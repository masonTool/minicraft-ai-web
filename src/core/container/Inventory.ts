/**
 * 背包数据模型
 *
 * 槽位编号完全对齐原版：
 *   0-8   快捷栏
 *   9-35  主背包（3 行 × 9 列）
 *   36-39 盔甲（头盔/胸甲/护腿/靴子）
 *   40    副手
 *
 * 堆叠用可变对象表示（`{ id, count }`），count 归零即视为空槽，由 set() 统一归一化，
 * 这样 UI 拖拽时不必到处判断"数量为 0 的残留槽位"。
 */

import { maxStackOf } from '../registry/items.ts';

export interface ItemStack {
  id: number;
  count: number;
}

/**
 * 槽位数据源：让界面里的拖拽逻辑对"背包"和"合成网格"一视同仁。
 */
export interface SlotSource {
  get(index: number): ItemStack | null;
  set(index: number, stack: ItemStack | null): void;
}

export const HOTBAR_START = 0;
export const HOTBAR_SIZE = 9;
export const MAIN_START = 9;
export const MAIN_SIZE = 27;
export const ARMOR_START = 36;
export const ARMOR_SIZE = 4;
export const OFFHAND_SLOT = 40;
export const TOTAL_SLOTS = 41;

export class Inventory implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(TOTAL_SLOTS).fill(null);

  /** 槽位内容变化时触发（UI 刷新用） */
  onChange: (() => void) | null = null;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= TOTAL_SLOTS) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= TOTAL_SLOTS) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.notify();
  }

  /**
   * 放入物品（优先进已有堆叠，再占空槽）。
   * @returns 未能放入的剩余数量
   */
  add(itemId: number, count: number): number {
    if (count <= 0) return 0;
    const limit = maxStackOf(itemId);
    let remaining = count;

    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.id !== itemId) continue;
      const room = limit - slot.count;
      if (room <= 0) continue;
      const moved = Math.min(room, remaining);
      slot.count += moved;
      remaining -= moved;
    }

    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      if (this.slots[i]) continue;
      const moved = Math.min(limit, remaining);
      this.slots[i] = { id: itemId, count: moved };
      remaining -= moved;
    }

    if (remaining !== count) this.notify();
    return remaining;
  }

  /** 从槽位取出指定数量；数量不足时按实际数量取出 */
  take(index: number, count: number): ItemStack | null {
    const slot = this.get(index);
    if (!slot || count <= 0) return null;
    const moved = Math.min(slot.count, count);
    slot.count -= moved;
    if (slot.count <= 0) this.slots[index] = null;
    this.notify();
    return { id: slot.id, count: moved };
  }

  /** 消耗指定物品，数量不足则不做任何改动并返回 false */
  consume(itemId: number, count: number): boolean {
    if (this.countOf(itemId) < count) return false;
    let remaining = count;
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.id !== itemId) continue;
      const moved = Math.min(slot.count, remaining);
      slot.count -= moved;
      remaining -= moved;
      if (slot.count <= 0) this.slots[i] = null;
    }
    this.notify();
    return true;
  }

  countOf(itemId: number): number {
    let total = 0;
    for (const slot of this.slots) if (slot && slot.id === itemId) total += slot.count;
    return total;
  }

  /** 背包中第一个该物品的槽位下标，找不到返回 -1 */
  find(itemId: number): number {
    return this.slots.findIndex((slot) => slot !== null && slot.id === itemId);
  }

  /** 拖拽用的合并/交换语义 */
  moveTo(from: number, to: number): void {
    if (from === to) return;
    const source = this.get(from);
    if (!source) return;
    const target = this.get(to);

    if (!target) {
      this.slots[to] = source;
      this.slots[from] = null;
    } else if (target.id === source.id) {
      const room = maxStackOf(target.id) - target.count;
      const moved = Math.min(room, source.count);
      target.count += moved;
      source.count -= moved;
      if (source.count <= 0) this.slots[from] = null;
    } else {
      this.slots[from] = target;
      this.slots[to] = source;
    }
    this.notify();
  }

  get isEmpty(): boolean {
    return this.slots.every((slot) => slot === null);
  }

  clear(): void {
    this.slots.fill(null);
    this.notify();
  }

  notify(): void {
    this.onChange?.();
  }
}
