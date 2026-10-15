/**
 * 药水表（H10）
 *
 * ⚠️ **为什么用 id 枚举而不是给 `ItemStack` 加一个 potion 字段**：
 * `ItemStack` 目前只有 `id/count/damage/enchants`，没有 NBT。给药水加字段看着自然，
 * 但会连带改**存档、提示框、配方匹配、合成书**四处——而药水种类是有限枚举
 * （原版也就 30 来种），用 id 枚举与现有架构
 * （id → 静态贴图/静态中文名）完全一致，改动面最小。
 *
 * ⚠️ **为什么是"变体表 × 档位"而不是 24 条平铺**：
 * 一种效果的普通 / 延长（红石粉）/ 强化（荧石粉）三档，
 * **效果相同、只有时长与倍率不同**；平铺写成 24 条的话，
 * 改一处数值就要在物品注册、酿造配方、贴图配色三处各改一遍。
 * 这里先写 9 条效果变体（`POTION_VARIANTS`），再展开成 24 条物品条目。
 *
 * ⚠️ **本文件不能 import `items.ts`**：`items.ts` 要 import 本文件批量注册药水，
 * 反过来再 import 就成环（表现是 `Cannot read properties of undefined (reading 'POTION_AWKWARD')`，
 * 这一轮真踩到过）。所以**酿造的"用哪种材料"写在 `crafting/Brewing.ts`**——
 * 那边本来就要 import `items.ts` 拿材料 id。
 */

import { romanLevel, type EffectId } from '../survival/StatusEffects.ts';

/** 一条挂上去的效果 */
export interface PotionEffectEntry {
  readonly id: EffectId;
  readonly seconds: number;
  readonly amplifier: number;
}

/** 档位：普通 / 延长（红石粉）/ 强化（荧石粉） */
export type PotionTier = 'base' | 'long' | 'strong';

export interface PotionEntry {
  readonly id: number;
  /** 稳定 key（拼注册名与贴图名） */
  readonly key: string;
  readonly name: string;
  /** 喝下后挂上的效果；空数组表示这瓶什么都不做（粗制药水就是"半成品"） */
  readonly effects: readonly PotionEffectEntry[];
  /** 半成品：只能当酿造原料，喝了没效果 */
  readonly base?: boolean;
  /** 这条属于哪个效果变体（粗制自己是一组）；贴图配色按它分组 */
  readonly variant: string;
  readonly tier: PotionTier;
}

/**
 * 一种效果的三个档位。
 *
 * 数值全部对照原版（Java 1.18 酿造表）：
 *   3:00 / 8:00 / II 1:30 —— 迅捷、力量
 *   0:45 / 1:30 / II 0:22 —— 生命恢复（中毒是 0:21）
 *   1:30 / 4:00 / IV 0:20 —— 缓慢（**强化档是 IV 级**，原版就它特殊）
 *   抗火、夜视只有延长档（原版没有 II 级）；治疗只有强化档（瞬时效果不能延长）
 *   虚弱只有延长档（原版没有虚弱 II 的药水）
 */
export interface PotionVariant {
  readonly key: string;
  readonly name: string;
  readonly effect: EffectId;
  /** 普通档时长（秒）。瞬间效果写 1：原版是"瞬时"，秒数没有意义但要有值 */
  readonly seconds: number;
  /** 红石粉延长后的时长；不写 = 原版也不能延长（瞬间效果） */
  readonly extended?: number;
  /** 荧石粉强化后的倍率与时长；不写 = 原版也没有强化档（抗火 / 夜视 / 虚弱） */
  readonly strong?: { readonly amplifier: number; readonly seconds: number };
  readonly baseId: number;
  readonly longId?: number;
  readonly strongId?: number;
}

/**
 * 药水的物品 id。
 *
 * ⚠️ **基础档那 10 个 id 是 H10 第一轮定的，不能动**：玩家的存档里存的就是这些数字。
 * 新增的延长 / 强化档从 1200 起，与酿造材料（1190~1199）错开。
 *
 * ⚠️ 定义在这里而不是 `Item` 枚举：见文件头的成环说明。
 * `items.ts` 那边用 `POTION_IDS.xxx` 填 `Item` 枚举，两边因此始终一致。
 */
export const POTION_IDS = {
  // ---- 基础档（第一轮就有的 10 条，id 保持不变）
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
  // ---- 延长档（红石粉）
  swiftness_long: 1200,
  strength_long: 1201,
  regeneration_long: 1202,
  fire_resistance_long: 1203,
  night_vision_long: 1204,
  poison_long: 1205,
  slowness_long: 1206,
  weakness_long: 1207,
  // ---- 强化档（荧石粉）
  swiftness_strong: 1210,
  strength_strong: 1211,
  healing_strong: 1212,
  regeneration_strong: 1213,
  poison_strong: 1214,
  slowness_strong: 1215,
} as const;

/** 粗制药水：一切药水的起点（水瓶 + 下界疣） */
export const AWKWARD: PotionEntry = {
  id: POTION_IDS.awkward,
  key: 'awkward',
  name: '粗制药水',
  effects: [],
  base: true,
  variant: 'awkward',
  tier: 'base',
};

export const POTION_VARIANTS: readonly PotionVariant[] = [
  {
    key: 'swiftness',
    name: '迅捷药水',
    effect: 'speed',
    seconds: 180,
    extended: 480,
    strong: { amplifier: 1, seconds: 90 },
    baseId: POTION_IDS.swiftness,
    longId: POTION_IDS.swiftness_long,
    strongId: POTION_IDS.swiftness_strong,
  },
  {
    key: 'strength',
    name: '力量药水',
    effect: 'strength',
    seconds: 180,
    extended: 480,
    strong: { amplifier: 1, seconds: 90 },
    baseId: POTION_IDS.strength,
    longId: POTION_IDS.strength_long,
    strongId: POTION_IDS.strength_strong,
  },
  {
    key: 'healing',
    name: '治疗药水',
    effect: 'instant_health',
    seconds: 1,
    // 瞬间效果不能被红石粉延长（原版如此），只有强化档
    strong: { amplifier: 1, seconds: 1 },
    baseId: POTION_IDS.healing,
    strongId: POTION_IDS.healing_strong,
  },
  {
    key: 'regeneration',
    name: '生命恢复药水',
    effect: 'regeneration',
    seconds: 45,
    extended: 90,
    strong: { amplifier: 1, seconds: 22 },
    baseId: POTION_IDS.regeneration,
    longId: POTION_IDS.regeneration_long,
    strongId: POTION_IDS.regeneration_strong,
  },
  {
    key: 'fire_resistance',
    name: '抗火药水',
    effect: 'fire_resistance',
    seconds: 180,
    extended: 480,
    // 原版没有抗火 II
    baseId: POTION_IDS.fire_resistance,
    longId: POTION_IDS.fire_resistance_long,
  },
  {
    key: 'night_vision',
    name: '夜视药水',
    effect: 'night_vision',
    seconds: 180,
    extended: 480,
    // 原版没有夜视 II
    baseId: POTION_IDS.night_vision,
    longId: POTION_IDS.night_vision_long,
  },
  {
    key: 'poison',
    name: '剧毒药水',
    effect: 'poison',
    seconds: 45,
    extended: 90,
    strong: { amplifier: 1, seconds: 21 },
    baseId: POTION_IDS.poison,
    longId: POTION_IDS.poison_long,
    strongId: POTION_IDS.poison_strong,
  },
  {
    key: 'slowness',
    name: '缓慢药水',
    effect: 'slowness',
    seconds: 90,
    extended: 240,
    // 缓慢的强化档是 **IV 级**（原版唯一一个跳级的：荧石粉给的是缓慢 IV）
    strong: { amplifier: 3, seconds: 20 },
    baseId: POTION_IDS.slowness,
    longId: POTION_IDS.slowness_long,
    strongId: POTION_IDS.slowness_strong,
  },
  {
    key: 'weakness',
    name: '虚弱药水',
    effect: 'weakness',
    seconds: 90,
    extended: 240,
    // 原版没有虚弱 II 的药水
    baseId: POTION_IDS.weakness,
    longId: POTION_IDS.weakness_long,
  },
];

/** 按 key 拿变体（酿造链与断言都按 key 找） */
export function variantByKey(key: string): PotionVariant | undefined {
  return POTION_VARIANTS.find((variant) => variant.key === key);
}

/** 变体的基础档 id（腐化链要拿它当产物） */
export function variantBaseId(key: string): number | undefined {
  return variantByKey(key)?.baseId;
}

/** 档位的 key 后缀（普通档没有后缀，贴图名与旧版完全一致） */
function tierKey(key: string, tier: PotionTier): string {
  return tier === 'base' ? key : `${key}_${tier}`;
}

/**
 * 档位的显示名：
 *   普通 → `迅捷药水`；延长 → `迅捷药水（延长）`；强化 → `迅捷药水 II`（缓慢是 IV）
 * 名字里带级别，是因为玩家在背包里只能看到图标与名字——不带级别就没法区分两瓶同效果的药水。
 *
 * ⚠️ `StatusEffects.romanLevel` 吃的是 **amplifier**（0 → I、3 → IV），不要 +1：
 * 另一处 `enchantments.romanLevel` 是 1 起始的，两者同名但口径不同。
 */
function tierName(variant: PotionVariant, tier: PotionTier): string {
  if (tier === 'long') return `${variant.name}（延长）`;
  if (tier === 'strong') return `${variant.name} ${romanLevel(variant.strong!.amplifier)}`;
  return variant.name;
}

function entry(variant: PotionVariant, tier: PotionTier, id: number, seconds: number, amplifier: number): PotionEntry {
  return {
    id,
    key: tierKey(variant.key, tier),
    name: tierName(variant, tier),
    effects: [{ id: variant.effect, seconds, amplifier }],
    variant: variant.key,
    tier,
  };
}

/** 所有可喝的药水（含粗制）：9 种效果 × 各自有的档位 + 粗制，共 24 条 */
export const POTIONS: readonly PotionEntry[] = [
  AWKWARD,
  ...POTION_VARIANTS.flatMap((variant): PotionEntry[] => {
    const rows: PotionEntry[] = [entry(variant, 'base', variant.baseId, variant.seconds, 0)];
    if (variant.longId !== undefined) rows.push(entry(variant, 'long', variant.longId, variant.extended!, 0));
    if (variant.strongId !== undefined) {
      rows.push(entry(variant, 'strong', variant.strongId, variant.strong!.seconds, variant.strong!.amplifier));
    }
    return rows;
  }),
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

/** 这瓶能不能喝（粗制药水是半成品，喝了没效果） */
export function isDrinkable(potion: PotionEntry | undefined): potion is PotionEntry {
  return potion !== undefined && potion.base !== true;
}
