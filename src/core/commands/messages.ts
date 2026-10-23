/**
 * 命令文案的取用入口（多语言 P1 收口）。
 *
 * 三件事，各自处在不同的迁移阶段：
 *  · `commandUsage` / `commandDescription`：`/help` 的用法与说明 —— **已走 `cmd.*` 查表**（P1-1b）。
 *    之前是"中文串写在 spec 里 + 英文串放在 `commandHelp.data.ts`"二选一，改一句要同步两个文件。
 *  · `msg()`：命令回执 —— 键仍是**中文原文**（P1-5 才搬进 `cmdMessages.ts`、P1-6 切调用点）。
 *  · `pickLabel()`：**过渡遗留** —— `/gamemode`、`/weather`、`/difficulty`、`/scoreboard setdisplay`
 *    这几条回执里嵌着另一张"值 → 名字"的表，还是中文一张 + 英文一张（P1-7 删掉，改成 `cmd.label.*`）。
 */

import { getLanguage, t } from '../i18n/I18n.ts';

/** 中文原文 → 英文。键是**中文原文**，不是人造 id —— 见下面 `msg()` 的说明。 */
export { COMMAND_MESSAGES_EN } from './commandMessages.data.ts';

/**
 * 把"中文表 + 英文表"这对常量按当前语言取一个值。
 *
 * ⚠️ 多语言 P0-4：判定从"是不是英文"改成"**是不是中文**"。
 * 原来德语/俄语用户会在这几处拿到中文（`Weather set to 下雨` 那种半截话的根源）。
 * 这套形态会在 **P1-7** 删掉（改成 `cmd.label.*` 走查表），这里只是先让判定方向正确。
 */
export function pickLabel(zh: string, en: string): string {
  return getLanguage() === 'zh' ? zh : en;
}

/**
 * `/help` 里那条命令的用法行（按当前语言）。
 *
 * 多语言 P1-1b：`spec.usageKey`（`cmd.<name>.usage`）→ 查表。
 * 想拿"语法结构"也拿这一份 —— 德/俄等翻译必须保留 `<>` `[]` `|` 这些语法符号（P4 的验收项）。
 */
export function commandUsage(spec: { readonly name: string; readonly usageKey: string }): string {
  return t(spec.usageKey);
}

/** `/help` 里那条命令的说明（按当前语言） */
export function commandDescription(spec: { readonly name: string; readonly descriptionKey: string }): string {
  return t(spec.descriptionKey);
}

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
 * ⚠️ **P1-5 / P1-6 会推翻这个取舍**（一批命令域收成一套 `cmd.msg.*` 语义键），
 * 那时这条注释与 `commandMessages.data.ts` 一起删。
 */
export function msg(zh: string, params?: Record<string, unknown>): string {
  const template = t(zh);
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}
