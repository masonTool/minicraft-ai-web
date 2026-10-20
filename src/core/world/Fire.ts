/**
 * 火方块与燃烧蔓延（I12）
 *
 * 原版火焰有三件事：**烧**（把可燃方块变成火）、**灭**（没有燃料/被水浇/被雨淋）、
 * **伤人**（站在火里会被点燃，之后持续掉血）。这里把它们做成纯逻辑，
 * 世界只通过 `TickWorld`（读/写方块 + 随机源）接触，因此能离线断言。
 *
 * 对齐原版的地方：
 *  - 燃料是**3×3×3 邻域**里的可燃方块；没有燃料火焰会自己熄灭（原版靠 age 递增 + 无燃料）
 *  - 蔓延方向在 3×3×3 里随机挑一个；可燃方块被**替换成火**（原版就是"烧掉"而不是"点燃新的方块"）
 *  - 往下优先的"火不会悬空"由"必须挨着燃料"隐含保证
 *  - **水（含流动的水）贴着火焰就浇灭**；下雨时**露天的**（天光 15）火焰会被浇灭
 *  - 站在火里的实体被点燃 8 秒（原版 `setSecondsOnFire(8)`）
 *
 * 与原版的差异（写进 TASKS 的 I12）：
 *  - 火焰没有 age / 没有 4 个朝向的模型，统一用植物的 `cross` 形状与一张贴图
 *  - 蔓延是按随机刻的概率推进，不是原版按 age 分档的节奏
 *  - 不烧"自己脚下的支撑方块"（否则火焰会一路浮在空中）
 */

import {
  Block,
  SHAPED_PARENTS,
  SIGN_IDS,
  Wood,
  WoodShaped,
  blockDef,
  carpetId,
  slabId,
  stairsId,
  woolId,
} from '../registry/blocks.ts';
import { isLitState } from '../registry/blockState.ts';
import { DYE_COLORS } from '../registry/colors.ts';
import type { RandomSource, RandomTickBehavior, TickWorld } from '../tick/RandomTicks.ts';

export const FIRE = Block.FIRE;

/** 站在火里被点燃的秒数（原版 8 秒） */
export const FIRE_IGNITE_SECONDS = 8;
/** 着火伤害：每 20 tick（1 秒）1 点，无视无敌帧（对齐原版） */
export const FIRE_DAMAGE = 1;
export const FIRE_DAMAGE_INTERVAL_TICKS = 20;

/**
 * 站在**点着的营火**上被点燃的秒数（原版 5 秒，比火方块短）。
 *
 * 营火不是"火焰方块"（它是一块 7/16 高的柴堆，能站上去做烟熏架），
 * 但它同样会点燃踩上去的实体。这里只把"会不会点着"这条判定做成纯函数，
 * 伤害交给既有的着火机制（`PlayerStats.ignite` / `Mob.ignite`）——
 * 不新开一套伤害，也就自然继承了"水能灭火、抗火免疫、雨能浇灭"这些既有规则。
 */
export const CAMPFIRE_IGNITE_SECONDS = 5;

/**
 * 这一格会不会点燃**贴着它**的实体（脚或身体所在格）。
 *
 * 三种：火焰、岩浆、**点着的营火**（熄灭的不算）。
 * 判据按"方块 + 状态"而不是只按 id：营火点着与熄灭是同一个方块的两种状态。
 */
export function burnsOnContact(blockId: number, state: number): boolean {
  if (blockId === Block.FIRE || blockId === Block.LAVA) return true;
  return blockId === Block.CAMPFIRE && isLitState(state);
}

/** 随机刻命中后蔓延出去的概率（未命中就只是"烧着不动"） */
export const FIRE_SPREAD_CHANCE = 0.25;
/** 挑中可燃方块时真的把它烧掉的概率（原版火焰每 20 tick 才烧一格，这里加快以便观察） */
export const FIRE_CONSUME_CHANCE = 0.6;

// ---------------------------------------------------------------- 可燃方块

/**
 * 可燃方块表。
 *
 * 原版是给每个方块打 `#flammable` 标签（木头类 5、树叶 30、羊毛 60…还有"燃烧概率"的差别）。
 * 这里只需要"能不能烧"，所以按**方块族**批量登记：木头家族走 `Wood` 表、
 * 16 色羊毛走 `DYE_COLORS`、植物按形状（`cross`）判定。
 *
 * ⚠️ 橡木是"基础方块"（id 5/6/7 与台阶楼梯 80/84），不在 `Wood` 表里，必须单独补——
 * 这个坑项目里踩过一次（"砍云杉有加速、砍橡木没有"）。
 */
const FLAMMABLE = new Set<number>([
  // ---- 橡木家族（基础方块，不在 Wood 表里）
  Block.OAK_LOG,
  Block.OAK_LEAVES,
  Block.OAK_PLANKS,
  Block.OAK_FENCE,
  Block.OAK_DOOR,
  Block.OAK_TRAPDOOR,
  Block.OAK_FENCE_GATE,
  Block.LADDER,
  Block.CRAFTING_TABLE,
  Block.CHEST,
  Block.BOOKSHELF,
  // ---- 植物（除了菌类与下界植物，原版也都易燃）
  Block.SHORT_GRASS,
  Block.FERN,
  Block.DANDELION,
  Block.POPPY,
  Block.BLUE_ORCHID,
  Block.OXEYE_DAISY,
  Block.CORNFLOWER,
  Block.RED_MUSHROOM,
  Block.BROWN_MUSHROOM,
  Block.SUGAR_CANE,
  Block.DEAD_BUSH,
  Block.BAMBOO,
  // ---- 下界木质（原版同样易燃）
  Block.CRIMSON_STEM,
  Block.WARPED_STEM,
  Block.CRIMSON_PLANKS,
  Block.WARPED_PLANKS,
  Block.NETHER_WART_BLOCK,
  Block.WARPED_WART_BLOCK,
]);

// 16 色羊毛（原版燃烧速度最快的一类）与 16 色地毯（同一族的薄片，原版也一样易燃）
for (let i = 0; i < DYE_COLORS.length; i++) {
  FLAMMABLE.add(woolId(i));
  FLAMMABLE.add(carpetId(i));
}

// 藤蔓（B11）：原版会烧，而且容易把火带到树冠上
FLAMMABLE.add(Block.VINE);

// 干海带块（批次 50）：原版是可燃的（不然"当燃料"这件事就说不通）
// —— 可燃与"能当燃料"在游戏里是两回事，但这里两样都登记才自洽
FLAMMABLE.add(Block.DRIED_KELP_BLOCK);

// 脚手架（批次 53）：竹子 + 线做的，原版一点就着
FLAMMABLE.add(Block.SCAFFOLDING);

// 告示牌（批次 80）：木板做的，原版可燃。
// ⚠️ 烧掉的那一格**不会**在这一处顺手清掉牌子上的字（火是随机刻里的 `setBlock`，
// 拿不到文字表）；清理由主程序那趟"对账"负责——发现那一格已经不是牌子了就丢掉文字
// （见 `main.ts` 的 `syncSigns`，爆炸/活塞/指令改方块也一并覆盖）
for (const id of SIGN_IDS) FLAMMABLE.add(id);

// 其余 5 种木材：原木 / 木板 / 树叶 / 台阶 / 楼梯
for (const ids of Object.values(Wood)) {
  FLAMMABLE.add(ids.log);
  FLAMMABLE.add(ids.planks);
  FLAMMABLE.add(ids.leaves);
  FLAMMABLE.add(ids.slab);
  FLAMMABLE.add(ids.stairs);
}
// 木制方块族（批次 38）：每种木材的栅栏 / 栅栏门 / 门 / 活板门都可燃
// —— 逐个木材补会漏掉"同一族的其它木材"（橡木那次就是这么漏的），所以整族一起登记
for (const ids of Object.values(WoodShaped)) {
  FLAMMABLE.add(ids.fence);
  FLAMMABLE.add(ids.fenceGate);
  FLAMMABLE.add(ids.door);
  FLAMMABLE.add(ids.trapdoor);
}
// 橡木的台阶与楼梯：母方块是橡木木板（id 7），但它们的 id 是由 SHAPED_PARENTS 生成的，
// 所以从 `slabId`/`stairsId` 反查而不是硬编码 80/84
for (let index = 0; index < SHAPED_PARENTS.length; index++) {
  if (SHAPED_PARENTS[index]![0] !== Block.OAK_PLANKS) continue;
  FLAMMABLE.add(slabId(index));
  FLAMMABLE.add(stairsId(index));
}

/** 这个方块能不能被火点着 */
export function isFlammable(blockId: number): boolean {
  return FLAMMABLE.has(blockId);
}

/** 可燃方块总数（断言与界面用） */
export function flammableCount(): number {
  return FLAMMABLE.size;
}

// ---------------------------------------------------------------- 生存判定

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** 3×3×3 邻域里有没有燃料（火焰的"生存判据"，与原版 `isBlockFuel` 同义） */
export function hasFuelAround(world: TickWorld, x: number, y: number, z: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        if (isFlammable(world.getBlock(x + dx, y + dy, z + dz))) return true;
      }
    }
  }
  return false;
}

/** 这一格的下方是不是"能立得住火"的实心顶面 */
export function isSolidTop(world: TickWorld, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  if (id === Block.AIR) return false;
  const def = blockDef(id);
  return def.solid && def.shape === 'cube';
}

/** 旁边有没有水（火焰贴着水会被浇灭） */
export function isTouchingWater(world: TickWorld, x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of NEIGHBOURS) {
    if (world.getBlock(x + dx, y + dy, z + dz) === Block.WATER) return true;
  }
  return false;
}

/**
 * 这一格能不能放火（打火石的判定，对齐原版 `FireBlock#getStateForPlacement` 的两条活路）：
 *  1. 下面是实心顶面（在石头/木板上点火）
 *  2. 附近有可燃方块（在一堆木头中间点火，下方是空气也能着）
 */
export function canPlaceFire(world: TickWorld, x: number, y: number, z: number): boolean {
  if (world.getBlock(x, y, z) !== Block.AIR) return false;
  if (isSolidTop(world, x, y - 1, z)) return true;
  return hasFuelAround(world, x, y, z);
}

// ---------------------------------------------------------------- 随机刻

/**
 * 火焰的随机刻行为。
 * @returns 是否改动了世界
 */
/**
 * 火是否被随机刻处理（`/gamerule doFireTick`，批次 433）。
 *
 * 为什么用模块级状态：随机刻的行为表是**按方块 id 查函数**（`[Block.FIRE, fireBehavior]`），
 * 那条查表路径没有"选项"参数可传。要给它开口子得改 `RandomTicks` 的整张表签名，
 * 而这里要的只是一个全局开关——与 `I18n` 的当前语言是同一类取舍，
 * 代价同样是"改它不会自动通知谁"，所以主程序在**设置/规则变化时显式调一次**。
 */
let fireTickEnabled = true;

export function setFireTickEnabled(enabled: boolean): void {
  fireTickEnabled = enabled;
}

export const fireBehavior: RandomTickBehavior = (
  world: TickWorld,
  x: number,
  y: number,
  z: number,
  random: RandomSource,
): boolean => {
  // 规则关掉时**完全不处理**：不蔓延、不烧方块、不熄灭（已经点着的火留着）
  if (!fireTickEnabled) return false;
  // ---- 1) 下雨 + 露天 → 浇灭（原版：雨把露天的火浇灭）
  if (world.raining && (world.skyLightAt?.(x, y, z) ?? 0) >= 15) {
    return world.setBlock(x, y, z, Block.AIR);
  }

  // ---- 2) 旁边是水 → 浇灭（流动的水也算，水一过来火就该灭）
  if (isTouchingWater(world, x, y, z)) {
    return world.setBlock(x, y, z, Block.AIR);
  }

  // ---- 3) 没有燃料 → 自己熄灭（原版靠 age 走到头，这里用"没得烧了"等价表达）
  if (!hasFuelAround(world, x, y, z)) {
    return world.setBlock(x, y, z, Block.AIR);
  }

  // ---- 4) 蔓延：随机挑一个 3×3×3 的位置
  if (random() >= FIRE_SPREAD_CHANCE) return false;

  const dx = Math.floor(random() * 3) - 1;
  const dy = Math.floor(random() * 3) - 1;
  const dz = Math.floor(random() * 3) - 1;
  // 不烧自己脚下的支撑方块：原版也不会把火坐着的那一格烧掉，
  // 否则火焰会一格一格往上"漂浮"，看起来完全不像火
  if (dx === 0 && dy === -1 && dz === 0) return false;

  const tx = x + dx;
  const ty = y + dy;
  const tz = z + dz;
  const target = world.getBlock(tx, ty, tz);

  if (isFlammable(target)) {
    // 烧掉燃料：原地变成火（原版火焰就是这样"吃"过去的）
    if (random() >= FIRE_CONSUME_CHANCE) return false;
    return world.setBlock(tx, ty, tz, FIRE);
  }

  // 空气格：只有"挨着燃料"或"下方是实心顶面"才能点着
  if (target === Block.AIR && canPlaceFire(world, tx, ty, tz)) {
    return world.setBlock(tx, ty, tz, FIRE);
  }

  return false;
};

/**
 * 打火石点火：在命中面的外侧放一格火。
 * 判定失败（没有立足点、已经有方块）返回 false，调用方据此**不消耗耐久**。
 */
export function igniteAt(world: TickWorld, x: number, y: number, z: number): boolean {
  if (!canPlaceFire(world, x, y, z)) return false;
  return world.setBlock(x, y, z, FIRE);
}
