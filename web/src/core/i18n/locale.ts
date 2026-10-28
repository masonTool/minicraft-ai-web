/**
 * 界面语言的元数据与匹配（多语言 P0-1，批次 20261023-0000）
 *
 * 为什么单独一个文件、而不是继续塞进 `I18n.ts`：
 * 这里只有"数据 + 纯函数"，谁 import 它都不背包袱；而 `I18n.ts` 要 import 六张文案表，
 * 被设置页、启动流程、离线断言同时引用。分层之后**加一种语言 = 在 `LOCALES` 加一行**，
 * 逻辑一行不用动。
 *
 * 三条约定（都有断言守着）：
 *
 *  1. **code 用短码**（`zh` / `pt`），不用 `zh-CN` / `pt-BR`：
 *     存档里存的就是它，而地区差异（简体/繁体、巴西/欧洲）目前不产生不同的文案。
 *     带地区的值放在 `htmlLang` / `intlLocale` 里——`<html lang>` 与 `Intl.*` 都要求它。
 *     ⚠️ 好处是**老存档不用迁移**：设置里存的 `zh` / `en` 与这里一一对应。
 *  2. **匹配只做前缀**：`de-AT` → `de`、`pt-PT` → `pt`、`zh-Hant` → `zh`。
 *     不做语言协商（不收 `Accept-Language` 那一套）：玩家的选择永远优先于设备猜测。
 *  3. **匹配不到返回 `null`，不在这里兜底**：兜底交给 `detectLocale()`，
 *     这样"匹配对不对"和"兜底选谁"是两件可以分开验的事。
 *     ⚠️ 兜底是**英文**而不是中文（发 Play 的口径：陌生语言用户看到英文比看到中文有用）。
 */

/**
 * 支持的语言。**顺序就是设置页下拉里的顺序**：
 * 源语言（中文）与发行主语言（英文）在前，其余按使用人口排。
 */
export const LOCALES = [
  { code: 'zh', nativeName: '简体中文', htmlLang: 'zh-CN', intlLocale: 'zh-CN' },
  { code: 'en', nativeName: 'English', htmlLang: 'en', intlLocale: 'en' },
  { code: 'ru', nativeName: 'Русский', htmlLang: 'ru', intlLocale: 'ru' },
  { code: 'pt', nativeName: 'Português (Brasil)', htmlLang: 'pt-BR', intlLocale: 'pt-BR' },
  { code: 'fr', nativeName: 'Français', htmlLang: 'fr', intlLocale: 'fr' },
  { code: 'de', nativeName: 'Deutsch', htmlLang: 'de', intlLocale: 'de' },
] as const;

export type Locale = (typeof LOCALES)[number];
export type LocaleCode = Locale['code'];

/** 兜底语言：匹配不到、或某种语言缺一条文案时用它 */
export const FALLBACK_LOCALE: LocaleCode = 'en';

const CODES: readonly string[] = LOCALES.map((locale) => locale.code);

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && CODES.includes(value);
}

/** 取一种语言的元数据；没登记返回 `null`（不抛异常——调用方要对"没登记"有明确处理） */
export function localeMeta(code: string): Locale | null {
  return LOCALES.find((locale) => locale.code === code) ?? null;
}

/**
 * 把浏览器 / Android 给的标签匹配到我们支持的语言。
 *
 * 认两种分隔符：`de-AT`（BCP 47）与 `zh_CN`（Android / 部分浏览器给下划线）。
 * 大小写不敏感——`ZH-cn` 也算中文。
 *
 * @returns 匹配到就返回短码，没登记就返回 `null`
 */
export function matchLocale(tag: string | undefined | null): LocaleCode | null {
  if (typeof tag !== 'string') return null;
  const lower = tag.trim().toLowerCase();
  if (lower.length === 0) return null;
  const base = lower.split(/[-_]/)[0] ?? '';
  return isLocaleCode(base) ? base : null;
}

/**
 * 从设备语言推断界面语言（首次启动用）。
 *
 * ⚠️ 与旧 `I18n.detectLanguage()` 的区别：那个只会认出 `zh` / `en` 两种，其余一律回中文；
 * 这里认全 6 种，认不出来回**英文**。旧函数在 P0-4 一并改走这里，不再各留一套。
 */
export function detectLocale(tag: string | undefined | null): LocaleCode {
  return matchLocale(tag) ?? FALLBACK_LOCALE;
}
