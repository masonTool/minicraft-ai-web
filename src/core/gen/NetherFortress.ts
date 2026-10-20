/**
 * 下界要塞（J26 的断环之一，批次 92）
 *
 * 为什么这一批非得做它：它是**下界疣唯一的天然产地**（原版只长在要塞的灵魂沙上），
 * 而下界疣是**整条酿造链的第一件原料**（水瓶 + 下界疣 = 粗制的药水）。
 * 批次 91 的可达性审计把这件事量出来了：**112 件药水与药水箭在生存里一瓶都拿不到**
 * （见 `tools/reachability-test.ts` 的白名单），根因就是这里。
 * 同一座要塞还要负责另一件事：**烈焰人**（→ 烈焰棒 → 烈焰粉 → 酿造台与它的燃料），
 * 所以大厅正中摆着一个刷怪笼（`Block.SPAWNER`，主线程按它生成烈焰人）。
 *
 * 与 `Bastion.ts` 的关系：**放置机制同源**（单元网格 + 世界坐标哈希 + 3×3 邻域重放，
 * 见 `Structures.ts` 的文件头），同样自带一套"下界锚点"（地板 / 洞顶 / 群系由
 * `NetherGenerator` 注入）。两座结构各有自己的间距/分离度/盐，互不干扰。
 *
 * ⚠️ 与原版的差距（记在 TASKS J26 的注记里）：
 *  - 原版要塞由一堆"拼图零件"随机拼（走廊/十字口/楼梯/阳台/烈焰人房间），
 *    这里**只有一种手写布局**（一条中轴走廊 + 一间大厅 + 两座塔）；
 *  - 原版是**悬在岩浆海上方的桥**，这里落在地板上（与堡垒遗迹同一个取舍）；
 *  - 原版要塞里还有**凋灵骷髅**（批次 115 已接上：它是"只在要塞里自然刷"的，
 *    判据见 `fortressAt`）、岩浆怪与战利品箱（`nether_bridge` 表）——
 *    后两者还没有：岩浆怪是没做的生物，箱子要新增一张战利品表（见 K10）。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block, NETHER_WART_STAGES, stoneVariantId } from '../registry/blocks.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z } from '../world/Chunk.ts';
import { FeatureWriter, hashAt, PositionalRng } from './Features.ts';

/** 下界那边注入进来的世界查询（都是纯函数，见 `NetherGenerator`） */
export interface FortressWorld {
  /** 该列的地板高度（**地面方块本身**那一层） */
  floorAt(x: number, z: number): number;
  /** 该列的洞顶高度（实心岩层的底面） */
  ceilingAt(x: number, z: number): number;
  /** 该列的下界群系 id */
  biomeAt(x: number, z: number): number;
  /** 玄武岩三角洲的群系 id（要塞不在那里生成，与原版一致） */
  basaltBiome: number;
  /**
   * 灵魂沙峡谷的群系 id（批次 410：下界化石只在那里生成）。
   *
   * 放在这张表里而不是让化石自己去问生成器：`structureWorld()` 是**下界结构共用**的
   * 一份查询（堡垒 / 要塞 / 化石三家都用它），多一个字段比多一条查询路径便宜。
   */
  soulSandBiome: number;
}

/** 单元网格间距（区块）：22 区块 = 352 格一个单元 */
export const FORTRESS_SPACING = 22;
/** 分离度（区块）：候选点距单元边界至少这么远 */
export const FORTRESS_SEPARATION = 5;
/** 每个单元生成一座的概率——原版要塞比堡垒常见（它是下界的主建筑） */
export const FORTRESS_CHANCE = 0.8;
/** 哈希盐（与堡垒遗迹那个不同：两座结构不该总在同一格相遇） */
const FORTRESS_SALT = 0x0f17e5;
/** 要塞占的水平半径（方块）——放置与"是否落到本区块"都按它算 */
export const FORTRESS_RADIUS = 18;
/** 需要的最小净空（洞顶 − 地板）：塔有 9 格高，再加一层顶 */
export const FORTRESS_CLEARANCE = 14;

export interface FortressInstance {
  cellX: number;
  cellZ: number;
  /** 原点：走廊地面那一层的中心（世界坐标） */
  x: number;
  y: number;
  z: number;
  /**
   * 生成用的随机源**不放在实例上**，理由与堡垒遗迹同一条（见那边的注记）：
   * 实例是"这座要塞在哪"的纯数据，随机源每次进来按坐标新建，
   * 于是"同一个实例建两次"逐格一致——重建区块正是会走到这条路的地方。
   */
  seed: number;
}

/**
 * 某个单元里的要塞实例；没有候选返回 null。
 *
 * 三条判据（都是世界坐标的纯函数）：单元内按哈希挑点、不是玄武岩三角洲、净空够。
 */
export function fortressCandidate(
  cellX: number,
  cellZ: number,
  seed: number,
  world: FortressWorld,
): FortressInstance | null {
  const cellSize = FORTRESS_SPACING * 16;
  const margin = FORTRESS_SEPARATION * 16;
  const inner = Math.max(16, cellSize - margin * 2);

  const x = cellX * cellSize + margin + Math.floor(hashAt(cellX, cellZ, seed ^ FORTRESS_SALT) * inner);
  const z =
    cellZ * cellSize + margin + Math.floor(hashAt(cellX - 31337, cellZ + 65537, seed ^ FORTRESS_SALT) * inner);

  if (hashAt(x, z, seed ^ (FORTRESS_SALT + 0x3c3c)) > FORTRESS_CHANCE) return null;
  if (world.biomeAt(x, z) === world.basaltBiome) return null;

  const floor = world.floorAt(x, z);
  const ceiling = world.ceilingAt(x, z);
  if (ceiling - floor < FORTRESS_CLEARANCE) return null;
  // 岩浆海面之上才算"站在地上"（与堡垒遗迹同一条，泡在岩浆里的要塞进不去）
  if (floor < 34) return null;

  return { cellX, cellZ, x, y: floor + 1, z, seed };
}

/** 该实例是否会写到 (cx, cz) 这个区块 */
export function fortressIntersects(instance: FortressInstance, cx: number, cz: number): boolean {
  const minX = instance.x - FORTRESS_RADIUS;
  const maxX = instance.x + FORTRESS_RADIUS;
  const minZ = instance.z - FORTRESS_RADIUS;
  const maxZ = instance.z + FORTRESS_RADIUS;
  const originX = cx * CHUNK_SIZE_X;
  const originZ = cz * CHUNK_SIZE_Z;
  return !(maxX < originX || minX > originX + 15 || maxZ < originZ || minZ > originZ + 15);
}

// ---------------------------------------------------------------- 建材

/**
 * 要塞的建材（原版那套）：**下界砖**是唯一的主角，**红色下界砖**只做点缀
 * （原版要塞里偶尔嵌着几块，是"看得出这里被人修过"的那种细节）。
 *
 * 台阶/楼梯按 `stoneVariantId` 取，取不到时退回下界砖——变体表是批量生成的，
 * 不该让结构生成因为它的存在与否而崩（与堡垒遗迹同一个写法）。
 */
const BRICKS = Block.NETHER_BRICKS;
const RED_BRICKS = Block.RED_NETHER_BRICKS;
const SOUL_SAND = Block.SOUL_SAND;
const SPAWNER = Block.SPAWNER;
const STAIRS = stoneVariantId('nether_bricks', 'stairs') ?? BRICKS;
const SLAB = stoneVariantId('nether_bricks', 'slab') ?? BRICKS;

/**
 * 要塞要"挖开"的那些方块：**只有下界岩那一层地形**。
 *
 * ⚠️ 这是与堡垒遗迹那套 `Block.AIR` 清场**故意不同**的一处，理由很实在：
 * 下界有两种结构（堡垒遗迹与要塞），两套单元网格的间距不同（24 与 22）、
 * **互相对不齐**，所以偶尔会挨得很近。无条件清场会把先写的结构"抹掉一块"——
 * 批次 92 第一次跑测试时就是这样：**堡垒遗迹宝库里的箱子被要塞的清场抹成了空气**
 * （`test:bastion` 当场变红，症状是"宝库里没有箱子"）。
 * 按"只挖开下界岩"之后，要塞不会动别的结构写下的方块
 * （箱子、黑石、下界砖都不在下面这张表里），只把天然岩石挖空。
 */
const CARVEABLE = new Set<number>([Block.NETHERRACK, Block.SOUL_SAND, Block.SOUL_SOIL, Block.BASALT, Block.BLACKSTONE, Block.MAGMA_BLOCK, Block.GLOWSTONE]);

/** 把 (x,y,z) 那一格"挖空"——但只挖天然的下界岩层 */
function carve(w: FeatureWriter, x: number, y: number, z: number): void {
  if (CARVEABLE.has(w.get(x, y, z))) w.fill(x, y, z, Block.AIR);
}

/** 相对原点填一个长方体 */
function rel(
  w: FeatureWriter,
  inst: FortressInstance,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  id: number,
): void {
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) w.fill(inst.x + x, inst.y + y, inst.z + z, id);
    }
  }
}

/**
 * 在 (x, z) 那一列的地板上种一小簇下界疣（灵魂沙 + 随机阶段的疣）。
 *
 * 原版要塞里下界疣是**成片**长在灵魂沙上的（一片 3~7 格），这里按同样的观感来：
 * 灵魂沙铺一片，上面每格按随机阶段种下。
 */
function wartCluster(
  w: FeatureWriter,
  inst: FortressInstance,
  rng: PositionalRng,
  x: number,
  z: number,
  y: number,
  size: number,
): void {
  for (let dz = 0; dz < size; dz++) {
    for (let dx = 0; dx < size; dx++) {
      const wx = inst.x + x + dx;
      const wy = inst.y + y; // ⚠️ 相对 → 世界坐标：漏了 `+ inst.y` 就是"把下界疣种在 y=0"
      const wz = inst.z + z + dz;
      w.fill(wx, wy, wz, SOUL_SAND);
      // 阶段 0~3 均匀挑：一眼看过去"有的刚种下、有的能收了"才是原版那种样子
      w.fill(wx, wy + 1, wz, NETHER_WART_STAGES[rng.int(NETHER_WART_STAGES.length)]!);
    }
  }
}

/**
 * 把一座要塞写进世界。
 *
 * 布局（俯视，x 向右、z 向上；`·` 是走廊、`█` 是墙、`疣` 是下界疣簇）：
 * ```
 *          ███████        z = +12..+18   北塔：7×7、9 格高，四角柱 + 顶层平台
 *          ██···██
 *   ██████████·██████████ z = -4..+4    大厅：11×11、7 格高；中央刷怪笼 + 4 处疣簇
 *   ████████疣█疣████████ z 轴走廊：宽 3、两侧墙 4 格高（沿 z 通到两塔）
 *          ██···██
 *          ███████        z = -18..-12  南塔
 * ```
 * 一条**中轴走廊**把两座塔与中间的大厅串起来——与原版"要塞就是一条条走廊接房间"的观感一致。
 */
export function buildFortress(w: FeatureWriter, inst: FortressInstance): void {
  // 每次进来新建随机源（实例上不留状态，见 `FortressInstance#seed`）
  const rng = new PositionalRng(inst.x, inst.z, inst.seed ^ (FORTRESS_SALT + 0x9e9e));

  // ---- 0) 清出空间：要塞是"嵌在下界岩里"的（原版也被下界岩包着）。
  // 注意走的是 `carve`（**只挖天然岩层**），不是无条件 `fill(AIR)`——见那张表的注释
  for (let y = 0; y <= 12; y++) {
    for (let z = -19; z <= 19; z++) {
      for (let x = -6; x <= 6; x++) carve(w, inst.x + x, inst.y + y, inst.z + z);
    }
  }

  // ---- 1) 中轴走廊：地面 y=0，宽 3（x ∈ [-1, 1]），两侧墙 x = ±2、高 4
  rel(w, inst, -1, 0, -14, 1, 0, 14, BRICKS);
  for (const side of [-2, 2]) {
    rel(w, inst, side, 1, -14, side, 4, 14, BRICKS);
  }
  // 走廊顶：每隔一格铺一层"肋"（原版要塞的走廊顶就是这个观感）
  for (let z = -14; z <= 14; z += 3) {
    rel(w, inst, -2, 5, z, 2, 5, z, BRICKS);
  }

  // ---- 2) 大厅：x ∈ [-5, 5]，z ∈ [-4, 4]，墙高 6、顶 y=6
  rel(w, inst, -5, 0, -4, 5, 0, 4, BRICKS);
  for (let y = 1; y <= 6; y++) {
    const ceiling = y === 6;
    for (let z = -4; z <= 4; z++) {
      for (let x = -5; x <= 5; x++) {
        const edge = x === -5 || x === 5 || z === -4 || z === 4;
        if (!edge) {
          if (ceiling) w.fill(inst.x + x, inst.y + y, inst.z + z, BRICKS);
          continue;
        }
        // 南北两面各留一个 3 格宽的门洞通向走廊
        const doorway = (z === -4 || z === 4) && Math.abs(x) <= 1 && y >= 1 && y <= 3;
        if (doorway) continue;
        w.fill(inst.x + x, inst.y + y, inst.z + z, BRICKS);
      }
    }
  }
  // 红色下界砖点缀：四角 + 顶面四角（原版要塞里那种"修过"的痕迹）
  for (const [rx, rz] of [
    [-5, -4],
    [-5, 4],
    [5, -4],
    [5, 4],
  ] as const) {
    w.fill(inst.x + rx, inst.y + 1, inst.z + rz, RED_BRICKS);
    w.fill(inst.x + rx, inst.y + 6, inst.z + rz, RED_BRICKS);
  }
  // 大厅顶面再压一圈台阶当"檐口"（原版要塞的屋檐）
  for (let x = -4; x <= 4; x += 2) {
    w.fill(inst.x + x, inst.y + 7, inst.z - 4, SLAB);
    w.fill(inst.x + x, inst.y + 7, inst.z + 4, SLAB);
  }

  // ---- 3) 两座塔：x ∈ [-3, 3]，z ∈ [12, 18] 与 [-18, -12]，9 格高
  for (const tz of [-15, 15]) {
    const z0 = tz - 3;
    const z1 = tz + 3;
    rel(w, inst, -3, 0, z0, 3, 0, z1, BRICKS); // 塔基
    for (let y = 1; y <= 8; y++) {
      const top = y === 8;
      for (let z = z0; z <= z1; z++) {
        for (let x = -3; x <= 3; x++) {
          const edge = x === -3 || x === 3 || z === z0 || z === z1;
          if (!edge) {
            if (top) w.fill(inst.x + x, inst.y + y, inst.z + z, BRICKS);
            continue;
          }
          // 面向走廊（朝原点那一侧）留一个门洞
          const inner = tz > 0 ? z === z0 : z === z1;
          if (inner && Math.abs(x) <= 1 && y >= 1 && y <= 3) continue;
          w.fill(inst.x + x, inst.y + y, inst.z + z, BRICKS);
        }
      }
    }
    // 顶层平台四周的栏杆（原版塔顶就是这个"能站人"的样子）
    rel(w, inst, -3, 9, z0, 3, 9, z1, BRICKS);
    for (const [cx, cz] of [
      [-3, z0],
      [3, z0],
      [-3, z1],
      [3, z1],
    ] as const) {
      w.fill(inst.x + cx, inst.y + 10, inst.z + cz, BRICKS);
    }
    // 塔里的楼梯：贴着内墙斜着上去（纯装饰，给"这是座塔"一个交代）
    for (let i = 0; i < 7; i++) {
      w.fillState(inst.x - 2, inst.y + 1 + i, inst.z + (tz > 0 ? z0 + 1 + i : z1 - 1 - i), STAIRS, 0);
    }
  }

  // ---- 4) 下界疣：大厅的地板上四片 + 走廊两侧零星几片（原版要塞里到处都是）
  wartCluster(w, inst, rng, -4, -3, 0, 2);
  wartCluster(w, inst, rng, 2, -3, 0, 2);
  wartCluster(w, inst, rng, -4, 2, 0, 2);
  wartCluster(w, inst, rng, 2, 2, 0, 2);
  for (let i = 0; i < 3; i++) {
    const z = -12 + rng.int(24);
    wartCluster(w, inst, rng, rng.chance(0.5) ? -1 : 0, z, 0, 1);
  }

  // ---- 5) 刷怪笼：大厅正中那一格（**烈焰人**的唯一出生点，见 `registry/spawners.ts`）
  w.fill(inst.x, inst.y + 1, inst.z, SPAWNER);

  // ---- 6) 大厅四个角各摆一根下界砖柱，让空间不空（原版要塞的柱子）
  for (const [px, pz] of [
    [-4, -3],
    [4, -3],
    [-4, 3],
    [4, 3],
  ] as const) {
    rel(w, inst, px, 1, pz, px, 5, pz, BRICKS);
    w.fill(inst.x + px, inst.y + 6, inst.z + pz, RED_BRICKS);
  }
}

/**
 * 生成一个区块里属于它的要塞。
 *
 * 与 `Bastion.ts#generateBastions` 同一个套路：遍历可能覆盖到本区块的单元，
 * 只写落在本区块的部分（每个结构只属于一个单元，跨区块重放时逐格一致）。
 */
export function generateFortresses(w: FeatureWriter, seed: number, world: FortressWorld): void {
  const cellSize = FORTRESS_SPACING * 16;
  const reach = Math.ceil((FORTRESS_RADIUS + 16) / cellSize) + 1;
  const baseCellX = Math.floor((w.cx * 16) / cellSize);
  const baseCellZ = Math.floor((w.cz * 16) / cellSize);

  for (let dcz = -reach; dcz <= reach; dcz++) {
    for (let dcx = -reach; dcx <= reach; dcx++) {
      const instance = fortressCandidate(baseCellX + dcx, baseCellZ + dcz, seed, world);
      if (!instance || !fortressIntersects(instance, w.cx, w.cz)) continue;
      buildFortress(w, instance);
    }
  }
}

/**
 * (x, z) 这一列在不在某座下界要塞里（批次 115，凋灵骷髅的刷怪判据）。
 *
 * 为什么要问"在不在要塞里"而不是"离要塞多远"：这一句要每 2 秒跑几十次
 * （`MobSpawner` 的敌对刷怪循环），所以判据必须是**几个网格数的比较**——
 * 而"最近的要塞在哪"那种做法每次都要算 9 个候选（每个 candidate 要三次噪声查询，
 * 见 `fortressCandidate`）。这里的做法是：先按单元反推出"覆盖这一格的那几个单元"，
 * 逐个算实例（同一份公式！），再看这一格的半径内有没有它。
 *
 * ⚠️ **必须复用 `fortressCandidate`**：一旦自己重写一遍"单元 + 哈希"的位置公式，
 * 就会出现"生物刷在要塞外面"或"要塞里一只都不刷"——两边都"没错"、只是对不上
 * （末影之眼那批在 `Structures.ts` 踩过同一条，那里抽成了 `structureCellOrigin`）。
 *
 * @returns 命中时返回那座要塞（调用方若只关心真假，忽略返回值即可）
 */
export function fortressAt(
  x: number,
  z: number,
  seed: number,
  world: FortressWorld,
): FortressInstance | null {
  const cellSize = FORTRESS_SPACING * 16;
  const baseCellX = Math.floor(x / cellSize);
  const baseCellZ = Math.floor(z / cellSize);
  // 半径 18 格远小于单元（352 格），所以只需看这一格所在的单元与它相邻的八个
  for (let dcz = -1; dcz <= 1; dcz++) {
    for (let dcx = -1; dcx <= 1; dcx++) {
      const instance = fortressCandidate(baseCellX + dcx, baseCellZ + dcz, seed, world);
      if (!instance) continue;
      if (Math.abs(instance.x - x) > FORTRESS_RADIUS) continue;
      if (Math.abs(instance.z - z) > FORTRESS_RADIUS) continue;
      return instance;
    }
  }
  return null;
}

/** 测试用：直接求某个单元里的实例（不经过区块裁剪，见 `structureInstanceForTest`） */
export function fortressInstanceForTest(
  cellX: number,
  cellZ: number,
  seed: number,
  world: FortressWorld,
): FortressInstance | null {
  return fortressCandidate(cellX, cellZ, seed, world);
}

// ---------------------------------------------------------------- 要塞里的生物（批次 458）

/** 一只由结构生成的生物（与 `Bastion.ts` 同一个形状；两边都不引对方的类型） */
export interface FortressCreatureSpawn {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * 下界要塞的锚点：大厅两侧各 1 只凋灵骷髅。
 *
 * 烈焰人不用放——大厅正中那个**刷怪笼**（`SPAWNER`）早就由 `SpawnerTicking` 负责；
 * 这一批补的是"没有刷怪笼、但原版必有"的凋灵骷髅。
 */
const FORTRESS_CREATURES: readonly { kind: string; dx: number; dy: number; dz: number; count?: number }[] = [
  { kind: 'wither_skeleton', dx: 6, dy: 2, dz: 0, count: 2 },
];

/** 这个区块里"要塞该有的生物"（批次 458；reach 与相交判定与 `generateFortresses` 同一套） */
export function fortressCreatureSpawnsAt(
  cx: number,
  cz: number,
  seed: number,
  world: FortressWorld,
): FortressCreatureSpawn[] {
  const cellSize = FORTRESS_SPACING * 16;
  const reach = Math.ceil((FORTRESS_RADIUS + 16) / cellSize) + 1;
  const baseCellX = Math.floor((cx * 16) / cellSize);
  const baseCellZ = Math.floor((cz * 16) / cellSize);
  const spawns: FortressCreatureSpawn[] = [];
  for (let dcz = -reach; dcz <= reach; dcz++) {
    for (let dcx = -reach; dcx <= reach; dcx++) {
      const instance = fortressCandidate(baseCellX + dcx, baseCellZ + dcz, seed, world);
      if (!instance || !fortressIntersects(instance, cx, cz)) continue;
      for (const anchor of FORTRESS_CREATURES) {
        for (let i = 0; i < (anchor.count ?? 1); i++) {
          const x = Math.round(instance.x + anchor.dx);
          const y = Math.round(instance.y + anchor.dy);
          const z = Math.round(instance.z + anchor.dz + i);
          if (Math.floor(x / 16) !== cx || Math.floor(z / 16) !== cz) continue;
          spawns.push({ kind: anchor.kind, x, y, z });
        }
      }
    }
  }
  return spawns;
}
