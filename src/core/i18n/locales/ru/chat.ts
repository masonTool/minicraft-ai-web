/**
 * 俄语文案·chat（与 `locales/zh/chat.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-2：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { chat as zhChat } from '../zh/chat.ts';

export const chat = {
  "chat.send": "Отправить",
  "command.usagePrefix": "Использование: ",
  "command.unknown": "Неизвестная команда: /{name} (введите /help, чтобы увидеть все)",
  "command.unknownHelp": "Неизвестная команда: {name}",
  "command.creativeOnly": "/{name} работает только в творческом режиме",
  "command.empty": "Введите команду, например /help",
  "command.failed": "Ошибка выполнения команды: {message}",
  "command.listTitle": "Доступные команды ({count}):",
  "chat.sendLabel": "Отправить",
  "chat.collapse": "Нажмите, чтобы свернуть",
  "chat.expand": "Нажмите, чтобы развернуть",
  "chat.hintIdle": "Введите команду (/help — все команды) или просто напишите и нажмите «Отправить»",
  "chat.hintIdleKeyboard": "Введите команду (/help — все команды) или напишите: Enter отправляет, Esc отменяет",
  "chat.hintCommand": "Нажмите «Отправить» (на телефоне нет автодополнения по Tab, параметры вводите целиком)",
  "chat.hintCommandKeyboard": "Tab дополняет параметры · Enter отправляет · ↑↓ история",
  "chat.candidates": "Варианты: {list}{suffix}",
  "chat.tabComplete": " (дополнение по Tab)",
  "chat.noCommandMatch": "Подходящих команд нет, введите /help, чтобы увидеть все",
} satisfies Pick<Messages, keyof typeof zhChat>;
