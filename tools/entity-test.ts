/**
 * 实体与掉落物的离线测试
 *
 * 运行：npm run test:entity
 * 用一个假的碰撞世界（地面 + 一堵墙）驱动实体，验证重力、落地、拾取、超时消失与区块清理。
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import { ItemEntity, ITEM_LIFETIME } from '../src/core/entity/ItemEntity.ts';
import { EntityManager } from '../src/core/entity/EntityManager.ts';
import type { EntityContext } from '../src/core/entity/Entity.ts';
import type { PhysicsWorld } from '../src/core/physics/PlayerPhysics.ts';
import { boxAt } from '../src/core/physics/AABB.ts';

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

/** 地面位于 y<0；x>=4 处有一堵墙 */
const world: PhysicsWorld = {
  collisionAt: (x, y) => (y < 0 || x >= 4 ? 'full' : null),
  isLiquid: () => false,
};

function makeContext(pickup: (id: number, count: number) => number = () => 0): EntityContext {
  return {
    world,
    playerBox: null,
    pickup,
  };
}

function advance(entity: ItemEntity, ctx: EntityContext, seconds: number, step = 0.05): void {
  for (let t = 0; t < seconds; t += step) entity.tick(ctx, step);
}

console.log('\n[掉落物：重力与落地]');
{
  const item = new ItemEntity(Block.STONE, 1, 0.5, 6, 0.5, { x: 0, y: 0, z: 0 });
  const ctx = makeContext();

  advance(item, ctx, 0.5);
  check('自由下落中 y 变小', item.y < 6, `y=${item.y.toFixed(2)}`);

  advance(item, ctx, 2);
  check('落在地面上（y 约等于 0）', Math.abs(item.y) < 0.05, `y=${item.y.toFixed(4)}`);
  check('落地后标记为在地面', item.onGround);
  equal('落地后竖直速度归零', item.vy, 0);
}

console.log('\n[掉落物：水平运动与撞墙]');
{
  // 贴着墙起步并给一个大初速，确保第一帧就会撞上。
  // 注意原版掉落物的地面摩擦极大（约 0.6/tick），离墙太远根本滑不到墙边。
  const item = new ItemEntity(Block.DIRT, 1, 3.7, 0.5, 0.5, { x: 8, y: 0, z: 0 });
  const ctx = makeContext();
  advance(item, ctx, 3);

  check('被墙挡住（x 不超过 4）', item.x < 4, `x=${item.x.toFixed(3)}`);
  check('贴到墙面（x 接近 3.875）', Math.abs(item.x - 3.875) < 0.02, `x=${item.x.toFixed(3)}`);
  equal('撞墙后水平速度归零', item.vx, 0);

  // 地面摩擦：给一个初速后应当很快停下
  const sliding = new ItemEntity(Block.DIRT, 1, 0.5, 0.1, 0.5, { x: 3, y: 0, z: 0 });
  const ctx2 = makeContext();
  advance(sliding, ctx2, 0.05);
  advance(sliding, ctx2, 2);
  check('地面摩擦让掉落物迅速停下', Math.abs(sliding.vx) < 0.01, `vx=${sliding.vx.toFixed(4)}`);
}

console.log('\n[掉落物：拾取]');
{
  const picked: Array<[number, number]> = [];
  const ctx = makeContext((id, count) => {
    picked.push([id, count]);
    return 0;
  });
  ctx.playerBox = boxAt(0.5, 0, 0.5, 0.6, 1.8);

  const item = new ItemEntity(Item.DIAMOND, 3, 0.5, 0.3, 0.5, { x: 0, y: 0, z: 0 });

  // 前 0.5 秒是拾取冷却，不应该被收走
  advance(item, ctx, 0.4);
  equal('冷却期内未被拾取', picked.length, 0);
  check('冷却期内仍然存在', !item.dead);

  advance(item, ctx, 0.3);
  equal('冷却结束后被拾取一次', picked.length, 1);
  equal('拾取到钻石 3 个', `${picked[0]![0]}:${picked[0]![1]}`, `${Item.DIAMOND}:3`);
  check('拾取后实体移除', item.dead);
}

console.log('\n[掉落物：背包放不下时留在原地]');
{
  const ctx = makeContext((_id, count) => count);
  ctx.playerBox = boxAt(0.5, 0, 0.5, 0.6, 1.8);

  const item = new ItemEntity(Block.STONE, 64, 0.5, 0.3, 0.5, { x: 0, y: 0, z: 0 });
  advance(item, ctx, 1.5);
  check('未被移除', !item.dead);
  equal('数量保持不变', item.count, 64);
}

console.log('\n[掉落物：超时消失]');
{
  const item = new ItemEntity(Block.STONE, 1, 0.5, 0.5, 0.5, { x: 0, y: 0, z: 0 });
  const ctx = makeContext();
  advance(item, ctx, ITEM_LIFETIME - 5);
  check('5 分钟内仍然存在', !item.dead);
  advance(item, ctx, 10);
  check('超过 5 分钟后消失', item.dead);
  equal('存在时长常量为 300 秒', ITEM_LIFETIME, 300);
}

console.log('\n[掉落物：水中上浮]');
{
  const waterWorld: PhysicsWorld = {
    collisionAt: (_x, y) => (y < -10 ? 'full' : null),
    isLiquid: (_x, y) => y < 5,
  };
  const ctx: EntityContext = { world: waterWorld, playerBox: null, pickup: () => 0 };
  const item = new ItemEntity(Block.SAND, 1, 0.5, -5, 0.5, { x: 0, y: -3, z: 0 });
  advance(item, ctx, 1);
  check('水中速度被限制住（上浮而非下坠）', item.vy > -0.1, `vy=${item.vy.toFixed(3)}`);
  const before = item.y;
  advance(item, ctx, 2);
  check('在水中向上浮', item.y > before, `y ${before.toFixed(2)} → ${item.y.toFixed(2)}`);
}

console.log('\n[掉落物：同类合并]');
{
  const ctx = makeContext();

  // 同类且靠近 → 合并成一堆
  const manager = new EntityManager();
  const a = new ItemEntity(Block.STONE, 20, 0.5, 0.5, 0.5, { x: 0, y: 0, z: 0 });
  const b = new ItemEntity(Block.STONE, 12, 1.0, 0.5, 0.5, { x: 0, y: 0, z: 0 });
  a.age = 1;
  b.age = 1;
  manager.spawn(a);
  manager.spawn(b);
  manager.update(ctx, 0.05);
  equal('同类掉落物合并为一个实体', manager.count, 1);
  equal('数量相加', (manager.all[0] as ItemEntity).count, 32);

  // 不同物品不合并
  const manager2 = new EntityManager();
  const c = new ItemEntity(Block.STONE, 1, 0.5, 0.5, 0.5, { x: 0, y: 0, z: 0 });
  const d = new ItemEntity(Block.DIRT, 1, 1.0, 0.5, 0.5, { x: 0, y: 0, z: 0 });
  c.age = 1;
  d.age = 1;
  manager2.spawn(c);
  manager2.spawn(d);
  manager2.update(ctx, 0.05);
  equal('不同物品不合并', manager2.count, 2);

  // 合并遵循堆叠上限
  const manager3 = new EntityManager();
  const e = new ItemEntity(Block.STONE, 40, 0.5, 0.5, 0.5, { x: 0, y: 0, z: 0 });
  const f = new ItemEntity(Block.STONE, 40, 1.0, 0.5, 0.5, { x: 0, y: 0, z: 0 });
  e.age = 1;
  f.age = 1;
  manager3.spawn(e);
  manager3.spawn(f);
  manager3.update(ctx, 0.05);
  const counts = (manager3.all as ItemEntity[]).map((item) => item.count).sort((p, q) => q - p);
  equal('80 个同类按 64 上限拆成两堆', `${manager3.count}:${counts.join(',')}`, '2:64,16');

  // 刚丢出的不参与合并
  const manager4 = new EntityManager();
  const g = new ItemEntity(Block.STONE, 5, 0.5, 0.5, 0.5, { x: 0, y: 0, z: 0 });
  const h = new ItemEntity(Block.STONE, 5, 0.8, 0.5, 0.5, { x: 0, y: 0, z: 0 });
  manager4.spawn(g);
  manager4.spawn(h);
  manager4.update(ctx, 0.05);
  equal('0.5 秒冷却期内不合并', manager4.count, 2);

  // 距离太远不合并
  const manager5 = new EntityManager();
  const i = new ItemEntity(Block.STONE, 5, 0.5, 0.5, 0.5, { x: 0, y: 0, z: 0 });
  const j = new ItemEntity(Block.STONE, 5, 5.0, 0.5, 0.5, { x: 0, y: 0, z: 0 });
  i.age = 1;
  j.age = 1;
  manager5.spawn(i);
  manager5.spawn(j);
  manager5.update(ctx, 0.05);
  equal('距离超过 1 格不合并', manager5.count, 2);
}

console.log('\n[实体管理器]');
{
  const manager = new EntityManager();
  const ctx = makeContext();
  equal('初始为空', manager.count, 0);

  manager.spawn(new ItemEntity(Block.STONE, 1, 0.5, 5, 0.5, { x: 0, y: 0, z: 0 }));
  manager.spawn(new ItemEntity(Block.DIRT, 1, 40.5, 5, 40.5, { x: 0, y: 0, z: 0 }));
  equal('生成两个实体', manager.count, 2);

  const dying = new ItemEntity(Block.STONE, 1, 0.5, 5, 0.5, { x: 0, y: 0, z: 0 });
  dying.dead = true;
  manager.spawn(dying);
  manager.update(ctx, 0.05);
  equal('update 会移除已死亡实体', manager.count, 2);

  manager.removeInChunk(2, 2); // 40.5 → 区块 (2, 2)
  equal('按区块清理后剩 1 个', manager.count, 1);

  manager.clear();
  equal('清空', manager.count, 0);
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
