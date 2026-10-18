/**
 * 玩家物理的两条尾巴（F3，批次 197）
 *
 * F3 一直挂着两句"待补"：**潜行防掉落**与**冲刺跳**。这两条都是"手感规则"，
 * 但它们判据很硬，所以能用假世界离线钉住：
 *
 *  1. **潜行防掉落**：站在台子边缘按潜行往前走，走不出去；松开潜行就会掉下去；
 *     贴着边缘**横着挪**仍然可以（原版能沿坑边挪）；从半空潜行下落不会被钉住。
 *  2. **冲刺跳**：起跳那一帧水平速度会**高于**疾跑速度，普通跳不会；
 *     补的速度沿**输入方向**（不是当前速度方向）。
 *
 * 运行：npm run test:physics
 */

import { PlayerPhysics, SPRINT_JUMP_BOOST, SPRINT_SPEED, WALK_SPEED, type PlayerInput } from '../src/core/physics/PlayerPhysics.ts';
import type { PhysicsWorld } from '../src/core/physics/PlayerPhysics.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

const DT = 1 / 60;

/**
 * 假世界：`y < 64` 且（`edgeX` 为 null 或 `x < edgeX`）的格子是实心。
 * `edgeX = 1` 就是"x < 1 是台子、x ≥ 1 是悬崖"。
 */
function makeWorld(edgeX: number | null = null): PhysicsWorld {
  return {
    collisionAt(x: number, y: number, z: number) {
      void z;
      if (y >= 64) return null;
      if (edgeX !== null && x >= edgeX) return null;
      return 'full' as const;
    },
    isLiquid: () => false,
    isClimbable: () => false,
  };
}

function input(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, ...overrides };
}

/** 站在台子上（y = 64 是地面顶部），朝向 +X（yaw = -π/2） */
function standOnGround(x = 0.5, z = 0.5): PlayerPhysics {
  const physics = new PlayerPhysics();
  physics.x = x;
  physics.y = 64;
  physics.z = z;
  physics.onGround = true;
  return physics;
}

const YAW_PLUS_X = -Math.PI / 2;

console.log('\n[潜行防掉落]');
{
  // 台子在 x < 1，往 +X 走 1 秒
  const sneaking = standOnGround();
  const world = makeWorld(1);
  for (let i = 0; i < 60; i++) {
    sneaking.update(world, input({ forward: 1, sneak: true }), YAW_PLUS_X, DT, false);
  }
  // 站住时 y 会是 64.0001（碰撞把身体顶出地面一点点），所以比"没掉下去"而不是比精确值
  check('潜行时没有掉下去（还在台子上）', Math.abs(sneaking.y - 64) < 0.01, `y=${sneaking.y.toFixed(4)}`);
  check('而且确实走到了边缘（x 在 0.6~0.82 之间）', sneaking.x > 0.6 && sneaking.x <= 0.82, `x=${sneaking.x.toFixed(3)}`);
  check('没有越过悬崖（四个角都还在台上）', sneaking.x <= 0.8, `x=${sneaking.x.toFixed(3)}`);
  equal('水平速度被清掉了', sneaking.vx, 0);

  // 同样起步，但不潜行 → 会掉下去
  const walking = standOnGround();
  for (let i = 0; i < 60; i++) {
    walking.update(world, input({ forward: 1 }), YAW_PLUS_X, DT, false);
  }
  check('不潜行就会走下悬崖', walking.y < 63.5, `y=${walking.y.toFixed(2)}`);
  check('而且确实走出去了', walking.x > 1, `x=${walking.x.toFixed(2)}`);
}

console.log('\n[潜行时贴着边缘横着挪仍然可以]');
{
  // 台子只在 z < 1 有（往 +Z 是悬崖）；玩家朝 +X 潜行
  const world: PhysicsWorld = {
    collisionAt(x: number, y: number, z: number) {
      void x;
      if (y >= 64) return null;
      return z < 1 ? ('full' as const) : null;
    },
    isLiquid: () => false,
  };
  const physics = standOnGround(0.5, 0.5);
  const startZ = physics.z;
  for (let i = 0; i < 60; i++) {
    physics.update(world, input({ forward: 1, sneak: true }), YAW_PLUS_X, DT, false);
  }
  check('没有掉下悬崖', Math.abs(physics.y - 64) < 0.01, `y=${physics.y.toFixed(4)}`);
  check('横向（+X）仍然走了', physics.x > 1.2, `x=${physics.x.toFixed(2)}`);
  equal('纵向没被推开', physics.z, startZ);
}

console.log('\n[半空潜行不会被钉住]');
{
  const world = makeWorld(null);
  const physics = new PlayerPhysics();
  physics.x = 5;
  physics.y = 70;
  physics.z = 5;
  physics.onGround = false;
  for (let i = 0; i < 30; i++) {
    physics.update(world, input({ forward: 1, sneak: true }), YAW_PLUS_X, DT, false);
  }
  check('照样往下掉', physics.y < 69, `y=${physics.y.toFixed(2)}`);
}

console.log('\n[冲刺跳]');
{
  const world = makeWorld(null);
  const sprinting = standOnGround();
  // 先跑满速（1 秒）
  for (let i = 0; i < 60; i++) {
    sprinting.update(world, input({ forward: 1, sprint: true }), YAW_PLUS_X, DT, false);
  }
  const groundSpeed = sprinting.vx;
  check('地面上已经是疾跑速度', Math.abs(groundSpeed - SPRINT_SPEED) < 0.2, `vx=${groundSpeed.toFixed(2)}`);

  sprinting.update(world, input({ forward: 1, sprint: true, jump: true }), YAW_PLUS_X, DT, false);
  check('起跳后竖直速度向上', sprinting.vy > 0, `vy=${sprinting.vy.toFixed(2)}`);
  check(
    '起跳那一帧水平速度超过疾跑速度',
    sprinting.vx > SPRINT_SPEED + SPRINT_JUMP_BOOST * 0.9,
    `vx=${sprinting.vx.toFixed(2)}`,
  );
  check('离地了', !sprinting.onGround);

  // 普通跳：没有那一脚
  const walking = standOnGround();
  for (let i = 0; i < 60; i++) {
    walking.update(world, input({ forward: 1 }), YAW_PLUS_X, DT, false);
  }
  const walkSpeed = walking.vx;
  check('普通走是走路速度', Math.abs(walkSpeed - WALK_SPEED) < 0.2, `vx=${walkSpeed.toFixed(2)}`);
  walking.update(world, input({ forward: 1, jump: true }), YAW_PLUS_X, DT, false);
  check('普通跳没有额外推力', walking.vx <= walkSpeed + 0.01, `vx=${walking.vx.toFixed(3)}`);

  // 原地跳（不按方向）：不该有水平推力
  const still = standOnGround();
  still.update(world, input({ sprint: true, jump: true }), YAW_PLUS_X, DT, false);
  check('不按方向冲刺跳没有水平推力', Math.abs(still.vx) < 1e-6, `vx=${still.vx}`);
}

console.log('\n[常量]');
{
  check('冲刺跳的补速是正的', SPRINT_JUMP_BOOST > 0);
  check('补速不会超过疾跑本身（否则像被弹射）', SPRINT_JUMP_BOOST < SPRINT_SPEED);
}

console.log(`\n物理测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
