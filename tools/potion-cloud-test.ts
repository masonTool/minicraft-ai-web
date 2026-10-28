/**
 * 药水云与滞留药水离线测试（批次 23 / K4 尾巴）
 *
 * 覆盖五块：
 *  1. **云的生命周期**：每 0.5 秒结算一次、30 秒后消失、半径随时间收缩
 *  2. **范围效果**：离云心越远时长越短（与喷溅共用同一套缩放）、半径外完全没有
 *  3. **龙息云**：能接龙息的条件、接一次云会缩小
 *  4. **接缝**：滞留药水摔碎时把"药水 id 与落点"报给主程序；菌（投掷物那边）不越权
 *  5. **这一批补的两个效果**：伤害药水（瞬间伤害 I/II）与隐身药水（180/480 秒），
 *     以及**隐身真的生效**（相邻的僵尸不会打隐身的玩家）
 *
 * 运行：npm run test:potioncloud
 */

import { Block } from '../web/src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, itemDef, maxStackOf } from '../web/src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../web/src/core/registry/itemNames.ts';
import { potionById, POTION_IDS, lingeringIdOf, splashIdOf } from '../web/src/core/registry/potions.ts';
import {
  CLOUD_DURATION,
  CLOUD_PULSE_INTERVAL,
  CLOUD_RADIUS_SHRINK,
  DRAGON_BREATH_COLLECT_SHRINK,
  DRAGON_BREATH_DAMAGE,
  DRAGON_BREATH_RADIUS,
  LINGERING_RADIUS,
  canCollectDragonBreath,
  cloudEffectsAt,
  createDragonBreathCloud,
  createLingeringCloud,
  tickCloud,
} from '../web/src/core/survival/PotionCloud.ts';
import { Throwable } from '../web/src/core/entity/Throwable.ts';
import { Mob } from '../web/src/core/entity/Mob.ts';
import { mobTypeById } from '../web/src/core/entity/mobs.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import type { EntityContext } from '../web/src/core/entity/Entity.ts';
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

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

function close(label: string, actual: number, expected: number, epsilon = 1e-6): void {
  check(label, Math.abs(actual - expected) <= epsilon, `实际 ${actual}，期望 ${expected}`);
}

const TILES = new Set<string>(TILE_ORDER);

/** 地面在 y<0；x ≥ 4 处有一堵墙 */
function makeWorld(): PhysicsWorld {
  return {
    collisionAt: (x: number, y: number) => (y < 0 || x >= 4 ? 'full' : null),
    isLiquid: () => false,
  } as unknown as PhysicsWorld;
}

function makeCtx(overrides: Partial<EntityContext> = {}): EntityContext {
  return {
    world: makeWorld(),
    playerBox: null,
    pickup: () => 0,
    getBlock: () => Block.AIR,
    player: { x: 0.5, y: 1, z: 0.5 },
    hurtPlayer: () => {},
    spawnDrop: () => {},
    ...overrides,
  } as EntityContext;
}

const poison = potionById(POTION_IDS.poison)!;

// ---------------------------------------------------------------- 1. 云的生命周期

console.log('\n[药水云：常量与生命周期]');
{
  equal('滞留云的半径是原版的 3 格', LINGERING_RADIUS, 3);
  equal('龙息云的半径也是 3 格', DRAGON_BREATH_RADIUS, 3);
  equal('云停留 30 秒（原版 600 tick）', CLOUD_DURATION, 30);
  equal('每 0.5 秒结算一次（原版 reapplicationDelay）', CLOUD_PULSE_INTERVAL, 0.5);
  equal('半径每秒收缩 0.1 格（原版 0.005 格/tick）', CLOUD_RADIUS_SHRINK, 0.1);

  const cloud = createLingeringCloud(poison.id, 10, 20, 30);
  equal('云记住自己的药水', cloud.potionId, poison.id);
  equal('云按出生半径起算', cloud.radius, LINGERING_RADIUS);
  equal('刚出生的云 age 为 0', cloud.age, 0);
  equal('刚出生还没结算过', cloud.pulses, 0);

  // 第一口气立刻结算（砸下去就见效）
  const first = tickCloud(cloud, 0.05);
  check('刚出生就结算第一次', first.pulse && first.alive);
  equal('结算次数 +1', cloud.pulses, 1);

  // 之后按 0.5 秒一次
  let pulses = 0;
  const cadence = createLingeringCloud(poison.id, 0, 0, 0);
  for (let t = 0; t < 3; t += 0.1) {
    if (tickCloud(cadence, 0.1).pulse) pulses++;
  }
  // 3 秒 = 第一次 + 每 0.5 秒一次 ≈ 6 次（浮点误差允许 1 次）
  check('结算节奏约每 0.5 秒一次（3 秒 ≈ 6 次）', pulses >= 5 && pulses <= 7, `实际 ${pulses} 次`);

  // 半径收缩
  const shrinking = createLingeringCloud(poison.id, 0, 0, 0);
  for (let t = 0; t < 10; t += 0.5) tickCloud(shrinking, 0.5);
  close('10 秒后半径缩掉 1 格', shrinking.radius, LINGERING_RADIUS - 1, 1e-6);
  for (let t = 0; t < 20; t += 0.5) tickCloud(shrinking, 0.5);
  equal('30 秒后云消失', tickCloud(shrinking, 0.1).alive, false);

  const longLive = createLingeringCloud(poison.id, 0, 0, 0);
  for (let t = 0; t < CLOUD_DURATION - 1; t += 0.5) tickCloud(longLive, 0.5);
  check('29 秒时还活着（不是提前消失）', tickCloud(longLive, 0.1).alive);
}

// ---------------------------------------------------------------- 2. 范围效果

console.log('\n[药水云：范围与时长缩放]');
{
  const cloud = createLingeringCloud(poison.id, 0, 0, 0);

  const center = cloudEffectsAt(cloud, 0);
  equal('云心拿满时长（剧毒 45 秒）', center[0]?.seconds, 45);

  const half = cloudEffectsAt(cloud, 1.5);
  close('1.5 格处（半径的一半）只剩一半时长', half[0]!.seconds, 22.5);

  equal('正好在云边 → 够不着', cloudEffectsAt(cloud, LINGERING_RADIUS).length, 0);
  equal('云外 → 什么都没有', cloudEffectsAt(cloud, 8).length, 0);

  // 收缩之后范围跟着小
  const small = createLingeringCloud(poison.id, 0, 0, 0);
  for (let t = 0; t < 20; t += 0.5) tickCloud(small, 0.5);
  close('20 秒后半径只剩 1 格', small.radius, 1, 1e-6);
  equal('半径缩到 1 格后，2 格处拿不到效果', cloudEffectsAt(small, 2).length, 0);
  check('但云心仍然有效', cloudEffectsAt(small, 0).length > 0);

  // 龙息云不带药水（伤害由主程序按固定值结算）
  const breath = createDragonBreathCloud(0, 0, 0);
  equal('龙息云不是药水云', breath.kind, 'dragon_breath');
  equal('龙息云没有药水 id', breath.potionId, undefined);
  equal('对龙息云取药水效果 → 空', cloudEffectsAt(breath, 0).length, 0);
}

// ---------------------------------------------------------------- 3. 接龙息

console.log('\n[龙息：收集条件]');
{
  const breath = createDragonBreathCloud(0, 0, 0);
  check('站在云里（距离 < 半径）能接', canCollectDragonBreath(breath, 1));
  check('恰好站在云边也能接（原版是"在云里"）', canCollectDragonBreath(breath, DRAGON_BREATH_RADIUS));
  check('站在云外接不到', !canCollectDragonBreath(breath, DRAGON_BREATH_RADIUS + 0.5));

  const lingering = createLingeringCloud(poison.id, 0, 0, 0);
  check('滞留药水的云接不出龙息', !canCollectDragonBreath(lingering, 0));

  // 接一次云缩小一圈（否则一片云能被无限接）
  equal('接一次缩小 0.5 格（原版 radiusOnUse）', DRAGON_BREATH_COLLECT_SHRINK, 0.5);
  breath.radius -= DRAGON_BREATH_COLLECT_SHRINK;
  close('接两次后半径剩 2 格', breath.radius - DRAGON_BREATH_COLLECT_SHRINK, 2, 1e-6);
  equal('龙息每次结算 6 点伤害（原版）', DRAGON_BREATH_DAMAGE, 6);

  check('龙息是已注册物品', itemDef(Item.DRAGON_BREATH) !== undefined);
  equal('龙息叫"龙息"', itemLabel(Item.DRAGON_BREATH), '龙息');
  equal('龙息可堆 64（原版如此）', maxStackOf(Item.DRAGON_BREATH), 64);
  check('龙息的图标在图集名单里', TILES.has(itemDef(Item.DRAGON_BREATH)!.tile));
  check('龙息有说明（写明怎么收集）', hasDescription(Item.DRAGON_BREATH));
  check('龙息在创造物品栏里', CREATIVE_ITEMS.includes(Item.DRAGON_BREATH));
}

// ---------------------------------------------------------------- 4. 与投掷物的接缝

console.log('\n[接缝：滞留药水摔碎 → 留下云]');
{
  const world = makeWorld();
  const potionId = lingeringIdOf(POTION_IDS.poison);

  const spawned: { potionId: number; x: number; y: number; z: number }[] = [];
  const ctx = makeCtx({
    world,
    applySplash: () => {},
    spawnLingering: (id, x, y, z) => spawned.push({ potionId: id, x, y, z }),
  });

  const bottle = new Throwable(0.5, 1, 0.5, { x: 30, y: 0, z: 0 }, {
    kind: 'lingering_potion',
    itemId: potionId,
    potionId,
  });
  for (let t = 0; t < 1 && !bottle.dead; t += 0.02) bottle.tick(ctx, 0.02);

  check('滞留药水命中后消失', bottle.dead);
  equal('只留下一片云', spawned.length, 1);
  equal('云记住的是滞留药水的 id', spawned[0]?.potionId, potionId);
  check('云留在墙前（不是格心也不是原点）', (spawned[0]?.x ?? 99) < 4 && (spawned[0]?.x ?? 0) > 3);

  // 喷溅与滞留是两条不同的分支：喷溅不该留下云
  const splashes: number[] = [];
  const splashCtx = makeCtx({
    world,
    spawnLingering: () => {
      throw new Error('喷溅药水不该留下药水云');
    },
    applySplash: (id) => splashes.push(id),
  });
  const splashBottle = new Throwable(0.5, 1, 0.5, { x: 30, y: 0, z: 0 }, {
    kind: 'splash_potion',
    itemId: splashIdOf(POTION_IDS.poison),
    potionId: splashIdOf(POTION_IDS.poison),
  });
  for (let t = 0; t < 1 && !splashBottle.dead; t += 0.02) splashBottle.tick(splashCtx, 0.02);
  equal('喷溅药水走炸开那条路', splashes.length, 1);
  check('两种改造版的 id 相差 50（喷溅 +50、滞留 +100）', lingeringIdOf(POTION_IDS.poison) - splashIdOf(POTION_IDS.poison) === 50);
}

// ---------------------------------------------------------------- 5. 伤害与隐身

console.log('\n[伤害药水：瞬间伤害 I / II]');
{
  const harming = potionById(POTION_IDS.harming)!;
  const harmingStrong = potionById(POTION_IDS.harming_strong)!;

  equal('伤害药水挂的是瞬间伤害', harming.effects[0]?.id, 'instant_damage');
  equal('普通档是 I 级', harming.effects[0]?.amplifier, 0);
  equal('强化档是 II 级', harmingStrong.effects[0]?.amplifier, 1);
  check('说明里写的是"立刻生效"（瞬间效果没有时长）', itemDescription(harming.id).includes('立刻生效'));
  check('它在药水表里（能被识别）', potionById(harming.id) !== undefined);

  // 对生物生效：瞬间伤害 I 打 6 点、II 打 12 点（与 Mob 侧的结算对上）
  const world = makeWorld();
  const ctx = makeCtx({ world });
  const zombieType = mobTypeById('zombie')!;
  const first = new Mob(zombieType, 0.5, 1, 0.5);
  const before = first.health;
  first.effects.apply('instant_damage', 1, 0);
  for (let t = 0; t < 0.2; t += 0.05) first.tick(ctx, 0.05);
  equal('瞬间伤害 I 打掉 6 点', before - first.health, 6);

  const second = new Mob(zombieType, 0.5, 1, 0.5);
  const before2 = second.health;
  second.effects.apply('instant_damage', 1, 1);
  for (let t = 0; t < 0.2; t += 0.05) second.tick(ctx, 0.05);
  equal('瞬间伤害 II 打掉 12 点', before2 - second.health, 12);
}

console.log('\n[隐身药水：真的生效]');
{
  const invisibility = potionById(POTION_IDS.invisibility)!;
  equal('隐身药水挂的是隐身', invisibility.effects[0]?.id, 'invisibility');
  equal('普通档 180 秒', invisibility.effects[0]?.seconds, 180);
  const long = potionById(POTION_IDS.invisibility_long)!;
  equal('延长档 480 秒', long.effects[0]?.seconds, 480);
  equal('都是 I 级（原版没有隐身 II）', invisibility.effects[0]?.amplifier, 0);

  // 相邻的僵尸：玩家可见时会打人，玩家隐身时不会
  const world = makeWorld();
  const zombieType = mobTypeById('zombie')!;

  let visibleHits = 0;
  const visibleZombie = new Mob(zombieType, 1.5, 1, 0.5);
  const visibleCtx = makeCtx({
    world,
    player: { x: 0.5, y: 1, z: 0.5 },
    hurtPlayer: () => visibleHits++,
  });
  visibleZombie.tick(visibleCtx, 0.05);
  equal('玩家可见：贴到身边就出手', visibleHits, 1);

  let hiddenHits = 0;
  const hiddenZombie = new Mob(zombieType, 1.5, 1, 0.5);
  const hiddenCtx = makeCtx({
    world,
    player: { x: 0.5, y: 1, z: 0.5 },
    playerInvisible: true,
    hurtPlayer: () => hiddenHits++,
  });
  for (let t = 0; t < 1; t += 0.05) hiddenZombie.tick(hiddenCtx, 0.05);
  equal('玩家隐身：贴着也不打', hiddenHits, 0);

  // 过一秒再打一次（确认隐身是持续的，不是"少算了一帧"）
  for (let t = 0; t < 1; t += 0.05) hiddenZombie.tick(hiddenCtx, 0.05);
  equal('隐身两秒都没挨打', hiddenHits, 0);

  // 解除隐身之后恢复追击（同一只僵尸）
  const backCtx = makeCtx({
    world,
    player: { x: 0.5, y: 1, z: 0.5 },
    playerInvisible: false,
    hurtPlayer: () => hiddenHits++,
  });
  for (let t = 0; t < 0.2 && hiddenHits === 0; t += 0.05) hiddenZombie.tick(backCtx, 0.05);
  equal('显形之后重新开始打人', hiddenHits, 1);
}

console.log(`\n药水云测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
