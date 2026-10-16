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

import {
  BERRY_STAGES,
  Block,
  COCOA_STAGES,
  CORAL_DEAD_VARIANT,
  CORAL_LIVE_VARIANT,
  CROP_STAGES,
  JUNGLE_LOG_ID,
  KELP_MAX_HEIGHT,
  berryStageOf,
  blockDef,
  cocoaStageOf,
  cropOf,
  isLiveCoral,
  Wood,
} from '../registry/blocks.ts';
import { Item } from '../registry/items.ts';
import {
  FACING_OFFSET,
  MAX_SNOW_LAYERS,
  facingOf,
  snowLayers,
  withSnowLayers,
  withVineSide,
  withVineUp,
  vineSides,
  type Facing,
} from '../registry/blockState.ts';
import { fireBehavior } from '../world/Fire.ts';
import { COPPER_IDS, copperWeatherBehavior } from '../world/Copper.ts';

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
   * 该点的**方块光**（0~15）。
   * 雪层融化只看方块光（原版 `getBrightness(BLOCK, pos) > 11`）——
   * 白天的天光 15 **不会**把雪晒化，所以不能复用 `lightAt`（它是天光与方块光的较大者）。
   */
  blockLightAt?: (x: number, y: number, z: number) => number;
  /**
   * 该点是否正在**下雪**（下雨 + 该列是寒冷群系）。
   * 原版是"雨天在寒冷群系按列下雪"，所以判据是**按位置**的，
   * 一个全局的 `raining` 不够用（雨地里不该积雪）。
   */
  snowingAt?: (x: number, y: number, z: number) => boolean;
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

/**
 * 甜浆果丛（批次 49）：随机刻往前长一阶段。
 *
 * 与小麦/甜菜那套 `growCrop` 的三点差别：**不要求下面是耕地**（原版长在草与泥土上）、
 * **不要求"成熟"之外的东西**、**光照要求相同**（太暗不长，这一条与作物一致）。
 */
function berryBehavior(world: TickWorld, x: number, y: number, z: number, random: RandomSource): boolean {
  const stage = berryStageOf(world.getBlock(x, y, z));
  if (stage < 0 || stage >= BERRY_STAGES.length - 1) return false;
  if (!isSolidGround(world.getBlock(x, y - 1, z))) return false;
  if ((world.lightAt?.(x, y, z) ?? 15) < CROP_MIN_LIGHT) return false;
  if (random() >= BERRY_GROW_CHANCE) return false;
  return world.setBlock(x, y, z, BERRY_STAGES[stage + 1]!);
}

/**
 * 可可豆（批次 49）：随机刻往前长一阶段。
 *
 * ⚠️ 换阶段是换**方块 id**，而朝向存在状态里——所以必须把原状态一起带过去
 * （`setBlockWithState`）。要是走普通的 `setBlock`，豆荚会在长大的一瞬间
 * **转到北面**（状态被清零），看起来像"长着长着掉了个头"。
 *
 * 另外要求"还贴着丛林原木"：原版被拆掉原木后豆荚会自己掉下来，
 * 这里简化为"不再生长"（掉落实现在 `blockDrops` 之外，见 TASKS 里记的差异）。
 */
function cocoaBehavior(world: TickWorld, x: number, y: number, z: number, random: RandomSource): boolean {
  const stage = cocoaStageOf(world.getBlock(x, y, z));
  if (stage < 0 || stage >= COCOA_STAGES.length - 1) return false;

  const state = world.getState?.(x, y, z) ?? 0;
  const offset = FACING_OFFSET[facingOf(state)]!;
  if (world.getBlock(x + offset[0], y, z + offset[1]) !== JUNGLE_LOG_ID) return false;
  if (random() >= COCOA_GROW_CHANCE) return false;

  const next = COCOA_STAGES[stage + 1]!;
  if (world.setBlockWithState) return world.setBlockWithState(x, y, z, next, state);
  return world.setBlock(x, y, z, next);
}

/** 实心地面（甜浆果丛的着床判定：草/泥土/灰化土都属于这一类） */
function isSolidGround(id: number): boolean {
  return id !== Block.AIR && blockDef(id).solid;
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

// ---------------------------------------------------------------- 海带（批次 50）

/**
 * 随机刻命中时"往上长一节"的概率（观感值）。
 * 与甘蔗取同一个量级：原版的真实节奏要等十几分钟，单机验收时看不到它长。
 */
export const KELP_GROW_CHANCE = 0.2;

/**
 * 海带（批次 50）：**只由顶端**往上长，且**离开水就枯萎**。
 *
 * 这一条与甘蔗那套 `makeCaneBehavior` 的三个差别：
 *  1. "上面那一格"要的是**水**（不是空气）——海带长在水里，新的一节占掉的是一格水；
 *  2. 还要再往上看一格：那格也得是水，否则长出去的那一节会**正好顶到水面**，
 *     下一 tick 就因为"上方不是水"而枯死——一长一死来回抖，看着像抽搐。
 *     要求"上方两格都是水"就等于"顶端永远停在水面下 1 格"，与原版一致；
 *  3. **脱水即枯萎**：顶端上方不再是水（水被放干、被方块填掉）→ 整格毁掉并掉 1 个海带。
 *     原版海带离开水就是这么死的；没有这条，堵住的水塘里会留着一株悬空的海带。
 *
 * "我是不是顶端"由**上方那一格是不是自己**现算，而不是存状态位——
 * 与甘蔗同一条判据（原版那是 `kelp` 与 `kelp_plant` 两个方块，这里合成一个 id）。
 */
function kelpBehavior(world: TickWorld, x: number, y: number, z: number, random: RandomSource): boolean {
  const id = world.getBlock(x, y, z);
  const above = world.getBlock(x, y + 1, z);
  // 上面还有一节海带 → 我不是顶端，交给顶端那格处理（否则一节一节同时长会重复）
  if (above === id) return false;

  // 脱水：顶端不在水里 → 枯萎（掉海带，与原版"海带离开水就毁"一致）
  if (above !== Block.WATER) {
    if (!world.setBlock(x, y, z, Block.AIR)) return false;
    world.drop?.(id, 1, x, y, z);
    return true;
  }

  // 顶端上面那一格也得是水：否则长出去立刻枯死（见上面的注解 2）
  if (world.getBlock(x, y + 2, z) !== Block.WATER) return false;

  let height = 1;
  while (height < 64 && world.getBlock(x, y - height, z) === id) height++;
  if (height >= KELP_MAX_HEIGHT) return false;
  if (random() >= KELP_GROW_CHANCE) return false;
  return world.setBlock(x, y + 1, z, id);
}

// ---------------------------------------------------------------- 珊瑚（批次 51）

/**
 * 失活珊瑚"挨着活珊瑚就复活"的概率（原版这条没有公开数值，取一个能看出来、又不刷屏的值）。
 *
 * 复活是本项目里**唯一一条"方块变回另一种 id"的升级路径**（铜的氧化只往前走不回头），
 * 所以它得稀疏一点：不然把一株活珊瑚放在一片失活珊瑚旁边，半分钟就全绿了。
 */
export const CORAL_REVIVE_CHANCE = 0.12;

/** 六个面（活珊瑚判"泡不泡在水里"、失活珊瑚判"挨没挨着活珊瑚"都用它） */
const NEIGHBORS_6: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * 这一格珊瑚还"泡在水里"吗。
 *
 * 两种形状两种判据（原版也是这样）：
 *  - **珊瑚块**（固体）：看**六个面里有没有一格水**——原版珊瑚块贴着水才活着
 *  - **珊瑚丛 / 珊瑚扇**（水里的植物）：看**上面那一格是不是水**——
 *    它们自己就占了那一格水（`waterPlant`），所以"水还在不在"只能看上面那格
 *
 * ⚠️ 由此带来一条与原版的差异：**一格深的浅水**里种下的珊瑚丛/扇会失活
 * （上面是空气），原版则一直活着（它是 waterlogged）。这条与海带是同一条规则的取舍：
 * 我们的水是独立方块，没有"水浸"这一层语义（详见 TASKS B15 的差异记录）。
 */
function coralInWater(world: TickWorld, id: number, x: number, y: number, z: number): boolean {
  if (blockDef(id).waterPlant) return isWaterLike(world.getBlock(x, y + 1, z));
  for (const [dx, dy, dz] of NEIGHBORS_6) {
    if (isWaterLike(world.getBlock(x + dx, y + dy, z + dz))) return true;
  }
  return false;
}

/**
 * 这一格算不算"水"：水本身，**或者长在水里的植物**（`waterPlant`）。
 *
 * ⚠️ 为什么水里的植物要算水：我们的模型里没有"水浸"（waterlogged）这一层语义——
 * 珊瑚丛/海带/海草是**替换掉那一格水**存在的。于是"珊瑚块顶上长了一株珊瑚丛"这种情况，
 * 如果只认 `Block.WATER`，那颗珊瑚块的六个面就一格水都看不到、下一 tick 就发灰了——
 * 而原版里那株珊瑚丛是 waterlogged 的，珊瑚块活得好好的。
 * 把水里的植物当作"水"来认，正是补上这一层语义。
 */
function isWaterLike(id: number): boolean {
  return id === Block.WATER || blockDef(id).waterPlant;
}

/** 六面里有没有活珊瑚（复活的条件之一） */
function hasLiveCoralNeighbor(world: TickWorld, x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of NEIGHBORS_6) {
    if (isLiveCoral(world.getBlock(x + dx, y + dy, z + dz))) return true;
  }
  return false;
}

/**
 * 活珊瑚：**离开水就失活**（原地变成对应的失活版本，不是消失）。
 *
 * 这是 1.13 珊瑚最标志性的一条：把它挖上岸、或者把水放干，珊瑚先变灰、
 * 然后再挖下来的就是失活版本（原版"活珊瑚必须精准采集"那条掉落规则正是为此存在）。
 *
 * 本项目用随机刻结算（原版是方块更新时立刻判）——所以"刚放上岸"的那一下还看不出变化，
 * 要等它自己被抽到；这一条与海带枯萎是同一取舍。
 */
function coralSurviveBehavior(world: TickWorld, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  const dead = CORAL_DEAD_VARIANT.get(id);
  if (dead === undefined) return false;
  if (coralInWater(world, id, x, y, z)) return false;
  return world.setBlock(x, y, z, dead);
}

/** 失活珊瑚：泡在水里 + 六面挨着活珊瑚 → 有机会复活 */
function coralReviveBehavior(world: TickWorld, x: number, y: number, z: number, random: RandomSource): boolean {
  const id = world.getBlock(x, y, z);
  const live = CORAL_LIVE_VARIANT.get(id);
  if (live === undefined) return false;
  if (!hasLiveCoralNeighbor(world, x, y, z)) return false;
  if (!coralInWater(world, id, x, y, z)) return false;
  if (random() >= CORAL_REVIVE_CHANCE) return false;
  return world.setBlock(x, y, z, live);
}

// ---------------------------------------------------------------- 雪层（K11 收尾）

/** 一次随机刻让雪层长高一层的概率（观感值：原版是"每个区块每 tick 抽几个点"的另一套节奏） */
export const SNOW_ACCUMULATE_CHANCE = 0.12;
/** 融化阈值：**方块光**大于它就融化（原版 `> 11`，正好是"火把旁边会化、萤石会化"） */
export const SNOW_MELT_LIGHT = 11;

/**
 * 雪层（K11 收尾）：下雪时越积越高、被方块光烤到时融化。
 *
 * 两条规则都对齐原版语义：
 *  1. **融化**：方块光 > 11 → **减一层**（只剩 1 层就整块消失），并且**掉 1 个雪球**
 *     （原版 `SnowLayerBlock#randomTick` 里是先 `dropResources` 再移除）。
 *     ⚠️ 只看方块光：白天的天光 15 不会把雪晒化——这是"雪在白天不化"的原因。
 *  2. **积雪**：正在下雪（雨天 + 寒冷群系）+ **露天**（天光 15，说明头顶没遮挡）→ 长高一层，
 *     封顶 `MAX_SNOW_LAYERS`（8 层 = 整格）。
 *
 * ⚠️ 与原版的差异（已记进 TASKS）：原版的"新雪"是**区块级降水刻**（`tickChunk` 里随机取点，
 * 空气处直接铺一层），本项目没有那条通道，所以**只有已经存在的雪层会越积越高**；
 * "光秃秃的地面自己长出第一层雪"要等区块级降水刻落地（见 TASKS K11）。
 */
function snowBehavior(world: TickWorld, x: number, y: number, z: number, random: RandomSource): boolean {
  const layers = snowLayers(world.getState?.(x, y, z) ?? 0);

  // 1) 融化（只看方块光）
  const blockLight = world.blockLightAt?.(x, y, z) ?? 0;
  if (blockLight > SNOW_MELT_LIGHT) {
    if (layers <= 1) {
      world.setBlock(x, y, z, Block.AIR);
    } else if (world.setBlockWithState) {
      world.setBlockWithState(x, y, z, Block.SNOW, withSnowLayers(0, layers - 1));
    } else {
      world.setBlock(x, y, z, Block.SNOW);
    }
    // 原版融化会掉雪球（所以"火把边上铲雪"是能收集到雪球的）
    world.drop?.(Item.SNOWBALL, 1, x, y, z);
    return true;
  }

  // 2) 积雪：下雪 + 露天 + 没到满格
  if (layers >= MAX_SNOW_LAYERS) return false;
  if (world.snowingAt?.(x, y, z) !== true) return false;
  if ((world.skyLightAt?.(x, y, z) ?? 0) < 15) return false; // 15 = 头顶直接见天
  if (random() >= SNOW_ACCUMULATE_CHANCE) return false;
  if (world.setBlockWithState) return world.setBlockWithState(x, y, z, Block.SNOW, withSnowLayers(0, layers + 1));
  return world.setBlock(x, y, z, Block.SNOW);
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
  // 铜的氧化（批次 40）：16 个铜方块都要登记——随机刻是按"当前这个 id"查行为的
  ...COPPER_IDS.map((id) => [id, copperWeatherBehavior] as const),
  // 雪层（K11 收尾）：下雪时越积越高、被方块光烤到时融化
  [Block.SNOW, snowBehavior],
  // 甜浆果丛 / 可可豆（批次 49）：随机刻往前长一阶段（4 个 / 3 个 id 都要登记，
  // 只登记第 0 阶段的话长到第 1 阶段就再也不长了——与小麦那条同一个坑）
  ...BERRY_STAGES.map((id) => [id, berryBehavior] as const),
  ...COCOA_STAGES.map((id) => [id, cocoaBehavior] as const),
  // 海带（批次 50）：顶端往上长、离开水枯萎。**海草不登记**——它是不生长的草丛
  [Block.KELP, kelpBehavior],
  // 珊瑚（批次 51）：活珊瑚离开水失活、失活珊瑚挨着活珊瑚复活。
  // ⚠️ 30 个珊瑚方块**全部**要登记（5 种 × 3 形 × 活/失活），且"活"与"失活"是**两个不同行为**——
  // 照 id 手抄 30 行必然漏；这里从 `CORAL_DEAD_VARIANT` 那张映射表展开，
  // 于是"漏掉一种珊瑚"这件事在结构上就不可能发生
  ...[...CORAL_DEAD_VARIANT.keys()].map((id) => [id, coralSurviveBehavior] as const),
  ...[...CORAL_LIVE_VARIANT.keys()].map((id) => [id, coralReviveBehavior] as const),
]);

/** 作物生长需要的最低光照（原版小麦就是 9） */
export const CROP_MIN_LIGHT = 9;

/**
 * 甜浆果丛 / 可可豆每命中一次随机刻就往前长一阶段的概率（批次 49）。
 *
 * 取 0.25 与甘蔗同一个量级：单机验收时"能看见它长"，而不是按原版那种
 * 十几分钟才等到一次的真实节奏（原版靠 stats 与随机刻密度控制，这里调快）。
 */
export const BERRY_GROW_CHANCE = 0.25;
export const COCOA_GROW_CHANCE = 0.25;
/**
 * 随机刻命中时"长一节"的概率。
 *
 * ⚠️ 与原版的差异：原版小麦平均要 20 分钟才熟，单机验收场景下太久，
 * 这里把概率调高（干旱 35%、旁边有水 70%）。**"有水长得快"这条关系保留**——
 * 它才是玩家该感觉到的东西，绝对时长不是。
 */
export const CROP_GROW_CHANCE_DRY = 0.35;
export const CROP_GROW_CHANCE_WET = 0.7;

/**
 * 耕地是否"湿润"（作物长得快）。
 *
 * 两条路（批次 47 补上第二条）：
 *  1. **旁边有水**（下层水平 4 格内有水，原版判定范围就是 4 格）；
 *  2. **正在下雨且这一列露天**——原版 `FarmlandBlock#randomTick` 里
 *     "下雨时湿度不降反升"，效果就是雨天的作物长得快。
 *     ⚠️ 本项目没有耕地湿度那个状态位（浇水与否是靠 `isHydrated` 现算的），
 *     所以"雨打湿耕地"在这里的等价实现就是**把降雨也算进 `isHydrated`**；
 *     没有这一步，"雨打湿耕地"就只是一句空话。
 */
function isHydrated(world: TickWorld, x: number, y: number, z: number): boolean {
  // 露天（天光 15）才算"淋到雨"——屋檐下的耕地不该因为下雨就变湿
  if (world.raining && (world.skyLightAt?.(x, y + 1, z) ?? 0) >= 15) return true;
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
