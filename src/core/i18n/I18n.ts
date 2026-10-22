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
 *  2. **查不到的键返回键名本身**，不返回空串、也不抛异常：
 *     界面上显示 `settings.group.game` 一眼就能看出漏了文案，
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

export const LANGUAGES = ['zh', 'en'] as const;

export type Language = (typeof LANGUAGES)[number];

/** 语言自称（语言选择器里显示的就是这两串，不随当前语言变） */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  zh: '简体中文',
  en: 'English',
};

/** 默认语言：中文（本项目最初的文案全是中文，英文是后来补的） */
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

export const TABLES: Readonly<Record<Language, Readonly<Record<string, string>>>> = {
  zh: ZH_MERGED,
  en: EN_MERGED,
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * 从浏览器语言标签推断（`navigator.language`，形如 `zh-CN` / `en-US`）。
 * 分辨不出来的按中文处理——本项目的中文文案最全，英文是子集时也不至于一半中文一半英文。
 */
export function detectLanguage(tag: string | undefined | null): Language {
  if (typeof tag !== 'string') return DEFAULT_LANGUAGE;
  const lower = tag.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('en')) return 'en';
  return DEFAULT_LANGUAGE;
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
    // `<html lang>` 不是装饰：手机上的朗读/断行规则、以及浏览器的"翻译此页"提示都看它
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }
}

/** 测试用：把模块状态恢复成默认，避免用例之间互相污染 */
export function resetLanguageForTest(): void {
  current = DEFAULT_LANGUAGE;
}

/**
 * 查一条文案。`language` 省略时用当前语言。
 * 查不到就**返回键名**（见文件头第 2 条约定）。
 */
export function t(key: string, language: Language = current): string {
  const table = TABLES[language] ?? ZH;
  const value = table[key];
  if (typeof value === 'string' && value.length > 0) return value;
  // 当前语言缺这一条时退到中文：英文表漏一条不该让界面出现空白
  const fallback = ZH[key];
  if (typeof fallback === 'string' && fallback.length > 0) return fallback;
  return key;
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
  if (language === 'en') {
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
