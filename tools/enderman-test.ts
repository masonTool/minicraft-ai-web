/**
 * 末影人离线测试（批次 112，J13 的前一半）
 *
 * 这一批做的是**末影珍珠的正经来源**：在它之前，珍珠只有"要塞传送门房的箱子"
 * 一个来源，而那张表是临时放大过的（要塞只有一个箱子却要凑够 12 颗，见 K9/批次 111）。
 * 末影人接上之后，那张表压回原版量——所以这里的判据也包含"珍珠确实掉"。
 *
 * 覆盖六块：
 *  1. **数据**：数值按原版（40 血 / 触摸 7 / 追击 24 / 高 2.9）；
 *     四处招牌行为各占一个字段（`neutral` / `stareRange` / `teleports` / `waterSensitive`）；
 *     掉落 **0~1 末影珍珠**；
 *  2. **被注视激怒**：准星落在它头上 → 翻脸 + 瞬移到你附近；没看它/隔得太远则不翻脸；
 *  3. **怕水**：泡水或**露天淋雨**每秒掉 1 点并瞬移逃开；屋檐下（天光不是 15）不掉；
 *  4. **瞬移的落点规则**：只落在能站人、不在水/岩浆里的地方；找不到落点就**不瞬移**
 *     （宁可留在原地，也不卡进石头里）；瞬移后旧路径作废；
 *  5. **受伤**：被打过就记仇（中立失效）；一半概率瞬移；**致死那一下不瞬移**
 *     （否则永远打不死）；
 *  6. **生成口径**：主世界与末地自然刷（数组写法）、不在下界；**掉落的珍珠能凑出眼睛**
 *     （与 `test:endportal` 那条"压回原版量"是一对）。
 *
 * 运行：npm run test:enderman
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Item, itemDef } from '../src/core/registry/items.ts';
import { LOOT_TABLES } from '../src/core/registry/loot.ts';
import {
  ALL_HOSTILE_MOBS,
  ENDERMAN_TYPE,
  GHAST_TYPE,
  HOSTILE_MOBS,
  MOB_TYPES,
  mobSpawnsIn,
  mobTypeById,
} from '../src/core/entity/mobs.ts';
import { createMob } from '../src/core/entity/MobFactory.ts';
import { Mob, TELEPORT_ATTEMPTS } from '../src/core/entity/Mob.ts';
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

// ---------------------------------------------------------------- 场景脚手架

/**
 * 地形：地面（STONE）在 y ≤ 63，其余是空气；`wet` 给出"那一片是水"的范围。
 *
 * ⚠️ 与 `spider-test` 同一条教训：**物理与方块查询必须来自同一份地形**，
 * 否则"AI 以为站在地上、物理却让它掉下去"，测出来的现象与代码无关。
 * 这里的物理只把 **STONE** 当实心（水不是实心），所以泡在水里的末影人会沉到水底站着。
 */
function makeTerrain(wet?: { minX: number; maxX: number; minZ: number; maxZ: number }): (
  x: number,
  y: number,
  z: number,
) => number {
  return (x, y, z) => {
    if (y <= 63) return Block.STONE;
    if (y === 64 && wet && x >= wet.minX && x <= wet.maxX && z >= wet.minZ && z <= wet.maxZ) {
      return Block.WATER;
    }
    return Block.AIR;
  };
}

function physicsOf(blocks: (x: number, y: number, z: number) => number): PhysicsWorld {
  return {
    collisionAt: (x: number, y: number, z: number) =>
      blocks(Math.floor(x), Math.floor(y), Math.floor(z)) === Block.STONE ? 'full' : null,
    isLiquid: () => false,
  } as unknown as PhysicsWorld;
}

interface Recorder {
  ctx: EntityContext;
  /** 每次 `spawnDrop` 记一笔（掉落统计用） */
  drops: number[];
  /** 玩家是不是"正看着"——由测试直接控制（真实判据在主程序里，见 `playerGazeAt`） */
  gaze: boolean;
}

function makeCtx(
  physics: PhysicsWorld,
  blocks: (x: number, y: number, z: number) => number,
  opts: { player?: { x: number; y: number; z: number } | null; skyLight?: number; raining?: boolean } = {},
): Recorder {
  const rec: Recorder = { drops: [], gaze: false, ctx: null as unknown as EntityContext };
  rec.ctx = {
    world: physics,
    playerBox: null,
    pickup: () => 0,
    getBlock: blocks,
    player: opts.player ?? null,
    lightAt: () => 0,
    skyLightAt: () => opts.skyLight ?? 0,
    raining: opts.raining ?? false,
    playerGazeAt: () => rec.gaze,
    hurtPlayer: () => {},
    spawnDrop: (itemId: number, count: number) => {
      for (let i = 0; i < count; i++) rec.drops.push(itemId);
    },
  } as unknown as EntityContext;
  return rec;
}

/** 推进若干秒（20Hz 那一档的步长） */
function run(mob: Mob, ctx: EntityContext, seconds: number, step = 0.05): void {
  for (let t = 0; t < seconds; t += step) mob.tick(ctx, step);
}

const FLAT = makeTerrain();
const FLAT_PHYSICS = physicsOf(FLAT);

/** 平地上放一只末影人（站着：脚下是 y=63 的石头） */
function spawnEnderman(x = 0.5, y = 64, z = 0.5): Mob {
  return createMob(ENDERMAN_TYPE, x, y, z);
}

// ---------------------------------------------------------------- 1. 数据

console.log('\n[末影人：类型与数据]');
{
  equal('在生物表里', mobTypeById('enderman'), ENDERMAN_TYPE);
  equal('名字', ENDERMAN_TYPE.name, '末影人');
  equal('生命 40（原版，本项目最耐打的普通怪）', ENDERMAN_TYPE.health, 40);
  equal('接触伤害 7（原版普通难度）', ENDERMAN_TYPE.attackDamage, 7);
  equal('追击范围 24 格', ENDERMAN_TYPE.followRange, 24);
  equal('身高 2.9（三格高）', ENDERMAN_TYPE.height, 2.9);
  equal('击杀经验 5', ENDERMAN_TYPE.xp, 5);

  check('**不主动攻击**（只有被注视或被打过才动手）', ENDERMAN_TYPE.neutral === true);
  equal('**被注视 64 格内会激怒**（原版数值）', ENDERMAN_TYPE.stareRange, 64);
  check('**会瞬移**', ENDERMAN_TYPE.teleports === true);
  check('**怕水**（泡水淋雨掉血）', ENDERMAN_TYPE.waterSensitive === true);

  equal('掉落只有一样：末影珍珠', ENDERMAN_TYPE.drops.length, 1);
  equal('掉的就是末影珍珠', ENDERMAN_TYPE.drops[0]!.itemId, Item.ENDER_PEARL);
  check('数量区间 0~1（原版）', ENDERMAN_TYPE.drops[0]!.min === 0 && ENDERMAN_TYPE.drops[0]!.max === 1);
  check('没有额外的概率项（原版就是 50% 掉 1 个，不是"有 50% 概率再掷数量"）', ENDERMAN_TYPE.drops[0]!.chance === undefined);
  check('**唯一掉珍珠的生物**（末地正门那条链全靠它）', MOB_TYPES.every((type) => type.id === 'enderman' || !type.drops.some((drop) => drop.itemId === Item.ENDER_PEARL)));

  // 模型：人形（不是蜘蛛那 8 条腿的骨架）
  const model = describeMobModel(ENDERMAN_TYPE);
  equal('模型骨架是人形', model.kind, 'humanoid');
  check('有两条腿在摆动（人形模型的约定）', model.legs === 2, `实际 ${model.legs}`);
  equal('眼睛是原版那抹紫色（纯黑身上唯一的辨识点）', ENDERMAN_TYPE.eyeColor, 0xcc00fa);
  check('身上是纯黑（比其它生物暗得多）', ENDERMAN_TYPE.bodyColor < 0x202028);
}

// ---------------------------------------------------------------- 2. 生成口径

console.log('\n[末影人：在哪刷]');
{
  check('进"会自然刷的敌对生物"表（主世界夜里/洞里）', HOSTILE_MOBS.some((type) => type.id === 'enderman'));
  check('也在"所有敌对生物"里（进度那条"击败怪物"认得它）', ALL_HOSTILE_MOBS.some((type) => type.id === 'enderman'));
  check('主世界会刷', mobSpawnsIn(ENDERMAN_TYPE, 'overworld'));
  check('**末地也会刷**（数组写法：原版末影人三个维度都有）', mobSpawnsIn(ENDERMAN_TYPE, 'end'));
  check('下界不刷（原版只在诡异森林，本项目没有那个群系）', !mobSpawnsIn(ENDERMAN_TYPE, 'nether'));
  check('对照：恶魂那种"一个维度"的写法照旧工作', mobSpawnsIn(GHAST_TYPE, 'nether') && !mobSpawnsIn(GHAST_TYPE, 'overworld'));
  check('对照：不写 `dimension` 的生物仍然默认主世界（僵尸）', mobSpawnsIn(mobTypeById('zombie')!, 'overworld'));

  // 三格高才装得下（默认判据是 1×2，2.9 格的末影人会半截卡在岩层里）
  equal('自然生成要求 1×3 的空腔', `${ENDERMAN_TYPE.spawnSpace?.width}×${ENDERMAN_TYPE.spawnSpace?.height}`, '1×3');
}

// ---------------------------------------------------------------- 3. 被注视激怒

console.log('\n[末影人：被注视激怒]');
{
  const player = { x: 20.5, y: 64, z: 0.5 };

  // 没看它：一直不追
  {
    const mob = spawnEnderman();
    const rec = makeCtx(FLAT_PHYSICS, FLAT, { player });
    rec.gaze = false;
    run(mob, rec.ctx, 3);
    equal('没被注视时不会追人（中立）', mob.chasingPath, 0);
  }

  // 看着它：立刻翻脸 + 贴过来
  {
    const mob = spawnEnderman();
    const rec = makeCtx(FLAT_PHYSICS, FLAT, { player });
    rec.gaze = true;
    mob.tick(rec.ctx, 0.05);
    check('被注视时**这一帧就翻脸**（不等一个延迟）', mob.angry);
    const afterStare = Math.hypot(mob.x - player.x, mob.z - player.z);
    check('翻脸时瞬移到玩家附近（3~12 格，"它怎么在我背后"的那一下）', afterStare >= 1 && afterStare <= 14, `实际 ${afterStare.toFixed(1)} 格`);
    run(mob, rec.ctx, 1);
    check('翻脸之后就走追人那条路（有路径了）', mob.chasingPath > 0 || Math.hypot(mob.x - player.x, mob.z - player.z) < afterStare);
  }

  // 太远（超过 stareRange）：看着也不翻脸
  {
    const far = { x: 70.5, y: 64, z: 0.5 };
    const mob = spawnEnderman();
    const rec = makeCtx(FLAT_PHYSICS, FLAT, { player: far });
    rec.gaze = true;
    run(mob, rec.ctx, 2);
    check('超出注视距离（64 格）就不翻脸', !mob.angry);
  }
}

// ---------------------------------------------------------------- 4. 怕水

console.log('\n[末影人：怕水]');
{
  const wet = makeTerrain({ minX: -3, maxX: 3, minZ: -3, maxZ: 3 });
  const wetPhysics = physicsOf(wet);

  // 泡在水里：1 秒掉 1 点，而且会瞬移逃开
  {
    const mob = spawnEnderman();
    const rec = makeCtx(wetPhysics, wet, { player: { x: 40.5, y: 64, z: 0.5 } });
    run(mob, rec.ctx, 0.9);
    equal('泡水不到 1 秒不掉血', mob.health, 40);
    run(mob, rec.ctx, 0.3);
    equal('泡水每满 1 秒掉 1 点', mob.health, 39);
    check('掉血的同时**瞬移逃开**（不在水坑里了）', mob.x < -3 || mob.x > 3 || Math.abs(mob.z) > 3, `落点 (${mob.x.toFixed(1)}, ${mob.z.toFixed(1)})`);
  }

  // 露天淋雨：同样掉血
  {
    const mob = spawnEnderman();
    const rec = makeCtx(FLAT_PHYSICS, FLAT, { player: { x: 40.5, y: 64, z: 0.5 }, raining: true, skyLight: 15 });
    run(mob, rec.ctx, 1.1);
    equal('露天淋雨也每秒掉 1 点（原版）', mob.health, 39);
  }

  // 屋檐下（天光不是 15 = 头顶有遮挡）：不掉血
  {
    const mob = spawnEnderman();
    const rec = makeCtx(FLAT_PHYSICS, FLAT, { player: { x: 40.5, y: 64, z: 0.5 }, raining: true, skyLight: 4 });
    run(mob, rec.ctx, 3);
    equal('屋檐下（天光 < 15）淋不到雨，不掉血', mob.health, 40);
  }

  // 不下雨也没泡水：完全不掉血
  {
    const mob = spawnEnderman();
    const rec = makeCtx(FLAT_PHYSICS, FLAT, { player: { x: 40.5, y: 64, z: 0.5 } });
    run(mob, rec.ctx, 5);
    equal('晴天在陆地上不掉血', mob.health, 40);
  }

  // 别的生物不受这一套影响（这是一根数据线，不是"所有生物都怕水"）
  {
    const zombieType = mobTypeById('zombie')!;
    const zombie = createMob(zombieType, 0.5, 64, 0.5);
    const rec = makeCtx(FLAT_PHYSICS, FLAT, { player: { x: 40.5, y: 64, z: 0.5 }, raining: true, skyLight: 15 });
    run(zombie, rec.ctx, 3);
    equal('对照：僵尸淋雨不掉血（没有 `waterSensitive`）', zombie.health, zombieType.health);
  }
}

// ---------------------------------------------------------------- 5. 瞬移的落点规则

console.log('\n[末影人：瞬移落在哪]');
{
  // 周围全是水：一次也不许落进水里
  {
    const allWet = makeTerrain({ minX: -100, maxX: 100, minZ: -100, maxZ: 100 });
    const mob = spawnEnderman(0.5, 65, 0.5);
    let inWater = 0;
    for (let i = 0; i < 40; i++) {
      const rec = makeCtx(physicsOf(allWet), allWet, {});
      mob.teleportRandomly(rec.ctx);
      const feet = allWet(Math.floor(mob.x), Math.floor(mob.y + 0.1), Math.floor(mob.z));
      if (feet === Block.WATER) inWater++;
    }
    equal('周围全是水时，40 次瞬移一次都没落进水里', inWater, 0);
  }

  // 完全没有落脚点（虚空）：不瞬移，留在原地
  {
    const voidTerrain = (): number => Block.AIR;
    const mob = spawnEnderman(8.5, 90, 8.5);
    const rec = makeCtx(physicsOf(voidTerrain), voidTerrain, {});
    const moved = mob.teleportRandomly(rec.ctx);
    check('找不到能站人的落点时**不瞬移**（宁可留在原地也不卡进方块/虚空）', moved === false);
    equal('位置一点没动', `${mob.x},${mob.y},${mob.z}`, '8.5,90,8.5');
  }

  // 瞬移之后旧路径作废（不然它会照着"旧位置算出来的路"往回走）
  {
    const mob = spawnEnderman();
    const rec = makeCtx(FLAT_PHYSICS, FLAT, { player: { x: 30.5, y: 64, z: 0.5 } });
    rec.gaze = true;
    mob.tick(rec.ctx, 0.05);
    // ⚠️ 前置条件要记"**途中**有没有过路"，而不是"0.6 秒之后还有没有"：
    // 这只末影人在追一个 30 格外的玩家，0.6 秒足够把当前这一段路走完，
    // 于是 `chasingPath` 归零——**看起来像失败，其实一切正常**。
    // 这条偶发失败在批次 499 的全量跑里露过一次（第二次跑就过），
    // 属于"断言写法不稳"，不是产品问题。
    let hadPath = mob.chasingPath > 0;
    for (let t = 0; t < 0.6; t += 0.05) {
      mob.tick(rec.ctx, 0.05);
      if (mob.chasingPath > 0) hadPath = true;
    }
    mob.teleportRandomly(rec.ctx);
    equal('瞬移之后寻路路径被清空', mob.chasingPath, 0);
    check('（前置条件：瞬移之前确实有路）', hadPath);
  }

  check('一次瞬移最多试 16 个落点（试不到就不动，见上面那条）', TELEPORT_ATTEMPTS === 16);
}

// ---------------------------------------------------------------- 6. 受伤

console.log('\n[末影人：挨打之后]');
{
  const player = { x: 20.5, y: 64, z: 0.5 };

  // 记仇：中立失效
  {
    const mob = spawnEnderman();
    const rec = makeCtx(FLAT_PHYSICS, FLAT, { player });
    mob.hurt(1, 0, 0, rec.ctx, 0, 0, { kind: 'player' });
    check('被打过就记仇（中立暂时失效）', mob.angry);
    // ⚠️ 挨打那一下有**一半概率把它闪到 32 格外**（那是"受伤逃开"，与记不记仇无关），
    // 所以这里先把位置摆回玩家跟前再推进——否则这条断言会时红时绿。
    // （"挨打会不会闪走"由下面那条统计断言单独管）
    mob.x = player.x - 6;
    mob.z = player.z;
    mob.y = 64;
    run(mob, rec.ctx, 1);
    check('记仇之后会追上来（中立失效）', mob.chasingPath > 0, `实际 ${mob.chasingPath}`);
  }

  // 一半概率瞬移（原版按伤害来源分，我们统一折成一半，见 `TELEPORT_ON_HURT_CHANCE`）
  {
    let moved = 0;
    const total = 200;
    for (let i = 0; i < total; i++) {
      const mob = spawnEnderman();
      const rec = makeCtx(FLAT_PHYSICS, FLAT, {});
      const x0 = mob.x;
      const z0 = mob.z;
      mob.hurt(1, 0, 0, rec.ctx, 0, 0, { kind: 'player' });
      if (Math.hypot(mob.x - x0, mob.z - z0) > 1) moved++;
    }
    const rate = moved / total;
    check(`挨打约一半会闪走（${(rate * 100).toFixed(0)}%，期望 50%）`, rate > 0.3 && rate < 0.7, `${moved}/${total}`);
  }

  // 致死的那一下不瞬移（否则永远打不死）
  {
    let survived = 0;
    let movedOnKill = 0;
    for (let i = 0; i < 60; i++) {
      const mob = spawnEnderman();
      const rec = makeCtx(FLAT_PHYSICS, FLAT, {});
      const x0 = mob.x;
      const z0 = mob.z;
      mob.hurt(100, 0, 0, rec.ctx, 0, 0, { kind: 'player' });
      if (!mob.dead) survived++;
      if (Math.hypot(mob.x - x0, mob.z - z0) > 1) movedOnKill++;
    }
    equal('（前置）60 次都真的打死了', survived, 0);
    equal('打死它的那一下不会瞬移', movedOnKill, 0);
  }

  // 掉落：0~1 个珍珠（50%）
  {
    let pearls = 0;
    const total = 400;
    for (let i = 0; i < total; i++) {
      const mob = spawnEnderman();
      const rec = makeCtx(FLAT_PHYSICS, FLAT, {});
      mob.hurt(100, 0, 0, rec.ctx, 0, 0, { kind: 'player' });
      pearls += rec.drops.filter((id) => id === Item.ENDER_PEARL).length;
    }
    const rate = pearls / total;
    check(`击杀平均掉到约 0.5 个珍珠（${rate.toFixed(2)}，原版 0~1）`, rate > 0.35 && rate < 0.65, `${pearls}/${total}`);
  }

  check('（对照）末影珍珠本身是已登记的物品', itemDef(Item.ENDER_PEARL) !== undefined);
  check('（对照）末影珍珠的堆叠上限 16（原版）', itemDef(Item.ENDER_PEARL)!.maxStack === 16);
}

// ---------------------------------------------------------------- 7. 与要塞那张表是一对

console.log('\n[末影珍珠的两个来源]');
{
  const table = LOOT_TABLES.find((entry) => entry.key === 'stronghold_portal');
  const pearl = table?.entries.find((entry) => entry.id === Item.ENDER_PEARL);
  check('要塞传送门房的箱子里还留着一点珍珠（跑要塞的零头）', pearl !== undefined);
  check(
    '但已经压回原版量（2~3 颗）——批次 111 那一版是 4~6 颗、权重 60 的临时放大',
    pearl!.min === 2 && pearl!.max === 3 && pearl!.weight <= 20,
    `实际 ${pearl!.min}~${pearl!.max}，权重 ${pearl!.weight}`,
  );
  check('末影人这一条路才是主力：掉珍珠的生物只有它', MOB_TYPES.filter((type) => type.drops.some((drop) => drop.itemId === Item.ENDER_PEARL)).length === 1);
}

console.log(`\n末影人测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
