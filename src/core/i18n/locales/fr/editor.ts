/**
 * 法语文案·editor（与 `locales/zh/editor.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-3：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`。
 * ⚠️ 值里的撇号统一写成排版撇号 `’`（`l’eau`），避免转义且符合法语排版。
 */

import type { Messages } from '../zh/index.ts';
import type { editor as zhEditor } from '../zh/editor.ts';

export const editor = {
  "book.noPages": "Aucune page écrite, impossible de signer",
  "sign.done": "Terminé",
  "editor.ok": "OK",
  "editor.cancel": "Annuler",
  "editor.done": "Terminé",
  "editor.close": "Fermer",
  "editor.back": "Retour",
  "editor.sign": "Signer",
  "book.writePlaceholder": "Écrivez quelque chose sur cette page…",
  "book.titlePlaceholder": "Titre du livre",
  "book.writingTitle": "Livre et plume",
  "book.emptyPage": "(cette page est vide)",
  "book.pageOf": "Page {current} / {total}",
  "sign.linePlaceholder": "Ligne {n}",
  "sign.hint": "{n} caractères max par ligne · tout laisser vide = effacer le panneau",
  "nameTag.placeholder": "Donnez-lui un nom",
  "nameTag.hint": "{n} caractères max · laisser vide ne change rien",
  "commandBlock.title": "Bloc de commande",
} satisfies Pick<Messages, keyof typeof zhEditor>;
