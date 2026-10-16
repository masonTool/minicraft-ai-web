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
import { POTION_IDS, POTION_ITEMS, TIPPED_ARROWS } from './potions.ts';
import {
  Block,
  CORAL_BLOCK_ID_START,
  CORAL_DEAD_VARIANT,
  CORAL_FAN_ID_START,
  CORAL_ID_START,
  CORAL_KINDS,
  COPPER_STAGES,
  DEAD_CORAL_BLOCK_ID_START,
  DEAD_CORAL_FAN_ID_START,
  DEAD_CORAL_ID_START,
  STONE_VARIANT_IDS,
  WHEAT_STAGES,
  Wood,
  WoodShaped,
  berryStageOf,
  blockDef,
  carpetId,
  copperId,
  cropOf,
  wheatStageOf,
  woolId,
} from './blocks.ts';
import { DYE_COLORS } from './colors.ts';
import { foodForName, type FoodInfo } from './food.ts';
import { SHEARS_INFO, SHEARS_ITEM_ID, TOOL_SPECS, type ToolInfo } from './tools.ts';

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
  /**
   * 耐用品但不是工具/盔甲的（目前只有弓）。
   * 工具与盔甲的耐久在各自的属性表里（它们还要登记等级、护甲值），
   * 这里只给"只差一个耐久上限"的东西留个位置。
   */
  readonly durability?: number;
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
  // ---- 单个注册的耐用品（J8 起：剪刀、桶…）
  // id 定义在 tools.ts（`TOOL_BY_ID` 需要按 id 反查，反向 import 会成环）
  SHEARS: SHEARS_ITEM_ID,
  // ---- 酿造（H10）
  GLASS_BOTTLE: 1170,
  WATER_BOTTLE: 1171,
  NETHER_WART: 1172,
  BLAZE_POWDER: 1173,
  SUGAR: 1174,
  RABBIT_FOOT: 1190,
  MAGMA_CREAM: 1191,
  GHAST_TEAR: 1192,
  SPIDER_EYE: 1193,
  FERMENTED_SPIDER_EYE: 1194,
  GLISTERING_MELON: 1195,
  PUFFERFISH: 1196,
  GOLDEN_CARROT: 1197,
  // ---- 食物与杂物补齐（批次 48）
  // ⚠️ 这一段排在**所有药水段之后**（药水占 1180~1189 / 1200~1219，加上喷溅·滞留·药水箭
  // 的偏移一直排到 1419）。最初写成 1200~1206，启动时被"物品 id 重复注册"那道防线
  // 当场拦下（撞的是 `potion_swiftness_long`，再撞 `potion_awkward`）——
  // 那条防线的意义正在于此：否则药水会被整件覆盖，玩家只会看到"捡起金粒显示成药水"
  GOLD_NUGGET: 1420,
  BOWL: 1421,
  MUSHROOM_STEW: 1422,
  PUMPKIN_PIE: 1423,
  BEETROOT: 1424,
  BEETROOT_SEEDS: 1425,
  BEETROOT_SOUP: 1426,
  // ---- 甜浆果与可可豆（批次 49，B17 最后两种"要地物"的食物）
  SWEET_BERRIES: 1427,
  COCOA_BEANS: 1428,
  COOKIE: 1429,
  // ---- 海带与干海带（批次 50）：
  // 海带与海草**本身就是方块**（id 436/437，物品 id 与方块 id 同源，见上面的方块物品循环），
  // 只有"干海带"是纯粹的非方块物品（海带烧一下出来的那个）
  DRIED_KELP: 1430,
  REDSTONE_DUST: 1198,
  GLOWSTONE_DUST: 1199,
  // ---- 投掷物（K4 尾巴）：雪球与鸡蛋，原版都是 16 个一堆。
  // 1175~1179 是"酿造材料"与"药水（1180 起）"之间一直空着的一段
  SNOWBALL: 1175,
  EGG: 1176,
  /** 龙息（K4 尾巴）：滞留药水的原料，来源见 `Dragon` 的血息阶段 */
  DRAGON_BREATH: 1177,
  // 药水：用 id 枚举而不是给 ItemStack 加字段（见 potions.ts 的说明）
  // id 定义在 potions.ts（本文件要 import 它来批量注册，反过来会成环）
  POTION_AWKWARD: POTION_IDS.awkward,
  POTION_SWIFTNESS: POTION_IDS.swiftness,
  POTION_STRENGTH: POTION_IDS.strength,
  POTION_HEALING: POTION_IDS.healing,
  POTION_REGENERATION: POTION_IDS.regeneration,
  POTION_FIRE_RESISTANCE: POTION_IDS.fire_resistance,
  POTION_NIGHT_VISION: POTION_IDS.night_vision,
  POTION_POISON: POTION_IDS.poison,
  POTION_SLOWNESS: POTION_IDS.slowness,
  POTION_WEAKNESS: POTION_IDS.weakness,
  // ---- 农业（H13）
  CARROT: 1163,
  POTATO: 1164,
  BAKED_POTATO: 1165,
  WHEAT_SEEDS: 1160,
  WHEAT: 1161,
  BREAD: 1162,
  // ---- 桶与牛奶（J8）
  BUCKET: 1151,
  MILK_BUCKET: 1152,
  /** 打火石（I12）：耐用品，对着方块右键点燃火焰。原版耐久 64 */
  FLINT_AND_STEEL: 1153,
  // ---- 下界合金（K8 尾巴）：远古残骸烧成碎片，4 碎片 + 4 金锭 = 1 锭
  NETHERITE_SCRAP: 1155,
  NETHERITE_INGOT: 1156,
  /** 铁粒（B11）：锁链的原料。1 铁锭 ↔ 9 铁粒（原版两向都有） */
  IRON_NUGGET: 1157,
  /** 下界石英（批次 42）：石英家族的唯一原料，由下界石英矿石掉落 */
  QUARTZ: 1158,
  // ---- 弓与箭（J9）
  FLINT: 1072,
  STRING: 1073,
  ARROW: 1075,
  BOW: 1076,
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
  /** 耐用品（弓）：与 `ItemDef.durability` 同一个意思 */
  durability?: number;
  /**
   * 放置时变成哪个方块（H13 的小麦种子）。
   * 与方块物品的 `block` 字段同一个含义——种子不是方块，但右键耕地会把小麦苗种上去。
   */
  block?: number;
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
  // 铁粒（B11）：锁链的原料；原版由铁锭拆成 9 粒，也能 9 粒合成 1 锭
  { id: Item.IRON_NUGGET, name: 'minecraft:iron_nugget', tile: 'item_iron_nugget' },
  // 下界石英（批次 42）：此前**缺了这一件**——下界石英矿石掉的是"方块本身"，
  // 于是石英家族（石英块/石英柱/平滑石英/錾制石英）根本无法合成，这一批补上
  { id: Item.QUARTZ, name: 'minecraft:quartz', tile: 'item_quartz' },
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
  // ---- 弓与箭
  { id: Item.FLINT, name: 'minecraft:flint', tile: 'item_flint' },
  { id: Item.STRING, name: 'minecraft:string', tile: 'item_string' },
  { id: Item.ARROW, name: 'minecraft:arrow', tile: 'item_arrow' },
  // 药水箭（K4 最后一步）：28 支，id = 饮用型 + 200，贴图与名字都由药水表生成
  ...TIPPED_ARROWS.map((entry) => ({ id: entry.id, name: `minecraft:${entry.key}`, tile: `item_${entry.key}`, maxStack: 64 })),
  // ---- 投掷物（K4 尾巴）：扔出去的是这两个 + 喷溅药水
  { id: Item.SNOWBALL, name: 'minecraft:snowball', tile: 'item_snowball', maxStack: 16 },
  { id: Item.EGG, name: 'minecraft:egg', tile: 'item_egg', maxStack: 16 },
  // 龙息（K4 尾巴）：可堆 64（原版也是如此），它是滞留药水的原料
  { id: Item.DRAGON_BREATH, name: 'minecraft:dragon_breath', tile: 'item_dragon_breath' },
  // 喷溅药水 / 滞留药水：与饮用型共用 `POTION_ITEMS`
  // （id = 饮用型 + 50 / + 100，见 potions.ts）——不在这里单列
  // 弓是耐用品（原版 384 点耐久，每射一箭 -1），但不是"工具"：
  // 它没有采集等级与挖掘速度，所以不放进 TOOL_SPECS（那是 5 种类 × 5 材质的表）
  { id: Item.BOW, name: 'minecraft:bow', tile: 'item_bow', maxStack: 1, durability: 384 },
  // ---- 农业：种子（可种在耕地上）与小麦
  { id: Item.WHEAT_SEEDS, name: 'minecraft:wheat_seeds', tile: 'item_wheat_seeds', block: Block.WHEAT_STAGE0, maxStack: 64 },
  { id: Item.WHEAT, name: 'minecraft:wheat', tile: 'item_wheat' },
  // ---- 酿造（H10）：瓶子与材料
  { id: Item.GLASS_BOTTLE, name: 'minecraft:glass_bottle', tile: 'item_glass_bottle', maxStack: 16 },
  { id: Item.WATER_BOTTLE, name: 'minecraft:water_bottle', tile: 'item_water_bottle', maxStack: 1 },
  { id: Item.NETHER_WART, name: 'minecraft:nether_wart', tile: 'item_nether_wart' },
  { id: Item.BLAZE_POWDER, name: 'minecraft:blaze_powder', tile: 'item_blaze_powder' },
  { id: Item.SUGAR, name: 'minecraft:sugar', tile: 'item_sugar' },
  { id: Item.RABBIT_FOOT, name: 'minecraft:rabbit_foot', tile: 'item_rabbit_foot' },
  { id: Item.MAGMA_CREAM, name: 'minecraft:magma_cream', tile: 'item_magma_cream' },
  { id: Item.GHAST_TEAR, name: 'minecraft:ghast_tear', tile: 'item_ghast_tear' },
  { id: Item.SPIDER_EYE, name: 'minecraft:spider_eye', tile: 'item_spider_eye' },
  { id: Item.FERMENTED_SPIDER_EYE, name: 'minecraft:fermented_spider_eye', tile: 'item_fermented_spider_eye' },
  { id: Item.GLISTERING_MELON, name: 'minecraft:glistering_melon_slice', tile: 'item_glistering_melon_slice' },
  { id: Item.PUFFERFISH, name: 'minecraft:pufferfish', tile: 'item_pufferfish' },
  { id: Item.GOLDEN_CARROT, name: 'minecraft:golden_carrot', tile: 'item_golden_carrot' },
  // ---- 食物与杂物补齐（批次 48，B17）
  // 金粒：原版由 1 金锭拆成 9 粒，也是**金胡萝卜**的原料（此前金胡萝卜只能当酿造材料，
  // 因为"8 金粒"这条配方缺原料——这是那批"第一件原料从哪来"里最便宜的一个缺口）
  { id: Item.GOLD_NUGGET, name: 'minecraft:gold_nugget', tile: 'item_gold_nugget' },
  // 碗：原版"3 木板 → 4 碗"，蘑菇煲 / 甜菜汤 / 兔肉煲都要它
  { id: Item.BOWL, name: 'minecraft:bowl', tile: 'item_bowl' },
  { id: Item.MUSHROOM_STEW, name: 'minecraft:mushroom_stew', tile: 'item_mushroom_stew' },
  { id: Item.PUMPKIN_PIE, name: 'minecraft:pumpkin_pie', tile: 'item_pumpkin_pie' },
  // 甜菜根（B17）：第四种作物。种子只从村庄/矿井的战利品里来（原版也是这么来的）
  { id: Item.BEETROOT, name: 'minecraft:beetroot', tile: 'item_beetroot' },
  { id: Item.BEETROOT_SEEDS, name: 'minecraft:beetroot_seeds', tile: 'item_beetroot_seeds', block: Block.BEETROOTS_STAGE0 },
  { id: Item.BEETROOT_SOUP, name: 'minecraft:beetroot_soup', tile: 'item_beetroot_soup' },
  // ---- 甜浆果与可可豆（批次 49）
  // 甜浆果：种下去就是**甜浆果丛**（`block` 指向第 0 阶段，与原版一致）
  { id: Item.SWEET_BERRIES, name: 'minecraft:sweet_berries', tile: 'item_sweet_berries', block: Block.SWEET_BERRY_BUSH_STAGE0 },
  // 可可豆：种在**丛林原木侧面**（`block` 指向第 0 阶段，朝向由放置规则算出来）
  { id: Item.COCOA_BEANS, name: 'minecraft:cocoa_beans', tile: 'item_cocoa_beans', block: Block.COCOA_STAGE0 },
  { id: Item.COOKIE, name: 'minecraft:cookie', tile: 'item_cookie' },
  // ---- 海带与干海带（批次 50）：干海带是食物（1 饥饿 / 0.6 饱和度，数值在 food.ts），
  // 也是"干海带块"的唯一材料（9 ↔ 1）
  { id: Item.DRIED_KELP, name: 'minecraft:dried_kelp', tile: 'item_dried_kelp' },
  { id: Item.REDSTONE_DUST, name: 'minecraft:redstone_ingredient', tile: 'item_redstone_ingredient' },
  { id: Item.GLOWSTONE_DUST, name: 'minecraft:glowstone_dust_ingredient', tile: 'item_glowstone_dust_ingredient' },
  // ---- 药水（H10）：不可堆叠，一次一瓶
  ...POTION_ITEMS.map((entry) => ({ id: entry.id, name: `minecraft:potion_${entry.key}`, tile: `item_potion_${entry.key}`, maxStack: 1 })),
  { id: Item.CARROT, name: 'minecraft:carrot', tile: 'item_carrot', block: Block.CARROTS_STAGE0 },
  { id: Item.POTATO, name: 'minecraft:potato', tile: 'item_potato', block: Block.POTATOES_STAGE0 },
  { id: Item.BAKED_POTATO, name: 'minecraft:baked_potato', tile: 'item_baked_potato' },
  { id: Item.BREAD, name: 'minecraft:bread', tile: 'item_bread' },

  // ---- 桶（可堆 16，与原版一致）与牛奶桶（一次性的"饮品"，不可堆）
  { id: Item.BUCKET, name: 'minecraft:bucket', tile: 'item_bucket', maxStack: 16 },
  { id: Item.MILK_BUCKET, name: 'minecraft:milk_bucket', tile: 'item_milk_bucket', maxStack: 1 },
  // ---- 打火石（I12）：铁锭 + 燧石；耐久 64（原版），对着方块面右键点燃火焰
  {
    id: Item.FLINT_AND_STEEL,
    name: 'minecraft:flint_and_steel',
    tile: 'item_flint_and_steel',
    maxStack: 1,
    durability: 64,
  },
  // ---- 下界合金（K8 尾巴）：远古残骸烧出来的碎片，与金锭合成下界合金锭
  { id: Item.NETHERITE_SCRAP, name: 'minecraft:netherite_scrap', tile: 'item_netherite_scrap' },
  { id: Item.NETHERITE_INGOT, name: 'minecraft:netherite_ingot', tile: 'item_netherite_ingot' },

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

/**
 * 物品表的长度（按 id 索引）。
 *
 * ⚠️ 改小会**静默丢掉** id 更大的物品（数组直接截断），所以每次新增一段 id 都要回来看这里。
 * 当前最大的一段是**药水箭 1380~1419**（饮用型 id + 200，见 `potions.ts`）；
 * 再下面是滞留药水 1280~1319、喷溅药水 1230~1269，所以留到 1500。
 */
const MAX_ITEM_ID = 1500;

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
  // 流体不进入物品栏；火焰这类"本来就没有对应物品"的方块也不进（见 `BlockDef.itemless`）
  if (def.liquid || def.itemless) continue;
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
    // 耐久也要在这一处搬运。`ItemDef` 上的可选字段每加一个，都要回来补这句——
    // 漏了的话表现是"弓永远是崭新的"（`durabilityOf` 返回 0），而且不报任何错
    ...(spec.durability !== undefined ? { durability: spec.durability } : {}),
    // 同理：可放置的非方块物品（小麦种子）必须带上 block，否则右键耕地种不下去
    ...(spec.block !== undefined ? { block: spec.block } : {}),
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

// ---- 剪刀：单独注册（不参与「5 种类 × 5 材质」那套叉乘，只有铁的一种）
ITEMS[Item.SHEARS] = {
  id: Item.SHEARS,
  name: 'minecraft:shears',
  maxStack: 1,
  tile: 'item_shears',
  tool: SHEARS_INFO,
  durability: SHEARS_INFO.durability,
};

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
  // 下界合金用下界合金锭修（原版）；一件修耐久上限的 1/4，也就是一块锭换 500+ 点
  netherite: Item.NETHERITE_INGOT,
  leather: Item.LEATHER,
  chainmail: Item.IRON_INGOT,
};

/**
 * 非工具/盔甲、但要参与附魔与铁砧的物品（J9）。
 *
 * 弓是唯一的例子：附魔台要按 `kind` 决定能出哪些附魔（力量/冲击/火矢/无限），
 * 铁砧要按 `repair` 决定用什么修（木板）。
 * 放在 `items.ts` 是因为附魔与铁砧两个模块都**被** `items.ts` 引用（反向引用会成环）。
 */
export const SPECIAL_ITEMS: Record<number, { kind: string; repair: string }> = {
  [Item.BOW]: { kind: 'bow', repair: 'wooden' },
  [Item.SHEARS]: { kind: 'shears', repair: 'iron' },
};

/**
 * 这件物品的耐久上限；不是耐用品返回 0。
 * 三处来源按"越具体越优先"排：工具/盔甲自带属性，其余看 `ItemDef.durability`。
 */
export function durabilityOf(itemId: number): number {
  const def = ITEMS[itemId];
  return def?.tool?.durability ?? def?.armor?.durability ?? def?.durability ?? 0;
}

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
  // 酿造与药水（K4 尾巴补的分类）：84 瓶药水挤在"矿石与材料"里根本翻不动
  'brewing',
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
  brewing: '酿造与药水',
};

/** 工具与武器（25 种由 TOOL_SPECS 派生，另外加上单独注册的剪刀） */
/**
 * 工具与武器：工具表 + 剪刀 + **弓与箭（含 28 支药水箭）**。
 *
 * 弓/箭原来没登记，于是掉进"矿石与材料"——一个叫"工具与武器"的分类里没有弓和箭，
 * 玩家第一次找就会觉得哪里不对（批次 27 顺手修正）。
 */
const TOOLS = new Set<number>([
  ...TOOL_SPECS.map((spec) => spec.id),
  Item.SHEARS,
  // 打火石算"工具"：它也不可堆叠、有耐久、右键对着方块用（放"矿石与材料"里找不到）
  Item.FLINT_AND_STEEL,
  Item.BOW,
  Item.ARROW,
  ...TIPPED_ARROWS.map((entry) => entry.id),
]);

/** 盔甲（20 件，由 ARMOR_SPECS 派生） */
const ARMOR = new Set<number>(ARMOR_SPECS.map((spec) => spec.id));

/** 食物：凡是挂了 `food` 的物品都算（表在 food.ts，这里不再手抄一份名单） */
const FOODS = new Set<number>(
  BASE_NON_BLOCK_SPECS.filter((spec) => foodForName(spec.name) !== undefined).map((spec) => spec.id),
);
// 蛋糕（批次 52）：它是**方块**，却属于"食物"那一页——
// 上面那条是从"非方块物品"里筛的，方块物品得单独登记（不然会掉进"自然"里，
// 玩家在食物页翻不到它）。
FOODS.add(Block.CAKE);

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
  // 门 / 活板门 / 栅栏 / 栅栏门：原版归在"建筑"里（此前没登记，
  // 于是掉进了"矿石与材料"）。批次 30 顺手补上
  Block.OAK_DOOR,
  Block.OAK_TRAPDOOR,
  Block.OAK_FENCE_GATE,
  Block.OAK_FENCE,
]);

// 木制方块族（批次 38）：其余 5 种木材的四件也归"建筑"（按族登记，不逐个手抄）
for (const ids of Object.values(WoodShaped)) {
  BUILDING.add(ids.fence);
  BUILDING.add(ids.fenceGate);
  BUILDING.add(ids.door);
  BUILDING.add(ids.trapdoor);
}

// 铜的四档 × 四种形状（批次 40）：也归"建筑"（与原版的"建筑方块"页一致）
for (let stage = 0; stage < COPPER_STAGES.length; stage++) {
  for (let kind = 0; kind < 4; kind++) BUILDING.add(copperId(stage, kind as 0 | 1 | 2 | 3));
}

// 石材家族的台阶/楼梯/墙（批次 41）：建材，归"建筑"
for (const id of STONE_VARIANT_IDS) BUILDING.add(id);

// 石英家族 / 深板岩瓦 / 红色下界砖（批次 42）：同样是建材
for (const id of [
  Block.QUARTZ_BLOCK,
  Block.CHISELED_QUARTZ_BLOCK,
  Block.QUARTZ_PILLAR,
  Block.SMOOTH_QUARTZ,
  Block.DEEPSLATE_TILES,
  Block.RED_NETHER_BRICKS,
]) {
  BUILDING.add(id);
}

// 脚手架（批次 53）：搭东西用的——归"建筑"（原版也在"装饰/建筑"那一档）
BUILDING.add(Block.SCAFFOLDING);

// 砂岩家族与红砂岩家族（批次 41 的漏登记 + 批次 45）：同样是建材。
// ⚠️ `錾制/切制/平滑砂岩` 自批次 41 起一直**漏在这里**（只有"砂岩"本体登记了），
// 于是那三件掉进了"矿石与材料"——它们跟石头一样是建材，顺手补齐。
for (const id of [
  Block.CHISELED_SANDSTONE,
  Block.CUT_SANDSTONE,
  Block.SMOOTH_SANDSTONE,
  Block.RED_SANDSTONE,
  Block.CHISELED_RED_SANDSTONE,
  Block.CUT_RED_SANDSTONE,
  Block.SMOOTH_RED_SANDSTONE,
]) {
  BUILDING.add(id);
}

const NATURAL = new Set<number>([
  Block.GRASS_BLOCK,
  Block.DIRT,
  Block.SAND,
  // 红沙（批次 45）：跟沙子一样是"自然"方块（它长在恶地地表）
  Block.RED_SAND,
  Block.GRAVEL,
  Block.CLAY,
  Block.OAK_LOG,
  Block.OAK_LEAVES,
  Block.SNOW_BLOCK,
  // 雪层（批次 37）：跟着"雪块/冰"放"自然"分类，别掉进"矿石与材料"里
  Block.SNOW,
  Block.ICE,
  Block.PACKED_ICE,
  Block.OBSIDIAN,
  Block.DEEPSLATE,
  Block.GRANITE,
  Block.DIORITE,
  Block.ANDESITE,
  Block.TUFF,
  Block.CALCITE,
  // 干海带块（批次 50）：跟"雪块/冰"一样是"自然材料方块"，别掉进"矿石与材料"
  Block.DRIED_KELP_BLOCK,
]);

// 珊瑚块（批次 51，活 + 失活共 10 件）：海底的自然方块，与"雪块/冰"同一档归"自然"。
// 按族登记而不是手抄 10 行——"新加一种颜色却忘了分类"是这一族最容易犯的错
for (const start of [CORAL_BLOCK_ID_START, DEAD_CORAL_BLOCK_ID_START]) {
  for (let i = 0; i < CORAL_KINDS.length; i++) NATURAL.add(start + i);
}

const FUNCTIONAL = new Set<number>([
  Block.CRAFTING_TABLE,
  Block.FURNACE,
  // 烟熏炉与高炉（批次 46）：熔炉的两个变体，同样是"右键打开的功能方块"
  Block.SMOKER,
  Block.BLAST_FURNACE,
  // 营火（批次 47）：也是"右键打开的烤东西的地方"
  Block.CAMPFIRE,
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
  // 锻造台（K8 尾巴）：和铁砧一样是"右键打开的工作台"
  Block.SMITHING_TABLE,
  // 切石机（H11，批次 44）：同样是"右键打开的工作台"
  Block.STONECUTTER,
  // 阳光传感器（批次 54）：红石元件，与拉杆/中继器同页
  Block.DAYLIGHT_DETECTOR,
  // 花盆（批次 52）：原版把它摆在"装饰"页（1.19 起并进了功能页），
  // 本项目没有装饰页——它是"右键往里种一株"的功能方块，与营火/熔炉同一类
  Block.FLOWER_POT,
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
  // 海带与海草（批次 50）：植物，归"自然"
  Block.KELP,
  Block.SEAGRASS,
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

// 珊瑚与珊瑚扇（批次 51，活 + 失活共 20 件）：海底的植物，与海带/海草同一档归"自然"。
// 同样按族登记（见上面的珊瑚块那段）
for (const start of [CORAL_ID_START, DEAD_CORAL_ID_START, CORAL_FAN_ID_START, DEAD_CORAL_FAN_ID_START]) {
  for (let i = 0; i < CORAL_KINDS.length; i++) DECORATION_AND_NETHER.add(start + i);
}

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
  // 铁粒跟着铁锭归"矿石与材料"（B11）
  Item.IRON_NUGGET,
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
  // 下界石英（批次 42）：与矿石归同一类"矿石与材料"
  Item.QUARTZ,
  Block.ANCIENT_DEBRIS,
  Block.SHROOMLIGHT,
  Block.SEA_LANTERN,
  Block.NETHER_BRICKS,
  // 下界合金块放在"矿石与材料"里而不是"建筑"：与铁块/粗铁块在本项目里的归处保持一致
  Block.NETHERITE_BLOCK,
]);

/** 16 色羊毛 + 16 色地毯 + 16 种染料（地毯是羊毛族的薄片，摆在同一个分类里最好找） */
const WOOL_AND_DYE = new Set<number>();
for (let index = 0; index < DYE_COLORS.length; index++) {
  WOOL_AND_DYE.add(woolId(index));
  WOOL_AND_DYE.add(carpetId(index));
  WOOL_AND_DYE.add(dyeItemId(index));
}
// 可可豆（批次 49）：它是棕色染料的原料，摆在染料旁边比扔进"矿石与材料"好找
WOOL_AND_DYE.add(Item.COCOA_BEANS);

/**
 * 酿造与药水（K4 尾巴）：**84 瓶药水** + 瓶子 + 材料 + 酿造台本身。
 * 药水种类一多，"矿石与材料"里就再也翻不动了。
 */
const BREWING = new Set<number>([
  ...POTION_ITEMS.map((entry) => entry.id),
  Item.GLASS_BOTTLE,
  Item.WATER_BOTTLE,
  Item.NETHER_WART,
  Item.BLAZE_POWDER,
  Item.SUGAR,
  Item.RABBIT_FOOT,
  Item.MAGMA_CREAM,
  Item.GHAST_TEAR,
  Item.SPIDER_EYE,
  Item.FERMENTED_SPIDER_EYE,
  Item.GLISTERING_MELON,
  Item.PUFFERFISH,
  Item.GOLDEN_CARROT,
  Item.REDSTONE_DUST,
  Item.GLOWSTONE_DUST,
  Item.DRAGON_BREATH,
  Block.BREWING_STAND,
]);

/** 判断物品属于哪个创造分类；未登记的默认归入"矿石与材料" */
export function categoryOf(itemId: number): ItemCategory {
  if (TOOLS.has(itemId)) return 'tools';
  if (ARMOR.has(itemId)) return 'armor';
  // 食物排在矿石前面：腐肉/生肉此前被归进"矿石与材料"，看着不像能吃的东西
  if (FOODS.has(itemId)) return 'food';
  if (WOOL_AND_DYE.has(itemId)) return 'wool';
  if (BREWING.has(itemId)) return 'brewing';
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
  // 藤蔓（B11）：徒手/斧头打掉什么都不掉，只有剪刀或精准采集能完整带走（见 `CUTTABLE`）
  Block.VINE,
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
 * 「概率替换」掉落：以一定概率**顶替**原本的掉落（不是额外掉一份）。
 *
 * 目前只有"砂砾 10% 掉燧石"——原版也是替换关系：挖砂砾要么掉砂砾、要么掉燧石。
 * 与 `RARE_DROPS`（额外掉一份，例如树叶掉苹果）分成两张表，
 * 是因为两者语义完全不同，混在一张表里迟早会搞错。
 *
 * @param roll 掷出的随机数（0~1）
 */
export function replaceDropFor(blockId: number, roll: number): { id: number; count: number } | null {
  const entry = REPLACE_DROPS.get(blockId);
  if (entry === undefined || roll >= entry.rate) return null;
  return { id: entry.id, count: 1 };
}

const REPLACE_DROPS = new Map<number, { id: number; rate: number }>([
  [Block.GRAVEL, { id: Item.FLINT, rate: 0.1 }],
]);

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

// ---------------------------------------------------------------- 破坏掉落（收成一个纯函数）

/**
 * **必须用剪刀才有掉落**的方块。
 *
 * 注意它不是 `REQUIRED_TOOL`：原版羊毛/树叶的"必须剪刀"写在 `getDrops` 里，
 * 而不是 `requiresCorrectToolForDrops`——区别在于**徒手拆羊毛的时间是正常的 1.2 秒，
 * 只是什么都不掉**。放进 `REQUIRED_TOOL` 会让徒手耗时变成 4 秒，手感直接变差。
 *
 * 剪刀拿到的东西与"精准采集"一致：直接掉方块自身（羊毛掉羊毛、树叶掉树叶）。
 */
const SHEARS_ONLY = new Set<number>();
for (let i = 0; i < DYE_COLORS.length; i++) SHEARS_ONLY.add(woolId(i));
// 海草（批次 50）：原版的掉落判定也**只认剪刀**（徒手拔掉什么都不掉，
// 精准采集同样不给——原版海草的 `getDrops` 里只判 `tool.is(ShearsItem)`），
// 所以它进这张表而不是 `CUTTABLE`。羊毛与海草是这张表里唯一的两种。
SHEARS_ONLY.add(Block.SEAGRASS);

/**
 * "剪刀与精准采集都能完整带走"的方块。
 *
 * 和羊毛的区别就在这里——羊毛只认剪刀，精准采集对它无效（见 `SHEARS_ONLY`）。
 * 树叶与藤蔓属于这一类（原版两样都行）。
 */
const CUTTABLE = new Set<number>([
  // 橡木是"基础方块"，不在 `Wood` 表里，得单独写一行
  // （踩过一次：批量注册时漏掉橡木，表现为"砍云杉有加速、砍橡木没有"）
  Block.OAK_LEAVES,
  // 藤蔓（B11）：剪刀或精准采集都能把它整根摘下来
  Block.VINE,
]);
for (const ids of Object.values(Wood)) CUTTABLE.add(ids.leaves);

/** 这个方块是不是"不剪就一无所获"（羊毛与海草——原版的掉落判定都只认剪刀） */
export function requiresShears(blockId: number): boolean {
  return SHEARS_ONLY.has(blockId);
}

export interface DropContext {
  /** 手上是不是剪刀 */
  shears: boolean;
  /** 有没有精准采集 */
  silkTouch: boolean;
  /** 时运等级（0 = 没有） */
  fortune: number;
  /** 破坏的是不是双层台阶（掉落翻倍） */
  doubleSlab: boolean;
  /** 0~1 的随机数发生器（测试里传固定值） */
  roll: () => number;
}

/**
 * 破坏一个方块该掉什么（J8 把这条规则收拢到一起）。
 *
 * 判定顺序是**有讲究**的，写成一条流水线：
 *   1. 剪刀 → 羊毛/树叶"完整带走"
 *   2. 精准采集 → 其余能"完整带走"的方块；**对羊毛无效**（羊毛只认剪刀）
 *   3. 羊毛没剪 → 一无所有。**必须在常规掉落之前拦**，
 *      否则会顺着"方块掉自身"的默认规则漏出来，剪刀就白做了
 *   4. 概率替换（砂砾 10% 掉燧石）——是**顶替**原掉落，不是额外掉一份
 *   5. 常规掉落表
 *   6. 额外概率掉落（树叶 0.5% 掉苹果）
 * 最后再乘双层台阶与时运。
 *
 * 原先这 5 条规则挤在 `main` 破坏分支的 10 行里，加"剪刀"这条时已经看不清顺序了。
 */
export function blockDrops(blockId: number, ctx: DropContext): { id: number; count: number } | null {
  const scale = (drop: { id: number; count: number }): { id: number; count: number } => {
    const base = ctx.doubleSlab ? drop.count * 2 : drop.count;
    return { id: drop.id, count: base * fortuneMultiplier(blockId, ctx.fortune, ctx.roll()) };
  };

  // 1) 剪刀：羊毛、树叶与藤蔓都能"完整带走"（原版剪刀就是这几样的专用工具）
  const shearsTakes = ctx.shears && (SHEARS_ONLY.has(blockId) || CUTTABLE.has(blockId));
  // 2) 精准采集：能"完整带走"的都生效，但**对羊毛无效**——
  //    原版羊毛的掉落判定只认剪刀（`is(WOOL) && tool.is(ShearsItem)`），
  //    写成"精准采集也能拿羊毛"是个很容易漏掉的偏差
  const silkTakes = ctx.silkTouch && !SHEARS_ONLY.has(blockId) && silkTouchDropsSelf(blockId);
  if (shearsTakes || silkTakes) return scale({ id: blockId, count: 1 });

  // 3) 草丛：没剪刀拿不到它本身，但**有 12.5% 概率掉小麦种子**——
  //    这是原版唯一稳定的种子来源。必须排在下一条 SHEARS_ONLY 之前，
  //    否则会先被判定成"一无所有"，种子永远掉不出来。
  if (GRASS_SEED_SOURCES.has(blockId) && ctx.roll() < GRASS_SEED_CHANCE) {
    return scale({ id: Item.WHEAT_SEEDS, count: 1 });
  }

  // 4) 羊毛没剪就一无所有（注意要在"常规掉落"之前拦，否则会顺着"方块掉自身"漏出来）
  if (SHEARS_ONLY.has(blockId)) return null;

  // 4.5) 活珊瑚（批次 51）：没有精准采集就只掉**失活版本**——
  //      原版活珊瑚块/丛/扇的掉落判定就是"带精准采集给活的，否则给灰的"，
  //      所以"想搬走活珊瑚"必须专门准备一把精准采集的镐/剪刀。
  //      ⚠️ 这一条必须排在**精准采集之后**（上面那条已经把活珊瑚自身返回了），
  //      并且排在常规掉落之前——否则会掉出"活的珊瑚块"，精准采集就白做了。
  const deadCoral = CORAL_DEAD_VARIANT.get(blockId);
  if (deadCoral !== undefined) return scale({ id: deadCoral, count: 1 });

  // 5~7) 概率替换 → 常规掉落 → 额外概率掉落
  const drop = replaceDropFor(blockId, ctx.roll()) ?? dropFor(blockId) ?? rareDropFor(blockId, ctx.roll());
  return drop ? scale(drop) : null;
}

/** 草丛这类"拔了有概率掉种子"的方块（原版 12.5%） */
const GRASS_SEED_SOURCES = new Set<number>([Block.SHORT_GRASS, Block.FERN]);
export const GRASS_SEED_CHANCE = 0.125;

/**
 * 收成熟小麦时额外掉的种子（H13）。
 *
 * 原版成熟小麦掉 **1 个小麦 + 0~3 粒种子（平均 1.5 粒）**。
 * 单独抽出来而不是让 `blockDrops` 返回数组：目前只有这一处要"一个方块掉两样"，
 * 为它改 `blockDrops` 的返回类型会牵动所有调用方与断言，等以后（比如树叶掉树苗+苹果）
 * 真的多起来了再改。两次掷点拼出 0~3，期望 1.5 与原版一致。
 */
export function wheatExtraSeeds(blockId: number, roll: () => number): number {
  const stage = wheatStageOf(blockId);
  if (stage < 0 || stage < WHEAT_STAGES.length - 1) return 0;
  return (roll() < 0.75 ? 1 : 0) + (roll() < 0.75 ? 1 : 0);
}

/**
 * 收成熟作物时**额外**掉的那一份（H13 续）。
 *
 * - 小麦：0~3 粒种子（原版平均 1.5）
 * - 胡萝卜/马铃薯：各 0~2 个（原版成熟一次给 1~4 个，主掉落已经给了 2 个）
 *
 * @returns 额外掉落物与数量；没有额外掉落返回 null
 */
export function extraCropDrop(blockId: number, roll: () => number): { id: number; count: number } | null {
  // 甜浆果丛（批次 49）：主掉落 1~2 个，成熟后**额外**再给 0~1 个
  // （合起来 阶段2 是 1~2、阶段3 是 2~3，与原版一致）
  const berryStage = berryStageOf(blockId);
  if (berryStage >= 0) {
    if (berryStage < 2) return null;
    const extra = (roll() < 0.5 ? 1 : 0) + (berryStage >= 3 && roll() < 0.5 ? 1 : 0);
    return extra > 0 ? { id: Item.SWEET_BERRIES, count: extra } : null;
  }

  const crop = cropOf(blockId);
  if (!crop || !crop.ripe) {
    // 未熟的胡萝卜/马铃薯只会掉回 1 个自己（主掉落已经处理），没有额外
    return null;
  }
  if (crop.crop === 'wheat') {
    const seeds = wheatExtraSeeds(blockId, roll);
    return seeds > 0 ? { id: Item.WHEAT_SEEDS, count: seeds } : null;
  }
  // 甜菜（批次 48）：熟了额外掉 0~2 粒种子（种子只有村庄/矿井那两条来源，
  // 让它自己接得上才有意义——否则"种一次就绝后"）
  if (crop.crop === 'beetroots') {
    const seeds = (roll() < 0.5 ? 1 : 0) + (roll() < 0.5 ? 1 : 0);
    return seeds > 0 ? { id: Item.BEETROOT_SEEDS, count: seeds } : null;
  }
  // 胡萝卜/马铃薯：0~1 个，两次掷点拼出 0~2，期望 1（主掉落 2 + 额外 1 ≈ 原版 1~4 的中值）
  const extra = (roll() < 0.5 ? 1 : 0) + (roll() < 0.5 ? 1 : 0);
  if (extra <= 0) return null;
  return { id: crop.crop === 'carrots' ? Item.CARROT : Item.POTATO, count: extra };
}

/** 与"掉落自身"不同的特例 */
const DROP_OVERRIDES = new Map<number, { id: number; count: number }>([
  [Block.GRASS_BLOCK, { id: Block.DIRT, count: 1 }],
  // 小麦（H13）：没熟只能拿回 1 粒种子，熟了才给小麦（种子另算，见 wheatExtraSeeds）
  [Block.WHEAT_STAGE0, { id: Item.WHEAT_SEEDS, count: 1 }],
  [Block.WHEAT_STAGE1, { id: Item.WHEAT_SEEDS, count: 1 }],
  [Block.WHEAT_STAGE2, { id: Item.WHEAT_SEEDS, count: 1 }],
  [Block.WHEAT_STAGE3, { id: Item.WHEAT, count: 1 }],
  // 甜浆果丛（批次 49）：无论哪个阶段都掉甜浆果（原版如此：果子没了也不至于一无所有），
  // 数量随阶段涨，见下面的 `extraCropDrop`
  [Block.SWEET_BERRY_BUSH_STAGE0, { id: Item.SWEET_BERRIES, count: 1 }],
  [Block.SWEET_BERRY_BUSH_STAGE1, { id: Item.SWEET_BERRIES, count: 1 }],
  [Block.SWEET_BERRY_BUSH_STAGE2, { id: Item.SWEET_BERRIES, count: 1 }],
  [Block.SWEET_BERRY_BUSH_STAGE3, { id: Item.SWEET_BERRIES, count: 2 }],
  // 可可豆（批次 49）：1 / 2 / 3 个（原版按成熟度给 1~3，没有随机）
  [Block.COCOA_STAGE0, { id: Item.COCOA_BEANS, count: 1 }],
  [Block.COCOA_STAGE1, { id: Item.COCOA_BEANS, count: 2 }],
  [Block.COCOA_STAGE2, { id: Item.COCOA_BEANS, count: 3 }],
  // 甜菜（批次 48）：与小麦同一条规矩——没熟只拿回 1 粒种子，熟了才给甜菜根
  [Block.BEETROOTS_STAGE0, { id: Item.BEETROOT_SEEDS, count: 1 }],
  [Block.BEETROOTS_STAGE1, { id: Item.BEETROOT_SEEDS, count: 1 }],
  [Block.BEETROOTS_STAGE2, { id: Item.BEETROOT_SEEDS, count: 1 }],
  [Block.BEETROOTS_STAGE3, { id: Item.BEETROOT, count: 1 }],
  // 胡萝卜/马铃薯（H13 续）：没熟只掉 1 个自己（能再种回去），熟了才给果实
  [Block.CARROTS_STAGE0, { id: Item.CARROT, count: 1 }],
  [Block.CARROTS_STAGE1, { id: Item.CARROT, count: 1 }],
  [Block.CARROTS_STAGE2, { id: Item.CARROT, count: 1 }],
  [Block.CARROTS_STAGE3, { id: Item.CARROT, count: 2 }],
  [Block.POTATOES_STAGE0, { id: Item.POTATO, count: 1 }],
  [Block.POTATOES_STAGE1, { id: Item.POTATO, count: 1 }],
  [Block.POTATOES_STAGE2, { id: Item.POTATO, count: 1 }],
  [Block.POTATOES_STAGE3, { id: Item.POTATO, count: 2 }],
  [Block.STONE, { id: Block.COBBLESTONE, count: 1 }],
  // 黏土块一次掉 4 个黏土球（原版行为），黏土球烧炼后得到红砖
  [Block.CLAY, { id: Item.CLAY_BALL, count: 4 }],
  // 雪块一次掉 4 个雪球（原版行为）——雪球在生存里的唯一来源
  [Block.SNOW_BLOCK, { id: Item.SNOWBALL, count: 4 }],
  // 雪层：不管叠了几层都只掉 **1 个雪球**（原版如此，层数不进掉落数量），
  // 想要"整块带走"得用精准采集（走 `silkTakes`，轮不到这里）
  [Block.SNOW, { id: Item.SNOWBALL, count: 1 }],
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
  // 下界石英矿石（批次 42）：掉 1 个下界石英。
  // ⚠️ 它此前**漏了这条覆盖**，于是掉的是矿石方块本身——石英家族因此没有原料来源
  // （"一条链收尾时要问第一件原料从哪来"，这是第 N 次踩）
  [Block.NETHER_QUARTZ_ORE, { id: Item.QUARTZ, count: 1 }],
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
