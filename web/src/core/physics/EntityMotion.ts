/**
 * 通用实体运动解析
 *
 * 与玩家物理共用同一套"逐轴移动 + 立即推出"的思路，但实体没有自动上台阶，
 * 也不区分姿态，所以单独抽出来给掉落物、生物（后续）复用。
 *
 * 说明：PlayerPhysics 里的逐轴解析是本文件逻辑的"玩家特化版"（多了上台阶与潜行）。
 * 两处存在一定重复，等生物系统（I4）落地、需要更多共用行为时再统一重构。
 */

import { boxAt, collides, resolveVertical, type AABB, type CollisionWorld } from './AABB.ts';

/** 单次步进最大位移，避免高速穿透 */
const MAX_STEP = 0.4;

export interface MovingBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  width: number;
  height: number;
  onGround: boolean;
}

export function bodyBox(body: { x: number; y: number; z: number; width: number; height: number }): AABB {
  return boxAt(body.x, body.y, body.z, body.width, body.height);
}

/**
 * 按 (dx, dy, dz) 移动实体并解决碰撞，会就地修改 body 的位置与速度。
 */
export function moveBody(world: CollisionWorld, body: MovingBody, dx: number, dy: number, dz: number): void {
  const distance = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  const steps = Math.max(1, Math.ceil(distance / MAX_STEP));
  const stepX = dx / steps;
  const stepY = dy / steps;
  const stepZ = dz / steps;

  for (let i = 0; i < steps; i++) {
    moveAxis(world, body, 0, stepX);
    moveAxis(world, body, 1, stepY);
    moveAxis(world, body, 2, stepZ);
  }
}

function moveAxis(world: CollisionWorld, body: MovingBody, axis: 0 | 1 | 2, amount: number): void {
  if (amount === 0) return;

  const from = axis === 0 ? body.x : axis === 1 ? body.y : body.z;

  if (axis === 0) body.x += amount;
  else if (axis === 1) body.y += amount;
  else body.z += amount;

  if (!collides(world, bodyBox(body))) {
    if (axis === 1 && amount < 0) body.onGround = false;
    return;
  }

  const half = body.width / 2;

  if (axis === 0) {
    body.x = amount > 0 ? Math.floor(body.x + half) - half - 1e-4 : Math.floor(body.x - half) + 1 + half + 1e-4;
    body.vx = 0;
  } else if (axis === 1) {
    // 与玩家物理同一条修正（批次 206）：落在雪层/台阶上要吸附到**真实顶面**，
    // 不能用"整格高度"，否则掉落物与生物站在雪上会一帧一顶地抖。
    body.y = resolveVertical(world, (y) => boxAt(body.x, y, body.z, body.width, body.height), from, body.y);
    if (amount < 0) body.onGround = true;
    body.vy = 0;
  } else {
    body.z = amount > 0 ? Math.floor(body.z + half) - half - 1e-4 : Math.floor(body.z - half) + 1 + half + 1e-4;
    body.vz = 0;
  }
}
