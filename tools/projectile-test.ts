/**
 * 弹射物与弓离线测试（J9）
 *
 * 覆盖：
 *  1. 物品数据层：弓/箭/燧石/线的注册、耐久、贴图、名字
 *  2. 燧石的来源（砂砾 10% 的"概率替换"掉落）
 *  3. 配方：箭 4 支、弓（镜像）、羊毛拆线
 *  4. 弓参与附魔与铁砧的方式（附魔类别 bow、用木板修）
 *
 * 运行：npm run test:projectile
 */

import { Block } from '../web/src/core/registry/blocks.ts';
import { Item, itemDef, maxStackOf, replaceDropFor, durabilityOf, SPECIAL_ITEMS } from '../web/src/core/registry/items.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import { itemLabel, itemTooltip } from '../web/src/core/registry/itemNames.ts';
import { RECIPES, matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { enchantKindOf, offeringFor } from '../web/src/core/crafting/Enchanting.ts';
import { maxDurabilityOf, repairMaterialOf } from '../web/src/core/crafting/Anvil.ts';
import { Arrow, ARROW_GRAVITY, ARROW_LIFETIME } from '../web/src/core/entity/Arrow.ts';
import { TRAJECTORY_STEPS, simulateArrowPath } from '../web/src/core/entity/ArrowPath.ts';
import {
  ARROW_MAX_DAMAGE,
  ARROW_MAX_SPEED,
  BOW_FULL_CHARGE,
  BOW_MIN_CHARGE,
  FLAME_SECONDS,
  arrowDamageAt,
  arrowSpeedAt,
  arrowsConsumed,
  bowEffects,
  canFire,
  canShoot,
  chargeAfter,
  knockbackStrength,
} from '../web/src/core/entity/Bow.ts';
import type { EntityContext } from '../web/src/core/entity/Entity.ts';
import type { Mob } from '../web/src/core/entity/Mob.ts';
import type { PhysicsWorld } from '../web/src/core/physics/PlayerPhysics.ts';
import { boxAt } from '../web/src/core/physics/AABB.ts';

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

const TILES: readonly string[] = TILE_ORDER;

// ---------------------------------------------------------------- 1. 物品数据层

console.log('\n[弓与箭的物品]');
equal('弓有注册名', itemDef(Item.BOW)?.name, 'minicraft:bow');
equal('箭有注册名', itemDef(Item.ARROW)?.name, 'minicraft:arrow');
equal('燧石有注册名', itemDef(Item.FLINT)?.name, 'minicraft:flint');
equal('线有注册名', itemDef(Item.STRING)?.name, 'minicraft:string');

equal('弓每件一叠（它是耐用品）', maxStackOf(Item.BOW), 1);
equal('箭可以堆 64 支', maxStackOf(Item.ARROW), 64);
equal('燧石可以堆 64 个', maxStackOf(Item.FLINT), 64);
equal('线可以堆 64 根', maxStackOf(Item.STRING), 64);

equal('弓的耐久是原版的 384', durabilityOf(Item.BOW), 384);
equal('铁砧那边读到的弓耐久一致', maxDurabilityOf(Item.BOW), 384);
equal('箭没有耐久（不是耐用品）', durabilityOf(Item.ARROW), 0);
equal('钻石镐的耐久仍然走工具表', durabilityOf(1000) >= 0, true);

check(
  '四件新物品的图标都在图集名单里',
  [Item.BOW, Item.ARROW, Item.FLINT, Item.STRING].every((id) => TILES.includes(itemDef(id)!.tile)),
  [Item.BOW, Item.ARROW, Item.FLINT, Item.STRING].map((id) => itemDef(id)!.tile).join(' '),
);

console.log('\n[中文名与说明]');
equal('弓叫"弓"', itemLabel(Item.BOW), '弓');
equal('箭叫"箭"', itemLabel(Item.ARROW), '箭');
equal('燧石叫"燧石"', itemLabel(Item.FLINT), '燧石');
equal('线叫"线"', itemLabel(Item.STRING), '线');
check('弓的说明提到蓄力与耐久', itemTooltip(Item.BOW).description.includes('蓄力'), itemTooltip(Item.BOW).description);
check('箭的说明写明配方数量', itemTooltip(Item.ARROW).description.includes('4 支'), itemTooltip(Item.ARROW).description);

// ---------------------------------------------------------------- 2. 燧石的来源

console.log('\n[砂砾 10% 掉燧石（概率替换）]');
{
  equal('掷点 0.05（<10%）时变成燧石', replaceDropFor(Block.GRAVEL, 0.05)?.id, Item.FLINT);
  equal('掷点 0 也是燧石', replaceDropFor(Block.GRAVEL, 0)?.id, Item.FLINT);
  equal('掷点 0.5 时还是砂砾（没有替换）', replaceDropFor(Block.GRAVEL, 0.5), null);
  equal('刚好 0.1 不算命中（边界是左闭右开）', replaceDropFor(Block.GRAVEL, 0.1), null);
  equal('替换掉的是 1 个', replaceDropFor(Block.GRAVEL, 0.01)?.count, 1);
  equal('石头不会被替换成别的东西', replaceDropFor(Block.STONE, 0.01), null);
  equal('沙子也不会', replaceDropFor(Block.SAND, 0.01), null);
}

// ---------------------------------------------------------------- 3. 配方

console.log('\n[配方]');
{
  const grid = (size: 3, rows: readonly string[], legend: Record<string, number>): number[] => {
    const cells = new Array<number>(size * size).fill(0);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r]!.length; c++) {
        const ch = rows[r]![c]!;
        if (ch === '·') continue;
        cells[r * size + c] = legend[ch] ?? 0;
      }
    }
    return cells;
  };

  const arrowRecipe = RECIPES.find((recipe) => recipe.result.id === Item.ARROW);
  check('有箭的配方', arrowRecipe !== undefined);
  equal('一次出 4 支', arrowRecipe?.result.count, 4);
  check('箭的配方是无序的（燧石/木棍/羽毛随便摆）', arrowRecipe?.kind === 'shapeless');

  const bowRecipe = RECIPES.find((recipe) => recipe.result.id === Item.BOW);
  check('有弓的配方', bowRecipe !== undefined);
  equal('弓一次出 1 把', bowRecipe?.result.count, 1);

  equal(
    '弓：3 木棍 + 3 线（原版图案）',
    matchRecipe(grid(3, ['·ST', 'S·T', '·ST'], { S: Item.STRING, T: Item.STICK }), 3)?.id,
    Item.BOW,
  );
  equal(
    '弓：镜像摆法也能合成',
    matchRecipe(grid(3, ['TS·', 'T·S', 'TS·'], { S: Item.STRING, T: Item.STICK }), 3)?.id,
    Item.BOW,
  );

  const stringRecipe = RECIPES.find((recipe) => recipe.result.id === Item.STRING);
  check('有羊毛拆线的配方（替代还没做的蜘蛛）', stringRecipe !== undefined);
  equal('1 个羊毛拆 4 根线', stringRecipe?.result.count, 4);
}

// ---------------------------------------------------------------- 4. 弓的附魔与修复

console.log('\n[弓参与附魔与铁砧]');
{
  equal('弓的附魔类别是 bow', enchantKindOf(Item.BOW), 'bow');
  equal('箭不能附魔', enchantKindOf(Item.ARROW), null);
  const bowEnchants = offeringFor('bow').map((def) => def.id);
  check('弓能附到力量', bowEnchants.includes('power'));
  check('弓能附到冲击', bowEnchants.includes('punch'));
  check('弓能附到火矢', bowEnchants.includes('flame'));
  check('弓能附到无限', bowEnchants.includes('infinity'));
  check('弓能附到耐久（全装备通用）', bowEnchants.includes('unbreaking'));
  check('弓附不到效率这种工具附魔', !bowEnchants.includes('efficiency'));

  equal('弓用木板修', repairMaterialOf(Item.BOW), Block.OAK_PLANKS);
  equal('弓在特殊物品表里登记了', SPECIAL_ITEMS[Item.BOW]?.kind, 'bow');
}

// ---------------------------------------------------------------- 5. 箭矢实体

console.log('\n[箭矢：重力与插住]');
{
  // 地面在 y<0；x>=4 处有一堵墙（与 entity-test 用的是同一个搭法）
  const world = {
    collisionAt: (x: number, y: number) => (y < 0 || x >= 4 ? 'full' : null),
    isLiquid: () => false,
  } as unknown as PhysicsWorld;

  const makeCtx = (overrides: Partial<EntityContext> = {}): EntityContext =>
    ({
      world,
      playerBox: null,
      pickup: () => 0,
      getBlock: () => Block.AIR,
      player: { x: 0, y: 0, z: 0 },
      hurtPlayer: () => {},
      spawnDrop: () => {},
      ...overrides,
    }) as EntityContext;

  const advance = (arrow: Arrow, ctx: EntityContext, seconds: number, step = 0.02): void => {
    for (let t = 0; t < seconds; t += step) arrow.tick(ctx, step);
  };

  // ---- 重力
  const falling = new Arrow(0.5, 6, 0.5, { x: 0, y: 0, z: 0 }, { fromPlayer: true, damage: 6 });
  advance(falling, makeCtx(), 0.5);
  check('自由飞行的箭会下坠（受重力）', falling.vy < 0 && falling.y < 6, `vy=${falling.vy.toFixed(2)}`);
  equal('下坠的箭水平速度不变（没有凭空减速）', falling.vx, 0);

  // ---- 撞墙插住
  const intoWall = new Arrow(0.5, 2, 0.5, { x: 30, y: 0, z: 0 }, { fromPlayer: true, damage: 6 });
  advance(intoWall, makeCtx(), 1.5);
  check('撞到墙就插住', intoWall.stuck, `x=${intoWall.x.toFixed(2)}`);
  check('插住后停在墙前（没有穿过去）', intoWall.x < 4, `x=${intoWall.x.toFixed(2)}`);
  equal('插住后速度清零', intoWall.vx + intoWall.vy + intoWall.vz, 0);
  const stuckX = intoWall.x;
  advance(intoWall, makeCtx(), 1);
  equal('插住后不再移动（也不会继续下坠）', intoWall.x, stuckX);

  // ---- 命中朝向
  check('记录了飞行方向（渲染用）', Math.abs(intoWall.dirX - 1) < 0.2, `dirX=${intoWall.dirX}`);

  // ---- 超时消失
  const old = new Arrow(0.5, 30, 0.5, { x: 0, y: 0, z: 0 }, { fromPlayer: true, damage: 6 });
  advance(old, makeCtx(), ARROW_LIFETIME - 1);
  check('60 秒内还活着', !old.dead);
  advance(old, makeCtx(), 2);
  check('超过 60 秒自然消失', old.dead);
}

console.log('\n[箭矢：捡回来]');
{
  const world = { collisionAt: () => 'full', isLiquid: () => false } as unknown as PhysicsWorld;
  let picked = 0;
  const ctx = {
    world,
    playerBox: boxAt(0.5, 0, 0.5, 0.6, 1.8),
    pickup: (id: number) => {
      if (id === Item.ARROW) picked += 1;
      return 0;
    },
    getBlock: () => Block.AIR,
    player: { x: 0.5, y: 0, z: 0.5 },
    hurtPlayer: () => {},
    spawnDrop: () => {},
  } as unknown as EntityContext;

  const arrow = new Arrow(0.5, 2, 0.5, { x: 0, y: 0, z: 0 }, { fromPlayer: true, damage: 6 });
  arrow.tick(ctx, 0.02);
  check('刚插住时还捡不起来（0.5 秒冷却）', picked === 0);
  for (let t = 0; t < 1; t += 0.02) arrow.tick(ctx, 0.02);
  equal('冷却过后玩家靠近就捡起来（1 支箭）', picked, 1);
  check('捡起来之后这支箭消失', arrow.dead);

  // 无限附魔射出的箭不可拾取
  let infinitePicked = 0;
  const infiniteCtx = {
    ...ctx,
    pickup: () => {
      infinitePicked += 1;
      return 0;
    },
  } as unknown as EntityContext;
  const infiniteArrow = new Arrow(0.5, 2, 0.5, { x: 0, y: 0, z: 0 }, {
    fromPlayer: true,
    damage: 6,
    pickable: false,
  });
  for (let t = 0; t < 2; t += 0.02) infiniteArrow.tick(infiniteCtx, 0.02);
  equal('无限附魔的箭捡不回来（否则等于无限刷箭）', infinitePicked, 0);
  check('但它仍然插在地上', infiniteArrow.stuck);
}

console.log('\n[箭矢：打玩家（骷髅的箭）]');
{
  const world = { collisionAt: () => null, isLiquid: () => false } as unknown as PhysicsWorld;
  let hurt = 0;
  let cause = '';
  const ctx = {
    world,
    playerBox: boxAt(0.5, 1, 0.5, 0.6, 1.8),
    pickup: () => 0,
    getBlock: () => Block.AIR,
    player: { x: 0.5, y: 1, z: 0.5 },
    hurtPlayer: (_amount: number, _sx: number, _sz: number, c?: string) => {
      hurt += 1;
      cause = c ?? 'generic';
    },
    spawnDrop: () => {},
  } as unknown as EntityContext;

  // 骷髅的箭：从玩家上方斜着射下来
  const mobArrow = new Arrow(0.5, 6, 0.5, { x: 0, y: -20, z: 0 }, { fromPlayer: false, damage: 4 });
  for (let t = 0; t < 1 && !mobArrow.dead; t += 0.02) mobArrow.tick(ctx, 0.02);
  equal('骷髅的箭打中玩家', hurt, 1);
  equal('伤害类型是 projectile（弹射物保护靠它生效）', cause, 'projectile');
  check('命中后箭消失', mobArrow.dead);

  // 玩家自己的箭不该打玩家
  let selfHurt = 0;
  const selfCtx = {
    ...ctx,
    hurtPlayer: () => {
      selfHurt += 1;
    },
  } as unknown as EntityContext;
  const ownArrow = new Arrow(0.5, 6, 0.5, { x: 0, y: -20, z: 0 }, { fromPlayer: true, damage: 6 });
  for (let t = 0; t < 1 && !ownArrow.dead; t += 0.02) ownArrow.tick(selfCtx, 0.02);
  equal('玩家自己的箭不会打到自己', selfHurt, 0);
}

console.log('\n[箭矢：命中生物]');
{
  const world = { collisionAt: () => null, isLiquid: () => false } as unknown as PhysicsWorld;

  /** 记下被打了几次、掉了多少血、有没有被点燃的桩生物 */
  const makeMob = (): { id: number; hits: number; damage: number; knockback: [number, number]; fire: number; hurt: Function; ignite: (s: number) => void } => {
    const mob = {
      id: 9001,
      hits: 0,
      damage: 0,
      knockback: [0, 0] as [number, number],
      fire: 0,
      hurt(amount: number, kx: number, kz: number) {
        mob.hits += 1;
        mob.damage += amount;
        mob.knockback = [kx, kz];
        return true;
      },
      ignite(seconds: number) {
        mob.fire = Math.max(mob.fire, seconds);
      },
    };
    return mob;
  };

  const mob = makeMob();
  const ctx = {
    world,
    playerBox: null,
    pickup: () => 0,
    getBlock: () => Block.AIR,
    player: { x: 20, y: 0, z: 20 },
    hurtPlayer: () => {},
    spawnDrop: () => {},
    hitMob: () => mob as unknown as Mob,
  } as unknown as EntityContext;

  const arrow = new Arrow(0.5, 2, 0.5, { x: 40, y: 0, z: 0 }, { fromPlayer: true, damage: 6, knockback: 2, fireSeconds: 5 });
  for (let t = 0; t < 0.5 && !arrow.dead; t += 0.02) arrow.tick(ctx, 0.02);
  equal('命中生物一次（子步不会重复打）', mob.hits, 1);
  equal('造成的是算好的伤害', mob.damage, 6);
  check('击退方向沿飞行方向（x 为正）', mob.knockback[0] > 0, String(mob.knockback));
  equal('火矢点燃 5 秒', mob.fire, 5);
  check('命中后箭消失', arrow.dead);

  // 没打到生物时箭继续飞
  const emptyCtx = { ...ctx, hitMob: () => null } as unknown as EntityContext;
  const free = new Arrow(0.5, 2, 0.5, { x: 40, y: 0, z: 0 }, { fromPlayer: true, damage: 6 });
  for (let t = 0; t < 0.1; t += 0.02) free.tick(emptyCtx, 0.02);
  check('没命中生物时箭继续飞', !free.dead && free.x > 1, `x=${free.x.toFixed(2)}`);
}

// ---------------------------------------------------------------- 6. 蓄力与射击数值

console.log('\n[蓄力]');
{
  equal('拉满需要 1 秒', BOW_FULL_CHARGE, 1);
  equal('低于 15% 射不出去（原版阈值）', BOW_MIN_CHARGE, 0.15);

  equal('按住 0.25 秒 = 蓄力 0.25', chargeAfter(0, 0.25), 0.25);
  equal('按住 1 秒 = 拉满', chargeAfter(0, 1), 1);
  equal('按住 2 秒还是 1（不会超过满）', chargeAfter(0, 2), 1);
  equal('从 0.8 再按 0.5 秒 → 夹到 1', chargeAfter(0.8, 0.5), 1);
  equal('dt 为 0 时不变', chargeAfter(0.4, 0), 0.4);

  check('14% 蓄力射不出去', !canFire(0.14));
  check('15% 蓄力刚好能射', canFire(0.15));
  check('拉满当然能射', canFire(1));
}

console.log('\n[箭速与伤害随蓄力]');
{
  equal('满蓄力箭速 60 格/秒（原版 3 格/tick）', ARROW_MAX_SPEED, 60);
  equal('半蓄力箭速 30', arrowSpeedAt(0.5), 30);
  equal('零蓄力箭速 0', arrowSpeedAt(0), 0);
  equal('蓄力超过 1 也按 1 算', arrowSpeedAt(1.5), 60);

  equal('满蓄力基础伤害 6（原版）', ARROW_MAX_DAMAGE, 6);
  equal('满蓄力、无附魔 = 6', arrowDamageAt(1), 6);
  equal('半蓄力 = 3', arrowDamageAt(0.5), 3);
  equal('三成蓄力 = 1.8', Number(arrowDamageAt(0.3).toFixed(2)), 1.8);
}

console.log('\n[弓的附魔]');
{
  equal('力量 I：满蓄力 9 点（×1.5）', arrowDamageAt(1, 1), 9);
  equal('力量 II：满蓄力 10.5 点（×1.75）', arrowDamageAt(1, 2), 10.5);
  equal('力量 V：满蓄力 15 点（×2.5，原版数值）', arrowDamageAt(1, 5), 15);
  equal('力量对半蓄力也按比例', arrowDamageAt(0.5, 1), 4.5);

  equal('没有冲击时击退 1', knockbackStrength(0), 1);
  equal('冲击 II 击退 3', knockbackStrength(2), 3);

  const plain = bowEffects(undefined);
  equal('没附魔时力量 0', plain.power, 0);
  equal('没附魔时没有无限', plain.infinity, 0);
  const loaded = bowEffects({ power: 3, punch: 2, flame: 1, infinity: 1, mending: 1 });
  equal('读出力量 3', loaded.power, 3);
  equal('读出冲击 2', loaded.punch, 2);
  equal('读出火矢 1', loaded.flame, 1);
  equal('读出无限 1', loaded.infinity, 1);
  equal('火矢点燃 5 秒（原版）', FLAME_SECONDS, 5);
}

console.log('\n[箭够不够]');
{
  const plain = bowEffects(undefined);
  const infinite = bowEffects({ infinity: 1 });

  equal('普通弓：1 支箭就要消耗 1 支', arrowsConsumed(plain), 1);
  equal('无限弓：不消耗', arrowsConsumed(infinite), 0);

  check('普通弓有 1 支箭 → 能射', canShoot(true, 1, 1, plain));
  check('普通弓没箭 → 不能射', !canShoot(true, 1, 0, plain));
  check('无限弓有 1 支箭 → 能射（留着那一支）', canShoot(true, 1, 1, infinite));
  check('无限弓一支箭都没有 → 也不能射（原版行为，否则空手无限射）', !canShoot(true, 1, 0, infinite));
  check('蓄力不够 → 不能射', !canShoot(true, 0.1, 64, plain));
  check('手上不是弓 → 不能射', !canShoot(false, 1, 64, plain));
}

console.log('\n[弹道预览]');
{
  // 批次 20261031-1108：拉弓时的预测弹道必须与实体用同一套数，否则预览会"骗"玩家。
  equal('预览与箭用同一个重力常量', ARROW_GRAVITY, 20);

  const flat = simulateArrowPath(
    { x: 0, y: 0, z: 0 },
    { x: ARROW_MAX_SPEED, y: 0, z: 0 },
    () => false,
  );
  equal('射程内不撞东西 → 用满步数', flat.points.length, TRAJECTORY_STEPS);
  equal('没有落点', flat.landing, null);
  // 步长 0.02 秒、60 格/秒 → 相邻两点水平相距 1.2 格（点距太密会糊成一条线）
  const gap = Math.hypot(flat.points[1]!.x - flat.points[0]!.x, flat.points[1]!.z - flat.points[0]!.z);
  check('相邻点相距约 1.2 格', Math.abs(gap - 1.2) < 1e-6, gap.toFixed(3));
  // 整秒处的下坠：水平射 1 秒（50 步）后 y = -g·step²·n(n+1)/2 = -10.2 格
  const oneSecond = flat.points[49]!;
  check(
    '平射 1 秒下坠约 10 格（与原版 20 格/秒² 一致）',
    oneSecond.y < -9.9 && oneSecond.y > -10.5,
    oneSecond.y.toFixed(2),
  );
  check('水平方向不减速', Math.abs(oneSecond.x - ARROW_MAX_SPEED) < 1e-6, oneSecond.x.toFixed(2));

  // 撞到就停在**撞点前一格**（不许把点画进方块里）
  const blocked = simulateArrowPath({ x: 0, y: 0, z: 0 }, { x: ARROW_MAX_SPEED, y: 0, z: 0 }, (x) => x >= 10);
  check('撞到方块时有落点', blocked.landing !== null);
  check(
    '落点在撞击前一格（不是穿进方块里）',
    blocked.landing !== null && Math.round(blocked.landing.x * 10) / 10 === 9.6,
    blocked.landing ? blocked.landing.x.toFixed(2) : 'null',
  );
  // 每步 1.2 格：飞到 9.6 格是第 8 个点，下一步 10.8 就撞上了
  check('撞到之后不再往后画点', blocked.points.length === 8, String(blocked.points.length));
}

console.log(`\n弹射物测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
