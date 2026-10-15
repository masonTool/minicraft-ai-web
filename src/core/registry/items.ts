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

import { Block, Wood, blockDef, woolId } from './blocks.ts';
import { DYE_COLORS } from './colors.ts';

export const MAX_STACK = 64;

export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears';

export interface ToolInfo {
  readonly type: ToolType;
  /** 工具等级 0-4 */
  readonly tier: number;
  /** 采集速度倍率（徒手为 1） */
  readonly speed: number;
  readonly durability: number;
}

export interface ItemDef {
  readonly id: number;
  readonly name: string;
  readonly maxStack: number;
  /** 可放置方块时对应的方块 id */
  readonly block?: number;
  /** 图标贴图名 */
  readonly tile: string;
  readonly tool?: ToolInfo;
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
  ROTTEN_FLESH: 1030,
  BONE: 1031,
  GUNPOWDER: 1032,
  BEEF: 1033,
  PORKCHOP: 1034,
  MUTTON: 1035,
  CHICKEN: 1036,
  LEATHER: 1037,
  FEATHER: 1038,
} as const;

/** 染料物品 id 起始值，顺序与 DYE_COLORS 一致 */
export const DYE_ITEM_START = 1020;

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

// ---- 方块物品：id 与方块 id 相同，图标用方块侧面贴图
for (let id = Block.AIR + 1; id < BLOCK_ITEM_ID_LIMIT; id++) {
  const def = blockDef(id);
  // 注册表按 id 顺序密集排列，blockDef 回落到空气说明已经越过末尾
  if (def.id !== id) break;
  // 流体不进入物品栏
  if (def.liquid) continue;
  ITEMS[id] = {
    id,
    name: def.name,
    maxStack: MAX_STACK,
    block: id,
    tile: def.tiles[2],
  };
}

// ---- 非方块物品
for (const spec of NON_BLOCK_SPECS) {
  ITEMS[spec.id] = {
    id: spec.id,
    name: spec.name,
    maxStack: spec.maxStack ?? MAX_STACK,
    tile: spec.tile,
  };
}

export function itemDef(id: number): ItemDef | undefined {
  return ITEMS[id];
}

// ---------------------------------------------------------------- 创造模式分类

/** 创造物品栏的分类标签 */
export const ITEM_CATEGORIES = ['all', 'building', 'natural', 'ores', 'wool', 'functional'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  all: '全部',
  building: '建筑',
  natural: '自然',
  ores: '矿石与材料',
  wool: '羊毛与染料',
  functional: '功能方块',
};

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

const FUNCTIONAL = new Set<number>([Block.CRAFTING_TABLE, Block.FURNACE, Block.CHEST, Block.GLOWSTONE]);

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

// 6 种木材的树叶都不掉落（原版徒手破坏树叶只偶尔掉树苗与苹果，这里简化为不掉落）
for (const ids of Object.values(Wood)) NO_DROP.add(ids.leaves);

/** 与"掉落自身"不同的特例 */
const DROP_OVERRIDES = new Map<number, { id: number; count: number }>([
  [Block.GRASS_BLOCK, { id: Block.DIRT, count: 1 }],
  [Block.STONE, { id: Block.COBBLESTONE, count: 1 }],
  // 黏土块一次掉 4 个黏土球（原版行为），黏土球烧炼后得到红砖
  [Block.CLAY, { id: Item.CLAY_BALL, count: 4 }],

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
