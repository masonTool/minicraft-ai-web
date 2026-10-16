/**
 * 信标（K5，批次 117）
 *
 * 原版信标由两件事组成，这一层只管这两件事、不碰界面与渲染：
 *
 *  1. **金字塔底座**：信标下面要摆一座矿物块金字塔（3×3 是第一级、往上每级外扩一圈，
 *     最高 9×9 = 四级），级别决定**有效半径**（20 / 30 / 40 / 50 格）
 *     与主效果的**等级**（1~2 级 = I，3~4 级 = II）；
 *     能做底座的方块是**固定的五种**（铁块 / 金块 / 钻石块 / 绿宝石块 / 下界合金块，
 *     可以混着摆）。
 *  2. **选哪条效果**：主效果五选一（速度 / 急迫 / 抗性提升 / 跳跃提升 / 力量），
 *     三级以上的金字塔还能再要一条**生命恢复**。
 *
 * ⚠️ 与原版的差异（记在 TASKS K5）：
 *  - 原版还要求"底座那一圈上方必须是空气/透明方块"（不然埋在山里的金字塔不算数），
 *    本项目**不查**这一条——它只影响"把金字塔砌在洞里"这种少见摆法；
 *  - 原版四级时次级效果**还能再选一个主效果**（比如"速度 + 急迫"），
 *    本项目把次级收成**只有生命恢复**一档（界面也因此只有一行）；
 *  - 原版的光柱会被**染色玻璃**染成对应颜色，本项目不做（光柱一律白）；
 *  - 原版的信标每 4 秒刷一次效果，这里是**每秒刷一次、时长 3 秒**
 *    （离开范围后还会留 2 秒，与原版"离开后效果还在"手感一致）。
 *
 * 这一层是**纯逻辑**（只认识"读一个方块"这一点能力），所以能离线断言
 * （见 `tools/beacon-test.ts`）。
 */

import { Block } from '../registry/blocks.ts';
import type { EffectId } from '../survival/StatusEffects.ts';

/** 信标看到的世界（只有"读方块"这一件事） */
export interface BeaconWorld {
  getBlock(worldX: number, worldY: number, worldZ: number): number;
}

/** 金字塔最多四级（原版） */
export const BEACON_MAX_LEVEL = 4;
/** 各级的有效半径（格，原版 20 / 30 / 40 / 50）；下标就是等级，0 级不能用 */
export const BEACON_RANGE_BY_LEVEL: readonly number[] = [0, 20, 30, 40, 50];
/**
 * 能做金字塔底座的方块（原版这五种，且**可以混着摆**——一层里铁块金块各一半也算数）。
 * ⚠️ 金/钻石/绿宝石块是这一批才补的（见 `blocks.ts` 的 `MINERAL_AND_BEACON_SPECS`）。
 */
export const BEACON_BASE_BLOCKS: readonly number[] = [
  Block.IRON_BLOCK,
  Block.GOLD_BLOCK,
  Block.DIAMOND_BLOCK,
  Block.EMERALD_BLOCK,
  Block.NETHERITE_BLOCK,
];

export interface BeaconPower {
  readonly key: string;
  readonly label: string;
  readonly effect: EffectId;
}

/**
 * 主效果五选一。**顺序就是方块状态里的下标 1~5**（0 是"还没选"）。
 *
 * ⚠️ 改这个数组的顺序 = 改存档语义：老存档里"记着 2"的信标会换效果。
 * 要加新效果请**追加**（并同步 `blockState.ts` 的位宽注释）。
 */
export const BEACON_POWERS: readonly BeaconPower[] = [
  { key: 'speed', label: '速度', effect: 'speed' },
  { key: 'haste', label: '急迫', effect: 'haste' },
  { key: 'resistance', label: '抗性提升', effect: 'resistance' },
  { key: 'jump_boost', label: '跳跃提升', effect: 'jump_boost' },
  { key: 'strength', label: '力量', effect: 'strength' },
];

/** 次级效果：原版三级以上的金字塔能再要一条**生命恢复** */
export const BEACON_REGEN_POWER: BeaconPower = {
  key: 'regeneration',
  label: '生命恢复',
  effect: 'regeneration',
};
/** 生命恢复需要几级金字塔（原版 3 级起） */
export const BEACON_REGEN_MIN_LEVEL = 3;
/** 效果时长（秒）：每秒刷一次，所以它会一直续着；离开范围后还能留一会儿 */
export const BEACON_EFFECT_SECONDS = 3;

/** 这一层（半径 radius 的正方形，含边）是不是全是矿物块 */
function layerComplete(world: BeaconWorld, x: number, y: number, z: number, radius: number): boolean {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (!BEACON_BASE_BLOCKS.includes(world.getBlock(x + dx, y, z + dz))) return false;
    }
  }
  return true;
}

/**
 * 这座信标现在是几级（0 = 没有底座，不工作）。
 *
 * 从紧贴信标底下那一层往下数：**第 1 级是贴着的 3×3**、第 2 级再外面一圈（5×5）…
 * 某一层不齐就停在上一级（原版也是"缺一层就只算到那一层"）。
 * 最大的四级要读 9+25+49+81 = 164 格——所以调用方**不要每帧算**（主程序每秒一次）。
 */
export function beaconLevel(world: BeaconWorld, x: number, y: number, z: number): number {
  if (world.getBlock(x, y, z) !== Block.BEACON) return 0;
  let level = 0;
  for (let layer = 1; layer <= BEACON_MAX_LEVEL; layer++) {
    if (!layerComplete(world, x, y - layer, z, layer)) break;
    level = layer;
  }
  return level;
}

/** 这一级的有效半径（格）；0 级返回 0 */
export function beaconRange(level: number): number {
  return BEACON_RANGE_BY_LEVEL[Math.max(0, Math.min(BEACON_MAX_LEVEL, level))] ?? 0;
}

/** 主效果的等级（amplifier）：1~2 级给 I（0）、3~4 级给 II（1）——原版如此 */
export function beaconPrimaryAmplifier(level: number): number {
  return level >= 3 ? 1 : 0;
}

export interface BeaconEffectSpec {
  readonly effect: EffectId;
  readonly seconds: number;
  readonly amplifier: number;
}

/**
 * 这座信标现在该挂哪些效果。
 *
 * @param primaryIndex 方块状态里的主效果下标（0 = 没选 → 什么都不挂）
 * @param regen 要不要生命恢复（三级以下**给不了**，这里会直接忽略）
 */
export function beaconEffects(
  level: number,
  primaryIndex: number,
  regen: boolean,
  seconds = BEACON_EFFECT_SECONDS,
): BeaconEffectSpec[] {
  if (level <= 0) return [];
  const specs: BeaconEffectSpec[] = [];
  const power = primaryIndex > 0 ? BEACON_POWERS[primaryIndex - 1] : undefined;
  if (power) specs.push({ effect: power.effect, seconds, amplifier: beaconPrimaryAmplifier(level) });
  // 生命恢复永远是 I（原版如此），而且三级起才给
  if (regen && level >= BEACON_REGEN_MIN_LEVEL) {
    specs.push({ effect: BEACON_REGEN_POWER.effect, seconds, amplifier: 0 });
  }
  return specs;
}

/** 界面上那句"几级 / 多大范围"的文案（主程序与测试都读它，避免各写一遍） */
export function beaconSummary(level: number): string {
  if (level <= 0) return '没有金字塔底座：摆成 3×3 起才会工作';
  return `金字塔 ${level} 级 · 半径 ${beaconRange(level)} 格`;
}
