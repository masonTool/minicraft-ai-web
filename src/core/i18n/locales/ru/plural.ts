/**
 * 俄语的复数形式（多语言 P4-2）。
 *
 * 俄语有 **4 个 CLDR 类别**（one / few / many / other），判断规则与数值有关：
 *   1, 21, 31 → one（блок）
 *   2~4, 22~24 → few（блока）
 *   0, 5~20, 25~30 → many（блоков）
 *   1.5 → other（这里用不到）
 *
 * ⚠️ **只登记"数量会变格、不登记就读错"的键**；其余键仍走 `locales/ru/*.ts` 的那一条
 * （`tn()` 没找到复数表时回落到 `t(key)`）。判据：`{count}` 后面直接跟名词的才登记 ——
 * `{count} мин` 这种缩写不登记（缩写不随数变格）。
 *
 * ⚠️ 每个类别里的 `{count}` 占位符要保留 —— 由 `tn()` 统一替换。
 */
import type { PluralTable } from '../../plural.ts';

export const plural = {
  // 移动距离：1 блок / 2 блока / 5 блоков
  'statistics.blocks': { one: '{count} блок', few: '{count} блока', many: '{count} блоков' },
  // 还能酿几次：1 раз / 2 раза / 5 раз（many 与 one 同形，这是俄语的特点）
  'station.brewLeft': { one: 'Можно сварить ещё {count} раз', few: 'Можно сварить ещё {count} раза', many: 'Можно сварить ещё {count} раз' },
} satisfies PluralTable;
