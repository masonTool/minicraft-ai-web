/**
 * 实体与掉落物的离线测试
 *
 * 运行：npm run test:entity
 * 用一个假的碰撞世界（地面 + 一堵墙）驱动实体，验证重力、落地、拾取、超时消失与区块清理。
 */

import { Block } from '../src/core/registry/blocks.ts';
import { withPowered } from '../src/core/registry/blockState.ts';
import { Item, isFireproofItem } from '../src/core/registry/items.ts';
import { createMob } from '../src/core/entity/MobFactory.ts';
import { mobTypeById } from '../src/core/entity/mobs.ts';
import { SPAWN_EGG_SPECS, spawnEggItemId, spawnEggMobOf } from '../src/core/registry/spawnEggs.ts';
import { readFileSync } from 'node:fs';
import { TOOL_KINDS, toolItemId } from '../src/core/registry/tools.ts';
import { ItemEntity, ITEM_FIRE_SECONDS, ITEM_LIFETIME } from '../src/core/entity/ItemEntity.ts';
import { ORB_VALUES, XP_ORB_LIFETIME, XpOrb, splitXpOrbs } from '../src/core/entity/XpOrb.ts';
import { EntityManager } from '../src/core/entity/EntityManager.ts';
import { Boat } from '../src/core/entity/Boat.ts';
import {
  VEHICLE_MAX_HEALTH,
  applyVehicleDamage,
  vehicleDropFor,
  vehicleHitDamage,
} from '../src/core/world/VehicleBreach.ts';
import { Horse, horseArmorTier } from '../src/core/entity/Horse.ts';
import { mobAppearanceKey } from '../src/render/MobRenderer.ts';
import {
  BEE_STING_POISON_SECONDS,
  BeeHives,
  HONEY_HARVEST_COOLDOWN,
  HONEY_MAX_LEVEL,
  HONEY_REGROW_SECONDS,
  shouldSting,
} from '../src/core/world/BeeHive.ts';
import { Minecart } from '../src/core/entity/Minecart.ts';
import { VehicleParking } from '../src/core/entity/VehicleParking.ts';
import { EntityParking } from '../src/core/entity/EntityParking.ts';
import { Arrow } from '../src/core/entity/Arrow.ts';
import { HopperMinecart } from '../src/core/entity/HopperMinecart.ts';
import { FURNACE_CART_FUEL_PER_COAL, FurnaceMinecart } from '../src/core/entity/FurnaceMinecart.ts';
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
  // ⚠️ 初速必须显式给 0：默认初速是"随机向四周弹一下"（±0.8 格/秒 + 向上一抛），
  // 0.6 秒后两个球可能已经飘出 1 格——那正好是合并半径，于是这条断言**时绿时红**
  // （批次 175 抓到的：它灰了一整轮才发现是"测试自己带随机性"）
  const a = manager.spawn(new XpOrb(3, 0.5, 1, 0.5, { x: 0, y: 0, z: 0 }));
  const b = manager.spawn(new XpOrb(7, 0.6, 1, 0.6, { x: 0, y: 0, z: 0 }));
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

console.log('\n[船：浮在水面 / 驾驶 / 空船漂（批次 244）]');
{
  // 水面在 y=3（水格 0..3），海底是实心
  const waterWorld: PhysicsWorld = {
    collisionAt: (_x, y) => (y < 0 ? 'full' : null),
    isLiquid: (_x, y) => y >= 0 && y <= 3,
  };
  const baseCtx: EntityContext = {
    world: waterWorld,
    playerBox: null,
    pickup: () => 0,
    getBlock: () => 0,
    player: null,
    hurtPlayer: () => {},
    spawnDrop: () => {},
  };
  const drive = { forward: 1, strafe: 0, sprint: false };
  const ctx: EntityContext = { ...baseCtx, vehicleInput: drive };

  // ---- 浮力：从水下 1 格开始，几秒后应该浮到水面附近
  const boat = new Boat(0.5, 2.2, 0.5);
  for (let i = 0; i < 120; i++) boat.tick(baseCtx, 0.05);
  check('空船会自己浮到水面附近（不沉底）', boat.y > 3.2, `y=${boat.y.toFixed(2)}`);
  check('浮起来之后不再乱抖（竖直速度收敛）', Math.abs(boat.vy) < 1.2, `vy=${boat.vy.toFixed(2)}`);

  // ---- 驾驶：船头是 -Z（与玩家视角同一口径）
  boat.passenger = 'player';
  boat.yaw = 0;
  boat.y = 3.6;
  const z0 = boat.z;
  for (let i = 0; i < 40; i++) boat.tick(ctx, 0.05); // 2 秒
  check('有人驾驶时朝船头（-Z）开出去', boat.z < z0 - 1, `z ${z0.toFixed(2)} → ${boat.z.toFixed(2)}`);
  check('速度被限制在 `BOAT_MAX_SPEED` 以内', Math.hypot(boat.vx, boat.vz) <= 7.01, `${Math.hypot(boat.vx, boat.vz).toFixed(2)}`);

  // ---- 空船：同样的输入不该被开走
  const empty = new Boat(0.5, 3.6, 0.5);
  const ez = empty.z;
  for (let i = 0; i < 40; i++) empty.tick(ctx, 0.05);
  check('空船不吃驾驶输入（没人开就不动）', Math.abs(empty.z - ez) < 0.2, `z ${ez.toFixed(2)} → ${empty.z.toFixed(2)}`);

  // ---- 岸上：重力把它拉回地面
  const landWorld: PhysicsWorld = {
    collisionAt: (_x, y) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  };
  const landCtx: EntityContext = { ...baseCtx, world: landWorld };
  const beached = new Boat(0.5, 4, 0.5);
  for (let i = 0; i < 80; i++) beached.tick(landCtx, 0.05);
  check('岸上的船会落到地面', beached.y < 0.2, `y=${beached.y.toFixed(2)}`);
}

console.log('\n[矿车：轨道上滑得远 / 离轨寸步难行（批次 245）]');
{
  const flatWorld: PhysicsWorld = {
    collisionAt: (_x, y) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  };
  const makeCtx = (rail: boolean): EntityContext => ({
    world: flatWorld,
    playerBox: null,
    pickup: () => 0,
    // 铁轨铺在 y=0 这一层；`rail=false` 就是"草地上"
    getBlock: (_x, y) => (rail && y === 0 ? Block.RAIL : Block.AIR),
    player: null,
    hurtPlayer: () => {},
    spawnDrop: () => {},
    vehicleInput: { forward: 1, strafe: 0, sprint: false },
  });
  const drive = (cart: Minecart, ctx: EntityContext, seconds: number): void => {
    for (let t = 0; t < seconds; t += 0.05) cart.tick(ctx, 0.05);
  };

  // 车头朝 +X：yaw = -π/2 时 forward = (-sin(-π/2), -cos(-π/2)) = (1, 0)
  const onRail = new Minecart(0.5, 0.05, 0.5);
  onRail.passenger = 'player';
  onRail.yaw = -Math.PI / 2;
  drive(onRail, makeCtx(true), 2);
  check('铁轨上 2 秒能滑出很远（加速度大、阻力小）', onRail.x > 6, `x=${onRail.x.toFixed(2)}`);

  const offRail = new Minecart(0.5, 0.05, 0.5);
  offRail.passenger = 'player';
  offRail.yaw = -Math.PI / 2;
  drive(offRail, makeCtx(false), 2);
  check(
    '草地上同样的输入几乎推不动（原版也寸步难行）',
    offRail.x < 3 && offRail.x < onRail.x,
    `草地上 x=${offRail.x.toFixed(2)}，铁轨上 x=${onRail.x.toFixed(2)}`,
  );

  const empty = new Minecart(0.5, 0.05, 0.5);
  empty.yaw = -Math.PI / 2;
  drive(empty, makeCtx(true), 2);
  check('空车不吃驾驶输入（没人开就不动）', Math.abs(empty.x - 0.5) < 0.2, `x=${empty.x.toFixed(2)}`);

  // 批次 246：动力铁轨通电才有额外推力（状态位由红石引擎写，这里直接给通电状态）
  const poweredCtx: EntityContext = {
    ...makeCtx(true),
    getBlock: (_x, y) => (y === 0 ? Block.POWERED_RAIL : Block.AIR),
    getState: () => withPowered(0, true),
  };
  const idleCtx: EntityContext = {
    ...makeCtx(true),
    getBlock: (_x, y) => (y === 0 ? Block.POWERED_RAIL : Block.AIR),
    getState: () => 0,
  };
  const boosted = new Minecart(0.5, 0.05, 0.5);
  boosted.passenger = 'player';
  boosted.yaw = -Math.PI / 2;
  drive(boosted, poweredCtx, 3);
  const idle = new Minecart(0.5, 0.05, 0.5);
  idle.passenger = 'player';
  idle.yaw = -Math.PI / 2;
  drive(idle, idleCtx, 3);
  check(
    '通电的动力铁轨把车推得更快（断电就只是普通轨）',
    Math.hypot(boosted.vx, boosted.vz) > Math.hypot(idle.vx, idle.vz) + 2,
    `通电 ${Math.hypot(boosted.vx, boosted.vz).toFixed(1)} vs 断电 ${Math.hypot(idle.vx, idle.vz).toFixed(1)}`,
  );
}

console.log('\n[漏斗矿车：5 格肚子（批次 251）]');
{
  const cart = new HopperMinecart(0.5, 0.05, 0.5);
  equal('5 格', cart.slots.length, 5);
  equal('塞 70 个石头：全收下（先填满一格 64，再占一格 6）', cart.accept(Block.STONE, 70), 0);
  equal('总数 70', cart.itemCount, 70);
  equal('再塞 5 组泥土：只收下剩余 3 格（192），退回 128', cart.accept(Block.DIRT, 320), 128);
  equal('总数变成 262', cart.itemCount, 262);
}

console.log('\n[动力矿车：烧煤自己推（批次 252）]');
{
  const railWorld: PhysicsWorld = {
    collisionAt: (_x, y) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  };
  const ctx: EntityContext = {
    world: railWorld,
    playerBox: null,
    pickup: () => 0,
    getBlock: (_x, y) => (y === 0 ? Block.RAIL : Block.AIR),
    player: null,
    hurtPlayer: () => {},
    spawnDrop: () => {},
  };
  // 车头朝 +X（yaw = -π/2 时 forward = (1, 0)）
  const cart = new FurnaceMinecart(0.5, 0.05, 0.5);
  cart.yaw = -Math.PI / 2;
  const start = cart.x;
  for (let i = 0; i < 60; i++) cart.tick(ctx, 0.05);
  check('没燃料时纹丝不动（没人坐也不烧）', Math.abs(cart.x - start) < 0.2, `x=${cart.x.toFixed(2)}`);

  cart.addFuel(FURNACE_CART_FUEL_PER_COAL);
  for (let i = 0; i < 60; i++) cart.tick(ctx, 0.05);
  check('加一块煤之后自己往前开', cart.x > start + 3, `x=${cart.x.toFixed(2)}`);
  check(
    '燃料在按秒消耗',
    cart.fuelSeconds < FURNACE_CART_FUEL_PER_COAL && cart.fuelSeconds > 0,
    `剩余 ${cart.fuelSeconds.toFixed(1)} 秒`,
  );

  cart.addFuel(10_000);
  check('燃料有上限（不会一加就无限烧）', cart.fuelSeconds <= 300, `${cart.fuelSeconds}`);
}

console.log('\n[载具停放：区块卸载/重载不丢（批次 257）]');
{
  const parking = new VehicleParking();
  parking.park('overworld', 0, 0, { kind: 'boat', x: 1, y: 2, z: 3, yaw: 0.5 });
  parking.park('overworld', 0, 0, { kind: 'hopper', x: 4, y: 5, z: 6, yaw: 1 });
  check('同一区块能停多辆', parking.size === 2, `${parking.size}`);

  const taken = parking.take('overworld', 0, 0);
  check('一次取回两辆', taken.length === 2, `${taken.length}`);
  check(
    '坐标与朝向原样带回',
    taken[0]?.kind === 'boat' && taken[0]?.x === 1 && taken[0]?.y === 2 && taken[0]?.z === 3 && taken[0]?.yaw === 0.5,
    JSON.stringify(taken[0]),
  );
  check('取完即删（不会重复生成）', parking.take('overworld', 0, 0).length === 0 && parking.size === 0);

  // 维度隔离：同一组区块坐标在不同维度不能串
  parking.park('overworld', 2, -1, { kind: 'minecart', x: 0, y: 64, z: 0, yaw: 0 });
  parking.park('the_nether', 2, -1, { kind: 'furnace', x: 0, y: 32, z: 0, yaw: 0 });
  check('下界只取到下界那一辆', parking.take('the_nether', 2, -1).length === 1);
  check('主世界那一辆还在', parking.take('overworld', 2, -1).length === 1);

  // ---- 存档往返（批次 258）：导出 → 恢复 → 还能按原区块取回
  const before = new VehicleParking();
  before.park('overworld', 0, 0, { kind: 'boat', x: 12.5, y: 62, z: 3.5, yaw: 1.2 });
  before.park('the_nether', -2, 1, { kind: 'hopper', x: -20, y: 40, z: 30, yaw: 0.4 });
  const dump = before.snapshotAll();
  check('导出两条记录', dump.length === 2, `${dump.length}`);

  const after = new VehicleParking();
  after.restoreAll(dump);
  check('恢复后条数一致', after.size === 2, `${after.size}`);
  const boat = after.take('overworld', 0, 0);
  check(
    '正坐标按原区块取回，朝向保留',
    boat.length === 1 && boat[0]?.kind === 'boat' && boat[0]?.yaw === 1.2,
    JSON.stringify(boat[0]),
  );
  check('负坐标也落在正确区块（-20 → -2）', after.take('the_nether', -2, 1).length === 1);

  // ---- 脏数据：种类不认识 / 坐标 NaN 都要跳过，别把读档带崩
  const dirty = new VehicleParking();
  dirty.restoreAll([
    { dimension: 'overworld', kind: 'ufo' as never, x: 1, y: 2, z: 3, yaw: 0 },
    { dimension: 'overworld', kind: 'boat', x: Number.NaN, y: 2, z: 3, yaw: 0 },
  ]);
  check('脏记录全部跳过', dirty.size === 0, `${dirty.size}`);
}

console.log('\n[生物 / 掉落物的区块寄存（批次 258）]');
{
  const parking = new EntityParking();
  parking.park('overworld', 0, 0, {
    kind: 'mob',
    typeId: 'cow',
    x: 5,
    y: 65,
    z: 5,
    yaw: 1.5,
    health: 7,
    tamed: true,
    sitting: false,
    leashed: true,
    sheared: true,
    woolColor: 3,
    baby: false,
    growSeconds: 0,
  });
  parking.park('overworld', 0, 0, { kind: 'item', itemId: 12, count: 3, x: 6, y: 65, z: 6 });
  check('同一区块能存生物与掉落物', parking.size === 2, `${parking.size}`);

  const dump = parking.snapshotAll();
  const after = new EntityParking();
  after.restoreAll(dump);
  const back = after.take('overworld', 0, 0);
  const mob = back.find((r) => r.kind === 'mob');
  const item = back.find((r) => r.kind === 'item');
  check(
    '生物状态原样带回（血量/驯服/被牵/剪毛/羊毛色）',
    mob?.kind === 'mob' &&
      mob.health === 7 &&
      mob.tamed &&
      mob.leashed &&
      mob.sheared &&
      mob.woolColor === 3,
    JSON.stringify(mob),
  );
  check('掉落物 id 与数量原样带回', item?.kind === 'item' && item.itemId === 12 && item.count === 3);
  check('取完即删（不会重复生成）', after.take('overworld', 0, 0).length === 0 && after.size === 0);

  // 脏数据：不认识的 kind / 未知坐标 / 数量 0 都跳过
  const dirty = new EntityParking();
  // 故意构造脏数据：`as never` 是为了绕过编译期检查——这里测的正是"运行时能挡住"
  dirty.restoreAll([
    { dimension: 'overworld', kind: 'ufo', x: 1, y: 2, z: 3 },
    { dimension: 'overworld', kind: 'item', itemId: 1, count: 0, x: 1, y: 2, z: 3 },
    { dimension: 'overworld', kind: 'mob', typeId: '', x: 1, y: 2, z: 3 },
  ] as never);
  check('脏记录全部跳过', dirty.size === 0, `${dirty.size}`);
}

console.log('\n[实体的附加数据随存档往返（批次 445）]');
{
  // JSON 往返是真实存档的路径：Date/undefined/函数都会在这里现原形
  const parking = new EntityParking();
  parking.park('overworld', 0, 0, {
    kind: 'mob',
    typeId: 'cow',
    x: 1,
    y: 64,
    z: 1,
    yaw: 0,
    health: 10,
    tamed: false,
    sitting: false,
    leashed: false,
    sheared: false,
    woolColor: 0,
    baby: true,
    growSeconds: 321,
    effects: [{ id: 'poison', amplifier: 1, ticks: 200, ambient: false }],
  });
  parking.park('overworld', 0, 0, {
    kind: 'item',
    itemId: 3,
    count: 1,
    x: 2,
    y: 64,
    z: 2,
    extras: {
      damage: 12,
      enchants: { efficiency: 3 },
      name: '镐子',
      contents: [{ id: 7, count: 2 }, null, { id: 9, count: 1, damage: 4 }],
    },
  });

  const round = new EntityParking();
  round.restoreAll(JSON.parse(JSON.stringify(parking.snapshotAll())) as never);
  const back = round.take('overworld', 0, 0);
  const mob = back.find((r) => r.kind === 'mob');
  const item = back.find((r) => r.kind === 'item');

  check(
    '幼体标记与剩余成长秒数原样带回',
    mob?.kind === 'mob' && mob.baby && mob.growSeconds === 321,
    JSON.stringify(mob),
  );
  check(
    '生物的状态效果原样带回',
    mob?.kind === 'mob' && mob.effects?.[0]?.id === 'poison' && mob.effects[0]?.ticks === 200,
    JSON.stringify(mob),
  );
  check(
    '掉落物的耐久/附魔/改名原样带回',
    item?.kind === 'item' &&
      item.extras?.damage === 12 &&
      item.extras?.enchants?.efficiency === 3 &&
      item.extras?.name === '镐子',
    JSON.stringify(item),
  );
  check(
    '潜影盒内容物（含空槽）原样带回',
    item?.kind === 'item' && item.extras?.contents?.length === 3 && item.extras.contents[1] === null,
    JSON.stringify(item?.kind === 'item' ? item.extras?.contents : null),
  );

  // 装备 / 马鞍 / 马铠（批次 584）：区块寄存往返不能把马变成"光背"
  const geared = new EntityParking();
  geared.park('overworld', 0, 0, {
    kind: 'mob',
    typeId: 'horse',
    x: 1,
    y: 64,
    z: 1,
    yaw: 0,
    health: 20,
    tamed: true,
    sitting: false,
    leashed: false,
    sheared: false,
    woolColor: 0,
    baby: false,
    growSeconds: 0,
    equipment: { mainHand: toolItemId('sword', 'diamond') },
    saddled: true,
    horseArmor: Item.DIAMOND_HORSE_ARMOR,
  });
  const gearedRound = new EntityParking();
  gearedRound.restoreAll(JSON.parse(JSON.stringify(geared.snapshotAll())) as never);
  const gearedBack = gearedRound.take('overworld', 0, 0).find((r) => r.kind === 'mob');
  check(
    '装备、马鞍与马铠原样带回',
    gearedBack?.kind === 'mob' &&
      gearedBack.equipment?.mainHand === toolItemId('sword', 'diamond') &&
      gearedBack.saddled === true &&
      gearedBack.horseArmor === Item.DIAMOND_HORSE_ARMOR,
    JSON.stringify(gearedBack),
  );

  // 脏数据：非法效果项被剔除、非幼体的成长计时归零、非法附魔等级不落盘
  const dirty = new EntityParking();
  dirty.restoreAll([
    {
      dimension: 'overworld',
      kind: 'mob',
      typeId: 'cow',
      x: 1,
      y: 2,
      z: 3,
      baby: false,
      growSeconds: 999,
      effects: [{ id: '', amplifier: 0, ticks: 0, ambient: false }, { id: 'poison', ticks: -5 }],
    },
    {
      dimension: 'overworld',
      kind: 'item',
      itemId: 1,
      count: 1,
      x: 1,
      y: 2,
      z: 3,
      extras: { damage: -3, enchants: { efficiency: 0 }, name: '' },
    },
  ] as never);
  const dirtyBack = dirty.take('overworld', 0, 0);
  const dirtyMob = dirtyBack.find((r) => r.kind === 'mob');
  const dirtyItem = dirtyBack.find((r) => r.kind === 'item');
  check(
    '成年体的残留成长计时归零',
    dirtyMob?.kind === 'mob' && dirtyMob.baby === false && dirtyMob.growSeconds === 0,
    JSON.stringify(dirtyMob),
  );
  check(
    '非法效果项被整条剔除（不留下空数组）',
    dirtyMob?.kind === 'mob' && dirtyMob.effects === undefined,
    JSON.stringify(dirtyMob),
  );
  check(
    '非法附加数据不落盘（负耐久/0 级附魔/空名字）',
    dirtyItem?.kind === 'item' && dirtyItem.extras === undefined,
    JSON.stringify(dirtyItem),
  );

  // 实体那一侧：makeBaby 要能接着存档里的成长进度走
  const cow = createMob(mobTypeById('cow')!, 0, 64, 0);
  cow.makeBaby(123);
  check('makeBaby 接受剩余成长秒数', cow.baby && cow.growRemaining === 123, `${cow.growRemaining}`);
  cow.effects.restore([{ id: 'poison', amplifier: 2, ticks: 100, ambient: false }]);
  const dumped = cow.effects.serialize();
  check(
    '生物的效果能存能读',
    dumped.length === 1 && dumped[0]?.id === 'poison' && dumped[0]?.amplifier === 2,
    JSON.stringify(dumped),
  );
}

console.log('\n[穿透箭：命中后继续飞（批次 266）]');
{
  const first = createMob(mobTypeById('cow')!, 1.5, 64, 0.5);
  const second = createMob(mobTypeById('cow')!, 2.5, 64, 0.5);
  let served = first;
  // `hitMob` 直接返回"当前要打的那只"：这里测的是箭的穿透状态机，不是射线
  const ctx = {
    world: { collisionAt: () => null, isLiquid: () => false },
    playerBox: null,
    pickup: () => 0,
    getBlock: () => Block.AIR,
    player: null,
    hurtPlayer: () => {},
    spawnDrop: () => {},
    hitMob: () => served,
  } as never;

  const arrow = new Arrow(0.5, 64.5, 0.5, { x: 30, y: 0, z: 0 }, {
    fromPlayer: true,
    damage: 2,
    pierce: 1,
  });
  const firstHp = first.health;
  arrow.tick(ctx, 0.05);
  check('第一只被打中', first.health < firstHp, `${firstHp} → ${first.health}`);
  check('穿透次数没用完时箭不消失', !arrow.dead);

  const afterFirst = first.health;
  arrow.tick(ctx, 0.05);
  check('同一只不会被回头再打一次', first.health === afterFirst, `${afterFirst} → ${first.health}`);

  served = second;
  const secondHp = second.health;
  arrow.tick(ctx, 0.05);
  check('第二只也被打中', second.health < secondHp, `${secondHp} → ${second.health}`);
  check('穿透次数用完 → 箭消失', arrow.dead);

  // 没有穿透的普通箭：第一只命中就停
  const plain = new Arrow(0.5, 64.5, 0.5, { x: 30, y: 0, z: 0 }, { fromPlayer: true, damage: 2 });
  served = first;
  plain.tick(ctx, 0.05);
  check('普通箭命中即消失（不穿透）', plain.dead);

  // 引雷（批次 269）：命中点报给主程序
  let strikes = 0;
  const strikeAt: { x?: number; y?: number; z?: number } = {};
  const channelCtx = Object.assign({}, ctx as object, {
    strikeLightningAt: (x: number, y: number, z: number) => {
      strikes++;
      strikeAt.x = x;
      strikeAt.y = y;
      strikeAt.z = z;
    },
  }) as never;
  const channelled = new Arrow(0.5, 64.5, 0.5, { x: 30, y: 0, z: 0 }, {
    fromPlayer: true,
    damage: 2,
    channeling: true,
  });
  served = second;
  channelled.tick(channelCtx, 0.05);
  check('引雷箭命中生物 → 报一次落雷点', strikes === 1, `${strikes}`);
  check(
    '落雷点就是那只生物的位置',
    typeof strikeAt.x === 'number' &&
      Math.abs(strikeAt.x - second.x) < 2 &&
      typeof strikeAt.z === 'number' &&
      Math.abs(strikeAt.z - second.z) < 2,
    JSON.stringify(strikeAt),
  );

  let plainStrikes = 0;
  const noChannelCtx = Object.assign({}, ctx as object, {
    strikeLightningAt: () => {
      plainStrikes++;
    },
  }) as never;
  const ordinary = new Arrow(0.5, 64.5, 0.5, { x: 30, y: 0, z: 0 }, { fromPlayer: true, damage: 2 });
  served = first;
  ordinary.tick(noChannelCtx, 0.05);
  check('没有引雷的箭不报落雷点', plainStrikes === 0, `${plainStrikes}`);
}

console.log('\n[骑乘：马要驯服、猪装鞍即骑（批次 406）]');
{
  const world: PhysicsWorld = {
    collisionAt: (_x, y) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  };
  const ctx = (input: { forward?: number; jump?: boolean } = {}): EntityContext => ({
    world,
    playerBox: null,
    pickup: () => 0,
    getBlock: () => 0,
    player: null,
    hurtPlayer: () => {},
    spawnDrop: () => {},
    vehicleInput: { forward: input.forward ?? 1, strafe: 0, sprint: false, jump: input.jump === true },
  });

  const pig = createMob(mobTypeById('pig')!, 0.5, 0.05, 0.5);
  const horse = createMob(mobTypeById('horse')!, 0.5, 0.05, 0.5);
  const strider = createMob(mobTypeById('strider')!, 0.5, 0.05, 0.5);

  // 工厂是"能不能骑"的唯一入口：造错的类会静默变成"能喂不能骑"
  check('工厂造出来的猪是可骑乘的那个类', pig instanceof Horse);
  check('工厂造出来的炽足兽也可骑乘', strider instanceof Horse);
  check('猪不需要驯服（原版装鞍即骑）', (pig as Horse).needsTaming === false);
  check('炽足兽也不需要驯服', (strider as Horse).needsTaming === false);
  check('猪骑着不能跳', (pig as Horse).canJump === false);
  check('马仍然需要驯服', (horse as Horse).needsTaming === true);
  check('马骑着能跳', (horse as Horse).canJump === true);

  // 装上鞍、有人骑：按前进朝 -Z 走（与船/矿车同一口径）
  const mountedPig = createMob(mobTypeById('pig')!, 0.5, 0.05, 0.5) as Horse;
  mountedPig.saddled = true;
  mountedPig.passenger = 'player';
  mountedPig.rideYaw = 0;
  const z0 = mountedPig.z;
  for (let i = 0; i < 40; i++) mountedPig.tick(ctx(), 0.05);
  check('骑着猪按前进会朝 -Z 走', mountedPig.z < z0 - 0.5, `z ${z0.toFixed(2)} → ${mountedPig.z.toFixed(2)}`);

  // 没人骑的猪不该吃驾驶输入
  const emptyPig = createMob(mobTypeById('pig')!, 0.5, 0.05, 0.5) as Horse;
  const ez = emptyPig.z;
  for (let i = 0; i < 40; i++) emptyPig.tick(ctx(), 0.05);
  check('没人骑的猪不吃驾驶输入', Math.abs(emptyPig.z - ez) < 0.6, `z ${ez.toFixed(2)} → ${emptyPig.z.toFixed(2)}`);

  // 跳跃：猪跳不起来，马能跳（同一段代码，靠 canJump 分叉）
  const jumpPig = createMob(mobTypeById('pig')!, 0.5, 0.05, 0.5) as Horse;
  jumpPig.passenger = 'player';
  jumpPig.tick(ctx({ forward: 0, jump: true }), 0.05);
  check('猪按跳跃键不起跳', jumpPig.vy < 1, `vy=${jumpPig.vy.toFixed(2)}`);

  const jumpHorse = createMob(mobTypeById('horse')!, 0.5, 0.05, 0.5) as Horse;
  jumpHorse.passenger = 'player';
  jumpHorse.onGround = true;
  jumpHorse.tick(ctx({ forward: 0, jump: true }), 0.05);
  check('马按跳跃键会起跳', jumpHorse.vy > 4, `vy=${jumpHorse.vy.toFixed(2)}`);

  // 马铠（批次 571）：只有马/驴/骡能装，有护甲点且挡玩家/生物伤害
  equal('钻石马铠识别正确', horseArmorTier(Item.DIAMOND_HORSE_ARMOR), 'diamond');
  equal('普通物品不是马铠', horseArmorTier(Item.SADDLE), null);
  const armored = createMob(mobTypeById('horse')!, 0.5, 0.05, 0.5) as Horse;
  check('马能装马铠', armored.canWearHorseArmor);
  check('猪不能装马铠', !(pig as Horse).canWearHorseArmor);
  const plainKey = mobAppearanceKey(armored);
  armored.armor = Item.DIAMOND_HORSE_ARMOR;
  equal('钻石马铠 11 点护甲', armored.armorPoints, 11);
  check(
    '装马铠会触发外观重建（key 带档位）',
    mobAppearanceKey(armored) !== plainKey && mobAppearanceKey(armored).includes('horse-armor:diamond'),
  );
  const before = armored.health;
  armored.hurt(10, 0, 0, ctx(), 0, 0, { kind: 'mob' });
  check('马铠挡下部分生物伤害', armored.health > before - 10 && armored.health < before, `${before} → ${armored.health}`);

  const envHorse = createMob(mobTypeById('horse')!, 0.5, 0.05, 0.5) as Horse;
  envHorse.armor = Item.DIAMOND_HORSE_ARMOR;
  const envBefore = envHorse.health;
  envHorse.hurt(5, 0, 0, ctx(), 0, 0, { kind: 'environment' });
  equal('环境伤害不被马铠减免', envBefore - envHorse.health, 5);
}

console.log('\n[蜂巢：蜂蜜等级 / 挤蜜 / 被蛰（J21，批次 407）]');
{
  const dim = 'overworld';
  const hives = new BeeHives();

  // 懒建：第一次碰到的巢按"满蜜"处理，否则玩家会以为挤蜜坏了
  check('新巢第一次看就是满级（原版自然生成的巢多半带蜜）', hives.level(0, 64, 0, dim) === HONEY_MAX_LEVEL);

  check('满级能挤出一瓶蜂蜜', hives.harvest(0, 64, 0, dim) === true);
  check('挤完是**归 0**，不是降一级', hives.level(0, 64, 0, dim) === 0);
  check('0 级挤不出来（调用方要据此放行放置逻辑）', hives.harvest(0, 64, 0, dim) === false);

  // 回涨：先走完冷却，再按档位涨
  hives.tick(HONEY_HARVEST_COOLDOWN - 0.5);
  check('冷却期间不涨', hives.level(0, 64, 0, dim) === 0, String(hives.level(0, 64, 0, dim)));
  hives.tick(0.6);
  check('冷却走完涨一级', hives.level(0, 64, 0, dim) === 1, String(hives.level(0, 64, 0, dim)));
  hives.tick(HONEY_REGROW_SECONDS * 10);
  check('涨到满级就停住', hives.level(0, 64, 0, dim) === HONEY_MAX_LEVEL, String(hives.level(0, 64, 0, dim)));

  // 维度隔离：同一个 (x,y,z) 在主世界与下界是两个巢
  hives.harvest(8, 64, 8, 'nether');
  check('下界那个巢被挤过', hives.level(8, 64, 8, 'nether') === 0);
  check('主世界同坐标不受影响', hives.level(8, 64, 8, dim) === HONEY_MAX_LEVEL);

  // 拆掉方块要清记录，否则原地再放一个会"自带蜂蜜"
  hives.harvest(4, 64, 4, dim);
  hives.forget(4, 64, 4, dim);
  check('拆掉之后重新放 = 新巢（又是满级）', hives.level(4, 64, 4, dim) === HONEY_MAX_LEVEL);

  // 夹取
  hives.setLevel(2, 64, 2, dim, 99);
  check('等级被夹到 5', hives.level(2, 64, 2, dim) === HONEY_MAX_LEVEL);

  // 被蛰：一只蜜蜂只蜇一次
  check('蜜蜂第一下会蛰', shouldSting('bee', false));
  check('蛰过的蜜蜂不再蛰', !shouldSting('bee', true));
  check('猪不会蛰人', !shouldSting('pig', false));
  check('中毒时长是 10 秒（原版普通难度）', BEE_STING_POISON_SECONDS === 10);
}

console.log('\n[载具被敲坏 + doEntityDrops（批次 435）]');
{
  check('船与矿车的耐久都是 6', VEHICLE_MAX_HEALTH === 6);

  // 耐久边界：第 6 点坏，第 5 点不坏
  let health = VEHICLE_MAX_HEALTH;
  let brokenAt = 0;
  for (let hit = 1; hit <= 6; hit++) {
    const result = applyVehicleDamage(health, 1);
    health = result.health;
    if (result.broken) brokenAt = hit;
  }
  check('徒手敲 6 下才坏（第 5 下不坏）', brokenAt === 6, `第 ${brokenAt} 下坏`);

  const overkill = applyVehicleDamage(2, 5);
  check('伤害超过剩余耐久时归零而不是负数', overkill.health === 0 && overkill.broken);

  // 创造模式一击必坏
  check('创造模式一击必坏', applyVehicleDamage(VEHICLE_MAX_HEALTH, vehicleHitDamage(1, true)).broken);
  check('生存模式按工具伤害（徒手至少 1）', vehicleHitDamage(0, false) === 1 && vehicleHitDamage(3, false) === 3);

  // 掉落：开着掉、关着一件都不掉
  check('船掉橡木船', vehicleDropFor('boat', true) === Item.OAK_BOAT);
  check('矿车掉矿车', vehicleDropFor('minecart', true) === Item.MINECART);
  check('漏斗矿车掉漏斗矿车', vehicleDropFor('hopper_minecart', true) === Item.HOPPER_MINECART);
  check('动力矿车掉动力矿车', vehicleDropFor('furnace_minecart', true) === Item.FURNACE_MINECART);
  check(
    'doEntityDrops 关掉时四种载具都不掉',
    (['boat', 'minecart', 'hopper_minecart', 'furnace_minecart'] as const).every(
      (kind) => vehicleDropFor(kind, false) === null,
    ),
  );
}

console.log('\n[最后三种生物（批次 436）]');
{
  const fish = mobTypeById('tropical_fish');
  const puffer = mobTypeById('pufferfish');
  const glow = mobTypeById('glow_squid');

  check('热带鱼在生物表里', fish !== undefined);
  check('河豚在生物表里', puffer !== undefined);
  check('发光鱿鱼在生物表里', glow !== undefined);

  check('热带鱼掉热带鱼', fish?.drops?.[0]?.itemId === Item.TROPICAL_FISH);
  check('河豚掉河豚', puffer?.drops?.[0]?.itemId === Item.PUFFERFISH);
  // ⚠️ 原版掉发光墨囊，本仓库没有那件物品 → 掉普通墨囊，这条断言就是"留字据"
  check('发光鱿鱼掉墨囊（原版是发光墨囊，此处有差异）', glow?.drops?.[0]?.itemId === Item.INK_SAC);

  check('三种都是水生、只在水里刷', fish?.aquatic === true && fish?.spawnInWater === true && puffer?.aquatic === true && glow?.aquatic === true);
  check(
    '热带鱼与河豚只在暖水/温水海',
    fish?.spawnBiomes?.every((id) => id.includes('warm')) === true &&
      puffer?.spawnBiomes?.every((id) => id.includes('warm')) === true,
  );
  check(
    '发光鱿鱼只在深海',
    glow?.spawnBiomes?.every((id) => id.startsWith('deep_')) === true,
    (glow?.spawnBiomes ?? []).join(','),
  );

  // 刷怪蛋：三种都能拿到，且能反查到生物
  for (const [mob, label] of [
    ['tropical_fish', '热带鱼'],
    ['pufferfish', '河豚'],
    ['glow_squid', '发光鱿鱼'],
  ] as const) {
    const eggId = spawnEggItemId(SPAWN_EGG_SPECS.findIndex((spec) => spec.mobId === mob));
    check(`${label}有刷怪蛋`, eggId > 0, String(eggId));
    check(`${label}的刷怪蛋能反查到生物`, spawnEggMobOf(eggId) === mob, String(spawnEggMobOf(eggId)));
  }
}


console.log('\n[伤害来源：只有"被打"才记仇（批次 471）]');
{
  // ① 环境伤害（摔/火/爆炸/闪电/龙息）不记仇
  const burned = createMob(mobTypeById('zombie')!, 0.5, 64, 0.5);
  const hurt1 = burned.hurt(2, 0, 0, undefined, 0, 0, { kind: 'environment' });
  check('环境伤害真的扣血了（不是被无敌帧挡掉）', hurt1 && burned.health < burned.type.health, `${burned.health}`);
  check('环境伤害不记仇', !burned.angry);
  equal('来源记成 environment', burned.lastDamageSource.kind, 'environment');

  // ② 玩家伤害记仇
  const hitByPlayer = createMob(mobTypeById('zombie')!, 0.5, 64, 0.5);
  hitByPlayer.hurt(2, 0, 0, undefined, 0, 0, { kind: 'player' });
  check('玩家伤害会记仇', hitByPlayer.angry);
  equal('来源记成 player', hitByPlayer.lastDamageSource.kind, 'player');

  // ③ 不传来源 = 按环境算（老调用点不改也不会凭空记仇）
  const legacy = createMob(mobTypeById('zombie')!, 0.5, 64, 0.5);
  legacy.hurt(2, 0, 0);
  check('不传来源时不记仇（默认 environment）', !legacy.angry);

  // ④ 群体激怒（僵尸猪灵）：只有被打才惊动同类
  let provoked = 0;
  const ctx = {
    provokeNearby: () => {
      provoked++;
    },
  } as unknown as Parameters<typeof legacy.hurt>[3];
  const piglin = createMob(mobTypeById('zombie_piglin')!, 0.5, 64, 0.5);
  piglin.hurt(1, 0, 0, ctx, 0, 0, { kind: 'environment' });
  equal('环境伤害不惊动同类（岩浆块烫到不算"被攻击"）', provoked, 0);
  const piglin2 = createMob(mobTypeById('zombie_piglin')!, 0.5, 64, 0.5);
  piglin2.hurt(1, 0, 0, ctx, 0, 0, { kind: 'player' });
  equal('玩家打一下才惊动同类', provoked, 1);
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
