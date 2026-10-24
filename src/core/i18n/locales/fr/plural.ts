/**
 * 法语的复数形式（多语言 P4-3）。
 *
 * 法语只有 **one / other** 两类，但规则跟英语**不一样**：
 *   0 → one（0 bloc，不是 0 blocs）
 *   1 → one
 *   2 及以上 → other
 * 这一条是法语特有的坑：`{count} 格` 直译成 `{count} blocs` 会在 0 时印成「0 blocs」。
 *
 * ⚠️ 只登记"数量会变格、不登记就读错"的键；其余键仍走 `locales/fr/*.ts` 的那一条
 * （`tn()` 没找到复数表时回落到 `t(key)`）。
 */
import type { PluralTable } from '../../plural.ts';

export const plural = {
  // 移动距离：0 bloc / 1 bloc / 2 blocs
  'statistics.blocks': { one: '{count} bloc', other: '{count} blocs' },
  // 还能酿几次
  'station.brewLeft': { one: 'Encore {count} brassage possible', other: 'Encore {count} brassages possibles' },
} satisfies PluralTable;
