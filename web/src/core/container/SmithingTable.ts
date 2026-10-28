/**
 * 锻造台的容器状态（K8 尾巴）
 *
 * 两格输入（左：装备 / 右：下界合金锭）+ 一格产物。与铁砧**完全同构**：
 *  - 纯函数式：只要两格定了，产物就定了（见 `core/crafting/Smithing.ts`）
 *  - 产物槽由 `refresh` 写出来，**只能取不能放**
 *  - 取走产物时扣材料（这里只扣右格 1 个锭，左格整件被消耗）
 *
 * 与铁砧不同的两点：
 *  - **不消耗经验**（原版锻造台不要等级）
 *  - 不保留"名字输入框"（改名是铁砧的事）
 */

import { SMITHING_INGOT_COST, combineOnSmithing, type SmithingOutcome } from '../crafting/Smithing.ts';
import { reason, type ReasonRef } from './reason.ts';
import type { ItemStack, SlotSource } from './Inventory.ts';

export const SMITHING_EQUIPMENT = 0;
export const SMITHING_MATERIAL = 1;
export const SMITHING_RESULT = 2;
export const SMITHING_SIZE = 3;

export class SmithingTable implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(SMITHING_SIZE).fill(null);

  onChange: (() => void) | null = null;

  /** 当前算出来的结果；不可行时为 null（界面拿它显示提示） */
  outcome: SmithingOutcome | null = null;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= SMITHING_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= SMITHING_SIZE) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.refresh();
  }

  /** 左格：要升级的钻石装备 */
  get equipment(): ItemStack | null {
    return this.get(SMITHING_EQUIPMENT);
  }

  /** 右格：下界合金锭 */
  get material(): ItemStack | null {
    return this.get(SMITHING_MATERIAL);
  }

  /** 重算产物。两格任一变化都要调一次 */
  refresh(): void {
    this.outcome = combineOnSmithing(this.equipment, this.material);
    this.slots[SMITHING_RESULT] = this.outcome ? { ...this.outcome.output } : null;
    this.onChange?.();
  }

  /**
   * 取走产物：消耗左格整件、右格扣掉 1 个锭。
   *
   * 顺序照铁砧那条经验：**先算结果、再留产物快照、最后扣材料**——
   * 任何一步失败都不改动任何东西（东西没了又没拿到产物是最恼人的 bug）。
   */
  take(): { ok: true; output: ItemStack } | { ok: false; reason: ReasonRef } {
    const outcome = combineOnSmithing(this.equipment, this.material);
    if (!outcome) return { ok: false, reason: reason('station.reason.noResult') };

    const output: ItemStack = { ...outcome.output };
    if (outcome.output.enchants) output.enchants = { ...outcome.output.enchants };

    // 左格整件被消耗（升级是"改造"，不是"复制"）
    this.slots[SMITHING_EQUIPMENT] = null;
    const material = this.slots[SMITHING_MATERIAL];
    if (material) {
      material.count -= SMITHING_INGOT_COST;
      if (material.count <= 0) this.slots[SMITHING_MATERIAL] = null;
    }

    this.outcome = null;
    this.refresh();
    return { ok: true, output };
  }
}
