/**
 * 砂轮逻辑（H15 / J25）
 *
 * 砂轮在原版干三件事，这一份就是这三件事的纯函数版本（不碰 DOM、不碰容器）：
 *  1. **洗掉附魔**：一件带附魔的东西放进去，拿出来的同一件东西上没有附魔了；
 *  2. **拼耐久**：两件**同种**装备 → 剩余耐久相加，再送 5%（铁砧是 12%）；
 *     顺便把附魔全洗掉、把累积惩罚（`repairCost`）归零——这是砂轮与铁砧最大的差别：
 *     铁砧越用越贵，砂轮**只洗不修**，所以它是"把附魔清干净再重新附"的那条路；
 *  3. **返还经验**：被洗掉的附魔按"权重 × 等级"折算成经验点。
 *
 * ⚠️ 与原版的差异（写在这里，免得被当成 bug）：
 *  - 经验按 `enchantCostOnAnvil()` 的权重折算（1/2/4/8 × 等级），原版用的是
 *    `Enchantment#getMinCost`，两者量级一致但不是同一个数；
 *  - 一次只消耗**每格 1 件**（原版砂轮本来也只吃单件装备，这里与铁砧同一口径）；
 *  - **保留自定义名**（原版砂轮也保留名字，只洗附魔）；
 *  - 不做"砂轮对带诅咒的物品额外给经验"这类细节。
 */

import type { ItemStack } from '../container/Inventory.ts';
import { durabilityOf, Item } from '../registry/items.ts';
import { enchantCostOnAnvil, maxDurabilityOf } from './Anvil.ts';
import { enchantmentById } from '../registry/enchantments.ts';

/** 拼耐久时的额外奖励（原版砂轮 5%，铁砧 12%） */
export const GRINDSTONE_DURABILITY_BONUS = 0.05;

export interface GrindstoneOutcome {
  /** 产物（砂轮永远只产出 1 件） */
  output: ItemStack;
  /** 洗掉附魔返还的经验点数 */
  xp: number;
}

/** 这件物品上所有附魔折算成的经验（没有附魔 → 0） */
export function grindExperience(stack: ItemStack | null): number {
  if (!stack?.enchants) return 0;
  let xp = 0;
  for (const [id, rawLevel] of Object.entries(stack.enchants)) {
    const level = Math.max(1, Math.floor(rawLevel));
    const def = enchantmentById(id);
    xp += def ? enchantCostOnAnvil(def, level) : level;
  }
  return xp;
}

/** 有没有附魔（空表也算没有——旧存档里可能留下 `{}`） */
function hasEnchants(stack: ItemStack | null): boolean {
  return stack?.enchants !== undefined && Object.keys(stack.enchants).length > 0;
}

/**
 * 复制一份物品并**剥掉**附魔与累积惩罚。
 *
 * 单独抽出来的理由：三条产出路（洗单件 / 拼两件 / 附魔书）都要做同一件事，
 * 而"漏删 `repairCost`"的症状是"洗过的剑下次上铁砧还是那么贵"——很难联想到砂轮。
 */
function stripped(stack: ItemStack, id = stack.id): ItemStack {
  const output: ItemStack = { id, count: 1 };
  // 耐久 / 名字 / 内容物原样带过去：砂轮只洗附魔，不该顺手把别的东西抹掉
  if (stack.damage !== undefined) output.damage = stack.damage;
  if (stack.name !== undefined && stack.name !== '') output.name = stack.name;
  if (stack.contents !== undefined) output.contents = stack.contents.map((entry) => (entry ? { ...entry } : null));
  return output;
}

/**
 * 算出砂轮的结果。
 *
 * @param left 左格；`right` 右格（可空）
 * @returns 产物与返还经验；没有任何可做的事返回 null
 */
export function grindOnGrindstone(left: ItemStack | null, right: ItemStack | null): GrindstoneOutcome | null {
  const a = left && left.count > 0 ? left : null;
  const b = right && right.count > 0 ? right : null;
  if (!a && !b) return null;
  // 两格必须放同一种东西（原版：不同物品直接没有结果）
  if (a && b && a.id !== b.id) return null;

  const xp = grindExperience(a) + grindExperience(b);

  // ---- 1. 附魔书：洗完变成一本普通书（原版行为）
  // 本项目没有独立的"附魔书"物品 id，附魔书写成 `book + enchants`。
  if ((a?.id === Item.BOOK || b?.id === Item.BOOK) && xp > 0) {
    return { output: { id: Item.BOOK, count: 1 }, xp };
  }

  // ---- 2. 两件同种装备：剩余耐久相加 + 5% 奖励
  if (a && b && a.id === b.id) {
    const max = maxDurabilityOf(a.id);
    if (max <= 0) {
      // 没有耐久的东西（附魔书已在上面处理）：只有"带着附魔"才谈得上洗
      if (xp <= 0) return null;
      return { output: stripped(a), xp };
    }
    const leftRemaining = max - (a.damage ?? 0);
    const rightRemaining = max - (b.damage ?? 0);
    const total = Math.min(max, leftRemaining + rightRemaining + Math.floor(max * GRINDSTONE_DURABILITY_BONUS));
    const output = stripped(a);
    const damage = max - total;
    if (damage > 0) output.damage = damage;
    else delete output.damage;
    return { output, xp };
  }

  // ---- 3. 单件：只有带附魔才有意义（单件受损物品砂轮修不了，原版也一样）
  const only = (a ?? b)!;
  if (hasEnchants(only)) return { output: stripped(only), xp };
  return null;
}

/**
 * 界面上的提示文案。
 *
 * 与铁砧那条一样**从"最具体"排到"最笼统"**：先告诉玩家"这件没附魔可洗"，
 * 再说"两件不是同一种"——否则放着两块不同的石头会显示"这里放不了"，
 * 玩家会以为是砂轮坏了。
 */
export function grindstoneHint(left: ItemStack | null, right: ItemStack | null): string {
  const a = left && left.count > 0 ? left : null;
  const b = right && right.count > 0 ? right : null;
  if (!a && !b) return '放入要洗掉附魔的物品（两件同种装备也可以拼耐久）';
  if (a && b && a.id !== b.id) return '两格必须是同一种物品';

  const outcome = grindOnGrindstone(a, b);
  if (outcome) {
    const max = maxDurabilityOf(outcome.output.id);
    const damage = outcome.output.damage ?? 0;
    const durability = max > 0 ? `耐久 ${max - damage}/${max}` : '';
    const xp = outcome.xp > 0 ? `返还 ${outcome.xp} 点经验` : '';
    return [durability, xp].filter((part) => part !== '').join(' · ') || '可以洗掉附魔';
  }

  if (a && b && a.id === b.id && durabilityOf(a.id) <= 0) return '这两件东西没有耐久，拼不起来';
  if (a && b) return '两件都是完好的，没有可拼的耐久';
  return '这件东西上没有附魔，砂轮洗不出什么';
}
