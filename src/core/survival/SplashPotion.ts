/**
 * 喷溅药水的范围结算（K4 尾巴）
 *
 * 与原版对齐的三条：
 *  1. **半径 4 格**（原版 `inflate(4.0)` 是球/立方体范围，这里按**球**算距离）
 *  2. 时长按 **`1 - 距离 / 4`** 缩放 —— 直接命中的目标距离≈0，拿满时长；
 *     贴着半径边缘的目标几乎没效果；**瞬间效果（治疗/伤害）不缩放**（原版也就效果时长那一项缩）
 *  3. 距离 ≥ 半径的目标**完全不受影响**（不是"很短"，而是"没有"）
 *
 * 为什么单独一个文件：这段是纯函数（不碰 DOM、不碰实体列表），
 * "谁在范围内"由主程序去问实体管理器（与 `hitMob`/`findMate` 同一个套路），
 * 于是范围与缩放这两种最容易写错的逻辑都能离线断言。
 */

import type { EffectId } from './StatusEffects.ts';
import type { PotionEntry } from '../registry/potions.ts';

/** 喷溅半径（格，原版 4） */
export const SPLASH_RADIUS = 4;

/** 瞬间效果：没有"持续多久"可言，范围只决定打不打得到（原版同样不缩放） */
export function isInstantEffect(id: EffectId): boolean {
  return id === 'instant_health' || id === 'instant_damage';
}

/**
 * 距离衰减系数。
 * @returns 0（半径外/正好在半径上）~ 1（爆心）
 */
export function splashScale(distance: number, radius = SPLASH_RADIUS): number {
  if (distance <= 0) return 1;
  if (distance >= radius) return 0;
  return 1 - distance / radius;
}

export interface SplashEffect {
  readonly id: EffectId;
  readonly seconds: number;
  readonly amplifier: number;
}

/**
 * 一次喷溅对"距离爆心 distance 格"的实体施加什么。
 * @returns 空数组 = 够不着，什么都不挂
 */
export function splashEffectsAt(potion: PotionEntry, distance: number, radius = SPLASH_RADIUS): SplashEffect[] {
  const scale = splashScale(distance, radius);
  if (scale <= 0) return [];

  return potion.effects.map((effect) => ({
    id: effect.id,
    // 瞬间效果不缩；其余按距离缩（0.6 秒这种也是合法的，效果系统会换算成 12 tick）
    seconds: isInstantEffect(effect.id) ? effect.seconds : effect.seconds * scale,
    amplifier: effect.amplifier,
  }));
}

