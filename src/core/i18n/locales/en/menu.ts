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
  "world.saveFailed": "Save failed, please try again",
  "world.seedHint": "Enter a number as the seed, or leave it empty for a random one.",
  "world.survivalWarn": "{base} — in Survival, pick the default world or switch to Creative.",
  "world.typeHint.default": "Full world: biomes, trees, ores, villages, strongholds… recommended for Survival",
  "world.typeHint.amplified": "Everything the default world has, but with bigger terrain and taller mountains",
  "world.typeHint.flat": "Only three layers of flat ground: no trees, villages or ores (good for building/creative)",
  "world.typeHint.large_biomes": "A full world like the default, but biomes are about ×4 larger (you walk much further between them)",
  "world.typeHint.single_biome": "The same terrain as default, but the whole world is one biome (pick it below)",
  // ---- 多人游戏（联机9）：主菜单 / 暂停菜单的入口按钮 + 连接小面板
  'menu.multiplayer': 'Multiplayer',
  'mp.title': 'Multiplayer',
  'mp.server': 'Server address',
  'mp.serverHint': 'e.g. ws://192.168.1.5:8787; on the same LAN enter it and tap Host or Join',
  'mp.name': 'Nickname',
  'mp.host': 'Host',
  'mp.join': 'Join',
  'mp.disconnect': 'Disconnect',
  'mp.close': 'Close',
  'mp.hint': 'The host runs the world (redstone, mobs, containers); everyone else only renders. Press / to chat',
  'mp.status.idle': 'Not connected',
  'mp.status.connecting': 'Connecting…',
  'mp.status.connected': 'Connected',
  'mp.status.reconnecting': 'Reconnecting…',
  'mp.status.offline': 'Disconnected',
  'mp.error.url': 'The address must be ws:// or wss:// (ws:// is added automatically)',
} satisfies Pick<Messages, keyof typeof zhmenu>;
