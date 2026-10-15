/**
 * 药水箭命中时挂什么效果（K4 最后一块）
 *
 * 原版规则只有一条：**药水箭给的效果时长是原药水的 1/8**
 * （3 分钟的迅捷 → 22.5 秒；1 分 30 秒的缓慢 II → 11.25 秒）。
 * 不做这个折算的话，一支箭就等于一整瓶药，那"药水箭"就会变成
 * "把药水装进箭里白嫖 8 倍时长"的漏洞。
 *
 * 与喷溅药水共用同一套效果结构（`SplashEffect`）：两者都是"把一瓶药水的效果
 * 换一种投送方式"，差别只在缩放比例与是否按距离衰减。
 */

import { potionById, type PotionEntry } from '../registry/potions.ts';
import { isInstantEffect, type SplashEffect } from './SplashPotion.ts';

/** 药水箭的时长折算（原版 1/8） */
export const TIPPED_ARROW_SCALE = 1 / 8;

/**
 * 这支药水箭命中生物时挂上的效果。
 *
 * - **瞬间效果不折算**（治疗/伤害没有"时长"可言，折算了还是立刻生效）
 * - 倍率（等级）原样保留：药水箭射的是"那瓶药水的效果"，不该自己降级
 */
export function tippedArrowEffects(potion: PotionEntry): SplashEffect[] {
  return potion.effects.map((effect) => ({
    id: effect.id,
    seconds: isInstantEffect(effect.id) ? effect.seconds : effect.seconds * TIPPED_ARROW_SCALE,
    amplifier: effect.amplifier,
  }));
}

/** 按药水 id 取"命中后挂什么"；药水不存在时返回空表 */
export function tippedArrowEffectsOf(potionId: number): SplashEffect[] {
  const potion = potionById(potionId);
  return potion ? tippedArrowEffects(potion) : [];
}
