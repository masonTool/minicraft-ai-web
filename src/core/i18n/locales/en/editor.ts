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
