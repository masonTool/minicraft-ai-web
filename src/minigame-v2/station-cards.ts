/**
 * 熔炉左栏"可做列表" —— v2 侧的装配层。
 *
 * 规则本体在 `core/crafting/StationRecipes.furnaceStationRecipes`（纯函数，`test:stations` 有断言），
 * 这里只负责三件界面的事：
 *
 *  1. **算"有没有燃料"**：炉子里正在烧 / 燃料槽里有可燃物 / 背包里有燃料，三者任一即算有。
 *     外部端是同一个口径（"白底点下去一定能烧"）。
 *  2. **站台过滤**：烟熏炉只列食物、高炉只列矿物 —— 由 `FURNACE_STATIONS[station].accepts` 决定，
 *     不在这里重写一遍。
 *  3. **按产物去重**：同一产物可能有多条熔炼配方（不同原料），列表里只留一条，
 *     否则同一个铁锭会在列表里出现两次，玩家点哪条都行但看着像重复。
 */

import { FURNACE_STATIONS, SMELTING_RECIPES, fuelSeconds, type FurnaceStation } from '../core/crafting/Smelting.ts';
import { furnaceStationRecipes, type StationRecipeEntry } from '../core/crafting/StationRecipes.ts';

/** 列表里的一条（只留界面要画的字段） */
export interface StationCard {
  resultId: number;
  resultCount: number;
  /** 要放进原料槽的那一件 */
  inputId: number;
  inputCount: number;
  /** 白底 = 现在点下去就能开工 */
  available: boolean;
  /** 红底原因：缺原料 / 缺燃料 */
  missing: 'input' | 'fuel' | null;
}

/**
 * 这个站台能不能吃这件东西（烟熏炉只吃食物、高炉只吃矿物）。
 *
 * 直接查 `FURNACE_STATIONS[station].accepts` —— 别在这里另写一份分类表，
 * 那张表改了这里就静默失效（烟熏炉会开始烤铁矿）。
 */
export function stationAccepts(station: FurnaceStation, kind: string | undefined): boolean {
  return FURNACE_STATIONS[station].accepts.includes((kind ?? 'none') as never);
}

/**
 * 这座炉子现在有没有燃料可用。
 *
 * @param burnTimeLeft 还在烧的剩余秒数
 * @param fuelSlotId   燃料槽里那件东西（空槽传 0）
 * @param bagFuelIds   背包里所有物品 id（只用来判"有没有可燃物"）
 */
export function hasFuelAvailable(
  burnTimeLeft: number,
  fuelSlotId: number,
  bagFuelIds: readonly number[],
): boolean {
  if (burnTimeLeft > 0) return true;
  if (fuelSlotId > 0 && fuelSeconds(fuelSlotId) > 0) return true;
  return bagFuelIds.some((id) => id > 0 && fuelSeconds(id) > 0);
}

/**
 * 组装左栏列表。
 *
 * @param station 站台（furnace / smoker / blast_furnace）
 * @param countOf 某个物品在**背包 + 原料槽**里的总数（原料槽里已摆的也要算，
 *                否则点过一条配方摆好后，那条会立刻变成红底 —— 看起来像出错）
 * @param fuel    有没有燃料（用 `hasFuelAvailable` 算）
 */
export function stationCards(
  station: FurnaceStation,
  countOf: (itemId: number) => number,
  fuel: boolean,
): StationCard[] {
  const entries = furnaceStationRecipes(station, countOf, fuel);
  const seen = new Set<number>();
  const cards: StationCard[] = [];
  for (const entry of entries) {
    // 按产物去重：同一产物的第二条配方不重复列（见文件头注释）
    if (seen.has(entry.resultId)) continue;
    seen.add(entry.resultId);
    cards.push(toCard(entry));
  }
  return cards;
}

function toCard(entry: StationRecipeEntry): StationCard {
  const input = entry.inputs[0];
  const missing: StationCard['missing'] =
    entry.reason === 'missing_input' ? 'input' : entry.reason === 'missing_fuel' ? 'fuel' : null;
  return {
    resultId: entry.resultId,
    resultCount: entry.resultCount,
    inputId: input?.id ?? 0,
    inputCount: input?.count ?? 1,
    available: entry.available,
    missing,
  };
}

/** 卡片底部那行小字 */
export function stationCardHint(card: StationCard): string {
  if (card.missing === 'fuel') return '缺燃料';
  if (card.missing === 'input') return '缺原料';
  return '';
}

/**
 * 站台拒绝这件原料的理由（烟熏炉塞进铁矿时说的话）。
 *
 * 数据层已有 `Furnace.rejectReason`，这里只是把它翻成"给玩家看的一句话"，
 * 补上"这座炉子只吃什么"的具体例子 —— 只说"这个炉子不能烧它"，
 * 玩家不知道是该换炉子还是换材料。
 */
export function rejectReasonText(station: FurnaceStation, itemId: number): string {
  if (itemId <= 0) return '';
  const recipe = SMELTING_RECIPES.find((r) => r.input === itemId);
  if (!recipe) return '这件东西不能烧';
  const kind = recipe.kind ?? 'none';
  if (stationAccepts(station, kind)) return '';
  const label = FURNACE_STATIONS[station].cn;
  if (kind === 'food') return `${label}只烤食物，这个要换熔炉`;
  if (kind === 'metal') return `${label}只烧矿物，这个要换熔炉`;
  return `${label}烧不了这个`;
}

/** 一页能放几张卡（左栏 3 列） */
export function stationPageSize(availableHeight: number, cardHeight: number): number {
  if (cardHeight <= 0) return 1;
  const rows = Math.max(1, Math.floor(availableHeight / cardHeight));
  return rows * 3;
}

/** 页码越界时夹回来 */
export function clampStationPage(page: number, total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 0;
  const last = Math.max(0, Math.ceil(total / pageSize) - 1);
  return Math.max(0, Math.min(last, page));
}
