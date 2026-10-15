/**
 * 槽位上的小装饰（批次 28）：耐久条
 *
 * 快捷栏、背包、容器里的槽位长得一样，所以"这条 3px 的耐久条怎么算、怎么画"
 * 只能有一处实现——否则会出现"快捷栏里红了、背包里还是绿的"这种
 * 让人怀疑数据的现象（两处的判定逻辑必然慢慢漂开）。
 */

import { armorInfoById } from '../core/registry/armor.ts';
import type { ItemStack } from '../core/container/Inventory.ts';
import { durabilityBar } from '../core/registry/itemVisuals.ts';
import { toolInfoById } from '../core/registry/tools.ts';

/** 这件物品的耐久上限（工具与盔甲都从各自的表里取；没有耐久概念时返回 0） */
export function maxDurabilityOf(itemId: number): number {
  return toolInfoById(itemId)?.durability ?? armorInfoById(itemId)?.durability ?? 0;
}

/**
 * 按当前物品更新一个 `.dur-bar` 元素。
 *
 * 结构约定（`main.buildHotbar` 与 `InventoryScreen.createSlot` 都按它建）：
 * ```html
 * <i class="dur-bar"><b style="width: 37%"></b></i>
 * ```
 * 不该显示时加 `hidden` 类（满耐久、以及本来就没有耐久的东西）。
 */
export function updateDurabilityBar(element: HTMLElement | null, stack: ItemStack | null | undefined): void {
  if (!element) return;
  const bar = stack ? durabilityBar(stack.damage, maxDurabilityOf(stack.id)) : null;
  if (!bar) {
    element.classList.add('hidden');
    return;
  }

  element.classList.remove('hidden');
  // 档位（绿/黄/红）决定颜色，比例决定长度：三档都由 `itemVisuals` 算
  for (const level of ['high', 'mid', 'low'] as const) {
    element.classList.toggle(`dur-${level}`, bar.level === level);
  }
  const fill = element.querySelector('b');
  if (fill) (fill as HTMLElement).style.width = `${Math.round(bar.ratio * 100)}%`;
}
