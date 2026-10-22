/**
 * 推箱子的 10 关（小游戏4，批次 20261022-1954）
 *
 * 全是 7×7 的单层小关卡：横屏手机一屏能看全，格子也够大（手指点得准）。
 * 难度按"推动次数 + 需要绕路"递增，前两关各 1~2 步就能过——第一关必须
 * **一眼看懂玩法**，否则低龄玩家不会玩第二关。
 *
 * 每条都通过 `parseLevel` 的校验（起点唯一、有目标、字符合法），
 * 并且 `tools/minigame-test.ts` 里的 BFS 会把"可解"钉死——
 * 手写关卡最容易出的错就是"看起来能推，其实卡死"。
 */

import type { RawLevel } from '../../level.ts';

/** 7×7 边框墙：每关都从这张底图开始改内部 5×5 */
function frame(rows: readonly [string, string, string, string, string]): RawLevel['rows'] {
  return [['#######', `#${rows[0]}#`, `#${rows[1]}#`, `#${rows[2]}#`, `#${rows[3]}#`, `#${rows[4]}#`, '#######']];
}

export const SOKOBAN_LEVELS: readonly RawLevel[] = [
  {
    id: 'sokoban-1',
    width: 7,
    height: 1,
    depth: 7,
    stepLimit: 20,
    // 教学关：往上推一格就赢
    rows: frame(['.....', '..G..', '..B..', '..P..', '.....']),
  },
  {
    id: 'sokoban-2',
    width: 7,
    height: 1,
    depth: 7,
    stepLimit: 30,
    // 先往上推，再绕到左边往右推
    rows: frame(['.....', '...G.', '.B...', '.P...', '.....']),
  },
  {
    id: 'sokoban-3',
    width: 7,
    height: 1,
    depth: 7,
    stepLimit: 60,
    // 两个箱子各推一次
    rows: frame(['.....', '.G.G.', '.....', '.B.B.', '..P..']),
  },
  {
    id: 'sokoban-4',
    width: 7,
    height: 1,
    depth: 7,
    stepLimit: 60,
    // 两个箱子、一个目标：多出来的箱子不碍事
    rows: frame(['.....', '..G..', '.B.B.', '..P..', '.....']),
  },
  {
    id: 'sokoban-5',
    width: 7,
    height: 1,
    depth: 7,
    stepLimit: 80,
    // 中间有柱子，必须绕到侧面推
    rows: frame(['.....', '..G..', '..#..', '..B..', '..P..']),
  },
  {
    id: 'sokoban-6',
    width: 7,
    height: 1,
    depth: 7,
    stepLimit: 80,
    // 目标贴墙，箱子要先横推再上推
    rows: frame(['.....', 'G#.#G', '.B.B.', '..P..', '.....']),
  },
  {
    id: 'sokoban-7',
    width: 7,
    height: 1,
    depth: 7,
    stepLimit: 90,
    // 三个箱子、三个方向
    rows: frame(['.G.G.', '..P..', '.B.B.', '..B..', '..G..']),
  },
  {
    id: 'sokoban-8',
    width: 7,
    height: 1,
    depth: 7,
    stepLimit: 80,
    // 柱子把两个箱子分开
    rows: frame(['.G.G.', '.....', '.B#B.', '..P..', '.....']),
  },
  {
    id: 'sokoban-9',
    width: 7,
    height: 1,
    depth: 7,
    stepLimit: 120,
    // 窄通道：只能先横推进通道，再一路往上
    rows: frame(['.....', 'G...G', '.#.#.', '.B.B.', '..P..']),
  },
  {
    id: 'sokoban-10',
    width: 7,
    height: 1,
    depth: 7,
    stepLimit: 120,
    // 综合关：先挪开挡路的箱子，才能走到上半区
    rows: frame(['G...G', '.#.#.', '.B.B.', '..B..', '..P..']),
  },
];

export const SOKOBAN_LEVEL_COUNT = SOKOBAN_LEVELS.length;

/** 取第 `index` 关（越界时夹到最后一关，不抛错） */
export function sokobanLevel(index: number): RawLevel {
  const safe = Number.isFinite(index) ? Math.max(0, Math.min(SOKOBAN_LEVELS.length - 1, Math.floor(index))) : 0;
  return SOKOBAN_LEVELS[safe]!;
}
