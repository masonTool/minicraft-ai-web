/**
 * 弓的蓄力与射击数值（J9）
 *
 * 抽成纯函数是为了能离线断言："拉满是多少伤害""力量 III 加了多少"这类数
 * 写在 `main` 的右键分支里就完全测不到。
 *
 * 与原版对齐：
 *  - 拉满需要 1 秒；**拉不到 15% 就射不出去**（原版低于这个阈值右键松手等于没拉）
 *  - 满蓄力的箭速约 60 格/秒（原版 3 格/tick），伤害按蓄力线性给到 6 点
 *  - **力量**：每级 +25% 且额外再 +25%（原版 `×(1 + 0.25 × (等级+1))`，
 *    所以力量 I 是 ×1.5 → 满蓄力 9 点、力量 V 是 ×2.5 → 15 点）
 *  - **冲击**：击退强度 = 1 + 等级（基础击退是 1）
 *  - **火矢**：点燃 5 秒
 *  - **无限**：不消耗箭，但身上**至少要有一支**（原版如此，否则空手也能射）
 */

/** 拉满需要的秒数（原版 1 秒） */
export const BOW_FULL_CHARGE = 1;
/** 低于这个蓄力射不出去（原版约 0.15） */
export const BOW_MIN_CHARGE = 0.15;
/** 满蓄力箭速（格/秒，原版 3 格/tick） */
export const ARROW_MAX_SPEED = 60;
/** 满蓄力基础伤害（原版 6 点） */
export const ARROW_MAX_DAMAGE = 6;
/** 火矢点燃秒数 */
export const FLAME_SECONDS = 5;
/** 基础击退强度 */
export const BASE_KNOCKBACK = 1;

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1 ? 1 : value;
}

/** 蓄力推进（会被夹在 0~1，所以不需要调用方自己夹） */
export function chargeAfter(current: number, dt: number, full = BOW_FULL_CHARGE): number {
  if (dt <= 0 || full <= 0) return clamp01(current);
  return clamp01(current + dt / full);
}

/** 这个蓄力能不能射 */
export function canFire(charge: number): boolean {
  return charge >= BOW_MIN_CHARGE;
}

/** 蓄力 → 箭速（格/秒） */
export function arrowSpeedAt(charge: number): number {
  return clamp01(charge) * ARROW_MAX_SPEED;
}

/**
 * 弩的装填时间（秒，批次 265）。
 *
 * 原版基础 1.25 秒，快速装填每级 -0.25 秒（III 级 0.5 秒）；这里再兜一个 0.25 秒下限，
 * 免得以后改数值时出现"0 秒装填"。
 */
export function crossbowChargeTime(quickChargeLevel: number): number {
  const level = Math.max(0, Math.min(3, Math.floor(quickChargeLevel)));
  return Math.max(0.25, 1.25 - level * 0.25);
}

/**
 * 一次装填射出几支（批次 265）。
 *
 * 多重射击一次三支（只消耗 1 支箭，与原版一致）；没箭时返回 0，调用方据此提示"没有箭了"。
 */
export function crossbowVolley(multishot: boolean, arrows: number): number {
  if (arrows <= 0) return 0;
  return multishot ? 3 : 1;
}

/** 蓄力 + 力量 → 伤害 */
export function arrowDamageAt(charge: number, powerLevel = 0): number {
  const base = clamp01(charge) * ARROW_MAX_DAMAGE;
  if (powerLevel <= 0) return base;
  return base * (1 + 0.25 * (powerLevel + 1));
}

export interface BowEnchantEffects {
  /** 力量等级 */
  power: number;
  /** 冲击等级 */
  punch: number;
  /** 火矢等级（只有 1 级，>0 即生效） */
  flame: number;
  /** 无限等级 */
  infinity: number;
}

/** 从弓的附魔表里取出这几条的效果 */
export function bowEffects(enchants?: Readonly<Record<string, number>>): BowEnchantEffects {
  const level = (id: string): number => {
    const value = enchants?.[id];
    return typeof value === 'number' && value > 0 ? Math.floor(value) : 0;
  };
  return { power: level('power'), punch: level('punch'), flame: level('flame'), infinity: level('infinity') };
}

/** 击退强度（基础 1 + 冲击等级） */
export function knockbackStrength(punchLevel: number): number {
  return BASE_KNOCKBACK + Math.max(0, punchLevel);
}

/**
 * 这一箭要消耗几支箭。
 * 有"无限"时返回 0（不消耗），但**身上一支都没有时仍然不能射**（见 `canShoot`）。
 */
export function arrowsConsumed(effects: BowEnchantEffects): number {
  return effects.infinity > 0 ? 0 : 1;
}

/**
 * 手上有没有弓、蓄力够不够、箭够不够，能不能射这一箭。
 *
 * 注意"箭够不够"这一条：有无限附魔时要**至少留 1 支**（原版行为，
 * 否则空手也能无限射）；没有无限时要有 1 支可消耗。
 * 写成 `arrowCount >= 1 + arrowsConsumed()` 是错的——那样普通弓会要求 2 支箭才肯射。
 */
export function canShoot(hasBow: boolean, charge: number, arrowCount: number, effects: BowEnchantEffects): boolean {
  if (!hasBow || !canFire(charge)) return false;
  return arrowCount >= Math.max(1, arrowsConsumed(effects));
}
