/**
 * 弓射出去的那一支"用背包里的哪种箭"（K4 最后一步）
 *
 * 为什么单独一个纯函数：这段逻辑要同时回答三个问题——**有没有箭**、
 * **这一箭算哪一支**（普通箭 / 某支药水箭）、**捡回来是什么**，
 * 而它天然可离线断言（界面与主循环里那部分只能靠手点）。
 *
 * 挑箭规则（与原版一致的地方）：**按背包槽位顺序取第一个非空的箭类物品**，
 * 快捷栏是 0~8 号槽，所以快捷栏里的箭优先于主背包。
 * 想射药水箭就把它摆在普通箭前面——这与原版"用哪一格里的箭"是同一个直觉。
 */

import { Item } from '../registry/items.ts';
import { tippedArrowById } from '../registry/potions.ts';
import type { ItemStack } from '../container/Inventory.ts';

export interface ArrowAmmo {
  /** 这一箭要消耗哪件物品（普通箭或某支药水箭的 id） */
  readonly itemId: number;
  /** 这一箭带的药水（普通箭没有）：命中时按它挂 1/8 时长的效果 */
  readonly potionId?: number;
  /** 背包里一共有多少支能射的箭（普通 + 各种药水箭） */
  readonly total: number;
}

/** 一件物品是不是"能射的箭"（普通箭或药水箭） */
export function isArrowItem(itemId: number): boolean {
  return itemId === Item.ARROW || tippedArrowById(itemId) !== undefined;
}

/** 背包里一共有多少支箭（`canShoot` 与"没有箭了"的提示都用它） */
export function arrowAmmoTotal(stacks: readonly (ItemStack | null)[]): number {
  let total = 0;
  for (const stack of stacks) {
    if (stack && stack.count > 0 && isArrowItem(stack.id)) total += stack.count;
  }
  return total;
}

/**
 * 挑出这一箭用哪一支；背包里一支箭都没有时返回 null。
 * 返回的 `total` 是**全部**箭的数量（不是被挑中那一堆的数量）。
 */
export function pickArrowAmmo(stacks: readonly (ItemStack | null)[]): ArrowAmmo | null {
  let total = 0;
  let picked: { itemId: number; potionId?: number } | null = null;

  for (const stack of stacks) {
    if (!stack || stack.count <= 0 || !isArrowItem(stack.id)) continue;
    total += stack.count;
    if (picked) continue;
    const arrow = tippedArrowById(stack.id);
    picked = arrow ? { itemId: stack.id, potionId: arrow.potionId } : { itemId: stack.id };
  }

  return picked ? { ...picked, total } : null;
}
