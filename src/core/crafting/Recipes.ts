/**
 * 合成配方
 *
 * 两种配方形态，对齐原版：
 *  - 有序（shaped）  ：用字符图案描述，匹配时会先把图案与网格都"裁剪到最小包围盒"，
 *                     所以 2×2 的配方放在 3×3 网格的任何角落都能合成（原版行为）。
 *  - 无序（shapeless）：只比较物品的多重集合，摆放位置无关。
 *
 * 匹配默认允许镜像（把图案左右翻转再比一次），这也是原版默认行为。
 */

import { Block, woolId } from '../registry/blocks.ts';
import { DYE_COLORS } from '../registry/colors.ts';
import { Item, dyeItemId } from '../registry/items.ts';

export interface RecipeResult {
  id: number;
  count: number;
}

export interface ShapelessRecipe {
  readonly kind: 'shapeless';
  readonly result: RecipeResult;
  readonly ingredients: readonly number[];
}

export interface ShapedRecipe {
  readonly kind: 'shaped';
  readonly result: RecipeResult;
  /** 每个字符串是一行，' ' 表示空 */
  readonly pattern: readonly string[];
  /** 字符 → 物品 id */
  readonly key: Readonly<Record<string, number>>;
  /** 是否允许镜像匹配，默认 true（原版行为） */
  readonly mirror?: boolean;
}

export type Recipe = ShapelessRecipe | ShapedRecipe;

const P = Block.OAK_PLANKS;
const LOG = Block.OAK_LOG;
const COBBLE = Block.COBBLESTONE;

/**
 * 基础配方（不需方块状态系统即可合成的部分）。
 *
 * 关于"配方数量"：原版约 1000+ 条，其中很大一部分属于**台阶 / 楼梯 / 门 / 栅栏 / 墙**
 * 这类非完整方块——它们必须先有方块状态与非常规形状渲染（任务 B4/E10）才能落地。
 * 这里先把"石材家族 + 羊毛染色 + 木质进阶"这条主干铺齐，
 * 台阶楼梯类配方已单独记录在 TASKS 的 B4 前置需求里。
 */
const BASE_RECIPES: readonly Recipe[] = [
  // ---- 木质进阶
  { kind: 'shapeless', result: { id: P, count: 4 }, ingredients: [LOG] },
  { kind: 'shaped', result: { id: Item.STICK, count: 4 }, pattern: ['P', 'P'], key: { P } },
  { kind: 'shaped', result: { id: Block.CRAFTING_TABLE, count: 1 }, pattern: ['PP', 'PP'], key: { P } },
  { kind: 'shaped', result: { id: Block.CHEST, count: 1 }, pattern: ['PPP', 'P P', 'PPP'], key: { P } },

  // ---- 石头 → 石砖 → 錾制石砖
  { kind: 'shaped', result: { id: Block.STONE_BRICKS, count: 4 }, pattern: ['SS', 'SS'], key: { S: Block.STONE } },
  {
    kind: 'shaped',
    result: { id: Block.CHISELED_STONE_BRICKS, count: 1 },
    pattern: ['S', 'S'],
    key: { S: Block.STONE_BRICKS },
  },

  // ---- 圆石 → 熔炉
  { kind: 'shaped', result: { id: Block.FURNACE, count: 1 }, pattern: ['CCC', 'C C', 'CCC'], key: { C: COBBLE } },

  // ---- 磨制变体（4 个原料 → 4 个磨制方块）
  { kind: 'shaped', result: { id: Block.POLISHED_GRANITE, count: 4 }, pattern: ['GG', 'GG'], key: { G: Block.GRANITE } },
  { kind: 'shaped', result: { id: Block.POLISHED_DIORITE, count: 4 }, pattern: ['DD', 'DD'], key: { D: Block.DIORITE } },
  { kind: 'shaped', result: { id: Block.POLISHED_ANDESITE, count: 4 }, pattern: ['AA', 'AA'], key: { A: Block.ANDESITE } },

  // ---- 深板岩链：深板岩 → 磨制深板岩 → 深板岩砖 → 錾制深板岩
  { kind: 'shaped', result: { id: Block.POLISHED_DEEPSLATE, count: 4 }, pattern: ['DD', 'DD'], key: { D: Block.DEEPSLATE } },
  {
    kind: 'shaped',
    result: { id: Block.DEEPSLATE_BRICKS, count: 4 },
    pattern: ['DD', 'DD'],
    key: { D: Block.POLISHED_DEEPSLATE },
  },
  {
    kind: 'shaped',
    result: { id: Block.CHISELED_DEEPSLATE, count: 1 },
    pattern: ['D', 'D'],
    key: { D: Block.DEEPSLATE_BRICKS },
  },

  // ---- 红砖：4 个砖 → 1 块砖方块
  { kind: 'shaped', result: { id: Block.BRICKS, count: 1 }, pattern: ['BB', 'BB'], key: { B: Item.BRICK } },

  // ---- 沙 → 砂岩
  { kind: 'shaped', result: { id: Block.SANDSTONE, count: 1 }, pattern: ['SS', 'SS'], key: { S: Block.SAND } },
];

/**
 * 羊毛染色：白色羊毛 + 任意染料 → 对应颜色的羊毛（原版是无序配方）。
 * 16 条由配色表批量生成，改动配色顺序时自动跟随。
 */
const WOOL_RECIPES: readonly Recipe[] = DYE_COLORS.map((_color, index) => ({
  kind: 'shapeless' as const,
  result: { id: woolId(index), count: 1 },
  ingredients: [woolId(0), dyeItemId(index)],
}));

export const RECIPES: readonly Recipe[] = [...BASE_RECIPES, ...WOOL_RECIPES];

interface Normalized {
  /** height × width，0 表示空 */
  rows: number[][];
  width: number;
  height: number;
}

/** 把扁平网格裁剪到最小包围盒；全空返回 null */
function normalizeGrid(cells: readonly number[], size: number): Normalized | null {
  let minRow = size;
  let maxRow = -1;
  let minCol = size;
  let maxCol = -1;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (cells[row * size + col] === 0) continue;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
    }
  }

  if (maxRow < 0) return null;

  const height = maxRow - minRow + 1;
  const width = maxCol - minCol + 1;
  const rows: number[][] = [];
  for (let row = 0; row < height; row++) {
    const line: number[] = [];
    for (let col = 0; col < width; col++) {
      line.push(cells[(minRow + row) * size + (minCol + col)]!);
    }
    rows.push(line);
  }
  return { rows, width, height };
}

/** 把字符图案裁剪并翻译成物品 id 矩阵 */
function normalizePattern(pattern: readonly string[], key: Readonly<Record<string, number>>): Normalized | null {
  const width = Math.max(...pattern.map((line) => line.length));
  const padded = pattern.map((line) => line.padEnd(width, ' '));
  const nonEmpty = padded.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) return null;

  let minCol = width;
  let maxCol = -1;
  for (const line of nonEmpty) {
    for (let col = 0; col < width; col++) {
      if (line[col] === ' ' || line[col] === undefined) continue;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
    }
  }

  const rows: number[][] = [];
  for (const line of nonEmpty) {
    const cells: number[] = [];
    for (let col = minCol; col <= maxCol; col++) {
      const ch = line[col] ?? ' ';
      cells.push(ch === ' ' ? 0 : (key[ch] ?? 0));
    }
    rows.push(cells);
  }
  return { rows, width: maxCol - minCol + 1, height: rows.length };
}

function sameShape(a: Normalized, b: Normalized): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let row = 0; row < a.height; row++) {
    for (let col = 0; col < a.width; col++) {
      if (a.rows[row]![col] !== b.rows[row]![col]) return false;
    }
  }
  return true;
}

function mirrorOf(shape: Normalized): Normalized {
  return {
    rows: shape.rows.map((line) => [...line].reverse()),
    width: shape.width,
    height: shape.height,
  };
}

function shapelessMatches(cells: readonly number[], ingredients: readonly number[]): boolean {
  const present = cells.filter((id) => id !== 0).sort((a, b) => a - b);
  const needed = [...ingredients].sort((a, b) => a - b);
  if (present.length !== needed.length) return false;
  return present.every((id, index) => id === needed[index]);
}

/**
 * 在 size×size 网格里匹配配方。
 * @param cells 扁平物品 id 数组（长度 size²），0 表示空
 */
export function matchRecipe(cells: readonly number[], size: 2 | 3): RecipeResult | null {
  const grid = normalizeGrid(cells, size);
  if (!grid) return null;

  for (const recipe of RECIPES) {
    if (recipe.kind === 'shapeless') {
      if (shapelessMatches(cells, recipe.ingredients)) return { ...recipe.result };
      continue;
    }

    const pattern = normalizePattern(recipe.pattern, recipe.key);
    if (!pattern) continue;
    if (sameShape(grid, pattern)) return { ...recipe.result };
    if (recipe.mirror !== false && sameShape(grid, mirrorOf(pattern))) return { ...recipe.result };
  }

  return null;
}

/** 该物品能参与哪些配方（UI 提示用） */
export function recipesUsing(itemId: number): readonly Recipe[] {
  return RECIPES.filter((recipe) =>
    recipe.kind === 'shapeless'
      ? recipe.ingredients.includes(itemId)
      : Object.values(recipe.key).includes(itemId),
  );
}
