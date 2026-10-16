/**
 * 药水箭离线断言（K4 最后一块）
 *
 * 覆盖四块：
 *  1. **物品层**：28 支药水箭的 id / 名字 / 说明 / 贴图，以及"id 与药水全表不撞车"
 *  2. **效果同源与 1/8 折算**：箭上的效果必须就是那瓶药水的效果，时长只有 1/8
 *     （瞬间效果不折算；倍率不降级）——不折算就等于"一支箭顶一瓶药"
 *  3. **配方**：`滞留药水 + 8 支箭 → 8 支`，而且**必须用滞留型**（饮用型/喷溅型配不出来）
 *  4. **弓与箭**：弹药挑选（纯函数：按槽位顺序、普通箭与药水箭都算）、
 *     命中药水箭挂效果、捡回来是原来那支（不能降级成普通箭）
 *
 * 运行：npm run test:tipped
 */

import { Block } from '../src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, categoryOf, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import {
  DRINKABLE,
  POTION_IDS,
  POTIONS,
  TIPPED_ARROWS,
  TIPPED_ARROW_ID_OFFSET,
  lingeringIdOf,
  potionById,
  splashIdOf,
  tippedArrowById,
  tippedArrowIdOf,
  tippedArrowOfPotion,
} from '../src/core/registry/potions.ts';
import { TIPPED_ARROW_SCALE, tippedArrowEffects } from '../src/core/survival/TippedArrow.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { arrowAmmoTotal, isArrowItem, pickArrowAmmo } from '../src/core/entity/ArrowAmmo.ts';
import { Arrow } from '../src/core/entity/Arrow.ts';
import { Mob } from '../src/core/entity/Mob.ts';
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

// ---------------------------------------------------------------- 1. 物品层

console.log('\n[药水箭：物品层]');
{
  equal('一共 28 支（每种饮用型各一支）', TIPPED_ARROWS.length, DRINKABLE.length);
  equal('时长折算是原版的 1/8', TIPPED_ARROW_SCALE, 1 / 8);
  equal('id 偏移是 +200', TIPPED_ARROW_ID_OFFSET, 200);

  const potionIds = new Set(POTIONS.map((potion) => potion.id));
  const drinkIds = new Set(DRINKABLE.map((potion) => potion.id));
  let collisions = 0;
  for (const arrow of TIPPED_ARROWS) {
    if (potionIds.has(arrow.id) || drinkIds.has(arrow.id)) collisions++;
    if (arrow.id !== tippedArrowIdOf(arrow.potionId)) collisions++;
  }
  equal('28 支的 id 都等于对应饮用型 + 200，且与药水全表不撞车', collisions, 0);
  check('喷溅 / 滞留 / 药水箭 三段互不重叠', splashIdOf(POTION_IDS.awkward) !== lingeringIdOf(POTION_IDS.awkward) && lingeringIdOf(POTION_IDS.awkward) !== tippedArrowIdOf(POTION_IDS.awkward));

  check('每支都注册成了物品', TIPPED_ARROWS.every((arrow) => itemDef(arrow.id) !== undefined));
  check('每支都能在创造物品栏里拿到', TIPPED_ARROWS.every((arrow) => CREATIVE_ITEMS.includes(arrow.id)));
  equal('可堆 64', maxStackOf(TIPPED_ARROWS[0]!.id), 64);
  check('贴图名唯一且在图集名单里', new Set(TIPPED_ARROWS.map((arrow) => itemDef(arrow.id)!.tile)).size === TIPPED_ARROWS.length && TIPPED_ARROWS.every((arrow) => TILES.has(itemDef(arrow.id)!.tile)));
  check('中文名唯一', new Set(TIPPED_ARROWS.map((arrow) => itemLabel(arrow.id))).size === TIPPED_ARROWS.length);
  check('每支都有说明', TIPPED_ARROWS.every((arrow) => hasDescription(arrow.id)));
  equal('箭算"工具与武器"（与普通箭同一分类）', categoryOf(Item.ARROW), 'tools');
  equal('药水箭也是同一个分类', categoryOf(TIPPED_ARROWS[0]!.id), 'tools');

  // 名字：档位后缀与药水名同源（`romanLevel` 吃 amplifier：缓慢强化档是 IV 而不是 III）
  equal('普通档：药水箭（迅捷）', itemLabel(tippedArrowIdOf(POTION_IDS.swiftness)), '药水箭（迅捷）');
  equal('延长档：药水箭（迅捷 · 延长）', itemLabel(tippedArrowIdOf(POTION_IDS.swiftness_long)), '药水箭（迅捷 · 延长）');
  equal('强化档：药水箭（力量 · II）', itemLabel(tippedArrowIdOf(POTION_IDS.strength_strong)), '药水箭（力量 · II）');
  equal('缓慢的强化档是 IV 级', itemLabel(tippedArrowIdOf(POTION_IDS.slowness_strong)), '药水箭（缓慢 · IV）');
  equal('粗制的滞留药水也有一支（原版允许，虽然没用）', itemLabel(tippedArrowIdOf(POTION_IDS.awkward)), '药水箭（粗制）');
  check('说明里写了 1/8 时长', itemDescription(tippedArrowIdOf(POTION_IDS.swiftness)).includes('1/8'), itemDescription(tippedArrowIdOf(POTION_IDS.swiftness)));
  check('说明里的时长是折算后的（迅捷 22 秒而不是 3 分钟）', itemDescription(tippedArrowIdOf(POTION_IDS.swiftness)).includes('22'), itemDescription(tippedArrowIdOf(POTION_IDS.swiftness)));
  check('瞬间效果的说明写"立刻生效"', itemDescription(tippedArrowIdOf(POTION_IDS.harming)).includes('立刻生效'));

  // 反查
  equal('tippedArrowOfPotion 能反查', tippedArrowOfPotion(POTION_IDS.poison)?.id, tippedArrowIdOf(POTION_IDS.poison));
  equal('按 id 反查', tippedArrowById(tippedArrowIdOf(POTION_IDS.poison))?.potionId, POTION_IDS.poison);
  equal('普通箭不是药水箭', tippedArrowById(Item.ARROW), undefined);
}

// ---------------------------------------------------------------- 2. 效果与折算

console.log('\n[药水箭：效果同源与 1/8 折算]');
{
  let mismatch = 0;
  for (const arrow of TIPPED_ARROWS) {
    const potion = potionById(arrow.potionId)!;
    if (JSON.stringify(arrow.effects) !== JSON.stringify(potion.effects)) mismatch++;
  }
  equal('28 支箭的效果表与对应药水逐字段一致', mismatch, 0);

  const swift = tippedArrowEffects(potionById(POTION_IDS.swiftness)!);
  equal('迅捷挂的还是迅捷', swift[0]?.id, 'speed');
  close('迅捷 3 分钟 → 22.5 秒', swift[0]!.seconds, 22.5);
  equal('倍率不降级（迅捷 I 还是 I）', swift[0]!.amplifier, 0);

  const slownessStrong = tippedArrowEffects(potionById(POTION_IDS.slowness_strong)!);
  close('缓慢 IV 的 20 秒 → 2.5 秒', slownessStrong[0]!.seconds, 2.5);
  equal('强化档的倍率保留（IV = amplifier 3）', slownessStrong[0]!.amplifier, 3);

  const long = tippedArrowEffects(potionById(POTION_IDS.regeneration_long)!);
  close('生命恢复延长档 90 秒 → 11.25 秒', long[0]!.seconds, 11.25);

  const harming = tippedArrowEffects(potionById(POTION_IDS.harming_strong)!);
  equal('瞬间伤害不折算时长（折算了也还是立刻生效）', harming[0]!.seconds, 1);
  equal('瞬间伤害的倍率保留（II = amplifier 1）', harming[0]!.amplifier, 1);

  const awkward = tippedArrowEffects(potionById(POTION_IDS.awkward)!);
  equal('粗制药水箭什么都不挂', awkward.length, 0);
}

// ---------------------------------------------------------------- 3. 配方

console.log('\n[药水箭：配方]');
{
  const arrows8 = Array<number>(8).fill(Item.ARROW);

  const brewed = matchRecipe([lingeringIdOf(POTION_IDS.poison), ...arrows8], 3);
  equal('滞留剧毒药水 + 8 支箭 → 药水箭（剧毒）', brewed?.id, tippedArrowIdOf(POTION_IDS.poison));
  equal('一次出 8 支', brewed?.count, 8);
  equal('用普通箭 + 8 支箭当然不行', matchRecipe(arrows8, 3)?.id, undefined);
  equal('用**饮用型**药水配不出来（原版要求滞留型）', matchRecipe([POTION_IDS.poison, ...arrows8], 3), null);
  equal('用**喷溅型**也配不出来', matchRecipe([splashIdOf(POTION_IDS.poison), ...arrows8], 3), null);
  equal(
    '7 支箭也不行（数量必须正好 8）',
    matchRecipe([lingeringIdOf(POTION_IDS.poison), ...Array<number>(7).fill(Item.ARROW)], 3),
    null,
  );

  // 28 条都要在（漏一条只会表现成"某种药水箭合不出来"，不报错）
  let craftable = 0;
  for (const potion of DRINKABLE) {
    const result = matchRecipe([lingeringIdOf(potion.id), ...arrows8], 3);
    if (result?.id === tippedArrowIdOf(potion.id) && result.count === 8) craftable++;
  }
  equal('28 种药水箭全部能合出来', craftable, DRINKABLE.length);

  // 药水箭不再是任何配方的原料（与原版一致：箭是消耗品）
  check('药水箭本身不是原料', TIPPED_ARROWS.every((arrow) => matchRecipe([arrow.id, arrow.id, arrow.id, arrow.id], 2) === null));
  check('粗制的滞留药水也能合（得到一支没用的箭）', matchRecipe([lingeringIdOf(POTION_IDS.awkward), ...arrows8], 3)?.id === tippedArrowIdOf(POTION_IDS.awkward));
  check('与雪球那条无序配方不冲突（4 个雪球仍是雪块）', matchRecipe([Item.SNOWBALL, Item.SNOWBALL, Item.SNOWBALL, Item.SNOWBALL], 2)?.id === Block.SNOW_BLOCK);
}

// ---------------------------------------------------------------- 4. 弓与箭

console.log('\n[弓与箭：弹药挑选（纯函数）]');
{
  const normal = { id: Item.ARROW, count: 32 };
  const tipped = { id: tippedArrowIdOf(POTION_IDS.poison), count: 4 };

  equal('空背包没有弹药', pickArrowAmmo([]), null);
  equal('背包里只有石头 → 没有弹药', pickArrowAmmo([{ id: Block.STONE, count: 64 }]), null);
  check('石头不是箭', !isArrowItem(Block.STONE));
  check('普通箭是箭', isArrowItem(Item.ARROW));
  check('药水箭也是箭', isArrowItem(tipped.id));

  const onlyNormal = pickArrowAmmo([null, normal, null]);
  equal('只有普通箭时射普通箭', onlyNormal?.itemId, Item.ARROW);
  equal('普通箭不带药水', onlyNormal?.potionId, undefined);
  equal('总数算对', onlyNormal?.total, 32);

  const onlyTipped = pickArrowAmmo([tipped]);
  equal('只有药水箭时射药水箭', onlyTipped?.itemId, tipped.id);
  equal('药水箭带上它那瓶药水', onlyTipped?.potionId, POTION_IDS.poison);
  equal('总数算对', onlyTipped?.total, 4);

  // 槽位顺序：快捷栏（0~8）在前，所以摆在前面的一堆先被射出去
  const mixed = pickArrowAmmo([normal, tipped]);
  equal('普通箭在前就先射普通箭', mixed?.itemId, Item.ARROW);
  equal('但总数把两种都算上（"没有箭了"不能误报）', mixed?.total, 36);
  const tippedFirst = pickArrowAmmo([tipped, normal]);
  equal('药水箭在前就先射药水箭', tippedFirst?.itemId, tipped.id);
  equal('总数一样', arrowAmmoTotal([tipped, normal]), 36);

  equal('空堆叠不算数', pickArrowAmmo([{ id: Item.ARROW, count: 0 }]), null);
}

console.log('\n[弓与箭：命中挂效果、捡回来还是那支]');
{
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

  const zombieType = mobTypeById('zombie')!;

  // ---- 药水箭命中生物：挂上 1/8 时长的效果
  const zombie = new Mob(zombieType, 2, 1, 0.5);
  const arrow = new Arrow(1.5, 1.4, 0.5, { x: 10, y: 0, z: 0 }, {
    fromPlayer: true,
    damage: 6,
    itemId: tippedArrowIdOf(POTION_IDS.poison),
    potionId: POTION_IDS.poison,
  });
  equal('箭知道自己带的是哪瓶药水', arrow.potionId, POTION_IDS.poison);
  equal('箭知道自己捡回来是什么', arrow.itemId, tippedArrowIdOf(POTION_IDS.poison));

  arrow.tick(makeCtx({ hitMob: () => zombie }), 0.02);
  check('命中后箭消失', arrow.dead);
  check('目标挂上了中毒', zombie.effects.has('poison'));
  const poisonEffect = zombie.effects.all.find((effect) => effect.id === 'poison');
  close('中毒时长是 1/8（45 秒 → 5.625 秒）', (poisonEffect?.ticks ?? 0) / 20, 45 * TIPPED_ARROW_SCALE, 0.05);

  // ---- 普通箭不挂效果
  const plainTarget = new Mob(zombieType, 2, 1, 0.5);
  const plain = new Arrow(1.5, 1.4, 0.5, { x: 10, y: 0, z: 0 }, { fromPlayer: true, damage: 6 });
  equal('普通箭不带药水', plain.potionId, undefined);
  equal('普通箭捡回来是普通箭', plain.itemId, Item.ARROW);
  plain.tick(makeCtx({ hitMob: () => plainTarget }), 0.02);
  equal('普通箭命中不挂效果', plainTarget.effects.count, 0);

  // ---- 插住之后拾取：返回的是**这一支**
  const picked: number[] = [];
  // 朝墙射（与 `test:throwable` 同一个搭法：x ≥ 4 处有一堵墙）→ 插住 → 玩家走过去捡。
  // 注意先不给 `playerBox`：一射出去就被"捡走"的话就测不到"插住之后"这条路径了
  const flyCtx = makeCtx({ pickup: () => 0 });
  const stuckTipped = new Arrow(0.5, 1, 0.5, { x: 30, y: 0, z: 0 }, {
    fromPlayer: true,
    damage: 6,
    itemId: tippedArrowIdOf(POTION_IDS.swiftness),
    potionId: POTION_IDS.swiftness,
  });
  for (let t = 0; t < 1 && !stuckTipped.stuck; t += 0.02) stuckTipped.tick(flyCtx, 0.02);
  check('先插在墙上', stuckTipped.stuck);

  // 玩家走到箭的位置（碰撞盒跟着箭走），并且过了 0.5 秒的拾取冷却
  const walkOverCtx = makeCtx({
    playerBox: boxAt(stuckTipped.x, stuckTipped.y, stuckTipped.z, 0.6, 1.8),
    pickup: (itemId) => {
      picked.push(itemId);
      return 0;
    },
  });
  for (let t = 0; t < 1; t += 0.02) stuckTipped.tick(walkOverCtx, 0.02);
  equal('捡回来的是那支药水箭（不是普通箭）', picked[0], tippedArrowIdOf(POTION_IDS.swiftness));

  const pickedPlain: number[] = [];
  const stuckPlain = new Arrow(0.5, 1, 0.5, { x: 30, y: 0, z: 0 }, { fromPlayer: true, damage: 6 });
  for (let t = 0; t < 1 && !stuckPlain.stuck; t += 0.02) stuckPlain.tick(flyCtx, 0.02);
  const plainWalkCtx = makeCtx({
    playerBox: boxAt(stuckPlain.x, stuckPlain.y, stuckPlain.z, 0.6, 1.8),
    pickup: (itemId) => {
      pickedPlain.push(itemId);
      return 0;
    },
  });
  for (let t = 0; t < 1; t += 0.02) stuckPlain.tick(plainWalkCtx, 0.02);
  equal('普通箭捡回来还是普通箭', pickedPlain[0], Item.ARROW);
}

console.log(`\n药水箭测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
