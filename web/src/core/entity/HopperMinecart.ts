/**
 * 漏斗矿车（批次 251，G12 收尾）
 *
 * 与普通矿车**同一套运动**（继承 `Minecart`），多出来的是 5 格"肚子"：
 * 主程序每 0.4 秒把附近掉落物塞进来、把肚子里的东西送进脚下那一格的容器。
 *
 * ⚠️ 实体层不认识容器层：这里只存 `{ id, count }` 的白板栈，
 * "往哪个箱子倒"由主程序决定（见 `main.updateHopperMinecarts`）。
 * 带耐久/附魔的掉落物进车会**丢掉附加数据**——原版漏斗矿车是原样搬运的，
 * 这一条写在 TASKS G12 的差异里。
 */

import { Minecart } from './Minecart.ts';

/** 车里的格数（原版 5 格） */
export const HOPPER_CART_SLOTS = 5;
/** 一格最多堆多少（原版 64；取矿车里最常见的那一档就够） */
const SLOT_LIMIT = 64;

export interface HopperCartSlot {
  id: number;
  count: number;
}

export class HopperMinecart extends Minecart {
  /** 5 格肚子（白板栈；空位为 null） */
  readonly slots: (HopperCartSlot | null)[] = new Array<HopperCartSlot | null>(
    HOPPER_CART_SLOTS,
  ).fill(null);

  /**
   * 往车里塞东西。
   * @returns 没塞下的剩余数量（0 = 全收下）
   */
  accept(itemId: number, count: number): number {
    let remaining = count;
    // 先并进已有的同类堆
    for (const slot of this.slots) {
      if (!slot || slot.id !== itemId || slot.count >= SLOT_LIMIT) continue;
      const moved = Math.min(SLOT_LIMIT - slot.count, remaining);
      slot.count += moved;
      remaining -= moved;
      if (remaining <= 0) return 0;
    }
    // 再占空位
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      if (this.slots[i]) continue;
      const moved = Math.min(SLOT_LIMIT, remaining);
      this.slots[i] = { id: itemId, count: moved };
      remaining -= moved;
    }
    return remaining;
  }

  /** 车里现有多少件（验收与 HUD 用） */
  get itemCount(): number {
    let total = 0;
    for (const slot of this.slots) if (slot) total += slot.count;
    return total;
  }

  /** 清空（丢弃内容物时用） */
  clear(): void {
    this.slots.fill(null);
  }
}
