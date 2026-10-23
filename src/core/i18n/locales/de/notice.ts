/**
 * DE 文案·提示（与 `locales/zh/notice.ts` **键集必须相同**）
 *
 * `satisfies Pick<Messages, keyof typeof zhNotice>` 把键集卡在 `typecheck`。
 */

import type { Messages } from '../zh/index.ts';
import type { notice as zhNotice } from '../zh/notice.ts';

export const notice = {
  "notice.damage.cause.poison": "Vergiftung (Schaden über Zeit)",
  "notice.damage.cause.wither": "Wither (Schaden über Zeit, tödlich)",
  "notice.damage.cause.freeze": "Erfrieren (zu lange in Pulverschnee)",
  "notice.damage.cause.fall": "Sturzschaden (aus der Höhe gefallen)",
  "notice.damage.cause.drown": "Ertrinken (Luft ausgegangen)",
  "notice.damage.cause.lava": "Lava (sofort raus — Wasser löscht sie nicht)",
  "notice.damage.cause.fire": "Brennt (in Feuer/Magmablock oder angezündet)",
  "notice.damage.cause.cactus": "Kaktus (ein stacheliger Block)",
  "notice.damage.cause.sweetBerry": "Süßbeerenstrauch (an Dornen geschnitten)",
  "notice.damage.cause.suffocate": "Ersticken (Kopf steckt im Block)",
  "notice.damage.cause.starve": "Verhungern (Hunger aufgebraucht)",
  "notice.damage.cause.void": "Leere (aus der Welt gefallen)",
  "notice.damage.cause.explosion": "Explosion (TNT / Creeper / Bett)",
  "notice.damage.cause.projectile": "Von einem Geschoss getroffen",
  "notice.damage.cause.lightning": "Vom Blitz getroffen",
  "notice.damage.cause.generic": "Schaden erlitten (keine Quelle erfasst)",
  "notice.damage.from": "Von {source}",
  "notice.damage.shotBy": "Von {source} beschossen",
  "notice.damage.explosionOf": "Explosion von {source}",
  "notice.damage.fireOf": "Feuerschaden von {source}",
  "notice.damage.poisonOf": "Vergiftung durch {source}",
  "notice.damage.witherOf": "Wither durch {source}",
  "notice.damage.withSource": "{cause} (Quelle: {source})",
  "notice.recipe.searchPlaceholder": "Gegenstände oder Materialien suchen (Deutsch oder Englisch)",
  "notice.recipe.close": "Schließen (R)",
  "notice.recipe.closeAria": "Rezeptbuch schließen",
  "notice.recipe.prev": "‹ Zurück",
  "notice.recipe.next": "Weiter ›",
  "notice.recipe.summary": "{total} Rezepte · {craftable} jetzt herstellbar",
  "notice.recipe.emptyCraftable": "Nichts herstellbar (schalte „Nur herstellbar“ aus, um alles zu sehen)",
  "notice.recipe.emptyFiltered": "In dieser Registerkarte gibt es keine passenden Rezepte",
  "notice.recipe.filterOn": "Nur herstellbar (an)",
  "notice.recipe.filterOff": "Nur herstellbar",
  "notice.recipe.line": "{head} · {layout}",
  "notice.recipe.lineMissing": "{head} · {layout} · Material fehlt",
  "notice.recipe.lineMissingNoList": "{head} · {layout} · Material fehlt ({missing})",
  "notice.recipe.lineNeedTable": "{head} · {layout} · braucht eine 3×3-Werkbank",
  "notice.recipe.lineCraftable": "{head} · {layout} · {times}× herstellbar",
  "notice.recipe.smeltingHint": "Schmelzen: Material in das obere Feld, Brennstoff nach unten (etwa {seconds} s pro Stück)",
} satisfies Pick<Messages, keyof typeof zhNotice>;
