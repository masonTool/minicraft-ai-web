/**
 * 命令的执行反馈文案（批次 617 / Q14 的后续，条目 [发现]）。
 *
 * 为什么单独一个文件、而不是塞进 `I18n.ts`：
 * 这里有 **129 条一句一义的反馈**（"已将时间设置为 …"、"找不到物品：…"），
 * 句式重复的只有 8 组 —— 没法像 `UsageText.ts` 那样用词表压。
 * 塞进 `I18n.ts` 会让那个文件从 199 条涨到 330 条，而它服务于**界面**；
 * 命令反馈是**运行时输出**，单独一处更好审、也更好按命令分组。
 *
 * 与 `I18n.ts` 的关系：`msg()` / `msgp()` 最终仍走同一个语言状态，
 * 所以 `setLanguage()` 切过去、这里立刻跟着变，不存在第二套语言开关。
 */

import { getLanguage, t } from '../i18n/I18n.ts';
import { COMMAND_DESCRIPTION_EN, COMMAND_USAGE_EN } from './commandHelp.data.ts';

/** 中文原文 → 英文。键是**中文原文**，不是人造 id —— 见下面 `msg()` 的说明。 */
export { COMMAND_MESSAGES_EN } from './commandMessages.data.ts';


/**
 * 取一条反馈文案。
 *
 * 参数用**中文原文当键**，而不是 `cmd.give.ok` 这类人造 id。理由：
 *   · 129 条里 8 成只在一处用，人造 id 只是把一句中文换个名字存两遍；
 *   · 数组里那些报告"实际写了什么"的断言按中文匹配（它们验的是**逻辑**对不对，
 *     不是翻译对不对），原文当键不用改那批断言；
 *   · 漏译检测很直接：`t(key)` 找不到就返回键本身，也就是中文原文原样漏出来 ——
 *     英文界面上看得见，而不是变成 `cmd.give.ok` 这种谁也看不懂的东西。
 *
 * 代价：改中文文案等于改键。命令反馈的措辞本来就极少动，可以接受。
 */
/**
 * 把"中文表 + 英文表"这对常量按当前语言取一个值。
 *
 * 用于 `/weather` `/difficulty` `/gamemode` `/scoreboard setdisplay` 这些
 * **回执里嵌着另一个标签表**的命令：句式已经翻了，若值还是中文，
 * 英文界面上就会出现 `Weather set to 下雨` 这种半截话 —— 比整句不翻更难看。
 *
 * 为什么不让那几张表直接走 `t()`：它们本身就是"值 → 名字"的映射，
 * 拆成 `i18n.ts` 的键组反而让 core 层依赖界面层的分组约定。两张表 + 一个开关最直白。
 */
export function pickLabel(zh: string, en: string): string {
  return getLanguage() === 'en' ? en : zh;
}

/** `/help` 里那条命令的用法行（按当前语言） */
export function commandUsage(spec: { readonly name: string; readonly usage: string }): string {
  return pickLabel(spec.usage, COMMAND_USAGE_EN[spec.name] ?? spec.usage);
}

/** `/help` 里那条命令的说明（按当前语言） */
export function commandDescription(spec: { readonly name: string; readonly description: string }): string {
  return pickLabel(spec.description, COMMAND_DESCRIPTION_EN[spec.name] ?? spec.description);
}

export function msg(zh: string, params?: Record<string, unknown>): string {
  const template = t(zh);
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}
