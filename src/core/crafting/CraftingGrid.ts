/**
 * 合成网格
 *
 * 持有 2×2（背包内）或 3×3（工作台）的材料槽，每次材料变化就重算产物。
 * 取出产物时每个非空槽消耗 1 个（原版行为：一次合成消耗一份材料）。
 */

import type { Inventory, ItemStack, SlotSource } from '../container/Inventory.ts';
import { matchRecipe } from './Recipes.ts';
import { Item } from '../registry/items.ts';

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
    const matched = matchRecipe(this.cells(), this.size);
    // 烟花（批次 192）：火箭的**颜色来自摆进去的那颗星**（星本身带数据，配方里只有 id）。
    // 放在这里而不是配方表里：配方表是按 id 匹配的，看不到那一叠的 `firework.colors`。
    if (matched && matched.id === Item.FIREWORK_ROCKET) {
      const star = this.slots.find((slot) => slot !== null && slot.id === Item.FIREWORK_STAR);
      const colors = star?.firework?.colors ?? [];
      if (colors.length > 0) matched.firework = { flight: matched.firework?.flight ?? 1, colors: [...colors] };
    }
    this.result = matched;
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
