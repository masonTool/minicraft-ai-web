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

import { Block, CROP_STAGES } from '../registry/blocks.ts';
import { Item } from '../registry/items.ts';
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

/** 敌对生物（本批实现了的三种）：击杀类进度共用它 */
const HOSTILE_MOBS: readonly string[] = ['zombie', 'skeleton', 'creeper'];

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
    desc: '击败一只敌对生物（僵尸 / 骷髅 / 苦力怕）',
    icon: toolItemId('sword', 'iron'),
    trigger: { kind: 'kill', mobs: HOSTILE_MOBS },
  },
  {
    id: 'minecraft:adventure/kill_a_mob',
    parent: 'minecraft:adventure/root',
    tab: 'adventure',
    title: '怪物猎人',
    desc: '僵尸、骷髅、苦力怕各击败一只',
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
