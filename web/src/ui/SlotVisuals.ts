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

/**
 * 装备槽的五个位置（批次 20261024-1152）。
 *
 * 空槽以前写"头 / 胸 / 腿 / 靴 / 副手"，那是**文字**；原版（Java 与基岩版手机）
 * 画的是部位剪影图标——一眼就能看出这格放什么，而且换语言不受影响。
 */
export type ArmorSlotKind = 'helmet' | 'chestplate' | 'leggings' | 'boots' | 'offhand';

/**
 * 24×24 视口的部位剪影（`fill="currentColor"`，颜色与透明度交给 CSS）。
 *
 * ⚠️ 只画填充色块、不用描边：40px 的格子里描边会糊成一团（与 `TouchIcons` 同一条经验）。
 */
const ARMOR_SLOT_PATHS: Readonly<Record<ArmorSlotKind, string>> = {
  // 头盔：圆顶 + 两侧护颊，脸那一块留空
  helmet: '<path d="M12 4.2a7.2 7.2 0 0 1 7.2 7.2v4.4h-3.3v-3.4a3.9 3.9 0 0 0-7.8 0v3.4H4.8v-4.4A7.2 7.2 0 0 1 12 4.2z"/>',
  // 胸甲：肩部两片 + 躯干
  chestplate:
    '<path d="M8.6 4.6 4 7.6l1.7 4.4 2.1-1.1v8.5h8.4v-8.5l2.1 1.1L20 7.6l-4.6-3-3.4 1.6z"/>',
  // 护腿：腰 + 两条腿（中间留缝）
  leggings: '<path d="M6.4 3.8h11.2v6.4h-1.5V20h-3.3v-7.6h-1.6V20H7.9V10.2H6.4z"/>',
  // 靴子：鞋筒 + 前伸的鞋头
  boots: '<path d="M7 3.8h4.2v8.4l4.7 2.8c1 .6 1.6 1.7 1.6 2.9v1.3H7z"/>',
  // 副手：盾牌（与原版副手槽一致）
  offhand:
    '<path d="M12 3.2 19 5.4v5.8c0 4.2-2.8 7.5-7 9-4.2-1.5-7-4.8-7-9V5.4z"/>',
};

/** 某个部位的空槽图标（`<svg>` 字符串，直接写进槽位里） */
export function armorSlotHintSvg(kind: ArmorSlotKind): string {
  return (
    '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true" focusable="false">' +
    `${ARMOR_SLOT_PATHS[kind]}</svg>`
  );
}
