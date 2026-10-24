/**
 * 远端玩家盔甲 → 模型装备（联机40）。
 *
 * 本地玩家的甲片颜色由 `main.ts` 的 `applyArmorAppearance()` 从**背包里的四槽物品**算
 * （`armorInfoById(stack.id)` → 图标平均色），数据源本来就是逐槽物品 id——缺的只是
 * "把它告诉队友"。
 *
 * 协议里 `move.armor` 是 4 个 id（`联机17` 起就在，只是本地一直没填）。收到之后要变成
 * `MobEquipment` 的 `head/chest/legs/feet`——`MobRenderer` 已经会按 `armorTint()` 上色，
 * 且 `mobAppearanceKey` 把装备算进 key，所以换甲会自动重建视觉，这里不用碰渲染。
 *
 * 纯函数：网络来的数组可能短、可能带 0、可能是坏值，收口放在能离线断言的地方。
 */

/** 四个槽的装备字段名，**顺序必须与 `ARMOR_SLOT_BASE + 0..3` 一致**（头/胸/腿/脚） */
export const ARMOR_EQUIPMENT_SLOTS = ['head', 'chest', 'legs', 'feet'] as const;

export type ArmorEquipmentSlot = (typeof ARMOR_EQUIPMENT_SLOTS)[number];

/**
 * 把 `armor` 数组转成要写进 `MobEquipment` 的那几格。
 *
 * 只返回**非空**的槽：空槽不能带 `0`（`MobRenderer` 看到 `0` 会当成"装备了 id 0"，
 * 于是 `armorTint(0)` 给出一层灰色），所以调用方拿到的是"该删就删"的补丁。
 */
export function armorEquipmentPatch(armor: readonly number[] | undefined): Partial<Record<ArmorEquipmentSlot, number>> {
  const patch: Partial<Record<ArmorEquipmentSlot, number>> = {};
  if (!armor) return patch;
  for (let slot = 0; slot < ARMOR_EQUIPMENT_SLOTS.length; slot++) {
    const id = armor[slot];
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) continue;
    patch[ARMOR_EQUIPMENT_SLOTS[slot]!] = id;
  }
  return patch;
}

/**
 * 副手 → `MobEquipment.offHand`（联机41）。
 *
 * 与 `armorEquipmentPatch` 同一条口径：空槽要**删**而不是写 0（写 0 会被渲染成
 * 一层灰的"id 0 物品"），坏值一律不收。抽成函数只为能离线断言——
 * 真正画第二只手的是 `MobRenderer.equipmentBoxes`。
 */
export function offhandEquipmentPatch(offhand: number | undefined): { offHand?: number } {
  if (typeof offhand !== 'number' || !Number.isInteger(offhand) || offhand <= 0) return {};
  return { offHand: offhand };
}
