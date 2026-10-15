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

import { ARMOR_SLOT_BASE, armorSlotAccepts } from '../registry/armor.ts';
import { maxStackOf } from '../registry/items.ts';

export interface ItemStack {
  id: number;
  count: number;
  /**
   * 工具/盔甲的已损耗耐久（0 表示崭新）。
   * 普通方块与材料不带这个字段，因此存档里不会多出一堆 `damage: 0`。
   */
  damage?: number;
  /**
   * 附魔（H9）：附魔 id → 等级。
   * 与 `damage` 同样是"可选 + 跟着栈走"，用普通对象而不是 Map 是为了能直接进存档。
   */
  enchants?: Record<string, number>;
  /** 铁砧改过的名字（H8）；没改过就不带这个字段 */
  name?: string;
  /**
   * 铁砧的累积惩罚（原版 `RepairCost`）：每上过一次铁砧就 `2 × 旧值 + 1`，
   * 下次操作要多花这么多级。不带这个字段表示"没用过铁砧"（0）。
   */
  repairCost?: number;
}

/**
 * 槽位数据源：让界面里的拖拽逻辑对"背包"和"合成网格"一视同仁。
 */
export interface SlotSource {
  get(index: number): ItemStack | null;
  set(index: number, stack: ItemStack | null): void;
}

/**
 * 把"可选的栈附加数据"（耐久 / 附魔）拷成一个新对象。
 *
 * 抽成函数的原因：`take`、`serialize`、提示框、附魔台都要搬这几项，
 * 每处各写一遍三元表达式的话，加第三项时必然漏掉一处——
 * 耐久当初就是这么一项项加进来的（并且 `moveTo` 的交换分支也因此漏过一次搬运）。
 */
export function stackExtras(stack: ItemStack): Partial<ItemStack> {
  const extras: Partial<ItemStack> = {};
  if (stack.damage !== undefined) extras.damage = stack.damage;
  if (stack.enchants !== undefined) extras.enchants = { ...stack.enchants };
  if (stack.name !== undefined) extras.name = stack.name;
  if (stack.repairCost !== undefined) extras.repairCost = stack.repairCost;
  return extras;
}

export const HOTBAR_START = 0;
export const HOTBAR_SIZE = 9;
export const MAIN_START = 9;
export const MAIN_SIZE = 27;
export const ARMOR_START = ARMOR_SLOT_BASE;
export const ARMOR_SIZE = 4;
export const OFFHAND_SLOT = 40;
export const TOTAL_SLOTS = 41;

/** 自动拾取只会用到的槽位区间（[0, 36)）：盔甲槽与副手槽不参与自动填充 */
export const AUTO_FILL_SLOTS = ARMOR_SLOT_BASE;

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
   *
   * 只填 0-35（快捷栏与主背包）：盔甲槽与副手槽**不参与自动拾取**——
   * 否则捡到的铁靴子会自己"穿"到 36 号槽上，与原版行为不符（原版只有主动装备才会穿）。
   *
   * @returns 未能放入的剩余数量
   */
  add(itemId: number, count: number): number {
    if (count <= 0) return 0;
    const limit = maxStackOf(itemId);
    let remaining = count;

    for (let i = 0; i < AUTO_FILL_SLOTS && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.id !== itemId) continue;
      const room = limit - slot.count;
      if (room <= 0) continue;
      const moved = Math.min(room, remaining);
      slot.count += moved;
      remaining -= moved;
    }

    for (let i = 0; i < AUTO_FILL_SLOTS && remaining > 0; i++) {
      if (this.slots[i]) continue;
      const moved = Math.min(limit, remaining);
      this.slots[i] = { id: itemId, count: moved };
      remaining -= moved;
    }

    if (remaining !== count) this.notify();
    return remaining;
  }

  /**
   * 第 index 号槽位能不能放这件物品。
   * 盔甲槽（36-39）只吃对应部位；其余槽位不限——界面在"放下/交换"之前先问一句。
   */
  canPlace(index: number, itemId: number): boolean {
    return armorSlotAccepts(index, itemId);
  }

  /** 从槽位取出指定数量；数量不足时按实际数量取出 */
  take(index: number, count: number): ItemStack | null {
    const slot = this.get(index);
    if (!slot || count <= 0) return null;
    const moved = Math.min(slot.count, count);
    slot.count -= moved;
    const taken: ItemStack = { id: slot.id, count: moved, ...stackExtras(slot) };
    if (slot.count <= 0) this.slots[index] = null;
    this.notify();
    return taken;
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

  /**
   * 导出全部槽位（存档用）。
   * 返回定长的 41 项数组，空槽为 null——不存下标，读档时按下标直接还原。
   */
  serialize(): Array<ItemStack | null> {
    return this.slots.map((slot) => (slot ? { id: slot.id, count: slot.count, ...stackExtras(slot) } : null));
  }

  /** 从存档恢复槽位（长度不符时按能恢复的部分恢复） */
  restore(data: ReadonlyArray<ItemStack | null>): void {
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const stack = data[i];
      if (!stack || stack.count <= 0) {
        this.slots[i] = null;
        continue;
      }
      const restored: ItemStack = { id: stack.id, count: stack.count };
      // 旧存档没有 damage 字段；顺手夹紧非法值，避免坏存档把工具直接判成"已损坏"
      if (typeof stack.damage === 'number' && stack.damage > 0) restored.damage = stack.damage;
      // 附魔同理：只收"看起来像附魔表"的对象，坏存档不会把整件物品读崩
      if (stack.enchants && typeof stack.enchants === 'object') {
        const enchants: Record<string, number> = {};
        for (const [id, level] of Object.entries(stack.enchants)) {
          if (typeof level === 'number' && level > 0) enchants[id] = Math.floor(level);
        }
        if (Object.keys(enchants).length > 0) restored.enchants = enchants;
      }
      // 改名与累积惩罚同理：只收合法值，坏存档不会把整件物品读崩
      if (typeof stack.name === 'string' && stack.name.length > 0) restored.name = stack.name.slice(0, 64);
      if (typeof stack.repairCost === 'number' && stack.repairCost > 0) restored.repairCost = Math.floor(stack.repairCost);
      this.slots[i] = restored;
    }
    this.notify();
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
    // 目标槽位不收这件东西（例如把石头塞进头盔位）就整次操作作废，不做半途改动
    if (!this.canPlace(to, source.id)) return;
    const target = this.get(to);

    if (!target) {
      this.slots[to] = source;
      this.slots[from] = null;
    } else if (target.id === source.id && maxStackOf(target.id) > 1) {
      // 只能堆叠的物品才合并；工具（maxStack 1）走下面的交换分支，
      // 否则两把同款工具互拖会变成"什么都没发生"
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
