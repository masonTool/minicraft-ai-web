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
import { SPAWN_EGG_SPECS, spawnEggTile } from './spawnEggs.ts';
import { enchantmentById, romanLevel } from './enchantments.ts';
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
// 挂上去是 7 幅里的哪一幅由放置时决定（见 `registry/paintings.ts`），
// 所以这里不该出现"烤肉串画""阿兹特克画"七条名字
put('item_frame', '物品展示框');
put('painting', '画');

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
const COPPER_CN = [
  { block: '铜块', cut: '切制铜' },
  { block: '斑驳的铜块', cut: '斑驳的切制铜' },
  { block: '锈蚀的铜块', cut: '锈蚀的切制铜' },
  { block: '氧化的铜块', cut: '氧化的切制铜' },
] as const;
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
const DESCRIPTIONS: Record<string, string> = {
  // 平滑石头（批次 528，用户点名）：它没有专门说明时只剩标题 + 英文 id
  // ---- 可疑的炖菜（批次 57）：5 种花各自的文案由下面这一小段循环生成
  wheat: '可以做成面包（3 个小麦 → 1 个面包），也能喂牛羊把它们引过来。',
  bread: '一口回 5 点饥饿、6 点饱和度。用 3 个小麦做成。',
  brewing_stand: '右键放入药水与材料开始酿造：一次 20 秒，燃料是烈焰粉（1 份 20 次）。3 圆石 + 1 烈焰粉做成；原版那个配方用的是烈焰棒，本项目的烈焰棒还没做，先用烈焰粉顶。',
  glass_bottle: '3 个玻璃做 3 个。拿空瓶右键水方块就装满水，成为酿造的起点。',
  water_bottle: '酿造的基础：放进酿造台、加下界疣就是"粗制药水"，再加一种材料才成为具体药水。',
  nether_wart: '在下界要塞的楼梯上能找到的作物，是**一切药水的起点**（水瓶 + 下界疣 = 粗制药水）。拿到它之后可以**种回灵魂沙上**自己长（不需要光，也不需要水），成熟了收 2~4 个。',
  blaze_powder: '酿造台的燃料，1 份能酿 20 次；**1 根烈焰棒拆成 2 份**。它同时是**酿造台自己的配方原料**（3 圆石 + 1 烈焰粉），所以没有它连台子都做不出来。',
  spawner: '会**自己出生物**的笼子：手靠近它 16 格以内、里面没有同种生物时，就会在附近生成一只（下界要塞里的笼子出**烈焰人**或**凋灵骷髅**，看笼子上的花纹）。⚠️ 打掉它**什么都不掉**（原版要精准采集），所以在创造模式里搬它、或者绕着它打。',
  wither_skeleton_skull: '**凋灵骷髅**掉下来的头（2.5%，很少）。放在地上当装饰（只有半格高，能站上去也能从旁边走过去）；把 **4 块灵魂沙摆成 T 形、顶上放 3 颗头**就能召唤**凋灵**。',
  nether_star: '**凋灵**倒下时留下的那一件。**信标**的核心材料：3 块黑曜石 + 1 颗下界之星 + 5 块玻璃。',
  gold_block: '9 个金锭压成一块（也能拆回去）。**信标金字塔**的底座可以拿它摆——底座还能是铁块/钻石块/绿宝石块/下界合金块，混着用也行。',
  diamond_block: '9 颗钻石压成一块。信标金字塔的底座材料之一（也是"我很有钱"的展示柜）。',
  emerald_block: '9 颗绿宝石压成一块。信标金字塔的底座材料之一。',
  beacon: '**金字塔顶上那一块**：把它架在 3×3（最高 9×9）的矿物块金字塔顶上，它就会射出一道**冲天光柱**，并给半径内的玩家挂上**增益效果**（1 级 20 格、4 级 50 格）。右键打开界面选效果：主效果五选一（速度/急迫/抗性提升/跳跃提升/力量），三级以上的金字塔还能再要一条**生命恢复**。',
  nether_wart_stage0: '刚种下的下界疣。**只认灵魂沙**（原版唯一的种法），**不需要光照**，随机刻里一阶段一阶段地长。成熟（第 4 阶段）之后打掉给 2~4 个下界疣——它是**一切药水的起点**。',
  nether_wart_stage1: '长起来一点的下界疣。它**不看光照也不看水**（原版在下界的洞里照样长），只是慢。',
  nether_wart_stage2: '快熟了的下界疣。再等一次随机刻就能收（收早了只给 1 个，亏一半）。',
  nether_wart_stage3: '成熟的下界疣：打掉给 **2~4 个**（没熟只有 1 个）。收下来的可以再种回灵魂沙上——这是下界疣唯一的"复制"方式，所以第一次拿到的那几个要留一个当种。',
  blaze_rod: '烈焰人掉的火棒。1 根拆成 2 份**烈焰粉**：那是酿造台的燃料，也是酿造台自己的配方原料（3 圆石 + 1 烈焰粉）。下界要塞里那些飘着喷火的家伙就掉它。',
  ender_pearl: '**末影人**掉落（它们怕水：泡水或淋雨时一边掉血一边闪走）。右键**扔出去**，落地时你会被**传过去**——代价是 5 点摔落伤害（摔落保护能挡）。1 颗珍珠 + 1 份烈焰粉 = 1 只**末影之眼**，要塞传送门房的箱子也能翻到几颗。',
  ender_eye: '两件事：对着**末地传送门框架**右键把它按进去（12 格凑齐一圈，中间 3×3 就会亮起，那是进末地唯一的正门）；朝**别处**右键则把它**扔出去**——它会飞向**最近的要塞**，跟着方向走就能找到它（八成会掉回地上，所以能一路扔）。',
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
  // ---- 钓鱼（批次 81，G11）
  fishing_rod:
    '对着**水面**右键抛竿（只认水面，水里有没有鱼不看），浮标落水后等 **5~30 秒** 会咬钩——浮标往下一沉的那 **2 秒内** 再右键收杆才算钓上来，收早了只是把浮标收回来。钓上来三种可能：**鱼**（85%）、**杂物**（10%：睡莲/皮革/骨头/碗/木棍…）、**宝藏**（5%：弓/附魔书/钓竿）。耐用 64 次，每次收杆 -1。附魔诱饵（每级少等 5 秒）与海之眷顾（杂物变少、宝藏变多）。',
  cod: '生吃只回 2 点饥饿，**烤过之后回 5 点**——先烤再吃。',
  salmon: '生吃只回 2 点饥饿，**烤过之后回 6 点**。',
  tropical_fish: '钓上来的观赏鱼（原版有几千种花纹，这里只有一种）。只能回 1 点饥饿，拿来当摆设比拿来吃划算。',
  cooked_cod: '烤过的鳕鱼：5 点饥饿、0.6 饱和度，是钓鱼最稳的一顿饭。',
  cooked_salmon: '烤过的鲑鱼：6 点饥饿、0.8 饱和度，钓鱼里最能顶饱的一样。',
  cactus: '碰到会掉血；可烧成绿色染料。',
  melon: '西瓜片：吃下能恢复饥饿值。',
  pumpkin: '可以做成雕刻南瓜，也能做南瓜派。',
  coal_ore: '用镐挖出煤炭；深层也有分布。',
  // 黑石家族（批次 82）：堡垒遗迹的建材。说明写清"它从哪来"——
  // 这三块都不在合成链的主干上，玩家第一次见它们多半是在下界的堡垒里
  polished_blackstone: '黑石打磨之后的样子，堡垒遗迹的墙面与地面都是它。4 块黑石能合成 4 块。',
  polished_blackstone_bricks: '磨制黑石砖（4 块磨制黑石合成 4 块），堡垒遗迹的主墙体；它还有台阶、楼梯与墙。',
  chiseled_polished_blackstone: '带花纹的磨制黑石（2 块磨制黑石台阶合成 1 块），堡垒遗迹里的装饰墙面。',
  cracked_polished_blackstone_bricks: '裂了缝的磨制黑石砖：**只能把磨制黑石砖丢进熔炉烧出来**（原版没有合成配方）。',
  lightning_rod: '**被雷劈中的那 0.4 秒输出 15 级红石信号**。雷暴里它会把附近（128 格内）的雷**引到自己身上**——所以它是"给屋顶装一根，家里就不会被烧"的那件东西。贴在方块上、朝外伸 6/16（六向都能挂）。⚠️ 与原版差异：本项目不会氧化（原版的四档铜）。',
  gilded_blackstone: '嵌着金块的黑石，堡垒遗迹里最值钱的那几块：**挖掉掉 2~5 个金粒**（带精准采集才掉它自己），所以进堡垒先找它。',
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
  magma_block: '站在上面**每秒掉 1 点血**（算**火焰伤害**——所以喝抗火药水能挡、免疫火焰的生物也不掉）。它自己会发光（亮度 3）。4 份**岩浆膏**压成一块；也是刷怪塔里那把"刀"。',
  magma_cream: '**岩浆怪**掉的那一颗（大中小三档都掉 0~1）。1 份**烈焰粉** + 1 颗**黏液球** = 1 份岩浆膏；4 份岩浆膏压成 1 块**岩浆块**。它还是**抗火药水**的酿造原料（1 份岩浆膏 + 1 瓶粗制的药水）。',
  bamboo: '丛林中大量生长，可以做成木棍与脚手架。',
  oak_sapling: '种在土/草方块上，过一会儿（或用一次**骨粉**立刻）长成一棵**橡木**。打掉树叶时偶尔会掉一棵。',
  birch_sapling: '种下去长成**白桦**（细高、树冠小）；用骨粉可以立刻长成。',
  spruce_sapling: '种下去长成**云杉**（塔状、圆锥树冠）；用骨粉可以立刻长成。',
  jungle_sapling: '种下去长成**丛林树**（高高的、树干上挂藤蔓）；用骨粉可以立刻长成。⚠️ 原版要 2×2 才长成巨型丛林树，这里一格就能长。',
  acacia_sapling: '种下去长成**金合欢**（树干斜、顶部一张扁伞）；用骨粉可以立刻长成。',
  dark_oak_sapling: '种下去长成**深色橡木**；用骨粉可以立刻长成。⚠️ 原版要 2×2 才长，这里一格就能长。',
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
  shulker_box: '装 **27 格**，而且**挖下来的时候里面的东西跟着走**——换个地方放下，东西还在盒子里（箱子做不到这一点：拆箱子会当场把东西倒在地上）。所以它是"背包外挂格"的首选。⚠️ 与原版差异：配方用**末地石**代替原版的**潜影贝壳**（那要末地城的潜影贝，本项目还没有）。',
  ender_chest: '装 **27 格**，但**内容跟着你走**：世界里所有末影箱打开的都是同一箱东西（换维度、换地方都一样），所以它是最安全的"随身仓库"。两个代价：**箱子里没东西时也看不出来**（空箱子不会"没东西可拿"），以及它**挖起来像黑曜石**（要**钻石镐**、很慢）。⚠️ 配方与原版不同：原版要**末影之眼**，本项目还没有那件物品。',
  composter: '把**能吃的东西**扔进去堆肥：每扔一件有 **30%~100%** 的机会涨**一级**（不同的东西概率不同），攒满 **8 级**之后右键收 **1 份骨粉**、桶清空。好处是**把没用的作物变成骨粉**（骨粉能催熟庄稼）。⚠️ 与原版差异：漏斗**不能**往堆肥桶里灌东西。',
  cauldron: '**装水**：拿水桶往里倒会灌满（3 级），空桶只能从**满锅**里舀回一桶水，**玻璃瓶**一次舀一瓶（每舀一瓶掉一级）。**下雨**时露天的空锅会自己慢慢接满。也能装**岩浆**（岩浆桶）与**细雪**（细雪桶），空桶舀回对应的桶。⚠️ 与原版差异：**洗掉染色装备**还没做（TASKS G13）。',
  water_bucket: '对着一格**水（水源，不是流下来的那摊）**右击装满；拿着它对地面右击就**放下一格水源**——回家做无限水池、浇灭岩浆、给耕地浇水都靠它。⚠️ 只能装**水源**：流水装不起来（原版规则）。',
  lava_bucket: '对着一格**岩浆**右击装满；拿着它对地面右击就**放下一格岩浆**。危险同原版：倒出来的岩浆会点燃旁边的东西，走上去会掉血。',
  powder_snow_bucket: '对着一格**细雪**右击装满，拿着它对地面右击放下细雪，或对着**炼药锅**右击灌成细雪锅。走进去会陷住、待久了会**冰冻扣血**；穿皮革靴子可以免疫冰冻。',
  note_block: '**右击响一声**（音高 0~24，每档半音）；**潜行 + 右击**把音高往上拨一档，最高音之后再点回到最低音。摆一排不同音高的音符盒就能敲旋律；接上红石后，**通电的上升沿也会自动演奏**（保持通电不会连响，断电后才允许下一次）。',
  barrel: '和箱子一样装 **27 格**，但**上面压着方块就打不开**（原版规则）——所以它最适合塞进墙里、天花板上，只留一个侧面朝外。与箱子一样**徒手就能挖下来**（斧头更快）。',
  dispenser: '投掷器的**加强版**：同样 9 格、同样通一次红石信号动一下，但**动之前会先看手里是什么**——箭/雪球/鸡蛋会**射出去**、药水会**砸出去**、TNT 会**点燃**、打火石会**点火**、剪刀会**剪羊毛**；表里没有的东西才当掉落物吐出来。朝向是**六向**（朝上/朝下要**潜行**放：普通放置凸口朝你）。⚠️ 水/岩浆桶、骨粉这些原版行为还没做（缺对应的物品）。',
  hopper: '会自己搬东西的容器（5 格）：每 **0.4 秒**把**朝向那一格**里的容器填一件，同时从**头顶**的容器或掉落物里吸一件进来（**先推后拉**）。放的时候**看着哪一面，管子就朝哪边**（俯视放就是朝下）；潜行放则朝你面朝的方向。通上红石信号会被**锁定**（不推也不吸）——这是"漏斗计时器 / 闸门"那套玩法的基础。',
  rail: '6 铁锭 + 1 木棍做 16 段。铺在地上（1/16 厚、不挡路），矿车放上去就能滑：**轨道上阻力极小、离开轨道寸步难行**。目前只有直轨（弯道/坡道/动力轨还没做）。',
  powered_rail: '动力铁轨：通电后给矿车加速。',
  slime_block: '**落在上面会被弹起来**（不摔伤），跳上去会再弹一下——是电梯与摔落保护的老办法。⚠️ 原版它还会"粘住方块一起被活塞推动"，本项目还没做那一条。',
  slime_ball: '**史莱姆**掉的那一颗（打最小的那一档才掉：大、中史莱姆被杀时会先分裂成更小的）。9 颗压一块**黏液块**；它也是**粘性活塞**缺的那件原料。',
  phantom_membrane: '**幻翼**掉的那一片。1 片 + 1 瓶**粗制的药水** = **缓降药水**（摔得慢、也不摔伤）。⚠️ 原版它还能修**鞘翅**，而鞘翅还没做（见 B18）。',
  trident: '**溺尸**手里那一件（约 15% 的溺尸带着它，带的那种打死才有机会掉）。近战 **9 点**——比下界合金剑还高；**右键也能扔出去**（8 点伤害，落地会掉回地上，能捡回来）。⚠️ 原版它还有"忠诚/穿刺"那些附魔，本项目还没有。',
  map: '**右键**把它绑到脚下这片区域（中心钉在当前位置，覆盖 512×512 格），之后就变成**已填好的地图**：走到哪自动记到哪。配方：8 张纸 + 1 个指南针。',
  filled_map: '**右键打开**看地图：绿色 = 去过的区块，米色 = 还没去过，红色三角 = 你自己（尖端朝向你面朝的方向），✦ = 这张图的中心。走到的每片新区域都会自动记上来（关掉界面也在记）。',
  clock: '**拿在手里**时屏幕下方会出现一个表盘：太阳在正上方 = 正午，月亮在正上方 = 午夜（下界与末地它也照转，原版也是如此）。',
  compass: '**拿在手里**时屏幕下方会出现一根指向**世界出生点**的红色指针（指针朝上 = 出生点在你正前方），旁边同时显示距离。**对着磁石右键**可以把指向钉在那块磁石上（坐标记在指南针自己身上，丢给别人也跟着走）；换维度之后它会指不到（显示 0）。',
  shield: '**按住右键举起来**就能挡住正面来的近战、箭矢与爆炸（挡下会磨损耐久，336 点用完就碎）。举盾时移速降到 30%；被**斧头**命中会破防 5 秒（这 5 秒里盾牌不生效）。',
  firework_star: '烟花的**颜色来源**：火药 + 染料合成。它自己不会飞，要和纸、火药一起做成**烟花火箭**（配方里放几份火药，火箭就飞多高）。',
  firework_rocket: '**右键发射**：升空 1~2 秒后炸开成一朵烟花（档位越高飞得越高、炸得越大）。没放星就是金色，放了星就按星的颜色炸。⚠️ 与原版的差异：只有圆球一种形状，也没有闪烁/拖尾。',
  writable_book: '**右键打开**就能写：一页一段文字，最多 50 页。写完点「署名」给它起个名字，就变成**成书**（从此只读）。⚠️ 原版还能把成书复制成新的书与笔（书与笔 + 成书），这条配方还没做。',
  written_book: '**右键打开**就能翻页阅读。内容在署名的那一刻就定死了，改不了——想改只能再做一本。',
  ink_sac: '**鱿鱼**掉的那一颗（1~3 个）。和 1 份**白色染料**合成 2 份**灰色染料**，它自己也能直接当**黑色染料**用（1:1）。黑色染料一有，黑色/灰色那一整族（羊毛、地毯、床、染色玻璃、陶瓦、混凝土）就都通了。',
  honey_block: '能粘住方块，但不会让人弹跳。',
};

// 深层矿石统一补一句
for (const [ore, cn] of Object.entries(ORE_NAMES_CN)) {
  DESCRIPTIONS[`deepslate_${ore}_ore`] = `深层（深板岩层）的${cn}，掉落与普通${cn}相同。`;
}

// 告示牌（B12，批次 80）：6 种木材共用一段说明（差别只有木料颜色）
for (const [wood, cn] of Object.entries(WOODS_CN)) {
  DESCRIPTIONS[`${wood}_sign`] =
    `${cn}告示牌：**能写四行字**（每行最多 15 字），右键牌子就能改。放置方式看**点在哪一面**：点方块**顶面** → **落地牌**（字朝你）；点**侧面** → **挂墙牌**（贴在墙上、字朝外）。牌子**不挡路**，能从它中间走过去；木头做的，会被火烧掉。`;
}

// 展示框与画（B14，批次 86）
DESCRIPTIONS.item_frame =
  '物品展示框：贴在**墙上**（点方块侧面放），框里能挂**任何一件东西**。右键空框 → 把手里那件挂上去（消耗 1 个）；右键有东西的框 → **转 45°**（转 8 次回到原位）；手里拿着别的东西右键 → **换一件**。拆框时挂着的那件会一起掉出来。⚠️ 与原版差异：**框里只挂 1 件**（不显示数量），方块类物品挂上去是**一张平面图标**（原版是立体小方块）。';
DESCRIPTIONS.painting =
  '画：贴在**墙上**（点方块侧面放），挂上去的是**哪一幅随机**。⚠️ 与原版差异：本项目这一批只做了原版 1.18 里 **1×1 的 7 幅**（烤肉串 / 阿兹特克 / 阿尔班 / 阿兹特克II / 炸弹 / 植物 / 荒地），**多格拼贴的大画还没做**——所以不会出现"挂一幅 2×2 的大画"。';

// 混凝土粉末（批次 131）：16 色共用一段说明（差别只有颜色，按配色表套模板）
for (const [color, cn] of Object.entries(COLORS_CN)) {
  DESCRIPTIONS[`${color}_concrete_powder`] =
    `**挨到水就凝固**成${cn}**混凝土**——这是混凝土唯一的来源（原版它也做不出来）。` +
    '合成：4 沙 + 4 砾石 + 1 染料 = 8 份（沙在四角、砾石在四边、染料在正中）。⚠️ 凝固之后回不去了。';
}

// 床（B13，批次 79）：16 色的说明是同一段（差别只有颜色，所以按配色表套模板）
for (const [color, cn] of Object.entries(COLORS_CN)) {
  DESCRIPTIONS[`${color}_bed`] = `${cn}床：**横着占两格**，右键躺下睡觉——**只能在夜晚或雷暴时**入睡，附近 8 格里有敌对生物也睡不着。睡一觉会**跳到天亮**、**把重生点设在这张床上**（死了之后从这里复活；床被拆掉就回世界出生点）。⚠️ 与原版差异：睡觉时视角停在原地（不摆出躺下的姿势），跳跃键随时可以起床。`;
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

// ---------------------------------------------------------------- 刷怪蛋（批次 174，J17）
//
// 21 枚蛋的名字与说明都由**同一张规格表**派生（`registry/spawnEggs.ts`）：
// 手抄 21 行"僵尸刷怪蛋/骷髅刷怪蛋…"迟早会漏一个，而漏掉的那枚在界面上会显示成英文 id。
for (const spec of SPAWN_EGG_SPECS) {
  const key = spawnEggTile(spec.mobId);
  // 刷怪蛋（多语言 P2-1b-2）：结构先接好；`{mob}` 现在还是中文名，P2-4 把生物名键化后自动跟着变
  put(key, () => tp('item.tpl.spawnEgg', { mob: spec.label }));
  DESCRIPTIONS[key] =
    `对着一格方块右击，生成一只**${spec.label}**。⚠️ **创造专属**：原版刷怪蛋也没有任何生存来源` +
    `（本项目一样），所以它只出现在创造物品栏里；生存模式拿到也用不掉。`;
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
  const key = id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id;
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
  // 多语言 P2-3：先查语言表（`item.desc.<id>`，模板字面量让审计能认出这一族）；
  // 还没搬过来的仍走旧表，两部分互不重叠
  const probe = `item.desc.${key}`;
  const text = t(`item.desc.${key}`);
  if (text !== probe) return text;
  return DESCRIPTIONS[key] ?? '';
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
  const key = def.name.startsWith('minecraft:') ? def.name.slice('minecraft:'.length) : def.name;
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
    const key = def.name.replace('minecraft:', '');
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
