/**
 * 英文文案（发行主语言）
 *
 * 多语言 P0-3：与中文同构拆分；`satisfies Messages` 保证**键集与中文完全一致**。
 * `Messages` 的键来自 `locales/zh/index.ts` 的 `as const`，所以中文是唯一真相，
 * 任何语言只要少一条键就编译不过。
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

export const en = {
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
