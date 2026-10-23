/**
 * 联机世界的种子对齐（联机5）。
 *
 * 地形是由种子纯函数重现的：两边种子不同，等于在两个不一样的大陆上玩——
 * 坐标对得上、风景对不上，而且**方块改动会互相错位**（服务端记的是"他那边的
 * (x,y,z)"，落到我这边是另一格）。所以进服时以服务端种子为准：
 * 不一致就提示，并给出"用该种子新建多人世界 / 重载当前世界"两条路。
 *
 * 这里只放**能离线断言**的判定与换算，落盘与重载动作在 `main.ts`（要 WebGL）与
 * `boot()`（持有世界清单）里。
 */

import type { WorldSummary } from '../save/WorldRegistry.ts';

/** 一次种子冲突（两边不一致才存在） */
export interface SeedConflict {
  serverSeed: number;
  localSeed: number;
}

/**
 * 服务端种子与本地种子是否冲突。
 *
 * @param serverSeed `welcome` 里的种子；老服务端不带（null/undefined）时**不算冲突**
 *   ——那时只能沿用本地种子，提示了也没第二条路可走。
 */
export function seedConflict(serverSeed: number | null | undefined, localSeed: number): SeedConflict | null {
  if (serverSeed === null || serverSeed === undefined) return null;
  if (!Number.isFinite(serverSeed)) return null;
  if (serverSeed === localSeed) return null;
  return { serverSeed, localSeed };
}

/**
 * 用服务端种子重载之后，世界清单项该长什么样。
 *
 * 为什么不是"只把 seed 换掉"：种子换了等于地形整个换了一套，旧的
 * `edits`（改过多少格）与 `playTime` 都是另一片大陆上的成绩，留着只会让主菜单
 * 卡片显示"改了 8 万格"却进到一个新世界。`id` / 名字 / 世界类型 / 难度都保留——
 * 玩家认的是那个"世界"，不是那次地形。
 *
 * @param now 由调用方传入（纯函数不碰时钟，测试里才好断言）
 */
export function realignedWorldSummary(world: Readonly<WorldSummary>, serverSeed: number, now: number): WorldSummary {
  return {
    ...world,
    seed: serverSeed,
    edits: 0,
    playTime: 0,
    lastPlayed: now,
  };
}
