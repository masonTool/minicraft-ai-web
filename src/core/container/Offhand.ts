/**
 * 副手槽的交换规则（联机41）。
 *
 * 核对后结论：**副手槽本来就存在**（`Inventory.ts` 的 `OFFHAND_SLOT = 40`，存档里那句
 * "41 个背包槽（含盔甲与副手）"说的就是它），所以这条不需要改存档格式——缺的只是
 * "F 键能换"和"把 offhand 告诉队友"。
 *
 * 交换本身是一行三赋值，但**顺序错了会丢东西**（先把手持覆盖成副手、再想读手持已经晚了），
 * 所以抽成纯函数并单测：调用方拿到"交换后手里该是什么、副手该是什么"。
 */

/** 交换的输入：只关心"是什么"，不关心槽位与容器实现 */
export interface OffhandSwapInput<T> {
  readonly held: T | null;
  readonly offhand: T | null;
}

/** 交换的结果 */
export interface OffhandSwapResult<T> {
  readonly held: T | null;
  readonly offhand: T | null;
}

/**
 * 手持 ↔ 副手。
 *
 * 两边都空时什么都不变（不用特判，`null` 对 `null` 交换仍是 `null` 对 `null`）；
 * 一边空时就是"挪过去"——这也是玩家按 F 最常见的意图（把火把放副手 / 收回来）。
 */
export function swapOffhand<T>(input: OffhandSwapInput<T>): OffhandSwapResult<T> {
  return { held: input.offhand, offhand: input.held };
}
