/**
 * 砂轮的容器状态（H15 / J25）
 *
 * 三格：左（要洗的物品）/ 右（可选：同种装备，用来拼耐久）/ 产物。
 * 与铁砧同构——**纯函数式**：两格定了，产物与返还经验就定了
 * （见 `core/crafting/Grindstone.ts`）。所以这里只负责：
 *  1. 存三格；
 *  2. 每次变化重算产物（`refresh`）；
 *  3. 取走产物时扣掉两格的各 1 件，并把"该返还多少经验"报给调用方。
 *
 * 产物槽由 `refresh` 写出来，**只能取不能放**：产物是两格算出来的，
 * 允许手动放进去就会出现"产物与输入对不上"的鬼状态。
 *
 * ⚠️ 返还的经验**不在这里直接加**：容器不知道经验系统、更不知道玩家站在哪，
 * 与熔炉攒的烧炼经验同一条口径——`take()` 只把数字报出去，加经验由主程序做。
 *
 * ⚠️ 与原版的差异：砂轮登记进了 `CONTAINER_BLOCKS` 与 `containerOfBlockAt`，
 * 后者同时是**漏斗的投递目标**——所以本项目的漏斗能给砂轮塞东西
 * （原版不行）。这一条是"拆方块时把台面上的东西还给你"换来的：
 * 不登记的话，拆掉砂轮会把两格里的东西静默吞掉。
 */

import { grindOnGrindstone, type GrindstoneOutcome } from '../crafting/Grindstone.ts';
import type { ItemStack, SlotSource } from './Inventory.ts';

export const GRINDSTONE_LEFT = 0;
export const GRINDSTONE_RIGHT = 1;
export const GRINDSTONE_RESULT = 2;
export const GRINDSTONE_SIZE = 3;

export type GrindstoneTakeResult =
  | { ok: true; output: ItemStack; xp: number }
  | { ok: false; reason: string };

export class Grindstone implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(GRINDSTONE_SIZE).fill(null);

  onChange: (() => void) | null = null;

  /** 当前算出来的结果；不可行时为 null（界面拿它显示提示） */
  outcome: GrindstoneOutcome | null = null;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= GRINDSTONE_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= GRINDSTONE_SIZE) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.refresh();
  }

  /** 左格（要洗的物品） */
  get left(): ItemStack | null {
    return this.get(GRINDSTONE_LEFT);
  }

  /** 右格（同种装备，可选） */
  get right(): ItemStack | null {
    return this.get(GRINDSTONE_RIGHT);
  }

  /** 重算产物。两格一变就要调一次 */
  refresh(): void {
    this.outcome = grindOnGrindstone(this.left, this.right);
    this.slots[GRINDSTONE_RESULT] = this.outcome ? { ...this.outcome.output } : null;
    this.onChange?.();
  }

  /**
   * 取走产物。
   *
   * 顺序照铁砧那条经验：**先重算、再留产物快照、最后扣输入**——
   * 任何一步失败都不改动任何东西（"东西被吃掉却没拿到产物"是最恼人的 bug）。
   * 砂轮**不收经验、只返还经验**，所以没有等级校验那一步。
   */
  take(): GrindstoneTakeResult {
    const outcome = grindOnGrindstone(this.left, this.right);
    if (!outcome) return { ok: false, reason: '没有可产出的结果' };

    const output: ItemStack = { ...outcome.output };
    if (outcome.output.contents) output.contents = outcome.output.contents.map((entry) => (entry ? { ...entry } : null));

    // 扣输入：两格各消耗 1 件（原版砂轮也只吃单件）
    for (const index of [GRINDSTONE_LEFT, GRINDSTONE_RIGHT]) {
      const stack = this.slots[index];
      if (!stack) continue;
      stack.count -= 1;
      if (stack.count <= 0) this.slots[index] = null;
    }

    this.outcome = null;
    this.refresh();
    return { ok: true, output, xp: outcome.xp };
  }
}
