/**
 * 酿造台的纯逻辑（H10）
 *
 * 与原版对齐：
 *  - 一次酿造 **20 秒**；燃料是**烈焰粉**，1 份能酿 **20 次**（原版就是 20）
 *  - 三个药水槽**同时**推进（放一瓶也是 20 秒，放三瓶一样是 20 秒——这是原版的特点）
 *  - 配方六类：水瓶 + 下界疣 → 粗制；粗制 + 材料 → 具体药水；
 *    具体药水 + 红石粉 → **延长**；+ 荧石粉 → **强化**；
 *    + 发酵蜘蛛眼 → **腐化**（换一种效果，见 `CORRUPTION`）；
 *    **药水 + 火药 → 喷溅版**、**喷溅版 + 龙息 → 滞留版**（K4 尾巴的两条链）
 *  - 不需要"配方解锁"，但**原料与基础药水不匹配时什么都不发生**（不消耗、不浪费）
 *
 * 配方表**由 `POTIONS` 的变体表展开**，不手写几十条：手写的话"加一种药水"要改好几处，
 * 而漏改的那一处不会报错，只会让新药水永远酿不出来。
 *
 * 与原版的两处差异（都是"少一层状态"，行为可预期）：
 *  1. 红石粉与荧石粉**只能从普通档出发**（原版给 II 级药水再补红石粉也是可以的）；
 *     反过来说"已经改造过的药水不能再改造"，与原版 1.9 之后"二选一"的限制一致。
 *  2. 腐化**只从基础档出发**（原版也不能给"延长版迅捷"腐化，这条是一致的）；
 *     另外"跳跃药水 → 缓慢"这一条还没有原料药水（跳跃药水本身没做），
 *     所以 `CORRUPTION` 里只有四条。
 *
 * 本文件要 import `items.ts` 拿材料 id —— 这是**必须**的：`POTIONS` 那边反过来
 * 不能 import `items.ts`（会成环，见 `potions.ts` 的文件头）。
 */

import { Item } from '../registry/items.ts';
import {
  DRINKABLE,
  POTION_IDS,
  POTION_VARIANTS,
  lingeringIdOf,
  splashIdOf,
  variantBaseId,
} from '../registry/potions.ts';

/** 一次酿造耗时（秒，原版 20） */
export const BREW_SECONDS = 20;
/** 一份烈焰粉能酿几次（原版 20） */
export const BREWS_PER_BLAZE_POWDER = 20;

export interface BrewIngredient {
  /** 槽里的材料 */
  readonly ingredient: number;
  /** 原料瓶 → 产物瓶（同一种变换对三个槽都适用） */
  readonly from: number;
  readonly to: number;
}

/**
 * 每种效果的基础档怎么来：粗制 + 哪种材料（原版一一对应）。
 *
 * **缓慢与虚弱故意不在表里**：它们不是"粗制 + 材料"，原版里只从腐化链来
 * （迅捷→缓慢、水瓶/粗制→虚弱）。给它们硬塞一种材料就会凭空多出一条原版没有的配方。
 */
export const VARIANT_INGREDIENTS: Readonly<Record<string, number>> = {
  swiftness: Item.SUGAR,
  strength: Item.BLAZE_POWDER,
  healing: Item.GLISTERING_MELON,
  regeneration: Item.GHAST_TEAR,
  fire_resistance: Item.MAGMA_CREAM,
  night_vision: Item.GOLDEN_CARROT,
  poison: Item.SPIDER_EYE,
};

/**
 * 发酵蜘蛛眼腐化：原料效果的基础档 → 目标效果的基础档。
 *
 * 原版一共五条，现在**全部补齐**（K4 尾巴把缺的三个目标效果做出来了）：
 * 迅捷 → 缓慢、治疗 → 伤害、剧毒 → 伤害、夜视 → 隐身、跳跃 → 缓慢（跳跃药水还没做）。
 */
export const CORRUPTION: Readonly<Record<string, string>> = {
  swiftness: 'slowness',
  healing: 'harming',
  poison: 'harming',
  night_vision: 'invisibility',
};

function requireBaseId(key: string): number {
  const id = variantBaseId(key);
  if (id === undefined) throw new Error(`酿造配方表里引用了不存在的效果变体：${key}`);
  return id;
}

/**
 * 酿造配方表（由变体表在模块加载时展开一次）。
 *
 * 顺序即"配方查找顺序"：每条 (材料, 原料瓶) 都是唯一的，
 * 断言里有一条专门盯着"没有重复的 (材料, 原料瓶)"——配方表一旦撞车，
 * 后写的那条永远查不到，玩家看到的是"明明放了材料却酿不出东西"。
 */
export const BREW_RECIPES: readonly BrewIngredient[] = buildRecipes();

function buildRecipes(): BrewIngredient[] {
  // 起点：水瓶 + 下界疣 → 粗制
  const recipes: BrewIngredient[] = [
    { ingredient: Item.NETHER_WART, from: Item.WATER_BOTTLE, to: POTION_IDS.awkward },
  ];

  for (const variant of POTION_VARIANTS) {
    const ingredient = VARIANT_INGREDIENTS[variant.key];
    if (ingredient !== undefined) {
      recipes.push({ ingredient, from: POTION_IDS.awkward, to: variant.baseId });
    }
    if (variant.longId !== undefined) {
      recipes.push({ ingredient: Item.REDSTONE_DUST, from: variant.baseId, to: variant.longId });
    }
    if (variant.strongId !== undefined) {
      recipes.push({ ingredient: Item.GLOWSTONE_DUST, from: variant.baseId, to: variant.strongId });
    }
    const corruptTo = CORRUPTION[variant.key];
    if (corruptTo !== undefined) {
      recipes.push({ ingredient: Item.FERMENTED_SPIDER_EYE, from: variant.baseId, to: requireBaseId(corruptTo) });
    }
  }

  // 腐化"没有效果的药水"→ 虚弱：原版里水瓶与粗制药水都能这么变
  recipes.push({ ingredient: Item.FERMENTED_SPIDER_EYE, from: Item.WATER_BOTTLE, to: requireBaseId('weakness') });
  recipes.push({ ingredient: Item.FERMENTED_SPIDER_EYE, from: POTION_IDS.awkward, to: requireBaseId('weakness') });

  // 喷溅药水（K4 尾巴）：**任何饮用型 + 火药 → 它的喷溅版**（原版就这么做）。
  // ⚠️ 必须只遍历 `DRINKABLE`：遍历 `POTIONS` 再跳过喷溅型的话，**滞留型也会被算进来**，
  // 于是生成一批 id 为"滞留 + 50"的垃圾配方（1330、1331…指向不存在的物品）。
  // 上一轮写成 `POTIONS` 是靠断言"每条配方的产物都是已注册物品"抓出来的。
  for (const potion of DRINKABLE) {
    recipes.push({ ingredient: Item.GUNPOWDER, from: potion.id, to: splashIdOf(potion.id) });
  }

  // 滞留药水（K4 尾巴）：**喷溅型 + 龙息 → 滞留版**（原版就是这么做的）。
  // 只从喷溅型出发：滞留版本身不再是酿造原料（原版里也没有"滞留 + 什么"的配方）
  for (const potion of DRINKABLE) {
    recipes.push({
      ingredient: Item.DRAGON_BREATH,
      from: splashIdOf(potion.id),
      to: lingeringIdOf(potion.id),
    });
  }

  return recipes;
}

/** 查这条配方；没有配方返回 null */
export function brewRecipeFor(ingredient: number, bottle: number): BrewIngredient | null {
  for (const recipe of BREW_RECIPES) {
    if (recipe.ingredient === ingredient && recipe.from === bottle) return recipe;
  }
  return null;
}

/**
 * 这一槽当前能不能开酿（三个槽只要有任意一个能酿，整台就开始走 20 秒）。
 * @returns 能不能酿
 */
export function canBrew(ingredient: number | undefined, bottles: readonly (number | undefined)[]): boolean {
  if (ingredient === undefined) return false;
  return bottles.some((bottle) => bottle !== undefined && brewRecipeFor(ingredient, bottle) !== null);
}

/** 把三个槽按配方推进一次；返回被改动的槽下标 */
export function applyBrew(ingredient: number, bottles: readonly (number | undefined)[]): { index: number; to: number }[] {
  const changed: { index: number; to: number }[] = [];
  for (let i = 0; i < bottles.length; i++) {
    const bottle = bottles[i];
    if (bottle === undefined) continue;
    const recipe = brewRecipeFor(ingredient, bottle);
    if (recipe) changed.push({ index: i, to: recipe.to });
  }
  return changed;
}
