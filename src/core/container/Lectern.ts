/**
 * 讲台的容器状态（J25，批次 191）
 *
 * 讲台只有**一格**：摊在上面的那本书（书与笔或成书）。另外记一个**当前页**——
 * 原版把它放在方块状态的低 4 位（0~15），这里跟着容器走：
 * 页数是由书里的 `pages` 决定的（最多 50 页），而方块状态我们只留了 1 字节给形状/朝向，
 * 塞不下 50 档；更重要的是**读档时两者必须一致**，放在同一份数据里就不会对不上。
 *
 * 三处与原版的差异（都写在 TASKS J25）：
 *  1. **不在世界里画书页文字**：原版摊开的那本书上能直接看到字。本项目没有"在方块表面
 *     画动态文字"的能力（告示牌是整块平面贴图，讲台的书页是斜的），所以改成
 *     "右击打开阅读界面"——功能等价，少了"远远看一眼"的那点味道；
 *  2. **翻页在界面里**（左/右翻页键），不是原版那样"每右击一次翻一页"；
 *  3. 潜行右击把书收回来（与原版一致）。
 */

import { bookPages, isWritableBook, isWrittenBook } from '../items/Book.ts';
import type { ItemStack, SlotSource } from './Inventory.ts';

export const LECTERN_SLOT = 0;
export const LECTERN_SIZE = 1;

export class Lectern implements SlotSource {
  private slots: (ItemStack | null)[] = new Array<ItemStack | null>(LECTERN_SIZE).fill(null);

  onChange: (() => void) | null = null;

  /** 当前翻到第几页（0 基；读档时会被夹到页数范围内） */
  page = 0;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= LECTERN_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= LECTERN_SIZE) return;
    // 只有书能放上讲台（与 `accepts` 同一套判据，避免"漏斗塞进一块石头"）
    const next = stack && stack.count > 0 && this.accepts(stack) ? stack : null;
    this.slots[index] = next;
    this.clampPage();
    this.onChange?.();
  }

  /** 摊着的那本书（没有就 null） */
  get book(): ItemStack | null {
    return this.get(LECTERN_SLOT);
  }

  /** 它接不接受这件东西（书与笔 / 成书） */
  accepts(stack: ItemStack): boolean {
    return isWritableBook(stack) || isWrittenBook(stack);
  }

  /** 这本书一共几页（没放书时按 1 页算，界面不会出现"0 / 0 页"） */
  get pageCount(): number {
    const book = this.book;
    return book ? bookPages(book).length : 1;
  }

  /** 翻页（夹在 0 ~ 页数-1；返回翻完之后在第几页） */
  turnPage(delta: number): number {
    this.page = Math.max(0, Math.min(this.pageCount - 1, this.page + delta));
    this.onChange?.();
    return this.page;
  }

  /** 直接跳到某一页（阅读界面关掉时把"玩家停在哪一页"记下来） */
  setPage(page: number): void {
    this.page = Math.max(0, Math.min(this.pageCount - 1, Math.floor(page)));
    this.onChange?.();
  }

  /**
   * 把书放上讲台。
   *
   * @returns 放上去之后**手里还剩几本**（书本来不可堆叠，所以通常就是 0）；
   *          台面上已经有书时返回 -1（不替换，玩家得先把旧的拿走）
   */
  place(stack: ItemStack): number {
    if (!this.accepts(stack)) return -1;
    if (this.book) return -1;
    const placed: ItemStack = { ...stack, count: 1 };
    this.slots[LECTERN_SLOT] = placed;
    this.page = 0;
    this.onChange?.();
    return Math.max(0, stack.count - 1);
  }

  /** 把书拿下来（没有就返回 null） */
  take(): ItemStack | null {
    const book = this.book;
    if (!book) return null;
    this.slots[LECTERN_SLOT] = null;
    this.page = 0;
    this.onChange?.();
    return book;
  }

  private clampPage(): void {
    const max = this.pageCount - 1;
    if (this.page > max) this.page = Math.max(0, max);
    if (this.page < 0) this.page = 0;
  }
}
