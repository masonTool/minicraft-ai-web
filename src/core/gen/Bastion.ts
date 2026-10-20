/**
 * 堡垒遗迹（K8 收尾，批次 82）
 *
 * 本项目**第一座下界结构**。前面七种结构（村庄/矿井/要塞/地牢/沉船/海底神殿/林地府邸）
 * 都长在主世界的地表或地下，`Structures.ts` 那套框架直接读 `world.surfaceY()` 定位；
 * 下界没有"地表"这回事（地板是噪声、洞顶是另一条噪声），所以这里**自带一套锚点**：
 * 由 `NetherGenerator` 把 `floorAt` / `ceilingAt` / `biomeAt` 三个纯函数注入进来。
 *
 * 与 `Structures.ts` 的关系：**放置机制同源**（单元网格 + 世界坐标哈希 + 3×3 邻域重放，
 * 见那边的文件头），只是换了个"世界坐标系"。复用它的 `lootChest()` 与放置原语。
 *
 * ⚠️ 与原版的差距（记在 TASKS K8）：
 *  - 原版堡垒由 4 种拼图（bridge / housing / stables / treasure）随机拼接，这里**只有一种布局**
 *    （桥 + 桥头宝库），是"手写的一座建筑"而不是模板系统；
 *  - 没有猪灵/疣猪兽守在里面（那两族生物还没做），也没有"金块换平安"那套互动；
 *  - 宝箱里少几样原版物品（附魔金苹果、唱片、附魔装备），见 `loot.ts` 的注记。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block, stoneVariantId } from '../registry/blocks.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z } from '../world/Chunk.ts';
import { FeatureWriter, hashAt, PositionalRng } from './Features.ts';
import { lootChest } from './Structures.ts';

/** 下界那边注入进来的世界查询（都是纯函数，见 `NetherGenerator`） */
export interface BastionWorld {
  /** 该列的地板高度（**地面方块本身**那一层） */
  floorAt(x: number, z: number): number;
  /** 该列的洞顶高度（实心岩层的底面） */
  ceilingAt(x: number, z: number): number;
  /** 该列的下界群系 id */
  biomeAt(x: number, z: number): number;
  /** 玄武岩三角洲的群系 id（堡垒不在那里生成，与原版一致） */
  readonly basaltBiome: number;
  /** 灵魂沙峡谷的群系 id（下界化石只在那里生成，与原版一致） */
  readonly soulSandBiome: number;
}

/**
 * 下界的结构种类：堡垒遗迹 + 下界要塞（批次 92）。
 *
 * 为什么单独开一张表：`Structures.ts` 的 `STRUCTURE_KINDS` 是**主世界那套框架**的清单，
 * 覆盖面度台账（`audit:coverage`）数结构种类时要把它加上，否则"我们做了几种结构"这件事
 * 在台账里永远少算下界这两座——**指标漏了自己人会比数字错了更隐蔽**。
 */
export const NETHER_STRUCTURE_KINDS = ['bastion_remnant', 'nether_fortress', 'nether_fossil'] as const;

/** 单元网格间距（区块）：24 区块 = 384 格一个单元 */
export const BASTION_SPACING = 24;
/** 分离度（区块）：候选点距单元边界至少这么远 */
export const BASTION_SEPARATION = 6;
/** 每个单元生成一座的概率 */
export const BASTION_CHANCE = 0.7;
/** 哈希盐 */
const BASTION_SALT = 0x1b0a57;
/** 堡垒占的水平半径（方块）——放置与"是否落到本区块"都按它算 */
export const BASTION_RADIUS = 14;
/** 需要的最小净空（洞顶 − 地板）：低于这个数就放不下（桥头堡有 6 格高） */
export const BASTION_CLEARANCE = 12;

export interface BastionInstance {
  cellX: number;
  cellZ: number;
  /** 原点：桥面那一层（世界坐标） */
  x: number;
  y: number;
  z: number;
  /**
   * 生成用的随机源**不放在实例上**（实例是"这座堡在哪"的纯数据）。
   *
   * 理由是踩过的一次：把 `rng` 挂上去之后，`buildBastion` 每调一次就把随机源往前走一段，
   * 于是"同一个实例建两次"会得到两种布局——而"重建一个区块"正是会走到这条路的地方
   * （重放、测试、以后可能的并行生成）。改成**每次进来按坐标新建一个**就没有这个状态了。
   */
  seed: number;
}

/**
 * 某个单元里的堡垒实例；没有候选返回 null。
 *
 * 三条判据（都是世界坐标的纯函数，所以跨区块重放时结论一致）：
 *  1. 单元内按哈希挑一个点；
 *  2. 该点不能是玄武岩三角洲（原版也不在那里生成）；
 *  3. 净空够（洞顶 − 地板 ≥ `BASTION_CLEARANCE`）。
 */
export function bastionCandidate(
  cellX: number,
  cellZ: number,
  seed: number,
  world: BastionWorld,
): BastionInstance | null {
  const cellSize = BASTION_SPACING * 16;
  const margin = BASTION_SEPARATION * 16;
  const inner = Math.max(16, cellSize - margin * 2);

  const x = cellX * cellSize + margin + Math.floor(hashAt(cellX, cellZ, seed ^ BASTION_SALT) * inner);
  const z = cellZ * cellSize + margin + Math.floor(hashAt(cellX + 7919, cellZ - 104729, seed ^ BASTION_SALT) * inner);

  if (hashAt(x, z, seed ^ (BASTION_SALT + 0x5a5a)) > BASTION_CHANCE) return null;
  if (world.biomeAt(x, z) === world.basaltBiome) return null;

  const floor = world.floorAt(x, z);
  const ceiling = world.ceilingAt(x, z);
  if (ceiling - floor < BASTION_CLEARANCE) return null;
  // 岩浆海面之上才算"站在地上"（泡在岩浆里的堡垒没法进去）
  if (floor < 34) return null;

  return {
    cellX,
    cellZ,
    x,
    y: floor + 1,
    z,
    seed,
  };
}

/** 该实例是否会写到 (cx, cz) 这个区块 */
export function bastionIntersects(instance: BastionInstance, cx: number, cz: number): boolean {
  const minX = instance.x - BASTION_RADIUS;
  const maxX = instance.x + BASTION_RADIUS;
  const minZ = instance.z - BASTION_RADIUS;
  const maxZ = instance.z + BASTION_RADIUS;
  const originX = cx * CHUNK_SIZE_X;
  const originZ = cz * CHUNK_SIZE_Z;
  return !(maxX < originX || minX > originX + 15 || maxZ < originZ || minZ > originZ + 15);
}

// ---------------------------------------------------------------- 建材

/**
 * 堡垒的建材。
 *
 * 主墙用**黑石砖**、地面与栏杆用**黑石**、点缀用**磨制黑石**，
 * 而**鎏金黑石**是"玩家真正会去撬的东西"——它在桥面上零星嵌着（拆了掉 2~5 个金粒）。
 * ⚠️ 黑石台阶（原版桥面两侧的排水沟用它）通过 `stoneVariantId` 取，
 * 取不到时退回黑石——注册表里那个变体是批量生成的，不该让结构生成因为它的存在与否而崩。
 */
const BRICKS = Block.POLISHED_BLACKSTONE_BRICKS;
const POLISHED = Block.POLISHED_BLACKSTONE;
const BLACKSTONE = Block.BLACKSTONE;
const GILDED = Block.GILDED_BLACKSTONE;
const STAIRS = stoneVariantId('blackstone', 'stairs') ?? BLACKSTONE;

/** 相对原点填一个长方体（x/z 是相对坐标，y 也是相对） */
function rel(
  w: FeatureWriter,
  inst: BastionInstance,
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
 * 把一座堡垒写进世界（相对布局见下方注释）。
 *
 * 布局是一条**东西向的桥**加一座**桥头宝库**：
 * ```
 *        z=-5 ┌──────────┐
 *             │  宝库    │        ← 墙体黑石砖、地面磨制黑石、四角鎏金黑石
 *        z=-3 └──┬────┬──┘           正中一个战利品箱（bastion_treasure）
 *   桥面 y=0  ═══╧════╧═══════════    ← 黑石桥面 + 两侧栏杆（黑石砖 + 磨制黑石柱）
 *        z=+3    └────┘
 *              x=-12        桥墩         x=+12
 * ```
 */
export function buildBastion(w: FeatureWriter, inst: BastionInstance): void {
  // 每次进来新建随机源（见 `BastionInstance#seed` 的注记：实例上不留状态）
  const rng = new PositionalRng(inst.x, inst.z, inst.seed ^ (BASTION_SALT + 0x77));

  // ---- 0) 清出空间：堡垒是"嵌在下界岩里"的（原版也是这样被下界岩包着）
  rel(w, inst, -12, 0, -8, 12, 13, 8, Block.AIR);

  // ---- 1) 桥面：y=0，z ∈ [-2, 2]；正中一条磨制黑石当"中缝"
  rel(w, inst, -12, 0, -2, 12, 0, 2, BLACKSTONE);
  rel(w, inst, -12, 0, 0, 12, 0, 0, POLISHED);

  // ---- 2) 栏杆：两侧各 2 格高（y=1..2）；每 4 格一根磨制黑石柱，顶上一块台阶当"压顶"
  for (const side of [-3, 3]) {
    rel(w, inst, -12, 1, side, 12, 2, side, BRICKS);
    for (let x = -12; x <= 12; x += 4) {
      rel(w, inst, x, 1, side, x, 3, side, POLISHED);
      w.fill(inst.x + x, inst.y + 4, inst.z + side, STAIRS);
    }
  }

  // ---- 3) 桥墩：从桥面往下撑到地形（往下 8 格够把整条桥托住）
  for (const px of [-11, -5, 1, 7, 11]) {
    for (const pz of [-2, 2]) {
      rel(w, inst, px, -8, pz, px, -1, pz, BLACKSTONE);
    }
  }

  // ---- 4) 桥头宝库：x ∈ [7, 12]，z ∈ [-5, 5]，高 6 格（y=0..5）
  rel(w, inst, 7, 0, -5, 12, 0, 5, POLISHED); // 地板
  for (let y = 1; y <= 5; y++) {
    const ceiling = y === 5;
    for (let z = -5; z <= 5; z++) {
      for (let x = 7; x <= 12; x++) {
        const edge = x === 7 || x === 12 || z === -5 || z === 5;
        if (!edge) {
          // 内部：只有天花板才铺方块，其余留空（房间）
          if (ceiling) w.fill(inst.x + x, inst.y + y, inst.z + z, BRICKS);
          continue;
        }
        w.fill(inst.x + x, inst.y + y, inst.z + z, BRICKS);
      }
    }
  }
  // 门洞：朝桥那一侧（x=7）中间的 3 格宽、3 格高
  rel(w, inst, 7, 1, -1, 7, 3, 1, Block.AIR);
  // 屋顶正中一块磨制黑石（原版的"天窗"那种感觉）
  rel(w, inst, 9, 5, -1, 10, 5, 1, POLISHED);

  // ---- 5) 鎏金黑石：四角 + 天花板四角（"撬金"是进堡垒的正事）
  for (const [gx, gz] of [
    [8, -4],
    [8, 4],
    [11, -4],
    [11, 4],
  ] as const) {
    w.fill(inst.x + gx, inst.y + 1, inst.z + gz, GILDED);
    w.fill(inst.x + gx, inst.y + 5, inst.z + gz, GILDED);
  }

  // ---- 6) 宝箱：房间正中偏里一格（`bastion_treasure` 那张表）
  lootChest(w, inst.x + 10, inst.y + 1, inst.z, 'bastion_treasure');

  // ---- 7) 桥面上零星嵌几块鎏金黑石（2~4 块，位置由 rng 决定但**落在桥面范围内**）
  const gildedOnBridge = 2 + rng.int(3);
  for (let i = 0; i < gildedOnBridge; i++) {
    const gx = -10 + rng.int(19); // x ∈ [-10, 8]
    const gz = rng.int(3) - 1; // z ∈ [-1, 1]
    w.fill(inst.x + gx, inst.y, inst.z + gz, GILDED);
  }

  // ---- 8) 桥的另一头：两根磨制黑石柱（让"桥"有头有尾，不然像被切断的）
  for (const pz of [-2, 2]) {
    rel(w, inst, -12, 1, pz, -12, 4, pz, POLISHED);
  }
}

/**
 * 生成一个区块里属于它的堡垒。
 *
 * 与 `Structures.ts#generateStructures` 同一个套路：遍历可能覆盖到本区块的单元，
 * 只写落在本区块的部分（**每个结构只属于一个单元**，跨区块重放时逐格一致）。
 */
export function generateBastions(w: FeatureWriter, seed: number, world: BastionWorld): void {
  const cellSize = BASTION_SPACING * 16;
  const reach = Math.ceil((BASTION_RADIUS + 16) / cellSize) + 1;
  const baseCellX = Math.floor((w.cx * 16) / cellSize);
  const baseCellZ = Math.floor((w.cz * 16) / cellSize);

  for (let dcz = -reach; dcz <= reach; dcz++) {
    for (let dcx = -reach; dcx <= reach; dcx++) {
      const instance = bastionCandidate(baseCellX + dcx, baseCellZ + dcz, seed, world);
      if (!instance || !bastionIntersects(instance, w.cx, w.cz)) continue;
      buildBastion(w, instance);
    }
  }
}

/** 测试用：直接求某个单元里的实例（不经过区块裁剪，见 `structureInstanceForTest`） */
export function bastionInstanceForTest(
  cellX: number,
  cellZ: number,
  seed: number,
  world: BastionWorld,
): BastionInstance | null {
  return bastionCandidate(cellX, cellZ, seed, world);
}

// ---------------------------------------------------------------- 下界化石（批次 410）

/**
 * 下界化石：埋在灵魂沙峡谷里的骨架。
 *
 * 与原版一致的地方：**只在灵魂沙峡谷**生成、由骨块组成、中间夹一块煤矿。
 * ⚠️ 简化：原版有 14 种骨架形状（含"巨大的脊椎/肋骨"两套变体），这里只做
 * "脊柱 + 肋骨"这一种并按坐标随机决定走向——形制对了就够，逐个复刻 14 种
 * 的收益远不如把它们的位置规律做对。
 */
const FOSSIL_SPACING_CHUNKS = 16;
const FOSSIL_CHANCE = 0.35;
const FOSSIL_SALT = 0x1f05;
const FOSSIL_RADIUS = 5;

export interface NetherFossilInstance {
  x: number;
  y: number;
  z: number;
  /** 骨头的走向：true = 沿 X，false = 沿 Z（世界坐标的纯函数，可重放） */
  alongX: boolean;
  seed: number;
}

/** 某个单元里的化石实例；没有候选返回 null（三条判据都是世界坐标的纯函数） */
export function netherFossilCandidate(
  cellX: number,
  cellZ: number,
  seed: number,
  world: BastionWorld,
): NetherFossilInstance | null {
  const cellSize = FOSSIL_SPACING_CHUNKS * 16;
  const x = cellX * cellSize + Math.floor(hashAt(cellX, cellZ, seed ^ FOSSIL_SALT) * cellSize);
  const z = cellZ * cellSize + Math.floor(hashAt(cellX + 6151, cellZ - 7919, seed ^ FOSSIL_SALT) * cellSize);

  if (hashAt(x, z, seed ^ (FOSSIL_SALT + 0x31)) > FOSSIL_CHANCE) return null;
  // 只长在灵魂沙峡谷（原版如此）。玄武岩三角洲与其它群系都不该出现骨架
  if (world.biomeAt(x, z) !== world.soulSandBiome) return null;

  const floor = world.floorAt(x, z);
  const ceiling = world.ceilingAt(x, z);
  // 埋在地表下 1 格：完全埋着看不见，露头一格才找得到
  const y = floor - 1;
  if (ceiling - y < 4) return null;
  if (y < 32) return null;

  return { x, y, z, alongX: hashAt(x + 13, z - 29, seed ^ (FOSSIL_SALT + 0x77)) > 0.5, seed };
}

/** 该实例是否会写到 (cx, cz) 这个区块 */
export function netherFossilIntersects(instance: NetherFossilInstance, cx: number, cz: number): boolean {
  const originX = cx * CHUNK_SIZE_X;
  const originZ = cz * CHUNK_SIZE_Z;
  return !(
    instance.x + FOSSIL_RADIUS < originX ||
    instance.x - FOSSIL_RADIUS > originX + 15 ||
    instance.z + FOSSIL_RADIUS < originZ ||
    instance.z - FOSSIL_RADIUS > originZ + 15
  );
}

function buildNetherFossil(w: FeatureWriter, f: NetherFossilInstance): void {
  const rng = new PositionalRng(f.x, f.z, f.seed ^ (FOSSIL_SALT + 0x99));
  // 先清出一格高的腔体：不清的话骨块会被灵魂沙埋住，看上去"什么都没有"
  for (let i = -2; i <= 2; i++) {
    const x = f.alongX ? f.x + i : f.x;
    const z = f.alongX ? f.z : f.z + i;
    w.fill(x, f.y, z, Block.AIR);
    if (i % 2 === 1) {
      for (const side of [-1, 1] as const) {
        w.fill(f.alongX ? x : x + side, f.y, f.alongX ? z + side : z, Block.AIR);
      }
    }
  }
  // 脊柱 + 肋骨
  for (let i = -2; i <= 2; i++) {
    const x = f.alongX ? f.x + i : f.x;
    const z = f.alongX ? f.z : f.z + i;
    w.fill(x, f.y, z, Block.BONE_BLOCK);
    if (i % 2 === 1) {
      for (const side of [-1, 1] as const) {
        w.fill(f.alongX ? x : x + side, f.y + 1, f.alongX ? z + side : z, Block.BONE_BLOCK);
      }
    }
  }
  // 中心夹一块煤矿（原版骨架里也夹矿石）
  w.fill(f.x, f.y + 1, f.z, rng.chance(0.5) ? Block.COAL_ORE : Block.BONE_BLOCK);
}

/** 生成这个区块里落到的下界化石 */
export function generateNetherFossils(w: FeatureWriter, seed: number, world: BastionWorld): void {
  const cellSize = FOSSIL_SPACING_CHUNKS * 16;
  const baseCellX = Math.floor((w.cx * 16) / cellSize);
  const baseCellZ = Math.floor((w.cz * 16) / cellSize);
  for (let dcz = -1; dcz <= 1; dcz++) {
    for (let dcx = -1; dcx <= 1; dcx++) {
      const instance = netherFossilCandidate(baseCellX + dcx, baseCellZ + dcz, seed, world);
      if (!instance) continue;
      if (!netherFossilIntersects(instance, w.cx, w.cz)) continue;
      buildNetherFossil(w, instance);
    }
  }
}

// ---------------------------------------------------------------- 堡垒遗迹里的生物（批次 458）

/** 一只由结构生成的生物（世界坐标） */
export interface NetherCreatureSpawn {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * 堡垒遗迹的锚点：宝库前 1 只猪灵蛮兵、桥面上 2 只猪灵。
 *
 * 与主世界那张表（`StructureCreatures.ts`）同一个思路：偏移是"相对实例原点"，
 * 主线程拿到之后还会就近找落点，所以差一两格不会把生物卡进黑石里。
 */
const BASTION_CREATURES: readonly { kind: string; dx: number; dy: number; dz: number; count?: number }[] = [
  // 宝库在 buildBastion 里的位置是 (inst.x + 10, inst.y + 1, inst.z)
  { kind: 'piglin_brute', dx: 10, dy: 2, dz: 0 },
  { kind: 'piglin', dx: 6, dy: 2, dz: 4, count: 2 },
];

/**
 * 这个区块里"堡垒遗迹该有的生物"（批次 458）。
 *
 * 与 `generateBastions` 同一套 reach 与相交判定；锚点只由**它所在的区块**负责，
 * 所以跨区块不会重复。主世界那条通道（`Structures.structureCreatureSpawnsAt`）
 * 不覆盖下界，所以这里单独一份——这正是"下界结构不共用 STRUCTURE_DEFS"的代价。
 */
export function bastionCreatureSpawnsAt(
  cx: number,
  cz: number,
  seed: number,
  world: BastionWorld,
): NetherCreatureSpawn[] {
  const cellSize = BASTION_SPACING * 16;
  const reach = Math.ceil((BASTION_RADIUS + 16) / cellSize) + 1;
  const baseCellX = Math.floor((cx * 16) / cellSize);
  const baseCellZ = Math.floor((cz * 16) / cellSize);
  const spawns: NetherCreatureSpawn[] = [];
  for (let dcz = -reach; dcz <= reach; dcz++) {
    for (let dcx = -reach; dcx <= reach; dcx++) {
      const instance = bastionCandidate(baseCellX + dcx, baseCellZ + dcz, seed, world);
      if (!instance || !bastionIntersects(instance, cx, cz)) continue;
      for (const anchor of BASTION_CREATURES) {
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

/** `/locate structure` 的下界结果（与主世界同一个形状） */
export interface NetherStructureHit {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly distance: number;
}

/**
 * 找离 (fromX, fromZ) 最近的堡垒遗迹（批次 465，`/locate structure bastion_remnant`）。
 *
 * 堡垒位置是"种子 + 候选规则"的纯函数，所以主线程重算即可，不需要 Worker。
 * @param cellRadius 向外数几个单元（默认 2：24 区块 × 2 = ±768 格）
 */
export function nearestBastion(
  fromX: number,
  fromZ: number,
  seed: number,
  world: BastionWorld,
  cellRadius = 2,
): NetherStructureHit | null {
  const cellSize = BASTION_SPACING * 16;
  const baseCellX = Math.floor(fromX / cellSize);
  const baseCellZ = Math.floor(fromZ / cellSize);
  let best: NetherStructureHit | null = null;
  for (let dcz = -cellRadius; dcz <= cellRadius; dcz++) {
    for (let dcx = -cellRadius; dcx <= cellRadius; dcx++) {
      const instance = bastionCandidate(baseCellX + dcx, baseCellZ + dcz, seed, world);
      if (!instance) continue;
      const distance = Math.hypot(instance.x - fromX, instance.z - fromZ);
      if (best === null || distance < best.distance) {
        best = { kind: 'bastion_remnant', x: instance.x, y: instance.y, z: instance.z, distance };
      }
    }
  }
  return best;
}
