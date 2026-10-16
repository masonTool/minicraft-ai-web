/**
 * 铜的氧化（批次 40）
 *
 * 原版 1.17 起，铜方块会随时间氧化成四档：**新铜 → 斑驳 → 锈蚀 → 氧化**。
 * 它有两个玩家最常感知的点：
 *  1. **锈会"传染"**：已经锈了的铜会带动旁边更新的铜一起锈（所以一面铜墙的锈是从某处蔓延开的，
 *     而不是每块各自随机变色）；
 *  2. **斧头能刮**：拿斧头右键可以刮掉一层锈（退化一档），消耗 1 点耐久。
 *
 * 与随机刻的其它行为一样，这里是**纯逻辑 + 只依赖 TickWorld 的最小接口**，可以离线断言。
 *
 * ⚠️ 与原版的差异（已记进 TASKS）：
 *  - 原版的推进条件是"从邻居里随机挑一个方向再看它"，这里简化为"6 邻居里存在更锈的铜就推进自己"；
 *    观感一致（锈从锈处蔓延），但传播速度与原版不完全相同；
 *  - **涂蜡没做**：它要蜜蜡，而蜜蜡唯一的来源是蜂巢（蜜蜂还没做），
 *    按"A 一条链收尾时要问第一件原料从哪来"那条经验，宁可不做也不给一个拿不到的原料。
 */

import { COPPER_STAGES, copperId } from '../registry/blocks.ts';
import type { RandomSource, RandomTickBehavior, TickWorld } from '../tick/RandomTicks.ts';

/** 全部铜方块的 id（按氧化顺序、档内按形状） */
export const COPPER_IDS: readonly number[] = COPPER_STAGES.flatMap((_stage, stage) =>
  [0, 1, 2, 3].map((kind) => copperId(stage, kind as 0 | 1 | 2 | 3)),
);

/** 氧化档数（四档：新铜 / 斑驳 / 锈蚀 / 氧化） */
export const COPPER_STAGE_COUNT = COPPER_STAGES.length;

/**
 * 这个方块是第几档（不是铜方块返回 -1）。
 *
 * 靠**id 的算术**推出来（每档连续 4 个、档内形状顺序固定），所以同一形状的
 * "下一档" 就是 `id + 4`、"上一档" 就是 `id - 4`——见下面两个函数。
 */
export function oxidationStageOf(blockId: number): number {
  const offset = blockId - copperId(0, 0);
  if (offset < 0 || offset >= COPPER_STAGE_COUNT * 4) return -1;
  return Math.floor(offset / 4);
}

/** 是不是铜方块（含四种形状） */
export function isCopperBlock(blockId: number): boolean {
  return oxidationStageOf(blockId) >= 0;
}

/** 再氧化一档的 id；已经是最氧化的一档返回 undefined */
export function nextOxidation(blockId: number): number | undefined {
  const stage = oxidationStageOf(blockId);
  if (stage < 0 || stage + 1 >= COPPER_STAGE_COUNT) return undefined;
  return blockId + 4;
}

/** 刮锈（斧头右键）后退一档的 id；已经是新铜返回 undefined */
export function scrapeResult(blockId: number): number | undefined {
  const stage = oxidationStageOf(blockId);
  if (stage <= 0) return undefined;
  return blockId - 4;
}

/** 每次随机刻"做一次判定"的概率（原版 0.0568） */
export const COPPER_WEATHER_CHANCE = 0.0568;
/**
 * 周围**没有**更锈的铜时，"自己开始生锈"的概率。
 *
 * 原版没有这个数（它靠邻居逻辑自然扩散），但那样一来一整面新铜永远不生锈
 * （我的规则是"有更锈的邻居才推进"，没有起点就没有传播）。所以补一个很小的自启动概率。
 */
export const COPPER_SELF_START_CHANCE = 0.1;

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * 随机刻行为：推进一格铜的氧化。
 *
 * 流程：不是铜 / 已经是最氧化的一档 → 什么都不做；否则先过 5.68% 的判定门槛，
 * 再看 6 个邻居里有没有**比自己更锈**的铜：
 *  - 有 → 直接推进（"锈会传染"）
 *  - 没有 → 再过一次很小的自启动概率才推进
 *
 * @returns 是否真的改了方块（随机刻的统计要用）
 */
export const copperWeatherBehavior: RandomTickBehavior = (
  world: TickWorld,
  x: number,
  y: number,
  z: number,
  random: RandomSource,
): boolean => {
  const id = world.getBlock(x, y, z);
  const stage = oxidationStageOf(id);
  if (stage < 0) return false;
  const next = nextOxidation(id);
  if (next === undefined) return false;
  if (random() >= COPPER_WEATHER_CHANCE) return false;

  const rustedNeighbour = NEIGHBOURS.some(
    ([dx, dy, dz]) => oxidationStageOf(world.getBlock(x + dx, y + dy, z + dz)) > stage,
  );
  if (!rustedNeighbour && random() >= COPPER_SELF_START_CHANCE) return false;
  return world.setBlock(x, y, z, next);
};
