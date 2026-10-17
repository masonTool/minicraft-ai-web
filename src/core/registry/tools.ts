/**
 * 工具、武器与采集规则
 *
 * 这个模块把「工具是什么」和「方块需要什么工具才能挖」放在一起，
 * 因为这两件事必须互相印证：`breakSeconds` 同时用到方块的硬度与工具的速度，
 * `canHarvest` 同时用到方块的采集需求与工具的等级。分散到两个文件很容易改一边忘一边。
 *
 * 与原版对齐的部分：
 *  - 等级沿用原版：0 木/金 · 1 石 · 2 铁 · 3 钻石 · 4 下界合金；
 *  - 挖掘耗时 = 硬度 × (可采集 ? 1.5 : 5) ÷ 工具速度（原版 30/100 除以 20 tick 的等价写法）；
 *  - 「必须用正确工具才掉落」的方块（`minecraft:mineable/*` + `requiresCorrectToolForDrops`）：
 *    等级不够就**挖得动但什么都不掉**，与原版一致。
 *
 * 与原版的已知差异：
 *  - 这里的"工具"只指镐/斧/锹/锄/剑（剪刀、打火石、弓各自有专用模块）；
 *  - 攻击速度（冷却）统一为 0.5 秒，没有按武器区分（原版剑 1.6、斧 0.8~1.0）；
 *  - 下界合金的 id 单独一段（改 id 会毁存档，见 `TOOL_MATERIALS` 的注解），
 *    它也没有合成配方——只能在锻造台上把钻石工具升上去。
 */

import {
  Block,
  COPPER_STAGES,
  CORAL_BLOCK_ID_START,
  CORAL_KINDS,
  DEAD_CORAL_BLOCK_ID_START,
  SHAPED_PARENTS,
  SIGN_IDS,
  STONE_VARIANT_PARENTS,
  Wood,
  WoodShaped,
  blockHardness,
  concreteId,
  copperId,
  slabId,
  stairsId,
  stoneVariantId,
  terracottaId,
  woolId,
} from './blocks.ts';
import { DYE_COLORS } from './colors.ts';
import { enchantLevel } from './enchantments.ts';

// ---------------------------------------------------------------- 工具定义

/**
 * 工具种类。
 *
 * 注意 `shears` **不在** `TOOL_KINDS` 里：剪刀只有铁的一种，而 `TOOL_KINDS` 是用来
 * 「5 种类 × 5 材质」叉乘生成 25 件工具的。剪刀单独注册（见 `SHEARS_INFO`）。
 */
/**
 * ⚠️ `'shears'` 与 `'trident'` **不在 `TOOL_KINDS` 里**（那一份只放"5 种类 × 5 材质"
 * 那套叉乘，用来算物品 id）——它们各有自己的 id，单独登记进 `TOOL_BY_ID`。
 * 往 `TOOL_KINDS` 里加东西会**整体挪动**已有工具的物品 id（存档会错位）。
 */
export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears' | 'trident';

/** 工具材质（原版 `golden_*`，写成 gold 会和矿物 id 混） */
export type ToolMaterial = 'wooden' | 'stone' | 'iron' | 'golden' | 'diamond' | 'netherite';

export interface ToolInfo {
  readonly type: ToolType;
  readonly material: ToolMaterial;
  /** 采集等级 0-4（0 木/金 · 1 石 · 2 铁 · 3 钻石 · 4 下界合金） */
  readonly tier: number;
  /** 采集速度倍率（徒手为 1） */
  readonly speed: number;
  /** 耐久（可挖多少方块 / 攻击多少次） */
  readonly durability: number;
  /** 攻击伤害（含玩家徒手的 1 点，对齐原版界面显示值） */
  readonly attack: number;
}

/** 工具种类顺序（决定物品 id，不要改动顺序） */
/**
 * **参与"种类 × 材质"叉乘**的那 5 种（它们决定物品 id 的排布，见 `toolItemId`）。
 *
 * ⚠️ 类型上排掉了 `'shears'` 与 `'trident'`：这两件各有自己的 id、单独登记进
 * `TOOL_BY_ID`，**不能**混进这一份——往这里加一项会让所有工具的 id 整体挪位（存档错乱）。
 */
export const TOOL_KINDS: readonly Exclude<ToolType, 'shears' | 'trident'>[] = [
  'pickaxe',
  'axe',
  'shovel',
  'hoe',
  'sword',
];
/**
 * **可合成**的 5 种材质，也决定物品 id 的排布。
 *
 * ⚠️ 下界合金**刻意不在这张表里**：`toolItemId` 的公式是
 * `起点 + 种类序号 × TOOL_MATERIALS.length + 材质序号`，往这张表里塞第 6 种材质会让
 * **所有工具的 id 整体错位**（斧子从 1105 变成 1106…），而存档里存的就是这些数字——
 * 一改就等于把老存档里的钻石斧变成别的东西。所以下界合金走**单独一段 id**
 * （`NETHERITE_TOOL_ITEM_START`），要枚举"全部材质"请用 `ALL_TOOL_MATERIALS`。
 */
export const TOOL_MATERIALS: readonly ToolMaterial[] = ['wooden', 'stone', 'iron', 'golden', 'diamond'];

/** 全部工具材质，含下界合金（枚举用；**不要**拿它算 id） */
export const ALL_TOOL_MATERIALS: readonly ToolMaterial[] = [...TOOL_MATERIALS, 'netherite'];

/** 工具物品 id 起点（非方块物品区，1000 以上且避开染料 1020-1035 / 生物掉落 1030-1038 的区间） */
export const TOOL_ITEM_START = 1100;

/** 下界合金工具的物品 id 起点（接在 1270 之后；1270-1379 这一段是空的） */
export const NETHERITE_TOOL_ITEM_START = 1270;

/** 第 (kind, material) 种工具的物品 id */
/**
 * 由"种类 + 材质"算出物品 id。
 *
 * 参数排掉 `'shears'` 与 `'trident'`：那两件不在 `TOOL_KINDS` 里（各有自己的 id），
 * 传进来会算出**别的工具**的 id（`indexOf` 返回 -1，一乘一加就落到前面去了）。
 */
export function toolItemId(kind: Exclude<ToolType, 'shears' | 'trident'>, material: ToolMaterial): number {
  if (material === 'netherite') return NETHERITE_TOOL_ITEM_START + TOOL_KINDS.indexOf(kind);
  return TOOL_ITEM_START + TOOL_KINDS.indexOf(kind) * TOOL_MATERIALS.length + TOOL_MATERIALS.indexOf(material);
}

interface MaterialStat {
  tier: number;
  speed: number;
  durability: number;
}

const MATERIAL_STATS: Record<ToolMaterial, MaterialStat> = {
  wooden: { tier: 0, speed: 2, durability: 59 },
  stone: { tier: 1, speed: 4, durability: 131 },
  iron: { tier: 2, speed: 6, durability: 250 },
  // 金工具等级低但速度最快（原版特性）
  golden: { tier: 0, speed: 12, durability: 32 },
  diamond: { tier: 3, speed: 8, durability: 1561 },
  // 下界合金：采集等级 4（比钻石高一级，能挖钻石镐挖的一切）、速度 9、耐久 2031
  netherite: { tier: 4, speed: 9, durability: 2031 },
};

/**
 * 攻击伤害表（原版 1.18 的显示值，已含徒手 1 点）。
 *
 * ⚠️ 类型里排掉了 `'trident'`：它不是"种类 × 材质"叉乘出来的（原版也不能合成），
 * 属性写在 `TRIDENT_INFO` 那一份里（批次 123）。
 */
const ATTACK_BY_KIND: Record<Exclude<ToolType, 'trident'>, Record<ToolMaterial, number>> = {
  sword: { wooden: 4, stone: 5, iron: 6, golden: 4, diamond: 7, netherite: 8 },
  axe: { wooden: 7, stone: 9, iron: 9, golden: 7, diamond: 9, netherite: 10 },
  pickaxe: { wooden: 2, stone: 3, iron: 4, golden: 2, diamond: 5, netherite: 6 },
  shovel: { wooden: 2.5, stone: 3.5, iron: 4.5, golden: 2.5, diamond: 5.5, netherite: 6.5 },
  hoe: { wooden: 1, stone: 1, iron: 1, golden: 1, diamond: 1, netherite: 1 },
  // 剪刀只有铁的一种，攻击力与徒手相同（原版 1 点）
  shears: { wooden: 1, stone: 1, iron: 1, golden: 1, diamond: 1, netherite: 1 },
};

/**
 * 组装一件工具的完整属性。
 *
 * 参数排掉 `'trident'`：它不走这张表（见 `ATTACK_BY_KIND` 与 `TRIDENT_INFO`）。
 */
export function makeToolInfo(kind: Exclude<ToolType, 'trident'>, material: ToolMaterial): ToolInfo {
  const stat = MATERIAL_STATS[material];
  return {
    type: kind,
    material,
    tier: stat.tier,
    speed: stat.speed,
    durability: stat.durability,
    attack: ATTACK_BY_KIND[kind][material],
  };
}

/** 一件待注册的工具：id / 注册名 / 图集贴图 / 属性 */
export interface ToolSpec {
  readonly id: number;
  readonly name: string;
  readonly tile: string;
  readonly tool: ToolInfo;
}

/**
 * 全部 30 种工具 = 可合成的 25 种（5 种类 × 5 材质，由两张表叉乘）+ 下界合金 5 种。
 *
 * 下界合金单独一段，是因为它的 id 走另一套（见 `TOOL_MATERIALS` 的注解）；
 * 它也没有合成配方——只能拿钻石工具去锻造台升级（见 `core/crafting/Smithing.ts`）。
 */
const BASE_TOOL_SPECS: readonly ToolSpec[] = TOOL_KINDS.flatMap((kind) =>
  TOOL_MATERIALS.map((material) => ({
    id: toolItemId(kind, material),
    name: `minecraft:${material}_${kind}`,
    tile: `item_${material}_${kind}`,
    tool: makeToolInfo(kind, material),
  })),
);

const NETHERITE_TOOL_SPECS: readonly ToolSpec[] = TOOL_KINDS.map((kind) => ({
  id: toolItemId(kind, 'netherite'),
  name: `minecraft:netherite_${kind}`,
  tile: `item_netherite_${kind}`,
  tool: makeToolInfo(kind, 'netherite'),
}));

export const TOOL_SPECS: readonly ToolSpec[] = [...BASE_TOOL_SPECS, ...NETHERITE_TOOL_SPECS];

/** 按物品 id 反查工具属性（非工具返回 undefined） */
/**
 * 剪刀（J8）。
 *
 * 它不是"采集等级"体系的成员（没有等级门槛），真正特别的地方在**掉落**：
 * 羊毛不剪就没有、树叶不剪只掉苹果（见 `items.ts#requiresShears`）。
 * 速度 15 与原版一致：徒手拆羊毛 1.2 秒，剪刀 0.08 秒。
 */
export const SHEARS_INFO: ToolInfo = {
  type: 'shears',
  material: 'iron',
  tier: 1,
  speed: 15,
  durability: 238,
  attack: 1,
};

/**
 * 剪刀的物品 id。
 *
 * 放在这里而不是 `items.ts`，是因为 `TOOL_BY_ID` 必须能按 id 查到剪刀——
 * 否则 `toolInfoById(剪刀)` 返回 undefined，`main.heldTool`、附魔分类、
 * 耐久消耗全都会把剪刀当成"手上没东西"。而反过来让 tools.ts 去 import items.ts
 * 会成环（items.ts 本来就 import 这里）。所以 id 定义在这边，`Item.SHEARS` 引用它。
 */
export const SHEARS_ITEM_ID = 1150;

/**
 * 三叉戟（批次 123，溺尸那一批）。
 *
 * 它**不是**"5 种类 × 5 材质"那套的成员（原版也做不出来，只能从溺尸手里捡），
 * 所以像剪刀一样单独登记：
 *  - 近战 **9 点**——比下界合金剑的 8 还高一点，代价是没有横扫、也不能修；
 *  - 耐久 250（与铁制工具同档）；
 *  - 采集档位与徒手相同（`tier: 0` / `speed: 1`）：原版拿它挖石头并不比手快。
 *
 * ⚠️ 必须登记进 `TOOL_BY_ID`：否则 `main.heldTool` 会把它当成"手上没东西"，
 * 近战伤害、附魔分类、耐久消耗三处都会把它漏掉（剪刀那条注释写过同一个坑）。
 * 也正因为如此，这两个常量要写在 `TOOL_BY_ID` **之前**（`const` 不提升）。
 */
export const TRIDENT_INFO: ToolInfo = {
  type: 'trident',
  material: 'iron',
  tier: 0,
  speed: 1,
  durability: 250,
  attack: 9,
};

/** 三叉戟的物品 id */
export const TRIDENT_ITEM_ID = 1447;

const TOOL_BY_ID = new Map<number, ToolInfo>([
  ...TOOL_SPECS.map((spec) => [spec.id, spec.tool] as [number, ToolInfo]),
  // 剪刀不在 TOOL_SPECS 里（那套是 5 种类 × 5 材质的叉乘），单独登记
  [SHEARS_ITEM_ID, SHEARS_INFO],
  // 三叉戟同理（批次 123）
  [TRIDENT_ITEM_ID, TRIDENT_INFO],
]);

/**
 * 锄头能耕出耕地的方块（H13）。原版还认粗泥/灰化土/土径，我们目前只有前两种。
 * @returns 耕完之后的方块 id；耕地不适合耕就返回 undefined
 */
export function tillableTo(blockId: number): number | undefined {
  return blockId === Block.DIRT || blockId === Block.GRASS_BLOCK ? Block.FARMLAND : undefined;
}

/** 手上这东西能不能耕地（只有锄头行） */
export function canTill(tool: ToolInfo | null | undefined): boolean {
  return tool !== null && tool !== undefined && tool.type === 'hoe';
}

export function toolInfoById(itemId: number): ToolInfo | undefined {
  return TOOL_BY_ID.get(itemId);
}

// ---------------------------------------------------------------- 采集需求

/** 采集该方块需要的工具与最低等级 */
export interface HarvestRequirement {
  readonly tool: ToolType;
  readonly tier: number;
}

/**
 * 必须用正确工具（且等级够）才会掉落的方块。
 *
 * 对应原版的 `requiresCorrectToolForDrops`：等级不够时**挖得动但一无所获**。
 * **不在表里 = 徒手就能采到**（`isHandHarvestable` 就是这么派生的），
 * 这样木质方块、泥土、玻璃这些"斧/锹能加速但徒手也能捡"的方块不用逐个登记。
 */
const REQUIRED_TOOL = new Map<number, HarvestRequirement>();

/**
 * 徒手也能采集、但用对应工具会明显加速的方块。
 * （必须用工具的方块不必登记在这里，`efficientToolType` 会从 REQUIRED_TOOL 里取。）
 */
const EFFICIENT_TOOL = new Map<number, ToolType>();

function requirePickaxe(tier: number, ids: readonly number[]): void {
  for (const id of ids) REQUIRED_TOOL.set(id, { tool: 'pickaxe', tier });
}

// ---- 木质镐就能挖（原版 tier 0）：石质家族、部分矿物、功能方块
requirePickaxe(0, [
  Block.STONE,
  Block.COBBLESTONE,
  Block.DEEPSLATE,
  Block.GRANITE,
  Block.DIORITE,
  Block.ANDESITE,
  Block.TUFF,
  Block.CALCITE,
  Block.SANDSTONE,
  Block.SMOOTH_STONE,
  Block.STONE_BRICKS,
  Block.CHISELED_STONE_BRICKS,
  Block.POLISHED_GRANITE,
  Block.POLISHED_DIORITE,
  Block.POLISHED_ANDESITE,
  Block.DEEPSLATE_BRICKS,
  Block.CHISELED_DEEPSLATE,
  Block.POLISHED_DEEPSLATE,
  Block.BRICKS,
  Block.COBBLED_DEEPSLATE,
  Block.MOSSY_COBBLESTONE,
  Block.MOSSY_STONE_BRICKS,
  Block.CRACKED_STONE_BRICKS,
  Block.CRACKED_DEEPSLATE_BRICKS,
  Block.CHISELED_SANDSTONE,
  Block.CUT_SANDSTONE,
  Block.SMOOTH_SANDSTONE,
  // 红砂岩家族（批次 45）：与砂岩家族同一档——要镐，但不挑等级
  Block.RED_SANDSTONE,
  Block.CHISELED_RED_SANDSTONE,
  Block.CUT_RED_SANDSTONE,
  Block.SMOOTH_RED_SANDSTONE,
  Block.COBBLESTONE_WALL,
  Block.STONE_BRICK_WALL,
  Block.FURNACE,
  // 烟熏炉与高炉（批次 46）：与熔炉同一档——要镐，但不挑等级
  Block.SMOKER,
  Block.BLAST_FURNACE,
  // 投掷器（批次 59）与发射器（批次 60）：与熔炉同一档——要镐，但不挑等级
  Block.DROPPER,
  Block.DISPENSER,
  Block.COAL_ORE,
  Block.DEEPSLATE_COAL_ORE,
  Block.NETHER_QUARTZ_ORE,
  // 海晶石家族与末地建材
  Block.PRISMARINE,
  Block.PRISMARINE_BRICKS,
  Block.DARK_PRISMARINE,
  Block.END_STONE,
  Block.END_STONE_BRICKS,
  Block.PURPUR_BLOCK,
  Block.PURPUR_PILLAR,
  // 下界石材
  Block.BASALT,
  Block.SMOOTH_BASALT,
  Block.BLACKSTONE,
  Block.NETHER_BRICKS,
  // 黑石家族（批次 82）：与黑石同一档——要镐，但不挑等级。
  // 鎏金黑石也在这一档：它掉的是金粒，但**还是得用镐**（原版如此）
  Block.POLISHED_BLACKSTONE,
  Block.POLISHED_BLACKSTONE_BRICKS,
  Block.GILDED_BLACKSTONE,
  // 红石元件里需要镐的那几个
  // 避雷针（批次 83）：铜做的，要镐但不挑等级（与铜块同档）
  Block.LIGHTNING_ROD,
  Block.REDSTONE_LAMP,
  Block.PISTON,
  Block.STICKY_PISTON,
  Block.OBSERVER,
  // 附魔台（H9）与铁砧（H8）：原版要镐但对等级没有要求——**任何**镐都能采到
  Block.ENCHANTING_TABLE,
  Block.ANVIL,
  // 铁块要石镐（原版）
  Block.IRON_BLOCK,
  // 锻造台（K8 尾巴）：原版要镐但对等级没有要求——任何镐都能采到
  Block.SMITHING_TABLE,
  // 切石机（H11，批次 44）：同样是"要镐但不挑等级"的工作台
  Block.STONECUTTER,
  // 砂轮（J23，批次 90）：石头做的转轮，原版同样"要镐、不限等级"
  Block.GRINDSTONE,
  // 锁链（B11）：原版同样是"要镐、不限等级"（徒手挖得动但什么都不掉）
  Block.CHAIN,
  // 石英家族、深板岩瓦、红色下界砖（批次 42）：原版都要镐，且不限等级。
  // 海晶石三兄弟早在 218~220 就登记过（这一批只是给它们补台阶/楼梯/墙）
  Block.QUARTZ_BLOCK,
  Block.CHISELED_QUARTZ_BLOCK,
  Block.QUARTZ_PILLAR,
  Block.SMOOTH_QUARTZ,
  Block.DEEPSLATE_TILES,
  Block.RED_NETHER_BRICKS,
]);
// 书架：原版是"斧更快、徒手也能采到"，所以只进加速表不进需求表
EFFICIENT_TOOL.set(Block.BOOKSHELF, 'axe');
// 营火（批次 47）：同样是"斧更快、徒手也能采"（还常见于"用什么工具都能拆"）
EFFICIENT_TOOL.set(Block.CAMPFIRE, 'axe');

// 铜的四档 × 四种形状（批次 40）：原版要**石镐**（needs_stone_tool），全 16 个同档
// （按表展开而不是从 `world/Copper.ts` 取：注册表层不该反向依赖 world 层）
for (let stage = 0; stage < COPPER_STAGES.length; stage++) {
  for (let kind = 0; kind < 4; kind++) {
    REQUIRED_TOOL.set(copperId(stage, kind as 0 | 1 | 2 | 3), { tool: 'pickaxe', tier: 1 });
  }
}

// 羊毛：剪刀是加速工具，但**不能**顺手放进 REQUIRED_TOOL——
// 原版"必须用剪刀"体现在掉落表里，破坏耗时不受影响（徒手拆羊毛仍是正常的 1.2 秒，
// 只是什么都不掉）。放进 REQUIRED_TOOL 会让徒手耗时变成 4 秒，手感直接变差。
for (let i = 0; i < DYE_COLORS.length; i++) EFFICIENT_TOOL.set(woolId(i), 'shears');
// 雪层：锹是加速工具（原版同一条：徒手也能撸掉，拿锹快得多），不进需求表
EFFICIENT_TOOL.set(Block.SNOW, 'shovel');
// 地毯：原版没有任何工具能加速，徒手最快——所以既不在需求表也不在加速表里
// 刷怪笼（批次 92）：原版硬度 5、要镐（徒手挖得动但一无所获——它本来也不掉落，
// 见 `items.ts` 的 `NO_DROP`）
REQUIRED_TOOL.set(Block.SPAWNER, { tool: 'pickaxe', tier: 0 });
// 陶瓦与混凝土（17 色 / 16 色）都需要镐
// ⚠️ 原色陶瓦是 `Block.TERRACOTTA`（不在 `terracottaId(i)` 的范围里，见那个函数的注释）
REQUIRED_TOOL.set(Block.TERRACOTTA, { tool: 'pickaxe', tier: 0 });
for (let i = 0; i < DYE_COLORS.length; i++) REQUIRED_TOOL.set(terracottaId(i), { tool: 'pickaxe', tier: 0 });
for (let i = 0; i < DYE_COLORS.length; i++) REQUIRED_TOOL.set(concreteId(i), { tool: 'pickaxe', tier: 0 });
// 珊瑚块（批次 51）：原版的珊瑚块与失活珊瑚块都**必须用镐**（硬度 1.5，与石砖同档），
// 徒手挖得动但一无所获。⚠️ 珊瑚丛与珊瑚扇**不在这里**——它们是植物（一碰就掉、徒手可采）
requirePickaxe(
  0,
  [
    ...CORAL_KINDS.map((_, i) => CORAL_BLOCK_ID_START + i),
    ...CORAL_KINDS.map((_, i) => DEAD_CORAL_BLOCK_ID_START + i),
  ],
);

// 漏斗（批次 58）：原版与铁块同一档，**木质镐就能挖**（徒手挖得动但一无所获）
requirePickaxe(0, [Block.HOPPER, Block.SHULKER_BOX]);

// ---- 石镐（tier 1）：铁/铜/青金石矿与粗金属块
requirePickaxe(1, [
  Block.IRON_ORE,
  Block.COPPER_ORE,
  Block.LAPIS_ORE,
  Block.DEEPSLATE_IRON_ORE,
  Block.DEEPSLATE_COPPER_ORE,
  Block.DEEPSLATE_LAPIS_ORE,
  Block.RAW_COPPER_BLOCK,
  Block.RAW_IRON_BLOCK,
]);

// ---- 铁镐（tier 2）：金/红石/钻石/绿宝石矿
requirePickaxe(2, [
  Block.GOLD_ORE,
  Block.REDSTONE_ORE,
  Block.DIAMOND_ORE,
  Block.EMERALD_ORE,
  Block.DEEPSLATE_GOLD_ORE,
  Block.DEEPSLATE_REDSTONE_ORE,
  Block.DEEPSLATE_DIAMOND_ORE,
  Block.DEEPSLATE_EMERALD_ORE,
]);

// ---- 钻石镐（tier 3）：黑曜石、远古残骸与下界合金块
// 下界合金块要钻石镐（原版如此）：想把它挖回去得先有钻石镐，和"想炼下界合金先要钻石镐"一致
requirePickaxe(3, [Block.OBSIDIAN, Block.ANCIENT_DEBRIS, Block.NETHERITE_BLOCK, Block.ENDER_CHEST]);

// ---- 矿物块与信标（批次 117，K5 信标那一批的开采口径）
// 矿物块**跟随它那种矿石的档位**：铁块要石镐（与铁矿同档），
// 金/钻石/绿宝石块要铁镐（与它们各自的矿石同档）——原版 1.17 起就是这么归的
requirePickaxe(1, [Block.IRON_BLOCK, Block.GOLD_BLOCK]);
requirePickaxe(2, [Block.DIAMOND_BLOCK, Block.EMERALD_BLOCK]);
// 信标：原版木质镐就能挖下来（它是"打凋灵换来"的东西，不该再用工具档位卡一道）
requirePickaxe(0, [Block.BEACON]);

// 台阶 / 楼梯跟随母方块：母方块要镐，它们也要
for (let index = 0; index < SHAPED_PARENTS.length; index++) {
  const parent = SHAPED_PARENTS[index]![0];
  const required = REQUIRED_TOOL.get(parent);
  if (!required) continue;
  REQUIRED_TOOL.set(slabId(index), required);
  REQUIRED_TOOL.set(stairsId(index), required);
}

// 石材家族的台阶/楼梯/墙（批次 41）同样跟随母方块：
// 母方块要镐它们就要镐、母方块是几级镐它们就是几级（原版如此）。
// 按父级**取**而不是重新手抄一张表——母方块换档时这里自动跟上。
for (const [parent, name, kinds] of STONE_VARIANT_PARENTS) {
  const required = REQUIRED_TOOL.get(parent);
  if (!required) continue;
  for (const kind of kinds) REQUIRED_TOOL.set(stoneVariantId(name, kind)!, required);
}

// ---- 加速表：斧头砍木、锹挖土
// 藤蔓（B11）：原版归 `mineable/axe`（斧头更快），但它掉不掉取决于剪刀/精准采集，
// 所以只进加速表、不进需求表——与羊毛"剪刀"那条同一个道理（见下面羊毛那段的注解）
EFFICIENT_TOOL.set(Block.VINE, 'axe');
for (const id of [
  Block.OAK_FENCE,
  Block.OAK_DOOR,
  Block.LADDER,
  Block.CRAFTING_TABLE,
  Block.CHEST,
  // 木桶（批次 61）：与箱子一样"斧头更快，但徒手也能挖下来"
  Block.BARREL,
  // 堆肥桶（批次 70）：木制桶，斧头更快（原版也是）
  Block.COMPOSTER,
  // 音符盒（批次 173）：木头做的，斧头更快、徒手也能挖（原版 0.8 硬度）
  Block.NOTE_BLOCK,
  // 工作站四件里的三件木制的（J23，批次 90）：斧头更快、徒手也能采
  // （砂轮是石头做的，走下面的"要镐"那一档）
  Block.LECTERN,
  Block.FLETCHING_TABLE,
  Block.LOOM,
  Block.PUMPKIN,
  Block.MELON,
  Block.BAMBOO,
  Block.CRIMSON_STEM,
  Block.WARPED_STEM,
  Block.CRIMSON_PLANKS,
  Block.WARPED_PLANKS,
  Block.NETHER_WART_BLOCK,
  Block.WARPED_WART_BLOCK,
]) {
  EFFICIENT_TOOL.set(id, 'axe');
}
for (const ids of Object.values(Wood)) {
  EFFICIENT_TOOL.set(ids.log, 'axe');
  EFFICIENT_TOOL.set(ids.planks, 'axe');
  EFFICIENT_TOOL.set(ids.slab, 'axe');
  EFFICIENT_TOOL.set(ids.stairs, 'axe');
}
// 木制方块族（批次 38）：栅栏 / 栅栏门 / 门 / 活板门同样是"斧更快、徒手也能采"
for (const ids of Object.values(WoodShaped)) {
  EFFICIENT_TOOL.set(ids.fence, 'axe');
  EFFICIENT_TOOL.set(ids.fenceGate, 'axe');
  EFFICIENT_TOOL.set(ids.door, 'axe');
  EFFICIENT_TOOL.set(ids.trapdoor, 'axe');
}
// 告示牌（批次 80）：原版归 `mineable/axe`——斧更快、徒手也能采（硬度 1）
for (const id of SIGN_IDS) EFFICIENT_TOOL.set(id, 'axe');
// 橡木是"基础方块"（id 5/6/7 与台阶楼梯 80/84），不在 Wood 表里，得单独登记
EFFICIENT_TOOL.set(Block.OAK_LOG, 'axe');
EFFICIENT_TOOL.set(Block.OAK_PLANKS, 'axe');
for (let index = 0; index < SHAPED_PARENTS.length; index++) {
  if (SHAPED_PARENTS[index]![0] !== Block.OAK_PLANKS) continue;
  EFFICIENT_TOOL.set(slabId(index), 'axe');
  EFFICIENT_TOOL.set(stairsId(index), 'axe');
}
for (const id of [Block.DIRT, Block.GRASS_BLOCK, Block.SAND, Block.GRAVEL, Block.CLAY, Block.SNOW_BLOCK, Block.SOUL_SAND, Block.SOUL_SOIL]) {
  EFFICIENT_TOOL.set(id, 'shovel');
}

/** 该方块的采集需求；undefined 表示徒手可采集 */
export function harvestRequirement(blockId: number): HarvestRequirement | undefined {
  return REQUIRED_TOOL.get(blockId);
}

/** 用哪种工具挖这个方块会加速；undefined 表示没有工具能加速 */
export function efficientToolType(blockId: number): ToolType | undefined {
  return REQUIRED_TOOL.get(blockId)?.tool ?? EFFICIENT_TOOL.get(blockId);
}

/**
 * 用这把手上的工具能不能"采到"这个方块（决定是否掉落）。
 * 等级不够 / 工具类型不对 → false（原版：挖得动但什么都不掉）。
 */
/**
 * 这个方块**徒手就能采到**吗（批次 62）。
 *
 * ⚠️ 这条判定的**唯一事实来源是"要求工具"那张表**：原版里"徒手能采"就等于
 * "没有 `requiresCorrectToolForDrops`"。所以这里**由表派生**，而不是另写一张手写清单——
 * 批次 61 的探针正是被那种"两张手写表必须同时正确"的设计咬到：
 * `canHarvest` 的兜底原来查一张手写的徒手表，于是**既不在需求表、又没写进徒手表**的
 * 方块（红石粉/拉杆/活塞/酿造台/海晶灯/龙蛋…共 20 个）**拿什么挖都不掉**，
 * 而创造模式不产生掉落，所以一直没被发现。
 */
export function isHandHarvestable(blockId: number): boolean {
  return !REQUIRED_TOOL.has(blockId);
}

export function canHarvest(blockId: number, tool?: ToolInfo | null): boolean {
  const required = REQUIRED_TOOL.get(blockId);
  // 没要求工具 = 一定采得到（原来这里查那张手写的徒手表，漏登记就"挖了什么都不掉"）
  if (!required) return true;
  if (!tool || tool.type !== required.tool) return false;
  return tool.tier >= required.tier;
}

/**
 * 破坏该方块所需秒数（对齐原版公式）：
 *   可采集 → 1.5 × 硬度 ÷ 速度；不可采集 → 5 × 硬度 ÷ 速度
 * 例：石头徒手 7.5s、木镐 1.125s、钻石镐 0.281s；黑曜石徒手 250s、钻石镐 9.375s。
 */
export function breakSeconds(
  blockId: number,
  tool?: ToolInfo | null,
  enchants?: Readonly<Record<string, number>>,
): number {
  const hardness = blockHardness(blockId);
  if (hardness < 0) return Number.POSITIVE_INFINITY;
  if (hardness === 0) return 0;
  const efficient = efficientToolType(blockId);
  // 效率附魔按原版加 `等级² + 1` 的速度，但**只有拿对工具时才生效**——
  // 拿镐挖土不会因为镐上有"效率 V"就变快
  const correctTool = tool !== null && tool !== undefined && efficient === tool.type;
  const efficiency = correctTool ? enchantLevel(enchants, 'efficiency') : 0;
  const toolSpeed = correctTool ? tool.speed : 1;
  // 原版是 `if (efficiency > 0) speed += efficiency² + 1`——那个 +1 **只在有附魔时才加**，
  // 写成 `tool.speed + 0 + 1` 会让所有工具凭空快 1 点
  const speed = efficiency > 0 ? toolSpeed + efficiency * efficiency + 1 : toolSpeed;
  const multiplier = canHarvest(blockId, tool) ? 1.5 : 5;
  return (hardness * multiplier) / speed;
}

/**
 * 近战伤害（含「锋利」与按生物家族分流的「亡灵杀手 / 节肢杀手」）。
 *
 * 原版式子：
 *  - 锋利：每级 +0.5、且**只要有一级就再 +0.5**（所以 I 级是 +1.0 而不是 +0.5）
 *  - 亡灵杀手 / 节肢杀手：每级 +2.5，**只对对应家族的生物生效**（对别的生物一点不加）
 * 抽成纯函数是因为伤害公式原先写在 `main` 的近战分支里，离线测不到——
 * "锋利到底加了多少"这种数必须能断言。
 *
 * @param family 被打的生物家族；不是亡灵/节肢就为 undefined（此时两条杀手都不生效）
 */
export function meleeDamage(
  weaponAttack: number,
  enchants?: Readonly<Record<string, number>>,
  family?: 'undead' | 'arthropod',
): number {
  const sharpness = enchantLevel(enchants, 'sharpness');
  let damage = weaponAttack + (sharpness > 0 ? 0.5 * sharpness + 0.5 : 0);
  if (family === 'undead') damage += 2.5 * enchantLevel(enchants, 'smite');
  if (family === 'arthropod') damage += 2.5 * enchantLevel(enchants, 'bane_of_arthropods');
  return damage;
}

/**
 * 「抢夺」带来的额外掉落上限。
 * 原版是把每种掉落的**数量上限**加上等级（`uniform(min, max + looting)`），
 * 所以这里返回的正是那个加数，由 `Mob.dropLoot` 加在 `max` 上。
 */
export function lootingBonus(enchants?: Readonly<Record<string, number>>): number {
  return enchantLevel(enchants, 'looting');
}

// ---------------------------------------------------------------- 单个注册的耐久品

// ---------------------------------------------------------------- 工具耐久文案

/**
 * 供界面显示的"耐久 137/250"。
 * 参数只要求"有 durability"，因此工具（`ToolInfo`）与盔甲（`ArmorInfo`）都能直接用。
 */
export function durabilityLabel(item: { durability: number }, damage: number): string {
  return `耐久 ${Math.max(0, item.durability - damage)}/${item.durability}`;
}
