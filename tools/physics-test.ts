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
import { moveBody } from '../src/core/physics/EntityMotion.ts';

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

console.log('\n[非整格地面：雪层 / 台阶不再抖跳]');
{
  /** y=64 那一层是 `height` 高的非整格方块，底下是实心地面 */
  function partialWorld(height: number): PhysicsWorld {
    return {
      collisionAt(x: number, y: number, z: number) {
        void x;
        void z;
        if (y < 64) return 'full' as const;
        if (y === 64) return [[0, 0, 0, 1, height, 1]] as const;
        return null;
      },
      isLiquid: () => false,
    };
  }

  for (const [name, height] of [
    ['雪层（1/8 格）', 0.125],
    ['台阶（1/2 格）', 0.5],
  ] as const) {
    const world = partialWorld(height);
    const physics = new PlayerPhysics();
    physics.x = 0.5;
    physics.y = 65;
    physics.z = 0.5;

    // 落下来，再原地站 2 秒：以前会"顶上去 → 掉回来"地反复跳
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 180; i++) {
      physics.update(world, input(), YAW_PLUS_X, DT, false);
      if (i > 60) {
        min = Math.min(min, physics.y);
        max = Math.max(max, physics.y);
      }
    }
    check(`${name}：停在真实顶面（${(64 + height).toFixed(3)}）`, Math.abs(physics.y - (64 + height)) < 0.005, `y=${physics.y.toFixed(4)}`);
    check(`${name}：站着 2 秒不再上下跳`, max - min < 0.005, `波动 ${(max - min).toFixed(4)}`);
    check(`${name}：落稳后 onGround 为 true`, physics.onGround === true);
  }

  // 实体（掉落物 / 生物）走的是另一套解算，同样要贴在真实顶面
  const body = { x: 0.5, y: 65, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.25, height: 0.25, onGround: false };
  const world = partialWorld(0.125);
  for (let i = 0; i < 120; i++) moveBody(world, body, 0, -0.3, 0);
  check('实体也能停在雪层顶面', Math.abs(body.y - 64.125) < 0.005, `y=${body.y.toFixed(4)}`);
}

console.log('\n[自动跳跃（设置项）]');
{
  /** 地面 y<64；x>=1 处额外多出一段 `height` 高的坎 */
  function stepWorld(height: number): PhysicsWorld {
    return {
      collisionAt(x: number, y: number, z: number) {
        void z;
        if (y < 64) return 'full' as const;
        if (x >= 1 && y === 64 && height > 0) return [[0, 0, 0, 1, height, 1]] as const;
        return null;
      },
      isLiquid: () => false,
    };
  }

  function walk(world: PhysicsWorld, autoJump: boolean, frames = 90): PlayerPhysics {
    const physics = standOnGround();
    for (let i = 0; i < frames; i++) {
      physics.update(world, input({ forward: 1 }), YAW_PLUS_X, DT, false, 1, 1, autoJump);
    }
    return physics;
  }

  const withJump = walk(stepWorld(1), true);
  check('一格高的坎：自动跳上去了', withJump.y > 64.9, `y=${withJump.y.toFixed(3)}`);
  check('一格高的坎：确实越过去了', withJump.x > 1.2, `x=${withJump.x.toFixed(2)}`);

  const withoutJump = walk(stepWorld(1), false);
  check('关掉之后：被一格坎挡住', withoutJump.y < 64.01 && withoutJump.x < 1, `y=${withoutJump.y.toFixed(3)} x=${withoutJump.x.toFixed(2)}`);

  // 两格墙：跳了也上不去 → 不该原地一直蹦
  const wall = walk(stepWorld(2), true);
  check('两格墙前不会原地蹦', wall.y < 64.01, `y=${wall.y.toFixed(3)}`);
  check('两格墙前仍然被挡住', wall.x < 1, `x=${wall.x.toFixed(2)}`);

  // 雪层只有 1/8 格：由上台阶处理，自动跳跃不该被触发（不该出现"跳到 1 格高"）
  const snowPhysics = standOnGround();
  let snowMax = -Infinity;
  const snowWorld = stepWorld(0.125);
  for (let i = 0; i < 90; i++) {
    snowPhysics.update(snowWorld, input({ forward: 1 }), YAW_PLUS_X, DT, false, 1, 1, true);
    snowMax = Math.max(snowMax, snowPhysics.y);
  }
  check('雪层由台阶逻辑走上去（没有整格起跳）', snowMax < 64.2, `最高 y=${snowMax.toFixed(3)}`);
  check('雪层上最终停在 64.125', Math.abs(snowPhysics.y - 64.125) < 0.01, `y=${snowPhysics.y.toFixed(4)}`);

  // 仙人掌（批次 222）：1 格高，但贴上去会掉血 → 自动跳跃不该把它当台阶。
  // 用户反馈"顶着仙人掌走路画面一直抖"：跳上去、被挡/滑下、再跳，就是这个循环。
  const cactusWorld: PhysicsWorld = { ...stepWorld(1), isHazardous: (x) => x >= 1 };
  const cactus = walk(cactusWorld, true, 30);
  check('仙人掌前不会自动跳（不把危险方块当台阶）', cactus.y < 64.01, `y=${cactus.y.toFixed(3)}`);
  check('仙人掌前被老老实实挡住', cactus.x < 1, `x=${cactus.x.toFixed(2)}`);

  // 反向断言：普通台阶仍然要跳（别把"有 hazard 判据"写成"所有台阶都不跳"）
  const normalStep = walk(stepWorld(1), true, 30);
  check('同一份假世界去掉 hazard 之后照旧自动跳', normalStep.y > 64.5, `y=${normalStep.y.toFixed(3)}`);

  // autoJumped 标志（诊断用）：只在起跳那一帧为真
  const flagPhysics = standOnGround();
  const flagWorld = stepWorld(1);
  let jumpFrames = 0;
  for (let i = 0; i < 30; i++) {
    flagPhysics.update(flagWorld, input({ forward: 1 }), YAW_PLUS_X, DT, false, 1, 1, true);
    if (flagPhysics.autoJumped) jumpFrames++;
  }
  check('autoJumped 只在起跳那一帧为真', jumpFrames === 1, `${jumpFrames} 帧`);
}

console.log('\n[常量]');
{
  check('冲刺跳的补速是正的', SPRINT_JUMP_BOOST > 0);
  check('补速不会超过疾跑本身（否则像被弹射）', SPRINT_JUMP_BOOST < SPRINT_SPEED);
}

console.log('\n[姿态：潜行 1.5 格高（F9，批次 404）]');
{
  // 走廊在 x ≥ 4，天花板是"上半格"的半砖 → 净高 64 → 65.5 = **1.5 格**
  const halfCeilingWorld = (ceiling: 'half' | 'full'): PhysicsWorld => ({
    collisionAt(x: number, y: number, z: number) {
      void z;
      if (y < 64) return 'full' as const;
      if (y !== 65 || x < 4) return null;
      // 上半格：局部盒 [0, 0.5, 0, 1, 1, 1] → 天花板底面在 65.5
      return ceiling === 'half' ? ([[0, 0.5, 0, 1, 1, 1]] as const) : ('full' as const);
    },
    isLiquid: () => false,
    isClimbable: () => false,
  });

  // ① 空地上：站立
  const standing = standOnGround(0.5);
  standing.update(makeWorld(), input(), YAW_PLUS_X, DT, false);
  equal('空地上站着时高度是 1.8', standing.height, 1.8);
  equal('眼高 1.62', standing.eyeHeight, 1.62);
  check('空地上不会自己蹲下', !standing.crouching);

  // ② 按潜行：变矮、视角跟着降
  const sneaking = standOnGround(0.5);
  sneaking.update(makeWorld(), input({ sneak: true }), YAW_PLUS_X, DT, false);
  check('按潜行就蹲下', sneaking.crouching);
  equal('潜行高度 1.5（不是 1.8）', sneaking.height, 1.5);
  equal('潜行眼高 1.27', sneaking.eyeHeight, 1.27);
  check('视角确实降低了 0.35 格', Math.abs((64 + 1.62) - sneaking.eyeY - 0.35) < 1e-9, `eyeY=${sneaking.eyeY}`);
  check('碰撞盒跟着变矮', Math.abs(sneaking.box().maxY - sneaking.box().minY - 1.5) < 1e-9);

  // ③ 1.5 格缝：蹲着能钻进去，站着进不去
  const through = standOnGround(3.0);
  const world15 = halfCeilingWorld('half');
  for (let i = 0; i < 120; i++) {
    through.update(world15, input({ forward: 1, sneak: true }), YAW_PLUS_X, DT, false);
  }
  check('蹲着钻进了 1.5 格高的缝（x 走到走廊里）', through.x > 4.2, `x=${through.x.toFixed(2)}`);

  const blocked = standOnGround(3.0);
  for (let i = 0; i < 120; i++) {
    blocked.update(world15, input({ forward: 1 }), YAW_PLUS_X, DT, false);
  }
  check('站着被挡在缝外', blocked.x < 3.8, `x=${blocked.x.toFixed(2)}`);

  // ④ 缝里松开潜行：站不起来（强制蹲），也不会被顶进天花板
  const inside = standOnGround(5.0);
  inside.update(world15, input(), YAW_PLUS_X, DT, false);
  check('缝里松手仍然蹲着（站不起来）', inside.crouching);
  equal('高度还是 1.5', inside.height, 1.5);
  check('没有被顶起来（y 仍在地面）', Math.abs(inside.y - 64) < 0.05, `y=${inside.y.toFixed(3)}`);

  // ⑤ 走出缝之后松手：站回来
  const outside = standOnGround(2.0);
  outside.update(world15, input(), YAW_PLUS_X, DT, false);
  check('缝外松手就站直', !outside.crouching);
  equal('高度回到 1.8', outside.height, 1.8);

  // ⑥ 负对照：净高 1.0 的洞，蹲着也过不去（没把玩家改成 1 格高）
  const tight = standOnGround(3.0);
  const world10 = halfCeilingWorld('full');
  for (let i = 0; i < 120; i++) {
    tight.update(world10, input({ forward: 1, sneak: true }), YAW_PLUS_X, DT, false);
  }
  check('1 格高的洞蹲着也进不去', tight.x < 3.8, `x=${tight.x.toFixed(2)}`);
}

console.log(`\n物理测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
