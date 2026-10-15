/**
 * 铁砧逻辑（H8）
 *
 * 四种用法，规则对齐原版 `AnvilMenu#createResult`：
 *  1. **重命名**：改物品名，固定 1 级（+ 累积惩罚）
 *  2. **材料修复**：左格是要修的装备、右格是它的修复材料（铁锭修铁装备…），
 *     每个材料修 `耐久上限 / 4`，每个材料 1 级
 *  3. **合并同种装备**：两件一样的装备 → 耐久相加再送 12%，附魔取更高等级，
 *     固定 2 级（+ 每条附魔的代价）
 *  4. **附魔书**：左格是装备、右格是带附魔的书 → 把书上的附魔并到装备上，
 *     代价 = 每条附魔的代价
 *
 * **累积惩罚**（原版 `RepairCost`，新手最容易忽略的一条）：每次用过铁砧，
 * 物品自身就带一个惩罚值 `2 × 旧值 + 1`（0 → 1 → 3 → 7 → 15 → 31…），
 * 下次再上铁砧就要多花这么多级。于是"反复修一把镐"会越来越贵，
 * 逼玩家去用经验修补而不是无限重修。总代价 ≥ 40 时原版显示"过于昂贵"，这里同样拒绝。
 *
 * 与原版的差异（都写在这里，免得被当成 bug）：
 *  - 每条附魔的合并代价按**权重**推（原版是 rarity 枚举：COMMON/UNCOMMON/RARE/VERY_RARE
 *    对应 1/2/4/8 倍等级），我们的权重表是 10/5/2/1，映射关系一致
 *  - 不做"命名牌/创造模式改颜色"、不做铁砧落地受损与损坏后无法使用
 */

import type { ItemStack } from '../container/Inventory.ts';
import { armorInfoById } from '../registry/armor.ts';
import { enchantmentById, type EnchantmentDef } from '../registry/enchantments.ts';
import { MATERIAL_REPAIR_ITEM } from '../registry/items.ts';
import { toolInfoById } from '../registry/tools.ts';

/** 总代价到这条线就是"过于昂贵"，原版是 40 */
export const MAX_ANVIL_COST = 40;

/** 重命名的固定代价 */
export const RENAME_COST = 1;

/** 合并同种装备的固定代价 */
export const COMBINE_COST = 2;

/** 合并两件同种装备时的额外耐久奖励（原版 12%） */
export const COMBINE_DURABILITY_BONUS = 0.12;

/** 每个修复材料修多少比例（原版 25%） */
export const REPAIR_FRACTION = 0.25;

/** 下一次操作的累积惩罚（原版 `2 × 旧值 + 1`） */
export function nextRepairCost(previous: number): number {
  const value = Number.isFinite(previous) && previous > 0 ? Math.floor(previous) : 0;
  return value * 2 + 1;
}

/** 累积惩罚的展示文案（界面用来解释"为什么这次这么贵"） */
export function repairCostLabel(penalty: number): string {
  return penalty > 0 ? `（含积累惩罚 ${penalty} 级）` : '';
}

/**
 * 这件物品的修复材料；没有（不可修复）返回 undefined。
 * 先按工具/盔甲查出"材质名"，再去 `items.ts` 的统一表里取材料——
 * 这样加一种材质只要在两个地方各加一行（属性表 + 材料表）。
 */
export function repairMaterialOf(itemId: number): number | undefined {
  const material = toolInfoById(itemId)?.material ?? armorInfoById(itemId)?.material;
  return material === undefined ? undefined : MATERIAL_REPAIR_ITEM[material];
}

/** 这件物品的耐久上限；不是耐用品返回 0 */
export function maxDurabilityOf(itemId: number): number {
  return toolInfoById(itemId)?.durability ?? armorInfoById(itemId)?.durability ?? 0;
}

/** 在铁砧上合并一条附魔的代价（原版按 rarity 给 1/2/4/8 倍等级） */
export function enchantCostOnAnvil(def: EnchantmentDef, level: number): number {
  const multiplier = def.weight >= 10 ? 1 : def.weight >= 5 ? 2 : def.weight >= 2 ? 4 : 8;
  return multiplier * Math.max(1, level);
}

export interface AnvilOutcome {
  /** 需要的玩家等级 */
  cost: number;
  /** 产物（铁砧永远只产出 1 个） */
  output: ItemStack;
  /** 产物要不要算作"改过名字"（界面用来决定是否显示名字那一行） */
  renamed: boolean;
}

/** 合并两边的附魔，返回新表与本次的代价；等级取更高，同级则 +1（受各自上限限制） */
function mergeEnchants(
  left: Readonly<Record<string, number>> | undefined,
  right: Readonly<Record<string, number>> | undefined,
): { enchants: Record<string, number>; cost: number } {
  const enchants: Record<string, number> = { ...(left ?? {}) };
  let cost = 0;
  for (const [id, rawLevel] of Object.entries(right ?? {})) {
    const def = enchantmentById(id);
    const level = Math.max(1, Math.floor(rawLevel));
    const current = enchants[id] ?? 0;
    if (current === 0) {
      // 装备上还没有这条：直接搬过来
      enchants[id] = level;
      cost += def ? enchantCostOnAnvil(def, level) : level;
      continue;
    }
    if (current === level && def && current < def.maxLevel) {
      // 两边同级 → 升一级（原版行为）
      enchants[id] = current + 1;
      cost += def ? enchantCostOnAnvil(def, current + 1) : current + 1;
      continue;
    }
    if (level > current) {
      // 一边更高 → 取更高的那一边，代价按**增量**算
      enchants[id] = level;
      cost += def ? enchantCostOnAnvil(def, level - current) : 1;
    }
    // 等级更低且不相等：什么都不发生，也不加代价（原版如此）
  }
  return { enchants, cost };
}

/**
 * 算出铁砧的结果。
 *
 * @param left 左格（要改的物品）
 * @param right 右格（材料 / 附魔书 / 同种装备）；空则只做重命名
 * @param newName 输入框里的名字（空串表示不改名）
 * @returns 需要多少级 + 产物；不可行返回 null
 */
export function combineOnAnvil(left: ItemStack | null, right: ItemStack | null, newName: string): AnvilOutcome | null {
  if (!left) return null;

  const output: ItemStack = { ...left };
  if (left.enchants) output.enchants = { ...left.enchants };

  // 累积惩罚：两件物品各自的惩罚相加（原版 `getBaseRepairCost` 相加）
  const penalty = (left.repairCost ?? 0) + (right?.repairCost ?? 0);
  let cost = 0;

  // ---- 1. 重命名
  // `newName` 在界面上来自一个 input，理论上可能给到 null；顺手兜一下比崩掉强
  const trimmed = (newName ?? '').trim();
  const renamed = trimmed.length > 0 && trimmed !== (left.name ?? '');
  if (renamed) cost += RENAME_COST;

  // ---- 2~4. 右格非空时的三种用法
  if (right) {
    const material = repairMaterialOf(left.id);
    const maxDurability = maxDurabilityOf(left.id);

    if (material !== undefined && right.id === material && (output.damage ?? 0) > 0) {
      // 材料修复：每个材料修 25% 上限，每个材料 1 级
      const perUnit = Math.max(1, Math.floor(maxDurability * REPAIR_FRACTION));
      let damage = output.damage ?? 0;
      let used = 0;
      while (damage > 0 && used < right.count) {
        damage -= Math.min(perUnit, damage);
        used += 1;
        cost += 1;
      }
      if (used === 0) return null;
      if (damage > 0) output.damage = damage;
      else delete output.damage;
    } else if (left.id === right.id && maxDurability > 0) {
      // 合并同种装备：剩余耐久相加 + 12% 奖励
      const leftLeft = maxDurability - (left.damage ?? 0);
      const rightLeft = maxDurability - (right.damage ?? 0);
      const total = Math.min(maxDurability, leftLeft + rightLeft + Math.floor(maxDurability * COMBINE_DURABILITY_BONUS));
      const damage = maxDurability - total;
      if (damage > 0) output.damage = damage;
      else delete output.damage;
      cost += COMBINE_COST;

      const merged = mergeEnchants(left.enchants, right.enchants);
      if (Object.keys(merged.enchants).length > 0) output.enchants = merged.enchants;
      cost += merged.cost;
    } else {
      // 附魔书（或任何带附魔的东西）→ 把附魔并过来
      const merged = mergeEnchants(left.enchants, right.enchants);
      if (merged.cost === 0) return null;
      output.enchants = merged.enchants;
      // 右格是"书"时消耗整叠？原版是消耗 1 本；这里统一按"消耗 1 个"处理
      cost += merged.cost;
    }
  }

  // 光放一件东西、不改名也没材料可合 → 没有意义
  if (cost === 0) return null;

  const total = cost + penalty;
  if (total > MAX_ANVIL_COST) return null;

  if (renamed) output.name = trimmed;
  // 产物带上新的累积惩罚：取两件里更高的那个惩罚再 `2 × 旧值 + 1`（原版行为）。
  // 注意**不能**用两件之和 `penalty` 再算一遍——那样惩罚会翻倍增长，
  // 第三次上铁砧就爆表了（这一处最容易写错）
  output.repairCost = nextRepairCost(Math.max(left.repairCost ?? 0, right?.repairCost ?? 0));
  output.count = 1;

  return { cost: total, output, renamed };
}

/**
 * 界面上的失败原因：`combineOnAnvil` 返回 null 时用它解释为什么。
 *
 * 顺序有讲究，**从"最具体"排到"最笼统"**：先报"物品没损坏""名字没变化"这种玩家一眼能懂的，
 * 最后才落到"过于昂贵"——否则拿一块完好的镐去配钻石也会显示"过于昂贵"，
 * 玩家会以为是自己等级不够，而真正的问题是他根本不需要修。
 */
export function anvilHint(left: ItemStack | null, right: ItemStack | null, newName: string): string {
  if (!left) return '放入要改造的物品';
  const trimmed = (newName ?? '').trim();

  const outcome = combineOnAnvil(left, right, newName);
  if (outcome) return `需要 ${outcome.cost} 级经验`;

  if (!right && trimmed.length === 0) return '右侧放材料/附魔书，或在上方改名';
  const penalty = (left.repairCost ?? 0) + (right?.repairCost ?? 0);
  const baseCost = (right ? 1 : 0) + (trimmed.length > 0 ? RENAME_COST : 0);
  if (penalty + baseCost > MAX_ANVIL_COST) return '过于昂贵（积累惩罚太高）';

  const material = repairMaterialOf(left.id);
  if (right && material === right.id && (left.damage ?? 0) <= 0) return '物品没有损坏，不需要修复';
  if (!right && trimmed.length > 0 && trimmed === (left.name ?? '')) return '名字没有变化';
  if (right && left.id === right.id && maxDurabilityOf(left.id) === 0) return '这件东西没有耐久，合不出结果';
  if (right && left.id === right.id) return '两件物品无法合并';
  if (right && right.enchants === undefined) return '两者无法组合';
  return '这件物品上没有可用的附魔';
}

/** 供界面显示的"耐久 137/250"——铁砧的产物槽也用它 */
export function anvilDurabilityLabel(itemId: number, damage: number): string {
  const max = maxDurabilityOf(itemId);
  if (max <= 0) return '';
  return `耐久 ${Math.max(0, max - damage)}/${max}`;
}
