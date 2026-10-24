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

import { BLOCKS, COPPER_STAGES, CORAL_KIND_CN, blockHardness } from './blocks.ts';
import { normalizeId, shortId } from './ids.ts';
import {
  itemCategoryLabel,
  categoryOf,
  CREATIVE_ITEMS,
  itemDef,
  maxStackOf,
  type ItemCategory,
} from './items.ts';
import { ALL_ARMOR_MATERIALS, ARMOR_SPECS, ARMOR_TYPES, armorInfoById } from './armor.ts';
import { effectLabel } from '../survival/StatusEffects.ts';
import { SPLASH_RADIUS, isInstantEffect } from '../survival/SplashPotion.ts';
import { CLOUD_DURATION, CLOUD_PULSE_INTERVAL, LINGERING_RADIUS } from '../survival/PotionCloud.ts';
import { POTIONS, TIPPED_ARROWS, potionById, type PotionEntry, type TippedArrowEntry } from './potions.ts';
import { tippedArrowEffects } from '../survival/TippedArrow.ts';
import { SPAWN_EGG_SPECS, spawnEggTile } from './spawnEggs.ts';
import { enchantmentName, romanLevel } from './enchantments.ts';
import { FOOD_TABLE, saturationFrom } from './food.ts';
import {
  TOOL_SPECS,
  durabilityLabel,
  efficientToolType,
  harvestRequirement,
  toolInfoById,
} from './tools.ts';
import { durabilityBar, rarityOf, type ItemRarity } from './itemVisuals.ts';
// 多语言 P2-1a：物品名从"中文常量"改成"查表 + 模板拼装"，切语言不必重建模块
import { allKeys, t, tp } from '../i18n/I18n.ts';

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

/**
 * 石材基名（多语言 P2-1c）：**原来两张表**（`STRUCTURE_BASES_CN` 只出台阶/楼梯、
 * `STONE_VARIANT_PARENTS_CN` 多出墙）在 4 个 id 上重复，两处文字必须一致才不会"看提交顺序变名字"。
 * 现在合成**一份 id 清单** + 一份**有墙的 id 集合**：
 *   · 清单决定生成哪些名字；集合决定要不要多生成 `_wall`（原先只有石材变体那 28 个有墙）。
 * ⚠️ 不能简单"并对集都出台阶/楼梯/墙"：那会给 `stone` / `bricks` 之类凭空补出墙的名字，
 * 属于**顺手改行为** —— 要补也是另一条（那些 id 现在显示裸英文 id，是既有缺口）。
 */
const STONE_BASE_IDS = [
  'stone',
  'cobblestone',
  'oak_planks',
  'spruce_planks',
  'birch_planks',
  'jungle_planks',
  'acacia_planks',
  'dark_oak_planks',
  'sandstone',
  'stone_bricks',
  'smooth_stone',
  'polished_granite',
  'polished_diorite',
  'polished_andesite',
  'deepslate_bricks',
  'bricks',
  'polished_deepslate',
  'granite',
  'diorite',
  'andesite',
  'mossy_cobblestone',
  'mossy_stone_bricks',
  'cobbled_deepslate',
  'cut_sandstone',
  'smooth_sandstone',
  'blackstone',
  'polished_blackstone',
  'polished_blackstone_bricks',
  'nether_bricks',
  'end_stone_bricks',
  'purpur_block',
  'quartz_block',
  'smooth_quartz',
  'deepslate_tiles',
  'red_nether_bricks',
  'prismarine',
  'prismarine_bricks',
  'dark_prismarine',
  'red_sandstone',
  'cut_red_sandstone',
  'smooth_red_sandstone',
] as const;

/** 这些基名在原版里有"墙"这一形态（对应原来那张 28 行的 `STONE_VARIANT_PARENTS_CN`） */
const WALL_BASE_IDS = new Set<string>([
'granite', 'diorite', 'andesite', 'sandstone', 'deepslate_bricks', 'bricks', 'polished_deepslate', 'mossy_cobblestone', 'mossy_stone_bricks', 'cobbled_deepslate', 'cut_sandstone', 'smooth_sandstone', 'blackstone', 'polished_blackstone', 'polished_blackstone_bricks', 'nether_bricks', 'end_stone_bricks', 'purpur_block', 'quartz_block', 'smooth_quartz', 'deepslate_tiles', 'red_nether_bricks', 'prismarine', 'prismarine_bricks', 'dark_prismarine', 'red_sandstone', 'cut_red_sandstone', 'smooth_red_sandstone',
]);

/**
 * 木板类基名**不单独存名字**：`oak_planks` 就是"橡木 + 木板"，与 `item.tpl.woodPlanks` 同一个词。
 * 这里做一层去重（6 个 id → 0 条新文案），否则每加一种木材要翻两遍同一个词。
 */
function stoneBaseName(base: string): string {
  if (base.endsWith('_planks')) {
    const wood = base.slice(0, -'_planks'.length);
    if (wood in WOODS_CN) return tp('item.tpl.woodPlanks', { wood: t(`item.wood.${wood}`) });
  }
  return t(`item.base.${base}`);
}

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


/**
 * 名字来源：**字符串**（尚未搬进语言表的老形态，P2-2 会全部换掉）或 **函数**。
 *
 * 为什么要函数：物品名要按当前语言拼（`白色羊毛` / `White Wool` / `Weiße Wolle`），
 * 而模块只在启动时求值一次。存成函数就能在**取值那一刻**再查表，
 * 切语言（含测试里 `setLanguage()`）自然跟着变，不用重启模块。
 */
type NameSource = string | (() => string);

const NAMES = new Map<string, NameSource>();

function put(id: string, name: NameSource): void {
  NAMES.set(id, name);
}

/** 染料色的 id（顺序与原 `COLORS_CN` 一致；表在 `locales/<lang>/item.ts`） */
const COLOR_IDS = [
  'white',
  'orange',
  'magenta',
  'light_blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light_gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
] as const;

type ColorId = (typeof COLOR_IDS)[number];

/** 颜色的显示名（`白色` / `White` / `Weiß`） */
function colorName(color: ColorId): string {
  return t(`item.color.${color}`);
}

// 染料系：16 色 × 10 件 = 160 条名字，**语序由语言表里的模板决定**（多语言 P2-1a）
// 模板键：item.dye / item.wool / …，值形如 `{color}染料` / `{color} Wool`
for (const color of COLOR_IDS) {
  put(`${color}_dye`, () => tp('item.tpl.dye', { color: colorName(color) }));
  put(`${color}_wool`, () => tp('item.tpl.wool', { color: colorName(color) }));
  put(`${color}_carpet`, () => tp('item.tpl.carpet', { color: colorName(color) }));
  // 床（B13，批次 79）：16 色，与羊毛/地毯同一条"配色表驱动"
  put(`${color}_bed`, () => tp('item.tpl.bed', { color: colorName(color) }));
  put(`${color}_terracotta`, () => tp('item.tpl.terracottaColored', { color: colorName(color) }));
  put(`${color}_concrete`, () => tp('item.tpl.concrete', { color: colorName(color) }));
  put(`${color}_concrete_powder`, () => tp('item.tpl.concretePowder', { color: colorName(color) }));
  put(`${color}_stained_glass`, () => tp('item.tpl.stainedGlass', { color: colorName(color) }));
  put(`${color}_stained_glass_pane`, () => tp('item.tpl.stainedGlassPane', { color: colorName(color) }));
  // 潜影盒（批次 451）：16 色，与羊毛同一条配色表驱动
  put(`${color}_shulker_box`, () => tp('item.tpl.shulkerBox', { color: colorName(color) }));
}
put('terracotta', () => t('item.terracotta'));
put('glass', () => t('item.glass'));
put('glass_pane', () => t('item.glass_pane'));

// 木头系：原木 / 木板 / 树叶（多语言 P2-1b-1：模板在语言表里，语序由语言决定）
for (const wood of Object.keys(WOODS_CN)) {
  put(`${wood}_log`, () => tp('item.tpl.woodLog', { wood: t(`item.wood.${wood}`) }));
  put(`${wood}_planks`, () => tp('item.tpl.woodPlanks', { wood: t(`item.wood.${wood}`) }));
  put(`${wood}_leaves`, () => tp('item.tpl.woodLeaves', { wood: t(`item.wood.${wood}`) }));
}

// 木制方块族（批次 38）：栅栏 / 栅栏门 / 门 / 活板门
// 与方块表同源（都从木材表展开），加一种木材两边自动跟上——
// 这正是"新加了方块却冒出英文 id"那条老毛病要防的地方
for (const wood of Object.keys(WOODS_CN)) {
  put(`${wood}_fence`, () => tp('item.tpl.woodFence', { wood: t(`item.wood.${wood}`) }));
  put(`${wood}_fence_gate`, () => tp('item.tpl.woodFenceGate', { wood: t(`item.wood.${wood}`) }));
  put(`${wood}_door`, () => tp('item.tpl.woodDoor', { wood: t(`item.wood.${wood}`) }));
  put(`${wood}_trapdoor`, () => tp('item.tpl.woodTrapdoor', { wood: t(`item.wood.${wood}`) }));
  // 告示牌（批次 80）：同一个方块兼作落地牌与挂墙牌，所以名字只有一个
  put(`${wood}_sign`, () => tp('item.tpl.woodSign', { wood: t(`item.wood.${wood}`) }));
}

// 展示框与画（B14，批次 86）：各一条——**画只有一件物品**，
// 挂上去是 10 幅里的哪一幅由放置时决定（见 `registry/paintings.ts`），
// 所以这里不该出现"日出画""壁画"这类按画分条的名字。
// 名字走 `item.item_frame` / `item.painting`（P6-3，批次 20261024-0020）：
// 原来这里是 `put('item_frame', '物品展示框')` 的中文常量，德语界面露中文。

// 珊瑚一族（批次 51）：5 种 × 3 形 × 活/失活 = 30 条中文名，**由"种"表展开**。
// 与方块表（`CORAL_SPECS`）同一套命名规则：少写一种就会冒出英文 id，
// 而"某一格显示 tube_coral_fan"这种事只有玩家看得见
const coralName = (kind: string): string => t(`item.coral.${kind}`);
for (const kind of Object.keys(CORAL_KIND_CN)) {
  // 失活 = `失活的{name}` 再套一层（英文是 `Dead {name}`，语序由模板给）
  const dead = (name: string): string => tp('item.tpl.dead', { name });
  put(`${kind}_coral_block`, () => tp('item.tpl.coralBlock', { coral: coralName(kind) }));
  put(`dead_${kind}_coral_block`, () => dead(tp('item.tpl.coralBlock', { coral: coralName(kind) })));
  put(`${kind}_coral`, () => tp('item.tpl.coral', { coral: coralName(kind) }));
  put(`dead_${kind}_coral`, () => dead(tp('item.tpl.coral', { coral: coralName(kind) })));
  put(`${kind}_coral_fan`, () => tp('item.tpl.coralFan', { coral: coralName(kind) }));
  put(`dead_${kind}_coral_fan`, () => dead(tp('item.tpl.coralFan', { coral: coralName(kind) })));
}

// 台阶 / 楼梯
for (const base of STONE_BASE_IDS) {
  put(`${base}_slab`, () => tp('item.tpl.slab', { base: stoneBaseName(base) }));
  put(`${base}_stairs`, () => tp('item.tpl.stairs', { base: stoneBaseName(base) }));
  if (WALL_BASE_IDS.has(base)) put(`${base}_wall`, () => tp('item.tpl.wall', { base: stoneBaseName(base) }));
}



// 铜的四档（批次 40）：铜块 / 斑驳的铜块 / 锈蚀的铜块 / 氧化的铜块 + 切制铜家族。
// 名字由 `COPPER_STAGES` 展开（与方块表同源），加一档氧化不会漏名字。
// ⚠️ 中文名的语序不是"前缀 + 块"：斑驳的是"斑驳的铜块"、切制那支是"斑驳的切制铜"，
// 所以两种写法各列一份，不要拿一个前缀去拼。
COPPER_STAGES.forEach((stage, index) => {
  put(stage.blockTile, () => t(`item.copper.block.${index}`));
  put(stage.cutTile, () => t(`item.copper.cut.${index}`));
  put(`${stage.cutTile}_slab`, () => tp('item.tpl.slab', { base: t(`item.copper.cut.${index}`) }));
  put(`${stage.cutTile}_stairs`, () => tp('item.tpl.stairs', { base: t(`item.copper.cut.${index}`) }));
});

// 矿石：`coal_ore` = 煤矿石，`deepslate_coal_ore` = 深层煤矿石
for (const ore of Object.keys(ORE_NAMES_CN)) {
  put(`${ore}_ore`, () => t(`item.ore.${ore}`));
  put(`deepslate_${ore}_ore`, () => tp('item.tpl.deepslateOre', { name: t(`item.ore.${ore}`) }));
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
for (const material of Object.keys(TOOL_MATERIALS_CN)) {
  for (const kind of Object.keys(TOOL_KINDS_CN)) {
    put(`${material}_${kind}`, () =>
      tp('item.tpl.tool', { material: t(`item.toolMaterial.${material}`), kind: t(`item.toolKind.${kind}`) }));
  }
}

// 盔甲：部位 × 材质 = 24 件（皮革头盔 / 锁链胸甲 / 铁护腿 / 钻石靴子 / 下界合金头盔……）
for (const material of ALL_ARMOR_MATERIALS) {
  for (const type of ARMOR_TYPES) {
    put(`${material}_${type}`, () =>
      tp('item.tpl.armor', { material: t(`item.armorMaterial.${material}`), type: t(`item.armorType.${type}`) }));
  }
}

// ---------------------------------------------------------------- 显式表


// 红石元件（多语言 P2-1b-2）：键**写死**，不走 `item.${id}` —— 前缀 `item.` 太短，会把整个命名空间洗白，孤儿判据就废了
put('redstone_wire', () => t('item.redstone_wire'));
put('redstone_torch', () => t('item.redstone_torch'));
put('redstone_block', () => t('item.redstone_block'));
put('lever', () => t('item.lever'));
put('stone_button', () => t('item.stone_button'));
put('oak_button', () => t('item.oak_button'));
put('stone_pressure_plate', () => t('item.stone_pressure_plate'));
put('oak_pressure_plate', () => t('item.oak_pressure_plate'));
put('repeater', () => t('item.repeater'));
put('comparator', () => t('item.comparator'));
put('redstone_lamp', () => t('item.redstone_lamp'));
put('piston', () => t('item.piston'));
put('piston_head', () => t('item.piston_head'));
put('sticky_piston', () => t('item.sticky_piston'));
put('observer', () => t('item.observer'));
put('iron_door', () => t('item.iron_door'));
put('iron_trapdoor', () => t('item.iron_trapdoor'));
put('oak_trapdoor', () => t('item.oak_trapdoor'));
put('note_block', () => t('item.note_block'));
put('dispenser', () => t('item.dispenser'));
put('dropper', () => t('item.dropper'));
put('barrel', () => t('item.barrel'));
put('composter', () => t('item.composter'));
put('ender_chest', () => t('item.ender_chest'));
put('trapped_chest', () => t('item.trapped_chest'));
put('shulker_box', () => t('item.shulker_box'));
put('hopper', () => t('item.hopper'));
put('target', () => t('item.target'));
put('daylight_detector', () => t('item.daylight_detector'));
put('tripwire', () => t('item.tripwire'));
put('tripwire_hook', () => t('item.tripwire_hook'));
put('slime_block', () => t('item.slime_block'));
put('rail', () => t('item.rail'));
put('powered_rail', () => t('item.powered_rail'));
put('detector_rail', () => t('item.detector_rail'));
put('activator_rail', () => t('item.activator_rail'));
put('light_weighted_pressure_plate', () => t('item.light_weighted_pressure_plate'));
put('heavy_weighted_pressure_plate', () => t('item.heavy_weighted_pressure_plate'));

// ---------------------------------------------------------------- 说明

/**
 * 说明文案。
 *
 * 只写"光看图标看不出来"的信息：矿石在哪一层、这个能当燃料、右键能打开什么界面。
 * 普通建材不写（写"一种方块"没有意义）。
 */
/**
 * 说明表。值是**字符串**（还没搬走的静态条目）或**惰性函数**（模板拼装，多语言 P2-3c1）。
 * 惰性求值的理由同 `NAMES`：切语言（含测试里 `setLanguage()`）后要立刻拿到新文案。
 */
const DESCRIPTIONS: Record<string, string | (() => string)> = {
  // 平滑石头（批次 528，用户点名）：它没有专门说明时只剩标题 + 英文 id
  // ---- 可疑的炖菜（批次 57）：5 种花各自的文案由下面这一小段循环生成
  // ---- 钓鱼（批次 81，G11）：文案已进 `item.desc.fishing_rod`（P6-3，批次 20261024-0020）
  // 黑石家族（批次 82）：堡垒遗迹的建材。说明写清"它从哪来"——
  // 这三块都不在合成链的主干上，玩家第一次见它们多半是在下界的堡垒里
};

// 深层矿石统一补一句
for (const ore of Object.keys(ORE_NAMES_CN)) {
  DESCRIPTIONS[`deepslate_${ore}_ore`] = () => tp('item.desc.tpl.deepslateOre', { ore: t(`item.ore.${ore}`) });
}

// 告示牌（B12，批次 80）：6 种木材共用一段说明（差别只有木料颜色）
for (const wood of Object.keys(WOODS_CN)) {
  DESCRIPTIONS[`${wood}_sign`] = () => tp('item.desc.tpl.sign', { wood: t(`item.wood.${wood}`) });
}

// 展示框与画（B14，批次 86）

// 混凝土粉末（批次 131）：16 色共用一段说明（差别只有颜色，按配色表套模板）
for (const color of Object.keys(COLORS_CN)) {
  DESCRIPTIONS[`${color}_concrete_powder`] = () =>
    tp('item.desc.tpl.concretePowder', { color: t(`item.color.${color}`) });
}

// 床（B13，批次 79）：16 色的说明是同一段（差别只有颜色，所以按配色表套模板）
for (const color of Object.keys(COLORS_CN)) {
  DESCRIPTIONS[`${color}_bed`] = () => tp('item.desc.tpl.bed', { color: t(`item.color.${color}`) });
}

// 珊瑚一族（批次 51）：30 件的说明按"形 × 活/失活"**四套模板**套上"种"的中文名——
// 一个一个手写 30 段必然出现"某一种的文案写的是另一种的颜色"
for (const kind of Object.keys(CORAL_KIND_CN)) {
  const coral = (): string => t(`item.coral.${kind}`);
  DESCRIPTIONS[`${kind}_coral_block`] = () => tp('item.desc.tpl.coralBlock', { coral: coral() });
  DESCRIPTIONS[`dead_${kind}_coral_block`] = () => tp('item.desc.tpl.deadCoralBlock', { coral: coral() });
  DESCRIPTIONS[`${kind}_coral`] = () => tp('item.desc.tpl.coral', { coral: coral() });
  DESCRIPTIONS[`dead_${kind}_coral`] = () => tp('item.desc.tpl.deadCoral', { coral: coral() });
  DESCRIPTIONS[`${kind}_coral_fan`] = () => tp('item.desc.tpl.coralFan', { coral: coral() });
  DESCRIPTIONS[`dead_${kind}_coral_fan`] = () => tp('item.desc.tpl.deadCoralFan', { coral: coral() });
}

// 铜的四档（批次 40）：说明写清"会氧化、斧头能刮、刮了会退一档"
COPPER_STAGES.forEach((stage, index) => {
  const block = (): string => t(`item.copper.block.${index}`);
  const cut = (): string => t(`item.copper.cut.${index}`);
  // "氧化到下一档 / 斧头刮回上一档"这两句本身也是模板：它们嵌着**相邻档位的名字**，
  // 而档位名要按当前语言取 —— 所以这里拼的不是字符串，是"取文案的函数"
  const oxidize = (): string =>
    index + 1 < COPPER_STAGES.length
      ? tp('item.desc.tpl.oxidizeTo', { next: t(`item.copper.block.${index + 1}`) })
      : t('item.desc.tpl.oxidizedFinal');
  const scrape = (): string =>
    index > 0 ? tp('item.desc.tpl.scrapeTo', { prev: t(`item.copper.block.${index - 1}`) }) : t('item.desc.tpl.scrapeNone');
  DESCRIPTIONS[stage.blockTile] = () => tp('item.desc.tpl.copperBlock', { oxidize: oxidize(), scrape: scrape() });
  DESCRIPTIONS[stage.cutTile] = () => tp('item.desc.tpl.cutCopper', { block: block(), cut: cut() });
  DESCRIPTIONS[`${stage.cutTile}_slab`] = () => tp('item.desc.tpl.copperSlab', { cut: cut() });
  DESCRIPTIONS[`${stage.cutTile}_stairs`] = () => tp('item.desc.tpl.copperStairs', { cut: cut() });
});

// 工具与武器的说明由属性表生成：新加一把工具就自带说明，不会漏
for (const spec of TOOL_SPECS) {
  // 说明由属性表 + 语言表拼：材质/种类/等级词都按当前语言取（多语言 P2-3c2）
  DESCRIPTIONS[`${spec.tool.material}_${spec.tool.type}`] = () =>
    tp('item.desc.tpl.tool', {
      material: t(`item.toolMaterial.${spec.tool.material}`),
      kind: t(`item.toolKind.${spec.tool.type}`),
      desc: t(`item.desc.tpl.toolKind.${spec.tool.type}`),
      tier: t(`item.desc.tpl.toolTier.${spec.tool.tier}`),
      speed: spec.tool.speed,
      attack: spec.tool.attack,
      durability: spec.tool.durability,
    });
}

// 盔甲的说明同样从属性表生成。
// "满套 N 点"是新手最想知道的那个数，所以顺手按材质算出来写进说明里
const armorSetTotals = new Map<string, number>();
for (const spec of ARMOR_SPECS) {
  armorSetTotals.set(spec.armor.material, (armorSetTotals.get(spec.armor.material) ?? 0) + spec.armor.defense);
}
for (const spec of ARMOR_SPECS) {
  DESCRIPTIONS[`${spec.armor.material}_${spec.armor.type}`] = () =>
    tp('item.desc.tpl.armor', {
      material: t(`item.armorMaterial.${spec.armor.material}`),
      type: t(`item.armorType.${spec.armor.type}`),
      desc: t(`item.desc.tpl.armorType.${spec.armor.type}`),
      defense: spec.armor.defense,
      toughness: spec.armor.toughness > 0 ? tp('item.desc.tpl.toughness', { value: spec.armor.toughness }) : '',
      durability: spec.armor.durability,
      total: armorSetTotals.get(spec.armor.material)!,
    });
}

// 食物的说明也由数值表生成：饥饿与饱和度是玩家最关心的两个数，
// 而附加效果（腐肉/生鸡肉的饥饿）不写出来玩家根本不知道，会以为吃了没事。
//
// 多语言 P5-4（[发现] 食物说明键化）：这族原来把「饥饿 +N」「饱和度 +N」「饥饿满时也能吃」
// 与「N% 概率<效果> N 级 N 秒」直接拼在代码里 —— 德语/俄语界面上会露出中文。
// 现在每个片段都进表（`item.desc.food.*`），连**分隔符**与**句号**也是：
// 中文用全角 `｜` + `。`，其它语言用 ` | ` + `.`；片段的先后顺序与单位写法由各语言自己排
// （德语 `30 s auf Stufe 2`、俄语 `30 сек., уровень 2` 的语序不同，拼不出来）。
for (const [key, food] of Object.entries(FOOD_TABLE)) {
  // ⚠️ 必须是**函数**，不能是字符串：模块加载时求值一次的话，
  // 记下来的是"那一刻的语言"（默认中文），之后切语言这条说明不会跟着变。
  // 工具/盔甲那两族一开始就写成 `() => tp(...)`，所以没踩到；食物这族原来拼的是纯中文常量，
  // 看起来"（反正只有中文）没问题"，一旦键化就立刻暴露成"界面换了语言、说明还是中文"。
  DESCRIPTIONS[key] = () => {
    const parts = [
      tp('item.desc.food.hunger', { n: food.hunger }),
      tp('item.desc.food.saturation', { n: saturationFrom(food).toFixed(1) }),
    ];
    if (food.alwaysEdible) parts.push(t('item.desc.food.alwaysEdible'));
    for (const effect of food.effects ?? []) {
      // 秒数先过 `durationSeconds` 片段，拿到**带单位**的字符串（中文 `30 秒` / 德语 `30 s` /
      // 俄语 `30 сек.`）—— 单位的写法与位置各语言不同，不能在这里拼。
      const seconds = tp('item.desc.tpl.durationSeconds', { n: effect.seconds });
      const power =
        effect.amplifier > 0
          ? tp('item.desc.food.powerLeveled', { level: effect.amplifier + 1, seconds })
          : tp('item.desc.food.power', { seconds });
      const label = effectLabel(effect.id);
      parts.push(
        effect.chance === undefined
          ? tp('item.desc.food.effect', { label, power })
          : tp('item.desc.food.effectChance', { chance: Math.round(effect.chance * 100), label, power }),
      );
    }
    return `${parts.join(t('item.desc.food.sep'))}${t('item.desc.tpl.potionEnd')}`;
  };
}

// ---- 药水（H10）：24 瓶的名字与说明都由 `potions.ts` 的变体表生成。
// 只有两处信息需要人写：**档位前缀**（延长/强化，由 `tier` 决定）与
// **效果本身的注意事项**（中毒不致死之类，下表）。


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
  if (minutes === 0) return tp('item.desc.tpl.durationSeconds', { n: rest });
  return rest === 0
    ? tp('item.desc.tpl.durationMinutes', { n: minutes })
    : tp('item.desc.tpl.durationMixed', { m: minutes, s: rest });
}

function potionDescription(potion: PotionEntry): string {
  const splash = potion.splash === true;
  const lingering = potion.lingering === true;
  if (potion.variant === 'awkward') {
    if (splash) return t('item.desc.tpl.potionBaseSplash');
    if (lingering) return t('item.desc.tpl.potionBaseLingering');
    return t('item.desc.tpl.potionBase');
  }
  const tier =
    potion.tier === 'long'
      ? t('item.desc.tpl.potionTierLong')
      : potion.tier === 'strong'
        ? t('item.desc.tpl.potionTierStrong')
        : '';
  const effects = potion.effects.map((effect) => {
    // ⚠️ 本文件用的是 `enchantments.romanLevel`（**1 起始**，所以 +1）；
    // `StatusEffects` 里那个同名函数吃的是 amplifier（0 → I），两处别抄错
    const level = effect.amplifier > 0 ? ` ${romanLevel(effect.amplifier + 1)}` : '';
    const label = `${effectLabel(effect.id)}${level}`;
    // 瞬间效果（治疗/伤害）没有"持续多久"可言——判定与喷溅那边的缩放共用同一个函数
    if (isInstantEffect(effect.id)) return tp('item.desc.tpl.effectInstant', { label });
    return tp('item.desc.tpl.effectTimed', { label, duration: durationLabel(effect.seconds) });
  });
  // 三种用法的文案都与各自的范围/节奏同源（半径、持续、结算间隔都来自 `survival/`）
  const verb = lingering
    ? tp('item.desc.tpl.potionVerbLingering', { radius: LINGERING_RADIUS })
    : splash
      ? tp('item.desc.tpl.potionVerbSplash', { radius: SPLASH_RADIUS })
      : t('item.desc.tpl.potionVerbDrink');
  const tail = lingering
    ? tp('item.desc.tpl.potionTailLingering', { duration: CLOUD_DURATION, interval: CLOUD_PULSE_INTERVAL })
    : splash
      ? t('item.desc.tpl.potionTailSplash')
      : '';
  const note =
    potion.variant === 'poison'
      ? t('item.desc.tpl.potionNotePoison')
      : potion.variant === 'slowness'
        ? t('item.desc.tpl.potionNoteSlowness')
        : '';
  const sep = t('item.desc.tpl.listSep');
  return `${tier}${verb}${effects.join(sep)}${t('item.desc.tpl.potionEnd')}${tail}${note}`;
}

/**
 * 药水的显示名（P6-2，批次 20261024-0020）。
 *
 * 名字由 `variant` / `tier` / `splash` / `lingering` 四个字段拼出来，**不再用 `potion.name`**
 * 那个中文串（它是构建时算好的整句，切语言不会变）。
 *
 * ⚠️ `tp()` 的键必须写成**模板字面量**（三个分支各一处），`audit:i18n` 靠这个形态认出
 * "这一族键是数据驱动取的"；拼成变量的话这 22 条会被判成孤儿键。
 */
function potionDisplayName(potion: PotionEntry): string {
  const effect = t(`item.potionEffect.${potion.variant}`);
  // ⚠️ 本文件的 `romanLevel` 是 **1 起始**（enchantments 版）；药水的 `amplifier` 是 0 起始
  // （0 → I）。不加 1 会把「力量 II」印成「力量 I」—— `potions.ts` 用的是 `StatusEffects` 版那个
  // `romanLevel`（直接吃 amplifier），两处同名不同口径，别抄混。
  const level = potion.tier === 'strong' ? romanLevel(potion.effects[0]!.amplifier + 1) : '';
  const suffix = potion.tier === 'long' ? t('item.potionSuffixLong') : level === '' ? '' : ` ${level}`;
  const base = potion.lingering
    ? tp('item.tpl.potionLingering', { effect })
    : potion.splash
      ? tp('item.tpl.potionSplash', { effect })
      : tp('item.tpl.potion', { effect });
  return `${base}${suffix}`;
}

/** 药水箭的显示名：`药水箭（{效果}{档位}）`，档位是" · 延长"或" · II" */
function arrowDisplayName(arrow: TippedArrowEntry): string {
  const effect = t(`item.potionEffect.${arrow.variant}`);
  const suffix =
    arrow.tier === 'long'
      ? t('item.arrowSuffixLong')
      : arrow.tier === 'strong'
        ? tp('item.tpl.arrowLevel', { level: romanLevel(arrow.effects[0]!.amplifier + 1) })
        : '';
  return tp('item.tpl.tippedArrow', { effect, suffix });
}

// ---- 木材与作物茎（B4b，批次 20261024-0136）：**53 个方块只写 8 条模板**
//
// 木材是"树种 × 形状"的组合：6 种 × {原木/木板/树叶/木头/去皮原木} = 30 条说明。
// 逐条写会得到 30 段只差一个词的文案，翻译时还要再乘 6 —— 模板一条顶五条。
//
// ⚠️ `{wood}` 在各语言里的**语法形态不同**（中文"橡木"是名词前缀、德语 `Eichen` 是合成词干、
// 俄语 `Дубов` 是形容词干），所以模板不是"同一个句式",而是每种语言各自排 —— 这是模板能做到、
// 拼接做不到的地方（`{wood}stamm` → `Eichenstamm`，`{wood}ое бревно` → `Дубовое бревно`）。
const WOOD_KEYS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'] as const;
for (const wood of WOOD_KEYS) {
  // ⚠️ 取值必须在**函数里**做：写在外面就成了"模块加载时那一刻的语言"（P6 那条坑）
  DESCRIPTIONS[`${wood}_log`] = () => tp('item.desc.tpl.woodLog', { wood: t(`item.wood.${wood}`) });
  DESCRIPTIONS[`${wood}_planks`] = () => tp('item.desc.tpl.woodPlanks', { wood: t(`item.wood.${wood}`) });
  DESCRIPTIONS[`${wood}_leaves`] = () => tp('item.desc.tpl.woodLeaves', { wood: t(`item.wood.${wood}`) });
  DESCRIPTIONS[`${wood}_wood`] = () => tp('item.desc.tpl.wood', { wood: t(`item.wood.${wood}`) });
  DESCRIPTIONS[`stripped_${wood}_log`] = () => tp('item.desc.tpl.strippedLog', { wood: t(`item.wood.${wood}`) });
}

// 作物茎的 8 个生长阶段 + "已连上果实"的那一支：3 条模板覆盖 18 个方块
for (const crop of ['pumpkin', 'melon'] as const) {
  for (let stage = 0; stage < 8; stage += 1) {
    DESCRIPTIONS[`${crop}_stem_stage${stage}`] = () => tp('item.desc.tpl.stemStage', { crop: t(`item.${crop}`), stage });
  }
  DESCRIPTIONS[`attached_${crop}_stem`] = () => tp('item.desc.tpl.attachedStem', { crop: t(`item.${crop}`) });
}

DESCRIPTIONS.mushroom_stem = () => t('item.desc.tpl.mushroomStem');
// ---- 台阶 / 楼梯 / 墙（B4c，批次 20261024-0136）：95 个方块只写 3 条模板
//
// 这 95 个全是「{base} + 形状」，说明的差别只在基座名与形状用途。三种形状各一条模板。
//
// ⚠️ 基座名有两种来源，别混：**显式物品名**（`item.cobblestone` = 圆石）与**模板拼的**（木板走
// `item.tpl.woodPlanks`，`item.oak_planks` 这个键根本不存在）。后者若直接用 `t('item.oak_planks')`
// 会拿到键名本身 —— 实测就是这样发现 6 种木板的基座名全是 `item.xxx_planks`。
const SHAPE_BASES = [
  'stone', 'cobblestone', 'mossy_cobblestone', 'stone_bricks', 'mossy_stone_bricks', 'bricks',
  'sandstone', 'cut_sandstone', 'smooth_sandstone', 'red_sandstone', 'cut_red_sandstone',
  'smooth_red_sandstone', 'granite', 'polished_granite', 'diorite', 'polished_diorite',
  'andesite', 'polished_andesite', 'deepslate_bricks', 'cobbled_deepslate', 'polished_deepslate',
  'deepslate_tiles', 'blackstone', 'polished_blackstone', 'polished_blackstone_bricks',
  'nether_bricks', 'red_nether_bricks', 'quartz_block', 'smooth_quartz', 'purpur_block',
  'prismarine', 'prismarine_bricks', 'dark_prismarine', 'end_stone_bricks', 'smooth_stone',
] as const;
for (const base of SHAPE_BASES) {
  DESCRIPTIONS[`${base}_stairs`] = () => tp('item.desc.tpl.stairs', { base: t(`item.${base}`) });
  DESCRIPTIONS[`${base}_slab`] = () => tp('item.desc.tpl.slab', { base: t(`item.${base}`) });
  DESCRIPTIONS[`${base}_wall`] = () => tp('item.desc.tpl.wall', { base: t(`item.${base}`) });
}
// ---- 颜色族第一批（B4d，批次 20261024-0136）：80 个方块只写 5 条模板
//
// 羊毛 / 地毯 / 混凝土 / 染色玻璃 / 染色玻璃板 —— 每种 16 色，共 80 个。
// **`{name}` 传的是"整件物品名"而不是颜色词**：物品名本身已经是各语言的正确形式
// （中文"白色羊毛"、德语 `Weißwolle`、俄语 `Шерсть (Белый)`、法语 `Laine (blanc)`），
// 所以说明模板不用再操心性数配合 —— 这是比"颜色词 + 形状词拼接"更稳的一层复用。
const COLOR_KEYS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
] as const;
for (const color of COLOR_KEYS) {
  // 每个形状各自一条分支：键必须写成字面量，`audit:i18n` 才认得出这一族被引用了
  DESCRIPTIONS[`${color}_wool`] = () =>
    tp('item.desc.tpl.wool', { name: tp('item.tpl.wool', { color: t(`item.color.${color}`) }) });
  DESCRIPTIONS[`${color}_carpet`] = () =>
    tp('item.desc.tpl.carpet', { name: tp('item.tpl.carpet', { color: t(`item.color.${color}`) }) });
  DESCRIPTIONS[`${color}_concrete`] = () =>
    tp('item.desc.tpl.concrete', { name: tp('item.tpl.concrete', { color: t(`item.color.${color}`) }) });
  DESCRIPTIONS[`${color}_stained_glass`] = () =>
    tp('item.desc.tpl.stainedGlass', { name: tp('item.tpl.stainedGlass', { color: t(`item.color.${color}`) }) });
  DESCRIPTIONS[`${color}_stained_glass_pane`] = () =>
    tp('item.desc.tpl.stainedGlassPane', { name: tp('item.tpl.stainedGlassPane', { color: t(`item.color.${color}`) }) });
}

// ---- 收尾批（B4h，批次 20261024-0136）：染料 16 + 木质按钮/压力板 12 + 涂蜡铜块 4 走 4 条模板
for (const color of COLOR_KEYS) {
  DESCRIPTIONS[`${color}_dye`] = () =>
    tp('item.desc.tpl.dye', { name: tp('item.tpl.dye', { color: t(`item.color.${color}`) }) });
}
for (const wood of WOOD_KEYS) {
  DESCRIPTIONS[`${wood}_button`] = () => tp('item.desc.tpl.woodButton', { name: t(`item.${wood}_button`) });
  DESCRIPTIONS[`${wood}_pressure_plate`] = () => tp('item.desc.tpl.woodPressurePlate', { name: t(`item.${wood}_pressure_plate`) });
}
for (const key of ['waxed_copper_block', 'waxed_exposed_copper', 'waxed_weathered_copper', 'waxed_oxidized_copper'] as const) {
  DESCRIPTIONS[key] = () => tp('item.desc.tpl.waxedCopper', { name: t(`item.${key}`) });
}

// ---- 木质围栏 / 栅栏门 / 门 / 活板门（B4g，批次 20261024-0136）：21 个方块只写 4 条模板
//
// `{name}` 传整件物品名（`item.oak_fence` = 橡木栅栏）—— 这个名字在表里是**生成的显式键**，
// 直接 `t()` 就能拿到，不必再拼一次构件。
for (const wood of WOOD_KEYS) {
  DESCRIPTIONS[`${wood}_fence`] = () => tp('item.desc.tpl.woodFence', { name: t(`item.${wood}_fence`) });
  DESCRIPTIONS[`${wood}_fence_gate`] = () => tp('item.desc.tpl.woodFenceGate', { name: t(`item.${wood}_fence_gate`) });
  DESCRIPTIONS[`${wood}_door`] = () => tp('item.desc.tpl.woodDoor', { name: t(`item.${wood}_door`) });
  DESCRIPTIONS[`${wood}_trapdoor`] = () => tp('item.desc.tpl.woodTrapdoor', { name: t(`item.${wood}_trapdoor`) });
}

// ---- 作物生长阶段（B4f，批次 20261024-0136）：15 个方块只写 2 条模板
//
// ⚠️ 名字里是**复数**（`carrots_stage0` / `potatoes_stage0` / `beetroots_stage0`），
// 而 `item.<crop>` 的键是单数 —— 拼前缀时踩过一次 `potato + s` = `potatos` 的坑，
// 这里用显式三元组把"名字前缀"与"物品键"分开写，不靠字符串加法。
const CROP_STAGES = [
  ['carrots', 'carrot'],
  ['potatoes', 'potato'],
  ['beetroots', 'beetroot'],
] as const;
for (const [prefix, crop] of CROP_STAGES) {
  for (let stage = 0; stage < 4; stage += 1) {
    DESCRIPTIONS[`${prefix}_stage${stage}`] = () =>
      tp('item.desc.tpl.cropStage', { crop: t(`item.${crop}`), stage });
  }
}
for (let stage = 1; stage <= 3; stage += 1) {
  DESCRIPTIONS[`sweet_berry_bush_stage${stage}`] = () => tp('item.desc.tpl.berryBush', { stage });
}

// ---- 颜色族第二批（B4e，批次 20261024-0136）：80 个方块只写 5 条模板
//
// 陶瓦 / 带釉陶瓦 / 蜡烛 / 旗帜 / 潜影盒，各 16 色。
//
// ⚠️ `{name}` 有两种来源，别混：
//  · 陶瓦与潜影盒的名字是**模板拼的**（`item.tpl.terracottaColored` / `item.tpl.shulkerBox`，
//    `item.white_terracotta` 这个键**不存在**）；
//  · 带釉陶瓦 / 蜡烛 / 旗帜的名字是**显式键**（`item.white_glazed_terracotta` 等）。
// 用错的那种会拿到键名本身（B4c 的木板就是这个坑）。
for (const color of COLOR_KEYS) {
  const colorName = () => t(`item.color.${color}`);
  DESCRIPTIONS[`${color}_terracotta`] = () =>
    tp('item.desc.tpl.coloredTerracotta', { name: tp('item.tpl.terracottaColored', { color: colorName() }) });
  DESCRIPTIONS[`${color}_glazed_terracotta`] = () =>
    tp('item.desc.tpl.glazedTerracotta', { name: t(`item.${color}_glazed_terracotta`) });
  DESCRIPTIONS[`${color}_candle`] = () => tp('item.desc.tpl.candle', { name: t(`item.${color}_candle`) });
  DESCRIPTIONS[`${color}_banner`] = () => tp('item.desc.tpl.banner', { name: t(`item.${color}_banner`) });
  DESCRIPTIONS[`${color}_shulker_box`] = () =>
    tp('item.desc.tpl.shulkerBox', { name: tp('item.tpl.shulkerBox', { color: colorName() }) });
}


// ⚠️ 石砖墙的 id 是**单数**（`stone_brick_wall`），与另外两个形状（`stone_bricks_stairs` /
// `stone_bricks_slab`）不一致 —— 遍历基座表碰不到它，只能单独补一条。
DESCRIPTIONS['stone_brick_wall'] = () => tp('item.desc.tpl.wall', { base: t('item.stone_bricks') });

// 木板基座：名字由 `item.tpl.woodPlanks` 拼（`item.oak_planks` 这种键不存在）
for (const wood of WOOD_KEYS) {
  const label = () => tp('item.tpl.woodPlanks', { wood: t(`item.wood.${wood}`) });
  DESCRIPTIONS[`${wood}_planks_stairs`] = () => tp('item.desc.tpl.stairs', { base: label() });
  DESCRIPTIONS[`${wood}_planks_slab`] = () => tp('item.desc.tpl.slab', { base: label() });
  DESCRIPTIONS[`${wood}_planks_wall`] = () => tp('item.desc.tpl.wall', { base: label() });
}


for (const potion of POTIONS) {
  const key = `potion_${potion.key}`;
  // 函数形态：取值这一刻才查表，所以切语言后名字立刻变（`translateName` 支持函数）
  put(key, () => potionDisplayName(potion));
  DESCRIPTIONS[key] = () => potionDescription(potion);
}

// ---- 药水箭（K4 最后一步）：28 支，名字与说明同样由数据表生成。
// ⚠️ 说明里的时长必须是**折算之后**的（1/8），否则文案与实际射出去的箭不符——
// 所以这里直接用运行时那条同一个函数（`tippedArrowEffects`），不另抄一份数字。

function tippedArrowDescription(arrow: TippedArrowEntry): string {
  const potion = potionById(arrow.potionId);
  if (!potion || potion.base) return t('item.desc.tpl.tippedArrowBase');
  const effects = tippedArrowEffects(potion).map((effect) => {
    const level = effect.amplifier > 0 ? ` ${romanLevel(effect.amplifier + 1)}` : '';
    const label = `${effectLabel(effect.id)}${level}`;
    if (isInstantEffect(effect.id)) return tp('item.desc.tpl.effectInstant', { label });
    return tp('item.desc.tpl.effectTimed', { label, duration: durationLabel(effect.seconds) });
  });
  return tp('item.desc.tpl.tippedArrowBody', { list: effects.join(t('item.desc.tpl.listSep')) });
}

for (const arrow of TIPPED_ARROWS) {
  put(arrow.key, () => arrowDisplayName(arrow));
  DESCRIPTIONS[arrow.key] = () => tippedArrowDescription(arrow);
}

// ---------------------------------------------------------------- 刷怪蛋（批次 174，J17）
//
// 21 枚蛋的名字与说明都由**同一张规格表**派生（`registry/spawnEggs.ts`）：
// 手抄 21 行"僵尸刷怪蛋/骷髅刷怪蛋…"迟早会漏一个，而漏掉的那枚在界面上会显示成英文 id。
for (const spec of SPAWN_EGG_SPECS) {
  const key = spawnEggTile(spec.mobId);
  // 刷怪蛋（多语言 P2-1b-2）：结构先接好；`{mob}` 现在还是中文名，P2-4 把生物名键化后自动跟着变
  put(key, () => tp('item.tpl.spawnEgg', { mob: t(`entity.${spec.mobId}`) }));
  DESCRIPTIONS[key] = () => tp('item.desc.tpl.spawnEgg', { mob: t(`entity.${spec.mobId}`) });
}

// ---------------------------------------------------------------- 对外接口

/** 由英文 id（可带命名空间）取中文名；查不到就回退成英文 id */
/**
 * 由英文 id（可带命名空间）取当前语言的名字。
 *
 * 三级查找（多语言 P2-2）：
 *  ① **族拼装表** `NAMES`：颜色/木材/工具这类"构件 + 模板"生成的名字；
 *  ② **语言表里的 `item.<id>`**：显式名字（481 条），查不到说明这条没有词条；
 *  ③ 都查不到 → 回退成注册 id（宁可露出 `grasss_block` 让人发现，也不要显示空串）。
 */
export function translateName(id: string): string {
  const key = shortId(id);
  const value = NAMES.get(key);
  if (value !== undefined) {
    // 函数形态（多语言 P2-1a）：**取值这一刻**才查表，所以切语言后立刻是新的
    return typeof value === 'function' ? value() : value;
  }
  // ⚠️ 必须写成**模板字面量**而不是 `t(probe)`：`audit:i18n` 靠它认出"这一族键是数据驱动取的"，
  // 写成变量的话 481 条 `item.<id>` 会全被判成孤儿，那份报告就没法看了。
  const probe = `item.${key}`;
  const text = t(`item.${key}`);
  return text === probe ? key : text;
}

/** 这个名字有来源吗（族拼装表，或 `item.<id>` 在语言表里命中） */
function hasName(key: string): boolean {
  if (NAMES.has(key)) return true;
  const probe = `item.${key}`;
  return t(`item.${key}`) !== probe;
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
    ([id, level]) => `${enchantmentName(id)} ${romanLevel(level)}`,
  );
}

/** 中文类别名 */
export function categoryLabel(itemId: number): string {
  const category: ItemCategory = categoryOf(itemId);
  return itemCategoryLabel(category);
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
  const key = shortId(def.name);
  // 多语言 P2-3：先查语言表（`item.desc.<id>`，模板字面量让审计能认出这一族）；
  // 还没搬过来的仍走旧表，两部分互不重叠
  const probe = `item.desc.${key}`;
  const text = t(`item.desc.${key}`);
  if (text !== probe) return text;
  const value = DESCRIPTIONS[key];
  if (value === undefined) return '';
  return typeof value === 'function' ? value() : value;
}

/** 方块形状的一句话说明（通用说明用；没列到的走"完整方块"） */
const BLOCK_SHAPE_HINTS: Readonly<Record<string, string>> = {
  slab: '台阶：只占半格高，可以上下叠成完整方块。',
  stairs: '楼梯：可以朝四个方向摆，走上去会自动上台阶。',
  fence: '栅栏：能挡住玩家与生物，但挡不住跳跃。',
  wall: '墙：会连接相邻的墙与方块，比完整方块矮一点。',
  door: '门：占两格高，右键开关；僵尸能撞开木门。',
  trapdoor: '活板门：一格薄板，右键开关，可以贴地或贴顶。',
  fence_gate: '栅栏门：右键开关，开着时中间能走过去。',
  torch: '火把：能贴在方块顶面或侧面，提供光照。',
  ladder: '梯子：贴在墙上，可以攀爬。',
  rail: '铁轨：铺在地上供矿车行驶。',
  banner: '旗帜：占两格高，可以染色。',
  pane: '薄板：占一格宽、很薄，可以当窗或隔断。',
  cross: '植物：没有碰撞，可以从中间走过去；通常要种在土/沙/水上。',
  coral_fan: '珊瑚扇：一片薄薄的扇形，能落在方块顶上或贴在侧面。',
  head: '头：只占半格见方，可以放在方块顶面。',
  cactus: '仙人掌：四面向内缩，碰到会受伤。',
  lantern: '灯笼：落地的小灯，会发光。',
  flat: '薄片：只占 1/16 格高，通常不挡路。',
  lily_pad: '睡莲：浮在水面上的薄叶片，可以站上去。',
  composter: '堆肥桶：可以把植物类物品堆成骨粉。',
  bell: '钟：立在地上，右键敲响。',
  armor_stand: '盔甲架：可以挂上盔甲与手持物品。',
  cave_vines: '洞穴藤蔓：从洞顶垂下来，可以攀爬。',
  snow: '雪层：可以一层层叠高，踩上去会陷下去一点。',
};

/** 方块采集等级的中文名（0 = 木/金） */
const HARVEST_TIER_CN = ['木/金', '石', '铁', '钻石', '下界合金'] as const;
/** 工具种类的中文名 */
const TOOL_KIND_CN: Readonly<Record<string, string>> = {
  pickaxe: '镐',
  axe: '斧',
  shovel: '锹',
  hoe: '锄',
  sword: '剑',
  shears: '剪刀',
  trident: '三叉戟',
};

/**
 * 通用物品说明（批次 528）。
 *
 * 背景：`DESCRIPTIONS` 只给"有信息量"的物品手写了文案，其余物品的提示框
 * 只剩标题 + 英文 id + 类别。用户点平滑石头时看到的就是这种空说明。
 *
 * 这里**按注册表里的真实数据**拼一段兜底说明：方块形状、采集要求、
 * 是否发光/液体/可穿过、食物数值、工具/盔甲属性。它不是手写文案的替代品，
 * 但保证任何一件物品点开都有可读内容，而且不会写错数值。
 */
export function genericItemDescription(itemId: number): string {
  const def = itemDef(itemId);
  if (!def) return '';
  const category = `分类：${categoryLabel(itemId)}。`;

  if (def.block !== undefined) {
    const block = BLOCKS[def.block];
    if (block) {
      const parts: string[] = [BLOCK_SHAPE_HINTS[block.shape] ?? '完整方块：可以铺地、砌墙，也能用来搭建筑。'];
      if (block.liquid) {
        parts.push('液体：可以用桶装起来。');
      } else {
        if (block.light > 0) parts.push(`自身发光（亮度 ${block.light}），可以照亮周围。`);
        if (!block.solid) parts.push('没有碰撞，可以从中间走过去。');
        const hardness = blockHardness(block.id);
        if (hardness < 0) {
          parts.push('不可破坏：生存模式里挖不动。');
        } else {
          const need = harvestRequirement(block.id);
          const fast = efficientToolType(block.id);
          if (need) {
            const tier = HARVEST_TIER_CN[need.tier] ?? String(need.tier);
            const tool = TOOL_KIND_CN[need.tool] ?? need.tool;
            parts.push(`采集：需要${tier}${tool}以上；等级不够时挖得动，但不会掉落。`);
          } else if (fast) {
            const tool = TOOL_KIND_CN[fast] ?? fast;
            parts.push(`采集：徒手也能挖下来，用${tool}会更快。`);
          } else {
            parts.push('采集：徒手即可挖下来。');
          }
        }
      }
      parts.push(category);
      return parts.join(' ');
    }
  }

  const parts: string[] = [];
  if (def.food) {
    parts.push(`食物：恢复 ${def.food.hunger} 点饥饿值。`);
  } else if (def.tool) {
    const kind = TOOL_KIND_CN[def.tool.type] ?? def.tool.type;
    parts.push(`工具/武器（${kind}）：耐久 ${def.tool.durability}。`);
  } else if (def.armor) {
    parts.push(`盔甲：提供 ${def.armor.defense} 点护甲值，耐久 ${def.armor.durability}。`);
  }
  parts.push(category);
  if (def.maxStack > 0) parts.push(`最多 ${def.maxStack} 个/格。`);
  parts.push('可以在配方书里查看它由什么合成、或能用来做什么。');
  return parts.join('');
}

/** 是否有专门写过的说明（界面用它决定要不要额外显示"类别/堆叠"那行） */
export function hasDescription(itemId: number): boolean {
  const def = itemDef(itemId);
  if (!def) return false;
  const key = shortId(def.name);
  // 多语言 P2-3：说明分两处（语言表 + 还没搬走的旧表），任一处有就算「有说明」。
  // 它和 `knownNameCount` / `missingBlockNames` 是同一类"读表判断"，搬表时最容易漏改。
  return key in DESCRIPTIONS || t(`item.desc.${key}`) !== `item.desc.${key}`;
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
  // 手写说明优先；没有手写文案时用注册表数据生成一段兜底说明（批次 528），
  // 保证提示框不再只剩"标题 + 英文 id"。
  const explicitDescription = itemDescription(itemId);
  const description =
    explicitDescription.length > 0 ? explicitDescription : genericItemDescription(itemId);
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
    // 类别/堆叠那行的判据仍然看"有没有手写说明"：兜底说明是通用描述，
    // 类别与堆叠上限仍然是额外信息，不该被它顶掉。
    showMeta: explicitDescription.length === 0 && durability.length === 0 && enchantLines.length === 0,
    category: categoryLabel(itemId),
    maxStack: maxStackOf(itemId),
    count,
  };
}

/** 供测试与调试：所有有中文名的条目数 */
export function knownNameCount(): number {
  // 族拼成的名字 + 语言表里的 `item.<id>` 词条（P2-2 之后后者是主体）
  return NAMES.size + allKeys().filter((key) => key.startsWith('item.') && !key.startsWith('item.tpl.')).length;
}

/** 供测试用：方块表里还没翻译的条目（应当为空） */
export function missingBlockNames(): string[] {
  const missing: string[] = [];
  for (const def of BLOCKS) {
    if (!def || def.id === 0) continue;
    const key = shortId(def.name);
    if (!hasName(key)) missing.push(key);
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
    const short = shortId(full);
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
    const short = shortId(def.name);
    index.set(short.toLowerCase(), def.id);
    index.set(def.name.toLowerCase(), def.id);
    index.set(blockLabel(def.id), def.id);
  }
  return index;
}

/**
 * 按名字找物品 id。
 * 接受 `minicraft:stone` / `stone` / `石头` / 数字 id 四种写法——
 * 命令与创造物品栏搜索共用同一套解析，玩家不用记英文。
 */
export function resolveItemId(query: string): number | undefined {
  const raw = query.trim();
  if (raw.length === 0) return undefined;
  if (!itemIndex) itemIndex = buildItemIndex();
  // 归一化后再查：`stone` / `minicraft:stone` / `minecraft:stone`（老命令、老玩家习惯）都认
  const key = normalizeId(raw);
  return itemIndex.get(key.toLowerCase()) ?? itemIndex.get(shortId(key).toLowerCase()) ?? itemIndex.get(raw);
}

/** 按名字找方块 id（只含方块；空气用 `air` 或 0） */
export function resolveBlockId(query: string): number | undefined {
  const raw = query.trim();
  if (raw.length === 0) return undefined;
  if (shortId(raw) === 'air' || raw === '空气' || raw === '0') return 0;
  if (!blockIndex) blockIndex = buildBlockIndex();
  const key = normalizeId(raw);
  return blockIndex.get(key.toLowerCase()) ?? blockIndex.get(shortId(key).toLowerCase()) ?? blockIndex.get(raw);
}

/** 供测试与调试：索引规模 */
export function nameIndexSize(): { items: number; blocks: number } {
  if (!itemIndex) itemIndex = buildItemIndex();
  if (!blockIndex) blockIndex = buildBlockIndex();
  return { items: itemIndex.size, blocks: blockIndex.size };
}
