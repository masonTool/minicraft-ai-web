/**
 * 箱子容器：27 格（3×9），与原版一致。
 *
 * 与背包共用 SlotSource 接口，所以界面里的拖拽逻辑可以直接复用。
 */

import type { ItemStack, SlotSource } from './Inventory.ts';
import { maxStackOf } from '../registry/items.ts';

export const CHEST_SIZE = 27;

export class Chest implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(CHEST_SIZE).fill(null);

  onChange: (() => void) | null = null;

  /**
   * 这只箱子是不是**已经被战利品表填过**（结构里的箱子用过一次就置位）。
   *
   * 存在的唯一理由是"别被重复填满"：结构箱的内容是按坐标确定性掷出来的，
   * 而加载区块时会再走一遍填充逻辑；如果没有这个标记，玩家把箱子掏空、
   * 区块一卸载一加载，箱子又会**满血复活**——那等于无限刷铁锭。
   * 因此它必须进存档（见 `ContainerSave`：置位过的空箱子也要写）。
   */
  looted = false;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= CHEST_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= CHEST_SIZE) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.onChange?.();
  }

  /** 放入物品，返回未能放入的剩余数量 */
  add(itemId: number, count: number): number {
    if (count <= 0) return 0;
    const limit = maxStackOf(itemId);
    let remaining = count;

    for (let i = 0; i < CHEST_SIZE && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.id !== itemId) continue;
      const room = limit - slot.count;
      if (room <= 0) continue;
      const moved = Math.min(room, remaining);
      slot.count += moved;
      remaining -= moved;
    }
    for (let i = 0; i < CHEST_SIZE && remaining > 0; i++) {
      if (this.slots[i]) continue;
      const moved = Math.min(limit, remaining);
      this.slots[i] = { id: itemId, count: moved };
      remaining -= moved;
    }

    if (remaining !== count) this.onChange?.();
    return remaining;
  }

  get isEmpty(): boolean {
    return this.slots.every((slot) => slot === null);
  }

  /** 序列化用：只保留非空槽位 */
  entries(): Array<{ index: number; stack: ItemStack }> {
    const result: Array<{ index: number; stack: ItemStack }> = [];
    this.slots.forEach((slot, index) => {
      if (slot) result.push({ index, stack: slot });
    });
    return result;
  }
}
