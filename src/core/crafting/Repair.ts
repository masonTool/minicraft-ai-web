/**
 * 「经验修补」附魔（K3）
 *
 * 原版行为：身上任何一件带经验修补的装备没修满时，**捡到的经验会先被拿去修它**
 * （不是先进球再修，而是球直接被消耗掉、不进经验条）。换算关系是 1 点经验换 2 点耐久。
 *
 * 与原版的一处差异：原版每次随机挑一件没修满的装备，这里改成**按传入顺序依次修满**。
 * 随机抽一件在界面上表现为"耐久条跳来跳去"，而且没法写断言；依次修满行为可预测，
 * 总换算关系（1 点经验 = 2 点耐久）与原版完全一致。
 */

import { armorInfoById } from '../registry/armor.ts';
import { enchantLevel } from '../registry/enchantments.ts';
import { toolInfoById } from '../registry/tools.ts';
import type { ItemStack } from '../container/Inventory.ts';

/** 1 点经验换 2 点耐久（原版数值） */
export const MENDING_DURABILITY_PER_XP = 2;

/** 这件物品的耐久上限；不是耐用品返回 0 */
export function durabilityOf(itemId: number): number {
  return toolInfoById(itemId)?.durability ?? armorInfoById(itemId)?.durability ?? 0;
}

/**
 * 这件物品能不能吃经验修补（带附魔、有耐久、且确实损耗了）
 *
 * 注意：**装在装备槽里的盔甲也算**——原版身上穿着的甲一样会被修。
 */
export function isMendable(stack: ItemStack | null): boolean {
  if (!stack) return false;
  if (enchantLevel(stack.enchants, 'mending') <= 0) return false;
  const max = durabilityOf(stack.id);
  if (max <= 0) return false;
  return (stack.damage ?? 0) > 0;
}

/**
 * 把经验拿去修装备。
 *
 * **会就地修改 `stacks` 里的物品**（把 `damage` 减下来），并把修好的返回出去。
 *
 * @param stacks 候选物品（通常 = 背包 0-40 号槽，含盔甲槽）
 * @param xp 本次拿到的经验点数
 * @returns 实际被用掉的经验；剩下的应当进经验条
 */
export function applyMending(stacks: readonly (ItemStack | null)[], xp: number): number {
  if (xp <= 0) return 0;
  let left = xp;

  for (const stack of stacks) {
    if (left <= 0) break;
    if (!isMendable(stack)) continue;

    // 一点经验修 2 点耐久，修不满也照样扣 1 点经验（原版就是这个粒度），
    // 所以按"经验点"为单位一步步修，而不是先算总账再四舍五入
    let damage = stack!.damage ?? 0;
    while (left > 0 && damage > 0) {
      damage -= Math.min(MENDING_DURABILITY_PER_XP, damage);
      left -= 1;
    }
    if (damage > 0) stack!.damage = damage;
    else delete stack!.damage;
  }

  return xp - left;
}
