/**
 * 可投掷实体与喷溅药水离线测试（K4 尾巴）
 *
 * 覆盖五块：
 *  1. **物品与来源**：雪球/鸡蛋的注册、名字、贴图；雪块掉 4 雪球、4 雪球合成 1 块雪块；
 *     鸡会下蛋（鸡蛋的唯一来源）——"表里有、游戏里拿不到"是这一批最容易翻的车
 *  2. **投掷物实体**：重力、超时消失、撞方块/命中生物后的分流
 *     （雪球只推不伤、鸡蛋 1/8 孵小鸡、喷溅药水把爆心位置报给主程序）
 *  3. **喷溅范围**（纯函数）：半径 4、时长按 `1 - 距离/4` 缩、瞬间效果不缩、半径外完全没有
 *  4. **生物侧的状态效果**：缓慢/速度改移速、中毒不致死、凋零致死、瞬间治疗/伤害立即结算
 *  5. **鸡下蛋的节奏**：5~10 分钟内一定下过一个蛋；幼体不下蛋
 *
 * 运行：npm run test:throwable
 */

import { Block } from '../src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, dropFor, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { brewRecipeFor } from '../src/core/crafting/Brewing.ts';
import { POTIONS, SPLASH_POTIONS, potionById, splashIdOf } from '../src/core/registry/potions.ts';
import { SPLASH_RADIUS, isInstantEffect, splashEffectsAt, splashScale } from '../src/core/survival/SplashPotion.ts';
import {
  EGG_CHICK_CHANCE,
  PLAYER_THROW_SPEED,
  THROWABLE_LIFETIME,
  Throwable,
} from '../src/core/entity/Throwable.ts';
import { Mob, EGG_LAY_INTERVAL_MIN, EGG_LAY_INTERVAL_MAX } from '../src/core/entity/Mob.ts';
import { mobTypeById } from '../src/core/entity/mobs.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
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

equal('雪球有注册名', itemDef(Item.SNOWBALL)?.name, 'minecraft:snowball');
equal('鸡蛋有注册名', itemDef(Item.EGG)?.name, 'minecraft:egg');
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
