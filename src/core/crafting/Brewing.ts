/**
 * 酿造台的纯逻辑（H10）
 *
 * 与原版对齐：
 *  - 一次酿造 **20 秒**；燃料是**烈焰粉**，1 份能酿 **20 次**（原版就是 20）
 *  - 三个药水槽**同时**推进（放一瓶也是 20 秒，放三瓶一样是 20 秒——这是原版的特点）
 *  - 配方：水瓶 + 下界疣 → 粗制药水；粗制药水 + 材料 → 各种药水
 *  - 不需要"配方解锁"，但**原料与基础药水不匹配时什么都不发生**（不消耗、不浪费）
 *
 * 不碰 DOM，也不持有状态：`BrewingStand` 容器负责攒进度，这里只回答
 * "这瓶能不能酿、酿成什么"。
 */

import { Item } from '../registry/items.ts';
import { POTION_IDS } from '../registry/potions.ts';

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
 * 酿造配方表。
 *
 * 只做「水瓶 + 下界疣 → 粗制」与「粗制 + 材料 → 药水」两类；
 * 原版还有"药水 + 红石 → 延长""+ 荧石粉 → 强化""+ 发酵蜘蛛眼 → 腐化"这几条改造链，
 * 需要额外的药水 id（每种效果 × 三档），**放到下一批**——那时的做法是把
 * `POTIONS` 按"效果 × 档位"扩成表，而不是在这里加分支。
 */
export const BREW_RECIPES: readonly BrewIngredient[] = [
  { ingredient: Item.NETHER_WART, from: Item.WATER_BOTTLE, to: POTION_IDS.awkward },
];

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
