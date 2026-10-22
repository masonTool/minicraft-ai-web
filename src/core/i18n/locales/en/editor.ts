/**
 * 英文文案·editor（与 `locales/zh/editor.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P0-3：这里的类型是 `satisfies Pick<Messages, keyof typeof zhXxx>`——
 * 中文那边加一条键、这边没跟上，`npm run typecheck` 直接报错，不必等测试跑起来。
 * 搬运规则：只搬不改，英文一个字都没动。
 */

import type { Messages } from '../zh/index.ts';
import type { editor as zheditor } from '../zh/editor.ts';

export const editor = {
  'book.noPages': 'Nothing written yet — cannot sign it',
  'sign.done': 'Done',
  // ---- build tools (batch 20261022-1954)
  'buildtools.undo.creativeOnly': 'Undo is only available in Creative mode',
  'buildtools.undo.onlineOnly': "You can't undo while connected to a server",
  'buildtools.undo.empty': 'Nothing to undo',
  'buildtools.redo.empty': 'Nothing to redo',
  'buildtools.select.first': 'First corner set — tap another corner',
  'buildtools.select.done': 'Selected {volume} blocks',
  'buildtools.select.tooLarge': 'Selection too large (max 32768 blocks)',
  'buildtools.select.outOfWorld': 'Selection is outside the world',
  'buildtools.fill.noSelection': 'Pick two corners to select an area first',
  'buildtools.fill.done': 'Filled {count} blocks',
  'buildtools.fill.cancelled': 'Fill cancelled',
  'buildtools.copy.done': 'Copied {count} blocks',
  'buildtools.copy.none': 'Nothing copied yet',
  'buildtools.copy.empty': 'The selection is empty',
  'buildtools.paste.done': 'Pasted {count} blocks',
  'buildtools.paste.cancelled': 'Paste cancelled',
  'buildtools.paste.outOfWorld': 'Paste target is outside the world',
  // ---- build templates (batch 20261022-1954)
  'template.smallHouse': 'Cottage',
  'template.bridge': 'Bridge',
  'template.tree': 'Tree',
  'template.tower': 'Stone Tower',
  'buildtools.template.blocked': "Can't place here — blocks in the way",
  'buildtools.template.unsupported': "Can't place here — nothing underneath",
  'buildtools.template.outOfWorld': 'Outside the world',
  'buildtools.template.placed': 'Placing: {name}',
  // ---- build toolbar (batch 20261022-1954)
  'buildtools.toggle': 'Build mode',
  'buildtools.tool.select': 'Select',
  'buildtools.tool.fill': 'Fill',
  'buildtools.tool.copy': 'Copy',
  'buildtools.tool.paste': 'Paste',
  'buildtools.tool.mirror': 'Mirror paste',
  'buildtools.tool.undo': 'Undo',
  'buildtools.tool.redo': 'Redo',
  'buildtools.tool.template': 'Templates',
  'buildtools.tool.selectHint': 'Tap a block to set the first corner',
  'buildtools.fill.noBlock': 'Hold a block first',
} satisfies Pick<Messages, keyof typeof zheditor>;
