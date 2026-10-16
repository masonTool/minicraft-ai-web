/**
 * 物品的中文名与说明
 *
 * 注册表里的名字是英文 id（`grass_block`），玩家在界面上看到的应该是"草方块"。
 * 分两层：
 *
 *  1. **中文名**：能给规则的就用规则批量生成（16 种染料 × 羊毛/陶瓦/混凝土/染色玻璃/玻璃板/染料
 *     就有 96 条；台阶/楼梯 24 条；矿石主世界 8 + 深层 8），剩下的写成一张显式表。
 *     查不到的**回退成英文 id**——宁可显示 `warped_nylium` 也不要显示空白。
 *  2. **说明**：只给"有信息量"的东西写（矿石在哪挖、燃料能烧几个、功能方块怎么用），
 *     普通建材不写，由 `describe` 兜底成"类别 + 堆叠上限"。
 *
 * 为什么不塞进 `items.ts`：注册表是给逻辑用的（id / 掉落 / 堆叠），
 * 文案是给界面用的，两者改动的理由和频率都不一样。
 */

import { BLOCKS, COPPER_STAGES, CORAL_KIND_CN } from './blocks.ts';
import {
  CATEGORY_LABELS,
  categoryOf,
  CREATIVE_ITEMS,
  itemDef,
  maxStackOf,
  type ItemCategory,
} from './items.ts';
import { ALL_ARMOR_MATERIALS, ARMOR_SPECS, ARMOR_TYPES, armorInfoById } from './armor.ts';
import { EFFECT_LABELS } from '../survival/StatusEffects.ts';
import { SPLASH_RADIUS, isInstantEffect } from '../survival/SplashPotion.ts';
import { CLOUD_DURATION, CLOUD_PULSE_INTERVAL, LINGERING_RADIUS } from '../survival/PotionCloud.ts';
import { POTIONS, TIPPED_ARROWS, potionById, type PotionEntry, type TippedArrowEntry } from './potions.ts';
import { tippedArrowEffects } from '../survival/TippedArrow.ts';
import { enchantmentById, romanLevel } from './enchantments.ts';
import { FOOD_TABLE, saturationFrom } from './food.ts';
import { TOOL_SPECS, durabilityLabel, toolInfoById } from './tools.ts';
import { durabilityBar, rarityOf, type ItemRarity } from './itemVisuals.ts';

// ---------------------------------------------------------------- 规则生成

/** 16 种染料色（原版顺序），羊毛/陶瓦/混凝土/染色玻璃/玻璃板/染料都按它拼 */
const COLORS_CN: Record<string, string> = {
  white: '白色',
  orange: '橙色',
  magenta: '品红色',
  light_blue: '淡蓝色',
  yellow: '黄色',
  lime: '黄绿色',
  pink: '粉红色',
  gray: '灰色',
  light_gray: '淡灰色',
  cyan: '青色',
  purple: '紫色',
  blue: '蓝色',
  brown: '棕色',
  green: '绿色',
  red: '红色',
  black: '黑色',
};

/** 木质名称 */
const WOODS_CN: Record<string, string> = {
  oak: '橡木',
  spruce: '云杉',
  birch: '白桦',
  jungle: '丛林',
  acacia: '金合欢',
  dark_oak: '深色橡木',
};

/** 有"台阶 / 楼梯"两种变体的建材 */
const STRUCTURE_BASES_CN: Record<string, string> = {
  stone: '石头',
  cobblestone: '圆石',
  oak_planks: '橡木木板',
  spruce_planks: '云杉木板',
  birch_planks: '白桦木板',
  jungle_planks: '丛林木板',
  acacia_planks: '金合欢木板',
  dark_oak_planks: '深色橡木木板',
  sandstone: '砂岩',
  stone_bricks: '石砖',
  smooth_stone: '平滑石头',
  polished_granite: '磨制花岗岩',
  polished_diorite: '磨制闪长岩',
  polished_andesite: '磨制安山岩',
  deepslate_bricks: '深板岩砖',
  bricks: '红砖块',
  polished_deepslate: '磨制深板岩',
};

/**
 * 矿石：主世界的 8 种 + 深层的 8 种。
 * 注意矿石名不是"材料名 + 矿石"：煤炭 → **煤矿石**、红石 → **红石矿石**、青金石 → **青金石矿石**，
 * 所以单列一张表，不要拿材料名去拼。
 */
const ORE_NAMES_CN: Record<string, string> = {
  coal: '煤矿石',
  iron: '铁矿石',
  copper: '铜矿石',
  gold: '金矿石',
  redstone: '红石矿石',
  lapis: '青金石矿石',
  diamond: '钻石矿石',
  emerald: '绿宝石矿石',
};


const NAMES = new Map<string, string>();

function put(id: string, name: string): void {
  NAMES.set(id, name);
}

// 染料系：16 × 7 = 112 条
for (const [color, cn] of Object.entries(COLORS_CN)) {
  put(`${color}_dye`, `${cn}染料`);
  put(`${color}_wool`, `${cn}羊毛`);
  put(`${color}_carpet`, `${cn}地毯`);
  put(`${color}_terracotta`, `${cn}陶瓦`);
  put(`${color}_concrete`, `${cn}混凝土`);
  put(`${color}_stained_glass`, `${cn}染色玻璃`);
  put(`${color}_stained_glass_pane`, `${cn}染色玻璃板`);
}
put('terracotta', '陶瓦');
put('glass', '玻璃');
put('glass_pane', '玻璃板');

// 木头系：原木 / 木板 / 树叶
for (const [wood, cn] of Object.entries(WOODS_CN)) {
  put(`${wood}_log`, `${cn}原木`);
  put(`${wood}_planks`, `${cn}木板`);
  put(`${wood}_leaves`, `${cn}树叶`);
}

// 木制方块族（批次 38）：栅栏 / 栅栏门 / 门 / 活板门
// 与方块表同源（都从木材表展开），加一种木材两边自动跟上——
// 这正是"新加了方块却冒出英文 id"那条老毛病要防的地方
for (const [wood, cn] of Object.entries(WOODS_CN)) {
  put(`${wood}_fence`, `${cn}栅栏`);
  put(`${wood}_fence_gate`, `${cn}栅栏门`);
  put(`${wood}_door`, `${cn}门`);
  put(`${wood}_trapdoor`, `${cn}活板门`);
}

// 珊瑚一族（批次 51）：5 种 × 3 形 × 活/失活 = 30 条中文名，**由"种"表展开**。
// 与方块表（`CORAL_SPECS`）同一套命名规则：少写一种就会冒出英文 id，
// 而"某一格显示 tube_coral_fan"这种事只有玩家看得见
for (const [kind, cn] of Object.entries(CORAL_KIND_CN)) {
  put(`${kind}_coral_block`, `${cn}珊瑚块`);
  put(`dead_${kind}_coral_block`, `失活的${cn}珊瑚块`);
  put(`${kind}_coral`, `${cn}珊瑚`);
  put(`dead_${kind}_coral`, `失活的${cn}珊瑚`);
  put(`${kind}_coral_fan`, `${cn}珊瑚扇`);
  put(`dead_${kind}_coral_fan`, `失活的${cn}珊瑚扇`);
}

// 台阶 / 楼梯
for (const [base, cn] of Object.entries(STRUCTURE_BASES_CN)) {
  put(`${base}_slab`, `${cn}台阶`);
  put(`${base}_stairs`, `${cn}楼梯`);
}

// 石材家族的变体（批次 41）：台阶 / 楼梯 / 墙的名字 = **母方块的中文名 + 后缀**。
// ⚠️ 不能反过来"从变体名推母方块名"：`mossy_stone_bricks_stairs` 切出前缀会得到
// `mossy_stone_bricks`（对），但 `end_stone_bricks_wall` 也是同理——真正容易错的是
// 中文（"苔石砖楼梯" vs "苔石砖的楼梯"），所以这里显式列一张母方块中文名表。
// 这张表与 `STRUCTURE_BASES_CN` 有 4 个重叠项（砂岩/深板岩砖/红砖块/磨制深板岩）：
// 那批已经生成过台阶与楼梯的名字，这里再写一遍是**为了给它们补上"墙"的名字**——
// 文字完全相同，覆盖是无害的（最怕的是两边写了不一样的中文，那就会看提交顺序变名字）。
const STONE_VARIANT_PARENTS_CN: Record<string, string> = {
  granite: '花岗岩',
  diorite: '闪长岩',
  andesite: '安山岩',
  sandstone: '砂岩',
  deepslate_bricks: '深板岩砖',
  bricks: '红砖块',
  polished_deepslate: '磨制深板岩',
  mossy_cobblestone: '苔石',
  mossy_stone_bricks: '苔石砖',
  cobbled_deepslate: '深板岩圆石',
  cut_sandstone: '切制砂岩',
  smooth_sandstone: '平滑砂岩',
  blackstone: '黑石',
  nether_bricks: '下界砖块',
  end_stone_bricks: '末地石砖',
  purpur_block: '紫珀块',
  // ---- 批次 42 追加（石英家族 / 深板岩瓦 / 红色下界砖 / 海晶石三兄弟）
  // ⚠️ 这张表是**变体名的词干**，通常等于母方块中文名，但石英是例外：
  // 母方块叫"石英块"，它的台阶/楼梯在原版叫"石英台阶/石英楼梯"（没有"块"字）
  quartz_block: '石英',
  smooth_quartz: '平滑石英',
  deepslate_tiles: '深板岩瓦',
  red_nether_bricks: '红色下界砖',
  prismarine: '海晶石',
  prismarine_bricks: '海晶石砖',
  dark_prismarine: '暗海晶石',
  // ---- 批次 45 追加（红砂岩家族）：词干与砂岩家族一一对应
  red_sandstone: '红砂岩',
  cut_red_sandstone: '切制红砂岩',
  smooth_red_sandstone: '平滑红砂岩',
};
for (const [base, cn] of Object.entries(STONE_VARIANT_PARENTS_CN)) {
  put(`${base}_slab`, `${cn}台阶`);
  put(`${base}_stairs`, `${cn}楼梯`);
  put(`${base}_wall`, `${cn}墙`);
}

// 铜的四档（批次 40）：铜块 / 斑驳的铜块 / 锈蚀的铜块 / 氧化的铜块 + 切制铜家族。
// 名字由 `COPPER_STAGES` 展开（与方块表同源），加一档氧化不会漏名字。
// ⚠️ 中文名的语序不是"前缀 + 块"：斑驳的是"斑驳的铜块"、切制那支是"斑驳的切制铜"，
// 所以两种写法各列一份，不要拿一个前缀去拼。
const COPPER_CN = [
  { block: '铜块', cut: '切制铜' },
  { block: '斑驳的铜块', cut: '斑驳的切制铜' },
  { block: '锈蚀的铜块', cut: '锈蚀的切制铜' },
  { block: '氧化的铜块', cut: '氧化的切制铜' },
] as const;
COPPER_STAGES.forEach((stage, index) => {
  const cn = COPPER_CN[index]!;
  put(stage.blockTile, cn.block);
  put(stage.cutTile, cn.cut);
  put(`${stage.cutTile}_slab`, `${cn.cut}台阶`);
  put(`${stage.cutTile}_stairs`, `${cn.cut}楼梯`);
});

// 矿石：`coal_ore` = 煤矿石，`deepslate_coal_ore` = 深层煤矿石
for (const [ore, cn] of Object.entries(ORE_NAMES_CN)) {
  put(`${ore}_ore`, cn);
  put(`deepslate_${ore}_ore`, `深层${cn}`);
}

// 工具与武器：材质 × 种类 = 30 条（木镐 / 石斧 / 铁锹 / 金锄 / 钻石剑 / 下界合金镐……）
const TOOL_MATERIALS_CN: Record<string, string> = {
  wooden: '木',
  stone: '石',
  iron: '铁',
  golden: '金',
  diamond: '钻石',
  netherite: '下界合金',
};
const TOOL_KINDS_CN: Record<string, string> = {
  pickaxe: '镐',
  axe: '斧',
  shovel: '锹',
  hoe: '锄',
  sword: '剑',
};
for (const [material, materialCn] of Object.entries(TOOL_MATERIALS_CN)) {
  for (const [kind, kindCn] of Object.entries(TOOL_KINDS_CN)) {
    put(`${material}_${kind}`, `${materialCn}${kindCn}`);
  }
}

// 盔甲：部位 × 材质 = 24 件（皮革头盔 / 锁链胸甲 / 铁护腿 / 钻石靴子 / 下界合金头盔……）
const ARMOR_MATERIALS_CN: Record<string, string> = {
  leather: '皮革',
  chainmail: '锁链',
  iron: '铁',
  golden: '金',
  diamond: '钻石',
  netherite: '下界合金',
};
const ARMOR_TYPES_CN: Record<string, string> = {
  helmet: '头盔',
  chestplate: '胸甲',
  leggings: '护腿',
  boots: '靴子',
};
for (const material of ALL_ARMOR_MATERIALS) {
  for (const type of ARMOR_TYPES) {
    put(`${material}_${type}`, `${ARMOR_MATERIALS_CN[material]!}${ARMOR_TYPES_CN[type]!}`);
  }
}

// ---------------------------------------------------------------- 显式表

const EXPLICIT: Record<string, string> = {
  // 自然方块
  stone: '石头',
  dirt: '泥土',
  grass_block: '草方块',
  sand: '沙子',
  cobblestone: '圆石',
  bedrock: '基岩',
  deepslate: '深板岩',
  granite: '花岗岩',
  diorite: '闪长岩',
  andesite: '安山岩',
  tuff: '凝灰岩',
  calcite: '方解石',
  gravel: '砂砾',
  clay: '黏土块',
  sandstone: '砂岩',
  snow_block: '雪块',
  // 雪层（批次 37）：与"雪块"是两样东西——它是 1~8 层的薄雪，用锹铲或徒手撸
  snow: '雪',
  ice: '冰',
  packed_ice: '浮冰',
  obsidian: '黑曜石',
  raw_copper_block: '粗铜块',
  raw_iron_block: '粗铁块',
  // 流体与光
  water: '水',
  lava: '岩浆',
  glowstone: '荧石',
  // 火焰（I12）与下界传送门（K8）：都没有物品（背包里拿不到），
  // 但方块的调试信息、主菜单与提示里要用到这两个名字
  fire: '火焰',
  nether_portal: '下界传送门',
  // 下界合金（K8 尾巴）
  netherite_block: '下界合金块',
  smithing_table: '锻造台',
  // 切石机（H11，批次 44）
  stonecutter: '切石机',
  // 烟熏炉与高炉（H6，批次 46）、营火（批次 47）
  smoker: '烟熏炉',
  blast_furnace: '高炉',
  campfire: '营火',
  // 漏斗（批次 58，H14）：本项目第一件"会自己搬东西"的方块
  hopper: '漏斗',
  // 投掷器（批次 59，H14）：通电就朝朝向那一格吐一件（对面是容器就塞进去）
  dropper: '投掷器',
  dispenser: '发射器',
  // 睡莲（B16）
  lily_pad: '睡莲',
  // 建材
  stone_bricks: '石砖',
  chiseled_stone_bricks: '錾制石砖',
  smooth_stone: '平滑石头',
  polished_granite: '磨制花岗岩',
  polished_diorite: '磨制闪长岩',
  polished_andesite: '磨制安山岩',
  deepslate_bricks: '深板岩砖',
  chiseled_deepslate: '錾制深板岩',
  bricks: '红砖块',
  polished_deepslate: '磨制深板岩',
  mossy_cobblestone: '苔石',
  mossy_stone_bricks: '苔石砖',
  cracked_stone_bricks: '裂纹石砖',
  cracked_deepslate_bricks: '裂纹深板岩砖',
  cobbled_deepslate: '深板岩圆石',
  chiseled_sandstone: '錾制砂岩',
  cut_sandstone: '切制砂岩',
  smooth_sandstone: '平滑砂岩',
  // 红沙与红砂岩（批次 45）：名字与砂岩家族一一对应，只加"红"字
  red_sand: '红沙',
  red_sandstone: '红砂岩',
  chiseled_red_sandstone: '錾制红砂岩',
  cut_red_sandstone: '切制红砂岩',
  smooth_red_sandstone: '平滑红砂岩',
  // 石英家族与深板岩瓦、红色下界砖（批次 42）
  quartz_block: '石英块',
  chiseled_quartz_block: '錾制石英块',
  quartz_pillar: '石英柱',
  smooth_quartz: '平滑石英',
  deepslate_tiles: '深板岩瓦',
  red_nether_bricks: '红色下界砖',
  // 功能方块
  crafting_table: '工作台',
  furnace: '熔炉',
  chest: '箱子',
  torch: '火把',
  ladder: '梯子',
  // 锁链与藤蔓（B11）
  chain: '锁链',
  vine: '藤蔓',
  oak_door: '橡木门',
  oak_trapdoor: '橡木活板门',
  oak_fence_gate: '橡木栅栏门',
  oak_fence: '橡木栅栏',
  cobblestone_wall: '圆石墙',
  stone_brick_wall: '石砖墙',
  // 植物与装饰
  short_grass: '矮草',
  fern: '蕨',
  dandelion: '蒲公英',
  poppy: '虞美人',
  blue_orchid: '兰花',
  oxeye_daisy: '雏菊',
  cornflower: '矢车菊',
  red_mushroom: '红色蘑菇',
  brown_mushroom: '棕色蘑菇',
  sugar_cane: '甘蔗',
  pumpkin: '南瓜',
  melon: '西瓜',
  cactus: '仙人掌',
  dead_bush: '枯萎的灌木',
  bamboo: '竹子',
  // 附魔与铁砧（H9 / H8）
  enchanting_table: '附魔台',
  bookshelf: '书架',
  anvil: '铁砧',
  iron_block: '铁块',
  // 海底
  prismarine: '海晶石',
  prismarine_bricks: '海晶石砖',
  dark_prismarine: '暗海晶石',
  sea_lantern: '海晶灯',
  // 下界
  netherrack: '下界岩',
  soul_sand: '灵魂沙',
  soul_soil: '灵魂土',
  basalt: '玄武岩',
  smooth_basalt: '平滑玄武岩',
  blackstone: '黑石',
  magma_block: '岩浆块',
  crimson_nylium: '绯红菌岩',
  warped_nylium: '诡异菌岩',
  crimson_stem: '绯红菌柄',
  warped_stem: '诡异菌柄',
  crimson_planks: '绯红木板',
  warped_planks: '诡异木板',
  crimson_fungus: '绯红菌',
  warped_fungus: '诡异菌',
  nether_wart_block: '下界疣块',
  warped_wart_block: '诡异疣块',
  shroomlight: '菌光体',
  nether_bricks: '下界砖',
  nether_quartz_ore: '下界石英矿石',
  ancient_debris: '远古残骸',
  crimson_roots: '绯红菌索',
  warped_roots: '诡异菌索',
  nether_sprouts: '下界苗',
  // 末地
  end_stone: '末地石',
  end_stone_bricks: '末地石砖',
  purpur_block: '紫珀块',
  purpur_pillar: '紫珀柱',
  chorus_plant: '紫颂植物',
  chorus_flower: '紫颂花',
  end_rod: '末地烛',
  dragon_egg: '龙蛋',
  end_portal_frame: '末地传送门框架',
  end_portal: '末地传送门',
  // 物品
  coal: '煤炭',
  charcoal: '木炭',
  raw_iron: '粗铁',
  raw_copper: '粗铜',
  raw_gold: '粗金',
  redstone: '红石粉',
  lapis_lazuli: '青金石',
  diamond: '钻石',
  emerald: '绿宝石',
  stick: '木棍',
  iron_ingot: '铁锭',
  // 铁粒（B11）：1 铁锭 ↔ 9 铁粒，锁链的原料
  iron_nugget: '铁粒',
  // 下界石英（批次 42）：石英家族的唯一原料
  quartz: '下界石英',
  gold_ingot: '金锭',
  copper_ingot: '铜锭',
  brick: '红砖',
  clay_ball: '黏土球',
  // 生物掉落物（这几件此前**根本没有词条**，一直被染料区压着显示成染料名）
  rotten_flesh: '腐肉',
  bone: '骨头',
  bone_meal: '骨粉',
  snowball: '雪球',
  egg: '鸡蛋',
  dragon_breath: '龙息',
  gunpowder: '火药',
  beef: '生牛肉',
  porkchop: '生猪排',
  mutton: '生羊肉',
  chicken: '生鸡肉',
  leather: '皮革',
  feather: '羽毛',
  // 附魔材料
  paper: '纸',
  book: '书',
  // 农业
  farmland: '耕地',
  carrots_stage0: '胡萝卜（第 1 阶段）',
  potatoes_stage0: '马铃薯（第 1 阶段）',
  wheat_stage0: '小麦（幼苗）',
  carrots_stage1: '胡萝卜（第 2 阶段）',
  potatoes_stage1: '马铃薯（第 2 阶段）',
  wheat_stage1: '小麦（生长中）',
  carrots_stage2: '胡萝卜（第 3 阶段）',
  potatoes_stage2: '马铃薯（第 3 阶段）',
  wheat_stage2: '小麦（抽穗）',
  carrots_stage3: '胡萝卜（第 4 阶段）',
  potatoes_stage3: '马铃薯（第 4 阶段）',
  // 甜菜（批次 48）：第四种作物，四个阶段各自一个方块
  beetroots_stage0: '甜菜（第 1 阶段）',
  beetroots_stage1: '甜菜（第 2 阶段）',
  beetroots_stage2: '甜菜（第 3 阶段）',
  beetroots_stage3: '甜菜（第 4 阶段）',
  // 甜浆果丛与可可豆（批次 49）
  sweet_berry_bush_stage0: '甜浆果丛（幼苗）',
  sweet_berry_bush_stage1: '甜浆果丛（生长中）',
  sweet_berry_bush_stage2: '甜浆果丛（结果）',
  sweet_berry_bush_stage3: '甜浆果丛（成熟）',
  cocoa_stage0: '可可果（未成熟）',
  cocoa_stage1: '可可果（半熟）',
  cocoa_stage2: '可可果（成熟）',
  // 海带与海草（批次 50）：长在海底的两样植物（方块本身就是物品）
  kelp: '海带',
  seagrass: '海草',
  dried_kelp: '干海带',
  dried_kelp_block: '干海带块',
  // 蛋糕与花盆（批次 52）
  cake: '蛋糕',
  flower_pot: '花盆',
  // 脚手架（批次 53）
  scaffolding: '脚手架',
  // 绊线与绊线钩（批次 55）：绊线没有物品，但方块名（调试/提示）要有
  tripwire: '绊线',
  tripwire_hook: '绊线钩',
  // TNT（批次 56）
  tnt: 'TNT',
  // 阳光传感器（批次 54）：中文名**不在这里写**——红石元件那一张 `REDSTONE_CN` 表里
  // 早就有 `daylight_detector: '阳光探测器'`（官方译名），两处都写必然漂（第一版就写成了
  // "阳光传感器"，实测被后注册的那张表覆盖掉）
  wheat_stage3: '小麦（成熟）',
  wheat_seeds: '小麦种子',
  // ---- 食物与杂物补齐（批次 48）
  gold_nugget: '金粒',
  bowl: '碗',
  mushroom_stew: '蘑菇煲',
  pumpkin_pie: '南瓜派',
  beetroot: '甜菜根',
  beetroot_seeds: '甜菜种子',
  beetroot_soup: '甜菜汤',
  sweet_berries: '甜浆果',
  cocoa_beans: '可可豆',
  cookie: '曲奇',
  // 可疑的炖菜（批次 57）：展示名**故意带花名**——原版是"同一样物品 + NBT"，
  // 光看名字分不出哪一碗；我们按花分 id，就把花写进名字里（更好用，见 TASKS B31 的差异记录）
  suspicious_stew_dandelion: '可疑的炖菜（蒲公英）',
  suspicious_stew_poppy: '可疑的炖菜（虞美人）',
  suspicious_stew_blue_orchid: '可疑的炖菜（兰花）',
  suspicious_stew_oxeye_daisy: '可疑的炖菜（雏菊）',
  suspicious_stew_cornflower: '可疑的炖菜（矢车菊）',
  wheat: '小麦',
  bread: '面包',
  brewing_stand: '酿造台',
  rabbit_foot: '兔子脚',
  magma_cream: '岩浆膏',
  ghast_tear: '恶魂之泪',
  spider_eye: '蜘蛛眼',
  fermented_spider_eye: '发酵蜘蛛眼',
  glistering_melon_slice: '闪烁的西瓜片',
  pufferfish: '河豚',
  golden_carrot: '金萝卜',
  redstone_ingredient: '红石',
  glowstone_dust_ingredient: '荧石粉',
  glass_bottle: '玻璃瓶',
  water_bottle: '水瓶',
  nether_wart: '下界疣',
  blaze_powder: '烈焰粉',
  sugar: '糖',
  // 药水的名字与说明**不在这里写**：24 瓶全部由 `potions.ts` 的变体表生成（见文件后半段），
  // 否则"改了表的时长、忘了改文案"这类漂移没人能发现
  carrot: '胡萝卜',
  potato: '马铃薯',
  baked_potato: '烤马铃薯',
  // 工具与杂项
  shears: '剪刀',
  bucket: '桶',
  milk_bucket: '牛奶桶',
  flint_and_steel: '打火石',
  // 下界合金（K8 尾巴）：材料
  netherite_scrap: '下界合金碎片',
  netherite_ingot: '下界合金锭',
  // 弓与箭
  flint: '燧石',
  string: '线',
  arrow: '箭',
  bow: '弓',
  // 食物
  cooked_beef: '牛排',
  cooked_porkchop: '熟猪排',
  cooked_mutton: '熟羊肉',
  cooked_chicken: '熟鸡肉',
  apple: '苹果',
  melon_slice: '西瓜片',
  golden_apple: '金苹果',
};

for (const [id, name] of Object.entries(EXPLICIT)) put(id, name);

/** 红石元件的中文名（它们由红石系统注册，单独一张小表） */
const REDSTONE_CN: Record<string, string> = {
  redstone_wire: '红石线',
  redstone_torch: '红石火把',
  redstone_block: '红石块',
  lever: '拉杆',
  stone_button: '石头按钮',
  oak_button: '橡木按钮',
  stone_pressure_plate: '石质压力板',
  oak_pressure_plate: '橡木压力板',
  repeater: '红石中继器',
  comparator: '红石比较器',
  redstone_lamp: '红石灯',
  piston: '活塞',
  piston_head: '活塞头',
  sticky_piston: '黏性活塞',
  observer: '侦测器',
  iron_door: '铁门',
  iron_trapdoor: '铁活板门',
  oak_trapdoor: '橡木活板门',
  note_block: '音符盒',
  dispenser: '发射器',
  dropper: '投掷器',
  barrel: '木桶',
  hopper: '漏斗',
  target: '标靶',
  daylight_detector: '阳光探测器',
  tripwire: '绊线',
  tripwire_hook: '绊线钩',
  slime_block: '黏液块',
  honey_block: '蜂蜜块',
  rail: '铁轨',
  powered_rail: '动力铁轨',
  detector_rail: '探测铁轨',
  activator_rail: '激活铁轨',
};
for (const [id, name] of Object.entries(REDSTONE_CN)) put(id, name);

// ---------------------------------------------------------------- 说明

/**
 * 说明文案。
 *
 * 只写"光看图标看不出来"的信息：矿石在哪一层、这个能当燃料、右键能打开什么界面。
 * 普通建材不写（写"一种方块"没有意义）。
 */
const DESCRIPTIONS: Record<string, string> = {
  coal: '燃料：能烧炼 8 个物品；也是火把的主要材料。',
  charcoal: '燃料：能烧炼 8 个物品；用原木在熔炉里烧出来，去不了煤矿时的替代品。',
  stick: '合成材料：工具手柄、火把、梯子、栅栏都要它。',
  raw_iron: '铁矿石直接挖出来的原矿，放进熔炉烧成铁锭。',
  raw_copper: '铜矿石的原矿，熔炼后得到铜锭。',
  raw_gold: '金矿石的原矿，熔炼后得到金锭。',
  iron_ingot: '由粗铁或铁矿石熔炼而来；工具、铁轨、铁门的材料。',
  gold_ingot: '由粗金或金矿石熔炼而来；可以做动力铁轨与金苹果。',
  copper_ingot: '由粗铜熔炼而来；还能做成铜块。',
  diamond: '珍贵的矿物，能做最强的工具与盔甲。',
  emerald: '珍贵的矿物，主要用来和村民交易。',
  lapis_lazuli: '附魔台要用的宝石，也能做蓝色染料。',
  redstone: '红石电路的"电"；也用来做红石火把、中继器、比较器。',
  brick: '由黏土球烧制，4 个合成 1 块红砖块。',
  clay_ball: '由黏土块挖出，可烧制成红砖。',
  leather: '牛的掉落物，可以做书与盔甲。',
  feather: '鸡的掉落物，可以做箭与书。',
  bone_meal: '骨头磨成的粉：右键**作物**能把它的生长往前推 **2~5** 个阶段（已经成熟的推不动、也**不消耗**）。1 根骨头磨 3 份，所以很好攒。放进发射器就是一台"对着的作物自动催熟机"。⚠️ 原版还能催树苗/海带/甜浆果丛这些，那些还没接上。',
  chicken: '生鸡肉：可以吃，但生的会闹肚子，烤熟更安全。',
  torch: '照明方块：放在地面或墙上，夜里也能看清周围。',
  fire: '点燃后会往附近的可燃方块上蔓延，被水或雨浇灭。站在里面会被点燃、每秒掉 1 点血。',
  flint_and_steel: '对着方块右键点火（耐久 64 次）：下方是实心方块、或旁边有可燃方块才点得着。用黑曜石摆一个 2×3 以上的框再点火，就成了一座下界传送门（这一步不消耗耐久）。',
  nether_portal: '走进去站 4 秒就会被传送（创造模式是立刻）：主世界与下界的水平坐标按 1:8 换算，也就是说主世界走 8 格，下界只走 1 格。',
  crafting_table: '右键打开 3×3 合成台（背包里只有 2×2）。',
  furnace: '右键打开熔炉：烧炼矿石、烤食物，需要燃料。',
  chest: '右键打开 27 格存储空间，多个箱子可以并排摆放。',
  ladder: '贴在墙上可以上下攀爬（按跳跃往上、按潜行往下）。',
  chain: '一根细锁链：轴向由你点的那一面决定，可以竖着挂、也能横着拉。**基岩版里锁链可以攀爬**；要挖下来必须用镐。配方：1 铁锭 + 2 铁粒 → 1 根。',
  vine: '挂在墙上或天花板下的藤蔓：能攀爬、没有碰撞（可以穿过去），会自己往下长、也会往旁边的墙面蔓延。徒手打掉什么都不掉——**用剪刀（或精准采集）**才能整根摘下来。丛林的大树上天然就挂着。',
  iron_nugget: '1 个铁锭拆成 9 粒（9 粒也能合成 1 锭）；锁链的原料。',
  oak_door: '两格高的门，右键开关；放上方块需要留出空间。',
  oak_trapdoor: '一块薄板：横着贴在上下半格，右键立起来当挡板；通上红石会自动开合。配方：6 木板 → 2 个。',
  oak_fence_gate: '放在栅栏之间就能留一个能开关的通道：关着挡路、开了中间够走过去（格宽 0.75）；通上红石会自动开合。配方：2 木板 + 4 木棍。',
  glowstone: '明亮的照明方块，比火把亮得多。',
  lava: '碰到会持续掉血，也会点燃附近的可燃方块。',
  water: '可以在里面游泳，会缓慢恢复氧气以外的状态。',
  bedrock: '世界底部的基岩，挖不动。',
  obsidian: '需要钻石镐才能挖动；要塞的传送门房用它搭成。摆成一个 2×3 以上的空心框、用打火石点燃，就是一座下界传送门；把框敲掉门就跟着熄灭。',
  ancient_debris: '只在**下界的 y 8~22** 成小簇生成，是下界合金唯一的来源。烧成"下界合金碎片"、4 碎片 + 4 金锭合成 1 个下界合金锭；必须用钻石镐以上才挖得动（硬度 30，徒手要 2 分钟）。',
  netherite_scrap: '远古残骸在熔炉里烧出来的碎片（原地烧 10 秒、给 2 点经验）。4 个碎片 + 4 个金锭 = 1 个下界合金锭。',
  netherite_ingot: '4 个下界合金碎片 + 4 个金锭合成。**它不能直接做成工具或盔甲**：要拿着钻石装备去锻造台上升级（这一步不消耗经验，也不会掉附魔）。也能当盔甲与工具的修复材料。',
  netherite_block: '9 个下界合金锭合成的储物方块。硬度 50（比黑曜石更硬），要钻石镐以上才挖得动。',
  smithing_table: '右键打开：把**钻石装备**升级成下界合金装备，每次消耗 1 个下界合金锭。附魔、耐久损耗与自定义名字全部保留（不修耐久）；也能拆回 9 个锭。',
  stonecutter: '右键打开：放进**任何石料**（石头 / 砂岩 / 深板岩 / 石英 / 铜块…），直接切出它的台阶、楼梯、墙等变体——**1 个母方块出 1 份**，比在合成台里摆图案省料。放进去的那一刻会列出所有能切的东西，点哪一项就切哪一项。',
  smoker: '右键打开：**只烧食物**（生肉、马铃薯…），但速度是熔炉的 **2 倍**（5 秒一次）。同样的燃料能烧的次数不变——燃料在它里面烧得更快而已。',
  blast_furnace: '右键打开：**只烧矿物与金属**（原矿、远古残骸…），速度是熔炉的 **2 倍**（5 秒一次）。玻璃、石头、木炭这些它一概不做，那是熔炉的活。',
  campfire: '右键打开放上最多 **4 样食物**：不要燃料、点着就一直烤，30 秒一份（比熔炉慢 3 倍），烤好的会**自己弹出来**。拿**锹**右键可以熄灭、拿**打火石**右键重新点燃。',
  sugar_cane: '长在水边的植物：3 个可以合成 3 张纸（纸再做成书）。',
  lily_pad: '浮在水面上的叶子：**可以踩上去**，踩着它能一路走过浅水（不用游泳）。只在沼泽的水面上自然生长；手持它对着水面右键就能放下（水面正上方那一格）。',
  enchanting_table: '右键打开附魔界面：花经验与青金石给工具/武器/盔甲附魔。周围的书架越多，能出的附魔等级越高（满加成要 15 个书架）。',
  bookshelf: '放在附魔台周围给它加成：满 15 级需要 15 个书架（书架与附魔台之间要留一格空）。',
  anvil: '右键打开：可以合并两件装备的附魔、用材料修耐久、给物品改名。每次使用都会增加"积累惩罚"，所以同一件东西反复用会越来越贵——这也是经验修补更划算的原因。总代价超过 40 级就修不动了。',
  paper: '甘蔗做成的材料：3 张纸 + 1 个皮革 = 1 本书。',
  book: '附魔台与书架的原料，也可以放进附魔台当装饰。',
  flint: '挖砂砾时约 10% 概率掉出来（靠精准采集是挖不到的）；做箭要用它。',
  string: '弓与钓竿的材料。原版从蜘蛛身上拿，这里暂时用羊毛拆（1 个羊毛 → 4 根线）。',
  arrow: '弓的弹药：1 燧石 + 1 木棍 + 1 羽毛 = 4 支箭。射出去的箭能捡回来。',
  shears: '剪羊毛与树叶的专用工具：羊毛**不剪就没有**、树叶不剪只掉苹果；徒手拆羊毛虽然快，但什么也拿不到。耐久 238，也可以附魔效率/精准采集/耐久。',
  farmland: '用锄头右键泥土或草方块就成了耕地。小麦只能种在耕地上；旁边有水、光照够才长得快。',
  wheat_stage0: '刚播下的小麦苗。旁边有水、光照够就会一节节长高，成熟后能收小麦。',
  wheat_stage1: '正在长高的小麦。',
  wheat_stage2: '已经抽穗的小麦，再等一会儿就熟了。',
  wheat_stage3: '成熟的小麦：收下来得 1 个小麦 + 0~3 粒种子（原版是 1 个 + 平均 1.5 粒）。',
  wheat_seeds: '种在耕地上会长出小麦。破坏矮草约有 12.5% 概率掉种子（原版如此）。也能喂鸡。',
  gold_nugget: '1 个金锭拆成 9 粒，9 粒也能合成 1 个锭。金胡萝卜与（原版的）金苹果都要它。',
  bowl: '3 块木板做 4 个。蘑菇煲、甜菜汤、可疑的炖菜都要用碗——**喝完会退回空碗**（原版如此：碗是装东西的容器，喝完了碗还在）。',
  mushroom_stew: '一口回 6 点饥饿、7.2 点饱和度：红蘑菇 + 棕蘑菇 + 碗，前期最划算的熟食。',
  beetroot_soup: '一口回 6 点饥饿、7.2 点饱和度：6 个甜菜根 + 碗。甜菜根单吃只有 1 点，做成汤才值。',
  pumpkin_pie: '一口回 8 点饥饿、4.8 点饱和度：南瓜 + 糖 + 蛋。不用烤，直接能吃。',
  beetroot: '一口回 1 点饥饿。生的别急着吃——6 个能煮成一锅甜菜汤。种在耕地上会长出甜菜。',
  beetroot_seeds: '种在耕地上会长出甜菜（第四种作物）。种子只从村庄与废弃矿井的箱子里来（原版也只有这几条来源）。',
  sweet_berries: '一口回 2 点饥饿。种在**草或泥土**上会长成甜浆果丛（不用耕地），熟了自己结果——雪原与针叶林里天然长着这种丛。',
  cocoa_beans: '对着**丛林原木的侧面**种，会长成可可果。1 个可可豆能做成 1 个棕色染料；2 小麦 + 1 可可豆能烤出 8 块曲奇。',
  cookie: '一口回 2 点饥饿：2 个小麦 + 1 个可可豆做 8 块。丛林里的可可果就为它而种。',
  // ---- 可疑的炖菜（批次 57）：5 种花各自的文案由下面这一小段循环生成
  suspicious_stew_dandelion: '一碗看不出所以然的汤：**蒲公英**煮的，喝下去补一点**饱和度**（0.35 秒的饱和效果，原版数值）。配方 = 碗 + 红蘑菇 + 棕蘑菇 + 蒲公英。',
  suspicious_stew_poppy: '一碗看不出所以然的汤：**虞美人**煮的，喝下去给 **5 秒夜视**（下矿不带火把时的应急手段）。配方 = 碗 + 红蘑菇 + 棕蘑菇 + 虞美人。',
  suspicious_stew_blue_orchid: '一碗看不出所以然的汤：**兰花**煮的，喝下去补一点**饱和度**。配方 = 碗 + 红蘑菇 + 棕蘑菇 + 兰花。',
  suspicious_stew_oxeye_daisy: '一碗看不出所以然的汤：**雏菊**煮的，喝下去给 **8 秒生命恢复**。配方 = 碗 + 红蘑菇 + 棕蘑菇 + 雏菊。',
  suspicious_stew_cornflower: '一碗看不出所以然的汤：**矢车菊**煮的，喝下去给 **6 秒跳跃提升**（跳一格半）。配方 = 碗 + 红蘑菇 + 棕蘑菇 + 矢车菊。',
  sweet_berry_bush_stage0: '刚种下的甜浆果丛。长在草与泥土上，成熟后能摘到甜浆果。',
  cocoa_stage0: '挂在丛林原木上的可可果。熟了会从青绿变成橙黄，摘下来就是可可豆。',
  kelp: '海底往上长的一株长海带：**种在水里**（站着往脚下的水格点右键就行），会一节节长高、封顶 26 格。拆掉任意一节，上面几节一起断，每节掉 1 个海带。⚠️ 离开水就枯萎。烧一下就是干海带。',
  seagrass: '海底的草。**徒手拔下来什么都不掉**——要用**剪刀**才能整丛拿走（原版规则），所以别徒手去薅。也能在创造模式里种到水下的实心方块上。',
  dried_kelp: '一口回 1 点饥饿：海带在熔炉里烧出来的（0.1 经验）。单吃很亏，它的用处是**9 个压成 1 块干海带块**——那块能当燃料烧 20 个东西。',
  dried_kelp_block: '9 个干海带压成一块。**当燃料能烧 20 个东西**（比煤炭的 8 个还多一倍半），这就是海带农场在原版里的意义：一种可再生燃料。',
  cake: '3 牛奶桶 + 2 糖 + 1 蛋 + 3 小麦做出来的**能吃 7 次的方块**：放下之后**空手右键**啃一片（每片回 2 点饥饿），越吃越小，吃完就没了。⚠️ 蛋糕物品本身不能吃——只能放下来大家分。',
  flower_pot: '矮陶盆：**右键把花种进去**（矮草/蕨/五朵花/蘑菇/枯木/仙人掌/竹子/甜浆果丛，还有五色珊瑚扇），**空手右键**再把它取出来。3 个红砖就能做一个，摆一排做花架。',
  scaffolding: '6 竹子 + 1 线做 6 个。搭高的工具：**能站上去**（底部那块板 1/8 格高，走上去不用跳）、**能顺着往上爬**（跳跃上升、潜行下降）、相邻的会**连成一整片平台**。⚠️ 拆任意一节，上面那一片会**哗啦一下全掉**（原版如此）——所以在高处拆底面要小心。',
  daylight_detector: '按**天光强度**输出红石信号（正午 15 级、夜里 0 级，强度就是天光等级）。**右键切换反向模式**：变成"天黑才通电"，用来做夜灯最方便。3 玻璃 + 3 石英 + 3 木台阶。',
  tripwire_hook: '铁锭 + 木棍 + 木板做 **2 个**。**两根朝向相对**的钩子贴在墙或门框两侧，中间的每一格用**线**（手持线右键方块顶面）铺成绊线，就成了一条回路：任何生物/玩家/掉落的物品踩上去，两个钩子都会输出 15 级信号。⚠️ 用**剪刀右键**可以把某一格线剪断（剪断后不再触发，但回路不断）。',
  tripwire: '绊线（**没有物品**）：手持**线**右键方块顶面就能铺一格。踩上去会触发两端的绊线钩。拆掉会退回 1 根线。',
  tnt: '5 火药 + 4 沙。三种点法：**打火石右键**、**红石信号**（拉杆/压力板/绊线都行）、或者挨着**火与岩浆**。点燃后**闪 4 秒**再炸，威力 4（比苦力怕还大），能炸掉一大片方块、也能引爆范围内的其他 TNT（一串一片）。⚠️ 炸地形受"生物破坏地形"这条规则控制。',
  wheat: '可以做成面包（3 个小麦 → 1 个面包），也能喂牛羊把它们引过来。',
  bread: '一口回 5 点饥饿、6 点饱和度。用 3 个小麦做成。',
  brewing_stand: '右键放入药水与材料开始酿造：一次 20 秒，燃料是烈焰粉（1 份 20 次）。3 圆石 + 1 烈焰粉做成；原版那个配方用的是烈焰棒，本项目的烈焰棒还没做，先用烈焰粉顶。',
  glass_bottle: '3 个玻璃做 3 个。拿空瓶右键水方块就装满水，成为酿造的起点。',
  water_bottle: '酿造的基础：放进酿造台、加下界疣就是"粗制药水"，再加一种材料才成为具体药水。',
  nether_wart: '在下界要塞的楼梯上能找到的作物，是**一切药水的起点**（水瓶 + 下界疣 = 粗制药水）。',
  blaze_powder: '酿造台的燃料，1 份能酿 20 次。也可以做成烈焰棒（还没做）。',
  sugar: '甘蔗做的（1 甘蔗 → 1 糖）。在酿造里把粗制药水变成迅捷药水。',
  snowball: '右键扔出去：对生物**0 伤害**（原版如此），只会把它们推开；4 个雪球能合成 1 块雪块。',
  egg: '右键扔出去，1/8 概率砸出小鸡（原版概率）；鸡每 5~10 分钟下一个蛋，是鸡蛋的唯一来源。',
  dragon_breath: '末影龙吐出的血息，用**空玻璃瓶**站在血息云里右键就能接一瓶；在酿造里把喷溅药水变成滞留药水。',
  carrot: '种在耕地上会长出胡萝卜（收一次得 2~4 个）。能回 3 点饥饿，也能把猪引过来——**这就是猪的原版口粮**。',
  potato: '种在耕地上会长出马铃薯。生吃回 1 点饥饿，**烤过之后回 5 点**（原版差得很明显）。',
  baked_potato: '烤过的马铃薯：一口回 5 点饥饿、6 点饱和度（生的只有 1 点）。熔炉里烤一下就行。',
  bucket: '空桶：对着牛右键可以挤牛奶。3 个铁锭摆成 V 形就能做一个。',
  milk_bucket: '对着牛用空桶挤出来的。喝掉可以**清除身上所有状态效果**（中毒、缓慢都洗掉），但不回饥饿值。',
  bow: '右键蓄力、松手射箭：拉满（1 秒）伤害 6 点，没拉满威力打折。耐久 384，每射一次 -1。可以附魔力量/冲击/火矢/无限。',
  cactus: '碰到会掉血；可烧成绿色染料。',
  melon: '西瓜片：吃下能恢复饥饿值。',
  pumpkin: '可以做成雕刻南瓜，也能做南瓜派。',
  coal_ore: '用镐挖出煤炭；深层也有分布。',
  iron_ore: '用石镐以上才能挖动，掉落粗铁。',
  copper_ore: '用石镐以上才能挖动，掉落粗铜。',
  gold_ore: '用铁镐以上才能挖动，掉落粗金。',
  diamond_ore: '用铁镐以上才能挖动，是最有价值的矿石之一。',
  redstone_ore: '用铁镐以上才能挖动，掉落红石粉。',
  lapis_ore: '用石镐以上才能挖动，掉落青金石。',
  emerald_ore: '只在山地群系生成，掉落绿宝石。',
  prismarine: '海底神殿的建材，也由守卫者掉落。',
  sea_lantern: '海晶石做的光源，亮度很高。',
  netherrack: '下界最常见的岩石，用镐能很快挖开。',
  soul_sand: '踩上去会陷进去；也能种下界疣。',
  magma_block: '站在上面会掉血，但可以作为无限岩浆源的一部分。',
  bamboo: '丛林中大量生长，可以做成木棍与脚手架。',
  short_grass: '用剪刀能剪下来当装饰。',
  red_mushroom: '能做蘑菇煲，也能种成巨型蘑菇。',
  brown_mushroom: '能做蘑菇煲，在暗处生长。',
  dead_bush: '沙漠与恶地的枯木，可以当燃料。',
  snow_block: '雪做的方块，会融化（附近有热源时）。',
  snow: '薄薄一层雪：最多叠 8 层（叠满就是整格高），徒手也能撸掉，拿锹更快；破坏掉 1 个雪球。',
  ice: '光滑的冰面，走在上面会打滑。',
  gravel: '会掉落的方块；也是村庄道路的铺装材料。',
  sand: '会掉落的方块，能烧成玻璃。',
  red_sand: '恶地地表那一层赭红色的沙：4 个能合成红砂岩，也是红砂岩家族的唯一起点（普通沙子在沙漠与海边）。',
  redstone_wire: '红石线：把信号从电源传到元件上，最多传 15 格。',
  redstone_torch: '持续输出 15 级信号，也能反过来给红石线充能。',
  lever: '手动开关：右键切换通断。',
  stone_button: '按一下短暂通电，之后自动弹回。',
  repeater: '中继信号（可以延长到 15 格外）、也能做延迟与单向传输。',
  comparator: '比较两路信号的强度，也能读取箱子这类方块的状态。',
  redstone_lamp: '通电就亮，断电就灭。',
  piston: '通电时把前面的方块推出去，最多推 12 格。',
  sticky_piston: '通电推出、断电拉回。',
  observer: '侦测前方方块的变化，并从背面发出一个脉冲。',
  dropper: '装 **9 格**东西，通一次红石信号就朝**凸口那一面**吐一件：对面是容器（箱子/熔炉/别的漏斗…）就**塞进去**，不是容器就**当掉落物吐出来**。吐的时候**随机挑一格**（所以混装也公平）。放的时候**凸口朝你**（与熔炉的正面一样）。脉冲式的信号每来一次吐一件——红石钟就能把它变成"自动投喂机"。',
  barrel: '和箱子一样装 **27 格**，但**上面压着方块就打不开**（原版规则）——所以它最适合塞进墙里、天花板上，只留一个侧面朝外。与箱子一样**徒手就能挖下来**（斧头更快）。',
  dispenser: '投掷器的**加强版**：同样 9 格、同样通一次红石信号动一下，但**动之前会先看手里是什么**——箭/雪球/鸡蛋会**射出去**、药水会**砸出去**、TNT 会**点燃**、打火石会**点火**、剪刀会**剪羊毛**；表里没有的东西才当掉落物吐出来。朝向是**六向**（朝上/朝下要**潜行**放：普通放置凸口朝你）。⚠️ 水/岩浆桶、骨粉这些原版行为还没做（缺对应的物品）。',
  hopper: '会自己搬东西的容器（5 格）：每 **0.4 秒**把**朝向那一格**里的容器填一件，同时从**头顶**的容器或掉落物里吸一件进来（**先推后拉**）。放的时候**看着哪一面，管子就朝哪边**（俯视放就是朝下）；潜行放则朝你面朝的方向。通上红石信号会被**锁定**（不推也不吸）——这是"漏斗计时器 / 闸门"那套玩法的基础。',
  note_block: '在上面放乐器演奏会发出不同的声音。',
  rail: '铁轨：矿车在上面行驶。',
  powered_rail: '动力铁轨：通电后给矿车加速。',
  slime_block: '能弹跳，也能粘住方块一起被活塞推动。',
  honey_block: '能粘住方块，但不会让人弹跳。',
};

// 深层矿石统一补一句
for (const [ore, cn] of Object.entries(ORE_NAMES_CN)) {
  DESCRIPTIONS[`deepslate_${ore}_ore`] = `深层（深板岩层）的${cn}，掉落与普通${cn}相同。`;
}

// 珊瑚一族（批次 51）：30 件的说明按"形 × 活/失活"**四套模板**套上"种"的中文名——
// 一个一个手写 30 段必然出现"某一种的文案写的是另一种的颜色"
for (const [kind, cn] of Object.entries(CORAL_KIND_CN)) {
  DESCRIPTIONS[`${kind}_coral_block`] =
    `${cn}珊瑚块：活着的珊瑚，**贴着水才活着**——离开水会慢慢变成失活的珊瑚块（灰白）。挖它要带镐；**不用精准采集挖到的就是失活版**。暖水海洋的海底成片长着它。`;
  DESCRIPTIONS[`dead_${kind}_coral_block`] =
    `失活的${cn}珊瑚块：活珊瑚离开水之后留下的灰白骨架。泡在水里、且**六面挨着活珊瑚**时会慢慢复活（原版机制）。也可以当建材。`;
  DESCRIPTIONS[`${kind}_coral`] =
    `活着的${cn}珊瑚（丛）：长在海底珊瑚块上的小株，一碰就掉、徒手可采。**离开水会失活**；想要活的带回家，得用**精准采集**的镐。`;
  DESCRIPTIONS[`dead_${kind}_coral`] =
    `失活的${cn}珊瑚丛：灰白的珊瑚骸骨。泡在水里、挨着活珊瑚会复活。`;
  DESCRIPTIONS[`${kind}_coral_fan`] =
    `${cn}珊瑚扇：一片薄薄的扇形珊瑚，能**落在方块顶上、也能贴在侧面**（与火把一样）。种在水里、徒手可采；**离开水会失活**。`;
  DESCRIPTIONS[`dead_${kind}_coral_fan`] =
    `失活的${cn}珊瑚扇：灰白的扇形骸骨。贴在水里挨着活珊瑚会慢慢复活。`;
}

// 铜的四档（批次 40）：说明写清"会氧化、斧头能刮、刮了会退一档"
COPPER_STAGES.forEach((stage, index) => {
  const cn = COPPER_CN[index]!;
  const next = COPPER_CN[index + 1];
  const oxidize = next
    ? `放久了会慢慢变成**${next.block}**（一共 4 档，锈会从已经锈的地方往旁边蔓延）`
    : '已经锈到底了，不会再变';
  const scrape =
    index > 0
      ? `拿斧头右键能刮掉一层锈（退回**${COPPER_CN[index - 1]!.block}**，消耗 1 点耐久）`
      : '拿斧头刮没有效果（它已经是最新的一档）';
  DESCRIPTIONS[stage.blockTile] = `铜锭做的方块。${oxidize}；${scrape}。`;
  DESCRIPTIONS[stage.cutTile] = `把 4 个${cn.block}切成 4 个${cn.cut}，切面更整齐的铜建材。同样会氧化、也能用斧头刮。`;
  DESCRIPTIONS[`${stage.cutTile}_slab`] = `${cn.cut}做的台阶（3 个切 6 个）。`;
  DESCRIPTIONS[`${stage.cutTile}_stairs`] = `${cn.cut}做的楼梯（6 个切 4 个）。`;
});

// 工具与武器的说明由属性表生成：新加一把工具就自带说明，不会漏
const TOOL_TIER_CN = ['木/金', '石', '铁', '钻石', '下界合金'];
const TOOL_KIND_DESC: Record<string, string> = {
  pickaxe: '挖石头、矿石与砖石类方块；等级不够的矿石挖了也不掉落。',
  axe: '砍木头最快；近战单次伤害最高。',
  shovel: '挖泥土、沙子、砂砾这类松软方块最快。',
  hoe: '耕地的工具，也能当低伤害武器。',
  sword: '近战伤害与攻击手感最好的武器。',
};
for (const spec of TOOL_SPECS) {
  const materialCn = TOOL_MATERIALS_CN[spec.tool.material]!;
  const kindCn = TOOL_KINDS_CN[spec.tool.type]!;
  DESCRIPTIONS[`${spec.tool.material}_${spec.tool.type}`] =
    `${materialCn}${kindCn}：${TOOL_KIND_DESC[spec.tool.type]!}` +
    ` 采集等级 ${TOOL_TIER_CN[spec.tool.tier]!}｜速度 ×${spec.tool.speed}｜攻击 ${spec.tool.attack}｜耐久 ${spec.tool.durability}`;
}

// 盔甲的说明同样从属性表生成。
// "满套 N 点"是新手最想知道的那个数，所以顺手按材质算出来写进说明里
const ARMOR_KIND_DESC: Record<string, string> = {
  helmet: '戴在头上，四件里护甲值最低但材料最省。',
  chestplate: '穿在胸口，护甲值最高，优先做它。',
  leggings: '穿在腿上，护甲值居中。',
  boots: '穿在脚上，护甲值最低。',
};
const armorSetTotals = new Map<string, number>();
for (const spec of ARMOR_SPECS) {
  armorSetTotals.set(spec.armor.material, (armorSetTotals.get(spec.armor.material) ?? 0) + spec.armor.defense);
}
for (const spec of ARMOR_SPECS) {
  const materialCn = ARMOR_MATERIALS_CN[spec.armor.material]!;
  const typeCn = ARMOR_TYPES_CN[spec.armor.type]!;
  const toughness = spec.armor.toughness > 0 ? `｜韧性 ${spec.armor.toughness}` : '';
  DESCRIPTIONS[`${spec.armor.material}_${spec.armor.type}`] =
    `${materialCn}${typeCn}：${ARMOR_KIND_DESC[spec.armor.type]!}` +
    ` 护甲值 ${spec.armor.defense}${toughness}｜耐久 ${spec.armor.durability}` +
    `｜${materialCn}满套共 ${armorSetTotals.get(spec.armor.material)!} 点护甲`;
}

// 食物的说明也由数值表生成：饥饿与饱和度是玩家最关心的两个数，
// 而附加效果（腐肉/生鸡肉的饥饿）不写出来玩家根本不知道，会以为吃了没事
for (const [key, food] of Object.entries(FOOD_TABLE)) {
  const parts = [`饥饿 +${food.hunger}`, `饱和度 +${saturationFrom(food).toFixed(1)}`];
  if (food.alwaysEdible) parts.push('饥饿满时也能吃');
  for (const effect of food.effects ?? []) {
    const chance = effect.chance === undefined ? '' : `${Math.round(effect.chance * 100)}% 概率`;
    const level = effect.amplifier > 0 ? ` ${effect.amplifier + 1} 级` : '';
    parts.push(`${chance}${EFFECT_LABELS[effect.id]}${level} ${effect.seconds} 秒`);
  }
  DESCRIPTIONS[key] = `${parts.join('｜')}。`;
}

// ---- 药水（H10）：24 瓶的名字与说明都由 `potions.ts` 的变体表生成。
// 只有两处信息需要人写：**档位前缀**（延长/强化，由 `tier` 决定）与
// **效果本身的注意事项**（中毒不致死之类，下表）。

/** 效果本身的注意事项（按变体 key）；没写的效果就是"照着效果名念一遍"就够清楚 */
const POTION_NOTES: Record<string, string> = {
  poison: '中毒不会致死（会停在半颗心）。',
  slowness: '原版里这瓶通常是用来砸别人的——喷溅药水还没做，现在只能自己喝。',
};

/**
 * 时长文案：`45 秒` / `3 分钟` / `1 分 30 秒`。
 *
 * ⚠️ 小数**向下取整**（与原版的 mm:ss 一样）：药水箭的时长是折算出来的
 * （45 秒 → 5.625 秒），四舍五入会让说明写着"6 秒"而实际只有 5.6 秒——
 * 说明书宁可少说一点，也不该承诺打不到的时间。
 */
function durationLabel(seconds: number): string {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) return `${rest} 秒`;
  return rest === 0 ? `${minutes} 分钟` : `${minutes} 分 ${rest} 秒`;
}

function potionDescription(potion: PotionEntry): string {
  const splash = potion.splash === true;
  const lingering = potion.lingering === true;
  if (potion.variant === 'awkward') {
    if (splash) return '半成品（喷溅版）：扔出去也不会有任何效果。';
    if (lingering) return '半成品（滞留版）：扔出去只会留下一片什么用都没有的云。';
    return '半成品：酿出具体药水之前的中间状态，直接喝没有效果。';
  }
  const tier = potion.tier === 'long' ? '红石粉延长版：' : potion.tier === 'strong' ? '荧石粉强化版：' : '';
  const effects = potion.effects.map((effect) => {
    // ⚠️ 本文件用的是 `enchantments.romanLevel`（**1 起始**，所以 +1）；
    // `StatusEffects` 里那个同名函数吃的是 amplifier（0 → I），两处别抄错
    const level = effect.amplifier > 0 ? ` ${romanLevel(effect.amplifier + 1)}` : '';
    const label = `${EFFECT_LABELS[effect.id]}${level}`;
    // 瞬间效果（治疗/伤害）没有"持续多久"可言——判定与喷溅那边的缩放共用同一个函数
    if (isInstantEffect(effect.id)) return `${label}（立刻生效）`;
    return `${label} ${durationLabel(effect.seconds)}`;
  });
  // 三种用法的文案都与各自的范围/节奏同源（半径、持续、结算间隔都来自 `survival/`）
  const verb = lingering
    ? `扔出去留下一片 ${LINGERING_RADIUS} 格的药水云，云里的实体获得`
    : splash
      ? `扔出去砸中后 ${SPLASH_RADIUS} 格内的实体获得`
      : '喝下获得';
  const tail = lingering
    ? `云持续 ${CLOUD_DURATION} 秒、每 ${CLOUD_PULSE_INTERVAL} 秒结算一次，站得越靠边领到的时长越短。`
    : splash
      ? '离爆心越远时长越短，直接命中的目标拿满时长。'
      : '';
  return `${tier}${verb}${effects.join('、')}。${tail}${POTION_NOTES[potion.variant] ?? ''}`;
}

for (const potion of POTIONS) {
  const key = `potion_${potion.key}`;
  put(key, potion.name);
  DESCRIPTIONS[key] = potionDescription(potion);
}

// ---- 药水箭（K4 最后一步）：28 支，名字与说明同样由数据表生成。
// ⚠️ 说明里的时长必须是**折算之后**的（1/8），否则文案与实际射出去的箭不符——
// 所以这里直接用运行时那条同一个函数（`tippedArrowEffects`），不另抄一份数字。

function tippedArrowDescription(arrow: TippedArrowEntry): string {
  const potion = potionById(arrow.potionId);
  if (!potion || potion.base) return '半成品做的箭：射中生物也不会有任何效果（只能当普通箭用）。';
  const effects = tippedArrowEffects(potion).map((effect) => {
    const level = effect.amplifier > 0 ? ` ${romanLevel(effect.amplifier + 1)}` : '';
    const label = `${EFFECT_LABELS[effect.id]}${level}`;
    if (isInstantEffect(effect.id)) return `${label}（立刻生效）`;
    return `${label} ${durationLabel(effect.seconds)}`;
  });
  return `射中生物后获得${effects.join('、')}（药水箭只给原药水 **1/8** 的时长）。酿造：滞留药水 + 8 支箭 → 8 支。`;
}

for (const arrow of TIPPED_ARROWS) {
  put(arrow.key, arrow.name);
  DESCRIPTIONS[arrow.key] = tippedArrowDescription(arrow);
}

// ---------------------------------------------------------------- 对外接口

/** 由英文 id（可带命名空间）取中文名；查不到就回退成英文 id */
export function translateName(id: string): string {
  const key = id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id;
  return NAMES.get(key) ?? key;
}

/** 方块的中文名 */
export function blockLabel(blockId: number): string {
  const def = BLOCKS[blockId];
  if (!def || def.id === 0) return '空气';
  return translateName(def.name);
}

/** 物品的中文名（方块物品与方块同名） */
export function itemLabel(itemId: number): string {
  const def = itemDef(itemId);
  if (!def) return `未知物品(${itemId})`;
  // 方块物品走方块那张表：`Block.GRASS_BLOCK` 的注册名就是 grass_block
  return translateName(def.name);
}

/**
 * 附魔的展示文案：`附魔：效率 III、耐久 II`。
 * 表里查不到的 id 原样显示——宁可露出一个生 id，也不要默默不显示（那才是真查不出来的 bug）。
 */
export function enchantLabel(enchants?: Readonly<Record<string, number>>): string {
  const parts = enchantList(enchants);
  return parts.length > 0 ? `附魔：${parts.join('、')}` : '';
}

/**
 * 附魔逐条列出（批次 28 的提示框用：一条一行）。
 *
 * 与 `enchantLabel` 共用同一份实现——两个函数各自拼一遍必然会漂
 * （一边显示"效率 IV"、另一边显示"效率 4"）。
 */
export function enchantList(enchants?: Readonly<Record<string, number>>): string[] {
  if (!enchants) return [];
  return Object.entries(enchants).map(
    ([id, level]) => `${enchantmentById(id)?.name ?? id} ${romanLevel(level)}`,
  );
}

/** 中文类别名 */
export function categoryLabel(itemId: number): string {
  const category: ItemCategory = categoryOf(itemId);
  return CATEGORY_LABELS[category] ?? category;
}

/**
 * 物品说明。
 *
 * 只返回**专门写过**的文案；没写过的返回空串——
 * 这种物品的信息量就是"类别 + 堆叠上限"，交给提示框的 meta 那一行显示即可，
 * 在这里再拼一遍会出现两行几乎一样的内容。
 */
export function itemDescription(itemId: number): string {
  const def = itemDef(itemId);
  if (!def) return '';
  const key = def.name.startsWith('minecraft:') ? def.name.slice('minecraft:'.length) : def.name;
  return DESCRIPTIONS[key] ?? '';
}

/** 是否有专门写过的说明（界面用它决定要不要额外显示"类别/堆叠"那行） */
export function hasDescription(itemId: number): boolean {
  const def = itemDef(itemId);
  if (!def) return false;
  const key = def.name.startsWith('minecraft:') ? def.name.slice('minecraft:'.length) : def.name;
  return key in DESCRIPTIONS;
}

/** 提示框要显示的全部内容 */
export interface ItemTooltip {
  /** 主标题：中文名 */
  title: string;
  /** 副标题：英文 id（方便对照 wiki 与配方数据） */
  subtitle: string;
  /**
   * 说明正文。
   * ⚠️ **只放说明**：耐久与附魔各自在下面两行（批次 28 改的）。
   * 原来是"说明｜455/495｜效率 IV"挤成一行用 `｜` 分隔，三样信息量大又读不快。
   */
  description: string;
  /** 耐久文案（`剩余 455 / 495`）；没有耐久概念时为空串 */
  durability: string;
  /** 耐久条的档位（`itemVisuals.durabilityBar`）；不该显示时为 null */
  durabilityBar: { ratio: number; level: string } | null;
  /** 附魔各自的文案（`效率 IV`）；没有附魔时为空数组 */
  enchants: readonly string[];
  /** 稀有度：标题按它上色（附魔 → 稀有、龙蛋 → 史诗…） */
  rarity: ItemRarity;
  /** 是否显示"类别 / 堆叠"那一行 */
  showMeta: boolean;
  category: string;
  maxStack: number;
  /** 数量（>1 时才显示） */
  count: number;
}

/**
 * 提示框内容。
 * @param damage 工具/盔甲的已损耗耐久；不传就不显示耐久那一行
 */
export function itemTooltip(
  itemId: number,
  count = 1,
  damage?: number,
  enchants?: Readonly<Record<string, number>>,
  name?: string,
): ItemTooltip {
  const def = itemDef(itemId);
  const rawName = def?.name ?? 'unknown';
  // 工具与盔甲都用同一个 damage 字段存耐久，这里一并取出来显示
  const durable = toolInfoById(itemId) ?? armorInfoById(itemId);
  const description = itemDescription(itemId);
  const durability = durable && damage !== undefined ? durabilityLabel(durable, damage) : '';
  const bar = durabilityBar(damage, durable?.durability ?? 0);
  // 附魔逐条列出（`效率 IV`、`耐久 III`），由界面一条一行地排——
  // 原来是拼成一句话挤在说明后面，一排附魔会被看漏
  const enchantLines = enchantList(enchants);
  return {
    // 铁砧改过名字就用改过的名字当标题（原版也这样，而且会把原来的名字留在副标题里）
    title: name && name.length > 0 ? name : itemLabel(itemId),
    subtitle: name && name.length > 0 ? `原名 ${itemLabel(itemId)}` : rawName,
    description,
    durability,
    durabilityBar: bar,
    enchants: enchantLines,
    // 附魔的东西按"稀有"上色（与 `rarityOf` 同一个判断）
    rarity: rarityOf(itemId, enchants),
    showMeta: description.length === 0 && durability.length === 0 && enchantLines.length === 0,
    category: categoryLabel(itemId),
    maxStack: maxStackOf(itemId),
    count,
  };
}

/** 供测试与调试：所有有中文名的条目数 */
export function knownNameCount(): number {
  return NAMES.size;
}

/** 供测试用：方块表里还没翻译的条目（应当为空） */
export function missingBlockNames(): string[] {
  const missing: string[] = [];
  for (const def of BLOCKS) {
    if (!def || def.id === 0) continue;
    const key = def.name.replace('minecraft:', '');
    if (!NAMES.has(key)) missing.push(key);
  }
  return missing;
}

// ---------------------------------------------------------------- 名字 → id

/** 物品名索引：英文全名 / 英文短名 / 中文名 / 数字 id 都指向同一个 id */
let itemIndex: Map<string, number> | null = null;
/** 方块名索引：只有方块（放置类命令用） */
let blockIndex: Map<string, number> | null = null;

function buildItemIndex(): Map<string, number> {
  const index = new Map<string, number>();
  for (const id of CREATIVE_ITEMS) {
    const def = itemDef(id);
    if (!def) continue;
    const full = def.name;
    const short = full.startsWith('minecraft:') ? full.slice('minecraft:'.length) : full;
    index.set(full.toLowerCase(), id);
    index.set(short.toLowerCase(), id);
    index.set(itemLabel(id), id);
    index.set(String(id), id);
  }
  return index;
}

function buildBlockIndex(): Map<string, number> {
  const index = new Map<string, number>();
  for (const def of BLOCKS) {
    if (!def || def.id === 0) continue;
    const short = def.name.replace('minecraft:', '');
    index.set(short.toLowerCase(), def.id);
    index.set(def.name.toLowerCase(), def.id);
    index.set(blockLabel(def.id), def.id);
  }
  return index;
}

/**
 * 按名字找物品 id。
 * 接受 `minecraft:stone` / `stone` / `石头` / 数字 id 四种写法——
 * 命令与创造物品栏搜索共用同一套解析，玩家不用记英文。
 */
export function resolveItemId(query: string): number | undefined {
  const raw = query.trim();
  if (raw.length === 0) return undefined;
  if (!itemIndex) itemIndex = buildItemIndex();
  return itemIndex.get(raw.toLowerCase()) ?? itemIndex.get(raw);
}

/** 按名字找方块 id（只含方块；空气用 `air` 或 0） */
export function resolveBlockId(query: string): number | undefined {
  const raw = query.trim();
  if (raw.length === 0) return undefined;
  if (raw === 'air' || raw === 'minecraft:air' || raw === '空气' || raw === '0') return 0;
  if (!blockIndex) blockIndex = buildBlockIndex();
  return blockIndex.get(raw.toLowerCase()) ?? blockIndex.get(raw);
}

/** 供测试与调试：索引规模 */
export function nameIndexSize(): { items: number; blocks: number } {
  if (!itemIndex) itemIndex = buildItemIndex();
  if (!blockIndex) blockIndex = buildBlockIndex();
  return { items: itemIndex.size, blocks: blockIndex.size };
}
