/**
 * 箭的抛物线预测（批次 20261031-1108）
 *
 * 用户原话："箭飞得很快，打出去就没有了，我也不知道那个箭打到哪里去了。"
 * 于是拉弓时按**当前蓄力**算一条抛物线：撒一串点，落点再画个圈。
 *
 * 为什么抽成纯函数：
 *  ① 预览与 `Arrow` 的物理必须是**同一套数**——重力用 `ARROW_GRAVITY`、
 *    初速用 `arrowSpeedAt(charge)`。预览算错了比没有预览更糟（玩家会照着它瞄准）；
 *  ② 纯函数才能离线断言（"水平射 1 秒下坠约 10 格""撞到就停在撞点"）。
 *
 * ⚠️ 这里**不模拟**水中阻力、穿透附魔与生物命中：预览只回答"打到哪块地"。
 */

import { ARROW_GRAVITY } from './Arrow.ts';

export interface ArrowPathPoint {
  x: number;
  y: number;
  z: number;
}

/** 预览的时间步长（秒）。60 格/秒 × 0.02 = 每步 1.2 格，点距够密又不至于上百个点 */
export const TRAJECTORY_STEP = 0.02;
/** 最多模拟多少步（0.02 × 80 = 1.6 秒 ≈ 96 格，比视距内能打到的距离还远） */
export const TRAJECTORY_STEPS = 80;

/**
 * 从 `start` 以 `velocity` 射出，逐段前进直到 `blockedAt` 命中或步数用尽。
 *
 * @param blockedAt 这一格会不会挡住箭（主程序传"这一格可选中/有碰撞"）
 * @returns `landing` 为命中的那一刻位置（null = 射程内没有撞到任何东西）
 */
export function simulateArrowPath(
  start: ArrowPathPoint,
  velocity: ArrowPathPoint,
  blockedAt: (x: number, y: number, z: number) => boolean,
  step = TRAJECTORY_STEP,
  steps = TRAJECTORY_STEPS,
): { points: ArrowPathPoint[]; landing: ArrowPathPoint | null } {
  const points: ArrowPathPoint[] = [];
  let { x, y, z } = start;
  let { x: vx, y: vy, z: vz } = velocity;
  let landing: ArrowPathPoint | null = null;

  for (let i = 0; i < steps; i++) {
    vy -= ARROW_GRAVITY * step;
    const nx = x + vx * step;
    const ny = y + vy * step;
    const nz = z + vz * step;
    if (blockedAt(nx, ny, nz)) {
      // 停在**上一格**：命中点落在方块表面上，而不是穿进方块里
      landing = { x, y, z };
      break;
    }
    x = nx;
    y = ny;
    z = nz;
    points.push({ x, y, z });
  }

  return { points, landing };
}
