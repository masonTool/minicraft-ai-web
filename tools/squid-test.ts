/**
 * 鱿鱼与墨囊离线测试（批次 189，J14 的生物 + J26 的染料链）
 *
 * 这一套盯的是**一条链**，不是一只怪：
 *
 *  鱿鱼（水里刷）→ 墨囊 → 黑色染料 → 黑/灰两色的羊毛、地毯、床、染色玻璃、陶瓦、
 *  混凝土整族。所以断言分三块：
 *
 *  1. **鱿鱼本体**：10 血 / 1~3 个墨囊 / 2 点经验 / 不还手；三根数据线
 *     （`spawnInWater` 刷在水里、`aquatic` 水里不受重力、`ignoreLight` 水下不看天光）；
 *  2. **墨囊与染料**：墨囊 → 黑色染料、黑 + 白 → 灰色染料（原版那两条唯一的路）；
 *  3. **水里刷 / 上岸窒息**：刷怪器那两条判据与重力分支的实测。
 *
 * 运行：npm run test:squid
 */

import { Block } from '../src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, dyeIdByName, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';
import { recipeIngredients } from '../src/core/crafting/RecipeBook.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { describeMobModel } from '../src/render/MobRenderer.ts';
import { MOB_TYPES, PASSIVE_MOBS, SQUID_TYPE, mobTypeById } from '../src/core/entity/mobs.ts';
import { Mob, mobLabel } from '../src/core/entity/Mob.ts';
import { MobSpawner, type SpawnContext } from '../src/core/entity/MobSpawner.ts';
import { SPAWN_EGG_SPECS, spawnEggItemId, spawnEggMobOf } from '../src/core/registry/spawnEggs.ts';
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

const TILES = new Set<string>(TILE_ORDER);

/** 一片平地（水面以上没有碰撞） */
function flatPhysics(): PhysicsWorld {
  return {
    collisionAt: (_x: number, y: number) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  } as unknown as PhysicsWorld;
}

function makeCtx(getBlock: (x: number, y: number, z: number) => number): EntityContext {
  return {
    world: flatPhysics(),
    playerBox: null,
    pickup: () => 0,
    getBlock,
    player: { x: 0.5, y: 0.5, z: 0.5 },
    hurtPlayer: () => undefined,
    spawnDrop: () => undefined,
    spawnArrow: () => undefined,
    spawnTrident: () => undefined,
  } as unknown as EntityContext;
}

function run(mob: Mob, ctx: EntityContext, seconds: number, step = 1 / 20): void {
  for (let t = 0; t < seconds; t += step) mob.tick(ctx, step);
}

/** 一个"永远返回同一个值"的随机源（刷怪器注入用，好让分支可复现） */
function constantRandom(value: number): () => number {
  return () => value;
}

// ---------------------------------------------------------------- 1. 鱿鱼的数据

console.log('\n[鱿鱼：海里那只]');
{
  equal('名字', mobLabel(SQUID_TYPE), '鱿鱼');
  equal('10 点生命（原版）', SQUID_TYPE.health, 10);
  equal('不还手', SQUID_TYPE.hostile, false);
  equal('不打人', SQUID_TYPE.attackDamage, 0);
  equal('击杀经验 2（原版 1~3）', SQUID_TYPE.xp, 2);
  equal('在主世界', SQUID_TYPE.dimension, 'overworld');
  check('在生物表里', MOB_TYPES.includes(SQUID_TYPE) && mobTypeById('squid') !== undefined);
  check('在"会自然刷的被动生物"表里', PASSIVE_MOBS.includes(SQUID_TYPE));

  // 三个"与岸上动物不同"的数据线
  check('**刷在水里**（`spawnInWater`）', SQUID_TYPE.spawnInWater === true);
  check('**水里不受重力**（`aquatic`）', SQUID_TYPE.aquatic === true);
  check('水下不看天光（`ignoreLight`）', SQUID_TYPE.ignoreLight === true);
  // 批次 338 把海洋补到 9 种，鱿鱼是"所有海洋都刷"的那一档
  equal(
    '只在九种海洋里刷',
    (SQUID_TYPE.spawnBiomes ?? []).join(','),
    'ocean,deep_ocean,warm_ocean,frozen_ocean,cold_ocean,deep_cold_ocean,lukewarm_ocean,deep_lukewarm_ocean,deep_frozen_ocean',
  );
  check('（对照）牛没有 `aquatic`', mobTypeById('cow')!.aquatic !== true);

  // 掉落：墨囊 1~3
  equal('只掉一样东西', SQUID_TYPE.drops.length, 1);
  equal('掉的是墨囊', SQUID_TYPE.drops[0]?.itemId, Item.INK_SAC);
  equal('1~3 个（原版）', `${SQUID_TYPE.drops[0]?.min}~${SQUID_TYPE.drops[0]?.max}`, '1~3');
  equal('必掉（原版没有概率项）', SQUID_TYPE.drops[0]?.chance, undefined);

  // 模型：圆头 + 八条触手
  const model = describeMobModel(SQUID_TYPE);
  equal('模型骨架是 squid', model.kind, 'squid');
  check('部件比人形多（头 + 尖 + 两只眼 + 八条触手 = 12）', model.parts === 12, String(model.parts));
  equal('没有腿（触手不算腿）', model.legs, 0);
}

// ---------------------------------------------------------------- 2. 墨囊与染料

console.log('\n[墨囊：一颗换一整族颜色]');
{
  equal('中文名', itemLabel(Item.INK_SAC), '墨囊');
  equal('可堆叠 64（原版）', maxStackOf(Item.INK_SAC), 64);
  check('有说明', hasDescription(Item.INK_SAC));
  check(
    '说明写了"鱿鱼 / 黑色染料"',
    itemDescription(Item.INK_SAC).includes('鱿鱼') && itemDescription(Item.INK_SAC).includes('黑色染料'),
    itemDescription(Item.INK_SAC),
  );
  check('图标在图集名单里', TILES.has(itemDef(Item.INK_SAC)!.tile));
  check('创造物品栏里拿得到', CREATIVE_ITEMS.includes(Item.INK_SAC));

  // 刷怪蛋：生物表多了一种，蛋也要跟上
  const egg = SPAWN_EGG_SPECS.findIndex((spec) => spec.mobId === 'squid');
  check('有一枚鱿鱼刷怪蛋', egg >= 0);
  equal('蛋的 id 是显式给的 1498（顺序区间 1451~1471 之后紧挨着水桶）', spawnEggItemId(egg), 1498);
  equal('按 id 反查得到 squid', spawnEggMobOf(1498), 'squid');
  check('蛋的贴图在图集名单里', TILES.has('spawn_egg_squid'));
}

const BLACK_DYE = dyeIdByName('black');
const GRAY_DYE = dyeIdByName('gray');
const WHITE_DYE = dyeIdByName('white');

console.log('\n[染料链：黑色与灰色]');
{
  const blackRecipe = RECIPES.find(
    (recipe) => recipe.result.id === BLACK_DYE && recipeIngredients(recipe).length === 1,
  );
  check('墨囊 → 黑色染料（原版唯一的两条路之一）', blackRecipe !== undefined);
  equal('1 个墨囊换 1 份染料', recipeIngredients(blackRecipe!).length, 1);
  equal('原料就是墨囊', recipeIngredients(blackRecipe!)[0]!.id, Item.INK_SAC);

  const grayRecipe = RECIPES.find((recipe) => recipe.result.id === GRAY_DYE);
  check('黑 + 白 → 灰色染料（原版唯一的路）', grayRecipe !== undefined);
  equal('两份原料', recipeIngredients(grayRecipe!).length, 2);
  check(
    '原料是黑染料与白染料',
    recipeIngredients(grayRecipe!).some((ingredient) => ingredient.id === BLACK_DYE) &&
      recipeIngredients(grayRecipe!).some((ingredient) => ingredient.id === WHITE_DYE),
  );
  equal('产 2 份（原版所有混合染料都产 2）', grayRecipe!.result.count, 2);
}

// ---------------------------------------------------------------- 3. 水里刷

console.log('\n[刷怪：只在水里、只在海里]');
{
  /** 一片海：水面 y=63，往下全是水，岸上那条路完全走不通（没有草方块） */
  const ocean = {
    player: { x: 0.5, y: 62, z: 0.5 },
    getBlock: (_x: number, y: number) => (y <= 63 ? Block.WATER : Block.AIR),
    getSurfaceBlockY: () => null,
    getSkyLight: () => 15,
    getBlockLight: () => 0,
    biomeAt: () => 'ocean',
  };
  const spawned: string[] = [];
  const ctx: SpawnContext = {
    ...ocean,
    spawn: (type: { id: string }) => spawned.push(type.id),
    hostileCount: 0,
    passiveCount: 0,
  } as unknown as SpawnContext;
  const spawner = new MobSpawner(constantRandom(0));
  spawner.update(2.1, ctx);
  equal('海里会刷出鱿鱼', spawned[0], 'squid');

  // 草地上不刷鱿鱼：岸上那条路现在只从 `land` 里挑
  const grassSpawned: string[] = [];
  const landCtx: SpawnContext = {
    player: { x: 0.5, y: 64, z: 0.5 },
    getBlock: (_x: number, y: number) => (y === 63 ? Block.GRASS_BLOCK : y < 63 ? Block.STONE : Block.AIR),
    getSurfaceBlockY: () => 63,
    getSkyLight: () => 15,
    getBlockLight: () => 0,
    biomeAt: () => 'plains',
    spawn: (type: { id: string }) => grassSpawned.push(type.id),
    hostileCount: 0,
    passiveCount: 0,
  } as unknown as SpawnContext;
  // 0.9 > `WATER_SPAWN_SHARE`，所以这一轮走的是岸上那条路（不会白试 16 次水里）
  for (let i = 0; i < 5; i++) new MobSpawner(constantRandom(0.9)).update(2.1, landCtx);
  check('草原上刷出来的都不是鱿鱼', grassSpawned.length > 0 && !grassSpawned.includes('squid'), grassSpawned.join(','));

  // 同是水，但群系不对（比如内陆湖在别的群系）：一只都不刷
  const wrongBiomeSpawned: string[] = [];
  const lakeCtx: SpawnContext = {
    ...ocean,
    biomeAt: () => 'plains',
    spawn: (type: { id: string }) => wrongBiomeSpawned.push(type.id),
    hostileCount: 0,
    passiveCount: 0,
  } as unknown as SpawnContext;
  new MobSpawner(constantRandom(0)).update(2.1, lakeCtx);
  equal('群系不对就不刷（鱿鱼只在海洋群系）', wrongBiomeSpawned.length, 0);
}

// ---------------------------------------------------------------- 4. 水里的物理

console.log('\n[水里的物理：不沉底、上岸会窒息]');
{
  // 泡在水里：2 秒后不但没沉下去，反而往上浮了一点
  const waterCtx = makeCtx((_x, y) => (y <= 70 ? Block.WATER : Block.AIR));
  const squid = new Mob(SQUID_TYPE, 0.5, 40, 0.5);
  const startY = squid.y;
  run(squid, waterCtx, 2);
  check('水里不会沉底（原版它悬在中层）', squid.y > startY - 0.05, `y=${squid.y.toFixed(3)} 起点 ${startY}`);

  // 上岸：普通重力，掉到底；离水满 10 秒之后开始掉血
  const landCtx = makeCtx((_x, y) => (y < 0 ? Block.STONE : Block.AIR));
  const beached = new Mob(SQUID_TYPE, 0.5, 4, 0.5);
  run(beached, landCtx, 2);
  check('上岸会往下掉（`aquatic` 只管水里，不是飞行）', beached.y < 4, `y=${beached.y.toFixed(3)}`);
  equal('刚上岸不掉血（前 10 秒只是抽动）', beached.health, 10);
  run(beached, landCtx, 12);
  check('离水满 10 秒后开始窒息掉血', beached.health < 10, `health=${beached.health}`);

  // 回到水里就不掉血了
  const wet = new Mob(SQUID_TYPE, 0.5, 40, 0.5);
  run(wet, landCtx, 12);
  const dryHealth = wet.health;
  check('（对照）在岸上它确实掉了血', dryHealth < 10, String(dryHealth));
  run(wet, waterCtx, 3);
  equal('回到水里就停止窒息（计时清零）', wet.health, dryHealth);
}

console.log(`\n鱿鱼测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
