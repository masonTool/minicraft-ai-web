/**
 * 俄语文案·progress（与 `locales/zh/progress.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-2：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { progress as zhProgress } from '../zh/progress.ts';

export const progress = {
  "statistics.title": "Статистика мира",
  "statistics.playTime": "Время в игре",
  "statistics.blocksMined": "Добыто блоков",
  "statistics.blocksPlaced": "Поставлено блоков",
  "statistics.mobsKilled": "Убито существ",
  "statistics.deaths": "Смертей",
  "statistics.distance": "Пройдено",
  "advancement.title": "Достижения",
  "advancement.empty": "В этой ветке пока нет записей",
  "map.close": "Закрыть",
  "map.title": "Карта",
  "map.locked": " · заблокирована",
  "advancement.close": "Закрыть",
  "advancement.closeLabel": "Закрыть достижения",
  "advancement.filterAll": "Все",
  "advancement.lockedHint": "Появится после предыдущей записи",
  "advancement.earned": "Получено",
  "advancement.summary": "Получено {earned} / {total}",
  "advancement.challengeDone": "Испытание пройдено",
  "advancement.locked": "Не открыто",
  "advancement.challenge": "Испытание",
  "advancement.available": "Доступно",
  "advancement.toastDone": "Достижение получено!",
  "advancement.toastChallenge": "Испытание пройдено!",
  "statistics.closeAria": "Закрыть статистику",
  "statistics.blocks": "{count} блоков",
} satisfies Pick<Messages, keyof typeof zhProgress>;
