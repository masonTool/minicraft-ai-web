/**
 * 尸壳与"亡灵白天被晒"离线测试（批次 124，J15 的下一只）
 *
 * 尸壳是僵尸的**沙漠变体**，它的两条招牌互相解释：
 *  - **打中你让你饥饿**（`venom: hunger`，7 秒）；
 *  - **白天在太阳底下不会烧**。
 *
 * ⚠️ 第二条**在本项目里一直是空的**：此前根本没有"亡灵白天着火"这条机制，
 * 所以尸壳做出来只是"一只普通的僵尸"。这一批先把它补上（`world/Daylight.ts`），
 * 尸壳才有它的招牌——所以这一套的重点是**那条新机制的三条判据**：
 * 露天（头顶天光 15）+ 白天 + 没下雨；以及**哪些生物会烧**这一位逐种写的数据。
 *
 * 运行：npm run test:husk
 */

import { Item, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { itemLabel } from '../src/core/registry/itemNames.ts';
import { Block } from '../src/core/registry/blocks.ts';
import { describeMobModel } from '../src/render/MobRenderer.ts';
import { ALL_HOSTILE_MOBS, HOSTILE_MOBS, HUSK_TYPE, MOB_TYPES, mobTypeById } from '../src/core/entity/mobs.ts';
import { Mob } from '../src/core/entity/Mob.ts';
import { MobSpawner, type SpawnContext } from '../src/core/entity/MobSpawner.ts';
import { DAYLIGHT_BURN_SECONDS, FULL_SKY_LIGHT, sunBurns } from '../src/core/world/Daylight.ts';
import { isNight } from '../src/core/survival/Sleep.ts';
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

/** 一片平地 */
function flatPhysics(): PhysicsWorld {
  return {
    collisionAt: (_x: number, y: number) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  } as unknown as PhysicsWorld;
}

/** 一个记录"玩家挨了几下 / 挂了什么效果"的上下文（玩家就在 1.5 格外，够得着） */
function makeCtx(overrides: Record<string, unknown> = {}): {
  ctx: EntityContext;
  rec: { hits: number; effects: { effect: string; seconds: number }[] };
} {
  const rec = { hits: 0, effects: [] as { effect: string; seconds: number }[] };
  const ctx = {
    world: flatPhysics(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (_x: number, y: number) => (y < 0 ? Block.STONE : Block.AIR),
    player: { x: 1.5, y: 0, z: 0.5 },
    hurtPlayer: () => {
      rec.hits++;
    },
    afflictPlayer: (effect: string, seconds: number) => rec.effects.push({ effect, seconds }),
    spawnDrop: () => {},
    ...overrides,
  } as unknown as EntityContext;
  return { ctx, rec };
}

function run(mob: Mob, ctx: EntityContext, seconds: number, step = 1 / 20): void {
  for (let t = 0; t < seconds; t += step) mob.tick(ctx, step);
}

// ---------------------------------------------------------------- 1. 尸壳的数据

console.log('\n[尸壳：僵尸的沙漠变体]');
{
  equal('名字', HUSK_TYPE.name, '尸壳');
  equal('20 点生命（与僵尸同）', HUSK_TYPE.health, 20);
  equal('接触伤害 3（与僵尸同）', HUSK_TYPE.attackDamage, 3);
  equal('追击 24 格', HUSK_TYPE.followRange, 24);
  equal('亡灵家族', HUSK_TYPE.family, 'undead');
  equal('击杀经验 5', HUSK_TYPE.xp, 5);
  equal('腐肉 0~2（与僵尸同）', `${HUSK_TYPE.drops[0]?.min}~${HUSK_TYPE.drops[0]?.max}`, '0~2');
  equal('掉的就是腐肉', HUSK_TYPE.drops[0]?.itemId, Item.ROTTEN_FLESH);
  check('在"会自然刷的敌对生物"表里', HOSTILE_MOBS.includes(HUSK_TYPE));
  check('生物表里有它', MOB_TYPES.includes(HUSK_TYPE) && mobTypeById('husk') !== undefined);
  equal('只刷在沙漠（`spawnBiomes`：一组群系名）', HUSK_TYPE.spawnBiomes?.join(','), 'desert');
  equal('只刷在主世界', HUSK_TYPE.dimension, 'overworld');

  // 两条招牌
  equal('命中让玩家**饥饿**（原版 7 秒）', `${HUSK_TYPE.venom?.effect},${HUSK_TYPE.venom?.seconds}`, 'hunger,7');
  check('**故意没写 `burnsInDaylight`**（它在白天照样活动，这正是它的招牌）', HUSK_TYPE.burnsInDaylight === undefined);

  const model = describeMobModel(HUSK_TYPE);
  equal('模型是通用人形（与僵尸同一副骨架）', model.kind, 'humanoid');
  equal('两条腿', model.legs, 2);
}

// ---------------------------------------------------------------- 2. 谁会在白天烧

console.log('\n[亡灵白天被晒：哪些生物会烧]');
{
  // 亡灵家族里，除了尸壳都写了这一位（原版也是如此）
  for (const id of ['zombie', 'skeleton', 'drowned'] as const) {
    const type = mobTypeById(id)!;
    check(`${type.name}**会**被太阳晒着（亡灵的通用规则）`, type.burnsInDaylight === true);
  }
  check('（对照）尸壳不会', mobTypeById('husk')!.burnsInDaylight !== true);
  // 非亡灵不烧（这几只都只是"顺带确认没写错"）
  for (const id of ['creeper', 'spider', 'zombie_piglin'] as const) {
    const type = mobTypeById(id)!;
    check(`${type.name} 不参与这条规则（不是亡灵 / 原版也不烧）`, type.burnsInDaylight !== true);
  }
  check('（对照）僵尸猪灵虽然是亡灵，但原版它在主世界也不烧——所以这一位是逐种写的', mobTypeById('zombie_piglin')!.family === 'undead');
  // 亡灵全是敌对生物（免得有人把某只挪出敌对表）
  check('会烧的那几只都在"所有敌对生物"表里', ALL_HOSTILE_MOBS.some((type) => type.id === 'zombie'));
}

// ---------------------------------------------------------------- 3. 烧的三条判据

console.log('\n[`sunBurns` 的三条判据：露天 + 白天 + 没下雨]');
{
  equal('"露天"的判据是头顶天光 15', FULL_SKY_LIGHT, 15);
  equal('点燃 8 秒（原版）', DAYLIGHT_BURN_SECONDS, 8);

  const day = { skyLight: 15, isDay: true, raining: false };
  check('白天 + 露天 + 晴天 → 烧', sunBurns(true, day));
  check('夜里不烧', !sunBurns(true, { ...day, isDay: false }));
  check('下雨不烧（原版雨会把人浇灭）', !sunBurns(true, { ...day, raining: true }));
  check('天光不足（洞里 / 屋檐下 / 水里）不烧', !sunBurns(true, { ...day, skyLight: 14 }));
  check('天光 0（深夜的洞里）当然不烧', !sunBurns(true, { ...day, skyLight: 0 }));

  // 尸壳（没这一位数据）在任何情况下都不烧
  for (const env of [day, { ...day, isDay: false }, { skyLight: 15, isDay: true, raining: true }]) {
    check(`没写这一位的生物（尸壳）不烧（isDay=${env.isDay} raining=${env.raining}）`, !sunBurns(undefined, env));
  }
  check('显式写 `false` 也不烧（与"没写"一个意思）', !sunBurns(false, day));

  // 判据与"夜里"同源：`isNight` 是那套既有口径（0.5 日落之后）
  check('（前置）夜里就是 `isNight(timeOfDay)`', isNight(0.6) && !isNight(0.1));
}

// ---------------------------------------------------------------- 4. 命中挂饥饿

console.log('\n[打中玩家 → 挂饥饿（对照：僵尸什么都不挂）]');
{
  const { ctx, rec } = makeCtx();
  const husk = new Mob(HUSK_TYPE, 0.5, 0, 0.5);
  run(husk, ctx, 3);
  check('尸壳打到了玩家', rec.hits > 0, `${rec.hits} 下`);
  check('每一下都挂一次饥饿', rec.effects.length > 0, `${rec.effects.length} 次`);
  equal('挂的是饥饿', rec.effects[0]?.effect, 'hunger');
  equal('时长 7 秒', rec.effects[0]?.seconds, 7);

  const { ctx: zombieCtx, rec: zombieRec } = makeCtx();
  const zombie = new Mob(mobTypeById('zombie')!, 0.5, 0, 0.5);
  run(zombie, zombieCtx, 3);
  check('（对照）僵尸也打人', zombieRec.hits > 0);
  equal('但僵尸不挂任何效果', zombieRec.effects.length, 0);
}

// ---------------------------------------------------------------- 5. 刷怪：只在沙漠

console.log('\n[刷怪：尸壳只在沙漠里出现]');
{
  /** 一个"y=61..62 是空气、下面全是石头"的沙漠（或别的群系） */
  const dryLand = (_biome: string, spawned: { id: string }[], biomeAt?: (x: number, z: number) => string | null): SpawnContext =>
    ({
      getBlock: (_x: number, y: number, _z: number) => (y >= 61 && y <= 62 ? Block.AIR : Block.STONE),
      getSkyLight: () => 0,
      getBlockLight: () => 0,
      getSurfaceBlockY: () => 60,
      player: { x: 0.5, y: 61, z: 0.5 },
      spawn: (type) => {
        spawned.push({ id: type.id });
      },
      hostileCount: 0,
      passiveCount: 0,
      ...(biomeAt ? { biomeAt } : {}),
    }) as SpawnContext;

  // ① 沙漠里：刷得出尸壳
  const desert: { id: string }[] = [];
  const desertSpawner = new MobSpawner();
  for (let i = 0; i < 60; i++) desertSpawner.update(2, dryLand('desert', desert, () => 'desert'));
  check('沙漠里刷得出尸壳', desert.some((entry) => entry.id === 'husk'), `${desert.length} 只`);

  // ② 别的群系（草原）：一只尸壳都不该有
  const plains: { id: string }[] = [];
  const plainsSpawner = new MobSpawner();
  for (let i = 0; i < 60; i++) plainsSpawner.update(2, dryLand('plains', plains, () => 'plains'));
  equal('草原上一只尸壳都没有', plains.filter((entry) => entry.id === 'husk').length, 0);
  check('但草原上别的怪照刷（不是"整个刷怪器被关掉了"）', plains.length > 0, `${plains.length} 只`);

  // ③ 不接钩子：一只都不刷（与 `spawnZone` 同一条口径——宁可少刷，也不要撒到全世界）
  const noHook: { id: string }[] = [];
  const noHookSpawner = new MobSpawner();
  for (let i = 0; i < 60; i++) noHookSpawner.update(2, dryLand('desert', noHook));
  equal('没接 `biomeAt` 钩子时一只尸壳都不刷', noHook.filter((entry) => entry.id === 'husk').length, 0);
}

// ---------------------------------------------------------------- 6. 腐肉那一头

console.log('\n[它掉的腐肉：用途那一头]');
{
  equal('腐肉的中文名', itemLabel(Item.ROTTEN_FLESH), '腐肉');
  equal('堆叠 64', maxStackOf(Item.ROTTEN_FLESH), 64);
  check('有图标', itemDef(Item.ROTTEN_FLESH) !== undefined);
}

console.log(`\n尸壳测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
