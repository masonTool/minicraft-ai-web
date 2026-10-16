/**
 * 生物 AI / 寻路离线测试
 *
 * 运行：npm run test:mob
 *
 * 用一个"可编程的实心方块集合"当世界，覆盖：
 *   1. 平地寻路（路径长度应接近直线距离）
 *   2. 两格高的墙必须绕行
 *   3. 一格高的台阶可以直接跳上去
 *   4. 超过 maxFall 的落差视为不可通行
 *   5. 完全封死时返回 null
 *   6. 僵尸追击玩家（若干秒后距离显著缩短）
 *   7. 被动生物在平台边缘游荡不会掉下去
 *   8. 受伤扣血、无敌帧、致死掉落
 *   9. 骷髅远程（J9）：射程内放箭、贴太近后退、有冷却、不再近战
 */

import { Mob } from '../src/core/entity/Mob.ts';
import { Pathfinder, type BlockSampler } from '../src/core/entity/Pathfinder.ts';
import { MOB_TYPES, mobTypeById } from '../src/core/entity/mobs.ts';
import type { EntityContext } from '../src/core/entity/Entity.ts';
import { Block, woolId } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import {
  BABY_GROW_SECONDS,
  BABY_SCALE,
  LOVE_SECONDS,
  WOOL_REGROW_SECONDS,
} from '../src/core/entity/Mob.ts';
import type { PhysicsWorld } from '../src/core/physics/PlayerPhysics.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(name: string, actual: unknown, expected: unknown, detail = ''): void {
  check(name, Object.is(actual, expected), detail || `实际 ${String(actual)}，期望 ${String(expected)}`);
}

/** 用集合表示实心方块的测试世界 */
class TestWorld implements BlockSampler {
  private readonly solid = new Set<string>();

  setBlock(x: number, y: number, z: number, solid: boolean): void {
    const key = `${x},${y},${z}`;
    if (solid) this.solid.add(key);
    else this.solid.delete(key);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.solid.has(`${x},${y},${z}`) ? Block.STONE : Block.AIR;
  }

  /** 铺一块地面 */
  floor(x0: number, x1: number, z0: number, z1: number, y: number): void {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) this.setBlock(x, y, z, true);
    }
  }

  asPhysicsWorld(): PhysicsWorld {
    return {
      collisionAt: (x, y, z) => (this.getBlock(x, y, z) !== Block.AIR ? 'full' : null),
      isLiquid: () => false,
    };
  }
}

const pathfinderOf = (world: TestWorld): Pathfinder => new Pathfinder(world);

console.log('\n[平地寻路]');
{
  const world = new TestWorld();
  world.floor(-4, 24, -4, 4, 64);
  const path = pathfinderOf(world).find(0.5, 65, 0.5, 10.5, 65, 0.5);
  check('能求出路径', path !== null && path.length > 0, `长度 ${path?.length ?? 0}`);
  // 直线距离 10 格，八向寻路的最优长度就是 10
  check('平地路径接近直线距离（10 步）', path !== null && path.length === 10, `实际 ${path?.length ?? 0}`);
  check('路径终点落在目标附近', path !== null && path[path.length - 1]!.x === 10 && path[path.length - 1]!.z === 0);
}

console.log('\n[障碍绕行]');
{
  const world = new TestWorld();
  world.floor(-6, 24, -6, 6, 64);
  // 两格高的墙，跳不过去，只能绕
  for (let z = -2; z <= 2; z++) {
    world.setBlock(5, 65, z, true);
    world.setBlock(5, 66, z, true);
  }
  const pf = pathfinderOf(world);
  check('墙体已建立', world.getBlock(5, 65, 0) === Block.STONE);
  check('墙内不可站立', !pf.canStandAt(5, 65, 0));
  check('墙顶可以站', pf.canStandAt(5, 67, 0));
  const path = pf.find(0.5, 65, 0.5, 10.5, 65, 0.5);
  check('能求出路径', path !== null && path.length > 0, `长度 ${path?.length ?? 0}`);
  check('路径绕开墙体', path === null || path.every((p) => !(p.x === 5 && Math.abs(p.z) <= 2)), '路径穿墙');
  check('路径上每个点都可站立', path !== null && path.every((p) => pf.canStandAt(p.x, p.y, p.z)));
  // 八向寻路会用斜线绕行，所以步数不一定变多；真正说明"绕过墙"的是出现了横向位移
  const detoured = path !== null && path.some((p) => p.z !== 0);
  check('路径为了绕墙产生了横向位移', detoured, JSON.stringify(path?.map((p) => `${p.x},${p.z}`)));
}

console.log('\n[台阶与落差]');
{
  const world = new TestWorld();
  world.floor(-4, 4, -2, 2, 64);
  world.floor(5, 12, -2, 2, 63); // 前面地面低一格 → 需要跳上去（反向）
  const path = pathfinderOf(world).find(0.5, 65, 0.5, 8.5, 64, 0.5);
  check('一格高的台阶可以直接跨上去', path !== null, '无路径');
  check('路径里包含向上移动', path !== null && path.some((p) => p.y !== 65), JSON.stringify(path?.slice(0, 4)));

  const fallWorld = new TestWorld();
  fallWorld.floor(-4, 4, -2, 2, 64);
  // 目标平台低了 5 格，超过默认 maxFall(3)
  fallWorld.floor(5, 12, -2, 2, 59);
  const blocked = pathfinderOf(fallWorld).find(0.5, 65, 0.5, 8.5, 60, 0.5);
  check('超过 maxFall 的落差不可通行', blocked === null, `长度 ${blocked?.length ?? 0}`);

  const allowed = pathfinderOf(fallWorld).find(0.5, 65, 0.5, 8.5, 60, 0.5, { maxFall: 6 });
  check('调大 maxFall 后可以走下去', allowed !== null, '仍无路径');
}

console.log('\n[封死与吸附]');
{
  const world = new TestWorld();
  world.floor(-4, 12, -4, 4, 64);
  // 用 3 格高的墙把起点围死
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      if (x === 0 && z === 0) continue;
      for (let y = 65; y <= 67; y++) world.setBlock(x, y, z, true);
    }
  }
  const path = pathfinderOf(world).find(0.5, 65, 0.5, 8.5, 65, 0.5);
  check('被完全封死时返回 null', path === null, `长度 ${path?.length ?? 0}`);

  const world2 = new TestWorld();
  world2.floor(-4, 12, -4, 4, 64);
  const snapped = pathfinderOf(world2).snapToGround(3, 70, 3);   // 悬空 5 格
  check('空中坐标会被吸附到地面', snapped !== null && snapped.y === 65, JSON.stringify(snapped));
}

console.log('\n[僵尸追击]');
{
  const world = new TestWorld();
  world.floor(-8, 32, -8, 8, 64);

  const dropped: number[] = [];
  let playerDamage = 0;
  const player = { x: 12.5, y: 65, z: 0.5 };
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player,
    hurtPlayer: (amount) => {
      playerDamage += amount;
    },
    spawnDrop: (itemId) => dropped.push(itemId),
  };

  const zombieType = mobTypeById('zombie')!;
  const zombie = new Mob(zombieType, 0.5, 65.5, 0.5);
  const distanceBefore = Math.abs(player.x - zombie.x);
  for (let i = 0; i < 200; i++) zombie.tick(ctx, 0.05); // 10 秒
  const distanceAfter = Math.abs(player.x - zombie.x);
  check('僵尸会朝玩家移动', distanceAfter < distanceBefore - 5, `${distanceBefore.toFixed(1)} → ${distanceAfter.toFixed(1)}`);
  check('僵尸贴身后对玩家造成伤害', playerDamage > 0, `累计 ${playerDamage}`);
  check('僵尸始终站在地面上（不会被地形卡死）', zombie.y > 60 && zombie.y < 68, `y=${zombie.y.toFixed(2)}`);
}

console.log('\n[苦力怕：贴身后点燃引信并爆炸]');
{
  const world = new TestWorld();
  world.floor(-8, 8, -8, 8, 64);

  let explosions = 0;
  let power = 0;
  const player = { x: 2.5, y: 65, z: 0.5 };
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player,
    hurtPlayer: () => undefined,
    spawnDrop: () => undefined,
    explode: (_x, _y, _z, value) => {
      explosions++;
      power = value;
    },
  };

  // 贴到 1 格外：引信点燃，1.5 秒后自爆（0.05 秒一 tick，40 次给足余量）
  const creeper = new Mob(mobTypeById('creeper')!, 1.5, 65.5, 0.5);
  for (let i = 0; i < 40; i++) creeper.tick(ctx, 0.05);
  check('苦力怕贴身 1.5 秒后自爆', explosions === 1, String(explosions));
  check('爆炸威力是 3', power === 3, String(power));
  check('爆炸之后苦力怕消失', creeper.dead);

  // 远处（超出跟随距离）不会点燃
  const farCreeper = new Mob(mobTypeById('creeper')!, 40, 65.5, 0.5);
  for (let i = 0; i < 40; i++) farCreeper.tick(ctx, 0.05);
  check('超出跟随距离时不会引爆', explosions === 1, String(explosions));

  // 别的敌对生物仍然是近战，不会爆炸
  let zombieDamage = 0;
  const zombieCtx: EntityContext = { ...ctx, hurtPlayer: (amount) => { zombieDamage += amount; } };
  const zombie = new Mob(mobTypeById('zombie')!, 2.5, 65.5, 0.5);
  for (let i = 0; i < 40; i++) zombie.tick(zombieCtx, 0.05);
  check('僵尸依旧近战（不会爆炸）', zombieDamage > 0 && explosions === 1, `伤害 ${zombieDamage}`);
}

console.log('\n[被动生物不会跳崖]');
{
  const world = new TestWorld();
  // 4×4 的小平台，四周悬空
  world.floor(0, 3, 0, 3, 64);

  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player: null,
    hurtPlayer: () => undefined,
    spawnDrop: () => undefined,
  };

  const cowType = mobTypeById('cow')!;
  const cows: Mob[] = [];
  for (let i = 0; i < 4; i++) {
    const cow = new Mob(cowType, 1.5 + i * 0.2, 65.2, 1.5);
    cows.push(cow);
  }

  for (let i = 0; i < 400; i++) {
    for (const cow of cows) cow.tick(ctx, 0.05); // 每只 20 秒
  }

  const fallen = cows.filter((cow) => cow.y < 63);
  check('四只牛游荡 20 秒都没有掉下平台', fallen.length === 0, `掉下去 ${fallen.length} 只`);
  check('牛仍在地面高度附近', cows.every((cow) => Math.abs(cow.y - 65) < 1.2), cows.map((c) => c.y.toFixed(1)).join(','));
}

console.log('\n[战斗与掉落]');
{
  const world = new TestWorld();
  world.floor(-4, 12, -4, 4, 64);
  const drops: Array<{ itemId: number; count: number }> = [];
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player: null,
    hurtPlayer: () => undefined,
    spawnDrop: (itemId, count) => drops.push({ itemId, count }),
  };

  const zombie = new Mob(mobTypeById('zombie')!, 0.5, 65.5, 0.5);
  check('初始生命与种类一致', zombie.health === 20, `${zombie.health}`);

  const applied = zombie.hurt(6, 1, 0, ctx);
  check('受到伤害后扣血', applied && zombie.health === 14, `${zombie.health}`);
  check('受伤会红闪', zombie.hitFlash > 0);

  const blocked = zombie.hurt(6, 1, 0, ctx);
  check('0.5 秒无敌帧内不再受伤', !blocked && zombie.health === 14, `${zombie.health}`);

  const knockback = zombie.vx;
  check('受伤会被击退', knockback > 1, `vx=${knockback.toFixed(2)}`);

  // 上面刚受过伤，无敌帧还在；换一只满血的来做致死测试
  const victim0 = new Mob(mobTypeById('zombie')!, 0.5, 65.5, 0.5);
  victim0.hurt(999, 0, 0, ctx);
  check('致死后标记为待移除', victim0.dead && victim0.health === 0);

  // 掉落是概率性的，跑 200 次统计总量
  let totalDrops = 0;
  for (let i = 0; i < 200; i++) {
    const victim = new Mob(mobTypeById('zombie')!, 0.5, 65.5, 0.5);
    const before = drops.length;
    victim.hurt(999, 0, 0, ctx);
    totalDrops += drops.length - before;
  }
  // 掉落数量是 0~2 的随机，所以实际"有掉落"的概率是 0.8 × 2/3 ≈ 0.53
  check('僵尸掉落腐肉（200 次击杀约 106 次有掉落）', totalDrops > 80 && totalDrops < 140, `实际 ${totalDrops}`);
}

console.log('\n[生物表]');
{
  // 批次 92 加了烈焰人（第一种会飞的），93 加了蜘蛛与洞穴蜘蛛（第一种节肢、第一种会爬墙的），
  // 94 加了恶魂（第一种只在下界刷的、第一种"不近战"的），
  // 112 加了末影人（第一种会瞬移的、第一种"不主动攻击"的）
  // 批次 115 加了凋灵骷髅（第一种"只在某个结构里刷"的）
  check('生物表包含 25 种生物（19 敌对 + 4 被动动物 + 村民 + 小史莱姆 + 小岩浆怪）', MOB_TYPES.length === 25, `${MOB_TYPES.length}`);
  check(
    '敌对生物要么有攻击力、要么另有一条伤害通道',
    // ⚠️ 恶魂是**刻意的例外**（批次 94）：原版它不近战（撞到人也不掉血），
    // 伤害全在大火球上——所以判据不是"attackDamage > 0"，而是
    // "有攻击力 **或** 会吐会炸的东西（`shootsFireballs` 那类）"
    MOB_TYPES.filter((t) => t.hostile).every(
      (t) => t.attackDamage > 0 || t.id === 'ghast' || t.id === 'blaze',
    ),
  );
  // 村民（J11，批次 88）是**刻意的例外**：原版杀掉村民什么都不掉也不给经验
  //（掉了就等于鼓励玩家屠村），所以它进不了"被动生物都有掉落"这条里
  check(
    '被动动物都有掉落，村民没有（原版如此）',
    MOB_TYPES.filter((t) => !t.hostile && t.id !== 'villager').every((t) => t.drops.length > 0) &&
      MOB_TYPES.find((t) => t.id === 'villager')!.drops.length === 0,
  );
  check('所有生物都有正的生命与尺寸', MOB_TYPES.every((t) => t.health > 0 && t.width > 0 && t.height > 0));
}

console.log('\n[骷髅：远程射击]');
{
  const world = new TestWorld();
  world.floor(-40, 40, -8, 8, 64);

  /** 记下每次射箭 */
  const shots: { vx: number; vy: number; vz: number; damage: number; fromPlayer: boolean }[] = [];
  let meleeDamage = 0;
  const player = { x: 12.5, y: 65, z: 0.5 };
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player,
    hurtPlayer: (amount) => {
      meleeDamage += amount;
    },
    spawnDrop: () => undefined,
    spawnArrow: (_x, _y, _z, velocity, options) => {
      shots.push({ vx: velocity.x, vy: velocity.y, vz: velocity.z, damage: options.damage, fromPlayer: options.fromPlayer });
    },
  };

  const skeletonType = mobTypeById('skeleton')!;
  check('骷髅配了远程参数', skeletonType.ranged !== undefined);
  equal('射程 16 格', skeletonType.ranged?.range, 16);
  equal('每 2 秒一箭', skeletonType.ranged?.cooldown, 2);
  equal('贴到 5 格内会后退', skeletonType.ranged?.keepDistance, 5);

  // ---- 12 格外：射程内，应该放箭
  const far = new Mob(skeletonType, 0.5, 65.5, 0.5);
  for (let i = 0; i < 60; i++) far.tick(ctx, 0.05); // 3 秒
  check('射程内会放箭', shots.length > 0, `射了 ${shots.length} 次`);
  check('3 秒最多两箭（有冷却，不会连发）', shots.length <= 2, `射了 ${shots.length} 次`);
  check('箭是"敌人射的"（会打玩家）', shots[0]?.fromPlayer === false);
  check('射击方向朝向玩家（x 为正）', (shots[0]?.vx ?? 0) > 0, JSON.stringify(shots[0]));
  equal('箭的伤害取生物的攻击力', shots[0]?.damage, skeletonType.attackDamage);
  equal('骷髅不再近战（不直接扣玩家血）', meleeDamage, 0);

  // ---- 玩家贴到 2 格：应该后退而不是继续贴
  const shotsBefore = shots.length;
  const closeWorld = new TestWorld();
  closeWorld.floor(-40, 40, -8, 8, 64);
  const closePlayer = { x: 2.5, y: 65, z: 0.5 };
  const closeCtx: EntityContext = { ...ctx, world: closeWorld.asPhysicsWorld(), player: closePlayer };
  const close = new Mob(skeletonType, 0.5, 65.5, 0.5);
  const distanceBefore = Math.abs(closePlayer.x - close.x);
  for (let i = 0; i < 40; i++) close.tick(closeCtx, 0.05); // 2 秒
  const distanceAfter = Math.abs(closePlayer.x - close.x);
  check(
    '玩家贴脸时骷髅会后退',
    distanceAfter > distanceBefore + 1,
    `${distanceBefore.toFixed(1)} → ${distanceAfter.toFixed(1)}`,
  );
  void shotsBefore;

  // ---- 20 格外：超出射程（16）但在警戒范围（24）内 → 不放箭、但会靠近
  // 注意不能放到 24 格外：那样骷髅根本没发现玩家（followRange），会去游荡而不是靠近
  const shotsFar = shots.length;
  const awayWorld = new TestWorld();
  awayWorld.floor(-40, 40, -8, 8, 64);
  const awayPlayer = { x: 20.5, y: 65, z: 0.5 };
  const awayCtx: EntityContext = { ...ctx, world: awayWorld.asPhysicsWorld(), player: awayPlayer };
  const away = new Mob(skeletonType, 0.5, 65.5, 0.5);
  // 先只跑 0.5 秒：这期间它还走不进射程（2.7 格/秒 × 0.5 = 1.35 格）
  for (let i = 0; i < 10; i++) away.tick(awayCtx, 0.05);
  equal('还在射程外时不开火', shots.length, shotsFar);
  // 再跑 2 秒：它会走进射程，然后开火（这正是"接近后才射击"的完整表现）
  for (let i = 0; i < 40; i++) away.tick(awayCtx, 0.05);
  check('会朝玩家靠近', away.x > 4, `x=${away.x.toFixed(2)}`);
  check('走进射程后开始放箭', shots.length > shotsFar, `${shotsFar} → ${shots.length}`);
}

console.log('\n[剪羊毛]');
{
  const world = new TestWorld();
  world.floor(-8, 8, -8, 8, 64);

  const dropped: number[] = [];
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player: null,
    hurtPlayer: () => undefined,
    spawnDrop: (itemId) => dropped.push(itemId),
  };

  const sheepType = mobTypeById('sheep')!;
  check('羊配了"按自己颜色掉羊毛"', sheepType.wool === true);
  check(
    '羊毛不在固定掉落表里（否则每只羊都只能掉白色）',
    !sheepType.drops.some((drop) => drop.itemId === woolId(0)),
  );

  // ---- 剪一次
  const sheep = new Mob(sheepType, 0.5, 65.5, 0.5);
  const count = sheep.shear();
  check(`剪羊毛得到 1~3 个（实际 ${count}）`, count >= 1 && count <= 3);
  check('剪过之后处于"已剪"状态', sheep.sheared);
  equal('同一只羊再剪什么都不掉', sheep.shear(), 0);

  // ---- 剪过的羊死了也不掉羊毛
  dropped.length = 0;
  sheep.hurt(100, 0, 0, ctx);
  check('剪过的羊死后不掉羊毛', dropped.every((id) => id !== woolId(0)), dropped.join(','));
  check('但仍然掉羊肉', dropped.includes(Item.MUTTON), dropped.join(','));

  // ---- 没剪的羊死了掉"自己颜色"的羊毛
  const blue = new Mob(sheepType, 0.5, 65.5, 0.5);
  blue.woolColor = 11;
  dropped.length = 0;
  blue.hurt(100, 0, 0, ctx);
  check('没剪的羊死后掉羊毛', dropped.includes(woolId(11)), dropped.join(','));
  check('掉的是它自己的颜色（不是白色）', !dropped.includes(woolId(0)), dropped.join(','));

  // ---- 30 秒后长回来
  const grow = new Mob(sheepType, 0.5, 65.5, 0.5);
  grow.shear();
  const quietCtx: EntityContext = { ...ctx, player: null };
  for (let t = 0; t < WOOL_REGROW_SECONDS - 2; t += 0.5) grow.tick(quietCtx, 0.5);
  check('30 秒内还没长回来', grow.sheared);
  for (let t = 0; t < 4; t += 0.5) grow.tick(quietCtx, 0.5);
  check('30 秒后羊毛长回来了', !grow.sheared);
  check('长回来之后还能再剪', grow.shear() >= 1);
}

console.log('\n[喂食繁殖与幼体]');
{
  const world = new TestWorld();
  world.floor(-8, 8, -8, 8, 64);

  const babies: string[] = [];
  const hearts: number[] = [];
  /** 让 ctx.findMate 直接返回"另一只牛"，不依赖真实的实体列表 */
  let mateFor: Mob | null = null;
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player: null,
    hurtPlayer: () => undefined,
    spawnDrop: () => undefined,
    findMate: () => mateFor,
    spawnBaby: (type, x, y, z) => {
      const baby = new Mob(type, x, y, z);
      baby.makeBaby();
      babies.push(`${type.id}@${x.toFixed(1)},${z.toFixed(1)}`);
    },
    spawnHearts: () => {
      hearts.push(1);
    },
  };

  const cowType = mobTypeById('cow')!;
  const apple = Item.WHEAT;

  // ---- 喂食表
  equal('牛爱吃小麦（H13 耕作落地后已换回原版）', cowType.feed, Item.WHEAT);
  equal('猪爱吃胡萝卜（原版）', mobTypeById('pig')!.feed, Item.CARROT);
  equal('鸡爱吃小麦种子（原版）', mobTypeById('chicken')!.feed, Item.WHEAT_SEEDS);
  equal('僵尸不吃东西（不参与繁殖）', mobTypeById('zombie')!.feed, undefined);

  // ---- 喂食：成年体进入求爱
  const cow = new Mob(cowType, 0.5, 65.5, 0.5);
  equal('喂错东西没反应', cow.feed(Item.BONE), null);
  equal('喂对了进入求爱', cow.feed(apple), 'love');
  check('喂完处于求爱状态', cow.inLove);
  equal('刚喂过再喂没反应（已经在求爱了）', cow.feed(apple), null);

  // ---- 求爱时partner不在附近：只冒爱心，不生孩子
  mateFor = null;
  babies.length = 0;
  hearts.length = 0;
  for (let i = 0; i < 20; i++) cow.tick(ctx, 0.05);
  equal('没有配偶时不会凭空生孩子', babies.length, 0);
  check('但会一直冒爱心', hearts.length > 0);

  // ---- 配偶就在旁边：生出幼体
  const partner = new Mob(cowType, 2.0, 65.5, 0.5);
  partner.startLove();
  mateFor = partner;
  babies.length = 0;
  cow.tick(ctx, 0.05);
  equal('挨得够近就生一只', babies.length, 1, JSON.stringify(babies));
  check('两只亲本都退出了求爱', !cow.inLove && !partner.inLove);
  check('幼体生在两只中间', babies[0]!.startsWith('cow@'), babies[0]);

  // ---- 冷却：刚生完不能再喂
  equal('刚繁殖完有冷却，喂了也没用', cow.feed(apple), null);

  // ---- 幼体
  const baby = new Mob(cowType, 2.5, 65.5, 0.5);
  baby.makeBaby();
  check('幼体标记生效', baby.baby);
  equal('幼体体型缩到 55%', Number(baby.width.toFixed(3)), Number((cowType.width * BABY_SCALE).toFixed(3)));
  check('幼体碰撞盒比成年小', baby.height < cowType.height);
  equal('幼体喂食是"加速成长"而不是求爱', baby.feed(apple), 'grow');
  check('幼体不会进入求爱', !baby.inLove);

  // ---- 幼体不掉落
  const dropped: number[] = [];
  const lootCtx: EntityContext = { ...ctx, spawnDrop: (id) => dropped.push(id) };
  baby.hurt(100, 0, 0, lootCtx);
  equal('幼体死了什么都不掉（原版行为）', dropped.length, 0, dropped.join(','));

  // ---- 长大
  const grow = new Mob(cowType, 0.5, 65.5, 0.5);
  grow.makeBaby();
  for (let t = 0; t < BABY_GROW_SECONDS - 1; t += 0.5) grow.tick(ctx, 0.5);
  check('还没到时间就是幼体', grow.baby);
  for (let t = 0; t < 2; t += 0.5) grow.tick(ctx, 0.5);
  check('到时间长大', !grow.baby);
  equal('长大之后碰撞盒回到成年', grow.height, cowType.height);
  equal('长大之后喂食会进入求爱（不再是加速成长）', grow.feed(apple), 'love');

  // ---- 求爱会过期
  const timeout = new Mob(cowType, 0.5, 65.5, 0.5);
  timeout.feed(apple);
  for (let t = 0; t < LOVE_SECONDS + 1; t += 0.5) timeout.tick(ctx, 0.5);
  check('求爱超过 LOVE_SECONDS 就自动结束（原版也会）', !timeout.inLove);
}

console.log('\n[手持食物的吸引跟随]');
{
  const world = new TestWorld();
  world.floor(-20, 20, -8, 8, 64);

  let heldItemId: number | undefined;
  const player = { x: 8.5, y: 65, z: 0.5 };
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player,
    hurtPlayer: () => undefined,
    spawnDrop: () => undefined,
    heldItemId: () => heldItemId,
  };

  const cowType = mobTypeById('cow')!;

  // ---- 拿着小麦：牛会跟过来
  heldItemId = Item.WHEAT;
  // 站在 6 格外（`TEMPT_RANGE` 是 8，别卡在边界上——8.0 < 8 是 false）
  const cow = new Mob(cowType, 2.5, 65.5, 0.5);
  const before = Math.abs(player.x - cow.x);
  for (let i = 0; i < 60; i++) cow.tick(ctx, 0.05); // 3 秒
  const after = Math.abs(player.x - cow.x);
  check('拿着小麦时牛会跟过来', after < before - 2, `${before.toFixed(1)} → ${after.toFixed(1)}`);
  check('但不会贴着玩家推（停在 1.6 格外）', after > 1, `距离 ${after.toFixed(2)}`);

  // ---- 空手：牛不跟
  heldItemId = undefined;
  const idle = new Mob(cowType, 12.5, 65.5, 0.5);
  const idleBefore = Math.abs(player.x - idle.x);
  for (let i = 0; i < 60; i++) idle.tick(ctx, 0.05);
  check('空手时牛不会特意靠过来', Math.abs(player.x - idle.x) > idleBefore - 4, `${idleBefore.toFixed(1)} → ${Math.abs(player.x - idle.x).toFixed(1)}`);

  // ---- 拿错东西：也不跟
  heldItemId = Item.BONE;
  const wrong = new Mob(cowType, 0.5, 65.5, 0.5);
  const wrongBefore = Math.abs(player.x - wrong.x);
  for (let i = 0; i < 40; i++) wrong.tick(ctx, 0.05);
  check('拿着骨头牛不理（它不是食物）', Math.abs(player.x - wrong.x) > wrongBefore - 4, `${wrongBefore.toFixed(1)} → ${Math.abs(player.x - wrong.x).toFixed(1)}`);

  // ---- 太远就不跟（8 格外）
  heldItemId = Item.WHEAT;
  const farWorld = new TestWorld();
  farWorld.floor(-40, 40, -8, 8, 64);
  const farCtx: EntityContext = { ...ctx, world: farWorld.asPhysicsWorld() };
  const far = new Mob(cowType, -4.5, 65.5, 0.5);
  const farBefore = Math.abs(player.x - far.x);
  for (let i = 0; i < 20; i++) far.tick(farCtx, 0.05); // 1 秒
  check('8 格之外不会被引过来（远到 13 格）', Math.abs(player.x - far.x) > farBefore - 2, `${farBefore.toFixed(1)} → ${Math.abs(player.x - far.x).toFixed(1)}`);

  // ---- 幼体也会跟（原版小牛也认食物）
  const baby = new Mob(cowType, 2.5, 65.5, 0.5);
  baby.makeBaby();
  for (let i = 0; i < 60; i++) baby.tick(ctx, 0.05);
  check('幼体也会跟着食物走', Math.abs(player.x - baby.x) < 6, `距离 ${Math.abs(player.x - baby.x).toFixed(1)}`);
}

console.log(`\n生物测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
