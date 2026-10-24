/**
 * 俄语文案·editor（与 `locales/zh/editor.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-2：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { editor as zhEditor } from '../zh/editor.ts';

export const editor = {
  "book.noPages": "Ни одна страница не заполнена — подписать нельзя",
  "sign.done": "Готово",
  "editor.ok": "ОК",
  "editor.cancel": "Отмена",
  "editor.done": "Готово",
  "editor.close": "Закрыть",
  "editor.back": "Назад",
  "editor.sign": "Подписать",
  "book.writePlaceholder": "Напишите что-нибудь на этой странице…",
  "book.titlePlaceholder": "Название книги",
  "book.writingTitle": "Книга и перо",
  "book.emptyPage": "(Эта страница пуста)",
  "book.pageOf": "Страница {current} / {total}",
  "sign.linePlaceholder": "Строка {n}",
  "sign.hint": "Не более {n} символов в строке · если оставить всё пустым, надпись сотрётся",
  "nameTag.placeholder": "Дайте ему имя",
  "nameTag.hint": "Не более {n} символов · пусто — имя не меняется",
  "commandBlock.title": "Командный блок",
} satisfies Pick<Messages, keyof typeof zhEditor>;
