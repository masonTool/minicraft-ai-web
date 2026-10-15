/**
 * 物品注册表
 *
 * id 空间约定：
 *   - 0            ：空
 *   - 1 ~ 99       ：方块物品，**id 与方块 id 完全相同**
 *                    （好处：破坏方块掉落自身时不需要任何映射，放置时反向查表也直接）
 *   - 100 及以上   ：非方块物品（煤炭、矿物原矿、木棍等）
 *
 * 工具等级沿用原版：0 木 / 1 石 / 2 铁 / 3 钻石 / 4 下界合金。
 */

import { ARMOR_SPECS, type ArmorInfo } from './armor.ts';
import { Block, Wood, blockDef, woolId } from './blocks.ts';
import { DYE_COLORS } from './colors.ts';
import { foodForName, type FoodInfo } from './food.ts';
import { TOOL_SPECS, type ToolInfo } from './tools.ts';

export const MAX_STACK = 64;

export type { ToolType, ToolInfo } from './tools.ts';
export type { ArmorInfo, ArmorMaterial, ArmorSlot, ArmorSlotType } from './armor.ts';
export type { FoodEffect, FoodInfo } from './food.ts';
export { TOOL_SPECS } from './tools.ts';
export { ARMOR_SPECS } from './armor.ts';
export { EAT_SECONDS, saturationFrom } from './food.ts';

export interface ItemDef {
  readonly id: number;
  readonly name: string;
  readonly maxStack: number;
  /** 可放置方块时对应的方块 id */
  readonly block?: number;
  /** 图标贴图名 */
  readonly tile: string;
  readonly tool?: ToolInfo;
  readonly armor?: ArmorInfo;
  /** 可食用时对应的食物数值（饥饿/饱和度/附加效果） */
  readonly food?: FoodInfo;
}

/** 方块物品可用的 id 上限：非方块物品一律从 1000 起，两段空间彻底隔开 */
export const BLOCK_ITEM_ID_LIMIT = 1000;

/** 非方块物品的 id 常量 */
export const Item = {
  AIR: 0,
  COAL: 1000,
  RAW_IRON: 1001,
  RAW_COPPER: 1002,
  RAW_GOLD: 1003,
  REDSTONE: 1004,
  LAPIS_LAZULI: 1005,
  DIAMOND: 1006,
  EMERALD: 1007,
  STICK: 1008,
  IRON_INGOT: 1009,
  GOLD_INGOT: 1010,
  COPPER_INGOT: 1011,
  CHARCOAL: 1012,
  BRICK: 1013,
  CLAY_BALL: 1014,
  // ---- 生物掉落物
  ROTTEN_FLESH: 1060,
  BONE: 1061,
  GUNPOWDER: 1062,
  BEEF: 1063,
  PORKCHOP: 1064,
  MUTTON: 1065,
  CHICKEN: 1066,
  LEATHER: 1067,
  FEATHER: 1068,
  // ---- 附魔相关材料（H9）
  PAPER: 1070,
  BOOK: 1071,
  // ---- 食物（数值表在 `food.ts`，这里只占 id）
  COOKED_BEEF: 1040,
  COOKED_PORKCHOP: 1041,
  COOKED_MUTTON: 1042,
  COOKED_CHICKEN: 1043,
  APPLE: 1044,
  MELON_SLICE: 1045,
  GOLDEN_APPLE: 1046,
} as const;

/**
 * 染料物品 id 起始值，顺序与 DYE_COLORS 一致。
 *
 * ⚠️ **改这里之前先看 `MOB_DROP_ITEM_START`**：16 种染料占 1020~1035，
 * 之前生物掉落物从 1030 起排，正好和染料压在一起，
 * 于是"腐肉/骨头/火药/生牛肉/生猪排/生羊肉"这 6 件在物品表里**被染料覆盖**——
 * 捡起来显示成"紫色染料"、还能和真染料堆在一格。
 * 现在由 `register()` 在启动时直接抛错挡住这类撞车。
 */
export const DYE_ITEM_START = 1020;

/** 生物掉落物的 id 起点（与染料区 1020~1035、食物区 1040~1046 都错开） */
export const MOB_DROP_ITEM_START = 1060;

/** 第 index 种染料的物品 id */
export function dyeItemId(colorIndex: number): number {
  return DYE_ITEM_START + colorIndex;
}

interface NonBlockItemSpec {
  id: number;
  name: string;
  tile: string;
  maxStack?: number;
}

const BASE_NON_BLOCK_SPECS: readonly NonBlockItemSpec[] = [
  { id: Item.COAL, name: 'minecraft:coal', tile: 'item_coal' },
  { id: Item.RAW_IRON, name: 'minecraft:raw_iron', tile: 'item_raw_iron' },
  { id: Item.RAW_COPPER, name: 'minecraft:raw_copper', tile: 'item_raw_copper' },
  { id: Item.RAW_GOLD, name: 'minecraft:raw_gold', tile: 'item_raw_gold' },
  { id: Item.REDSTONE, name: 'minecraft:redstone', tile: 'item_redstone' },
  { id: Item.LAPIS_LAZULI, name: 'minecraft:lapis_lazuli', tile: 'item_lapis' },
  { id: Item.DIAMOND, name: 'minecraft:diamond', tile: 'item_diamond' },
  { id: Item.EMERALD, name: 'minecraft:emerald', tile: 'item_emerald' },
  { id: Item.STICK, name: 'minecraft:stick', tile: 'item_stick' },
  { id: Item.IRON_INGOT, name: 'minecraft:iron_ingot', tile: 'item_iron_ingot' },
  { id: Item.GOLD_INGOT, name: 'minecraft:gold_ingot', tile: 'item_gold_ingot' },
  { id: Item.COPPER_INGOT, name: 'minecraft:copper_ingot', tile: 'item_copper_ingot' },
  { id: Item.CHARCOAL, name: 'minecraft:charcoal', tile: 'item_charcoal' },
  { id: Item.BRICK, name: 'minecraft:brick', tile: 'item_brick' },
  { id: Item.CLAY_BALL, name: 'minecraft:clay_ball', tile: 'item_clay_ball' },
  // ---- 生物掉落物
  { id: Item.ROTTEN_FLESH, name: 'minecraft:rotten_flesh', tile: 'item_rotten_flesh' },
  { id: Item.BONE, name: 'minecraft:bone', tile: 'item_bone' },
  { id: Item.GUNPOWDER, name: 'minecraft:gunpowder', tile: 'item_gunpowder' },
  { id: Item.BEEF, name: 'minecraft:beef', tile: 'item_beef' },
  { id: Item.PORKCHOP, name: 'minecraft:porkchop', tile: 'item_porkchop' },
  { id: Item.MUTTON, name: 'minecraft:mutton', tile: 'item_mutton' },
  { id: Item.CHICKEN, name: 'minecraft:chicken', tile: 'item_chicken' },
  { id: Item.LEATHER, name: 'minecraft:leather', tile: 'item_leather' },
  { id: Item.FEATHER, name: 'minecraft:feather', tile: 'item_feather' },
  // ---- 附魔材料：纸（甘蔗做）与书（纸 + 皮革）
  { id: Item.PAPER, name: 'minecraft:paper', tile: 'item_paper' },
  { id: Item.BOOK, name: 'minecraft:book', tile: 'item_book' },
  // ---- 食物（贴图在 TextureAtlas、数值在 food.ts，这里只登记 id / 名字 / 贴图名）
  { id: Item.COOKED_BEEF, name: 'minecraft:cooked_beef', tile: 'item_cooked_beef' },
  { id: Item.COOKED_PORKCHOP, name: 'minecraft:cooked_porkchop', tile: 'item_cooked_porkchop' },
  { id: Item.COOKED_MUTTON, name: 'minecraft:cooked_mutton', tile: 'item_cooked_mutton' },
  { id: Item.COOKED_CHICKEN, name: 'minecraft:cooked_chicken', tile: 'item_cooked_chicken' },
  { id: Item.APPLE, name: 'minecraft:apple', tile: 'item_apple' },
  { id: Item.MELON_SLICE, name: 'minecraft:melon_slice', tile: 'item_melon_slice' },
  { id: Item.GOLDEN_APPLE, name: 'minecraft:golden_apple', tile: 'item_golden_apple' },
];

/** 16 种染料，id 连续且顺序与 DYE_COLORS 一致 */
const DYE_SPECS: readonly NonBlockItemSpec[] = DYE_COLORS.map((color, index) => ({
  id: dyeItemId(index),
  name: `minecraft:${color.name}_dye`,
  tile: `dye_${color.name}`,
}));

const NON_BLOCK_SPECS: readonly NonBlockItemSpec[] = [...BASE_NON_BLOCK_SPECS, ...DYE_SPECS];

const MAX_ITEM_ID = 1200;

/** 按 id 索引的物品表（未定义的 id 为 undefined） */
export const ITEMS: (ItemDef | undefined)[] = new Array(MAX_ITEM_ID).fill(undefined);

/**
 * 写入物品表。
 *
 * 为什么要在启动时抛错而不是默默覆盖：物品 id 分散在"方块物品 / 材料 / 染料 / 生物掉落 /
 * 食物 / 工具 / 盔甲"好几段区间里，一旦两段压在一起，**后写的会把先写的整件覆盖掉**，
 * 而两边都还能按 id 正常增删——只有玩家看到"捡起腐肉显示成紫色染料"时才会发现。
 * 这个 bug 真发生过一次（染料 1020~1035 压住了生物掉落的 1030~1035），
 * 所以这里宁可开机就崩：报错信息直接写明撞的是哪两件东西。
 */
function register(def: ItemDef): void {
  const existing = ITEMS[def.id];
  if (existing) {
    throw new Error(`物品 id ${def.id} 被重复注册：${existing.name} 与 ${def.name}`);
  }
  ITEMS[def.id] = def;
}

// ---- 方块物品：id 与方块 id 相同，图标用方块侧面贴图
for (let id = Block.AIR + 1; id < BLOCK_ITEM_ID_LIMIT; id++) {
  const def = blockDef(id);
  // 注册表按 id 顺序密集排列，blockDef 回落到空气说明已经越过末尾
  if (def.id !== id) break;
  // 流体不进入物品栏
  if (def.liquid) continue;
  register({
    id,
    name: def.name,
    maxStack: MAX_STACK,
    block: id,
    tile: def.tiles[2],
  });
}

// ---- 非方块物品
// `food` 按**注册名**从 food.ts 的数值表里挂上：表放在那边是为了让"数值"与"进食逻辑"
// 挨在一起，而键用名字是为了避免 items ↔ food 互相 import 成环。
for (const spec of NON_BLOCK_SPECS) {
  const food = foodForName(spec.name);
  register({
    id: spec.id,
    name: spec.name,
    maxStack: spec.maxStack ?? MAX_STACK,
    tile: spec.tile,
    ...(food ? { food } : {}),
  });
}

// ---- 工具（25 种：5 种类 × 5 材质），耐久按「每件一叠」处理
for (const spec of TOOL_SPECS) {
  register({
    id: spec.id,
    name: spec.name,
    maxStack: 1,
    tile: spec.tile,
    tool: spec.tool,
  });
}

// ---- 盔甲（20 件：4 部位 × 5 材质），同样「每件一叠」+ 带耐久
for (const spec of ARMOR_SPECS) {
  register({
    id: spec.id,
    name: spec.name,
    maxStack: 1,
    tile: spec.tile,
    armor: spec.armor,
  });
}

/**
 * 铁砧上的修复材料（原版 `isValidRepairItem`）：材质名 → 用什么东西修。
 *
 * 放在 `items.ts` 而不是 `tools.ts` / `armor.ts`：那两个模块**被** `items.ts` 引用，
 * 反过来让它们引用 `Item` 就会成环（items → tools → items）。
 * 工具与盔甲的材料名共用一张表（木质/石质/铁/金/钻石/皮革/锁链）。
 *
 * 两个容易记错的点：石工具用**圆石**修（不是石头），锁链甲用**铁锭**修。
 */
export const MATERIAL_REPAIR_ITEM: Record<string, number> = {
  wooden: Block.OAK_PLANKS,
  stone: Block.COBBLESTONE,
  iron: Item.IRON_INGOT,
  golden: Item.GOLD_INGOT,
  diamond: Item.DIAMOND,
  leather: Item.LEATHER,
  chainmail: Item.IRON_INGOT,
};

export function itemDef(id: number): ItemDef | undefined {
  return ITEMS[id];
}

/** 该物品是不是工具/武器（决定堆叠上限与耐久逻辑） */
export function isTool(itemId: number): boolean {
  return itemDef(itemId)?.tool !== undefined;
}

/** 该物品是不是盔甲 */
export function isArmor(itemId: number): boolean {
  return itemDef(itemId)?.armor !== undefined;
}

/** 该物品的食物数值；不能吃返回 undefined */
export function foodInfoById(itemId: number): FoodInfo | undefined {
  return itemDef(itemId)?.food;
}

// ---------------------------------------------------------------- 创造模式分类

/** 创造物品栏的分类标签 */
export const ITEM_CATEGORIES = [
  'all',
  'building',
  'natural',
  'ores',
  'wool',
  'tools',
  'armor',
  'food',
  'functional',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  all: '全部',
  building: '建筑',
  natural: '自然',
  ores: '矿石与材料',
  wool: '羊毛与染料',
  tools: '工具与武器',
  armor: '盔甲',
  food: '食物',
  functional: '功能方块',
};

/** 工具与武器（25 种，由 TOOL_SPECS 派生） */
const TOOLS = new Set<number>(TOOL_SPECS.map((spec) => spec.id));

/** 盔甲（20 件，由 ARMOR_SPECS 派生） */
const ARMOR = new Set<number>(ARMOR_SPECS.map((spec) => spec.id));

/** 食物：凡是挂了 `food` 的物品都算（表在 food.ts，这里不再手抄一份名单） */
const FOODS = new Set<number>(
  BASE_NON_BLOCK_SPECS.filter((spec) => foodForName(spec.name) !== undefined).map((spec) => spec.id),
);

const BUILDING = new Set<number>([
  Block.STONE,
  Block.COBBLESTONE,
  Block.OAK_PLANKS,
  Block.GLASS,
  Block.STONE_BRICKS,
  Block.CHISELED_STONE_BRICKS,
  Block.SMOOTH_STONE,
  Block.POLISHED_GRANITE,
  Block.POLISHED_DIORITE,
  Block.POLISHED_ANDESITE,
  Block.DEEPSLATE_BRICKS,
  Block.CHISELED_DEEPSLATE,
  Block.POLISHED_DEEPSLATE,
  Block.BRICKS,
  Block.SANDSTONE,
]);

const NATURAL = new Set<number>([
  Block.GRASS_BLOCK,
  Block.DIRT,
  Block.SAND,
  Block.GRAVEL,
  Block.CLAY,
  Block.OAK_LOG,
  Block.OAK_LEAVES,
  Block.SNOW_BLOCK,
  Block.ICE,
  Block.PACKED_ICE,
  Block.OBSIDIAN,
  Block.DEEPSLATE,
  Block.GRANITE,
  Block.DIORITE,
  Block.ANDESITE,
  Block.TUFF,
  Block.CALCITE,
]);

const FUNCTIONAL = new Set<number>([
  Block.CRAFTING_TABLE,
  Block.FURNACE,
  Block.CHEST,
  Block.GLOWSTONE,
  // ---- 红石元件（都是"有信号才做事"的功能方块）
  Block.REDSTONE_WIRE,
  Block.REDSTONE_TORCH,
  Block.REDSTONE_BLOCK,
  Block.LEVER,
  Block.STONE_BUTTON,
  Block.OAK_BUTTON,
  Block.STONE_PRESSURE_PLATE,
  Block.OAK_PRESSURE_PLATE,
  Block.REPEATER,
  Block.COMPARATOR,
  Block.REDSTONE_LAMP,
  Block.PISTON,
  Block.PISTON_HEAD,
  Block.STICKY_PISTON,
  Block.OBSERVER,
]);

/** 自然装饰与下界方块（创造物品栏的"自然"分类） */
const DECORATION_AND_NETHER = new Set<number>([
  Block.SHORT_GRASS,
  Block.FERN,
  Block.DANDELION,
  Block.POPPY,
  Block.BLUE_ORCHID,
  Block.OXEYE_DAISY,
  Block.CORNFLOWER,
  Block.RED_MUSHROOM,
  Block.BROWN_MUSHROOM,
  Block.SUGAR_CANE,
  Block.PUMPKIN,
  Block.MELON,
  Block.CACTUS,
  Block.DEAD_BUSH,
  Block.BAMBOO,
  Block.NETHERRACK,
  Block.SOUL_SAND,
  Block.SOUL_SOIL,
  Block.BASALT,
  Block.SMOOTH_BASALT,
  Block.BLACKSTONE,
  Block.MAGMA_BLOCK,
  Block.CRIMSON_NYLIUM,
  Block.WARPED_NYLIUM,
  Block.CRIMSON_STEM,
  Block.WARPED_STEM,
  Block.CRIMSON_PLANKS,
  Block.WARPED_PLANKS,
  Block.CRIMSON_FUNGUS,
  Block.WARPED_FUNGUS,
  Block.NETHER_WART_BLOCK,
  Block.WARPED_WART_BLOCK,
  Block.CRIMSON_ROOTS,
  Block.WARPED_ROOTS,
  Block.NETHER_SPROUTS,
  Block.PRISMARINE,
  Block.PRISMARINE_BRICKS,
  Block.DARK_PRISMARINE,
  // ---- 末地
  Block.END_STONE,
  Block.END_STONE_BRICKS,
  Block.PURPUR_BLOCK,
  Block.PURPUR_PILLAR,
  Block.CHORUS_PLANT,
  Block.CHORUS_FLOWER,
  Block.END_ROD,
  Block.DRAGON_EGG,
  Block.END_PORTAL_FRAME,
  Block.END_PORTAL,
]);

/** 矿石与材料：所有矿石（含深板岩变体）与加工产物 */
const ORES = new Set<number>([
  Block.COAL_ORE,
  Block.IRON_ORE,
  Block.COPPER_ORE,
  Block.GOLD_ORE,
  Block.REDSTONE_ORE,
  Block.LAPIS_ORE,
  Block.DIAMOND_ORE,
  Block.EMERALD_ORE,
  Block.DEEPSLATE_COAL_ORE,
  Block.DEEPSLATE_IRON_ORE,
  Block.DEEPSLATE_COPPER_ORE,
  Block.DEEPSLATE_GOLD_ORE,
  Block.DEEPSLATE_REDSTONE_ORE,
  Block.DEEPSLATE_LAPIS_ORE,
  Block.DEEPSLATE_DIAMOND_ORE,
  Block.DEEPSLATE_EMERALD_ORE,
  Item.COAL,
  Item.CHARCOAL,
  Item.RAW_IRON,
  Item.RAW_COPPER,
  Item.RAW_GOLD,
  Item.IRON_INGOT,
  Item.GOLD_INGOT,
  Item.COPPER_INGOT,
  Item.REDSTONE,
  Item.LAPIS_LAZULI,
  Item.DIAMOND,
  Item.EMERALD,
  Item.STICK,
  Item.BRICK,
  Item.CLAY_BALL,
  Block.NETHER_QUARTZ_ORE,
  Block.ANCIENT_DEBRIS,
  Block.SHROOMLIGHT,
  Block.SEA_LANTERN,
  Block.NETHER_BRICKS,
]);

/** 16 色羊毛 + 16 种染料 */
const WOOL_AND_DYE = new Set<number>();
for (let index = 0; index < DYE_COLORS.length; index++) {
  WOOL_AND_DYE.add(woolId(index));
  WOOL_AND_DYE.add(dyeItemId(index));
}

/** 判断物品属于哪个创造分类；未登记的默认归入"矿石与材料" */
export function categoryOf(itemId: number): ItemCategory {
  if (TOOLS.has(itemId)) return 'tools';
  if (ARMOR.has(itemId)) return 'armor';
  // 食物排在矿石前面：腐肉/生肉此前被归进"矿石与材料"，看着不像能吃的东西
  if (FOODS.has(itemId)) return 'food';
  if (WOOL_AND_DYE.has(itemId)) return 'wool';
  if (FUNCTIONAL.has(itemId)) return 'functional';
  if (ORES.has(itemId)) return 'ores';
  if (BUILDING.has(itemId)) return 'building';
  if (NATURAL.has(itemId)) return 'natural';
  if (DECORATION_AND_NETHER.has(itemId)) return 'natural';
  return 'ores';
}

/** 物品显示名（去掉命名空间前缀） */
export function itemName(id: number): string {
  return (itemDef(id)?.name ?? 'minecraft:air').replace('minecraft:', '');
}

export function itemIconTile(id: number): string {
  return itemDef(id)?.tile ?? 'stone';
}

export function maxStackOf(id: number): number {
  return itemDef(id)?.maxStack ?? MAX_STACK;
}

/** 该物品放置时对应的方块；不可放置返回 undefined */
export function blockForItem(itemId: number): number | undefined {
  return itemDef(itemId)?.block;
}

/** 所有可放置的物品 id（方块物品） */
export const PLACEABLE_ITEMS: readonly number[] = ITEMS.filter(
  (item): item is ItemDef => item !== undefined && item.block !== undefined,
).map((item) => item.id);

/**
 * 创造物品栏展示的全部物品。
 * 必须包含非方块物品（染料、金属锭、宝石……），否则这些物品在创造模式下根本拿不到。
 */
export const CREATIVE_ITEMS: readonly number[] = ITEMS.filter((item): item is ItemDef => item !== undefined).map(
  (item) => item.id,
);

// ---------------------------------------------------------------- 掉落表

/** 破坏后无掉落的方块 */
const NO_DROP = new Set<number>([
  Block.AIR,
  Block.WATER,
  Block.LAVA,
  Block.BEDROCK,
  Block.OAK_LEAVES,
  Block.GLASS,
  Block.ICE,
  Block.PACKED_ICE,
  // 草与蕨类：原版徒手破坏不掉落任何东西（只有用剪刀才会掉落草方块本身）
  Block.SHORT_GRASS,
  Block.FERN,
]);

// 6 种木材的树叶都不掉落方块本身（原版徒手破坏树叶只偶尔掉树苗与苹果；
// 苹果走下面的 `rareDropFor`，树苗暂缺）
for (const ids of Object.values(Wood)) NO_DROP.add(ids.leaves);

/**
 * 概率掉落：与 `dropFor` 分开，是为了让 `dropFor` 保持**纯函数**——
 * 纯函数才好写断言，概率项则把"掷点"交给调用方（测试里传固定值就能验边界）。
 *
 * @param roll 本帧掷出的随机数（0~1）
 */
export function rareDropFor(blockId: number, roll: number): { id: number; count: number } | null {
  const chance = RARE_DROPS.get(blockId);
  if (chance === undefined || roll >= chance.rate) return null;
  return { id: chance.id, count: 1 };
}

/**
 * 概率掉落表：方块 → 掉落物与概率。
 * 目前只有"树叶 0.5% 掉苹果"（原版数值，橡木与深色橡木才有；这里 6 种树叶都给，
 * 因为树苗还没做，否则苹果就只能靠创造模式拿了）。
 */
const RARE_DROPS = new Map<number, { id: number; rate: number }>([
  [Block.OAK_LEAVES, { id: Item.APPLE, rate: 0.005 }],
  ...Object.values(Wood).map(
    (ids) => [ids.leaves, { id: Item.APPLE, rate: 0.005 }] as [number, { id: number; rate: number }],
  ),
]);

/**
 * 时运能加成的方块（原版只有这几类矿石：煤/钻石/绿宝石/青金石/红石/下界石英）。
 * 铁/铜/金**不在内**——它们本来就掉 1 个粗矿，时运不影响。
 */
const FORTUNE_BLOCKS = new Set<number>([
  Block.COAL_ORE,
  Block.DEEPSLATE_COAL_ORE,
  Block.DIAMOND_ORE,
  Block.DEEPSLATE_DIAMOND_ORE,
  Block.EMERALD_ORE,
  Block.DEEPSLATE_EMERALD_ORE,
  Block.LAPIS_ORE,
  Block.DEEPSLATE_LAPIS_ORE,
  Block.REDSTONE_ORE,
  Block.DEEPSLATE_REDSTONE_ORE,
  Block.NETHER_QUARTZ_ORE,
]);

/**
 * 时运的掉落倍数（1 = 不变）。
 *
 * 原版对每种矿石的概率曲线都不一样（煤 1/3 概率 +1、红石是 uniform(0..level)…），
 * 这里统一成 `1 + ⌊roll × (level+1)⌋`：III 级平均 1.5~2 倍，III 级挖钻石平均 2.2 倍的原版手感大致对上。
 */
export function fortuneMultiplier(blockId: number, level: number, roll: number): number {
  if (level <= 0 || !FORTUNE_BLOCKS.has(blockId)) return 1;
  return 1 + Math.floor(roll * (level + 1));
}

/** 时运能不能作用于这个方块（测试与界面提示用） */
export function isFortuneBlock(blockId: number): boolean {
  return FORTUNE_BLOCKS.has(blockId);
}

/**
 * 精准采集**拿不到**的方块。
 * 原版里树叶/草这类"只能靠剪刀"的东西精准采集也不掉自身；这里把无掉落表里的
 * 非实体方块排除掉即可（空气/水/岩浆/基岩本来也挖不动或无物品）。
 */
const NO_SILK_TOUCH = new Set<number>([Block.AIR, Block.WATER, Block.LAVA, Block.BEDROCK]);

/** 精准采集下这个方块该掉自身吗 */
export function silkTouchDropsSelf(blockId: number): boolean {
  if (NO_SILK_TOUCH.has(blockId)) return false;
  // 有对应物品的方块才能掉自身（草、花这些也有物品，所以照掉）
  return itemDef(blockId) !== undefined;
}

/** 与"掉落自身"不同的特例 */
const DROP_OVERRIDES = new Map<number, { id: number; count: number }>([
  [Block.GRASS_BLOCK, { id: Block.DIRT, count: 1 }],
  [Block.STONE, { id: Block.COBBLESTONE, count: 1 }],
  // 黏土块一次掉 4 个黏土球（原版行为），黏土球烧炼后得到红砖
  [Block.CLAY, { id: Item.CLAY_BALL, count: 4 }],
  // 西瓜块掉西瓜片（原版 3~7 片，取中值 5）
  [Block.MELON, { id: Item.MELON_SLICE, count: 5 }],

  [Block.COAL_ORE, { id: Item.COAL, count: 1 }],
  [Block.DEEPSLATE_COAL_ORE, { id: Item.COAL, count: 1 }],
  [Block.IRON_ORE, { id: Item.RAW_IRON, count: 1 }],
  [Block.DEEPSLATE_IRON_ORE, { id: Item.RAW_IRON, count: 1 }],
  [Block.COPPER_ORE, { id: Item.RAW_COPPER, count: 1 }],
  [Block.DEEPSLATE_COPPER_ORE, { id: Item.RAW_COPPER, count: 1 }],
  [Block.GOLD_ORE, { id: Item.RAW_GOLD, count: 1 }],
  [Block.DEEPSLATE_GOLD_ORE, { id: Item.RAW_GOLD, count: 1 }],
  // 红石与青金石一次掉多个（无时运附魔时的原版区间取中值）
  [Block.REDSTONE_ORE, { id: Item.REDSTONE, count: 4 }],
  [Block.DEEPSLATE_REDSTONE_ORE, { id: Item.REDSTONE, count: 4 }],
  [Block.LAPIS_ORE, { id: Item.LAPIS_LAZULI, count: 5 }],
  [Block.DEEPSLATE_LAPIS_ORE, { id: Item.LAPIS_LAZULI, count: 5 }],
  [Block.DIAMOND_ORE, { id: Item.DIAMOND, count: 1 }],
  [Block.DEEPSLATE_DIAMOND_ORE, { id: Item.DIAMOND, count: 1 }],
  [Block.EMERALD_ORE, { id: Item.EMERALD, count: 1 }],
  [Block.DEEPSLATE_EMERALD_ORE, { id: Item.EMERALD, count: 1 }],
]);

/**
 * 破坏方块后的掉落。返回 null 表示无掉落。
 * 注意：目前还不区分工具（例如石头无镐也应该有掉落），工具等级校验会在 G4 接入。
 */
export function dropFor(blockId: number): { id: number; count: number } | null {
  if (NO_DROP.has(blockId)) return null;
  const override = DROP_OVERRIDES.get(blockId);
  if (override) return { ...override };
  if (itemDef(blockId) === undefined) return null;
  return { id: blockId, count: 1 };
}
