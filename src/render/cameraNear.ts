/**
 * 自适应相机近裁面（批次 20261025-0256）
 *
 * 用户报的"进山洞 / 进石头里会看到一个透明半透明的世界"是**近裁面切掉了眼前的方块面**：
 * 相邻两个实心格之间的那一面是背向剔除的，近裁面一旦把它裁掉，屏幕上就没有东西挡着，
 * 直接看到"墙皮后面的世界"。
 *
 * 根因是 `CAMERA_NEAR = 0.25` 这个常量的前提不成立——它假设"眼睛在方块中心、最近的面
 * 也在 0.5 格外"，但：
 *   - 眼睛在脚底 +1.62（潜行 1.27、爬行 0.6），不是方块中心；
 *   - 撞天花板时 `resolveVertical` 让头顶**正好贴住**天花板（两格高的洞里跳一下，
 *     眼到天花板只剩 0.18）。
 *
 * 于是这里的做法不是"把 near 全局调小"（那会白丢批次 520 拿到的深度精度，
 * 远景共面闪烁会回来），而是**每帧量一次相机到最近碰撞面的距离，贴脸时才收缩**：
 *
 *   clearance（格）  near
 *   0.30（贴墙走）   0.25 ← 不动，保住深度精度
 *   0.23（半砖下蹲） 0.18
 *   0.18（洞里跳）   0.13
 *   0（埋在方块里）  下限（几何上救不了，交给 `ScreenEffects` 的 suffocate 色罩）
 *
 * ⚠️ 改 `near` **不改变画面**，只改变深度映射与裁剪（透视投影的 x/y 与 near 无关），
 * 所以收缩是"无感"的——不会像改 FOV 那样跳一下。
 *
 * 两条独立路径，本模块只管第一条：
 *   1. 相机在外面、但离面太近 → 收缩 near（本模块）；
 *   2. 相机**真的**进了实心方块（沙子砸头 / 活塞推 / 传送落点）→ 那面是背面、已被剔除，
 *      near 调到多小都没用，靠 `ScreenEffects` 的 suffocate 色罩盖住。
 */

import { CAMERA_NEAR } from './Sky.ts';
import type { CollisionWorld } from '../core/physics/AABB.ts';

/**
 * 探针的邻域半径（格）。1 = 3×3×3 共 27 次 `collisionAt`，与每帧的准星射线一个量级。
 *
 * 为什么是 1 就够：近裁面只在 0.25 以内才有意义，而 0.25 格的面必定落在**相机所在格
 * 或紧邻的那一格**里，再远的格子不可能给出更小的距离（半径 1 的邻域已经覆盖了
 * 距离 ≤ 1 的所有碰撞盒）。
 */
export const CAMERA_PROBE_RADIUS = 1;

/**
 * 近裁面与最近那个面之间留的余量（格）。
 *
 * 不能取 0：`collisionAt` 给的是**碰撞盒**，而少数方块的可见几何比碰撞盒略大
 * （仙人掌的碰撞盒是 14/16，可见面还要往外 1/16）。留 0.05 才能连这类也一起罩住；
 * 再往上加就白压深度精度了（0.30 那一档本来还能保持 0.25）。
 */
export const NEAR_MARGIN = 0.05;

/**
 * 近裁面的下限（格）。
 *
 * 再往下压没意义：贴到 0.02 还在透视的，一定是"相机在方块内部"（背面剔除），
 * 那种情况由 suffocate 色罩兜底；而 near 每小一倍，深度精度就再丢一半。
 */
export const CAMERA_NEAR_MIN = 0.02;

/** 点到轴对齐盒子的最短距离（点在盒内 = 0；正好贴面也按 0 算） */
function distanceToBox(
  x: number,
  y: number,
  z: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number {
  const dx = Math.max(minX - x, x - maxX, 0);
  const dy = Math.max(minY - y, y - maxY, 0);
  const dz = Math.max(minZ - z, z - maxZ, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 相机位置到**最近碰撞盒**的距离（格）。
 *
 * - 用碰撞盒而不是"非空气格"：水 / 岩浆 / 火 / 藤蔓 / 蛛网没有碰撞盒，不该把 near 拖下来
 *   （贴着水看不该牺牲深度精度）；
 * - 台阶 / 楼梯 / 雪层这类非完整方块按**局部盒子**算距离，所以蹲在半砖天花板下量到的
 *   是到半砖顶面（0.23）而不是整格顶面（0.73）——用整格算就会"该收缩时不收缩"；
 * - 点在盒内返回 0（调用方据此走 suffocate 色罩）；
 * - 邻域里没有任何碰撞盒返回 `Infinity`（正常站在空地上就是这一档）。
 *
 * 用**到盒子最短距离**而不是"沿视线的命中距离"：`最短距离 ≤ 任意方向的命中距离`，
 * 所以只要 `near < 最短距离`，任何朝向都不会裁掉那个面——不需要把视线传进来。
 */
export function cameraClearance(
  world: CollisionWorld,
  x: number,
  y: number,
  z: number,
  radius: number = CAMERA_PROBE_RADIUS,
): number {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);
  let best = Infinity;

  for (let vy = by - radius; vy <= by + radius; vy++) {
    for (let vz = bz - radius; vz <= bz + radius; vz++) {
      for (let vx = bx - radius; vx <= bx + radius; vx++) {
        const collision = world.collisionAt(vx, vy, vz);
        if (collision === null) continue;
        if (collision === 'full') {
          const d = distanceToBox(x, y, z, vx, vy, vz, vx + 1, vy + 1, vz + 1);
          if (d < best) best = d;
          continue;
        }
        for (const box of collision) {
          const d = distanceToBox(
            x,
            y,
            z,
            vx + box[0],
            vy + box[1],
            vz + box[2],
            vx + box[3],
            vy + box[4],
            vz + box[5],
          );
          if (d < best) best = d;
        }
      }
    }
  }

  return best;
}

/**
 * 由间隙算出近裁面：`clamp(clearance - 余量, 下限, CAMERA_NEAR)`。
 *
 * 间隙够宽时**原样返回 `CAMERA_NEAR`**（保住深度精度），只有贴脸时才收缩。
 * 非有限值（空场 = `Infinity`、`NaN`）也走上限。
 */
export function nearPlaneFor(clearance: number): number {
  if (!Number.isFinite(clearance)) return CAMERA_NEAR;
  return Math.min(CAMERA_NEAR, Math.max(CAMERA_NEAR_MIN, clearance - NEAR_MARGIN));
}
