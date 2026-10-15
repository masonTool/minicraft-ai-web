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
 * "按伤害类型分流"与"按生物家族分流"的那几条。
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
];
/** 四种盔甲 */
const ARMOR: readonly EnchantTarget[] = ['helmet', 'chestplate', 'leggings', 'boots'];

export interface EnchantmentDef {
  readonly id: string;
  /** 中文名（与游戏内文案一致） */
  readonly name: string;
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
  { id: 'protection', name: '保护', maxLevel: 4, targets: ARMOR, weight: 10, implemented: true },
  { id: 'fire_protection', name: '火焰保护', maxLevel: 4, targets: ARMOR, weight: 5, implemented: true },
  { id: 'feather_falling', name: '摔落保护', maxLevel: 4, targets: ['boots'], weight: 5 },
  { id: 'blast_protection', name: '爆炸保护', maxLevel: 4, targets: ARMOR, weight: 2, implemented: true },
  { id: 'projectile_protection', name: '弹射物保护', maxLevel: 4, targets: ARMOR, weight: 5, implemented: true },
  { id: 'respiration', name: '水下呼吸', maxLevel: 3, targets: ['helmet'], weight: 2 },
  { id: 'aqua_affinity', name: '水下速掘', maxLevel: 1, targets: ['helmet'], weight: 2 },
  { id: 'thorns', name: '荆棘', maxLevel: 3, targets: ['chestplate'], weight: 1 },
  { id: 'depth_strider', name: '深海探索者', maxLevel: 3, targets: ['boots'], weight: 2 },
  { id: 'frost_walker', name: '冰霜行者', maxLevel: 2, targets: ['boots'], weight: 2, treasure: true },
  { id: 'soul_speed', name: '灵魂疾行', maxLevel: 3, targets: ['boots'], weight: 1, treasure: true },
  { id: 'binding_curse', name: '绑定诅咒', maxLevel: 1, targets: ARMOR, weight: 1, treasure: true },

  // ---- 武器类
  { id: 'sharpness', name: '锋利', maxLevel: 5, targets: ['sword', 'axe'], weight: 10, implemented: true },
  { id: 'smite', name: '亡灵杀手', maxLevel: 5, targets: ['sword', 'axe'], weight: 5, implemented: true },
  { id: 'bane_of_arthropods', name: '节肢杀手', maxLevel: 5, targets: ['sword', 'axe'], weight: 5, implemented: true },
  { id: 'knockback', name: '击退', maxLevel: 2, targets: ['sword'], weight: 5 },
  { id: 'fire_aspect', name: '火焰附加', maxLevel: 2, targets: ['sword'], weight: 2 },
  { id: 'looting', name: '抢夺', maxLevel: 3, targets: ['sword'], weight: 2, implemented: true },
  { id: 'sweeping', name: '横扫之刃', maxLevel: 3, targets: ['sword'], weight: 2 },

  // ---- 工具类
  { id: 'efficiency', name: '效率', maxLevel: 5, targets: ['pickaxe', 'axe', 'shovel', 'hoe'], weight: 10, implemented: true },
  { id: 'silk_touch', name: '精准采集', maxLevel: 1, targets: ['pickaxe', 'axe', 'shovel', 'hoe'], weight: 1, implemented: true },
  { id: 'unbreaking', name: '耐久', maxLevel: 3, targets: ALL_GEAR, weight: 5, implemented: true },
  { id: 'fortune', name: '时运', maxLevel: 3, targets: ['pickaxe', 'axe', 'shovel', 'hoe'], weight: 2, implemented: true },
  { id: 'mending', name: '经验修补', maxLevel: 1, targets: ALL_GEAR, weight: 2, treasure: true, implemented: true },
  { id: 'vanishing_curse', name: '消失诅咒', maxLevel: 1, targets: ALL_GEAR, weight: 1, treasure: true },

  // ---- 远程与其它（物品本身还没做，先登记，等弓/三叉戟/钓竿落地）
  { id: 'power', name: '力量', maxLevel: 5, targets: ['bow'], weight: 10 },
  { id: 'punch', name: '冲击', maxLevel: 2, targets: ['bow'], weight: 2 },
  { id: 'flame', name: '火矢', maxLevel: 1, targets: ['bow'], weight: 2 },
  { id: 'infinity', name: '无限', maxLevel: 1, targets: ['bow'], weight: 1 },
  { id: 'luck_of_the_sea', name: '海之眷顾', maxLevel: 3, targets: ['fishing_rod'], weight: 2 },
  { id: 'lure', name: '诱饵', maxLevel: 3, targets: ['fishing_rod'], weight: 2 },
  { id: 'loyalty', name: '忠诚', maxLevel: 3, targets: ['trident'], weight: 5 },
  { id: 'impaling', name: '穿刺', maxLevel: 5, targets: ['trident'], weight: 2 },
  { id: 'riptide', name: '激流', maxLevel: 3, targets: ['trident'], weight: 2 },
  { id: 'channeling', name: '引雷', maxLevel: 1, targets: ['trident'], weight: 1 },
  { id: 'multishot', name: '多重射击', maxLevel: 1, targets: ['crossbow'], weight: 2 },
  { id: 'quick_charge', name: '快速装填', maxLevel: 3, targets: ['crossbow'], weight: 5 },
  { id: 'piercing', name: '穿透', maxLevel: 4, targets: ['crossbow'], weight: 10 },
];

/** 原版 1.18 的附魔总数（用于断言"表有没有漏"） */
export const VANILLA_ENCHANTMENT_COUNT = 38;

const BY_ID = new Map<string, EnchantmentDef>(ENCHANTMENTS.map((def) => [def.id, def]));

export function enchantmentById(id: string): EnchantmentDef | undefined {
  return BY_ID.get(id);
}

/** 附魔的中文名；表里没有就回退成 id（`/enchant` 与提示框都用它） */
export function enchantmentName(id: string): string {
  return BY_ID.get(id)?.name ?? id;
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
