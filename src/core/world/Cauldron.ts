/**
 * 炼药锅与桶装水（G13，批次 176）
 *
 * 这一批补的是**生存里最基础的一条物流**：把水搬回家。
 * 在它之前，`桶` 只是一件"能挤奶"的东西——世界里根本没有"装起来的水"，
 * 于是酿造台要的水瓶只能在创造模式拿（那条断环记在 TASKS H10/G13）。
 *
 * 为什么把判定写成纯函数：这套交互的**规则比实现容易错**——
 * "满锅舀一瓶会掉到 2 级"、"空桶只能在满锅时舀"、"桶只能从**水源**装水（流水不行）"，
 * 这三条各自都能单独断言，而混在 `main.ts` 的右键分支里就只能靠手点。
 *
 * 与桶有关的两条原版规则（都在这张表里）：
 *  1. **只能装水源**（`fluidLevel === 0` 且不是下落中的那一节）——流水装不起来；
 *  2. 倒水出去永远是**一个新的水源**（不是"接着流"）。
 */

import { Block } from '../registry/blocks.ts';
import { CAULDRON_MAX_LEVEL, cauldronLevelOf, fluidLevel, isFallingFluid, withCauldronLevel } from '../registry/blockState.ts';

/** 这一格是不是"可以装进桶里的水源"（水或岩浆，且是源头、不是瀑布的一节） */
export function isBucketSource(blockId: number, state: number): boolean {
  if (blockId !== Block.WATER && blockId !== Block.LAVA) return false;
  return fluidLevel(state) === 0 && !isFallingFluid(state);
}

/** 一桶能装什么（给"手上的桶装满之后变成哪件物品"用） */
export type BucketFluid = 'water' | 'lava';

/** 这格的液体对应哪一种桶 */
export function bucketFluidAt(blockId: number): BucketFluid | null {
  if (blockId === Block.WATER) return 'water';
  if (blockId === Block.LAVA) return 'lava';
  return null;
}

/**
 * 用一桶水灌炼药锅：**直接灌满**（原版就是这样，不按桶里的"量"算）。
 *
 * @returns 灌完之后的状态（调用方直接写回世界）
 */
export function fillCauldron(state: number): number {
  return withCauldronLevel(state, CAULDRON_MAX_LEVEL);
}

/** 这个锅满不满（空桶舀水要求满） */
export function isCauldronFull(state: number): boolean {
  return cauldronLevelOf(state) >= CAULDRON_MAX_LEVEL;
}

/**
 * 空桶从锅里舀：只有**满锅**才舀得出来（舀完变成空锅）。
 *
 * 原版是"一次舀走一整锅"（3 级），所以半锅的水舀不进桶——
 * 想收走就再倒一桶水把它灌满。这条规则看着别扭，但它保住了"桶 ↔ 锅"的整数关系。
 *
 * @returns 舀完之后的状态；锅不满时返回 null（调用方据此判定"什么都没发生"）
 */
export function drainCauldronToBucket(state: number): number | null {
  if (!isCauldronFull(state)) return null;
  return withCauldronLevel(state, 0);
}

/**
 * 玻璃瓶从锅里舀一瓶：**每一级一瓶**（锅里有水就行）。
 *
 * @returns 舀完之后的剩余状态；锅是空的返回 null
 */
export function drainCauldronToBottle(state: number): number | null {
  const level = cauldronLevelOf(state);
  if (level <= 0) return null;
  return withCauldronLevel(state, level - 1);
}

/**
 * 下雨时这一格会不会接到水（G13 的"下雨接水"）。
 *
 * 判据是"锅没满 + 头顶见天"，**概率由调用方摇**（`rainFillChance`）——
 * 纯函数里不放随机，这样断言只测规则、不测运气。
 */
export function cauldronAcceptsRain(state: number, skyLight: number): boolean {
  return !isCauldronFull(state) && skyLight >= 15;
}

/** 每个"降水刻"给炼药锅加一级的概率（原版靠随机刻，这里给一个能观察到的值） */
export const CAULDRON_RAIN_CHANCE = 0.15;

/** 调试面板/提示文案（主程序与断言共用同一句话） */
export function describeCauldron(state: number): string {
  const level = cauldronLevelOf(state);
  if (level <= 0) return '炼药锅（空）';
  return `炼药锅（水 ${level}/${CAULDRON_MAX_LEVEL}）`;
}
