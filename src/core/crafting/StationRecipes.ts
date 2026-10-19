/**
 * 工作站"可做列表"（批次 277）
 *
 * 工作台左栏列的是"材料够的合成产物"，工作站也应该是同一套交互：
 * 白底 = 现在能开工，红底 = 缺东西。区别只在判据——
 *  - 熔炉系：背包里有原料 **且** 有燃料（用户口径：白底点下去一定能烧）；
 *  - 营火：只要原料（它不吃燃料）；
 *  - 锻造台：钻石装备 + 下界合金锭都在；
 *  - 酿造台：基础药水 + 材料都在 **且** 有烈焰粉。
 *
 * 这里只有纯逻辑：配方表遍历、站台过滤、缺什么。界面只负责画格子与填材料。
 */

import { Item } from '../registry/items.ts';
import { BREW_RECIPES } from './Brewing.ts';
import { SMITHING_INGOT_COST, netheriteUpgradeList } from './Smithing.ts';
import { FURNACE_STATIONS, SMELTING_RECIPES, type FurnaceStation } from './Smelting.ts';

export type StationRecipeReason =
  | 'missing_input'
  | 'missing_fuel'
  | 'missing_equipment'
  | 'missing_material'
  | 'slot_occupied';

/** 红底时给玩家看的一句话（按"最具体 → 最笼统"排，由调用方选中的那一条直接显示） */
export const STATION_REASON_LABELS: Readonly<Record<StationRecipeReason, string>> = {
  missing_input: '缺原料',
  missing_fuel: '缺燃料',
  missing_equipment: '缺要升级的装备',
  missing_material: '缺材料',
  slot_occupied: '槽位被其他物品占着',
};

export interface StationRecipeEntry {
  /** 产物（列表格子里画它） */
  readonly resultId: number;
  readonly resultCount: number;
  /** 这条配方要消耗的材料（填格子的顺序） */
  readonly inputs: readonly { readonly id: number; readonly count: number }[];
  /** 白底 = true；红底 = false */
  readonly available: boolean;
  /** 红底原因；白底为 null */
  readonly reason: StationRecipeReason | null;
}

function entry(
  resultId: number,
  resultCount: number,
  inputs: readonly { id: number; count: number }[],
  reason: StationRecipeReason | null,
): StationRecipeEntry {
  return { resultId, resultCount, inputs, available: reason === null, reason };
}

/**
 * 熔炉 / 烟熏炉 / 高炉 / 营火：按站台的 `accepts` 过滤（烟熏炉只列食物、高炉只列矿物）。
 *
 * @param fuel 当前有没有可用燃料：炉子里正在烧、燃料槽里有可燃物、或背包里有燃料。
 *             营火不吃燃料，调用方传 true 即可。
 */
export function furnaceStationRecipes(
  station: FurnaceStation,
  countOf: (itemId: number) => number,
  fuel: boolean,
): StationRecipeEntry[] {
  const accepts = FURNACE_STATIONS[station].accepts;
  const entries: StationRecipeEntry[] = [];
  for (const recipe of SMELTING_RECIPES) {
    if (!accepts.includes(recipe.kind ?? 'none')) continue;
    const hasInput = countOf(recipe.input) >= 1;
    const needsFuel = station !== 'campfire';
    const reason: StationRecipeReason | null = !hasInput
      ? 'missing_input'
      : needsFuel && !fuel
        ? 'missing_fuel'
        : null;
    entries.push(
      entry(recipe.output.id, recipe.output.count, [{ id: recipe.input, count: 1 }], reason),
    );
  }
  return entries;
}

/** 锻造台：钻石装备 → 下界合金装备，要求左件 + 1 个下界合金锭 */
export function smithingStationRecipes(countOf: (itemId: number) => number): StationRecipeEntry[] {
  return netheriteUpgradeList().map(({ equipment, result }) => {
    const hasIngot = countOf(Item.NETHERITE_INGOT) >= SMITHING_INGOT_COST;
    const reason: StationRecipeReason | null =
      countOf(equipment) < 1 ? 'missing_equipment' : !hasIngot ? 'missing_material' : null;
    return entry(
      result,
      1,
      [
        { id: equipment, count: 1 },
        { id: Item.NETHERITE_INGOT, count: SMITHING_INGOT_COST },
      ],
      reason,
    );
  });
}

/**
 * 酿造台：基础药水 + 材料 → 目标药水。
 *
 * `bottleIds` 是已经放在三个药水槽里的药水（空格为 undefined）——
 * 已经放进去的那瓶也算"有"，否则点到白底会提示"缺药水"。
 */
export function brewingStationRecipes(
  countOf: (itemId: number) => number,
  bottleIds: readonly (number | undefined)[],
  fuel: boolean,
): StationRecipeEntry[] {
  const inBottles = (id: number): number => bottleIds.filter((bottle) => bottle === id).length;
  return BREW_RECIPES.map(({ ingredient, from, to }) => {
    const reason: StationRecipeReason | null =
      countOf(from) + inBottles(from) < 1
        ? 'missing_input'
        : countOf(ingredient) < 1
          ? 'missing_material'
          : !fuel
            ? 'missing_fuel'
            : null;
    return entry(
      to,
      1,
      [
        { id: from, count: 1 },
        { id: ingredient, count: 1 },
      ],
      reason,
    );
  });
}
