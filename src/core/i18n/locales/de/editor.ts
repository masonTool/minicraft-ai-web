/**
 * 德语文案·editor（与 `locales/zh/editor.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-1：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { editor as zhEditor } from '../zh/editor.ts';

export const editor = {
  "book.noPages": "Keine Seite geschrieben – Signieren nicht möglich",
  "sign.done": "Fertig",
  "editor.ok": "OK",
  "editor.cancel": "Abbrechen",
  "editor.done": "Fertig",
  "editor.close": "Schließen",
  "editor.back": "Zurück",
  "editor.sign": "Signieren",
  "book.writePlaceholder": "Schreib etwas auf diese Seite…",
  "book.titlePlaceholder": "Buchtitel",
  "book.writingTitle": "Buch und Feder",
  "book.emptyPage": "(Diese Seite ist leer)",
  "book.pageOf": "Seite {current} / {total}",
  "sign.linePlaceholder": "Zeile {n}",
  "sign.hint": "Max. {n} Zeichen pro Zeile · alles leer lassen löscht das Schild",
  "nameTag.placeholder": "Gib ihm einen Namen",
  "nameTag.hint": "Max. {n} Zeichen · leer lassen ändert nichts",
  "commandBlock.title": "Befehlsblock",
} satisfies Pick<Messages, keyof typeof zhEditor>;
