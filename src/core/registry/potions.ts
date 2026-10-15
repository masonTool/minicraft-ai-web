/**
 * 药水表（H10）
 *
 * ⚠️ **为什么用 id 枚举而不是给 `ItemStack` 加一个 potion 字段**：
 * `ItemStack` 目前只有 `id/count/damage/enchants`，没有 NBT。给药水加字段看着自然，
 * 但会连带改**存档、提示框、配方匹配、合成书**四处——而药水种类是有限枚举
 * （原版也就 30 来种，这里先做 10 种），用 id 枚举与现有架构
 * （id → 静态贴图/静态中文名）完全一致，改动面最小。
 *
 * 效果 id 与 `StatusEffects` 的表对齐，改那边要回来看这里。
 */

import type { EffectId } from '../survival/StatusEffects.ts';

export interface PotionEntry {
  readonly id: number;
  /** 稳定 key（拼贴图名与注册名） */
  readonly key: string;
  readonly name: string;
  /** 喝下后挂上的效果；空数组表示这瓶什么都不做（粗制药水就是"半成品"） */
  readonly effects: readonly { id: EffectId; seconds: number; amplifier: number }[];
  /** 半成品：只能当酿造原料，喝了没效果 */
  readonly base?: boolean;
}

/**
 * 药水的物品 id。
 *
 * ⚠️ 这些 id **定义在这里而不是 `Item` 枚举**：`items.ts` 要 import 本文件来批量注册药水，
 * 如果这里反过来再 import `items.ts` 拿 `Item.POTION_*`，就会成环——
 * 表现是 `Cannot read properties of undefined (reading 'POTION_AWKWARD')`（本轮踩到过）。
 * `items.ts` 那边用 `POTION_IDS.xxx` 填 `Item` 枚举，两边因此始终一致。
 */
export const POTION_IDS = {
  awkward: 1180,
  swiftness: 1181,
  strength: 1182,
  healing: 1183,
  regeneration: 1184,
  fire_resistance: 1185,
  night_vision: 1186,
  poison: 1187,
  slowness: 1188,
  weakness: 1189,
} as const;

/** 粗制药水：一切药水的起点（水瓶 + 下界疣） */
export const AWKWARD: PotionEntry = {
  id: POTION_IDS.awkward,
  key: 'awkward',
  name: '粗制药水',
  effects: [],
  base: true,
};

/** 所有可喝的药水（含粗制）。时长/倍率对齐原版的"普通档" */
export const POTIONS: readonly PotionEntry[] = [
  AWKWARD,
  { id: POTION_IDS.swiftness, key: 'swiftness', name: '迅捷药水', effects: [{ id: 'speed', seconds: 180, amplifier: 0 }] },
  { id: POTION_IDS.strength, key: 'strength', name: '力量药水', effects: [{ id: 'strength', seconds: 180, amplifier: 0 }] },
  { id: POTION_IDS.healing, key: 'healing', name: '治疗药水', effects: [{ id: 'instant_health', seconds: 1, amplifier: 0 }] },
  { id: POTION_IDS.regeneration, key: 'regeneration', name: '生命恢复药水', effects: [{ id: 'regeneration', seconds: 45, amplifier: 0 }] },
  { id: POTION_IDS.fire_resistance, key: 'fire_resistance', name: '抗火药水', effects: [{ id: 'fire_resistance', seconds: 180, amplifier: 0 }] },
  { id: POTION_IDS.night_vision, key: 'night_vision', name: '夜视药水', effects: [{ id: 'night_vision', seconds: 180, amplifier: 0 }] },
  { id: POTION_IDS.poison, key: 'poison', name: '剧毒药水', effects: [{ id: 'poison', seconds: 45, amplifier: 0 }] },
  { id: POTION_IDS.slowness, key: 'slowness', name: '缓慢药水', effects: [{ id: 'slowness', seconds: 90, amplifier: 0 }] },
  { id: POTION_IDS.weakness, key: 'weakness', name: '虚弱药水', effects: [{ id: 'weakness', seconds: 90, amplifier: 0 }] },
];

/** 给物品注册表用的最小信息（id + key 就够拼注册名与贴图名） */
export const POTION_ITEMS: readonly { id: number; key: string }[] = POTIONS.map((potion) => ({
  id: potion.id,
  key: potion.key,
}));

const BY_ID = new Map<number, PotionEntry>(POTIONS.map((potion) => [potion.id, potion]));

export function potionById(itemId: number): PotionEntry | undefined {
  return BY_ID.get(itemId);
}

/** 这瓶是不是药水 */
export function isPotion(itemId: number): boolean {
  return BY_ID.has(itemId);
}
