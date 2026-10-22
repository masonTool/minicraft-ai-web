/**
 * 小游戏目录（J0，批次 20261022-2220）
 *
 * 主菜单选择页列哪些游戏——**唯一来源**。这一期只剩一个「跳一跳」（无尽模式，没有关卡）。
 *
 * 三条口径：
 *  1. 只列**给玩家玩**的游戏；`smoke`（框架自检）不在目录里。
 *  2. 图标直接用注册表里的方块（图集里本来就有），不另做素材。
 *  3. 不做"解锁 / 关卡"：跳一跳是无尽模式，卡片点下去直接开局。
 */

import { Block } from '../core/registry/blocks.ts';
import type { MiniGameId } from './types.ts';

export interface MiniGameEntry {
  readonly id: MiniGameId;
  readonly titleKey: string;
  readonly descKey: string;
  /** 卡片图标用的方块 */
  readonly iconBlockId: number;
}

export const MINIGAME_CATALOG: readonly MiniGameEntry[] = [
  {
    id: 'jump',
    titleKey: 'minigame.jump.title',
    descKey: 'minigame.jump.desc',
    iconBlockId: Block.GRASS_BLOCK,
  },
];

export function miniGameEntry(id: string): MiniGameEntry | null {
  return MINIGAME_CATALOG.find((entry) => entry.id === id) ?? null;
}
