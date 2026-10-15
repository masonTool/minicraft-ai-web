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
  /** 喝下/砸中后挂上的效果；空数组表示这瓶什么都不做（粗制药水就是"半成品"） */
  readonly effects: readonly PotionEffectEntry[];
  /** 半成品：只能当酿造原料，喝了没效果 */
  readonly base?: boolean;
  /** 这条属于哪个效果变体（粗制自己是一组）；贴图配色按它分组 */
  readonly variant: string;
  readonly tier: PotionTier;
  /**
   * 喷溅型（K4 尾巴）：**扔出去**而不是喝下去。
   * 效果表与饮用型完全一样，差别只在"怎么生效"（见 `survival/SplashPotion.ts`）与贴图形状。
   */
  readonly splash?: boolean;
  /**
   * 滞留型（K4 尾巴）：扔出去不炸开，而是**在原地留下一片药水云**，
   * 持续 30 秒、周期性给云里的实体挂效果（见 `survival/PotionCloud.ts`）。
   */
  readonly lingering?: boolean;
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
  // ---- 后来补的两个效果（K4 尾巴）：伤害与隐身，接着强化档往后排。
  // 分段只是给人看的，id 不撞车就行（`register()` 会对重复 id 直接抛错）
  harming: 1216,
  harming_strong: 1217,
  invisibility: 1218,
  invisibility_long: 1219,
} as const;

/**
 * 喷溅型的 id 偏移：**饮用型 id + 50**。
 *
 * 为什么用偏移而不是再列一张 24 条的 id 表：喷溅版与饮用版是**一一对应**的，
 * 再手写一张表就多了一处会漂的地方（加了新药水忘了加喷溅 id —— 而那种漏不会报错，
 * 只会让新药水的喷溅版"不存在"）。偏移一览：
 *
 *   粗制 1180 → 1230 · 普通档 1181~1189 → 1231~1239
 *   延长档 1200~1207 → 1250~1257 · 强化档 1210~1215 → 1260~1265
 *
 * 断言里有一条专门盯着"偏移后的 id 不和任何饮用型撞车"（`test:brewing`）。
 */
export const SPLASH_ID_OFFSET = 50;

/** 饮用型 id → 喷溅型 id */
export function splashIdOf(potionId: number): number {
  return potionId + SPLASH_ID_OFFSET;
}

/**
 * 滞留型的 id 偏移：**饮用型 id + 100**（K4 尾巴）。
 *
 * 与喷溅型的 +50 同一个套路：滞留版也是**一一对应**的（原版就是"喷溅药水 + 龙息"），
 * 再手写一张 28 条的 id 表就又多一处会漂的地方。偏移一览：
 *
 *   饮用 1180~1219 → 滞留 1280~1319（喷溅占着 1230~1269，互不重叠）
 */
export const LINGERING_ID_OFFSET = 100;

/** 饮用型 id → 滞留型 id */
export function lingeringIdOf(potionId: number): number {
  return potionId + LINGERING_ID_OFFSET;
}

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
  // ---- K4 尾巴补的两个效果：它们**没有"粗制 + 材料"的配方**，
  // 原版里只能靠腐化链得到（治疗 / 剧毒 → 伤害、夜视 → 隐身），
  // 所以 `Brewing.ts` 的 `VARIANT_INGREDIENTS` 里故意没有它们
  {
    key: 'harming',
    name: '伤害药水',
    effect: 'instant_damage',
    seconds: 1,
    // 瞬间效果不能延长（原版如此），但能强化成瞬间伤害 II
    strong: { amplifier: 1, seconds: 1 },
    baseId: POTION_IDS.harming,
    strongId: POTION_IDS.harming_strong,
  },
  {
    key: 'invisibility',
    name: '隐身药水',
    effect: 'invisibility',
    seconds: 180,
    extended: 480,
    // 原版没有隐身 II
    baseId: POTION_IDS.invisibility,
    longId: POTION_IDS.invisibility_long,
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

/** 所有**饮用型**药水（含粗制）：9 种效果 × 各自有的档位 + 粗制，共 24 条 */
export const DRINKABLE: readonly PotionEntry[] = [
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

/**
 * 一瓶饮用型的"改造版"：**效果一模一样**，只有 id / 名字 / 贴图 / 生效方式不同。
 * @param kind `splash` = 扔出去炸开（喷溅）；`lingering` = 扔出去留一片云（滞留）
 */
function twinEntry(potion: PotionEntry, kind: 'splash' | 'lingering'): PotionEntry {
  const shared = {
    effects: potion.effects,
    // 粗制的改造版同样是"半成品"（扔出去也没有效果），所以 `base` 一起继承
    base: potion.base,
    variant: potion.variant,
    tier: potion.tier,
  };
  return kind === 'splash'
    ? {
        ...shared,
        id: splashIdOf(potion.id),
        key: `splash_${potion.key}`,
        name: `喷溅${potion.name}`,
        splash: true,
      }
    : {
        ...shared,
        id: lingeringIdOf(potion.id),
        key: `lingering_${potion.key}`,
        name: `滞留${potion.name}`,
        lingering: true,
      };
}

/**
 * 全部药水物品：**饮用型 + 喷溅型 + 滞留型，每种一一对应，共 28 × 3 = 84 条**。
 *
 * 三份放在一起是有意的——酿造链（+ 火药 → 喷溅、+ 龙息 → 滞留）与贴图生成
 * 都按这张表遍历，分成三张表就会出现"新药水只加进了其中一张"的半残状态。
 */
export const POTIONS: readonly PotionEntry[] = [
  ...DRINKABLE,
  ...DRINKABLE.map((potion) => twinEntry(potion, 'splash')),
  ...DRINKABLE.map((potion) => twinEntry(potion, 'lingering')),
];

/** 喷溅型药水（扔出去炸开） */
export const SPLASH_POTIONS: readonly PotionEntry[] = POTIONS.filter((potion) => potion.splash === true);

/** 滞留型药水（扔出去留一片云） */
export const LINGERING_POTIONS: readonly PotionEntry[] = POTIONS.filter((potion) => potion.lingering === true);

/** 按 key 找一瓶药水（改造版的 key 是 `splash_<key>` / `lingering_<key>`） */
export function potionByKey(key: string): PotionEntry | undefined {
  return POTIONS.find((potion) => potion.key === key);
}

/** 拿一瓶药水的喷溅版 */
export function splashOf(potion: PotionEntry): PotionEntry | undefined {
  return potion.splash ? potion : potionByKey(`splash_${potion.key}`);
}

/** 拿一瓶药水的滞留版 */
export function lingeringOf(potion: PotionEntry): PotionEntry | undefined {
  return potion.lingering ? potion : potionByKey(`lingering_${potion.key}`);
}

/**
 * 各效果的**基础档**液体颜色（对照游戏里的大致观感）。
 *
 * 放在数据层而不是渲染层：**贴图（瓶子）、粒子（药水云）、说明**都要用同一个颜色，
 * 三处各写一份迟早会出现"云是绿的、瓶子是黄的"。
 */
export const POTION_BASE_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  awkward: [126, 88, 162],
  swiftness: [124, 196, 224],
  strength: [196, 84, 60],
  healing: [236, 92, 130],
  regeneration: [222, 128, 168],
  fire_resistance: [232, 152, 68],
  night_vision: [44, 66, 158],
  poison: [96, 172, 74],
  slowness: [112, 118, 146],
  weakness: [86, 92, 86],
  harming: [140, 40, 78],
  invisibility: [150, 160, 190],
};

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, value));
}

/**
 * 档位的配色：普通档原色、延长档偏暗偏红（掺了红石粉）、强化档更亮（掺了荧石粉）。
 * 玩家在快捷栏上一眼就能看出"这是同一瓶，但更强/更久"。
 */
function tierColor(base: readonly [number, number, number], tier: PotionTier): readonly [number, number, number] {
  const [r, g, b] = base;
  if (tier === 'long') return [clampChannel(r * 1.06), clampChannel(g * 0.72), clampChannel(b * 0.72)];
  if (tier === 'strong') return [clampChannel(r * 1.15 + 28), clampChannel(g * 1.15 + 18), clampChannel(b * 1.15 + 18)];
  return [r, g, b];
}

/** 这瓶药水该是什么颜色（贴图与粒子共用同一个来源） */
export function potionColor(potion: PotionEntry): readonly [number, number, number] {
  return tierColor(POTION_BASE_COLORS[potion.variant] ?? POTION_BASE_COLORS.awkward!, potion.tier);
}

/** 同一颜色的 `0xRRGGBB` 形式（粒子系统要的格式） */
export function potionTint(potion: PotionEntry): number {
  const [r, g, b] = potionColor(potion);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

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

/**
 * 这瓶能不能**喝**。
 * 三种不能喝：粗制药水（半成品，喝了没效果）、喷溅型与滞留型
 * （原版其实能喝喷溅，但只给 1/4 时长；本项目不做这个冷门行为，
 * 统一"改造版只能扔"，所以它们在手上点按会扔出去而不是喝掉）。
 */
export function isDrinkable(potion: PotionEntry | undefined): potion is PotionEntry {
  return potion !== undefined && potion.base !== true && potion.splash !== true && potion.lingering !== true;
}

/** 这瓶是不是投掷型（喷溅或滞留）——主程序按它决定"点按是扔还是喝" */
export function isThrowablePotion(potion: PotionEntry | undefined): potion is PotionEntry {
  return potion !== undefined && (potion.splash === true || potion.lingering === true);
}
