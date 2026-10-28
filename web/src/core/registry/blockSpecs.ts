/**
 * 方块表的**数据**（批次 20261025-1032）
 *
 * 这张表（724 个方块、四千多行）是"核心且恒定"的那部分数据，也是复制者最想拿的东西。
 * 搬出来之后，"这个文件放哪"就决定了形态：
 *   · 随 APK 走（`core.bin`，宿主注入）→ 浏览器打不开游戏；
 *   · 放静态服务器 → 完整前端，浏览器照常玩。
 *
 * **依赖方向是单向的**：`blockIds.ts`（叶子） → 本文件 → `blocks.ts`。
 * 本文件只 import 纯数据/纯类型模块，**绝不 import `blocks.ts`**——否则就是环，
 * 而"环 + 顶层 await / 静态循环初始化"在打包器下会静默死锁（前三轮踩过两次）。
 *
 * 生产构建会把本文件换成一个 `export const SPECS = []` 的桩（`宿主9`），
 * 那时 724 个方块的明文根本不进产物，表由 `core/hostCore.ts` 从 `core.bin` 装进来。
 */


import type {
  BlockSpec,
} from './blockIds.ts';
import {
  ACTIVATOR_RAIL_ID,
  ARMOR_STAND_ID,
  BANNER_ID_START,
  BARREL_ID,
  BEACON_ID,
  BED_ID_MAP,
  BELL_ID,
  BLAST_FURNACE_ID,
  CAKE_ID,
  CAMPFIRE_ID,
  CARPET_ID_START,
  CARTOGRAPHY_TABLE_ID,
  CAULDRON_ID,
  CAVE_VINES_ID,
  CHISELED_POLISHED_BLACKSTONE_ID,
  COMMAND_BLOCK_ID,
  COMPOSTER_ID,
  CONCRETE_ID_START,
  CONCRETE_POWDER_ID_START,
  CONDUIT_ID,
  COPPER_SHAPES,
  COPPER_STAGES,
  CORAL_BLOCK_ID_START,
  CORAL_FAN_ID_START,
  CORAL_ID_START,
  CORAL_KINDS,
  CRACKED_POLISHED_BLACKSTONE_BRICKS_ID,
  DAYLIGHT_DETECTOR_ID,
  DEAD_CORAL_BLOCK_ID_START,
  DEAD_CORAL_FAN_ID_START,
  DEAD_CORAL_ID_START,
  DETECTOR_RAIL_ID,
  DIAMOND_BLOCK_ID,
  DISPENSER_ID,
  DRIED_KELP_BLOCK_ID,
  DROPPER_ID,
  EMERALD_BLOCK_ID,
  ENDER_CHEST_ID,
  EXTRA_WOODS,
  FLETCHING_TABLE_ID,
  FLOWER_POT_ID,
  FROSTED_ICE_ID,
  GILDED_BLACKSTONE_ID,
  GLASS_PANE_ID,
  GOLD_BLOCK_ID,
  GRINDSTONE_ID,
  HEAVY_WEIGHTED_PRESSURE_PLATE_ID,
  HOPPER_ID,
  ITEM_FRAME_ID,
  JUKEBOX_ID,
  KELP_ID,
  LECTERN_ID,
  LIGHTNING_ROD_ID,
  LIGHT_WEIGHTED_PRESSURE_PLATE_ID,
  LODESTONE_ID,
  LOOM_ID,
  MELON_STEM_ATTACHED_ID,
  NETHER_WART_ID_START,
  NOTE_BLOCK_ID,
  PAINTING_ID,
  POLISHED_BLACKSTONE_BRICKS_ID,
  POLISHED_BLACKSTONE_ID,
  POWDER_SNOW_ID,
  POWERED_RAIL_ID,
  PUMPKIN_STEM_ATTACHED_ID,
  RAIL_ID,
  RESPAWN_ANCHOR_ID,
  SAPLING_ID_MAP,
  SCAFFOLDING_ID,
  SEAGRASS_ID,
  SHAPED_PARENTS,
  SHULKER_BOX_COLOR_START,
  SHULKER_BOX_ID,
  SIGN_ID_MAP,
  SLAB_ID_START,
  SLIME_BLOCK_ID,
  SMOKER_ID,
  SNOW_LAYER_ID,
  SOUL_FIRE_ID,
  SOUL_LANTERN_ID,
  SOUL_TORCH_ID,
  SPAWNER_ID,
  STAINED_GLASS_ID_START,
  STAINED_GLASS_PANE_ID_START,
  STAIRS_ID_START,
  STEM_STAGES,
  STONECUTTER_ID,
  STONE_VARIANT_FAMILIES,
  STONE_VARIANT_MAP,
  TARGET_ID,
  TERRACOTTA_ID_START,
  TNT_ID,
  TRIPWIRE_HOOK_ID,
  TRIPWIRE_ID,
  WITHER_SKELETON_SKULL_ID,
  WOOD_ID_MAP,
  WOOD_SHAPED_MAP,
  WOOL_ID_START,
  copperId,
} from './blockIds.ts';
import {
  DYE_COLORS,
  WOOD_TYPES,
} from './colors.ts';
import {
  paintingTile,
} from './paintings.ts';


const BASE_SPECS: readonly BlockSpec[] = [
  { id: 0, name: 'minicraft:air', tiles: ['', '', ''], solid: false, opaque: false },

  // ---- 基础建筑与地形方块
  { id: 1, name: 'minicraft:stone', tiles: ['stone', 'stone', 'stone'] },
  { id: 2, name: 'minicraft:dirt', tiles: ['dirt', 'dirt', 'dirt'] },
  { id: 3, name: 'minicraft:grass_block', tiles: ['grass_top', 'dirt', 'grass_side'] },
  { id: 4, name: 'minicraft:sand', tiles: ['sand', 'sand', 'sand'] },
  { id: 5, name: 'minicraft:oak_log', tiles: ['oak_log_top', 'oak_log_top', 'oak_log_side'] },
  // 树叶：不透明（渲染要剔除相邻面）但**不致窒息**，原版钻进树叶里不掉血
  { id: 6, name: 'minicraft:oak_leaves', tiles: ['oak_leaves', 'oak_leaves', 'oak_leaves'], lightOpacity: 1, suffocates: false },
  { id: 7, name: 'minicraft:oak_planks', tiles: ['oak_planks', 'oak_planks', 'oak_planks'] },
  { id: 8, name: 'minicraft:cobblestone', tiles: ['cobblestone', 'cobblestone', 'cobblestone'] },
  { id: 9, name: 'minicraft:bedrock', tiles: ['bedrock', 'bedrock', 'bedrock'] },

  // ---- 流体与透明方块
  {
    id: 10,
    name: 'minicraft:water',
    tiles: ['water', 'water', 'water'],
    solid: false,
    opaque: false,
    liquid: true,
    shape: 'fluid',
    translucent: true,
    lightOpacity: 1,
  },
  { id: 11, name: 'minicraft:glass', tiles: ['glass', 'glass', 'glass'], opaque: false, translucent: true, lightOpacity: 0 },

  // ---- 1.18 地下岩石
  { id: 12, name: 'minicraft:deepslate', tiles: ['deepslate', 'deepslate', 'deepslate'] },
  { id: 13, name: 'minicraft:granite', tiles: ['granite', 'granite', 'granite'] },
  { id: 14, name: 'minicraft:diorite', tiles: ['diorite', 'diorite', 'diorite'] },
  { id: 15, name: 'minicraft:andesite', tiles: ['andesite', 'andesite', 'andesite'] },
  { id: 16, name: 'minicraft:tuff', tiles: ['tuff', 'tuff', 'tuff'] },
  // 干草块（批次 437）：六个面同一张贴图（原版只有顶面/侧面之分，这里不细分）
  { id: 667, name: 'minicraft:hay_block', tiles: ['hay_block', 'hay_block', 'hay_block'] },
  // 六面树皮的木头（批次 438）：复用原木侧面的贴图，不新画
  { id: 668, name: 'minicraft:oak_wood', tiles: ['oak_log_side', 'oak_log_side', 'oak_log_side'] },
  { id: 669, name: 'minicraft:spruce_wood', tiles: ['spruce_log_side', 'spruce_log_side', 'spruce_log_side'] },
  { id: 670, name: 'minicraft:birch_wood', tiles: ['birch_log_side', 'birch_log_side', 'birch_log_side'] },
  { id: 671, name: 'minicraft:jungle_wood', tiles: ['jungle_log_side', 'jungle_log_side', 'jungle_log_side'] },
  { id: 672, name: 'minicraft:acacia_wood', tiles: ['acacia_log_side', 'acacia_log_side', 'acacia_log_side'] },
  { id: 673, name: 'minicraft:dark_oak_wood', tiles: ['dark_oak_log_side', 'dark_oak_log_side', 'dark_oak_log_side'] },
  // 磨制玄武岩 / 蓝冰（批次 439）：复用已有贴图（玄武岩侧面、浮冰），不新画
  { id: 674, name: 'minicraft:polished_basalt', tiles: ['basalt_side', 'basalt_side', 'basalt_side'] },
  { id: 675, name: 'minicraft:blue_ice', tiles: ['packed_ice', 'packed_ice', 'packed_ice'] },
  // 蜜脾块（批次 440）：纯装饰方块，没有行为
  { id: 676, name: 'minicraft:honeycomb_block', tiles: ['honeycomb_block', 'honeycomb_block', 'honeycomb_block'] },
  // 蛛网（批次 441）：能穿过、会减速；渲染用一张带透明感的贴图
  { id: 677, name: 'minicraft:cobweb', tiles: ['cobweb', 'cobweb', 'cobweb'], solid: false, opaque: false, lightOpacity: 0 },
  // 剥皮原木（批次 443）：颜色比原木浅一档，贴图由 TextureAtlas 现画
  { id: 678, name: 'minicraft:stripped_oak_log', tiles: ['stripped_oak_log', 'stripped_oak_log', 'stripped_oak_log'] },
  { id: 679, name: 'minicraft:stripped_spruce_log', tiles: ['stripped_spruce_log', 'stripped_spruce_log', 'stripped_spruce_log'] },
  { id: 680, name: 'minicraft:stripped_birch_log', tiles: ['stripped_birch_log', 'stripped_birch_log', 'stripped_birch_log'] },
  { id: 681, name: 'minicraft:stripped_jungle_log', tiles: ['stripped_jungle_log', 'stripped_jungle_log', 'stripped_jungle_log'] },
  { id: 682, name: 'minicraft:stripped_acacia_log', tiles: ['stripped_acacia_log', 'stripped_acacia_log', 'stripped_acacia_log'] },
  { id: 683, name: 'minicraft:stripped_dark_oak_log', tiles: ['stripped_dark_oak_log', 'stripped_dark_oak_log', 'stripped_dark_oak_log'] },
  // 其余五种木材的按钮 / 压力板（批次 444）：贴图复用同种木板，形状与橡木那两个一致
  { id: 684, name: 'minicraft:spruce_button', tiles: ['spruce_planks', 'spruce_planks', 'spruce_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 685, name: 'minicraft:birch_button', tiles: ['birch_planks', 'birch_planks', 'birch_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 686, name: 'minicraft:jungle_button', tiles: ['jungle_planks', 'jungle_planks', 'jungle_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 687, name: 'minicraft:acacia_button', tiles: ['acacia_planks', 'acacia_planks', 'acacia_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 688, name: 'minicraft:dark_oak_button', tiles: ['dark_oak_planks', 'dark_oak_planks', 'dark_oak_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 689, name: 'minicraft:spruce_pressure_plate', tiles: ['spruce_planks', 'spruce_planks', 'spruce_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 690, name: 'minicraft:birch_pressure_plate', tiles: ['birch_planks', 'birch_planks', 'birch_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 691, name: 'minicraft:jungle_pressure_plate', tiles: ['jungle_planks', 'jungle_planks', 'jungle_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 692, name: 'minicraft:acacia_pressure_plate', tiles: ['acacia_planks', 'acacia_planks', 'acacia_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 693, name: 'minicraft:dark_oak_pressure_plate', tiles: ['dark_oak_planks', 'dark_oak_planks', 'dark_oak_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  // 海绵 / 湿海绵（批次 449）：干海绵放下去吸水（半径 3、最多 65 格，见 `world/Sponge.ts`），
  // 吸饱了变成湿海绵；湿海绵在熔炉里烤干才会变回来（原版就是这么一条闭环）
  { id: 694, name: 'minicraft:sponge', tiles: ['sponge', 'sponge', 'sponge'] },
  { id: 695, name: 'minicraft:wet_sponge', tiles: ['wet_sponge', 'wet_sponge', 'wet_sponge'] },
  // 蜂蜜块（批次 450）：站在上面**跳不起来**、贴着侧面下滑被限速、摔上去只受 20% 伤害。
  // 原版还有"被活塞推动时粘走相邻方块"——本项目没有"活塞推方块实体"那条路，记在差异里
  { id: 696, name: 'minicraft:honey_block', tiles: ['honey_block', 'honey_block', 'honey_block'] },

  { id: 17, name: 'minicraft:calcite', tiles: ['calcite', 'calcite', 'calcite'] },
  { id: 18, name: 'minicraft:gravel', tiles: ['gravel', 'gravel', 'gravel'] },
  { id: 19, name: 'minicraft:clay', tiles: ['clay', 'clay', 'clay'] },
  { id: 20, name: 'minicraft:sandstone', tiles: ['sandstone_top', 'sandstone_top', 'sandstone'] },

  // ---- 寒冷群系
  { id: 21, name: 'minicraft:snow_block', tiles: ['snow', 'snow', 'snow'] },
  { id: 22, name: 'minicraft:ice', tiles: ['ice', 'ice', 'ice'], opaque: false, translucent: true, lightOpacity: 1 },
  {
    id: 23,
    name: 'minicraft:packed_ice',
    tiles: ['packed_ice', 'packed_ice', 'packed_ice'],
    opaque: false,
    translucent: true,
    lightOpacity: 2,
  },

  // ---- 特殊
  { id: 24, name: 'minicraft:obsidian', tiles: ['obsidian', 'obsidian', 'obsidian'] },
  {
    id: 25,
    name: 'minicraft:lava',
    tiles: ['lava', 'lava', 'lava'],
    solid: false,
    opaque: false,
    liquid: true,
    shape: 'fluid',
    light: 15,
    lightOpacity: 1,
  },
  { id: 26, name: 'minicraft:glowstone', tiles: ['glowstone', 'glowstone', 'glowstone'], light: 15 },

  // ---- 主世界矿石（1.18 共 8 种主世界矿石 + 深层变体）
  { id: 27, name: 'minicraft:coal_ore', tiles: ['coal_ore', 'coal_ore', 'coal_ore'] },
  { id: 28, name: 'minicraft:iron_ore', tiles: ['iron_ore', 'iron_ore', 'iron_ore'] },
  { id: 29, name: 'minicraft:copper_ore', tiles: ['copper_ore', 'copper_ore', 'copper_ore'] },
  { id: 30, name: 'minicraft:gold_ore', tiles: ['gold_ore', 'gold_ore', 'gold_ore'] },
  {
    id: 31,
    name: 'minicraft:redstone_ore',
    tiles: ['redstone_ore', 'redstone_ore', 'redstone_ore'],
    // 踩上去会亮（批次 248）：原版是"被打扰时发光 9 级"，状态位与红石灯同一条 `powered`
  },
  { id: 32, name: 'minicraft:lapis_ore', tiles: ['lapis_ore', 'lapis_ore', 'lapis_ore'] },
  { id: 33, name: 'minicraft:diamond_ore', tiles: ['diamond_ore', 'diamond_ore', 'diamond_ore'] },
  { id: 34, name: 'minicraft:emerald_ore', tiles: ['emerald_ore', 'emerald_ore', 'emerald_ore'] },
  { id: 35, name: 'minicraft:deepslate_coal_ore', tiles: ['deepslate_coal_ore', 'deepslate_coal_ore', 'deepslate_coal_ore'] },
  { id: 36, name: 'minicraft:deepslate_iron_ore', tiles: ['deepslate_iron_ore', 'deepslate_iron_ore', 'deepslate_iron_ore'] },
  {
    id: 37,
    name: 'minicraft:deepslate_copper_ore',
    tiles: ['deepslate_copper_ore', 'deepslate_copper_ore', 'deepslate_copper_ore'],
  },
  { id: 38, name: 'minicraft:deepslate_gold_ore', tiles: ['deepslate_gold_ore', 'deepslate_gold_ore', 'deepslate_gold_ore'] },
  {
    id: 39,
    name: 'minicraft:deepslate_redstone_ore',
    tiles: ['deepslate_redstone_ore', 'deepslate_redstone_ore', 'deepslate_redstone_ore'],
  },
  { id: 40, name: 'minicraft:deepslate_lapis_ore', tiles: ['deepslate_lapis_ore', 'deepslate_lapis_ore', 'deepslate_lapis_ore'] },
  {
    id: 41,
    name: 'minicraft:deepslate_diamond_ore',
    tiles: ['deepslate_diamond_ore', 'deepslate_diamond_ore', 'deepslate_diamond_ore'],
  },
  {
    id: 42,
    name: 'minicraft:deepslate_emerald_ore',
    tiles: ['deepslate_emerald_ore', 'deepslate_emerald_ore', 'deepslate_emerald_ore'],
  },

  // ---- 功能方块
  { id: 43, name: 'minicraft:crafting_table', tiles: ['crafting_table_top', 'oak_planks', 'crafting_table_side'] },
  {
    id: 44,
    name: 'minicraft:furnace',
    tiles: ['furnace_top', 'furnace_top', 'furnace_side'],
    // 正面（批次 64，O10 的第一步）：未点 = 炉口黑洞、点着 = 有火光，**只亮正面**。
    // 在此之前四个侧面会一起亮（那时立方体只有一个"侧面"贴图槽），
    // 现在靠面级贴图 + `facing` 状态区分正反面（放置时正脸朝你）。
    facesPlayer: true,
  },
  { id: 45, name: 'minicraft:chest', tiles: ['chest_top', 'chest_top', 'chest_side'] },
  /**
   * 陷阱箱（批次 249）：外观与箱子同款（红锁扣区分），**打开时向相邻红石输出 15**。
   *
   * 它没有额外的状态位：开箱/关箱由主程序写 `powered` 位（与拉杆同一个口径），
   * 红石引擎把它当电源读。容器本身与箱子共用 `getOrCreateChest`（按坐标存）。
   */
  { id: 585, name: 'minicraft:trapped_chest', tiles: ['trapped_chest_top', 'trapped_chest_top', 'trapped_chest_side'] },

  // ---- 石材家族
  { id: 62, name: 'minicraft:stone_bricks', tiles: ['stone_bricks', 'stone_bricks', 'stone_bricks'] },
  { id: 63, name: 'minicraft:chiseled_stone_bricks', tiles: ['chiseled_stone_bricks', 'chiseled_stone_bricks', 'chiseled_stone_bricks'] },
  { id: 64, name: 'minicraft:smooth_stone', tiles: ['smooth_stone', 'smooth_stone', 'smooth_stone'] },
  { id: 65, name: 'minicraft:polished_granite', tiles: ['polished_granite', 'polished_granite', 'polished_granite'] },
  { id: 66, name: 'minicraft:polished_diorite', tiles: ['polished_diorite', 'polished_diorite', 'polished_diorite'] },
  { id: 67, name: 'minicraft:polished_andesite', tiles: ['polished_andesite', 'polished_andesite', 'polished_andesite'] },
  { id: 68, name: 'minicraft:deepslate_bricks', tiles: ['deepslate_bricks', 'deepslate_bricks', 'deepslate_bricks'] },
  { id: 69, name: 'minicraft:chiseled_deepslate', tiles: ['chiseled_deepslate', 'chiseled_deepslate', 'chiseled_deepslate'] },
  { id: 70, name: 'minicraft:bricks', tiles: ['bricks', 'bricks', 'bricks'] },
  { id: 71, name: 'minicraft:polished_deepslate', tiles: ['polished_deepslate', 'polished_deepslate', 'polished_deepslate'] },
];
const WOOL_SPECS: readonly BlockSpec[] = DYE_COLORS.map((color, index) => ({
  id: WOOL_ID_START + index,
  name: `minicraft:${color.name}_wool`,
  tiles: [`wool_${color.name}`, `wool_${color.name}`, `wool_${color.name}`],
}));
const WOOD_SPECS: readonly BlockSpec[] = EXTRA_WOODS.flatMap((wood) => {
  const ids = WOOD_ID_MAP.get(wood.name)!;

  const plankTile = `${wood.name}_planks`;
  return [
    {
      id: ids.log,
      name: `minicraft:${wood.name}_log`,
      tiles: [`${wood.name}_log_top`, `${wood.name}_log_top`, `${wood.name}_log_side`],
    },
    { id: ids.planks, name: `minicraft:${wood.name}_planks`, tiles: [plankTile, plankTile, plankTile] },
    {
      id: ids.leaves,
      name: `minicraft:${wood.name}_leaves`,
      tiles: [`${wood.name}_leaves`, `${wood.name}_leaves`, `${wood.name}_leaves`],
      lightOpacity: 1,
      // 与橡树树叶同一条：不透明但**不致窒息**
      suffocates: false,
    },
    {
      id: ids.slab,
      name: `minicraft:${wood.name}_planks_slab`,
      tiles: [plankTile, plankTile, plankTile],
      shape: 'slab' as const,
      opaque: false,
      lightOpacity: 0,
    },
    {
      id: ids.stairs,
      name: `minicraft:${wood.name}_planks_stairs`,
      tiles: [plankTile, plankTile, plankTile],
      shape: 'stairs' as const,
      opaque: false,
      lightOpacity: 0,
    },
  ];
});
const WOOD_SHAPED_SPECS: readonly BlockSpec[] = (() => {
  const specs: BlockSpec[] = [];
  for (const wood of WOOD_TYPES) {
    const ids = WOOD_SHAPED_MAP.get(wood.name)!;
    if (wood.name === 'oak') continue;

    const plankTile = `${wood.name}_planks`;
    const gateTile = `${wood.name}_fence_gate`;
    const doorTile = `${wood.name}_door`;
    const trapdoorTile = `${wood.name}_trapdoor`;
    specs.push(
      {
        id: ids.fence,
        name: `minicraft:${wood.name}_fence`,
        tiles: [plankTile, plankTile, plankTile],
        shape: 'fence',
        opaque: false,
        lightOpacity: 0,
      },
      {
        id: ids.fenceGate,
        name: `minicraft:${wood.name}_fence_gate`,
        tiles: [gateTile, gateTile, gateTile],
        shape: 'fence_gate',
        opaque: false,
        lightOpacity: 0,
      },
      {
        id: ids.door,
        name: `minicraft:${wood.name}_door`,
        tiles: [doorTile, doorTile, doorTile],
        shape: 'door',
        opaque: false,
        lightOpacity: 0,
      },
      {
        id: ids.trapdoor,
        name: `minicraft:${wood.name}_trapdoor`,
        tiles: [trapdoorTile, trapdoorTile, trapdoorTile],
        shape: 'trapdoor',
        opaque: false,
        lightOpacity: 0,
      },
    );
  }
  return specs;
})();
/**
 * 陶瓦与混凝土：都是 16 色 + 陶瓦多一个原色。
 * 陶瓦偏土、有颗粒感；混凝土是纯色 + 极细的杂点，两者观感差异明显。
 */
const COLORED_SPECS: readonly BlockSpec[] = [
  {
    id: TERRACOTTA_ID_START,
    name: 'minicraft:terracotta',
    tiles: ['terracotta', 'terracotta', 'terracotta'],
  },
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: TERRACOTTA_ID_START + 1 + index,
      name: `minicraft:${color.name}_terracotta`,
      tiles: [`terracotta_${color.name}`, `terracotta_${color.name}`, `terracotta_${color.name}`],
    }),
  ),
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: CONCRETE_ID_START + index,
      name: `minicraft:${color.name}_concrete`,
      tiles: [`concrete_${color.name}`, `concrete_${color.name}`, `concrete_${color.name}`],
    }),
  ),
  // 混凝土**粉末**（批次 131）：16 色，挨到水就凝固成上面那种混凝土（见 `world/Concrete.ts`）。
  // 它的贴图是"沙砾感的粉"，与混凝土那种纯色一眼分得开——原版也是这样区分这两兄弟的
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: CONCRETE_POWDER_ID_START + index,
      name: `minicraft:${color.name}_concrete_powder`,
      tiles: [
        `concrete_powder_${color.name}`,
        `concrete_powder_${color.name}`,
        `concrete_powder_${color.name}`,
      ],
    }),
  ),
];
const GLASS_AND_STONE_SPECS: readonly BlockSpec[] = [
  // ---- 石材补全（苔石 / 裂纹变体）
  { id: 160, name: 'minicraft:mossy_cobblestone', tiles: ['mossy_cobblestone', 'mossy_cobblestone', 'mossy_cobblestone'] },
  { id: 161, name: 'minicraft:mossy_stone_bricks', tiles: ['mossy_stone_bricks', 'mossy_stone_bricks', 'mossy_stone_bricks'] },
  { id: 162, name: 'minicraft:cracked_stone_bricks', tiles: ['cracked_stone_bricks', 'cracked_stone_bricks', 'cracked_stone_bricks'] },
  { id: 163, name: 'minicraft:cracked_deepslate_bricks', tiles: ['cracked_deepslate_bricks', 'cracked_deepslate_bricks', 'cracked_deepslate_bricks'] },
  { id: 164, name: 'minicraft:cobbled_deepslate', tiles: ['cobbled_deepslate', 'cobbled_deepslate', 'cobbled_deepslate'] },

  // ---- 砂岩变体
  { id: 165, name: 'minicraft:chiseled_sandstone', tiles: ['chiseled_sandstone', 'sandstone', 'chiseled_sandstone'] },
  { id: 166, name: 'minicraft:cut_sandstone', tiles: ['cut_sandstone', 'sandstone', 'cut_sandstone'] },
  { id: 167, name: 'minicraft:smooth_sandstone', tiles: ['smooth_sandstone', 'smooth_sandstone', 'smooth_sandstone'] },

  // ---- 染色玻璃（半透明整块）+ 玻璃板（薄片，连接方向由邻居实时决定）
  { id: GLASS_PANE_ID, name: 'minicraft:glass_pane', tiles: ['glass', 'glass', 'glass'], shape: 'pane' as const, opaque: false, translucent: true },
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: STAINED_GLASS_ID_START + index,
      name: `minicraft:${color.name}_stained_glass`,
      tiles: [`stained_glass_${color.name}`, `stained_glass_${color.name}`, `stained_glass_${color.name}`],
      opaque: false,
      translucent: true,
    }),
  ),
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: STAINED_GLASS_PANE_ID_START + index,
      name: `minicraft:${color.name}_stained_glass_pane`,
      tiles: [`stained_glass_${color.name}`, `stained_glass_${color.name}`, `stained_glass_${color.name}`],
      shape: 'pane' as const,
      opaque: false,
      translucent: true,
    }),
  ),

  // ---- 粗金属块（1.18 大矿脉里的稀有伴生方块）
  { id: 201, name: 'minicraft:raw_copper_block', tiles: ['raw_copper_block', 'raw_copper_block', 'raw_copper_block'] },
  { id: 202, name: 'minicraft:raw_iron_block', tiles: ['raw_iron_block', 'raw_iron_block', 'raw_iron_block'] },
];
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
      name: `minicraft:${name}_slab`,
      tiles,
      shape: 'slab' as const,
      opaque: false,
      lightOpacity: 0,
    },
    {
      id: STAIRS_ID_START + index,
      name: `minicraft:${name}_stairs`,
      tiles,
      shape: 'stairs' as const,
      opaque: false,
      lightOpacity: 0,
    },
  ];
});
const FUNCTIONAL_SHAPED_SPECS: readonly BlockSpec[] = [
  {
    id: 96,
    name: 'minicraft:oak_fence',
    tiles: baseTiles(7),
    shape: 'fence',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 97,
    name: 'minicraft:cobblestone_wall',
    tiles: baseTiles(8),
    shape: 'wall',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 98,
    name: 'minicraft:stone_brick_wall',
    tiles: baseTiles(62),
    shape: 'wall',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 99,
    name: 'minicraft:oak_door',
    tiles: ['oak_door', 'oak_door', 'oak_door'],
    shape: 'door',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 100,
    name: 'minicraft:torch',
    tiles: ['torch', 'torch', 'torch'],
    shape: 'torch',
    solid: false,
    opaque: false,
    light: 14,
    lightOpacity: 0,
  },
  {
    id: 101,
    name: 'minicraft:ladder',
    tiles: ['ladder', 'ladder', 'ladder'],
    shape: 'ladder',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];
/**
 * 植物方块。
 * @param id 方块 id
 * @param name 名称（不含命名空间）
 * @param tile 贴图名（三面同一个）
 */
function plantSpec(id: number, name: string, tile: string): BlockSpec {
  return {
    id,
    name: `minicraft:${name}`,
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
    name: 'minicraft:pumpkin',
    tiles: ['pumpkin_top', 'pumpkin_top', 'pumpkin_side'],
  },
  {
    id: 214,
    name: 'minicraft:melon',
    tiles: ['melon_top', 'melon_top', 'melon_side'],
  },
  {
    id: 215,
    name: 'minicraft:cactus',
    tiles: ['cactus_top', 'cactus_top', 'cactus_side'],
    opaque: false,
    lightOpacity: 0,
    shape: 'cactus' as const,
  },
];
/** 海晶石家族（海底神殿用） */
const PRISMARINE_SPECS: readonly BlockSpec[] = [
  { id: 218, name: 'minicraft:prismarine', tiles: ['prismarine', 'prismarine', 'prismarine'] },
  { id: 219, name: 'minicraft:prismarine_bricks', tiles: ['prismarine_bricks', 'prismarine_bricks', 'prismarine_bricks'] },
  { id: 220, name: 'minicraft:dark_prismarine', tiles: ['dark_prismarine', 'dark_prismarine', 'dark_prismarine'] },
  {
    id: 221,
    name: 'minicraft:sea_lantern',
    tiles: ['sea_lantern', 'sea_lantern', 'sea_lantern'],
    light: 15,
  },
];
const NETHER_SPECS: readonly BlockSpec[] = [
  { id: 222, name: 'minicraft:netherrack', tiles: ['netherrack', 'netherrack', 'netherrack'] },
  { id: 223, name: 'minicraft:soul_sand', tiles: ['soul_sand', 'soul_sand', 'soul_sand'] },
  { id: 224, name: 'minicraft:soul_soil', tiles: ['soul_soil', 'soul_soil', 'soul_soil'] },
  { id: 225, name: 'minicraft:basalt', tiles: ['basalt_top', 'basalt_top', 'basalt_side'] },
  { id: 226, name: 'minicraft:smooth_basalt', tiles: ['smooth_basalt', 'smooth_basalt', 'smooth_basalt'] },
  { id: 227, name: 'minicraft:blackstone', tiles: ['blackstone', 'blackstone', 'blackstone'] },
  {
    id: 228,
    name: 'minicraft:magma_block',
    tiles: ['magma', 'magma', 'magma'],
    light: 3,
  },
  { id: 229, name: 'minicraft:crimson_nylium', tiles: ['crimson_nylium', 'netherrack', 'crimson_nylium_side'] },
  { id: 230, name: 'minicraft:warped_nylium', tiles: ['warped_nylium', 'netherrack', 'warped_nylium_side'] },
  { id: 231, name: 'minicraft:crimson_stem', tiles: ['crimson_stem_top', 'crimson_stem_top', 'crimson_stem_side'] },
  { id: 232, name: 'minicraft:warped_stem', tiles: ['warped_stem_top', 'warped_stem_top', 'warped_stem_side'] },
  { id: 233, name: 'minicraft:crimson_planks', tiles: ['crimson_planks', 'crimson_planks', 'crimson_planks'] },
  { id: 234, name: 'minicraft:warped_planks', tiles: ['warped_planks', 'warped_planks', 'warped_planks'] },
  plantSpec(235, 'crimson_fungus', 'crimson_fungus'),
  plantSpec(236, 'warped_fungus', 'warped_fungus'),
  { id: 237, name: 'minicraft:nether_wart_block', tiles: ['nether_wart_block', 'nether_wart_block', 'nether_wart_block'] },
  {
    id: 238,
    name: 'minicraft:warped_wart_block',
    tiles: ['warped_wart_block', 'warped_wart_block', 'warped_wart_block'],
  },
  {
    id: 239,
    name: 'minicraft:shroomlight',
    tiles: ['shroomlight', 'shroomlight', 'shroomlight'],
    light: 15,
  },
  { id: 240, name: 'minicraft:nether_bricks', tiles: ['nether_bricks', 'nether_bricks', 'nether_bricks'] },
  {
    id: 241,
    name: 'minicraft:nether_quartz_ore',
    tiles: ['nether_quartz_ore', 'nether_quartz_ore', 'nether_quartz_ore'],
  },
  { id: 242, name: 'minicraft:ancient_debris', tiles: ['ancient_debris', 'ancient_debris', 'ancient_debris'] },
  plantSpec(243, 'crimson_roots', 'crimson_roots'),
  plantSpec(244, 'warped_roots', 'warped_roots'),
  plantSpec(245, 'nether_sprouts', 'nether_sprouts'),
];
const END_SPECS: readonly BlockSpec[] = [
  { id: 246, name: 'minicraft:end_stone', tiles: ['end_stone', 'end_stone', 'end_stone'] },
  { id: 247, name: 'minicraft:end_stone_bricks', tiles: ['end_stone_bricks', 'end_stone_bricks', 'end_stone_bricks'] },
  { id: 248, name: 'minicraft:purpur_block', tiles: ['purpur_block', 'purpur_block', 'purpur_block'] },
  {
    id: 249,
    name: 'minicraft:purpur_pillar',
    tiles: ['purpur_pillar_top', 'purpur_pillar_top', 'purpur_pillar_side'],
  },
  plantSpec(250, 'chorus_plant', 'chorus_plant'),
  plantSpec(251, 'chorus_flower', 'chorus_flower'),
  {
    id: 252,
    name: 'minicraft:end_rod',
    tiles: ['end_rod', 'end_rod', 'end_rod'],
    solid: false,
    opaque: false,
    lightOpacity: 0,
    light: 14,
    shape: 'cross',
  },
  { id: 253, name: 'minicraft:dragon_egg', tiles: ['dragon_egg', 'dragon_egg', 'dragon_egg'] },
  {
    id: 254,
    name: 'minicraft:end_portal_frame',
    // 插了眼的那一格**顶面换一张**（凹槽里亮起一颗眼睛）。侧/底面始终是石框：
    // 眼睛只画在顶面上——原版就是这样（框架是一块"朝上的凹槽"）
    tiles: ['end_portal_frame', 'end_portal_frame', 'end_portal_frame'],
  },
  {
    id: 255,
    name: 'minicraft:end_portal',
    tiles: ['end_portal', 'end_portal', 'end_portal'],
    solid: false,
    opaque: false,
    lightOpacity: 0,
    light: 15,
  },
];
const REDSTONE_SPECS: readonly BlockSpec[] = [
  {
    id: 256,
    name: 'minicraft:redstone_wire',
    tiles: ['redstone_wire', 'redstone_wire', 'redstone_wire'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 257,
    name: 'minicraft:redstone_torch',
    tiles: ['redstone_torch', 'redstone_torch', 'redstone_torch'],
    shape: 'torch',
    solid: false,
    opaque: false,
    lightOpacity: 0,
    light: 7,
  },
  { id: 258, name: 'minicraft:redstone_block', tiles: ['redstone_block', 'redstone_block', 'redstone_block'] },
  {
    id: 259,
    name: 'minicraft:lever',
    tiles: ['lever', 'lever', 'lever'],
    shape: 'torch',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 260,
    name: 'minicraft:stone_button',
    tiles: ['stone_button', 'stone_button', 'stone_button'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 261,
    name: 'minicraft:oak_button',
    tiles: ['oak_button', 'oak_button', 'oak_button'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 262,
    name: 'minicraft:stone_pressure_plate',
    tiles: ['stone_pressure_plate', 'stone_pressure_plate', 'stone_pressure_plate'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 263,
    name: 'minicraft:oak_pressure_plate',
    tiles: ['oak_pressure_plate', 'oak_pressure_plate', 'oak_pressure_plate'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 264,
    name: 'minicraft:repeater',
    tiles: ['repeater', 'repeater', 'repeater'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 265,
    name: 'minicraft:comparator',
    tiles: ['comparator', 'comparator', 'comparator'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 266,
    name: 'minicraft:redstone_lamp',
    tiles: ['redstone_lamp', 'redstone_lamp', 'redstone_lamp'],
    // 亮起的红石灯换成发光贴图，并把方块光拉到 15——这是"红石能点亮房间"的关键
  },
  {
    id: 267,
    name: 'minicraft:piston',
    // 批次 65：推板（`piston_top`）只贴在**推出方向那一面**，其余五面是活塞身。
    // 在此之前推板同时贴在顶面与底面（那时没有朝向贴图能力，只能"上下都画一个"）
    tiles: ['piston_side', 'piston_side', 'piston_side'],
    // 批次 66：活塞支持上下（引擎侧也补齐了），所以用"潜行指定六向"这条规则
    facesSneak: true,
  },
  {
    id: 268,
    name: 'minicraft:piston_head',
    tiles: ['piston_head', 'piston_head', 'piston_head'],
    // 批次 68：活塞头是**技术方块**（活塞伸出时才出现），原版**没有对应物品**——
    // 不给它物品，背包里就不会出现"一个孤零零的活塞头"、也无法凭空放出来。
    // 朝向由活塞写进去（六向，见 B40），贴图/几何都跟着它走。
    itemless: true,
  },
  {
    id: 269,
    name: 'minicraft:sticky_piston',
    tiles: ['piston_side', 'piston_side', 'piston_side'],
    facesSneak: true,
  },
  {
    id: 270,
    name: 'minicraft:observer',
    // 批次 65：**眼**贴在"看的那一面"（引擎里 `facing` 指的就是它）、
    // **红点**贴在对面的"输出面"（`componentOutput` 给的正是 `facing + 2`），其余四面是石壳。
    // 在此之前那只眼贴在顶面与底面——而侦测器看哪边完全看不出来
    tiles: ['observer_side', 'observer_side', 'observer_side'],
    facesSneak: true,
  },
  // ---- 附魔与书架（H9）
  {
    // 附魔台：原版只有 0.75 格高（底部一圈黑曜石 + 上面一本书）。
    // ⚠️ 简化成**整格方块**：新增一种"矮方块"形状要同时改碰撞盒、网格化与放置逻辑，
    // 与它带来的收益不成比例（见 TASKS H9 的说明）
    id: 271,
    name: 'minicraft:enchanting_table',
    tiles: ['enchanting_table_top', 'obsidian', 'enchanting_table_side'],
  },
  {
    id: 272,
    name: 'minicraft:bookshelf',
    tiles: ['oak_planks', 'oak_planks', 'bookshelf'],
  },
  // ---- 铁砧（H8）
  {
    // 铁砧原版有朝向与"落地受损"两种状态（受损后第三次使用会毁掉），
    // 这里只做**单一方块**：朝向要用方块状态（B4 的旋转变体那套），
    // 落地受损则要方块状态里再存一个"损伤度"，都留给后续。
    id: 273,
    name: 'minicraft:anvil',
    tiles: ['anvil_top', 'iron_block', 'anvil_side'],
  },
  {
    // 铁块：铁砧的配方材料。此前项目里只有"粗铁块"，而铁块是原版最基础的储物方块之一
    id: 274,
    name: 'minicraft:iron_block',
    tiles: ['iron_block', 'iron_block', 'iron_block'],
  },
  // ---- 农业（H13）：耕地与小麦（4 个生长阶段各占一个 id）
  // 用"一个阶段一个 id"而不是方块状态：贴图是按 id 静态查的（`blockDef(id).tiles`），
  // 状态化就要改网格化与图集两处；而 id 在这套代码里本来就充裕（台阶/楼梯/16 色都是批量生成）。
  {
    id: 275,
    name: 'minicraft:farmland',
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
    name: 'minicraft:brewing_stand',
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
 * 活板门与栅栏门（批次 30）。
 *
 * 两者都是"非立方体形状"家族的最后两块（见 B7）：形状定义在 `blockShapes.ts` 里，
 * 渲染与碰撞**共用同一份几何**（免得画一片板、撞在另一处）。
 * 状态位与门共用"开/关"那一位（见 `blockState.ts` 的说明）。
 */
const OPENABLE_SPECS: readonly BlockSpec[] = [
  {
    id: 289,
    name: 'minicraft:oak_trapdoor',
    tiles: ['oak_trapdoor', 'oak_trapdoor', 'oak_trapdoor'],
    shape: 'trapdoor',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 290,
    name: 'minicraft:oak_fence_gate',
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
    name: 'minicraft:fire',
    tiles: ['fire', 'fire', 'fire'],
    shape: 'cross',
    solid: false,
    opaque: false,
    light: 15,
    lightOpacity: 0,
    itemless: true,
  },
];
const SOUL_FIRE_SPECS: readonly BlockSpec[] = [
  {
    id: SOUL_FIRE_ID,
    name: 'minicraft:soul_fire',
    tiles: ['soul_fire', 'soul_fire', 'soul_fire'],
    shape: 'cross',
    solid: false,
    opaque: false,
    light: 10,
    lightOpacity: 0,
    itemless: true,
  },
];
const CONDUIT_SPECS: readonly BlockSpec[] = [
  {
    id: CONDUIT_ID,
    name: 'minicraft:conduit',
    tiles: ['conduit', 'conduit', 'conduit'],
    light: 15,
  },
];
const POWDER_SNOW_SPECS: readonly BlockSpec[] = [
  {
    id: POWDER_SNOW_ID,
    name: 'minicraft:powder_snow',
    tiles: ['powder_snow', 'powder_snow', 'powder_snow'],
    solid: false,
    opaque: false,
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
    name: 'minicraft:nether_portal',
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
  { id: 293, name: 'minicraft:netherite_block', tiles: ['netherite_block', 'netherite_block', 'netherite_block'] },
  {
    id: 294,
    name: 'minicraft:smithing_table',
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
    name: 'minicraft:lily_pad',
    tiles: ['lily_pad', 'lily_pad', 'lily_pad'],
    shape: 'lily_pad',
    solid: false,
    opaque: false,
    translucent: true,
    lightOpacity: 0,
  },
];
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
  name: `minicraft:${color.name}_carpet`,
  tiles: [`carpet_${color.name}`, `carpet_${color.name}`, `carpet_${color.name}`],
  shape: 'flat' as const,
  solid: false,
  opaque: false,
  lightOpacity: 0,
}));
/** 带釉陶瓦（批次 385）：16 色，由同色陶瓦烧制 */
const GLAZED_TERRACOTTA_SPECS: readonly BlockSpec[] = DYE_COLORS.map(
  (color, index): BlockSpec => ({
    id: 624 + index,
    name: `minicraft:${color.name}_glazed_terracotta`,
    tiles: [
      `glazed_terracotta_${color.name}`,
      `glazed_terracotta_${color.name}`,
      `glazed_terracotta_${color.name}`,
    ] as const,
  }),
);
/** 蜡烛（批次 382）：17 色，扁平、可放在地面上，光照 3 */
const CANDLE_SPECS: readonly BlockSpec[] = [
  {
    id: 607,
    name: 'minicraft:candle',
    tiles: ['candle', 'candle', 'candle'] as const,
    shape: 'flat' as const,
    solid: false,
    opaque: false,
    light: 3,
    lightOpacity: 0,
  },
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: 608 + index,
      name: `minicraft:${color.name}_candle`,
      tiles: [`candle_${color.name}`, `candle_${color.name}`, `candle_${color.name}`] as const,
      shape: 'flat' as const,
      solid: false,
      opaque: false,
      light: 3,
      lightOpacity: 0,
    }),
  ),
];
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
    name: 'minicraft:snow',
    tiles: ['snow', 'snow', 'snow'],
    shape: 'snow' as const,
    opaque: false,
    lightOpacity: 0,
  },
];
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
    name: 'minicraft:chain',
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
    name: 'minicraft:vine',
    tiles: ['vine', 'vine', 'vine'],
    shape: 'vine',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];
const COPPER_SPECS: readonly BlockSpec[] = COPPER_STAGES.flatMap((stage, index) =>
  COPPER_SHAPES.map((shape, kind): BlockSpec => {
    const tile = shape.cut ? stage.cutTile : stage.blockTile;
    const name = shape.cut
      ? `${stage.cutTile}${shape.suffix}` // cut_copper / cut_copper_slab / cut_copper_stairs
      : `${stage.blockTile}`; // copper_block / exposed_copper / ...
    const base: BlockSpec = {
      id: copperId(index, kind as 0 | 1 | 2 | 3),
      name: `minicraft:${name}`,
      tiles: [tile, tile, tile],
    };
    // 台阶与楼梯是非完整方块：不遮挡邻居、不挡光（与石材家族同一套写法）
    if (name.endsWith('_slab')) return { ...base, shape: 'slab', opaque: false, lightOpacity: 0 };
    if (name.endsWith('_stairs')) return { ...base, shape: 'stairs', opaque: false, lightOpacity: 0 };
    return base;
  }),
);
const BANNER_SPECS: readonly BlockSpec[] = DYE_COLORS.map(
  (color, index): BlockSpec => ({
    id: BANNER_ID_START + index,
    name: `minicraft:${color.name}_banner`,
    tiles: [`banner_${color.name}`, `banner_${color.name}`, `banner_${color.name}`] as const,
    // 图案（批次 497）：底色在 id 里，状态位只存"烫了哪种图案"。
    // 行为已搬到 `blockBehaviors.ts`（宿主3）：16 面旗帜按颜色在那边同样循环生成。
    shape: 'banner' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  }),
);
const MORE_STONE_SPECS: readonly BlockSpec[] = [
  {
    id: 404,
    name: 'minicraft:quartz_block',
    tiles: ['quartz_block_top', 'quartz_block_top', 'quartz_block_side'],
  },
  { id: 405, name: 'minicraft:chiseled_quartz_block', tiles: ['chiseled_quartz_block', 'chiseled_quartz_block', 'chiseled_quartz_block'] },
  // 石英柱在原版有轴向（横竖两种）；本项目与紫珀柱一样**不做轴向状态**（避免为一个方块加一条状态通道）
  { id: 406, name: 'minicraft:quartz_pillar', tiles: ['quartz_pillar_top', 'quartz_pillar_top', 'quartz_pillar_side'] },
  { id: 407, name: 'minicraft:smooth_quartz', tiles: ['smooth_quartz', 'smooth_quartz', 'smooth_quartz'] },
  { id: 408, name: 'minicraft:deepslate_tiles', tiles: ['deepslate_tiles', 'deepslate_tiles', 'deepslate_tiles'] },
  { id: 409, name: 'minicraft:red_nether_bricks', tiles: ['red_nether_bricks', 'red_nether_bricks', 'red_nether_bricks'] },
];
const STONECUTTER_SPECS: readonly BlockSpec[] = [
  {
    id: STONECUTTER_ID,
    name: 'minicraft:stonecutter',
    // 贴图顺序与 BlockSpec.tiles 一致：[顶面, 底面, 侧面]
    tiles: ['stonecutter_top', 'stonecutter_bottom', 'stonecutter_side'],
  },
];
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
const BERRY_AND_COCOA_SPECS: readonly BlockSpec[] = [
  plantSpec(429, 'sweet_berry_bush_stage0', 'sweet_berry_bush_stage0'),
  plantSpec(430, 'sweet_berry_bush_stage1', 'sweet_berry_bush_stage1'),
  plantSpec(431, 'sweet_berry_bush_stage2', 'sweet_berry_bush_stage2'),
  plantSpec(432, 'sweet_berry_bush_stage3', 'sweet_berry_bush_stage3'),
  // 可可豆荚：形状挂在原木侧面，朝向存在状态里
  {
    id: 433,
    name: 'minicraft:cocoa_stage0',
    tiles: ['cocoa_stage0', 'cocoa_stage0', 'cocoa_stage0'],
    shape: 'cocoa',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 434,
    name: 'minicraft:cocoa_stage1',
    tiles: ['cocoa_stage1', 'cocoa_stage1', 'cocoa_stage1'],
    shape: 'cocoa',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 435,
    name: 'minicraft:cocoa_stage2',
    tiles: ['cocoa_stage2', 'cocoa_stage2', 'cocoa_stage2'],
    shape: 'cocoa',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];
/** 长在水里的植物统一用 `cross` 形状（两片交叉薄面、无碰撞），只是多一个 `waterPlant` 标记 */
function waterPlantSpec(id: number, name: string, tile: string): BlockSpec {
  return { ...plantSpec(id, name, tile), waterPlant: true };
}
const KELP_SPECS: readonly BlockSpec[] = [
  waterPlantSpec(KELP_ID, 'kelp', 'kelp'),
  waterPlantSpec(SEAGRASS_ID, 'seagrass', 'seagrass'),
  {
    id: DRIED_KELP_BLOCK_ID,
    name: 'minicraft:dried_kelp_block',
    // 顶面是编织纹、侧面是横着压出来的一层层（底面孔位复用侧面：整块方块，不必为底面再画一张）
    tiles: ['dried_kelp_top', 'dried_kelp_side', 'dried_kelp_side'],
  },
];
/** 珊瑚扇：能贴墙也能落地，几何与火把同一套状态（"贴哪一面"写在状态里） */
function coralFanSpec(id: number, name: string, tile: string): BlockSpec {
  return {
    id,
    name: `minicraft:${name}`,
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
    name: `minicraft:${blockTile}`,
    tiles: [blockTile, blockTile, blockTile],
  });
  CORAL_SPECS.push({
    id: DEAD_CORAL_BLOCK_ID_START + i,
    name: `minicraft:${deadBlockTile}`,
    tiles: [deadBlockTile, deadBlockTile, deadBlockTile],
  });
  // 珊瑚丛（活/失活）：与花草同一种 cross 植物，只是长在水里
  CORAL_SPECS.push({ ...waterPlantSpec(CORAL_ID_START + i, `${kind}_coral`, `${kind}_coral`) });
  CORAL_SPECS.push({ ...waterPlantSpec(DEAD_CORAL_ID_START + i, `dead_${kind}_coral`, `dead_${kind}_coral`) });
  // 珊瑚扇（活/失活）
  CORAL_SPECS.push(coralFanSpec(CORAL_FAN_ID_START + i, `${kind}_coral_fan`, `${kind}_coral_fan`));
  CORAL_SPECS.push(coralFanSpec(DEAD_CORAL_FAN_ID_START + i, `dead_${kind}_coral_fan`, `dead_${kind}_coral_fan`));
}
const TNT_SPECS: readonly BlockSpec[] = [
  {
    id: TNT_ID,
    name: 'minicraft:tnt',
    // 正常是红白相间的炸药块；"闪"的那一相位换成发白的那两张（原版引信中就是白闪）
    tiles: ['tnt_top', 'tnt_bottom', 'tnt_side'],
    // 引信中：`powered` = 已点燃（与红石系统共用同一位），`flash` = 这一相位要发白
    shape: 'cube',
  },
];
const HOPPER_SPECS: readonly BlockSpec[] = [
  {
    id: HOPPER_ID,
    name: 'minicraft:hopper',
    tiles: ['hopper_top', 'hopper_inside', 'hopper_side'],
    shape: 'hopper',
    // 漏斗不是整格方块：上面的碗口 6/16 高，下面的管子不挡路（见 `blockShapes`）
    opaque: false,
    lightOpacity: 0,
  },
];
const DROPPER_SPECS: readonly BlockSpec[] = [
  {
    id: DROPPER_ID,
    name: 'minicraft:dropper',
    // 五个非凸口面都是外壳铁皮，**凸口那一面**用"管子口"贴图（批次 64 面级贴图）。
    // 原先钉在顶/底两面：朝下放时碰巧对，朝侧面放就完全看不出管子口（管子口只存在于几何上）
    tiles: ['dropper_side', 'dropper_side', 'dropper_side'],
    shape: 'dropper',
  },
];
const DISPENSER_SPECS: readonly BlockSpec[] = [
  {
    id: DISPENSER_ID,
    name: 'minicraft:dispenser',
    // 与投掷器同一条：**挡板那一面**用"挡板"贴图，其余五面是外壳
    tiles: ['dispenser_side', 'dispenser_side', 'dispenser_side'],
    shape: 'dispenser',
  },
];
const COMPOSTER_SPECS: readonly BlockSpec[] = [
  {
    id: COMPOSTER_ID,
    name: 'minicraft:composter',
    tiles: ['composter_top', 'composter_bottom', 'composter_side'],
    // 满仓：顶面换成"堆肥满仓"那张（桶底与桶身不动）
    shape: 'composter' as const,
  },
];
const CAULDRON_SPECS: readonly BlockSpec[] = [
  {
    id: CAULDRON_ID,
    name: 'minicraft:cauldron',
    tiles: ['cauldron_top', 'cauldron_bottom', 'cauldron_side'],
    // 有水时顶面换成"水面"那张（空锅是"看得到桶底"的暗口）；装了岩浆时是橙红的那张
    shape: 'composter' as const,
  },
];
const NOTE_BLOCK_SPECS: readonly BlockSpec[] = [
  {
    id: NOTE_BLOCK_ID,
    name: 'minicraft:note_block',
    tiles: ['note_block', 'note_block', 'note_block'],
  },
];
const ENDER_CHEST_SPECS: readonly BlockSpec[] = [
  {
    id: ENDER_CHEST_ID,
    name: 'minicraft:ender_chest',
    tiles: ['ender_chest_top', 'ender_chest_top', 'ender_chest_side'],
    facesPlayer: true,
    // 原版末影箱自己发亮 7（黑曜石底 + 那一圈末影气息）
    light: 7,
  },
];
const SHULKER_BOX_SPECS: readonly BlockSpec[] = [
  {
    id: SHULKER_BOX_ID,
    name: 'minicraft:shulker_box',
    tiles: ['shulker_top', 'shulker_bottom', 'shulker_side'],
  },
];
const COLORED_SHULKER_SPECS: readonly BlockSpec[] = DYE_COLORS.map((color, index) => ({
  id: SHULKER_BOX_COLOR_START + index,
  name: `minicraft:${color.name}_shulker_box`,
  tiles: [`shulker_top_${color.name}`, `shulker_bottom_${color.name}`, `shulker_side_${color.name}`],
}));
/**
 * 磁石（批次 453）。
 *
 * id **713**：697~712 被 16 色潜影盒占着（批次 451），所以接在最后。
 * `SPECS` 末尾会按 id 排序，写在数组哪个位置都行——但 id 必须对得上，
 * 否则构建表的"id 连续"校验会当场抛错（这是好事，宁可启动失败也不要静默错位）。
 */
const LODESTONE_SPEC: BlockSpec = {
  id: LODESTONE_ID,
  name: 'minicraft:lodestone',
  tiles: ['lodestone_top', 'lodestone_side', 'lodestone_side'],
};
const CAVE_VINES_SPEC: BlockSpec = {
  id: CAVE_VINES_ID,
  name: 'minicraft:cave_vines',
  tiles: ['cave_vines', 'cave_vines', 'cave_vines'],
  // 有浆果换一张图（状态 bit0）
  shape: 'cave_vines',
  solid: false,
  opaque: false,
  lightOpacity: 0,
};
const ARMOR_STAND_SPEC: BlockSpec = {
  id: ARMOR_STAND_ID,
  name: 'minicraft:armor_stand',
  tiles: ['armor_stand', 'armor_stand', 'armor_stand'],
  shape: 'armor_stand',
  solid: false,
  opaque: false,
  lightOpacity: 0,
};
const BELL_SPEC: BlockSpec = {
  id: BELL_ID,
  name: 'minicraft:bell',
  tiles: ['bell', 'bell', 'bell'],
  shape: 'bell',
  solid: false,
  opaque: false,
  lightOpacity: 0,
};
const JUKEBOX_SPEC: BlockSpec = {
  id: JUKEBOX_ID,
  name: 'minicraft:jukebox',
  tiles: ['jukebox_top', 'jukebox_side', 'jukebox_side'],
};
const COMMAND_BLOCK_SPEC: BlockSpec = {
  id: COMMAND_BLOCK_ID,
  name: 'minicraft:command_block',
  tiles: ['command_block_top', 'command_block_side', 'command_block_side'],
};
const RESPAWN_ANCHOR_SPEC: BlockSpec = {
  id: RESPAWN_ANCHOR_ID,
  name: 'minicraft:respawn_anchor',
  tiles: ['respawn_anchor_top', 'respawn_anchor_side', 'respawn_anchor_side'],
};
const SAPLING_SPECS: readonly BlockSpec[] = WOOD_TYPES.map((wood) => {
  const id = SAPLING_ID_MAP.get(wood.name)!;
  return plantSpec(id, `${wood.name}_sapling`, `${wood.name}_sapling`);
});
const STEM_SPECS: readonly BlockSpec[] = [
  ...STEM_STAGES.pumpkin!.map((id, stage) =>
    plantSpec(id, `pumpkin_stem_stage${stage}`, `pumpkin_stem_stage${stage}`),
  ),
  ...STEM_STAGES.melon!.map((id, stage) =>
    plantSpec(id, `melon_stem_stage${stage}`, `melon_stem_stage${stage}`),
  ),
  // 结果的茎：形状仍是十字面片，**朝向存在状态位里**（原版会朝果实弯，这里暂时只有一张贴图——
  // 差异写进 TASKS B48：模型弯曲要另加一条"按朝向旋转的面片"渲染路径）
  plantSpec(PUMPKIN_STEM_ATTACHED_ID, 'attached_pumpkin_stem', 'attached_pumpkin_stem'),
  plantSpec(MELON_STEM_ATTACHED_ID, 'attached_melon_stem', 'attached_melon_stem'),
];
const BARREL_SPECS: readonly BlockSpec[] = [
  {
    id: BARREL_ID,
    name: 'minicraft:barrel',
    // 批次 65：盖子（`barrel_top`）贴在**朝向那一面**（原版木桶的盖子可以朝任意一面），
    // 底面是 `barrel_bottom`、其余四面是木桶身。放置时盖子"远离你点的那一面"（六向）。
    // ⚠️ 木桶的朝向**只影响外观**：它不吃红石、也不按面限制漏斗（原版允许任意面取放）。
    tiles: ['barrel_side', 'barrel_side', 'barrel_side'],
    facesNormal: true,
  },
];
const TRIPWIRE_SPECS: readonly BlockSpec[] = [
  {
    id: TRIPWIRE_ID,
    name: 'minicraft:tripwire',
    tiles: ['tripwire', 'tripwire', 'tripwire'],
    shape: 'tripwire',
    opaque: false,
    lightOpacity: 0,
    // 原版绊线**没有物品**：只能拿线右键方块顶面放下来（见 main 的交互）
    itemless: true,
  },
  {
    id: TRIPWIRE_HOOK_ID,
    name: 'minicraft:tripwire_hook',
    // 通电时换一张（原版钩子"拉起来"的样子，这里用颜色区分）
    tiles: ['tripwire_hook', 'tripwire_hook', 'tripwire_hook'],
    shape: 'tripwire_hook',
    opaque: false,
    lightOpacity: 0,
  },
];
const DAYLIGHT_DETECTOR_SPECS: readonly BlockSpec[] = [
  {
    id: DAYLIGHT_DETECTOR_ID,
    name: 'minicraft:daylight_detector',
    // 反向模式换的是**顶面**那张（原版就是同一块板、顶面换个颜色）
    tiles: ['daylight_detector_top', 'daylight_detector_side', 'daylight_detector_side'],
    shape: 'daylight_detector',
    opaque: false,
    lightOpacity: 0,
  },
];
const SCAFFOLDING_SPECS: readonly BlockSpec[] = [
  {
    id: SCAFFOLDING_ID,
    name: 'minicraft:scaffolding',
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
    name: 'minicraft:cake',
    // 顶面奶油、底面蛋糕底、侧面那一圈（原版蛋糕就是这三张）
    tiles: ['cake_top', 'cake_bottom', 'cake_side'],
    shape: 'cake',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: FLOWER_POT_ID,
    name: 'minicraft:flower_pot',
    tiles: ['flower_pot_top', 'flower_pot', 'flower_pot'],
    shape: 'flower_pot',
    opaque: false,
    lightOpacity: 0,
  },
];
const CAMPFIRE_SPECS: readonly BlockSpec[] = [
  {
    id: CAMPFIRE_ID,
    name: 'minicraft:campfire',
    // 底面用原木的**横截面**（oak_log_top）：营火底下看到的就是木头的断面
    tiles: ['campfire_top', 'oak_log_top', 'campfire_side'],
    shape: 'campfire',
    opaque: false,
    lightOpacity: 0,
    // 点燃时**顶面**变成火焰（三座炉子亮的是侧面——营火是"敞口"的，火光从上面看最明显）
    // 原版营火是 15 级光源（比炉子的 13 更亮：它是明火）
  },
];
const FURNACE_STATION_SPECS: readonly BlockSpec[] = [
  {
    id: SMOKER_ID,
    name: 'minicraft:smoker',
    tiles: ['smoker_top', 'smoker_top', 'smoker_side'],
    // 点燃时的火光贴图与发光（批次 47，与熔炉同一套）
    facesPlayer: true,
  },
  {
    id: BLAST_FURNACE_ID,
    name: 'minicraft:blast_furnace',
    tiles: ['blast_furnace_top', 'blast_furnace_top', 'blast_furnace_side'],
    facesPlayer: true,
  },
];
const RED_SAND_SPECS: readonly BlockSpec[] = [
  { id: 411, name: 'minicraft:red_sand', tiles: ['red_sand', 'red_sand', 'red_sand'] },
  {
    id: 412,
    name: 'minicraft:red_sandstone',
    // 贴图顺序 [顶面, 底面, 侧面]：与普通砂岩同一套结构，只是换成红砂岩那三张
    tiles: ['red_sandstone_top', 'red_sandstone_top', 'red_sandstone'],
  },
  { id: 413, name: 'minicraft:chiseled_red_sandstone', tiles: ['chiseled_red_sandstone', 'red_sandstone', 'chiseled_red_sandstone'] },
  { id: 414, name: 'minicraft:cut_red_sandstone', tiles: ['cut_red_sandstone', 'red_sandstone', 'cut_red_sandstone'] },
  { id: 415, name: 'minicraft:smooth_red_sandstone', tiles: ['smooth_red_sandstone', 'smooth_red_sandstone', 'smooth_red_sandstone'] },
];
export const RAIL_SPECS: readonly BlockSpec[] = [
  {
    id: RAIL_ID,
    name: 'minicraft:rail',
    tiles: ['rail', 'rail', 'rail'],
    // 形状贴图（批次 478）：六种平面形状各一张（直南北 / 直东西 / 四个弯）。
    // ⚠️ 只有**普通铁轨**做了这套图：动力/探测/激活铁轨的形状也存在（矿车照样转向），
    // 但贴图仍是直轨——4 种 × 5 张 = 20 张图，这一批先不做（差异记在 TASKS G12）
    shape: 'rail',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: POWERED_RAIL_ID,
    name: 'minicraft:powered_rail',
    tiles: ['powered_rail', 'powered_rail', 'powered_rail'],
    // 通电状态换贴图：红石引擎在 `recompute` 里写 `powered` 位，渲染层照它取图
    shape: 'rail',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: DETECTOR_RAIL_ID,
    name: 'minicraft:detector_rail',
    tiles: ['detector_rail', 'detector_rail', 'detector_rail'],
    shape: 'rail',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: ACTIVATOR_RAIL_ID,
    name: 'minicraft:activator_rail',
    tiles: ['activator_rail', 'activator_rail', 'activator_rail'],
    shape: 'rail',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];
/**
 * 标靶（批次 248）：整格方块，中箭时发一秒信号。
 *
 * ⚠️ 原版按命中位置给 15/7/3 三档强度；这里只做"中/不中"两档（15/0）——
 * 要按位置分档，得让投掷物报出精确命中点，而现在的钩子只报"哪一格"。
 */
export const TARGET_SPECS: readonly BlockSpec[] = [
  {
    id: TARGET_ID,
    name: 'minicraft:target',
    tiles: ['target_top', 'target_top', 'target_side'],
  },
];
export const FROSTED_ICE_SPECS: readonly BlockSpec[] = [
  {
    id: FROSTED_ICE_ID,
    name: 'minicraft:frosted_ice',
    tiles: ['frosted_ice', 'frosted_ice', 'frosted_ice'],
    // 原版挖不到霜冰（挖掉直接碎），所以它**没有物品形态**——
    // 不标这一条，方块物品自动生成会往背包里塞一个"霜冰"，各路审计立刻报缺名字/缺配方
    itemless: true,
  },
];
export const WEIGHTED_PLATE_SPECS: readonly BlockSpec[] = [
  {
    id: LIGHT_WEIGHTED_PRESSURE_PLATE_ID,
    name: 'minicraft:light_weighted_pressure_plate',
    tiles: [
      'light_weighted_pressure_plate',
      'light_weighted_pressure_plate',
      'light_weighted_pressure_plate',
    ],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: HEAVY_WEIGHTED_PRESSURE_PLATE_ID,
    name: 'minicraft:heavy_weighted_pressure_plate',
    tiles: [
      'heavy_weighted_pressure_plate',
      'heavy_weighted_pressure_plate',
      'heavy_weighted_pressure_plate',
    ],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];
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
  // 铁轨（批次 245）：也进"已定义"表，`tilesOfDefined` 查得到它
  RAIL_SPECS,
  // 测重压力板（批次 247）与标靶（批次 248）
  WEIGHTED_PLATE_SPECS,
  TARGET_SPECS,
  // 霜冰（批次 263）
  FROSTED_ICE_SPECS,
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
const STONE_VARIANT_SPECS: readonly BlockSpec[] = (() => {
  const specs: BlockSpec[] = [];
  for (const [parent, name, kinds, , explicitTiles] of STONE_VARIANT_FAMILIES) {
    // 母方块横跨好几段规格，所以查"全部已定义的段"而不是 `baseTiles`（它只认 BASE_SPECS）；
    // 晚定义的那几族直接把贴图写在表里（见上面那段的注记）
    const tiles = explicitTiles ?? tilesOfDefined(parent);
    for (const kind of kinds) {
      const id = STONE_VARIANT_MAP.get(`${name}_${kind}`)!;
      // 三种变体都是非完整方块：不遮挡邻居、不挡光（与 `SHAPED_SPECS` 同一套写法）
      specs.push({ id, name: `minicraft:${name}_${kind}`, tiles, shape: kind, opaque: false, lightOpacity: 0 });
    }
  }
  return specs;
})();
const BED_SPECS: readonly BlockSpec[] = DYE_COLORS.map((color) => {
  const id = BED_ID_MAP.get(color.name)!;
  const top = `bed_${color.name}_top`;
  const side = `bed_${color.name}_side`;
  return {
    id,
    name: `minicraft:${color.name}_bed`,
    // [顶面, 底面, 侧面]：床头/床脚共用同一张顶面贴图（枕头是几何，不是贴图）
    tiles: [top, top, side] as const,
    shape: 'bed' as const,
    // 9/16 高的家具：不遮挡邻居、不挡光（与台阶/活板门同一条），但**有碰撞**（能站上去）
    opaque: false,
    lightOpacity: 0,
  };
});
const SIGN_SPECS: readonly BlockSpec[] = WOOD_TYPES.map((wood) => {
  const id = SIGN_ID_MAP.get(wood.name)!;
  const plank = `${wood.name}_planks`;
  return {
    id,
    name: `minicraft:${wood.name}_sign`,
    tiles: [plank, plank, plank] as const,
    shape: 'sign' as const,
    // 牌子**不挡路**（原版能从牌子里走过去）：没有碰撞盒（见 `blockShapes`），
    // 也不算"支撑面"（不能拿它当垫脚去种花）——所以 `solid: false`
    solid: false,
    opaque: false,
    lightOpacity: 0,
  };
});
const BLACKSTONE_FAMILY_SPECS: readonly BlockSpec[] = [
  {
    id: POLISHED_BLACKSTONE_ID,
    name: 'minicraft:polished_blackstone',
    tiles: ['polished_blackstone', 'polished_blackstone', 'polished_blackstone'],
  },
  {
    id: POLISHED_BLACKSTONE_BRICKS_ID,
    name: 'minicraft:polished_blackstone_bricks',
    tiles: ['polished_blackstone_bricks', 'polished_blackstone_bricks', 'polished_blackstone_bricks'],
  },
  {
    // 鎏金黑石：深色石头里嵌着金块。**它是一件"矿石"而不是装饰**——
    // 拆掉掉 2~5 个金粒（见 `items.ts` 的 `COUNT_RANGE_DROPS`），
    // 所以堡垒遗迹里它是玩家真正会去撬的那几块
    id: GILDED_BLACKSTONE_ID,
    name: 'minicraft:gilded_blackstone',
    tiles: ['gilded_blackstone', 'gilded_blackstone', 'gilded_blackstone'],
  },
];
const LIGHTNING_ROD_SPEC: BlockSpec = {
  id: LIGHTNING_ROD_ID,
  name: 'minicraft:lightning_rod',
  shape: 'lightning_rod',
  tiles: ['lightning_rod', 'lightning_rod', 'lightning_rod'],
  // 贴在命中的那一面上（六向），与木桶同一条规则
  facesNormal: true,
  // 铜做的、不挡光、不算实心（2/16 细杆）
  lightOpacity: 0,
  solid: false,
  opaque: false,
};
/**
 * 黑石家族的"装饰性补齐"（批次 85，B50）：錾制与裂纹两块。
 *
 * ⚠️ 裂纹磨制黑石砖**没有合成配方**——原版只有"把黑石砖丢进熔炉烧"这一条路
 * （见 `Smelting.ts`），所以它的说明里写的是"烧出来"，而断言里专门钉住
 * "它不出现在任何合成配方的产物里"。
 */
const BLACKSTONE_DECOR_SPECS: readonly BlockSpec[] = [
  {
    id: CHISELED_POLISHED_BLACKSTONE_ID,
    name: 'minicraft:chiseled_polished_blackstone',
    tiles: ['chiseled_polished_blackstone', 'chiseled_polished_blackstone', 'chiseled_polished_blackstone'],
  },
  {
    id: CRACKED_POLISHED_BLACKSTONE_BRICKS_ID,
    name: 'minicraft:cracked_polished_blackstone_bricks',
    tiles: [
      'cracked_polished_blackstone_bricks',
      'cracked_polished_blackstone_bricks',
      'cracked_polished_blackstone_bricks',
    ],
  },
];
const HANGING_SPECS: readonly BlockSpec[] = [
  {
    id: ITEM_FRAME_ID,
    name: 'minicraft:item_frame',
    shape: 'item_frame',
    tiles: ['item_frame', 'item_frame', 'item_frame'],
    // 框里能不能挂东西与方块无关（挂在墙上的是一块空心板），所以没有额外状态位
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: PAINTING_ID,
    name: 'minicraft:painting',
    shape: 'painting',
    // 默认贴图（状态为 0 时用）就是第一幅画；其余在 `stateTiles` 里按变体号换
    tiles: [paintingTile(0), paintingTile(0), paintingTile(0)],
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];
const CARTOGRAPHY_TABLE_SPEC: BlockSpec = {
  id: CARTOGRAPHY_TABLE_ID,
  name: 'minicraft:cartography_table',
  // 顶面：摊开的地图 + 罗盘；底面：木板；侧面：纸卷与木框
  tiles: ['cartography_table_top', 'oak_planks', 'cartography_table_side'],
};
const WORKSTATION_SPECS: readonly BlockSpec[] = [
  {
    id: LECTERN_ID,
    name: 'minicraft:lectern',
    // 顶面：摊开的书；侧面：木框 + 书脊
    tiles: ['lectern_top', 'lectern_top', 'lectern_side'],
  },
  {
    id: FLETCHING_TABLE_ID,
    name: 'minicraft:fletching_table',
    tiles: ['fletching_table_top', 'fletching_table_top', 'fletching_table_side'],
  },
  {
    id: GRINDSTONE_ID,
    name: 'minicraft:grindstone',
    tiles: ['grindstone_top', 'grindstone_top', 'grindstone_side'],
  },
  {
    id: LOOM_ID,
    name: 'minicraft:loom',
    tiles: ['loom_top', 'loom_bottom', 'loom_side'],
  },
];
const NETHER_WART_SPECS: readonly BlockSpec[] = [0, 1, 2, 3].map((stage) => ({
  id: NETHER_WART_ID_START + stage,
  name: `minicraft:nether_wart_stage${stage}`,
  tiles: [`nether_wart_stage${stage}`, `nether_wart_stage${stage}`, `nether_wart_stage${stage}`],
  solid: false,
  opaque: false,
  lightOpacity: 0,
  shape: 'nether_wart' as const,
}));
/**
 * 凋灵骷髅头（批次 115，J14 的前置）。
 *
 * 它有两个身份，这里都实现了：
 *  - **战利品**：凋灵骷髅 2.5% 掉一个（原版数值），可以放在地上当装饰；
 *  - **召唤材料**：4 块灵魂沙摆成 T + 顶上 3 个头 = 凋灵（仪式那一半在下一批）。
 *
 * 形状是 `head`（8/16 立方体贴在顶面正中，能站上去也能从旁边走过），
 * 所以它**不是** `cube`——原版那颗头占不满一格。
 *
 * ⚠️ 与原版的差异：**不存朝向**（原版会按放置方向把脸转过来）。本项目的状态位
 * 已被 `TOP_MASK` 那套"不同形状族共用位"的约定占着，而"头朝哪"这件事只影响观感，
 * 不值得为它占一位——脸朝 -Z，四个侧面共用同一张贴图，从哪边看都是那张脸。
 */
const SKULL_SPECS: readonly BlockSpec[] = [
  {
    id: WITHER_SKELETON_SKULL_ID,
    name: 'minicraft:wither_skeleton_skull',
    tiles: ['wither_skull_top', 'wither_skull', 'wither_skull'],
    shape: 'head',
    opaque: false,
    lightOpacity: 0,
  },
];
/**
 * 灵魂火把 / 灵魂灯笼（批次 200，B20 的三件之一）。
 *
 * 它们的存在理由不是"再来两个光源"：**灵魂沙谷**与**灵魂沙**早就在（下界生成），
 * 但做出来的东西只有"烧"这一条用途。这两件把灵魂沙接进了"照明"这条链，
 * 而且亮度 **10**（普通火把 14）——比火把暗一档，在灵魂沙谷里反而更耐看。
 */
const SOUL_LIGHT_SPECS: readonly BlockSpec[] = [
  {
    id: SOUL_TORCH_ID,
    name: 'minicraft:soul_torch',
    tiles: ['soul_torch', 'soul_torch', 'soul_torch'],
    shape: 'torch',
    solid: false,
    opaque: false,
    light: 10,
    lightOpacity: 0,
  },
  {
    id: SOUL_LANTERN_ID,
    name: 'minicraft:soul_lantern',
    tiles: ['soul_lantern', 'soul_lantern', 'soul_lantern'],
    shape: 'lantern',
    solid: false,
    opaque: false,
    light: 10,
    lightOpacity: 0,
  },
];
const SLIME_BLOCK_SPECS: readonly BlockSpec[] = [
  {
    id: SLIME_BLOCK_ID,
    name: 'minicraft:slime_block',
    tiles: ['slime_block', 'slime_block', 'slime_block'],
    // 它挡光但不像石头那样遮住邻居（原版粘液块是半透明的）
    opaque: false,
    lightOpacity: 0,
  },
];
/**
 * 矿物块与信标（批次 117，K5 信标那一批）。
 *
 * 为什么**这一批才补三种矿物块**：信标的金字塔底座要用它们（原版底座可以是
 * 铁块 / 金块 / 钻石块 / 绿宝石块 / 下界合金块，还能混着摆）——而在此之前本项目
 * 只有铁块与下界合金块，**金/钻石/绿宝石连储物方块都没有**（也没有"9 锭换 1 块"的配方）。
 * 所以它们不是"顺手加的装饰"，是信标的前置。
 *
 * 信标本身是完整立方体（`cube`）：原版它由"黑曜石底盘 + 玻璃身 + 里面的星"三截组成，
 * 本项目按既有画法把这三截画进 16×16 贴图（见 `TextureAtlas` 的 `beacon`）——
 * 不额外做几何，观感与其它方块一致，网格化那边也少一个分支。
 * 它是**光源**（原版信标亮度 15）而且不挡光（那圈玻璃）。
 */
const MINERAL_AND_BEACON_SPECS: readonly BlockSpec[] = [
  { id: GOLD_BLOCK_ID, name: 'minicraft:gold_block', tiles: ['gold_block', 'gold_block', 'gold_block'] },
  {
    id: DIAMOND_BLOCK_ID,
    name: 'minicraft:diamond_block',
    tiles: ['diamond_block', 'diamond_block', 'diamond_block'],
  },
  {
    id: EMERALD_BLOCK_ID,
    name: 'minicraft:emerald_block',
    tiles: ['emerald_block', 'emerald_block', 'emerald_block'],
  },
  {
    id: BEACON_ID,
    name: 'minicraft:beacon',
    tiles: ['beacon_top', 'beacon_top', 'beacon'],
    opaque: false,
    lightOpacity: 0,
    light: 15,
  },
];
const SPAWNER_SPECS: readonly BlockSpec[] = [
  {
    id: SPAWNER_ID,
    name: 'minicraft:spawner',
    tiles: ['spawner', 'spawner', 'spawner'],
    solid: true,
    // 不透光但**不遮挡邻居**：这样隔着笼子能看见里面的方块，与原版观感一致
    opaque: false,
    lightOpacity: 0,
  },
];
export const SPECS: readonly BlockSpec[] = [
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
  // 铁轨（批次 245/247）：flat 薄板，注册进主表
  ...RAIL_SPECS,
  ...WEIGHTED_PLATE_SPECS,
  ...TARGET_SPECS,
  ...FROSTED_ICE_SPECS,
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
  ...TNT_SPECS,
  ...HOPPER_SPECS,
  ...DROPPER_SPECS,
  ...DISPENSER_SPECS,
  ...BARREL_SPECS,
  ...COMPOSTER_SPECS,
  ...NOTE_BLOCK_SPECS,
  ...CAULDRON_SPECS,
  ...ENDER_CHEST_SPECS,
  ...SHULKER_BOX_SPECS,
  ...COLORED_SHULKER_SPECS,
  LODESTONE_SPEC,
  RESPAWN_ANCHOR_SPEC,
  COMMAND_BLOCK_SPEC,
  JUKEBOX_SPEC,
  BELL_SPEC,
  ARMOR_STAND_SPEC,
  CAVE_VINES_SPEC,
  CARTOGRAPHY_TABLE_SPEC,
  ...BANNER_SPECS,
  ...SAPLING_SPECS,
  ...STEM_SPECS,
  ...BED_SPECS,
  ...SIGN_SPECS,
  ...BLACKSTONE_FAMILY_SPECS,
  LIGHTNING_ROD_SPEC,
  ...BLACKSTONE_DECOR_SPECS,
  ...HANGING_SPECS,
  ...WORKSTATION_SPECS,
  ...NETHER_WART_SPECS,
  ...SPAWNER_SPECS,
  ...SKULL_SPECS,
  ...MINERAL_AND_BEACON_SPECS,
  ...SLIME_BLOCK_SPECS,
  ...SOUL_LIGHT_SPECS,
  ...SOUL_FIRE_SPECS,
  ...CONDUIT_SPECS,
  ...POWDER_SNOW_SPECS,
  ...CANDLE_SPECS,
  ...GLAZED_TERRACOTTA_SPECS,

  // 繁茂洞穴植物（批次 397）：小型 / 大型垂滴叶
  {
    id: 665,
    name: 'minicraft:small_dripleaf',
    tiles: ['small_dripleaf', 'small_dripleaf', 'small_dripleaf'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 666,
    name: 'minicraft:big_dripleaf',
    tiles: ['big_dripleaf', 'big_dripleaf', 'big_dripleaf'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },

  // 缠根泥土（批次 395）：洞穴顶部的泥土变体
  {
    id: 664,
    name: 'minicraft:rooted_dirt',
    tiles: ['rooted_dirt', 'rooted_dirt', 'rooted_dirt'] as const,
  },

  // 洞穴顶部的两件（批次 392）：孢子花 / 垂根
  {
    id: 662,
    name: 'minicraft:spore_blossom',
    tiles: ['spore_blossom', 'spore_blossom', 'spore_blossom'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    light: 15,
    lightOpacity: 0,
  },
  {
    id: 663,
    name: 'minicraft:hanging_roots',
    tiles: ['hanging_roots', 'hanging_roots', 'hanging_roots'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },

  // 洞穴装饰（批次 391）：发光地衣 / 发光浆果 / 尖滴石 / 滴水石
  {
    id: 658,
    name: 'minicraft:glow_lichen',
    tiles: ['glow_lichen', 'glow_lichen', 'glow_lichen'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    light: 7,
    lightOpacity: 0,
  },
  {
    id: 659,
    name: 'minicraft:glow_berries',
    tiles: ['glow_berries', 'glow_berries', 'glow_berries'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    light: 14,
    lightOpacity: 0,
  },
  {
    id: 660,
    name: 'minicraft:pointed_dripstone',
    tiles: ['pointed_dripstone', 'pointed_dripstone', 'pointed_dripstone'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 661,
    name: 'minicraft:dripstone_block',
    tiles: ['dripstone_block', 'dripstone_block', 'dripstone_block'] as const,
  },

  // 哭泣的黑曜石（批次 390）：猪灵以物易物的产物，发 10 级光
  {
    id: 657,
    name: 'minicraft:crying_obsidian',
    tiles: ['crying_obsidian', 'crying_obsidian', 'crying_obsidian'] as const,
    light: 10,
  },

  // 遮光玻璃（批次 387）：1.17 的"不透光玻璃"，4 紫水晶碎片 + 1 玻璃
  {
    id: 656,
    name: 'minicraft:tinted_glass',
    tiles: ['tinted_glass', 'tinted_glass', 'tinted_glass'] as const,
    opaque: false,
    lightOpacity: 15,
  },
  // 骨块（批次 349，D21 化石）：9 骨粉压成一块，化石结构也用它
  {
    id: 587,
    name: 'minicraft:bone_block',
    tiles: ['bone_block_top', 'bone_block_top', 'bone_block_side'] as const,
  },
  // 紫水晶族（批次 351，D21 收尾）：紫晶洞的三层壳
  {
    id: 588,
    name: 'minicraft:amethyst_block',
    tiles: ['amethyst_block', 'amethyst_block', 'amethyst_block'] as const,
  },
  {
    id: 589,
    name: 'minicraft:budding_amethyst',
    tiles: ['budding_amethyst', 'budding_amethyst', 'budding_amethyst'] as const,
  },
  {
    id: 590,
    name: 'minicraft:amethyst_cluster',
    tiles: ['amethyst_cluster', 'amethyst_cluster', 'amethyst_cluster'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    light: 5,
  },
  // 分物种刷怪笼（批次 365）：同一张贴图、不同方块 id —— 与原版 K6 的
  // "一种生物一个 id"取舍一致（方块状态只有 1 字节，装不下 NBT）
  {
    id: 595,
    name: 'minicraft:zombie_spawner',
    tiles: ['spawner', 'spawner', 'spawner'] as const,
    solid: true,
    opaque: false,
    lightOpacity: 0,
    itemless: true,
  },
  {
    id: 596,
    name: 'minicraft:cave_spider_spawner',
    tiles: ['spawner', 'spawner', 'spawner'] as const,
    solid: true,
    opaque: false,
    lightOpacity: 0,
    itemless: true,
  },
  {
    id: 597,
    name: 'minicraft:silverfish_spawner',
    tiles: ['spawner', 'spawner', 'spawner'] as const,
    solid: true,
    opaque: false,
    lightOpacity: 0,
    itemless: true,
  },
  // 苔藓族（批次 367）：沼泽里的苔藓块与苔藓地毯
  {
    id: 598,
    name: 'minicraft:moss_block',
    tiles: ['moss_block', 'moss_block', 'moss_block'] as const,
  },
  {
    id: 599,
    name: 'minicraft:moss_carpet',
    tiles: ['moss_block', 'moss_block', 'moss_block'] as const,
    shape: 'flat' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  // 杜鹃族（批次 369）：苔藓斑块上长出来的三种
  {
    id: 600,
    name: 'minicraft:azalea',
    tiles: ['azalea', 'azalea', 'azalea'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 601,
    name: 'minicraft:flowering_azalea',
    tiles: ['flowering_azalea', 'flowering_azalea', 'flowering_azalea'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  // 蜂巢（批次 374）：繁花森林里的蜜蜂巢
  {
    id: 602,
    name: 'minicraft:bee_nest',
    tiles: ['bee_nest_top', 'bee_nest_top', 'bee_nest_side'] as const,
  },
  // 涂蜡铜（批次 375）：四种氧化度的整块，贴图与未涂蜡版完全一致
  {
    id: 603,
    name: 'minicraft:waxed_copper_block',
    tiles: ['copper_block', 'copper_block', 'copper_block'] as const,
  },
  {
    id: 604,
    name: 'minicraft:waxed_exposed_copper',
    tiles: ['exposed_copper', 'exposed_copper', 'exposed_copper'] as const,
  },
  {
    id: 605,
    name: 'minicraft:waxed_weathered_copper',
    tiles: ['weathered_copper', 'weathered_copper', 'weathered_copper'] as const,
  },
  {
    id: 606,
    name: 'minicraft:waxed_oxidized_copper',
    tiles: ['oxidized_copper', 'oxidized_copper', 'oxidized_copper'] as const,
  },
  // 蘑菇岛族（批次 352）：菌丝 + 巨型蘑菇的柄与两种菌盖
  {
    id: 591,
    name: 'minicraft:mycelium',
    tiles: ['mycelium_top', 'dirt', 'mycelium_side'] as const,
  },
  {
    id: 592,
    name: 'minicraft:mushroom_stem',
    tiles: ['mushroom_stem', 'mushroom_stem', 'mushroom_stem'] as const,
  },
  {
    id: 593,
    name: 'minicraft:brown_mushroom_block',
    tiles: ['brown_mushroom_block_top', 'brown_mushroom_block_top', 'brown_mushroom_block_side'] as const,
  },
  {
    id: 594,
    name: 'minicraft:red_mushroom_block',
    tiles: ['red_mushroom_block_top', 'red_mushroom_block_top', 'red_mushroom_block_side'] as const,
  },
].sort((a, b) => a.id - b.id);
