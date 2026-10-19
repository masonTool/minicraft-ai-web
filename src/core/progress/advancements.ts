/**
 * 成就 / 进度（M7，批次 87）
 *
 * 这一模块只装**数据**：每一行长成什么样、挂在哪一支、靠什么达成。
 * 判定逻辑在 `AdvancementTracker.ts`（纯类，可离线断言），界面在 `ui/AdvancementScreen.ts`。
 *
 * 三件事先说清楚，它们决定了这个文件为什么长这样：
 *
 *  1. **触发条件是数据，不是代码**。每条进度写一个 `trigger`（种类 + 目标），
 *     主程序只负责在事件发生处调一次 `tracker.handle({ kind: 'obtain', item })`。
 *     于是"再加 30 条进度"是**加数据**，不是加 30 处 if——这也是本项目反复吃过的教训
 *     （能生成的就别手抄、能推的推、该手写的写明）。
 *  2. **大部分进度看的是"背包里有没有过"**，而不是"是不是合成出来的"。
 *     原版同样是这么做的（`inventory_changed` 触发器占了大半张表），
 *     所以"挖到的 / 合出来的 / 烧出来的 / 从箱子里拿的 / 钓上来的"一律算数，
 *     主程序只要在**背包变化**时把新增的那几件报上来一次。
 *  3. **id 一律用原版的**（`minecraft:story/mine_stone` 这种），中文名与说明也照原版的口气写。
 *     名字即接口：以后想对表（"原版有 100 条，我们有 26 条"）不用再翻译一遍。
 *
 * ⚠️ 本批只做**能用现有事件判定**的那些条；依赖未实现内容（村民交易、蜜蜂、信标、
 * 鞘翅、刷怪笼…）的条目**不做也不编**，缺哪些、为什么缺写在 TASKS M7 里。
 */

import { Block, CROP_STAGES, Wood } from '../registry/blocks.ts';
import { Item } from '../registry/items.ts';
// 击杀类进度按**生物表派生**（批次 93）：见下面 `HOSTILE_MOBS` 的注释
import { ALL_HOSTILE_MOBS } from '../entity/mobs.ts';
import { toolItemId } from '../registry/tools.ts';
import { armorItemId, ARMOR_TYPES, type ArmorMaterial } from '../registry/armor.ts';

/** 进度的分类（原版是几个"标签页"，本项目的界面按它分组） */
export type AdvancementTab = 'minecraft' | 'nether' | 'end' | 'adventure' | 'husbandry';

export interface AdvancementTabDef {
  readonly id: AdvancementTab;
  readonly title: string;
  /** 这一支的根条目（`parent === null` 的那一条） */
  readonly root: string;
}

/**
 * 一次"发生了什么"。
 *
 * 主程序只会在几处地方构造它（背包变化 / 放置 / 破坏 / 击杀 / 繁殖 / 钓上 / 入睡 /
 * 换维度 / 末影龙倒地），所以这里的字段是**够用的最小集**，不是"通用事件总线"。
 */
export type ProgressEvent =
  /** 背包里出现过某件物品（含挖到/合成/烧出/拾取/容器取出/钓上来的） */
  | { readonly kind: 'obtain'; readonly item: number; readonly enchanted?: boolean }
  /** 吃下/喝下某件物品 */
  | { readonly kind: 'eat'; readonly item: number }
  /** 放下某方块（含种下一颗种子） */
  | { readonly kind: 'place'; readonly block: number }
  /** 击杀某生物（`mob` 是生物 id） */
  | { readonly kind: 'kill'; readonly mob: string }
  /** 繁殖出某生物的幼体 */
  | { readonly kind: 'breed'; readonly mob: string }
  /** 进入某维度（`overworld` / `nether` / `end`） */
  | { readonly kind: 'dimension'; readonly dimension: string }
  /** 钓上来一件东西 */
  | { readonly kind: 'fish'; readonly item: number }
  /**
   * 与村民成交一笔（J11，批次 88）。
   *
   * 不带任何字段：原版那条"这是什么？"就是"做过一次交易"，
   * 将来要加"用某种东西换"再在这里补 `item`（那时才需要它）。
   */
  | { readonly kind: 'trade' }
  /** 睡了一觉（睡到天亮） */
  | { readonly kind: 'sleep' }
  /** 走进一个群系（批次 371；`biome` 是群系注册名） */
  | { readonly kind: 'biome'; readonly biome: string }
  /** 村庄保卫战（批次 383）：1 = 在村庄附近击杀掠夺者，2 = 击退一波（5 只） */
  | { readonly kind: 'raid'; readonly stage: number }
  /** 末影龙倒地 */
  | { readonly kind: 'dragon' }
  /** 不需要条件，由主程序显式授予（根条目用） */
  | { readonly kind: 'auto' };

export type TriggerKind = ProgressEvent['kind'];

export interface AdvancementTrigger {
  readonly kind: TriggerKind;
  /**
   * 目标 id（物品或方块，按 `kind` 解释）：**命中其中任意一个**就算数。
   *
   * 省略表示"这一类里的任意一个都行"（例如"获得任意一件带附魔的物品"）。
   */
  readonly ids?: readonly number[];
  /** 生物 id（`kill` / `breed`）：命中任意一个就算数 */
  readonly mobs?: readonly string[];
  /** 维度 id（`dimension`） */
  readonly dimensions?: readonly string[];
  /** 群系注册名（`biome`；省略表示任意群系） */
  readonly biomes?: readonly string[];
  /** 保卫战的阶段（`raid`；省略表示任意阶段） */
  readonly raidStage?: number;
  /**
   * 计数型：要命中**几个不同的目标**才算达成（原版的"资深怪物猎人"就是这样）。
   *
   * "不同"按命中值去重（生物 id / 物品 id / 维度 id），进度集随存档走——
   * 所以"两天各杀一只僵尸"不会算成两只（原版也不会）。
   */
  readonly needCount?: number;
  /** 只认**带附魔**的那一件（`obtain` 用）：原版的"附魔师"就是这么判的 */
  readonly enchanted?: boolean;
}

export interface AdvancementDef {
  /** 原版 id（`minecraft:story/root` 的这种全名） */
  readonly id: string;
  /** 父条目；`null` 表示这一支的根 */
  readonly parent: string | null;
  readonly tab: AdvancementTab;
  /** 界面上的标题（中文） */
  readonly title: string;
  /** 界面上的说明：**怎么写才能拿到**（原版的说明也是这个口气） */
  readonly desc: string;
  /** 图标：任意已注册的物品/方块 id（界面直接画它的图标） */
  readonly icon: number;
  readonly trigger: AdvancementTrigger;
  /** 原版的"挑战"（紫色边框，通常是需要耐心的一类） */
  readonly challenge?: boolean;
}

export const ADVANCEMENT_TABS: readonly AdvancementTabDef[] = [
  { id: 'minecraft', title: '我的世界', root: 'minecraft:story/root' },
  { id: 'nether', title: '下界', root: 'minecraft:nether/root' },
  { id: 'end', title: '末地', root: 'minecraft:end/root' },
  { id: 'adventure', title: '冒险', root: 'minecraft:adventure/root' },
  { id: 'husbandry', title: '农牧', root: 'minecraft:husbandry/root' },
];

// ---------------------------------------------------------------- 派生出来的一批目标
//
// 都是"某张表的头一项"这类**能算出来的**东西：写死一串 id 的话，
// 哪天表里加一种木材/一种颜色，进度就会漏掉它，而且不会报错。

/** 各种作物的第 0 阶段（种子放下去的那一格）：`place` 触发"种下一颗种子"用的就是它 */
const CROP_FIRST_STAGES: readonly number[] = Object.values(CROP_STAGES).map((stages) => stages[0]!);

/** 某一种装备的全部材质（锁链除外：原版没有它的配方，真做出来也拿不到） */
function armorIdsOf(type: (typeof ARMOR_TYPES)[number], materials: readonly ArmorMaterial[]): number[] {
  return materials.map((material) => armorItemId(type, material));
}

/**
 * 胸甲的四档可合成材质。
 *
 * ⚠️ 锁链**不在里面**：它在原版的材料与图案与铁甲逐格相同，所以原版干脆不给它配方
 * （见 TASKS J8 那批的记录）。把它写进"获得任意胸甲"不影响达成，但会让人以为
 * "这四档都能自己造出来"——而锁链甲在生存里拿不到。
 */
const CRAFTABLE_ARMOR_MATERIALS: readonly ArmorMaterial[] = ['leather', 'iron', 'golden', 'diamond'];

/**
 * 敌对生物（击杀类进度共用）：**从生物表派生，不手写**（批次 93 改）。
 *
 * 原先这里是手写的 `['zombie', 'skeleton', 'creeper']`——批次 92/93 加了烈焰人、
 * 蜘蛛、洞穴蜘蛛之后它就成了**第二份真相**（"击败一只敌对生物"打蜘蛛反而不算）。
 * 原版那条本来就不挑物种，所以直接引 `ALL_HOSTILE_MOBS`
 * （含不自然刷新的烈焰人与洞穴蜘蛛——从刷怪笼里打出来的当然也算怪物）。
 */
const HOSTILE_MOBS: readonly string[] = ALL_HOSTILE_MOBS.map((type) => type.id);

/** 能繁殖的四种家畜 */
const BREEDABLE_MOBS: readonly string[] = ['cow', 'pig', 'sheep', 'chicken'];

/**
 * "均衡饮食"要吃的食物种类。
 *
 * 挑的是**生存里真的能拿到**的那一批（作物/家畜/钓鱼/合成/熔炼各有覆盖），
 * 因此"吃遍"这件事是可达的——`tools/advancement-test.ts` 会对每一样都反查一次来源。
 */
const DIET_FOODS: readonly number[] = [
  Item.APPLE,
  Item.BREAD,
  Item.BEEF,
  Item.PORKCHOP,
  Item.CHICKEN,
  Item.MUTTON,
  Item.COOKED_BEEF,
  Item.COOKED_PORKCHOP,
  Item.COOKED_CHICKEN,
  Item.CARROT,
  Item.POTATO,
  Item.BAKED_POTATO,
  Item.BEETROOT,
  Item.COOKIE,
  Item.COD,
  Item.SALMON,
  Item.MUSHROOM_STEW,
  Item.PUMPKIN_PIE,
  Item.SWEET_BERRIES,
];

/** "均衡饮食"要吃到几种（原版是"吃遍所有食物"，本项目按可达的那一批取一半左右） */
export const DIET_TARGET = 10;

// ---------------------------------------------------------------- 进度表

/** 进度全表：**按树的顺序**排（父一定在子前面），判定时就按这个顺序走一遍 */
export const ADVANCEMENTS: readonly AdvancementDef[] = [
  // ---------------------------------------------------------------- 我的世界（主树）
  {
    id: 'minecraft:story/root',
    parent: null,
    tab: 'minecraft',
    title: '我的世界',
    desc: '打开背包（E）看一眼自己有什么',
    icon: Block.CRAFTING_TABLE,
    trigger: { kind: 'auto' },
  },
  {
    id: 'minecraft:story/mine_stone',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '石器时代',
    desc: '用镐挖一块圆石',
    icon: Block.COBBLESTONE,
    trigger: { kind: 'obtain', ids: [Block.COBBLESTONE] },
  },
  {
    id: 'minecraft:story/upgrade_tools',
    parent: 'minecraft:story/mine_stone',
    tab: 'minecraft',
    title: '升级工具',
    desc: '合成一把石镐',
    icon: toolItemId('pickaxe', 'stone'),
    trigger: { kind: 'obtain', ids: [toolItemId('pickaxe', 'stone')] },
  },
  {
    id: 'minecraft:story/smelt_iron',
    parent: 'minecraft:story/upgrade_tools',
    tab: 'minecraft',
    title: '来硬的',
    desc: '烧出一块铁锭（粗铁放进熔炉）',
    icon: Item.IRON_INGOT,
    trigger: { kind: 'obtain', ids: [Item.IRON_INGOT] },
  },
  {
    id: 'minecraft:story/iron_tools',
    parent: 'minecraft:story/smelt_iron',
    tab: 'minecraft',
    title: '现在你掌握了铁',
    desc: '合成一把铁镐',
    icon: toolItemId('pickaxe', 'iron'),
    trigger: { kind: 'obtain', ids: [toolItemId('pickaxe', 'iron')] },
  },
  {
    id: 'minecraft:story/obtain_armor',
    parent: 'minecraft:story/smelt_iron',
    tab: 'minecraft',
    title: '西装革履',
    desc: '获得任意一件胸甲（皮革 / 铁 / 金 / 钻石）',
    icon: armorItemId('chestplate', 'iron'),
    trigger: { kind: 'obtain', ids: armorIdsOf('chestplate', CRAFTABLE_ARMOR_MATERIALS) },
  },
  {
    id: 'minecraft:story/form_obsidian',
    parent: 'minecraft:story/smelt_iron',
    tab: 'minecraft',
    title: '冰桶挑战',
    desc: '挖一块黑曜石（得用钻石镐）',
    icon: Block.OBSIDIAN,
    trigger: { kind: 'obtain', ids: [Block.OBSIDIAN] },
  },
  {
    id: 'minecraft:story/mine_diamond',
    parent: 'minecraft:story/iron_tools',
    tab: 'minecraft',
    title: '钻石！',
    desc: '挖到第一颗钻石',
    icon: Item.DIAMOND,
    trigger: { kind: 'obtain', ids: [Item.DIAMOND] },
  },
  {
    id: 'minecraft:story/shiny_gear',
    parent: 'minecraft:story/mine_diamond',
    tab: 'minecraft',
    title: '光辉岁月',
    desc: '把钻石穿在身上（任意一件钻石盔甲）',
    icon: armorItemId('chestplate', 'diamond'),
    trigger: { kind: 'obtain', ids: armorIdsOf('chestplate', ['diamond']) },
  },
  {
    id: 'minecraft:story/enchant_item',
    parent: 'minecraft:story/mine_diamond',
    tab: 'minecraft',
    title: '附魔师',
    desc: '得到一件带附魔的物品（附魔台或铁砧）',
    icon: Block.ENCHANTING_TABLE,
    trigger: { kind: 'obtain', enchanted: true },
  },
  {
    id: 'minecraft:story/enter_the_nether',
    parent: 'minecraft:story/form_obsidian',
    tab: 'minecraft',
    title: '我们需要更深入些',
    desc: '用打火石点一个下界传送门，然后走进去',
    icon: Item.FLINT_AND_STEEL,
    trigger: { kind: 'dimension', dimensions: ['nether'] },
  },
  {
    id: 'minecraft:story/enter_the_end',
    parent: 'minecraft:story/enter_the_nether',
    tab: 'minecraft',
    title: '末地',
    desc: '走进末地传送门',
    icon: Block.END_STONE,
    trigger: { kind: 'dimension', dimensions: ['end'] },
  },

  // ---------------------------------------------------------------- 下界
  {
    id: 'minecraft:nether/root',
    parent: null,
    tab: 'nether',
    title: '下界',
    desc: '第一次踏进下界',
    icon: Block.NETHERRACK,
    trigger: { kind: 'dimension', dimensions: ['nether'] },
  },
  {
    id: 'minecraft:nether/obtain_ancient_debris',
    parent: 'minecraft:nether/root',
    tab: 'nether',
    title: '深藏不露',
    desc: '挖一块远古残骸（Y=8~22 之间最多）',
    icon: Block.ANCIENT_DEBRIS,
    trigger: { kind: 'obtain', ids: [Block.ANCIENT_DEBRIS] },
  },

  // ---------------------------------------------------------------- 末地
  {
    id: 'minecraft:end/root',
    parent: null,
    tab: 'end',
    title: '末地',
    desc: '第一次踏进末地',
    icon: Block.END_STONE,
    trigger: { kind: 'dimension', dimensions: ['end'] },
  },
  {
    id: 'minecraft:end/kill_dragon',
    parent: 'minecraft:end/root',
    tab: 'end',
    title: '末影龙之死',
    desc: '先敲掉十根柱子上的末地水晶，再把末影龙打下来',
    icon: Block.DRAGON_EGG,
    trigger: { kind: 'dragon' },
    challenge: true,
  },
  {
    id: 'minecraft:end/dragon_egg',
    parent: 'minecraft:end/kill_dragon',
    tab: 'end',
    title: '下一世代',
    desc: '把龙蛋捡起来',
    icon: Block.DRAGON_EGG,
    trigger: { kind: 'obtain', ids: [Block.DRAGON_EGG] },
  },

  // ---------------------------------------------------------------- 冒险
  {
    id: 'minecraft:adventure/root',
    parent: null,
    tab: 'adventure',
    title: '冒险',
    // 描述不再点名具体三种：池子是从生物表派生的（批次 93），点名就会漂
    desc: '击败一只敌对生物',
    icon: toolItemId('sword', 'iron'),
    trigger: { kind: 'kill', mobs: HOSTILE_MOBS },
  },
  {
    id: 'minecraft:adventure/kill_a_mob',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '怪物猎人',
    desc: '击败 3 种不同的敌对生物',
    icon: Item.BONE,
    trigger: { kind: 'kill', mobs: HOSTILE_MOBS, needCount: 3 },
  },
  {
    id: 'minecraft:adventure/sleep_in_bed',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '甜美的梦',
    desc: '在床上睡到天亮（天黑后右键床）',
    icon: Block.BED,
    trigger: { kind: 'sleep' },
  },
  {
    // 与村民交易（J11，批次 88）：原版 `adventure/trade`（"这是什么？"）
    id: 'minecraft:adventure/trade',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '这是什么？',
    desc: '与村民成交一笔交易（先给他一个工作站认领职业）',
    icon: Item.EMERALD,
    trigger: { kind: 'trade' },
  },
  {
    id: 'minecraft:adventure/breed_an_animal',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '成双成对',
    desc: '喂两只同类家畜，让它们生一只幼崽',
    icon: Item.WHEAT,
    trigger: { kind: 'breed', mobs: BREEDABLE_MOBS },
  },

  // ---------------------------------------------------------------- 农牧
  {
    id: 'minecraft:husbandry/root',
    parent: null,
    tab: 'husbandry',
    title: '农牧',
    desc: '收获第一份作物（成熟的小麦 / 甜菜根 / 胡萝卜 / 马铃薯）',
    icon: Item.WHEAT,
    trigger: { kind: 'obtain', ids: [Item.WHEAT, Item.BEETROOT, Item.CARROT, Item.POTATO] },
  },
  {
    id: 'minecraft:husbandry/plant_seed',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '种植',
    desc: '把种子种在耕地上（先拿锄头把泥土锄成耕地）',
    icon: Item.WHEAT_SEEDS,
    trigger: { kind: 'place', ids: CROP_FIRST_STAGES },
  },
  {
    id: 'minecraft:husbandry/fishy_business',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '腥味十足',
    desc: '钓上来一条鱼（拿钓竿右键水面，等浮标下沉时再收杆）',
    icon: Item.FISHING_ROD,
    trigger: { kind: 'fish' },
  },
  {
    id: 'minecraft:husbandry/balanced_diet',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '均衡饮食',
    desc: `吃过 ${DIET_TARGET} 种不同的食物（生的熟的、种的钓的都算）`,
    icon: Item.APPLE,
    trigger: { kind: 'eat', ids: DIET_FOODS, needCount: DIET_TARGET },
    challenge: true,
  },

  // ---------------------------------------------------------------- 批次 343：补 15 条
  // 只挑"现有触发条件 + 可达来源"的：不编依赖蜜蜂/鞘翅/袭击/刷怪笼的条目。
  {
    id: 'minecraft:story/mine_wood',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '伐木工',
    desc: '砍下任意一种原木（徒手就能砍，斧头更快）',
    icon: Block.OAK_LOG,
    trigger: {
      kind: 'obtain',
      // 从木料表派生（不手抄 6 个 log id：加一种木材时会自动跟上）
      ids: [Block.OAK_LOG, ...Object.values(Wood).map((wood) => wood.log)],
    },
  },
  {
    id: 'minecraft:story/mine_gold',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '金光闪闪',
    desc: '挖到粗金（金矿在 Y<32 最密）',
    icon: Item.RAW_GOLD,
    trigger: { kind: 'obtain', ids: [Item.RAW_GOLD] },
  },
  {
    id: 'minecraft:nether/obtain_blaze_rod',
    parent: 'minecraft:nether/root',
    tab: 'nether',
    title: '与火共舞',
    desc: '从烈焰人身上拿到一根烈焰棒（下界要塞里才有）',
    icon: Item.BLAZE_ROD,
    trigger: { kind: 'obtain', ids: [Item.BLAZE_ROD] },
  },
  {
    id: 'minecraft:nether/find_fortress',
    parent: 'minecraft:nether/root',
    tab: 'nether',
    title: '可怕的堡垒',
    desc: '在下界要塞的灵魂沙上采到下界疣',
    icon: Item.NETHER_WART,
    trigger: { kind: 'obtain', ids: [Item.NETHER_WART] },
  },
  {
    id: 'minecraft:nether/create_beacon',
    parent: 'minecraft:nether/root',
    tab: 'nether',
    title: '带信标回家',
    desc: '合成一个信标（3 颗下界之星碎片 + 5 块玻璃 + 1 颗下界之星）',
    icon: Block.BEACON,
    trigger: { kind: 'obtain', ids: [Block.BEACON] },
  },
  {
    id: 'minecraft:adventure/kill_a_creeper',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '嘶——砰',
    desc: '杀死一只苦力怕（别让它先炸到你）',
    icon: Item.GUNPOWDER,
    trigger: { kind: 'kill', mobs: ['creeper'] },
  },
  {
    id: 'minecraft:adventure/kill_a_spider',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '蛛丝马迹',
    desc: '杀死一只蜘蛛',
    icon: Item.STRING,
    trigger: { kind: 'kill', mobs: ['spider'] },
  },
  {
    id: 'minecraft:adventure/kill_a_skeleton',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '骨感',
    desc: '杀死一只骷髅（小心它的箭）',
    icon: Item.BONE,
    trigger: { kind: 'kill', mobs: ['skeleton'] },
  },
  {
    id: 'minecraft:adventure/kill_a_zombie',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '行尸走肉',
    desc: '杀死一只僵尸',
    icon: Item.ROTTEN_FLESH,
    trigger: { kind: 'kill', mobs: ['zombie'] },
  },
  {
    id: 'minecraft:adventure/kill_all_mobs',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '资深怪物猎人',
    desc: `击败 ${HOSTILE_MOBS.length} 种不同的敌对生物（不要求一次打完）`,
    icon: toolItemId('sword', 'iron'),
    trigger: { kind: 'kill', mobs: HOSTILE_MOBS, needCount: HOSTILE_MOBS.length },
    challenge: true,
  },
  {
    id: 'minecraft:adventure/place_sign',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '留个言',
    desc: '放下一个告示牌（6 木板 + 1 木棍）',
    icon: Block.OAK_SIGN,
    // 用 `obtain` 而不是 `place`：`test:advancement` 把 place 类目标限定在"作物第一阶段"，
    // 这是刻意的口径（放置类只用来判种植）；"放下了告示牌"从"拿到过告示牌"这一侧判定。
    trigger: { kind: 'obtain', ids: [Block.OAK_SIGN] },
  },
  {
    id: 'minecraft:adventure/lightning_rod',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '避雷针',
    desc: '获得一根避雷针（3 铜锭）',
    icon: Block.LIGHTNING_ROD,
    trigger: { kind: 'obtain', ids: [Block.LIGHTNING_ROD] },
  },
  {
    id: 'minecraft:husbandry/breed_all',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '牧场主',
    desc: '让牛、猪、羊、鸡各繁殖一次',
    icon: Item.WHEAT,
    trigger: { kind: 'breed', mobs: BREEDABLE_MOBS, needCount: BREEDABLE_MOBS.length },
  },
  {
    id: 'minecraft:end/obtain_elytra',
    parent: 'minecraft:end/root',
    tab: 'end',
    title: '天空之上',
    desc: '从末地城的宝箱里拿到鞘翅',
    icon: Item.ELYTRA,
    trigger: { kind: 'obtain', ids: [Item.ELYTRA] },
    challenge: true,
  },
  {
    id: 'minecraft:end/kill_enderman',
    parent: 'minecraft:end/root',
    tab: 'end',
    title: '末地来客',
    desc: '杀死一只末影人（别直视它的眼睛）',
    icon: Item.ENDER_PEARL,
    trigger: { kind: 'kill', mobs: ['enderman'] },
  },

  // ---------------------------------------------------------------- 批次 350：导航与装备
  // 全部是"拿到某件东西"，来源都已在生存里成立（合成或结构宝箱）。
  {
    id: 'minecraft:adventure/obtain_map',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '制图师',
    desc: '合成一张空白地图（8 纸 + 1 指南针）',
    icon: Item.MAP,
    trigger: { kind: 'obtain', ids: [Item.MAP] },
  },
  {
    id: 'minecraft:adventure/obtain_compass',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '指北',
    desc: '合成一个指南针（4 铁锭 + 1 红石）',
    icon: Item.COMPASS,
    trigger: { kind: 'obtain', ids: [Item.COMPASS] },
  },
  {
    id: 'minecraft:adventure/obtain_clock',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '时间就是金钱',
    desc: '合成一个时钟（4 金锭 + 1 红石）',
    icon: Item.CLOCK,
    trigger: { kind: 'obtain', ids: [Item.CLOCK] },
  },
  {
    id: 'minecraft:adventure/obtain_saddle',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '备鞍',
    desc: '拿到一个鞍（沙漠神殿的宝箱里会有）',
    icon: Item.SADDLE,
    trigger: { kind: 'obtain', ids: [Item.SADDLE] },
  },
  {
    id: 'minecraft:adventure/obtain_crossbow',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '弩箭上弦',
    desc: '合成一把弩（掠夺者前哨的箱子里也会有）',
    icon: Item.CROSSBOW,
    trigger: { kind: 'obtain', ids: [Item.CROSSBOW] },
  },
  {
    id: 'minecraft:adventure/obtain_bone_block',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '骨中寻宝',
    desc: '拿到一块骨块（9 骨粉压成，或去挖化石）',
    icon: Block.BONE_BLOCK,
    trigger: { kind: 'obtain', ids: [Block.BONE_BLOCK] },
  },

  // ---------------------------------------------------------------- 批次 354：下界与末地的猎物
  {
    id: 'minecraft:adventure/kill_a_blaze',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '烈火终结者',
    desc: '杀死一只烈焰人（下界要塞里才有）',
    icon: Item.BLAZE_ROD,
    trigger: { kind: 'kill', mobs: ['blaze'] },
  },
  {
    id: 'minecraft:adventure/kill_a_ghast',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '恶魂退散',
    desc: '杀死一只恶魂（它吐的火球可以打回去）',
    icon: Item.GHAST_TEAR,
    trigger: { kind: 'kill', mobs: ['ghast'] },
  },
  {
    id: 'minecraft:adventure/kill_a_piglin',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '猪灵不受欢迎',
    desc: '杀死一只猪灵（它平时中立，别先动手）',
    icon: Item.GOLD_INGOT,
    trigger: { kind: 'kill', mobs: ['piglin'] },
  },
  {
    id: 'minecraft:adventure/kill_a_hoglin',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '疣猪兽猎人',
    desc: '杀死一只疣猪兽（下界的野猪）',
    icon: Item.PORKCHOP,
    trigger: { kind: 'kill', mobs: ['hoglin'] },
  },
  {
    id: 'minecraft:adventure/kill_a_shulker',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '拆壳专家',
    desc: '杀死一只潜影贝（末地城附近）',
    icon: Item.ENDER_PEARL,
    trigger: { kind: 'kill', mobs: ['shulker'] },
  },
  {
    id: 'minecraft:adventure/kill_a_silverfish',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '除虫',
    desc: '杀死一只蠹虫（要塞的刷怪笼里会冒出来）',
    icon: Item.BONE,
    trigger: { kind: 'kill', mobs: ['silverfish'] },
  },

  // ---------------------------------------------------------------- 批次 355：变种与分裂体
  {
    id: 'minecraft:adventure/kill_a_drowned',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '深海猎手',
    desc: '杀死一只溺尸（海里或夜里岸边）',
    icon: Item.ROTTEN_FLESH,
    trigger: { kind: 'kill', mobs: ['drowned'] },
  },
  {
    id: 'minecraft:adventure/kill_a_husk',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '干尸',
    desc: '杀死一只尸壳（沙漠里的僵尸变种）',
    icon: Item.ROTTEN_FLESH,
    trigger: { kind: 'kill', mobs: ['husk'] },
  },
  {
    id: 'minecraft:adventure/kill_a_stray',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '冰霜箭',
    desc: '杀死一只流浪者（雪原里的骷髅变种）',
    icon: Item.BONE,
    trigger: { kind: 'kill', mobs: ['stray'] },
  },
  {
    id: 'minecraft:adventure/kill_a_phantom',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '别再熬夜了',
    desc: '杀死一只幻翼（连续几天不睡觉就会来）',
    icon: Item.PHANTOM_MEMBRANE,
    trigger: { kind: 'kill', mobs: ['phantom'] },
  },
  {
    id: 'minecraft:adventure/kill_a_slime',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '黏液怪',
    desc: '杀死一只史莱姆（打到大号会分裂）',
    icon: Item.SLIME_BALL,
    trigger: { kind: 'kill', mobs: ['slime_big', 'slime', 'slime_small'] },
  },
  {
    id: 'minecraft:adventure/kill_a_magma_cube',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '岩浆怪',
    desc: '杀死一只岩浆怪（下界的史莱姆）',
    icon: Item.MAGMA_CREAM,
    trigger: { kind: 'kill', mobs: ['magma_cube_big', 'magma_cube', 'magma_cube_small'] },
  },
  {
    id: 'minecraft:adventure/kill_a_cave_spider',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '洞穴清道夫',
    desc: '杀死一只洞穴蜘蛛（废弃矿井的刷怪笼里）',
    icon: Item.STRING,
    trigger: { kind: 'kill', mobs: ['cave_spider'] },
  },
  {
    id: 'minecraft:adventure/kill_a_wither_skeleton',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '黑石守卫',
    desc: '杀死一只凋灵骷髅（下界要塞）',
    icon: Item.COAL,
    trigger: { kind: 'kill', mobs: ['wither_skeleton'] },
  },
  {
    id: 'minecraft:adventure/defend_village',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '保家卫国',
    desc: '在村庄附近（64 格内）击杀一名掠夺者',
    icon: Item.EMERALD,
    trigger: { kind: 'raid', raidStage: 1 },
  },
  {
    id: 'minecraft:adventure/hero_of_the_village',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '村庄英雄',
    desc: '在村庄附近击退一波掠夺者（累计 5 名）',
    icon: Block.EMERALD_BLOCK,
    trigger: { kind: 'raid', raidStage: 2 },
    challenge: true,
  },
  {
    id: 'minecraft:adventure/explore_10_biomes',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '冒险家',
    desc: '走过 10 个不同的生物群系（不要求一次走完）',
    icon: Block.GRASS_BLOCK,
    trigger: {
      kind: 'biome',
      needCount: 10,
      // 列出 12 个代表性群系：池子要大于 10，否则这条永远达不成
      biomes: [
        'plains',
        'forest',
        'birch_forest',
        'dark_forest',
        'taiga',
        'desert',
        'savanna',
        'jungle',
        'swamp',
        'badlands',
        'snowy_plains',
        'ocean',
      ],
    },
  },
  {
    id: 'minecraft:adventure/kill_a_wither',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '凋灵终结者',
    desc: '击败凋灵（4 块灵魂沙 + 3 个凋灵骷髅头召唤）',
    icon: Item.NETHER_STAR,
    trigger: { kind: 'kill', mobs: ['wither'] },
    challenge: true,
  },
  {
    id: 'minecraft:adventure/kill_a_pillager',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '还你一箭',
    desc: '杀死一名掠夺者（前哨附近）',
    icon: Item.CROSSBOW,
    trigger: { kind: 'kill', mobs: ['pillager'] },
  },
  {
    id: 'minecraft:adventure/kill_iron_golem',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '忘恩负义',
    desc: '杀死一只铁傀儡（它平时守村，不会主动打你）',
    icon: Item.IRON_INGOT,
    trigger: { kind: 'kill', mobs: ['iron_golem'] },
  },
  {
    id: 'minecraft:adventure/kill_a_guardian',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '深海守卫',
    desc: '杀死一只守卫者（海底神殿附近）',
    icon: Item.PRISMARINE_SHARD,
    trigger: { kind: 'kill', mobs: ['guardian'] },
  },
  {
    id: 'minecraft:adventure/kill_an_elder_guardian',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '远古的凝视',
    desc: '击败一只远古守卫者（80 血，会给你挖掘疲劳）',
    icon: Item.PRISMARINE_CRYSTALS,
    trigger: { kind: 'kill', mobs: ['elder_guardian'] },
    challenge: true,
  },
  {
    id: 'minecraft:husbandry/beelocation',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '移动蜂巢',
    desc: '拿到一个蜂巢（3 蜜脾 + 6 木板合成，或带精准采集去挖）',
    icon: Block.BEE_NEST,
    trigger: { kind: 'obtain', ids: [Block.BEE_NEST] },
  },
  {
    id: 'minecraft:husbandry/wax_on',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '涂蜡',
    desc: '用蜜脾给一块铜块涂蜡（合成：铜块 + 蜜脾）',
    icon: Block.WAXED_COPPER_BLOCK,
    trigger: {
      kind: 'obtain',
      ids: [
        Block.WAXED_COPPER_BLOCK,
        Block.WAXED_EXPOSED_COPPER,
        Block.WAXED_WEATHERED_COPPER,
        Block.WAXED_OXIDIZED_COPPER,
      ],
    },
  },
  {
    id: 'minecraft:husbandry/obtain_honeycomb',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '与蜂共舞',
    desc: '从蜂巢里拿到蜜脾（草甸的蜂巢打掉就有）',
    icon: Item.HONEYCOMB,
    trigger: { kind: 'obtain', ids: [Item.HONEYCOMB] },
  },
  {
    id: 'minecraft:husbandry/obtain_honey_bottle',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '甜蜜蜜',
    desc: '用蜜脾 + 玻璃瓶合成一瓶蜂蜜',
    icon: Item.HONEY_BOTTLE,
    trigger: { kind: 'obtain', ids: [Item.HONEY_BOTTLE] },
  },
  {
    id: 'minecraft:story/obtain_prismarine_shard',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '海晶',
    desc: '拿到一片海晶碎片（守卫者掉落）',
    icon: Item.PRISMARINE_SHARD,
    trigger: { kind: 'obtain', ids: [Item.PRISMARINE_SHARD] },
  },

  // ---------------------------------------------------------------- 批次 364：下界合金与末影
  {
    id: 'minecraft:story/obtain_ancient_debris',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '远古残骸',
    desc: '在下界 Y<15 挖到远古残骸',
    icon: Block.ANCIENT_DEBRIS,
    trigger: { kind: 'obtain', ids: [Block.ANCIENT_DEBRIS] },
  },
  {
    id: 'minecraft:story/obtain_netherite_ingot',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '下界合金',
    desc: '用 4 个下界合金碎片 + 4 个金锭合成下界合金锭',
    icon: Item.NETHERITE_INGOT,
    trigger: { kind: 'obtain', ids: [Item.NETHERITE_INGOT] },
  },
  {
    id: 'minecraft:story/obtain_ender_chest',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '末影箱',
    desc: '合成一个末影箱（8 黑曜石 + 1 末影之眼）',
    icon: Block.ENDER_CHEST,
    trigger: { kind: 'obtain', ids: [Block.ENDER_CHEST] },
  },
  {
    id: 'minecraft:adventure/obtain_ender_pearl',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '末影珍珠',
    desc: '从末影人身上拿到一颗末影珍珠',
    icon: Item.ENDER_PEARL,
    trigger: { kind: 'obtain', ids: [Item.ENDER_PEARL] },
  },
  {
    id: 'minecraft:adventure/obtain_blaze_powder',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '烈焰粉',
    desc: '把烈焰棒磨成烈焰粉（酿造材料）',
    icon: Item.BLAZE_POWDER,
    trigger: { kind: 'obtain', ids: [Item.BLAZE_POWDER] },
  },
  {
    id: 'minecraft:adventure/obtain_slime_ball',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '黏液球',
    desc: '从史莱姆身上拿到一个黏液球',
    icon: Item.SLIME_BALL,
    trigger: { kind: 'obtain', ids: [Item.SLIME_BALL] },
  },

  // ---------------------------------------------------------------- 批次 356：矿物块与工作站
  {
    id: 'minecraft:story/obtain_iron_block',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '铁块',
    desc: '用 9 个铁锭压成一块铁块',
    icon: Block.IRON_BLOCK,
    trigger: { kind: 'obtain', ids: [Block.IRON_BLOCK] },
  },
  {
    id: 'minecraft:story/obtain_gold_block',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '金块',
    desc: '用 9 个金锭压成一块金块',
    icon: Block.GOLD_BLOCK,
    trigger: { kind: 'obtain', ids: [Block.GOLD_BLOCK] },
  },
  {
    id: 'minecraft:story/obtain_diamond_block',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '钻石块',
    desc: '用 9 颗钻石压成一块钻石块',
    icon: Block.DIAMOND_BLOCK,
    trigger: { kind: 'obtain', ids: [Block.DIAMOND_BLOCK] },
  },
  {
    id: 'minecraft:story/obtain_emerald_block',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '绿宝石块',
    desc: '用 9 颗绿宝石压成一块绿宝石块',
    icon: Block.EMERALD_BLOCK,
    trigger: { kind: 'obtain', ids: [Block.EMERALD_BLOCK] },
  },
  {
    id: 'minecraft:story/obtain_anvil',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '铁匠',
    desc: '合成一个铁砧（3 铁块 + 4 铁锭）',
    icon: Block.ANVIL,
    trigger: { kind: 'obtain', ids: [Block.ANVIL] },
  },
  {
    id: 'minecraft:story/obtain_enchanting_table',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '附魔台',
    desc: '合成一个附魔台（4 黑曜石 + 2 钻石 + 1 书）',
    icon: Block.ENCHANTING_TABLE,
    trigger: { kind: 'obtain', ids: [Block.ENCHANTING_TABLE] },
  },
  {
    id: 'minecraft:story/obtain_bookshelf',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '书架',
    desc: '合成一个书架（6 木板 + 3 书）',
    icon: Block.BOOKSHELF,
    trigger: { kind: 'obtain', ids: [Block.BOOKSHELF] },
  },
  {
    id: 'minecraft:husbandry/obtain_cake',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '蛋糕是个谎言',
    desc: '合成一个蛋糕（3 牛奶桶 + 2 糖 + 1 蛋 + 3 小麦）',
    icon: Block.CAKE,
    trigger: { kind: 'obtain', ids: [Block.CAKE] },
  },
  {
    id: 'minecraft:story/obtain_golden_apple',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '金苹果',
    desc: '用 8 个金锭围一个苹果',
    icon: Item.GOLDEN_APPLE,
    trigger: { kind: 'obtain', ids: [Item.GOLDEN_APPLE] },
  },
  {
    id: 'minecraft:story/obtain_ender_eye',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '末影之眼',
    desc: '合成一颗末影之眼（末影珍珠 + 烈焰粉）',
    icon: Item.ENDER_EYE,
    trigger: { kind: 'obtain', ids: [Item.ENDER_EYE] },
  },

  // ---------------------------------------------------------------- 批次 357：食物与工具
  {
    id: 'minecraft:husbandry/obtain_bread',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '面包',
    desc: '用 3 个小麦合成一个面包',
    icon: Item.BREAD,
    trigger: { kind: 'obtain', ids: [Item.BREAD] },
  },
  {
    id: 'minecraft:husbandry/obtain_cookie',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '曲奇',
    desc: '用小麦 + 可可豆烤一炉曲奇',
    icon: Item.COOKIE,
    trigger: { kind: 'obtain', ids: [Item.COOKIE] },
  },
  {
    id: 'minecraft:husbandry/obtain_pumpkin_pie',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '南瓜派',
    desc: '合成一个南瓜派（南瓜 + 糖 + 蛋）',
    icon: Item.PUMPKIN_PIE,
    trigger: { kind: 'obtain', ids: [Item.PUMPKIN_PIE] },
  },
  {
    id: 'minecraft:husbandry/obtain_mushroom_stew',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '蘑菇煲',
    desc: '用两种蘑菇 + 碗煮一锅蘑菇煲',
    icon: Item.MUSHROOM_STEW,
    trigger: { kind: 'obtain', ids: [Item.MUSHROOM_STEW] },
  },
  {
    id: 'minecraft:husbandry/obtain_cooked_beef',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '牛排',
    desc: '把生牛肉放进熔炉烤熟',
    icon: Item.COOKED_BEEF,
    trigger: { kind: 'obtain', ids: [Item.COOKED_BEEF] },
  },
  {
    id: 'minecraft:husbandry/obtain_cooked_porkchop',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '烤猪排',
    desc: '把生猪肉放进熔炉烤熟',
    icon: Item.COOKED_PORKCHOP,
    trigger: { kind: 'obtain', ids: [Item.COOKED_PORKCHOP] },
  },
  {
    id: 'minecraft:story/obtain_iron_pickaxe',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '铁镐',
    desc: '用 3 铁锭 + 2 木棍合成一把铁镐',
    icon: toolItemId('pickaxe', 'iron'),
    trigger: { kind: 'obtain', ids: [toolItemId('pickaxe', 'iron')] },
  },
  {
    id: 'minecraft:story/obtain_diamond_sword',
    parent: 'minecraft:story/root',
    tab: 'minecraft',
    title: '钻石剑',
    desc: '用 2 钻石 + 1 木棍合成一把钻石剑',
    icon: toolItemId('sword', 'diamond'),
    trigger: { kind: 'obtain', ids: [toolItemId('sword', 'diamond')] },
  },
  {
    id: 'minecraft:adventure/obtain_bow',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '弓',
    desc: '用 3 木棍 + 3 线合成一把弓',
    icon: Item.BOW,
    trigger: { kind: 'obtain', ids: [Item.BOW] },
  },
  {
    id: 'minecraft:husbandry/obtain_fishing_rod',
    parent: 'minecraft:husbandry/root',
    tab: 'husbandry',
    title: '钓竿',
    desc: '用 3 木棍 + 2 线合成一根钓竿',
    icon: Item.FISHING_ROD,
    trigger: { kind: 'obtain', ids: [Item.FISHING_ROD] },
  },
];

/** 按 id 查一条（界面与判定都用它；查不到返回 null） */
export function advancementById(id: string): AdvancementDef | null {
  return ADVANCEMENTS.find((def) => def.id === id) ?? null;
}

/** 某一支里的全部条目（按表的顺序，父在前） */
export function advancementsOfTab(tab: AdvancementTab): AdvancementDef[] {
  return ADVANCEMENTS.filter((def) => def.tab === tab);
}

/** 直接子条目（界面画树状缩进用） */
export function childrenOf(id: string | null): AdvancementDef[] {
  return ADVANCEMENTS.filter((def) => def.parent === id);
}

/** 全部"计数型"条目要吃的目标（测试与文档用） */
export function countTargetsOf(def: AdvancementDef): number {
  return def.trigger.needCount ?? 1;
}
