/**
 * 小游戏目录（小游戏3，批次 20261022-1954）
 *
 * 主菜单选择页列哪些游戏、每个游戏多少关——**唯一来源**。
 * 关卡页按 `levelCount` 生成按钮，进度按 `id` 记账，两边不会漂。
 *
 * 三条口径：
 *  1. 只列**给玩家玩**的游戏；`smoke`（框架自检）不在目录里。
 *  2. 图标直接用注册表里的方块（图集里本来就有），不另做素材。
 *  3. 不设"解锁顺序"：低龄玩家喜欢直接点第 10 关看是什么样，锁关只会让人放弃。
 */

import { Block } from '../core/registry/blocks.ts';
import type { MiniGameId } from './types.ts';

export interface MiniGameEntry {
  readonly id: MiniGameId;
  readonly titleKey: string;
  readonly descKey: string;
  readonly levelCount: number;
  /** 卡片图标用的方块 */
  readonly iconBlockId: number;
}

export const MINIGAME_CATALOG: readonly MiniGameEntry[] = [
  {
    id: 'sokoban',
    titleKey: 'minigame.sokoban.title',
    descKey: 'minigame.sokoban.desc',
    levelCount: 10,
    iconBlockId: Block.CHEST,
  },
  {
    id: 'breakout',
    titleKey: 'minigame.breakout.title',
    descKey: 'minigame.breakout.desc',
    levelCount: 10,
    iconBlockId: Block.BRICKS,
  },
];

export function miniGameEntry(id: string): MiniGameEntry | null {
  return MINIGAME_CATALOG.find((entry) => entry.id === id) ?? null;
}
