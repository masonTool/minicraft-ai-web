/**
 * 德语的复数形式（多语言 P4-1，补于 P4-2 发现）。
 *
 * 德语只有 **one / other** 两类（`Intl.PluralRules('de')`）：1 → one，其余 → other。
 * ⚠️ 这张表是**后补的**：P4-1 收口时漏了它，于是 `tn('statistics.blocks', 1)`
 * 回落到 `t(key)` 印出「1 Blöcke」（应为「1 Block」）。俄语那批开始写复数表时才发现。
 *
 * ⚠️ 只登记"数量会变格、不登记就读错"的键；其余键仍走 `locales/de/*.ts` 的那一条。
 */
import type { PluralTable } from '../../plural.ts';

export const plural = {
  // 移动距离：1 Block / 2 Blöcke
  'statistics.blocks': { one: '{count} Block', other: '{count} Blöcke' },
  // 「Mal」不随数变化，只需 other 与 one 同形 —— 登记它是为了不让 t() 那条被绕过时漏掉
  'station.brewLeft': { one: 'Noch {count} Mal braubar', other: 'Noch {count} Mal braubar' },
} satisfies PluralTable;
