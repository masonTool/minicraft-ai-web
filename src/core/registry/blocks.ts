/**
 * 方块注册表
 *
 * 设计说明：
 * - 方块以数字 id 存储在世界数据里（Uint8Array），注册表负责 id ↔ 定义 的映射。
 * - `tiles` 为 [顶面, 底面, 侧面] 三个图集贴图名。
 * - 完整 1.18 方块集（含 block state）会在 B3/B4 逐步补齐；当前覆盖地形生成所需部分。
 */

import { DYE_COLORS, WOOD_TYPES } from './colors.ts';
import { isInverted, isLitState, isPowered, type BlockShape } from './blockState.ts';

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
  /** 按状态取贴图（红石灯亮/灭这类）；不填则一律用 tiles */
  readonly stateTiles?: (state: number) => readonly [string, string, string];
  /** 按状态取发光等级（红石灯亮时 15）；不填则一律用 light */
  readonly stateLight?: (state: number) => number;
  /**
   * 不生成对应物品（原版火焰就没有物品：只能靠打火石/岩浆点燃）。
   *
   * 方块物品是**批量注册**的（见 `items.ts` 里那段循环），不显式排除的话
   * 会自动多出一件"可放置的火焰"，玩家能在背包里拿到它——与 I12 的设计不符。
   */
  readonly itemless: boolean;
  /**
   * 长在水里的植物（批次 50 的海带与海草）。
   *
   * 本项目的水是**流体方块**（`Block.WATER` 占着那一格），所以"水里的植物"
   * 必须是"把水那一格换成植物"——这就是它需要的两条特殊待遇：
   *  1. **放置**：落点那一格必须是水（而不是空气），见 `Placement.ts`
   *  2. **不许被水冲走**：`Fluids.canFlowInto` 见到它就返回 false
   *     （否则旁边一格水会把它当"可替换方块"直接覆盖掉，海带一放下去就没了）
   */
  readonly waterPlant: boolean;
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
  stateTiles?: (state: number) => readonly [string, string, string];
  stateLight?: (state: number) => number;
  itemless?: boolean;
  waterPlant?: boolean;
}

/**
 * "点燃时换贴图"的通用写法（批次 47）。
 *
 * 顶面与底面不动、**侧面**换成点火贴图。三种炉子与营火共用它，
 * 于是"点燃长什么样"只有一处实现（也保证它们的色温一致——都是炉火那种橙黄）。
 */
function litTiles(
  state: number,
  top: string,
  side: string,
  litSide: string,
): readonly [string, string, string] {
  return [top, top, isLitState(state) ? litSide : side];
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
    shape: 'fluid',
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
    shape: 'fluid',
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
  {
    id: 44,
    name: 'minecraft:furnace',
    tiles: ['furnace_top', 'furnace_top', 'furnace_side'],
    // 点燃时换"炉口有火光"的贴图并发光 13（批次 47，与红石灯同一套机制）。
    // ⚠️ 立方体方块只有一个"侧面"贴图槽，所以**四个侧面会一起亮**（原版只亮正面）；
    // 这是"没有朝向状态"的代价，已记进 TASKS H6。
    stateTiles: (state) => litTiles(state, 'furnace_top', 'furnace_side', 'furnace_front_on'),
    stateLight: (state) => (isLitState(state) ? 13 : 0),
  },
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

// ---------------------------------------------------------------- 木制方块族（栅栏 / 栅栏门 / 门 / 活板门）

/**
 * 木制方块族：每种木材的**栅栏 / 栅栏门 / 门 / 活板门**。
 *
 * 橡木那四件是历史方块（栅栏 96、门 99、活板门 289、栅栏门 290），保持原 id 不动；
 * 其余 5 种木材接在**当前最大 id 之后**（313 起，每种连续 4 个）。
 * 与 `WOOD_BLOCK_ID_START` 同样的理由：追加式布局，加木材不会打乱既有编号
 * （存档里存的就是这些数字）。
 *
 * ⚠️ 这四件**形状全部是现成的**（`fence` / `fence_gate` / `door` / `trapdoor`），
 * 贴图也只有门 / 活板门 / 栅栏门三张需要按木材配色生成（栅栏直接复用木板贴图）——
 * 所以"补一族的其它木材"是纯表驱动的工作量，这也是 B16 批量推进的意义所在。
 */
export const WOOD_SHAPED_ID_START = 313;

export interface WoodShapedIds {
  readonly fence: number;
  readonly fenceGate: number;
  readonly door: number;
  readonly trapdoor: number;
}

/** 橡木四件的历史 id（与 `Block` 枚举同源，这里写常量是为了在枚举定义之前就能用） */
const OAK_WOOD_SHAPED: WoodShapedIds = { fence: 96, fenceGate: 290, door: 99, trapdoor: 289 };

const WOOD_SHAPED_MAP = new Map<string, WoodShapedIds>();

const WOOD_SHAPED_SPECS: readonly BlockSpec[] = (() => {
  const specs: BlockSpec[] = [];
  let base = WOOD_SHAPED_ID_START;
  for (const wood of WOOD_TYPES) {
    if (wood.name === 'oak') {
      // 橡木沿用历史 id，不占新段
      WOOD_SHAPED_MAP.set(wood.name, OAK_WOOD_SHAPED);
      continue;
    }
    const ids: WoodShapedIds = { fence: base, fenceGate: base + 1, door: base + 2, trapdoor: base + 3 };
    base += 4;
    WOOD_SHAPED_MAP.set(wood.name, ids);

    const plankTile = `${wood.name}_planks`;
    const gateTile = `${wood.name}_fence_gate`;
    const doorTile = `${wood.name}_door`;
    const trapdoorTile = `${wood.name}_trapdoor`;
    specs.push(
      {
        id: ids.fence,
        name: `minecraft:${wood.name}_fence`,
        tiles: [plankTile, plankTile, plankTile],
        shape: 'fence',
        opaque: false,
        lightOpacity: 0,
      },
      {
        id: ids.fenceGate,
        name: `minecraft:${wood.name}_fence_gate`,
        tiles: [gateTile, gateTile, gateTile],
        shape: 'fence_gate',
        opaque: false,
        lightOpacity: 0,
      },
      {
        id: ids.door,
        name: `minecraft:${wood.name}_door`,
        tiles: [doorTile, doorTile, doorTile],
        shape: 'door',
        opaque: false,
        lightOpacity: 0,
      },
      {
        id: ids.trapdoor,
        name: `minecraft:${wood.name}_trapdoor`,
        tiles: [trapdoorTile, trapdoorTile, trapdoorTile],
        shape: 'trapdoor',
        opaque: false,
        lightOpacity: 0,
      },
    );
  }
  return specs;
})();

/** 某种木材的 4 件木制方块 id；未知木材返回 undefined */
export function woodShaped(name: string): WoodShapedIds | undefined {
  return WOOD_SHAPED_MAP.get(name);
}

/**
 * 全部木材的木制方块 id（可燃表 / 工具加速表 / 创造分类 / 配方批量遍历用）。
 * 含橡木——它的 id 是历史值，但"这一族"必须一起走，否则又会出现
 * "云杉栅栏可燃、橡木栅栏不可燃"这种半残状态。
 */
export const WoodShaped: Readonly<Record<string, WoodShapedIds>> = Object.fromEntries(WOOD_SHAPED_MAP);

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

  // ---- 粗金属块（1.18 大矿脉里的稀有伴生方块）
  { id: 201, name: 'minecraft:raw_copper_block', tiles: ['raw_copper_block', 'raw_copper_block', 'raw_copper_block'] },
  { id: 202, name: 'minecraft:raw_iron_block', tiles: ['raw_iron_block', 'raw_iron_block', 'raw_iron_block'] },
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

/**
 * 从**基础定义**里取母方块的贴图（此时 `BLOCKS` 还没构建，只能查 `SPECS`）。
 *
 * ⚠️ 只查 `BASE_SPECS`，而且**查不到就抛错**：早先这里回退成 `['stone','stone','stone']`，
 * 于是"母方块不在 BASE_SPECS 里"会变成"台阶/墙长着石头的贴图"——
 * 方块表、名称、配方全都正常，只有外观错，属于最难查的一类。
 * 需要查 160 号之后的方块用下面的 `tilesOfDefined`。
 */
function baseTiles(id: number): readonly [string, string, string] {
  const spec = BASE_SPECS.find((candidate) => candidate.id === id);
  if (!spec?.tiles) throw new Error(`baseTiles: 母方块 ${id} 不在 BASE_SPECS 里（该用 tilesOfDefined）`);
  return spec.tiles;
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

// ---------------------------------------------------------------- 自然装饰（地物）
//
// 植物统一用 `cross` 形状（两片交叉薄面、无碰撞），仙人掌用 `cactus` 形状（内缩 1 像素的立方体）。
// 它们都是**不遮挡**的（opaque=false）——否则长在草方块上的花会把脚下的草地剔掉一面。

export const DECORATION_ID_START = 203;

/**
 * 植物方块。
 * @param id 方块 id
 * @param name 名称（不含命名空间）
 * @param tile 贴图名（三面同一个）
 */
function plantSpec(id: number, name: string, tile: string): BlockSpec {
  return {
    id,
    name: `minecraft:${name}`,
    tiles: [tile, tile, tile],
    solid: false,
    opaque: false,
    lightOpacity: 0,
    shape: 'cross',
  };
}

const DECORATION_SPECS: readonly BlockSpec[] = [
  plantSpec(203, 'short_grass', 'short_grass'),
  plantSpec(204, 'fern', 'fern'),
  plantSpec(205, 'dandelion', 'dandelion'),
  plantSpec(206, 'poppy', 'poppy'),
  plantSpec(207, 'blue_orchid', 'blue_orchid'),
  plantSpec(208, 'oxeye_daisy', 'oxeye_daisy'),
  plantSpec(209, 'cornflower', 'cornflower'),
  plantSpec(210, 'red_mushroom', 'red_mushroom'),
  plantSpec(211, 'brown_mushroom', 'brown_mushroom'),
  plantSpec(212, 'sugar_cane', 'sugar_cane'),
  plantSpec(216, 'dead_bush', 'dead_bush'),
  plantSpec(217, 'bamboo', 'bamboo'),
  {
    id: 213,
    name: 'minecraft:pumpkin',
    tiles: ['pumpkin_top', 'pumpkin_top', 'pumpkin_side'],
  },
  {
    id: 214,
    name: 'minecraft:melon',
    tiles: ['melon_top', 'melon_top', 'melon_side'],
  },
  {
    id: 215,
    name: 'minecraft:cactus',
    tiles: ['cactus_top', 'cactus_top', 'cactus_side'],
    opaque: false,
    lightOpacity: 0,
    shape: 'cactus' as const,
  },
];

/** 海晶石家族（海底神殿用） */
const PRISMARINE_SPECS: readonly BlockSpec[] = [
  { id: 218, name: 'minecraft:prismarine', tiles: ['prismarine', 'prismarine', 'prismarine'] },
  { id: 219, name: 'minecraft:prismarine_bricks', tiles: ['prismarine_bricks', 'prismarine_bricks', 'prismarine_bricks'] },
  { id: 220, name: 'minecraft:dark_prismarine', tiles: ['dark_prismarine', 'dark_prismarine', 'dark_prismarine'] },
  {
    id: 221,
    name: 'minecraft:sea_lantern',
    tiles: ['sea_lantern', 'sea_lantern', 'sea_lantern'],
    light: 15,
  },
];

// ---------------------------------------------------------------- 下界
//
// 下界方块全部走同一竖列 id，下界地形生成器按这些 id 直接写方块。
// 菌柄（stem）与主世界原木结构一致，只是配色偏紫红 / 青蓝。

const NETHER_SPECS: readonly BlockSpec[] = [
  { id: 222, name: 'minecraft:netherrack', tiles: ['netherrack', 'netherrack', 'netherrack'] },
  { id: 223, name: 'minecraft:soul_sand', tiles: ['soul_sand', 'soul_sand', 'soul_sand'] },
  { id: 224, name: 'minecraft:soul_soil', tiles: ['soul_soil', 'soul_soil', 'soul_soil'] },
  { id: 225, name: 'minecraft:basalt', tiles: ['basalt_top', 'basalt_top', 'basalt_side'] },
  { id: 226, name: 'minecraft:smooth_basalt', tiles: ['smooth_basalt', 'smooth_basalt', 'smooth_basalt'] },
  { id: 227, name: 'minecraft:blackstone', tiles: ['blackstone', 'blackstone', 'blackstone'] },
  {
    id: 228,
    name: 'minecraft:magma_block',
    tiles: ['magma', 'magma', 'magma'],
    light: 3,
  },
  { id: 229, name: 'minecraft:crimson_nylium', tiles: ['crimson_nylium', 'netherrack', 'crimson_nylium_side'] },
  { id: 230, name: 'minecraft:warped_nylium', tiles: ['warped_nylium', 'netherrack', 'warped_nylium_side'] },
  { id: 231, name: 'minecraft:crimson_stem', tiles: ['crimson_stem_top', 'crimson_stem_top', 'crimson_stem_side'] },
  { id: 232, name: 'minecraft:warped_stem', tiles: ['warped_stem_top', 'warped_stem_top', 'warped_stem_side'] },
  { id: 233, name: 'minecraft:crimson_planks', tiles: ['crimson_planks', 'crimson_planks', 'crimson_planks'] },
  { id: 234, name: 'minecraft:warped_planks', tiles: ['warped_planks', 'warped_planks', 'warped_planks'] },
  plantSpec(235, 'crimson_fungus', 'crimson_fungus'),
  plantSpec(236, 'warped_fungus', 'warped_fungus'),
  { id: 237, name: 'minecraft:nether_wart_block', tiles: ['nether_wart_block', 'nether_wart_block', 'nether_wart_block'] },
  {
    id: 238,
    name: 'minecraft:warped_wart_block',
    tiles: ['warped_wart_block', 'warped_wart_block', 'warped_wart_block'],
  },
  {
    id: 239,
    name: 'minecraft:shroomlight',
    tiles: ['shroomlight', 'shroomlight', 'shroomlight'],
    light: 15,
  },
  { id: 240, name: 'minecraft:nether_bricks', tiles: ['nether_bricks', 'nether_bricks', 'nether_bricks'] },
  {
    id: 241,
    name: 'minecraft:nether_quartz_ore',
    tiles: ['nether_quartz_ore', 'nether_quartz_ore', 'nether_quartz_ore'],
  },
  { id: 242, name: 'minecraft:ancient_debris', tiles: ['ancient_debris', 'ancient_debris', 'ancient_debris'] },
  plantSpec(243, 'crimson_roots', 'crimson_roots'),
  plantSpec(244, 'warped_roots', 'warped_roots'),
  plantSpec(245, 'nether_sprouts', 'nether_sprouts'),
];

// ---------------------------------------------------------------- 末地
//
// 末地的方块数不多（末地石 / 末地石砖 / 紫珀家族 / 紫颂 / 末地烛 / 龙蛋 / 传送门），
// 但紫颂植株与紫颂花是末地独有的"树"，末地城与末地船则全靠紫珀和末地石砖搭。
//
// ⚠️ 紫珀与末地石砖**没有台阶/楼梯变体**：SHAPED_PARENTS 的 slab/stairs id 区间
// 与后面的栅栏/装饰 id 紧挨着，追加母方块会撞 id（见 blocks.ts 里 SHAPED_PARENTS 的注释）。
// 末地城因此用整块搭建，已在 TASKS.md 记录这个取舍。

const END_SPECS: readonly BlockSpec[] = [
  { id: 246, name: 'minecraft:end_stone', tiles: ['end_stone', 'end_stone', 'end_stone'] },
  { id: 247, name: 'minecraft:end_stone_bricks', tiles: ['end_stone_bricks', 'end_stone_bricks', 'end_stone_bricks'] },
  { id: 248, name: 'minecraft:purpur_block', tiles: ['purpur_block', 'purpur_block', 'purpur_block'] },
  {
    id: 249,
    name: 'minecraft:purpur_pillar',
    tiles: ['purpur_pillar_top', 'purpur_pillar_top', 'purpur_pillar_side'],
  },
  plantSpec(250, 'chorus_plant', 'chorus_plant'),
  plantSpec(251, 'chorus_flower', 'chorus_flower'),
  {
    id: 252,
    name: 'minecraft:end_rod',
    tiles: ['end_rod', 'end_rod', 'end_rod'],
    solid: false,
    opaque: false,
    lightOpacity: 0,
    light: 14,
    shape: 'cross',
  },
  { id: 253, name: 'minecraft:dragon_egg', tiles: ['dragon_egg', 'dragon_egg', 'dragon_egg'] },
  { id: 254, name: 'minecraft:end_portal_frame', tiles: ['end_portal_frame', 'end_portal_frame', 'end_portal_frame'] },
  {
    id: 255,
    name: 'minecraft:end_portal',
    tiles: ['end_portal', 'end_portal', 'end_portal'],
    solid: false,
    opaque: false,
    lightOpacity: 0,
    light: 15,
  },
];

// ---------------------------------------------------------------- 红石元件
//
// 红石方块分两类：
//  - **电源与传输**：红石粉（贴地薄板）、红石火把、红石块、拉杆、按钮、压力板、中继器、比较器
//  - **执行器**：红石灯（亮/灭两套贴图 + 发光等级）、活塞 / 粘性活塞（伸出时在前方放一个活塞头）
//
// 信号强度**不存在方块状态里**，而是由 `core/redstone/RedstoneEngine.ts` 在运行时维护
// （方块状态只有 8 位，还要留给朝向与延迟；强度是易变的中间量，没必要落盘）。
// 状态位只用来记"元件的持久状态"：通电/按下（bit3）、朝向（bit1-2）、中继器延迟（bit4-5）。

const REDSTONE_SPECS: readonly BlockSpec[] = [
  {
    id: 256,
    name: 'minecraft:redstone_wire',
    tiles: ['redstone_wire', 'redstone_wire', 'redstone_wire'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 257,
    name: 'minecraft:redstone_torch',
    tiles: ['redstone_torch', 'redstone_torch', 'redstone_torch'],
    shape: 'torch',
    solid: false,
    opaque: false,
    lightOpacity: 0,
    light: 7,
  },
  { id: 258, name: 'minecraft:redstone_block', tiles: ['redstone_block', 'redstone_block', 'redstone_block'] },
  {
    id: 259,
    name: 'minecraft:lever',
    tiles: ['lever', 'lever', 'lever'],
    shape: 'torch',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 260,
    name: 'minecraft:stone_button',
    tiles: ['stone_button', 'stone_button', 'stone_button'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 261,
    name: 'minecraft:oak_button',
    tiles: ['oak_button', 'oak_button', 'oak_button'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 262,
    name: 'minecraft:stone_pressure_plate',
    tiles: ['stone_pressure_plate', 'stone_pressure_plate', 'stone_pressure_plate'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 263,
    name: 'minecraft:oak_pressure_plate',
    tiles: ['oak_pressure_plate', 'oak_pressure_plate', 'oak_pressure_plate'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 264,
    name: 'minecraft:repeater',
    tiles: ['repeater', 'repeater', 'repeater'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 265,
    name: 'minecraft:comparator',
    tiles: ['comparator', 'comparator', 'comparator'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 266,
    name: 'minecraft:redstone_lamp',
    tiles: ['redstone_lamp', 'redstone_lamp', 'redstone_lamp'],
    // 亮起的红石灯换成发光贴图，并把方块光拉到 15——这是"红石能点亮房间"的关键
    stateTiles: (state) =>
      isPowered(state)
        ? ['redstone_lamp_on', 'redstone_lamp_on', 'redstone_lamp_on']
        : ['redstone_lamp', 'redstone_lamp', 'redstone_lamp'],
    stateLight: (state) => (isPowered(state) ? 15 : 0),
  },
  {
    id: 267,
    name: 'minecraft:piston',
    tiles: ['piston_top', 'piston_top', 'piston_side'],
  },
  {
    id: 268,
    name: 'minecraft:piston_head',
    tiles: ['piston_head', 'piston_head', 'piston_head'],
  },
  {
    id: 269,
    name: 'minecraft:sticky_piston',
    tiles: ['sticky_piston_top', 'piston_top', 'piston_side'],
  },
  {
    id: 270,
    name: 'minecraft:observer',
    tiles: ['observer_top', 'observer_top', 'observer_side'],
  },
  // ---- 附魔与书架（H9）
  {
    // 附魔台：原版只有 0.75 格高（底部一圈黑曜石 + 上面一本书）。
    // ⚠️ 简化成**整格方块**：新增一种"矮方块"形状要同时改碰撞盒、网格化与放置逻辑，
    // 与它带来的收益不成比例（见 TASKS H9 的说明）
    id: 271,
    name: 'minecraft:enchanting_table',
    tiles: ['enchanting_table_top', 'obsidian', 'enchanting_table_side'],
  },
  {
    id: 272,
    name: 'minecraft:bookshelf',
    tiles: ['oak_planks', 'oak_planks', 'bookshelf'],
  },
  // ---- 铁砧（H8）
  {
    // 铁砧原版有朝向与"落地受损"两种状态（受损后第三次使用会毁掉），
    // 这里只做**单一方块**：朝向要用方块状态（B4 的旋转变体那套），
    // 落地受损则要方块状态里再存一个"损伤度"，都留给后续。
    id: 273,
    name: 'minecraft:anvil',
    tiles: ['anvil_top', 'iron_block', 'anvil_side'],
  },
  {
    // 铁块：铁砧的配方材料。此前项目里只有"粗铁块"，而铁块是原版最基础的储物方块之一
    id: 274,
    name: 'minecraft:iron_block',
    tiles: ['iron_block', 'iron_block', 'iron_block'],
  },
  // ---- 农业（H13）：耕地与小麦（4 个生长阶段各占一个 id）
  // 用"一个阶段一个 id"而不是方块状态：贴图是按 id 静态查的（`blockDef(id).tiles`），
  // 状态化就要改网格化与图集两处；而 id 在这套代码里本来就充裕（台阶/楼梯/16 色都是批量生成）。
  {
    id: 275,
    name: 'minecraft:farmland',
    tiles: ['farmland', 'dirt', 'farmland_side'],
    // ⚠️ 原版耕地是 15/16 高、而且踩上去会"退化"回泥土；这里先做成整格、不退化
    solid: true,
    opaque: true,
  },
  plantSpec(276, 'wheat_stage0', 'wheat_stage0'),
  plantSpec(277, 'wheat_stage1', 'wheat_stage1'),
  plantSpec(278, 'wheat_stage2', 'wheat_stage2'),
  plantSpec(279, 'wheat_stage3', 'wheat_stage3'),
  {
    id: 288,
    name: 'minecraft:brewing_stand',
    // 三段贴图：顶面（放药水的台面）/ 底面 / 侧面（石座 + 一根烈焰棒）
    tiles: ['brewing_stand_top', 'brewing_stand_bottom', 'brewing_stand_side'],
    solid: true,
    opaque: true,
  },
  plantSpec(280, 'carrots_stage0', 'carrots_stage0'),
  plantSpec(281, 'carrots_stage1', 'carrots_stage1'),
  plantSpec(282, 'carrots_stage2', 'carrots_stage2'),
  plantSpec(283, 'carrots_stage3', 'carrots_stage3'),
  plantSpec(284, 'potatoes_stage0', 'potatoes_stage0'),
  plantSpec(285, 'potatoes_stage1', 'potatoes_stage1'),
  plantSpec(286, 'potatoes_stage2', 'potatoes_stage2'),
  plantSpec(287, 'potatoes_stage3', 'potatoes_stage3'),
];



/**
 * 全部方块定义。
 * ⚠️ 必须按 id 升序排列：BLOCKS 是按数组下标索引的，顺序错位会让 blockDef(id) 取到别的方块。
 */
/**
 * 活板门与栅栏门（批次 30）。
 *
 * 两者都是"非立方体形状"家族的最后两块（见 B7）：形状定义在 `blockShapes.ts` 里，
 * 渲染与碰撞**共用同一份几何**（免得画一片板、撞在另一处）。
 * 状态位与门共用"开/关"那一位（见 `blockState.ts` 的说明）。
 */
const OPENABLE_SPECS: readonly BlockSpec[] = [
  {
    id: 289,
    name: 'minecraft:oak_trapdoor',
    tiles: ['oak_trapdoor', 'oak_trapdoor', 'oak_trapdoor'],
    shape: 'trapdoor',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 290,
    name: 'minecraft:oak_fence_gate',
    tiles: ['oak_fence_gate', 'oak_fence_gate', 'oak_fence_gate'],
    shape: 'fence_gate',
    opaque: false,
    lightOpacity: 0,
  },
];

/**
 * 火焰（I12）。
 *
 * 形状借用了植物那套 `cross`（两片交叉薄面、无碰撞）——原版火焰其实有 4 张朝向不同的面，
 * 但 `cross` 已经能表达"站在草/木板上的火苗"，而新增一种形状要同时改网格化与碰撞两处。
 *
 * - **自发光 15**：火把是 14，火焰比火把更亮，这一点在夜里看得很明显
 * - **不生成物品**（见 `itemless`）：只能靠打火石点燃，背包里拿不到"一叠火"
 * - **硬度 0**：徒手一拍即灭（与原版一致——打火是瞬间的，灭也是）
 */
const FIRE_SPECS: readonly BlockSpec[] = [
  {
    id: 291,
    name: 'minecraft:fire',
    tiles: ['fire', 'fire', 'fire'],
    shape: 'cross',
    solid: false,
    opaque: false,
    light: 15,
    lightOpacity: 0,
    itemless: true,
  },
];

/**
 * 下界传送门方块（K8）。
 *
 * 形状上它就是一块"整格"，但**没有任何碰撞**（可以走进去）、**不遮挡**邻居、
 * 走**半透明渲染层**（紫色门面是半透明的，且两个门方块之间的内部面会被剔除，
 * 于是 2×3 的门面最终只是一面 1 格厚的紫色墙——与原版观感一致）。
 *
 * - **自发光 11**（原版数值）：门自己会照亮周围，夜里一眼就能看见
 * - **不生成物品**（见 `itemless`）：只能由黑曜石框点燃，背包里拿不到
 * - 状态位记"门面沿哪个水平轴"（见 `blockState.ts#portalAxis`），
 *   与状态无关的渲染（贴图滚动）在材质里做
 */
const PORTAL_SPECS: readonly BlockSpec[] = [
  {
    id: 292,
    name: 'minecraft:nether_portal',
    tiles: ['nether_portal', 'nether_portal', 'nether_portal'],
    solid: false,
    opaque: false,
    translucent: true,
    light: 11,
    lightOpacity: 0,
    itemless: true,
  },
];

/**
 * 下界合金（K8 尾巴）。
 *
 * - **下界合金块**：9 个下界合金锭合成的储物方块（与铁块/金块同一档硬度）
 * - **锻造台**：把钻石装备升级成下界合金装备的工作台。原版它有 `facing` 状态与
 *   "把物品放在台面上"的模型；这里和铁砧/附魔台一样**简化成整格方块**
 *   （理由同 H9：新增矮方块形状要同时改碰撞盒、网格化与放置逻辑，收益不成比例）
 */
const NETHERITE_SPECS: readonly BlockSpec[] = [
  { id: 293, name: 'minecraft:netherite_block', tiles: ['netherite_block', 'netherite_block', 'netherite_block'] },
  {
    id: 294,
    name: 'minecraft:smithing_table',
    tiles: ['smithing_table_top', 'oak_planks', 'smithing_table_side'],
  },
];

/**
 * 睡莲（B16）：水面上的薄叶片。
 *
 * 形状是 `lily_pad`（1/16 薄板 + **有碰撞**，见 `blockShapes.ts`）——
 * 与红石粉那批 `flat` 的唯一区别就是能站上去。
 * 走**半透明层**：贴图四角是透明的（叶片是个圆盘），必须 alpha 混合而不是 alphaTest，
 * 否则叶片边缘会出现硬锯齿；它也只有 1/16 高，与水面挨着时不会有明显的排序问题。
 */
const LILY_PAD_SPECS: readonly BlockSpec[] = [
  {
    id: 295,
    name: 'minecraft:lily_pad',
    tiles: ['lily_pad', 'lily_pad', 'lily_pad'],
    shape: 'lily_pad',
    solid: false,
    opaque: false,
    translucent: true,
    lightOpacity: 0,
  },
];

// ---------------------------------------------------------------- 地毯与雪层（批次 37）
//
// 这一批是"方块族批量推进"（B16）的第一块：地毯按 16 色配色表生成，
// 雪层则给"雪原＝一片白"这件事补上真正的地表装饰（D14 / K11 的尾巴）。

/** 地毯 id 起始值：16 色连续排列，顺序与 DYE_COLORS 一致 */
export const CARPET_ID_START = 296;

/** 雪层（1~8 层，层数存在方块状态里；见 `blockState.ts#snowLayers`） */
export const SNOW_LAYER_ID = 312;

/**
 * 地毯（16 色）。
 *
 * 形状**直接复用"贴地薄板" `flat`**（1/16 高、无碰撞）：原版地毯本来就不挡路，
 * 与红石粉 / 压力板是同一套几何与同一套物理，所以不必新开形状。
 * ——与睡莲那条经验正好相反：睡莲"几何相同但能站上去"，物理不同，才必须拆成 `lily_pad`。
 *
 * `solid: false` 是必须的：`World.collisionAt` 见到 `!def.solid` 直接返回 null，
 * 而地毯在原版确实踩得过去（它的碰撞盒本来就是空的）。
 */
const CARPET_SPECS: readonly BlockSpec[] = DYE_COLORS.map((color, index) => ({
  id: CARPET_ID_START + index,
  name: `minecraft:${color.name}_carpet`,
  tiles: [`carpet_${color.name}`, `carpet_${color.name}`, `carpet_${color.name}`],
  shape: 'flat' as const,
  solid: false,
  opaque: false,
  lightOpacity: 0,
}));

/**
 * 雪层（B11 / K11）。
 *
 * 与"一个生长阶段一个 id"的小麦不同，雪层是**一个方块 + 状态位**：
 * 8 个阶段共用同一张贴图（`snow`），变的只有几何高度，
 * 而几何本来就吃状态（`meshBoxes(shape, state)`）——不需要为了 8 种高度多出 8 个 id。
 *
 * - **有碰撞**（所以 `solid` 保持默认 true，`collisionAt` 才会去算形状盒），
 *   高度 = 层数/8：1 层只有 1/8 格（直接走上去），8 层正好整格
 * - 不遮挡邻居（`opaque: false`、`lightOpacity: 0`）：雪层压在地上不该让草皮变暗
 * - 破坏掉落 **1 个雪球**（原版：不精准采集就掉雪球，与层数无关），精准采集掉自身
 */
const SNOW_SPECS: readonly BlockSpec[] = [
  {
    id: SNOW_LAYER_ID,
    name: 'minecraft:snow',
    tiles: ['snow', 'snow', 'snow'],
    shape: 'snow' as const,
    opaque: false,
    lightOpacity: 0,
  },
];

// ---------------------------------------------------------------- 锁链与藤蔓（B11 收口）

/**
 * 锁链（B11）：3/16 粗的细柱，**轴向存在状态里**（竖着挂 / 沿 X / 沿 Z）。
 *
 * - **有碰撞**：原版 `ChainBlock` 的盒子是 3/16 见方（`box(6.5,0,6.5,9.5,16,9.5)`），照抄
 * - 不遮挡邻居、不挡光（挂在天花板上的锁链不该让下面变暗）
 * - **可以攀爬**（基岩版特性——本项目复刻的是基岩版，见 `PlayerPhysics` 的攀爬分支）
 * - 硬度 5、**必须用镐**（原版 `requiresCorrectToolForDrops`：徒手挖得动但什么都不掉）
 */
const CHAIN_SPECS: readonly BlockSpec[] = [
  {
    id: 333,
    name: 'minecraft:chain',
    tiles: ['chain', 'chain', 'chain'],
    shape: 'chain',
    opaque: false,
    lightOpacity: 0,
  },
];

/**
 * 藤蔓（B11）：贴在方块侧面或天花板底下的薄片，**一个方块能同时挂 5 面**。
 *
 * - **没有碰撞**（原版穿得过去）、不遮挡邻居、不挡光
 * - **可以攀爬**（与梯子一样：按跳跃往上、按潜行往下）
 * - 硬度 0.2；**只有剪刀或精准采集才掉自身**，徒手/斧头打掉什么都不掉（原版规则）
 * - 可燃（原版藤蔓会烧）
 */
const VINE_SPECS: readonly BlockSpec[] = [
  {
    id: 334,
    name: 'minecraft:vine',
    tiles: ['vine', 'vine', 'vine'],
    shape: 'vine',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];

// ---------------------------------------------------------------- 铜的氧化（批次 40）

/**
 * 铜的四档氧化（原版 1.17 那条"铜会锈"的机制）。
 *
 * 每档 4 个方块：**铜块 / 切制铜 / 切制铜台阶 / 切制铜楼梯**，四档共 16 个。
 * id 从 `COPPER_ID_START` 起**每档连续 4 个**，档内顺序固定为
 * `[铜块, 切制铜, 台阶, 楼梯]`（见 `copperId(stage, kind)`）。
 *
 * ⚠️ **顺序即氧化顺序**：`core/world/Copper.ts` 就是按这张表的**下标**推进氧化的，
 * 往中间插一行会打乱既有的存档方块（老存档里的"斑驳铜块"会变成别的档），只能往末尾加。
 * 涂蜡变体（16 个）还没做——它要**蜜蜡**，而蜜蜡唯一的来源是蜂巢（蜜蜂没做），
 * 于是记进了 TASKS：要么等蜜蜂，要么先不做（"第一件原料从哪来"那条老经验）。
 */
export const COPPER_ID_START = 335;

/** 每档的贴图名与中文前缀（贴图、名字、配方都由它展开） */
export const COPPER_STAGES = [
  { blockTile: 'copper_block', cutTile: 'cut_copper' },
  { blockTile: 'exposed_copper', cutTile: 'exposed_cut_copper' },
  { blockTile: 'weathered_copper', cutTile: 'weathered_cut_copper' },
  { blockTile: 'oxidized_copper', cutTile: 'oxidized_cut_copper' },
] as const;

/** 档内四种形状的名字后缀（与 `copperId` 的第二维一一对应） */
const COPPER_SHAPES = [
  { suffix: '_block', cut: false },
  { suffix: '', cut: true },
  { suffix: '_slab', cut: true },
  { suffix: '_stairs', cut: true },
] as const;

/** 第 `stage` 档第 `kind` 种铜方块的 id：kind 0=铜块、1=切制铜、2=台阶、3=楼梯 */
export function copperId(stage: number, kind: 0 | 1 | 2 | 3): number {
  return COPPER_ID_START + stage * 4 + kind;
}

const COPPER_SPECS: readonly BlockSpec[] = COPPER_STAGES.flatMap((stage, index) =>
  COPPER_SHAPES.map((shape, kind): BlockSpec => {
    const tile = shape.cut ? stage.cutTile : stage.blockTile;
    const name = shape.cut
      ? `${stage.cutTile}${shape.suffix}` // cut_copper / cut_copper_slab / cut_copper_stairs
      : `${stage.blockTile}`; // copper_block / exposed_copper / ...
    const base: BlockSpec = {
      id: copperId(index, kind as 0 | 1 | 2 | 3),
      name: `minecraft:${name}`,
      tiles: [tile, tile, tile],
    };
    // 台阶与楼梯是非完整方块：不遮挡邻居、不挡光（与石材家族同一套写法）
    if (name.endsWith('_slab')) return { ...base, shape: 'slab', opaque: false, lightOpacity: 0 };
    if (name.endsWith('_stairs')) return { ...base, shape: 'stairs', opaque: false, lightOpacity: 0 };
    return base;
  }),
);

// ---------------------------------------------------------------- 石英与更多石材（批次 42）

/**
 * 第二批"石材家族"的母方块：**石英家族 + 深板岩瓦 + 红色下界砖**。
 *
 * 它们与批次 41 的 16 个母方块共用同一张变体表（`STONE_VARIANT_PARENTS`），
 * 所以下面的 id 段紧跟变体段：
 *
 *   id 351 ~ 386：批次 41 的 36 个变体
 *   id 387 ~ 403：批次 42 新增的 17 个变体（石英 / 平滑石英 / 深板岩瓦 / 红色下界砖 / 海晶石三兄弟）
 *   id 404 ~ 409：**本段的 6 个母方块**（石英块 / 錾制石英块 / 石英柱 / 平滑石英 / 深板岩瓦 / 红色下界砖）
 *
 * ⚠️ 母方块的 id 写成常量而不是"变体段末尾接着排"：变体段的长度会随表变化，
 * 用运行时计算的话，往变体表里加一项就会把母方块的 id 整体挪一格（存档里存的正是这些数字）。
 * 套件里有一条断言守着"变体段不许溢进母方块段"。
 */
export const MORE_STONE_ID_START = 404;

const MORE_STONE_SPECS: readonly BlockSpec[] = [
  {
    id: 404,
    name: 'minecraft:quartz_block',
    tiles: ['quartz_block_top', 'quartz_block_top', 'quartz_block_side'],
  },
  { id: 405, name: 'minecraft:chiseled_quartz_block', tiles: ['chiseled_quartz_block', 'chiseled_quartz_block', 'chiseled_quartz_block'] },
  // 石英柱在原版有轴向（横竖两种）；本项目与紫珀柱一样**不做轴向状态**（避免为一个方块加一条状态通道）
  { id: 406, name: 'minecraft:quartz_pillar', tiles: ['quartz_pillar_top', 'quartz_pillar_top', 'quartz_pillar_side'] },
  { id: 407, name: 'minecraft:smooth_quartz', tiles: ['smooth_quartz', 'smooth_quartz', 'smooth_quartz'] },
  { id: 408, name: 'minecraft:deepslate_tiles', tiles: ['deepslate_tiles', 'deepslate_tiles', 'deepslate_tiles'] },
  { id: 409, name: 'minecraft:red_nether_bricks', tiles: ['red_nether_bricks', 'red_nether_bricks', 'red_nether_bricks'] },
];

// ---------------------------------------------------------------- 切石机（批次 44）

/**
 * 切石机（H11）。
 *
 * 原版把它做成"整块方块 + 台面上一条锯片"，**没有状态**（没有朝向、没有开关），
 * 所以这里就是一个普通的 cube：id 接在最大 id（409）之后。
 *
 * id 写成常量、不用"末尾接着排"：方块总数每批都在涨，
 * 而存档里存的就是这个数字（与 `MORE_STONE_ID_START` 同一条理由）。
 */
export const STONECUTTER_ID = 410;

const STONECUTTER_SPECS: readonly BlockSpec[] = [
  {
    id: STONECUTTER_ID,
    name: 'minecraft:stonecutter',
    // 贴图顺序与 BlockSpec.tiles 一致：[顶面, 底面, 侧面]
    tiles: ['stonecutter_top', 'stonecutter_bottom', 'stonecutter_side'],
  },
];

// ---------------------------------------------------------------- 红沙与红砂岩（批次 45）

/**
 * 红沙与红砂岩家族（批次 45，B23 的收尾）。
 *
 * 批次 42 把红砂岩家族记进了"不做"清单，理由是**原料从哪来**那条老规矩：
 * 红砂岩要红沙，而红沙只长在恶地。当时判断"本项目没有恶地"——这句其实是错的：
 * 恶地（`Biome.BADLANDS`）从地貌批次起就在，连彩色陶瓦色带都铺好了，
 * 缺的只是**地表那一层红沙**（原版恶地地表是红沙，陶瓦在它下面）。
 *
 * 所以这一批先补红沙、再让它长在恶地地表，红砂岩家族才真正成立：
 *
 *   id 411      红沙（普通 cube，可以徒手铲）
 *   id 412~415  红砂岩 / 錾制红砂岩 / 切制红砂岩 / 平滑红砂岩（4 个母方块）
 *   id 416~421  它们的 6 个变体（3 + 1 + 2，见下面的变体表）
 *
 * ⚠️ 变体的 id **不能靠顺序排**：变体段从 351 起顺序分配，第一批 23 个家族正好排到 403，
 * 后面 404~410 是写死的母方块常量（石英家族 + 切石机）。再往变体表末尾追加家族，
 * 顺序分配就会**撞进那一段**。所以这里给变体表加了"显式起点"这一列
 * （`RED_SANDSTONE_VARIANT_ID_START`），追加家族时把下一段的起点写清楚即可。
 */
export const RED_SAND_ID_START = 411;

/** 红砂岩家族变体的显式起点（见上面的注解：顺序分配会撞进写死的母方块段） */
export const RED_SANDSTONE_VARIANT_ID_START = 416;

// ---------------------------------------------------------------- 烟熏炉与高炉（批次 46）

/**
 * 烟熏炉与高炉（H6，批次 46）。
 *
 * 它们是**熔炉的两个变体**：原版三者的界面、格子布局、燃料规则完全一样，
 * 区别只有两条——**只吃一类东西**（烟熏炉吃食物、高炉吃矿物与金属）
 * 与**速度 2 倍**（10 秒 → 5 秒）。所以这一批的"方块"部分很薄，
 * 真正的东西在 `crafting/Smelting.ts` 的站台过滤与 `container/Furnace.ts` 的站台上。
 *
 * ⚠️ 三种炉子的**点燃外观**都没做（本项目熔炉一直没有 LIT 状态位与点火贴图）：
 * 方块贴图是静态的两张（顶 + 侧），炉子烧起来时看不出在烧。这条差异记在 TASKS H6 里。
 */
export const SMOKER_ID = 422;
export const BLAST_FURNACE_ID = 423;

/**
 * 营火（H11，批次 47）。
 *
 * 它是"炉子的第三种站台"，但有三处与三座炉子不同（都对齐原版）：
 *  1. **不要燃料**——点着就一直烤；用锹右键熄灭、用打火石重新点燃；
 *  2. **一次烤 4 个**（4 个格子同时推进），烤好的东西**直接弹出来**（没有产物槽）；
 *  3. **慢**：原版 600 tick = 30 秒一个（熔炉的 3 倍），而且**只烤食物**。
 *
 * 形状单开一个 `campfire`（7/16 高的柴堆，能站上去），点燃时顶面变成火焰贴图并发光 15。
 */
export const CAMPFIRE_ID = 424;

/**
 * 甜菜（B17，批次 48）：第四种作物。
 *
 * 与小麦/胡萝卜/马铃薯共用同一套生长行为与阶段表（`CROP_STAGES`），
 * 所以新增一种作物要动的地方很少：**4 行 `plantSpec` + 一张阶段表 + 掉落表**。
 * 种子只从村庄与矿井的战利品里来（原版也只有这几条来源，见 `loot.ts`）。
 */
const BEETROOT_SPECS: readonly BlockSpec[] = [
  plantSpec(425, 'beetroots_stage0', 'beetroots_stage0'),
  plantSpec(426, 'beetroots_stage1', 'beetroots_stage1'),
  plantSpec(427, 'beetroots_stage2', 'beetroots_stage2'),
  plantSpec(428, 'beetroots_stage3', 'beetroots_stage3'),
];

// ---------------------------------------------------------------- 甜浆果丛与可可豆（批次 49）

/**
 * 甜浆果丛与可可豆（B17，批次 49）。
 *
 * 这两样是 B17 里最后两种"**能靠玩家自己走通**"的食物来源，
 * 也是同一种结构：**一个能种的植物 → 结出食物**。
 *
 * 甜浆果丛：4 个生长阶段（与小麦/甜菜同一套"一个阶段一个 id"的做法），
 * 长在草/泥土上，**不需要耕地**——所以它不走 `growCrop` 那套判定，
 * 自己有一条随机刻行为（见 `RandomTicks.ts` 的 `berryBehavior`）。
 *
 * 可可豆：原版是**挂在丛林原木侧面**的豆荚，所以它有朝向状态
 * （`facing` = 贴着哪一面），3 个生长阶段各占一个 id。
 */
export const SWEET_BERRY_BUSH_ID_START = 429;
export const COCOA_ID_START = 433;

const BERRY_AND_COCOA_SPECS: readonly BlockSpec[] = [
  plantSpec(429, 'sweet_berry_bush_stage0', 'sweet_berry_bush_stage0'),
  plantSpec(430, 'sweet_berry_bush_stage1', 'sweet_berry_bush_stage1'),
  plantSpec(431, 'sweet_berry_bush_stage2', 'sweet_berry_bush_stage2'),
  plantSpec(432, 'sweet_berry_bush_stage3', 'sweet_berry_bush_stage3'),
  // 可可豆荚：形状挂在原木侧面，朝向存在状态里
  {
    id: 433,
    name: 'minecraft:cocoa_stage0',
    tiles: ['cocoa_stage0', 'cocoa_stage0', 'cocoa_stage0'],
    shape: 'cocoa',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 434,
    name: 'minecraft:cocoa_stage1',
    tiles: ['cocoa_stage1', 'cocoa_stage1', 'cocoa_stage1'],
    shape: 'cocoa',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 435,
    name: 'minecraft:cocoa_stage2',
    tiles: ['cocoa_stage2', 'cocoa_stage2', 'cocoa_stage2'],
    shape: 'cocoa',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];

// ---------------------------------------------------------------- 海带与海草（批次 50）

/**
 * 海带与海草（B17 的最后一样"要地物"的食物）。
 *
 * 这两样是 B17 里**唯一卡在"水里能长的植物"**的两件：本项目的水是流体方块
 * （水占着那一格），所以"种在水里"意味着**植物替换掉那一格水**——
 * 之前没有任何方块这么干过（睡莲是"水面正上方那一格空气"），
 * 于是需要一条新通道，见 `FeatureWriter#putInWater` 与 `BlockDef.waterPlant`。
 *
 * 三件东西的差别：
 *  - **海带**（`kelp`）：从海底往上长的一株（随机刻里由**顶端**长高，封顶 26 格——
 *    与甘蔗"只由顶端长高"同一套做法），**脱水即枯萎**（上方不再是水就整格毁掉并掉 1 个海带）。
 *    ⚠️ 原版是 `kelp`（顶端）与 `kelp_plant`（茎）两个方块，这里合成**一个 id**：
 *    "我是不是顶端"由"上方那一格是不是自己"现算（与甘蔗同一条判据），
 *    省掉一个 id 与一整套"顶端 vs 茎"的同步逻辑，代价是两者共用一张贴图。
 *  - **海草**（`seagrass`）：海底的草，不生长、**徒手拔不掉**（只有剪刀才会掉自身，
 *    与原版一致——原版海草的掉落判定就只认剪刀）。
 *  - **干海带块**（`dried_kelp_block`）：9 个干海带压成一块，**当燃料能烧 20 个东西**
 *    （200 秒，比煤炭的 80 秒还耐烧，这是原版数据）。
 */
export const KELP_ID = 436;
export const SEAGRASS_ID = 437;
export const DRIED_KELP_BLOCK_ID = 438;

/**
 * 海带的最高长度（原版 `KelpBlock` 的 `MAX_HEIGHT` 是 26）。
 *
 * ⚠️ 放在这里而不是 `RandomTicks.ts`（生长行为那一侧）或 `Features.ts`（生成那一侧）：
 * **两边都要用它**（随机刻封顶、世界生成时裁高度），而 `Features.ts` 会被 Web Worker 直接引用，
 * 让它 import `RandomTicks` 会把火焰/铜/物品注册表整包拖进 Worker。数据放注册表、
 * 两边各自引用，就不会有第二个 26 悄悄漂开。
 */
export const KELP_MAX_HEIGHT = 26;

/** 长在水里的植物统一用 `cross` 形状（两片交叉薄面、无碰撞），只是多一个 `waterPlant` 标记 */
function waterPlantSpec(id: number, name: string, tile: string): BlockSpec {
  return { ...plantSpec(id, name, tile), waterPlant: true };
}

const KELP_SPECS: readonly BlockSpec[] = [
  waterPlantSpec(KELP_ID, 'kelp', 'kelp'),
  waterPlantSpec(SEAGRASS_ID, 'seagrass', 'seagrass'),
  {
    id: DRIED_KELP_BLOCK_ID,
    name: 'minecraft:dried_kelp_block',
    // 顶面是编织纹、侧面是横着压出来的一层层（底面孔位复用侧面：整块方块，不必为底面再画一张）
    tiles: ['dried_kelp_top', 'dried_kelp_side', 'dried_kelp_side'],
  },
];

// ---------------------------------------------------------------- 珊瑚一族（批次 51）

/**
 * 珊瑚（1.13 海洋更新的主角，暖水海洋海底）。
 *
 * **五"种" × 三"形" × 活/失活 = 30 个方块**，全部由下面这一小段循环展开：
 *  - **珊瑚块**（`tube_coral_block`，固体方块）：珊瑚礁的主体
 *  - **珊瑚**（`tube_coral`，`cross` 形状的丛）：长在珊瑚块上/海底
 *  - **珊瑚扇**（`tube_coral_fan`，`coral_fan` 形状的薄片）：能贴墙、也能落在方块顶上
 *
 * 活珊瑚与失活珊瑚是**两套 id**（原版如此）。这一族最要紧的两条机制都在
 * `RandomTicks.ts` 里：**离开水就失活**、**挨着活珊瑚会复活**；
 * 掉落那条在 `items.ts`：**活珊瑚不用精准采集只掉失活版**。
 *
 * 为什么用循环展开而不是手抄 30 行：这一族的"三形 × 五色"必然要一起改
 * （贴图、掉落、失活映射、生成都用同一套名字），手抄的版本一定会漏掉某一格，
 * 而漏掉的那一格看起来与其他格子毫无区别（就像"少了一种木材的门"）。
 */
export const CORAL_BLOCK_ID_START = 439;
export const DEAD_CORAL_BLOCK_ID_START = 444;
export const CORAL_ID_START = 449;
export const DEAD_CORAL_ID_START = 454;
export const CORAL_FAN_ID_START = 459;
export const DEAD_CORAL_FAN_ID_START = 464;

/** 珊瑚的五"种"（原版顺序：管 / 脑 / 气泡 / 火 / 鹿角） */
export const CORAL_KINDS = ['tube', 'brain', 'bubble', 'fire', 'horn'] as const;
export type CoralKind = (typeof CORAL_KINDS)[number];

/** 五种珊瑚的中文译名（方块名与物品名共用同一套） */
export const CORAL_KIND_CN: Record<CoralKind, string> = {
  tube: '管',
  brain: '脑',
  bubble: '气泡',
  fire: '火',
  horn: '鹿角',
};

/** 珊瑚扇：能贴墙也能落地，几何与火把同一套状态（"贴哪一面"写在状态里） */
function coralFanSpec(id: number, name: string, tile: string): BlockSpec {
  return {
    id,
    name: `minecraft:${name}`,
    tiles: [tile, tile, tile],
    solid: false,
    opaque: false,
    lightOpacity: 0,
    shape: 'coral_fan',
    // 与海带/海草同一条：它占了那一格水，所以放置要落在水里、水也冲不走它
    waterPlant: true,
  };
}

const CORAL_SPECS: BlockSpec[] = [];
for (let i = 0; i < CORAL_KINDS.length; i++) {
  const kind = CORAL_KINDS[i]!;
  const blockTile = `${kind}_coral_block`;
  const deadBlockTile = `dead_${kind}_coral_block`;
  // 珊瑚块（活/失活）：固体方块，走默认 cube
  CORAL_SPECS.push({
    id: CORAL_BLOCK_ID_START + i,
    name: `minecraft:${blockTile}`,
    tiles: [blockTile, blockTile, blockTile],
  });
  CORAL_SPECS.push({
    id: DEAD_CORAL_BLOCK_ID_START + i,
    name: `minecraft:${deadBlockTile}`,
    tiles: [deadBlockTile, deadBlockTile, deadBlockTile],
  });
  // 珊瑚丛（活/失活）：与花草同一种 cross 植物，只是长在水里
  CORAL_SPECS.push({ ...waterPlantSpec(CORAL_ID_START + i, `${kind}_coral`, `${kind}_coral`) });
  CORAL_SPECS.push({ ...waterPlantSpec(DEAD_CORAL_ID_START + i, `dead_${kind}_coral`, `dead_${kind}_coral`) });
  // 珊瑚扇（活/失活）
  CORAL_SPECS.push(coralFanSpec(CORAL_FAN_ID_START + i, `${kind}_coral_fan`, `${kind}_coral_fan`));
  CORAL_SPECS.push(coralFanSpec(DEAD_CORAL_FAN_ID_START + i, `dead_${kind}_coral_fan`, `dead_${kind}_coral_fan`));
}

/** 珊瑚一族的"活 ↔ 失活"对照（掉落要用、失活与复活两条机制也要用） */
export const CORAL_DEAD_VARIANT = new Map<number, number>();
export const CORAL_LIVE_VARIANT = new Map<number, number>();
for (const [liveStart, deadStart] of [
  [CORAL_BLOCK_ID_START, DEAD_CORAL_BLOCK_ID_START],
  [CORAL_ID_START, DEAD_CORAL_ID_START],
  [CORAL_FAN_ID_START, DEAD_CORAL_FAN_ID_START],
] as const) {
  for (let i = 0; i < CORAL_KINDS.length; i++) {
    CORAL_DEAD_VARIANT.set(liveStart + i, deadStart + i);
    CORAL_LIVE_VARIANT.set(deadStart + i, liveStart + i);
  }
}

/**
 * 这一格是不是"活珊瑚"（变色都用它）。
 *
 * ⚠️ 判据是"**在活珊瑚那张表里**"，而不是"是珊瑚族但不是失活的"：
 * 后者要求先判断"是不是珊瑚族"，那就得再维护一张族表——两张表迟早会不一样。
 */
export function isLiveCoral(id: number): boolean {
  return CORAL_DEAD_VARIANT.has(id);
}

/** 这一格是不是"失活珊瑚"（同样只看表） */
export function isDeadCoral(id: number): boolean {
  return CORAL_LIVE_VARIANT.has(id);
}

// ---------------------------------------------------------------- 蛋糕与花盆（批次 52）

/**
 * 蛋糕（批次 52）：**一个能被一片片吃掉的方块**。
 *
 * 原版蛋糕是"放置后右键吃、共 7 片、吃完消失"，所以它既是方块又是食物——
 * 但**它的物品不是食物**（手里拿着蛋糕右键地面是"放下"，长按不会啃）。
 * 因此这里**不把 cake 登记进 `FOOD_TABLE`**，而是单独给一片的数值
 * （`CAKE_SLICE_FOOD`，见 `food.ts`）：一登记就会让"手持蛋糕长按"也能吃掉，
 * 那是与"放下去大家一起吃"完全不同的行为。
 */
export const CAKE_ID = 469;

/**
 * 花盆（批次 52）：盆 + 里面那株植物。
 *
 * 原版用**方块实体**记"里面装的是什么"，本项目没有方块实体，也没有物品 NBT，
 * 于是改用**状态位里的索引**（见 `POTTED_PLANTS`）：0 = 空盆，1..N = 第 N 种植物。
 * 5 个状态位够放 31 种，目前 18 种（草/蕨/五朵花/两种蘑菇/枯木/仙人掌/竹子/
 * 甜浆果丛/五色珊瑚扇——与原版花盆能放的那批一致）。
 */
export const FLOWER_POT_ID = 470;

// ---------------------------------------------------------------- 脚手架（批次 53）

/**
 * 脚手架（`scaffolding`，id 471）：**底部一块板 + 四角柱**，能站上去、也能**攀爬**。
 *
 * 它一次性把三件事凑齐（都是"形状框架"里现成的能力）：
 *  - **水平连接**：与栅栏/墙同一套"网格化时按邻居实时算"（四角柱在连成片时省略）
 *  - **可站上去**：底部 1/8 格高的板（走上去不用跳，原版也是 1/8）
 *  - **可攀爬**：`isClimbableBlock` 按**形状**判定 → 这里加一个形状就自动能爬
 *
 * ⚠️ 与原版的差异（已写进 TASKS B27）：原版脚手架的攀爬是"**往前走就往上爬**、松手停住"，
 * 这里复用的是梯子那套"跳跃上升 / 潜行下降 / 松手缓缓下滑"（物理侧目前只有一套攀爬实现）；
 * 原版"下方没有支撑就整体下落"也没做——改成**放置时就要求下方有支撑**
 * （不然会多出一套"方块自己下落"的机制，与本项目的"地物/摆放都是静态的"不一致）。
 */
export const SCAFFOLDING_ID = 471;

/**
 * 阳光传感器（`daylight_detector`，id 472）：**按天光强度输出红石信号**的电源。
 *
 * 它是本项目第一个"**强度可变**的电源"（拉杆/按钮/红石块都是 0 或 15）：
 * 输出 = 所在格的天光等级（0~15），反向模式 = 15 − 天光。
 * 强度**不写状态位**——每次重算时按天光现算（与红石粉强度同一个道理），
 * 状态位里只放"有没有输出"（渲染用）与"是不是反向模式"。
 *
 * ⚠️ 它需要一条新的世界能力：`RedstoneWorld.getSkyLight`（引擎本来只认方块与状态）。
 */
export const DAYLIGHT_DETECTOR_ID = 472;

/**
 * 绊线与绊线钩（批次 55）：一对**成对使用**的红石元件。
 *
 * 两根**朝向相对**的绊线钩 + 中间的若干格绊线 = 一条回路；任何实体踩到线上，
 * 两个钩子都会输出 15 级信号（这就是"矿车/生物踩到就开门"那套）。
 *
 * 三个关键点：
 *  - **绊线没有物品**（`itemless`）：原版是用**线**右键方块顶面放下来的，
 *    所以它的掉落也是 1 根线（见 `items.ts` 的掉落覆盖表）
 *  - **线的方向不写状态**：网格化时按邻居实时算（与栅栏同一套）
 *  - **剪断**（`disarmed`）：剪刀右键剪断之后线还在、还连着，但**不再触发**
 */
export const TRIPWIRE_ID = 473;
export const TRIPWIRE_HOOK_ID = 474;

/** 两个钩子之间最多隔多少格（原版 40） */
export const TRIPWIRE_MAX_LENGTH = 40;

const TRIPWIRE_SPECS: readonly BlockSpec[] = [
  {
    id: TRIPWIRE_ID,
    name: 'minecraft:tripwire',
    tiles: ['tripwire', 'tripwire', 'tripwire'],
    shape: 'tripwire',
    opaque: false,
    lightOpacity: 0,
    // 原版绊线**没有物品**：只能拿线右键方块顶面放下来（见 main 的交互）
    itemless: true,
  },
  {
    id: TRIPWIRE_HOOK_ID,
    name: 'minecraft:tripwire_hook',
    // 通电时换一张（原版钩子"拉起来"的样子，这里用颜色区分）
    tiles: ['tripwire_hook', 'tripwire_hook', 'tripwire_hook'],
    stateTiles: (state) =>
      isPowered(state)
        ? ['tripwire_hook_powered', 'tripwire_hook_powered', 'tripwire_hook_powered']
        : ['tripwire_hook', 'tripwire_hook', 'tripwire_hook'],
    shape: 'tripwire_hook',
    opaque: false,
    lightOpacity: 0,
  },
];

const DAYLIGHT_DETECTOR_SPECS: readonly BlockSpec[] = [
  {
    id: DAYLIGHT_DETECTOR_ID,
    name: 'minecraft:daylight_detector',
    // 反向模式换的是**顶面**那张（原版就是同一块板、顶面换个颜色）
    tiles: ['daylight_detector_top', 'daylight_detector_side', 'daylight_detector_side'],
    stateTiles: (state) =>
      isInverted(state)
        ? ['daylight_detector_inverted_top', 'daylight_detector_side', 'daylight_detector_side']
        : ['daylight_detector_top', 'daylight_detector_side', 'daylight_detector_side'],
    shape: 'daylight_detector',
    opaque: false,
    lightOpacity: 0,
  },
];

const SCAFFOLDING_SPECS: readonly BlockSpec[] = [
  {
    id: SCAFFOLDING_ID,
    name: 'minecraft:scaffolding',
    // 顶面是站人的木板、底面是木条、侧面是"带柱子的那一圈"
    tiles: ['scaffolding_top', 'scaffolding_bottom', 'scaffolding_side'],
    shape: 'scaffolding',
    opaque: false,
    lightOpacity: 0,
  },
];

const CAKE_AND_POT_SPECS: readonly BlockSpec[] = [
  {
    id: CAKE_ID,
    name: 'minecraft:cake',
    // 顶面奶油、底面蛋糕底、侧面那一圈（原版蛋糕就是这三张）
    tiles: ['cake_top', 'cake_bottom', 'cake_side'],
    shape: 'cake',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: FLOWER_POT_ID,
    name: 'minecraft:flower_pot',
    tiles: ['flower_pot_top', 'flower_pot', 'flower_pot'],
    shape: 'flower_pot',
    opaque: false,
    lightOpacity: 0,
  },
];

const CAMPFIRE_SPECS: readonly BlockSpec[] = [
  {
    id: CAMPFIRE_ID,
    name: 'minecraft:campfire',
    // 底面用原木的**横截面**（oak_log_top）：营火底下看到的就是木头的断面
    tiles: ['campfire_top', 'oak_log_top', 'campfire_side'],
    shape: 'campfire',
    opaque: false,
    lightOpacity: 0,
    // 点燃时**顶面**变成火焰（三座炉子亮的是侧面——营火是"敞口"的，火光从上面看最明显）
    stateTiles: (state) =>
      isLitState(state)
        ? ['campfire_fire', 'oak_log_top', 'campfire_side']
        : ['campfire_top', 'oak_log_top', 'campfire_side'],
    // 原版营火是 15 级光源（比炉子的 13 更亮：它是明火）
    stateLight: (state) => (isLitState(state) ? 15 : 0),
  },
];

const FURNACE_STATION_SPECS: readonly BlockSpec[] = [
  {
    id: SMOKER_ID,
    name: 'minecraft:smoker',
    tiles: ['smoker_top', 'smoker_top', 'smoker_side'],
    // 点燃时的火光贴图与发光（批次 47，与熔炉同一套）
    stateTiles: (state) => litTiles(state, 'smoker_top', 'smoker_side', 'smoker_front_on'),
    stateLight: (state) => (isLitState(state) ? 13 : 0),
  },
  {
    id: BLAST_FURNACE_ID,
    name: 'minecraft:blast_furnace',
    tiles: ['blast_furnace_top', 'blast_furnace_top', 'blast_furnace_side'],
    stateTiles: (state) => litTiles(state, 'blast_furnace_top', 'blast_furnace_side', 'blast_furnace_front_on'),
    stateLight: (state) => (isLitState(state) ? 13 : 0),
  },
];

const RED_SAND_SPECS: readonly BlockSpec[] = [
  { id: 411, name: 'minecraft:red_sand', tiles: ['red_sand', 'red_sand', 'red_sand'] },
  {
    id: 412,
    name: 'minecraft:red_sandstone',
    // 贴图顺序 [顶面, 底面, 侧面]：与普通砂岩同一套结构，只是换成红砂岩那三张
    tiles: ['red_sandstone_top', 'red_sandstone_top', 'red_sandstone'],
  },
  { id: 413, name: 'minecraft:chiseled_red_sandstone', tiles: ['chiseled_red_sandstone', 'red_sandstone', 'chiseled_red_sandstone'] },
  { id: 414, name: 'minecraft:cut_red_sandstone', tiles: ['cut_red_sandstone', 'red_sandstone', 'cut_red_sandstone'] },
  { id: 415, name: 'minecraft:smooth_red_sandstone', tiles: ['smooth_red_sandstone', 'smooth_red_sandstone', 'smooth_red_sandstone'] },
];

// ---------------------------------------------------------------- 石材家族的变体（批次 41）

/**
 * 石材家族的"台阶 / 楼梯 / 墙"补齐（B16 的 A 档批量）。
 *
 * 这一族最能体现"表驱动"的威力：**形状全部现成**（`slab` / `stairs` / `wall` 三种形状
 * 早在批次 30 之前就有了）、**贴图全部复用母方块**（`baseTiles(parent)`），
 * 所以新增一个变体只需要在下面这张表里加一个词——方块、贴图、硬度、工具、分类、
 * 中文名、配方七处会一起跟上（一处漏了都有断言兜着）。
 *
 * ⚠️ 为什么不用 `SHAPED_PARENTS` 那条现成的路：它的 slab/stairs id 区间（72~95）已经被
 * 12 个母方块排满，再加一个母方块就会撞到后面的栅栏/装饰 id（见那边的注释）。
 * 所以这一族**自己排一段 id**（351 起，追加式，不许往中间插）。
 *
 * ⚠️ 表里只列**原版确实有的**变体：原版对"錾制 / 裂纹"类不出变体，`cut_sandstone` 只有台阶、
 * `smooth_sandstone` 没有墙、`purpur` 没有墙、`stone` 没有墙。**多造一个方块比少造一个更难查**
 * （它看起来就是个正经方块），所以测试里专门有一条"这些变体不应该存在"。
 */
export const STONE_VARIANT_ID_START = 351;

/** 截至这里已经建好的全部规格段（按定义顺序）——下面 `tilesOfDefined` 用它查母方块贴图 */
const DEFINED_SPECS: readonly (readonly BlockSpec[])[] = [
  BASE_SPECS,
  WOOL_SPECS,
  WOOD_SPECS,
  WOOD_SHAPED_SPECS,
  COLORED_SPECS,
  GLASS_AND_STONE_SPECS,
  SHAPED_SPECS,
  FUNCTIONAL_SHAPED_SPECS,
  DECORATION_SPECS,
  PRISMARINE_SPECS,
  NETHER_SPECS,
  END_SPECS,
  REDSTONE_SPECS,
  OPENABLE_SPECS,
  FIRE_SPECS,
  PORTAL_SPECS,
  NETHERITE_SPECS,
  LILY_PAD_SPECS,
  CARPET_SPECS,
  SNOW_SPECS,
  // 红沙与红砂岩（批次 45）：红砂岩家族的变体要按 `tilesOfDefined(412)` 查母方块贴图，
  // 所以这一段必须在 `DEFINED_SPECS` 里（漏了会直接抛"找不到贴图"，这正是想要的效果）
  RED_SAND_SPECS,
  CHAIN_SPECS,
  VINE_SPECS,
  COPPER_SPECS,
  MORE_STONE_SPECS,
];

/**
 * 在**所有已经定义好的**规格段里找母方块的贴图。
 *
 * 石材变体表的母方块横跨三段（`GLASS_AND_STONE_SPECS` 的 160~167、
 * `NETHER_SPECS` 的 227/240、`END_SPECS` 的 247/248），所以不能只查 `BASE_SPECS`
 * ——那会静默回退成石头贴图（"苔石墙长得像石头墙"）。
 * 查不到直接抛错：注册期的错误就该在启动时炸。
 */
function tilesOfDefined(id: number): readonly [string, string, string] {
  for (const specs of DEFINED_SPECS) {
    const spec = specs.find((candidate) => candidate.id === id);
    if (spec?.tiles) return spec.tiles;
  }
  throw new Error(`tilesOfDefined: 找不到方块 ${id} 的贴图（石材变体表里的 id 写错了？）`);
}

export type StoneVariantKind = 'slab' | 'stairs' | 'wall';

/**
 * [母方块 id, 命名前缀, 原版有的变体, 显式起点?]。
 *
 * 母方块 id 这里只能写数字：本文件在 `Block` 枚举**之前**就要把这些方块拼进 `SPECS`。
 * 代价是数字可能打错——所以套件里有一条断言核对"id 对应的方块名 == 登记名"。
 *
 * **第 4 列（显式起点）只写在每一段的第一行**：写了它就把分配器的游标跳到那个 id，
 * 后面的家族继续往后排。批次 45 的红砂岩家族就是这么接在 416 上的
 * （不写的话会从 404 接着排，直接撞进写死的石英家族与切石机）。
 */
const STONE_VARIANT_FAMILIES: readonly (
  readonly [number, string, readonly StoneVariantKind[], number?]
)[] = [
  [13, 'granite', ['slab', 'stairs', 'wall']],
  [14, 'diorite', ['slab', 'stairs', 'wall']],
  [15, 'andesite', ['slab', 'stairs', 'wall']],
  [20, 'sandstone', ['wall']],
  [68, 'deepslate_bricks', ['wall']],
  [70, 'bricks', ['wall']],
  [71, 'polished_deepslate', ['wall']],
  [160, 'mossy_cobblestone', ['slab', 'stairs', 'wall']],
  [161, 'mossy_stone_bricks', ['slab', 'stairs', 'wall']],
  [164, 'cobbled_deepslate', ['slab', 'stairs', 'wall']],
  [166, 'cut_sandstone', ['slab']],
  [167, 'smooth_sandstone', ['slab', 'stairs']],
  [227, 'blackstone', ['slab', 'stairs', 'wall']],
  [240, 'nether_bricks', ['slab', 'stairs', 'wall']],
  [247, 'end_stone_bricks', ['slab', 'stairs', 'wall']],
  [248, 'purpur_block', ['slab', 'stairs']],
  // ---- 批次 42 追加（id 387 起）：石英家族、深板岩瓦、红色下界砖、海晶石三兄弟。
  // 石英只有台阶与楼梯（原版没有石英墙）；錾制石英块与石英柱没有任何变体。
  [404, 'quartz_block', ['slab', 'stairs']],
  [407, 'smooth_quartz', ['slab', 'stairs']],
  [408, 'deepslate_tiles', ['slab', 'stairs', 'wall']],
  [409, 'red_nether_bricks', ['slab', 'stairs', 'wall']],
  [218, 'prismarine', ['slab', 'stairs', 'wall']],
  [219, 'prismarine_bricks', ['slab', 'stairs']],
  [220, 'dark_prismarine', ['slab', 'stairs']],
  // ---- 批次 45 追加（id 416 起）：红砂岩家族（红沙长在恶地地表，原料链在这里闭合）。
  // 原版的变体分布与普通砂岩**完全一致**（砂岩那三行就在上面几行，可以对着看）：
  // 红砂岩三件套、切制只有台阶、平滑有台阶与楼梯、錾制没有变体。
  [412, 'red_sandstone', ['slab', 'stairs', 'wall'], RED_SANDSTONE_VARIANT_ID_START],
  [414, 'cut_red_sandstone', ['slab']],
  [415, 'smooth_red_sandstone', ['slab', 'stairs']],
];

const STONE_VARIANT_MAP = new Map<string, number>();

const STONE_VARIANT_SPECS: readonly BlockSpec[] = (() => {
  const specs: BlockSpec[] = [];
  let next = STONE_VARIANT_ID_START;
  for (const [parent, name, kinds, explicitStart] of STONE_VARIANT_FAMILIES) {
    // 显式起点：把游标跳到这一段该在的位置（批次 45 的红砂岩家族用它避开写死的母方块段）
    if (explicitStart !== undefined) next = explicitStart;
    // 母方块横跨好几段规格，所以查"全部已定义的段"而不是 `baseTiles`（它只认 BASE_SPECS）
    const tiles = tilesOfDefined(parent);
    for (const kind of kinds) {
      const id = next++;
      STONE_VARIANT_MAP.set(`${name}_${kind}`, id);
      // 三种变体都是非完整方块：不遮挡邻居、不挡光（与 `SHAPED_SPECS` 同一套写法）
      specs.push({ id, name: `minecraft:${name}_${kind}`, tiles, shape: kind, opaque: false, lightOpacity: 0 });
    }
  }
  return specs;
})();

/**
 * 母方块与它的变体（硬度表 / 工具表"跟随母方块"要用）。
 *
 * ⚠️ 这里**故意只暴露前 3 列**：显式起点是"分配 id"用的实现细节，
 * 下游（硬度 / 工具 / 配方 / 切石表）只关心"谁的变体有哪些"。
 */
export const STONE_VARIANT_PARENTS: readonly (readonly [number, string, readonly StoneVariantKind[]])[] =
  STONE_VARIANT_FAMILIES.map(([parent, name, kinds]) => [parent, name, kinds] as const);

/** 某个"母方块 + 变体"的 id；表里没有这个变体时返回 undefined */
export function stoneVariantId(parentName: string, kind: StoneVariantKind): number | undefined {
  return STONE_VARIANT_MAP.get(`${parentName}_${kind}`);
}

/** 全部石材变体的 id（套件、创造分类、配方批量遍历用） */
export const STONE_VARIANT_IDS: readonly number[] = [...STONE_VARIANT_MAP.values()];

const SPECS: readonly BlockSpec[] = [
  ...BASE_SPECS,
  ...WOOL_SPECS,
  ...WOOD_SPECS,
  ...COLORED_SPECS,
  ...GLASS_AND_STONE_SPECS,
  ...SHAPED_SPECS,
  ...FUNCTIONAL_SHAPED_SPECS,
  ...DECORATION_SPECS,
  ...PRISMARINE_SPECS,
  ...NETHER_SPECS,
  ...END_SPECS,
  ...REDSTONE_SPECS,
  ...OPENABLE_SPECS,
  ...FIRE_SPECS,
  ...PORTAL_SPECS,
  ...NETHERITE_SPECS,
  ...LILY_PAD_SPECS,
  ...CARPET_SPECS,
  ...SNOW_SPECS,
  ...WOOD_SHAPED_SPECS,
  ...CHAIN_SPECS,
  ...VINE_SPECS,
  ...COPPER_SPECS,
  ...MORE_STONE_SPECS,
  ...STONE_VARIANT_SPECS,
  ...STONECUTTER_SPECS,
  ...RED_SAND_SPECS,
  ...FURNACE_STATION_SPECS,
  ...CAMPFIRE_SPECS,
  ...BEETROOT_SPECS,
  ...BERRY_AND_COCOA_SPECS,
  ...KELP_SPECS,
  ...CORAL_SPECS,
  ...CAKE_AND_POT_SPECS,
  ...SCAFFOLDING_SPECS,
  ...DAYLIGHT_DETECTOR_SPECS,
  ...TRIPWIRE_SPECS,
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
  /** 原色陶瓦（恶地地表用），id 与 TERRACOTTA_ID_START 同源 */
  TERRACOTTA: TERRACOTTA_ID_START,
  MOSSY_COBBLESTONE: 160,
  MOSSY_STONE_BRICKS: 161,
  CRACKED_STONE_BRICKS: 162,
  CRACKED_DEEPSLATE_BRICKS: 163,
  COBBLED_DEEPSLATE: 164,
  CHISELED_SANDSTONE: 165,
  CUT_SANDSTONE: 166,
  SMOOTH_SANDSTONE: 167,
  OAK_DOOR: 99,
  TORCH: 100,
  LADDER: 101,
  /** 大矿脉的伴生稀有方块 */
  RAW_COPPER_BLOCK: 201,
  RAW_IRON_BLOCK: 202,

  // ---- 自然装饰（地物）
  SHORT_GRASS: 203,
  FERN: 204,
  DANDELION: 205,
  POPPY: 206,
  BLUE_ORCHID: 207,
  OXEYE_DAISY: 208,
  CORNFLOWER: 209,
  RED_MUSHROOM: 210,
  BROWN_MUSHROOM: 211,
  SUGAR_CANE: 212,
  PUMPKIN: 213,
  MELON: 214,
  CACTUS: 215,
  DEAD_BUSH: 216,
  BAMBOO: 217,

  // ---- 海晶石家族
  PRISMARINE: 218,
  PRISMARINE_BRICKS: 219,
  DARK_PRISMARINE: 220,
  SEA_LANTERN: 221,

  // ---- 下界
  NETHERRACK: 222,
  SOUL_SAND: 223,
  SOUL_SOIL: 224,
  BASALT: 225,
  SMOOTH_BASALT: 226,
  BLACKSTONE: 227,
  MAGMA_BLOCK: 228,
  CRIMSON_NYLIUM: 229,
  WARPED_NYLIUM: 230,
  CRIMSON_STEM: 231,
  WARPED_STEM: 232,
  CRIMSON_PLANKS: 233,
  WARPED_PLANKS: 234,
  CRIMSON_FUNGUS: 235,
  WARPED_FUNGUS: 236,
  NETHER_WART_BLOCK: 237,
  WARPED_WART_BLOCK: 238,
  SHROOMLIGHT: 239,
  NETHER_BRICKS: 240,
  NETHER_QUARTZ_ORE: 241,
  ANCIENT_DEBRIS: 242,
  CRIMSON_ROOTS: 243,
  WARPED_ROOTS: 244,
  NETHER_SPROUTS: 245,

  // ---- 末地
  END_STONE: 246,
  END_STONE_BRICKS: 247,
  PURPUR_BLOCK: 248,
  PURPUR_PILLAR: 249,
  CHORUS_PLANT: 250,
  CHORUS_FLOWER: 251,
  END_ROD: 252,
  DRAGON_EGG: 253,
  END_PORTAL_FRAME: 254,
  END_PORTAL: 255,

  // ---- 红石
  REDSTONE_WIRE: 256,
  REDSTONE_TORCH: 257,
  REDSTONE_BLOCK: 258,
  LEVER: 259,
  STONE_BUTTON: 260,
  OAK_BUTTON: 261,
  STONE_PRESSURE_PLATE: 262,
  OAK_PRESSURE_PLATE: 263,
  REPEATER: 264,
  COMPARATOR: 265,
  REDSTONE_LAMP: 266,
  PISTON: 267,
  PISTON_HEAD: 268,
  STICKY_PISTON: 269,
  OBSERVER: 270,
  ENCHANTING_TABLE: 271,
  BOOKSHELF: 272,
  ANVIL: 273,
  IRON_BLOCK: 274,
  FARMLAND: 275,
  WHEAT_STAGE0: 276,
  WHEAT_STAGE1: 277,
  WHEAT_STAGE2: 278,
  WHEAT_STAGE3: 279,
  CARROTS_STAGE0: 280,
  CARROTS_STAGE1: 281,
  CARROTS_STAGE2: 282,
  CARROTS_STAGE3: 283,
  POTATOES_STAGE0: 284,
  POTATOES_STAGE1: 285,
  POTATOES_STAGE2: 286,
  POTATOES_STAGE3: 287,
  BREWING_STAND: 288,
  /** 活板门与栅栏门（批次 30）：id 接在最大 id 之后，SPECS 会按 id 排序 */
  OAK_TRAPDOOR: 289,
  OAK_FENCE_GATE: 290,
  /** 火焰（I12）：没有物品，只能靠打火石点燃 */
  FIRE: 291,
  /** 下界传送门（K8）：黑曜石框点燃后填满框内的那 2×3 格 */
  NETHER_PORTAL: 292,
  /** 下界合金（K8 尾巴）：储物方块与锻造台 */
  NETHERITE_BLOCK: 293,
  SMITHING_TABLE: 294,
  /** 锁链（B11）：3/16 粗的细柱，可攀爬；悬挂式告示牌以后会挂在它上面 */
  CHAIN: 333,
  /** 藤蔓（B11）：可攀爬、能蔓延，一个方块能同时挂 5 面 */
  VINE: 334,
  // ---- 铜的氧化（批次 40）：四档 × 四种形状，顺序即氧化顺序（见 COPPER_STAGES）
  COPPER_BLOCK: 335,
  CUT_COPPER: 336,
  CUT_COPPER_SLAB: 337,
  CUT_COPPER_STAIRS: 338,
  EXPOSED_COPPER_BLOCK: 339,
  EXPOSED_CUT_COPPER: 340,
  EXPOSED_CUT_COPPER_SLAB: 341,
  EXPOSED_CUT_COPPER_STAIRS: 342,
  WEATHERED_COPPER_BLOCK: 343,
  WEATHERED_CUT_COPPER: 344,
  WEATHERED_CUT_COPPER_SLAB: 345,
  WEATHERED_CUT_COPPER_STAIRS: 346,
  OXIDIZED_COPPER_BLOCK: 347,
  OXIDIZED_CUT_COPPER: 348,
  OXIDIZED_CUT_COPPER_SLAB: 349,
  OXIDIZED_CUT_COPPER_STAIRS: 350,
  // ---- 石英与更多石材的母方块（批次 42，见 `MORE_STONE_ID_START`）
  QUARTZ_BLOCK: 404,
  CHISELED_QUARTZ_BLOCK: 405,
  QUARTZ_PILLAR: 406,
  SMOOTH_QUARTZ: 407,
  DEEPSLATE_TILES: 408,
  RED_NETHER_BRICKS: 409,
  /** 睡莲（B16）：水面上的平铺叶片，id 接在最大 id 之后 */
  LILY_PAD: 295,
  /** 雪层（B11）：层数在状态里（1~8 层），id 单独一个 */
  SNOW: SNOW_LAYER_ID,
  /** 切石机（H11）：整块方块，没有状态；右键打开"一进多选"的界面 */
  STONECUTTER: STONECUTTER_ID,
  // ---- 红沙与红砂岩（批次 45，见 `RED_SAND_ID_START`）
  RED_SAND: 411,
  RED_SANDSTONE: 412,
  CHISELED_RED_SANDSTONE: 413,
  CUT_RED_SANDSTONE: 414,
  SMOOTH_RED_SANDSTONE: 415,
  // ---- 熔炉的两个变体（批次 46，见 `SMOKER_ID` / `BLAST_FURNACE_ID`）
  SMOKER: SMOKER_ID,
  BLAST_FURNACE: BLAST_FURNACE_ID,
  /** 营火（批次 47）：不要燃料、一次烤 4 个、只烤食物、烤好直接弹出来 */
  CAMPFIRE: CAMPFIRE_ID,
  // ---- 甜菜（批次 48，B17 的第四种作物）
  BEETROOTS_STAGE0: 425,
  BEETROOTS_STAGE1: 426,
  BEETROOTS_STAGE2: 427,
  BEETROOTS_STAGE3: 428,
  // ---- 甜浆果丛与可可豆（批次 49）
  SWEET_BERRY_BUSH_STAGE0: SWEET_BERRY_BUSH_ID_START,
  SWEET_BERRY_BUSH_STAGE1: 430,
  SWEET_BERRY_BUSH_STAGE2: 431,
  SWEET_BERRY_BUSH_STAGE3: 432,
  COCOA_STAGE0: COCOA_ID_START,
  COCOA_STAGE1: 434,
  COCOA_STAGE2: 435,
  // ---- 海带与海草（批次 50，见 `KELP_SPECS`）：方块本身**替换掉那一格水**
  KELP: KELP_ID,
  SEAGRASS: SEAGRASS_ID,
  DRIED_KELP_BLOCK: DRIED_KELP_BLOCK_ID,
  // ---- 珊瑚（批次 51，见 `CORAL_SPECS`）：每个常量是那一族的**第一个**（管珊瑚），
  // 其余四种用 `+ i` 取（i = 0..4，顺序见 `CORAL_KINDS`）
  CORAL_BLOCK: CORAL_BLOCK_ID_START,
  DEAD_CORAL_BLOCK: DEAD_CORAL_BLOCK_ID_START,
  CORAL: CORAL_ID_START,
  DEAD_CORAL: DEAD_CORAL_ID_START,
  CORAL_FAN: CORAL_FAN_ID_START,
  DEAD_CORAL_FAN: DEAD_CORAL_FAN_ID_START,
  // ---- 蛋糕与花盆（批次 52，见 `CAKE_AND_POT_SPECS`）
  CAKE: CAKE_ID,
  FLOWER_POT: FLOWER_POT_ID,
  // ---- 脚手架（批次 53，见 `SCAFFOLDING_SPECS`）
  SCAFFOLDING: SCAFFOLDING_ID,
  // ---- 阳光传感器（批次 54，见 `DAYLIGHT_DETECTOR_SPECS`）
  DAYLIGHT_DETECTOR: DAYLIGHT_DETECTOR_ID,
  // ---- 绊线与绊线钩（批次 55，见 `TRIPWIRE_SPECS`）
  TRIPWIRE: TRIPWIRE_ID,
  TRIPWIRE_HOOK: TRIPWIRE_HOOK_ID,
} as const;

/** 花盆里能种的一株植物：物品（种进去时手里拿的）+ 贴图（渲染用）+ 中文名 */
export interface PottedPlant {
  readonly itemId: number;
  readonly tile: string;
  readonly name: string;
}

/**
 * 花盆能种的植物表（**顺序就是状态里的索引**，只能往后追加、不能插队）。
 *
 * ⚠️ 索引会写进存档与联机消息里：中间插一项会让老存档里"种着第 3 种"的花盆
 * 突然变成另一种植物（玩家只会觉得"我的花被换了"）。所以新植物一律**追加到表尾**。
 *
 * 这一批与原版花盆能放的那批对齐：两种草、五朵花、两种蘑菇、枯木、仙人掌、竹子、
 * 甜浆果丛，以及**五色珊瑚扇**（原版 1.13 起花盆也能放珊瑚扇——正好给水族箱用）。
 * 树苗不在内（我们还没有树苗物品，见 TASKS B17）。
 */
export const POTTED_PLANTS: readonly PottedPlant[] = [
  { itemId: Block.SHORT_GRASS, tile: 'short_grass', name: '矮草' },
  { itemId: Block.FERN, tile: 'fern', name: '蕨' },
  { itemId: Block.DANDELION, tile: 'dandelion', name: '蒲公英' },
  { itemId: Block.POPPY, tile: 'poppy', name: '虞美人' },
  { itemId: Block.BLUE_ORCHID, tile: 'blue_orchid', name: '兰花' },
  { itemId: Block.OXEYE_DAISY, tile: 'oxeye_daisy', name: '雏菊' },
  { itemId: Block.CORNFLOWER, tile: 'cornflower', name: '矢车菊' },
  { itemId: Block.RED_MUSHROOM, tile: 'red_mushroom', name: '红蘑菇' },
  { itemId: Block.BROWN_MUSHROOM, tile: 'brown_mushroom', name: '棕蘑菇' },
  { itemId: Block.DEAD_BUSH, tile: 'dead_bush', name: '枯木' },
  { itemId: Block.CACTUS, tile: 'cactus_side', name: '仙人掌' },
  { itemId: Block.BAMBOO, tile: 'bamboo', name: '竹子' },
  // 甜浆果丛的代表阶段（成熟那一个）：4 个 id 里挑一个最像"一丛"的
  { itemId: Block.SWEET_BERRY_BUSH_STAGE3, tile: 'sweet_berry_bush_stage3', name: '甜浆果丛' },
  ...CORAL_KINDS.map((kind, i) => ({
    itemId: CORAL_FAN_ID_START + i,
    tile: `${kind}_coral_fan`,
    name: `${CORAL_KIND_CN[kind]}珊瑚扇`,
  })),
];

/**
 * 花盆里的植物该用哪张贴图（0 = 空盆 → null）。
 * 渲染层（`ChunkMesher`）只认这一张表，不自己列第二份植物名单。
 */
export function pottedPlantTile(plant: number): string | null {
  return POTTED_PLANTS[plant - 1]?.tile ?? null;
}

/** 这个物品能不能种进花盆（返回要写进状态的索引；不能种返回 0） */
export function flowerPotIndexFor(itemId: number): number {
  const index = POTTED_PLANTS.findIndex((entry) => entry.itemId === itemId);
  return index < 0 ? 0 : index + 1;
}

/** 空手取出一株植物时该给回什么物品 */
export function pottedPlantItem(plant: number): number | undefined {
  return POTTED_PLANTS[plant - 1]?.itemId;
}

/** 花盆里的植物叫什么（提示框与聊天用） */
export function pottedPlantName(plant: number): string {
  return POTTED_PLANTS[plant - 1]?.name ?? '空盆';
}

/** 第 index 种颜色的羊毛方块 id（顺序与 DYE_COLORS 一致） */
export function woolId(colorIndex: number): number {
  return WOOL_ID_START + colorIndex;
}

/** 第 index 种颜色的地毯方块 id（顺序与 DYE_COLORS 一致） */
export function carpetId(colorIndex: number): number {
  return CARPET_ID_START + colorIndex;
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
      stateTiles: spec.stateTiles,
      stateLight: spec.stateLight,
      itemless: spec.itemless ?? false,
      waterPlant: spec.waterPlant ?? false,
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

/**
 * 按状态取贴图。绝大多数方块与状态无关；红石灯这类需要按状态换贴图的走 stateTiles。
 * 网格化器统一走这个入口，于是"新增一个会变色的方块"不需要改网格化器。
 */
export function blockTiles(id: number, state: number): readonly [string, string, string] {
  const def = BLOCKS[id] ?? BLOCKS[0]!;
  return def.stateTiles ? def.stateTiles(state) : def.tiles;
}

/** 按状态取发光等级（红石灯亮时为 15） */
export function emitLightWithState(id: number, state: number): number {
  const def = BLOCKS[id] ?? BLOCKS[0]!;
  return def.stateLight ? def.stateLight(state) : def.light;
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
  // 红沙与沙子同档 0.5（原版如此；挖起来与沙子一模一样）
  [Block.RED_SAND, 0.5],
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
  // 烟熏炉 3.5、高炉 3.5（原版三者同档，都要镐）
  [Block.SMOKER, 3.5],
  [Block.BLAST_FURNACE, 3.5],
  // 营火 2（原版）：斧最快，徒手也能采
  [Block.CAMPFIRE, 2],
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

// 地毯：比羊毛薄得多，原版硬度 0.1（一拍就掉）；雪层同样是 0.1
for (let i = 0; i < DYE_COLORS.length; i++) HARDNESS.set(carpetId(i), 0.1);
HARDNESS.set(Block.SNOW, 0.1);

// 台阶 / 楼梯的硬度跟随母方块（原版行为）
for (let index = 0; index < SHAPED_PARENTS.length; index++) {
  const parentId = SHAPED_PARENTS[index]![0];
  const hardness = HARDNESS.get(parentId) ?? 1.5;
  HARDNESS.set(slabId(index), hardness);
  HARDNESS.set(stairsId(index), hardness);
}

// 石材家族的变体（批次 41）：硬度同样**跟随母方块**——但这一条必须写在
// **全部母方块硬度登记完之后**（见文件末尾那一处，写在前面会拿到"还没登记 → 回退 1.5"）

HARDNESS.set(Block.OAK_FENCE, 2);
HARDNESS.set(Block.COBBLESTONE_WALL, 2);
HARDNESS.set(Block.STONE_BRICK_WALL, 1.5);
HARDNESS.set(Block.OAK_DOOR, 3);
// 活板门 3（与门同档）、栅栏门 2（与栅栏同档）——都是木头，原版如此
HARDNESS.set(Block.OAK_TRAPDOOR, 3);
HARDNESS.set(Block.OAK_FENCE_GATE, 2);

// 木制方块族（批次 38）：其余 5 种木材的栅栏/栅栏门/门/活板门与橡木同档
// （栅栏门与栅栏 2、活板门与门 3）——按族批量登记，不逐个手抄
for (const ids of Object.values(WoodShaped)) {
  HARDNESS.set(ids.fence, 2);
  HARDNESS.set(ids.fenceGate, 2);
  HARDNESS.set(ids.door, 3);
  HARDNESS.set(ids.trapdoor, 3);
}
HARDNESS.set(Block.TORCH, 0);
HARDNESS.set(Block.LADDER, 0.4);
// 锁链 5（原版，必须用镐）；藤蔓 0.2（原版，徒手一拍就掉，但只有剪刀/精准采集会掉下来）
HARDNESS.set(Block.CHAIN, 5);
HARDNESS.set(Block.VINE, 0.2);
// 甜浆果丛与可可豆（批次 49）：原版都是"一碰就掉"（甜浆果丛 0、可可果 0.2）
HARDNESS.set(Block.SWEET_BERRY_BUSH_STAGE0, 0);
HARDNESS.set(Block.SWEET_BERRY_BUSH_STAGE1, 0);
HARDNESS.set(Block.SWEET_BERRY_BUSH_STAGE2, 0);
HARDNESS.set(Block.SWEET_BERRY_BUSH_STAGE3, 0);
HARDNESS.set(Block.COCOA_STAGE0, 0.2);
HARDNESS.set(Block.COCOA_STAGE1, 0.2);
HARDNESS.set(Block.COCOA_STAGE2, 0.2);
// 海带与海草（批次 50）：都是"一碰就掉"（硬度 0）；干海带块 0.5（原版，徒手可拆）
HARDNESS.set(Block.KELP, 0);
HARDNESS.set(Block.SEAGRASS, 0);
HARDNESS.set(Block.DRIED_KELP_BLOCK, 0.5);
// 珊瑚（批次 51）：珊瑚块 1.5（原版，与石砖同档），珊瑚丛/珊瑚扇 0（一碰就掉）
for (const start of [CORAL_BLOCK_ID_START, DEAD_CORAL_BLOCK_ID_START]) {
  for (let i = 0; i < CORAL_KINDS.length; i++) HARDNESS.set(start + i, 1.5);
}
for (const start of [CORAL_ID_START, DEAD_CORAL_ID_START, CORAL_FAN_ID_START, DEAD_CORAL_FAN_ID_START]) {
  for (let i = 0; i < CORAL_KINDS.length; i++) HARDNESS.set(start + i, 0);
}
// 蛋糕与花盆（批次 52）：蛋糕 0.5（原版，徒手拆得动）、花盆 0（一碰就掉）
HARDNESS.set(Block.CAKE, 0.5);
HARDNESS.set(Block.FLOWER_POT, 0);
// 脚手架（批次 53）：0（原版一碰就掉——所以搭高之后拆底下一节会哗啦一下全掉）
HARDNESS.set(Block.SCAFFOLDING, 0);
// 阳光传感器（批次 54）：0.2（原版）
HARDNESS.set(Block.DAYLIGHT_DETECTOR, 0.2);
// 绊线与绊线钩（批次 55）：都是 0（原版一碰就掉）
HARDNESS.set(Block.TRIPWIRE, 0);
HARDNESS.set(Block.TRIPWIRE_HOOK, 0);
// 铜的四档 × 四种形状：硬度 3（原版铜块就是 3.0，台阶与楼梯同档）
for (let stage = 0; stage < COPPER_STAGES.length; stage++) {
  for (let kind = 0; kind < 4; kind++) HARDNESS.set(copperId(stage, kind as 0 | 1 | 2 | 3), 3);
}
// 附魔台 5（必须钻石镐）、书架 1.5（斧更快，徒手也能采）
HARDNESS.set(Block.FARMLAND, 0.6);
HARDNESS.set(Block.BREWING_STAND, 0.5);
// 火焰硬度 0：徒手一拍即灭（`breakSeconds` 直接返回 0，不做任何计时）
HARDNESS.set(Block.FIRE, 0);
// 下界传送门硬度 -1：**挖不动**（`breakSeconds` 返回 Infinity）。
// 原版就是这样——想熄门只能敲框，敲一下门就整片灭掉（见 `NetherPortal.ts`）
HARDNESS.set(Block.NETHER_PORTAL, -1);
HARDNESS.set(Block.ENCHANTING_TABLE, 5);
HARDNESS.set(Block.BOOKSHELF, 1.5);
// 铁砧 5（原版 5.0，也砸得动）
HARDNESS.set(Block.ANVIL, 5);
// 铁块 5（原版），必须用镐
HARDNESS.set(Block.IRON_BLOCK, 5);
// 下界合金块 50（原版 50，比黑曜石还硬；必须钻石镐以上）
HARDNESS.set(Block.NETHERITE_BLOCK, 50);
// 锻造台 2.5（原版），斧最快、徒手也能采
HARDNESS.set(Block.SMITHING_TABLE, 2.5);
// 切石机 3.5（原版与石头同档），要镐
HARDNESS.set(Block.STONECUTTER, 3.5);

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

// 石材补全与砂岩变体（批次 41 顺手把这里的**魔法数字**换成了 `Block` 常量，
// 并把 cobbled_deepslate 的硬度从 3 修成原版的 3.5——变体的硬度由它推出来，
// 母方块错一档，五个变体会跟着一起错）
HARDNESS.set(Block.MOSSY_COBBLESTONE, 2);
HARDNESS.set(Block.MOSSY_STONE_BRICKS, 1.5);
HARDNESS.set(Block.CRACKED_STONE_BRICKS, 1.5);
HARDNESS.set(Block.CRACKED_DEEPSLATE_BRICKS, 3.5);
HARDNESS.set(Block.COBBLED_DEEPSLATE, 3.5);
HARDNESS.set(Block.CHISELED_SANDSTONE, 0.8);
HARDNESS.set(Block.CUT_SANDSTONE, 0.8);
HARDNESS.set(Block.SMOOTH_SANDSTONE, 0.8);

// 红砂岩家族（批次 45）：与砂岩家族同档 0.8（原版两个家族是一套数值）
HARDNESS.set(Block.RED_SANDSTONE, 0.8);
HARDNESS.set(Block.CHISELED_RED_SANDSTONE, 0.8);
HARDNESS.set(Block.CUT_RED_SANDSTONE, 0.8);
HARDNESS.set(Block.SMOOTH_RED_SANDSTONE, 0.8);
// 末地建材（此前没登记，一律落到默认的 3；紫珀实际是 1.5）
HARDNESS.set(Block.END_STONE, 3);
HARDNESS.set(Block.END_STONE_BRICKS, 3);
HARDNESS.set(Block.PURPUR_BLOCK, 1.5);
HARDNESS.set(Block.PURPUR_PILLAR, 1.5);
// 石英家族 0.8（原版）、深板岩瓦 3.5（与深板岩砖同档）、红色下界砖 2（与下界砖同档）
HARDNESS.set(Block.QUARTZ_BLOCK, 0.8);
HARDNESS.set(Block.CHISELED_QUARTZ_BLOCK, 0.8);
HARDNESS.set(Block.QUARTZ_PILLAR, 0.8);
HARDNESS.set(Block.SMOOTH_QUARTZ, 0.8);
HARDNESS.set(Block.DEEPSLATE_TILES, 3.5);
HARDNESS.set(Block.RED_NETHER_BRICKS, 2);

// 粗金属块：硬度 5（原版），必须用镐
HARDNESS.set(Block.RAW_COPPER_BLOCK, 5);
HARDNESS.set(Block.RAW_IRON_BLOCK, 5);

// 玻璃与玻璃板：0.3，徒手可采集（徒手可采集表在下面统一维护）
HARDNESS.set(GLASS_PANE_ID, 0.3);
for (let i = 0; i < DYE_COLORS.length; i++) {
  HARDNESS.set(stainedGlassId(i), 0.3);
  HARDNESS.set(stainedGlassPaneId(i), 0.3);
}

// 自然装饰：植物一律"一碰就掉"（硬度 0），南瓜/西瓜/仙人掌按原版
for (const plant of [
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
  Block.DEAD_BUSH,
  Block.BAMBOO,
  Block.CRIMSON_FUNGUS,
  Block.WARPED_FUNGUS,
  Block.CRIMSON_ROOTS,
  Block.WARPED_ROOTS,
  Block.NETHER_SPROUTS,
  // 睡莲也是"一碰就掉"（原版硬度 0）
  Block.LILY_PAD,
]) {
  HARDNESS.set(plant, 0);
}
HARDNESS.set(Block.PUMPKIN, 1);
HARDNESS.set(Block.MELON, 1);
HARDNESS.set(Block.CACTUS, 0.4);

// 海晶石家族（原版都需要镐）
HARDNESS.set(Block.PRISMARINE, 1.5);
HARDNESS.set(Block.PRISMARINE_BRICKS, 1.5);
HARDNESS.set(Block.DARK_PRISMARINE, 1.5);
HARDNESS.set(Block.SEA_LANTERN, 0.3);

// 下界方块
HARDNESS.set(Block.NETHERRACK, 0.4);
HARDNESS.set(Block.SOUL_SAND, 0.5);
HARDNESS.set(Block.SOUL_SOIL, 0.5);
HARDNESS.set(Block.BASALT, 1.25);
HARDNESS.set(Block.SMOOTH_BASALT, 1.25);
HARDNESS.set(Block.BLACKSTONE, 1.5);
HARDNESS.set(Block.MAGMA_BLOCK, 0.5);
HARDNESS.set(Block.CRIMSON_NYLIUM, 0.4);
HARDNESS.set(Block.WARPED_NYLIUM, 0.4);
HARDNESS.set(Block.CRIMSON_STEM, 2);
HARDNESS.set(Block.WARPED_STEM, 2);
HARDNESS.set(Block.CRIMSON_PLANKS, 2);
HARDNESS.set(Block.WARPED_PLANKS, 2);
HARDNESS.set(Block.NETHER_WART_BLOCK, 1);
HARDNESS.set(Block.WARPED_WART_BLOCK, 1);
HARDNESS.set(Block.SHROOMLIGHT, 1);
HARDNESS.set(Block.NETHER_BRICKS, 2);
HARDNESS.set(Block.NETHER_QUARTZ_ORE, 3);
HARDNESS.set(Block.ANCIENT_DEBRIS, 30);

// 石材家族的变体（批次 41）：硬度**跟随母方块**（花岗岩台阶 = 花岗岩 = 1.5、
// 苔石墙 = 苔石 = 2、深板岩圆石楼梯 = 3.5）。
//
// ⚠️ 这一条必须放在**所有母方块的硬度都登记完之后**：它读的是 `HARDNESS.get(parent)`，
// 而 160~167 / 227 / 240 / 247 / 248 这些母方块是在本文件后半段才登记的
// （踩过一次：循环写早了，变体全部拿到 `undefined → 1.5`，于是"苔石墙比苔石软"）。
// 正确性由 `tools/stone-variant-test.ts` 的"硬度 = 母方块"逐条断言兜住。
for (const [parentId, name, kinds] of STONE_VARIANT_PARENTS) {
  const hardness = HARDNESS.get(parentId) ?? 1.5;
  for (const kind of kinds) HARDNESS.set(stoneVariantId(name, kind)!, hardness);
}

/** 徒手就能采集的方块（决定挖掘耗时用哪条公式，对齐原版） */
const HAND_HARVESTABLE = new Set<number>([
  Block.DIRT,
  Block.GRASS_BLOCK,
  Block.SAND,
  // 红沙（批次 45）：与沙子同一条——徒手就能挖、拿锹更快（不放进需求表）
  Block.RED_SAND,
  Block.GRAVEL,
  Block.CLAY,
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
  // 营火（批次 47）：徒手就能拆（斧只是更快）
  Block.CAMPFIRE,
]);

// 羊毛徒手即可采集（石材家族一律需要镐，不加入此表）
for (let i = 0; i < DYE_COLORS.length; i++) HAND_HARVESTABLE.add(woolId(i));

// 地毯与雪层也是徒手就能采（原版地毯随手一抓、雪层用手也能撸掉，锹只是加速）
for (let i = 0; i < DYE_COLORS.length; i++) HAND_HARVESTABLE.add(carpetId(i));
HAND_HARVESTABLE.add(Block.SNOW);

// 台阶 / 楼梯的"徒手可采集"跟随母方块；木质与火把梯子一律徒手可采
for (let index = 0; index < SHAPED_PARENTS.length; index++) {
  if (!HAND_HARVESTABLE.has(SHAPED_PARENTS[index]![0])) continue;
  HAND_HARVESTABLE.add(slabId(index));
  HAND_HARVESTABLE.add(stairsId(index));
}
HAND_HARVESTABLE.add(Block.OAK_FENCE);
HAND_HARVESTABLE.add(Block.OAK_DOOR);
HAND_HARVESTABLE.add(Block.OAK_TRAPDOOR);
HAND_HARVESTABLE.add(Block.OAK_FENCE_GATE);

// 木制方块族（批次 38）：其余 5 种木材的四件也徒手可采（斧只是加速，见 tools.ts）
for (const ids of Object.values(WoodShaped)) {
  HAND_HARVESTABLE.add(ids.fence);
  HAND_HARVESTABLE.add(ids.fenceGate);
  HAND_HARVESTABLE.add(ids.door);
  HAND_HARVESTABLE.add(ids.trapdoor);
}

// 藤蔓（B11）：徒手能打掉（什么都不掉），剪刀才是"采下来"的工具——见 items.ts 的掉落表。
// 锁链不在这里：它**必须用镐**，登记在 tools.ts 的 REQUIRED_TOOL 里。
HAND_HARVESTABLE.add(Block.VINE);
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

/**
 * 自然装饰与下界方块里徒手可采集的部分。
 * 海晶石家族、黑石、下界砖、石英矿、远古残骸都需要镐（原版），故意不加入。
 */
for (const id of [
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
  Block.DEAD_BUSH,
  Block.BAMBOO,
  // 睡莲徒手就能采（原版不需要任何工具）
  Block.LILY_PAD,
  Block.PUMPKIN,
  Block.MELON,
  Block.CACTUS,
  Block.NETHERRACK,
  Block.SOUL_SAND,
  Block.SOUL_SOIL,
  Block.MAGMA_BLOCK,
  Block.CRIMSON_NYLIUM,
  Block.WARPED_NYLIUM,
  Block.CRIMSON_STEM,
  Block.WARPED_STEM,
  Block.CRIMSON_PLANKS,
  Block.WARPED_PLANKS,
  Block.CRIMSON_FUNGUS,
  Block.WARPED_FUNGUS,
  Block.CRIMSON_ROOTS,
  Block.WARPED_ROOTS,
  Block.NETHER_SPROUTS,
  Block.NETHER_WART_BLOCK,
  Block.WARPED_WART_BLOCK,
  Block.SHROOMLIGHT,
]) {
  HAND_HARVESTABLE.add(id);
}

// 书架徒手也能采（原版如此）；附魔台要镐，所以**不进**这张表
HAND_HARVESTABLE.add(Block.BOOKSHELF);
HAND_HARVESTABLE.add(Block.FARMLAND);
for (let stage = 0; stage < 4; stage++) HAND_HARVESTABLE.add(Block.WHEAT_STAGE0 + stage);
for (let stage = 0; stage < 4; stage++) {
  HAND_HARVESTABLE.add(Block.CARROTS_STAGE0 + stage);
  HAND_HARVESTABLE.add(Block.POTATOES_STAGE0 + stage);
  HAND_HARVESTABLE.add(Block.BEETROOTS_STAGE0 + stage);
  // 甜浆果丛（批次 49）：徒手就能采（原版也是，它连工具都不认）
  HAND_HARVESTABLE.add(Block.SWEET_BERRY_BUSH_STAGE0 + stage);
}
// 可可豆（批次 49）：徒手可采
for (let stage = 0; stage < 3; stage++) HAND_HARVESTABLE.add(Block.COCOA_STAGE0 + stage);
// 海带与海草（批次 50）：徒手都能拔（海草徒手拔下来**什么都不掉**——
// 那条规则在掉落表里（`SHEARS_ONLY`），不在这里；这里只管"挖得动"）
HAND_HARVESTABLE.add(Block.KELP);
HAND_HARVESTABLE.add(Block.SEAGRASS);
HAND_HARVESTABLE.add(Block.DRIED_KELP_BLOCK);
// 珊瑚（批次 51）：**珊瑚块不在这里**（要镐，登记在 `tools.ts` 的 REQUIRED_TOOL 里），
// 珊瑚丛与珊瑚扇是"一碰就掉"的植物（徒手可采，与花草同档）
for (const start of [CORAL_ID_START, DEAD_CORAL_ID_START, CORAL_FAN_ID_START, DEAD_CORAL_FAN_ID_START]) {
  for (let i = 0; i < CORAL_KINDS.length; i++) HAND_HARVESTABLE.add(start + i);
}
// 蛋糕与花盆（批次 52）：徒手都能拆（原版都不需要工具）
HAND_HARVESTABLE.add(Block.CAKE);
HAND_HARVESTABLE.add(Block.FLOWER_POT);
// 脚手架（批次 53）：徒手可采（原版不需要工具）
HAND_HARVESTABLE.add(Block.SCAFFOLDING);
// 阳光传感器（批次 54）：徒手可采（原版斧头更快，但不要求工具）
HAND_HARVESTABLE.add(Block.DAYLIGHT_DETECTOR);
// 绊线与绊线钩（批次 55）：徒手可采
HAND_HARVESTABLE.add(Block.TRIPWIRE);
HAND_HARVESTABLE.add(Block.TRIPWIRE_HOOK);

/**
 * 作物的生长阶段表（按顺序）。
 *
 * 作物生长就是"把当前阶段换成下一个 id"，所以这几张表是唯一的事实来源。
 * 三种作物共用同一套生长行为，只是 id 区间与掉落不同（见 `cropOf`）。
 */
export const CROP_STAGES: Readonly<Record<string, readonly number[]>> = {
  wheat: [Block.WHEAT_STAGE0, Block.WHEAT_STAGE1, Block.WHEAT_STAGE2, Block.WHEAT_STAGE3],
  carrots: [Block.CARROTS_STAGE0, Block.CARROTS_STAGE1, Block.CARROTS_STAGE2, Block.CARROTS_STAGE3],
  potatoes: [Block.POTATOES_STAGE0, Block.POTATOES_STAGE1, Block.POTATOES_STAGE2, Block.POTATOES_STAGE3],
  beetroots: [Block.BEETROOTS_STAGE0, Block.BEETROOTS_STAGE1, Block.BEETROOTS_STAGE2, Block.BEETROOTS_STAGE3],
};

/**
 * 甜浆果丛与可可豆的生长阶段表（批次 49）。
 *
 * 它们**不进 `CROP_STAGES`**：那张表是"种在耕地上的作物"，
 * `cropOf` / `growCrop` / `extraCropDrop` 三处都假设"下面是耕地、收获给种子"。
 * 甜浆果丛长在草上、可可豆挂在原木上，判定与掉落都不一样，各自一张表更清楚。
 */
export const BERRY_STAGES: readonly number[] = [
  Block.SWEET_BERRY_BUSH_STAGE0,
  Block.SWEET_BERRY_BUSH_STAGE1,
  Block.SWEET_BERRY_BUSH_STAGE2,
  Block.SWEET_BERRY_BUSH_STAGE3,
];
export const COCOA_STAGES: readonly number[] = [Block.COCOA_STAGE0, Block.COCOA_STAGE1, Block.COCOA_STAGE2];

/** 这个 id 是甜浆果丛的第几阶段（不是则 -1） */
export function berryStageOf(id: number): number {
  return BERRY_STAGES.indexOf(id);
}

/** 这个 id 是可可豆的第几阶段（不是则 -1） */
export function cocoaStageOf(id: number): number {
  return COCOA_STAGES.indexOf(id);
}

/** 丛林原木的 id（可可豆只能挂在它上面；丛林树与巨型丛林树共用同一种原木） */
export const JUNGLE_LOG_ID: number = Wood.jungle!.log;

/** 小麦的阶段表（保留这个名字：调用点很多，而且它是最常用的一张） */
export const WHEAT_STAGES: readonly number[] = CROP_STAGES.wheat!;

export interface CropAt {
  readonly crop: string;
  /** 第几个阶段（0 起） */
  readonly stage: number;
  /** 是不是最后一阶段（成熟） */
  readonly ripe: boolean;
}

/** 这个 id 属于哪种作物的哪个阶段；不是作物返回 null */
export function cropOf(id: number): CropAt | null {
  for (const [crop, stages] of Object.entries(CROP_STAGES)) {
    const stage = stages.indexOf(id);
    if (stage >= 0) return { crop, stage, ripe: stage === stages.length - 1 };
  }
  return null;
}

/** 这个 id 是小麦的某个阶段吗（不是则 -1） */
export function wheatStageOf(id: number): number {
  return WHEAT_STAGES.indexOf(id);
}

export function blockHardness(id: number): number {
  return HARDNESS.get(id) ?? 3;
}

export function isHandHarvestable(id: number): boolean {
  return HAND_HARVESTABLE.has(id);
}

/**
 * 这一格能不能攀爬（B11）：梯子 / 藤蔓 / 锁链。
 *
 * 锁链可攀爬是**基岩版**特性（本项目复刻的正是基岩版；Java 版不行）。
 * 按**形状**判定而不是列方块 id：加一种木材、以后加铁梯子都自动跟上——
 * 这正是"同族方块的行为一律按形状判定"那条经验（批次 38 踩过）。
 */
export function isClimbableBlock(id: number): boolean {
  const shape = blockDef(id).shape;
  // 脚手架（批次 53）：原版能顺着它往上爬——加一个形状，攀爬就自动跟上了
  return shape === 'ladder' || shape === 'vine' || shape === 'chain' || shape === 'scaffolding';
}

// 注：破坏耗时的计算在 `tools.ts` 的 `breakSeconds`（需要工具的等级与速度），
// 这里只提供硬度与「徒手可采集」这两份原始数据。

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
