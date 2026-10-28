// 多语言 P2-5：附魔名走 `label.enchantment.*`
import { t } from '../i18n/I18n.ts';

/**
 * 附魔表（H9 / K3）
 *
 * 名字、最高等级、可附魔的物品类型、权重（原版的 rarity weight，越小越稀有）都对齐原版 1.18。
 * 原版 1.18 共 38 种（不含 1.19 才加的迅捷潜行），这里**全部登记**，
 * 但只有 `implemented` 标了 true 的那几条真的接了效果——剩下的是"表里有、效果待接"，
 * 免得界面里凭空冒出一个不存在的附魔名。
 *
 * 为什么效果要分两步做：附魔效果各自要改的地方差得很远（挖掘速度在 `tools.ts`、
 * 掉落数量在破坏路径、减伤在 `armor.ts`、攻击伤害在近战入口），
 * 一次全接容易把每条都做得似是而非。第一批做了最有手感的六条，第二批补上了
 * "按伤害类型分流"与"按生物家族分流"的那几条；批次 243 又接了六条
 * （摔落保护 / 水下呼吸 / 水下速掘 / 击退 / 火焰附加 / 消失诅咒）。
 *
 * ⚠️ **节肢杀手**目前"公式接好了但打不到东西"（蜘蛛还没做）——留着是对的，
 * 一旦有来源就立刻生效，但现在的玩家附了看不出区别，这一点写在 TASKS 的 K3 里。
 * （弹射物保护原本在同一条里，J9 的骷髅远程落地后已经有来源了。）
 */

/** 附魔能附在什么上 */
export type EnchantTarget =
  | 'sword'
  | 'axe'
  | 'pickaxe'
  | 'shovel'
  | 'hoe'
  | 'helmet'
  | 'chestplate'
  | 'leggings'
  | 'boots'
  | 'bow'
  | 'crossbow'
  | 'trident'
  | 'fishing_rod'
  | 'shears'
  | 'book';

/**
 * 「所有有耐久的装备」的简写：剑/工具/护甲 + 弓/弩/三叉戟/钓竿。
 *
 * 后面四样目前只有弓落地了，但**一并写进来**：耐久与经验修补在原版是"只要物品有耐久就能附"，
 * 漏掉一个就会表现为"弓附不到耐久"，而且这种漏很难从界面上看出来。
 */
const ALL_GEAR: readonly EnchantTarget[] = [
  'sword',
  'axe',
  'pickaxe',
  'shovel',
  'hoe',
  'helmet',
  'chestplate',
  'leggings',
  'boots',
  'bow',
  'crossbow',
  'trident',
  'fishing_rod',
  'shears',
];
/** 四种盔甲 */
const ARMOR: readonly EnchantTarget[] = ['helmet', 'chestplate', 'leggings', 'boots'];

export interface EnchantmentDef {
  readonly id: string;
  readonly maxLevel: number;
  readonly targets: readonly EnchantTarget[];
  /** 权重：越小越稀有（原版 rarity weight） */
  readonly weight: number;
  /** 只能从宝藏/交易获得，附魔台不出 */
  readonly treasure?: boolean;
  /**
   * 效果是否已经真的接进游戏。
   * 没接的那些**会出现在附魔台候选里**（否则表就白登记了），但除了名字什么都不做——
   * 界面上会标一个「效果未实现」的提示，不装作能用。
   */
  readonly implemented?: boolean;
}

export const ENCHANTMENTS: readonly EnchantmentDef[] = [
  // ---- 盔甲类
  { id: 'protection', maxLevel: 4, targets: ARMOR, weight: 10, implemented: true },
  { id: 'fire_protection', maxLevel: 4, targets: ARMOR, weight: 5, implemented: true },
  { id: 'feather_falling', maxLevel: 4, targets: ['boots'], weight: 5, implemented: true },
  { id: 'blast_protection', maxLevel: 4, targets: ARMOR, weight: 2, implemented: true },
  { id: 'projectile_protection', maxLevel: 4, targets: ARMOR, weight: 5, implemented: true },
  { id: 'respiration', maxLevel: 3, targets: ['helmet'], weight: 2, implemented: true },
  { id: 'aqua_affinity', maxLevel: 1, targets: ['helmet'], weight: 2, implemented: true },
  // 荆棘（批次 264）：被近战打中时反伤攻击者，数值见 `PlayerStats.thornsDamage`
  { id: 'thorns', maxLevel: 3, targets: ['chestplate'], weight: 1, implemented: true },
  // 深海探索者 / 灵魂疾行（批次 262）：水下与灵魂沙上的移速倍率，见 `PlayerStats`
  { id: 'depth_strider', maxLevel: 3, targets: ['boots'], weight: 2, implemented: true },
  // 冰霜行者（批次 263）：踩过的水面结霜冰，5 秒后化回水，见 `main.updateFrostWalker`
  { id: 'frost_walker', maxLevel: 2, targets: ['boots'], weight: 2, treasure: true, implemented: true },
  { id: 'soul_speed', maxLevel: 3, targets: ['boots'], weight: 1, treasure: true, implemented: true },
  // 绑定诅咒（批次 270）：装备后无法主动脱下，判定见 `isBoundByCurse`
  { id: 'binding_curse', maxLevel: 1, targets: ARMOR, weight: 1, treasure: true, implemented: true },

  // ---- 武器类
  { id: 'sharpness', maxLevel: 5, targets: ['sword', 'axe'], weight: 10, implemented: true },
  { id: 'smite', maxLevel: 5, targets: ['sword', 'axe'], weight: 5, implemented: true },
  { id: 'bane_of_arthropods', maxLevel: 5, targets: ['sword', 'axe'], weight: 5, implemented: true },
  { id: 'knockback', maxLevel: 2, targets: ['sword'], weight: 5, implemented: true },
  { id: 'fire_aspect', maxLevel: 2, targets: ['sword'], weight: 2, implemented: true },
  { id: 'looting', maxLevel: 3, targets: ['sword'], weight: 2, implemented: true },
  // 横扫之刃（批次 262）：命中时对周围生物溅射，公式见 `tools.ts#sweepDamage`
  { id: 'sweeping', maxLevel: 3, targets: ['sword'], weight: 2, implemented: true },

  // ---- 工具类
  { id: 'efficiency', maxLevel: 5, targets: ['pickaxe', 'axe', 'shovel', 'hoe', 'shears'], weight: 10, implemented: true },
  { id: 'silk_touch', maxLevel: 1, targets: ['pickaxe', 'axe', 'shovel', 'hoe', 'shears'], weight: 1, implemented: true },
  { id: 'unbreaking', maxLevel: 3, targets: ALL_GEAR, weight: 5, implemented: true },
  { id: 'fortune', maxLevel: 3, targets: ['pickaxe', 'axe', 'shovel', 'hoe'], weight: 2, implemented: true },
  { id: 'mending', maxLevel: 1, targets: ALL_GEAR, weight: 2, treasure: true, implemented: true },
  { id: 'vanishing_curse', maxLevel: 1, targets: ALL_GEAR, weight: 1, treasure: true, implemented: true },

  // ---- 弓（J9 落地后四条全部接线）
  // ⚠️ 这四条曾经漏标 `implemented`：效果在 `core/entity/Bow.ts` 里早就按它们算了
  // （`arrowDamageAt` 取力量、`knockbackStrength` 取冲击、火矢点燃、无限不耗箭），
  // 但界面上仍按"效果未实现"标着 `*` —— 玩家附了一把力量 V 的弓，却被界面告知"这条没效果"。
  // 教训：`implemented` 是**一列手写的数据**，接线时要跟着改；覆盖度台账（`audit:coverage`）
  // 现在把"已接线条数"当众数出来，这类漂移会直接体现在百分比上。
  { id: 'power', maxLevel: 5, targets: ['bow'], weight: 10, implemented: true },
  { id: 'punch', maxLevel: 2, targets: ['bow'], weight: 2, implemented: true },
  { id: 'flame', maxLevel: 1, targets: ['bow'], weight: 2, implemented: true },
  { id: 'infinity', maxLevel: 1, targets: ['bow'], weight: 1, implemented: true },
  // 海之眷顾 / 诱饵（批次 81 随钓鱼接线）：前者改池子权重（`registry/fishing.ts`），
  // 后者缩短等待时间（`survival/Fishing.ts` 的 `waitSecondsFor`）
  { id: 'luck_of_the_sea', maxLevel: 3, targets: ['fishing_rod'], weight: 2, implemented: true },
  { id: 'lure', maxLevel: 3, targets: ['fishing_rod'], weight: 2, implemented: true },
  // 忠诚（批次 268）：投出的三叉戟插住后自己飞回手里
  { id: 'loyalty', maxLevel: 3, targets: ['trident'], weight: 5, implemented: true },
  // 穿刺（批次 267）：三叉戟对水生生物每级 +2.5
  { id: 'impaling', maxLevel: 5, targets: ['trident'], weight: 2, implemented: true },
  // 激流（批次 267）：在水里/雨中按住使用键向前冲，速度见 `tools.riptideSpeed`
  { id: 'riptide', maxLevel: 3, targets: ['trident'], weight: 2, implemented: true },
  // 引雷（批次 269）：雷雨天命中点召唤闪电（雷雨判定在主程序）
  { id: 'channeling', maxLevel: 1, targets: ['trident'], weight: 1, implemented: true },
  // 多重射击 / 快速装填（批次 265）：弩装填与齐射，数值见 `Bow.ts`
  { id: 'multishot', maxLevel: 1, targets: ['crossbow'], weight: 2, implemented: true },
  { id: 'quick_charge', maxLevel: 3, targets: ['crossbow'], weight: 5, implemented: true },
  // 穿透（批次 266）：箭矢命中生物后继续飞，剩余次数 = 等级
  { id: 'piercing', maxLevel: 4, targets: ['crossbow'], weight: 10, implemented: true },
];

/** 原版 1.18 的附魔总数（用于断言"表有没有漏"） */
export const VANILLA_ENCHANTMENT_COUNT = 38;

const BY_ID = new Map<string, EnchantmentDef>(ENCHANTMENTS.map((def) => [def.id, def]));

export function enchantmentById(id: string): EnchantmentDef | undefined {
  return BY_ID.get(id);
}

/**
 * 附魔名（多语言 P2-5）：键 `label.enchantment.<id>`，查不到回退成 id。
 *
 * 名字原来写在每条 `ENCHANTMENTS` 里（`name: '保护'`），于是 `附魔：保护 III`
 * 这种提示在英文界面下整行是中文。现在名字只住在语言表，数据表只管数值。
 */
export function enchantmentName(id: string): string {
  const key = `label.enchantment.${id}`;
  const text = t(`label.enchantment.${id}`);
  return text === key ? id : text;
}

/**
 * 有没有绑定诅咒（批次 270）。
 *
 * 抽成纯函数：装备槽的"能不能脱下"要在界面层判，而界面层不该关心附魔表怎么存。
 */
export function isBoundByCurse(enchants?: Readonly<Record<string, number>>): boolean {
  return enchantLevel(enchants, 'binding_curse') > 0;
}

/**
 * 取某条附魔的等级；没有这条附魔返回 0。
 * 所有"效果接线"的地方都用它，省得每处各写一遍 `enchants?.[id] ?? 0`。
 */
export function enchantLevel(enchants: Readonly<Record<string, number>> | undefined, id: string): number {
  const level = enchants?.[id];
  return typeof level === 'number' && level > 0 ? Math.floor(level) : 0;
}

/** 罗马数字（界面显示"效率 III"用；等级从 1 起） */
export function romanLevel(level: number): string {
  const table: readonly [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let rest = Math.max(1, Math.floor(level));
  let out = '';
  for (const [value, symbol] of table) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

/** 这件物品的"附魔类别"（由工具/盔甲的种类推出来） */
export type EnchantItemKind = EnchantTarget | null;

/** 能把这条附魔附在这件物品上吗 */
export function canEnchant(def: EnchantmentDef, kind: EnchantItemKind): boolean {
  return kind !== null && def.targets.includes(kind);
}

/** 这本书/这件装备在附魔台里能出的全部附魔（已排除宝藏附魔） */
export function offeringFor(kind: EnchantItemKind): readonly EnchantmentDef[] {
  return ENCHANTMENTS.filter((def) => canEnchant(def, kind) && !def.treasure);
}

