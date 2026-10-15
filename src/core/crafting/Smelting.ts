/**
 * 烧炼配方与燃料
 *
 * 普通熔炉一次烧炼 10 秒（原版 200 tick）。烟熏炉/高炉是 5 秒，等 H6 扩展时再加。
 * 燃料按"可燃烧秒数"表示，与原版比例一致：1 个煤炭 = 80 秒 = 8 次烧炼。
 */

import { Block } from '../registry/blocks.ts';
import { Item } from '../registry/items.ts';

export interface SmeltingRecipe {
  readonly input: number;
  readonly output: { id: number; count: number };
  /** 单次烧炼耗时（秒） */
  readonly time: number;
  /** 取出产物时获得的经验（原版量纲，经验球在后续版本接入） */
  readonly experience: number;
}

/** 普通熔炉的单次烧炼耗时 */
export const SMELTING_TIME = 10;

/** 全部熔炼配方（配方书要列出来，所以导出） */

export const SMELTING_RECIPES: readonly SmeltingRecipe[] = [
  // 烤马铃薯（H13 续）：原版 0.35 经验
  // 矿物 → 金属锭
  // 烤马铃薯（H13 续）：原版 0.35 经验
  { input: Item.POTATO, output: { id: Item.BAKED_POTATO, count: 1 }, time: SMELTING_TIME, experience: 0.35 },
  { input: Item.RAW_IRON, output: { id: Item.IRON_INGOT, count: 1 }, time: SMELTING_TIME, experience: 0.7 },
  { input: Item.RAW_GOLD, output: { id: Item.GOLD_INGOT, count: 1 }, time: SMELTING_TIME, experience: 1 },
  { input: Item.RAW_COPPER, output: { id: Item.COPPER_INGOT, count: 1 }, time: SMELTING_TIME, experience: 0.7 },

  // 沙 → 玻璃
  { input: Block.SAND, output: { id: Block.GLASS, count: 1 }, time: SMELTING_TIME, experience: 0.1 },

  // 圆石 → 石头
  { input: Block.COBBLESTONE, output: { id: Block.STONE, count: 1 }, time: SMELTING_TIME, experience: 0.1 },

  // 原木 → 木炭
  { input: Block.OAK_LOG, output: { id: Item.CHARCOAL, count: 1 }, time: SMELTING_TIME, experience: 0.15 },

  // 远古残骸 → 下界合金碎片（K8 尾巴）：原版 2 点经验，是整个下界合金链的第一环
  { input: Block.ANCIENT_DEBRIS, output: { id: Item.NETHERITE_SCRAP, count: 1 }, time: SMELTING_TIME, experience: 2 },

  // 黏土球 → 红砖
  { input: Item.CLAY_BALL, output: { id: Item.BRICK, count: 1 }, time: SMELTING_TIME, experience: 0.3 },

  // 生肉 → 熟肉（经验值取自原版：生肉 0.35）
  { input: Item.BEEF, output: { id: Item.COOKED_BEEF, count: 1 }, time: SMELTING_TIME, experience: 0.35 },
  { input: Item.PORKCHOP, output: { id: Item.COOKED_PORKCHOP, count: 1 }, time: SMELTING_TIME, experience: 0.35 },
  { input: Item.MUTTON, output: { id: Item.COOKED_MUTTON, count: 1 }, time: SMELTING_TIME, experience: 0.35 },
  { input: Item.CHICKEN, output: { id: Item.COOKED_CHICKEN, count: 1 }, time: SMELTING_TIME, experience: 0.35 },
];

const RECIPE_BY_INPUT = new Map<number, SmeltingRecipe>(SMELTING_RECIPES.map((recipe) => [recipe.input, recipe]));

export function smeltingRecipeFor(itemId: number): SmeltingRecipe | undefined {
  return RECIPE_BY_INPUT.get(itemId);
}

export const SMELTING_RECIPE_COUNT = SMELTING_RECIPES.length;

/**
 * 燃料 → 可燃烧秒数。
 * 数值取自原版（原版以 tick 计，这里换算成秒；1 煤炭 = 1600 tick = 80 秒）。
 */
const FUELS = new Map<number, number>([
  [Item.COAL, 80],
  [Item.CHARCOAL, 80],

  [Block.OAK_LOG, 15],
  [Block.OAK_PLANKS, 15],
  [Block.CRAFTING_TABLE, 15],
  [Block.CHEST, 15],
  [Block.OAK_LEAVES, 5],
  [Item.STICK, 5],
]);

/** 返回该物品作为燃料的可燃烧秒数；0 表示不能当燃料 */
export function fuelSeconds(itemId: number): number {
  return FUELS.get(itemId) ?? 0;
}

export function isFuel(itemId: number): boolean {
  return FUELS.has(itemId);
}
