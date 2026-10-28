/**
 * 盔甲与副手的**放置规则**（纯函数）
 *
 * 自绘面板把装备列当成 5 个普通格子用时，玩家能把面包塞进头盔格 —— 看着像个小问题，
 * 但它是"这个界面到底是背包还是装备栏"的分界线：能塞进去，就说明规则层根本没接。
 *
 * 这里只做**形状判断**：哪一格收什么种类。物品属于哪一类由调用方给（`armorKindOf(item)`，
 * 因为品类在 `core` 的注册表里，`ui2d` 不依赖 `core`）。
 */

/** 装备列 5 格的种类（与布局的 `side` 组顺序一致：4 盔甲 + 1 副手） */
export const SIDE_SLOT_KINDS = ['helmet', 'chestplate', 'leggings', 'boots', 'offhand'] as const;

export type SideSlotKind = (typeof SIDE_SLOT_KINDS)[number];

/** 物品的装备类别（`armorKindOf` 的返回值；不是装备就是 `null`） */
export type ItemEquipKind = 'helmet' | 'chestplate' | 'leggings' | 'boots' | null;

/**
 * 这一格能不能放这件东西。
 *
 * 规则三条：
 *  1. 四个盔甲格只收**对应部位**（头盔格不收靴子 —— 原版就是这样，没有"通用盔甲格"）；
 *  2. 副手格什么都收（原版也允许放方块/食物，只是拿着不生效）；
 *  3. 空手（`null`）永远可以放 —— 这是"拿走"而不是"放入"。
 */
export function canPlaceInSideSlot(slot: SideSlotKind, item: ItemEquipKind): boolean {
  if (slot === 'offhand') return true;
  if (item === null) return true;
  return item === slot;
}

/** 反过来问：这件装备该进哪一格（不是装备返回 `null`） */
export function sideSlotFor(item: ItemEquipKind): SideSlotKind | null {
  return item;
}

/**
 * 布局里的下标 → 装备种类（`sideStart` 是装备列在 `SlotAccess` 里的起始下标）。
 *
 * 不直接把 `index` 当成 0..4：装备列可能排在工作站槽位之后（例如"熔炉 + 装备列"），
 * 写死 0..4 会让规则作用到错误的格子上。
 */
export function sideSlotAt(index: number, sideStart: number): SideSlotKind | null {
  const offset = index - sideStart;
  if (offset < 0 || offset >= SIDE_SLOT_KINDS.length) return null;
  return SIDE_SLOT_KINDS[offset]!;
}
