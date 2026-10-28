/**
 * 附魔台的容器状态（H9）
 *
 * 只放两格：要附魔的装备 + 青金石。**候选槽的掷点结果也放在这里**，
 * 而不是放在界面里——原因有两个：
 *  1. 界面每次重建上半区（切模式、刷新）都会重来，状态放界面里会被丢掉；
 *  2. 掷点、校验、扣材料这些是纯逻辑，放这里才能离线测（`tools/enchant-test.ts`）。
 *
 * 界面只做三件事：把两格画出来、把候选槽画成按钮、点了调 `applySlot`。
 */

import { enchantKindOf, rollOptions, type EnchantApplied, type EnchantOption } from '../crafting/Enchanting.ts';
import { reason, type ReasonRef } from './reason.ts';
import { Item } from '../registry/items.ts';
import type { ItemStack, SlotSource } from './Inventory.ts';

/** 两个槽的下标 */
export const ENCHANT_ITEM_SLOT = 0;
export const ENCHANT_LAPIS_SLOT = 1;

export type EnchantAttempt =
  | { ok: true; enchants: readonly EnchantApplied[] }
  | { ok: false; reason: ReasonRef };

export class EnchantTable implements SlotSource {
  private readonly slots: (ItemStack | null)[] = [null, null];
  onChange: (() => void) | null = null;

  /** 当前掷出的三个候选（装备/加成变了就重掷） */
  options: readonly EnchantOption[] = [];

  /** 上次掷点时的"局面指纹"：装备 + 青金石 + 玩家等级 + 书架加成 */
  private rollKey = '';

  get(index: number): ItemStack | null {
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    this.slots[index] = stack;
    this.onChange?.();
  }

  /** 要附魔的装备 */
  get item(): ItemStack | null {
    return this.get(ENCHANT_ITEM_SLOT);
  }

  /** 手里那叠青金石的数量 */
  get lapis(): number {
    return this.get(ENCHANT_LAPIS_SLOT)?.count ?? 0;
  }

  /**
   * 按当前局面重掷候选槽。
   *
   * 只有"局面指纹"变化时才重掷：不然每帧刷新界面都会换一批附魔，
   * 玩家永远点不到刚才看到的那一条。
   *
   * @param roll 0~1 的随机数发生器
   */
  refresh(playerLevel: number, power: number, roll: () => number): void {
    const item = this.item;
    const key = `${item?.id ?? 0}:${this.lapis}:${playerLevel}:${power}`;
    if (key === this.rollKey) return;
    this.rollKey = key;
    this.options = item && enchantKindOf(item.id) !== null ? rollOptions(item.id, playerLevel, power, roll) : [];
  }

  /** 这个候选槽现在能不能点；不能点就给出原因（界面直接显示给玩家） */
  checkSlot(slot: number, playerLevel: number): { ok: true; option: EnchantOption } | { ok: false; reason: ReasonRef } {
    const option = this.options[slot];
    if (!option) return { ok: false, reason: reason('station.reason.enchantNoOption') };
    if (!this.item) return { ok: false, reason: reason('station.reason.enchantNeedItem') };
    if (option.enchants.length === 0) return { ok: false, reason: reason('station.reason.needLevels', { cost: option.cost }) };
    if (playerLevel < option.cost) return { ok: false, reason: reason('station.reason.needLevels', { cost: option.cost }) };
    if (this.lapis < option.lapis) return { ok: false, reason: reason('station.reason.needLapis', { lapis: option.lapis }) };
    return { ok: true, option };
  }

  /**
   * 点第 slot 个候选。
   *
   * 顺序很讲究：**先扣等级、再扣青金石、最后写附魔**。
   * 任何一步失败都返回原因且不改动任何东西（扣了等级又没附上是最让人恼火的 bug）。
   *
   * @param consumeLevels 扣等级的出口（由主程序接到 `Experience` 上）
   */
  applySlot(slot: number, playerLevel: number, consumeLevels: (levels: number) => boolean): EnchantAttempt {
    const check = this.checkSlot(slot, playerLevel);
    if (!check.ok) return { ok: false, reason: check.reason };

    const { option } = check;
    const item = this.item!;
    if (!consumeLevels(option.cost)) return { ok: false, reason: reason('station.reason.needLevels', { cost: option.cost }) };

    // 扣青金石：优先扣这一槽，不够再从别处补（玩家可能把青金石分了几叠）
    const lapisStack = this.get(ENCHANT_LAPIS_SLOT);
    if (lapisStack) {
      const used = Math.min(lapisStack.count, option.lapis);
      lapisStack.count -= used;
      if (lapisStack.count <= 0) this.slots[ENCHANT_LAPIS_SLOT] = null;
    }

    // 写附魔：同一条已有时取更高级别（原版也是"取更高"）
    const enchants: Record<string, number> = { ...(item.enchants ?? {}) };
    for (const applied of option.enchants) {
      enchants[applied.id] = Math.max(enchants[applied.id] ?? 0, applied.level);
    }
    item.enchants = enchants;

    // 附完这一轮就重掷（同一次摆放不应该反复拿同一批附魔刷等级）
    this.rollKey = '';
    this.onChange?.();
    return { ok: true, enchants: option.enchants };
  }

  /** 青金石是唯一允许放进第二个槽的东西 */
  static acceptsLapis(itemId: number): boolean {
    return itemId === Item.LAPIS_LAZULI;
  }
}
