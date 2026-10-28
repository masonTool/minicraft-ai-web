/**
 * 葡语文案·chat（与 `locales/zh/chat.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-4：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`。
 */

import type { Messages } from '../zh/index.ts';
import type { chat as zhChat } from '../zh/chat.ts';

export const chat = {
  "chat.send": "Enviar",
  "command.usagePrefix": "Uso: ",
  "command.unknown": "Comando desconhecido: /{name} (digite /help para ver todos)",
  "command.unknownHelp": "Comando desconhecido: {name}",
  "command.creativeOnly": "/{name} só funciona no modo criativo",
  "command.empty": "Digite um comando, por exemplo /help",
  "command.failed": "Erro ao executar: {message}",
  "command.listTitle": "Comandos disponíveis ({count}):",
  "chat.sendLabel": "Enviar",
  "chat.collapse": "Toque para recolher",
  'chat.expandBadge': 'Expandir',
  "chat.expand": "Toque para expandir",
  "chat.hintIdle": "Digite um comando (/help para ver todos) ou fale, depois toque em « Enviar »",
  "chat.hintIdleKeyboard": "Digite um comando (/help) ou fale · Enter envia · Esc cancela",
  "chat.hintCommand": "« Enviar » para confirmar (no celular não há Tab, digite os argumentos inteiros)",
  "chat.hintCommandKeyboard": "Tab completa · Enter envia · ↑↓ histórico",
  "chat.candidates": "Sugestões: {list}{suffix}",
  "chat.tabComplete": " (Tab)",
  "chat.noCommandMatch": "Nenhum comando corresponde, digite /help para ver todos",
} satisfies Pick<Messages, keyof typeof zhChat>;
