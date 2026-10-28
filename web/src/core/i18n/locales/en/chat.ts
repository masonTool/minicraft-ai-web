/**
 * 英文文案·chat（与 `locales/zh/chat.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P0-3：这里的类型是 `satisfies Pick<Messages, keyof typeof zhXxx>`——
 * 中文那边加一条键、这边没跟上，`npm run typecheck` 直接报错，不必等测试跑起来。
 * 搬运规则：只搬不改，英文一个字都没动。
 */

import type { Messages } from '../zh/index.ts';
import type { chat as zhchat } from '../zh/chat.ts';

export const chat = {
  'chat.send': 'Send',
  'command.usagePrefix': 'Usage: ',
  'command.unknown': "Unknown command: /{name} (type /help for the list)",
  'command.unknownHelp': 'Unknown command: {name}',
  'command.creativeOnly': '/{name} can only be used in creative mode',
  'command.empty': 'Type a command, e.g. /help',
  'command.failed': 'Command failed: {message}',
  'command.listTitle': 'Available commands ({count}):',
  // ---- 命令运行时反馈（批次 617 后续）：直接由 src/core/commands/messages.ts 生成 ----
  'chat.sendLabel': 'Send',
  'chat.collapse': 'Click to collapse',
  'chat.expandBadge': 'Expand',
  'chat.expand': 'Click to expand',
  'chat.hintIdle': 'Type a command (/help for the list) or just talk; tap Send to post',
  'chat.hintIdleKeyboard': 'Type a command (/help for the list) or just talk; Enter to post, Esc to cancel',
  'chat.hintCommand': 'Tap Send to post (no Tab completion on phones — type arguments in full)',
  'chat.hintCommandKeyboard': 'Tab fills arguments · Enter posts · ↑↓ history',
  'chat.candidates': 'Matches: {list}{suffix}',
  'chat.tabComplete': ' (Tab to fill)',
  'chat.noCommandMatch': 'No matching command — type /help to see all',
} satisfies Pick<Messages, keyof typeof zhchat>;
