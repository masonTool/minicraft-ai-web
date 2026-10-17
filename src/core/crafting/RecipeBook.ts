/**
 * 配方书（数据层）
 *
 * 界面要回答四个问题，这里把它们做成纯函数，方便离线测试：
 *  1. **一条配方要什么材料**（几个格子、每个格子几个）——形状配方要数 pattern 里的字符
 *  2. **背包里够不够**（缺什么、缺几个）——材料可能分散在 36 个槽位里
 *  3. **把配方摆进合成格**（`fillCraftingGrid`，批次 132）——**原版配方书点一条配方
 *     就是做这件事**：材料从背包挪进格子，摆法看得见、还能自己改，最后由输出格取成品
 *  4. **一键直接合成**（`craftFromInventory`）——不经过格子，给"批量做"留的快捷方式
 *
 * ⚠️ 第 3 条是**主交互**、第 4 条是**便捷**，两者都要有：只有 4 会看不见摆放过程
 *（与原版不符），只有 3 则"能做 5 次"要来回点五遍。
 */

import type { Inventory } from '../container/Inventory.ts';
import type { CraftingGrid } from './CraftingGrid.ts';
import { RECIPES, type Recipe, type RecipeResult } from './Recipes.ts';
import { SMELTING_RECIPES } from './Smelting.ts';
import { itemLabel } from '../registry/itemNames.ts';
import { categoryOf, itemName } from '../registry/items.ts';

// ---------------------------------------------------------------- 配方书的标签栏
//
// 批次 133：**基岩版的配方书是按标签栏分的**（中文 Wiki「物品栏 → 配方书」）：
//   建筑 / 装备 / 物品 / 自然 / 全部
// 并写明"合成配方书的标签栏与创造分类相同"。所以这里拿 `categoryOf`（创造分类）
// 做一次**归并**，而不是另立一套分类表——另立一套迟早与创造栏漂移
//（同一桶混凝土在两边归进不同页，玩家就得记两套）。

/**
 * **经典 UI** 的标签栏顺序（批次 136，照 Wiki 原文改）。
 *
 * 中文 Wiki「物品栏 → 配方书」逐条写了位置：
 *   建筑 —— 使用经典UI时为**最左侧第一个**标签栏
 *   装备 —— 经典UI时为**第二个**
 *   物品 —— 经典UI时为**左侧第三个**
 *   自然 —— （夹在物品与全部之间）
 *   全部 —— 使用经典UI时显示在**最右侧**，使用携带版UI时为顶部第一个
 *
 * ⚠️ 批次 133 只写了携带版那一套（"全部"在最前），与用户给的**经典 UI 截图**对不上。
 */
export const RECIPE_BOOK_TABS = ['building', 'equipment', 'items', 'nature', 'all'] as const;
/** **携带版 UI** 的顺序（Wiki："全部…使用携带版UI时为顶部第一个标签栏"） */
export const RECIPE_BOOK_TABS_POCKET = ['all', 'building', 'equipment', 'items', 'nature'] as const;
export type RecipeBookTab = (typeof RECIPE_BOOK_TABS)[number];

/**
 * 经典 UI 的判据宽度（px）：与 `index.html` 里 `body.split-ui` 那组规则的
 * `min-width: 1280px` **同一个数**——两边不一致会出现"画面已并排、页签还是按
 * 携带版排"这种一半对一半的情况。
 */
export const CLASSIC_UI_MIN_WIDTH = 1280;

/** 该视口走经典 UI（并排）还是携带版 UI（整屏） */
export function isClassicUi(width: number): boolean {
  return width >= CLASSIC_UI_MIN_WIDTH;
}

/** 该视口下标签栏的排列顺序（转屏会变，界面按它重排 `order`） */
export function recipeBookTabsFor(width: number): readonly RecipeBookTab[] {
  return isClassicUi(width) ? RECIPE_BOOK_TABS : RECIPE_BOOK_TABS_POCKET;
}

export const RECIPE_BOOK_TAB_LABELS: Record<RecipeBookTab, string> = {
  all: '全部',
  building: '建筑',
  equipment: '装备',
  items: '物品',
  nature: '自然',
};

/**
 * 这件食物算不算"熟食"（是某条 `kind: 'food'` 熔炼配方的产物）。
 *
 * Wiki 把食物拆到了两页里："装备 - 包含战斗用品、部分工具和**熟食**"、
 * "自然 - 包含自然方块、农作物、染料和**生食**"。判据直接借熔炼表
 *（"生肉 → 熟肉"那几条的 `kind` 就是 `food`），不另写一张生熟表。
 */
function isCookedFood(itemId: number): boolean {
  return SMELTING_RECIPES.some((recipe) => recipe.kind === 'food' && recipe.output.id === itemId);
}

/** 一件产物属于哪个标签栏（拿创造分类归并，见上面那段说明） */
export function recipeBookTab(resultId: number): RecipeBookTab {
  switch (categoryOf(resultId)) {
    case 'building':
      return 'building';
    case 'tools':
    case 'armor':
      return 'equipment';
    case 'natural':
    case 'wool':
      return 'nature';
    case 'food':
      return isCookedFood(resultId) ? 'equipment' : 'nature';
    case 'functional':
    case 'ores':
    case 'brewing':
    default:
      return 'items';
  }
}

/** 一条配方需要的材料（同类合并、已排序） */
export interface Ingredient {
  id: number;
  count: number;
}

/** 材料清单：形状配方数 pattern 里出现的字符，无序配方数数组 */
export function recipeIngredients(recipe: Recipe): Ingredient[] {
  const counts = new Map<number, number>();

  if (recipe.kind === 'shapeless') {
    for (const id of recipe.ingredients) counts.set(id, (counts.get(id) ?? 0) + 1);
  } else {
    for (const row of recipe.pattern) {
      for (const char of row) {
        if (char === ' ') continue;
        const id = recipe.key[char];
        if (id === undefined) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => a.id - b.id);
}

/** 配方需要占用的格子数（形状配方按 pattern 的行列，无序配方按材料个数） */
export function recipeGridSize(recipe: Recipe): 2 | 3 {
  if (recipe.kind === 'shapeless') return recipe.ingredients.length <= 4 ? 2 : 3;
  const width = Math.max(...recipe.pattern.map((row) => row.length), 1);
  const height = recipe.pattern.length;
  return width <= 2 && height <= 2 ? 2 : 3;
}

/** 背包能不能做这条配方 */
export interface Craftability {
  ok: boolean;
  /** 缺的材料（够的时候是空数组） */
  missing: Array<{ id: number; need: number; have: number }>;
}

/** 只依赖 `countOf`：传 Inventory 或者一个简单的桩对象都能用 */
export interface CountSource {
  countOf(itemId: number): number;
}

export function canCraft(source: CountSource, recipe: Recipe): Craftability {
  const missing: Craftability['missing'] = [];
  for (const ingredient of recipeIngredients(recipe)) {
    const have = source.countOf(ingredient.id);
    if (have < ingredient.count) missing.push({ id: ingredient.id, need: ingredient.count, have });
  }
  return { ok: missing.length === 0, missing };
}

/**
 * 直接合成一次：扣材料、给产物。
 *
 * @returns 成功了返回产物（调用方用它刷界面/放音效），材料不够返回 null
 *
 * 注意先判断再扣：`Inventory.consume` 是"能扣就扣、扣不动返回 false"，
 * 但一条配方有多种材料，中途失败会留下"扣了一半"的脏状态，所以先整条判断。
 */
export function craftFromInventory(inventory: Inventory, recipe: Recipe): RecipeResult | null {
  if (!canCraft(inventory, recipe).ok) return null;
  for (const ingredient of recipeIngredients(recipe)) {
    if (!inventory.consume(ingredient.id, ingredient.count)) {
      // 理论上到不了这里：`canCraft` 已经确认过数量。
      // 真到了就说明背包在这中间被改过（联机同步等），直接当作失败，不做补偿（宁可少给也不多给）
      return null;
    }
  }
  inventory.add(recipe.result.id, recipe.result.count);
  return recipe.result;
}

/**
 * 把一条配方**摆进合成格**（批次 132，对齐原版）。
 *
 * ⚠️ 原版配方书的交互不是"点一下直接出成品"，而是**把材料摆进合成格**：
 * 摆完之后摆法看得见、还能自己改，最后点输出格取成品。
 * 上面那个 `craftFromInventory` 是"一键扣料出成品"，看不见摆放过程——
 * 它仍然有用（批量合成），但**点配方**这件事该按原版来。
 *
 * 规则：
 *  1. 配方放不进当前格子（背包里只有 2×2，3×3 要站到工作台前）→ 整条不动，返回 false；
 *  2. 材料不够 → 整条不动，返回 false（不留"摆了一半"的脏状态）；
 *  3. 摆之前把格子里的旧东西**还回背包**（原版点配方时就是这么做的）；
 *     背包放不下就原样退回、中止本次填充——**绝不吞掉玩家的东西**；
 *  4. 形状配方摆在**左上角**：`matchRecipe` 会先把网格归一化（裁掉空的边），
 *     所以摆在哪个角都认，左上角是最直观的。
 */
export function fillCraftingGrid(inventory: Inventory, grid: CraftingGrid, recipe: Recipe): boolean {
  if (recipeGridSize(recipe) > grid.size) return false;
  if (!canCraft(inventory, recipe).ok) return false;

  const cells = grid.size * grid.size;
  const backup = Array.from({ length: cells }, (_, index) => grid.get(index));
  const restore = (): void => {
    for (let index = 0; index < cells; index++) grid.set(index, backup[index] ?? null);
  };

  // ① 格子里的旧东西先还回背包（`addStack` 返回**放不下的剩余**）
  for (const stack of backup) {
    if (stack && inventory.addStack(stack) > 0) {
      restore();
      return false;
    }
  }
  for (let index = 0; index < cells; index++) grid.set(index, null);

  // ② 按配方摆放。中途 `consume` 失败理论上到不了（`canCraft` 已经确认过），
  //    真到了就整条回滚：把已经放进去的还给背包，再把格子恢复原样。
  const placement = recipePlacement(recipe, grid.size);
  for (let i = 0; i < placement.length; i++) {
    const [index, id] = placement[i]!;
    if (!inventory.consume(id, 1)) {
      for (let j = 0; j < i; j++) {
        const [doneIndex, doneId] = placement[j]!;
        grid.set(doneIndex, null);
        inventory.add(doneId, 1);
      }
      restore();
      return false;
    }
    grid.set(index, { id, count: 1 });
  }

  grid.recompute();
  return true;
}

/**
 * 一条配方摆进格子后的"哪一格放什么"。
 *
 * 形状配方按 `pattern` 的字符顺序摆在**左上角**（超出格子的部分直接跳过——
 * 调用方已经用 `recipeGridSize` 挡过）；无序配方按材料顺序依次填。
 */
export function recipePlacement(recipe: Recipe, size: 2 | 3): Array<[number, number]> {
  const placement: Array<[number, number]> = [];

  if (recipe.kind === 'shapeless') {
    recipe.ingredients.forEach((id, index) => {
      if (index >= size * size) return;
      placement.push([index, id]);
    });
    return placement;
  }

  recipe.pattern.forEach((line, row) => {
    let col = 0;
    for (const char of line) {
      const column = col;
      col += 1;
      if (char === ' ' || row >= size || column >= size) continue;
      const id = recipe.key[char];
      if (id === undefined) continue;
      placement.push([row * size + column, id]);
    }
  });
  return placement;
}

/** 一次能合成几份（按最缺的那种材料算） */
export function maxCraftable(source: CountSource, recipe: Recipe): number {
  let max = Infinity;
  for (const ingredient of recipeIngredients(recipe)) {
    max = Math.min(max, Math.floor(source.countOf(ingredient.id) / ingredient.count));
  }
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

/** 配方书的条目：配方 + 材料 + 能不能做 */
export interface RecipeEntry {
  recipe: Recipe;
  result: RecipeResult;
  ingredients: Ingredient[];
  gridSize: 2 | 3;
  craftable: boolean;
  /** 最多能做几份（材料够时 ≥1） */
  maxCraftable: number;
  /** 属于哪个标签栏（批次 133；界面按它分页） */
  tab: RecipeBookTab;
}

/**
 * 组出配方书的全部条目。
 *
 * 排序规则：**能做的排前面**，其次按产物 id——玩家打开配方书十有八九是想知道"我现在能做什么"。
 */
export function buildRecipeEntries(source: CountSource, recipes: readonly Recipe[] = RECIPES): RecipeEntry[] {
  const entries: RecipeEntry[] = recipes.map((recipe) => {
    const craftability = canCraft(source, recipe);
    return {
      recipe,
      result: recipe.result,
      ingredients: recipeIngredients(recipe),
      gridSize: recipeGridSize(recipe),
      craftable: craftability.ok,
      maxCraftable: maxCraftable(source, recipe),
      tab: recipeBookTab(recipe.result.id),
    };
  });

  return entries.sort((a, b) => {
    if (a.craftable !== b.craftable) return a.craftable ? -1 : 1;
    return a.result.id - b.result.id;
  });
}

/** 按产物 id 找配方（同一产物可能有多条，例如不同木材的木板） */
export function recipesForResult(resultId: number, recipes: readonly Recipe[] = RECIPES): Recipe[] {
  return recipes.filter((recipe) => recipe.result.id === resultId);
}

/**
 * 配方书里的搜索：产物或任一材料的**中文名 / 英文 id** 命中就算。
 * 中文按"包含"匹配（写"羊毛"能搜到所有羊毛相关），英文按小写包含匹配（写 stone 能搜到 stone_bricks）。
 */
export function matchesRecipe(recipe: Recipe, query: string): boolean {
  const raw = query.trim();
  if (raw.length === 0) return true;
  const lower = raw.toLowerCase();

  const hit = (id: number): boolean =>
    itemLabel(id).includes(raw) || itemName(id).toLowerCase().includes(lower) || String(id) === raw;

  if (hit(recipe.result.id)) return true;
  return recipeIngredients(recipe).some((ingredient) => hit(ingredient.id));
}
