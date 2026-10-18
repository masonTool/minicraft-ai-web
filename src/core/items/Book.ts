/**
 * 书与笔 / 成书（批次 190，H16 的第一块）
 *
 * 这一块把"物品带一段文字"这件事做成**纯数据 + 几个纯函数**，界面只负责输入与翻页：
 *
 *  书 + 墨囊 + 羽毛 → **书与笔**（可写，`pages` 一页一段）
 *  写完点「署名」→ **成书**（`id` 换成成书、`title` 记下书名，从此只读）
 *
 * 三处刻意的取舍：
 *  1. **每页 256 字 / 最多 50 页**：原版是 1023 字 / 100 页，但我们的翻页界面一页装不下
 *     那么多字（装不下就会滚动，手机上很别扭）。截短的好处是"看到的就是存下的"；
 *  2. **`pages` 与 `title` 都是可选字段**：没写过的书不带它们，存档里不会多出一片 `pages: []`；
 *  3. **成书只读**：`signBook` 之后再改只能靠"书与笔 + 成书"的复制配方（还没做，见 TASKS H16）。
 *
 * ⚠️ 与 `Inventory.restoreStack` 的分工：那边做**存档校验**（认不出的丢掉），
 * 这里做**编辑期的规整**（裁长度、去空页）。两处都要过 `sanitizePage`，
 * 否则会出现"界面里能打 300 字、读档回来只剩 256 字"这种前后不一致。
 */

import { Item } from '../registry/items.ts';
import type { ItemStack } from '../container/Inventory.ts';

/** 每页最多多少字（换行也算一个字） */
export const BOOK_PAGE_CHARS = 256;
/** 一本书最多多少页 */
export const BOOK_MAX_PAGES = 50;
/** 书名最多多少字 */
export const BOOK_TITLE_CHARS = 32;
/** 成书没写书名时的兜底 */
export const UNTITLED_BOOK = '未命名的书';

/**
 * 规整一页文字：去掉回车与控制字符、把连续空行压到最多一个、截到 `BOOK_PAGE_CHARS`。
 *
 * 为什么要去控制字符：玩家可以从别处粘贴一段带 `\u0000`/`\u0007` 的文本，
 * 那些字在界面里看不见、存进存档又会让"两份内容不同的书"比较出怪结果。
 */
export function sanitizePage(text: string): string {
  // \r\n → \n；再去掉除换行之外的所有 C0 控制字符与 DEL
  const normalized = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
  // 连续三个以上换行压成一个空行（原版书页也留不住大段空白）
  const compact = normalized.replace(/\n{3,}/g, '\n\n');
  return compact.slice(0, BOOK_PAGE_CHARS);
}

/**
 * 规整整本书的页：逐页 sanitize、去掉末尾的空页、最多 `BOOK_MAX_PAGES` 页。
 *
 * @returns 至少一页（全空时是 `['']`）；调用方想判断"这本书是不是空的"用 `isBlankBook`
 */
export function sanitizePages(pages: readonly string[]): string[] {
  const cleaned = pages.slice(0, BOOK_MAX_PAGES).map((page) => sanitizePage(page));
  while (cleaned.length > 1 && cleaned[cleaned.length - 1] === '') cleaned.pop();
  return cleaned.length > 0 ? cleaned : [''];
}

/** 这本书是不是一个字都没写 */
export function isBlankBook(pages: readonly string[]): boolean {
  return pages.every((page) => page.trim() === '');
}

/** 这一叠是不是书与笔（可写） */
export function isWritableBook(stack: ItemStack | null | undefined): boolean {
  return stack !== undefined && stack !== null && stack.id === Item.BOOK_AND_QUILL;
}

/** 这一叠是不是成书（只读） */
export function isWrittenBook(stack: ItemStack | null | undefined): boolean {
  return stack !== undefined && stack !== null && stack.id === Item.WRITTEN_BOOK;
}

/** 取一份页的副本（没写过 → `['']`，界面上就是一张空白页） */
export function bookPages(stack: ItemStack): string[] {
  return stack.pages && stack.pages.length > 0 ? [...stack.pages] : [''];
}

/** 成书的书名（没写 → `未命名的书`） */
export function bookTitleOf(stack: ItemStack): string {
  const title = stack.title?.trim();
  return title && title.length > 0 ? title : UNTITLED_BOOK;
}

/**
 * 把页写回一份**新的**栈（不改原对象）。
 *
 * 为什么返回新对象而不是原地改：物品栏里那一格可能同时被界面、掉落物、箱子持有，
 * 原地改会让"已经取出的快照"跟着变（与 `stackExtras` 同一条理由）。
 */
export function withPages(stack: ItemStack, pages: readonly string[]): ItemStack {
  const next: ItemStack = { id: stack.id, count: stack.count };
  // 除了 id / count 与这两个字段，其余附加数据原样带过去（耐久/附魔/改名/内容物…）。
  // ⚠️ 不要写成 `{...stack}` 再删字段：那就把 `pages` 的**引用**带过去了
  for (const key of Object.keys(stack) as (keyof ItemStack)[]) {
    if (key === 'id' || key === 'count' || key === 'pages' || key === 'title') continue;
    (next as unknown as Record<string, unknown>)[key] = stack[key];
  }
  const cleaned = sanitizePages(pages);
  if (!isBlankBook(cleaned)) next.pages = cleaned;
  return next;
}

/**
 * 署名：书与笔 → 成书。
 *
 * @returns 新的成书栈；**一页都没写**时返回 `null`（原版也不让署空白书）
 */
export function signBook(stack: ItemStack, title: string): ItemStack | null {
  if (!isWritableBook(stack)) return null;
  const pages = sanitizePages(bookPages(stack));
  if (isBlankBook(pages)) return null;
  const signed = withPages(stack, pages);
  signed.id = Item.WRITTEN_BOOK;
  signed.title = (title.trim() || UNTITLED_BOOK).slice(0, BOOK_TITLE_CHARS);
  return signed;
}
