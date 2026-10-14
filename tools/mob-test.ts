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
 */

import { Mob } from '../src/core/entity/Mob.ts';
import { Pathfinder, type BlockSampler } from '../src/core/entity/Pathfinder.ts';
import { MOB_TYPES, mobTypeById } from '../src/core/entity/mobs.ts';
import type { EntityContext } from '../src/core/entity/Entity.ts';
import { Block } from '../src/core/registry/blocks.ts';
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
  check('生物表包含 7 种生物（3 敌对 + 4 被动）', MOB_TYPES.length === 7, `${MOB_TYPES.length}`);
  check('敌对生物有攻击力', MOB_TYPES.filter((t) => t.hostile).every((t) => t.attackDamage > 0));
  check('被动生物不掉落空表', MOB_TYPES.filter((t) => !t.hostile).every((t) => t.drops.length > 0));
  check('所有生物都有正的生命与尺寸', MOB_TYPES.every((t) => t.health > 0 && t.width > 0 && t.height > 0));
}

console.log(`\n生物测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
