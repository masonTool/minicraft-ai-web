/**
 * 葡语（巴西）的复数形式（多语言 P4-4）。
 *
 * `Intl.PluralRules('pt-BR')` 只有 **one / other**，但和英语不同：
 *   0 → one（0 bloco，不是 0 blocos）
 *   1 → one
 *   2 及以上 → other
 * 这一条是葡语与法语共有的坑：`{count} 格` 直译成 `{count} blocos` 会在 0 时印成「0 blocos」。
 *
 * ⚠️ 只登记"数量会变格、不登记就读错"的键；其余键仍走 `locales/pt/*.ts` 的那一条
 * （`tn()` 没找到复数表时回落到 `t(key)`）。
 */
import type { PluralTable } from '../../plural.ts';

export const plural = {
  // 移动距离：0 bloco / 1 bloco / 2 blocos
  'statistics.blocks': { one: '{count} bloco', other: '{count} blocos' },
  // 还能酿几次
  'station.brewLeft': { one: 'Ainda dá para preparar {count} vez', other: 'Ainda dá para preparar {count} vezes' },
} satisfies PluralTable;
