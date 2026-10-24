/**
 * 英文文案·say（与 `locales/zh/say.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P0-3：`satisfies Pick<Messages, keyof typeof zhSay>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { say as zhSay } from '../zh/say.ts';

export const say = {
  'say.damage.taken': 'Took {amount} damage: {reasons} · Health {health}/20',
  'say.damage.reason': '{cause} ({amount})',
  'say.damage.sep': '; ',
  'say.health.gain': 'Health +{amount} (natural regeneration or healing) · Now {health}/20',
  'say.food.loss': 'Hunger -{amount} (walking / jumping / fighting / mining) · {food}/20 left{hint}',
  'say.food.lowHint': ' · Eat something soon, or you will start losing health',
  'say.food.gain': 'Hunger +{amount} (eating / saturation) · Now {food}/20',
  'say.health.low': 'Low health ({health}/20): get away from danger, eating restores health',
  'say.food.starving': 'Hunger depleted: you keep losing health and cannot regenerate; eat something now',
  'say.air.low': 'Low air (underwater, {air} left): surface to breathe',
  'say.air.empty': 'Out of air: you are drowning, surface now',
  'say.air.back': 'Back at the surface: your air is refilling',
  'say.burning': 'You are on fire (standing in fire/lava or ignited): losing health every second, jump into water',
  'say.shield.axeBreak': 'Shield disabled by an axe hit ({seconds}s)',
  'say.shield.broken': 'Your shield broke',
  'say.totem.saved': 'A Totem of Undying saved your life',
  'say.hardcore.dead': 'Hardcore: you died and can only keep watching as a spectator',
  'say.respawn.anchorEmpty': 'The respawn anchor is out of charge; you respawn at the world spawn',
  'say.respawn.bedGone': 'Your bed is gone; you respawn at the world spawn',
} satisfies Pick<Messages, keyof typeof zhSay>;
