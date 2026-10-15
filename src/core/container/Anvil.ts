/**
 * 铁砧的容器状态（H8）
 *
 * 三格：左（要改造的物品）/ 右（材料、附魔书或同种装备）/ 产物。
 * 与熔炉的"每 tick 推进"不同，铁砧是**纯函数式**的：只要左右两格与名字定了，
 * 产物与代价就定了（见 `core/crafting/Anvil.ts`）。所以这里只负责三件事：
 *  1. 存三格 + 名字输入框的内容；
 *  2. 每次变化重算产物（`refresh`）；
 *  3. 取走产物时扣材料、扣等级、写累积惩罚。
 *
 * 产物槽由 `refresh` 写出来，**只能取不能放**：产物是左右两格算出来的，
 * 允许手动放进去就会出现"产物与输入对不上"的鬼状态。
 */

import { combineOnAnvil, type AnvilOutcome } from '../crafting/Anvil.ts';
import type { ItemStack, SlotSource } from './Inventory.ts';

export const ANVIL_LEFT = 0;
export const ANVIL_RIGHT = 1;
export const ANVIL_RESULT = 2;
export const ANVIL_SIZE = 3;

export type AnvilTakeResult =
  | { ok: true; output: ItemStack; cost: number }
  | { ok: false; reason: string };

export class Anvil implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(ANVIL_SIZE).fill(null);

  onChange: (() => void) | null = null;

  /** 名字输入框里的内容（空串 = 不改名） */
  name = '';

  /** 当前算出来的结果；不可行时为 null（界面拿它显示代价与提示） */
  outcome: AnvilOutcome | null = null;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= ANVIL_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= ANVIL_SIZE) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.refresh();
  }

  /** 左边的物品 */
  get left(): ItemStack | null {
    return this.get(ANVIL_LEFT);
  }

  /** 右边的材料/附魔书 */
  get right(): ItemStack | null {
    return this.get(ANVIL_RIGHT);
  }

  setName(name: string): void {
    if (this.name === name) return;
    this.name = name;
    this.refresh();
  }

  /** 重算产物。左右两格或名字一变就要调一次 */
  refresh(): void {
    this.outcome = combineOnAnvil(this.left, this.right, this.name);
    this.slots[ANVIL_RESULT] = this.outcome ? { ...this.outcome.output } : null;
    this.onChange?.();
  }

  /**
   * 取走产物。
   *
   * 顺序很讲究：**先算结果、再查等级、再扣等级、最后扣材料**——
   * 任何一步失败都返回原因且不改动任何东西（扣了等级又没拿到东西是最恼人的 bug）。
   *
   * @param consumeLevels 扣等级的出口（界面不持有 `Experience`，由主程序提供）
   * @returns 成功时给出"应该放到光标上的物品"
   */
  take(playerLevel: number, consumeLevels: (levels: number) => boolean): AnvilTakeResult {
    const outcome = combineOnAnvil(this.left, this.right, this.name);
    if (!outcome) return { ok: false, reason: '没有可产出的结果' };
    if (playerLevel < outcome.cost) return { ok: false, reason: `需要 ${outcome.cost} 级经验` };

    // 先留一份产物快照：后面的 refresh 会把产物槽重算成"下一轮"的结果
    const output: ItemStack = { ...outcome.output };
    if (outcome.output.enchants) output.enchants = { ...outcome.output.enchants };

    if (!consumeLevels(outcome.cost)) return { ok: false, reason: `需要 ${outcome.cost} 级经验` };

    // 扣材料：两格各消耗 1 个（附魔书也是消耗 1 本，原版行为）
    for (const index of [ANVIL_LEFT, ANVIL_RIGHT]) {
      const stack = this.slots[index];
      if (!stack) continue;
      stack.count -= 1;
      if (stack.count <= 0) this.slots[index] = null;
    }

    this.outcome = null;
    this.refresh();
    return { ok: true, output, cost: outcome.cost };
  }
}
