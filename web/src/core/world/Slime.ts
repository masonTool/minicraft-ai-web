/**
 * 史莱姆那几件事（批次 120）
 *
 * 归在一个模块里，是因为它们**同属一条链**："史莱姆区块里长出史莱姆 → 打死掉黏液球 →
 * 黏液球做粘性活塞与黏液块 → 黏液块把人弹起来"。分开写会散在四个地方，
 * 而它们之间那些数字（刷在哪、弹多高）是互相看的。
 *
 * 三块内容：
 *  1. **史莱姆区块**（`isSlimeChunk`）：原版那条"只有约 1/10 的区块会刷史莱姆"的规则。
 *     ⚠️ 本项目**不追求与正版逐格一致**（那是另一套 PRNG 序列），用的是自己那套
 *     确定性哈希（与 `Features.hashAt` 同源）——重要的是"同一格永远同一个答案"，
 *     存档重进、多人联机才对得上；
 *  2. **黏液块的弹跳**（`slimeBounceVelocity`）：落在黏液块上不受伤、按比例弹回去；
 *  3. 刷怪那条高度线（`SLIME_SPAWN_MAX_Y = 40`，原版史莱姆只在 y<40 刷）。
 */

import { hashAt } from '../gen/Features.ts';

/**
 * 这一列所在的区块是不是**史莱姆区块**。
 *
 * 原版是"每 10 个区块里有 1 个"，判据只与种子和区块坐标有关；这里用同一套确定性哈希
 * （`hashAt` 的取模）——**不追求与正版逐格一致**，但保证：
 *  - 同一格永远同一个答案（存档、联机、离线测试三处一致）；
 *  - 大约 1/10 的区块是史莱姆区块（这条有断言盯着，见 `test:slime`）。
 *
 * ⚠️ 取值用的是**区块坐标**（不是世界坐标）：原版也是按区块分的——
 * 同一区块里的 256 列共享同一个答案，玩家才能"记住哪一片刷史莱姆"。
 */
export function isSlimeChunk(seed: number, x: number, z: number): boolean {
  const chunkX = Math.floor(x / 16);
  const chunkZ = Math.floor(z / 16);
  // ⚠️ `hashAt` 返回的是 **[0, 1) 的浮点数**（不是整数），所以要乘了再取整——
  // 写成 `% 10 === 0` 会永远为假（浮点 `%` 得不到 0），症状是"史莱姆一只都不刷"
  // 而且**没有任何报错**。离线测试里那条"约 1/10"就是为它准备的。
  return Math.floor(hashAt(chunkX, chunkZ, seed ^ 0x51ed) * SLIME_CHUNK_ONE_IN) === 0;
}

/** 大约每几个区块有一个是史莱姆区块（原版是 1/10） */
export const SLIME_CHUNK_ONE_IN = 10;

/** 史莱姆的自然刷怪高度上限（原版 y<40） */
export const SLIME_SPAWN_MAX_Y = 40;

/**
 * 落在黏液块上时保留的竖直速度比例（原版 0.8）。
 *
 * 0.8 这个数决定了"能不能一路弹上去"：等于 1 就会越弹越高（增益），
 * 小于 1 则每次矮一点——原版取的就是"略小于 1"，所以弹几下就停了。
 */
export const SLIME_BOUNCE_FACTOR = 0.8;

/**
 * 落地速度 → 弹起速度（纯函数，好断言）。
 *
 * @param vy 落地那一瞬间的竖直速度（负值 = 往下）
 * @returns 弹起后的竖直速度（正值 = 往上）；速度太小就不弹（返回 0，站着不动）
 */
export function slimeBounceVelocity(vy: number): number {
  if (vy >= 0) return 0;
  const bounce = -vy * SLIME_BOUNCE_FACTOR;
  // 小于这个速度就不弹了：否则"站在黏液块上微微抖动"会一直触发
  return bounce < MIN_BOUNCE_SPEED ? 0 : bounce;
}

/** 低于这个速度不弹（原版也有这个"静止阈值"） */
export const MIN_BOUNCE_SPEED = 1.2;
