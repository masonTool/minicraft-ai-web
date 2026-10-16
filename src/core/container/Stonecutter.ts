/**
 * 切石机的容器状态（H11，批次 44）
 *
 * 与铁砧 / 锻造台**不同构**：那两台的产物是"两格算出来的一个结果"，
 * 而切石机是"**一格输入 + 一列可选产物**，玩家点哪一项就切哪一项"。
 * 所以这里的核心不是 `take()` 而是 `cut(outputId)`——它要校验
 * "这个产物**确实**在这份输入的候选里"（界面传进来的 id 是外部数据，
 * 不校验就等于开了一个"任意物品换任意物品"的后门）。
 *
 * ⚠️ 与其他工作台一样，输入格按坐标存（`BlockEntityStore`）：
 * 放进去走开再回来，东西还在台面上。
 *
 * ⚠️ 候选列表**存在容器里**（`offers`），不是界面上现算的：
 * 切换界面模式会重建上半区，状态留在界面里会丢；而且套件可以在离线环境里
 * 直接断言"某个输入列出哪些产物"，不必碰 DOM。
 */

import { stonecuttingOffers, type StonecuttingOffer } from '../crafting/Stonecutting.ts';
import type { ItemStack, SlotSource } from './Inventory.ts';

export const STONECUTTER_INPUT = 0;
export const STONECUTTER_SIZE = 1;

export class Stonecutter implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(STONECUTTER_SIZE).fill(null);

  onChange: (() => void) | null = null;

  /** 当前输入能切出来的东西（按下标与界面上那一列按钮一一对应） */
  offers: readonly StonecuttingOffer[] = [];

  get(index: number): ItemStack | null {
    if (index < 0 || index >= STONECUTTER_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= STONECUTTER_SIZE) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.refresh();
  }

  /** 输入格里的石料 */
  get input(): ItemStack | null {
    return this.get(STONECUTTER_INPUT);
  }

  /** 重算候选列表。输入格变了就要调一次（与锻造台的 `refresh` 同一个位置） */
  refresh(): void {
    this.offers = this.input ? stonecuttingOffers(this.input.id) : [];
    this.onChange?.();
  }

  /**
   * 切一次：消耗 **1 个**输入，产出对应的东西。
   *
   * 顺序照铁砧/锻造台那条经验：**先校验、再留产物快照、最后扣材料**——
   * 任何一步不满足都只返回原因、不改动任何东西
   * （"东西被吃掉却没拿到产物"是最恼人的 bug）。
   */
  cut(outputId: number): { ok: true; output: ItemStack } | { ok: false; reason: string } {
    const input = this.input;
    if (!input) return { ok: false, reason: '先放进要切的石料' };

    const offer = this.offers.find((candidate) => candidate.output === outputId);
    if (!offer) return { ok: false, reason: '这件石料切不出它' };

    const output: ItemStack = { id: offer.output, count: offer.count };

    input.count -= 1;
    if (input.count <= 0) this.slots[STONECUTTER_INPUT] = null;
    this.refresh();
    return { ok: true, output };
  }

  /** 候选项的中文标签需要物品名，这里只给"能不能切"，界面自己取名字 */
  get canCut(): boolean {
    return this.offers.length > 0;
  }
}
