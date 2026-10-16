/**
 * 创造物品栏**分类标签的图标**（批次 98，对齐基岩版的组织形式）
 *
 * 基岩版的创造栏每个分类是一个**图标**（砖块=建筑、花=装饰、镐=工具、苹果=食物…），
 * 而我们原来只有文字标签：手机上十个中文标签排一行必须横向滚动，
 * "矿石与材料""羊毛·床·染料"这种长标签还得占掉半屏宽——想换分类得先滑一下。
 * 改成"图标 + 文字"之后，**窄屏可以只留图标**（十个 38px 的方块刚好一行放得下）。
 *
 * 图标**直接用注册表里的真实物品**（不是另画一套 SVG）：它们本来就在纹理图集里，
 * 顺手还能享受批次 95 修好的"高分屏清晰"（`drawItemIcon` 会按 DPR 放大背板）。
 * 另外这也让"标签长什么样"与"游戏里那件东西"天然一致——
 * 另画一套就得维护两份"砖块长什么样"。
 *
 * ⚠️ 表里必须覆盖 `ITEM_CATEGORIES` 的**每一项**：漏一个会在界面上出现一个没有图标的空标签，
 * 而那种问题很难在验收里被看见（标签仍然可点、只是空白）。`missingTabIcons()` 就是为它准备的。
 */

import { Block, woolId } from '../core/registry/blocks.ts';
import { Item, type ItemCategory } from '../core/registry/items.ts';
import { armorItemId } from '../core/registry/armor.ts';
import { toolItemId } from '../core/registry/tools.ts';
import { POTION_ITEMS } from '../core/registry/potions.ts';

/** 每个分类拿哪一件物品当图标（都是注册表里已有的东西） */
export const CREATIVE_TAB_ICONS: Record<ItemCategory, number> = {
  // "全部"用箱子：与基岩版一样表示"什么都有"
  all: Block.CHEST,
  building: Block.BRICKS,
  natural: Block.GRASS_BLOCK,
  ores: Item.IRON_INGOT,
  // 羊毛那一页是"羊毛 · 床 · 染料"，图标用白羊毛（一眼能认出是染色那一族）
  wool: woolId(0),
  tools: toolItemId('pickaxe', 'iron'),
  armor: armorItemId('chestplate', 'iron'),
  food: Item.APPLE,
  functional: Block.FURNACE,
  // 酿造那一页的核心是药水：拿第一瓶（粗制的药水）当图标
  brewing: POTION_ITEMS[0]!.id,
};

/** 哪些分类还没配图标（验收用：漏一个就是界面上一个空白标签） */
export function missingTabIcons(categories: readonly ItemCategory[]): ItemCategory[] {
  return categories.filter((category) => CREATIVE_TAB_ICONS[category] === undefined);
}
