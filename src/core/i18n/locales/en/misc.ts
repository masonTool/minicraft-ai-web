/**
 * 英文文案·misc（与 `locales/zh/misc.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P0-3：这里的类型是 `satisfies Pick<Messages, keyof typeof zhXxx>`——
 * 中文那边加一条键、这边没跟上，`npm run typecheck` 直接报错，不必等测试跑起来。
 * 搬运规则：只搬不改，英文一个字都没动。
 */

import type { Messages } from '../zh/index.ts';
import type { misc as zhmisc } from '../zh/misc.ts';

export const misc = {
  'pause.title': 'Game Paused',
  'pause.resume': 'Resume Game',
  'pause.settings': 'Settings',
  'pause.achievements': 'Advancements',
  'pause.statistics': 'Statistics',
  'pause.exit': 'Save & Quit to Title',
  'unit.item': 'items',
  'unit.bottle': 'bottles',
  'fullscreen.rotateTitle': 'Please rotate your device',
  'fullscreen.rotateDetail': 'Tap to go fullscreen · rotating the phone starts it too',
  'fullscreen.rotateIosDetail': 'Rotate the phone; for fullscreen use Share → Add to Home Screen',
  'install.hint': 'Add to Home Screen to launch straight into fullscreen landscape',
  'install.add': 'Add',
  'install.later': 'Later',
  'install.iosHint': 'Safari cannot fullscreen a web page directly: tap Share → Add to Home Screen, then open from the Home Screen icon.',
  'install.iosOk': 'Got it',
  'death.title': 'You died!',
  'death.respawning': 'Respawning…',
  'sleep.dawn': 'Dawn is coming',
  'sleep.hint': 'Press jump to get up early',
  'sleep.lieDown': 'You lie down… (press jump or tap the overlay to get up early)',
  "touch.sneak": "Sneak",
  "touch.flyUp": "Fly up",
  "touch.flyDown": "Fly down",
  "touch.hint": "Joystick to walk · double-tap it to sneak · drag to look · tap to place · hold to mine/use · double-tap jump to fly (up/down buttons appear while flying)",
  "touch.icon.jump": "Jump",
  "touch.icon.sneak": "Sneak",
  "touch.icon.inventory": "Inventory",
  "touch.icon.chat": "Chat & commands",
  "touch.icon.pause": "Pause & settings",
  "touch.icon.view": "Change view",
  "tooltip.unstackable": "Not stackable",
  "tooltip.maxStack": "Up to {n} per slot",
  "loading.world": "Generating world…",
  "loading.failed": "Loading failed — please refresh the page",
} satisfies Pick<Messages, keyof typeof zhmisc>;
