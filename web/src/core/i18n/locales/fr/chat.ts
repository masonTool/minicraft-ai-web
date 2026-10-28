/**
 * 法语文案·chat（与 `locales/zh/chat.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-3：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`。
 * ⚠️ 值里的撇号统一写成排版撇号 `’`（`l’eau`），避免转义且符合法语排版。
 */

import type { Messages } from '../zh/index.ts';
import type { chat as zhChat } from '../zh/chat.ts';

export const chat = {
  "chat.send": "Envoyer",
  "command.usagePrefix": "Utilisation : ",
  "command.unknown": "Commande inconnue : /{name} (tapez /help pour la liste)",
  "command.unknownHelp": "Commande inconnue : {name}",
  "command.creativeOnly": "/{name} n’est disponible qu’en mode créatif",
  "command.empty": "Saisissez une commande, par exemple /help",
  "command.failed": "Erreur d’exécution : {message}",
  "command.listTitle": "Commandes disponibles ({count}) :",
  "chat.sendLabel": "Envoyer",
  "chat.collapse": "Toucher pour réduire",
  'chat.expandBadge': 'Déplier',
  "chat.expand": "Toucher pour agrandir",
  "chat.hintIdle": "Tapez une commande (/help pour la liste) ou parlez, puis « Envoyer »",
  "chat.hintIdleKeyboard": "Tapez une commande (/help) ou parlez · Entrée pour envoyer · Échap pour annuler",
  "chat.hintCommand": "« Envoyer » pour valider (pas de complétion au doigt, tapez les arguments en entier)",
  "chat.hintCommandKeyboard": "Tab pour compléter · Entrée pour envoyer · ↑↓ pour l’historique",
  "chat.candidates": "Suggestions : {list}{suffix}",
  "chat.tabComplete": " (Tab)",
  "chat.noCommandMatch": "Aucune commande correspondante, tapez /help pour la liste",
} satisfies Pick<Messages, keyof typeof zhChat>;
