/**
 * 俄语文案·say（与 `locales/zh/say.ts` **键集必须相同**）
 *
 * ⚠️ `satisfies Pick<Messages, keyof typeof zhSay>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { say as zhSay } from '../zh/say.ts';

export const say = {
  'say.damage.taken': '{amount} урона: {reasons} · Здоровье {health}/20',
  'say.damage.reason': '{cause} ({amount})',
  'say.damage.sep': '; ',
  'say.health.gain': 'Здоровье +{amount} (естественная регенерация или лечение) · Сейчас {health}/20',
  'say.food.loss': 'Голод -{amount} (бег / прыжки / бой / копание) · Осталось {food}/20{hint}',
  'say.food.lowHint': ' · Скорее поешь, иначе начнёшь терять здоровье',
  'say.food.gain': 'Голод +{amount} (еда / насыщение) · Сейчас {food}/20',
  'say.health.low': 'Мало здоровья ({health}/20): отойди от опасности, еда восстанавливает здоровье',
  'say.food.starving': 'Голод исчерпан: здоровье постоянно падает и не восстанавливается; срочно поешь',
  'say.air.low': 'Мало воздуха (под водой, осталось {air}): всплыви, чтобы вдохнуть',
  'say.air.empty': 'Воздух кончился: ты тонешь, немедленно всплывай',
  'say.air.back': 'Ты снова на поверхности: воздух восстанавливается',
  'say.burning': 'Ты горишь (в огне / лаве или подожжён): урон каждую секунду, прыгай в воду',
  'say.shield.axeBreak': 'Щит пробит топором ({seconds} с)',
  'say.shield.broken': 'Твой щит сломался',
  'say.totem.saved': 'Тотем бессмертия спас тебе жизнь',
  'say.hardcore.dead': 'Хардкор: ты погиб и можешь только наблюдать как призрак',
  'say.respawn.anchorEmpty': 'Якорь возрождения разряжен; возрождение у спавна мира',
  'say.respawn.bedGone': 'Твоя кровать исчезла; возрождение у спавна мира',
} satisfies Pick<Messages, keyof typeof zhSay>;
