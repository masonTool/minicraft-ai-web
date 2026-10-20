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

import { readFileSync } from 'node:fs';
import {
  FLY_RAMP_SECONDS,
  FLY_SPEED,
  FLY_SPRINT_SPEED,
  HONEY_SLIDE_SPEED,
  PlayerPhysics,
  SPRINT_JUMP_BOOST,
  SPRINT_SPEED,
  SWIM_DIVE_SPEED,
  WALK_SPEED,
  type PlayerInput,
} from '../src/core/physics/PlayerPhysics.ts';
import type { PhysicsWorld } from '../src/core/physics/PlayerPhysics.ts';
import { moveBody } from '../src/core/physics/EntityMotion.ts';
import {
  FLOW_DRIFT_SPEED,
  FLOW_ENTITY_ACCEL,
  flowPush,
  waterFlowAt,
  type FlowWorld,
} from '../src/core/world/FluidFlow.ts';
import { Block, CONCRETE_POWDER_ID_START } from '../src/core/registry/blocks.ts';
import { FALL_STEP_SECONDS, FallingBlocks, isFallingBlock } from '../src/core/world/FallingBlocks.ts';
import { withFluidLevel } from '../src/core/registry/blockState.ts';

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

console.log('\n[创造飞行：起步慢、0.65 秒到满速（批次 528）]');
{
  const world = makeWorld(null);
  const ticks = Math.round(FLY_RAMP_SECONDS / DT);

  /** 从静止开始按前进，返回第 1 帧 / 到点 / 再按一段之后的速度 */
  function ramp(sprint: boolean): { first: number; atRamp: number; later: number } {
    const physics = new PlayerPhysics();
    physics.y = 70; // 空中：假世界在 y>=64 没有碰撞
    const step = (): void => {
      physics.update(world, input({ forward: 1, sprint }), YAW_PLUS_X, DT, true);
    };
    step();
    const first = physics.vx;
    for (let i = 1; i < ticks; i++) step();
    const atRamp = physics.vx;
    for (let i = 0; i < ticks; i++) step();
    return { first, atRamp, later: physics.vx };
  }

  const walk = ramp(false);
  check('第一帧只到满速的一小部分（不再一下就很快）', walk.first < FLY_SPEED * 0.25, `vx=${walk.first.toFixed(2)}`);
  check('过半程时还没到满速（是一个加速度过程）', walk.first > 0 && walk.first < walk.atRamp);
  check('0.65 秒后到达普通飞行速度', Math.abs(walk.atRamp - FLY_SPEED) < 0.3, `vx=${walk.atRamp.toFixed(2)}`);
  check('继续按着不会超过满速', walk.later <= FLY_SPEED + 1e-6, `vx=${walk.later.toFixed(3)}`);

  const sprint = ramp(true);
  check('冲刺档也是同一段时间到满速（手感一致）', Math.abs(sprint.atRamp - FLY_SPRINT_SPEED) < 0.6, `vx=${sprint.atRamp.toFixed(2)}`);
  check('冲刺档同样起步慢', sprint.first < FLY_SPRINT_SPEED * 0.25, `vx=${sprint.first.toFixed(2)}`);

  // 松手：同一个斜率减速，会滑一小段（不是啪地停住）
  const glide = new PlayerPhysics();
  glide.y = 70;
  for (let i = 0; i < ticks * 2; i++) glide.update(world, input({ forward: 1 }), YAW_PLUS_X, DT, true);
  glide.update(world, input(), YAW_PLUS_X, DT, true);
  check('松手后还会滑一段（有惯性）', glide.vx > FLY_SPEED * 0.6, `vx=${glide.vx.toFixed(2)}`);
  for (let i = 0; i < ticks * 2; i++) glide.update(world, input(), YAW_PLUS_X, DT, true);
  check('最终会停下来', Math.abs(glide.vx) < 0.05, `vx=${glide.vx.toFixed(3)}`);
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

  // ⑥ 负对照：净高 0.5 的洞，**爬着也过不去**（没把玩家改成"什么洞都能钻"）。
  // ⚠️ 批次 430 起"1 格高的洞"是**能爬进去的**（爬行高度 0.6），所以这条负对照
  // 从 1.0 改成 0.5：天花板是 y=64 那一格的上半砖。
  const tight = standOnGround(3.0);
  const world05: PhysicsWorld = {
    collisionAt: (x, y) => {
      if (y < 64) return 'full' as const;
      if (y === 64 && x >= 4) return [[0, 0.5, 0, 1, 1, 1]] as const;
      return null;
    },
    isLiquid: () => false,
    isClimbable: () => false,
  };
  for (let i = 0; i < 120; i++) {
    tight.update(world05, input({ forward: 1, sneak: true }), YAW_PLUS_X, DT, false);
  }
  check('净高 0.5 的洞爬着也进不去', tight.x < 3.8, `x=${tight.x.toFixed(2)}`);
}

console.log('\n[水中上下：跳跃上浮 / 潜行下潜（F9，批次 428）]');
{
  // 整个世界都是水（y < 100 全是液体、没有实心方块）
  const water: PhysicsWorld = {
    collisionAt: () => null,
    isLiquid: (_x, y) => y < 100,
    isClimbable: () => false,
  };
  const startIn = (y: number): PlayerPhysics => {
    const physics = new PlayerPhysics();
    physics.x = 0.5;
    physics.y = y;
    physics.z = 0.5;
    return physics;
  };

  // ① 按跳跃 → 上浮
  const up = startIn(50);
  for (let i = 0; i < 30; i++) up.update(water, input({ jump: true }), YAW_PLUS_X, DT, false);
  check('水里按跳跃会上浮', up.y > 50.3, `y=${up.y.toFixed(2)}`);

  // ② 按潜行 → 下潜（这一批新接的）
  const down = startIn(50);
  for (let i = 0; i < 60; i++) down.update(water, input({ sneak: true }), YAW_PLUS_X, DT, false);
  check('水里按潜行会下潜', down.y < 49.5, `y=${down.y.toFixed(2)}`);
  check('下潜速度不超过 SWIM_DIVE_SPEED（不会像石头一样砸下去）', down.vy >= -SWIM_DIVE_SPEED - 0.2, `vy=${down.vy.toFixed(2)}`);

  // ③ 什么都不按 → 只有 1/4 重力，沉得很慢（比按潜行慢）
  const idle = startIn(50);
  for (let i = 0; i < 60; i++) idle.update(water, input(), YAW_PLUS_X, DT, false);
  check('不按键时缓慢下沉', idle.y < 50 && idle.y > down.y, `idle=${idle.y.toFixed(2)} dive=${down.y.toFixed(2)}`);

  // ④ 下潜不会把人送到无底：竖直速度被夹在 -4
  check('竖直速度下限仍是 -4', down.vy >= -4, `vy=${down.vy.toFixed(2)}`);
}

console.log('\n[爬行：一格高的洞（F9，批次 430）]');
{
  // 走廊在 x ≥ 4，天花板占满 y=65 那一格 → 净高 1.0（潜行的 1.5 都放不下）
  const tunnel: PhysicsWorld = {
    collisionAt: (x, y) => {
      if (y < 64) return 'full' as const;
      if (y === 65 && x >= 4) return 'full' as const;
      return null;
    },
    isLiquid: () => false,
    isClimbable: () => false,
  };

  // ① 蹲着往前走：进得去（前瞻在洞口前就开始爬）
  const crawler = standOnGround(3.0);
  for (let i = 0; i < 150; i++) {
    crawler.update(tunnel, input({ forward: 1, sneak: true }), YAW_PLUS_X, DT, false);
  }
  check('按住潜行能钻进一格高的洞', crawler.x > 4.2, `x=${crawler.x.toFixed(2)}`);
  check('洞里处于爬行姿态', crawler.crawling);
  check('爬行高度是 0.6', Math.abs(crawler.height - 0.6) < 1e-9, String(crawler.height));

  // ② 不按潜行：被洞口挡在外面（潜行是必须的——原版也要求主动蹲下/爬）
  const walker = standOnGround(3.0);
  for (let i = 0; i < 150; i++) {
    walker.update(tunnel, input({ forward: 1 }), YAW_PLUS_X, DT, false);
  }
  check('不按潜行进不去', walker.x < 3.8, `x=${walker.x.toFixed(2)}`);
  check('洞外不会自己爬', !walker.crawling);

  // ③ 洞里松手：仍然是爬行（头顶放不下 1.5，站不起来）
  const inside = standOnGround(5.0);
  inside.update(tunnel, input(), YAW_PLUS_X, DT, false);
  check('洞里松手仍然爬着', inside.crawling);
  check('不会被顶起来', Math.abs(inside.y - 64) < 0.05, `y=${inside.y.toFixed(3)}`);

  // ④ 洞外松手：站直
  const outside = standOnGround(2.0);
  outside.update(tunnel, input(), YAW_PLUS_X, DT, false);
  check('洞外松手就站直', !outside.crawling && !outside.crouching);
  check('站立高度回到 1.8', Math.abs(outside.height - 1.8) < 1e-9, String(outside.height));

  // ⑤ 站在实心墙前不会误判成"要爬"（墙里连 0.6 都放不下）
  const solid: PhysicsWorld = {
    collisionAt: (x, y) => (y < 64 || (y >= 64 && y < 66 && x >= 4) ? ('full' as const) : null),
    isLiquid: () => false,
    isClimbable: () => false,
  };
  const againstWall = standOnGround(3.0);
  for (let i = 0; i < 60; i++) {
    againstWall.update(solid, input({ forward: 1, sneak: true }), YAW_PLUS_X, DT, false);
  }
  check('对着整堵墙时不会误入爬行', !againstWall.crawling);
  check('也确实被挡住了', againstWall.x < 3.8, `x=${againstWall.x.toFixed(2)}`);
}

console.log('\n[蛛网减速（批次 441）]');
{
  const flat = (web: boolean): PhysicsWorld => ({
    collisionAt: (_x, y) => (y < 64 ? ('full' as const) : null),
    isLiquid: () => false,
    isClimbable: () => false,
    // 整条走廊 x ≥ 2 都是蛛网
    isCobweb: (x: number) => web && x >= 2,
  });

  // ① 不在网里：正常速度
  const free = standOnGround(0.5);
  for (let i = 0; i < 40; i++) free.update(flat(true), input({ forward: 1 }), YAW_PLUS_X, DT, false);
  check('网外正常前进（2 秒走出 1 格以上）', free.x > 1.5, `x=${free.x.toFixed(2)}`);

  // ② 网里：同样时间走得明显更短
  const stuck = standOnGround(2.5);
  for (let i = 0; i < 40; i++) stuck.update(flat(true), input({ forward: 1 }), YAW_PLUS_X, DT, false);
  const stuckDistance = stuck.x - 2.5;
  const freeDistance = free.x - 0.5;
  check('网里走得更短（被粘住）', stuckDistance < freeDistance * 0.6, `网里 ${stuckDistance.toFixed(2)} / 网外 ${freeDistance.toFixed(2)}`);
  check('但不是完全动不了（退化成减速而不是卡死）', stuckDistance > 0.1, `网里 ${stuckDistance.toFixed(2)}`);

  // ③ 世界没实现 isCobweb 时不报错、也不减速（可选钩子）
  const plain: PhysicsWorld = { collisionAt: (_x, y) => (y < 64 ? ('full' as const) : null), isLiquid: () => false, isClimbable: () => false };
  const noHook = standOnGround(2.5);
  for (let i = 0; i < 40; i++) noHook.update(plain, input({ forward: 1 }), YAW_PLUS_X, DT, false);
  check('没接 isCobweb 的世界不受影响', Math.abs(noHook.x - stuck.x) > 0.2, `x=${noHook.x.toFixed(2)}`);
}

console.log('\n[水流推动（批次 447）]');
{
  // 假水世界：cells 里有键的就是水，值是液面等级（0 = 水源，越大越薄）
  const cells = new Map<string, number>();
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  const put = (x: number, y: number, z: number, level: number): void => {
    cells.set(key(x, y, z), withFluidLevel(0, level));
  };
  const flowWorld: FlowWorld = {
    getBlock: (x, y, z) => (cells.has(key(x, y, z)) ? Block.WATER : Block.AIR),
    getState: (x, y, z) => cells.get(key(x, y, z)) ?? 0,
  };

  // 一潭静水：四邻同厚度 → 不推
  put(0, 0, 0, 0);
  put(1, 0, 0, 0);
  put(-1, 0, 0, 0);
  check('静水不推人', waterFlowAt(flowWorld, 0.5, 0.5, 0.5) === null);

  // 水源在东边更薄的水旁 → 朝 +x 推
  cells.clear();
  put(0, 0, 0, 0);
  put(1, 0, 0, 3);
  const downstream = waterFlowAt(flowWorld, 0.5, 0.5, 0.5);
  check(
    '朝更薄的那一侧推（水源 → 下游）',
    downstream?.x === FLOW_DRIFT_SPEED && downstream?.z === 0,
    JSON.stringify(downstream),
  );

  // 上游（更厚）不加推力，只认下游
  cells.clear();
  put(0, 0, 0, 3);
  put(-1, 0, 0, 1);
  put(1, 0, 0, 5);
  const bothSides = waterFlowAt(flowWorld, 0.5, 0.5, 0.5);
  check('两侧都有水时只推向下游（等级更大的一侧）', bothSides?.x === FLOW_DRIFT_SPEED, JSON.stringify(bothSides));

  // 上方也是水：水柱向下按
  cells.clear();
  put(0, 0, 0, 0);
  put(0, 1, 0, 0);
  const fall = waterFlowAt(flowWorld, 0.5, 0.5, 0.5);
  check('水柱把人往下按', (fall?.y ?? 0) < 0, JSON.stringify(fall));

  // 不是水 → null
  cells.clear();
  check('不是水就不推', waterFlowAt(flowWorld, 0.5, 0.5, 0.5) === null);

  // ---- 生物/掉落物：只叠加速度，不覆盖它们自己的移动意图
  const flowRight = { x: FLOW_DRIFT_SPEED, y: 0, z: 0 };
  const pushedMob = flowPush(2, -1, flowRight, 0.5);
  check('顺流时在原速度上加速（不是直接改成漂流速度）', pushedMob.x > 2 && pushedMob.z === -1, JSON.stringify(pushedMob));
  check('静水（flow=null）原样返回', flowPush(2, -1, null, 0.5).x === 2);
  check('dt=0 不产生位移', flowPush(2, -1, flowRight, 0).x === 2);
  const upstreamMob = flowPush(2, 0, { x: -FLOW_DRIFT_SPEED, y: 0, z: 0 }, 1 / 60);
  check('逆流仍保留正向速度（不会只能顺流）', upstreamMob.x > 0, JSON.stringify(upstreamMob));
  check('推力强度是有限值', FLOW_ENTITY_ACCEL > 0 && FLOW_ENTITY_ACCEL < 20);

  const mobSrc = readFileSync(new URL('../src/core/entity/Mob.ts', import.meta.url), 'utf8');
  const itemSrc = readFileSync(new URL('../src/core/entity/ItemEntity.ts', import.meta.url), 'utf8');
  check('生物移动前调用 flowPush', mobSrc.includes('flowPush(this.vx, this.vz, flow, dt)'));
  check('掉落物在水里也调用 flowPush', itemSrc.includes('flowPush(this.vx, this.vz, flow, dt)'));

  // ---- 接到玩家物理上：不按方向时被水带着走，静水里原地不动
  const pool = (drift: number): PhysicsWorld => ({
    collisionAt: (_x, y) => (y < 64 ? ('full' as const) : null),
    isLiquid: () => true,
    isClimbable: () => false,
    waterFlow: () => ({ x: drift, y: 0, z: 0 }),
  });

  const pushed = standOnGround(2);
  for (let i = 0; i < 120; i++) pushed.update(pool(FLOW_DRIFT_SPEED), input({}), YAW_PLUS_X, DT, false);
  check('站在水里会被水流带着走（2 秒 > 0.8 格）', pushed.x - 2 > 0.8, `x=${pushed.x.toFixed(2)}`);

  const still = standOnGround(2);
  for (let i = 0; i < 120; i++) still.update(pool(0), input({}), YAW_PLUS_X, DT, false);
  check('静水里不会被推走', Math.abs(still.x - 2) < 0.2, `x=${still.x.toFixed(2)}`);

  // 逆流：玩家的游泳速度大于水流漂移，仍然能往前
  const upstream = standOnGround(2);
  for (let i = 0; i < 120; i++) {
    upstream.update(pool(-FLOW_DRIFT_SPEED), input({ forward: 1 }), YAW_PLUS_X, DT, false);
  }
  check('逆流仍然游得动', upstream.x - 2 > 0.5, `x=${upstream.x.toFixed(2)}`);
}

console.log('\n[蜂蜜块（批次 450）]');
{
  // ① 站在蜜块上：跳跃被取消（不是"跳得矮"，是一点都跳不起来）
  const honeyFloor = (honey: boolean): PhysicsWorld => ({
    collisionAt: (_x, y) => (y < 64 ? ('full' as const) : null),
    isLiquid: () => false,
    isClimbable: () => false,
    isHoney: (_x, y) => honey && y === 63,
  });

  const sticky = standOnGround();
  let stickyPeak = sticky.y;
  for (let i = 0; i < 40; i++) {
    sticky.update(honeyFloor(true), input({ jump: true }), YAW_PLUS_X, DT, false);
    stickyPeak = Math.max(stickyPeak, sticky.y);
  }
  check('站在蜂蜜块上跳不起来', stickyPeak < 64.25, `峰值 ${stickyPeak.toFixed(2)}`);

  const plain = standOnGround();
  let plainPeak = plain.y;
  for (let i = 0; i < 40; i++) {
    plain.update(honeyFloor(false), input({ jump: true }), YAW_PLUS_X, DT, false);
    plainPeak = Math.max(plainPeak, plain.y);
  }
  check('普通地面上照样能跳（负对照）', plainPeak > 64.8, `峰值 ${plainPeak.toFixed(2)}`);

  // ② 贴着蜜块侧面下滑：速度被限在 HONEY_SLIDE_SPEED 以内
  const honeyWall = (honey: boolean): PhysicsWorld => ({
    collisionAt: () => null,
    isLiquid: () => false,
    isClimbable: () => false,
    // 玩家身体所在高度整层都是蜜块 —— 等价于"贴着蜜块墙往下溜"
    isHoney: (_x, y) => honey && y >= 64,
  });

  const slider = new PlayerPhysics();
  slider.x = 0.5;
  slider.y = 80;
  slider.z = 0.5;
  for (let i = 0; i < 60; i++) slider.update(honeyWall(true), input({}), YAW_PLUS_X, DT, false);
  check('贴着蜂蜜块下滑被限速', slider.vy >= -HONEY_SLIDE_SPEED - 1e-6, `vy=${slider.vy.toFixed(2)}`);

  const freeFall = new PlayerPhysics();
  freeFall.x = 0.5;
  freeFall.y = 80;
  freeFall.z = 0.5;
  for (let i = 0; i < 60; i++) freeFall.update(honeyWall(false), input({}), YAW_PLUS_X, DT, false);
  check('没有蜜块时会一直加速（负对照）', freeFall.vy < -5, `vy=${freeFall.vy.toFixed(2)}`);
}

console.log('\n[下落方块（批次 543）]');
{
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  const world = {
    blocks: new Map<string, { id: number; state: number }>(),
    set(x: number, y: number, z: number, id: number, state = 0): void {
      this.blocks.set(key(x, y, z), { id, state });
    },
    getBlock(x: number, y: number, z: number): number {
      return this.blocks.get(key(x, y, z))?.id ?? Block.AIR;
    },
    getBlockState(x: number, y: number, z: number): number {
      return this.blocks.get(key(x, y, z))?.state ?? 0;
    },
    setBlock(x: number, y: number, z: number, id: number, state = 0): boolean {
      this.set(x, y, z, id, state);
      return true;
    },
  };

  check(
    '沙子/红沙/沙砾/混凝土粉末都会下落',
    [Block.SAND, Block.RED_SAND, Block.GRAVEL, CONCRETE_POWDER_ID_START].every(isFallingBlock),
  );
  check('石头与空气不会下落', !isFallingBlock(Block.STONE) && !isFallingBlock(Block.AIR));

  const fb = new FallingBlocks();
  world.set(0, 64, 0, Block.STONE);
  world.set(0, 65, 0, Block.SAND);
  check('有支撑的沙子不登记', !fb.wake(world, 0, 65, 0) && fb.pending === 0);

  // 抽掉沙子下面那格：`wakeAfterChange` 要看上面那一格
  world.set(0, 65, 0, Block.AIR);
  world.set(0, 66, 0, Block.SAND);
  fb.wakeAfterChange(world, 0, 65, 0);
  check('抽掉支撑后上面的沙子开始下落', fb.pending === 1, `pending=${fb.pending}`);

  fb.tick(world, FALL_STEP_SECONDS);
  check('一个步长下落一格', world.getBlock(0, 65, 0) === Block.SAND && world.getBlock(0, 66, 0) === Block.AIR);

  for (let i = 0; i < 20; i++) fb.tick(world, FALL_STEP_SECONDS);
  check('落到地面就停住', world.getBlock(0, 65, 0) === Block.SAND && fb.pending === 0);
  check('没有穿过地面', world.getBlock(0, 64, 0) === Block.STONE);

  // 两格高的沙柱：下面那块先落，上面那块跟着落，最后仍然叠在一起
  world.set(0, 70, 0, Block.SAND);
  world.set(0, 71, 0, Block.SAND);
  fb.wake(world, 0, 70, 0);
  fb.wake(world, 0, 71, 0);
  for (let i = 0; i < 100; i++) fb.tick(world, FALL_STEP_SECONDS);
  check(
    '整柱沙子一起落到底（65/66）',
    world.getBlock(0, 65, 0) === Block.SAND && world.getBlock(0, 66, 0) === Block.SAND,
    `65=${world.getBlock(0, 65, 0)} 66=${world.getBlock(0, 66, 0)}`,
  );
  check('整柱落完之后没有残留记录', fb.pending === 0);

  // 水不是支撑：沙子会穿过水，落到水下面的石头上（水被替换掉）
  world.set(0, 58, 0, Block.STONE);
  world.set(0, 59, 0, Block.WATER);
  world.set(0, 60, 0, Block.SAND);
  fb.wake(world, 0, 60, 0);
  for (let i = 0; i < 20; i++) fb.tick(world, FALL_STEP_SECONDS);
  check('沙子穿过水并落在石头上', world.getBlock(0, 59, 0) === Block.SAND && world.getBlock(0, 60, 0) === Block.AIR);

  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check('方块变动后唤醒下落方块', mainSrc.includes('fallingBlocks.wakeAfterChange(this.world, x, y, z)'));
  check('主循环推进下落方块', mainSrc.includes('fallingBlocks.tick(this.world, dt)'));
}

console.log(`\n物理测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
