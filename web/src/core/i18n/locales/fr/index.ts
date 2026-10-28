/**
 * 法语文案（多语言 P4-3）
 *
 * 与中文同构：`satisfies Messages` 保证键集一致。
 * ⚠️ 分批翻译中，未翻的分组是**英文占位**，进度见 `notes/i18n-fr.md`。
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
import { advancement } from './advancement.ts';
import { notice } from './notice.ts';
import { hud } from './hud.ts';
import { say } from './say.ts';

export const fr = {
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
  ...hud,
  ...say,
} satisfies Messages;
