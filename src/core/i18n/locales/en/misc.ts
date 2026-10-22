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
} satisfies Pick<Messages, keyof typeof zhmisc>;
