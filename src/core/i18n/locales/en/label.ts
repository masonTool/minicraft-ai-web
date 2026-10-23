/**
 * 英文文案·标签表
 *
 * 与 `locales/zh/label.ts` 键集必须相同（`satisfies` 卡住）。
 */

import type { Messages } from '../zh/index.ts';
import type { label as zhLabel } from '../zh/label.ts';

export const label = {
  "label.effect.speed": "Speed",
  "label.effect.slowness": "Slowness",
  "label.effect.haste": "Haste",
  "label.effect.mining_fatigue": "Mining Fatigue",
  "label.effect.strength": "Strength",
  "label.effect.instant_health": "Instant Health",
  "label.effect.instant_damage": "Instant Damage",
  "label.effect.jump_boost": "Jump Boost",
  "label.effect.nausea": "Nausea",
  "label.effect.regeneration": "Regeneration",
  "label.effect.resistance": "Resistance",
  "label.effect.fire_resistance": "Fire Resistance",
  "label.effect.water_breathing": "Water Breathing",
  "label.effect.invisibility": "Invisibility",
  "label.effect.blindness": "Blindness",
  "label.effect.night_vision": "Night Vision",
  "label.effect.hunger": "Hunger",
  "label.effect.weakness": "Weakness",
  "label.effect.poison": "Poison",
  "label.effect.wither": "Wither",
  "label.effect.health_boost": "Health Boost",
  "label.effect.absorption": "Absorption",
  "label.effect.saturation": "Saturation",
  "label.effect.levitation": "Levitation",
  "label.effect.slow_falling": "Slow Falling",
  "label.effect.conduit_power": "Conduit Power",
  "label.effect.dolphins_grace": "Dolphin's Grace",
  "label.effect.bad_omen": "Bad Omen",
  "label.effect.hero_of_the_village": "Hero of the Village",
  "label.effect.darkness": "Darkness",
} satisfies Pick<Messages, keyof typeof zhLabel>;
