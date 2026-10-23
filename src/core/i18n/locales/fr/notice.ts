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
  "notice.recipe.searchPlaceholder": "Rechercher un objet ou un matériau (français ou anglais)",
  "notice.recipe.close": "Fermer (R)",
  "notice.recipe.closeAria": "Fermer le livre de recettes",
  "notice.recipe.prev": "‹ Précédent",
  "notice.recipe.next": "Suivant ›",
  "notice.recipe.summary": "{total} recettes · {craftable} réalisables",
  "notice.recipe.emptyCraftable": "Rien à fabriquer pour l’instant (désactive « Réalisables seulement » pour tout voir)",
  "notice.recipe.emptyFiltered": "Aucune recette correspondante dans cet onglet",
  "notice.recipe.filterOn": "Réalisables seulement (activé)",
  "notice.recipe.filterOff": "Réalisables seulement",
  "notice.recipe.line": "{head} · {layout}",
  "notice.recipe.lineMissing": "{head} · {layout} · matériaux manquants",
  "notice.recipe.lineMissingNoList": "{head} · {layout} · matériaux manquants ({missing})",
  "notice.recipe.lineNeedTable": "{head} · {layout} · nécessite un établi 3×3",
  "notice.recipe.lineCraftable": "{head} · {layout} · {times} fabrications possibles",
  "notice.recipe.smeltingHint": "Cuisson : matériaux dans la case du haut, combustible en bas (environ {seconds} s par pièce)",
} satisfies Pick<Messages, keyof typeof zhNotice>;
