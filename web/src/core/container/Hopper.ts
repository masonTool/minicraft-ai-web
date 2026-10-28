/**
 * 漏斗（批次 58，H14 的第一件"传输型"容器）
 *
 * 5 格容器 + 一套**搬运节奏**，对齐原版：
 *  - 每 **8 游戏刻（0.4 秒）**搬一件，因此 `tick(dt)` 收的是秒；
 *  - 一个周期里**先推后拉**（原版 `HopperBlockEntity#tick` 就是这个顺序）：
 *    ① 自己不为空 → 往**朝向那一格**的容器里推一件；
 *    ② 自己没满 → 从**头顶那一格**的容器里拉一件，再顺手把头顶的掉落物吸一件；
 *  - **被红石锁定**时什么都不做（原版：通着电的漏斗既不推也不吸）。
 *
 * 三处刻意的取舍（都写在对应注释里，也记在 TASKS H14）：
 *  1. "哪些格子能塞"不在这里判断，而是交给 `Transfer.ts`——漏斗只负责
 *     "推/拉各一件、按节奏走"；
 *  2. 5 格里**没有**区分原版的"第 1 格只能从上方灌进来"（`HOPPER_TOP_SLOT` 只是
 *     界面给玩家的提示位，搬运逻辑一视同仁）；
 *  3. 搬运时**不生成/不销毁物品**：推出去的那一件从自己的槽里扣掉，
 *     拉进来的那一件从对方的槽里扣掉——两边任一环节失败就整件事取消（见 `pushOut`）。
 */

import type { ItemStack, SlotSource } from './Inventory.ts';
import { sameExtras } from './Inventory.ts';
import { peekTake, takeOne, tryInsertOne } from './Transfer.ts';
import { maxStackOf } from '../registry/items.ts';
import type { BlockContainer } from '../world/BlockEntityStore.ts';

/** 漏斗的 5 格（原版就是 5 格：1 个"上方口" + 4 个横向格） */
export const HOPPER_SIZE = 5;

/**
 * 5 格里的第 1 格（原版只有它能被"从上方灌进来"的物品占用）。
 *
 * ⚠️ 本项目**没有**实现这条限制（搬运逻辑对所有格一视同仁），这个常量只用于
 * 界面上的分组提示与调试读数——所以它不参与任何搬运判定。
 */
export const HOPPER_TOP_SLOT = 0;

/** 搬运节奏：原版每 8 游戏刻一件 = 0.4 秒 */
export const HOPPER_TRANSFER_SECONDS = 0.4;

/** 搬运需要问外界的三个问题（掉落物与"哪一格是什么容器"都只有主程序知道） */
export interface HopperEnv {
  /** 朝向那一格的容器（箱子/熔炉/另一个漏斗…）；没有就返回 null */
  target(): BlockContainer | null;
  /** 头顶那一格的容器（拉件用）；没有就返回 null */
  above(): BlockContainer | null;
  /**
   * 目标不是"格子容器"时的特殊投放（批次 555：堆肥桶）。
   *
   * 堆肥桶只有等级、没有 5 个槽，`tryInsertOne` 那套完全不适用。返回 true 表示
   * **这一件已经被目标吃掉**，漏斗应当从自己的槽里扣掉它；false 表示不接收。
   * 可选——老离线桩不给就是"没有特殊目标"。
   */
  tryPush?(stack: ItemStack): boolean;
  /**
   * 从头顶那一片掉落物里吸一件（主程序负责找范围、扣数量）。
   * 返回 null 表示头顶没有掉落物。**只能返回 count = 1 的栈**。
   */
  suck(): ItemStack | null;
}

export interface HopperTickResult {
  /** 内容变了（界面要重绘） */
  changed: boolean;
  /** 这个周期真的搬了东西 */
  moved: boolean;
  /** 被红石锁定（不搬运） */
  locked: boolean;
}

export class Hopper implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(HOPPER_SIZE).fill(null);

  /**
   * 距下次搬运还有多久（秒）。
   *
   * 放下时就是**满值**：新放的漏斗不该立刻动一件（原版放下后要等 8 刻），
   * 否则"刚放下就把手里的东西吸走"会让人以为出了 bug。
   */
  cooldown = HOPPER_TRANSFER_SECONDS;

  /**
   * 被红石锁定（由主程序按方块状态写进来）。
   *
   * 为什么缓存在实例上：tick 循环是按容器实例推进的，它手里只有 `Hopper`，
   * 拿不到"脚下那一格通电了没"——与 `Furnace.station` 是同一套做法。
   */
  locked = false;

  /** 这辈子搬过多少件（调试面板与断言用） */
  movedCount = 0;

  onChange: (() => void) | null = null;
  /**
   * 槽位内容被改动（联机15）：与 `onChange` 分开。
   *
   * `onChange` 是界面刷新，`tick` 里"点燃状态变了"也会调它；联机只关心内容，
   * 而且远端恢复（逐格 `set` 写回）不该触发它——抑制由调用方做（`main.ts` 的 `applyingRemoteBlock`）。
   */
  onMutate: (() => void) | null = null;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= HOPPER_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= HOPPER_SIZE) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.onMutate?.();
    this.onChange?.();
  }

  get isEmpty(): boolean {
    return this.slots.every((slot) => slot === null);
  }

  get isFull(): boolean {
    return this.slots.every((slot) => slot !== null && slot.count >= maxStackOf(slot.id));
  }

  /** 有几格装着东西（界面提示与断言用） */
  get usedSlots(): number {
    return this.slots.filter((slot) => slot !== null).length;
  }

  /**
   * 直接塞一件进来（吸取掉落物用）。
   *
   * 顺序对齐原版：**先并进同类未满的堆**，再找第一个空槽；都不行就返回 false
   * （主程序据此决定"这件掉落物留在原地"）。
   */
  insert(stack: ItemStack): boolean {
    const slot = this.firstSlotFor(stack);
    if (slot < 0) return false;
    this.addAt(slot, stack);
    return true;
  }

  /** 这个栈塞得进来吗（预判，不产生副作用） */
  canInsert(stack: ItemStack): boolean {
    return this.firstSlotFor(stack) >= 0;
  }

  /**
   * 推进 dt 秒。
   *
   * ⚠️ 一个周期里最多搬**两个**件（推一件 + 拉一件），这是原版行为：
   * 所以"漏斗链"每 0.4 秒能整体往前挪一格，而不是每件都要等一个周期。
   */
  tick(dt: number, env: HopperEnv): HopperTickResult {
    const result: HopperTickResult = { changed: false, moved: false, locked: this.locked };

    if (this.locked) {
      // 锁定时把冷却保持在满值：解锁之后要重新数满一个周期才开始搬，
      // 而不是"解锁瞬间连搬好几件"（原版也是这个观感）
      this.cooldown = HOPPER_TRANSFER_SECONDS;
      return result;
    }

    this.cooldown -= dt;
    if (this.cooldown > 0) return result;
    this.cooldown = HOPPER_TRANSFER_SECONDS;

    let moved = false;

    // ① 先推：自己不为空就试着往朝向那一格送一件
    if (!this.isEmpty) {
      const target = env.target();
      // 普通容器优先；不是容器时再问特殊目标（堆肥桶），两者都没有就什么都不做
      if (target || env.tryPush) moved = this.pushOut(target, env);
    }

    // ② 再拉：头顶的容器、头顶的掉落物（顺序与原版 pullItems 一致）
    if (!this.isFull) {
      const above = env.above();
      if (above) moved = this.pullFrom(above) || moved;
      if (!this.isFull) {
        const stack = env.suck();
        if (stack && this.insert(stack)) moved = true;
      }
    }

    if (moved) {
      this.movedCount++;
      this.onChange?.();
      result.changed = true;
      result.moved = true;
    }
    return result;
  }

  /**
   * 往目标容器推一件。
   *
   * ⚠️ 顺序：从第 0 格往后找**第一个"目标收得下"的东西**。
   * 原版是从第一个非空槽开始试；这里退化成"继续往后试"，
   * 差别只出现在"自己混装了好几格、而目标只收其中某一种"的情形。
   */
  private pushOut(target: BlockContainer | null, env: HopperEnv): boolean {
    for (let index = 0; index < HOPPER_SIZE; index++) {
      const stack = this.slots[index];
      if (!stack) continue;
      // 特殊目标（堆肥桶）：它自己决定吃不吃这一件；吃完就从漏斗扣
      const special = env.tryPush?.(stack) ?? false;
      if (!special) {
        if (!target || !tryInsertOne(target, stack)) continue;
      }
      stack.count -= 1;
      if (stack.count <= 0) this.slots[index] = null;
      return true;
    }
    return false;
  }

  /**
   * 从头顶的容器拉一件。
   *
   * ⚠️ 顺序是"**先确认自己收得下**，再从对方槽里扣"——反过来写的话，
   * 自己刚好满的时候会把对方那一件白白扣掉（东西凭空消失）。
   */
  private pullFrom(above: BlockContainer): boolean {
    const pick = peekTake(above);
    if (!pick) return false;
    const slot = this.firstSlotFor(pick.stack);
    if (slot < 0) return false;
    const taken = takeOne(above, pick.slot);
    if (!taken) return false;
    this.addAt(slot, taken);
    return true;
  }

  /**
   * 这个栈该放进哪一格（同类未满 → 空槽 → -1）。
   *
   * ⚠️ "同类"要连**附加数据**一起比（`sameExtras`）：只比 id 的话，
   * 一件改了名 / 带耐久的工具并进普通那一堆时名字与附魔会**静默丢掉**。
   */
  private firstSlotFor(stack: ItemStack): number {
    const limit = maxStackOf(stack.id);
    let empty = -1;
    for (let index = 0; index < HOPPER_SIZE; index++) {
      const slot = this.slots[index];
      if (!slot) {
        if (empty < 0) empty = index;
        continue;
      }
      if (slot.id === stack.id && sameExtras(slot, stack) && slot.count < limit) return index;
    }
    return empty;
  }

  private addAt(index: number, stack: ItemStack): void {
    const current = this.slots[index];
    if (current) current.count += 1;
    else this.slots[index] = { ...stack, count: 1 };
    this.onChange?.();
  }
}
