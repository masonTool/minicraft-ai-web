/**
 * 配方书（数据层）
 *
 * 界面要回答三个问题，这里把它们做成纯函数，方便离线测试：
 *  1. **一条配方要什么材料**（几个格子、每个格子几个）——形状配方要数 pattern 里的字符
 *  2. **背包里够不够**（缺什么、缺几个）——材料可能分散在 36 个槽位里
 *  3. **怎么直接合成**（从背包扣材料、把产物塞回背包）——不经过合成台界面
 *
 * 为什么不复用 `CraftingGrid`：那是"玩家手动摆格子"的模型（有摆放、拿回、结果槽），
 * 配方书要的是"知道配方就能一键做出来"，直接对背包做加减更简单也更不容易出错。
 */

import type { Inventory } from '../container/Inventory.ts';
import { RECIPES, type Recipe, type RecipeResult } from './Recipes.ts';
import { itemLabel } from '../registry/itemNames.ts';
import { itemName } from '../registry/items.ts';

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
