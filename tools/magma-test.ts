/**
 * 岩浆怪那一族离线测试（批次 121，J15 的下一只）
 *
 * 它基本上是**史莱姆的孪生兄弟**（批次 120 铺好的 `hops` / `splitsInto` / `spawnSpace`
 * 直接复用），所以这一套的重点不是"跳跃怎么写"，而是**三处不同**：
 *
 *  1. **三档数据**：大 16 血/伤害 6、中 4 血/伤害 4、小 1 血/伤害 2（原版三档都凶）；
 *     **三档都掉岩浆膏**（0~1）——史莱姆只有最小那一档掉黏液球；
 *  2. **免疫火焰**（`fireImmune`）：它自己就是岩浆做的，所以**站在岩浆块上也不掉血**
 *     （这一条同时验了"岩浆块烫伤"那条新机制的免疫分支）；
 *  3. **只在下界刷**，而且只有"大"那一档自然刷（中/小从分裂里来）。
 *
 * 另外两条**闭环**断言值得单独看：
 *  - **岩浆膏有来源了**：它一直是**抗火药水**的酿造原料（`VARIANT_INGREDIENTS`），
 *    而在此之前只能从战利品箱里翻到几份；
 *  - **岩浆膏 → 岩浆块 → 站在上面掉血**这条链能走通（配方 + 方块 + 烫伤）。
 *
 * 运行：npm run test:magma
 */

import { Block, blockDef, blockHardness } from '../web/src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, itemDef, maxStackOf } from '../web/src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../web/src/core/registry/itemNames.ts';
import { RECIPES, matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { VARIANT_INGREDIENTS } from '../web/src/core/crafting/Brewing.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import { describeMobModel } from '../web/src/render/MobRenderer.ts';
import {
  HOSTILE_MOBS,
  MAGMA_CUBE_BIG_TYPE,
  MAGMA_CUBE_SMALL_TYPE,
  MAGMA_CUBE_TYPE,
  MOB_TYPES,
  mobTypeById,
} from '../web/src/core/entity/mobs.ts';
import { Mob } from '../web/src/core/entity/Mob.ts';
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

const TILES = new Set<string>(TILE_ORDER);

/** 一片平地（物理与方块查询同源） */
function flatPhysics(): PhysicsWorld {
  return {
    collisionAt: (_x: number, y: number) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  } as unknown as PhysicsWorld;
}

/** 一个"什么都不发生"的上下文：只记下分裂请求 */
function makeCtx(overrides: Record<string, unknown> = {}): {
  ctx: EntityContext;
  spawned: { id: string; x: number; y: number; z: number }[];
} {
  const spawned: { id: string; x: number; y: number; z: number }[] = [];
  const ctx = {
    world: flatPhysics(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (_x: number, y: number) => (y < 0 ? Block.STONE : Block.AIR),
    player: { x: 0.5, y: 0, z: 0.5 },
    hurtPlayer: () => {},
    // ⚠️ 岩浆怪三档**都掉岩浆膏**（史莱姆那两档大/中是不掉的），所以这个假上下文
    // 必须给 `spawnDrop`——第一版没给，跑分裂那一段时直接抛 TypeError
    spawnDrop: () => {},
    spawnMob: (typeId: string, x: number, y: number, z: number) => spawned.push({ id: typeId, x, y, z }),
    ...overrides,
  } as unknown as EntityContext;
  return { ctx, spawned };
}

function run(mob: Mob, ctx: EntityContext, seconds: number, step = 1 / 20): void {
  for (let t = 0; t < seconds; t += step) mob.tick(ctx, step);
}

// ---------------------------------------------------------------- 1. 三档数据

console.log('\n[岩浆怪三档：与史莱姆同一套骨架，三处不同]');
{
  equal('表里有三档岩浆怪', MOB_TYPES.filter((type) => type.id.startsWith('magma_cube')).length, 3);
  check('大那一档在"会自然刷的敌对生物"表里', HOSTILE_MOBS.includes(MAGMA_CUBE_BIG_TYPE));
  check('中那一档不在（它只从分裂里出现）', !HOSTILE_MOBS.includes(MAGMA_CUBE_TYPE));
  check('小那一档也不在', !HOSTILE_MOBS.includes(MAGMA_CUBE_SMALL_TYPE));

  // 三档越分越小、越分越脆——但**最小的那一档照样有伤害**（与史莱姆 0 伤害的对照）
  check(
    '尺寸递减（2.0 → 1.0 → 0.5）',
    MAGMA_CUBE_BIG_TYPE.width > MAGMA_CUBE_TYPE.width && MAGMA_CUBE_TYPE.width > MAGMA_CUBE_SMALL_TYPE.width,
  );
  check(
    '血量递减（16 → 4 → 1）',
    MAGMA_CUBE_BIG_TYPE.health > MAGMA_CUBE_TYPE.health && MAGMA_CUBE_TYPE.health > MAGMA_CUBE_SMALL_TYPE.health,
  );
  check(
    '伤害递减但**都大于 0**（6 → 4 → 2；原版史莱姆最小是 0、岩浆怪最小是 2）',
    MAGMA_CUBE_BIG_TYPE.attackDamage === 6 &&
      MAGMA_CUBE_TYPE.attackDamage === 4 &&
      MAGMA_CUBE_SMALL_TYPE.attackDamage === 2,
    `${MAGMA_CUBE_BIG_TYPE.attackDamage}/${MAGMA_CUBE_TYPE.attackDamage}/${MAGMA_CUBE_SMALL_TYPE.attackDamage}`,
  );
  equal('最小的那一档**也是敌对的**（它会主动扑上来）', MAGMA_CUBE_SMALL_TYPE.hostile, true);

  // 三档都是跳跃式移动 + 免疫火焰
  check(
    '三档都是跳跃式移动（复用批次 120 的 `hops`）',
    [MAGMA_CUBE_BIG_TYPE, MAGMA_CUBE_TYPE, MAGMA_CUBE_SMALL_TYPE].every((type) => type.hops === true),
  );
  check(
    '三档都**免疫火焰**（它自己就是岩浆做的）',
    [MAGMA_CUBE_BIG_TYPE, MAGMA_CUBE_TYPE, MAGMA_CUBE_SMALL_TYPE].every((type) => type.fireImmune === true),
  );

  // 分裂链：大 → 中 → 小，小不再分
  equal('大 → 中', MAGMA_CUBE_BIG_TYPE.splitsInto, MAGMA_CUBE_TYPE.id);
  equal('中 → 小', MAGMA_CUBE_TYPE.splitsInto, MAGMA_CUBE_SMALL_TYPE.id);
  equal('小不再分裂', MAGMA_CUBE_SMALL_TYPE.splitsInto, undefined);
  check('链上每一环都查得到', mobTypeById(MAGMA_CUBE_TYPE.id) !== undefined && mobTypeById(MAGMA_CUBE_SMALL_TYPE.id) !== undefined);

  // 掉落：**三档都掉岩浆膏**（与史莱姆"只有最小那一档掉"正好相反）
  for (const [label, type] of [
    ['大', MAGMA_CUBE_BIG_TYPE],
    ['中', MAGMA_CUBE_TYPE],
    ['小', MAGMA_CUBE_SMALL_TYPE],
  ] as const) {
    equal(`${label}那一档掉 1 种东西`, type.drops.length, 1);
    equal(`${label}那一档掉的是岩浆膏`, type.drops[0]?.itemId, Item.MAGMA_CREAM);
    equal(`${label}那一档数量是 0~1（原版）`, `${type.drops[0]?.min}~${type.drops[0]?.max}`, '0~1');
  }

  // 只在下界刷
  check(
    '只在下界刷（与烈焰人/恶魂同一条）',
    [MAGMA_CUBE_BIG_TYPE, MAGMA_CUBE_TYPE, MAGMA_CUBE_SMALL_TYPE].every((type) => type.dimension === 'nether'),
  );
  equal('大那一档要 2×2 的空间', `${MAGMA_CUBE_BIG_TYPE.spawnSpace?.width}×${MAGMA_CUBE_BIG_TYPE.spawnSpace?.height}`, '2×2');
  check('中/小两档不参与自然生成', MAGMA_CUBE_TYPE.naturalSpawn === false && MAGMA_CUBE_SMALL_TYPE.naturalSpawn === false);
}

// ---------------------------------------------------------------- 2. 模型

console.log('\n[模型：与史莱姆共用同一个骨架]');
{
  for (const [label, type] of [
    ['大', MAGMA_CUBE_BIG_TYPE],
    ['中', MAGMA_CUBE_TYPE],
    ['小', MAGMA_CUBE_SMALL_TYPE],
  ] as const) {
    const model = describeMobModel(type);
    equal(`${label}岩浆怪用 'slime' 骨架（原版它与史莱姆的几何一模一样）`, model.kind, 'slime');
    equal(`${label}岩浆怪没有腿`, model.legs, 0);
    equal(`${label}岩浆怪两个盒子（外壳 + 内核）`, model.parts, 2);
  }
  check(
    '外壳深红、内核亮橙（一眼能分出"这是岩浆怪"）',
    MAGMA_CUBE_BIG_TYPE.bodyColor !== MAGMA_CUBE_BIG_TYPE.accentColor,
  );
}

// ---------------------------------------------------------------- 3. 跳跃式移动

console.log('\n[跳跃式移动：与史莱姆同一套]');
{
  // ⚠️ 玩家要放在追击范围内（16 格），否则它不追、方向随机
  const { ctx } = makeCtx({ player: { x: 8, y: 0, z: 0.5 } });
  const cube = new Mob(MAGMA_CUBE_TYPE, 0.5, 0, 0.5);

  let hops = 0;
  for (let i = 0; i < 20; i++) {
    const before = cube.vy;
    cube.tick(ctx, 0.05);
    if (cube.vy > before && cube.vy > 1) hops++;
  }
  check('一秒里至少起跳一次', hops >= 1, `${hops} 次`);
  check('**不走寻路**（跳跃式移动绕开路径）', cube.chasingPath === 0, `path=${cube.chasingPath}`);

  const dirs: number[] = [];
  for (let i = 0; i < 40; i++) {
    cube.tick(ctx, 0.05);
    if (!cube.onGround && Math.abs(cube.vx) > 0.1) dirs.push(Math.sign(cube.vx));
  }
  check('追人时朝玩家的方向跳（+x）', dirs.length > 0 && dirs.every((d) => d > 0), dirs.join(','));

  // 空中不转向（手动放到空中，不依赖时序）
  const air = new Mob(MAGMA_CUBE_BIG_TYPE, 0.5, 0, 0.5);
  air.onGround = false;
  air.vx = 3;
  air.vz = 1.5;
  air.vy = 2;
  air.tick(ctx, 0.05);
  check('空中不转向：水平速度一点不变', air.vx === 3 && air.vz === 1.5, `vx=${air.vx} vz=${air.vz}`);
}

// ---------------------------------------------------------------- 4. 分裂

console.log('\n[分裂：大 → 中 → 小]');
{
  const counts = new Set<number>();
  const ids = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const { ctx, spawned } = makeCtx();
    const big = new Mob(MAGMA_CUBE_BIG_TYPE, 0.5, 0, 0.5);
    big.hurt(999, 0, 0, ctx);
    run(big, ctx, 0.2);
    counts.add(spawned.length);
    for (const child of spawned) ids.add(child.id);
  }
  check('分裂出 2~4 只', [...counts].every((count) => count >= 2 && count <= 4), [...counts].join(','));
  equal('生出来的都是"中"岩浆怪', [...ids].join(','), MAGMA_CUBE_TYPE.id);

  {
    const { ctx, spawned } = makeCtx();
    const mid = new Mob(MAGMA_CUBE_TYPE, 0.5, 0, 0.5);
    mid.hurt(999, 0, 0, ctx);
    run(mid, ctx, 0.2);
    equal('中岩浆怪分裂出小的', [...new Set(spawned.map((child) => child.id))].join(','), MAGMA_CUBE_SMALL_TYPE.id);
  }

  {
    // 小的不分裂、但**照样掉岩浆膏**（打 30 只看总量，别用"打一只"断言——那是批次 120 的坑）
    let totalDrops = 0;
    let splits = 0;
    for (let i = 0; i < 30; i++) {
      const drops: number[] = [];
      const { ctx, spawned } = makeCtx({ spawnDrop: (itemId: number) => drops.push(itemId) });
      const small = new Mob(MAGMA_CUBE_SMALL_TYPE, 0.5, 0, 0.5);
      small.hurt(999, 0, 0, ctx);
      run(small, ctx, 0.2);
      totalDrops += drops.filter((itemId) => itemId === Item.MAGMA_CREAM).length;
      splits += spawned.length;
    }
    equal('小岩浆怪不分裂', splits, 0);
    check('打 30 只小岩浆怪会掉一批岩浆膏（0~1 份/只）', totalDrops > 0, `${totalDrops} 份`);
    check('总数不超过 1 份/只', totalDrops <= 30, `${totalDrops} 份`);
  }

  {
    // 自然消失不分裂（离玩家 96 格被清场时也是 dead）
    const { ctx, spawned } = makeCtx();
    const big = new Mob(MAGMA_CUBE_BIG_TYPE, 0.5, 0, 0.5);
    big.dead = true;
    run(big, ctx, 0.2);
    equal('自然消失不分裂', spawned.length, 0);
  }
}

// ---------------------------------------------------------------- 5. 岩浆块烫伤

console.log('\n[岩浆块：每秒 1 点，免疫火焰的不掉]');
{
  // 普通生物（僵尸）站在岩浆块上：每秒 1 点
  const zombie = new Mob(mobTypeById('zombie')!, 0.5, 0, 0.5);
  const { ctx } = makeCtx();
  const healthBefore = zombie.health;
  for (let t = 0; t < 3; t += 1 / 20) {
    zombie.tick(ctx, 1 / 20);
    zombie.tickMagmaBlock(ctx, true, 1 / 20);
  }
  check('僵尸站三秒掉 3 点', zombie.health === healthBefore - 3, `${healthBefore} → ${zombie.health}`);

  // 离开岩浆块：不再掉
  const healthAfter = zombie.health;
  for (let t = 0; t < 2; t += 1 / 20) {
    zombie.tick(ctx, 1 / 20);
    zombie.tickMagmaBlock(ctx, false, 1 / 20);
  }
  equal('走开之后不再掉血', zombie.health, healthAfter);

  // **免疫火焰的岩浆怪自己不掉**（原版如此：它自己就是岩浆做的）
  const cube = new Mob(MAGMA_CUBE_TYPE, 0.5, 0, 0.5);
  const cubeHealth = cube.health;
  for (let t = 0; t < 5; t += 1 / 20) {
    cube.tick(ctx, 1 / 20);
    cube.tickMagmaBlock(ctx, true, 1 / 20);
  }
  equal('免疫火焰的生物站在岩浆块上一滴都不掉', cube.health, cubeHealth);
  check('（前置）它确实免疫火焰', cube.type.fireImmune === true);

  // 死的生物不再掉血（免得尸体还在计时）
  const dead = new Mob(MAGMA_CUBE_TYPE, 0.5, 0, 0.5);
  dead.dead = true;
  const deadHealth = dead.health;
  dead.tickMagmaBlock(ctx, true, 5);
  equal('已经死了就不再结算', dead.health, deadHealth);

  // 岩浆块本身：亮度 3（原版）、硬度 0.5
  equal('岩浆块是发光方块（亮度 3）', blockDef(Block.MAGMA_BLOCK).light, 3);
  equal('硬度 0.5（原版：镐子快，徒手慢）', blockHardness(Block.MAGMA_BLOCK), 0.5);
}

// ---------------------------------------------------------------- 6. 岩浆膏与岩浆块

console.log('\n[岩浆膏与岩浆块：那条链的两头]');
{
  equal('岩浆膏的中文名', itemLabel(Item.MAGMA_CREAM), '岩浆膏');
  equal('堆叠 64', maxStackOf(Item.MAGMA_CREAM), 64);
  check('有说明', hasDescription(Item.MAGMA_CREAM));
  check(
    '说明写了三件事：岩浆怪掉 / 烈焰粉 + 黏液球合成 / 抗火药水的原料',
    ['岩浆怪', '烈焰粉', '黏液球', '抗火'].every((word) => itemDescription(Item.MAGMA_CREAM).includes(word)),
    itemDescription(Item.MAGMA_CREAM),
  );
  check('图标在图集名单里', TILES.has(itemDef(Item.MAGMA_CREAM)!.tile));
  check('创造物品栏里拿得到', CREATIVE_ITEMS.includes(Item.MAGMA_CREAM));

  equal('岩浆块的中文名', itemLabel(Block.MAGMA_BLOCK), '岩浆块');
  check(
    '说明写明了"每秒 1 点 + 算火焰伤害（抗火能挡）"',
    itemDescription(Block.MAGMA_BLOCK).includes('每秒') && itemDescription(Block.MAGMA_BLOCK).includes('火焰'),
    itemDescription(Block.MAGMA_BLOCK),
  );

  // 配方一：岩浆膏 = 烈焰粉 + 黏液球（原版）
  equal('烈焰粉 + 黏液球 → 岩浆膏', matchRecipe([Item.BLAZE_POWDER, Item.SLIME_BALL], 2)?.id, Item.MAGMA_CREAM);
  const cream = RECIPES.find((recipe) => recipe.result.id === Item.MAGMA_CREAM);
  check('配方表里那份岩浆膏配方就是这两样', cream !== undefined);
  check(
    '它无序配方（原版如此）',
    cream?.kind === 'shapeless' &&
      cream.ingredients.length === 2 &&
      cream.ingredients.includes(Item.BLAZE_POWDER) &&
      cream.ingredients.includes(Item.SLIME_BALL),
  );

  // 配方二：岩浆块 = 2×2 的岩浆膏（原版）
  equal('4 份岩浆膏 → 1 块岩浆块', matchRecipe([Item.MAGMA_CREAM, Item.MAGMA_CREAM, Item.MAGMA_CREAM, Item.MAGMA_CREAM], 2)?.id, Block.MAGMA_BLOCK);
  equal('一次出 1 块', matchRecipe([Item.MAGMA_CREAM, Item.MAGMA_CREAM, Item.MAGMA_CREAM, Item.MAGMA_CREAM], 2)?.count, 1);
  check('3 份做不出来（原版要 2×2 摆满）', matchRecipe([Item.MAGMA_CREAM, Item.MAGMA_CREAM, Item.MAGMA_CREAM], 2) === null);

  // 链条闭合：岩浆膏一直是**抗火药水**的原料，但在此之前只能从战利品箱里翻
  equal('抗火药水的酿造原料就是岩浆膏（原版）', VARIANT_INGREDIENTS.fire_resistance, Item.MAGMA_CREAM);
  check(
    '所以这条链是通的：岩浆怪 → 岩浆膏 → 抗火药水 / 岩浆块',
    MAGMA_CUBE_SMALL_TYPE.drops[0]!.itemId === Item.MAGMA_CREAM &&
      VARIANT_INGREDIENTS.fire_resistance === Item.MAGMA_CREAM,
  );
}

console.log(`\n岩浆怪测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
