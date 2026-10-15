/**
 * 物品的"观感元数据"：稀有度与耐久条（批次 28 界面美化）
 *
 * 为什么单独一个纯模块：这两样东西**既影响观感也承载信息**——
 *   - 稀有度决定提示框标题的颜色（原版里"附魔的钻石镐"名字是青色、金苹果是青色、
 *     龙蛋是品红），玩家扫一眼就知道"这东西值不值钱"；
 *   - 耐久条是原版最有用的一格视觉信息：快坏的镐子会明明白白变红。
 *
 * 两件事都能算成确定的值，所以放在这里（而不是散在 UI 里），
 * 由 `registry/itemNames.ts` 的提示框与 `ui/` 的槽位共用，并且能离线断言。
 */

import { Block } from './blocks.ts';
import { Item } from './items.ts';

/** 稀有度（与原版一致的四个档） */
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic';

/**
 * 稀有度配色（原版那套）：
 * 普通白 / 罕见黄 / 稀有青 / 史诗品红。
 *
 * ⚠️ 这几个值同时被 CSS（`.rarity-rare { color: ... }`）与断言用到，
 * 所以**只有这一个出处**，改色就改这里（CSS 那边靠类名，不重复写色值）。
 */
export const RARITY_ORDER: readonly ItemRarity[] = ['common', 'uncommon', 'rare', 'epic'];

/**
 * 少数"自带稀有度"的物品。
 *
 * 只登记**真的特殊**的东西：金苹果、龙蛋这种"一看就不是普通材料"的。
 * 钻石/铁这类常见材料在原版里也是普通档，不登记（否则整个背包都是彩色的，
 * 稀有度就失去意义了）。
 */
const SPECIAL_RARITY: Readonly<Record<number, ItemRarity>> = {
  [Item.GOLDEN_APPLE]: 'rare',
  [Block.DRAGON_EGG]: 'epic',
  [Block.ENCHANTING_TABLE]: 'rare',
  // 信标 / 潮涌核心 / 下界之星都还没做，等做了再加（加一行就行）
};

/**
 * 一件物品的稀有度。
 *
 * 规则（优先级从高到低）：
 *  1. 有附魔 → **稀有**（原版里附魔过的装备名字就是青色的，与它原本是什么无关）
 *  2. 登记在特殊表里 → 表里的档
 *  3. 其余 → 普通
 *
 * @param enchants 附魔表；空对象/undefined 都算"没有附魔"
 */
export function rarityOf(itemId: number, enchants?: Readonly<Record<string, number>> | null): ItemRarity {
  if (enchants && Object.keys(enchants).length > 0) return 'rare';
  return SPECIAL_RARITY[itemId] ?? 'common';
}

/** 稀有度对应的 CSS 类名（UI 只认类名，不认色值） */
export function rarityClassName(rarity: ItemRarity): string {
  return `rarity-${rarity}`;
}

/** 耐久条的档位：绿 / 黄 / 红 */
export type DurabilityLevel = 'high' | 'mid' | 'low';

export interface DurabilityBar {
  /** 剩余比例 0~1（满耐久是 1） */
  ratio: number;
  level: DurabilityLevel;
}

/**
 * 剩余比例 → 档位。阈值照原版的观感：
 * 剩 60% 以上绿、30%~60% 黄、30% 以下红。
 */
export function durabilityLevel(ratio: number): DurabilityLevel {
  if (ratio > 0.6) return 'high';
  if (ratio > 0.3) return 'mid';
  return 'low';
}

/**
 * 一条耐久条该画成什么样；**不该显示时返回 null**。
 *
 * 不该显示的情况有两种：
 *  - 这件东西根本没有耐久（方块、材料…）
 *  - 它是满耐久（原版也只在受损后显示，满耐久的工具不占那一行）
 *
 * @param damage 已损耗的点数（与 `ItemStack.damage` 同一口径）
 * @param maxDurability 耐久上限；非正数视为"没有耐久"
 */
export function durabilityBar(damage: number | undefined, maxDurability: number): DurabilityBar | null {
  if (!Number.isFinite(maxDurability) || maxDurability <= 0) return null;
  if (!Number.isFinite(damage ?? 0) || (damage ?? 0) <= 0) return null;

  const ratio = Math.max(0, Math.min(1, 1 - (damage as number) / maxDurability));
  return { ratio, level: durabilityLevel(ratio) };
}
