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
 * **回落链：当前语言 → 英文（发行主语言）→ 中文（源语言，最全）→ 键名本身。**
 *
 * 为什么英文排在中文前面：6 种语言之后，"德语缺一条"退到英文是对的
 * （德语用户多半看得懂英文），退到中文等于把界面切成看不懂的字。
 * 中文留在链尾做最后兜底——它是最全的一张表。
 */
export function t(key: string, language: Language = current): string {
  return (
    nonEmpty(tableOf(language), key) ??
    nonEmpty(tableOf(FALLBACK_LOCALE), key) ??
    nonEmpty(ZH_MERGED, key) ??
    key
  );
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
  return t(key).replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * 把几个词连成一句（枚举清单用）。
 *
 * 为什么需要它：中文用顿号、英文用逗号加 and，**分隔符本身就是语言相关的**。
 * 直接把 `items.join('、')` 写在界面里，英文模式下会变成
 * "Oak Planks、Cobblestone、Stick" —— 语法上不算错，但一眼就是机翻。
 */
export function joinList(items: readonly string[], language: Language = current): string {
  const list = items.filter((item) => item.length > 0);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0]!;
  // 中文用顿号，其余语言暂按英文那套（`, ` + `and`）。
  // ⚠️ 这是 P0-6 改成 `Intl.ListFormat` 之前的临时口径：法/德/葡/俄各自的连接词
  // 会在那一条里由 Intl 处理，这里不手写四种分词规则。
  if (language !== 'zh') {
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
  }
  return list.join('、');
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
