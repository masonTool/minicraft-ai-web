/**
 * 远端方块改动落到本地时的去向判定（联机4）。
 *
 * 为什么需要单独一条判定：服务端的 `block` 广播是不管你视野的——队友在他那边
 * 挖掉一格、改一堆、第 200 格，都会原样发给你。而本地只有"当前维度 + 已加载
 * 区块"能立刻写。原来的写法是 `if (!isLoaded) return`，于是**区块一加载就丢改动**
 * （区块生成是种子重现的，玩家走过去看到的还是没被改过的地形，只有重连能补）。
 *
 * 现在的口径：一律先记进增量表（`world.edits`），区块以后加载时 `World.onGenerated`
 * 会用 `applyTo` 把增量叠回去；只有"同维度 + 已加载"才额外立刻写世界（顺带刷光照与网格）。
 * 不同维度的改动同样只记增量：玩家以后切过去，那批改动自然补上。
 *
 * 越界高度直接丢：`Chunk.index` 对 y 越界会算出别的格子的下标，记进去就是
 * "改了一格不相干的方块"，比丢掉更难查。
 */

import { WORLD_MAX_Y, WORLD_MIN_Y } from '../world/Chunk.ts';

/** 收到远端方块改动后该做什么 */
export type RemoteBlockAction =
  /** 同维度且区块已加载：立刻写世界 + 记增量 */
  | 'apply'
  /** 只记增量：等区块加载（或以后切到那个维度）时由 `world.edits.applyTo` 补上 */
  | 'buffer'
  /** y 越界：不记也不写 */
  | 'drop';

export function planRemoteBlock(
  editDimension: string,
  currentDimension: string,
  loaded: boolean,
  y: number,
): RemoteBlockAction {
  // 越界的 y 连"记增量"都不能做：区块内下标会落到别的格子上去
  if (!Number.isFinite(y) || y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return 'drop';
  if (editDimension !== currentDimension) return 'buffer';
  return loaded ? 'apply' : 'buffer';
}
