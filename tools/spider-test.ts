/**
 * 蜘蛛与洞穴蜘蛛离线测试（批次 93，J26 的最后一条断环）
 *
 * 这一批把可达性审计里剩下的那条药水链接上：**蜘蛛眼**是"剧毒"唯一的原料，
 * 也是"发酵蜘蛛眼 → 缓慢 / 伤害 / 隐身"那三条的起点。要证的东西：
 *
 *  1. **两种蜘蛛的数据**：数值按原版、掉落 蛛丝 0~2 + 蜘蛛眼（1/3）、
 *     **节肢家族**（`节肢杀手` 附魔的第一个生效目标，在此之前它没有任何生物能试）；
 *  2. **会爬墙**：贴着挡路的方块、又有往前的速度才往上爬（不是"悬浮"，
 *     更不是"穿墙"——位置照旧由 `moveBody` 推）；
 *  3. **亮处中立**：原版蜘蛛在亮度 ≥ 11 时不主动攻击；但**被打过会记仇**，
 *     记仇期间照打（不然"白天戳它一下它还在发呆"看着就像 AI 坏了）；
 *  4. **洞穴蜘蛛**：更小、每次命中让对方**中毒 7 秒**、**不进自然生成表**
 *     （原版只从废弃矿井的刷怪笼里来，而矿井还没做）。
 *
 * 运行：npm run test:spider
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import { meleeDamage } from '../src/core/registry/tools.ts';
import { Mob } from '../src/core/entity/Mob.ts';
import { ALL_HOSTILE_MOBS, CAVE_SPIDER_TYPE, HOSTILE_MOBS, MOB_TYPES, SPIDER_TYPE, mobTypeById } from '../src/core/entity/mobs.ts';
import { createMob } from '../src/core/entity/MobFactory.ts';
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

/**
 * 地形：地面在 y ≤ 63（站在 y = 64），可选一堵墙。
 *
 * ⚠️ 物理与方块查询**必须来自同一份地形**：只给 AI 看见墙、物理却不知道，
 * 蜘蛛会直接穿墙走过去（第一次跑这条测试就是这么错的——它绕过了墙，
 * 于是"爬墙"永远不会触发）。`mob-test` 里的 `TestWorld` 也是这个写法。
 */
function makeTerrain(wallX?: readonly [number, number], wallTop?: number): (x: number, y: number, z: number) => number {
  return (x, y, z) => {
    if (y <= 63) return Block.STONE;
    if (wallX && x >= wallX[0] && x <= wallX[1] && wallTop !== undefined && y <= wallTop) return Block.STONE;
    void z;
    return Block.AIR;
  };
}

/** 由地形推出物理世界（与 `TestWorld.asPhysicsWorld` 同一个写法） */
function physicsOf(blocks: (x: number, y: number, z: number) => number): PhysicsWorld {
  return {
    collisionAt: (x: number, y: number, z: number) => (blocks(Math.floor(x), Math.floor(y), Math.floor(z)) !== Block.AIR ? 'full' : null),
    isLiquid: () => false,
  } as unknown as PhysicsWorld;
}

interface Recorder {
  damage: number;
  /** 每次"施加中毒"调用记一笔（时长），用来验"每次命中施一次毒" */
  poison: number[];
  drops: number[];
  ctx: EntityContext;
}

function makeCtx(
  physics: PhysicsWorld,
  blocks: (x: number, y: number, z: number) => number,
  opts: { player?: { x: number; y: number; z: number } | null; light?: number } = {},
): Recorder {
  const rec: Recorder = { damage: 0, poison: [], drops: [], ctx: null as unknown as EntityContext };
  rec.ctx = {
    world: physics,
    playerBox: null,
    pickup: () => 0,
    getBlock: blocks,
    player: opts.player ?? null,
    lightAt: () => opts.light ?? 0,
    hurtPlayer: (amount: number) => {
      rec.damage += amount;
    },
    afflictPlayer: (_effect: 'poison', seconds: number) => {
      rec.poison.push(seconds);
    },
    spawnDrop: (itemId: number, count: number) => {
      for (let i = 0; i < count; i++) rec.drops.push(itemId);
    },
  } as unknown as EntityContext;
  return rec;
}

/** 平地 */
const FLAT = makeTerrain();

// ---------------------------------------------------------------- 1. 数据

console.log('\n[蜘蛛：类型与掉落]');
{
  equal('在中生物表里', mobTypeById('spider'), SPIDER_TYPE);
  equal('名字', SPIDER_TYPE.name, '蜘蛛');
  equal('生命 16（原版）', SPIDER_TYPE.health, 16);
  equal('接触伤害 2（原版）', SPIDER_TYPE.attackDamage, 2);
  equal('追击范围 16 格（原版）', SPIDER_TYPE.followRange, 16);
  equal('击杀经验 5', SPIDER_TYPE.xp, 5);
  equal('**节肢家族**（节肢杀手的第一个生效目标）', SPIDER_TYPE.family, 'arthropod');
  check('**会爬墙**', SPIDER_TYPE.climbing === true);
  equal('**亮度 ≥ 11 就不主动打人**（原版招牌行为）', SPIDER_TYPE.neutralInLight, 11);
  check('不进"不自然刷"那一档（蜘蛛会自然刷）', SPIDER_TYPE.naturalSpawn !== false);
  check('在敌对生物表里（会被夜晚刷出来）', HOSTILE_MOBS.includes(SPIDER_TYPE));
  check('宽体：比僵尸宽一倍（原版 1.4 格）', SPIDER_TYPE.width === 1.4 && SPIDER_TYPE.height === 0.9);

  const string_ = SPIDER_TYPE.drops.find((drop) => drop.itemId === Item.STRING);
  const eye = SPIDER_TYPE.drops.find((drop) => drop.itemId === Item.SPIDER_EYE);
  check('掉落表里有蛛丝 0~2', string_ !== undefined && string_.min === 0 && string_.max === 2);
  check(
    '掉落表里有蜘蛛眼：1 个 / 1/3 概率（原版）',
    eye !== undefined && eye.min === 1 && eye.max === 1 && Math.abs((eye.chance ?? 1) - 1 / 3) < 1e-9,
    JSON.stringify(eye),
  );
}

console.log('\n[节肢杀手：终于有生物能试了]');
{
  equal('节肢杀手 5 级 → +12.5 伤害', meleeDamage(4, { bane_of_arthropods: 5 }, SPIDER_TYPE.family), 16.5);
  equal('同一条附魔对亡灵不加', meleeDamage(4, { bane_of_arthropods: 5 }, 'undead'), 4);
  equal('蜘蛛与洞穴蜘蛛都是节肢', `${SPIDER_TYPE.family},${CAVE_SPIDER_TYPE.family}`, 'arthropod,arthropod');
}

// ---------------------------------------------------------------- 2. 掉落

console.log('\n[掉落：蛛丝总是掉、蜘蛛眼 1/3]');
{
  const physics = physicsOf(FLAT);
  let withEye = 0;
  let stringTotal = 0;
  let maxStrings = 0;
  let maxEyes = 0;
  const KILLS = 600;
  for (let i = 0; i < KILLS; i++) {
    const rec = makeCtx(physics, FLAT);
    const spider = new Mob(SPIDER_TYPE, 0.5, 65, 0.5);
    spider.hurt(100, 0, 0, rec.ctx);
    const eyes = rec.drops.filter((id) => id === Item.SPIDER_EYE).length;
    const strings = rec.drops.filter((id) => id === Item.STRING).length;
    if (eyes > 0) withEye++;
    stringTotal += strings;
    maxStrings = Math.max(maxStrings, strings);
    maxEyes = Math.max(maxEyes, eyes);
  }
  check('单次掉落量都在表里写的区间内（蛛丝 ≤ 2、蜘蛛眼 ≤ 1）', maxStrings <= 2 && maxEyes <= 1, `${maxStrings}/${maxEyes}`);
  equal('蜘蛛只掉这两样（原版没有别的）', SPIDER_TYPE.drops.length, 2);
  const eyeRate = withEye / KILLS;
  check(`蜘蛛眼出现率约 1/3（实测 ${(eyeRate * 100).toFixed(1)}%）`, eyeRate > 0.22 && eyeRate < 0.45);
  check(
    '蛛丝平均约 1 个（0~2 的均值）',
    stringTotal / KILLS > 0.6 && stringTotal / KILLS < 1.4,
    (stringTotal / KILLS).toFixed(2),
  );
}

// ---------------------------------------------------------------- 3. 爬墙

console.log('\n[爬墙：目标在墙顶上时会贴着墙爬上去]');
{
  // 场景：地面 y=64，x ≥ 2 是一堵 4 格高的墙，玩家站在**墙顶**上（y = 69）。
  // 这正是"会爬墙"唯一有意义的场合——寻路看不到墙顶的路，只会站在原地；
  // 有了它，蜘蛛会先贴墙挤、再顺着墙爬上去（原版行为）
  const WALL = makeTerrain([2, 3], 68);
  const onRoof = { x: 2.5, y: 69, z: 0.5 };

  const climbing = new Mob(SPIDER_TYPE, 0.5, 65, 0.5);
  const climbCtx = makeCtx(physicsOf(WALL), WALL, { player: onRoof, light: 4 }).ctx;
  for (let i = 0; i < 120; i++) climbing.tick(climbCtx, 0.05); // 6 秒
  check('爬上了墙（明显高于自己身高）', climbing.y > 66.5, climbing.y.toFixed(2));
  check('而且是朝墙那边贴过去的（横向也靠近了）', climbing.x > 1, climbing.x.toFixed(2));

  // 对照组：同样场景下的僵尸——它不会爬（贴着墙抖，高度不变）
  const zombie = new Mob(mobTypeById('zombie')!, 0.5, 65, 0.5);
  const zombieCtx = makeCtx(physicsOf(WALL), WALL, { player: onRoof, light: 4 }).ctx;
  for (let i = 0; i < 120; i++) zombie.tick(zombieCtx, 0.05);
  check('（对照）不会爬墙的僵尸上不去', zombie.y < 66, zombie.y.toFixed(2));

  // 空地上不爬：玩家在平地上时，蜘蛛走过去打人，不会无缘无故升高
  const flat = new Mob(SPIDER_TYPE, 0.5, 65, 0.5);
  const flatCtx = makeCtx(physicsOf(FLAT), FLAT, { player: { x: 6.5, y: 64, z: 0.5 }, light: 4 }).ctx;
  let maxY = flat.y;
  for (let i = 0; i < 120; i++) {
    flat.tick(flatCtx, 0.05);
    maxY = Math.max(maxY, flat.y);
  }
  check('平地上不会自己往上飘（只会走过去）', maxY <= 65.01, maxY.toFixed(2));
}

// ---------------------------------------------------------------- 4. 亮处中立

console.log('\n[亮处中立：暗处追人、亮处干瞪眼、被打过就还手]');
{
  const player = { x: 6.5, y: 64, z: 0.5 };

  // ⚠️ 判据用的是 "有没有进入追击状态"（`chasingPath` = 当前寻路节点数），
  // 而不是"离玩家多远"：亮处的蜘蛛仍然会**随便溜达**，溜达也可能凑巧靠近，
  // 拿距离当判据会时红时绿（第一版就是这么写的，实测飘到 1.3 格）
  const dark = new Mob(SPIDER_TYPE, 0.5, 65, 0.5);
  const darkRec = makeCtx(physicsOf(FLAT), FLAT, { player, light: 4 });
  let darkChased = false;
  for (let i = 0; i < 200; i++) {
    dark.tick(darkRec.ctx, 0.05);
    if (dark.chasingPath > 0) darkChased = true;
  }
  check('暗处（亮度 4）会追击并打到玩家', darkRec.damage > 0, String(darkRec.damage));
  check('暗处确实进入了追击状态（寻路有节点）', darkChased);

  const bright = new Mob(SPIDER_TYPE, 0.5, 65, 0.5);
  const brightRec = makeCtx(physicsOf(FLAT), FLAT, { player, light: 12 });
  let brightChased = false;
  for (let i = 0; i < 200; i++) {
    bright.tick(brightRec.ctx, 0.05);
    if (bright.chasingPath > 0) brightChased = true;
  }
  equal('亮处（亮度 12）完全不动手', brightRec.damage, 0);
  check('亮处从头到尾没进入追击状态（只会自己溜达）', !brightChased);

  const angered = new Mob(SPIDER_TYPE, 0.5, 65, 0.5);
  const angeredRec = makeCtx(physicsOf(FLAT), FLAT, { player, light: 12 });
  angered.hurt(1, 0, 0, angeredRec.ctx); // 玩家打了它一下
  for (let i = 0; i < 200; i++) angered.tick(angeredRec.ctx, 0.05);
  check('**被打过之后，亮处也照样打回来**（记仇 10 秒）', angeredRec.damage > 0, String(angeredRec.damage));

  const otherMob = new Mob(mobTypeById('zombie')!, 0.5, 65, 0.5);
  const zombieRec = makeCtx(physicsOf(FLAT), FLAT, { player, light: 15 });
  for (let i = 0; i < 100; i++) otherMob.tick(zombieRec.ctx, 0.05);
  check('别的生物没有"亮处中立"这一条（僵尸在正午照样追）', zombieRec.damage > 0, String(zombieRec.damage));
}

// ---------------------------------------------------------------- 5. 洞穴蜘蛛

console.log('\n[洞穴蜘蛛：更小、有毒、不自然刷]');
{
  equal('名字', CAVE_SPIDER_TYPE.name, '洞穴蜘蛛');
  equal('生命 12（比蜘蛛少）', CAVE_SPIDER_TYPE.health, 12);
  check(
    '体型更小（能钻进 1 格高的缝）',
    CAVE_SPIDER_TYPE.width < SPIDER_TYPE.width && CAVE_SPIDER_TYPE.height < SPIDER_TYPE.height,
    `${CAVE_SPIDER_TYPE.width}×${CAVE_SPIDER_TYPE.height}`,
  );
  equal('**命中让对方中毒 7 秒**（原版）', CAVE_SPIDER_TYPE.venom?.seconds, 7);
  equal('毒的类型是中毒', CAVE_SPIDER_TYPE.venom?.effect, 'poison');
  check('**不进自然生成表**（原版只从废弃矿井的刷怪笼来，矿井还没做）', CAVE_SPIDER_TYPE.naturalSpawn === false);
  // ⚠️ 这两条是"少了点什么"，第一版抄蜘蛛时抄错了（原版洞穴蜘蛛既不会爬墙、也不看亮度）
  check('**不会爬墙**（原版如此：垫两格就能躲开它）', CAVE_SPIDER_TYPE.climbing !== true);
  check('**亮处也不中立**（矿井里见到就打，与亮度无关）', CAVE_SPIDER_TYPE.neutralInLight === undefined);
  check('所以它不在"会自然刷"的敌对表里', !HOSTILE_MOBS.includes(CAVE_SPIDER_TYPE));
  check('但它在"所有敌对生物"那一档里（击杀类进度要算它）', ALL_HOSTILE_MOBS.includes(CAVE_SPIDER_TYPE));
  // "不自然刷、但算敌对"的那几档：洞穴蜘蛛、烈焰人，以及**史莱姆与岩浆怪的中/小两档**
  // （它们只从分裂里出现，`naturalSpawn: false`）——批次 121 起一共 5 种
  check(
    '所有敌对表比"会自然刷的"多 5 种（洞穴蜘蛛 / 烈焰人 / 中史莱姆 / 中岩浆怪 / 小岩浆怪）',
    ALL_HOSTILE_MOBS.length === HOSTILE_MOBS.length + 5,
    `${ALL_HOSTILE_MOBS.length} vs ${HOSTILE_MOBS.length}`,
  );

  const player = { x: 0.5, y: 64, z: 0.5 };
  const rec = makeCtx(physicsOf(FLAT), FLAT, { player, light: 4 });
  const caveSpider = new Mob(CAVE_SPIDER_TYPE, 0.5, 65, 0.5);
  for (let i = 0; i < 60; i++) caveSpider.tick(rec.ctx, 0.05);
  check('贴脸会打玩家', rec.damage > 0, String(rec.damage));
  check(
    '每次命中都施一次毒，每次 7 秒（3 秒里贴身命中了几次就几次）',
    rec.poison.length >= 1 && rec.poison.every((seconds) => seconds === 7),
    JSON.stringify(rec.poison),
  );

  const plainRec = makeCtx(physicsOf(FLAT), FLAT, { player, light: 4 });
  const plainSpider = new Mob(SPIDER_TYPE, 0.5, 65, 0.5);
  for (let i = 0; i < 60; i++) plainSpider.tick(plainRec.ctx, 0.05);
  equal('普通蜘蛛不施毒（对照）', plainRec.poison.length, 0);
}

// ---------------------------------------------------------------- 6. 工厂与模型

console.log('\n[工厂与模型]');
{
  const spider = createMob(SPIDER_TYPE, 0, 0, 0);
  check('工厂造出来的是 `Mob`（两种蜘蛛都没有专属子类——行为全在数据里）', spider instanceof Mob);
  equal('造出来带着自己的种类', spider.type.id, 'spider');

  const model = describeMobModel(SPIDER_TYPE);
  equal('蜘蛛用 `spider` 骨架', model.kind, 'spider');
  equal('**八条腿**参与摆动', model.legs, 8);
  equal('八个部件在最前面（腿）+ 3 段身体 + 4 只眼 = 15', model.parts, 15);
  const caveModel = describeMobModel(CAVE_SPIDER_TYPE);
  equal('洞穴蜘蛛用同一套骨架', caveModel.kind, 'spider');
  equal('部件数一样（尺寸由 type.width/height 推出来，不用另写模型）', caveModel.parts, model.parts);
  check('别的生物还是老骨架（僵尸是人形、牛是四足、烈焰人不摆动）', describeMobModel(mobTypeById('zombie')!).kind === 'humanoid');
  equal('牛仍然是四足 4 条腿', describeMobModel(mobTypeById('cow')!).legs, 4);
  equal('烈焰人仍然不摆腿', describeMobModel(mobTypeById('blaze')!).legs, 0);
  // 批次 94 起：11 → 12 种（加了恶魂）；批次 112 起 12 → 13 种、敌对 7 → 8（加了末影人）；
  // 批次 115 起 13 → 14 种、敌对 8 → 9（加了凋灵骷髅）
  check('生物表里 20 种，其中 14 种敌对（史莱姆与岩浆怪各三档、最小的史莱姆不敌对）', MOB_TYPES.length === 20 && ALL_HOSTILE_MOBS.length === 14, `${MOB_TYPES.length}/${ALL_HOSTILE_MOBS.length}`);
}

console.log(`\n蜘蛛测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
