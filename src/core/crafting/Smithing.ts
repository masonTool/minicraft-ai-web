/**
 * 锻造台逻辑（K8 尾巴：下界合金装备）
 *
 * 原版 1.16 的锻造台只做一件事：**把钻石装备升级成下界合金装备**
 * （1.20 之后多了"盔甲纹饰"与"下界合金升级模板"，本项目不做那一档）。
 *
 * 规则逐条对齐原版 `SmithingMenu#createResult`：
 *  - 左格必须是**钻石**工具/武器/盔甲，右格必须是**下界合金锭**
 *  - 一次消耗 **1 个锭**，产出 1 件下界合金装备
 *  - **不消耗经验**（这是它和铁砧最大的差别：铁砧改名/合并要等级，锻造台不要）
 *  - **附魔、自定义名字、累积惩罚全部原样带过去**
 *  - **耐久损耗也原样带过去**（原版不修耐久！很多人以为锻造台会顺手修满，
 *    实际是"升级前后磨损程度一模一样"，所以升级前最好先把耐久修满）
 *  - 不可升级的东西（铁装备、下界合金装备自己、别的物品）→ 没有产物
 *
 * 为什么单独一个文件而不是塞进 `Recipes.ts`：合成是"9 格摆好→出结果"，
 * 锻造是"两格固定位置→出结果"，连"能不能摆"的判定都不一样。
 */

import type { ItemStack } from '../container/Inventory.ts';
import { ARMOR_TYPES, armorItemId } from '../registry/armor.ts';
import { Item } from '../registry/items.ts';
import { TOOL_KINDS, toolItemId } from '../registry/tools.ts';

/** 下界合金锭每升级一次消耗几个（原版 1 个） */
export const SMITHING_INGOT_COST = 1;

/**
 * 钻石装备 → 下界合金装备的对照表（9 条：5 种工具 + 4 件盔甲）。
 *
 * 从两张表推出来而不是手抄 9 行——手抄的话"以后加了新的工具种类"就会漏。
 */
const NETHERITE_UPGRADE = new Map<number, number>();
for (const kind of TOOL_KINDS) {
  NETHERITE_UPGRADE.set(toolItemId(kind, 'diamond'), toolItemId(kind, 'netherite'));
}
for (const type of ARMOR_TYPES) {
  NETHERITE_UPGRADE.set(armorItemId(type, 'diamond'), armorItemId(type, 'netherite'));
}

/** 这件装备能不能被升级成下界合金（钻石工具/武器/盔甲可以） */
export function isNetheriteUpgradable(itemId: number): boolean {
  return NETHERITE_UPGRADE.has(itemId);
}

/** 升级后的物品 id；不能升级返回 undefined */
export function netheriteUpgradeOf(itemId: number): number | undefined {
  return NETHERITE_UPGRADE.get(itemId);
}

/** 对照表里的条目数（断言用） */
export function netheriteUpgradeCount(): number {
  return NETHERITE_UPGRADE.size;
}

/**
 * 全部升级组合（批次 277：锻造台左栏的"可做列表"要从这里生成）。
 *
 * 返回数组而不是 Map：界面只遍历、不查表，数组的顺序稳定（工具种类 → 盔甲），
 * 列表每次画出来的顺序也就稳定。
 */
export function netheriteUpgradeList(): readonly { equipment: number; result: number }[] {
  return [...NETHERITE_UPGRADE].map(([equipment, result]) => ({ equipment, result }));
}

export interface SmithingOutcome {
  /** 产物（永远 1 件） */
  output: ItemStack;
  /** 消耗几个锭 */
  cost: number;
}

/**
 * 算出锻造台的结果；不可行返回 null。
 *
 * @param equipment 左格（要升级的装备）
 * @param material  右格（下界合金锭）
 */
export function combineOnSmithing(equipment: ItemStack | null, material: ItemStack | null): SmithingOutcome | null {
  if (!equipment || !material) return null;
  if (material.id !== Item.NETHERITE_INGOT || material.count < SMITHING_INGOT_COST) return null;

  const upgraded = netheriteUpgradeOf(equipment.id);
  if (upgraded === undefined) return null;

  // 原样复制：耐久损耗（damage）、附魔、自定义名字、累积惩罚都要带过去
  const output: ItemStack = { ...equipment, id: upgraded, count: 1 };
  if (equipment.enchants) output.enchants = { ...equipment.enchants };

  return { output, cost: SMITHING_INGOT_COST };
}

/**
 * 界面上的提示：`combineOnSmithing` 返回 null 时用它解释为什么。
 *
 * 顺序从"最具体"到"最笼统"（与铁砧那边同一条经验）：
 * 先报"放的是下界合金装备"这种一眼能懂的，最后才落到"材料不对"。
 */
export function smithingHint(equipment: ItemStack | null, material: ItemStack | null): string {
  if (!equipment && !material) return '左边放装备、右边放下界合金锭';
  if (!equipment) return '左格放入钻石装备';
  if (!material) return '右格放入下界合金锭';
  // "两格放反了"要排在"材料不对"**前面**：否则玩家把锭放在左格时，
  // 提示只会说"右格只能放下界合金锭"，他根本不知道自己只是放反了
  if (equipment.id === Item.NETHERITE_INGOT && netheriteUpgradeOf(material.id) !== undefined) {
    return '两格放反了：装备在左、锭在右';
  }
  if (material.id !== Item.NETHERITE_INGOT) return '右格只能放下界合金锭';
  if (netheriteUpgradeOf(equipment.id) === undefined) return '只有钻石装备能升级成下界合金';
  // 走到这里说明材料数量不足（正常堆叠不会出现，兜一句免得界面空白）
  return `需要 ${SMITHING_INGOT_COST} 个下界合金锭`;
}
