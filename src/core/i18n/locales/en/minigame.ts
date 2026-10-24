/**
 * 英文文案·minigame（与 `locales/zh/minigame.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P0-3：这里的类型是 `satisfies Pick<Messages, keyof typeof zhXxx>`——
 * 中文那边加一条键、这边没跟上，`npm run typecheck` 直接报错，不必等测试跑起来。
 * 搬运规则：只搬不改，英文一个字都没动。
 */

import type { Messages } from '../zh/index.ts';
import type { minigame as zhminigame } from '../zh/minigame.ts';

export const minigame = {
  // ---- first-run guide (batch 20261022-1954)
  'tutorial.progress': 'Step {current} of {total}',
  'tutorial.collapse': 'Collapse',
  'tutorial.expand': 'Expand',
  'tutorial.dismiss': "Don't show again",
  'tutorial.finish': 'All done — go build something!',
  // ---- mini-games (batch 20261022-1954)
  'minigame.exit': 'Exit',
  'minigame.crashed': 'The mini-game hit an error and closed',
  'minigame.smoke.title': 'Framework check',
  'minigame.smoke.hint': 'Tap to toggle (framework check)',
  'minigame.smoke.won': 'Cleared!',
  'minigame.smoke.playing': 'Continue',
  'minigame.menu.title': 'Mini-games',
  'minigame.menu.back': '‹ Back',
  'minigame.menu.best': 'Best {best}',
  // ---- jump (batch 20261022-2220)
  'minigame.jump.title': 'Jump',
  'minigame.jump.desc': 'Hold to charge, release to jump',
  'minigame.jump.best': 'Best {best}',
  'minigame.jump.over': 'Score',
  'minigame.jump.retry': 'Play again',
  'minigame.jump.record': 'New best!',
  'tutorial.survival.log.title': 'Chop a tree first',
  'tutorial.survival.log.desc': 'Walk up to a trunk and hold to break it',
  'tutorial.survival.table.title': 'Craft a crafting table',
  'tutorial.survival.table.desc': 'Combine 4 planks in your inventory',
  'tutorial.survival.woodPickaxe.title': 'Craft a wooden pickaxe',
  'tutorial.survival.woodPickaxe.desc': '3 planks + 2 sticks',
  'tutorial.survival.stonePickaxe.title': 'Mine stone, craft a stone pickaxe',
  'tutorial.survival.stonePickaxe.desc': 'Mine cobblestone with the wooden pickaxe, then craft (stone is a few blocks down)',
  'tutorial.creative.place10.title': 'Place 10 blocks',
  'tutorial.creative.place10.desc': 'Pick a block from the hotbar and tap the ground',
  'tutorial.creative.layers.title': 'Stack 3 layers high',
  'tutorial.creative.layers.desc': 'Build upward and see how tall it gets',
  'tutorial.creative.colors.title': 'Use 3 different blocks',
  'tutorial.creative.colors.desc': 'Try blocks in different colours',
  'tutorial.creative.door.title': 'Add a door',
  'tutorial.creative.door.desc': 'Put a door in a wall so you can get in and out',
} satisfies Pick<Messages, keyof typeof zhminigame>;
