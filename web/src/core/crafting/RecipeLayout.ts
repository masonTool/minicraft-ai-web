/**
 * 配方的**摆放位置**（批次 29）
 *
 * 之前的配方书只列出"要哪些材料"（一列小标签），玩家知道要什么、**不知道该摆哪儿**：
 * "火把是煤炭在木棍上面"这种信息在形状配方里是配方的一部分，不画出来就等于没给全。
 *
 * 这里把一条配方算成"每个格子里放什么"：
 *  - **形状配方**：把 pattern 裁到最小包围盒，左上对齐铺进 2×2 / 3×3 的格子
 *    （与合成匹配器的做法一致：`normalizeGrid` 也是先裁包围盒，所以 2×2 的配方
 *    放 3×3 的任意角落都能合成——界面按"左上角"这一种画法呈现即可）
 *  - **无序配方**：摆放位置**不影响结果**，所以不画格子，只给"无序"的说明
 *    （画成格子反而会让人以为"必须这么摆"）
 *
 * 顺带给出**在哪摆**：2×2 用背包自带的合成格就够，3×3 必须站到工作台前。
 */

import { recipeGridSize } from './RecipeBook.ts';
import { itemLabel } from '../registry/itemNames.ts';
import type { Recipe, ShapedRecipe } from './Recipes.ts';

/** 在哪儿合成：背包自带的 2×2，还是必须用工作台的 3×3 */
export type CraftStation = 'inventory' | 'crafting_table';

interface LayoutBase {
  grid: 2 | 3;
  station: CraftStation;
  /** 一句话说明摆放方式（提示框与无障碍都用它；断言也直接读它） */
  text: string;
}

export interface ShapedLayout extends LayoutBase {
  kind: 'shaped';
  /** 行优先的格子内容，长度 = grid × grid；`null` = 空格 */
  cells: Array<number | null>;
}

export interface ShapelessLayout extends LayoutBase {
  kind: 'shapeless';
  /** 材料展开成一个一个（`[木棍, 木棍, ...]`），按 id 排序便于对照 */
  items: number[];
}

export type RecipeLayout = ShapedLayout | ShapelessLayout;

/** 摆放用的站台 */
export function stationOf(grid: 2 | 3): CraftStation {
  return grid <= 2 ? 'inventory' : 'crafting_table';
}

/** 站台的中文名（文案与断言共用一处） */
export function stationLabel(station: CraftStation): string {
  return station === 'inventory' ? '背包 2×2' : '工作台 3×3';
}

/**
 * 把 pattern 裁到**最小包围盒**（去掉整行/整列都是空的边）。
 * 与 `Recipes.normalizeGrid` 的口径一致——不一致会出现"界面画的摆法和能合成的摆法不是一回事"。
 */
export function trimPattern(pattern: readonly string[]): string[] {
  const rows = pattern.map((row) => row);
  // 去掉整行为空的
  while (rows.length > 0 && rows[0]!.trim().length === 0) rows.shift();
  while (rows.length > 0 && rows[rows.length - 1]!.trim().length === 0) rows.pop();
  if (rows.length === 0) return [];

  // 去掉整列为空的
  let start = Math.min(...rows.map((row) => firstFilled(row)));
  let end = Math.max(...rows.map((row) => lastFilled(row)));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return rows.map((row) => row.slice(start, end + 1));
}

function firstFilled(row: string): number {
  for (let i = 0; i < row.length; i++) if (row[i] !== ' ') return i;
  return Number.POSITIVE_INFINITY;
}

function lastFilled(row: string): number {
  for (let i = row.length - 1; i >= 0; i--) if (row[i] !== ' ') return i;
  return Number.NEGATIVE_INFINITY;
}

/** 形状配方 → 每个格子里放什么 */
export function shapedLayout(recipe: ShapedRecipe): ShapedLayout {
  const trimmed = trimPattern(recipe.pattern);
  const grid = recipeGridSize(recipe);
  const station = stationOf(grid);
  const cells: Array<number | null> = new Array<number | null>(grid * grid).fill(null);

  for (let row = 0; row < trimmed.length && row < grid; row++) {
    const line = trimmed[row]!;
    for (let col = 0; col < line.length && col < grid; col++) {
      const char = line[col]!;
      if (char === ' ') continue;
      cells[row * grid + col] = recipe.key[char] ?? null;
    }
  }

  return { kind: 'shaped', grid, station, cells, text: shapedText(station, grid, cells) };
}

/**
 * 摆放说明的文案：`工作台 3×3 · 第 1 行：铁锭｜铁锭｜铁锭`
 *
 * 一行一行写（而不是"第 1 格、第 5 格"这种编号）——玩家的脑子是按行扫的，
 * 而且这样读出来的顺序与眼睛看到的格子顺序一致。
 */
function shapedText(station: CraftStation, grid: 2 | 3, cells: ReadonlyArray<number | null>): string {
  const names = cells.map((id) => (id === null ? '空' : itemLabel(id)));
  const lines: string[] = [];
  for (let row = 0; row < grid; row++) {
    lines.push(`第 ${row + 1} 行：${names.slice(row * grid, row * grid + grid).join('｜')}`);
  }
  return `${stationLabel(station)} · ${lines.join(' · ')}`;
}

/** 无序配方 → 材料清单（摆放位置不影响结果） */
export function shapelessLayout(recipe: Recipe & { kind: 'shapeless' }): ShapelessLayout {
  const grid = recipeGridSize(recipe);
  const items = [...recipe.ingredients].sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (const id of items) counts.set(id, (counts.get(id) ?? 0) + 1);
  const parts = [...counts.entries()].map(([id, count]) => `${itemLabel(id)} ×${count}`);
  return {
    kind: 'shapeless',
    grid,
    station: stationOf(grid),
    items,
    text: `${stationLabel(stationOf(grid))} · 无序摆放（摆哪一格都行）：${parts.join('、')}`,
  };
}

export function recipeLayout(recipe: Recipe): RecipeLayout {
  return recipe.kind === 'shapeless' ? shapelessLayout(recipe) : shapedLayout(recipe);
}
