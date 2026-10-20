/**
 * 结构生成（Structure Features）
 *
 * 与地物（Features）一样遵守同一条跨区块约定：
 * **结构的落点与它写下的每一格坐标都只依赖世界坐标**，
 * 因此同一个村庄在任意区块里被"重放"时写出的方块完全一致，接缝不会错位。
 *
 * 放置机制对齐原版的「间距 / 分离度」思路：
 *   世界被切成 spacing×spacing（区块）的单元网格，每个单元里由哈希选出一个候选点，
 *   候选点必须落在单元内部的 area（距边界至少 separation），再按概率与群系过滤。
 *   生成某个区块时，遍历可能覆盖到它的所有单元（±reach），只写入落在本区块的部分。
 *
 * ⚠️ 与原版的差距（已记录到 TASKS.md）：
 *  - 建筑使用轴对齐布局，没有原版那套「结构模板 + 随机朝向 + 拼图（jigsaw）」系统；
 *  - 结构是"一次性生成"的，没有原版"先占位、后扩展"带来的跨结构连接；
 *  - 战利品箱只写"哪张战利品表"（方块状态里的 bits 4-7），**箱内物品由主线程在区块
 *    载入后按表掷点填充**（见 `core/world/LootFill.ts`）——Worker 里不碰容器，
 *    也就不必把物品数组跨线程传回来。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block, bedId, stairsId, Wood } from '../registry/blocks.ts';
import {
  bedOtherHalf,
  withBedHead,
  withChestLoot,
  withDoorHinge,
  withDoorOpen,
  withDoorUpper,
  withEndPortalEye,
  withFacing,
  withWallMounted,
  type Facing,
} from '../registry/blockState.ts';
// 末地传送门框架那一圈的布局只有一处出处（`world/EndPortal.ts`）：
// 生成端与"按眼睛时怎么判圈齐了"读的是同一张表，两边不会漂
import { END_PORTAL_RING } from '../world/EndPortal.ts';
import { lootTableIndex } from '../registry/loot.ts';
// 村庄要往屋里摆工作站（J22）：那张清单从职业表派生，不另抄一份
import { WORKSTATION_BLOCKS } from '../registry/villagerTrades.ts';
import { Biome } from './Biome.ts';
import { hashAt, PositionalRng, SEA_LEVEL, type FeatureWriter, type FeatureWorld, OUTSIDE } from './Features.ts';

// ---------------------------------------------------------------- 类型

export type StructureKind =
  | 'village'
  | 'mineshaft'
  | 'stronghold'
  | 'dungeon'
  | 'shipwreck'
  | 'ocean_monument'
  | 'woodland_mansion'
  // 批次 341（D21 第一批）
  | 'desert_pyramid'
  | 'jungle_temple'
  // 批次 345（D21 第二批）
  | 'witch_hut'
  | 'pillager_outpost'
  // 批次 347（D21 第三批）
  | 'ruined_portal'
  | 'buried_treasure'
  // 批次 348（D21 第四批）
  | 'igloo'
  | 'ocean_ruins'
  // 批次 349（D21 收尾）
  | 'fossil'
  | 'amethyst_geode'
  // 批次 408
  | 'desert_well';

/** 一个结构实例：原点 + 包围盒 + 随机源 */
export interface StructureInstance {
  kind: StructureKind;
  /** 结构原点（世界坐标）。地表类结构这里就是"地面那一格" */
  x: number;
  y: number;
  z: number;
  /** 包围盒（世界坐标，含端点） */
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  rng: PositionalRng;
}

interface StructureDef {
  kind: StructureKind;
  /** 单元网格的间距（区块） */
  spacing: number;
  /** 分离度（区块）：候选点距单元边界至少这么远 */
  separation: number;
  /** 每个单元里生成的概率 */
  chance: number;
  /** 哈希盐 */
  salt: number;
  /** 包围盒半径（方块）：x/z 为水平半径，y 为竖直半径 */
  radius: number;
  /** 竖直半径 */
  height: number;
  /** 生物群系过滤 */
  biomes: readonly number[];
  /** 是否是水下结构 */
  underwater?: boolean;
  /** 地表类结构：原点取地表高度；否则用 undergroundY 取地下高度 */
  undergroundY?: (x: number, z: number, seed: number) => number;
}

// ---------------------------------------------------------------- 工具

/** 填一个长方体（会自动裁剪到当前区块） */
function box(w: FeatureWriter, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) w.fill(x, y, z, id);
    }
  }
}

/** 长方体空心（四面墙 + 可选地板/天花板） */
function walls(w: FeatureWriter, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1 || y === y0 || y === y1;
        if (edge) w.fill(x, y, z, id);
      }
    }
  }
}

/**
 * 把一块区域清成空气（会挖穿地表，但结构施工本来就需要）。
 * 只清"非基岩"的部分，避免把世界底部挖漏。
 */
function clear(w: FeatureWriter, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  for (let y = Math.max(y0, -62); y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) w.fill(x, y, z, Block.AIR);
    }
  }
}

/**
 * 在 (x,y,z) 放一个火把。
 * @param facing 传朝向表示挂墙火把；不传表示落地火把
 */
function torch(w: FeatureWriter, x: number, y: number, z: number, facing: Facing | null = null): void {
  const state = facing === null ? 0 : withWallMounted(withFacing(0, facing), true);
  w.fillState(x, y, z, Block.TORCH, state);
}

/** 一扇"已经打开"的门（村庄里常见） */
function openDoor(w: FeatureWriter, x: number, y: number, z: number, facing: Facing, hinge: 0 | 1 = 0): void {
  const base = withDoorOpen(withDoorHinge(withFacing(0, facing), hinge), true);
  w.fillState(x, y, z, Block.OAK_DOOR, base);
  w.fillState(x, y + 1, z, Block.OAK_DOOR, withDoorUpper(base, true));
}

/** 一段楼梯（沿 facing 方向逐级上升） */
/**
 * 放一只**带战利品表**的箱子。
 *
 * 表序号写进方块状态的 bits 4-7（见 `blockState.ts` 的 `withChestLoot`），
 * 于是"这是哪张表"跟着区块数据与增量存档一起走，不需要另开一条 Worker 通道；
 * 箱内物品由主线程按表掷点（`LootFill.ts`），Worker 里完全不碰容器。
 *
 * ⚠️ 结构里**所有**箱子都要走这里：漏一处就是"打开箱子空空如也"，
 * 而这正是这一批要修的 bug。`tools/loot-test.ts` 有一条断言专门盯着它。
 */
export function lootChest(w: FeatureWriter, x: number, y: number, z: number, tableKey: string): void {
  w.fillState(x, y, z, Block.CHEST, withChestLoot(0, lootTableIndex(tableKey)));
}

function stairs(w: FeatureWriter, x: number, y: number, z: number, facing: Facing, count: number, id: number, dx: number, dz: number): void {
  for (let i = 0; i < count; i++) {
    w.fillState(x + dx * i, y + i, z + dz * i, id, withFacing(0, facing));
  }
}

// ---------------------------------------------------------------- 结构定义表

/** 主世界地表类结构的候选群系 */
const VILLAGE_BIOMES = [
  Biome.PLAINS,
  Biome.SUNFLOWER_PLAINS,
  Biome.SAVANNA,
  Biome.TAIGA,
  Biome.SNOWY_PLAINS,
  Biome.SNOWY_TAIGA,
  Biome.DESERT,
  Biome.MEADOW,
];

const OCEAN_BIOMES = [
  Biome.OCEAN,
  Biome.DEEP_OCEAN,
  Biome.WARM_OCEAN,
  Biome.FROZEN_OCEAN,
  // 批次 338 补齐的五种海洋：沉船在任意海洋都可能出现（原版如此）
  Biome.COLD_OCEAN,
  Biome.DEEP_COLD_OCEAN,
  Biome.LUKEWARM_OCEAN,
  Biome.DEEP_LUKEWARM_OCEAN,
  Biome.DEEP_FROZEN_OCEAN,
];

const STRUCTURE_DEFS: readonly StructureDef[] = [
  {
    kind: 'village',
    spacing: 32,
    separation: 8,
    chance: 0.85,
    salt: 0x1111,
    radius: 32,
    height: 24,
    biomes: VILLAGE_BIOMES,
  },
  {
    kind: 'mineshaft',
    // 矿井是"每区块按概率出现"的结构，间距取 1 个区块
    spacing: 1,
    separation: 0,
    chance: 1 / 90,
    salt: 0x2222,
    radius: 28,
    height: 24,
    biomes: [], // 地下结构：不看群系
    undergroundY: (x, z, seed) => -10 + Math.floor(hashAt(x, z, seed ^ 0x2a2a) * 50),
  },
  {
    kind: 'stronghold',
    spacing: 96,
    separation: 24,
    chance: 1,
    salt: 0x3333,
    radius: 40,
    height: 28,
    biomes: [],
    undergroundY: (x, z, seed) => -35 + Math.floor(hashAt(x, z, seed ^ 0x3a3a) * 55),
  },
  {
    kind: 'dungeon',
    spacing: 8,
    separation: 1,
    chance: 0.4,
    salt: 0x4444,
    radius: 6,
    height: 5,
    biomes: [],
    undergroundY: (x, z, seed) => -50 + Math.floor(hashAt(x, z, seed ^ 0x4a4a) * 85),
  },
  {
    kind: 'shipwreck',
    spacing: 12,
    separation: 2,
    chance: 0.65,
    salt: 0x5555,
    radius: 14,
    height: 14,
    // 沉船是水下结构（原版也有搁浅在沙滩上的，这里先只做水下沉船）
    underwater: true,
    biomes: OCEAN_BIOMES,
  },
  {
    kind: 'ocean_monument',
    spacing: 32,
    separation: 6,
    chance: 1,
    salt: 0x6666,
    radius: 26,
    height: 26,
    // 原版海底神殿不出现在暖水 / 温水海洋，所以只加寒带的两档（批次 338）
    biomes: [
      Biome.DEEP_OCEAN,
      Biome.OCEAN,
      Biome.FROZEN_OCEAN,
      Biome.COLD_OCEAN,
      Biome.DEEP_COLD_OCEAN,
      Biome.DEEP_FROZEN_OCEAN,
    ],
    underwater: true,
  },
  {
    kind: 'woodland_mansion',
    spacing: 96,
    separation: 20,
    chance: 1,
    salt: 0x7777,
    radius: 26,
    height: 30,
    // 批次 339 补上深色森林之后，林地府邸回到原版的群系限定
    // （以前群系表里没有 dark_forest，只能退化成"森林里的稀有大型木质建筑"）
    biomes: [Biome.DARK_FOREST, Biome.FOREST],
  },
  {
    kind: 'desert_pyramid',
    spacing: 40,
    separation: 8,
    chance: 0.8,
    salt: 0x8888,
    radius: 24,
    height: 24,
    // 原版沙漠神殿只生成在沙漠
    biomes: [Biome.DESERT],
  },
  {
    kind: 'jungle_temple',
    spacing: 40,
    separation: 8,
    chance: 0.75,
    salt: 0x9999,
    radius: 20,
    height: 24,
    // 三种丛林都可能有（原版也生成在竹林与稀疏丛林）
    biomes: [Biome.JUNGLE, Biome.SPARSE_JUNGLE, Biome.BAMBOO_JUNGLE],
  },
  {
    kind: 'witch_hut',
    spacing: 32,
    separation: 8,
    chance: 0.6,
    salt: 0xaaaa,
    radius: 14,
    height: 16,
    // 原版只生成在沼泽
    biomes: [Biome.SWAMP],
  },
  {
    kind: 'pillager_outpost',
    spacing: 32,
    separation: 8,
    chance: 0.7,
    salt: 0xbbbb,
    radius: 16,
    height: 30,
    // 原版：平原/沙漠/热带草原/针叶林/雪原等开阔地形
    biomes: [Biome.PLAINS, Biome.DESERT, Biome.SAVANNA, Biome.TAIGA, Biome.SNOWY_PLAINS],
  },
  {
    kind: 'ruined_portal',
    spacing: 40,
    separation: 8,
    chance: 0.5,
    salt: 0xcccc,
    radius: 12,
    height: 12,
    // 主世界各种地形都可能（原版如此），这里挑几个有代表性的
    biomes: [
      Biome.PLAINS,
      Biome.DESERT,
      Biome.TAIGA,
      Biome.SNOWY_PLAINS,
      Biome.SWAMP,
      Biome.JUNGLE,
      Biome.SAVANNA,
    ],
  },
  {
    kind: 'buried_treasure',
    spacing: 48,
    separation: 8,
    chance: 0.6,
    salt: 0xdddd,
    radius: 8,
    height: 8,
    // 原版埋在海滩的沙下
    biomes: [Biome.BEACH, Biome.SNOWY_BEACH],
  },
  {
    kind: 'igloo',
    spacing: 48,
    separation: 10,
    chance: 0.5,
    salt: 0xeeee,
    radius: 10,
    height: 10,
    biomes: [Biome.SNOWY_PLAINS, Biome.SNOWY_TAIGA, Biome.SNOWY_SLOPES],
  },
  {
    kind: 'ocean_ruins',
    spacing: 24,
    separation: 6,
    chance: 0.6,
    salt: 0xffff,
    radius: 8,
    height: 8,
    biomes: [
      Biome.OCEAN,
      Biome.DEEP_OCEAN,
      Biome.COLD_OCEAN,
      Biome.DEEP_COLD_OCEAN,
      Biome.LUKEWARM_OCEAN,
      Biome.DEEP_LUKEWARM_OCEAN,
      Biome.WARM_OCEAN,
      Biome.FROZEN_OCEAN,
      Biome.DEEP_FROZEN_OCEAN,
    ],
    underwater: true,
  },
  {
    kind: 'fossil',
    spacing: 48,
    separation: 8,
    chance: 0.4,
    salt: 0x1234,
    radius: 8,
    height: 8,
    // 原版埋在沙漠/沼泽/针叶林的地下
    biomes: [Biome.DESERT, Biome.SWAMP, Biome.SNOWY_TAIGA],
    // 固定埋深：-20 左右（原版化石大致在这一带）
    undergroundY: () => -20,
  },
  {
    kind: 'desert_well',
    spacing: 32,
    separation: 8,
    // 原版在沙漠里大约是"每 32 区块的单元里 1/4 概率"
    chance: 0.25,
    salt: 0x3456,
    radius: 6,
    height: 6,
    biomes: [Biome.DESERT],
  },
  {
    kind: 'amethyst_geode',
    spacing: 64,
    separation: 12,
    chance: 0.35,
    salt: 0x2345,
    radius: 10,
    height: 10,
    biomes: [
      Biome.PLAINS,
      Biome.DESERT,
      Biome.FOREST,
      Biome.TAIGA,
      Biome.SNOWY_PLAINS,
      Biome.SAVANNA,
      Biome.JUNGLE,
      Biome.SWAMP,
      Biome.BADLANDS,
      Biome.MEADOW,
      Biome.WINDSWEPT_HILLS,
    ],
    // 紫晶洞在 deepslate 层附近（-30 左右）
    undergroundY: () => -30,
  },
];

/** 结构数量统计（调试/测试用） */
export interface StructureStats {
  /** 每个种类的生成次数 */
  counts: Record<string, number>;
}

function emptyCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const def of STRUCTURE_DEFS) counts[def.kind] = 0;
  return counts;
}

// ---------------------------------------------------------------- 候选点求解

/**
 * 单元里候选点的**平面位置**（只由种子与单元决定，**不看地形**）。
 *
 * 抽出来是为了"末影之眼找最近的要塞"（批次 114，`nearestStronghold`）：
 * 那一次查询发生在**主线程**、又要连着算 9 个单元，若每个都去问一次地表高度
 * （那是整套噪声路由器），扔一只眼睛就会卡一下。要塞是地下结构，位置本来就不看地形。
 *
 * ⚠️ 位置公式只能有这一份：`candidateFor` 也走它，否则"眼睛指的地方"与
 * "真的生成出来的要塞"会悄悄错开——那是最难查的一类 bug（两个地方都"没错"）。
 */
export function structureCellOrigin(
  kind: StructureKind,
  cellX: number,
  cellZ: number,
  seed: number,
): { x: number; z: number } | null {
  const def = STRUCTURE_DEFS.find((entry) => entry.kind === kind);
  if (!def) return null;
  const cellSize = def.spacing * 16;
  const margin = def.separation * 16;
  const inner = Math.max(16, cellSize - margin * 2);
  return {
    x: cellX * cellSize + margin + Math.floor(hashAt(cellX, cellZ, seed ^ def.salt) * inner),
    z: cellZ * cellSize + margin + Math.floor(hashAt(cellX + 7919, cellZ - 104729, seed ^ def.salt) * inner),
  };
}

/**
 * 离 (x,z) **最近的那一座要塞**（批次 114，末影之眼的导航）。
 *
 * ⚠️ 这里**不看地形**：要塞是地下结构（`biomes: []`、有 `undergroundY`），
 * 位置与高度只由"种子 + 单元"决定——所以主线程拿着种子就能算，不必像
 * `nearestVillageForTest` 那样先起一个 `OverworldGenerator`（那一步是真花钱的）。
 *
 * 只扫 ±1 个单元：候选点一定落在单元的**中间那一半**（margin 384 格、单元 1536 格），
 * 所以最近的那一座不会跑出相邻格。`chance: 1` 意味着每个单元都有一座要塞
 * （原版是全世界 3 座，本项目按格铺开——差异记在 TASKS D15/K9）。
 */
export function nearestStronghold(
  seed: number,
  x: number,
  z: number,
): { x: number; y: number; z: number; distance: number } | null {
  const def = STRUCTURE_DEFS.find((entry) => entry.kind === 'stronghold');
  if (!def) return null;
  const cellSize = def.spacing * 16;
  const cellX = Math.floor(x / cellSize);
  const cellZ = Math.floor(z / cellSize);
  let best: { x: number; y: number; z: number; distance: number } | null = null;

  for (let dcx = -1; dcx <= 1; dcx++) {
    for (let dcz = -1; dcz <= 1; dcz++) {
      const origin = structureCellOrigin('stronghold', cellX + dcx, cellZ + dcz, seed);
      if (!origin) continue;
      // 高度走结构表里那一份（与真生成时同一个函数，见 `undergroundY`）
      const y = def.undergroundY ? def.undergroundY(origin.x, origin.z, seed) : 0;
      const distance = Math.hypot(origin.x - x, origin.z - z);
      if (!best || distance < best.distance) best = { x: origin.x, y, z: origin.z, distance };
    }
  }
  return best;
}

/** 该单元的候选结构实例；没有候选返回 null */
function candidateFor(
  def: StructureDef,
  cellX: number,
  cellZ: number,
  world: FeatureWorld,
  seed: number,
): StructureInstance | null {
  const origin = structureCellOrigin(def.kind, cellX, cellZ, seed);
  if (!origin) return null;
  const { x, z } = origin;

  if (hashAt(x, z, seed ^ (def.salt + 0x5a5a)) > def.chance) return null;

  if (def.biomes.length > 0) {
    const biome = world.columnBiome(x, z);
    if (!def.biomes.includes(biome.id)) return null;
  }

  const surfaceY = world.surfaceY(x, z);
  // 水下结构不能落在陆地上
  if (def.underwater && surfaceY >= SEA_LEVEL - 1) return null;
  // 地表结构不能落在水里（原版村庄不会泡在水里）
  if (!def.underwater && !def.undergroundY && surfaceY < SEA_LEVEL) return null;

  const y = def.undergroundY ? def.undergroundY(x, z, seed) : surfaceY;

  return {
    kind: def.kind,
    x,
    y,
    z,
    minX: x - def.radius,
    maxX: x + def.radius,
    minY: y - def.height,
    maxY: y + def.height,
    minZ: z - def.radius,
    maxZ: z + def.radius,
    rng: new PositionalRng(x, z, seed ^ (def.salt + 0x77)),
  };
}

/** 该实例是否会写到 (cx, cz) 这个区块 */
function intersects(instance: StructureInstance, cx: number, cz: number): boolean {
  const originX = cx * 16;
  const originZ = cz * 16;
  return !(
    instance.maxX < originX ||
    instance.minX > originX + 15 ||
    instance.maxZ < originZ ||
    instance.minZ > originZ + 15
  );
}

// ---------------------------------------------------------------- 入口

/**
 * 生成一个区块里属于它的结构。
 *
 * 调用方（TerrainGenerator）应当在地物之后调用它：
 * 结构用强制写入覆盖地形与地物，于是村庄里不会长出一棵穿过屋顶的树。
 */
export function generateStructures(
  w: FeatureWriter,
  world: FeatureWorld,
  seed: number,
  stats?: StructureStats,
): void {
  let counts: Record<string, number> | null = null;
  for (const def of STRUCTURE_DEFS) {
    const cellSize = def.spacing * 16;
    const reach = Math.ceil((def.radius + 16) / cellSize) + 1;
    const baseCellX = Math.floor((w.cx * 16) / cellSize);
    const baseCellZ = Math.floor((w.cz * 16) / cellSize);

    for (let dcz = -reach; dcz <= reach; dcz++) {
      for (let dcx = -reach; dcx <= reach; dcx++) {
        const cellX = baseCellX + dcx;
        const cellZ = baseCellZ + dcz;
        const instance = candidateFor(def, cellX, cellZ, world, seed);
        if (!instance || !intersects(instance, w.cx, w.cz)) continue;

        BUILDERS[def.kind](w, instance, world, seed);
        if (stats) {
          counts ??= emptyCounts();
          counts[def.kind] = (counts[def.kind] ?? 0) + 1;
        }
      }
    }
  }
  if (stats && counts) {
    for (const [kind, count] of Object.entries(counts)) stats.counts[kind] = (stats.counts[kind] ?? 0) + count;
  }
}

/** 建立统计对象 */
export function newStructureStats(): StructureStats {
  return { counts: emptyCounts() };
}

/**
 * 测试用：直接求出某个结构在指定单元里的实例（不经过区块裁剪）。
 *
 * 为什么需要：大间距结构（要塞 96 区块、府邸 96 区块）的单元宽达 1536 格，
 * 想"生成一片区域碰一个"就得铺 96×96 个区块，测试根本跑不动。
 * 这里把候选点求解单独暴露出来，测试就能精确定位到某个实例再检查它。
 */
export function structureInstanceForTest(
  kind: StructureKind,
  cellX: number,
  cellZ: number,
  world: FeatureWorld,
  seed: number,
): StructureInstance | null {
  const def = STRUCTURE_DEFS.find((entry) => entry.kind === kind);
  if (!def) return null;
  return candidateFor(def, cellX, cellZ, world, seed);
}

// ---------------------------------------------------------------- 村庄

/** 村庄的建材配色（按群系挑一套，平原用橡木、沙漠用砂岩、雪原用云杉） */
interface VillagePalette {
  wall: number;
  corner: number;
  roof: number;
  roofStair: number;
  floor: number;
  foundation: number;
}

function villagePalette(biomeId: number): VillagePalette {
  /** 用木材表拼一套建材（Wood 表里没有橡木，橡木用 id 常量） */
  const fromWood = (wood: { log: number; planks: number; stairs: number }): VillagePalette => ({
    wall: wood.planks,
    corner: wood.log,
    roof: wood.planks,
    roofStair: wood.stairs,
    floor: wood.planks,
    foundation: Block.COBBLESTONE,
  });

  switch (biomeId) {
    case Biome.DESERT:
      return {
        wall: Block.SANDSTONE,
        corner: Block.CUT_SANDSTONE,
        roof: Block.SMOOTH_SANDSTONE,
        roofStair: stairsId(3), // sandstone_stairs
        floor: Block.SMOOTH_SANDSTONE,
        foundation: Block.SANDSTONE,
      };
    case Biome.SNOWY_PLAINS:
    case Biome.SNOWY_TAIGA:
    case Biome.TAIGA:
      return fromWood(Wood.spruce!);
    case Biome.SAVANNA:
      return fromWood(Wood.acacia!);
    case Biome.BIRCH_FOREST:
      return fromWood(Wood.birch!);
    default:
      return {
        wall: Block.OAK_PLANKS,
        corner: Block.OAK_LOG,
        roof: Block.OAK_PLANKS,
        roofStair: stairsId(2), // oak_planks_stairs
        floor: Block.OAK_PLANKS,
        foundation: Block.COBBLESTONE,
      };
  }
}

function buildVillage(w: FeatureWriter, s: StructureInstance, world: FeatureWorld, _seed: number): void {
  const palette = villagePalette(world.columnBiome(s.x, s.z).id);
  const ground = s.y;

  // ---- 广场水井（村庄的中心地标）
  const wellY = ground + 1;
  box(w, s.x - 2, ground - 3, s.z - 2, s.x + 2, ground - 1, s.z + 2, palette.foundation);
  clear(w, s.x - 1, ground - 2, s.z - 1, s.x + 1, ground - 1, s.z + 1);
  box(w, s.x - 1, ground - 2, s.z - 1, s.x + 1, ground - 2, s.z + 1, Block.WATER);
  walls(w, s.x - 2, wellY, s.z - 2, s.x + 2, wellY + 2, s.z + 2, palette.foundation);
  clear(w, s.x - 1, wellY, s.z - 1, s.x + 1, wellY + 2, s.z + 1);
  box(w, s.x - 2, wellY + 3, s.z - 2, s.x + 2, wellY + 3, s.z + 2, palette.roof);
  torch(w, s.x - 2, wellY + 3, s.z, 0);
  torch(w, s.x + 2, wellY + 3, s.z, 0);

  // ---- 房屋：绕中心散布（角度 + 半径抖动，避免重叠）
  //
  // ⚠️ 撒候选的数量是"想要的房子数 × 3"（批次 89 改）：原来是**只撒 houses 个**、
  // 能成几个算几个，而"间距 13 格 + 高差不超过 6 + 必须在海平面以上"三条一起卡下来，
  // **山坡上的村庄经常只剩 1 栋房子**——村庄里住几个人全靠房子数（一张床一个人），
  // 于是"走到一个村庄，只见一个村民"。改成多撒候选、够了就停之后，
  // 实测（随机种子上 12 个村庄）从平均 1 栋提到 **2 栋**、最好的 4 栋
  // （`test:village` 直接数房子与床；要更多就得放宽高差或铺第二圈，那是另一条活的量级）。
  const houses = 4 + s.rng.int(4);
  const placed: Array<{ x: number; z: number; r: number }> = [];
  for (let attempt = 0; attempt < houses * 3 && placed.length < houses; attempt++) {
    const angle = (attempt / (houses * 3)) * Math.PI * 2 + s.rng.next() * 0.8;
    const distance = 11 + s.rng.int(12);
    const hx = s.x + Math.round(Math.cos(angle) * distance);
    const hz = s.z + Math.round(Math.sin(angle) * distance);
    if (placed.some((other) => Math.abs(other.x - hx) < 13 && Math.abs(other.z - hz) < 13)) continue;
    // 房屋必须建在陆地上，且地面不能太陡
    const hGround = world.surfaceY(hx, hz);
    if (hGround < SEA_LEVEL || Math.abs(hGround - ground) > 6) continue;
    placed.push({ x: hx, z: hz, r: 8 });
    buildHouse(w, hx, hGround, hz, s.rng, palette);
  }

  /**
   * 房屋占地的保守半径（含 ±1 的石头地基圈与 1 格余量）。
   * 房子最大 9×9（半宽 4）+ 地基外扩 1 + 余量 1 = 6。
   */
  const HOUSE_HALF = 6;

  // ---- 道路：从广场向 4 个方向铺出去，顺带清掉挡路的植物
  //
  // ⚠️ 批次 179 修：道路**必须绕开房屋**。原来这里是无条件
  // `clear(rx, ry+1, rz, rx, ry+4, rz)` —— 一条路正好从房子南墙穿过去时，
  // 会把墙和门一起清掉，于是那栋房子**有床没门**（`test:village` 数到 10 张床 9 扇门）。
  // 这个坑一直在，只是以前村庄中心那个区块没有房子、断言整段被跳过；
  // 地形一变（房屋落点高度变了）露出来。判据是"房子的门必须比邻床存在"。
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const length = 14 + s.rng.int(12);
    for (let step = 3; step < length; step++) {
      const px = s.x + dx * step;
      const pz = s.z + dz * step;
      if (world.surfaceY(px, pz) < SEA_LEVEL) continue;
      for (let side = -1; side <= 1; side++) {
        const rx = px + (dz === 0 ? 0 : side);
        const rz = pz + (dx === 0 ? 0 : side);
        const insideHouse = placed.some(
          (house) => Math.abs(house.x - rx) <= HOUSE_HALF && Math.abs(house.z - rz) <= HOUSE_HALF,
        );
        if (insideHouse) continue;
        const ry = world.surfaceY(rx, rz);
        clear(w, rx, ry + 1, rz, rx, ry + 4, rz);
        w.fill(rx, ry, rz, Block.GRAVEL);
        // 路边偶尔插个火把
        if (side === 0 && step % 7 === 0) torch(w, rx, ry + 1, rz, 0);
      }
    }
  }
}

/**
 * 在村庄房屋里放一张床（J22，批次 89）。
 *
 * 床是**两格**的东西，而且"哪一半是床头"写在状态位里，所以这里必须走
 * `bedOtherHalf` 那套纯函数算另一半——自己手写 `x + 1` 的话，朝向一改就会
 * 得到"两半方向不一致"的鬼床（而症状只是"睡下去位置不对"）。
 *
 * @param facing 床头朝哪边（0 北 / 1 东 / 2 南 / 3 西）
 */
function villageBed(
  w: FeatureWriter,
  x: number,
  y: number,
  z: number,
  facing: Facing,
  colorIndex: number,
): void {
  const foot = withFacing(0, facing);
  const id = bedId(colorIndex);
  w.fillState(x, y, z, id, foot);
  const [hx, , hz] = bedOtherHalf(x, y, z, foot);
  w.fillState(hx, y, hz, id, withBedHead(foot, true));
}

/** 一栋村庄房屋：地基 → 木墙 → 门窗 → 坡屋顶 */
function buildHouse(w: FeatureWriter, x: number, floorY: number, z: number, rng: PositionalRng, palette: VillagePalette): void {
  const width = rng.chance(0.5) ? 7 : 9;
  const depth = rng.chance(0.5) ? 7 : 9;
  const x0 = x - (width >> 1);
  const x1 = x0 + width - 1;
  const z0 = z - (depth >> 1);
  const z1 = z0 + depth - 1;
  const base = floorY + 1;
  const wallHeight = 3;

  // 平整地基：先挖掉上面的植物与地形起伏，再铺一层石头地基
  clear(w, x0 - 1, base - 2, z0 - 1, x1 + 1, base + 12, z1 + 1);
  box(w, x0 - 1, base - 3, z0 - 1, x1 + 1, base - 1, z1 + 1, palette.foundation);

  // 地板
  box(w, x0, base - 1, z0, x1, base - 1, z1, palette.floor);

  // 四面墙：木墙 + 四角原木
  walls(w, x0, base, z0, x1, base + wallHeight, z1, palette.wall);
  // ⚠️ `walls()` 是"空心盒"那套：它会把**底面与顶面也填成整块**（见它的实现）。
  // 房屋要的只是"四面墙"，所以把底面那层（y=base）的屋内格子清回来——
  // 不清的话屋里会凭空多出一层 1 格高的地板，后果有三条，全都很难从截图看出来
  // （批次 89 做"村庄住上人"时才发现，见 TASKS O13）：
  //   ① 玩家进不去门（门口比屋外高两格，得跳）；
  //   ② 地上的箱子**埋在那层地板里**（原版村庄的箱子就在地上）；
  //   ③ 村民只有 2 格净空（他们身高 1.95，头顶就是天花板）。
  clear(w, x0 + 1, base, z0 + 1, x1 - 1, base, z1 - 1);
  for (let y = base; y <= base + wallHeight; y++) {
    for (const [cx, cz] of [
      [x0, z0],
      [x1, z0],
      [x0, z1],
      [x1, z1],
    ] as const) {
      w.fill(cx, y, cz, palette.corner);
    }
  }

  // 窗户
  for (let wx = x0 + 2; wx <= x1 - 2; wx += 3) {
    w.fill(wx, base + 1, z0, Block.GLASS);
    w.fill(wx, base + 1, z1, Block.GLASS);
  }
  for (let wz = z0 + 2; wz <= z1 - 2; wz += 3) {
    w.fill(x0, base + 1, wz, Block.GLASS);
    w.fill(x1, base + 1, wz, Block.GLASS);
  }

  // 门（开在南墙中央，门轴随机左右）
  const doorX = x0 + (width >> 1);
  const hinge = rng.chance(0.5) ? 1 : 0;
  w.fill(doorX, base, z1, Block.AIR);
  w.fill(doorX, base + 1, z1, Block.AIR);
  openDoor(w, doorX, base, z1, 2, hinge as 0 | 1);

  // 屋顶：四周挑檐 + 平顶（用楼梯做出檐口）
  for (let rx = x0 - 1; rx <= x1 + 1; rx++) {
    for (let rz = z0 - 1; rz <= z1 + 1; rz++) {
      const eave = rx === x0 - 1 || rx === x1 + 1 || rz === z0 - 1 || rz === z1 + 1;
      w.fill(rx, base + wallHeight + 1, rz, eave ? palette.roofStair : palette.roof);
    }
  }
  // 挑檐用倒置楼梯近似（放到屋顶之下一层的外圈）
  for (let rx = x0 - 1; rx <= x1 + 1; rx++) {
    for (let rz = z0 - 1; rz <= z1 + 1; rz++) {
      const eave = rx === x0 - 1 || rx === x1 + 1 || rz === z0 - 1 || rz === z1 + 1;
      if (eave) w.fill(rx, base + wallHeight, rz, palette.roofStair);
    }
  }

  // 室内：一盏火把 + 一张箱子 + **一张床 + 一个工作站**（J22，批次 89）。
  //
  // ⚠️ 床与工作站是"这栋房子里住着人"的**唯一凭据**：主线程在区块加载时
  // 扫的就是它们（见 `core/world/VillagePopulation.ts`）——屋里没床，村庄就是空村。
  // 所以这两样不是装饰，是**功能方块**，位置也不能被别的家具挤掉。
  torch(w, x0 + 1, base + 1, z0 + 1, 0);
  lootChest(w, x1 - 1, base, z1 - 2, 'village_house');
  // 床贴着西墙、在火把那盏灯的南边（错开一格，免得火把正好悬在枕头上面）
  villageBed(w, x0 + 1, base, z0 + 2, 2, rng.int(16));
  // 工作站贴着东墙（与箱子隔开一格，免得"打开箱子挡着认领"）
  w.fill(x1 - 1, base, z0 + 1, rng.pick(WORKSTATION_BLOCKS));
}

// ---------------------------------------------------------------- 废弃矿井

function buildMineshaft(w: FeatureWriter, s: StructureInstance, _world: FeatureWorld, _seed: number): void {
  const rng = s.rng;
  const log = Block.OAK_LOG;
  const plank = Block.OAK_PLANKS;
  const fence = Block.OAK_FENCE;

  // 走廊：3 高 3 宽，木支撑每 4 格
  const dig = (x: number, y: number, z: number, dirX: number, dirZ: number, length: number, depth: number): void => {
    for (let i = 0; i < length; i++) {
      const cx = x + dirX * i;
      const cz = z + dirZ * i;
      // 3×3 截面
      const px = dirX === 0 ? 1 : 0;
      const pz = dirZ === 0 ? 1 : 0;
      clear(w, cx - px, y, cz - pz, cx + px, y + 2, cz + pz);
      // 地面铺木板，避免踩在虚空上
      for (let dx = -px; dx <= px; dx++) {
        for (let dz = -pz; dz <= pz; dz++) w.fill(cx + dx, y - 1, cz + dz, plank);
      }
      // 木支撑（拱形：两根立柱 + 一根横梁）
      if (i % 4 === 0) {
        w.fill(cx - px, y, cz - pz, plank);
        w.fill(cx + px, y, cz + pz, plank);
        w.fill(cx - px, y + 1, cz - pz, fence);
        w.fill(cx + px, y + 1, cz + pz, fence);
        w.fill(cx, y + 2, cz, plank);
        if (i % 12 === 0) torch(w, cx, y + 1, cz, 0);
      }
    }

    // 分叉与继续延伸
    if (depth <= 0) return;
    const branches = 1 + rng.int(3);
    for (let b = 0; b < branches; b++) {
      const bx = x + dirX * (4 + rng.int(Math.max(1, length - 4)));
      const bz = z + dirZ * (4 + rng.int(Math.max(1, length - 4)));
      const turn = rng.chance(0.5);
      const nx = turn ? (rng.chance(0.5) ? 1 : -1) : dirX;
      const nz = turn ? 0 : rng.chance(0.5) ? 1 : -1;
      const ny = y + (rng.chance(0.3) ? (rng.chance(0.5) ? 5 : -5) : 0);
      if (ny < -60 || ny > 55) continue;
      dig(bx, ny, bz, nx, nz, 10 + rng.int(18), depth - 1);
    }

    // 走廊尽头的小房间
    if (rng.chance(0.7)) {
      const rx = x + dirX * (length - 2);
      const rz = z + dirZ * (length - 2);
      const ex = dirX === 0 ? 3 : 0;
      const ez = dirZ === 0 ? 3 : 0;
      clear(w, rx - ex, y, rz - ez, rx + ex, y + 3, rz + ez);
      box(w, rx - ex - 1, y - 1, rz - ez - 1, rx + ex + 1, y - 1, rz + ez + 1, plank);
      lootChest(w, rx + ex, y, rz + ez, 'mineshaft');
      // 废弃矿井的招牌：洞穴蜘蛛刷怪笼（批次 365）
      if (rng.chance(0.6)) w.fill(rx, y, rz, Block.CAVE_SPIDER_SPAWNER);
      torch(w, rx, y + 3, rz, 0);
      // 支撑柱与可能的粗铁块（原版矿井里的"矿车箱"）
      w.fill(rx - ex, y, rz - ez, log);
      w.fill(rx + ex, y, rz + ez, log);
    }
  };

  // 主巷道沿 X 方向铺开
  dig(s.x - 14, s.y, s.z, 1, 0, 28, 2);
}

// ---------------------------------------------------------------- 要塞

function buildStronghold(w: FeatureWriter, s: StructureInstance): void {
  const rng = s.rng;
  const brick = Block.STONE_BRICKS;
  const mossy = Block.MOSSY_STONE_BRICKS;
  const cracked = Block.CRACKED_STONE_BRICKS;
  const pick = (): number => {
    const roll = rng.next();
    return roll < 0.12 ? mossy : roll < 0.24 ? cracked : brick;
  };
  /** 用"随机化的石砖"砌墙：要塞的墙面本身就有苔石与裂纹的斑驳感 */
  const mottled = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const edge = x === x0 || x === x1 || z === z0 || z === z1 || y === y0 || y === y1;
          if (edge) w.fill(x, y, z, pick());
        }
      }
    }
  };

  // 主走廊：沿 X 方向 44 格，截面 3 宽 4 高
  const y = s.y;
  const startX = s.x - 22;
  clear(w, startX, y, s.z - 2, startX + 44, y + 4, s.z + 2);
  box(w, startX, y - 1, s.z - 2, startX + 44, y - 1, s.z + 2, brick);
  walls(w, startX, y, s.z - 2, startX + 44, y + 4, s.z + 2, brick);
  for (let i = 0; i < 44; i += 3) {
    for (const dz of [-2, 2]) w.fill(startX + i, y + 3, s.z + dz, Block.TORCH);
  }

  // 图书馆（走廊北侧的方厅，放书架台与箱子）
  const libX = startX + 6;
  const libZ = s.z - 14;
  clear(w, libX, y, libZ, libX + 14, y + 5, libZ + 9);
  box(w, libX, y - 1, libZ, libX + 14, y - 1, libZ + 9, Block.OAK_PLANKS);
  mottled(libX, y, libZ, libX + 14, y + 5, libZ + 9);
  // 书架（用木板 + 台阶叠出的"书柜"：原版书架方块暂无）
  for (let i = 0; i < 5; i++) {
    box(w, libX + 2 + i * 2, y, libZ + 1, libX + 2 + i * 2, y + 2, libZ + 1, Block.OAK_PLANKS);
  }
  // 图书馆角落的蠹虫刷怪笼（批次 365）
  w.fill(libX + 12, y, libZ + 7, Block.SILVERFISH_SPAWNER);
  lootChest(w, libX + 1, y, libZ + 4, 'stronghold_library');
  lootChest(w, libX + 13, y, libZ + 8, 'stronghold_library');
  torch(w, libX + 7, y + 4, libZ + 5, 0);
  // 连接走廊与图书馆的支路
  clear(w, libX + 6, y, s.z - 2, libX + 8, y + 3, libZ + 9);
  box(w, libX + 6, y - 1, s.z - 2, libX + 8, y - 1, libZ + 9, brick);
  walls(w, libX + 6, y, s.z - 3, libX + 8, y + 3, libZ, brick);

  // 喷泉房（走廊南侧）：中央水池 + 金块装饰（用粗金块位代替的"金"）
  const fX = startX + 26;
  const fZ = s.z + 6;
  clear(w, fX, y, fZ, fX + 12, y + 6, fZ + 12);
  box(w, fX, y - 1, fZ, fX + 12, y - 1, fZ + 12, brick);
  mottled(fX, y, fZ, fX + 12, y + 6, fZ + 12);
  clear(w, fX + 3, y, fZ + 3, fX + 9, y + 1, fZ + 9);
  box(w, fX + 4, y, fZ + 4, fX + 8, y, fZ + 8, Block.WATER);
  box(w, fX + 4, y - 1, fZ + 4, fX + 8, y - 1, fZ + 8, Block.STONE_BRICKS);
  w.fill(fX + 6, y + 1, fZ + 6, Block.SEA_LANTERN);
  clear(w, fX + 5, y, s.z + 2, fX + 7, y + 3, fZ + 6);
  box(w, fX + 5, y - 1, s.z + 2, fX + 7, y - 1, fZ + 6, brick);

  // 传送门房（走廊尽头，K9 批次 111 改成**真的**末地传送门）：
  // 12 格末地传送门框架围成一圈 + 中间的岩浆池。圈齐了（12 只末影之眼）
  // 中间的 3×3 才会亮起来——在此之前这里只是一堵"用黑曜石比划出来的假门"。
  //
  // 布局与原版一致：框架圈在**地面上那一层**，中间 3×3 是空的、底下往下两层是岩浆
  //（原版传送门房就是"一座架在岩浆池上的门"）。
  const pX = startX + 38;
  const pZ = s.z;
  clear(w, pX - 5, y, pZ - 5, pX + 5, y + 6, pZ + 5);
  box(w, pX - 5, y - 1, pZ - 5, pX + 5, y - 1, pZ + 5, brick);
  mottled(pX - 5, y, pZ - 5, pX + 5, y + 6, pZ + 5);

  // 中心 3×3 的岩浆池：先把池子**包起来**再灌岩浆
  // （要塞是地下结构，池底周围可能是洞穴——不包的话岩浆会顺着洞流走，
  //  原版的传送门房也是"一圈石砖围着一个池子"）
  box(w, pX - 2, y - 2, pZ - 2, pX + 2, y - 1, pZ + 2, brick);
  box(w, pX - 1, y - 2, pZ - 1, pX + 1, y - 1, pZ + 1, Block.LAVA);
  clear(w, pX - 1, y, pZ - 1, pX + 1, y, pZ + 1);

  // 12 格框架（5×5 去掉四角，见 `world/EndPortal.ts` 的唯一一份布局表）。
  // 每格有 10% 的概率**出生时就带着眼睛**（原版数值）——
  // 所以"这一座要塞还差几只"每次都不一样
  for (const [dx, dz] of END_PORTAL_RING) {
    w.fillState(
      pX + dx,
      y,
      pZ + dz,
      Block.END_PORTAL_FRAME,
      rng.chance(0.1) ? withEndPortalEye(0, true) : 0,
    );
  }

  // 传送门房的那一个箱子（K9）：末影珍珠在这里（表见 `loot.ts` 的 `stronghold_portal`）
  lootChest(w, pX - 4, y, pZ + 4, 'stronghold_portal');
  for (const dx of [-4, 4]) {
    for (const dz of [-4, 4]) w.fill(pX + dx, y, pZ + dz, Block.TORCH);
  }
}

// ---------------------------------------------------------------- 地牢

function buildDungeon(w: FeatureWriter, s: StructureInstance): void {
  const rng = s.rng;
  const size = 3 + rng.int(2) * 2; // 3 或 5 → 房间 7×7 / 9×9
  const y = s.y;
  const id = (): number => (rng.chance(0.3) ? Block.MOSSY_COBBLESTONE : Block.COBBLESTONE);

  // 房间：地板 + 四周墙 + 天花板，全部用"带斑驳的鹅卵石"
  for (let dy = 0; dy <= 4; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      for (let dz = -size; dz <= size; dz++) {
        const edge = dx === -size || dx === size || dz === -size || dz === size;
        if (dy === 0 || dy === 4 || edge) w.fill(s.x + dx, y + dy, s.z + dz, id());
      }
    }
  }
  clear(w, s.x - size + 1, y + 1, s.z - size + 1, s.x + size - 1, y + 3, s.z + size - 1);

  // 中央箱子 + 火把；角落一只僵尸刷怪笼（批次 365）
  lootChest(w, s.x, y + 1, s.z, 'dungeon');
  w.fill(s.x + 2, y + 1, s.z + 2, Block.ZOMBIE_SPAWNER);
  torch(w, s.x - size + 1, y + 1, s.z - size + 1, 0);
  torch(w, s.x + size - 1, y + 1, s.z + size - 1, 0);
}

// ---------------------------------------------------------------- 沉船

function buildShipwreck(w: FeatureWriter, s: StructureInstance): void {
  const rng = s.rng;
  const length = 18 + rng.int(8);
  const halfWidth = 3 + rng.int(2);
  const x0 = s.x - (length >> 1);
  const hullBottom = s.y; // 船底（海底）
  const deck = hullBottom + 4 + rng.int(2);

  const plankIds = [Block.OAK_PLANKS, 103, 108, 113, 118, 123]; // 6 种木板
  const pick = (): number => plankIds[rng.int(plankIds.length)]!;
  const mainPlank = pick();

  // 船体：从船底向两侧展开的 V 形
  for (let i = 0; i < length; i++) {
    const x = x0 + i;
    // 首尾收窄
    const taper = Math.min(i, length - 1 - i);
    const width = Math.max(1, halfWidth - (taper < 3 ? 3 - taper : 0));
    for (let dz = -width; dz <= width; dz++) {
      const edge = Math.abs(dz) === width;
      // 底部 V 形：中间低、两侧高
      const rise = Math.round((Math.abs(dz) / (width + 0.001)) * 2);
      const y = hullBottom + rise;
      w.fill(x, y, s.z + dz, mainPlank);
      if (edge) {
        for (let dy = 1; dy <= deck - y - 1; dy++) w.fill(x, y + dy, s.z + dz, pick());
      } else {
        // 内舱：清空
        for (let dy = 1; dy < deck - y; dy++) w.fill(x, y + dy, s.z + dz, Block.AIR);
      }
    }
    // 甲板（每隔几格留缺口，表现破损）
    if (i % 5 !== 4) {
      for (let dz = -width; dz <= width; dz++) w.fill(x, deck, s.z + dz, mainPlank);
    }
  }

  // 桅杆（可能已经断掉，只留一截）
  const mastX = s.x;
  const mastHeight = rng.chance(0.5) ? 3 : 6 + rng.int(4);
  for (let dy = 1; dy <= mastHeight; dy++) w.fill(mastX, deck + dy, s.z, Block.OAK_LOG);

  // 舰楼（船尾的小舱室）
  const cabinX = x0 + length - 5;
  for (let dx = 0; dx < 4; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      w.fill(cabinX + dx, deck + 1, s.z + dz, mainPlank);
      w.fill(cabinX + dx, deck + 4, s.z + dz, mainPlank);
    }
  }
  for (let dx = 0; dx < 4; dx++) {
    for (const dz of [-2, 2]) {
      for (let dy = 2; dy <= 3; dy++) w.fill(cabinX + dx, deck + dy, s.z + dz, mainPlank);
    }
  }
  clear(w, cabinX, deck + 2, s.z - 1, cabinX + 3, deck + 3, s.z + 1);
  // 甲板上的箱子是"补给箱"、船底的是"宝箱"（原版也是两张表：supply / treasure）
  lootChest(w, cabinX + 1, deck + 2, s.z, 'shipwreck_supply');
  torch(w, cabinX + 3, deck + 2, s.z + 1, 0);

  // 船舱里的散落箱子
  lootChest(w, s.x - 4, hullBottom + 1, s.z + 1, 'shipwreck_treasure');
  if (rng.chance(0.5)) lootChest(w, s.x + 3, hullBottom + 2, s.z - 1, 'shipwreck_treasure');
  // 注：船体周围的海水保留，船舱内部在上面的循环里已经被清空（原版沉船里可以呼吸）
}

// ---------------------------------------------------------------- 海底神殿

function buildOceanMonument(w: FeatureWriter, s: StructureInstance, world: FeatureWorld, _seed: number): void {
  const rng = s.rng;
  const base = Math.max(world.surfaceY(s.x, s.z) + 4, s.y + 4);
  const prismarine = Block.PRISMARINE;
  const bricks = Block.PRISMARINE_BRICKS;
  const dark = Block.DARK_PRISMARINE;
  const lamp = Block.SEA_LANTERN;

  /** 一层棱台：外墙 + 内部挖空 */
  const tier = (radius: number, y0: number, height: number, wallId: number): void => {
    for (let y = y0; y < y0 + height; y++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const edge = Math.max(Math.abs(dx), Math.abs(dz)) === radius;
          if (edge) w.fill(s.x + dx, y, s.z + dz, rng.chance(0.18) ? dark : wallId);
          else if (y === y0) w.fill(s.x + dx, y, s.z + dz, rng.chance(0.25) ? bricks : prismarine);
          else w.fill(s.x + dx, y, s.z + dz, Block.AIR);
        }
      }
    }
  };

  // 三层棱台（30 → 22 → 14）
  tier(15, base, 6, prismarine);
  tier(11, base + 6, 6, bricks);
  tier(7, base + 12, 6, prismarine);
  // 顶盖
  box(w, s.x - 7, base + 18, s.z - 7, s.x + 7, base + 18, s.z + 7, dark);

  // 内部房间：隔墙 + 海灯
  for (const axis of ['x', 'z'] as const) {
    for (const offset of [-8, 0, 8]) {
      for (let y = base + 1; y <= base + 11; y++) {
        for (let t = -8; t <= 8; t++) {
          const x = axis === 'x' ? s.x + t : s.x + offset;
          const z = axis === 'x' ? s.z + offset : s.z + t;
          // 留出门洞
          if (Math.abs(t) < 2 && (y === base + 1 || y === base + 2)) continue;
          w.fill(x, y, z, rng.chance(0.25) ? dark : bricks);
        }
      }
    }
  }
  for (const [dx, dz] of [
    [0, 0],
    [5, 5],
    [-5, 5],
    [5, -5],
    [-5, -5],
  ] as const) {
    w.fill(s.x + dx, base + 5, s.z + dz, lamp);
  }

  // 外部的海灯柱（原版神殿四周的那几根柱子）
  for (const [dx, dz] of [
    [18, 0],
    [-18, 0],
    [0, 18],
    [0, -18],
  ] as const) {
    const px = s.x + dx;
    const pz = s.z + dz;
    const columnBase = Math.max(base - 4, world.surfaceY(px, pz));
    for (let y = columnBase; y < base + 6; y++) w.fill(px, y, pz, dark);
    w.fill(px, base + 6, pz, lamp);
    w.fill(px, base + 7, pz, dark);
  }

  // 神殿底部的地基：把底座下方的水换成石头，避免"悬空的神殿"
  for (let dx = -15; dx <= 15; dx++) {
    for (let dz = -15; dz <= 15; dz++) {
      for (let y = base - 1; y > base - 6; y--) {
        // 只在原来是水/空气时填石头，避免破坏海底
        const current = w.get(s.x + dx, y, s.z + dz);
        if (current === OUTSIDE || current === Block.WATER || current === Block.AIR) w.fill(s.x + dx, y, s.z + dz, Block.STONE);
        else break;
      }
    }
  }
}

// ---------------------------------------------------------------- 林地府邸

function buildWoodlandMansion(w: FeatureWriter, s: StructureInstance, world: FeatureWorld): void {
  const base = world.surfaceY(s.x, s.z) + 1;
  const plank = Wood.dark_oak!.planks;
  const log = Wood.dark_oak!.log;
  const cobble = Block.COBBLESTONE;
  const stair = Wood.dark_oak!.stairs;

  // 三层（24 → 16 → 10），每层 4 格高，逐层收缩
  const tiers: Array<readonly [number, number]> = [
    [12, 0],
    [8, 4],
    [5, 8],
  ];

  for (const [radius, dy] of tiers) {
    const y0 = base + dy;
    const y1 = y0 + 3;
    // 地基（挖掉起伏 + 铺石）
    box(w, s.x - radius - 1, y0 - 1, s.z - radius - 1, s.x + radius + 1, y0 - 1, s.z + radius + 1, cobble);
    clear(w, s.x - radius, y0, s.z - radius, s.x + radius, y1, s.z + radius);

    // 外墙：木板 + 角柱
    for (let y = y0; y <= y1; y++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const edge = Math.abs(dx) === radius || Math.abs(dz) === radius;
          if (!edge) continue;
          const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
          w.fill(s.x + dx, y, s.z + dz, corner ? log : plank);
        }
      }
    }
    // 窗
    for (let t = -radius + 2; t <= radius - 2; t += 3) {
      w.fill(s.x + t, y0 + 1, s.z - radius, Block.GLASS);
      w.fill(s.x + t, y0 + 1, s.z + radius, Block.GLASS);
      w.fill(s.x - radius, y0 + 1, s.z + t, Block.GLASS);
      w.fill(s.x + radius, y0 + 1, s.z + t, Block.GLASS);
    }
    // 内部隔墙：把每层切成几个房间
    for (const offset of [-Math.floor(radius / 2), Math.floor(radius / 2)]) {
      for (let t = -radius + 1; t <= radius - 1; t++) {
        for (let y = y0; y <= y1; y++) {
          if (Math.abs(t) < 2 && y <= y0 + 1) continue; // 门洞
          w.fill(s.x + t, y, s.z + offset, plank);
          w.fill(s.x + offset, y, s.z + t, plank);
        }
      }
    }
    // 地板
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) w.fill(s.x + dx, y0 - 1, s.z + dz, plank);
    }
    // 室内火把
    for (const [dx, dz] of [
      [radius - 2, radius - 2],
      [-radius + 2, -radius + 2],
      [radius - 2, -radius + 2],
      [-radius + 2, radius - 2],
    ] as const) {
      torch(w, s.x + dx, y0 + 2, s.z + dz, 0);
    }
  }

  // 楼梯：从一层通到三层（沿着 +x 侧的内墙盘旋）
  const stairX = s.x + 9;
  const stairZ = s.z + 9;
  stairs(w, stairX, base + 1, stairZ, 1, 4, stair, -1, 0);
  stairs(w, stairX - 4, base + 5, stairZ, 1, 4, stair, -1, 0);

  // 一层的门厅 + 箱子
  clear(w, s.x, base + 1, s.z + 11, s.x + 1, base + 3, s.z + 12);
  openDoor(w, s.x, base + 1, s.z + 12, 0, 1);
  lootChest(w, s.x + 3, base + 1, s.z + 3, 'mansion');
  lootChest(w, s.x - 3, base + 5, s.z - 3, 'mansion');

  // 屋顶
  for (const [radius, dy] of tiers) {
    box(w, s.x - radius - 1, base + dy + 4, s.z - radius - 1, s.x + radius + 1, base + dy + 4, s.z + radius + 1, plank);
  }
}

// ---------------------------------------------------------------- 沙漠神殿（批次 341）

/**
 * 沙漠神殿：21×21 四级阶梯金字塔。
 *
 * ⚠️ 与原版的差异：原版宝库在地下的一个房间里（入口是向下的阶梯）；
 * 这里把宝库放在**基座层**、由北侧 1×3 走廊直通——地形起伏下挖竖井要额外一套
 * 支撑/梯子处理，先把"有房间、有四个箱子、有战利品"这条主干做出来。
 */
function buildDesertPyramid(w: FeatureWriter, s: StructureInstance): void {
  const base = s.y;
  box(w, s.x - 10, base, s.z - 10, s.x + 10, base, s.z + 10, Block.SANDSTONE);

  for (const [radius, dy] of [[10, 0], [7, 4], [4, 8], [2, 12]] as const) {
    box(w, s.x - radius, base + dy + 1, s.z - radius, s.x + radius, base + dy + 4, s.z + radius, Block.SANDSTONE);
    // 每级顶面一圈切制砂岩（原版那种"描边"）
    box(w, s.x - radius, base + dy + 4, s.z - radius, s.x + radius, base + dy + 4, s.z + radius, Block.CUT_SANDSTONE);
  }
  box(w, s.x - 2, base + 17, s.z - 2, s.x + 2, base + 17, s.z + 2, Block.SMOOTH_SANDSTONE);

  // 北侧入口 → 中央宝库
  clear(w, s.x, base + 1, s.z - 10, s.x, base + 3, s.z - 1);
  clear(w, s.x - 3, base + 1, s.z - 1, s.x + 3, base + 3, s.z + 3);
  lootChest(w, s.x - 3, base + 1, s.z - 1, 'desert_pyramid');
  lootChest(w, s.x + 3, base + 1, s.z - 1, 'desert_pyramid');
  lootChest(w, s.x - 3, base + 1, s.z + 3, 'desert_pyramid');
  lootChest(w, s.x + 3, base + 1, s.z + 3, 'desert_pyramid');
  torch(w, s.x, base + 2, s.z + 1);
}

// ---------------------------------------------------------------- 丛林神庙（批次 341）

/** 丛林神庙：13×13 三级阶梯，苔石斑驳，南侧入口通中央密室 */
function buildJungleTemple(w: FeatureWriter, s: StructureInstance): void {
  const rng = s.rng;
  const base = s.y;
  const stone = (): number => (rng.chance(0.35) ? Block.MOSSY_COBBLESTONE : Block.COBBLESTONE);

  for (let x = -6; x <= 6; x++) {
    for (let z = -6; z <= 6; z++) w.fill(s.x + x, base, s.z + z, stone());
  }

  for (const [radius, dy] of [[6, 0], [4, 3], [2, 6]] as const) {
    for (let y = 1; y <= 3; y++) {
      for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) w.fill(s.x + x, base + dy + y, s.z + z, stone());
      }
    }
    for (let x = -radius; x <= radius; x++) {
      w.fill(s.x + x, base + dy + 3, s.z - radius, Block.CHISELED_STONE_BRICKS);
      w.fill(s.x + x, base + dy + 3, s.z + radius, Block.CHISELED_STONE_BRICKS);
    }
  }

  // 南侧入口 → 中央密室
  clear(w, s.x, base + 1, s.z + 6, s.x, base + 2, s.z + 2);
  clear(w, s.x - 2, base + 1, s.z - 2, s.x + 2, base + 2, s.z + 2);
  lootChest(w, s.x, base + 1, s.z - 2, 'jungle_temple');
  torch(w, s.x - 2, base + 2, s.z - 1);
  torch(w, s.x + 2, base + 2, s.z - 1);
}

// ---------------------------------------------------------------- 女巫小屋（批次 345）

/** 沼泽里的高脚小屋：云杉木、四根柱子、炼药锅/工作台/箱子 */
function buildWitchHut(w: FeatureWriter, s: StructureInstance): void {
  const base = s.y;
  const plank = Wood.spruce?.planks ?? Block.OAK_PLANKS;
  const log = Wood.spruce?.log ?? Block.OAK_LOG;
  clear(w, s.x - 3, base + 1, s.z - 3, s.x + 3, base + 7, s.z + 3);

  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]] as const) {
    for (let y = 1; y <= 2; y++) w.fill(s.x + dx, base + y, s.z + dz, log);
  }
  const floorY = base + 3;
  box(w, s.x - 3, floorY, s.z - 3, s.x + 3, floorY, s.z + 3, plank);
  walls(w, s.x - 3, floorY + 1, s.z - 3, s.x + 3, floorY + 3, s.z + 3, plank);
  // 南侧门
  w.fill(s.x, floorY + 1, s.z + 3, Block.AIR);
  w.fill(s.x, floorY + 2, s.z + 3, Block.AIR);
  // 屋顶（一层平台 + 向内收一圈）
  box(w, s.x - 4, floorY + 4, s.z - 4, s.x + 4, floorY + 4, s.z + 4, plank);
  box(w, s.x - 2, floorY + 5, s.z - 2, s.x + 2, floorY + 5, s.z + 2, plank);

  w.fill(s.x - 2, floorY + 1, s.z - 2, Block.CAULDRON);
  w.fill(s.x + 2, floorY + 1, s.z - 2, Block.CRAFTING_TABLE);
  lootChest(w, s.x + 2, floorY + 1, s.z + 2, 'witch_hut');
  torch(w, s.x, floorY + 2, s.z);
}

// ---------------------------------------------------------------- 掠夺者前哨（批次 345）

/** 三层深色橡木塔；没有掠夺者（J24 未做），只作为可探索建筑与箱子来源 */
function buildPillagerOutpost(w: FeatureWriter, s: StructureInstance): void {
  const base = s.y;
  const plank = Wood.dark_oak?.planks ?? Block.OAK_PLANKS;
  const log = Wood.dark_oak?.log ?? Block.OAK_LOG;
  clear(w, s.x - 3, base, s.z - 3, s.x + 3, base + 13, s.z + 3);

  for (let level = 0; level < 3; level++) {
    const y = base + level * 4;
    box(w, s.x - 3, y, s.z - 3, s.x + 3, y, s.z + 3, plank);
    walls(w, s.x - 3, y + 1, s.z - 3, s.x + 3, y + 3, s.z + 3, plank);
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]] as const) {
      for (let t = 1; t <= 3; t++) w.fill(s.x + dx, y + t, s.z + dz, log);
    }
    // 上一层地板留一个 1×1 洞（不铺梯子，玩家可以自己搭）
    if (level < 2) w.fill(s.x + 2, y, s.z + 2, Block.AIR);
  }
  box(w, s.x - 4, base + 12, s.z - 4, s.x + 4, base + 12, s.z + 4, plank);
  lootChest(w, s.x, base + 9, s.z, 'outpost');
  torch(w, s.x - 2, base + 9, s.z - 2);
}

// ---------------------------------------------------------------- 废弃传送门（批次 347）

/** 废弃传送门：残缺黑曜石框 + 火山岩地皮 + 金块 + 箱子（用现有 `dungeon` 表） */
function buildRuinedPortal(w: FeatureWriter, s: StructureInstance): void {
  const rng = s.rng;
  const base = s.y;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      if (rng.chance(0.35)) w.fill(s.x + dx, base, s.z + dz, Block.NETHERRACK);
    }
  }
  // 4 宽 5 高的框（每块 80% 概率还在：原版就是"塌了一半"）
  for (let y = 1; y <= 5; y++) {
    for (const dx of [-2, 2] as const) if (rng.chance(0.8)) w.fill(s.x + dx, base + y, s.z, Block.OBSIDIAN);
  }
  for (let x = -2; x <= 2; x++) {
    for (const y of [1, 5] as const) if (rng.chance(0.8)) w.fill(s.x + x, base + y, s.z, Block.OBSIDIAN);
  }
  if (rng.chance(0.5)) w.fill(s.x - 1, base + 1, s.z - 1, Block.GOLD_BLOCK);
  lootChest(w, s.x + 1, base + 1, s.z - 1, 'dungeon');
}

// ---------------------------------------------------------------- 埋藏的宝藏（批次 347）

/** 海滩沙下的小石室 + 一只宝箱（用现有 `shipwreck_treasure` 表） */
function buildBuriedTreasure(w: FeatureWriter, s: StructureInstance): void {
  const y = s.y - 5;
  clear(w, s.x - 2, y, s.z - 2, s.x + 2, y + 2, s.z + 2);
  box(w, s.x - 2, y - 1, s.z - 2, s.x + 2, y - 1, s.z + 2, Block.SANDSTONE);
  walls(w, s.x - 2, y, s.z - 2, s.x + 2, y + 2, s.z + 2, Block.SANDSTONE);
  lootChest(w, s.x, y, s.z, 'shipwreck_treasure');
}

// ---------------------------------------------------------------- 沙漠水井（批次 408）

/**
 * 沙漠水井：5×5 的圆石台 + 中间 1×1 的井 + 四根柱子撑一个 3×3 的顶。
 *
 * ⚠️ 与原版的差异：原版的顶是**砂岩台阶**（半砖），这里用整块圆石——
 * 本项目没有通用的 `stone_slab` 常量（石材台阶是按变体函数算 id 的），
 * 为了一个装饰顶去接那套 id 换算不划算。整体轮廓（方井 + 柱 + 顶）是一致的。
 * 井水只填**一格深**：填 4 格深的话，玩家掉进去要靠游泳才上得来。
 */
function buildDesertWell(w: FeatureWriter, s: StructureInstance): void {
  const base = s.y;
  clear(w, s.x - 2, base + 1, s.z - 2, s.x + 2, base + 4, s.z + 2);

  // 台面：5×5 砂岩，中间 3×3 换成圆石（井沿）
  box(w, s.x - 2, base, s.z - 2, s.x + 2, base, s.z + 2, Block.SANDSTONE);
  box(w, s.x - 1, base, s.z - 1, s.x + 1, base, s.z + 1, Block.COBBLESTONE);

  // 井口：中心一格挖成水，四周留一圈圆石护沿（高 1）
  w.fill(s.x, base, s.z, Block.WATER);
  walls(w, s.x - 1, base + 1, s.z - 1, s.x + 1, base + 1, s.z + 1, Block.COBBLESTONE);

  // 四根柱子 + 3×3 顶
  for (const [dx, dz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    w.fill(s.x + dx, base + 1, s.z + dz, Block.COBBLESTONE);
    w.fill(s.x + dx, base + 2, s.z + dz, Block.COBBLESTONE);
  }
  box(w, s.x - 1, base + 3, s.z - 1, s.x + 1, base + 3, s.z + 1, Block.COBBLESTONE);
}

// ---------------------------------------------------------------- 冰屋（批次 348）

/** 雪原小屋：雪块墙 + 冰地板 + 两层内收屋顶 + 箱子（复用 `village_house` 表） */
function buildIgloo(w: FeatureWriter, s: StructureInstance): void {
  const base = s.y;
  clear(w, s.x - 3, base + 1, s.z - 2, s.x + 3, base + 5, s.z + 2);
  box(w, s.x - 3, base, s.z - 2, s.x + 3, base, s.z + 2, Block.ICE);
  walls(w, s.x - 3, base + 1, s.z - 2, s.x + 3, base + 3, s.z + 2, Block.SNOW_BLOCK);
  w.fill(s.x, base + 1, s.z + 2, Block.AIR);
  w.fill(s.x, base + 2, s.z + 2, Block.AIR);
  box(w, s.x - 3, base + 4, s.z - 2, s.x + 3, base + 4, s.z + 2, Block.SNOW_BLOCK);
  box(w, s.x - 2, base + 5, s.z - 1, s.x + 2, base + 5, s.z + 1, Block.SNOW_BLOCK);
  lootChest(w, s.x + 2, base + 1, s.z - 1, 'village_house');
  torch(w, s.x - 2, base + 2, s.z);
}

// ---------------------------------------------------------------- 海底废墟（批次 348）

/** 海床上的残墙与碎块（5×5、高 1~3），箱子复用 `shipwreck_supply` */
function buildOceanRuins(w: FeatureWriter, s: StructureInstance): void {
  const rng = s.rng;
  const base = s.y;
  const stone = (): number => (rng.chance(0.4) ? Block.MOSSY_COBBLESTONE : Block.SANDSTONE);

  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
      const height = 1 + rng.int(3);
      for (let y = 1; y <= height; y++) if (rng.chance(0.75)) w.fill(s.x + dx, base + y, s.z + dz, stone());
    }
  }
  for (let i = 0; i < 8; i++) {
    const dx = rng.int(5) - 2;
    const dz = rng.int(5) - 2;
    if (rng.chance(0.5)) w.fill(s.x + dx, base, s.z + dz, stone());
  }
  if (rng.chance(0.5)) lootChest(w, s.x, base + 1, s.z, 'shipwreck_supply');
}

// ---------------------------------------------------------------- 化石（批次 349）

/** 地下骨块"脊柱 + 肋骨"，中心一块煤矿（原版的化石确实会裹煤） */
function buildFossil(w: FeatureWriter, s: StructureInstance): void {
  const rng = s.rng;
  const y = s.y;
  const alongX = rng.chance(0.5);
  for (let i = 0; i < 5; i++) {
    const x = s.x + (alongX ? i - 2 : 0);
    const z = s.z + (alongX ? 0 : i - 2);
    w.fill(x, y, z, Block.BONE_BLOCK);
    if (i % 2 === 1) {
      // 肋骨：脊柱两侧各立一根 2 格高的骨块
      for (const side of [-1, 1] as const) {
        w.fill(alongX ? x : x + side, y, alongX ? z + side : z, Block.BONE_BLOCK);
        w.fill(alongX ? x : x + side, y + 1, alongX ? z + side : z, Block.BONE_BLOCK);
      }
    }
  }
  w.fill(s.x, y + 1, s.z, Block.COAL_ORE);
}

// ---------------------------------------------------------------- 紫晶洞（批次 351）

/** 三层球壳：平滑玄武岩 → 方解石 → 紫水晶块；中心芽床，六个方向各一簇 */
function buildAmethystGeode(w: FeatureWriter, s: StructureInstance): void {
  const cy = s.y;
  const sphere = (radius: number, id: number): void => {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy + dz * dz <= radius * radius) w.fill(s.x + dx, cy + dy, s.z + dz, id);
        }
      }
    }
  };
  sphere(7, Block.SMOOTH_BASALT);
  sphere(5, Block.CALCITE);
  sphere(4, Block.AMETHYST_BLOCK);
  w.fill(s.x, cy, s.z, Block.BUDDING_AMETHYST);
  for (const [dx, dy, dz] of [
    [3, 0, 0],
    [-3, 0, 0],
    [0, 3, 0],
    [0, -3, 0],
    [0, 0, 3],
    [0, 0, -3],
  ] as const) {
    w.fill(s.x + dx, cy + dy, s.z + dz, Block.AMETHYST_CLUSTER);
  }
}

// ---------------------------------------------------------------- 建造器表

const BUILDERS: Record<StructureKind, (w: FeatureWriter, s: StructureInstance, world: FeatureWorld, seed: number) => void> = {
  village: buildVillage,
  mineshaft: buildMineshaft,
  stronghold: (w, s) => buildStronghold(w, s),
  dungeon: (w, s) => buildDungeon(w, s),
  shipwreck: (w, s) => buildShipwreck(w, s),
  ocean_monument: (w, s, world, seed) => buildOceanMonument(w, s, world, seed),
  woodland_mansion: (w, s, world) => buildWoodlandMansion(w, s, world),
  desert_pyramid: (w, s) => buildDesertPyramid(w, s),
  jungle_temple: (w, s) => buildJungleTemple(w, s),
  witch_hut: (w, s) => buildWitchHut(w, s),
  pillager_outpost: (w, s) => buildPillagerOutpost(w, s),
  ruined_portal: (w, s) => buildRuinedPortal(w, s),
  buried_treasure: (w, s) => buildBuriedTreasure(w, s),
  igloo: (w, s) => buildIgloo(w, s),
  ocean_ruins: (w, s) => buildOceanRuins(w, s),
  fossil: (w, s) => buildFossil(w, s),
  amethyst_geode: (w, s) => buildAmethystGeode(w, s),
  desert_well: (w, s) => buildDesertWell(w, s),
};

/** 结构种类清单（测试用） */
export const STRUCTURE_KINDS: readonly StructureKind[] = STRUCTURE_DEFS.map((def) => def.kind);

/** 某个结构的包围盒半径（测试用：判断跨区块是否需要更大邻域） */
export const STRUCTURE_RADIUS: Readonly<Record<string, number>> = Object.fromEntries(
  STRUCTURE_DEFS.map((def) => [def.kind, def.radius]),
);

