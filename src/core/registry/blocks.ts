/**
 * 方块注册表
 *
 * 设计说明：
 * - 方块以数字 id 存储在世界数据里（Uint8Array），注册表负责 id ↔ 定义 的映射。
 * - `tiles` 为 [顶面, 底面, 侧面] 三个图集贴图名。
 * - 完整 1.18 方块集（含 block state）会在 B3/B4 逐步补齐；当前覆盖地形生成所需部分。
 */

export interface BlockDef {
  readonly id: number;
  readonly name: string;
  /** [顶面, 底面, 侧面]，值为图集贴图名 */
  readonly tiles: readonly [string, string, string];
  /** 参与碰撞 */
  readonly solid: boolean;
  /** 完全遮挡：剔除相邻面 + 阻挡光照 */
  readonly opaque: boolean;
  /** 自发光等级 0-15 */
  readonly light: number;
  /** 光照衰减（0-15）：光穿过该方块时减少的等级，≥15 视为完全阻挡 */
  readonly lightOpacity: number;
  /** 是否为液体 */
  readonly liquid: boolean;
  /** 半透明：走独立的透明渲染层（水、玻璃、冰） */
  readonly translucent: boolean;
}

interface BlockSpec {
  id: number;
  name: string;
  tiles?: readonly [string, string, string];
  solid?: boolean;
  opaque?: boolean;
  light?: number;
  lightOpacity?: number;
  liquid?: boolean;
  translucent?: boolean;
}

const SPECS: readonly BlockSpec[] = [
  { id: 0, name: 'minecraft:air', tiles: ['', '', ''], solid: false, opaque: false },

  // ---- 基础建筑与地形方块
  { id: 1, name: 'minecraft:stone', tiles: ['stone', 'stone', 'stone'] },
  { id: 2, name: 'minecraft:dirt', tiles: ['dirt', 'dirt', 'dirt'] },
  { id: 3, name: 'minecraft:grass_block', tiles: ['grass_top', 'dirt', 'grass_side'] },
  { id: 4, name: 'minecraft:sand', tiles: ['sand', 'sand', 'sand'] },
  { id: 5, name: 'minecraft:oak_log', tiles: ['oak_log_top', 'oak_log_top', 'oak_log_side'] },
  { id: 6, name: 'minecraft:oak_leaves', tiles: ['oak_leaves', 'oak_leaves', 'oak_leaves'], lightOpacity: 1 },
  { id: 7, name: 'minecraft:oak_planks', tiles: ['oak_planks', 'oak_planks', 'oak_planks'] },
  { id: 8, name: 'minecraft:cobblestone', tiles: ['cobblestone', 'cobblestone', 'cobblestone'] },
  { id: 9, name: 'minecraft:bedrock', tiles: ['bedrock', 'bedrock', 'bedrock'] },

  // ---- 流体与透明方块
  {
    id: 10,
    name: 'minecraft:water',
    tiles: ['water', 'water', 'water'],
    solid: false,
    opaque: false,
    liquid: true,
    translucent: true,
    lightOpacity: 1,
  },
  { id: 11, name: 'minecraft:glass', tiles: ['glass', 'glass', 'glass'], opaque: false, translucent: true, lightOpacity: 0 },

  // ---- 1.18 地下岩石
  { id: 12, name: 'minecraft:deepslate', tiles: ['deepslate', 'deepslate', 'deepslate'] },
  { id: 13, name: 'minecraft:granite', tiles: ['granite', 'granite', 'granite'] },
  { id: 14, name: 'minecraft:diorite', tiles: ['diorite', 'diorite', 'diorite'] },
  { id: 15, name: 'minecraft:andesite', tiles: ['andesite', 'andesite', 'andesite'] },
  { id: 16, name: 'minecraft:tuff', tiles: ['tuff', 'tuff', 'tuff'] },
  { id: 17, name: 'minecraft:calcite', tiles: ['calcite', 'calcite', 'calcite'] },
  { id: 18, name: 'minecraft:gravel', tiles: ['gravel', 'gravel', 'gravel'] },
  { id: 19, name: 'minecraft:clay', tiles: ['clay', 'clay', 'clay'] },
  { id: 20, name: 'minecraft:sandstone', tiles: ['sandstone_top', 'sandstone_top', 'sandstone'] },

  // ---- 寒冷群系
  { id: 21, name: 'minecraft:snow_block', tiles: ['snow', 'snow', 'snow'] },
  { id: 22, name: 'minecraft:ice', tiles: ['ice', 'ice', 'ice'], opaque: false, translucent: true, lightOpacity: 1 },
  {
    id: 23,
    name: 'minecraft:packed_ice',
    tiles: ['packed_ice', 'packed_ice', 'packed_ice'],
    opaque: false,
    translucent: true,
    lightOpacity: 2,
  },

  // ---- 特殊
  { id: 24, name: 'minecraft:obsidian', tiles: ['obsidian', 'obsidian', 'obsidian'] },
  {
    id: 25,
    name: 'minecraft:lava',
    tiles: ['lava', 'lava', 'lava'],
    solid: false,
    opaque: false,
    liquid: true,
    light: 15,
    lightOpacity: 1,
  },
  { id: 26, name: 'minecraft:glowstone', tiles: ['glowstone', 'glowstone', 'glowstone'], light: 15 },

  // ---- 主世界矿石（1.18 共 8 种主世界矿石 + 深层变体）
  { id: 27, name: 'minecraft:coal_ore', tiles: ['coal_ore', 'coal_ore', 'coal_ore'] },
  { id: 28, name: 'minecraft:iron_ore', tiles: ['iron_ore', 'iron_ore', 'iron_ore'] },
  { id: 29, name: 'minecraft:copper_ore', tiles: ['copper_ore', 'copper_ore', 'copper_ore'] },
  { id: 30, name: 'minecraft:gold_ore', tiles: ['gold_ore', 'gold_ore', 'gold_ore'] },
  { id: 31, name: 'minecraft:redstone_ore', tiles: ['redstone_ore', 'redstone_ore', 'redstone_ore'] },
  { id: 32, name: 'minecraft:lapis_ore', tiles: ['lapis_ore', 'lapis_ore', 'lapis_ore'] },
  { id: 33, name: 'minecraft:diamond_ore', tiles: ['diamond_ore', 'diamond_ore', 'diamond_ore'] },
  { id: 34, name: 'minecraft:emerald_ore', tiles: ['emerald_ore', 'emerald_ore', 'emerald_ore'] },
  { id: 35, name: 'minecraft:deepslate_coal_ore', tiles: ['deepslate_coal_ore', 'deepslate_coal_ore', 'deepslate_coal_ore'] },
  { id: 36, name: 'minecraft:deepslate_iron_ore', tiles: ['deepslate_iron_ore', 'deepslate_iron_ore', 'deepslate_iron_ore'] },
  {
    id: 37,
    name: 'minecraft:deepslate_copper_ore',
    tiles: ['deepslate_copper_ore', 'deepslate_copper_ore', 'deepslate_copper_ore'],
  },
  { id: 38, name: 'minecraft:deepslate_gold_ore', tiles: ['deepslate_gold_ore', 'deepslate_gold_ore', 'deepslate_gold_ore'] },
  {
    id: 39,
    name: 'minecraft:deepslate_redstone_ore',
    tiles: ['deepslate_redstone_ore', 'deepslate_redstone_ore', 'deepslate_redstone_ore'],
  },
  { id: 40, name: 'minecraft:deepslate_lapis_ore', tiles: ['deepslate_lapis_ore', 'deepslate_lapis_ore', 'deepslate_lapis_ore'] },
  {
    id: 41,
    name: 'minecraft:deepslate_diamond_ore',
    tiles: ['deepslate_diamond_ore', 'deepslate_diamond_ore', 'deepslate_diamond_ore'],
  },
  {
    id: 42,
    name: 'minecraft:deepslate_emerald_ore',
    tiles: ['deepslate_emerald_ore', 'deepslate_emerald_ore', 'deepslate_emerald_ore'],
  },
];

/** 方块 id 常量，避免代码里出现魔法数字 */
export const Block = {
  AIR: 0,
  STONE: 1,
  DIRT: 2,
  GRASS_BLOCK: 3,
  SAND: 4,
  OAK_LOG: 5,
  OAK_LEAVES: 6,
  OAK_PLANKS: 7,
  COBBLESTONE: 8,
  BEDROCK: 9,
  WATER: 10,
  GLASS: 11,
  DEEPSLATE: 12,
  GRANITE: 13,
  DIORITE: 14,
  ANDESITE: 15,
  TUFF: 16,
  CALCITE: 17,
  GRAVEL: 18,
  CLAY: 19,
  SANDSTONE: 20,
  SNOW_BLOCK: 21,
  ICE: 22,
  PACKED_ICE: 23,
  OBSIDIAN: 24,
  LAVA: 25,
  GLOWSTONE: 26,
  COAL_ORE: 27,
  IRON_ORE: 28,
  COPPER_ORE: 29,
  GOLD_ORE: 30,
  REDSTONE_ORE: 31,
  LAPIS_ORE: 32,
  DIAMOND_ORE: 33,
  EMERALD_ORE: 34,
  DEEPSLATE_COAL_ORE: 35,
  DEEPSLATE_IRON_ORE: 36,
  DEEPSLATE_COPPER_ORE: 37,
  DEEPSLATE_GOLD_ORE: 38,
  DEEPSLATE_REDSTONE_ORE: 39,
  DEEPSLATE_LAPIS_ORE: 40,
  DEEPSLATE_DIAMOND_ORE: 41,
  DEEPSLATE_EMERALD_ORE: 42,
} as const;

/** 按 id 索引的方块定义表 */
export const BLOCKS: readonly BlockDef[] = SPECS.map((s) => ({
  id: s.id,
  name: s.name,
  tiles: s.tiles ?? ['stone', 'stone', 'stone'],
  solid: s.solid ?? true,
  opaque: s.opaque ?? true,
  light: s.light ?? 0,
  // 默认：不透光方块完全阻挡光照，透明方块不衰减
  lightOpacity: s.lightOpacity ?? ((s.opaque ?? true) ? 15 : 0),
  liquid: s.liquid ?? false,
  translucent: s.translucent ?? false,
}));

export function blockDef(id: number): BlockDef {
  return BLOCKS[id] ?? BLOCKS[0]!;
}

export function isOpaque(id: number): boolean {
  return blockDef(id).opaque;
}

export function isSolid(id: number): boolean {
  return blockDef(id).solid;
}

/** 光照衰减：≥15 表示完全阻挡，0 表示完全透过 */
export function lightOpacity(id: number): number {
  return blockDef(id).lightOpacity;
}

export function emitLight(id: number): number {
  return blockDef(id).light;
}

/** 石材类方块（深板岩变体的判定基准） */
export function deepslateVariantOf(id: number): number {
  switch (id) {
    case Block.COAL_ORE:
      return Block.DEEPSLATE_COAL_ORE;
    case Block.IRON_ORE:
      return Block.DEEPSLATE_IRON_ORE;
    case Block.COPPER_ORE:
      return Block.DEEPSLATE_COPPER_ORE;
    case Block.GOLD_ORE:
      return Block.DEEPSLATE_GOLD_ORE;
    case Block.REDSTONE_ORE:
      return Block.DEEPSLATE_REDSTONE_ORE;
    case Block.LAPIS_ORE:
      return Block.DEEPSLATE_LAPIS_ORE;
    case Block.DIAMOND_ORE:
      return Block.DEEPSLATE_DIAMOND_ORE;
    case Block.EMERALD_ORE:
      return Block.DEEPSLATE_EMERALD_ORE;
    default:
      return id;
  }
}
