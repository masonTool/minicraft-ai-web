/**
 * 可投掷实体与喷溅药水离线测试（K4 尾巴 + 批次 113 的末影珍珠）
 *
 * 覆盖六块：
 *  1. **物品与来源**：雪球/鸡蛋的注册、名字、贴图；雪块掉 4 雪球、4 雪球合成 1 块雪块；
 *     鸡会下蛋（鸡蛋的唯一来源）——"表里有、游戏里拿不到"是这一批最容易翻的车
 *  2. **投掷物实体**：重力、超时消失、撞方块/命中生物后的分流
 *     （雪球只推不伤、鸡蛋 1/8 孵小鸡、喷溅药水把爆心位置报给主程序）
 *  2b. **末影珍珠**（批次 113）：落地把玩家传到**格心**、卡在方块里往上一格一格顶
 *     （顶满就用原落点）、打在生物身上也传、**超时消失不传**、说明文字不过期
 *  3. **喷溅范围**（纯函数）：半径 4、时长按 `1 - 距离/4` 缩、瞬间效果不缩、半径外完全没有
 *  4. **生物侧的状态效果**：缓慢/速度改移速、中毒不致死、凋零致死、瞬间治疗/伤害立即结算
 *  5. **鸡下蛋的节奏**：5~10 分钟内一定下过一个蛋；幼体不下蛋
 *
 * 运行：npm run test:throwable
 */

import { Block } from '../web/src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, dropFor, itemDef, maxStackOf } from '../web/src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../web/src/core/registry/itemNames.ts';
import { matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { brewRecipeFor } from '../web/src/core/crafting/Brewing.ts';
import { POTIONS, SPLASH_POTIONS, potionById, splashIdOf } from '../web/src/core/registry/potions.ts';
import { SPLASH_RADIUS, isInstantEffect, splashEffectsAt, splashScale } from '../web/src/core/survival/SplashPotion.ts';
import {
  EGG_CHICK_CHANCE,
  ENDER_EYE_DROP_CHANCE,
  ENDER_EYE_LIFETIME,
  ENDER_EYE_RISE,
  ENDER_EYE_SPEED,
  ENDER_PEARL_FALL_DAMAGE,
  ENDER_PEARL_LANDING_LIFT,
  PLAYER_THROW_SPEED,
  THROWABLE_LIFETIME,
  Throwable,
} from '../web/src/core/entity/Throwable.ts';
import { Mob, EGG_LAY_INTERVAL_MIN, EGG_LAY_INTERVAL_MAX } from '../web/src/core/entity/Mob.ts';
import { mobTypeById } from '../web/src/core/entity/mobs.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import { boxAt } from '../web/src/core/physics/AABB.ts';
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

/** 地面在 y<0，x ≥ 4 处有一堵墙 */
function makeWorld(): PhysicsWorld {
  return {
    collisionAt: (x: number, y: number) => (y < 0 || x >= 4 ? 'full' : null),
    isLiquid: () => false,
  } as unknown as PhysicsWorld;
}

/** 无障碍的世界（用来测"一直没碰到东西"） */
function emptyWorld(): PhysicsWorld {
  return { collisionAt: () => null, isLiquid: () => false } as unknown as PhysicsWorld;
}

function makeCtx(world: PhysicsWorld, overrides: Partial<EntityContext> = {}): EntityContext {
  return {
    world,
    playerBox: null,
    pickup: () => 0,
    getBlock: () => Block.AIR,
    player: { x: 0, y: 0, z: 0 },
    hurtPlayer: () => {},
    spawnDrop: () => {},
    ...overrides,
  } as EntityContext;
}

function advance(entity: { tick: (ctx: EntityContext, dt: number) => void; dead: boolean }, ctx: EntityContext, seconds: number, step = 0.02): void {
  for (let t = 0; t < seconds && !entity.dead; t += step) entity.tick(ctx, step);
}

// ---------------------------------------------------------------- 1. 物品与来源

console.log('\n[投掷物：物品与来源]');

equal('雪球有注册名', itemDef(Item.SNOWBALL)?.name, 'minicraft:snowball');
equal('鸡蛋有注册名', itemDef(Item.EGG)?.name, 'minicraft:egg');
equal('雪球 16 个一叠（原版）', maxStackOf(Item.SNOWBALL), 16);
equal('鸡蛋 16 个一叠（原版）', maxStackOf(Item.EGG), 16);
check(
  '两件投掷物的图标都在图集名单里',
  [Item.SNOWBALL, Item.EGG].every((id) => TILES.has(itemDef(id)!.tile)),
  [Item.SNOWBALL, Item.EGG].map((id) => itemDef(id)!.tile).join(' '),
);
equal('雪球叫"雪球"', itemLabel(Item.SNOWBALL), '雪球');
equal('鸡蛋叫"鸡蛋"', itemLabel(Item.EGG), '鸡蛋');
check('雪球有说明（写明 0 伤害）', hasDescription(Item.SNOWBALL));
check('鸡蛋有说明（写明 1/8 概率）', hasDescription(Item.EGG));
check('两件投掷物都能在创造物品栏里拿到', [Item.SNOWBALL, Item.EGG].every((id) => CREATIVE_ITEMS.includes(id)));

// 生存来源：雪块挖掉掉 4 个雪球（原版）
equal('雪块挖掉掉 4 个雪球', dropFor(Block.SNOW_BLOCK)?.count, 4);
equal('掉的正是雪球', dropFor(Block.SNOW_BLOCK)?.id, Item.SNOWBALL);
// 4 雪球 → 1 雪块（原版无序配方）
const snowBlockRecipe = matchRecipe([Item.SNOWBALL, Item.SNOWBALL, Item.SNOWBALL, Item.SNOWBALL], 2);
equal('4 个雪球能合成 1 块雪块', snowBlockRecipe?.id, Block.SNOW_BLOCK);
equal('合成出的雪块是 1 个', snowBlockRecipe?.count, 1);

// 鸡蛋的来源：鸡会下蛋（这条不成立的话，鸡蛋又只能在创造模式里拿）
const chickenType = mobTypeById('chicken');
check('鸡的种类表里标了"会下蛋"', chickenType?.laysEggs === true);
check('鸡蛋不是靠掉落得到的（原版鸡不掉蛋）', (chickenType?.drops ?? []).every((drop) => drop.itemId !== Item.EGG));

// 喷溅链的原料火药要在（不然喷溅药水酿不出来）
check('火药已注册且在创造物品栏里', itemDef(Item.GUNPOWDER) !== undefined && CREATIVE_ITEMS.includes(Item.GUNPOWDER));

equal('投掷初速是 30 格/秒（原版 1.5 格/tick）', PLAYER_THROW_SPEED, 30);

// ---------------------------------------------------------------- 2. 投掷物实体

console.log('\n[投掷物：重力与超时]');
{
  const world = emptyWorld();
  const ctx = makeCtx(world);
  const ball = new Throwable(0.5, 20, 0.5, { x: 10, y: 0, z: 0 }, { kind: 'snowball', itemId: Item.SNOWBALL });
  check('出手时就记录了飞行方向（渲染用）', Math.abs(ball.dirX - 1) < 1e-6 && ball.dirZ === 0);
  advance(ball, ctx, 0.5);
  check('自由飞行会下坠（受重力 12 格/秒²）', ball.vy < -5.9 && ball.vy > -6.1, `vy=${ball.vy.toFixed(2)}`);
  check('水平速度保持（没有凭空减速）', Math.abs(ball.vx - 10) < 1e-6);
  check('下坠后朝向跟着往下偏', ball.dirY < 0 && ball.dirX > 0, `dir=(${ball.dirX.toFixed(2)}, ${ball.dirY.toFixed(2)})`);

  const old = new Throwable(0.5, 20, 0.5, { x: 0, y: 0, z: 0 }, { kind: 'egg', itemId: Item.EGG });
  advance(old, ctx, THROWABLE_LIFETIME - 1);
  check(`${THROWABLE_LIFETIME} 秒内还活着`, !old.dead);
  advance(old, ctx, 2);
  check(`超过 ${THROWABLE_LIFETIME} 秒自然消失`, old.dead);
}

console.log('\n[投掷物：命中分流]');
{
  const world = makeWorld();

  // ---- 撞方块：不管哪种都会消失，并留下声音
  const sounds: string[] = [];
  const wallCtx = makeCtx(world, { playSound: (kind) => sounds.push(kind) });
  const intoWall = new Throwable(0.5, 1, 0.5, { x: 30, y: 0, z: 0 }, { kind: 'snowball', itemId: Item.SNOWBALL });
  advance(intoWall, wallCtx, 1);
  check('撞到墙就消失', intoWall.dead);
  check('没有穿墙（撞之前 x < 4）', intoWall.x < 4, `x=${intoWall.x.toFixed(2)}`);
  check('撞墙有音效', sounds.includes('arrow_hit'), sounds.join(','));

  // ---- 雪球命中生物：只推不伤（原版 0 伤害）
  const zombie = new Mob(mobTypeById('zombie')!, 2, 1, 0.5);
  const healthBefore = zombie.health;
  const hitCtx = makeCtx(world, { hitMob: () => zombie });
  const snowball = new Throwable(1.5, 1.4, 0.5, { x: 10, y: 0, z: 0 }, { kind: 'snowball', itemId: Item.SNOWBALL });
  snowball.tick(hitCtx, 0.02);
  check('雪球命中生物后消失', snowball.dead);
  equal('雪球对生物 0 伤害（血量不变）', zombie.health, healthBefore);
  check('但把目标推开了（击退）', zombie.vx > 0, `vx=${zombie.vx.toFixed(2)}`);

  // ---- 鸡蛋：掷点决定孵不孵小鸡
  const realRandom = Math.random;
  let hatched = 0;
  // 用"一定命中生物"的上下文：鸡蛋的孵小鸡判定就在命中那一下
  const eggCtx = makeCtx(world, { hitMob: () => zombie, hatchChicken: () => hatched++ });
  try {
    Math.random = () => 0; // 必定命中 1/8
    const egg = new Throwable(1.5, 1.4, 0.5, { x: 10, y: 0, z: 0 }, { kind: 'egg', itemId: Item.EGG });
    egg.tick(eggCtx, 0.02);
    equal('掷点命中就孵出小鸡', hatched, 1);

    Math.random = () => 0.99; // 必定不中
    const dud = new Throwable(1.5, 1.4, 0.5, { x: 10, y: 0, z: 0 }, { kind: 'egg', itemId: Item.EGG });
    dud.tick(eggCtx, 0.02);
    equal('掷点没中就不孵', hatched, 1);
    check('没孵出来也照样消失（鸡蛋碎了）', dud.dead);
  } finally {
    Math.random = realRandom;
  }
  close('孵出小鸡的概率是原版的 1/8', EGG_CHICK_CHANCE, 0.125);

  // ---- 喷溅药水：把爆心位置与药水 id 报给主程序
  const splashes: { potionId: number; x: number; y: number; z: number }[] = [];
  const potionId = splashIdOf(POTIONS.find((potion) => potion.key === 'poison')!.id);
  const splashCtx = makeCtx(world, {
    applySplash: (id, x, y, z) => splashes.push({ potionId: id, x, y, z }),
  });
  const bottle = new Throwable(0.5, 1, 0.5, { x: 30, y: 0, z: 0 }, {
    kind: 'splash_potion',
    itemId: potionId,
    potionId,
  });
  advance(bottle, splashCtx, 1);
  check('喷溅药水命中后消失', bottle.dead);
  equal('只结算一次', splashes.length, 1);
  equal('报上来的药水 id 正确', splashes[0]?.potionId, potionId);
  check('爆心就在墙前（没有落到格心之外）', (splashes[0]?.x ?? 99) < 4, `x=${splashes[0]?.x}`);

  // ---- 没有 applySplash 时也不能崩（退化路径）
  const bottle2 = new Throwable(0.5, 1, 0.5, { x: 30, y: 0, z: 0 }, {
    kind: 'splash_potion',
    itemId: potionId,
    potionId,
  });
  advance(bottle2, makeCtx(world), 1);
  check('主程序没给 applySplash 时也不崩', bottle2.dead);
}

// ---------------------------------------------------------------- 2b. 末影珍珠（批次 113）

console.log('\n[末影珍珠：落地把人传过去]');
{
  const world = makeWorld();

  // ---- 物品侧
  equal('末影珍珠 16 个一叠（原版）', maxStackOf(Item.ENDER_PEARL), 16);
  check('图标在图集名单里', TILES.has(itemDef(Item.ENDER_PEARL)!.tile));
  check('有说明', hasDescription(Item.ENDER_PEARL));
  check(
    '说明写了"扔出去会被传过去 + 5 点摔落伤害"',
    itemDescription(Item.ENDER_PEARL).includes('传过去') && itemDescription(Item.ENDER_PEARL).includes('摔落'),
    itemDescription(Item.ENDER_PEARL),
  );
  check(
    '说明里那句"本项目还没有末影人"已经改掉（批次 112 之后它过期了）',
    !itemDescription(Item.ENDER_PEARL).includes('还没有末影人'),
  );
  equal('摔落伤害是原版的 5 点', ENDER_PEARL_FALL_DAMAGE, 5);

  // ---- 撞墙：把玩家传到落点
  const teleports: { x: number; y: number; z: number }[] = [];
  const ctx = makeCtx(world, { teleportPlayer: (x, y, z) => teleports.push({ x, y, z }) });
  const pearl = new Throwable(0.5, 1, 0.5, { x: 30, y: 0, z: 0 }, {
    kind: 'ender_pearl',
    itemId: Item.ENDER_PEARL,
  });
  advance(pearl, ctx, 1);
  check('珍珠撞墙后消失', pearl.dead);
  equal('恰好传了一次', teleports.length, 1);
  check('落点在墙前（人不会穿墙）', (teleports[0]?.x ?? 99) < 4, `x=${teleports[0]?.x}`);
  check(
    '落点是**格心**（.5），不是珍珠的浮点坐标（否则人会半只脚卡在方块里）',
    Number.isInteger((teleports[0]?.x ?? 0) - 0.5) && Number.isInteger((teleports[0]?.z ?? 0) - 0.5),
    `${teleports[0]?.x}, ${teleports[0]?.z}`,
  );
  equal('落点吸附到脚下那一层（地面在 y<0）', teleports[0]?.y, 0);

  // ---- 落点卡在方块里：往上一格一格顶
  const lifted: { x: number; y: number; z: number }[] = [];
  const solidAt0 = makeCtx(world, {
    getBlock: (_x, y) => (y === 0 ? Block.STONE : Block.AIR),
    teleportPlayer: (x, y, z) => lifted.push({ x, y, z }),
  });
  const intoFloor = new Throwable(0.5, 0.5, 0.5, { x: 30, y: 0, z: 0 }, {
    kind: 'ender_pearl',
    itemId: Item.ENDER_PEARL,
  });
  advance(intoFloor, solidAt0, 1);
  equal('落点那一格是实心时往上顶一格', lifted[0]?.y, 1);

  // ---- 顶满仍然卡着：用原落点，不凭空把人挪走
  const buried: { x: number; y: number; z: number }[] = [];
  const allSolid = makeCtx(world, {
    getBlock: (_x, y) => (y >= 0 && y <= 6 ? Block.STONE : Block.AIR),
    teleportPlayer: (x, y, z) => buried.push({ x, y, z }),
  });
  const deep = new Throwable(0.5, 0.5, 0.5, { x: 30, y: 0, z: 0 }, {
    kind: 'ender_pearl',
    itemId: Item.ENDER_PEARL,
  });
  advance(deep, allSolid, 1);
  equal(`顶满 ${ENDER_PEARL_LANDING_LIFT} 格还不行就用原落点（顶到 3）`, buried[0]?.y, ENDER_PEARL_LANDING_LIFT);

  // ---- 打在生物身上：也照样传（原版就是"打到谁就传到他那儿"）
  const zombie = new Mob(mobTypeById('zombie')!, 2, 1, 0.5);
  const onMob: { x: number; y: number; z: number }[] = [];
  const mobCtx = makeCtx(world, {
    hitMob: () => zombie,
    teleportPlayer: (x, y, z) => onMob.push({ x, y, z }),
  });
  const atMob = new Throwable(1.5, 1.4, 0.5, { x: 10, y: 0, z: 0 }, {
    kind: 'ender_pearl',
    itemId: Item.ENDER_PEARL,
  });
  atMob.tick(mobCtx, 0.02);
  check('打在生物身上珍珠也消失', atMob.dead);
  equal('也传一次（落点就在那一片）', onMob.length, 1);
  check('落点横向落在生物附近 1 格内', Math.abs((onMob[0]?.x ?? 99) - 1.5) <= 1);

  // ---- 飞太久自然消失：**不传**（没落地就没有"落点"这回事）
  const timeoutTeleports: unknown[] = [];
  const emptyCtx = makeCtx(emptyWorld(), { teleportPlayer: (x, y, z) => timeoutTeleports.push({ x, y, z }) });
  const flying = new Throwable(0.5, 200, 0.5, { x: 5, y: 0, z: 0 }, {
    kind: 'ender_pearl',
    itemId: Item.ENDER_PEARL,
  });
  advance(flying, emptyCtx, THROWABLE_LIFETIME + 1);
  check('没碰到任何东西的珍珠超时消失', flying.dead);
  equal('超时消失不会把人传过去', timeoutTeleports.length, 0);

  // ---- 主程序没给 teleportPlayer 时也不能崩（退化路径）
  const noHook = new Throwable(0.5, 1, 0.5, { x: 30, y: 0, z: 0 }, {
    kind: 'ender_pearl',
    itemId: Item.ENDER_PEARL,
  });
  advance(noHook, makeCtx(world), 1);
  check('主程序没给 teleportPlayer 时也不崩', noHook.dead);
}

// ---------------------------------------------------------------- 2c. 末影之眼（批次 114）

console.log('\n[末影之眼：朝要塞飞]');
{
  const target = { x: 400, y: 30, z: 0 };
  const sky = makeCtx(emptyWorld(), {});

  // ---- 物品侧：说明必须把**两件事**都写出来（按进框架 / 扔出去找要塞）
  check(
    '说明写了"按进框架"与"飞向最近的要塞"两件事',
    itemDescription(Item.ENDER_EYE).includes('框架') && itemDescription(Item.ENDER_EYE).includes('要塞'),
    itemDescription(Item.ENDER_EYE),
  );
  check('末影之眼已登记（手上有它才谈得上扔）', itemDef(Item.ENDER_EYE) !== undefined);
  equal('眼睛能堆叠 64', maxStackOf(Item.ENDER_EYE), 64);

  // ---- 朝目标飘 + 先上升
  const eye = new Throwable(0.5, 70, 0.5, { x: ENDER_EYE_SPEED, y: ENDER_EYE_RISE, z: 0 }, {
    kind: 'ender_eye',
    itemId: Item.ENDER_EYE,
    target,
  });
  equal('出手时记下了目标（渲染与测试都读它）', eye.target?.x, 400);
  advance(eye, sky, 1);
  check('朝要塞飞（x 在一秒里走出去十几格）', eye.x > 8, `x=${eye.x.toFixed(1)}`);
  check('先上升（不叠重力）', eye.y > 70.5, `y=${eye.y.toFixed(2)}`);
  advance(eye, sky, 1);
  check('上升速度会衰减（弧线压平，不是一直窜）', eye.vy < ENDER_EYE_RISE, `vy=${eye.vy.toFixed(2)}`);
  check('水平速度收敛到设计值附近', Math.abs(eye.vx - ENDER_EYE_SPEED) < 1, `vx=${eye.vx.toFixed(2)}`);

  // ---- 朝反方向扔：也会拐回来（原版就是"它自己指向要塞"）
  const back = new Throwable(0.5, 70, 0.5, { x: -ENDER_EYE_SPEED, y: ENDER_EYE_RISE, z: 0 }, {
    kind: 'ender_eye',
    itemId: Item.ENDER_EYE,
    target,
  });
  advance(back, sky, 0.6);
  check('朝反方向扔出去也会自己拐向要塞', back.vx > 0, `vx=${back.vx.toFixed(2)}`);

  // ---- 已经很近了：只往上飘（原版那个"就在脚下了"的信号）
  const near = new Throwable(0.5, 70, 0.5, { x: ENDER_EYE_SPEED, y: ENDER_EYE_RISE, z: 0 }, {
    kind: 'ender_eye',
    itemId: Item.ENDER_EYE,
    target: { x: 5, y: 30, z: 0 },
  });
  advance(near, sky, 1);
  check('离要塞 15 格以内就不再往前飘', near.x < 5, `x=${near.x.toFixed(2)}`);
  check('但它还在往上飘（"挖下去"的信号）', near.y > 70.5, `y=${near.y.toFixed(2)}`);

  // ---- 飞够时间就落地
  const timed = new Throwable(0.5, 70, 0.5, { x: ENDER_EYE_SPEED, y: ENDER_EYE_RISE, z: 0 }, {
    kind: 'ender_eye',
    itemId: Item.ENDER_EYE,
    target,
  });
  advance(timed, sky, ENDER_EYE_LIFETIME - 0.5);
  check(`${ENDER_EYE_LIFETIME} 秒内一直在飞（还没落地）`, !timed.dead);
  advance(timed, sky, 1);
  check('飞够时间就落地（原版约 4 秒）', timed.dead);
  check('落地时飞出去三四十格（够看出方向）', timed.x > 25 && timed.x < 60, `x=${timed.x.toFixed(1)}`);

  // ---- 落地：八成掉回地上，两成碎掉
  const realRandom = Math.random;
  try {
    const drops: number[] = [];
    const sounds: string[] = [];
    const particles: number[] = [];
    const landed = makeCtx(emptyWorld(), {
      spawnDrop: (itemId) => drops.push(itemId),
      playSound: (kind) => sounds.push(kind),
      spawnPortalParticles: () => particles.push(1),
    });
    Math.random = () => 0.5; // < 0.8 → 掉回地上
    const lucky = new Throwable(0.5, 70, 0.5, { x: ENDER_EYE_SPEED, y: 0, z: 0 }, {
      kind: 'ender_eye',
      itemId: Item.ENDER_EYE,
      target: { x: 5, y: 30, z: 0 },
    });
    advance(lucky, landed, ENDER_EYE_LIFETIME + 0.5);
    equal('八成：眼睛掉回地上（这是"能一路扔着找"的前提）', drops.length, 1);
    equal('掉的就是末影之眼', drops[0], Item.ENDER_EYE);
    equal('掉回地上时不放碎裂粒子', particles.length, 0);

    Math.random = () => 0.95; // ≥ 0.8 → 碎掉
    const broken = new Throwable(0.5, 70, 0.5, { x: ENDER_EYE_SPEED, y: 0, z: 0 }, {
      kind: 'ender_eye',
      itemId: Item.ENDER_EYE,
      target: { x: 5, y: 30, z: 0 },
    });
    advance(broken, landed, ENDER_EYE_LIFETIME + 0.5);
    equal('两成：碎掉，什么都不留', drops.length, 1);
    check('碎掉时有声音', sounds.includes('break_glass'), sounds.join(','));
    equal('碎掉时冒一圈紫色粒子', particles.length, 1);
  } finally {
    Math.random = realRandom;
  }
  close('掉落概率是原版的 0.8', ENDER_EYE_DROP_CHANCE, 0.8);

  // ---- 穿过生物（原版它是"指路的东西"，不会打在谁身上）
  const zombie = new Mob(mobTypeById('zombie')!, 1, 70, 0.5);
  const through = new Throwable(0.5, 70, 0.5, { x: ENDER_EYE_SPEED, y: 0, z: 0 }, {
    kind: 'ender_eye',
    itemId: Item.ENDER_EYE,
    target,
  });
  const zombieCtx = makeCtx(emptyWorld(), { hitMob: () => zombie });
  advance(through, zombieCtx, 0.5);
  check('撞到生物也不落地（穿过它继续飞）', !through.dead);
  check('生物也没被推（它只是路过）', zombie.vx === 0);

  // ---- 没有目标（下界/末地扔）：按普通投掷物受重力落下
  const noTarget = new Throwable(0.5, 70, 0.5, { x: 10, y: 0, z: 0 }, {
    kind: 'ender_eye',
    itemId: Item.ENDER_EYE,
  });
  advance(noTarget, sky, 0.5);
  check('没有目标时受重力（不会诡异地一直往上飘）', noTarget.vy < -5, `vy=${noTarget.vy.toFixed(2)}`);
}

// ---------------------------------------------------------------- 3. 喷溅范围

console.log('\n[喷溅药水：范围与时长缩放]');
{
  equal('半径是原版的 4 格', SPLASH_RADIUS, 4);
  equal('距离 0 → 满倍率', splashScale(0), 1);
  close('距离 2 → 半倍率', splashScale(2), 0.5);
  equal('正好在半径上 → 0（够不着）', splashScale(SPLASH_RADIUS), 0);
  equal('半径外 → 0', splashScale(SPLASH_RADIUS + 1), 0);
  check('半径内侧一点点仍然是正的倍率', splashScale(SPLASH_RADIUS - 0.001) > 0);

  // 用真实的药水表：剧毒（45 秒，普通档）
  const poison = POTIONS.find((potion) => potion.key === 'splash_poison')!;
  check('找得到喷溅剧毒药水', poison !== undefined);
  equal('毒药水本身的时长是 45 秒', poison.effects[0]!.seconds, 45);

  const atCenter = splashEffectsAt(poison, 0);
  equal('爆心拿满时长', atCenter[0]!.seconds, 45);
  equal('倍率不因距离下降（等级是效果本身的）', atCenter[0]!.amplifier, 0);

  const atTwo = splashEffectsAt(poison, 2);
  close('2 格处只剩一半时长', atTwo[0]!.seconds, 22.5);

  equal('半径处完全没有效果', splashEffectsAt(poison, SPLASH_RADIUS).length, 0);
  equal('半径外完全没有效果', splashEffectsAt(poison, 9).length, 0);
  equal('距离为负数时按满倍率算（防手滑传负）', splashEffectsAt(poison, -3)[0]!.seconds, 45);

  // 瞬间效果不缩放（原版只缩效果时长那一项）
  const healing = POTIONS.find((potion) => potion.key === 'splash_healing')!;
  check('瞬间治疗效果被识别为瞬间', isInstantEffect('instant_health') && isInstantEffect('instant_damage'));
  equal('瞬间治疗在 2 格处仍是原时长（不缩）', splashEffectsAt(healing, 2)[0]!.seconds, healing.effects[0]!.seconds);

  // 每一瓶喷溅药水都要能算出效果（不允许出现"算不出来"的瓶子）
  let emptyTables = 0;
  for (const potion of SPLASH_POTIONS) {
    const effects = splashEffectsAt(potion, 0);
    if (potion.base) {
      if (effects.length !== 0) emptyTables++;
    } else if (effects.length !== potion.effects.length) {
      emptyTables++;
    }
  }
  equal('所以喷溅药水在爆心都能算出与效果表等长的结果', emptyTables, 0);
}

// ---------------------------------------------------------------- 4. 生物侧效果

console.log('\n[生物的状态效果：移速与伤害]');
{
  const world = makeWorld();
  const ctx = makeCtx(world);

  const slow = new Mob(mobTypeById('zombie')!, 0.5, 1, 0.5);
  equal('没效果时移速倍率是 1', slow.effects.moveSpeedMultiplier(), 1);
  slow.effects.apply('slowness', 60, 0);
  close('缓慢 I 是 -15%（原版）', slow.effects.moveSpeedMultiplier(), 0.85, 1e-9);
  slow.effects.apply('speed', 60, 0);
  close('速度 +20% 与缓慢叠加相乘', slow.effects.moveSpeedMultiplier(), 0.85 * 1.2, 1e-9);

  // 效果会过期
  const temporary = new Mob(mobTypeById('zombie')!, 0.5, 1, 0.5);
  temporary.effects.apply('slowness', 0.2);
  advance(temporary, ctx, 0.3);
  check('效果到期后自己消失', !temporary.effects.has('slowness'));

  // 力量/虚弱影响出手伤害
  const strong = new Mob(mobTypeById('zombie')!, 0.5, 1, 0.5);
  strong.effects.apply('strength', 60, 0);
  close('力量 I 加 3 点（原版）', strong.effects.attackBonus(), 3, 1e-9);
  strong.effects.apply('weakness', 60, 0);
  close('再挂虚弱 I 减 4 点', strong.effects.attackBonus(), -1, 1e-9);
}

console.log('\n[生物的状态效果：掉血与瞬间结算]');
{
  const world = makeWorld();
  const ctx = makeCtx(world);

  // 中毒不致死（原版停在 1 点血）
  const poisoned = new Mob(mobTypeById('chicken')!, 0.5, 1, 0.5);
  poisoned.health = 3;
  poisoned.effects.apply('poison', 60, 0);
  advance(poisoned, ctx, 70);
  equal('中毒不会把生物毒死（停在 1 点）', poisoned.health, 1);
  check('但它确实一直在掉血', !poisoned.dead);

  // 凋零会致死
  const withered = new Mob(mobTypeById('chicken')!, 0.5, 1, 0.5);
  withered.effects.apply('wither', 60, 0);
  advance(withered, ctx, 70);
  check('凋零会把生物打死（原版行为）', withered.dead);

  // 瞬间伤害：I 级 6 点、II 级 12 点
  const zapped = new Mob(mobTypeById('zombie')!, 0.5, 1, 0.5);
  const before = zapped.health;
  zapped.effects.apply('instant_damage', 1, 0);
  advance(zapped, ctx, 0.1);
  equal('瞬间伤害 I 打 6 点（原版）', zapped.health, before - 6);

  const zapped2 = new Mob(mobTypeById('zombie')!, 0.5, 1, 0.5);
  const before2 = zapped2.health;
  zapped2.effects.apply('instant_damage', 1, 1);
  advance(zapped2, ctx, 0.1);
  equal('瞬间伤害 II 打 12 点', zapped2.health, before2 - 12);

  // 瞬间治疗：回到上限就不再回
  const healed = new Mob(mobTypeById('zombie')!, 0.5, 1, 0.5);
  healed.health = 5;
  healed.effects.apply('instant_health', 1, 0);
  advance(healed, ctx, 0.1);
  equal('瞬间治疗 I 回 4 点', healed.health, 9);
  healed.health = healed.type.health - 2;
  healed.effects.apply('instant_health', 1, 1);
  advance(healed, ctx, 0.1);
  equal('回血不会超过生命上限', healed.health, healed.type.health);

  // 生命恢复（持续回血）
  const regen = new Mob(mobTypeById('zombie')!, 0.5, 1, 0.5);
  regen.health = 4;
  regen.effects.apply('regeneration', 10, 0);
  advance(regen, ctx, 4);
  check('生命恢复会持续回血', regen.health > 4, `health=${regen.health}`);
}

console.log('\n[雪球的推挤]');
{
  const target = new Mob(mobTypeById('zombie')!, 0.5, 1, 0.5);
  const health = target.health;
  target.push(1, 0);
  equal('推挤不改血量', target.health, health);
  check('推挤给了水平速度', target.vx > 0, `vx=${target.vx}`);
  check('推挤把人抬起来一点（原版击退也有个上抛）', target.vy > 0, `vy=${target.vy}`);
  target.vx = 0;
  target.vz = 0;
  target.push(0, 0);
  equal('方向为零时什么都不做', target.vx, 0);
}

// ---------------------------------------------------------------- 5. 鸡下蛋

console.log('\n[鸡下蛋：鸡蛋的生存来源]');
{
  const world = makeWorld();
  const laid: number[] = [];
  const ctx = makeCtx(world, {
    spawnDrop: (itemId) => laid.push(itemId),
  });

  check('下蛋间隔是原版的 5~10 分钟', EGG_LAY_INTERVAL_MIN === 300 && EGG_LAY_INTERVAL_MAX === 600);

  const hen = new Mob(mobTypeById('chicken')!, 0.5, 1, 0.5);
  advance(hen, ctx, EGG_LAY_INTERVAL_MIN - 1, 0.5);
  equal('5 分钟内还没下蛋（不早于原版节奏）', laid.length, 0);

  advance(hen, ctx, EGG_LAY_INTERVAL_MAX - EGG_LAY_INTERVAL_MIN + 1, 0.5);
  check('10 分钟内一定下过一个蛋', laid.length >= 1, `下了 ${laid.length} 个`);
  check('掉出来的确实是鸡蛋', laid.every((id) => id === Item.EGG));

  // 幼体不下蛋
  const chick = new Mob(mobTypeById('chicken')!, 0.5, 1, 0.5);
  chick.makeBaby();
  const chickDrops: number[] = [];
  const chickCtx = makeCtx(world, { spawnDrop: (itemId) => chickDrops.push(itemId) });
  advance(chick, chickCtx, 20, 0.5);
  equal('幼体在 20 秒内不下蛋', chickDrops.length, 0);

  // 不下蛋的生物一个蛋都不该下（表里没标 laysEggs 的）
  const cow = new Mob(mobTypeById('cow')!, 0.5, 1, 0.5);
  const cowDrops: number[] = [];
  const cowCtx = makeCtx(world, { spawnDrop: (itemId) => cowDrops.push(itemId) });
  advance(cow, cowCtx, EGG_LAY_INTERVAL_MAX + 1, 0.5);
  equal('牛不会下蛋', cowDrops.length, 0);
}

// ---------------------------------------------------------------- 6. 与酿造链的接缝

console.log('\n[与酿造链的接缝]');
{
  // 喷溅药水必须能酿出来（上一批的酿造链 + 这一批的投掷物在这里对上）
  const drink = POTIONS.find((potion) => potion.key === 'poison')!;
  equal('剧毒药水 + 火药 → 喷溅剧毒药水', brewRecipeFor(Item.GUNPOWDER, drink.id)?.to, splashIdOf(drink.id));
  const splash = potionById(splashIdOf(drink.id));
  check('喷溅版在药水表里', splash !== undefined && splash.splash === true);
  check('喷溅药水的物品已注册（手上有它就说明能扔）', splash !== undefined && itemDef(splash.id) !== undefined);

  // hitMob 的碰撞盒判定：投掷物用的还是 AABB 那一套
  const box = boxAt(2, 1, 0.5, 0.25, 0.25);
  check('碰撞盒函数可用（投掷物命中判定依赖它）', box.maxX > box.minX && box.maxY > box.minY);
}

console.log(`\n投掷物测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
