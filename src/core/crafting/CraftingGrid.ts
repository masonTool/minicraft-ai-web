/**
 * 合成网格
 *
 * 持有 2×2（背包内）或 3×3（工作台）的材料槽，每次材料变化就重算产物。
 * 取出产物时每个非空槽消耗 1 个（原版行为：一次合成消耗一份材料）。
 */

import type { Inventory, ItemStack, SlotSource } from '../container/Inventory.ts';
import { matchRecipe } from './Recipes.ts';

export class CraftingGrid implements SlotSource {
  private readonly slots: (ItemStack | null)[];

  /** 当前可合成的产物；null 表示没有匹配的配方 */
  result: ItemStack | null = null;

  onChange: (() => void) | null = null;

  constructor(readonly size: 2 | 3) {
    this.slots = new Array<ItemStack | null>(size * size).fill(null);
  }

  get(index: number): ItemStack | null {
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= this.slots.length) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.recompute();
  }

  private cells(): number[] {
    return this.slots.map((slot) => (slot ? slot.id : 0));
  }

  recompute(): void {
    this.result = matchRecipe(this.cells(), this.size);
    this.onChange?.();
  }

  /** 取出产物：每个非空材料槽消耗 1 个 */
  takeResult(): boolean {
    if (!this.result) return false;
    for (const slot of this.slots) {
      if (!slot) continue;
      slot.count -= 1;
    }
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot && slot.count <= 0) this.slots[i] = null;
    }
    this.recompute();
    return true;
  }

  /** 关闭界面时把剩余材料还回背包，避免物品被界面吞掉 */
  drainTo(inventory: Inventory): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot) continue;
      const leftover = inventory.add(slot.id, slot.count);
      this.slots[i] = leftover > 0 ? { id: slot.id, count: leftover } : null;
    }
    this.recompute();
  }

  get isEmpty(): boolean {
    return this.slots.every((slot) => slot === null);
  }
}
