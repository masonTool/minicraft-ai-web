/**
 * 流浪者离线测试（批次 125，J15 的下一只）
 *
 * 它是**骷髅的雪原变体**，也是"变体三部曲"的第三只（僵尸 → 尸壳、僵尸 → 溺尸、
 * 骷髅 → 流浪者）。招牌只有一条，但很显眼：**它射出的箭会让玩家"缓慢"**
 * （原版 30 秒）——伤害与骷髅一样是 2 点，威胁全在"追不上、跑不掉"。
 *
 * 所以这一套要盯的是三件事：
 *  1. **数据**：与骷髅同的那几项（20 血 / 伤害 2 / 射程与节奏）+ 两处不同
 *     （`arrowEffect` 缓慢 30 秒、`spawnBiomes` 只在雪原）；
 *  2. **箭上的效果**（新机制）：`Arrow` 命中玩家时挂效果那一支——玩家射的箭
 *     **不会**打玩家（所以也不该挂效果），怪物射的箭才会；
 *  3. **刷怪的"一组群系"**（批次 124 那根数据线在这一批从"一个"改成"一组"）：
 *     三处雪原都认，沙漠与草原都不认；不接钩子时一只都不刷。
 *
 * 运行：npm run test:stray
 */

import { BIOMES } from '../src/core/gen/Biome.ts';
import { Block } from '../src/core/registry/blocks.ts';
import { Item, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { itemLabel } from '../src/core/registry/itemNames.ts';
import { describeMobModel } from '../src/render/MobRenderer.ts';
import { HOSTILE_MOBS, MOB_TYPES, STRAY_TYPE, HUSK_TYPE, mobTypeById } from '../src/core/entity/mobs.ts';
import { Mob, mobLabel } from '../src/core/entity/Mob.ts';
import { MobSpawner, type SpawnContext } from '../src/core/entity/MobSpawner.ts';
import { Arrow } from '../src/core/entity/Arrow.ts';
import { boxAt } from '../src/core/physics/AABB.ts';
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

interface Rec {
  arrows: { effect?: { effect: string; seconds: number } }[];
  playerHits: number;
  effects: { effect: string; seconds: number }[];
}

/** 记录"射出去的箭带什么 / 玩家挨了几下 / 挂了什么效果"的上下文 */
function makeCtx(overrides: Record<string, unknown> = {}): { ctx: EntityContext; rec: Rec } {
  const rec: Rec = { arrows: [], playerHits: 0, effects: [] };
  const ctx = {
    world: flatPhysics(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (_x: number, y: number) => (y < 0 ? Block.STONE : Block.AIR),
    player: { x: 8.5, y: 0, z: 0.5 },
    hurtPlayer: () => {
      rec.playerHits++;
    },
    afflictPlayer: (effect: string, seconds: number) => rec.effects.push({ effect, seconds }),
    spawnDrop: () => {},
    spawnArrow: (_x: number, _y: number, _z: number, _v: unknown, options: Rec['arrows'][number]) => {
      rec.arrows.push(options);
    },
    ...overrides,
  } as unknown as EntityContext;
  return { ctx, rec };
}

function run(mob: Mob, ctx: EntityContext, seconds: number, step = 1 / 20): void {
  for (let t = 0; t < seconds; t += step) mob.tick(ctx, step);
}

// ---------------------------------------------------------------- 1. 数据

console.log('\n[流浪者：骷髅的雪原变体]');
{
  equal('名字', mobLabel(STRAY_TYPE), '流浪者');
  equal('20 点生命（与骷髅同）', STRAY_TYPE.health, 20);
  equal('接触伤害 2（与骷髅同——它的威胁不在数值上）', STRAY_TYPE.attackDamage, 2);
  equal('（对照）骷髅也是 2', mobTypeById('skeleton')!.attackDamage, 2);
  equal('追击 24 格', STRAY_TYPE.followRange, 24);
  equal('亡灵家族', STRAY_TYPE.family, 'undead');
  equal('击杀经验 5', STRAY_TYPE.xp, 5);
  equal('掉骨头 0~2（与骷髅同）', `${STRAY_TYPE.drops[0]?.min}~${STRAY_TYPE.drops[0]?.max}`, '0~2');
  equal('掉的就是骨头', STRAY_TYPE.drops[0]?.itemId, Item.BONE);
  check('在"会自然刷的敌对生物"表里', HOSTILE_MOBS.includes(STRAY_TYPE));
  check('生物表里有它', MOB_TYPES.includes(STRAY_TYPE) && mobTypeById('stray') !== undefined);

  // 与骷髅同的射击参数（原版两者一样）
  equal('射程 16 格（与骷髅同）', STRAY_TYPE.ranged?.range, 16);
  equal('每 2 秒一箭（与骷髅同）', STRAY_TYPE.ranged?.cooldown, 2);
  equal('贴到 5 格内会后退（与骷髅同）', STRAY_TYPE.ranged?.keepDistance, 5);
  check('白天照样会被晒着烧（与骷髅同一条规则）', STRAY_TYPE.burnsInDaylight === true);

  // 两处不同
  equal('**招牌：箭命中玩家挂"缓慢"**', STRAY_TYPE.arrowEffect?.effect, 'slowness');
  equal('时长 30 秒（原版）', STRAY_TYPE.arrowEffect?.seconds, 30);
  check('（对照）骷髅的箭什么都不挂', mobTypeById('skeleton')!.arrowEffect === undefined);
  check(
    '只在雪原那几处刷（`spawnBiomes` 是一组）',
    (STRAY_TYPE.spawnBiomes?.length ?? 0) > 1,
    (STRAY_TYPE.spawnBiomes ?? []).join(','),
  );
  equal('只刷在主世界', STRAY_TYPE.dimension, 'overworld');

  const model = describeMobModel(STRAY_TYPE);
  equal('模型是通用人形（与骷髅同一副骨架）', model.kind, 'humanoid');
  equal('两条腿', model.legs, 2);
  check('配色是结霜的青灰（一眼能与骷髅的白骨头分开）', STRAY_TYPE.bodyColor !== mobTypeById('skeleton')!.bodyColor);
}

// ---------------------------------------------------------------- 2. 群系名都得是真的

console.log('\n[群系限定：写进去的名字必须真的存在]');
{
  const biomeNames = new Set(BIOMES.map((biome) => biome.name));
  for (const [label, names] of [
    ['流浪者', STRAY_TYPE.spawnBiomes ?? []],
    ['尸壳', HUSK_TYPE.spawnBiomes ?? []],
  ] as const) {
    for (const name of names) {
      check(`${label}列的「${name}」是真群系（打错字就会变成"一只都不刷"且无人察觉）`, biomeNames.has(name));
    }
  }
  check(
    '流浪者要三种雪原 + 两种冻洋的冰面',
    (STRAY_TYPE.spawnBiomes ?? []).join(',') === 'snowy_plains,snowy_taiga,snowy_slopes,frozen_ocean,deep_frozen_ocean',
  );
}

// ---------------------------------------------------------------- 3. 箭上的效果

console.log('\n[箭上的效果：怪物射的箭才会挂到玩家身上]');
{
  // 流浪者射的箭（fromPlayer: false + effect）→ 伤害 + 缓慢
  {
    const { ctx, rec } = makeCtx({ playerBox: boxAt(0.5, 1, 0.5, 0.6, 1.8) });
    const arrow = new Arrow(0.5, 1, 0.5, { x: 0.01, y: 0, z: 0 }, {
      fromPlayer: false,
      damage: 2,
      effect: { effect: 'slowness', seconds: 30 },
    });
    arrow.tick(ctx, 0.02);
    check('命中了玩家（箭消失）', arrow.dead);
    equal('先结算伤害', rec.playerHits, 1);
    equal('再挂一条效果', rec.effects.length, 1);
    equal('挂的是缓慢', rec.effects[0]?.effect, 'slowness');
    equal('时长 30 秒（不是药水箭那种 1/8）', rec.effects[0]?.seconds, 30);
  }

  // 普通箭（没有 effect）→ 只伤害
  {
    const { ctx, rec } = makeCtx({ playerBox: boxAt(0.5, 1, 0.5, 0.6, 1.8) });
    const plain = new Arrow(0.5, 1, 0.5, { x: 0.01, y: 0, z: 0 }, { fromPlayer: false, damage: 2 });
    plain.tick(ctx, 0.02);
    equal('普通箭只伤害、不挂效果', rec.effects.length, 0);
    equal('（伤害照旧）', rec.playerHits, 1);
  }

  // **玩家射的箭不会打玩家自己**——所以也不会把缓慢挂到自己身上
  {
    const { ctx, rec } = makeCtx({ playerBox: boxAt(0.5, 1, 0.5, 0.6, 1.8) });
    const own = new Arrow(0.5, 1, 0.5, { x: 0.01, y: 0, z: 0 }, {
      fromPlayer: true,
      damage: 6,
      effect: { effect: 'slowness', seconds: 30 },
    });
    own.tick(ctx, 0.02);
    equal('玩家射的箭不伤自己', rec.playerHits, 0);
    equal('也不给自己挂效果', rec.effects.length, 0);
    check('（对照）它还在飞（没被自己拦下）', !own.dead);
  }
}

// ---------------------------------------------------------------- 4. AI：把效果交给箭

console.log('\n[远程 AI：箭上带不带效果，由生物自己那根数据线决定]');
{
  const { ctx, rec } = makeCtx();
  const stray = new Mob(STRAY_TYPE, 0.5, 0, 0.5);
  run(stray, ctx, 3);
  check('流浪者射箭了', rec.arrows.length > 0, `${rec.arrows.length} 支`);
  equal('箭上带着"缓慢 30 秒"', JSON.stringify(rec.arrows[0]?.effect), JSON.stringify({ effect: 'slowness', seconds: 30 }));
  check('有冷却、不会连发（3 秒最多两箭）', rec.arrows.length <= 2, `${rec.arrows.length} 支`);

  const { ctx: skelCtx, rec: skelRec } = makeCtx();
  const skeleton = new Mob(mobTypeById('skeleton')!, 0.5, 0, 0.5);
  run(skeleton, skelCtx, 3);
  check('骷髅也射箭', skelRec.arrows.length > 0);
  equal('但骷髅的箭上什么都没有（对照）', skelRec.arrows[0]?.effect, undefined);
}

// ---------------------------------------------------------------- 5. 刷怪：一组群系

console.log('\n[刷怪：流浪者只在雪原里出现（一组群系都要认）]');
{
  const land = (spawned: { id: string }[], biomeAt?: (x: number, z: number) => string | null): SpawnContext =>
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

  const runIn = (biome: string | null): { id: string }[] => {
    const spawned: { id: string }[] = [];
    const spawner = new MobSpawner();
    for (let i = 0; i < 60; i++) spawner.update(2, land(spawned, biome === null ? undefined : () => biome));
    return spawned;
  };

  // 三处雪原都要刷得出来（这一组里任何一处被漏掉，这条就会红）
  for (const biome of ['snowy_plains', 'snowy_taiga', 'snowy_slopes']) {
    const spawned = runIn(biome);
    check(`${biome} 里刷得出流浪者`, spawned.some((entry) => entry.id === 'stray'), `${spawned.length} 只`);
  }
  // 非雪原一只都没有
  for (const biome of ['plains', 'desert']) {
    const spawned = runIn(biome);
    equal(`${biome} 里一只流浪者都没有`, spawned.filter((entry) => entry.id === 'stray').length, 0);
    check(`但 ${biome} 上别的怪照刷（不是"整个刷怪器被关掉了"）`, spawned.length > 0, `${spawned.length} 只`);
  }
  // 不接钩子：一只都不刷（与 `spawnZone`/`spawnBiome` 同一条口径）
  const noHook = runIn(null);
  equal('没接 `biomeAt` 钩子时一只流浪者都不刷', noHook.filter((entry) => entry.id === 'stray').length, 0);
  equal('（顺带）尸壳也一样一只都不刷', noHook.filter((entry) => entry.id === 'husk').length, 0);
}

// ---------------------------------------------------------------- 6. 骨头那一头

console.log('\n[它掉的骨头：用途那一头]');
{
  equal('骨头的中文名', itemLabel(Item.BONE), '骨头');
  equal('堆叠 64', maxStackOf(Item.BONE), 64);
  check('有图标', itemDef(Item.BONE) !== undefined);
}

console.log(`\n流浪者测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
