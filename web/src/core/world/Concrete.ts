/**
 * 混凝土：粉末遇水凝固（TASKS B52 的最后一块，批次 131）
 *
 * 原版规则很简单：**混凝土粉末挨到水就变成混凝土**（自己那一色）——
 * 水流过来、把粉末扔进水里、在下雨的海边盖房子都算。混凝土本身**不可逆**
 * （再碰水也不会变回去），而且它**没有配方**：16 色混凝土只有这一条来源。
 *
 * 在方块侧可达性审计里，这一条就是那 16 个"有方块、有贴图、但一个配方都没有"的
 * 缺口（批次 118 量出来的，白名单里一直挂着）——它是**机制型来源**，
 * 与"耕地""铜的氧化档"同一类：不在任何表里，只在世界的规则里。
 *
 * ## 为什么单独一个模块
 *
 * "哪六格算挨着水"这件事只有一处能定义（写错通常是漏掉上下、或者把斜角也算上）。
 * 而且它**必须能离线断言**：真机上验这件事要"提一桶水慢慢浇 20 次"，没人会那么测。
 */

import { CONCRETE_POWDER_ID_START, concreteId, Block } from '../registry/blocks.ts';

/** 混凝土粉末的颜色数（与原版一致：16 色） */
export const CONCRETE_COLOR_COUNT = 16;

/** 这一格是"挨着的水"吗（水源与流水都算——原版也是"碰到水"就算） */
function isWater(id: number): boolean {
  return id === Block.WATER;
}

/** 这一个是混凝土粉末吗 */
export function isConcretePowder(id: number): boolean {
  return id >= CONCRETE_POWDER_ID_START && id < CONCRETE_POWDER_ID_START + CONCRETE_COLOR_COUNT;
}

/**
 * 这一块粉末凝固之后是哪一个混凝土（`null` = 它不是粉末）。
 *
 * 两族方块的 id 都是 16 连号、颜色顺序一致（`DYE_COLORS` 那一份），
 * 所以映射就是**同一个颜色下标**——不另列一张表。
 */
export function concreteForPowder(powderId: number): number | null {
  if (!isConcretePowder(powderId)) return null;
  return concreteId(powderId - CONCRETE_POWDER_ID_START);
}

/** 这一个是混凝土吗（凝固过的那种） */
export function isConcrete(id: number): boolean {
  return id >= concreteId(0) && id < concreteId(0) + CONCRETE_COLOR_COUNT;
}

/** 世界那一侧只需要"读一格 + 把一格换成混凝土"（其余交给主程序，见 `harden`） */
export interface ConcreteWorld {
  getBlock(x: number, y: number, z: number): number;
  /**
   * 换成混凝土。
   *
   * ⚠️ 由主程序实现成"走世界那条会重网格化/更新光照的路"（`setBlockAndUpdate`）：
   * 直接改数组的话，玩家要盯着看那块方块**换色之前的样子**直到区块被重新网格化
   * （看起来像"水浇了没反应"，其实是没刷新）。
   */
  harden(x: number, y: number, z: number, concreteId: number): void;
}

/** 六个正方向的偏移（**不含斜角**：对角线上的水在原版不会让它凝固） */
const NEIGHBOURS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** `(x, y, z)` 的六邻域里有没有水 */
export function touchesWater(world: ConcreteWorld, x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of NEIGHBOURS) {
    if (isWater(world.getBlock(x + dx, y + dy, z + dz))) return true;
  }
  return false;
}

/**
 * 这一格如果是"挨着水的混凝土粉末"，就把它换成混凝土。
 *
 * @returns 换成了哪一个混凝土（`null` = 什么都没发生）
 */
export function hardenPowderAt(world: ConcreteWorld, x: number, y: number, z: number): number | null {
  const here = world.getBlock(x, y, z);
  const concrete = concreteForPowder(here);
  if (concrete === null) return null;
  if (!touchesWater(world, x, y, z)) return null;
  world.harden(x, y, z, concrete);
  return concrete;
}

/**
 * 把 `(x, y, z)` **自己与六邻域**里所有挨着水的粉末都凝固掉。
 *
 * 两个调用点，都是"水刚刚动过"或"方块刚刚被改过"的公共出口：
 *  - 一次流体流动刻之后（水摊开到了粉末旁边）；
 *  - 玩家放/挖方块之后（把粉末放在水边，或者把水底挖开让水流过来）。
 *
 * @returns 一共凝固了几块（0 = 什么都没发生）
 */
export function hardenAround(world: ConcreteWorld, x: number, y: number, z: number): number {
  let count = 0;
  if (hardenPowderAt(world, x, y, z) !== null) count++;
  for (const [dx, dy, dz] of NEIGHBOURS) {
    if (hardenPowderAt(world, x + dx, y + dy, z + dz) !== null) count++;
  }
  return count;
}
