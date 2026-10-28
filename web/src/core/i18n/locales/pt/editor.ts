/**
 * 葡语文案·editor（与 `locales/zh/editor.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-4：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`。
 */

import type { Messages } from '../zh/index.ts';
import type { editor as zhEditor } from '../zh/editor.ts';

export const editor = {
  "book.noPages": "Nenhuma página escrita, não dá para assinar",
  "sign.done": "Concluir",
  "editor.ok": "OK",
  "editor.cancel": "Cancelar",
  "editor.done": "Concluir",
  "editor.close": "Fechar",
  "editor.back": "Voltar",
  "editor.sign": "Assinar",
  "book.writePlaceholder": "Escreva algo nesta página…",
  "book.titlePlaceholder": "Título do livro",
  "book.writingTitle": "Livro e pena",
  "book.emptyPage": "(esta página está vazia)",
  "book.pageOf": "Página {current} / {total}",
  "sign.linePlaceholder": "Linha {n}",
  "sign.hint": "{n} caracteres por linha · deixar tudo vazio apaga a placa",
  "nameTag.placeholder": "Dê um nome a ele",
  "nameTag.hint": "{n} caracteres no máximo · vazio não altera nada",
  "commandBlock.title": "Bloco de comando",
} satisfies Pick<Messages, keyof typeof zhEditor>;
