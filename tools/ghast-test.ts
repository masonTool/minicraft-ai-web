/**
 * 恶魂离线测试（批次 94，J26 的最后一块）
 *
 * 它是**唯一掉恶魂之泪**的生物——接上它，"再生"那一族药水才通，
 * 批次 91 量出的"整族 112 件药水/药水箭拿不到"到这里正式收口。
 *
 * 要证的东西：
 *  1. **数据**：10 点生命、4×4 的大块头、**不近战**（伤害全在火球上）、
 *     只在下界自然刷、空腔要 4×4；
 *  2. **飞行 AI 与别的会飞生物相反**：它**不贴身**——太近往后退、太远往前挪、
 *     "刚合适"就悬停（原版就是远远吊着打）；
 *  3. **大火球**：约 3 秒一颗、命中 **6 点伤害 + 点燃 + 炸开一片**（威力 1）；
 *     超过 48 格不吐（对着空气吐看起来像 bug）。
 *
 * 运行：npm run test:ghast
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import { Mob, mobLabel } from '../src/core/entity/Mob.ts';
import { Ghast, GHAST_FIRE_COOLDOWN, GHAST_FIRE_RANGE, GHAST_KEEP_DISTANCE } from '../src/core/entity/Ghast.ts';
import { GHAST_TYPE, HOSTILE_MOBS, MOB_TYPES, mobSpawnsIn } from '../src/core/entity/mobs.ts';
import { createMob } from '../src/core/entity/MobFactory.ts';
import { Throwable, LARGE_FIREBALL_DAMAGE, LARGE_FIREBALL_FIRE_SECONDS, LARGE_FIREBALL_POWER } from '../src/core/entity/Throwable.ts';
import { describeMobModel } from '../src/render/MobRenderer.ts';
import type { EntityContext } from '../src/core/entity/Entity.ts';
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

/** 空世界：脚下实心在 y<64，其余都是空气（会飞的东西不需要地形） */
const physics: PhysicsWorld = {
  collisionAt: (_x: number, y: number) => (y < 64 ? 'full' : null),
  isLiquid: () => false,
} as unknown as PhysicsWorld;

interface Recorder {
  damage: number;
  ignited: number;
  /** 吐出来的火球；`mouthOffset` = 火球相对"吐它的那只恶魂"的高度（用来验"从身体中部吐出"） */
  fireballs: { x: number; y: number; z: number; vx: number; vy: number; vz: number; mouthOffset: number }[];
  ctx: EntityContext;
}

function makeCtx(player: { x: number; y: number; z: number } | null, source?: Mob): Recorder {
  const rec: Recorder = { damage: 0, ignited: 0, fireballs: [], ctx: null as unknown as EntityContext };
  rec.ctx = {
    world: physics,
    playerBox: null,
    pickup: () => 0,
    getBlock: () => Block.AIR,
    player,
    hurtPlayer: (amount: number) => {
      rec.damage += amount;
    },
    ignitePlayer: (seconds: number) => {
      rec.ignited = seconds;
    },
    spawnLargeFireball: (x: number, y: number, z: number, velocity: { x: number; y: number; z: number }) => {
      rec.fireballs.push({
        x,
        y,
        z,
        vx: velocity.x,
        vy: velocity.y,
        vz: velocity.z,
        mouthOffset: source ? y - source.y : Number.NaN,
      });
    },
  } as unknown as EntityContext;
  return rec;
}

function distanceTo(ghast: Ghast, player: { x: number; y: number; z: number }): number {
  return Math.hypot(player.x - ghast.x, player.z - ghast.z);
}

// ---------------------------------------------------------------- 1. 数据

console.log('\n[恶魂：数据]');
{
  equal('在生物表里', MOB_TYPES.some((type) => type.id === 'ghast'), true);
  equal('名字', mobLabel(GHAST_TYPE), '恶魂');
  equal('生命 10（很脆）', GHAST_TYPE.health, 10);
  check('**大块头**：4×4（本项目最大的生物）', GHAST_TYPE.width === 4 && GHAST_TYPE.height === 4);
  check('会飞、免疫火焰', GHAST_TYPE.flying === true && GHAST_TYPE.fireImmune === true);
  equal('**不近战**（原版撞到人也不掉血，伤害全在火球上）', GHAST_TYPE.attackDamage, 0);
  equal('只在**下界**自然刷', GHAST_TYPE.dimension, 'nether');
  check('空腔要 4×4（不然 4 格宽的身子会卡在岩层里）', GHAST_TYPE.spawnSpace?.width === 4 && GHAST_TYPE.spawnSpace?.height === 4);
  check('在"会自然刷的敌对生物"表里（往下界刷）', HOSTILE_MOBS.includes(GHAST_TYPE));
  check('`mobSpawnsIn` 认下界、不认主世界', mobSpawnsIn(GHAST_TYPE, 'nether') && !mobSpawnsIn(GHAST_TYPE, 'overworld'));
  check('别的生物默认在主世界刷（对照）', mobSpawnsIn(MOB_TYPES.find((type) => type.id === 'zombie')!, 'overworld'));

  const tear = GHAST_TYPE.drops.find((drop) => drop.itemId === Item.GHAST_TEAR);
  const powder = GHAST_TYPE.drops.find((drop) => drop.itemId === Item.GUNPOWDER);
  check('掉恶魂之泪 0~1（"再生"药水唯一的原料）', tear !== undefined && tear.min === 0 && tear.max === 1);
  check('掉火药 0~2（TNT 的原料，第二个来源）', powder !== undefined && powder.min === 0 && powder.max === 2);
  equal('击杀经验 5', GHAST_TYPE.xp, 5);
}

// ---------------------------------------------------------------- 2. 工厂与模型

console.log('\n[恶魂：工厂与模型]');
{
  const mob = createMob(GHAST_TYPE, 0, 100, 0);
  check('工厂造出来的是 `Ghast` 子类（它有自己的招）', mob instanceof Ghast);
  check('它仍然是 `Mob`', mob instanceof Mob);

  const model = describeMobModel(GHAST_TYPE);
  equal('用 `ghast` 骨架', model.kind, 'ghast');
  equal('部件数 = 身体 1 + 眉眼 4 + 触手 9 = 14', model.parts, 14);
  equal('没有部件参与走路摆动（触手是垂着的）', model.legs, 0);
}

// ---------------------------------------------------------------- 3. 飞行：保持距离

console.log('\n[恶魂：不贴身，远远吊着打]');
{
  // 太近 → 往后退
  const close = new Ghast(0, 100, 0);
  const closeRec = makeCtx({ x: 4, y: 64, z: 0 });
  const before = distanceTo(close, closeRec.ctx.player!);
  for (let i = 0; i < 100; i++) close.tick(closeRec.ctx, 0.05); // 5 秒
  const after = distanceTo(close, closeRec.ctx.player!);
  check(`贴太近会往后退（${before.toFixed(1)} → ${after.toFixed(1)}）`, after > before + 2);

  // 太远 → 往前挪
  const far = new Ghast(0, 100, 0);
  const farRec = makeCtx({ x: 40, y: 64, z: 0 });
  const farBefore = distanceTo(far, farRec.ctx.player!);
  for (let i = 0; i < 100; i++) far.tick(farRec.ctx, 0.05);
  const farAfter = distanceTo(far, farRec.ctx.player!);
  check(`太远会往前挪（${farBefore.toFixed(1)} → ${farAfter.toFixed(1)}）`, farAfter < farBefore - 2);

  // "刚合适" → 只悬停（不留那一圈它会在目标距离上左右抖）
  const steady = new Ghast(0, 100, 0);
  const steadyRec = makeCtx({ x: GHAST_KEEP_DISTANCE, y: 64, z: 0 });
  const steadyBefore = distanceTo(steady, steadyRec.ctx.player!);
  for (let i = 0; i < 100; i++) steady.tick(steadyRec.ctx, 0.05);
  const steadyAfter = distanceTo(steady, steadyRec.ctx.player!);
  check(`距离刚合适时几乎不动（${steadyBefore.toFixed(1)} → ${steadyAfter.toFixed(1)}）`, Math.abs(steadyAfter - steadyBefore) < 4);

  // 悬停：没有重力，既不落地也不往上飘
  const drifting = new Ghast(0, 100, 0);
  const driftRec = makeCtx(null);
  const y0 = drifting.y;
  for (let i = 0; i < 60; i++) drifting.tick(driftRec.ctx, 0.05);
  check('没目标时悬停浮动（3 秒里没有往下掉）', Math.abs(drifting.y - y0) < 2, `${y0} → ${drifting.y.toFixed(2)}`);
}

// ---------------------------------------------------------------- 4. 开火

console.log('\n[恶魂：吐大火球]');
{
  const inRange = new Ghast(0, 100, 0);
  const rec = makeCtx({ x: 20, y: 64, z: 0 }, inRange);
  for (let i = 0; i < 200; i++) inRange.tick(rec.ctx, 0.05); // 10 秒
  check(`10 秒里吐了 ${rec.fireballs.length} 颗（约 3 秒一颗）`, rec.fireballs.length >= 2 && rec.fireballs.length <= 4);
  const shot = rec.fireballs[0];
  check('火球朝玩家飞（+x 方向）', shot !== undefined && shot.vx > 0, JSON.stringify(shot));
  check(
    '火球从身体中部吐出（高度约半个身子，不会贴着脚底）',
    shot !== undefined && Math.abs(shot.mouthOffset - GHAST_TYPE.height * 0.5) < 0.05,
    String(shot?.mouthOffset),
  );
  equal('冷却常量是 3 秒（原版节奏）', GHAST_FIRE_COOLDOWN, 3);
  check('刚出生的冷却不到一个周期（不会一出生就打脸）', new Ghast(0, 100, 0).fireCooldown <= GHAST_FIRE_COOLDOWN);

  // 超出射程：不吐（对着空气吐像 bug）
  const outOfRange = new Ghast(0, 100, 0);
  const farRec = makeCtx({ x: GHAST_FIRE_RANGE + 30, y: 64, z: 0 });
  for (let i = 0; i < 200; i++) outOfRange.tick(farRec.ctx, 0.05);
  equal(`超过 ${GHAST_FIRE_RANGE} 格不吐`, farRec.fireballs.length, 0);
}

// ---------------------------------------------------------------- 5. 大火球的结算

console.log('\n[大火球：6 点伤害 + 点燃 + 炸开一片]');
{
  let damage = 0;
  let cause = '';
  let ignited = 0;
  let explodedPower = -1;

  const fireball = new Throwable(0, 100, 0, { x: 11, y: 0, z: 0 }, {
    kind: 'large_fireball',
    itemId: Item.BLAZE_POWDER,
  });
  const ctx = {
    world: physics,
    playerBox: { minX: 0.05, minY: 100, minZ: 0, maxX: 1, maxY: 101.8, maxZ: 0.6 },
    pickup: () => 0,
    getBlock: () => Block.AIR,
    player: null,
    hurtPlayer: (amount: number, _sx: number, _sz: number, damageCause?: string) => {
      damage = amount;
      cause = damageCause ?? '';
    },
    ignitePlayer: (seconds: number) => {
      ignited = seconds;
    },
    explode: (_x: number, _y: number, _z: number, power: number) => {
      explodedPower = power;
    },
  } as unknown as EntityContext;

  fireball.tick(ctx, 0.05);
  equal('直接命中 6 点（原版）', damage, LARGE_FIREBALL_DAMAGE);
  equal('伤害来源是 `fire`', cause, 'fire');
  equal('点着 5 秒', ignited, LARGE_FIREBALL_FIRE_SECONDS);
  check('**而且炸开一片**（小火球只打人不伤地形，两种火球的区别就在这里）', explodedPower >= 0);
  equal('爆炸威力与常量一致', explodedPower, LARGE_FIREBALL_POWER);
  check('命中之后自己消失', fireball.dead);

  // 重力对照：火球是一条直线（飞出去之后 y 速度不变）
  const straight = new Throwable(0, 100, 0, { x: 11, y: 0, z: 0 }, { kind: 'large_fireball', itemId: Item.BLAZE_POWDER });
  const openCtx = { ...ctx, playerBox: null } as unknown as EntityContext;
  for (let i = 0; i < 20; i++) straight.tick(openCtx, 0.05);
  check('不受重力（飞出去还是平飞）', Math.abs(straight.vy) < 1e-6, String(straight.vy));

  // 对照：小火球不炸
  let smallExploded = false;
  const small = new Throwable(0, 100, 0, { x: 11, y: 0, z: 0 }, { kind: 'small_fireball', itemId: Item.BLAZE_POWDER });
  small.tick(
    {
      ...ctx,
      explode: () => {
        smallExploded = true;
      },
    } as unknown as EntityContext,
    0.05,
  );
  check('（对照）烈焰人的小火球不炸地形', !smallExploded);
}

console.log(`\n恶魂测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
