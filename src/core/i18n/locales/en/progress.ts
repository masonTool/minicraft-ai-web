/**
 * 英文文案·progress（与 `locales/zh/progress.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P0-3：这里的类型是 `satisfies Pick<Messages, keyof typeof zhXxx>`——
 * 中文那边加一条键、这边没跟上，`npm run typecheck` 直接报错，不必等测试跑起来。
 * 搬运规则：只搬不改，英文一个字都没动。
 */

import type { Messages } from '../zh/index.ts';
import type { progress as zhprogress } from '../zh/progress.ts';

export const progress = {
  'statistics.title': 'World Statistics',
  'statistics.playTime': 'Play Time',
  'statistics.blocksMined': 'Blocks Mined',
  'statistics.blocksPlaced': 'Blocks Placed',
  'statistics.mobsKilled': 'Mobs Killed',
  'statistics.deaths': 'Deaths',
  'statistics.distance': 'Distance Walked',
  'advancement.title': 'Advancements',
  'advancement.empty': 'Nothing in this branch yet',
  'map.close': 'Close',
  'map.title': 'Map',
  'map.locked': ' · locked',
  'advancement.close': 'Close',
  'advancement.closeLabel': 'Close advancements',
  'advancement.filterAll': 'All',
  'advancement.lockedHint': 'Complete the earlier entries to reveal it',
  'advancement.earned': 'Earned',
  'advancement.summary': 'Earned {earned} / {total}',
  'advancement.challengeDone': 'Challenge complete',
  'advancement.locked': 'Locked',
  'advancement.challenge': 'Challenge',
  'advancement.available': 'Available',
  'advancement.toastDone': 'Advancement made!',
  'advancement.toastChallenge': 'Challenge complete!',
} satisfies Pick<Messages, keyof typeof zhprogress>;
