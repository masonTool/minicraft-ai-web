/**
 * 成就文案按语言取值（批次 620）。
 *
 * 单独一层而不是塞进 `advancementText.data.ts`：数据文件必须**零依赖**（否则和
 * `I18n.ts` 循环引用），而这里要用 `getLanguage()`，只能是另一个文件。
 *
 * 取不到英文时**回落中文**，不做二次处理：英文界面上冒出中文一眼能看见，
 * 比显示 id 或空串好定位得多（同 `commandMessages.data.ts` 的取舍）。
 */

import { getLanguage } from '../i18n/I18n.ts';
import { ADVANCEMENT_TAB_EN, ADVANCEMENT_TEXT_EN } from './advancementText.data.ts';

/** 某条进度的标题（按当前语言） */
export function advancementTitle(def: { readonly id: string; readonly title: string }): string {
  if (getLanguage() !== 'en') return def.title;
  return ADVANCEMENT_TEXT_EN[def.id]?.title ?? def.title;
}

/** 某条进度的说明（按当前语言） */
export function advancementDesc(def: { readonly id: string; readonly desc: string }): string {
  if (getLanguage() !== 'en') return def.desc;
  return ADVANCEMENT_TEXT_EN[def.id]?.desc ?? def.desc;
}

/** 标签页名（按当前语言） */
export function advancementTabTitle(tab: { readonly id: string; readonly title: string }): string {
  if (getLanguage() !== 'en') return tab.title;
  return ADVANCEMENT_TAB_EN[tab.id] ?? tab.title;
}
