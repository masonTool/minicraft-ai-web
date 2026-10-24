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
  // Short label under the collapsed toggle (batch 20261024-0344)
  'buildtools.toggle.short': 'Build',
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
  // ---- Build drawer (batch 20261024-0344): short cell label + one-line hint + panel chrome
  'buildtools.tool.select.short': 'Select',
  'buildtools.tool.fill.short': 'Fill',
  'buildtools.tool.copy.short': 'Copy',
  'buildtools.tool.paste.short': 'Paste',
  'buildtools.tool.mirror.short': 'Mirror',
  'buildtools.tool.undo.short': 'Undo',
  'buildtools.tool.redo.short': 'Redo',
  'buildtools.tool.template.short': 'Templates',
  'buildtools.tool.select.hint': 'Tap two blocks',
  'buildtools.tool.fill.hint': 'Fill the box',
  'buildtools.tool.copy.hint': 'Copy the box',
  'buildtools.tool.paste.hint': 'Paste beside it',
  'buildtools.tool.mirror.hint': 'Flip left-right',
  'buildtools.tool.undo.hint': 'Step back',
  'buildtools.tool.redo.hint': 'Step forward',
  'buildtools.tool.template.hint': 'Built-in builds',
  'buildtools.panel.title': 'Build tools',
  'buildtools.panel.endBuild': 'End building',

  // ---- 四个编辑器面板的框架文案（多语言 P3-2）
  "editor.ok": "OK",
  "editor.cancel": "Cancel",
  "editor.done": "Done",
  "editor.close": "Close",
  "editor.back": "Back",
  "editor.sign": "Sign",
  "book.writePlaceholder": "Write something on this page…",
  "book.titlePlaceholder": "Title",
  "book.writingTitle": "Book and Quill",
  "book.emptyPage": "(This page is empty)",
  "book.pageOf": "Page {current} of {total}",
  "sign.linePlaceholder": "Line {n}",
  "sign.hint": "Up to {n} characters per line · leave every line blank to erase the sign",
  "nameTag.placeholder": "Give it a name",
  "nameTag.hint": "Up to {n} characters · leave it blank to keep the current name",
  "commandBlock.title": "Command Block",
} satisfies Pick<Messages, keyof typeof zheditor>;
