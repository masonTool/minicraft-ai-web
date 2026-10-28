/**
 * 命令文案的取用入口（多语言 P1 收口）。
 *
 * 三件事，各自处在不同的迁移阶段：
 *  · `commandUsage` / `commandDescription`：`/help` 的用法与说明 —— **已走 `cmd.*` 查表**（P1-1b）。
 *    之前是"中文串写在 spec 里 + 英文串放在 `commandHelp.data.ts`"二选一，改一句要同步两个文件。
 *  · `msg()`：命令回执 —— 键是 `cmd.reply.*` 语义键（P1-6 已切完，旧的中文原文表已删除）。
 */

import { t } from '../i18n/I18n.ts';

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
 * 参数是 **`cmd.reply.*` 语义键**（多语言 P1-6）。修这段历史时值得记一笔：
 * 原来这里的参数是**中文原文**，理由是"人造 id 只是把一句中文换个名字存两遍"。
 * 那个取舍在两种语言下成立，到六种语言就不成立了 —— 键随语言变意味着表没法互相
 * 对照、`satisfies` 也没法卡齐。现在键固定、中文只是它的一个值。
 */
export function msg(zh: string, params?: Record<string, unknown>): string {
  const template = t(zh);
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}
