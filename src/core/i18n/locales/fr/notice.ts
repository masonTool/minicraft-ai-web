/**
 * FR 文案·提示（与 `locales/zh/notice.ts` **键集必须相同**）
 *
 * `satisfies Pick<Messages, keyof typeof zhNotice>` 把键集卡在 `typecheck`。
 */

import type { Messages } from '../zh/index.ts';
import type { notice as zhNotice } from '../zh/notice.ts';

export const notice = {
  "notice.damage.cause.poison": "Poison (dégâts continus)",
  "notice.damage.cause.wither": "Décomposition (dégâts continus, mortels)",
  "notice.damage.cause.freeze": "Gel (trop longtemps dans la neige poudreuse)",
  "notice.damage.cause.fall": "Chute (tombé de haut)",
  "notice.damage.cause.drown": "Noyade (plus d’air)",
  "notice.damage.cause.lava": "Lave (sors vite — l’eau ne l’éteint pas)",
  "notice.damage.cause.fire": "En feu (dans le feu/le magma, ou enflammé)",
  "notice.damage.cause.cactus": "Cactus (un bloc épineux)",
  "notice.damage.cause.sweetBerry": "Buisson à baies sucrées (piqué par les épines)",
  "notice.damage.cause.suffocate": "Suffocation (tête coincée dans un bloc)",
  "notice.damage.cause.starve": "Famine (faim épuisée)",
  "notice.damage.cause.void": "Vide (tombé hors du monde)",
  "notice.damage.cause.explosion": "Explosion (TNT / Creeper / lit)",
  "notice.damage.cause.projectile": "Touché par un projectile",
  "notice.damage.cause.lightning": "Frappé par la foudre",
  "notice.damage.cause.generic": "Dégâts subis (source non enregistrée)",
  "notice.damage.from": "De la part de {source}",
  "notice.damage.shotBy": "Touché par les tirs de {source}",
  "notice.damage.explosionOf": "Explosion causée par {source}",
  "notice.damage.fireOf": "Dégâts de feu de {source}",
  "notice.damage.poisonOf": "Empoisonnement par {source}",
  "notice.damage.witherOf": "Décomposition par {source}",
  "notice.damage.withSource": "{cause} (source : {source})",
} satisfies Pick<Messages, keyof typeof zhNotice>;
