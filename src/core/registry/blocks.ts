/**
 * 方块注册表
 *
 * 设计说明：
 * - 方块以数字 id 存储在世界数据里（Uint8Array），注册表负责 id ↔ 定义 的映射。
 * - `tiles` 为 [顶面, 底面, 侧面] 三个图集贴图名。
 * - 完整 1.18 方块集（含 block state）会在 B3/B4 逐步补齐；当前覆盖地形生成所需部分。
 */

import { DYE_COLORS, WOOD_TYPES } from './colors.ts';
import type { BlockShape } from './blockState.ts';

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
  /** 几何形状族：完整立方体 / 台阶 / 楼梯 / 栅栏 / 墙 / 门 / 火把 / 梯子 */
  readonly shape: BlockShape;
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
  shape?: BlockShape;
}

const BASE_SPECS: readonly BlockSpec[] = [
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

  // ---- 功能方块
  { id: 43, name: 'minecraft:crafting_table', tiles: ['crafting_table_top', 'oak_planks', 'crafting_table_side'] },
  { id: 44, name: 'minecraft:furnace', tiles: ['furnace_top', 'furnace_top', 'furnace_side'] },
  { id: 45, name: 'minecraft:chest', tiles: ['chest_top', 'chest_top', 'chest_side'] },

  // ---- 石材家族
  { id: 62, name: 'minecraft:stone_bricks', tiles: ['stone_bricks', 'stone_bricks', 'stone_bricks'] },
  { id: 63, name: 'minecraft:chiseled_stone_bricks', tiles: ['chiseled_stone_bricks', 'chiseled_stone_bricks', 'chiseled_stone_bricks'] },
  { id: 64, name: 'minecraft:smooth_stone', tiles: ['smooth_stone', 'smooth_stone', 'smooth_stone'] },
  { id: 65, name: 'minecraft:polished_granite', tiles: ['polished_granite', 'polished_granite', 'polished_granite'] },
  { id: 66, name: 'minecraft:polished_diorite', tiles: ['polished_diorite', 'polished_diorite', 'polished_diorite'] },
  { id: 67, name: 'minecraft:polished_andesite', tiles: ['polished_andesite', 'polished_andesite', 'polished_andesite'] },
  { id: 68, name: 'minecraft:deepslate_bricks', tiles: ['deepslate_bricks', 'deepslate_bricks', 'deepslate_bricks'] },
  { id: 69, name: 'minecraft:chiseled_deepslate', tiles: ['chiseled_deepslate', 'chiseled_deepslate', 'chiseled_deepslate'] },
  { id: 70, name: 'minecraft:bricks', tiles: ['bricks', 'bricks', 'bricks'] },
  { id: 71, name: 'minecraft:polished_deepslate', tiles: ['polished_deepslate', 'polished_deepslate', 'polished_deepslate'] },
];

/** 羊毛 id 起始值：16 种颜色连续排列，顺序与 DYE_COLORS 一致 */
export const WOOL_ID_START = 46;

const WOOL_SPECS: readonly BlockSpec[] = DYE_COLORS.map((color, index) => ({
  id: WOOL_ID_START + index,
  name: `minecraft:${color.name}_wool`,
  tiles: [`wool_${color.name}`, `wool_${color.name}`, `wool_${color.name}`],
}));

// ---------------------------------------------------------------- 木材家族

/**
 * 除橡木之外的 5 种木材，每种派生 5 个方块：原木 / 木板 / 树叶 / 台阶 / 楼梯。
 *
 * id 从 102 起按「每种木头连续 5 个」分配；橡木（5/6/7 以及已有的台阶楼梯）保持原 id 不动。
 * 这种**追加式布局**的意义在于：以后再加木材只需要往 WOOD_TYPES 加一行，不会打乱既有编号。
 */
export const WOOD_BLOCK_ID_START = 102;

export interface WoodBlockIds {
  readonly log: number;
  readonly planks: number;
  readonly leaves: number;
  readonly slab: number;
  readonly stairs: number;
}

const EXTRA_WOODS = WOOD_TYPES.filter((wood) => wood.name !== 'oak');

const WOOD_ID_MAP = new Map<string, WoodBlockIds>();
const WOOD_SPECS: readonly BlockSpec[] = EXTRA_WOODS.flatMap((wood, index) => {
  const base = WOOD_BLOCK_ID_START + index * 5;
  const ids: WoodBlockIds = {
    log: base,
    planks: base + 1,
    leaves: base + 2,
    slab: base + 3,
    stairs: base + 4,
  };
  WOOD_ID_MAP.set(wood.name, ids);

  const plankTile = `${wood.name}_planks`;
  return [
    {
      id: ids.log,
      name: `minecraft:${wood.name}_log`,
      tiles: [`${wood.name}_log_top`, `${wood.name}_log_top`, `${wood.name}_log_side`],
    },
    { id: ids.planks, name: `minecraft:${wood.name}_planks`, tiles: [plankTile, plankTile, plankTile] },
    {
      id: ids.leaves,
      name: `minecraft:${wood.name}_leaves`,
      tiles: [`${wood.name}_leaves`, `${wood.name}_leaves`, `${wood.name}_leaves`],
      lightOpacity: 1,
    },
    {
      id: ids.slab,
      name: `minecraft:${wood.name}_planks_slab`,
      tiles: [plankTile, plankTile, plankTile],
      shape: 'slab' as const,
      opaque: false,
      lightOpacity: 0,
    },
    {
      id: ids.stairs,
      name: `minecraft:${wood.name}_planks_stairs`,
      tiles: [plankTile, plankTile, plankTile],
      shape: 'stairs' as const,
      opaque: false,
      lightOpacity: 0,
    },
  ];
});

/** 取某种木材的 5 个方块 id；未知木材返回 undefined */
export function woodBlocks(name: string): WoodBlockIds | undefined {
  return WOOD_ID_MAP.get(name);
}

/** 木材方块 id 的具名入口（配方与测试用；与 WOOD_SPECS 同源，不会写错） */
export const Wood: Readonly<Record<string, WoodBlockIds>> = Object.fromEntries(
  EXTRA_WOODS.map((wood) => [wood.name, WOOD_ID_MAP.get(wood.name)!]),
);

// ---------------------------------------------------------------- 陶瓦与混凝土

export const TERRACOTTA_ID_START = 127;
export const CONCRETE_ID_START = 144;

/**
 * 陶瓦与混凝土：都是 16 色 + 陶瓦多一个原色。
 * 陶瓦偏土、有颗粒感；混凝土是纯色 + 极细的杂点，两者观感差异明显。
 */
const COLORED_SPECS: readonly BlockSpec[] = [
  {
    id: TERRACOTTA_ID_START,
    name: 'minecraft:terracotta',
    tiles: ['terracotta', 'terracotta', 'terracotta'],
  },
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: TERRACOTTA_ID_START + 1 + index,
      name: `minecraft:${color.name}_terracotta`,
      tiles: [`terracotta_${color.name}`, `terracotta_${color.name}`, `terracotta_${color.name}`],
    }),
  ),
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: CONCRETE_ID_START + index,
      name: `minecraft:${color.name}_concrete`,
      tiles: [`concrete_${color.name}`, `concrete_${color.name}`, `concrete_${color.name}`],
    }),
  ),
];

/** 第 index 种颜色的陶瓦 id（0 为原色陶瓦，1-16 对应 DYE_COLORS） */
export function terracottaId(colorIndex: number): number {
  return TERRACOTTA_ID_START + colorIndex;
}

/** 第 index 种颜色的混凝土 id */
export function concreteId(colorIndex: number): number {
  return CONCRETE_ID_START + colorIndex;
}

// ---------------------------------------------------------------- 石材补全 / 玻璃

export const STONE_EXTRA_ID_START = 160;
export const STAINED_GLASS_ID_START = 168;
export const GLASS_PANE_ID = 184;
export const STAINED_GLASS_PANE_ID_START = 185;

/** 第 index 种颜色的染色玻璃 id */
export function stainedGlassId(colorIndex: number): number {
  return STAINED_GLASS_ID_START + colorIndex;
}

/** 第 index 种颜色的染色玻璃板 id */
export function stainedGlassPaneId(colorIndex: number): number {
  return STAINED_GLASS_PANE_ID_START + colorIndex;
}

const GLASS_AND_STONE_SPECS: readonly BlockSpec[] = [
  // ---- 石材补全（苔石 / 裂纹变体）
  { id: 160, name: 'minecraft:mossy_cobblestone', tiles: ['mossy_cobblestone', 'mossy_cobblestone', 'mossy_cobblestone'] },
  { id: 161, name: 'minecraft:mossy_stone_bricks', tiles: ['mossy_stone_bricks', 'mossy_stone_bricks', 'mossy_stone_bricks'] },
  { id: 162, name: 'minecraft:cracked_stone_bricks', tiles: ['cracked_stone_bricks', 'cracked_stone_bricks', 'cracked_stone_bricks'] },
  { id: 163, name: 'minecraft:cracked_deepslate_bricks', tiles: ['cracked_deepslate_bricks', 'cracked_deepslate_bricks', 'cracked_deepslate_bricks'] },
  { id: 164, name: 'minecraft:cobbled_deepslate', tiles: ['cobbled_deepslate', 'cobbled_deepslate', 'cobbled_deepslate'] },

  // ---- 砂岩变体
  { id: 165, name: 'minecraft:chiseled_sandstone', tiles: ['chiseled_sandstone', 'sandstone', 'chiseled_sandstone'] },
  { id: 166, name: 'minecraft:cut_sandstone', tiles: ['cut_sandstone', 'sandstone', 'cut_sandstone'] },
  { id: 167, name: 'minecraft:smooth_sandstone', tiles: ['smooth_sandstone', 'smooth_sandstone', 'smooth_sandstone'] },

  // ---- 染色玻璃（半透明整块）+ 玻璃板（薄片，连接方向由邻居实时决定）
  { id: GLASS_PANE_ID, name: 'minecraft:glass_pane', tiles: ['glass', 'glass', 'glass'], shape: 'pane' as const, opaque: false, translucent: true },
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: STAINED_GLASS_ID_START + index,
      name: `minecraft:${color.name}_stained_glass`,
      tiles: [`stained_glass_${color.name}`, `stained_glass_${color.name}`, `stained_glass_${color.name}`],
      opaque: false,
      translucent: true,
    }),
  ),
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: STAINED_GLASS_PANE_ID_START + index,
      name: `minecraft:${color.name}_stained_glass_pane`,
      tiles: [`stained_glass_${color.name}`, `stained_glass_${color.name}`, `stained_glass_${color.name}`],
      shape: 'pane' as const,
      opaque: false,
      translucent: true,
    }),
  ),
];

// ---------------------------------------------------------------- 台阶 / 楼梯

/**
 * 有台阶与楼梯变体的母方块：[母方块 id, 命名前缀]。
 * 顺序决定 slabId / stairsId 的取值，改动顺序会导致存档不兼容。
 */
export const SHAPED_PARENTS: readonly (readonly [number, string])[] = [
  [1, 'stone'],
  [8, 'cobblestone'],
  [7, 'oak_planks'],
  [20, 'sandstone'],
  [62, 'stone_bricks'],
  [64, 'smooth_stone'],
  [65, 'polished_granite'],
  [66, 'polished_diorite'],
  [67, 'polished_andesite'],
  [68, 'deepslate_bricks'],
  [70, 'bricks'],
  [71, 'polished_deepslate'],
];

export const SLAB_ID_START = 72;
export const STAIRS_ID_START = 84;

export function slabId(parentIndex: number): number {
  return SLAB_ID_START + parentIndex;
}

export function stairsId(parentIndex: number): number {
  return STAIRS_ID_START + parentIndex;
}

/** 从基础定义里取母方块的贴图（此时 BLOCKS 还没构建，只能查 SPECS） */
function baseTiles(id: number): readonly [string, string, string] {
  return BASE_SPECS.find((spec) => spec.id === id)?.tiles ?? ['stone', 'stone', 'stone'];
}

/**
 * 台阶与楼梯同母方块共用贴图，且都是**非完整方块**：
 * opaque=false 让相邻方块的面正常渲染（台阶上方是空的），lightOpacity=0 让光自由通过。
 */
const SHAPED_SPECS: readonly BlockSpec[] = SHAPED_PARENTS.flatMap(([parentId, name], index) => {
  const tiles = baseTiles(parentId);
  return [
    {
      id: SLAB_ID_START + index,
      name: `minecraft:${name}_slab`,
      tiles,
      shape: 'slab' as const,
      opaque: false,
      lightOpacity: 0,
    },
    {
      id: STAIRS_ID_START + index,
      name: `minecraft:${name}_stairs`,
      tiles,
      shape: 'stairs' as const,
      opaque: false,
      lightOpacity: 0,
    },
  ];
});

// ---------------------------------------------------------------- 栅栏 / 墙 / 门 / 火把 / 梯子

const FUNCTIONAL_SHAPED_SPECS: readonly BlockSpec[] = [
  {
    id: 96,
    name: 'minecraft:oak_fence',
    tiles: baseTiles(7),
    shape: 'fence',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 97,
    name: 'minecraft:cobblestone_wall',
    tiles: baseTiles(8),
    shape: 'wall',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 98,
    name: 'minecraft:stone_brick_wall',
    tiles: baseTiles(62),
    shape: 'wall',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 99,
    name: 'minecraft:oak_door',
    tiles: ['oak_door', 'oak_door', 'oak_door'],
    shape: 'door',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 100,
    name: 'minecraft:torch',
    tiles: ['torch', 'torch', 'torch'],
    shape: 'torch',
    solid: false,
    opaque: false,
    light: 14,
    lightOpacity: 0,
  },
  {
    id: 101,
    name: 'minecraft:ladder',
    tiles: ['ladder', 'ladder', 'ladder'],
    shape: 'ladder',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];

/**
 * 全部方块定义。
 * ⚠️ 必须按 id 升序排列：BLOCKS 是按数组下标索引的，顺序错位会让 blockDef(id) 取到别的方块。
 */
const SPECS: readonly BlockSpec[] = [
  ...BASE_SPECS,
  ...WOOL_SPECS,
  ...WOOD_SPECS,
  ...COLORED_SPECS,
  ...GLASS_AND_STONE_SPECS,
  ...SHAPED_SPECS,
  ...FUNCTIONAL_SHAPED_SPECS,
].sort((a, b) => a.id - b.id);

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
  CRAFTING_TABLE: 43,
  FURNACE: 44,
  CHEST: 45,
  STONE_BRICKS: 62,
  CHISELED_STONE_BRICKS: 63,
  SMOOTH_STONE: 64,
  POLISHED_GRANITE: 65,
  POLISHED_DIORITE: 66,
  POLISHED_ANDESITE: 67,
  DEEPSLATE_BRICKS: 68,
  CHISELED_DEEPSLATE: 69,
  BRICKS: 70,
  POLISHED_DEEPSLATE: 71,
  OAK_FENCE: 96,
  COBBLESTONE_WALL: 97,
  STONE_BRICK_WALL: 98,
  OAK_DOOR: 99,
  TORCH: 100,
  LADDER: 101,
} as const;

/** 第 index 种颜色的羊毛方块 id（顺序与 DYE_COLORS 一致） */
export function woolId(colorIndex: number): number {
  return WOOL_ID_START + colorIndex;
}

/** 按 id 索引的方块定义表 */
/**
 * 构造按 id 索引的方块表。
 *
 * 这里强制校验 id 从 0 开始连续——BLOCKS 是数组下标索引，一旦有空缺或错位，
 * blockDef(id) 就会静默地返回错误的方块。宁可启动时报错也不要让这种问题潜伏下去。
 */
function buildBlockTable(): readonly BlockDef[] {
  const table: BlockDef[] = [];
  for (const spec of SPECS) {
    if (spec.id !== table.length) {
      throw new Error(
        `方块 id 必须从 0 开始连续：第 ${table.length} 项期望 id=${table.length}，实际 id=${spec.id}（${spec.name}）`,
      );
    }
    table.push({
      id: spec.id,
      name: spec.name,
      tiles: spec.tiles ?? ['stone', 'stone', 'stone'],
      solid: spec.solid ?? true,
      opaque: spec.opaque ?? true,
      light: spec.light ?? 0,
      // 默认：不透光方块完全阻挡光照，透明方块不衰减
      lightOpacity: spec.lightOpacity ?? ((spec.opaque ?? true) ? 15 : 0),
      liquid: spec.liquid ?? false,
      translucent: spec.translucent ?? false,
      shape: spec.shape ?? 'cube',
    });
  }
  return table;
}

export const BLOCKS: readonly BlockDef[] = buildBlockTable();

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

// ---------------------------------------------------------------- 挖掘属性

/** 方块硬度（原版量纲）；-1 表示不可破坏 */
const HARDNESS = new Map<number, number>([
  [Block.AIR, 0],
  [Block.BEDROCK, -1],
  [Block.WATER, -1],
  [Block.LAVA, -1],

  [Block.STONE, 1.5],
  [Block.COBBLESTONE, 2],
  [Block.DEEPSLATE, 3],
  [Block.GRANITE, 1.5],
  [Block.DIORITE, 1.5],
  [Block.ANDESITE, 1.5],
  [Block.TUFF, 1.5],
  [Block.CALCITE, 0.75],
  [Block.OBSIDIAN, 50],

  [Block.DIRT, 0.5],
  [Block.GRASS_BLOCK, 0.6],
  [Block.SAND, 0.5],
  [Block.GRAVEL, 0.6],
  [Block.CLAY, 0.6],
  [Block.SANDSTONE, 0.8],
  [Block.SNOW_BLOCK, 0.2],

  [Block.OAK_LOG, 2],
  [Block.OAK_PLANKS, 2],
  [Block.OAK_LEAVES, 0.2],

  [Block.GLASS, 0.3],
  [Block.ICE, 0.5],
  [Block.PACKED_ICE, 0.5],
  [Block.GLOWSTONE, 0.3],

  [Block.CRAFTING_TABLE, 2.5],
  [Block.FURNACE, 3.5],
  [Block.CHEST, 2.5],

  [Block.STONE_BRICKS, 1.5],
  [Block.CHISELED_STONE_BRICKS, 1.5],
  [Block.SMOOTH_STONE, 2],
  [Block.POLISHED_GRANITE, 1.5],
  [Block.POLISHED_DIORITE, 1.5],
  [Block.POLISHED_ANDESITE, 1.5],
  [Block.DEEPSLATE_BRICKS, 3.5],
  [Block.CHISELED_DEEPSLATE, 3.5],
  [Block.BRICKS, 2],
  [Block.POLISHED_DEEPSLATE, 3.5],
]);

// 羊毛：16 种颜色硬度相同
for (let i = 0; i < DYE_COLORS.length; i++) HARDNESS.set(woolId(i), 0.8);

// 台阶 / 楼梯的硬度跟随母方块（原版行为）
for (let index = 0; index < SHAPED_PARENTS.length; index++) {
  const parentId = SHAPED_PARENTS[index]![0];
  const hardness = HARDNESS.get(parentId) ?? 1.5;
  HARDNESS.set(slabId(index), hardness);
  HARDNESS.set(stairsId(index), hardness);
}

HARDNESS.set(Block.OAK_FENCE, 2);
HARDNESS.set(Block.COBBLESTONE_WALL, 2);
HARDNESS.set(Block.STONE_BRICK_WALL, 1.5);
HARDNESS.set(Block.OAK_DOOR, 3);
HARDNESS.set(Block.TORCH, 0);
HARDNESS.set(Block.LADDER, 0.4);

// 木材家族：原木与木板 2.0、树叶 0.2，台阶楼梯跟随木板
for (const ids of Object.values(Wood)) {
  HARDNESS.set(ids.log, 2);
  HARDNESS.set(ids.planks, 2);
  HARDNESS.set(ids.leaves, 0.2);
  HARDNESS.set(ids.slab, 2);
  HARDNESS.set(ids.stairs, 2);
}

// 陶瓦 1.25、混凝土 1.8（都需要镐，不进徒手可采集表）
HARDNESS.set(terracottaId(0), 1.25);
for (let i = 0; i < DYE_COLORS.length; i++) {
  HARDNESS.set(terracottaId(i + 1), 1.25);
  HARDNESS.set(concreteId(i), 1.8);
}

// 石材补全与砂岩变体
HARDNESS.set(160, 2);
HARDNESS.set(161, 1.5);
HARDNESS.set(162, 1.5);
HARDNESS.set(163, 3.5);
HARDNESS.set(164, 3);
HARDNESS.set(165, 0.8);
HARDNESS.set(166, 0.8);
HARDNESS.set(167, 0.8);

// 玻璃与玻璃板：0.3，徒手可采集（徒手可采集表在下面统一维护）
HARDNESS.set(GLASS_PANE_ID, 0.3);
for (let i = 0; i < DYE_COLORS.length; i++) {
  HARDNESS.set(stainedGlassId(i), 0.3);
  HARDNESS.set(stainedGlassPaneId(i), 0.3);
}

/** 徒手就能采集的方块（决定挖掘耗时用哪条公式，对齐原版） */
const HAND_HARVESTABLE = new Set<number>([
  Block.DIRT,
  Block.GRASS_BLOCK,
  Block.SAND,
  Block.GRAVEL,
  Block.CLAY,
  Block.SANDSTONE,
  Block.SNOW_BLOCK,
  Block.OAK_LOG,
  Block.OAK_PLANKS,
  Block.OAK_LEAVES,
  Block.GLASS,
  Block.ICE,
  Block.PACKED_ICE,
  Block.GLOWSTONE,
  // 木质方块徒手可采集；熔炉需要镐，所以不在列表里
  Block.CRAFTING_TABLE,
  Block.CHEST,
]);

// 羊毛徒手即可采集（石材家族一律需要镐，不加入此表）
for (let i = 0; i < DYE_COLORS.length; i++) HAND_HARVESTABLE.add(woolId(i));

// 台阶 / 楼梯的"徒手可采集"跟随母方块；木质与火把梯子一律徒手可采
for (let index = 0; index < SHAPED_PARENTS.length; index++) {
  if (!HAND_HARVESTABLE.has(SHAPED_PARENTS[index]![0])) continue;
  HAND_HARVESTABLE.add(slabId(index));
  HAND_HARVESTABLE.add(stairsId(index));
}
HAND_HARVESTABLE.add(Block.OAK_FENCE);
HAND_HARVESTABLE.add(Block.OAK_DOOR);
HAND_HARVESTABLE.add(Block.TORCH);
HAND_HARVESTABLE.add(Block.LADDER);

// 木材家族全部徒手可采集
for (const ids of Object.values(Wood)) {
  HAND_HARVESTABLE.add(ids.log);
  HAND_HARVESTABLE.add(ids.planks);
  HAND_HARVESTABLE.add(ids.leaves);
  HAND_HARVESTABLE.add(ids.slab);
  HAND_HARVESTABLE.add(ids.stairs);
}

// 玻璃与玻璃板徒手可采集（石材补全与砂岩变体需要镐，不加入）
HAND_HARVESTABLE.add(GLASS_PANE_ID);
for (let i = 0; i < DYE_COLORS.length; i++) {
  HAND_HARVESTABLE.add(stainedGlassId(i));
  HAND_HARVESTABLE.add(stainedGlassPaneId(i));
}

export function blockHardness(id: number): number {
  return HARDNESS.get(id) ?? 3;
}

export function isHandHarvestable(id: number): boolean {
  return HAND_HARVESTABLE.has(id);
}

/**
 * 破坏该方块所需秒数（对齐原版公式）：
 *   可采集 → 1.5 × 硬度；不可采集 → 5 × 硬度
 * 例：泥土 0.75s、原木 3s、石头徒手 7.5s、黑曜石徒手 250s。
 */
export function breakSeconds(id: number, hasPickaxe = false): number {
  const hardness = blockHardness(id);
  if (hardness < 0) return Number.POSITIVE_INFINITY;
  const harvestable = hasPickaxe || isHandHarvestable(id);
  return harvestable ? hardness * 1.5 : hardness * 5;
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
