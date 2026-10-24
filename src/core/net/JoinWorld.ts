/**
 * 加入别人的房时，本地要加载哪个"世界"（L9）。
 *
 * 加入的人**不选世界**——地形由房主的那个世界决定。但没有世界对象就进不去游戏
 * （`startWorld` 要一个 `WorldSummary`：种子、类型、模式、难度），所以这里按房间的
 * 世界信息**临时造一个**：
 *
 *  · `id` 用 `mpjoin-<房间>`：它只是本地库名的前缀，不会进世界清单
 *    （`registry.update` 对未知 id 是空操作，卡片列表也就不会多出一个假世界）；
 *  · `name` 用房主的世界名（空则用房间名）——状态栏与面板上要写"你进的是谁的世界"；
 *  · 种子必须是房主给的那个，否则又是"两片大陆"。
 *
 * 纯函数（`now` 由调用方传入），`tests/join-world.test.ts` 离线断言。
 */

import { WORLD_TYPES, type WorldType } from '../gen/WorldType.ts';
import { GAME_MODES, type GameMode } from '../world/GameMode.ts';
import { DIFFICULTIES, type Difficulty } from '../world/Rules.ts';
import type { WorldSummary } from '../save/WorldRegistry.ts';
import type { NetWorldMeta } from '../../net/NetClient.ts';

/** 加入来的世界，本地 id 前缀（可反解出房间名，便于排查） */
export const JOIN_WORLD_PREFIX = 'mpjoin-';

/** 从"房间 + 房主的世界"造一个可直接进的世界项 */
export function summaryFromRoom(
  room: string,
  world: NetWorldMeta,
  now: number,
): WorldSummary {
  const mode = GAME_MODES.includes(world.mode as GameMode) ? (world.mode as GameMode) : 'survival';
  const difficulty = DIFFICULTIES.includes(world.difficulty as Difficulty)
    ? (world.difficulty as Difficulty)
    : 'normal';
  return {
    id: `${JOIN_WORLD_PREFIX}${room}`,
    name: world.name.trim().length > 0 ? world.name : room,
    seed: world.seed,
    // 世界类型也随 `welcome.world` 下发：它决定地形生成（超平坦 vs 默认），
    // 只对齐种子而不对齐类型，两边仍会是两片大陆
    worldType: WORLD_TYPES.includes(world.worldType as WorldType)
      ? (world.worldType as WorldType)
      : 'default',
    createdAt: now,
    lastPlayed: now,
    playTime: 0,
    edits: 0,
    difficulty,
    gameMode: mode,
  };
}
