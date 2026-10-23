/**
 * 德语文案（多语言 P4-1）
 *
 * 与中文同构：`satisfies Messages` 保证键集一致。
 * ⚠️ 其中 7 个分组仍是**英文占位**（inventory / cmd / cmdMessages / item / itemDesc / label / entity），
 * 进度见 `notes/i18n-de.md`。
 */

import type { Messages } from '../zh/index.ts';

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

export const de = {
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
} satisfies Messages;
