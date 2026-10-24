/**
 * 德语文案·chat（与 `locales/zh/chat.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-1：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { chat as zhChat } from '../zh/chat.ts';

export const chat = {
  "chat.send": "Senden",
  "command.usagePrefix": "Verwendung: ",
  "command.unknown": "Unbekannter Befehl: /{name} (tippe /help für alle)",
  "command.unknownHelp": "Unbekannter Befehl: {name}",
  "command.creativeOnly": "/{name} funktioniert nur im Kreativmodus",
  "command.empty": "Bitte einen Befehl eingeben, z. B. /help",
  "command.failed": "Fehler beim Ausführen: {message}",
  "command.listTitle": "Verfügbare Befehle ({count}):",
  "chat.sendLabel": "Senden",
  "chat.collapse": "Zum Einklappen tippen",
  'chat.expandBadge': 'Ausklappen',
  "chat.expand": "Zum Ausklappen tippen",
  "chat.hintIdle": "Befehl eingeben (/help zeigt alle) oder einfach schreiben, dann „Senden\"",
  "chat.hintIdleKeyboard": "Befehl eingeben (/help zeigt alle) oder schreiben, Enter sendet, Esc bricht ab",
  "chat.hintCommand": "„Senden\" tippen (auf dem Handy gibt es keine Tab-Vervollständigung)",
  "chat.hintCommandKeyboard": "Tab vervollständigt · Enter sendet · ↑↓ Verlauf",
  "chat.candidates": "Vorschläge: {list}{suffix}",
  "chat.tabComplete": " (Tab-Vervollständigung)",
  "chat.noCommandMatch": "Kein Befehl gefunden, tippe /help für alle",
} satisfies Pick<Messages, keyof typeof zhChat>;
