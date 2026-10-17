/**
 * 创造物品栏**分类标签的图标**（批次 98，对齐基岩版的组织形式）
 *
 * 基岩版的创造栏每个分类是一个**图标**（砖块=建筑、花=装饰、镐=工具、苹果=食物…），
 * 而我们原来只有文字标签：手机上内部细分类排一行必须横向滚动，
 * "矿石与材料""羊毛·床·染料"这种长标签还得占掉半屏宽——想换分类得先滑一下。
 * 现在进一步按基岩版归并为**五个顶层分类**，窄屏只留图标、携带版竖排在左侧。
 *
 * 图标**直接用注册表里的真实物品**（不是另画一套 SVG）：它们本来就在纹理图集里，
 * 顺手还能享受批次 95 修好的"高分屏清晰"（`drawItemIcon` 会按 DPR 放大背板）。
 * 另外这也让"标签长什么样"与"游戏里那件东西"天然一致——
 * 另画一套就得维护两份"砖块长什么样"。
 *
 * ⚠️ 表里必须覆盖 `CREATIVE_TABS` 的**每一项**：漏一个会在界面上出现一个没有图标的空标签，
 * 而那种问题很难在验收里被看见（标签仍然可点、只是空白）。`missingTabIcons()` 就是为它准备的。
 */

import { Block } from '../core/registry/blocks.ts';
import { categoryOf, type ItemCategory } from '../core/registry/items.ts';
import { toolItemId } from '../core/registry/tools.ts';

/** 基岩版创造栏的五个顶层分类（携带版为左侧竖排）。 */
export const CREATIVE_TABS = ['all', 'building', 'equipment', 'items', 'nature'] as const;
export type CreativeTab = (typeof CREATIVE_TABS)[number];

export const CREATIVE_TAB_LABELS: Record<CreativeTab, string> = {
  all: '全部',
  building: '建筑',
  equipment: '装备',
  items: '物品',
  nature: '自然',
};

/** 每个顶层分类拿哪一件物品当图标（都是注册表里已有的东西）。 */
export const CREATIVE_TAB_ICONS: Record<CreativeTab, number> = {
  all: Block.CHEST,
  building: Block.BRICKS,
  equipment: toolItemId('pickaxe', 'iron'),
  items: Block.CRAFTING_TABLE,
  nature: Block.GRASS_BLOCK,
};

/** 哪些分类还没配图标（验收用：漏一个就是界面上一个空白标签） */
export function missingTabIcons(categories: readonly CreativeTab[]): CreativeTab[] {
  return categories.filter((category) => CREATIVE_TAB_ICONS[category] === undefined);
}

/** 把注册表内部十个细分类归并为基岩版界面展示的五个顶层分类。 */
export function creativeTabFor(itemId: number): CreativeTab {
  const category: ItemCategory = categoryOf(itemId);
  switch (category) {
    case 'building':
      return 'building';
    case 'tools':
    case 'armor':
      return 'equipment';
    case 'natural':
    case 'wool':
    case 'food':
      return 'nature';
    case 'ores':
    case 'functional':
    case 'brewing':
    default:
      return 'items';
  }
}

/**
 * **配方书**标签栏的图标（批次 134）。
 *
 * Wiki 说得很直接："合成配方书的标签栏与创造分类相同"，所以这里复用创造栏那几件
 * 物品，而不是另画一套。"全部"那一栏在基岩版经典 UI 里是一个**放大镜**（它是
 * "搜索配方 + 列出全部"的入口），而图集里没有"放大镜"这件物品，所以由界面那边
 * 贴一个内联 SVG（见 `ui/RecipeBook.ts` 的 `SEARCH_TAB_ICON`）。
 */
export const RECIPE_TAB_ICONS: Record<'building' | 'equipment' | 'items' | 'nature', number> = {
  building: CREATIVE_TAB_ICONS.building,
  equipment: CREATIVE_TAB_ICONS.equipment,
  items: CREATIVE_TAB_ICONS.items,
  nature: CREATIVE_TAB_ICONS.nature,
};
