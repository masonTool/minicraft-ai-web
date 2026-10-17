/**
 * 物品网格的分页（界面适配：PC 与手机都要用）
 *
 * 为什么需要：创造物品栏原来一次性把**匹配到的全部物品**建进 DOM——
 * "全部"分类是 **495 件**，每件一个 `<canvas>` 图标 + 一个槽位 + 一个指针监听。
 * 桌面端还能忍（12 列滚 42 行），手机上打开背包会明显卡顿，而且四十多行里根本找不到东西。
 *
 * 三个决策：
 *  1. **页大小按屏幕给**（12 列 × 5 行 = 60 / 8 列 × 4 行 = 32），
 *     与 CSS 里的列数保持一致——不一致的话最后一行会出现"半行空位"看着像 bug。
 *  2. **分页是纯函数**（`pageCount` / `clampPage` / `slicePage`），能离线断言；
 *     界面只负责把结果铺出来。
 *  3. **不改搜索与分类的语义**：它们先筛出完整列表，分页只切这一份列表的窗口。
 *     所以"搜到 5 件"时只有一页，翻页条自动隐藏。
 */

/** 宽屏（PC / 平板横屏）每页条数：12 列 × 5 行，与 `.inv-grid.inv-creative` 的列数一致 */
export const PAGE_SIZE_WIDE = 60;
/** 窄屏（手机竖屏等）每页条数：8 列 × 4 行，与窄屏媒体查询里的列数一致 */
export const PAGE_SIZE_NARROW = 32;

/**
 * **卡片列表**的每页条数（配方书用）。
 *
 * 与格子网格分开定：一张配方卡比一个 34px 的格子高得多（要画摆放用的 2×2/3×3 小格、
 * 产物、材料与按钮），一页 60 张会滚到天边。
 * 值也不是拍脑袋来的——配方卡画满 181 张要 435ms（1348 个小格），
 * 分页之后只画一页，重建降到可忽略（见 `test:ui` 与 `ui-acceptance`）。
 */
export const CARD_PAGE_SIZE_WIDE = 18;
export const CARD_PAGE_SIZE_NARROW = 8;
/** 窄屏判定阈值（px）：与 CSS 里那个 `@media (max-width: 900px)` 是同一个数 */
export const NARROW_MAX_WIDTH = 900;

/**
 * 配方书**嵌在背包左栏**时的每页条数（批次 157）：7 列 × 4 行。
 *
 * 左栏只有面板的一半宽（约 340px），12 列 / 8 列都塞不下——塞不下就是横向被裁，
 * 而"界面不许横滑"这条规矩不能破。列数与页大小必须一起给：
 * 不一致的话最后一行会出现半行空位（见文件头那条第 1 条）。
 */
export const RECIPE_PANE_COLUMNS = 7;
export const RECIPE_PANE_PAGE_SIZE = RECIPE_PANE_COLUMNS * 4;

/** 这个宽度算不算窄屏 */
export function isNarrowViewport(width: number): boolean {
  return width <= NARROW_MAX_WIDTH;
}

/** 该视口下每页显示多少件 */
export function pageSizeFor(width: number): number {
  return isNarrowViewport(width) ? PAGE_SIZE_NARROW : PAGE_SIZE_WIDE;
}

/** 该视口下每页显示多少张卡片（配方书这类列表） */
export function cardPageSizeFor(width: number): number {
  return isNarrowViewport(width) ? CARD_PAGE_SIZE_NARROW : CARD_PAGE_SIZE_WIDE;
}

/** 一共几页（空列表也算 1 页，这样"第 1/1 页 · 共 0 件"说的是人话） */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  if (total <= 0) return 1;
  return Math.ceil(total / pageSize);
}

/** 把页码夹到合法范围（换分类、改搜索词、屏幕旋转后都可能越界） */
export function clampPage(page: number, total: number, pageSize: number): number {
  const last = pageCount(total, pageSize) - 1;
  if (!Number.isFinite(page)) return 0;
  return Math.max(0, Math.min(last, Math.floor(page)));
}

/** 取第 `page` 页的内容（越界时先夹一次，所以永远拿到合法片段） */
export function slicePage<T>(items: readonly T[], page: number, pageSize: number): readonly T[] {
  const safe = clampPage(page, items.length, pageSize);
  const start = safe * pageSize;
  return items.slice(start, start + pageSize);
}

/** 翻页条上要显示的那句话 */
export function pageLabel(page: number, total: number, pageSize: number): string {
  const pages = pageCount(total, pageSize);
  const current = clampPage(page, total, pageSize) + 1;
  return `第 ${current}/${pages} 页 · 共 ${total} 件`;
}
