/**
 * 创造物品栏的**搜索与分页**（纯函数）
 *
 * 为什么单独一层：创造栏的物品来自游戏注册表（上千条），页签与搜索是"筛出来再摆进 12 列网格"。
 * 这一步与绘制无关、与 DOM 无关，全是数据变换 —— 正好可以离线断言，也免得把过滤逻辑
 * 散在宿主里（那样每加一个入口就要重写一遍）。
 *
 * 约定：`nameOf` 由调用方注入（名字在 `core` 的 i18n 表里，`ui2d` 不依赖 `core`）。
 */

/** 一页几行（网格是 12 列 × 5 行，与 `CREATIVE_LAYOUT` 的默认值一致） */
export const CREATIVE_PAGE_SIZE = 12 * 5;

/**
 * 把用户输入规整成可比较的形式：去空白、转小写。
 *
 * 不做拼音/模糊匹配：用户输入的是**物品名**，而且中英文都要能搜 —— 统一按"包含"比就够，
 * 做模糊匹配反而会把"石"搜出"钻石"。
 */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** 物品名是否命中搜索词（空搜索全部命中） */
export function matchesQuery(name: string, query: string): boolean {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return true;
  return name.toLowerCase().includes(needle);
}

export interface CreativeFilterOptions<T> {
  /** 搜索词（空 = 不过滤） */
  readonly query: string;
  /** 取名字（i18n 后的可显示名字） */
  readonly nameOf: (item: T) => string;
  /** 所属页签（不传 = 不按页签过滤） */
  readonly tabOf?: (item: T) => string;
  /** 当前页签（配合 `tabOf`；不传 = 全部页签） */
  readonly tab?: string;
}

/**
 * 按页签 + 搜索词筛物品，**保持输入顺序**（注册表顺序就是玩家熟悉的顺序）。
 */
export function filterCreativeItems<T>(items: readonly T[], options: CreativeFilterOptions<T>): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (options.tab !== undefined && options.tabOf && options.tabOf(item) !== options.tab) continue;
    if (!matchesQuery(options.nameOf(item), options.query)) continue;
    out.push(item);
  }
  return out;
}

/** 总页数（至少 1 页：空结果也要显示"第 1 / 1 页"而不是 0 页） */
export function creativePageCount(total: number, pageSize: number = CREATIVE_PAGE_SIZE): number {
  if (!(pageSize > 0) || total <= 0) return 1;
  return Math.ceil(total / pageSize);
}

/**
 * 取某一页（页号从 0 起，越界自动夹住）。
 *
 * 越界夹取很重要：搜索词一变，页数就变，玩家停在"第 5 页"时搜一个只有 3 个结果的词，
 * 不夹的话会得到一屏空白。
 */
export function creativePageSlice<T>(
  items: readonly T[],
  page: number,
  pageSize: number = CREATIVE_PAGE_SIZE,
): T[] {
  const size = Math.max(1, Math.floor(pageSize));
  const pages = creativePageCount(items.length, size);
  const safePage = Number.isFinite(page) ? Math.min(pages - 1, Math.max(0, Math.floor(page))) : 0;
  return items.slice(safePage * size, safePage * size + size);
}

/**
 * 把一页物品铺成 12 列网格需要的数组（不足补 `null`）。
 *
 * 补 `null` 而不是返回短数组：网格要画固定数量的格子（空格也是格子），
 * 让绘制层自己去"补空"会把布局与内容的边界弄模糊。
 */
export function fillCreativeGrid<T>(page: readonly T[], columns: number, rows: number): (T | null)[] {
  const total = Math.max(0, columns) * Math.max(0, rows);
  const out: (T | null)[] = [];
  for (let i = 0; i < total; i += 1) out.push(page[i] ?? null);
  return out;
}
