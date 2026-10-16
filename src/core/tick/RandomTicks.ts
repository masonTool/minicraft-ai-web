/**
 * 随机刻与计划刻（B6 的调度部分）
 *
 * 原版的"世界会自己变化"全靠随机刻：每个 16³ 的 section 每 tick 抽 `randomTickSpeed` 个
 * 位置，命中的方块执行自己的随机刻行为（草蔓延、树叶消失、甘蔗长高、菌岩蔓延…）。
 *
 * 这里把它做成**不依赖具体世界实现**的纯逻辑：
 *  - `TickWorld` 只要求 `getBlock` / `setBlock`（外加可选的掉落回调），因此能离线测
 *  - 随机源是一个 `() => number`（0~1），测试里可以塞确定性序列
 *  - section 的选取用区块自带的 `sectionCounts`（每段非空气方块数）跳过空段，
 *    否则 384 格高的世界里随机点几乎全落在空气上，草永远蔓延不起来
 *
 * 计划刻（`TickScheduler`）是给流体这类"延迟若干个 tick 再处理"的方块准备的：
 * 同一位置重复计划只保留最早的一次（与原版一致）。
 */

import { Block, CROP_STAGES, blockDef, cropOf, Wood } from '../registry/blocks.ts';
import { Item } from '../registry/items.ts';
import { FACING_OFFSET, withVineSide, withVineUp, vineSides, type Facing } from '../registry/blockState.ts';
import { fireBehavior } from '../world/Fire.ts';

/** 随机刻看到的世界 */
export interface TickWorld {
  getBlock(worldX: number, worldY: number, worldZ: number): number;
  setBlock(worldX: number, worldY: number, worldZ: number, id: number): boolean;
  /** 掉落物回调（树叶消失掉木棍之类）；不传就什么都不掉 */
  drop?: (itemId: number, count: number, x: number, y: number, z: number) => void;
  /**
   * 该点的光照等级（0~15，取天光与方块光的较大者）。
   * 作物生长要用它；**不传就当全亮**——这样离线测试不必为了"能不能长"搭一套光照。
   */
  lightAt?: (x: number, y: number, z: number) => number;
  /**
   * 该点的**天光**等级（0~15）。
   * 火焰被雨浇灭要判"露不露天"——方块光在这里没用（火自己就发 15 级方块光），
   * 所以不能复用 `lightAt`。不传当 0（室内）。
   */
  skyLightAt?: (x: number, y: number, z: number) => number;
  /** 是否正在下雨（雨天露天的火焰会被浇灭）；不传当不下雨 */
  raining?: boolean;
  /**
   * 读方块状态（藤蔓要读"挂了哪几面"）。
   * 与其它可选成员同一套路：不传当 0，离线测试不必搭一套状态数组。
   */
  getState?: (x: number, y: number, z: number) => number;
  /** 写方块**并带上状态**（藤蔓蔓延要把挂面写进去）；不传时退化成 `setBlock` */
  setBlockWithState?: (x: number, y: number, z: number, id: number, state: number) => boolean;
}

export interface TickChunkView {
  /** 区块原点的世界坐标 */
  originX: number;
  originZ: number;
  /** 每个 16 高 section 的非空气方块数（长度 24） */
  sectionCounts: Int32Array;
}

/** 随机源：返回 [0,1) */
export type RandomSource = () => number;

/** 每种方块的随机刻行为；返回是否改动了世界 */
export type RandomTickBehavior = (
  world: TickWorld,
  x: number,
  y: number,
  z: number,
  random: RandomSource,
) => boolean;

/** 从木材表里取出其余 5 种树（橡木除外）的树叶与原木 id */
const WOOD_LEAVES: number[] = Object.values(Wood).map((wood) => wood.leaves);
const WOOD_LOGS: number[] = Object.values(Wood).map((wood) => wood.log);

/**
 * 树叶与原木的 id 集合（6 种树）。
 * 橡木有常量，其余 5 种木头是从木材表批量生成的（`Wood.xxx.leaves`），
 * 所以这里必须走表，不能写 `Block.SPRUCE_LEAVES` 这种常量。
 */
const LEAF_IDS: readonly number[] = [Block.OAK_LEAVES, ...WOOD_LEAVES];
const LEAF_SET = new Set(LEAF_IDS);
const LOG_SET = new Set<number>([Block.OAK_LOG, ...WOOD_LOGS]);

/** 树叶检查原木的搜索半径（原版是 4 格，跨区块也要找） */
const LEAF_DECAY_DISTANCE = 4;


/** 草能够蔓延的范围（原版是随机挑 3 个方向各试一次） */
const GRASS_SPREAD_TRIES = 3;
/** 甘蔗 / 竹子的高度上限 */
const CANE_MAX_HEIGHT = 3;
const BAMBOO_MAX_HEIGHT = 12;

function isOpaque(id: number): boolean {
  return id !== Block.AIR && blockDef(id).opaque;
}

/** 草方块：被不透明方块压住会退化；否则往附近的泥土蔓延 */
const grassBehavior: RandomTickBehavior = (world, x, y, z, random) => {
  if (isOpaque(world.getBlock(x, y + 1, z))) {
    // 被埋住 → 变回泥土（原版：草方块上方被不透明方块覆盖后会死亡）
    return world.setBlock(x, y, z, Block.DIRT);
  }

  let changed = false;
  for (let attempt = 0; attempt < GRASS_SPREAD_TRIES; attempt++) {
    // 在 3×3×3 邻域里找泥土，且泥土上方要能透光
    const dx = Math.floor(random() * 3) - 1;
    const dy = Math.floor(random() * 3) - 1;
    const dz = Math.floor(random() * 3) - 1;
    const tx = x + dx;
    const ty = y + dy;
    const tz = z + dz;
    if (world.getBlock(tx, ty, tz) !== Block.DIRT) continue;
    if (isOpaque(world.getBlock(tx, ty + 1, tz))) continue;
    if (world.setBlock(tx, ty, tz, Block.GRASS_BLOCK)) changed = true;
  }
  return changed;
};

/** 树叶：附近没有原木就消失（掉一根木棍） */
const leavesBehavior: RandomTickBehavior = (world, x, y, z, random) => {
  if (findNearbyLog(world, x, y, z)) return false;
  if (!world.setBlock(x, y, z, Block.AIR)) return false;
  // 原版树叶消失有 5% 掉树苗、2% 掉木棍；我们没有树苗物品，只掉木棍
  if (world.drop && random() < 0.05) world.drop(Item.STICK, 1, x + 0.5, y + 0.5, z + 0.5);
  return true;
};

/** 从树叶出发找原木：逐格扩散（限制在 4 格内，且只能穿过树叶/空气） */
function findNearbyLog(world: TickWorld, x: number, y: number, z: number): boolean {
  const visited = new Set<string>();
  const queue: Array<[number, number, number, number]> = [[x, y, z, 0]];
  visited.add(`${x},${y},${z}`);

  while (queue.length > 0) {
    const [cx, cy, cz, depth] = queue.shift()!;
    if (depth >= LEAF_DECAY_DISTANCE) continue;

    for (const [dx, dy, dz] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      const key = `${nx},${ny},${nz}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const id = world.getBlock(nx, ny, nz);
      if (LOG_SET.has(id)) return true;
      // 只在树叶里继续扩散（空气、泥土等会把"连接"断开）
      if (LEAF_SET.has(id)) queue.push([nx, ny, nz, depth + 1]);
    }
  }
  return false;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * 柱状植物：只由**顶端那一格**负责长高（下面几格不动），
 * 这样不会出现"一节一节同时长"导致的重复。
 * 甘蔗还要求旁边有水（原版如此），竹子不要求。
 */
function makeCaneBehavior(needsWater: boolean, maxHeight: number): RandomTickBehavior {
  return (world, x, y, z, random) => {
    const id = world.getBlock(x, y, z);
    if (world.getBlock(x, y + 1, z) !== Block.AIR) return false;
    // 下面还是同种方块 → 我不是顶端，交给顶端那格处理
    if (world.getBlock(x, y - 1, z) === id) return false;

    let height = 1;
    while (height < 32 && world.getBlock(x, y - height, z) === id) height++;
    if (height >= maxHeight) return false;
    if (needsWater && !hasAdjacentWater(world, x, y, z)) return false;
    // 原版甘蔗每 tick 生长概率与随机刻绑定，这里用 1/4 让它"看得见地长"
    if (random() > 0.25) return false;
    return world.setBlock(x, y + 1, z, id);
  };
}

function hasAdjacentWater(world: TickWorld, x: number, y: number, z: number): boolean {
  return (
    world.getBlock(x + 1, y, z) === Block.WATER ||
    world.getBlock(x - 1, y, z) === Block.WATER ||
    world.getBlock(x, y, z + 1) === Block.WATER ||
    world.getBlock(x, y, z - 1) === Block.WATER
  );
}

/** 菌岩：往旁边的下界岩蔓延（下界才有的东西，靠方块 id 自己判断） */
function makeNyliumBehavior(nylium: number): RandomTickBehavior {
  return (world, x, y, z, random) => {
    if (isOpaque(world.getBlock(x, y + 1, z))) return false;
    let changed = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const tx = x + Math.floor(random() * 3) - 1;
      const ty = y + Math.floor(random() * 3) - 1;
      const tz = z + Math.floor(random() * 3) - 1;
      if (world.getBlock(tx, ty, tz) !== Block.NETHERRACK) continue;
      if (isOpaque(world.getBlock(tx, ty + 1, tz))) continue;
      if (world.setBlock(tx, ty, tz, nylium)) changed = true;
    }
    return changed;
  };
}

// ---------------------------------------------------------------- 藤蔓（B11）

/** 随机刻命中时"往下长一节"的概率（观感调出来的，不是原版数值） */
export const VINE_GROW_DOWN_CHANCE = 0.35;
/** 随机刻命中时"往旁边蔓延"的概率（比往下长更少见，否则一面墙会长满） */
export const VINE_SPREAD_CHANCE = 0.12;

/** 该格在 `side` 方向上有没有可攀附的面（实心方块，或已经长着的藤蔓） */
function isVineSupport(world: TickWorld, x: number, y: number, z: number, side: Facing): boolean {
  const [dx, dz] = FACING_OFFSET[side]!;
  const neighbor = world.getBlock(x + dx, y, z + dz);
  return blockDef(neighbor).solid || neighbor === Block.VINE;
}

/** 写一根带挂面的藤蔓（`setBlockWithState` 不可用时退化成普通写入） */
function writeVine(world: TickWorld, x: number, y: number, z: number, state: number): boolean {
  if (world.setBlockWithState) return world.setBlockWithState(x, y, z, Block.VINE, state);
  return world.setBlock(x, y, z, Block.VINE);
}

/**
 * 藤蔓（B11）：随机刻里做两件事——**往下长**与**往旁边蔓延**。
 *
 * 原版 `VineBlock#randomTick` 会朝 6 个方向找"能挂的地方"（还带朝向偏好），
 * 这里取玩家最容易感知的两条：
 *  1. **往下长**：下方是空气，且下方那一格在某个挂面方向上仍有墙 →
 *     在下面接一节（沿用那一面）。天花板上的藤蔓则直接往下垂（`UP` 位）。
 *  2. **往旁边蔓延**：随机挑一个水平方向，那一格是空气、且再往外一格是实心 →
 *     挂到那面墙上（挂面是**反方向**：新藤蔓贴在原方块那一侧）。
 *
 * ⚠️ 与原版的差异（已记进 TASKS）：**支撑被拆掉之后藤蔓不会自己消失**——
 * 那需要"方块变动时通知邻居"这条通道，本项目目前只有红石负载有这种回调。
 */
function vineBehavior(world: TickWorld, x: number, y: number, z: number, random: RandomSource): boolean {
  const state = world.getState?.(x, y, z) ?? 0;
  const sides = vineSides(state);
  const up = (state & 0b10000) !== 0;
  // 悬空的藤蔓（一个挂面都没有的脏数据）不蔓延：它下一趟就该被清理掉
  if (sides.length === 0 && !up) return false;

  // 1) 往下长
  if (random() < VINE_GROW_DOWN_CHANCE && world.getBlock(x, y - 1, z) === Block.AIR) {
    if (up) return writeVine(world, x, y - 1, z, withVineUp(0, true));
    for (const side of sides) {
      if (!isVineSupport(world, x, y - 1, z, side)) continue;
      return writeVine(world, x, y - 1, z, withVineSide(0, side));
    }
  }

  // 2) 往旁边蔓延
  if (random() >= VINE_SPREAD_CHANCE) return false;
  const side = ((random() * 4) | 0) as Facing;
  const [dx, dz] = FACING_OFFSET[side]!;
  const nx = x + dx;
  const nz = z + dz;
  if (world.getBlock(nx, y, nz) !== Block.AIR) return false;
  // 新藤蔓挂在**原方块**那一侧 → 挂面是位移的反方向；
  // `isVineSupport` 从新藤蔓那一格往回查，查到的正是原方块本身
  const wallSide = ((side + 2) & 3) as Facing;
  if (!isVineSupport(world, nx, y, nz, wallSide)) return false;
  return writeVine(world, nx, y, nz, withVineSide(0, wallSide));
}

/** 方块 id → 随机刻行为 */
export const RANDOM_TICK_BEHAVIORS = new Map<number, RandomTickBehavior>([
  [Block.GRASS_BLOCK, grassBehavior],
  ...LEAF_IDS.map((id) => [id, leavesBehavior] as const),
  // 小麦的 4 个阶段都要登记：随机刻是按"当前这个 id"查行为的，
  // 只登记第 0 阶段的话，苗长到第 1 阶段就再也不长了
  ...Object.values(CROP_STAGES)
    .flat()
    .map((id) => [id, growCrop] as [number, RandomTickBehavior]),
  [Block.SUGAR_CANE, makeCaneBehavior(true, CANE_MAX_HEIGHT)],
  [Block.BAMBOO, makeCaneBehavior(false, BAMBOO_MAX_HEIGHT)],
  [Block.CRIMSON_NYLIUM, makeNyliumBehavior(Block.CRIMSON_NYLIUM)],
  [Block.WARPED_NYLIUM, makeNyliumBehavior(Block.WARPED_NYLIUM)],
  // 火焰（I12）：蔓延 / 被水与雨浇灭 / 没燃料就熄灭
  [Block.FIRE, fireBehavior],
  // 藤蔓（B11）：往下长 + 往旁边蔓延
  [Block.VINE, vineBehavior],
]);

/** 作物生长需要的最低光照（原版小麦就是 9） */
export const CROP_MIN_LIGHT = 9;
/**
 * 随机刻命中时"长一节"的概率。
 *
 * ⚠️ 与原版的差异：原版小麦平均要 20 分钟才熟，单机验收场景下太久，
 * 这里把概率调高（干旱 35%、旁边有水 70%）。**"有水长得快"这条关系保留**——
 * 它才是玩家该感觉到的东西，绝对时长不是。
 */
export const CROP_GROW_CHANCE_DRY = 0.35;
export const CROP_GROW_CHANCE_WET = 0.7;

/** 耕地是否被水浸润（下层的水平 4 格内有水；原版判定范围就是 4 格） */
function isHydrated(world: TickWorld, x: number, y: number, z: number): boolean {
  for (let dz = -4; dz <= 4; dz++) {
    for (let dx = -4; dx <= 4; dx++) {
      if (world.getBlock(x + dx, y, z + dz) === Block.WATER) return true;
    }
  }
  return false;
}

/**
 * 小麦生长：随机刻命中就往前推一个阶段。
 *
 * 三个条件缺一不可（都对原版）：**下方是耕地**、**光照 ≥ 9**、随机数命中。
 * 已经成熟的停在最后一个阶段，不会"长过头"变成别的方块。
 */
function growCrop(world: TickWorld, x: number, y: number, z: number, random: RandomSource): boolean {
  const id = world.getBlock(x, y, z);
  const crop = cropOf(id);
  if (!crop || crop.ripe) return false;
  if (world.getBlock(x, y - 1, z) !== Block.FARMLAND) return false;
  if ((world.lightAt?.(x, y, z) ?? 15) < CROP_MIN_LIGHT) return false;

  const chance = isHydrated(world, x, y - 1, z) ? CROP_GROW_CHANCE_WET : CROP_GROW_CHANCE_DRY;
  if (random() >= chance) return false;

  const stages = CROP_STAGES[crop.crop]!;
  world.setBlock(x, y, z, stages[crop.stage + 1]!);
  return true;
}

/** 这个方块是否会在随机刻里做事（用来估算开销） */
export function hasRandomTick(id: number): boolean {
  return RANDOM_TICK_BEHAVIORS.has(id);
}

/**
 * 对单个方块执行随机刻。
 * @returns 是否改动了世界
 */
export function randomTickBlock(
  world: TickWorld,
  x: number,
  y: number,
  z: number,
  random: RandomSource,
): boolean {
  const behavior = RANDOM_TICK_BEHAVIORS.get(world.getBlock(x, y, z));
  if (!behavior) return false;
  return behavior(world, x, y, z, random);
}

/**
 * 对一个区块执行 `count` 次随机刻。
 *
 * 位置采样：先在所有**非空 section** 里随机挑一段，再在段内随机挑一格——
 * 直接在整个 384 格高度里随机的话，命中率低到草方块几乎不会蔓延。
 *
 * @returns 真正改动了世界的次数
 */
export function randomTickChunk(
  world: TickWorld,
  chunk: TickChunkView,
  count: number,
  random: RandomSource,
): number {
  if (count <= 0) return 0;

  const sections: number[] = [];
  for (let section = 0; section < chunk.sectionCounts.length; section++) {
    if (chunk.sectionCounts[section]! > 0) sections.push(section);
  }
  if (sections.length === 0) return 0;

  let applied = 0;
  for (let i = 0; i < count; i++) {
    const section = sections[Math.floor(random() * sections.length)]!;
    const x = chunk.originX + Math.floor(random() * 16);
    const z = chunk.originZ + Math.floor(random() * 16);
    const y = section * 16 - 64 + Math.floor(random() * 16);
    if (randomTickBlock(world, x, y, z, random)) applied++;
  }
  return applied;
}

// ---------------------------------------------------------------- 计划刻

export interface ScheduledTick {
  x: number;
  y: number;
  z: number;
  dimension: string;
}

/**
 * 计划刻队列。
 *
 * 语义对齐原版：
 *  - 同一位置的多次计划只保留**最早**的一次（否则流动的水会把自己刷爆）
 *  - `advance()` 每 tick 调用一次，返回本 tick 到期的位置
 *  - 容量上限保护：超出就丢弃新计划（宁可水流慢一点，也不要把主循环拖死）
 */
export class TickScheduler {
  private readonly pending = new Map<string, { due: number; tick: ScheduledTick }>();
  private currentTick = 0;
  /** 队列容量上限 */
  readonly capacity: number;

  constructor(capacity = 4096) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.pending.size;
  }

  get tick(): number {
    return this.currentTick;
  }

  schedule(x: number, y: number, z: number, dimension: string, delayTicks: number): boolean {
    const key = `${dimension}:${x},${y},${z}`;
    const due = this.currentTick + Math.max(1, Math.floor(delayTicks));
    const existing = this.pending.get(key);
    if (existing) {
      if (existing.due <= due) return false;
      existing.due = due;
      return true;
    }
    if (this.pending.size >= this.capacity) return false;
    this.pending.set(key, { due, tick: { x, y, z, dimension } });
    return true;
  }

  /** 是否已计划过这个位置 */
  has(x: number, y: number, z: number, dimension: string): boolean {
    return this.pending.has(`${dimension}:${x},${y},${z}`);
  }

  /** 推进一 tick 并取出到期项 */
  advance(): ScheduledTick[] {
    this.currentTick++;
    const due: ScheduledTick[] = [];
    for (const [key, entry] of this.pending) {
      if (entry.due <= this.currentTick) {
        due.push(entry.tick);
        this.pending.delete(key);
      }
    }
    return due;
  }

  clear(): void {
    this.pending.clear();
    this.currentTick = 0;
  }
}
