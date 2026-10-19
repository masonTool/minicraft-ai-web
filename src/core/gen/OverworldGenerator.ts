/**
 * 主世界地形生成器（1.18 体系）
 *
 * 结构完全对齐 1.18 的"噪声路由器"思路：
 *   1. 二维气候噪声：大陆度 / 侵蚀度 / 奇异度 / 温度 / 湿度
 *      （大陆度决定海陆分布；侵蚀度决定地形起伏强度；奇异度经折叠后给出峰谷）
 *   2. 样条插值：气候参数 → 高度偏移、起伏系数、山脊锐度
 *   3. 三维密度：地表高度梯度 + 三维噪声细节 → 密度场（> 0 为固体）
 *   4. 密度场按 4×8×4 的粗网格采样 + 三线性插值（原版同款做法，
 *      每个区块只需 5×49×5 = 1225 次采样，而不是 98304 次）
 *   5. 地表规则 + 灌水 + 基岩层
 *
 * ⚠️ 诚实说明：这是**算法结构与官方一致、参数经视觉校准**的实现，
 * 不是逐位对齐官方 noise_settings JSON 的复刻（后者依赖官方数据包文件）。
 * 群系分布、洞穴雕刻、含水层将在 D6~D12 继续补齐。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block } from '../registry/blocks.ts';
import {
  type BlockArray,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  Chunk,
  WORLD_HEIGHT,
  WORLD_MAX_Y,
  WORLD_MIN_Y,
  createBlockArray,
} from '../world/Chunk.ts';
import { Aquifer } from './Aquifer.ts';
import { CaveCarver } from './CaveCarver.ts';
import { bandBlockAt, columnSurface } from './SurfaceRules.ts';
import { OreGenerator } from './OreGenerator.ts';
import {
  Biome,
  applyClimateGain,
  biomeById,
  biomeForColumn,
  caveBiomeAt,
  findLandBiome,
  regionVariantAt,
  type BiomeDef,
} from './Biome.ts';
import { DoublePerlinNoise, NormalNoise } from './noise/PerlinNoise.ts';
import { Random } from './noise/Random.ts';
import { Spline, smoothstep } from './noise/Spline.ts';
import { AMPLIFIED_RELIEF_SCALE, FLAT_SURFACE_Y, type WorldType } from './WorldType.ts';

/** 海平面（原版主世界海平面为 y=63） */
export const SEA_LEVEL = 63;

/** 密度采样单元格：水平 4 格、竖直 8 格，与原版一致 */
const CELL_XZ = 4;
const CELL_Y = 8;
const GRID_XZ = CHUNK_SIZE_X / CELL_XZ + 1; // 5
const GRID_Y = WORLD_HEIGHT / CELL_Y + 1; // 49

/** 气候通道数：大陆度 / 侵蚀度 / 奇异度 / 温度 / 湿度 */
const CHANNELS = 5;

/** 深板岩起始深度（原版 y=0 附近开始过渡） */
const DEEPSLATE_TOP = 0;
const DEEPSLATE_FULL = -8;

/**
 * 三维细节的**贴地衰减**（N9-a）：离目标地表越近，`detail3d` 的权重越小。
 *
 * 为什么需要它：`detail3d` 的幅度是按"山"的尺度折算的（×26 后最大 ±47 格），
 * 而它的频率是 4~32 格那一档 —— **幅度按山的尺度、频率按 4 格的尺度**，
 * 于是相邻几格的地表高度能差十几格，看起来是一片尖刺而不是山脊（这就是 N9 的"碎"）。
 * 衰减之后，玩家看到的形状更多由**二维样条那张面**决定（那是按山的尺度做的），
 * 三维细节退到它该在的地方：深处（悬崖/悬垂/洞穴口）。
 *
 * ⚠️⚠️ **下限不能是 0**：第一版把正地表处的权重设成 0，结果**判据 1 反而从 60.2% 涨到 65.8%** ——
 * 因为那会造出一个"死区"：`|R| < 24` 的节点解出来**恰好落在二维样条面上**、
 * `|R| > 24` 的节点跳到 `surface + R`，相邻节点之间于是出现**硬跳变**。
 * 有下限（当前实测为 0.35）就没有阈值，权重随距离连续变化；相较旧值 0.5，
 * 陆地纵向碎层更少，同时仍守住默认 / 放大化世界的连续高地预算。
 *
 * ⚠️ 这两个数就是"碎 ↔ 平"的旋钮，改它们必须重跑 `npm run test:terrain`
 * 并把 BUDGETS 跟着改紧（见 TASKS N9 的 a 项）。
 */
const DETAIL_FADE_FLOOR = 0.12;
const DETAIL_FADE_BLOCKS = 16;

/**
 * 三维细节的**总权重**（批次 179）。
 *
 * 旧写法是 `detail * (0.5 + factor * 0.85)` —— 那个 **0.5 的常数项**是关键问题：
 * 侵蚀度最高的"平坦区"（factor ≈ 0）本来应该完全没有三维起伏，却仍带着 0.5 的权重
 * （按 1/26 的梯度折算 ≈ ±13 格），于是**平原也长不出一块平地**。
 * 现在改成纯 `factor * 1.1`：平原（factor ≈ 0.05）几乎零扰动，
 * 山区（factor ≈ 0.75）才有 ±20 格上下的悬崖与悬垂。
 */
const DETAIL_SCALE = 0.5;

/**
 * 三维细节对密度的**最大扰动**（批次 179）。
 *
 * 为什么必须夹：`detail3d` 是 5 个八度叠加，尾部能到 3~4 个标准差。而竖直梯度只有
 * 1/26（1 个密度单位 = 26 格），所以不夹的话"负向尾部"能把零点一路往下推 ——
 * 实测海床最深处被推到 **y=10**（比基准面低了 24 格），症状就是"海底突然出现深坑"。
 * 夹到 ±0.45 之后，三维噪声最多只能把地表上下挪 **约 12 格**：
 * 悬崖、洞口、悬垂都还在，但不会再把海底捅穿。
 */
const DETAIL_MAX = 0.45;

/**
 * 起伏的**海陆门控**（批次 179，TASKS N10 的正解）。
 *
 * N10 记着"海太深、岸是墙"的根因是 `offset * 96`；这次量下来真正的根因是
 * **峰谷项与山脊项在水下照样叠加**：`offset` 深海端给到 y=34.2（与原版深海一致），
 * 但 `pv * factor * 40` 又在它身上叠了 ±62 格，于是海床被拖到 -20~-64。
 *
 * 三次"事后压缩"的尝试都失败了，因为它们压的是**求和之后**的 `surface`，
 * 已经分不清"这格是被峰谷项拖下去的"还是"本来就该是深海"，必然误伤近岸陆地。
 * 正确的位置是**加之前门控**：按"大陆度给的基准面"离海平面多远来缩放起伏项。
 *
 * ⚠️ 水下不能压到 0：那会得到一块绝对平面，也不合常理。留 0.12 的底，
 * 海底保留 ±8 格以内的平缓起伏（浅滩、缓沟、海山）。
 */
const UNDERWATER_RELIEF = 0.12;
const RELIEF_GATE_BLOCKS = 20;

/** 山脊噪声的绝对值上限（见 `targetSurface` 里的说明） */
const RIDGE_LIMIT = 1.5;

/** 稳定种子混合，用于给子生成器派生独立随机流 */
function mixSeed(seed: number, salt: number): number {
  let h = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(salt | 0, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * 起伏项里"噪音值"的夹紧上限（批次 179）。
 *
 * 与 `applyClimateGain` 对气候参数用的 ±1.1 是同一个口径：**样条/折叠函数只在自己
 * 的端点之内才有意义**，端点之外必须夹住。原版是靠 `CubicSpline` 在首末点截断做到的，
 * 而这里是手写的公式，漏了这一步。
 */
const CLIMATE_LIMIT = 1.1;

/**
 * 原版的峰谷折叠函数。
 *
 * ⚠️ 批次 179 修的关键点：**输入必须先夹到 ±1.1**。
 *
 * 折叠式 `-(|(|w| - 2/3)| - 1/3) × 3` 只在 |w| ≤ 1.1 内取值于 [-1, 1]；
 * |w| 越大它会**一路往下跑**（`|w| = 1.94` 时约 -2.8，`|w| = 4` 时约 -10）。
 * 而 `weirdness` 是标准差 1 的噪声，四分之一的采样点都超出 ±1.1 ——
 * 于是 `pv × factor × 40` 能给出 **-110 格**，这才是"世界最低点到 y=-64、
 * 海底出现无底深坑、岸变成墙"的真正来源（偏移项 `offset × 96` 其实是干净的）。
 *
 * 实测：夹紧之前最深处 y=15（基准面本应是 y=85.6，被 -2.8 的 pv 拖下去 70 格）；
 * 夹紧之后 pv 恒在 [-1, 1] 内，`pv × factor × 40` 的负向极限就是 -30 格。
 */
function peaksAndValleys(rawWeirdness: number): number {
  const weirdness = rawWeirdness > CLIMATE_LIMIT ? CLIMATE_LIMIT : rawWeirdness < -CLIMATE_LIMIT ? -CLIMATE_LIMIT : rawWeirdness;
  return -(Math.abs(Math.abs(weirdness) - 0.6666667) - 0.33333334) * 3;
}

function hash2(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 0xffffffff;
}

export class OverworldGenerator {
  private readonly continents: DoublePerlinNoise;
  private readonly erosion: DoublePerlinNoise;
  private readonly ridges: DoublePerlinNoise;
  private readonly temperature: DoublePerlinNoise;
  private readonly humidity: DoublePerlinNoise;
  /** 三维细节噪声：制造悬崖、洞穴口、悬垂 */
  private readonly detail3d: NormalNoise;
  /** 山脊噪声：制造尖锐山峰 */
  private readonly ridgeNoise: NormalNoise;

  private readonly offsetSpline: Spline;
  private readonly factorSpline: Spline;
  private readonly jaggednessSpline: Spline;

  private readonly carver: CaveCarver;
  private readonly aquifer: Aquifer;
  private readonly oreGenerator: OreGenerator;

  // 复用缓冲区，避免每次生成都重新分配
  private readonly climateGrid = new Float32Array(GRID_XZ * GRID_XZ * CHANNELS);
  private readonly densityGrid = new Float32Array(GRID_XZ * GRID_XZ * GRID_Y);
  /**
   * 每列**雕刻前**的地形顶面（`z * 16 + x`，批次 283）。
   *
   * 含水层要用它判断"这一列是不是在海面以下"：是的话水位强制到海平面，
   * 让海底被掏空出来的洞穴与海连成一片，而不是留一层悬空的水
   * （水在加载后不会自己流，见 `Aquifer.fill` 的说明）。
   */
  private readonly columnTop = new Int16Array(CHUNK_SIZE_X * CHUNK_SIZE_Z);
  /** 粗网格节点的地表高度缓存（地物/结构会反复查询同一片区域） */
  private readonly surfaceYCache = new Map<number, number>();
  /** 陆地群系按 4 格粗格缓存（批次 340 的 3×3 多数投票要用 9 个邻格） */
  private readonly landBiomeCache = new Map<string, number>();

  /**
   * 起伏倍率：默认 1，放大化世界把山体与峡谷的幅度整体放大。
   * 在构造函数体里赋值：`worldType` 是参数属性，字段初始化式里读它会被判为"用在自己初始化之前"。
   */
  private readonly reliefScale: number;

  constructor(
    seed: number,
    /** 世界类型：目前只有 `amplified` 会改参数（把起伏放大） */
    private readonly worldType: WorldType = 'default',
  ) {
    this.reliefScale = this.worldType === 'amplified' ? AMPLIFIED_RELIEF_SCALE : 1;
    const random = new Random(seed);

    /**
     * 气候噪声的 firstOctave / amplitudes 取自官方 overworld 的公开参数，
     * **批次 179 把能量的重心整体挪到了大尺度**（N9-a 只压了 8/4/2 格那三档，
     * 而真正的主力是 128/64/32 那三档 —— 它们各带权重 2）。
     *
     * 为什么必须挪：按空间尺度分解实测（`default`，各尺度上的平均高差，单位格）——
     *
     *   | 项 | 4格 | 8格 | 16格 | 32格 | 64格 | 128格 | 256格 |
     *   | --- | --- | --- | --- | --- | --- | --- | --- |
     *   | offset（大陆度×96） | 7.5 | 9.8 | 14.7 | **15.5** | 14.6 | 8.3 | 7.1 |
     *   | pv（峰谷×起伏×40） | 11.0 | 17.4 | 22.9 | **24.0** | 22.1 | 15.9 | 14.3 |
     *   | jag（山脊×46） | 4.5 | 6.3 | 6.9 | 0 | 0 | 0 | 0 |
     *
     * 也就是说**起伏的峰值落在 16~32 格那一档、振幅 ±30 格** ——
     * 这是"每隔十几格就有一座小山包"，玩家看到的就是"碎"，而不是"一整片山"。
     * 现在把 512 / 256 两档抬起来（2.4 / 1.7），128 / 64 / 32 逐级压下去
     * （0.85 / 0.42 / 0.18）：同样的总落差（按方差归一化后标准差仍是 1）
     * 会摊到 256~1024 格上 —— 那才是"一片平原 / 一整座山 / 一条海岸线"。
     *
     * ⚠️ **只改数值，不改"哪几档非零"**：`DoublePerlinNoise`/`NormalNoise` 每个非零振幅
     * 消耗一次 `random`，改了非零的个数会让后面所有噪声整体错位（世界跟着变），
     * 那就不是"只调了这几档"了。—— 这也是本批"不动世界类型、直接改默认世界"的底气：
     * 参数一改，对照的是 `git show HEAD:src/core/gen/OverworldGenerator.ts` 那份。
     */
    this.continents = new DoublePerlinNoise(random, -9, [2.4, 1.7, 0.85, 0.42, 0.18, 0.06, 0.02, 0.008, 0.004]);
    this.erosion = new DoublePerlinNoise(random, -9, [1.6, 1.2, 0, 0.2, 0.04]);
    // 山脊那一路 128/256 → **256/512 格**（`-8 → -9`）：峰谷本来就该是几百格一座
    this.ridges = new DoublePerlinNoise(random, -9, [1, 2, 1, 0, 0, 0]);
    this.temperature = new DoublePerlinNoise(random, -10, [1.5, 0, 1, 0, 0, 0]);
    this.humidity = new DoublePerlinNoise(random, -8, [1, 1, 0, 0, 0, 0]);
    /**
     * 三维细节噪声：制造悬崖、洞穴口、悬垂。
     *
     * N9-a 调过两处（**只动幅度值与首八度，振幅个数保持 5 个非零不变**）：
     *  - 首八度 `-5 → -4`：基准波长 32 格 → **64 格**（"山脊要的是 16~64 格的起伏"）；
     *  - 幅度 `[1,1,1,0.6,0.3] → [1,1,0.6,0.15,0.05]`：把高频那两档压下去
     *    （原来 4 格与 2 格那一档还带着 0.6/0.3 的权重，而密度粗网格在 XZ 上每 4 格采一次、
     *    在 Y 上每 8 格采一次 —— 2~4 格的东西**采不到，只会走样**）。
     *
     * ⚠️ **非零振幅的个数不能变**：`NormalNoise` 每个非零振幅消耗一次 `random`，
     * 而 `ridgeNoise` 用的是同一条流 —— 改个数会让后面的噪声整体错位（世界跟着变），
     * 那就不是"只调了 detail3d"了。`valueFactor` 按方差归一化，所以压高频**不会让整体变平**，
     * 只是把能量挪到低频。
     */
    this.detail3d = new NormalNoise(random, -4, [1, 1, 0.6, 0.15, 0.05]);
    /**
     * 山脊噪声：制造尖锐山峰。
     *
     * N9-a：首八度 `-3 → -5`（基准波长 **8 格 → 32 格**）。
     * 原来 8 格与 4 格那一档要乘以最大 46 格的高度 —— 也就是说**每隔 4 格地形就上下跳几十格**，
     * 这正是"碎"的主力（实测把它留在 8 格时，光压平 `detail3d` 反而让判据 1 从 60.2% 涨到 65.8%：
     * 尖刺换了个来源，看得更清楚了）。
     *
     * 批次 179：`-5 → -7`（**32/16 格 → 128/64 格**）。32 格波长配 46 格振幅，
     * 等于"每隔三十格立一根四十格高的尖刺"——那不是山脊，那是牙签阵。
     * 波长放大到 128 格之后，同样的振幅才是"一道山脊"。
     * 非零振幅仍是 2 个，`random` 的消耗次数不变，所以后面的噪声（含水层/洞穴另用独立流）不错位。
     */
    this.ridgeNoise = new NormalNoise(random, -7, [1, 0.7]);

    /**
     * 大陆度 → 高度偏移。
     *
     * 校准目标：偏移 ≈ 0 时地表刚好落在海平面附近（即海岸线），
     * 因此大陆度约 -0.24 以上为陆地，海陆比接近原版的"约四成海洋"
     * （实测海占 40%，与原版随机一片区域的观感一致）。
     *
     * 批次 179：**正半段整体压到原来的约 55%**（`1.1 → 0.38` 改成 `1.1 → 0.209`）。
     * 负半段**一格不动** —— 深海端 `-0.3 × 96 = y34.2` 正是原版深海的深度，
     * 海太深的锅在起伏项（见 `UNDERWATER_RELIEF`），不在这一条。
     * 正半段压下来之后，内陆基准面最高只到 y≈83，于是"平原"成为占比最大的一档，
     * 丘陵与山地改由起伏项（侵蚀度低的少数区域）提供 —— 这才是"平原为主、少量缓山"。
     */
    this.offsetSpline = new Spline([
      { location: -1.1, value: -0.28 },
      { location: -0.78, value: -0.235 },
      { location: -0.55, value: -0.15 },
      { location: -0.4, value: -0.066 },
      { location: -0.24, value: 0.0 },
      { location: -0.1, value: 0.02 },
      { location: 0.15, value: 0.045 },
      { location: 0.45, value: 0.09 },
      { location: 0.7, value: 0.2 },
      { location: 0.9, value: 0.3 },
      { location: 1.1, value: 0.36 },
    ]);

    /**
     * 侵蚀度 → 起伏强度（侵蚀度越低越崎岖）。
     *
     * 批次 179：峰值 `1.55 → 0.75`、整条线下移。这个系数同时管两件事：
     * ① 峰谷项的高度（`pv * factor * 40`）；② **三维细节的权重**（`detail * factor * 1.1`）。
     * 旧值 1.55 让"最崎岖"的地方峰谷项到 ±62 格、三维细节到 ±44 格 ——
     * 山不再是山，是一片插满尖刺的碎屑。0.75 之后峰谷最多 ±30 格，
     * 而平原（factor ≈ 0.14）几乎没有起伏。
     */
    this.factorSpline = new Spline([
      { location: -1.1, value: 0.7 },
      { location: -0.7, value: 0.45 },
      { location: -0.4, value: 0.28 },
      { location: -0.15, value: 0.17 },
      { location: 0.15, value: 0.1 },
      { location: 0.45, value: 0.05 },
      { location: 0.75, value: 0.02 },
      { location: 1.1, value: 0.0 },
    ]);

    /**
     * 侵蚀度 → 山脊锐度（只在地形崎岖的区域生效）。
     * 批次 179：峰值 `0.95 → 0.9`，但**生效范围收窄**（只在侵蚀度很低的那一小片）。
     * 山脊项是"加分项"（只增不减），所以它是"造山"最合适的那一路：
     * 峰谷项会同时造出同样深的谷（谷里积水就变成"陡的下面又是水"），
     * 而山脊项只往上加。把它的门槛收紧、峰值留着，得到的就是
     * "平原为主 + 少数成片的缓山"。
     */
    this.jaggednessSpline = new Spline([
      { location: -1.1, value: 0.9 },
      { location: -0.85, value: 0.6 },
      { location: -0.65, value: 0.25 },
      { location: -0.5, value: 0.06 },
      { location: -0.35, value: 0.01 },
      { location: -0.2, value: 0.0 },
      { location: 1.1, value: 0.0 },
    ]);

    this.carver = new CaveCarver(new Random(mixSeed(seed, 0xc0ffee)));
    // 含水层用独立随机流派生，避免改动这里会连带改变地形/洞穴的噪声序列
    this.aquifer = new Aquifer(new Random(mixSeed(seed, 0xa9f10d)), SEA_LEVEL);
    this.oreGenerator = new OreGenerator(seed);
  }

  /** 采样一列的气候参数，写入 climateGrid 的指定槽位 */
  private sampleClimate(x: number, z: number, slot: number): void {
    const grid = this.climateGrid;
    grid[slot] = this.continents.getValue(x, 0, z);
    grid[slot + 1] = this.erosion.getValue(x, 0, z);
    grid[slot + 2] = this.ridges.getValue(x, 0, z);
    grid[slot + 3] = this.temperature.getValue(x, 0, z);
    grid[slot + 4] = this.humidity.getValue(x, 0, z);
  }

  /** 该点对外的气候参数（供生物群系与地表规则使用） */
  climateAt(x: number, z: number): { continent: number; erosion: number; weirdness: number; temperature: number; humidity: number } {
    return {
      continent: this.continents.getValue(x, 0, z),
      erosion: this.erosion.getValue(x, 0, z),
      weirdness: this.ridges.getValue(x, 0, z),
      temperature: this.temperature.getValue(x, 0, z),
      humidity: this.humidity.getValue(x, 0, z),
    };
  }

  /** 该列的含水层水位（世界坐标，供测试与调试面板使用） */
  waterLevelAt(x: number, z: number): number {
    return this.aquifer.waterLevelAt(x, z);
  }

  /**
   * 该列所属的生物群系。
   * 地形采样出的五个气候参数直接作为参数空间坐标交给群系匹配器；
   * depth 维度目前恒为 0（所有群系的 depth 区间都是全集，不影响匹配结果）。
   */
  biomeAt(x: number, z: number): BiomeDef {
    const base = findLandBiome(
      applyClimateGain({
        temperature: this.temperature.getValue(x, 0, z),
        humidity: this.humidity.getValue(x, 0, z),
        continentalness: this.continents.getValue(x, 0, z),
        erosion: this.erosion.getValue(x, 0, z),
        depth: 0,
        weirdness: this.ridges.getValue(x, 0, z),
      }),
    );
    // 批次 342：母群系命中之后，再按 64 格区域决定是不是变体
    return regionVariantAt(base, x, z);
  }

  /**
   * 某个**粗网格节点**的地表高度（密度场在该节点上的零点）。
   *
   * ⚠️ 不能对解析式直接求根：解析式给的是"该点自己的零点"，而真实地形是在
   * **粗网格的 Y 层上取值再线性插值**出来的（Y 层间隔 8 格）。detail 三维噪声
   * 在 8 格内的起伏会被线性插值抹平，两者实测能差几十格。
   * 因此这里必须在粗网格的 Y 层上找"最上面那个密度 > 0 的层"。
   *
   * 性能：解析式先给一个粗估高度 y_est，从 y_est + 48 那一层往下扫（detail 的
   * 量级决定了真实零点不会高出这个上界太多），通常扫几层就命中；
   * 万一没命中再从最顶层完整扫一遍兜底。
   */
  private nodeSurfaceY(x: number, z: number): number {
    const key = ((x + 0x4000) * 0x10000 + (z + 0x4000)) | 0;
    const cached = this.surfaceYCache.get(key);
    if (cached !== undefined) return cached;

    // 复用 climateGrid 的第 0 槽位：地物装饰发生在 generate() 全部结束之后
    this.sampleClimate(x, z, 0);
    const factor = this.factorSpline.apply(this.climateGrid[1]!);
    // ⚠️ 与 `densityAt` 共用同一份公式（N9 之前这里是另一份、少了 relief 与夹紧）
    const surface = this.targetSurface(x, z, 0, factor);
    const spread = (0.5 + factor * 0.85) * 26;
    let estimate = surface;
    for (let i = 0; i < 2; i++) estimate = surface + this.detail3d.getValue(x, estimate, z) * spread;

    const topLevel = GRID_Y - 2;
    const densityAt = (gy: number): number => this.densityAt(x, WORLD_MIN_Y + gy * CELL_Y, z, 0);

    const startLevel = Math.min(topLevel, Math.max(0, Math.ceil((estimate + 48 - WORLD_MIN_Y) / CELL_Y)));
    let found = -1;
    for (let gy = startLevel; gy >= 0; gy--) {
      if (densityAt(gy) > 0) {
        found = gy;
        break;
      }
    }
    if (found < 0) {
      for (let gy = topLevel; gy >= 0; gy--) {
        if (densityAt(gy) > 0) {
          found = gy;
          break;
        }
      }
    }
    if (found < 0) return SEA_LEVEL;

    /**
     * ⚠️ N9 修的那一步（**别删**）：上面那段只在"起点落在**地表之上**"时才给出正确答案。
     *
     * 起点是 `estimate + 48`，而 `estimate` 只是"解析式 + 两次不动点迭代"的**近似**——
     * 它完全可能落在**实心地形内部**。那种情况下第一段循环的第一次采样就命中
     * "密度 > 0"，于是 `found` 停在**地形内部某一层**而不是地表，返回一个偏低的高度
     * （症状：树埋进山体、地表规则铺错一层）。
     *
     * 所以找到之后要**再往上走到这一段的上沿**。
     * 常见情况（起点在地表之上）这一段一次循环都不进，与原来的行为完全一致；
     * 单独修这一处，`npm run test:terrain` 的判据 1 从 60.9% 降到 60.2%。
     */
    while (found + 1 <= topLevel && densityAt(found + 1) > 0) found++;

    const d0 = densityAt(found);
    const d1 = densityAt(found + 1);
    const y0 = WORLD_MIN_Y + found * CELL_Y;
    // 密度场在 Y 上并非严格单调（detail 噪声会造出局部起伏），t 需要夹紧
    const t = d0 === d1 ? 0 : Math.min(1, Math.max(0, d0 / (d0 - d1)));
    const y = y0 + t * CELL_Y;

    if (this.surfaceYCache.size > 16384) this.surfaceYCache.clear();
    this.surfaceYCache.set(key, y);
    return y;
  }

  /**
   * **仅供测试与调试**：某一列在粗网格上的"实心段"分布（单位：格，`[顶, 底]` 成对，
   * 从高到低）。
   *
   * 为什么要有它（N9）：实测一列**最多能有 4 段互相隔开的实心块**（平均 1.5 段）——
   * 也就是说密度场在竖直方向被切得很碎（一层薄片、空气、再一层），
   * 而地表高度是按"往下扫到的第一段"推出来的，**扫到哪一段就决定了树长在哪**。
   * 这是"碎"在竖直方向的另一半，光看水平高差（判据 1）看不出来。
   *
   * 命名照 `structureInstanceForTest` 的先例（测试面向的公开入口）。
   */
  densityRunsAt(x: number, z: number): Array<[number, number]> {
    this.sampleClimate(x, z, 0);
    const runs: Array<[number, number]> = [];
    let top: number | null = null;
    for (let gy = GRID_Y - 2; gy >= 0; gy--) {
      const solid = this.densityAt(x, WORLD_MIN_Y + gy * CELL_Y, z, 0) > 0;
      if (solid && top === null) top = WORLD_MIN_Y + gy * CELL_Y;
      else if (!solid && top !== null) {
        runs.push([top, WORLD_MIN_Y + (gy + 1) * CELL_Y]);
        top = null;
      }
    }
    if (top !== null) runs.push([top, WORLD_MIN_Y]);
    return runs;
  }

  /**
   * 该列的近似地表高度（世界 Y）。
   *
   * 为什么需要它：地物（树、花）与结构（村庄、矿井）的落点必须**只依赖世界坐标**，
   * 否则同一棵树在相邻两个区块里会被算到不同高度，跨区块的树冠就会错位。
   *
   * ⚠️ 关键点：地形是**在 4×8×4 的粗网格上采样密度再做三线性插值**得到的，
   * 所以不能直接对该列的解析式求根——两者能差出 90 多格（实测）。
   * 正确做法与网格化一致：在周围 4 个粗网格节点上求零点，再按位置双线性插值。
   * 因为 density 对 y 是一次函数（斜率恒为 -1/26），"先插值密度再求根"与
   * "先求根再插值高度"完全等价，所以这样做既便宜（4 次采样）又准确。
   */
  surfaceY(x: number, z: number): number {
    // 超平坦没有噪声地形：地表恒为 FLAT_SURFACE_Y（批次 238）。
    // 不特判的话，出生点规划会按"一份根本不存在的噪声地形"来选位置，
    // 和真正生成出来的平地完全对不上。
    if (this.worldType === 'flat') return FLAT_SURFACE_Y;

    const gx = Math.floor(x / CELL_XZ) * CELL_XZ;
    const gz = Math.floor(z / CELL_XZ) * CELL_XZ;
    const tx = (x - gx) / CELL_XZ;
    const tz = (z - gz) / CELL_XZ;

    const h00 = this.nodeSurfaceY(gx, gz);
    const h10 = this.nodeSurfaceY(gx + CELL_XZ, gz);
    const h01 = this.nodeSurfaceY(gx, gz + CELL_XZ);
    const h11 = this.nodeSurfaceY(gx + CELL_XZ, gz + CELL_XZ);

    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    return Math.round(top + (bottom - top) * tz);
  }

  /**
   * 该列的群系（含海陆判定：地表低于海平面时按海洋群系处理）。
   * 供地物与结构使用；与 `applySurface` 里的判定完全同一套逻辑。
   */
  columnBiome(x: number, z: number): BiomeDef {
    const top = this.surfaceY(x, z);
    // 海洋 / 海岸仍按"地表高度 + 温度"判（那是水线决定的，不能平滑）
    if (top <= SEA_LEVEL) {
      const raw = this.climateAt(x, z);
      return biomeForColumn(this.climatePointOf(raw), top, SEA_LEVEL);
    }
    // 批次 353：山峰按高度判，不能走"气候平面 + 平滑"
    const peak = biomeForColumn(this.climatePointOf(this.climateAt(x, z)), top, SEA_LEVEL);
    if (peak.id === Biome.JAGGED_PEAKS || peak.id === Biome.FROZEN_PEAKS) return peak;
    return this.smoothedLandBiomeAt(x, z);
  }

  private climatePointOf(raw: {
    continent: number;
    erosion: number;
    weirdness: number;
    temperature: number;
    humidity: number;
  }): {
    temperature: number;
    humidity: number;
    continentalness: number;
    erosion: number;
    depth: number;
    weirdness: number;
  } {
    return {
      temperature: raw.temperature,
      humidity: raw.humidity,
      continentalness: raw.continent,
      erosion: raw.erosion,
      depth: 0,
      weirdness: raw.weirdness,
    };
  }

  /** 4 格粗网格上的陆地群系（只依赖气候；缓存，避免 9 邻域重复采样） */
  private landBiomeAtCell(cellX: number, cellZ: number): number {
    const key = `${cellX},${cellZ}`;
    const hit = this.landBiomeCache.get(key);
    if (hit !== undefined) return hit;
    const x = cellX * CELL_XZ + (CELL_XZ >> 1);
    const z = cellZ * CELL_XZ + (CELL_XZ >> 1);
    const base = findLandBiome(applyClimateGain(this.climatePointOf(this.climateAt(x, z))));
    const biome = regionVariantAt(base, x, z);
    if (this.landBiomeCache.size > 200_000) this.landBiomeCache.clear();
    this.landBiomeCache.set(key, biome.id);
    return biome.id;
  }

  /**
   * 陆地群系平滑（批次 340）：在 **3×3 个 4 格粗格**上做多数投票。
   *
   * 为什么需要它：1.18 的群系边界是**平滑**的（原版先低分辨率采样再放大/模糊），
   * 而这里是逐列点采样。宽区间群系看不出来，但"变体"必须比母群系窄才赢——
   * 一窄就会被噪声切成"一格一换"的碎片（实测花海 24 格碎成 19 块）。
   *
   * 判据：**取 3×3 里票数最多的那个**（平票时保留中心格）。
   *
   * ⚠️ 第一版写的是"至少 5/9 票才改判，否则保留中心"——那样**孤立单格永远不会被吸收**
   * （它自己是中心、9 格里只有 1 票），碎片一个都消不掉。改成"多数即改判"之后，
   * 3 格以下的窄带会被邻格吞掉：这是想要的效果（宁可不出现，也不要"一格一换"）。
   */
  private smoothedLandBiomeAt(x: number, z: number): BiomeDef {
    const cx = Math.floor(x / CELL_XZ);
    const cz = Math.floor(z / CELL_XZ);
    const ids = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    let center = 0;
    let k = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const id = this.landBiomeAtCell(cx + dx, cz + dz);
        ids[k++] = id;
        if (dx === 0 && dz === 0) center = id;
      }
    }
    const countOf = (id: number): number => {
      let n = 0;
      for (let i = 0; i < 9; i++) if (ids[i] === id) n++;
      return n;
    };
    let winner = center;
    let best = countOf(center);
    let tie = false;
    for (let i = 0; i < 9; i++) {
      const id = ids[i]!;
      if (id === winner) continue;
      const n = countOf(id);
      if (n > best) {
        best = n;
        winner = id;
        tie = false;
      } else if (n === best) {
        tie = true;
      }
    }
    return biomeById(tie ? center : winner);
  }

  /**
   * 密度场：> 0 为固体。
   * @param slot climateGrid 中该列气候参数起始下标
   */
  private densityAt(x: number, y: number, z: number, slot: number): number {
    const grid = this.climateGrid;
    const factor = this.factorSpline.apply(grid[slot + 1]!);

    // 目标地表高度（与地物落点**共用同一份公式**，见 `targetSurface`）
    const surface = this.targetSurface(x, z, slot, factor);

    // 竖直梯度 + 三维细节
    const gradient = (surface - y) / 26;
    const detail = this.detail3d.getValue(x, y, z);
    // N9-a：**离地表越近，三维细节压得越平**（下限 `DETAIL_FADE_FLOOR`，不能是 0）
    const taper =
      DETAIL_FADE_FLOOR + (1 - DETAIL_FADE_FLOOR) * Math.min(1, Math.abs(surface - y) / DETAIL_FADE_BLOCKS);
    // 海陆门控同样管三维细节：水下几乎不给扰动（否则海床会被捅出深坑）
    const jitter = detail * factor * DETAIL_SCALE * taper * this.landGate(slot);
    let density = gradient + Math.max(-DETAIL_MAX, Math.min(DETAIL_MAX, jitter));

    // 深处强制实心，避免出现大片浮空岛（洞穴由 D10 的雕刻器另行挖出）
    if (y < surface - 34) density = Math.max(density, 1);
    return density;
  }

  /**
   * 该列的目标地表高度（N9）。
   *
   * **为什么必须是一个方法**：这条式子在 N9 之前有**两份**——
   * `densityAt` 里一份、`nodeSurfaceY` 里一份，而后者少了 `* relief` 与上限夹紧。
   * 后果不是"差一点"，是**结构性**的：`nodeSurfaceY` 拿它当"往下扫的起点"
   * （先估一个高度，再从那一层往下找第一个密度 > 0 的层），起点落在真实地表**之下**时，
   * 第一次采样就命中密度 > 0，于是**返回一个偏低的地表高度**。
   * 于是地物落点与真正的地形分家（树浮在半空/埋进山体），而**只有放大化世界会踩到**
   * （`reliefScale` 默认 1，两项恰好相等）——这类"只在某个世界类型下错"的 bug 最难查。
   *
   * ⚠️ `factor` 由调用方传入：它是**唯一**同时被"地表高度"与"三维细节系数"用到的量，
   * 传进来可以避免每个采样点多算一次样条（`densityAt` 每区块要跑 1225 次）。
   */
  /**
   * 海陆门控：`0.12`（水下）→ `1`（内陆）。
   * 按**基准面**离海平面多高来算，所以它只与大陆度有关，是个纯函数。
   */
  private landGate(slot: number): number {
    const base = SEA_LEVEL + this.offsetSpline.apply(this.climateGrid[slot]!) * 96;
    return UNDERWATER_RELIEF + (1 - UNDERWATER_RELIEF) * smoothstep(0, RELIEF_GATE_BLOCKS, base - SEA_LEVEL);
  }

  private targetSurface(x: number, z: number, slot: number, factor: number): number {
    const grid = this.climateGrid;
    const offset = this.offsetSpline.apply(grid[slot]!);
    const jaggedness = this.jaggednessSpline.apply(grid[slot + 1]!);
    const pv = peaksAndValleys(grid[slot + 2]!);

    /**
     * ① **基准面**：由大陆度单独决定，不含任何起伏项，**也不乘 relief**。
     *
     * ⚠️ 批次 179 的一处修正：原来这里写的是 `offset * 96 * relief`，于是
     * `amplified`（relief = 2.2）把海底基准面也乘了 2.2 —— 深海端 `-0.3 × 96 × 2.2`
     * 直接落到 y≈-0.4，海被"放大"成了无底洞。放大化只该放大**山**，不该放大海。
     *
     * 深海端 `-0.28 × 96` → y=36.1（与原版深海 y=30~50 同档），
     * 内陆高原端 `0.235 × 96` → y=85.6。海陆比例由它一条决定。
     */
    // 放大化只放大**陆地**的基准面（`offset > 0` 那一侧）：海底不动，海陆比例与海岸线
    // 因此与默认世界完全一致，差别只在"山更高"。`offset = 0` 处两侧都是 0，接缝连续。
    const base = SEA_LEVEL + offset * 96 * (offset > 0 ? this.reliefScale : 1);

    /**
     * ② **起伏**：峰谷与山脊，离海平面越近权重越小（见 `UNDERWATER_RELIEF`）。
     *
     * ⚠️ `ridgeNoise` 同样要夹：它是标准差 1 的噪声，|值| 的尾部能到 3~4，
     * 而山脊项是**只加不减**的，不夹的话最崎岖处能凭空顶出 0.9 × 3.5 × 46 ≈ +145 格 ——
     * 那就是"平地旁边突然一根尖塔"。
     */
    let hills = pv * factor * 40;
    if (jaggedness > 0.001) {
      const ridge = Math.abs(this.ridgeNoise.getValue(x, 0, z));
      hills += jaggedness * (ridge > RIDGE_LIMIT ? RIDGE_LIMIT : ridge) * 46;
    }

    // ⚠️ 水下的起伏**不受 relief 放大**：放大化只该放大山，不该把海也放大成无底洞。
    const gate = this.landGate(slot);
    const effectiveGate = UNDERWATER_RELIEF + (gate - UNDERWATER_RELIEF) * this.reliefScale;
    let surface = base + hills * effectiveGate;

    if (surface > WORLD_MAX_Y - 12) surface = WORLD_MAX_Y - 12;
    return surface;
  }


  /**
   * 洞穴装饰（批次 391）：在**露天的洞穴空气**里撒发光地衣 / 发光浆果 / 尖滴石。
   *
   * 为什么放在雕刻之后：这时洞穴已经是空气了，只需要看"空气格的上下是不是石头"。
   * 用坐标哈希而不是随机数：同一个种子/坐标必须永远得到同样的结果（存档、联机、跨区块重放）。
   */
  private decorateCaves(blocks: BlockArray, originX: number, originZ: number): void {
    const stoneLike = (id: number): boolean => id === Block.STONE || id === Block.DEEPSLATE;
    for (let y = 5; y < 56; y++) {
      for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        for (let x = 0; x < CHUNK_SIZE_X; x++) {
          const index = Chunk.index(x, y, z);
          const below = blocks[Chunk.index(x, y - 1, z)]!;
          if (blocks[index] === Block.DIRT && blocks[Chunk.index(x, y + 1, z)] === Block.AIR) {
            // 缠根泥土（批次 395）：洞穴顶部的泥土按哈希变体
            let hd = Math.imul(originX + x + 7, 73856093) ^ Math.imul(originZ + z + 7, 19349663) ^ Math.imul(y + 7, 83492791);
            hd = Math.imul(hd ^ (hd >>> 13), 1274126177);
            if (((hd ^ (hd >>> 16)) >>> 0) % 149 === 0) blocks[index] = Block.ROOTED_DIRT;
            continue;
          }
          if (blocks[index] !== Block.AIR) continue;
          const above = blocks[Chunk.index(x, y + 1, z)]!;
          // 三轴混合的整数哈希（同坐标恒定）
          let h = Math.imul(originX + x + 1, 73856093) ^ Math.imul(originZ + z + 1, 19349663) ^ Math.imul(y + 1, 83492791);
          h = Math.imul(h ^ (h >>> 13), 1274126177);
          h = (h ^ (h >>> 16)) >>> 0;
          const cave = caveBiomeAt(originX + x, y, originZ + z);
          const lush = cave?.id === Biome.LUSH_CAVES;
          if (lush && stoneLike(below) && h % 7 === 0) {
            // 繁茂洞穴（批次 397）：把石头地面换成苔藓，再按哈希长植物
            blocks[Chunk.index(x, y - 1, z)] = Block.MOSS_BLOCK;
            if (h % 3 === 0) blocks[index] = Block.GLOW_BERRIES;
            else if (h % 5 === 0) blocks[index] = Block.AZALEA;
            else if (h % 11 === 0) blocks[index] = Block.FLOWERING_AZALEA;
            else if (h % 17 === 0) blocks[index] = Block.SMALL_DRIPLEAF;
            else if (h % 23 === 0) blocks[index] = Block.BIG_DRIPLEAF;
            else if (h % 13 === 0) blocks[index] = Block.MOSS_CARPET;
            else if (h % 29 === 0) blocks[index] = Block.GLOW_LICHEN;
            continue;
          }
          if (stoneLike(below)) {
            // 繁茂洞穴：地衣/浆果；滴水石洞：少量地衣
            if (h % (lush ? 317 : 1103) === 0) blocks[index] = Block.GLOW_BERRIES;
            else if (h % (lush ? 197 : 1601) === 0) blocks[index] = Block.GLOW_LICHEN;
          } else if (stoneLike(above)) {
            // 滴水石洞：尖滴石/孢子花/垂根更密
            if (h % (lush ? 2203 : 401) === 0) blocks[index] = Block.POINTED_DRIPSTONE;
            else if (h % (lush ? 4999 : 701) === 0) blocks[index] = Block.SPORE_BLOSSOM;
            else if (h % (lush ? 3001 : 901) === 0) blocks[index] = Block.HANGING_ROOTS;
          }
        }
      }
    }
  }

  generate(cx: number, cz: number, out?: BlockArray): BlockArray {
    const blocks = out ?? createBlockArray();
    if (out) blocks.fill(0);

    const originX = cx * CHUNK_SIZE_X;
    const originZ = cz * CHUNK_SIZE_Z;

    this.sampleGrid(originX, originZ);
    this.fillFromDensity(blocks);
    this.applySurface(blocks, originX, originZ);
    this.applyBedrock(blocks);

    // 雕刻顺序对齐原版：地形 → 地表规则 → 雕刻 → 含水层 → 矿石
    this.carver.carve(blocks, originX, originZ);
    this.aquifer.fill(blocks, originX, originZ, this.columnTop);
    this.oreGenerator.generate(blocks, cx, cz, (wx, wz) => this.erosion.getValue(wx, 0, wz));
    this.decorateCaves(blocks, originX, originZ);

    return blocks;
  }

  /** 第一步：在粗网格上采样气候与密度 */
  private sampleGrid(originX: number, originZ: number): void {
    for (let gx = 0; gx < GRID_XZ; gx++) {
      const worldX = originX + gx * CELL_XZ;
      for (let gz = 0; gz < GRID_XZ; gz++) {
        const worldZ = originZ + gz * CELL_XZ;
        const slot = (gx * GRID_XZ + gz) * CHANNELS;
        this.sampleClimate(worldX, worldZ, slot);

        const densityBase = (gx * GRID_XZ + gz) * GRID_Y;
        for (let gy = 0; gy < GRID_Y; gy++) {
          const worldY = WORLD_MIN_Y + gy * CELL_Y;
          this.densityGrid[densityBase + gy] = this.densityAt(worldX, worldY, worldZ, slot);
        }
      }
    }
  }

  /** 第二步：三线性插值填石头 */
  private fillFromDensity(blocks: BlockArray): void {
    const grid = this.densityGrid;

    for (let gx = 0; gx < GRID_XZ - 1; gx++) {
      for (let gz = 0; gz < GRID_XZ - 1; gz++) {
        const base000 = (gx * GRID_XZ + gz) * GRID_Y;
        const base100 = ((gx + 1) * GRID_XZ + gz) * GRID_Y;
        const base001 = (gx * GRID_XZ + (gz + 1)) * GRID_Y;
        const base101 = ((gx + 1) * GRID_XZ + (gz + 1)) * GRID_Y;

        for (let gy = 0; gy < GRID_Y - 1; gy++) {
          const d000 = grid[base000 + gy]!;
          const d001 = grid[base001 + gy]!;
          const d100 = grid[base100 + gy]!;
          const d101 = grid[base101 + gy]!;
          const d010 = grid[base000 + gy + 1]!;
          const d011 = grid[base001 + gy + 1]!;
          const d110 = grid[base100 + gy + 1]!;
          const d111 = grid[base101 + gy + 1]!;

          const cellBaseY = WORLD_MIN_Y + gy * CELL_Y;

          for (let iy = 0; iy < CELL_Y; iy++) {
            const ty = iy / CELL_Y;
            // 先沿 Y 方向插值，减少内层重复计算
            const d00 = d000 + (d010 - d000) * ty;
            const d01 = d001 + (d011 - d001) * ty;
            const d10 = d100 + (d110 - d100) * ty;
            const d11 = d101 + (d111 - d101) * ty;

            const worldY = cellBaseY + iy;
            const yIndexBase = (worldY - WORLD_MIN_Y) * CHUNK_SIZE_Z * CHUNK_SIZE_X;

            for (let ix = 0; ix < CELL_XZ; ix++) {
              const tx = ix / CELL_XZ;
              const d0 = d00 + (d10 - d00) * tx;
              const d1 = d01 + (d11 - d01) * tx;
              const xBase = yIndexBase + (gx * CELL_XZ + ix);

              for (let iz = 0; iz < CELL_XZ; iz++) {
                const tz = iz / CELL_XZ;
                const density = d0 + (d1 - d0) * tz;
                if (density <= 0) continue;

                const worldX = gx * CELL_XZ + ix;
                const worldZ = gz * CELL_XZ + iz;
                blocks[xBase + worldZ * CHUNK_SIZE_X] =
                  worldY >= DEEPSLATE_TOP
                    ? Block.STONE
                    : worldY <= DEEPSLATE_FULL
                      ? Block.DEEPSLATE
                      : hash2(worldX, worldZ * 31 + worldY, 17) < (worldY - DEEPSLATE_FULL) / -DEEPSLATE_FULL
                        ? Block.STONE
                        : Block.DEEPSLATE;
              }
            }
          }
        }
      }
    }
  }

  /** 第三步：地表规则 + 灌水 */
  private applySurface(blocks: BlockArray, originX: number, originZ: number): void {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const worldX = originX + x;
        const worldZ = originZ + z;

        // 找最高固体方块
        let top = WORLD_MIN_Y - 1;
        for (let y = WORLD_MIN_Y + WORLD_HEIGHT - 1; y >= WORLD_MIN_Y; y--) {
          if (blocks[Chunk.index(x, y, z)] !== Block.AIR) {
            top = y;
            break;
          }
        }
        // 记录"雕刻前的地形顶面"：含水层据此判断这一列是否在水下（见 `columnTop`）
        this.columnTop[z * CHUNK_SIZE_X + x] = top;
        if (top < WORLD_MIN_Y) continue;

        const raw = this.climateAt(worldX, worldZ);
        // 海洋/海岸按水线判；陆地走 3×3 多数投票（与 `columnBiome` 同一套口径）
        const columnBiome = biomeForColumn(this.climatePointOf(raw), top, SEA_LEVEL);
        const isPeak =
          columnBiome.id === Biome.JAGGED_PEAKS || columnBiome.id === Biome.FROZEN_PEAKS;
        // 批次 353：山峰按高度判，不参与"气候平面 + 平滑"
        const biome =
          top <= SEA_LEVEL || isPeak ? columnBiome : this.smoothedLandBiomeAt(worldX, worldZ);
        const underwater = top < SEA_LEVEL;

        // 地表分层交给 SurfaceRules：群系地表 → 次表层 → （恶地的）深层彩色色带
        const profile = columnSurface(biome, top, SEA_LEVEL, worldX, worldZ);

        blocks[Chunk.index(x, top, z)] = profile.surface;
        for (let d = 1; d <= profile.subDepth; d++) {
          const y = top - d;
          if (y < WORLD_MIN_Y) break;
          const current = blocks[Chunk.index(x, y, z)]!;
          if (current !== Block.STONE && current !== Block.DEEPSLATE) break;
          blocks[Chunk.index(x, y, z)] = profile.subSurface;
        }

        // 恶地：次表层之下继续铺彩色陶瓦色带（原版恶地最标志性的特征）
        if (profile.deepBands) {
          const from = top - profile.subDepth - 1;
          const to = Math.max(WORLD_MIN_Y, top - profile.deepDepth);
          for (let y = from; y >= to; y--) {
            const current = blocks[Chunk.index(x, y, z)]!;
            if (current !== Block.STONE && current !== Block.DEEPSLATE) continue;
            blocks[Chunk.index(x, y, z)] = bandBlockAt(profile.deepBands, worldX, y, worldZ);
          }
        }

        // 灌水到海平面
        if (underwater) {
          for (let y = top + 1; y <= SEA_LEVEL; y++) {
            blocks[Chunk.index(x, y, z)] = Block.WATER;
          }
        }
      }
    }
  }

  /** 第四步：底部基岩层（越深越密，形成原版的参差不齐过渡） */
  private applyBedrock(blocks: BlockArray): void {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        blocks[Chunk.index(x, WORLD_MIN_Y, z)] = Block.BEDROCK;
        for (let d = 1; d <= 4; d++) {
          const y = WORLD_MIN_Y + d;
          const chance = 1 - d / 5;
          if (hash2(x * 7 + y, z * 13, 91) < chance * chance) blocks[Chunk.index(x, y, z)] = Block.BEDROCK;
        }
      }
    }
  }
}
