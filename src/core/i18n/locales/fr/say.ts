/**
 * 法语文案·say（与 `locales/zh/say.ts` **键集必须相同**）
 *
 * ⚠️ `satisfies Pick<Messages, keyof typeof zhSay>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { say as zhSay } from '../zh/say.ts';

export const say = {
  'say.damage.taken': '{amount} dégâts subis : {reasons} · Santé {health}/20',
  'say.damage.reason': '{cause} ({amount})',
  'say.damage.sep': ' ; ',
  'say.health.gain': 'Santé +{amount} (régénération ou soin) · Actuel {health}/20',
  'say.food.loss': 'Faim -{amount} (course / saut / combat / minage) · Reste {food}/20{hint}',
  'say.food.lowHint': ' · Mange vite, sinon tu perdras des points de vie',
  'say.food.gain': 'Faim +{amount} (manger / saturation) · Actuel {food}/20',
  'say.health.low': 'Vie faible ({health}/20) : éloigne-toi du danger, manger rend des points de vie',
  'say.food.starving': 'Faim épuisée : tu perds des points de vie en continu et ne régénères plus ; mange vite',
  'say.air.low': 'Air faible (sous l’eau, {air} restant) : remonte pour respirer',
  'say.air.empty': 'Plus d’air : tu te noies, remonte immédiatement',
  'say.air.back': 'De retour à la surface : l’air se recharge',
  'say.burning': 'Tu brûles (dans le feu / la lave ou enflammé) : dégâts chaque seconde, saute dans l’eau',
  'say.shield.axeBreak': 'Bouclier brisé par une hache ({seconds} s)',
  'say.shield.broken': 'Ton bouclier est cassé',
  'say.totem.saved': 'Un Totem d’immortalité t’a sauvé la vie',
  'say.hardcore.dead': 'Hardcore : tu es mort, tu ne peux plus que regarder en spectateur',
  'say.respawn.anchorEmpty': 'L’ancre de réapparition est déchargée ; réapparition au point de départ du monde',
  'say.respawn.bedGone': 'Ton lit a disparu ; réapparition au point de départ du monde',
} satisfies Pick<Messages, keyof typeof zhSay>;
