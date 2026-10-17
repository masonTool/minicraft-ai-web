/**
 * 实体与掉落物的离线测试
 *
 * 运行：npm run test:entity
 * 用一个假的碰撞世界（地面 + 一堵墙）驱动实体，验证重力、落地、拾取、超时消失与区块清理。
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Item, isFireproofItem } from '../src/core/registry/items.ts';
import { createMob } from '../src/core/entity/MobFactory.ts';
import { mobTypeById } from '../src/core/entity/mobs.ts';
import { readFileSync } from 'node:fs';
import { TOOL_KINDS, toolItemId } from '../src/core/registry/tools.ts';
import { ItemEntity, ITEM_FIRE_SECONDS, ITEM_LIFETIME } from '../src/core/entity/ItemEntity.ts';
import { ORB_VALUES, XP_ORB_LIFETIME, XpOrb, splitXpOrbs } from '../src/core/entity/XpOrb.ts';
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

function makeContext(pickup: EntityContext['pickup'] = () => 0): EntityContext {
  return {
    world,
    playerBox: null,
    pickup,
    // 下面四项对"掉落物"这套断言用不上，但**接口要求**它们存在：
    // 桩对象少实现几个方法时 `npm test` 照样绿（这正是 O6 要修的盲区）
    getBlock: () => 0,
    player: null,
    hurtPlayer: () => {},
    spawnDrop: () => {},
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
  const ctx: EntityContext = {
    world: waterWorld,
    playerBox: null,
    pickup: () => 0,
    getBlock: () => 0,
    player: null,
    hurtPlayer: () => {},
    spawnDrop: () => {},
  };
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


console.log('\n[掉落物：带的是整份栈（批次 63）]');
{
  const plain = new ItemEntity(Block.STONE, 3, 0, 5, 0, { x: 0, y: 0, z: 0 });
  equal('白板的整栈还原', JSON.stringify(plain.toStack()), JSON.stringify({ id: Block.STONE, count: 3 }));

  const fancy = new ItemEntity(Block.STONE, 1, 0, 5, 0, { x: 0, y: 0, z: 0 }, {
    name: '地基',
    damage: 7,
    enchants: { efficiency: 3 },
    repairCost: 2,
  });
  const stack = fancy.toStack();
  equal('名字跟着掉下来', stack.name, '地基');
  equal('耐久跟着掉下来', stack.damage, 7);
  equal('附魔跟着掉下来', stack.enchants?.efficiency, 3);
  equal('累积惩罚也跟着（再修一次的代价不该变）', stack.repairCost, 2);

  // 合并判定：只比 id 会把"改了名的"并进普通那堆
  const plainB = new ItemEntity(Block.STONE, 1, 0, 5, 0, { x: 0, y: 0, z: 0 });
  check('同 id 同附加数据 → 同一件东西', plain.sameAs(plainB));
  check('同 id 不同名字 → 不是同一件东西', !plain.sameAs(fancy));
  const otherEnchant = new ItemEntity(Block.STONE, 1, 0, 5, 0, { x: 0, y: 0, z: 0 }, { enchants: { efficiency: 4 } });
  check('附魔等级不同 → 不是同一件东西', !fancy.sameAs(otherEnchant));
  const same = new ItemEntity(Block.STONE, 5, 0, 5, 0, { x: 0, y: 0, z: 0 }, {
    name: '地基',
    damage: 7,
    enchants: { efficiency: 3 },
    repairCost: 2,
  });
  check('完全一样 → 同一件东西（可以并堆）', fancy.sameAs(same));

  // 拾取时把附加数据一起交给背包（假上下文记录收到了什么）
  let picked: { id: number; count: number; extras: unknown } | null = null;
  const ctx = makeContext((itemId, count, extras) => {
    picked = { id: itemId, count, extras };
    return 0;
  });
  (ctx as { playerBox: unknown }).playerBox = boxAt(0, 5, 0, 1, 1.8);
  fancy.age = 1;
  fancy.tick(ctx, 0.05);
  equal('拾取回调收到了这一堆', picked !== null, true);
  check(
    '附加数据一起交出去了',
    JSON.stringify((picked as { extras?: unknown } | null)?.extras) === JSON.stringify(fancy.extras),
  );
  check('收下之后就消失了', fancy.dead);
}

console.log('\n[掉落物：岩浆与火焰会把它销毁（批次 168，J18）]');
{
  /**
   * 用户/规格要的那件事：**掉进岩浆的普通掉落物会没**，而下界合金那一族（`fireproof`）
   * 泡在岩浆里也不会消失——这才是 K8 里"下界合金不会被火烧掉"能成立的前提。
   *
   * 这几条断言的搭法：掉落物静止时脚在 y∈[0, 0.25)，`burnAway()` 读的是
   * `floor(y + 0.12)` 那一格，也就是 **y = 0 这一层**；所以只让 `getBlock`
   * 对 y === 0 回答"岩浆 / 火 / 空气"，其余给空气。
   */
  let cell: number = Block.AIR;
  const burningCtx = (): EntityContext => ({
    ...makeContext(),
    getBlock: (_x: number, y: number) => (y === 0 ? cell : Block.AIR),
  });

  // ① 普通掉落物碰到岩浆：当场销毁（不用等）
  cell = Block.LAVA;
  const inLava = new ItemEntity(Block.STONE, 1, 0.5, 0.3, 0.5, { x: 0, y: 0, z: 0 });
  inLava.tick(burningCtx(), 0.05);
  check('普通掉落物掉进岩浆 → 一 tick 就没了', inLava.dead);

  // ② 火里不是立刻没：烧 1.5 秒才销毁（给玩家伸手捡回来的余地）
  cell = Block.FIRE;
  const inFire = new ItemEntity(Block.STONE, 1, 0.5, 0.3, 0.5, { x: 0, y: 0, z: 0 });
  advance(inFire, burningCtx(), 1.0);
  check('泡在火里 1 秒还在（原版也留了一点余地）', !inFire.dead);
  advance(inFire, burningCtx(), 0.7);
  check(`泡满 ${ITEM_FIRE_SECONDS} 秒才烧掉`, inFire.dead);

  // ③ 离开火焰要清零：1 秒 + 跳出去 + 再 1 秒，仍然活着（不是"累计 1.5 秒"）
  cell = Block.FIRE;
  const hopping = new ItemEntity(Block.STONE, 1, 0.5, 0.3, 0.5, { x: 0, y: 0, z: 0 });
  advance(hopping, burningCtx(), 1.0);
  cell = Block.AIR;
  advance(hopping, burningCtx(), 0.2);
  cell = Block.FIRE;
  advance(hopping, burningCtx(), 1.0);
  check('跳出火焰后计时清零（不是累计 1.5 秒）', !hopping.dead);
  advance(hopping, burningCtx(), 0.6);
  check('再连着烧满就又没了', hopping.dead);

  // ④ 下界合金：岩浆与火都不怕
  cell = Block.LAVA;
  const alloyLava = new ItemEntity(Item.NETHERITE_INGOT, 1, 0.5, 0.3, 0.5, { x: 0, y: 0, z: 0 });
  advance(alloyLava, burningCtx(), 2);
  check('下界合金锭在岩浆里不会消失', !alloyLava.dead);
  cell = Block.FIRE;
  const alloyFire = new ItemEntity(Item.NETHERITE_INGOT, 1, 0.5, 0.3, 0.5, { x: 0, y: 0, z: 0 });
  advance(alloyFire, burningCtx(), 3);
  check('下界合金锭在火里也不会消失', !alloyFire.dead);

  // ⑤ 判据本身：按名字派生（以后再加下界合金的东西自动在里面）
  check('下界合金锭 / 残骸 / 远古残骸都算 fireproof', isFireproofItem(Item.NETHERITE_INGOT) && isFireproofItem(Item.NETHERITE_SCRAP) && isFireproofItem(Block.ANCIENT_DEBRIS));
  check(
    '下界合金的每一种工具都算 fireproof（派生，不是手抄一张表）',
    TOOL_KINDS.every((kind) => isFireproofItem(toolItemId(kind, 'netherite'))),
  );
  check('钻石镐 / 钻石 / 石头都不算（别把所有东西都豁免了）', !isFireproofItem(toolItemId('pickaxe', 'diamond')) && !isFireproofItem(Item.DIAMOND) && !isFireproofItem(Block.STONE));
}

console.log('\n[经验球：拆档 / 吸附 / 结算 / 合并（批次 170，I16）]');
{
  // ---- 拆档：一堆经验要按原版那几档拆开（10 → 7+3，而不是 10 个 1 点的小球）
  equal('0 点不掉球', splitXpOrbs(0).length, 0);
  equal('负经验不掉球（惩罚不该生成负数的球）', splitXpOrbs(-5).length, 0);
  equal('1 点 = 一个 1 档球', splitXpOrbs(1).join(','), '1');
  equal('3 点 = 一个 3 档球', splitXpOrbs(3).join(','), '3');
  equal('10 点 = 7 + 3', splitXpOrbs(10).join(','), '7,3');
  equal('100 点 = 73 + 17 + 7 + 3', splitXpOrbs(100).join(','), '73,17,7,3');
  const dragon = splitXpOrbs(12000);
  equal('12000 点（末影龙）拆开后总数不变', dragon.reduce((sum, value) => sum + value, 0), 12000);
  check(
    '拆出来的每一档都在表里（不是随手编的数字）',
    dragon.every((value) => ORB_VALUES.includes(value)),
  );
  check('球的数量远少于点数（否则实体表会被一堆 1 点球塞满）', dragon.length < 20, String(dragon.length));

  // ---- 吸附与结算：玩家在 8 格内就朝人飞，贴到 0.9 格内结算
  const picked: number[] = [];
  const ctx = {
    ...makeContext(),
    player: { x: 0, y: 0, z: 0 },
    awardXp: (amount: number) => picked.push(amount),
  } as EntityContext;

  const near = new XpOrb(7, 0.5, 0.5, 0.5);
  near.age = 1; // 跳过"刚生成"的合并冷却（合并逻辑在 EntityManager 里，这里无所谓）
  near.tick(ctx, 0.05);
  equal('贴身就结算（球消失 + 经验到账）', `${near.dead}/${picked.join(',')}`, 'true/7');

  const far = new XpOrb(3, 5, 0.5, 0);
  const before = Math.hypot(far.x - 0, far.y - 0.8, far.z - 0);
  for (let i = 0; i < 10; i++) far.tick(ctx, 0.05);
  const after = Math.hypot(far.x - 0, far.y - 0.8, far.z - 0);
  check('8 格内会自动飞过来（距离在缩小）', after < before, `${before.toFixed(2)} → ${after.toFixed(2)}`);

  // ⚠️ 两处"别让断言判错东西"的细节：
  //  ① 位置要留在假世界的"空地"里（`x >= 4` 是那堵墙，丢在那里会被碰撞推出来）；
  //  ② 初速显式给 0——默认初速是"像丢东西一样往上一抛"，`vy` 一开始就是正的，
  //     拿 `vy < 0` 当"受重力"会判出反直觉的结果（这一条就是被它绊了一次）。
  const away = new XpOrb(1, 2, 0.5, 0, { x: 0, y: 0, z: 0 });
  const awayX = away.x;
  away.tick({ ...ctx, player: { x: 100, y: 0, z: 0 } } as EntityContext, 0.05);
  check(
    '超出 8 格不会被吸走（原地只受重力）',
    Math.abs(away.x - awayX) < 1e-9 && away.vy < 0,
    `x=${away.x} vy=${away.vy.toFixed(3)}`,
  );

  // ---- 超时消失（原版 5 分钟）
  const old = new XpOrb(1, 30, 0.5, 0);
  old.age = XP_ORB_LIFETIME + 1;
  old.tick({ ...ctx, player: null } as EntityContext, 0.05);
  check('5 分钟后自己消失', old.dead);

  // ---- 合并：靠近的两个球并成一个（金额相加），而不是各飞各的
  const manager = new EntityManager();
  const a = manager.spawn(new XpOrb(3, 0.5, 1, 0.5));
  const b = manager.spawn(new XpOrb(7, 0.6, 1, 0.6));
  manager.update({ ...ctx, player: null } as EntityContext, 0.6);
  const orbs = manager.all.filter((entity) => entity instanceof XpOrb) as XpOrb[];
  equal('靠近的两个球并成一个', orbs.length, 1);
  equal('并起来的金额相加', orbs[0]?.amount, 10);
  void a;
  void b;

  // ---- 生物死亡要**掉球**（不是直接进账）：位置就是它倒下的地方
  const dropped: Array<{ amount: number; x: number; y: number; z: number }> = [];
  const mobCtx = {
    ...makeContext(),
    spawnXpOrbs: (amount: number, x: number, y: number, z: number) => dropped.push({ amount, x, y, z }),
  } as unknown as EntityContext;
  const zombieType = mobTypeById('zombie');
  check('生物表里有僵尸（下面那条断言的前提）', zombieType !== undefined);
  const zombie = createMob(zombieType!, 3.5, 0.5, 2.5);
  zombie.hurt(999, 0, 0, mobCtx);
  equal('僵尸倒下时掉了经验', dropped.length, 1);
  equal('掉的是它表里那个数值', dropped[0]?.amount, zombieType!.xp);
  check('球掉在它倒下的位置（x/z 对得上，y 抬到半身高）', dropped[0]?.x === 3.5 && dropped[0]?.z === 2.5 && (dropped[0]?.y ?? 0) > 0.5);

  // ---- 主程序两处接线（源码级）：死亡掉球那条公式 + 上下文把两个钩子分开
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check(
    '玩家死亡掉 min(等级×7, 100) 点球（原版那条公式）',
    mainSrc.includes('Math.min(this.experience.level * 7, 100)'),
  );
  check(
    '上下文里"生成"与"记账"是两个钩子（合成一个就测不了掉球）',
    mainSrc.includes('spawnXpOrbs: (amount, x, y, z) => this.spawnXpOrbs(amount, x, y, z)') &&
      mainSrc.includes('awardXp: (amount) => this.awardXp(amount)'),
  );
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
