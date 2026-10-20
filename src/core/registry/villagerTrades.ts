/**
 * 村民的职业与交易表（J11，批次 88）
 *
 * 村民是**本项目第一套"会做生意的生物"**：它自己不是容器，交易也不是"把东西放进格子"
 * ——原版那套是"两个收货格 + 一个产物格"的商人容器，而本项目在触屏上做那一步特别别扭
 * （拖两堆东西进格子），所以口径改成本项目的：**点一条交易 = 直接从背包结算**
 * （与切石机那套"点一下切一件"同源）。差异记在 TASKS J11。
 *
 * 这一层是**纯数据 + 纯函数**（不引实体、不引界面），所以：
 *  - "这条交易能不能做"能离线断言（缺几样、缺几个、次数用完没有）；
 *  - 职业 ↔ 工作站 的对应、等级经验阈值都能逐条钉住；
 *  - 主程序只负责"扣背包、给东西、报进度、播声音"。
 *
 * ⚠️ 价格口径（写在最前面，免得以后有人以为这些数字是抄原版的）：
 *  - **买卖方向与数量级照原版**（收 20 个小麦给 1 个绿宝石、1 个绿宝石换 6 个面包……）；
 *  - **卖装备的价格是本项目定的**（原版每条交易的价格会随难度与"声望"浮动，
 *    而且不少条目挂在未实现的内容上：讲台、附魔书、鞍、经验瓶……）；
 *  - **不做价格浮动**（原版买多了会涨价）：固定价才好断言，也免得玩家觉得"被宰"。
 */

import { Block, bedId, carpetId, woolId } from './blocks.ts';
import { DYE_COLORS } from './colors.ts';
import { Item, dyeItemId } from './items.ts';
// 武器匠卖的是**工具/武器**（原版也是），所以这里要按"种类 × 材质"算 id
import { toolItemId } from './tools.ts';
// 盔甲匠卖**锁链甲**（批次 169，B53）：它与铁甲没有配方差别，只能靠交易/穿甲怪物
import { armorItemId } from './armor.ts';

/** 职业 id（原版名字） */
export type VillagerProfessionId =
  | 'farmer'
  | 'butcher'
  | 'armorer'
  | 'cleric'
  | 'stonemason'
  | 'fisherman'
  | 'toolsmith'
  // 批次 90（J23）补齐的 4 个：方块与职业是同一批加的
  | 'librarian'
  | 'fletcher'
  | 'weaponsmith'
  | 'shepherd'
  // 批次 568（J23）：炼药锅落地后补上的皮匠
  | 'leatherworker';

/** 一条交易里村民收的东西（1~2 样） */
export interface TradeCost {
  readonly id: number;
  readonly count: number;
}

/** 一条交易的定义（表里写的就是它） */
export interface TradeSpec {
  /** 村民**收**的东西（1~2 样；第 2 样是原版那种"绿宝石 + X"的卖法） */
  readonly cost: readonly TradeCost[];
  /** 村民**给**的东西 */
  readonly result: { readonly id: number; readonly count: number };
  /** 一天能成交几次（原版 2 次/天刷新；本项目**不刷新**，用完就锁定） */
  readonly maxUses: number;
  /** 成交一次给村民多少经验（原版 2~5；攒够就升级） */
  readonly xp: number;
}

export interface VillagerProfession {
  readonly id: VillagerProfessionId;
  readonly name: string;
  /** 认领哪一格方块才得到这个职业（原版 1:1；本项目只列**已经实现的方块**） */
  readonly workstation: number;
  /**
   * 长袍的颜色（渲染用）。
   *
   * 原版村民的职业是"衣服 + 徽章"两处一起看，我们只有程序化配色的方块模型，
   * 所以用**长袍颜色**代替：一眼能分出站在面前的是谁（农民=土黄、牧师=紫、渔夫=蓝…）。
   */
  readonly robeColor: number;
  /** 第 1~5 级各自的交易（等级越高越多；升级时把新那一批追加进去） */
  readonly levels: readonly (readonly TradeSpec[])[];
}

/**
 * 村民的等级名（原版五档）。
 * 索引 = 等级 - 1，所以 `VILLAGER_LEVELS[0]` 是"新手"。
 */
export const VILLAGER_LEVELS = ['新手', '学徒', '老手', '专家', '大师'] as const;

/** 升到第 N 级需要的交易经验（原版阈值：0 / 10 / 70 / 150 / 250） */
export const TRADE_XP_THRESHOLDS: readonly number[] = [0, 10, 70, 150, 250];

/**
 * 村民爱吃的东西（原版：面包 / 胡萝卜 / 马铃薯 / 甜菜根）。
 *
 * 喂了会进入"求爱"——原版还要"有意愿"（够多的食物 + 够多的床），本项目没有床的归属判定，
 * 所以退化成与牛羊同一条繁殖链（差异记在 TASKS J11）。
 */
export const VILLAGER_FOODS: readonly number[] = [Item.BREAD, Item.CARROT, Item.POTATO, Item.BEETROOT];

export function isVillagerFood(itemId: number): boolean {
  return VILLAGER_FOODS.includes(itemId);
}

/** 没认领工作站时的长袍色（原版是"失业者"的褐色外衣） */
export const VILLAGER_IDLE_ROBE = 0x8a7150;
/**
 * 棕色染料在配色表里的下标（牧羊人收染料那一条用它）。
 * ⚠️ 按名字查而不是写死 0：配色表一调顺序，写死的数字会悄悄变成"收白色染料"，
 * 而白色染料在本项目**没有来源**（症状是"这条交易永远做不了"）。
 */
const BROWN_DYE_INDEX = DYE_COLORS.findIndex((color) => color.name === 'brown');
/** 村民的皮肤色（手臂与头用它；与"长袍"分开才能看出那是手） */
export const VILLAGER_SKIN_COLOR = 0xd6a27a;

/**
 * 12 个职业（原版 15 种里，**工作站方块已经实现了**的那 12 种）。
 *
 * 批次 90（J23）补齐了 4 个：图书管理员（讲台）、制箭师（制箭台）、
 * 武器匠（砂轮）、牧羊人（织布机）——它们的方块是同一批加的
 * （`blocks.ts` 的 `WORKSTATION_SPECS`，村庄会自动把它们摆进屋里）。
 *
 * 还剩 3 种没做，各卡在不同的前置上（不是"忘了"）：
 *  - **皮匠**已在批次 568 补上（炼药锅落地之后）；
 *  - **制图师**（制图台）、**牧师之外的"神职人员"**、**箭匠之外的…**：
 *    制图台、以及原版那几种需要**未实现内容**的职业（例如"信标/铃"那一类装饰方块）。
 *    真要做，判据是"先有方块，再谈职业"（这也是这一批的口径）。
 */
export const PROFESSIONS: readonly VillagerProfession[] = [
  {
    id: 'farmer',
    name: '农民',
    workstation: Block.COMPOSTER,
    robeColor: 0xb8a05a,
    levels: [
      [
        { cost: [{ id: Item.WHEAT, count: 20 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
        { cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.BREAD, count: 6 }, maxUses: 12, xp: 2 },
      ],
      [{ cost: [{ id: Item.CARROT, count: 26 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 5 }],
      [{ cost: [{ id: Item.POTATO, count: 26 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 10 }],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.PUMPKIN_PIE, count: 4 }, maxUses: 12, xp: 15 }],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.APPLE, count: 4 }, maxUses: 12, xp: 30 }],
    ],
  },
  {
    id: 'butcher',
    name: '屠夫',
    workstation: Block.SMOKER,
    robeColor: 0x9c5f4a,
    levels: [
      [
        { cost: [{ id: Item.BEEF, count: 7 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
        { cost: [{ id: Item.PORKCHOP, count: 7 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
      ],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.COOKED_PORKCHOP, count: 5 }, maxUses: 12, xp: 5 }],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.COOKED_BEEF, count: 5 }, maxUses: 12, xp: 10 }],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.COOKED_CHICKEN, count: 5 }, maxUses: 12, xp: 15 }],
      [{ cost: [{ id: Item.COAL, count: 10 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 30 }],
    ],
  },
  {
    id: 'armorer',
    name: '盔甲匠',
    workstation: Block.BLAST_FURNACE,
    robeColor: 0x7d7f8a,
    levels: [
      [
        { cost: [{ id: Item.COAL, count: 15 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
        { cost: [{ id: Item.EMERALD, count: 4 }], result: { id: Block.IRON_BLOCK, count: 1 }, maxUses: 8, xp: 2 },
      ],
      [{ cost: [{ id: Item.IRON_INGOT, count: 4 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 5 }],
      // ⚠️ 锁链甲（批次 169，TASKS B53）：原版它**没有配方**（材料与图案都与铁甲相同，
      // 给了配方必然和铁甲撞车），只能靠"穿甲的怪物掉落"或"与盔甲匠交易"。
      // 本项目没有个体装备层（怪物不穿甲），所以走交易这一条；三件分在 L3/L4/L5，
      // 于是"把盔甲匠养起来"这件事第一次有了明确的回报。
      [
        { cost: [{ id: Item.EMERALD, count: 6 }], result: { id: Block.IRON_BLOCK, count: 2 }, maxUses: 8, xp: 10 },
        { cost: [{ id: Item.EMERALD, count: 5 }], result: { id: armorItemId('helmet', 'chainmail'), count: 1 }, maxUses: 8, xp: 10 },
      ],
      [
        { cost: [{ id: Item.EMERALD, count: 9 }], result: { id: Block.IRON_BLOCK, count: 3 }, maxUses: 8, xp: 15 },
        { cost: [{ id: Item.EMERALD, count: 7 }], result: { id: armorItemId('leggings', 'chainmail'), count: 1 }, maxUses: 8, xp: 15 },
      ],
      [
        { cost: [{ id: Item.EMERALD, count: 12 }], result: { id: Block.IRON_BLOCK, count: 4 }, maxUses: 8, xp: 30 },
        { cost: [{ id: Item.EMERALD, count: 4 }], result: { id: armorItemId('boots', 'chainmail'), count: 1 }, maxUses: 8, xp: 30 },
      ],
    ],
  },
  {
    id: 'cleric',
    name: '牧师',
    workstation: Block.BREWING_STAND,
    robeColor: 0x8a5fb0,
    levels: [
      [
        { cost: [{ id: Item.ROTTEN_FLESH, count: 32 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
        { cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.REDSTONE, count: 2 }, maxUses: 12, xp: 2 },
      ],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.LAPIS_LAZULI, count: 4 }, maxUses: 12, xp: 5 }],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.GLOWSTONE_DUST, count: 4 }, maxUses: 12, xp: 10 }],
      [{ cost: [{ id: Item.EMERALD, count: 4 }], result: { id: Item.GUNPOWDER, count: 6 }, maxUses: 12, xp: 15 }],
      [{ cost: [{ id: Item.GOLD_INGOT, count: 3 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 30 }],
    ],
  },
  {
    id: 'stonemason',
    name: '石匠',
    workstation: Block.STONECUTTER,
    robeColor: 0x6f7b86,
    levels: [
      [
        { cost: [{ id: Item.CLAY_BALL, count: 10 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
        { cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.BRICK, count: 10 }, maxUses: 12, xp: 2 },
      ],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Block.CHISELED_STONE_BRICKS, count: 4 }, maxUses: 12, xp: 5 }],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Block.POLISHED_ANDESITE, count: 4 }, maxUses: 12, xp: 10 }],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Block.QUARTZ_BLOCK, count: 1 }, maxUses: 12, xp: 15 }],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Block.BRICKS, count: 4 }, maxUses: 12, xp: 30 }],
    ],
  },
  {
    id: 'fisherman',
    name: '渔夫',
    workstation: Block.BARREL,
    robeColor: 0x4a7fa0,
    levels: [
      [
        { cost: [{ id: Item.COD, count: 6 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
        { cost: [{ id: Item.SALMON, count: 6 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
      ],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.COOKED_COD, count: 6 }, maxUses: 12, xp: 5 }],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.COOKED_SALMON, count: 6 }, maxUses: 12, xp: 10 }],
      [{ cost: [{ id: Item.EMERALD, count: 2 }], result: { id: Block.CAMPFIRE, count: 1 }, maxUses: 8, xp: 15 }],
      [{ cost: [{ id: Item.SALMON, count: 10 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 30 }],
    ],
  },
  {
    id: 'toolsmith',
    name: '工具匠',
    workstation: Block.SMITHING_TABLE,
    robeColor: 0x6a5b45,
    levels: [
      [
        { cost: [{ id: Item.COAL, count: 15 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
        { cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.STICK, count: 8 }, maxUses: 12, xp: 2 },
      ],
      [{ cost: [{ id: Item.IRON_INGOT, count: 4 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 5 }],
      [{ cost: [{ id: Item.EMERALD, count: 2 }], result: { id: Block.ANVIL, count: 1 }, maxUses: 8, xp: 10 }],
      [{ cost: [{ id: Item.EMERALD, count: 3 }], result: { id: Item.BUCKET, count: 1 }, maxUses: 8, xp: 15 }],
      [{ cost: [{ id: Item.EMERALD, count: 5 }], result: { id: Block.SMITHING_TABLE, count: 2 }, maxUses: 8, xp: 30 }],
    ],
  },
  {
    // 图书管理员（J23，批次 90）：收纸张与书，卖书架与玻璃。
    // ⚠️ 原版大师那一条卖的是**现掷一条附魔的附魔书**——本项目暂时不行
    // （交易表的产物只有 `{id, count}`，装不下"附魔"这一层数据，记在 TASKS J23）
    id: 'librarian',
    name: '图书管理员',
    workstation: Block.LECTERN,
    robeColor: 0xf2efe4,
    levels: [
      [
        { cost: [{ id: Item.PAPER, count: 24 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
        { cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Block.BOOKSHELF, count: 1 }, maxUses: 12, xp: 2 },
      ],
      [{ cost: [{ id: Item.BOOK, count: 4 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 5 }],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Block.GLASS, count: 4 }, maxUses: 12, xp: 10 }],
      [{ cost: [{ id: Item.EMERALD, count: 2 }], result: { id: Item.PAPER, count: 16 }, maxUses: 12, xp: 15 }],
      [{ cost: [{ id: Item.EMERALD, count: 5 }], result: { id: Block.BOOKSHELF, count: 3 }, maxUses: 8, xp: 30 }],
    ],
  },
  {
    // 制箭师（J23，批次 90）：收木棍/燧石/羽毛（做箭的那几样），卖弓与箭
    id: 'fletcher',
    name: '制箭师',
    workstation: Block.FLETCHING_TABLE,
    robeColor: 0x9c6b3f,
    levels: [
      [
        { cost: [{ id: Item.STICK, count: 32 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
        { cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.ARROW, count: 16 }, maxUses: 12, xp: 2 },
      ],
      [{ cost: [{ id: Item.FLINT, count: 26 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 5 }],
      [{ cost: [{ id: Item.EMERALD, count: 2 }], result: { id: Item.BOW, count: 1 }, maxUses: 8, xp: 10 }],
      [{ cost: [{ id: Item.FEATHER, count: 20 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 15 }],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: Item.ARROW, count: 32 }, maxUses: 8, xp: 30 }],
    ],
  },
  {
    // 武器匠（J23，批次 90）：收煤炭与铁锭，卖**铁制武器**（工具/武器的 id 按
    // "种类 × 材质"算，见 `registry/tools.ts`）。价格是本项目定的（见文件头）
    id: 'weaponsmith',
    name: '武器匠',
    workstation: Block.GRINDSTONE,
    robeColor: 0x4a5a6a,
    levels: [
      [
        { cost: [{ id: Item.COAL, count: 15 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
        { cost: [{ id: Item.EMERALD, count: 3 }], result: { id: toolItemId('axe', 'iron'), count: 1 }, maxUses: 8, xp: 2 },
      ],
      [{ cost: [{ id: Item.IRON_INGOT, count: 4 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 5 }],
      [{ cost: [{ id: Item.EMERALD, count: 7 }], result: { id: toolItemId('sword', 'iron'), count: 1 }, maxUses: 8, xp: 10 }],
      [{ cost: [{ id: Item.EMERALD, count: 4 }], result: { id: toolItemId('pickaxe', 'iron'), count: 1 }, maxUses: 8, xp: 15 }],
      [{ cost: [{ id: Item.EMERALD, count: 8 }], result: { id: toolItemId('sword', 'diamond'), count: 1 }, maxUses: 4, xp: 30 }],
    ],
  },
  {
    // 牧羊人（J23，批次 90）：收羊毛与染料，卖剪刀、床、画、地毯。
    // ⚠️ 卖"画"这一条原版在（Bedrock 的牧羊人就有），本项目正好接上批次 86 的画
    id: 'shepherd',
    name: '牧羊人',
    workstation: Block.LOOM,
    robeColor: 0x6f7f4a,
    levels: [
      [
        { cost: [{ id: woolId(0), count: 18 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
        { cost: [{ id: Item.EMERALD, count: 2 }], result: { id: Item.SHEARS, count: 1 }, maxUses: 8, xp: 2 },
      ],
      // 收染料：⚠️ 本项目目前**只有棕色染料有来源**（可可豆 → 棕色染料，
      // 见 `Recipes` 里那条），其余 15 色的染料还没有配方（花不能制成染料），
      // 所以这里收的是棕色。等哪天补上"花 → 染料"，这一条按颜色展开即可
      [{ cost: [{ id: dyeItemId(BROWN_DYE_INDEX), count: 12 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 5 }],
      [{ cost: [{ id: Item.EMERALD, count: 3 }], result: { id: bedId(0), count: 1 }, maxUses: 8, xp: 10 }],
      [{ cost: [{ id: Item.EMERALD, count: 2 }], result: { id: Block.PAINTING, count: 1 }, maxUses: 8, xp: 15 }],
      [{ cost: [{ id: Item.EMERALD, count: 1 }], result: { id: carpetId(0), count: 8 }, maxUses: 8, xp: 30 }],
    ],
  },
  {
    // 皮匠（批次 568，J23 最后一个）：工作站是**炼药锅**——G13 那批方块交互
    // 落地之前它一直留着；现在炼药锅能装水/岩浆/细雪，这一条才成立。
    id: 'leatherworker',
    name: '皮匠',
    workstation: Block.CAULDRON,
    robeColor: 0x8a5a32,
    levels: [
      [
        { cost: [{ id: Item.LEATHER, count: 6 }], result: { id: Item.EMERALD, count: 1 }, maxUses: 16, xp: 2 },
        {
          cost: [{ id: Item.EMERALD, count: 1 }],
          result: { id: armorItemId('leggings', 'leather'), count: 1 },
          maxUses: 12,
          xp: 2,
        },
      ],
      [
        {
          cost: [{ id: Item.EMERALD, count: 1 }],
          result: { id: armorItemId('chestplate', 'leather'), count: 1 },
          maxUses: 12,
          xp: 5,
        },
      ],
      [
        {
          cost: [{ id: Item.EMERALD, count: 1 }],
          result: { id: armorItemId('helmet', 'leather'), count: 1 },
          maxUses: 12,
          xp: 10,
        },
      ],
      [
        {
          cost: [{ id: Item.EMERALD, count: 1 }],
          result: { id: armorItemId('boots', 'leather'), count: 1 },
          maxUses: 12,
          xp: 15,
        },
      ],
      [{ cost: [{ id: Item.EMERALD, count: 6 }], result: { id: Item.SADDLE, count: 1 }, maxUses: 4, xp: 30 }],
    ],
  },
];

/** 本批支持的职业数（表长；J22 补上另外几种之后这里会自动变大） */
export const PROFESSION_COUNT = PROFESSIONS.length;

export function professionById(id: string): VillagerProfession | undefined {
  return PROFESSIONS.find((profession) => profession.id === id);
}

/** 认领这一格方块得到哪个职业；不是工作站方块就返回 undefined */
export function professionForWorkstation(blockId: number): VillagerProfession | undefined {
  return PROFESSIONS.find((profession) => profession.workstation === blockId);
}

/**
 * **能被放进村庄里**的工作站方块（去重，顺序与职业表一致）。
 *
 * 生成的村庄要往屋里摆工作站（J22），而它必须只摆"有职业的那几种"——
 * 摆一个没人认领的方块，村民就永远是白丁。所以那张清单**从这个表派生出来**，
 * 不另抄一份：J23 补上另外 5 个工作站时，村庄里的种类会跟着自动变多。
 */
export const WORKSTATION_BLOCKS: readonly number[] = [
  ...new Set(PROFESSIONS.map((profession) => profession.workstation)),
];

/** 这个方块是不是某一种工作站（村民在村里找的就是它们） */
export function isWorkstation(blockId: number): boolean {
  return professionForWorkstation(blockId) !== undefined;
}

/**
 * 交易经验 → 等级（1~5）。
 *
 * 与"月相"那批同一条规矩：**等级是经验的纯函数**，不单独存一份派生值
 * （存了就会出现"经验够了但等级还是 3"这种不同步）。
 */
export function levelForTradeXp(xp: number): number {
  let level = 1;
  for (let i = 0; i < TRADE_XP_THRESHOLDS.length; i++) {
    if (xp >= TRADE_XP_THRESHOLDS[i]!) level = i + 1;
  }
  return Math.min(VILLAGER_LEVELS.length, level);
}

/** 第 `level` 级（1~5）对应的名字 */
export function levelName(level: number): string {
  return VILLAGER_LEVELS[Math.max(0, Math.min(VILLAGER_LEVELS.length - 1, level - 1))]!;
}

/**
 * 一条"还活着"的交易（表里的规格 + 已经用了几次）。
 *
 * 用可变对象而不是每次重建：`uses` 要跟着村民走，重建就把"今天卖了几次"丢了。
 */
export interface TradeOffer extends TradeSpec {
  /** 这一条是第几级解锁的（界面按它分组显示；升级时新增的那一批就是新等级） */
  readonly level: number;
  uses: number;
  /**
   * 需求量（批次 509）：成交一次 +1、每日补货 -1，价格按它上浮。
   * 老存档没有这个字段 → 0（与"从没涨过价"同义）。
   */
  demand?: number;
}

/**
 * 需求量上限（批次 509）。
 *
 * 每成交一次 +1、每天补货 -1；价格 = `floor(demand / 2)`，所以 6 点正好顶到 **+3**。
 * 原版 demand 没有明确上限、还能被声望/难度左右，这里收成一个可断言的数。
 */
export const MAX_TRADE_DEMAND = 6;

/** 这一条现在欠多少"需求"（脏数据夹到 0~上限） */
export function tradeDemand(offer: TradeOffer): number {
  const raw = offer.demand;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(MAX_TRADE_DEMAND, Math.floor(raw)));
}

/**
 * 涨价幅度（加在第一样收货物品上）。
 *
 * 每 2 点需求 +1，最多 +3 —— 原版是"买得越多越贵"，本项目把它做成**确定性**的：
 * 同样次数一定得到同样价格，离线可断言、玩家也不会觉得是随机被宰。
 */
export function tradePriceDelta(offer: TradeOffer): number {
  return Math.min(3, Math.floor(tradeDemand(offer) / 2));
}

/** 这一条交易**现在**要收什么（第一样按需求涨价） */
export function adjustedTradeCosts(offer: TradeOffer): TradeCost[] {
  const delta = tradePriceDelta(offer);
  const costs = offer.cost.map((cost) => ({ ...cost }));
  if (delta > 0 && costs.length > 0) costs[0]!.count += delta;
  return costs;
}

/** 成交一次：次数 +1、需求 +1（封顶） */
export function recordTradeUse(offer: TradeOffer): void {
  offer.uses = Math.min(offer.maxUses, offer.uses + 1);
  offer.demand = Math.min(MAX_TRADE_DEMAND, tradeDemand(offer) + 1);
}

/**
 * 建一个村民在 `level` 级时**应该有的全部交易**（1~level 级逐级展开）。
 *
 * 顺序就是显示顺序：低级在上、高级在下（与原版界面一致）。
 */
export function offersForLevel(profession: VillagerProfession, level: number): TradeOffer[] {
  const offers: TradeOffer[] = [];
  const top = Math.max(1, Math.min(profession.levels.length, level));
  for (let index = 0; index < top; index++) {
    for (const spec of profession.levels[index]!) {
      offers.push({ ...spec, level: index + 1, uses: 0 });
    }
  }
  return offers;
}

/** 升级时**新解锁**的那些交易（只展开第 `level` 级那一批） */
export function offersUnlockedAt(profession: VillagerProfession, level: number): TradeOffer[] {
  if (level < 1 || level > profession.levels.length) return [];
  return profession.levels[level - 1]!.map((spec) => ({ ...spec, level, uses: 0 }));
}

/** 这个村民当前有多少条交易（表长；"解锁了几条"是断言与界面都要用的量） */
export function totalOfferCount(profession: VillagerProfession): number {
  return profession.levels.reduce((sum, level) => sum + level.length, 0);
}

/** 背包侧"我手上有多少"的最小接口（`Inventory#countOf` 就满足它） */
export interface TradeInventory {
  countOf(itemId: number): number;
}

/**
 * 这一条能不能成交；不能成交就返回**给人看的原因**（能成交返回 null）。
 *
 * 判定顺序：先看"货还有没有"（次数用完），再看材料够不够——
 * 原版的两条提示也是这个顺序（"村民今天不卖了"比"你缺 3 个小麦"更根本）。
 */
export function tradeBlocker(offer: TradeOffer, inventory: TradeInventory): string | null {
  if (offer.uses >= offer.maxUses) return '这条交易今天已经用完了（明天补货）';
  for (const cost of adjustedTradeCosts(offer)) {
    const have = inventory.countOf(cost.id);
    if (have < cost.count) return `材料不够（还差 ${cost.count - have} 个）`;
  }
  return null;
}

/**
 * 把一条交易拆成"要扣什么、要给什么"（纯数据，供主程序执行）。
 *
 * 抽出来是为了让"扣与给"这件事**只有一处**：分两处写迟早出现
 * "扣了材料没给东西"或者"给了东西没扣材料"。
 */
export function tradeSettlement(offer: TradeOffer): { take: TradeCost[]; give: { id: number; count: number } } {
  // ⚠️ 要**逐项**拷，不能只拷数组：`[...offer.cost]` 拿到的是同一批对象，
  // 调用方（或断言）改一下 `take[0].count` 就把表里那条交易的价格改了
  // （这类"数组拷了、元素没拷"的坑在本项目栽过不止一次）
  return { take: adjustedTradeCosts(offer), give: { ...offer.result } };
}

/**
 * 村民会到多远去找工作站（格）：水平 ±8、垂直 ±3。
 *
 * ⚠️ 这个范围是**性能与体感的折中**：扫描盒是 17×7×17 = 2023 格，
 * 每只村民每 2~4 秒扫一次（见 `Villager.claimTick`）。原版是"跟着工作站走"，
 * 本项目只做"附近有就认领"——远到看不见的工作站不该隔空认领。
 */
export const WORKSTATION_SCAN_RANGE = 8;
export const WORKSTATION_SCAN_HEIGHT = 3;

/**
 * 在村民周围找一个工作站（没有返回 null）。
 *
 * 从**离村民最近的格子开始**逐层往外找（同一层里按固定顺序），
 * 于是"村里摆了好几个工作站"时，认领哪一个也是确定的——
 * 原版是"谁先被看见"，我们这里是"谁离得近"，可以离线断言。
 */
export function findWorkstationNear(
  getBlock: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
): { block: number; x: number; y: number; z: number } | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cz = Math.floor(z);
  for (let ring = 0; ring <= WORKSTATION_SCAN_RANGE; ring++) {
    for (let dy = -WORKSTATION_SCAN_HEIGHT; dy <= WORKSTATION_SCAN_HEIGHT; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          // 只看这一"层壳"，里面几层上一轮已经看过了
          if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
          const bx = cx + dx;
          const by = cy + dy;
          const bz = cz + dz;
          const block = getBlock(bx, by, bz);
          if (isWorkstation(block)) return { block, x: bx, y: by, z: bz };
        }
      }
    }
  }
  return null;
}
