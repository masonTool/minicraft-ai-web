/**
 * 配方书里的"这件东西需要什么工作站"（批次 531）
 *
 * 背景：以前 `InventoryScreen` 只认识两种站台（工作台 / 熔炉），而且只判断
 * "3×3"与"能烧"。于是烟熏炉、高炉、营火、酿造台、切石机、锻造台、织布机、
 * 制图台都显示不出来；食物/金属这种"多种站台都能做"的也只显示熔炉。
 *
 * 本模块把"产物 → 站台列表"收成**纯函数**：
 *  - 只依赖注册表与配方表，Node 里可以直接断言；
 *  - 输出顺序固定（工作台 → 熔炉 → 烟熏炉 → 高炉 → 营火 → 酿造台 → 切石机 →
 *    锻造台 → 织布机 → 制图台），界面上第一颗就是"最常走的路线"；
 *  - 不包含"2×2 手工合成"：那不需要站台，由调用方按"当前格子放不放得下"决定
 *    要不要显示站台图标。
 *
 * ⚠️ 配方表在模块加载时**反向索引一次**。点配方书时 `showRecipeFor` 会被
 * 按住滑动连续调用（每滑过一格一次），每次遍历 1000 条配方会白给一笔开销。
 */

import { Block, isBannerId } from '../registry/blocks.ts';
import { Item } from '../registry/items.ts';
import { RECIPES } from './Recipes.ts';
import { recipeGridSize } from './RecipeBook.ts';
import { SMELTING_RECIPES } from './Smelting.ts';
import { BREW_RECIPES } from './Brewing.ts';
import { isStonecuttingOutput } from './Stonecutting.ts';
import { netheriteUpgradeList } from './Smithing.ts';

/** 有 3×3 配方的产物：工作台能做 */
const WORKBENCH_OUTPUTS: ReadonlySet<number> = new Set(
  RECIPES.filter((recipe) => recipeGridSize(recipe) > 2).map((recipe) => recipe.result.id),
);

/** 产物 → 熔炼配方里出现过的 `kind` 集合（food / metal / none） */
const SMELT_KINDS_BY_OUTPUT: ReadonlyMap<number, ReadonlySet<string>> = (() => {
  const map = new Map<number, Set<string>>();
  for (const recipe of SMELTING_RECIPES) {
    const kinds = map.get(recipe.output.id) ?? new Set<string>();
    kinds.add(recipe.kind ?? 'none');
    map.set(recipe.output.id, kinds);
  }
  return map;
})();

const BREW_OUTPUTS: ReadonlySet<number> = new Set(BREW_RECIPES.map((recipe) => recipe.to));
const SMITHING_OUTPUTS: ReadonlySet<number> = new Set(
  netheriteUpgradeList().map((entry) => entry.result),
);

/**
 * 这件产物在**配方表**里需要哪些工作站。
 *
 * 返回的是工作站方块/物品 id，按固定顺序去重。调用方仍要判断"当前格子是否
 * 已经能做"——2×2 能做的物品不需要站台，即使它还有别的站台路线。
 */
export function stationItemsFor(itemId: number): number[] {
  const stations: number[] = [];

  // 工作台：只要存在一条 3×3 的合成配方就列。2×2 配方不算站台。
  if (WORKBENCH_OUTPUTS.has(itemId)) stations.push(Block.CRAFTING_TABLE);

  // 熔炉系：按熔炼配方里的 `kind` 决定还有哪些变体。
  const smeltKinds = SMELT_KINDS_BY_OUTPUT.get(itemId);
  if (smeltKinds && smeltKinds.size > 0) {
    stations.push(Block.FURNACE);
    if (smeltKinds.has('food')) stations.push(Block.SMOKER, Block.CAMPFIRE);
    if (smeltKinds.has('metal')) stations.push(Block.BLAST_FURNACE);
  }

  if (BREW_OUTPUTS.has(itemId)) stations.push(Block.BREWING_STAND);
  if (isStonecuttingOutput(itemId)) stations.push(Block.STONECUTTER);
  if (SMITHING_OUTPUTS.has(itemId)) stations.push(Block.SMITHING_TABLE);
  // 织布机的产物仍然是一面旗帜（图案存在方块状态/物品附加数据里）：
  // 因此"任何旗帜"都要提示可以用织布机加工。
  if (isBannerId(itemId)) stations.push(Block.LOOM);
  // 制图台只会产出"已填好的地图"（放大/复制/锁定都不换物品 id）
  if (itemId === Item.FILLED_MAP) stations.push(Block.CARTOGRAPHY_TABLE);

  return [...new Set(stations)];
}
