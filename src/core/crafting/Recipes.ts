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
  COPPER_STAGES,
  GLASS_PANE_ID,
  SHAPED_PARENTS,
  STONE_VARIANT_PARENTS,
  Wood,
  WoodShaped,
  carpetId,
  copperId,
  slabId,
  stairsId,
  stainedGlassId,
  stainedGlassPaneId,
  stoneVariantId,
  woolId,
} from '../registry/blocks.ts';
import { ARMOR_SPECS } from '../registry/armor.ts';
import { DYE_COLORS } from '../registry/colors.ts';
import { Item, dyeItemId } from '../registry/items.ts';
import { TOOL_SPECS } from '../registry/tools.ts';
import { DRINKABLE, lingeringIdOf, tippedArrowIdOf } from '../registry/potions.ts';

/** 配色表里"棕色"的下标（可可豆做棕色染料用；按名字查，不写死数字） */
const BROWN_DYE_INDEX = DYE_COLORS.findIndex((color) => color.name === 'brown');

/**
 * 橡木台阶在 `SHAPED_PARENTS` 里的下标（阳光传感器配方要"3 个木台阶"）。
 * ⚠️ 同样**按名字查**：那张变体表一旦调整顺序，写死的数字会让配方悄悄变成"石头台阶"。
 */
const OAK_SLAB_INDEX = SHAPED_PARENTS.findIndex(([, name]) => name === 'oak_planks');

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

  // ---- 砂岩家族与红砂岩家族（批次 45）
  //
  // 原版这两条链**完全同构**，所以这里成对写、也成对断言：
  //   4 沙 → 1 砂岩            ｜ 4 红沙 → 1 红砂岩
  //   4 砂岩 → 4 切制砂岩       ｜ 4 红砂岩 → 4 切制红砂岩
  //   2 砂岩台阶 → 1 錾制砂岩    ｜ 2 红砂岩台阶 → 1 錾制红砂岩
  //   （平滑砂岩走熔炼，见 Smelting.ts；切制/錾制也能用切石机，两条路都通）
  //
  // ⚠️ 普通砂岩的"切制 / 錾制"此前**只有切石机这一条路**（批次 44 才补上），
  // 原版这两条合成配方一直都在——本批顺手补齐，两个家族从此一模一样。
  { kind: 'shaped', result: { id: Block.CUT_SANDSTONE, count: 4 }, pattern: ['SS', 'SS'], key: { S: Block.SANDSTONE } },
  { kind: 'shaped', result: { id: Block.CHISELED_SANDSTONE, count: 1 }, pattern: ['S', 'S'], key: { S: slabId(3) } },
  { kind: 'shaped', result: { id: Block.RED_SANDSTONE, count: 1 }, pattern: ['SS', 'SS'], key: { S: Block.RED_SAND } },
  { kind: 'shaped', result: { id: Block.CUT_RED_SANDSTONE, count: 4 }, pattern: ['SS', 'SS'], key: { S: Block.RED_SANDSTONE } },
  {
    kind: 'shaped',
    result: { id: Block.CHISELED_RED_SANDSTONE, count: 1 },
    pattern: ['S', 'S'],
    key: { S: stoneVariantId('red_sandstone', 'slab')! },
  },
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
 * 地毯（批次 37）：2 个同色羊毛 → 3 块地毯（原版配方）。
 *
 * 与羊毛染色一样按配色表批量生成，16 条。颜色**必须一一对应**：
 * 写成"任意羊毛 → 任意地毯"虽然也能用，但玩家拿红羊毛合出橙地毯会以为是自己看错了。
 */
const CARPET_RECIPES: readonly Recipe[] = DYE_COLORS.map((_color, index) => ({
  kind: 'shapeless' as const,
  result: { id: carpetId(index), count: 3 },
  ingredients: [woolId(index), woolId(index)],
}));

/**
 * 熔炉的两个变体（批次 46）：烟熏炉与高炉。
 *
 * ⚠️ 烟熏炉在原版是"**任意原木** + 熔炉"的标签配方，这里**按木材种类展开成 6 条**
 * （橡木 + `Wood` 表的 5 种）——只写橡木会变成"配方书里写着能做、手里拿云杉原木却做不了"。
 * 这也是本项目处理"标签配方"的既有做法（见 `WOOD_RECIPES`）。
 *
 * 高炉是固定配方：5 铁锭 + 1 熔炉 + 3 平滑石头（原版图案）。
 */
const FURNACE_VARIANT_RECIPES: readonly Recipe[] = [
  ...[Block.OAK_LOG, ...Object.values(Wood).map((ids) => ids.log)].map(
    (log): Recipe => ({
      kind: 'shaped',
      result: { id: Block.SMOKER, count: 1 },
      pattern: [' L ', 'LFL', ' L '],
      key: { L: log, F: Block.FURNACE },
    }),
  ),
  {
    kind: 'shaped',
    result: { id: Block.BLAST_FURNACE, count: 1 },
    pattern: ['III', 'IFI', 'SSS'],
    key: { I: Item.IRON_INGOT, F: Block.FURNACE, S: Block.SMOOTH_STONE },
  },
  /**
   * 营火（批次 47）：3 木棍 + 1 煤炭/木炭 + 3 原木（原版图案）。
   *
   * 与烟熏炉同一套"标签配方展开"：**6 种原木 × 2 种燃料 = 12 条**。
   * ⚠️ 木炭那 6 条不能省：原版煤炭与木炭都能用，而**木炭是前期最容易拿到的那种**
   *（挖不到煤的时候就是它），只认煤炭会变成"配方书里写着能做、手里却做不了"。
   */
  ...[
    [Block.OAK_LOG, ...Object.values(Wood).map((ids) => ids.log)],
  ].flatMap((logs) =>
    logs.flatMap((log) =>
      [Item.COAL, Item.CHARCOAL].map(
        (fuel): Recipe => ({
          kind: 'shaped',
          result: { id: Block.CAMPFIRE, count: 1 },
          pattern: [' S ', 'SCS', 'LLL'],
          key: { S: Item.STICK, C: fuel, L: log },
        }),
      ),
    ),
  ),
];

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

/** 墙 / 梯子 / 火把（栅栏与门类见 `WOOD_SHAPED_RECIPES`，那边按木材表展开） */
const UTILITY_RECIPES: readonly Recipe[] = [
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
  // 1 铁锭 + 2 铁粒 → 1 根锁链（B11；原版是竖着「粒-锭-粒」）
  {
    kind: 'shaped',
    result: { id: Block.CHAIN, count: 1 },
    pattern: ['N', 'I', 'N'],
    key: { N: Item.IRON_NUGGET, I: Item.IRON_INGOT },
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
 * 铜的四档（批次 40）：每档 4 条 —— 9 铜锭 ↔ 1 铜块、4 铜块 → 4 切制铜、
 * 3 切制铜 → 6 台阶、6 切制铜 → 4 楼梯（后三条都是原版配方）。
 *
 * 按档展开而不是手抄 16 条：铜的"档"就是 `COPPER_STAGES` 的下标，
 * 加一档氧化自动带上全套（这也是"能生成的就别手抄"那条老规矩）。
 */
const COPPER_RECIPES: readonly Recipe[] = COPPER_STAGES.flatMap((_stage, stage): Recipe[] => {
  const block = copperId(stage, 0);
  const cut = copperId(stage, 1);
  return [
    // ⚠️ 只有**新铜**能由 9 铜锭合成：锈是"放出来的"，不是做出来的（原版如此）
    ...(stage === 0
      ? ([
          {
            kind: 'shaped' as const,
            result: { id: block, count: 1 },
            pattern: ['III', 'III', 'III'],
            key: { I: Item.COPPER_INGOT },
          },
        ] as Recipe[])
      : ([] as Recipe[])),
    // 反过来：**任意档**都能拆回 9 铜锭（锈了就熔回去。原版对已氧化档是否可拆没查证到，
    // 这里做成可拆并记进 TASKS——不给玩家留"一堵锈墙只能砸了重做"的死路）
    { kind: 'shapeless', result: { id: Item.COPPER_INGOT, count: 9 }, ingredients: [block] },
    {
      kind: 'shaped',
      result: { id: cut, count: 4 },
      pattern: ['CC', 'CC'],
      key: { C: block },
    },
    {
      kind: 'shaped',
      result: { id: copperId(stage, 2), count: 6 },
      pattern: ['CCC'],
      key: { C: cut },
    },
    {
      kind: 'shaped',
      result: { id: copperId(stage, 3), count: 4 },
      pattern: ['C  ', 'CC ', 'CCC'],
      key: { C: cut },
    },
  ];
});

/**
 * 石材家族的变体（批次 41）：每种变体一条原版配方 ——
 * 台阶「3 个母方块横排 → 6 个」、楼梯「6 个摆成阶梯 → 4 个」、
 * 墙「6 个摆成 2×3 → 6 个」（与 `cobblestone_wall` 那条同形）。
 *
 * 由 `STONE_VARIANT_PARENTS` 展开：加一个变体（往那张表里加一个词）就自动带上配方，
 * 材料恒为**它自己的母方块**（花岗岩台阶只能用花岗岩做，与原版一致）。
 */
const STONE_VARIANT_RECIPES: readonly Recipe[] = STONE_VARIANT_PARENTS.flatMap(
  ([parent, name, kinds]): Recipe[] =>
    kinds.map((kind): Recipe => {
      const id = stoneVariantId(name, kind)!;
      if (kind === 'slab') {
        return { kind: 'shaped', result: { id, count: 6 }, pattern: ['PPP'], key: { P: parent } };
      }
      if (kind === 'stairs') {
        return {
          kind: 'shaped',
          result: { id, count: 4 },
          pattern: ['P  ', 'PP ', 'PPP'],
          key: { P: parent },
        };
      }
      return { kind: 'shaped', result: { id, count: 6 }, pattern: ['PPP', 'PPP'], key: { P: parent } };
    }),
);

/**
 * 石英家族 / 深板岩瓦 / 红色下界砖（批次 42）：原版的 5 条合成配方。
 *
 * 石英链的原料是**下界石英**——它此前根本没有物品（下界石英矿石掉的是方块本身），
 * 所以这一批先补上"矿石 → 下界石英"的掉落覆盖，石英家族才有来源。
 * 平滑石英走熔炼（见 `Smelting.ts`）。
 */
const QUARTZ_AND_STONE_RECIPES: readonly Recipe[] = [
  // 4 下界石英（2×2）→ 1 石英块
  {
    kind: 'shaped',
    result: { id: Block.QUARTZ_BLOCK, count: 1 },
    pattern: ['QQ', 'QQ'],
    key: { Q: Item.QUARTZ },
  },
  // 2 石英块竖排 → 2 石英柱（原版）
  {
    kind: 'shaped',
    result: { id: Block.QUARTZ_PILLAR, count: 2 },
    pattern: ['Q', 'Q'],
    key: { Q: Block.QUARTZ_BLOCK },
  },
  // 2 石英台阶竖排 → 1 錾制石英块（原版就是拿台阶拼的）
  {
    kind: 'shaped',
    result: { id: Block.CHISELED_QUARTZ_BLOCK, count: 1 },
    pattern: ['S', 'S'],
    key: { S: stoneVariantId('quartz_block', 'slab')! },
  },
  // 4 磨制深板岩（2×2）→ 4 深板岩瓦
  {
    kind: 'shaped',
    result: { id: Block.DEEPSLATE_TILES, count: 4 },
    pattern: ['DD', 'DD'],
    key: { D: Block.POLISHED_DEEPSLATE },
  },
  // 2 下界砖 + 2 下界疣（棋盘 2×2）→ 1 红色下界砖
  {
    kind: 'shaped',
    result: { id: Block.RED_NETHER_BRICKS, count: 1 },
    pattern: ['NW', 'WN'],
    key: { N: Block.NETHER_BRICKS, W: Item.NETHER_WART },
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

/**
 * 木制方块族（批次 38）：每种木材 4 条——栅栏 / 栅栏门 / 门 / 活板门。
 *
 * 配方与原版一致，且**材料必须是同一种木材**（云杉木板做云杉门），
 * 所以由木材表展开而不是手抄 24 条。橡木的四条以前是手写在 `UTILITY_RECIPES` 里的，
 * 这一批并了过来——同一种东西只留一个出处，否则"改了配方忘了另一份"迟早发生。
 *
 * ⚠️ 不能两边都留：`matchRecipe` 取**首个匹配**，重复配方会让后一条永远合不出来。
 */
const WOOD_SHAPED_RECIPES: readonly Recipe[] = Object.entries(WoodShaped).flatMap(([name, ids]): Recipe[] => {
  // 橡木的木板是基础方块（id 7），不在 `Wood` 表里
  const planks = name === 'oak' ? Block.OAK_PLANKS : Wood[name]!.planks;
  return [
    // 4 木板 + 2 木棍 → 3 栅栏
    {
      kind: 'shaped' as const,
      result: { id: ids.fence, count: 3 },
      pattern: ['PSP', 'PSP'],
      key: { P: planks, S: Item.STICK },
    },
    // 2 木板 + 4 木棍 → 1 栅栏门（原版的"两柱一门板"）
    {
      kind: 'shaped' as const,
      result: { id: ids.fenceGate, count: 1 },
      pattern: ['SPS', 'SPS'],
      key: { P: planks, S: Item.STICK },
    },
    // 6 木板竖排 2×3 → 3 扇门
    {
      kind: 'shaped' as const,
      result: { id: ids.door, count: 3 },
      pattern: ['PP', 'PP', 'PP'],
      key: { P: planks },
    },
    // 6 木板横铺 3×2 → 2 个活板门
    {
      kind: 'shaped' as const,
      result: { id: ids.trapdoor, count: 2 },
      pattern: ['PPP', 'PPP'],
      key: { P: planks },
    },
  ];
});

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

// ⚠️ 要滤掉"没有合成材料"的材质：下界合金工具只能由锻造台升级而来，
// 在这里给它配一条配方就等于"4 个下界合金锭能直接做出一把镐"，与原版不符
const TOOL_RECIPES: readonly Recipe[] = TOOL_SPECS.filter(
  (spec) => TOOL_MATERIAL_INGREDIENTS[spec.tool.material] !== undefined,
).map((spec) => ({
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
  // 铁锭 ↔ 铁粒（B11，原版两向都有）：9 粒合成 1 锭，1 锭拆成 9 粒
  { kind: 'shapeless' as const, result: { id: Item.IRON_INGOT, count: 1 }, ingredients: [Item.IRON_NUGGET, Item.IRON_NUGGET, Item.IRON_NUGGET, Item.IRON_NUGGET, Item.IRON_NUGGET, Item.IRON_NUGGET, Item.IRON_NUGGET, Item.IRON_NUGGET, Item.IRON_NUGGET] },
  { kind: 'shapeless' as const, result: { id: Item.IRON_NUGGET, count: 9 }, ingredients: [Item.IRON_INGOT] },
  // ---- 食物与杂物（批次 48，B17）
  // 金锭 ↔ 金粒（与铁粒同一套两向配方）
  { kind: 'shapeless' as const, result: { id: Item.GOLD_INGOT, count: 1 }, ingredients: Array<number>(9).fill(Item.GOLD_NUGGET) },
  { kind: 'shapeless' as const, result: { id: Item.GOLD_NUGGET, count: 9 }, ingredients: [Item.GOLD_INGOT] },
  // 碗：3 木板摆成 V 形 → 4 个（原版图案）。蘑菇煲 / 甜菜汤都要它
  { kind: 'shaped' as const, result: { id: Item.BOWL, count: 4 }, pattern: ['P P', ' P '], key: { P: Block.OAK_PLANKS } },
  // 蘑菇煲：红蘑菇 + 棕蘑菇 + 碗（原版无序）
  { kind: 'shapeless' as const, result: { id: Item.MUSHROOM_STEW, count: 1 }, ingredients: [Block.RED_MUSHROOM, Block.BROWN_MUSHROOM, Item.BOWL] },
  // 甜菜汤：6 个甜菜根 + 碗（原版无序）
  {
    kind: 'shapeless' as const,
    result: { id: Item.BEETROOT_SOUP, count: 1 },
    ingredients: [Item.BEETROOT, Item.BEETROOT, Item.BEETROOT, Item.BEETROOT, Item.BEETROOT, Item.BEETROOT, Item.BOWL],
  },
  // 南瓜派：南瓜 + 糖 + 蛋（原版无序）——三样本项目都已经有
  { kind: 'shapeless' as const, result: { id: Item.PUMPKIN_PIE, count: 1 }, ingredients: [Block.PUMPKIN, Item.SUGAR, Item.EGG] },
  // 曲奇（批次 49）：2 小麦 + 1 可可豆 → **8 个**（原版无序配方，一次出一堆）
  {
    kind: 'shapeless' as const,
    result: { id: Item.COOKIE, count: 8 },
    ingredients: [Item.WHEAT, Item.WHEAT, Item.COCOA_BEANS],
  },
  // 棕色染料（批次 49）：1 个可可豆 → 1 个棕色染料（原版；可可豆在 1.14 之后只用来做染料与曲奇）
  // ⚠️ 下标**按名字查**而不是写死数字：配色表的下标一改（或中间插一种颜色），
  // 写死的数字会让"可可豆做出浅蓝色染料"——这种错在界面上看着就像个恶作剧
  { kind: 'shapeless' as const, result: { id: dyeItemId(BROWN_DYE_INDEX), count: 1 }, ingredients: [Item.COCOA_BEANS] },

  // ---- 可疑的炖菜（批次 57，B17 收口）
  // 原版是**无序配方**：碗 + 红蘑菇 + 棕蘑菇 + **任意一朵花**，效果看用的是哪朵花。
  // 项目里没有物品 NBT，所以按花分成 5 条配方 / 5 个 id（见 items.ts 的注释）
  {
    kind: 'shapeless' as const,
    result: { id: Item.SUSPICIOUS_STEW_DANDELION, count: 1 },
    ingredients: [Item.BOWL, Block.RED_MUSHROOM, Block.BROWN_MUSHROOM, Block.DANDELION],
  },
  {
    kind: 'shapeless' as const,
    result: { id: Item.SUSPICIOUS_STEW_POPPY, count: 1 },
    ingredients: [Item.BOWL, Block.RED_MUSHROOM, Block.BROWN_MUSHROOM, Block.POPPY],
  },
  {
    kind: 'shapeless' as const,
    result: { id: Item.SUSPICIOUS_STEW_BLUE_ORCHID, count: 1 },
    ingredients: [Item.BOWL, Block.RED_MUSHROOM, Block.BROWN_MUSHROOM, Block.BLUE_ORCHID],
  },
  {
    kind: 'shapeless' as const,
    result: { id: Item.SUSPICIOUS_STEW_OXEYE_DAISY, count: 1 },
    ingredients: [Item.BOWL, Block.RED_MUSHROOM, Block.BROWN_MUSHROOM, Block.OXEYE_DAISY],
  },
  {
    kind: 'shapeless' as const,
    result: { id: Item.SUSPICIOUS_STEW_CORNFLOWER, count: 1 },
    ingredients: [Item.BOWL, Block.RED_MUSHROOM, Block.BROWN_MUSHROOM, Block.CORNFLOWER],
  },

  // ---- TNT（批次 56）
  // 原版：**5 个火药（四角 + 中心）+ 4 个沙**（十字位置）
  {
    kind: 'shaped' as const,
    result: { id: Block.TNT, count: 1 },
    pattern: ['GSG', 'SGS', 'GSG'],
    key: { G: Item.GUNPOWDER, S: Block.SAND },
  },

  // ---- 绊线钩（批次 55）
  // 原版：铁锭 / 木棍 / 木板 竖着摆 → **2 个**绊线钩
  {
    kind: 'shaped' as const,
    result: { id: Block.TRIPWIRE_HOOK, count: 2 },
    pattern: ['I', 'S', 'P'],
    key: { I: Item.IRON_INGOT, S: Item.STICK, P: Block.OAK_PLANKS },
  },

  // ---- 阳光传感器（批次 54）
  // 原版：3 玻璃 + 3 下界石英 + 3 木台阶（一排一层）。台阶按名字查，不写死下标
  {
    kind: 'shaped' as const,
    result: { id: Block.DAYLIGHT_DETECTOR, count: 1 },
    pattern: ['GGG', 'QQQ', 'SSS'],
    key: { G: Block.GLASS, Q: Item.QUARTZ, S: slabId(OAK_SLAB_INDEX) },
  },

  // ---- 脚手架（批次 53）
  // 原版：**6 根竹子 + 1 根线 → 6 个脚手架**（上下两排竹子、中间一根线）
  {
    kind: 'shaped' as const,
    result: { id: Block.SCAFFOLDING, count: 6 },
    pattern: ['BBB', ' S ', 'BBB'],
    key: { B: Block.BAMBOO, S: Item.STRING },
  },

  // ---- 蛋糕与花盆（批次 52）
  // 蛋糕（原版图案）：一排牛奶 + 糖蛋糖 + 一排小麦。3 个牛奶桶**不退还**（原版也如此）
  {
    kind: 'shaped' as const,
    result: { id: Block.CAKE, count: 1 },
    pattern: ['MMM', 'SES', 'WWW'],
    key: { M: Item.MILK_BUCKET, S: Item.SUGAR, E: Item.EGG, W: Item.WHEAT },
  },
  // 花盆（原版）：3 个红砖摆成 V 形 → 1 个花盆
  {
    kind: 'shaped' as const,
    result: { id: Block.FLOWER_POT, count: 1 },
    pattern: ['B B', ' B '],
    key: { B: Item.BRICK },
  },

  // ---- 海带与干海带（批次 50）
  // 9 个干海带 ↔ 1 块干海带块（原版两向都有）。
  // 干海带块是本批唯一的"燃料"产出：**一块能烧 20 个东西**（见 `Smelting.ts` 的燃料表）
  { kind: 'shapeless' as const, result: { id: Block.DRIED_KELP_BLOCK, count: 1 }, ingredients: Array<number>(9).fill(Item.DRIED_KELP) },
  { kind: 'shapeless' as const, result: { id: Item.DRIED_KELP, count: 9 }, ingredients: [Block.DRIED_KELP_BLOCK] },

  // 金胡萝卜：8 金粒围 1 胡萝卜（原版图案）——金粒这一批刚补上，这条链才成立
  {
    kind: 'shaped' as const,
    result: { id: Item.GOLDEN_CARROT, count: 1 },
    pattern: ['NNN', 'NCN', 'NNN'],
    key: { N: Item.GOLD_NUGGET, C: Item.CARROT },
  },

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
  // ---- 雪层（批次 37）：3 块雪块横排 → 6 层雪（原版配方）。
  // 反过来 4 层雪合成 1 块雪块——原版**没有**这条，所以这里也不做（雪块只能由雪球合成）
  {
    kind: 'shaped' as const,
    result: { id: Block.SNOW, count: 6 },
    pattern: ['SSS'],
    key: { S: Block.SNOW_BLOCK },
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
  // 打火石（I12）：1 铁锭 + 1 燧石（原版是无序配方）
  {
    kind: 'shapeless' as const,
    result: { id: Item.FLINT_AND_STEEL, count: 1 },
    ingredients: [Item.IRON_INGOT, Item.FLINT],
  },
  // ---- 下界合金（K8 尾巴）
  // 下界合金锭：4 碎片 + 4 金锭（原版是无序配方，"4+4"这个配比就是它的全部难点）
  {
    kind: 'shapeless' as const,
    result: { id: Item.NETHERITE_INGOT, count: 1 },
    ingredients: [
      Item.NETHERITE_SCRAP,
      Item.NETHERITE_SCRAP,
      Item.NETHERITE_SCRAP,
      Item.NETHERITE_SCRAP,
      Item.GOLD_INGOT,
      Item.GOLD_INGOT,
      Item.GOLD_INGOT,
      Item.GOLD_INGOT,
    ],
  },
  // 下界合金块与锭互转（与铁块同款）
  {
    kind: 'shaped' as const,
    result: { id: Block.NETHERITE_BLOCK, count: 1 },
    pattern: ['III', 'III', 'III'],
    key: { I: Item.NETHERITE_INGOT },
  },
  { kind: 'shapeless' as const, result: { id: Item.NETHERITE_INGOT, count: 9 }, ingredients: [Block.NETHERITE_BLOCK] },
  // 锻造台：4 木板 + 2 铁锭（原版图案：上一排两铁锭、下面两块各两木板）
  {
    kind: 'shaped' as const,
    result: { id: Block.SMITHING_TABLE, count: 1 },
    pattern: ['II', 'PP', 'PP'],
    key: { I: Item.IRON_INGOT, P: Block.OAK_PLANKS },
  },
  // ---- 切石机（H11，批次 44）：1 铁锭 + 3 石头（原版图案：铁锭在上一排中间、三块石头一排）
  {
    kind: 'shaped' as const,
    result: { id: Block.STONECUTTER, count: 1 },
    pattern: [' I ', 'SSS'],
    key: { I: Item.IRON_INGOT, S: Block.STONE },
  },
  // ⚠️ 下界合金的**工具与盔甲没有配方**：它们只能在锻造台上、由对应的钻石装备 + 1 个
  // 下界合金锭升级而来（见 `core/crafting/Smithing.ts`），与原版一致。
  // ⚠️ 与 原版 的差异：原版是 4 线 → 1 羊毛，方向相反。
  // 这里反着来是因为**蜘蛛还没做**，否则"线"没有任何来源，弓就永远做不出来。
  {
    kind: 'shapeless' as const,
    result: { id: Item.STRING, count: 4 },
    ingredients: [woolId(0)],
  },
  // 骨粉（批次 69）：原版就是"1 根骨头磨成 3 份"，不需要工作台之外的任何东西。
  // 骨头来自骷髅（生物掉落物这条链已经通了），所以骨粉是**可再生**的。
  {
    kind: 'shapeless' as const,
    result: { id: Item.BONE_MEAL, count: 3 },
    ingredients: [Item.BONE],
  },
];

/**
 * 容器类功能方块（批次 58 起）：漏斗、投掷器。
 *
 * 原版图案：
 *  - 漏斗 = **5 个铁锭围住 1 个箱子**（中间那格是箱子）；
 *  - 投掷器 = **7 个圆石围住 1 个红石粉**（中间那格是红石粉）；
 *  - 发射器（下一批）= 7 个圆石围住 1 个**弓**——与投掷器只差中间那一格。
 *
 * 记在 TASKS H14 下：木桶 / 发射器与它们同一族，后续按同样方式往这里加。
 */
const CONTAINER_RECIPES: readonly Recipe[] = [
  {
    kind: 'shaped' as const,
    result: { id: Block.HOPPER, count: 1 },
    pattern: ['I I', 'ICI', ' I '],
    key: { I: Item.IRON_INGOT, C: Block.CHEST },
  },
  {
    kind: 'shaped' as const,
    result: { id: Block.DROPPER, count: 1 },
    pattern: ['CCC', 'CRC', 'CCC'],
    key: { C: Block.COBBLESTONE, R: Item.REDSTONE },
  },
  {
    // 发射器（批次 60）：原版就是"中间换成弓"（其余七格与投掷器逐格相同）
    kind: 'shaped' as const,
    result: { id: Block.DISPENSER, count: 1 },
    pattern: ['CCC', 'CBC', 'CCC'],
    key: { C: Block.COBBLESTONE, B: Item.BOW },
  },
  {
    // 堆肥桶（批次 70）：原版图案 = **7 个木板台阶**（围一圈、中间空着）。
    // 与木桶不同，它**不需要**工作台之外的东西；四角的台阶也照原版给足 7 个
    kind: 'shaped' as const,
    result: { id: Block.COMPOSTER, count: 1 },
    pattern: ['SSS', 'S S', 'SSS'],
    key: { S: slabId(OAK_SLAB_INDEX) },
  },
  {
    // 木桶（批次 61）：原版图案 = 6 块木板 + 上下两个**木板台阶**（左右两列各 3 块）
    kind: 'shaped' as const,
    result: { id: Block.BARREL, count: 1 },
    pattern: ['PSP', 'P P', 'PSP'],
    key: { P: Block.OAK_PLANKS, S: slabId(OAK_SLAB_INDEX) },
  },
];

export const RECIPES: readonly Recipe[] = [
  ...BASE_RECIPES,
  ...CONTAINER_RECIPES,
  ...FURNACE_VARIANT_RECIPES,
  ...WOOL_RECIPES,
  ...CARPET_RECIPES,
  ...SHAPED_BLOCK_RECIPES,
  ...UTILITY_RECIPES,
  ...WOOD_RECIPES,
  ...WOOD_SHAPED_RECIPES,
  ...COPPER_RECIPES,
  ...STONE_VARIANT_RECIPES,
  ...QUARTZ_AND_STONE_RECIPES,
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
