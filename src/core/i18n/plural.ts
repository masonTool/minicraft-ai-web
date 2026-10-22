/**
 * 复数的**类型与判据**（多语言 P0-6）。
 *
 * 为什么单独一个零依赖文件：`locales/xx/plural.ts` 要用这里的类型，
 * 而 `locales/**` 有一条硬约定"不许 import 运行时代码"（否则和 `I18n.ts` 循环引用）。
 * 只放类型 + 一个纯函数，两边都能安全引用。
 *
 * 为什么不能"加个 s"：复数形式是**语言相关**的，而且不是二分的——
 *   · 英语/葡语：2 种（one / other）；
 *   · 法语：0 也算单数（`0 jour` 而不是 `0 jours`）；
 *   · 俄语：4 种（1 → one、2~4 → few、5~20 → many、11 → many 但 21 → one）；
 * 所以判定必须交给 `Intl.PluralRules`，不要手写 `count === 1 ? a : b`。
 */

/** CLDR 的六种复数类别（`Intl.PluralRules#select()` 的返回值） */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** 一条文案的各种复数形式；语言用不到的那些类别可以不写 */
export type PluralForms = Partial<Record<PluralCategory, string>>;

/** 某个语言里"哪些键有复数形式" */
export type PluralTable = Readonly<Record<string, PluralForms>>;

/**
 * 一个数字在某种语言里属于哪个复数类别。
 *
 * `intlLocale` 用带地区的值（`ru` / `pt-BR`）：不同地区可能给不同结果，
 * 而我们要的结果必须和 `Intl` 其余部分（日期、列表）保持一致。
 * 环境里没有 `Intl.PluralRules`（很老的 WebView）时一律回 `other`——
 * 退化成"只有一种形式"，比抛异常好。
 */
export function pluralCategoryFor(count: number, intlLocale: string): PluralCategory {
  if (typeof Intl === 'undefined' || typeof Intl.PluralRules !== 'function') return 'other';
  try {
    return new Intl.PluralRules(intlLocale).select(count) as PluralCategory;
  } catch {
    return 'other';
  }
}
