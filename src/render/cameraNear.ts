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

/** 点到轴对齐盒子的最短距离与"由面指向点"的单位方向（点在盒内 = 距离 0、方向零向量） */
interface BoxClearance {
  distance: number;
  nx: number;
  ny: number;
  nz: number;
}

/**
 * 相机到最近碰撞面的**距离 + 推出方向**（批次 20261026-0141）。
 *
 * `cameraClearance` 只给距离，够算 near；但"相机停在墙角、侧墙只剩 1 厘米"时，
 * 光知道距离没法自救 —— 需要一个"往哪边退"的方向，才能把相机推出墙面
 * （见 `pushCameraOutOfWalls`）。判定口径与 `cameraClearance` 完全一致。
 */
export interface CameraClearance {
  /** 到最近碰撞盒的距离（格；点在盒内 = 0） */
  distance: number;
  /** 从最近的面指向相机的单位方向；距离 0（在盒内）时为零向量 */
  nx: number;
  ny: number;
  nz: number;
}

/** `cameraClearance` 的完整版：同时给出距离与推出方向 */
export function cameraClearanceInfo(
  world: CollisionWorld,
  x: number,
  y: number,
  z: number,
  radius: number = CAMERA_PROBE_RADIUS,
): CameraClearance {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);
  let best: CameraClearance = { distance: Infinity, nx: 0, ny: 0, nz: 0 };

  const consider = (box: BoxClearance): void => {
    if (box.distance < best.distance) best = box;
  };

  for (let vy = by - radius; vy <= by + radius; vy++) {
    for (let vz = bz - radius; vz <= bz + radius; vz++) {
      for (let vx = bx - radius; vx <= bx + radius; vx++) {
        const collision = world.collisionAt(vx, vy, vz);
        if (collision === null) continue;
        if (collision === 'full') {
          consider(offsetBox(x, y, z, FULL_BOX, vx, vy, vz));
          continue;
        }
        for (const box of collision) consider(offsetBox(x, y, z, box, vx, vy, vz));
      }
    }
  }

  return best;
}

/** 单位盒子（碰撞盒的 'full' 分支用） */
const FULL_BOX: readonly number[] = [0, 0, 0, 1, 1, 1];

function offsetBox(
  x: number,
  y: number,
  z: number,
  box: readonly number[],
  vx: number,
  vy: number,
  vz: number,
): BoxClearance {
  const cx = Math.min(Math.max(x, vx + box[0]!), vx + box[3]!);
  const cy = Math.min(Math.max(y, vy + box[1]!), vy + box[4]!);
  const cz = Math.min(Math.max(z, vz + box[2]!), vz + box[5]!);
  const dx = x - cx;
  const dy = y - cy;
  const dz = z - cz;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance === 0) return { distance: 0, nx: 0, ny: 0, nz: 0 };
  return { distance, nx: dx / distance, ny: dy / distance, nz: dz / distance };
}

/**
 * 把相机沿"最近面的法线"推出去（批次 20261026-0141）。
 *
 * 为什么需要：第三人称相机的射线**只朝背后那一个方向**打，撞到后墙就停在 0.22 格前 ——
 * 但玩家背靠墙角时，相机离**侧墙**可能只有 1~2 厘米。近裁面的下限是 0.02，比这还大，
 * 于是侧墙那个面被裁掉；而方块相邻面是背向剔除的，一裁就"看见墙皮后面还有一个世界"。
 *
 * 这里做的是**几何修复**而不是降 near：把相机推离最近的面到 `minClearance`，
 * 画面不变（相机只挪几厘米），也不会像调 near 那样牺牲全局深度精度。
 *
 * @returns 累计推出的距离；`-1` 表示相机已经在方块内部（推不出去，交给色罩兜底）。
 */
export function pushCameraOutOfWalls(
  world: CollisionWorld,
  position: { x: number; y: number; z: number },
  minClearance: number = NEAR_MARGIN,
  iterations = 3,
): number {
  let pushed = 0;
  for (let i = 0; i < iterations; i++) {
    const info = cameraClearanceInfo(world, position.x, position.y, position.z);
    if (info.distance >= minClearance) return pushed;
    if (info.distance <= 0) return -1;
    // 多推 1 毫米：正好推到面上时浮点比较仍可能算"贴住"
    const step = minClearance - info.distance + 0.001;
    position.x += info.nx * step;
    position.y += info.ny * step;
    position.z += info.nz * step;
    pushed += step;
  }
  return pushed;
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
  return cameraClearanceInfo(world, x, y, z, radius).distance;
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
