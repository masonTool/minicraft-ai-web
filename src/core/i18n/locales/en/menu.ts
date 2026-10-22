/**
 * 英文文案·menu（与 `locales/zh/menu.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P0-3：这里的类型是 `satisfies Pick<Messages, keyof typeof zhXxx>`——
 * 中文那边加一条键、这边没跟上，`npm run typecheck` 直接报错，不必等测试跑起来。
 * 搬运规则：只搬不改，英文一个字都没动。
 */

import type { Messages } from '../zh/index.ts';
import type { menu as zhmenu } from '../zh/menu.ts';

export const menu = {
  'menu.tagline': 'Survival, Creative and Multiple Worlds',
  'menu.play': 'Play',
  'menu.settings': 'Settings',
  'menu.footer': 'Unofficial web remake · saves live on this device',
  'menu.newWorld': '+ New World',
  'menu.empty': 'No worlds yet — use “+ New World” above to create one.',
  'menu.back': '‹ Back',
  'menu.cancel': 'Cancel',
  'menu.reroll': 'Random',
  'menu.create': 'Create & Enter',
  'world.list': 'Worlds',
  'world.name': 'World Name',
  'world.seed': 'Seed',
  'world.type': 'World Type',
  'world.biome': 'Biome',
  'world.difficulty': 'Difficulty',
  'world.gameMode': 'Game Mode',
  'world.hardcore': 'Hardcore',
  'world.hardcoreOff': 'Normal',
  'world.hardcoreOn': 'Hardcore',
  'world.namePlaceholder': 'Leave blank to auto-name',
  'world.seedPlaceholder': 'Blank = random',
  'world.hint': 'Same seed means same terrain; a superflat world is a single grass layer.',
  'world.createTitle': 'Create World',
  'world.enter': 'Enter',
  'world.edit': 'Edit',
  'world.editTitle': 'Edit World',
  'world.save': 'Save',
  'world.editHint': 'Mode and difficulty take effect next time you enter.',
  'world.delete': 'Delete',
  'world.export': 'Export',
  'world.import': 'Import Save',
  // ---- mini-game menu (batch 20261022-1954)
  'menu.minigames': 'Mini-games',
} satisfies Pick<Messages, keyof typeof zhmenu>;
