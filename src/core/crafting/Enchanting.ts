/**
 * 附魔台逻辑（H9）
 *
 * 不碰 DOM：给"物品 + 玩家等级 + 书架加成 + 一个随机数发生器"就能算出三个候选槽，
 * 点哪个就按哪个结算。随机数从外面传进来，所以离线测试可以固定种子验结果。
 *
 * 与原版对齐的部分：
 *  - **书架加成**＝附魔台周围的书架数，上限 15（原版 `Math.min(count, 15)`）
 *  - 三个候选槽的花费沿用原版 `EnchantmentHelper.getEnchantmentCost`：
 *      `base = rand(0,8) + 1 + (power >> 1) + rand(0, power)`
 *      槽 0 = max(base/3, 1)、槽 1 = max(base*2/3, 1)、槽 2 = max(base, 1)
 *  - 青金石消耗 1 / 2 / 3（对应三个槽），等级不够或青金石不够就点不动
 *  - 抽中的附魔**互不重复**，按权重加权（权重小 = 稀有）
 *  - 附魔书也能放进附魔台，随机出一条附魔（原版行为）
 *
 * 与原版的差异（都写在这里，免得被当成 bug）：
 *  - 每条附魔的"最低花费曲线"在原版是逐个手写的表（`getMinCost`），这里改成**由权重推**：
 *    权重 ≥10 每 8 点花费升一级、≥5 每 10 点、其余每 15 点。等级 30 时的观感与原版接近
 *    （效率 IV~V、保护 IV），但不是逐个复刻
 *  - 附魔个数用 `1 + ⌊花费/15⌋`（上限 3）近似原版
 *  - 不做附魔台的书页开合动画与符文飘字
 */

import { armorInfoById } from '../registry/armor.ts';
import { enchantmentName } from '../registry/enchantments.ts';
import { ENCHANTMENTS, enchantmentById, romanLevel, type EnchantItemKind, type EnchantmentDef } from '../registry/enchantments.ts';
import { SPECIAL_ITEMS } from '../registry/items.ts';
import { toolInfoById } from '../registry/tools.ts';

/** 书架加成的上限（原版 15） */
export const MAX_BOOKSHELF_POWER = 15;

/** 三个槽各自要的青金石（原版就是 1 / 2 / 3） */
export const LAPIS_PER_SLOT: readonly number[] = [1, 2, 3];

/** 书架数 → 附魔加成（原版是 min(书架数, 15)） */
export function bookshelfPower(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.floor(count), MAX_BOOKSHELF_POWER);
}

/** 这件物品属于哪种附魔类别；不能附魔返回 null */
export function enchantKindOf(itemId: number): EnchantItemKind {
  const tool = toolInfoById(itemId);
  if (tool) return tool.type;
  const armor = armorInfoById(itemId);
  if (armor) return armor.type;
  // 弓这类"不是工具也不是盔甲但能附魔"的走 `SPECIAL_ITEMS` 表（J9）
  const special = SPECIAL_ITEMS[itemId];
  return special ? (special.kind as EnchantItemKind) : null;
}

/** 原版 `EnchantmentHelper.getEnchantmentCost` */
export function enchantmentCost(rng: () => number, slotIndex: number, power: number): number {
  const base = Math.floor(rng() * 9) + 1 + (power >> 1) + Math.floor(rng() * (power + 1));
  if (slotIndex === 0) return Math.max(Math.floor(base / 3), 1);
  if (slotIndex === 1) return Math.max(Math.floor((base * 2) / 3), 1);
  return Math.max(base, 1);
}

/** 由权重推出的"每多少花费升一级"（原版逐条手写的表，这里用权重近似） */
function levelStep(def: EnchantmentDef): number {
  if (def.weight >= 10) return 8;
  if (def.weight >= 5) return 10;
  return 15;
}

/** 这条附魔在本次花费下能出到的等级（1 ~ maxLevel） */
export function enchantLevelAt(def: EnchantmentDef, cost: number, rng: () => number): number {
  const raw = 1 + Math.floor(Math.max(0, cost - 1) / levelStep(def));
  // 再抖一档：同一花费下不是每次都顶格（原版也这样：同样 30 级可能出 III 也可能出 IV）
  const level = raw - (rng() < 0.5 ? 1 : 0);
  return Math.max(1, Math.min(def.maxLevel, level));
}

/** 按权重加权抽一条 */
function pickWeighted(candidates: readonly EnchantmentDef[], rng: () => number): EnchantmentDef | undefined {
  if (candidates.length === 0) return undefined;
  let total = 0;
  for (const def of candidates) total += def.weight;
  let roll = rng() * total;
  for (const def of candidates) {
    roll -= def.weight;
    if (roll <= 0) return def;
  }
  return candidates[candidates.length - 1];
}

export interface EnchantApplied {
  readonly id: string;
  readonly level: number;
}

/** 一个候选槽：花费、青金石、以及"点了会得到什么" */
export interface EnchantOption {
  /** 消耗的玩家等级 */
  readonly cost: number;
  /** 消耗的青金石数量 */
  readonly lapis: number;
  /** 会附上的附魔（点之前就定好，与原版"悬停能看见附魔名"一致） */
  readonly enchants: readonly EnchantApplied[];
}

/**
 * 该类别在附魔台里能出的附魔。
 * 附魔书能出**全部非宝藏附魔**（原版行为），装备只出自己能附的。
 */
export function offeringFor(kind: EnchantItemKind): EnchantmentDef[] {
  if (kind === null) return [];
  return ENCHANTMENTS.filter(
    (def) => !def.treasure && (kind === 'book' || def.targets.includes(kind)),
  );
}

/**
 * 掷出实际附上的附魔。
 * 附魔书只出一条且等级随机（原版如此），装备按花费给 1~3 条。
 */
export function pickEnchants(kind: EnchantItemKind, cost: number, roll: () => number): EnchantApplied[] {
  let pool = offeringFor(kind);
  if (pool.length === 0) return [];

  const wanted = kind === 'book' ? 1 : Math.min(3, 1 + Math.floor(cost / 15));
  const picked: EnchantApplied[] = [];
  for (let i = 0; i < wanted && pool.length > 0; i++) {
    const def = pickWeighted(pool, roll);
    if (!def) break;
    // 书是"随机一条附魔"，等级在原版里也是随机的
    const level = kind === 'book' ? 1 + Math.floor(roll() * def.maxLevel) : enchantLevelAt(def, cost, roll);
    picked.push({ id: def.id, level });
    pool = pool.filter((d) => d.id !== def.id);
  }
  // 排序只为让输出稳定（测试与界面都好读），不影响游戏性
  return picked.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 掷出三个候选槽。
 *
 * @param roll 0~1 的随机数发生器
 */
export function rollOptions(itemId: number, playerLevel: number, power: number, roll: () => number): EnchantOption[] {
  const kind = enchantKindOf(itemId);
  return [0, 1, 2].map((slot) => {
    const cost = enchantmentCost(roll, slot, power);
    const lapis = LAPIS_PER_SLOT[slot]!;
    // 等级不够时这一槽没有候选（原版也是灰着点不动）
    if (kind === null || playerLevel < cost) return { cost, lapis, enchants: [] };
    return { cost, lapis, enchants: pickEnchants(kind, cost, roll) };
  });
}

/**
 * 展示用文案：`效率 III、耐久 II`。
 *
 * 效果还没接的附魔会带一个 `*`——38 条附魔里目前只有 6 条真的生效，
 * 不加标记的话玩家会以为附了个寂寞是 bug。`UI_HINT_UNIMPLEMENTED` 是给界面写的图例。
 */
export const UNIMPLEMENTED_MARK = '*';
export const UI_HINT_UNIMPLEMENTED = `${UNIMPLEMENTED_MARK} 标记的附魔只有名字，效果还没接`;

export function optionLabel(enchants: readonly EnchantApplied[]): string {
  if (enchants.length === 0) return '—';
  return enchants
    .map((enchant) => {
      const def = enchantmentById(enchant.id);
      const mark = def?.implemented === true ? '' : UNIMPLEMENTED_MARK;
      return `${enchantmentName(enchant.id)} ${romanLevel(enchant.level)}${mark}`;
    })
    .join('、');
}
