/**
 * 英文的复数形式（多语言 P0-6）。
 *
 * ⚠️ **只放"英文需要区分单复数"的那些键**，其余键仍用 `locales/en/*.ts` 里的那一条。
 * 没登记的键由 `tn()` 回落到 `t(key)` —— 所以这张表是**可选的精修**，不是又一套文案。
 *
 * 判据是"count 可能是 1 且英文会因此读错"：
 *   · `'{item} ×{count}'` 这类不用登记（×1 读得通）；
 *   · `'{count} more brews'` 必须登记（1 more brews ✗）。
 *
 * ⚠️ 每个类别里的 `{count}` 占位符要保留——由 `tn()` 统一替换。
 */
import type { PluralTable } from '../../plural.ts';

export const plural = {
  'station.brewLeft': { one: '{count} more brew', other: '{count} more brews' },
} satisfies PluralTable;
