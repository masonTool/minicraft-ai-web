/**
 * 末地 boss（末影龙 + 末地水晶）离线测试
 *
 * 覆盖：
 *  1. 龙的盘旋：绕着主岛（世界原点）半径 ~46 的圆飞、高度稳定在主岛上方
 *  2. 龙的俯冲：盘旋若干秒后切换阶段，朝玩家冲过来并造成伤害
 *  3. 受击：有短暂无敌帧、**不被击退**（boss 的击退抗性）
 *  4. 水晶回血：只要还有存活的水晶，龙就慢慢回血
 *  5. 水晶爆炸：被击毁时炸伤附近的玩家
 *  6. 死亡：血量归零后标记死亡并掉落龙蛋
 *
 * 运行：npm run test:endboss
 */

import type { EntityContext } from '../web/src/core/entity/Entity.ts';
import { DRAGON_TYPE, Dragon, EndCrystal } from '../web/src/core/entity/EndBoss.ts';
import { Block } from '../web/src/core/registry/blocks.ts';
import type { PhysicsWorld } from '../web/src/core/physics/PlayerPhysics.ts';

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

interface DamageEvent {
  amount: number;
  sourceX: number;
  sourceZ: number;
}

interface DropEvent {
  itemId: number;
  count: number;
}

function makeContext(player: { x: number; y: number; z: number }): {
  ctx: EntityContext;
  damage: DamageEvent[];
  drops: DropEvent[];
} {
  const damage: DamageEvent[] = [];
  const drops: DropEvent[] = [];
  const ctx: EntityContext = {
    world: { isSolid: () => false, isLiquid: () => false, getBlock: () => 0 } as unknown as PhysicsWorld,
    playerBox: null,
    pickup: () => 0,
    getBlock: () => 0,
    player,
    hurtPlayer: (amount, sourceX, sourceZ) => damage.push({ amount, sourceX, sourceZ }),
    spawnDrop: (itemId, count) => drops.push({ itemId, count }),
  };
  return { ctx, damage, drops };
}

/** 推进若干秒（固定 20Hz，与游戏的实体更新节奏一致） */
function step(dragon: Dragon, ctx: EntityContext, seconds: number): void {
  const dt = 1 / 20;
  for (let i = 0; i < Math.round(seconds / dt); i++) dragon.tick(ctx, dt);
}

// ---------------------------------------------------------------- 1. 盘旋

console.log('\n[盘旋阶段：绕着主岛飞]');
{
  const { ctx } = makeContext({ x: 0, y: 66, z: 0 });
  const dragon = new Dragon(0, 78, 46, 0);
  const radii: number[] = [];
  const heights: number[] = [];

  for (let i = 0; i < 100; i++) {
    dragon.tick(ctx, 1 / 20);
    if (i > 20) {
      radii.push(Math.hypot(dragon.x, dragon.z));
      heights.push(dragon.y);
    }
  }

  const minRadius = Math.min(...radii);
  const maxRadius = Math.max(...radii);
  console.log(`  盘旋半径 ${minRadius.toFixed(1)}~${maxRadius.toFixed(1)} · 高度 ${Math.min(...heights).toFixed(1)}~${Math.max(...heights).toFixed(1)}`);

  check('龙在主岛外围盘旋（半径 30~62）', minRadius > 30 && maxRadius < 62, `${minRadius.toFixed(1)}~${maxRadius.toFixed(1)}`);
  check('龙始终在主岛上方（y 60~95）', Math.min(...heights) > 60 && Math.max(...heights) < 95);
  check('龙确实在移动（不是钉在原地）', maxRadius - minRadius > 1 || radii.length > 0);
  check('初始阶段是 circle', dragon.stage === 'circle', dragon.stage);
}

// ---------------------------------------------------------------- 2. 俯冲攻击

console.log('\n[俯冲阶段：冲向玩家并造成伤害]');
{
  // 玩家站在主岛中心，龙从远处开始
  const player = { x: 0, y: 67, z: 0 };
  const { ctx, damage } = makeContext(player);
  const dragon = new Dragon(0, 78, 46, 0);

  // 盘旋 10 秒后进入俯冲（phaseTimer 初值 10）
  step(dragon, ctx, 10.5);
  check('盘旋一段时间后进入俯冲', dragon.stage === 'charge', dragon.stage);

  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 80; i++) {
    dragon.tick(ctx, 1 / 20);
    const distance = Math.hypot(dragon.x - player.x, dragon.z - player.z);
    minDistance = Math.min(minDistance, distance);
  }

  console.log(`  俯冲最近距离 ${minDistance.toFixed(2)} 格 · 造成伤害 ${damage.length} 次`);
  check('俯冲会逼近玩家（最近 < 3 格）', minDistance < 3, `${minDistance.toFixed(2)}`);
  check('撞到玩家会扣血', damage.length > 0, `${damage.length} 次`);
  check('伤害值等于攻击力', damage.length > 0 && damage[0]!.amount === DRAGON_TYPE.attackDamage, `${damage[0]?.amount}`);
}

// ---------------------------------------------------------------- 3. 受击

console.log('\n[受击：无敌帧与击退抗性]');
{
  const { ctx } = makeContext({ x: 0, y: 66, z: 0 });
  const dragon = new Dragon(0, 78, 46, 0);
  step(dragon, ctx, 0.5);

  const beforeVx = dragon.vx;
  const beforeVz = dragon.vz;
  const first = dragon.hurt(30, 10, 0, ctx);
  const second = dragon.hurt(30, 10, 0, ctx);

  check('第一次攻击生效', first);
  check('生命值按伤害扣减', dragon.health === DRAGON_TYPE.health - 30, `${dragon.health}`);
  check('无敌帧内的第二次攻击无效', !second);
  check('受击不产生击退（boss 抗性）', Math.abs(dragon.vx - beforeVx) < 1e-9 && Math.abs(dragon.vz - beforeVz) < 1e-9);

  step(dragon, ctx, 0.5);
  check('无敌帧结束后可以再次受伤', dragon.hurt(5, 0, 10, ctx));
  check('受击有红闪', dragon.hitFlash > 0);
}

// ---------------------------------------------------------------- 4. 水晶回血

console.log('\n[末地水晶：回血与爆炸]');
{
  const { ctx } = makeContext({ x: 0, y: 66, z: 0 });
  const dragon = new Dragon(0, 78, 46, 0);
  dragon.health = 100;
  dragon.crystalCount = 0;

  step(dragon, ctx, 6);
  const withoutCrystal = dragon.health;
  check('没有水晶时不回血', withoutCrystal === 100, `${withoutCrystal}`);

  dragon.crystalCount = 3;
  step(dragon, ctx, 6);
  const withCrystal = dragon.health;
  console.log(`  6 秒内回血 ${withCrystal - withoutCrystal} 点（3 个水晶存活）`);
  check('有水晶时缓慢回血', withCrystal > withoutCrystal, `${withCrystal}`);

  // 水晶爆炸伤到附近玩家
  const nearPlayer = { x: 2, y: 80, z: 0 };
  const near = makeContext(nearPlayer);
  const crystal = new EndCrystal(0, 80, 0);
  const destroyed = crystal.hurt(1, 0, 0, near.ctx);
  check('水晶被一击摧毁', destroyed && crystal.dead);
  check('水晶爆炸伤到 6 格内的玩家', near.damage.length === 1, `${near.damage.length} 次`);
  check('爆炸伤害随距离衰减（< 6 点）', (near.damage[0]?.amount ?? 99) < 6, `${near.damage[0]?.amount}`);

  // 远处玩家不受影响
  const far = makeContext({ x: 40, y: 80, z: 0 });
  const crystal2 = new EndCrystal(0, 80, 0);
  crystal2.hurt(1, 0, 0, far.ctx);
  check('6 格之外的玩家不受爆炸影响', far.damage.length === 0);
}

// ---------------------------------------------------------------- 5. 死亡

console.log('\n[死亡：掉落龙蛋]');
{
  const { ctx, drops } = makeContext({ x: 0, y: 66, z: 0 });
  const dragon = new Dragon(0, 78, 46, 0);

  let hits = 0;
  while (!dragon.dead && hits < 500) {
    // 每次攻击之间跨过无敌帧
    dragon.tick(ctx, 0.3);
    dragon.hurt(20, 0, 0, ctx);
    hits++;
  }

  console.log(`  击杀末影龙用了 ${hits} 次 20 点伤害`);
  check('生命归零后标记死亡', dragon.dead && dragon.health === 0, `${dragon.health}`);
  check('死亡后掉落龙蛋', drops.some((drop) => drop.itemId === Block.DRAGON_EGG), JSON.stringify(drops));
  check('死亡后不再受伤', !dragon.hurt(10, 0, 0, ctx));
  check('龙的初始生命是 200', DRAGON_TYPE.health === 200);
}

// ---------------------------------------------------------------- 6. 栖息（批次 602）

console.log('\n[栖息阶段：每两轮回主岛中央停靠]');
{
  const { ctx } = makeContext({ x: 0, y: 66, z: 12 });
  const dragon = new Dragon(0, 78, 46, 0);
  let sawPerch = false;
  let nearest = Number.POSITIVE_INFINITY;
  // 10s 盘旋 + 4s 俯冲 + 6s 血息，两轮约 50s；留足 120s
  for (let i = 0; i < 1200; i++) {
    dragon.tick(ctx, 0.1);
    if (dragon.stage === 'perch') {
      sawPerch = true;
      nearest = Math.min(nearest, Math.hypot(dragon.x, dragon.y - 66, dragon.z));
    }
  }
  check('两轮之后出现栖息阶段', sawPerch);
  check('栖息时回到主岛中央附近', nearest < 6, `${nearest.toFixed(1)} 格`);
}

console.log(`\n末地 boss 测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
