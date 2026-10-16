/**
 * 刷怪笼的生成规则（批次 92）
 *
 * 拆成纯函数（世界视图注入）的理由与 `VillagePopulation.ts` 完全一样：
 * "会不会多刷 / 漏刷 / 刷进墙里"这三件事**离线就能断言**，
 * 而主线程那一侧只剩"读真世界、看活着的实体、造实体"三件纯函数做不了的事。
 *
 * 判定顺序（原版的思路，简化版）：
 *   1. 玩家在 `activeRadius` 以内（太远就完全不工作，省掉扫描）；
 *   2. 附近同种生物少于 `maxNearby`（否则会越刷越多，而且**不报错**）；
 *   3. 在笼子周围 `spawnRange` 内找一个**站得下的位置**：那一格与它上面一格是空气、
 *      下面一格是实心方块（烈焰人会飞，但**出生点仍然要有落脚地**——
 *      不然它会卡在墙里被物理推出来，看着像"从方块里钻出来"）。
 *
 * ⚠️ 扫描顺序是**固定**的（由近到远、先水平后竖直），所以"同一个笼子算出来的落点"
 * 每次一样——这与村庄人口那条"顺序固定所以可复现"是同一条讲究。
 */

import { Block, blockDef } from '../registry/blocks.ts';
import type { SpawnerDef } from '../registry/spawners.ts';

/** 主线程那一侧要提供的东西 */
export interface SpawnerWorldView {
  getBlock(x: number, y: number, z: number): number;
  /** 玩家位置；不在任何维度/未加载时为 null */
  player: { x: number; y: number; z: number } | null;
  /** 这一带**已经**有几只这种生物了（主线程从实体表数） */
  mobsNear(x: number, y: number, z: number, radius: number, mobId: string): number;
}

/** 一个刷怪笼的位置 */
export interface SpawnerPos {
  x: number;
  y: number;
  z: number;
}

/**
 * 算一次：这个笼子现在该不该生成、生成在哪。
 * @returns 落点（整数格坐标，调用方负责 +0.5 落到格心）；不该生成时 null
 */
export function planSpawnerSpawn(
  view: SpawnerWorldView,
  def: SpawnerDef,
  spawner: SpawnerPos,
): SpawnerPos | null {
  const player = view.player;
  if (!player) return null;
  // 玩家在 16 格以内才工作（用**三维**距离：玩家在正上方 16 格也算近）
  const far = Math.hypot(player.x - spawner.x, player.y - spawner.y, player.z - spawner.z);
  if (far > def.activeRadius) return null;

  if (view.mobsNear(spawner.x, spawner.y, spawner.z, def.radius, def.mobId) >= def.maxNearby) return null;

  // 由近到远找落点：`r` 是切比雪夫半径，所以"贴着笼子"的格子一定先被看到
  for (let r = 1; r <= def.spawnRange; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        // 只看这一圈（半径正好是 r 的那一圈），否则靠近的格子会被反复检查
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        // 先看笼子同一层，再看上面一层、下面一层
        for (const dy of [0, 1, -1]) {
          const x = spawner.x + dx;
          const y = spawner.y + dy;
          const z = spawner.z + dz;
          if (view.getBlock(x, y, z) !== Block.AIR) continue;
          // 生物身高 1.8：上面那格也必须是空气
          if (view.getBlock(x, y + 1, z) !== Block.AIR) continue;
          if (!blockDef(view.getBlock(x, y - 1, z)).solid) continue;
          return { x, y, z };
        }
      }
    }
  }
  return null;
}
