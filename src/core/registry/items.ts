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

import { Block, blockDef } from './blocks.ts';

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

/** 非方块物品的 id 常量 */
export const Item = {
  AIR: 0,
  COAL: 100,
  RAW_IRON: 101,
  RAW_COPPER: 102,
  RAW_GOLD: 103,
  REDSTONE: 104,
  LAPIS_LAZULI: 105,
  DIAMOND: 106,
  EMERALD: 107,
  STICK: 108,
  IRON_INGOT: 109,
  GOLD_INGOT: 110,
  COPPER_INGOT: 111,
  CHARCOAL: 112,
} as const;

interface NonBlockItemSpec {
  id: number;
  name: string;
  tile: string;
  maxStack?: number;
}

const NON_BLOCK_SPECS: readonly NonBlockItemSpec[] = [
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
];

const MAX_ITEM_ID = 200;

/** 按 id 索引的物品表（未定义的 id 为 undefined） */
export const ITEMS: (ItemDef | undefined)[] = new Array(MAX_ITEM_ID).fill(undefined);

// ---- 方块物品：id 与方块 id 相同，图标用方块侧面贴图
for (let id = Block.AIR + 1; id < 100; id++) {
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

/** 所有可放置的物品 id（创造物品栏用） */
export const PLACEABLE_ITEMS: readonly number[] = ITEMS.filter(
  (item): item is ItemDef => item !== undefined && item.block !== undefined,
).map((item) => item.id);

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
]);

/** 与"掉落自身"不同的特例 */
const DROP_OVERRIDES = new Map<number, { id: number; count: number }>([
  [Block.GRASS_BLOCK, { id: Block.DIRT, count: 1 }],
  [Block.STONE, { id: Block.COBBLESTONE, count: 1 }],

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
