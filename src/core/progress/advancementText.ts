/**
 * 成就文案按语言取值（批次 620；多语言 P6-4 起走 i18n 表）。
 *
 * 历史：原来是「中文原文在 `advancements.ts`、英文另存 `advancementText.data.ts`」的两层结构，
 * 其它语言（德语/俄语/法语/葡语）一律回落到英文。P6-4 把这 200 条（100 条 × 标题+描述）
 * 搬进 `locales/<code>/advancement.ts`，**键由 id 派生**：
 *
 *   `minecraft:story/root` → `advancement.story_root.title` / `.desc`
 *
 * 也就是说这里不再有"第二份清单"—— 加一条成就只要在 `advancements.ts` 里写中文原文，
 * 其余语言按派生出来的同一批键填。
 *
 * ⚠️ 取不到时**回落到 `advancements.ts` 里的中文原文**（与 `commandMessages` 的取舍一致）：
 * 界面上冒出中文一眼能看见，比显示 id 或空串好定位。
 */

import { getLanguage, t } from '../i18n/I18n.ts';
import { ADVANCEMENT_TAB_EN } from './advancementText.data.ts';

/** 某条进度的标题（按当前语言） */
export function advancementTitle(def: { readonly id: string; readonly title: string }): string {
  // ⚠️ 必须写成模板字面量：`audit:i18n` 靠这个形态认出"这一族键是数据驱动取的"
  const probe = `advancement.${def.id.replace('minecraft:', '').replace(/\//g, '_')}.title`;
  const text = t(`advancement.${def.id.replace('minecraft:', '').replace(/\//g, '_')}.title`);
  return text === probe ? def.title : text;
}

/** 某条进度的说明（按当前语言） */
export function advancementDesc(def: { readonly id: string; readonly desc: string }): string {
  const probe = `advancement.${def.id.replace('minecraft:', '').replace(/\//g, '_')}.desc`;
  const text = t(`advancement.${def.id.replace('minecraft:', '').replace(/\//g, '_')}.desc`);
  return text === probe ? def.desc : text;
}

/**
 * 标签页名（按当前语言）。
 *
 * ⚠️ 这 7 条**还留在英文表**里（`ADVANCEMENT_TAB_EN`）：它们是 `progress` 组的
 * `advancement.*` 文案，与 100 条成就条目不是同一批数据，P6-4 没覆盖。
 * 后续要键化时走同一套派生规则（`advancementTab.<tab.id>`）。
 */
export function advancementTabTitle(tab: { readonly id: string; readonly title: string }): string {
  if (getLanguage() === 'zh') return tab.title;
  return ADVANCEMENT_TAB_EN[tab.id] ?? tab.title;
}
