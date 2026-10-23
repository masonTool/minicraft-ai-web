/**
 * 中文文案（源语言）——**键的唯一真相**
 *
 * 多语言 P0-2：原来 450 多条挤在 `I18n.ts` 一个 `const ZH` 里，加一种语言要在
 * 一千多行的文件里对着找；现在按界面分组拆开，`I18n.ts` 只留运行时。
 *
 * ⚠️ `as const` 不是为了好看：`MessageKey` / `Messages` 由它推导，
 * 别的语言文件用 `satisfies Messages` 声明，**少一条键就是编译错误**（P0-3）。
 * ⚠️ 合并顺序就是下面 import 的顺序；键不重复，顺序只影响遍历顺序。
 */

import { menu } from './menu.ts';
import { settings } from './settings.ts';
import { inventory } from './inventory.ts';
import { station } from './station.ts';
import { editor } from './editor.ts';
import { chat } from './chat.ts';
import { progress } from './progress.ts';
import { minigame } from './minigame.ts';
import { cmd } from './cmd.ts';
import { cmdMessages } from './cmdMessages.ts';
import { item } from './item.ts';
import { itemDesc } from './itemDesc.ts';
import { label } from './label.ts';
import { entity } from './entity.ts';
import { misc } from './misc.ts';
import { advancement } from './advancement.ts';
import { notice } from './notice.ts';

export const zh = {
  ...menu,
  ...settings,
  ...inventory,
  ...station,
  ...editor,
  ...chat,
  ...progress,
  ...minigame,
  ...cmd,
  ...cmdMessages,
  ...item,
  ...itemDesc,
  ...label,
  ...entity,
  ...misc,
  ...advancement,
  ...notice,
} as const;

export type MessageKey = keyof typeof zh;

/** 一种语言的完整文案表：键取自中文（源语言），值是译文 */
export type Messages = { readonly [K in MessageKey]: string };
