/**
 * 法语文案·progress（与 `locales/zh/progress.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-3：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`。
 * ⚠️ 值里的撇号统一写成排版撇号 `’`（`l’eau`），避免转义且符合法语排版。
 */

import type { Messages } from '../zh/index.ts';
import type { progress as zhProgress } from '../zh/progress.ts';

export const progress = {
  "statistics.title": "Statistiques du monde",
  "statistics.playTime": "Temps de jeu",
  "statistics.blocksMined": "Blocs minés",
  "statistics.blocksPlaced": "Blocs posés",
  "statistics.mobsKilled": "Créatures tuées",
  "statistics.deaths": "Morts",
  "statistics.distance": "Distance parcourue",
  "advancement.title": "Succès",
  "advancement.empty": "Aucune entrée dans cette branche",
  "map.close": "Fermer",
  "map.title": "Carte",
  "map.locked": " · verrouillée",
  "advancement.close": "Fermer",
  "advancement.closeLabel": "Fermer les succès",
  "advancement.filterAll": "Tous",
  "advancement.lockedHint": "Terminez les entrées précédentes pour la voir",
  "advancement.earned": "Obtenu",
  "advancement.summary": "{earned} / {total} obtenus",
  "advancement.challengeDone": "Défi terminé",
  "advancement.locked": "Verrouillé",
  "advancement.challenge": "Défi",
  "advancement.available": "Disponible",
  "advancement.toastDone": "Progrès obtenu !",
  "advancement.toastChallenge": "Défi terminé !",
  "statistics.closeAria": "Fermer les statistiques",
  "statistics.blocks": "{count} blocs",
} satisfies Pick<Messages, keyof typeof zhProgress>;
