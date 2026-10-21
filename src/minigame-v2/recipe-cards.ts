/**
 * 配方卡列表（生存模式的左栏）——**"用背包里的材料能做出什么"**。
 *
 * 与创造栏的区别（这是外部端 `InventoryScreen.craftableIds()` 的口径，批次 206 用户澄清）：
 *   创造栏 = "我有什么"（直接列物品）
 *   这一栏 = "我能做出什么"（按背包材料反查配方）
 *
 * 规则全部复用 `core/crafting/RecipeBook.ts` 的纯函数：
 * `canCraft`（够不够）、`recipeIngredients`（要什么）、`recipeGridSize`（放不放得下）。
 * 这里只做两件事：**筛出这一页该显示的配方**、**翻页/分类/搜索**。
 *
 * ⚠️ 为什么单独一个模块：`craftableIds()` 要遍历 600+ 条配方，而界面每次搬东西都会
 * 重画一次。把它抽成纯函数之后，既能按"指纹"缓存，也能离线断言
 * （"背包里 1 个原木能做出木板"这种，不开浏览器就能验）。
 */

import { RECIPES, type Recipe } from '../core/crafting/Recipes.ts';
import { canCraft, recipeGridSize } from '../core/crafting/RecipeBook.ts';
import { categoryOf } from '../core/registry/items.ts';
import { itemLabel } from '../core/registry/itemNames.ts';
import type { V2CreativeCategory } from './inventory-catalog.ts';

/** 一条卡片要显示的东西 */
export interface RecipeCard {
  resultId: number;
  /** 产物数量（配方一次产出几个） */
  resultCount: number;
  /** 现在能不能做（材料够 + 合成格放得下） */
  craftable: boolean;
  /** 缺什么（够的时候是空数组）——卡片上写"缺 2 木板"用 */
  missing: Array<{ id: number; need: number; have: number }>;
  /** 材料够了、但这条配方要 3×3（背包里的 2×2 做不了） */
  needsTable?: boolean;
}

export interface CraftableOptions {
  /** 当前合成格的边长（2 = 背包内 2×2、3 = 工作台）；放不下的配方不能标"可做" */
  gridSize: 2 | 3;
  /** 分类过滤；`all` = 不过滤 */
  category: V2CreativeCategory;
  /** 搜索词（按**产物名**搜，不是材料名） */
  query: string;
  /**
   * 是否连"做不出来的也列出来"。
   *
   * 外部端有这颗开关（白底 = 能做、红底 = 缺料）。v2 默认**只列能做的**，
   * 打开就全列 —— 对齐外部端的"配方书开关"。
   */
  showUncraftable?: boolean;
}

/**
 * 把一条配方归到哪个分类。
 *
 * 用**产物**的分类（与创造栏同一套 `categoryOf`）：这样"木板"永远在"建筑"里，
 * 不会出现"同一个东西在创造栏和配方书里归到两页"（外部端 `RecipeBook.ts` 也强调过这点）。
 */
function categoryOfRecipe(recipe: Recipe): V2CreativeCategory {
  const cat = categoryOf(recipe.result.id);
  switch (cat) {
    case 'building':
      return 'building';
    case 'tools':
    case 'armor':
      return 'equipment';
    case 'natural':
    case 'wool':
    case 'food':
      return 'nature';
    default:
      return 'items';
  }
}

/**
 * 算出当前该显示哪些配方卡。
 *
 * @param countOf 某物品在**背包 + 合成格**里的总数（外部端就是这么算的：只看背包的话，
 *                点一条配方把材料挪进格子之后，这条配方会立刻变成"缺料"、列表红掉）
 */
export function craftableCards(countOf: (itemId: number) => number, options: CraftableOptions): RecipeCard[] {
  const query = options.query.trim().toLowerCase();
  const source = { countOf };
  const seen = new Set<number>();
  const cards: RecipeCard[] = [];

  for (const recipe of RECIPES) {
    const resultId = recipe.result.id;
    // 同一个产物只留一条（配方表里木板有多种摆法，列表里重复出现只是噪声）
    if (seen.has(resultId)) continue;

    if (options.category !== 'all' && categoryOfRecipe(recipe) !== options.category) continue;
    if (query && !itemLabel(resultId).toLowerCase().includes(query)) continue;

    // 合成格放不下（3×3 配方在 2×2 里做不出来）→ 不能算"可做"，
    // 但仍可能是"缺料"那一档要显示的
    const fits = recipeGridSize(recipe) <= options.gridSize;
    const check = canCraft(source, recipe);
    const craftable = fits && check.ok;
    if (!craftable && !options.showUncraftable) continue;

    seen.add(resultId);
    cards.push({
      resultId,
      resultCount: recipe.result.count,
      craftable,
      // ⚠️ 缺料信息**不管放不放得下都要留着**：第一版写成 `fits ? check.missing : []`，
      // 于是 3×3 配方在 2×2 下永远显示"需要工作台"，
      // 明明还差 5 个圆石却不说 —— 玩家会以为材料够了、只是缺工作台。
      missing: check.missing,
      /** 材料够但格子放不下（3×3 配方在背包的 2×2 里） */
      needsTable: !fits && check.ok,
    });
  }

  // 能做的排前面（外部端也是这个顺序），同类里按 id 稳定排
  cards.sort((a, b) => (a.craftable === b.craftable ? a.resultId - b.resultId : a.craftable ? -1 : 1));
  return cards;
}

/** 一页能放几张卡（按可用高度算行数，3 列） */
export function recipePageSize(availableHeight: number, cardHeight: number): number {
  const rows = Math.max(1, Math.floor(availableHeight / cardHeight));
  return rows * 3;
}

/** 把页码夹进合法范围（搜索/换分类之后页码可能越界） */
export function clampPage(page: number, total: number, pageSize: number): number {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return Math.max(0, Math.min(page, pages - 1));
}

/**
 * 卡片底部那行小字。
 *
 * 三种情况分开说（顺序有讲究：**缺料优先于"需要工作台"**）：
 *  1. 材料都不够 → "缺 X ×n"（这时候说"需要工作台"是误导）
 *  2. 材料够、但 3×3 才能摆 → "需要工作台"
 *  3. 都能做 → 空串
 */
export function missingHint(card: RecipeCard): string {
  if (card.craftable) return '';
  if (card.missing.length > 0) {
    const first = card.missing[0]!;
    return `缺 ${itemLabel(first.id)} ×${first.need - first.have}`;
  }
  if (card.needsTable) return '需要工作台';
  return '缺材料';
}
