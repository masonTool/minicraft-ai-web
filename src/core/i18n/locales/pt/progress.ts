/**
 * 葡语文案·progress（与 `locales/zh/progress.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-4：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`。
 */

import type { Messages } from '../zh/index.ts';
import type { progress as zhProgress } from '../zh/progress.ts';

export const progress = {
  "statistics.title": "Estatísticas do mundo",
  "statistics.playTime": "Tempo de jogo",
  "statistics.blocksMined": "Blocos minerados",
  "statistics.blocksPlaced": "Blocos colocados",
  "statistics.mobsKilled": "Criaturas mortas",
  "statistics.deaths": "Mortes",
  "statistics.distance": "Distância percorrida",
  "advancement.title": "Conquistas",
  "advancement.empty": "Nenhuma entrada neste ramo",
  "map.close": "Fechar",
  "map.title": "Mapa",
  "map.locked": " · bloqueado",
  "advancement.close": "Fechar",
  "advancement.closeLabel": "Fechar conquistas",
  "advancement.filterAll": "Todas",
  "advancement.lockedHint": "Complete as entradas anteriores para ver esta",
  "advancement.earned": "Concluída",
  "advancement.summary": "{earned} / {total} concluídas",
  "advancement.challengeDone": "Desafio concluído",
  "advancement.locked": "Bloqueada",
  "advancement.challenge": "Desafio",
  "advancement.available": "Disponível",
  "advancement.toastDone": "Progresso concluído!",
  "advancement.toastChallenge": "Desafio concluído!",
  "statistics.closeAria": "Fechar estatísticas",
  "statistics.blocks": "{count} blocos",
} satisfies Pick<Messages, keyof typeof zhProgress>;
