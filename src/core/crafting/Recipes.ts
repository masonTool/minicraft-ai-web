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

import {
  Block,
  GLASS_PANE_ID,
  SHAPED_PARENTS,
  Wood,
  slabId,
  stairsId,
  stainedGlassId,
  stainedGlassPaneId,
  woolId,
} from '../registry/blocks.ts';
import { ARMOR_SPECS } from '../registry/armor.ts';
import { DYE_COLORS } from '../registry/colors.ts';
import { Item, dyeItemId } from '../registry/items.ts';
import { TOOL_SPECS } from '../registry/tools.ts';
import { DRINKABLE, lingeringIdOf, tippedArrowIdOf } from '../registry/potions.ts';

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

/**
 * 台阶与楼梯：由 12 个母方块批量生成，共 24 条。
 *  - 台阶：横排 3 个母方块 → 6 个台阶
 *  - 楼梯：阶梯状 6 个母方块 → 4 个楼梯（允许镜像，左右两侧的摆法都能合成）
 */
const SHAPED_BLOCK_RECIPES: readonly Recipe[] = SHAPED_PARENTS.flatMap(([parentId], index) => [
  {
    kind: 'shaped' as const,
    result: { id: slabId(index), count: 6 },
    pattern: ['PPP'],
    key: { P: parentId },
  },
  {
    kind: 'shaped' as const,
    result: { id: stairsId(index), count: 4 },
    pattern: ['P  ', 'PP ', 'PPP'],
    key: { P: parentId },
  },
]);

/** 栅栏 / 墙 / 门 / 梯子 / 火把 */
const UTILITY_RECIPES: readonly Recipe[] = [
  // 4 木板 + 2 木棍 → 3 栅栏
  {
    kind: 'shaped',
    result: { id: Block.OAK_FENCE, count: 3 },
    pattern: ['PSP', 'PSP'],
    key: { P, S: Item.STICK },
  },
  // 6 圆石 → 6 圆石墙
  {
    kind: 'shaped',
    result: { id: Block.COBBLESTONE_WALL, count: 6 },
    pattern: ['CCC', 'CCC'],
    key: { C: COBBLE },
  },
  // 6 石砖 → 6 石砖墙
  {
    kind: 'shaped',
    result: { id: Block.STONE_BRICK_WALL, count: 6 },
    pattern: ['BBB', 'BBB'],
    key: { B: Block.STONE_BRICKS },
  },
  // 6 木板竖排 2×3 → 3 扇门
  {
    kind: 'shaped',
    result: { id: Block.OAK_DOOR, count: 3 },
    pattern: ['PP', 'PP', 'PP'],
    key: { P },
  },
  // 6 木板横铺 3×2 → 2 个活板门（原版配方）
  {
    kind: 'shaped',
    result: { id: Block.OAK_TRAPDOOR, count: 2 },
    pattern: ['PPP', 'PPP'],
    key: { P },
  },
  // 2 木板 + 4 木棍 → 1 个栅栏门（原版的"两柱一门板"形状）
  {
    kind: 'shaped',
    result: { id: Block.OAK_FENCE_GATE, count: 1 },
    pattern: ['SPS', 'SPS'],
    key: { P, S: Item.STICK },
  },
  // 7 木棍摆成 H 形 → 3 个梯子
  {
    kind: 'shaped',
    result: { id: Block.LADDER, count: 3 },
    pattern: ['S S', 'SSS', 'S S'],
    key: { S: Item.STICK },
  },
  // 煤炭 / 木炭 + 木棍 → 4 个火把（两种燃料各写一条，配方匹配是精确物品匹配）
  {
    kind: 'shaped',
    result: { id: Block.TORCH, count: 4 },
    pattern: ['C', 'S'],
    key: { C: Item.COAL, S: Item.STICK },
  },
  {
    kind: 'shaped',
    result: { id: Block.TORCH, count: 4 },
    pattern: ['C', 'S'],
    key: { C: Item.CHARCOAL, S: Item.STICK },
  },
];

/**
 * 木材家族：每种木头 3 条（原木→木板、木板→台阶、木板→楼梯）。
 * 由 Wood 表批量生成，加一种木头自动获得全套配方。
 */
const WOOD_RECIPES: readonly Recipe[] = Object.values(Wood).flatMap((ids) => [
  { kind: 'shapeless' as const, result: { id: ids.planks, count: 4 }, ingredients: [ids.log] },
  { kind: 'shaped' as const, result: { id: ids.slab, count: 6 }, pattern: ['PPP'], key: { P: ids.planks } },
  {
    kind: 'shaped' as const,
    result: { id: ids.stairs, count: 4 },
    pattern: ['P  ', 'PP ', 'PPP'],
    key: { P: ids.planks },
  },
]);

/** 玻璃板：6 块玻璃横排两行 → 16 片；染色玻璃同理 */
const PANE_RECIPES: readonly Recipe[] = [
  {
    kind: 'shaped',
    result: { id: GLASS_PANE_ID, count: 16 },
    pattern: ['GGG', 'GGG'],
    key: { G: Block.GLASS },
  },
  ...DYE_COLORS.map(
    (_color, index): Recipe => ({
      kind: 'shaped',
      result: { id: stainedGlassPaneId(index), count: 16 },
      pattern: ['GGG', 'GGG'],
      key: { G: stainedGlassId(index) },
    }),
  ),
];

/**
 * 工具与武器：5 种类 × 5 材质 = 25 条，图案与原版一致。
 * 材质只影响"头部材料"，手柄一律是木棍。
 */
const TOOL_MATERIAL_INGREDIENTS: Record<string, number> = {
  wooden: P,
  stone: COBBLE,
  iron: Item.IRON_INGOT,
  golden: Item.GOLD_INGOT,
  diamond: Item.DIAMOND,
};

/** M = 材质，S = 木棍 */
const TOOL_PATTERNS: Record<string, readonly string[]> = {
  pickaxe: ['MMM', ' S ', ' S '],
  axe: ['MM', 'MS', ' S'],
  shovel: ['M', 'S', 'S'],
  hoe: ['MM', ' S', ' S'],
  sword: ['M', 'M', 'S'],
};

const TOOL_RECIPES: readonly Recipe[] = TOOL_SPECS.map((spec) => ({
  kind: 'shaped' as const,
  result: { id: spec.id, count: 1 },
  pattern: TOOL_PATTERNS[spec.tool.type]!,
  key: { M: TOOL_MATERIAL_INGREDIENTS[spec.tool.material]!, S: Item.STICK },
}));

/**
 * 盔甲：4 部位 × 4 材质 = 16 条，图案与原版一致（胸甲 8 块、护腿 7 块、头盔 5 块、靴子 4 块）。
 *
 * ⚠️ **锁链盔甲故意没有配方**，与原版一致（原版只能从穿甲的怪物掉落或与村民交易获得）。
 * 这里不是偷懒：锁链甲在原版的"材料"就是铁锭，图案也逐格相同——
 * 一旦给它写配方，就会和铁盔甲**完全撞车**（同样的材料、同样的图案），
 * 配方表里必然只剩先注册的那一条，玩家永远合不出另一条。
 * 代价是锁链甲目前只能从创造模式拿；等怪物会穿甲之后走"掉落"这条路补上。
 */
const ARMOR_MATERIAL_INGREDIENTS: Record<string, number | undefined> = {
  leather: Item.LEATHER,
  chainmail: undefined,
  iron: Item.IRON_INGOT,
  golden: Item.GOLD_INGOT,
  diamond: Item.DIAMOND,
};

/** M = 材质 */
const ARMOR_PATTERNS: Record<string, readonly string[]> = {
  helmet: ['MMM', 'M M'],
  chestplate: ['M M', 'MMM', 'MMM'],
  leggings: ['MMM', 'M M', 'M M'],
  boots: ['M M', 'M M'],
};

const ARMOR_RECIPES: readonly Recipe[] = ARMOR_SPECS.flatMap<Recipe>((spec) => {
  const ingredient = ARMOR_MATERIAL_INGREDIENTS[spec.armor.material];
  if (ingredient === undefined) return [];
  return [
    {
      kind: 'shaped' as const,
      result: { id: spec.id, count: 1 },
      pattern: ARMOR_PATTERNS[spec.armor.type]!,
      key: { M: ingredient },
    },
  ];
});

/**
 * 食物配方。目前只有金苹果（原版就这一条：8 个金锭围 1 个苹果）。
 * 面包要小麦、曲奇要可可豆、南瓜派要鸡蛋与糖——都缺前置物品，等农业系统。
 */
const FOOD_RECIPES: readonly Recipe[] = [
  {
    kind: 'shaped' as const,
    result: { id: Item.GOLDEN_APPLE, count: 1 },
    pattern: ['GGG', 'GAG', 'GGG'],
    key: { G: Item.GOLD_INGOT, A: Item.APPLE },
  },
];

/**
 * 附魔相关（H9）：纸 → 书 → 附魔台 / 书架。
 * 链条完整对上原版：甘蔗做纸、纸加皮革做书、书 + 钻石 + 黑曜石做附魔台、
 * 书 + 木板做书架（书架用来给附魔台加成）。
 */
const ENCHANT_RECIPES: readonly Recipe[] = [
  // 3 甘蔗 → 3 纸（原版是无序配方）
  { kind: 'shapeless' as const, result: { id: Item.PAPER, count: 3 }, ingredients: [Block.SUGAR_CANE, Block.SUGAR_CANE, Block.SUGAR_CANE] },
  // 3 纸 + 1 皮革 → 1 书（原版无序）
  { kind: 'shapeless' as const, result: { id: Item.BOOK, count: 1 }, ingredients: [Item.PAPER, Item.PAPER, Item.PAPER, Item.LEATHER] },
  {
    kind: 'shaped' as const,
    result: { id: Block.ENCHANTING_TABLE, count: 1 },
    pattern: [' B ', 'DOD', 'OOO'],
    key: { B: Item.BOOK, D: Item.DIAMOND, O: Block.OBSIDIAN },
  },
  {
    kind: 'shaped' as const,
    result: { id: Block.BOOKSHELF, count: 1 },
    pattern: ['PPP', 'BBB', 'PPP'],
    key: { P: P, B: Item.BOOK },
  },
  // 铁砧：3 个铁块 + 4 个铁锭（原版图案）
  {
    kind: 'shaped' as const,
    result: { id: Block.ANVIL, count: 1 },
    pattern: ['BBB', ' I ', 'III'],
    key: { B: Block.IRON_BLOCK, I: Item.IRON_INGOT },
  },
  // 铁块与铁锭互转（储物方块的标准做法）
  {
    kind: 'shaped' as const,
    result: { id: Block.IRON_BLOCK, count: 1 },
    pattern: ['III', 'III', 'III'],
    key: { I: Item.IRON_INGOT },
  },
  { kind: 'shapeless' as const, result: { id: Item.IRON_INGOT, count: 9 }, ingredients: [Block.IRON_BLOCK] },
  // ---- 酿造（H10）：3 玻璃 → 3 玻璃瓶（原版）
  {
    kind: 'shaped' as const,
    result: { id: Item.GLASS_BOTTLE, count: 3 },
    pattern: ['G G', ' G '],
    key: { G: Block.GLASS },
  },
  // 1 甘蔗 → 1 糖（原版无序）
  { kind: 'shapeless' as const, result: { id: Item.SUGAR, count: 1 }, ingredients: [Block.SUGAR_CANE] },
  // ---- 投掷物（K4 尾巴）：4 个雪球 → 1 块雪块（原版无序配方；雪块挖掉又掉 4 个雪球）
  {
    kind: 'shapeless' as const,
    result: { id: Block.SNOW_BLOCK, count: 1 },
    ingredients: [Item.SNOWBALL, Item.SNOWBALL, Item.SNOWBALL, Item.SNOWBALL],
  },
  // ---- 药水箭（K4 最后一步）：滞留药水 + 8 支箭 → 8 支药水箭（原版配方，1 瓶出 8 支）
  // 由药水表展开而不是手写 28 条：漏写一条只会表现成"某种药水箭合不出来"，不报错。
  // ⚠️ 必须用**滞留型**（不是饮用型/喷溅型）——这一条由断言盯着。
  ...DRINKABLE.map((potion) => ({
    kind: 'shapeless' as const,
    result: { id: tippedArrowIdOf(potion.id), count: 8 },
    ingredients: [lingeringIdOf(potion.id), ...Array<number>(8).fill(Item.ARROW)],
  })),
  // ---- 面包（H13）：3 个小麦横排（原版）
  {
    kind: 'shaped' as const,
    result: { id: Item.BREAD, count: 1 },
    pattern: ['WWW'],
    key: { W: Item.WHEAT },
  },
  // ---- 酿造台（H10）：3 圆石 + 1 烈焰粉（原版是 1 烈焰棒，本项目的烈焰棒还没做）
  {
    kind: 'shaped' as const,
    result: { id: Block.BREWING_STAND, count: 1 },
    pattern: ['CCC', ' B '],
    key: { C: Block.COBBLESTONE, B: Item.BLAZE_POWDER },
  },
  // ---- 桶（J8）：3 铁锭摆成 V 形（原版）
  {
    kind: 'shaped' as const,
    result: { id: Item.BUCKET, count: 1 },
    pattern: ['I I', ' I '],
    key: { I: Item.IRON_INGOT },
  },
  // ---- 剪刀（J8）：2 铁锭斜着摆（原版）
  {
    kind: 'shaped' as const,
    result: { id: Item.SHEARS, count: 1 },
    pattern: ['I ', ' I'],
    key: { I: Item.IRON_INGOT },
  },
  // ---- 弓与箭（J9）
  // 箭：1 燧石 + 1 木棍 + 1 羽毛 → 4 支（原版是无序配方）
  {
    kind: 'shapeless' as const,
    result: { id: Item.ARROW, count: 4 },
    ingredients: [Item.FLINT, Item.STICK, Item.FEATHER],
  },
  // 弓：3 木棍 + 3 线（原版图案，镜像摆法也能合成）
  {
    kind: 'shaped' as const,
    result: { id: Item.BOW, count: 1 },
    pattern: [' ST', 'S T', ' ST'],
    key: { S: Item.STRING, T: Item.STICK },
  },
  // ⚠️ 与 原版 的差异：原版是 4 线 → 1 羊毛，方向相反。
  // 这里反着来是因为**蜘蛛还没做**，否则"线"没有任何来源，弓就永远做不出来。
  {
    kind: 'shapeless' as const,
    result: { id: Item.STRING, count: 4 },
    ingredients: [woolId(0)],
  },
];

export const RECIPES: readonly Recipe[] = [
  ...BASE_RECIPES,
  ...WOOL_RECIPES,
  ...SHAPED_BLOCK_RECIPES,
  ...UTILITY_RECIPES,
  ...WOOD_RECIPES,
  ...PANE_RECIPES,
  ...TOOL_RECIPES,
  ...ARMOR_RECIPES,
  ...FOOD_RECIPES,
  ...ENCHANT_RECIPES,
];

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
