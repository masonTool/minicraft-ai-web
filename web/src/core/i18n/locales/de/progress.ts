/**
 * 德语文案·progress（与 `locales/zh/progress.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-1：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { progress as zhProgress } from '../zh/progress.ts';

export const progress = {
  "statistics.title": "Weltstatistiken",
  "statistics.playTime": "Spielzeit",
  "statistics.blocksMined": "Abgebaute Blöcke",
  "statistics.blocksPlaced": "Gesetzte Blöcke",
  "statistics.mobsKilled": "Getötete Kreaturen",
  "statistics.deaths": "Tode",
  "statistics.distance": "Zurückgelegte Strecke",
  "advancement.title": "Erfolge",
  "advancement.empty": "Dieser Zweig hat noch keine Einträge",
  "map.close": "Schließen",
  "map.title": "Karte",
  "map.locked": " · gesperrt",
  "advancement.close": "Schließen",
  "advancement.closeLabel": "Erfolge schließen",
  "advancement.filterAll": "Alle",
  "advancement.lockedHint": "Erst nach dem vorherigen Eintrag sichtbar",
  "advancement.earned": "Erreicht",
  "advancement.summary": "{earned} / {total} erreicht",
  "advancement.challengeDone": "Herausforderung geschafft",
  "advancement.locked": "Nicht freigeschaltet",
  "advancement.challenge": "Herausforderung",
  "advancement.available": "Erreichbar",
  "advancement.toastDone": "Fortschritt erreicht!",
  "advancement.toastChallenge": "Herausforderung geschafft!",
  "statistics.closeAria": "Statistiken schließen",
  "statistics.blocks": "{count} Blöcke",
} satisfies Pick<Messages, keyof typeof zhProgress>;
