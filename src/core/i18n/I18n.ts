/**
 * 界面语言（M8）—— 框架层。
 *
 * 为什么先做框架而不是"直接把中文换成英文"：这个仓库里用户可见的文案散在
 * 3 万行 UI 里（`SettingsScreen.ts` 一个文件就 2020 行），如果一边抽一边改行为，
 * 一次改动会同时动"文案"与"逻辑"两件互不相干的事，出问题时不知道是哪边坏的。
 * 所以这里只做三件事：**一张表、一个查表函数、一个当前语言**。
 *
 * 三条约定（都是踩过坑之后定的）：
 *  1. **键名点分、按界面分组**（`settings.group.game`），不写 `设置_游戏` 这种
 *     把中文当键的写法——那样改文案就会把键改掉，两处引用立刻失联。
 *  2. **查不到的键沿回落链找，最后一档是键名本身**：当前语言 → 英文 → 中文 → 键名。
 *     不返回空串、也不抛异常——界面上显示 `settings.group.game` 一眼就能看出漏了文案，
 *     而空串会变成"按钮是空的"，玩家只会以为是渲染坏了。
 *  3. **各语言键集必须与中文一致**。多语言 P0-3 起这件事由**类型**保证：
 *     `locales/en/*.ts` 用 `satisfies Pick<Messages, keyof typeof zhXxx>` 声明，
 *     中文加一条、英文没跟上就是 `npm run typecheck` 报错（错误会同时指到
 *     分组文件的具体行与 `index.ts` 的合并处）。`keyParity()` 退居第二道防线，
 *     留给"表是运行时拼出来的"那种情况（比如命令回执由数据文件合并进来）。
 */

import { COMMAND_MESSAGES_EN } from '../commands/commandMessages.data.ts';
// 中文文案本体（多语言 P0-2）：按界面分组，`index.ts` 是合并入口
import { zh } from './locales/zh/index.ts';
// 英文文案本体（多语言 P0-3）：与中文同构分组，键集由 `satisfies Messages` 卡齐
import { en } from './locales/en/index.ts';
// 英文的复数形式（多语言 P0-6）：只有需要区分单复数的键才出现在这里
import { plural } from './locales/en/plural.ts';
import { pluralCategoryFor, type PluralCategory, type PluralTable } from './plural.ts';
// 语言清单与匹配（多语言 P0-1 / P0-4）：6 种语言的元数据 + 设备标签匹配
import {
  FALLBACK_LOCALE,
  LOCALES,
  detectLocale,
  isLocaleCode,
  localeMeta,
  type LocaleCode,
} from './locale.ts';

/**
 * 语言码（`LocaleCode` 在本仓库的历史名字，多语言 P0-4）。
 *
 * ⚠️ 保留这个名字是因为它已经出现在几十处签名里（`t(key, language: Language)`）；
 * 现在它等于 `LocaleCode`——**6 种**而不是 2 种。新代码直接用 `LocaleCode`。
 */
export type Language = LocaleCode;

/** 当前语言的初值。首次启动会按设备语言覆盖（P0-5 把 `detectLanguage` 接到启动流程） */
export const DEFAULT_LANGUAGE: Language = 'zh';

/**
 * 中文表本体已搬到 `locales/zh/`（多语言 P0-2）；这里只留一个别名，
 * 让下面 `ZH_MERGED` / `t()` 那几处不必改写——这一步只搬不改。
 */
const ZH: Readonly<Record<string, string>> = zh;

/**
 * 英文表本体已搬到 `locales/en/`（多语言 P0-3）；这里只留一个别名，
 * 让下面 `EN_MERGED` 不必改写——这一步只搬不改。
 */
const EN: Readonly<Record<string, string>> = en;

/**
 * 命令运行时反馈的英文（批次 617）。
 *
 * 这批文案的**键就是中文原文**（见 `core/commands/messages.ts` 的说明），所以这里做两层：
 *   · `ZH` 侧原样并入 `COMMAND_MESSAGES_EN` 的键（值就是中文原文）；
 *   · `EN` 侧并入键 → 英文值。
 *
 * 放这里而不是手写进两张静态表：129 条一句话一条，手写会和中文原文**悄悄不一致**
 * ——改了一个字就再也对不上，而 `t()` 找不到键时原样返回，看起来"只是没翻译"。
 * 由同一个对象生成，两边天然对齐；`test:i18n` 另有一条断言查"每条中文都有英文"。
 */
const ZH_MERGED: Readonly<Record<string, string>> = {
  ...ZH,
  ...Object.fromEntries(Object.keys(COMMAND_MESSAGES_EN).map((zh) => [zh, zh])),
};
const EN_MERGED: Readonly<Record<string, string>> = { ...EN, ...COMMAND_MESSAGES_EN };

/**
 * 语言 → 文案表（**稀疏表**，多语言 P0-4）。
 *
 * 为什么允许缺项：加一种语言要先有表。表还没写的时候，这种语言**不该让应用崩或白屏**，
 * 也不该出现在设置页的可选项里（"能选但没内容"比不列更糟）。所以：
 *   · 这张表只放**已经有表**的语言；
 *   · UI 的下拉用 `LANGUAGES`（从这张表算出来）；
 *   · 设备语言检测与回落用 `LOCALES`（支持的**全集**）。
 */
export const TABLES: Readonly<Partial<Record<LocaleCode, Readonly<Record<string, string>>>>> = {
  zh: ZH_MERGED,
  en: EN_MERGED,
};

/** 没装表的语言查到的"空表"：让 `tableOf()` 永远返回一个可查对象，调用方不必判空 */
const EMPTY_TABLE: Readonly<Record<string, string>> = {};

/** 取一种语言的表；没装就返回空表（查出来全是 undefined，由 `t()` 走回落链） */
export function tableOf(language: LocaleCode): Readonly<Record<string, string>> {
  return TABLES[language] ?? EMPTY_TABLE;
}

/**
 * 每种语言的**复数表**（多语言 P0-6）：只放"count 可能是 1 且读起来别扭"的键。
 * 没登记的键仍走 `t()`，所以这不是第二套文案，是一层可选的精修。
 */
export const PLURAL_TABLES: Readonly<Partial<Record<LocaleCode, PluralTable>>> = { en: plural };
const EMPTY_PLURALS: PluralTable = {};

export function pluralTableOf(language: LocaleCode): PluralTable {
  return PLURAL_TABLES[language] ?? EMPTY_PLURALS;
}

/** 一个数字在某种语言里属于哪个复数类别（测试与 `tn()` 共用） */
export function pluralCategory(count: number, language: Language = current): PluralCategory {
  return pluralCategoryFor(count, localeMeta(language)?.intlLocale ?? 'en');
}

/**
 * **设置页里可选**的语言：只列已经有表的。
 * 由表派生而不是手写一份——写完某种语言的 `locales/xx/` 之后，它会自己出现在下拉里。
 */
export const LANGUAGES: readonly LocaleCode[] = LOCALES.map((locale) => locale.code).filter(
  (code) => TABLES[code] !== undefined,
);

/** 语言自称（下拉里显示的就是它，不随当前语言变）：6 种都有，哪怕还没有表 */
export const LANGUAGE_NAMES: Readonly<Record<LocaleCode, string>> = Object.fromEntries(
  LOCALES.map((locale) => [locale.code, locale.nativeName]),
) as Record<LocaleCode, string>;

export function isLanguage(value: unknown): value is Language {
  // 认的是**支持的**语言（6 种），不是"已经有表的"：存档里存了 `de` 不该被判成脏数据
  return isLocaleCode(value);
}

/**
 * 从设备语言标签推断界面语言（`navigator.language`，形如 `zh-CN` / `de-AT` / `pt_BR`）。
 *
 * ⚠️ 多语言 P0-4 起**口径变了**：原来只认 zh / en，其余一律回中文；
 * 现在认全 `LOCALES` 六种，**认不出来回英文**（发 Play 的口径：陌生语言用户看英文比看中文有用）。
 * 匹配规则只在 `locale.ts` 的 `matchLocale()` 一处，这里仅转发——不再留第二套判断。
 */
export function detectLanguage(tag: string | undefined | null): Language {
  return detectLocale(tag);
}

/** 设置里"跟随系统"的取值（多语言 P0-5） */
export const AUTO_LANGUAGE = 'auto';

/**
 * 设置项里存的**语言选择**：具体语言，或 `auto`（跟随系统）。
 *
 * 为什么把它和 `Language` 分开：`auto` 不是一种语言，它没有文案表、也不该进 `TABLES`。
 * 混进 `Language` 会让 `t(key, 'auto')` 这种调用在类型上合法却永远查不到东西。
 */
export type LanguageSetting = Language | typeof AUTO_LANGUAGE;

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return value === AUTO_LANGUAGE || isLanguage(value);
}

/**
 * 设备语言标签。
 * Node / Worker 里没有 `navigator`，返回 `undefined`（由 `detectLanguage` 兜底到英文）。
 */
export function deviceLanguage(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const tag = (navigator as { language?: unknown }).language;
  return typeof tag === 'string' ? tag : undefined;
}

/**
 * 把设置项解析成**真正生效**的语言：`auto` → 按设备标签推断，其余原样返回。
 *
 * `tag` 可显式传入（断言用）——否则测试结果会跟着跑测试那台机器的系统语言变。
 */
export function resolveLanguage(setting: LanguageSetting, tag: string | undefined = deviceLanguage()): Language {
  return setting === AUTO_LANGUAGE ? detectLanguage(tag) : setting;
}

/**
 * 解析 + 生效，返回真正生效的语言。
 *
 * 为什么要一个函数收口：`boot()` 与设置页下拉**必须**走同一条路，
 * 否则"启动时跟随系统、设置里选具体语言"会各写一遍解析逻辑，迟早不一致。
 */
export function applyLanguageSetting(setting: LanguageSetting, tag: string | undefined = deviceLanguage()): Language {
  const resolved = resolveLanguage(setting, tag);
  setLanguage(resolved);
  return resolved;
}

/**
 * 当前语言。
 *
 * ⚠️ 做成模块级状态而不是"到处传参数"：文案散在几十个渲染函数里，
 * 每处都多一个 `lang` 参数会把函数签名改一遍（那才是真正的大改）。
 * 代价是**它不参与依赖追踪**——所以切语言之后要显式刷新界面
 * （`SettingsScreen.applyLanguage()` 就是干这个的）。
 */
let current: Language = DEFAULT_LANGUAGE;

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  current = language;
  if (typeof document !== 'undefined') {
    // `<html lang>` 不是装饰：手机上的朗读/断行规则、以及浏览器的"翻译此页"提示都看它。
    // 带地区的值（`zh-CN` / `pt-BR`）从元数据取，不再是"三分支里猜一个"
    document.documentElement.lang = localeMeta(language)?.htmlLang ?? language;
  }
}

/** 测试用：把模块状态恢复成默认，避免用例之间互相污染 */
export function resetLanguageForTest(): void {
  current = DEFAULT_LANGUAGE;
}

/** 一条非空文案；空串按"没有"处理（界面上空按钮比露出键名更难查） */
function nonEmpty(table: Readonly<Record<string, string>>, key: string): string | undefined {
  const value = table[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 查一条文案。`language` 省略时用当前语言。
 *
 * **回落链：当前语言 → 英文（发行主语言）→ 键名本身。**
 *
 * 为什么只留英文这一档：6 种语言之后，"德语缺一条"退到英文是对的
 * （德语用户多半看得懂英文），退到中文等于把界面切成看不懂的字。
 * 又因为 `locales/en/**` 由 `satisfies Messages` 保证**键集与中文完全一致**，
 * 英文这一档实际上不可能查空——所以不要再留"最后退中文"的第三档：
 * 那会让"漏翻"变成"看起来只是语言不对"，而不是一眼可见的键名。
 */
export function t(key: string, language: Language = current): string {
  return nonEmpty(tableOf(language), key) ?? nonEmpty(tableOf(FALLBACK_LOCALE), key) ?? key;
}

/**
 * 把 `{name}` 占位符替换成参数。
 *
 * 两条约定（`tp()` / `tn()` 共用，别各写一份）：
 *  1. **缺参数时保留占位符原文**（不替换成空串、也不抛错）——
 *     界面上显示 `{count}` 一眼能看出漏传了，空串则像"排版坏了"；
 *  2. 值统一 `String()`，数字参数不必调用方先转。
 */
function substitute(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * 带占位符的查表：`tp('station.expected', { count: 3, unit: '个' })`。
 *
 * 为什么单独一个函数而不是给 `t()` 加参数：`t()` 的第二个参数已经是**语言**
 * （`t('pause.resume', 'en')`），再塞一个 params 会变成"第二个参数既可能是语言
 * 也可能是对象"——那种签名在运行时只能靠类型猜，出错时报的是别的字段。
 *
 * 两条约定：
 *  1. **占位符是 `{name}`**，不是 `${}` / `%s`：前者不会和模板字符串打架；
 *  2. **缺参数时保留占位符原文**（不替换成空串、也不抛错）——
 *     界面上显示 `{count}` 一眼能看出漏传了，空串则像"排版坏了"。
 */
export function tp(key: string, params: Record<string, string | number>): string {
  return substitute(t(key), params);
}

/**
 * 带**复数**的查表：`tn('station.brewLeft', left)`（多语言 P0-6）。
 *
 * 与 `tp()` 的唯一区别是**模板先按数量挑一种复数形式**：
 *   1. 该语言在 `PLURAL_TABLES` 里登记过这条键 → 用 `Intl.PluralRules` 选类别，
 *      取该类别（取不到取 `other`）的模板；
 *   2. 没登记 → 退回 `t(key)` 那一条，`{count}` 照样替换。
 * 所以**不需要每条文案都写复数**，只有"count 可能是 1 且读起来别扭"的才登记
 * （见 `locales/en/plural.ts` 的判据）。
 *
 * 中文用不到复数形式（CLDR 里只有 other），走第 2 条即可。
 */
export function tn(key: string, count: number, params: Record<string, string | number> = {}): string {
  // 先看**这条文案最终由哪种语言提供**（与 `t()` 的回落链同一判据）：
  //  · 中文有自己的文案 → 用中文（中文没有复数形式，直接替换 {count}）；
  //  · 德语表还没写 → 渲染的是英文那条 → 用英文的复数表 + 英文的复数规则。
  // 关键点：**复数类别必须跟模板同语言**。拿德语规则去英文模板里挑类别，
  // 会挑出 few/many 之类英文根本没有的类别，最后只能退回 other。
  const source = nonEmpty(tableOf(current), key) === undefined ? FALLBACK_LOCALE : current;
  const forms = pluralTableOf(source)[key];
  const category = pluralCategory(count, source);
  const template = forms?.[category] ?? forms?.other ?? nonEmpty(tableOf(source), key) ?? key;
  return substitute(template, { ...params, count });
}

/**
 * 把几个词连成一句（枚举清单用）。
 *
 * 为什么需要它：**连接词本身就是语言相关的**——中文是"和"、英文是"and"、
 * 德语是"und"、法语是"et"、葡语是"e"、俄语是"и"，而且标点规则各不相同。
 * 手写 `items.join('、')` 在英文下会变成 "Oak Planks、Cobblestone、Stick"，
 * 语法不算错但一眼就是机翻。
 *
 * ⚠️ 多语言 P0-6 起**一律交给 `Intl.ListFormat`**（用户拍板）：
 * 中文因此从"木板、圆石、木棍"变成"木板、圆石和木棍"——这是**有意的行为变化**，
 * 换来的是不用为每种语言手写一套连接规则（俄语/葡语的逗号规则并不简单）。
 */
export function joinList(items: readonly string[], language: Language = current): string {
  const list = items.filter((item) => item.length > 0);
  if (list.length === 0) return '';
  // 一项没有"连接"可言，也就不该走 Intl（某些语言会给出奇怪的单项形式）
  if (list.length === 1) return list[0]!;
  const tag = localeMeta(language)?.intlLocale ?? 'en';
  if (typeof Intl === 'undefined' || typeof Intl.ListFormat !== 'function') return list.join(', ');
  try {
    return new Intl.ListFormat(tag, { type: 'conjunction', style: 'long' }).format([...list]);
  } catch {
    // 老 WebView 或没装该 locale 的数据：退成逗号列表，总比抛异常好
    return list.join(', ');
  }
}

/**
 * 两张表的键集差异（给断言用）。
 * 正常情况下两个数组都为空——不空就是"漏翻了一条"。
 */
export function keyParity(): { missingInEn: string[]; missingInZh: string[] } {
  const zhKeys = Object.keys(ZH_MERGED);
  const enKeys = Object.keys(EN_MERGED);
  return {
    missingInEn: zhKeys.filter((key) => !(key in EN_MERGED)),
    missingInZh: enKeys.filter((key) => !(key in ZH_MERGED)),
  };
}

/** 所有已定义的键（断言"界面用到的键都在表里"时拿它当白名单） */
export function allKeys(): string[] {
  return Object.keys(ZH_MERGED);
}
