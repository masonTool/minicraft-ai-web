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

import { readFileSync } from 'node:fs';
import { ATTACK_ANIM_SECONDS, Mob, attackSwingAmount, leashPullBoost } from '../src/core/entity/Mob.ts';
import { Pathfinder, type BlockSampler } from '../src/core/entity/Pathfinder.ts';
import { MOB_TYPES, mobTypeById } from '../src/core/entity/mobs.ts';
import { createMob } from '../src/core/entity/MobFactory.ts';
import { toolItemId } from '../src/core/registry/tools.ts';
import { Horse } from '../src/core/entity/Horse.ts';
import type { EntityContext } from '../src/core/entity/Entity.ts';
import { Block, woolId } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import {
  BABY_GROW_SECONDS,
  BABY_SCALE,
  LOVE_SECONDS,
  WOOL_EAT_COOLDOWN_SECONDS,
  mobAcceptsTame,
  mobEats,
} from '../src/core/entity/Mob.ts';
import type { PhysicsWorld } from '../src/core/physics/PlayerPhysics.ts';
import { describeMobModel, mobAppearanceKey } from '../src/render/MobRenderer.ts';

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
  /** 明确指定 id 的格子（羊吃草要用）；没有就按 solid 回落成石头 */
  private readonly ids = new Map<string, number>();

  setBlock(x: number, y: number, z: number, solid: boolean | number): void {
    const key = `${x},${y},${z}`;
    if (typeof solid === 'number') {
      this.ids.set(key, solid);
      if (solid !== Block.AIR) this.solid.add(key);
      else this.solid.delete(key);
      return;
    }
    this.ids.delete(key);
    if (solid) this.solid.add(key);
    else this.solid.delete(key);
  }

  getBlock(x: number, y: number, z: number): number {
    const key = `${x},${y},${z}`;
    return this.ids.get(key) ?? (this.solid.has(key) ? Block.STONE : Block.AIR);
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

  // 主手武器改伤害（批次 562）：铁剑僵尸应当比空手僵尸疼
  let armedDamage = 0;
  const armedCtx: EntityContext = { ...ctx, hurtPlayer: (amount) => { armedDamage += amount; } };
  const armed = new Mob(mobTypeById('zombie')!, 2.5, 65.5, 0.5);
  armed.equipment.mainHand = toolItemId('sword', 'diamond');
  for (let i = 0; i < 40; i++) armed.tick(armedCtx, 0.05);
  check(
    '铁剑僵尸的伤害高于空手（武器伤害表生效）',
    armedDamage > zombieDamage,
    `铁剑 ${armedDamage} / 空手 ${zombieDamage}`,
  );
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

  // 击退附魔（批次 243）：同一个方向、同样的伤害，等级越高推得越远
  const plain = new Mob(mobTypeById('zombie')!, 0.5, 65.5, 0.5);
  plain.hurt(2, 1, 0, ctx);
  const knocked = new Mob(mobTypeById('zombie')!, 0.5, 65.5, 0.5);
  knocked.hurt(2, 1, 0, ctx, 0, 2);
  check(
    '击退 II 推得比无附魔远（每级 +35%）',
    knocked.vx > plain.vx * 1.5,
    `${plain.vx.toFixed(2)} → ${knocked.vx.toFixed(2)}`,
  );

  // 火焰附加（批次 243）：主程序调 `ignite(4 * 等级)`，这里钉住实体侧的两件事
  const burned = new Mob(mobTypeById('zombie')!, 0.5, 65.5, 0.5);
  burned.ignite(8);
  check('点燃之后进入燃烧', burned.burning);
  for (let i = 0; i < 20; i++) burned.tick(ctx, 0.5); // 10 秒
  check('烧够 8 秒后自动熄灭', !burned.burning);
  check('火里每满 1 秒掉 1 点（8 秒 ≈ 8 点）', burned.health <= 12 && burned.health >= 10, `剩余 ${burned.health}`);

  // 上面刚受过伤，无敌帧还在；换一只满血的来做致死测试
  const victim0 = new Mob(mobTypeById('zombie')!, 0.5, 65.5, 0.5);
  victim0.hurt(999, 0, 0, ctx);
  check('致死后标记为待移除', victim0.dead && victim0.health === 0);

  // 掉落是概率性的，跑 200 次统计总量
  let totalDrops = 0;
  for (let i = 0; i < 200; i++) {
    const victim = new Mob(mobTypeById('zombie')!, 0.5, 65.5, 0.5);
    // 只数腐肉：J27 之后僵尸还可能掉个体装备，不能再用 `drops.length` 一概而论
    const before = drops.filter((drop) => drop.itemId === Item.ROTTEN_FLESH).length;
    victim.hurt(999, 0, 0, ctx);
    totalDrops += drops.filter((drop) => drop.itemId === Item.ROTTEN_FLESH).length - before;
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
  // 批次 189 加了鱿鱼（被动、水生）
  // 批次 436：+ 热带鱼 / 河豚 / 发光鱿鱼 → 70（1.18 的完整名单）
  check('生物表包含 70 种生物（… + 热带鱼/河豚/发光鱿鱼）', MOB_TYPES.length === 70, `${MOB_TYPES.length}`);
  check(
    '敌对生物要么有攻击力、要么另有一条伤害通道',
    // ⚠️ 恶魂是**刻意的例外**（批次 94）：原版它不近战（撞到人也不掉血），
    // 伤害全在大火球上——所以判据不是"attackDamage > 0"，而是
    // "有攻击力 **或** 会吐会炸的东西（`shootsFireballs` 那类）"
    MOB_TYPES.filter((t) => t.hostile).every(
      (t) =>
        t.attackDamage > 0 ||
        t.ranged !== undefined || // 批次 344：潜影贝只有远程，没有近战
        t.id === 'ghast' ||
        t.id === 'blaze',
    ),
  );
  // 村民（J11，批次 88）是**刻意的例外**：原版杀掉村民什么都不掉也不给经验
  //（掉了就等于鼓励玩家屠村），所以它进不了"被动生物都有掉落"这条里
  // 山羊也在这条白名单里：原版它掉角，而本项目还没有那件物品，所以**故意不给假掉落**；
  // 兔子在批次 545 接上了兔脚（跳跃药水的原料），因此不再属于"没有掉落"这一档。
  // 蜜蜂（批次 374）：原版也不掉东西
  const noDropIds = new Set(['villager', 'fox', 'goat', 'panda', 'turtle', 'axolotl', 'bat', 'bee', 'parrot', 'wandering_trader']);
  check(
    '被动动物都有掉落；村民/狐狸/山羊与宠物没有（原版如此或物品未做）',
    MOB_TYPES.filter(
      (t) => !t.hostile && !noDropIds.has(t.id) && t.tameWith === undefined,
    ).every((t) => t.drops.length > 0) &&
      MOB_TYPES.filter((t) => noDropIds.has(t.id) || t.tameWith !== undefined).every(
        (t) => t.drops.length === 0,
      ),
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

  // ---- 吃草才长毛（批次 558）：脚下不是草方块就永远不长
  const hungry = new Mob(sheepType, 0.5, 65.5, 0.5);
  hungry.shear();
  for (let t = 0; t < WOOL_EAT_COOLDOWN_SECONDS * 3; t += 0.5) hungry.tick(ctx, 0.5);
  check('脚下没有草方块就不会凭空长毛', hungry.sheared);

  // 换成草方块：冷却结束后吃掉它、变泥土、羊毛长回来
  world.setBlock(0, 64, 0, Block.GRASS_BLOCK);
  const eatCtx: EntityContext = {
    ...ctx,
    setBlock: (x, y, z, id) => world.setBlock(x, y, z, id),
  };
  for (let t = 0; t < WOOL_EAT_COOLDOWN_SECONDS + 1; t += 0.5) {
    // 钉住位置：羊会自己游荡，跑出草方块上方就永远吃不到
    hungry.x = 0.5;
    hungry.z = 0.5;
    hungry.tick(eatCtx, 0.5);
  }
  check('吃到草方块后羊毛长回来', !hungry.sheared, `y=${hungry.y} sheared=${hungry.sheared} block=${world.getBlock(0, 64, 0)}`);
  equal('草方块被吃成泥土', world.getBlock(0, 64, 0), Block.DIRT);
  check('长回来之后还能再剪', hungry.shear() >= 1);
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

console.log('\n[驯服与宠物（批次 242）]');
{
  const world = new TestWorld();
  world.floor(-24, 24, -8, 8, 64);
  const player = { x: 8.5, y: 65, z: 0.5 };
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player,
    hurtPlayer: () => undefined,
    spawnDrop: () => undefined,
  };

  // ---- 数据：谁认什么
  const wolfType = mobTypeById('wolf')!;
  const catType = mobTypeById('cat')!;
  const ocelotType = mobTypeById('ocelot')!;
  const foxType = mobTypeById('fox')!;
  check(
    '狼：骨头驯服、生肉喂食（两套口粮分开）',
    mobAcceptsTame(wolfType, Item.BONE) && !mobEats(wolfType, Item.BONE) && mobEats(wolfType, Item.BEEF),
  );
  check(
    '猫/豹猫：生鱼既是驯服物也是食物',
    [catType, ocelotType].every((t) => mobAcceptsTame(t, Item.COD) && mobEats(t, Item.SALMON)),
  );
  check('狐狸不可驯服（原版也不能），只吃甜浆果', foxType.tameWith === undefined && mobEats(foxType, Item.SWEET_BERRIES));
  check(
    '三种宠物的基础成功率都是 1/3',
    [wolfType, catType, ocelotType].every((t) => Math.abs((t.tameChance ?? 0) - 1 / 3) < 1e-6),
  );

  // ---- 模型：独立的 pet 骨架 + 项圈随驯服状态换色
  const model = describeMobModel(wolfType);
  equal('狼用独立的 `pet` 骨架（不是牛猪羊那套四足）', model.kind, 'pet');
  equal('四条腿参与走路摆动', model.legs, 4);
  check(
    '部件够多（4 腿 + 躯干 + 头 + 吻 + 双耳 + 双眼 + 尾巴 + 项圈 = 13）',
    model.parts >= 13,
    `${model.parts} 个`,
  );
  const keyWild = mobAppearanceKey(new Mob(wolfType, 0, 64, 0));
  const tamedMob = new Mob(wolfType, 0, 64, 0);
  tamedMob.tryTame(1);
  check(
    '项圈颜色随驯服状态变（渲染层据此重建模型）',
    keyWild === 'wild' && mobAppearanceKey(tamedMob) === 'tamed',
    `${keyWild} → ${mobAppearanceKey(tamedMob)}`,
  );

  // ---- 掷骰：0 必失败、1 必成功
  const wild = new Mob(wolfType, 2.5, 65.5, 0.5);
  equal('概率 0 → 驯服失败', wild.tryTame(0), 'failed');
  check('失败不会把它变成宠物', !wild.tamed);
  equal('概率 1 → 驯服成功', wild.tryTame(1), 'tamed');
  check('驯服之后 tamed 为真', wild.tamed);
  equal('已驯服的再喂不重复消耗', wild.tryTame(1), null);

  // ---- 坐下 / 起来
  check('驯服的宠物可以坐下', wild.toggleSitting() === true && wild.sitting);
  check('再点一下站起来', wild.toggleSitting() === false && !wild.sitting);
  const untamed = new Mob(wolfType, 2.5, 65.5, 0.5);
  check('没驯服的不能坐下', untamed.toggleSitting() === false && !untamed.sitting);

  // ---- 跟随
  const follow = new Mob(wolfType, 2.5, 65.5, 0.5);
  follow.tryTame(1);
  const before = Math.abs(player.x - follow.x);
  for (let i = 0; i < 80; i++) follow.tick(ctx, 0.05); // 4 秒
  const after = Math.abs(player.x - follow.x);
  check('驯服的狼会跟着主人走', after < before - 2, `${before.toFixed(1)} → ${after.toFixed(1)}`);
  check('但不会顶着主人推（停在 2.2 格外）', after > 1.2, `距离 ${after.toFixed(2)}`);

  // ---- 坐下时不跟随
  const sitter = new Mob(wolfType, 2.5, 65.5, 0.5);
  sitter.tryTame(1);
  sitter.toggleSitting();
  const sitBefore = Math.abs(player.x - sitter.x);
  for (let i = 0; i < 80; i++) sitter.tick(ctx, 0.05);
  check(
    '坐下的宠物留在原地',
    Math.abs(player.x - sitter.x) > sitBefore - 0.6,
    `${sitBefore.toFixed(1)} → ${Math.abs(player.x - sitter.x).toFixed(1)}`,
  );
  check(
    '坐下时速度归零（不会滑走）',
    Math.abs(sitter.vx) < 0.2 && Math.abs(sitter.vz) < 0.2,
    `v=${sitter.vx.toFixed(2)},${sitter.vz.toFixed(2)}`,
  );

  // ---- 太远会传送到主人身边
  const teleporter = new Mob(wolfType, -20.5, 65.5, 0.5);
  teleporter.tryTame(1);
  let teleported = false;
  for (let i = 0; i < 40 && !teleported; i++) {
    teleporter.tick(ctx, 0.05);
    if (Math.abs(player.x - teleporter.x) < 6) teleported = true;
  }
  check('离主人超过 16 格会传送到身边', teleported, `最终距离 ${Math.abs(player.x - teleporter.x).toFixed(1)}`);
}

console.log('\n[骑乘：马（批次 253）]');
{
  const horse = createMob(mobTypeById('horse')!, 2.5, 65.5, 0.5) as Horse;
  check('马是 Horse 子类（不是普通 Mob）', horse instanceof Horse);
  check('默认没驯服', !horse.tamed);
  check('座位高度比矿车高（相机不会埋进马身）', horse.seatHeight > 1, `${horse.seatHeight}`);

  horse.tryTame(1);
  check('苹果驯服成功', horse.tamed);

  // 批次 253 修复：驱动方向必须用**独立的 `rideYaw`**——
  // `Mob.tick` 会按移动方向回写 `yaw`，用 yaw 算速度会让马原地来回蹭。
  const world = new TestWorld();
  world.floor(-24, 24, -8, 8, 64);
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player: { x: 8.5, y: 65, z: 0.5 },
    hurtPlayer: () => undefined,
    spawnDrop: () => undefined,
    vehicleInput: { forward: 1, strafe: 0, sprint: false },
  };

  horse.passenger = 'player';
  horse.rideYaw = -Math.PI / 2; // 朝 +X
  const start = horse.x;
  for (let i = 0; i < 60; i++) horse.tick(ctx, 0.05); // 3 秒
  check('骑上去按前进会往前走（不再原地蹭）', horse.x > start + 3, `x ${start.toFixed(1)} → ${horse.x.toFixed(1)}`);

  horse.passenger = null;
  const stopX = horse.x;
  for (let i = 0; i < 20; i++) horse.tick(ctx, 0.05);
  check('下马后不再按骑手的方向冲', Math.abs(horse.x - stopX) < 8, `x=${horse.x.toFixed(1)}`);

  // 批次 254：马跳与鞍
  check('默认没鞍（要先装鞍才能骑）', horse.saddled === false);
  horse.saddled = true;
  horse.passenger = 'player';
  const jumpCtx: EntityContext = {
    ...ctx,
    vehicleInput: { forward: 0, strafe: 0, sprint: false, jump: true },
  };
  for (let i = 0; i < 60; i++) horse.tick(ctx, 0.05); // 先落地
  horse.tick(jumpCtx, 0.05);
  check('骑着按跳跃键会起跳（vy > 0）', horse.vy > 0, `vy=${horse.vy.toFixed(2)}`);
}

console.log('\n[拴绳：牵着的动物跟着走（批次 256）]');
{
  const world = new TestWorld();
  world.floor(-24, 24, -8, 8, 64);
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player: { x: 8.5, y: 65, z: 0.5 },
    hurtPlayer: () => undefined,
    spawnDrop: () => undefined,
  };
  const cow = new Mob(mobTypeById('cow')!, 2.5, 65.5, 0.5);
  cow.tamed = true;
  cow.leashed = true;
  const before = Math.abs(8.5 - cow.x);
  for (let i = 0; i < 80; i++) cow.tick(ctx, 0.05); // 4 秒
  const after = Math.abs(8.5 - cow.x);
  check('被牵着的动物会朝主人走近', after < before - 2, `${before.toFixed(1)} → ${after.toFixed(1)}`);
  check('走到绳子长度（3.5 格）附近就停', after > 2 && after < 5.5, `距离 ${after.toFixed(2)}`);

  // 牵引增速（批次 575）：没绷紧不加速，越远越快，但有上限
  equal('没超出绳长不加速', leashPullBoost(0), 0);
  check('绷得越紧拉得越快', leashPullBoost(4) > leashPullBoost(1));
  check('牵引增速有上限（不会无限快）', leashPullBoost(100) === 1.4);
}

console.log('\n[蝙蝠：会飞的被动生物（批次 261）]');
{
  const world = new TestWorld();
  world.floor(-24, 24, -8, 8, 64);
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player: null,
    hurtPlayer: () => undefined,
    spawnDrop: () => undefined,
  };
  const bat = createMob(mobTypeById('bat')!, 2.5, 68.5, 0.5);
  const startX = bat.x;
  const startY = bat.y;
  const startZ = bat.z;
  // ⚠️ 蝙蝠的游荡方向来自 `Math.random`，不固定随机源时这条断言**偶发失败**
  // （实测出现过 horizontal = 0.25 < 0.3，而连跑三次又都是绿的）。
  // "偶尔红一次"比一直红更难查，所以这里临时换成固定种子的 LCG，跑完还原。
  const realRandom = Math.random;
  let seed = 12345;
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  try {
    for (let i = 0; i < 80; i++) bat.tick(ctx, 0.05); // 4 秒
  } finally {
    Math.random = realRandom;
  }
  const horizontal = Math.hypot(bat.x - startX, bat.z - startZ);
  check('蝙蝠在空中游荡（水平方向动了）', horizontal > 0.3, `水平位移 ${horizontal.toFixed(2)}`);
  check('不会越飞越远（只在出生点附近绕）', horizontal < 8, `水平位移 ${horizontal.toFixed(2)}`);
  check('高度基本维持（没有掉到地面）', bat.y > startY - 3 && bat.y < startY + 3, `y ${startY.toFixed(1)} → ${bat.y.toFixed(1)}`);
}

console.log('\n[炽足兽：能站在岩浆表面（批次 344）]');
{
  // 空世界（没有实心方块）+ y<=64 全是岩浆：没有 lavaWalker 的生物会直接掉下去
  const world = new TestWorld();
  const lavaCtx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (_x, y) => (y <= 64 ? Block.LAVA : 0),
    player: null,
    hurtPlayer: () => {},
    spawnDrop: () => {},
  };
  const strider = new Mob(mobTypeById('strider')!, 0.5, 64.5, 0.5);
  for (let i = 0; i < 40; i++) strider.tick(lavaCtx, 0.05);
  check('炽足兽停在岩浆表面（没有沉下去）', strider.y >= 64.5 && strider.y < 65.2, `y=${strider.y.toFixed(2)}`);

  const cow = new Mob(mobTypeById('cow')!, 0.5, 64.5, 0.5);
  for (let i = 0; i < 40; i++) cow.tick(lavaCtx, 0.05);
  check('（对照）牛会直接掉下去', cow.y < 60, `y=${cow.y.toFixed(2)}`);
}

console.log('\n[潜影贝：站着不动、射漂浮箭（批次 344）]');
{
  const world = new TestWorld();
  world.floor(-8, 63, -8, 16, 64);
  const shots: { x: number; effect?: { effect: string; seconds: number } }[] = [];
  const player = { x: 6.5, y: 65, z: 0.5 };
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player,
    hurtPlayer: () => {},
    spawnDrop: () => {},
    spawnArrow: (x, _y, _z, _v, options) => shots.push({ x, effect: options.effect }),
  };
  const shulker = new Mob(mobTypeById('shulker')!, 0.5, 64.5, 0.5);
  const startX = shulker.x;
  for (let i = 0; i < 60; i++) shulker.tick(ctx, 0.05); // 3 秒
  check('潜影贝站着不动（stationary）', Math.abs(shulker.x - startX) < 0.05, `x ${startX} → ${shulker.x.toFixed(2)}`);
  check('潜影贝会射箭', shots.length >= 1, `${shots.length} 发`);
  check(
    '箭上带漂浮 10 秒',
    shots[0]?.effect?.effect === 'levitation' && shots[0]?.effect?.seconds === 10,
    JSON.stringify(shots[0]?.effect),
  );
}

console.log('\n[寻路节流（批次 500）：走不到玩家时不会每帧重算]');
{
  // 一大片平地上盖一个 3 格高的封闭房间：玩家站在外面 10 格处，僵尸看得见、走不到
  const world = new TestWorld();
  world.floor(-12, 20, -12, 12, 64);
  for (let x = -4; x <= 4; x++) {
    for (let y = 65; y <= 67; y++) {
      world.setBlock(x, y, -4, true);
      world.setBlock(x, y, 4, true);
    }
  }
  for (let z = -3; z <= 3; z++) {
    for (let y = 65; y <= 67; y++) {
      world.setBlock(-4, y, z, true);
      world.setBlock(4, y, z, true);
    }
  }

  let blockReads = 0;
  let searches = 0;
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => {
      blockReads++;
      return world.getBlock(x, y, z);
    },
    player: { x: 10.5, y: 65, z: 0.5 },
    hurtPlayer: () => undefined,
    spawnDrop: () => undefined,
    // 只统计"真的去搜了路"的次数：`canPathSearch` 每次搜索前被问一次
    canPathSearch: () => {
      searches++;
      return true;
    },
  };

  const zombie = new Mob(mobTypeById('zombie')!, 0.5, 65.5, 0.5);
  // 1 秒 = 20 帧。旧写法（`path.length === 0` 就重算）每帧都会重跑一次失败搜索，
  // 20 帧就是 20 次；新写法首帧搜一次、失败后退避 1.2~2 秒
  for (let i = 0; i < 20; i++) zombie.tick(ctx, 0.05);
  check('1 秒内最多搜 2 次（旧写法是每帧一次 = 20 次）', searches <= 2, `${searches} 次搜索`);
  check('（对照）它确实跑过搜索，不是"根本没找路"', searches >= 1, `${searches} 次搜索`);
  check('世界查询量随之降到单次搜索的量级', blockReads < 60_000, `${blockReads} 次 getBlock`);
  check('走不到就待在原地（没有抽搐式乱走）', Math.abs(zombie.x - 0.5) < 0.6, `x=${zombie.x.toFixed(2)}`);
}

console.log('\n[寻路预算（批次 500）：拿不到预算就不跑 A*]');
{
  const world = new TestWorld();
  world.floor(-8, 20, -8, 8, 64);
  let blockReads = 0;
  let asked = 0;
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => {
      blockReads++;
      return world.getBlock(x, y, z);
    },
    player: { x: 10.5, y: 65, z: 0.5 },
    hurtPlayer: () => undefined,
    spawnDrop: () => undefined,
    // 主程序一帧的预算用完了：这一帧不许再搜
    canPathSearch: () => {
      asked++;
      return false;
    },
  };

  const zombie = new Mob(mobTypeById('zombie')!, 0.5, 65.5, 0.5);
  for (let i = 0; i < 20; i++) zombie.tick(ctx, 0.05);
  check('问过预算（钩子确实被调用）', asked > 0, `${asked} 次`);
  check('不给预算就一次 A* 都不跑', blockReads < 50, `${blockReads} 次 getBlock`);
  check('也不会因此乱走（没路就原地等下一帧）', Math.abs(zombie.x - 0.5) < 0.6, `x=${zombie.x.toFixed(2)}`);
}

console.log('\n[寻路：贴身 2 格内直接走（批次 500）]');
{
  const world = new TestWorld();
  world.floor(-8, 20, -8, 8, 64);
  let searches = 0;
  let damage = 0;
  const ctx: EntityContext = {
    world: world.asPhysicsWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    player: { x: 10.5, y: 65, z: 0.5 },
    hurtPlayer: (amount) => {
      damage += amount;
    },
    spawnDrop: () => undefined,
    canPathSearch: () => {
      searches++;
      return true;
    },
  };

  // 水平 1.5 格（distanceSq = 2.25 ≤ 4）、同一高度 → 走直线，不请 A*
  const zombie = new Mob(mobTypeById('zombie')!, 9, 65.5, 0.5);
  for (let i = 0; i < 20; i++) zombie.tick(ctx, 0.05);
  check('贴身时一次 A* 都不跑', searches === 0, `${searches} 次`);
  check('照样会贴上去打人（功能没退化）', damage > 0, `累计 ${damage}`);
}

console.log('\n[出手动画（J12）]');
{
  check('时长是一眼能看清的一小段（0.2~0.6 秒）', ATTACK_ANIM_SECONDS > 0.2 && ATTACK_ANIM_SECONDS < 0.6);
  check('没在攻击时摆动量为 0', attackSwingAmount(0) === 0);
  check('刚出手时从 0 开始抬', attackSwingAmount(ATTACK_ANIM_SECONDS) < 1e-9);
  check('中段最大（sin 半周期）', attackSwingAmount(ATTACK_ANIM_SECONDS / 2) > 0.99);
  check(
    '抬起与收回对称',
    Math.abs(attackSwingAmount(ATTACK_ANIM_SECONDS * 0.25) - attackSwingAmount(ATTACK_ANIM_SECONDS * 0.75)) < 1e-9,
  );
  check('剩余时间为负也不会画出异常角度', attackSwingAmount(-1) === 0);

  const mobSrc = readFileSync(new URL('../src/core/entity/Mob.ts', import.meta.url), 'utf8');
  const rendererSrc = readFileSync(new URL('../src/render/MobRenderer.ts', import.meta.url), 'utf8');
  check('命中时重置动画计时', mobSrc.includes('this.attackAnim = ATTACK_ANIM_SECONDS'));
  check('渲染层每帧读动画曲线', rendererSrc.includes('attackSwingAmount(mob.attackAnim)'));
  check('手臂绕肩关节转（不是绕自己中心）', rendererSrc.includes('spec.pivot && rotX !== 0'));

  // 远程动作（批次 553）：与近战分开计时，发射时才抬臂
  const skeleton = new Mob(mobTypeById('skeleton')!, 0, 64, 0);
  check('远程出手计时初始为 0', skeleton.rangedAnim === 0);
  check('发射时重置远程计时', mobSrc.includes('this.rangedAnim = ATTACK_ANIM_SECONDS'));
  check('渲染层远程双臂抬向前', rendererSrc.includes('aiming ? -1.25 * rangedSwing'));
}

console.log(`\n生物测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
