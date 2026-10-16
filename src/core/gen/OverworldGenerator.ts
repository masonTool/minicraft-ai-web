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
import { applyClimateGain, biomeForColumn, findLandBiome, type BiomeDef } from './Biome.ts';
import { DoublePerlinNoise, NormalNoise } from './noise/PerlinNoise.ts';
import { Random } from './noise/Random.ts';
import { Spline } from './noise/Spline.ts';
import { AMPLIFIED_RELIEF_SCALE, type WorldType } from './WorldType.ts';

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

/** 稳定种子混合，用于给子生成器派生独立随机流 */
function mixSeed(seed: number, salt: number): number {
  let h = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(salt | 0, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** 原版的峰谷折叠函数 */
function peaksAndValleys(weirdness: number): number {
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
  /** 粗网格节点的地表高度缓存（地物/结构会反复查询同一片区域） */
  private readonly surfaceYCache = new Map<number, number>();

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

    // firstOctave / amplitudes 采用官方 overworld 的公开参数
    this.continents = new DoublePerlinNoise(random, -9, [1, 1, 2, 2, 2, 1, 1, 1, 1]);
    this.erosion = new DoublePerlinNoise(random, -9, [1, 1, 0, 1, 1]);
    this.ridges = new DoublePerlinNoise(random, -7, [1, 2, 1, 0, 0, 0]);
    this.temperature = new DoublePerlinNoise(random, -10, [1.5, 0, 1, 0, 0, 0]);
    this.humidity = new DoublePerlinNoise(random, -8, [1, 1, 0, 0, 0, 0]);
    this.detail3d = new NormalNoise(random, -5, [1, 1, 1, 0.6, 0.3]);
    this.ridgeNoise = new NormalNoise(random, -3, [1, 0.7]);

    // 大陆度 → 高度偏移。
    // 校准目标：偏移 ≈ 0 时地表刚好落在海平面附近（即海岸线），
    // 因此大陆度约 -0.22 以上为陆地，海陆比接近原版的"约一半海洋"。
    this.offsetSpline = new Spline([
      { location: -1.1, value: -0.3 },
      { location: -0.78, value: -0.25 },
      { location: -0.55, value: -0.16 },
      { location: -0.4, value: -0.07 },
      { location: -0.24, value: 0.0 },
      { location: -0.1, value: 0.06 },
      { location: 0.05, value: 0.11 },
      { location: 0.25, value: 0.17 },
      { location: 0.5, value: 0.24 },
      { location: 0.8, value: 0.32 },
      { location: 1.1, value: 0.38 },
    ]);

    // 侵蚀度 → 起伏强度（侵蚀度越低越崎岖）
    this.factorSpline = new Spline([
      { location: -1.1, value: 1.55 },
      { location: -0.7, value: 1.2 },
      { location: -0.4, value: 0.85 },
      { location: -0.15, value: 0.55 },
      { location: 0.15, value: 0.32 },
      { location: 0.45, value: 0.14 },
      { location: 0.75, value: 0.05 },
      { location: 1.1, value: 0.0 },
    ]);

    // 侵蚀度 → 山脊锐度（只在地形崎岖的区域生效）
    this.jaggednessSpline = new Spline([
      { location: -1.1, value: 0.95 },
      { location: -0.85, value: 0.7 },
      { location: -0.65, value: 0.42 },
      { location: -0.5, value: 0.18 },
      { location: -0.35, value: 0.04 },
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
    return findLandBiome(
      applyClimateGain({
        temperature: this.temperature.getValue(x, 0, z),
        humidity: this.humidity.getValue(x, 0, z),
        continentalness: this.continents.getValue(x, 0, z),
        erosion: this.erosion.getValue(x, 0, z),
        depth: 0,
        weirdness: this.ridges.getValue(x, 0, z),
      }),
    );
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
    const raw = this.climateAt(x, z);
    return biomeForColumn(
      {
        temperature: raw.temperature,
        humidity: raw.humidity,
        continentalness: raw.continent,
        erosion: raw.erosion,
        depth: 0,
        weirdness: raw.weirdness,
      },
      this.surfaceY(x, z),
      SEA_LEVEL,
    );
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
    let density = gradient + detail * (0.5 + factor * 0.85);

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
  private targetSurface(x: number, z: number, slot: number, factor: number): number {
    const grid = this.climateGrid;
    const offset = this.offsetSpline.apply(grid[slot]!);
    const jaggedness = this.jaggednessSpline.apply(grid[slot + 1]!);
    const pv = peaksAndValleys(grid[slot + 2]!);

    // `amplified` 世界把三项起伏都乘一个倍率：山更高、峡谷更深（原版放大化的观感），
    // 同时把高度夹在世界高度之内，免得山尖顶出上限、出现"被切平"的怪地形。
    const relief = this.reliefScale;
    let surface = SEA_LEVEL + offset * 96 * relief;
    surface += pv * factor * 40 * relief;
    if (jaggedness > 0.001) surface += jaggedness * Math.abs(this.ridgeNoise.getValue(x, 0, z)) * 46 * relief;
    if (surface > WORLD_MAX_Y - 12) surface = WORLD_MAX_Y - 12;
    return surface;
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
    this.aquifer.fill(blocks, originX, originZ);
    this.oreGenerator.generate(blocks, cx, cz, (wx, wz) => this.erosion.getValue(wx, 0, wz));

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
        if (top < WORLD_MIN_Y) continue;

        const raw = this.climateAt(worldX, worldZ);
        const biome = biomeForColumn(
          {
            temperature: raw.temperature,
            humidity: raw.humidity,
            continentalness: raw.continent,
            erosion: raw.erosion,
            depth: 0,
            weirdness: raw.weirdness,
          },
          top,
          SEA_LEVEL,
        );
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
