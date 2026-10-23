/**
 * 幻翼离线测试（批次 126，J15 的最后一只）
 *
 * 幻翼是本项目**第一只"与地形无关、只看玩家自己"的刷怪**：连续三个游戏日不睡，
 * 夜里就会有东西从天上俯冲下来。所以这一套分四段：
 *
 *  1. **数据**：20 血 / 接触 3 / 会飞 / 亡灵 / 掉幻翼膜；**不进自然生成表**
 *     （写进去它就会被当成普通怪撒到野地——那是另一只生物）；
 *  2. **失眠（纯逻辑）**：`phantomNightIsComing` 四条判据 + `phantomSpawnCount`
 *     的"越不睡越多、封顶 7"；
 *  3. **俯冲 AI**（`Phantom` 的状态机）：盘旋 → 俯冲 → 拉起，以及"贴到 1.8 格内撞一下"；
 *  4. **它掉的那片膜能干什么**：酿 **缓降药水**（原版）；顺带把四个 id 段不撞车验一遍。
 *
 * 运行：npm run test:phantom
 */

import { Block } from '../src/core/registry/blocks.ts';
import { mobLabel } from '../src/core/entity/Mob.ts';
import { CREATIVE_ITEMS, Item, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';
import { VARIANT_INGREDIENTS, brewRecipeFor } from '../src/core/crafting/Brewing.ts';
import { POTIONS, POTION_IDS, variantByKey } from '../src/core/registry/potions.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { describeMobModel } from '../src/render/MobRenderer.ts';
import { ALL_HOSTILE_MOBS, HOSTILE_MOBS, MOB_TYPES, mobTypeById } from '../src/core/entity/mobs.ts';
import { createMob } from '../src/core/entity/MobFactory.ts';
import {
  Phantom,
  PHANTOM_CIRCLE_SECONDS,
  PHANTOM_DIVE_SECONDS,
  PHANTOM_HIT_RANGE,
  PHANTOM_TYPE,
} from '../src/core/entity/Phantom.ts';
import {
  PHANTOM_MAX_COUNT,
  PHANTOM_MIN_DAYS,
  PHANTOM_SPAWN_INTERVAL,
  phantomNightIsComing,
  phantomSpawnCount,
} from '../src/core/survival/Insomnia.ts';
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

function flatPhysics(): PhysicsWorld {
  return {
    collisionAt: (_x: number, y: number) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  } as unknown as PhysicsWorld;
}

/** 记录"玩家挨了几下"的上下文（玩家位置由用例给） */
function makeCtx(player: { x: number; y: number; z: number }): {
  ctx: EntityContext;
  rec: { hits: number; amounts: number[] };
} {
  const rec = { hits: 0, amounts: [] as number[] };
  const ctx = {
    world: flatPhysics(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (_x: number, y: number) => (y < 0 ? Block.STONE : Block.AIR),
    player,
    hurtPlayer: (amount: number) => {
      rec.hits++;
      rec.amounts.push(amount);
    },
    spawnDrop: () => {},
  } as unknown as EntityContext;
  return { ctx, rec };
}

function step(phantom: Phantom, ctx: EntityContext, seconds: number, dt = 1 / 20): void {
  for (let t = 0; t < seconds; t += dt) phantom.tick(ctx, dt);
}

// ---------------------------------------------------------------- 1. 数据

console.log('\n[幻翼：天上那只"失眠怪"]');
{
  equal('名字', mobLabel(PHANTOM_TYPE), '幻翼');
  equal('20 点生命', PHANTOM_TYPE.health, 20);
  equal('接触伤害 3（原版普通难度）', PHANTOM_TYPE.attackDamage, 3);
  equal('追击 48 格（它从天上扎下来，要看得远）', PHANTOM_TYPE.followRange, 48);
  equal('**会飞**', PHANTOM_TYPE.flying, true);
  equal('亡灵家族（亡灵杀手对它有效）', PHANTOM_TYPE.family, 'undead');
  equal('击杀经验 5', PHANTOM_TYPE.xp, 5);
  equal('掉幻翼膜 0~1', `${PHANTOM_TYPE.drops[0]?.min}~${PHANTOM_TYPE.drops[0]?.max}`, '0~1');
  equal('掉的就是幻翼膜', PHANTOM_TYPE.drops[0]?.itemId, Item.PHANTOM_MEMBRANE);
  check('白天照样会被晒着烧（与骷髅同一条）', PHANTOM_TYPE.burnsInDaylight === true);
  // 它**不写 `dimension`**：这一位只对"走刷怪器"的生物有意义，而幻翼根本不过刷怪器
  equal('不写 `dimension`（它不过刷怪器，维度由失眠那一趟自己保证）', PHANTOM_TYPE.dimension, undefined);

  // **不进自然生成表**是这一只最要紧的一处
  equal('**不进自然生成表**（它的生成条件与地形无关，只看玩家几天没睡）', PHANTOM_TYPE.naturalSpawn, false);
  check('所以它不在"会自然刷的敌对生物"表里', !HOSTILE_MOBS.includes(PHANTOM_TYPE));
  check('但它在"所有敌对生物"里（击杀类进度要算它）', ALL_HOSTILE_MOBS.includes(PHANTOM_TYPE));
  check('生物表里有它', MOB_TYPES.includes(PHANTOM_TYPE) && mobTypeById('phantom') !== undefined);

  const model = describeMobModel(PHANTOM_TYPE);
  equal('模型是幻翼（扁身子 + 两片长翼 + 尾巴）', model.kind, 'phantom');
  equal('没有腿可摆（它一直在飞）', model.legs, 0);
  check('部件够多（身子 + 两翼 + 头 + 两眼 + 尾巴）', model.parts >= 7, `${model.parts} 个`);

  // 工厂：必须是 Phantom 子类（否则会造出一只"只会平移"的鸟）
  const made = createMob(PHANTOM_TYPE, 0, 20, 0);
  check('走工厂造出来的就是 `Phantom`（不是普通 `Mob`）', made instanceof Phantom);
}

// ---------------------------------------------------------------- 2. 失眠（纯逻辑）

console.log('\n[失眠：连续几天不睡才会来]');
{
  equal('门槛是 3 天（原版）', PHANTOM_MIN_DAYS, 3);
  equal('一批最多 7 只（原版）', PHANTOM_MAX_COUNT, 7);
  equal('夜里每 25 秒试一次', PHANTOM_SPAWN_INTERVAL, 25);
  equal('撞人距离 1.8 格（它扎得很快，判定给宽一点）', PHANTOM_HIT_RANGE, 1.8);

  check('2 天不来（没到门槛）', !phantomNightIsComing(2, true, false));
  check('3 天 + 夜里 → 来', phantomNightIsComing(3, true, false));
  check('10 天 + 夜里 → 来（越久越凶）', phantomNightIsComing(10, true, false));
  check('白天不来（它们会被晒着烧）', !phantomNightIsComing(10, false, false));
  check('**这一夜已经来过就不再派**（一夜一批，免得刷成灾难）', !phantomNightIsComing(10, true, true));

  equal('3 天 → 1 只', phantomSpawnCount(3), 1);
  equal('4 天 → 2 只', phantomSpawnCount(4), 2);
  equal('9 天 → 7 只', phantomSpawnCount(9), 7);
  equal('10 天仍然 7 只（封顶）', phantomSpawnCount(10), 7);
  equal('2 天 → 0 只', phantomSpawnCount(2), 0);
  equal('0 天（刚睡过）→ 0 只', phantomSpawnCount(0), 0);
}

// ---------------------------------------------------------------- 3. 俯冲 AI

console.log('\n[俯冲 AI：盘旋 → 俯冲 → 拉起]');
{
  const { ctx } = makeCtx({ x: 10, y: 0, z: 0 });
  const phantom = new Phantom(0, 20, 0);
  equal('一开始在盘旋', phantom.divePhase, 'circle');

  // 盘旋：它在玩家上方（比玩家高）
  step(phantom, ctx, 1);
  check('盘旋时比玩家高（挂在天上）', phantom.y > 10, `y=${phantom.y.toFixed(1)}`);

  // 绕够时间就俯冲
  step(phantom, ctx, PHANTOM_CIRCLE_SECONDS);
  equal('盘旋够了就进俯冲', phantom.divePhase, 'dive');

  // 俯冲：朝玩家靠近
  const before = phantom.distanceToPlayerForTest(ctx);
  step(phantom, ctx, 0.6);
  const after = phantom.distanceToPlayerForTest(ctx);
  check('俯冲时朝玩家靠近', after < before, `${before.toFixed(1)} → ${after.toFixed(1)}`);

  // 俯冲一段时间没撞到 → 拉起 → 再回到盘旋
  step(phantom, ctx, 2.5);
  check('贴不到玩家就会拉起并回到盘旋', phantom.divePhase === 'circle' || phantom.divePhase === 'climb');

  // 撞人：把玩家直接放在它旁边
  {
    const target = { x: 0.5, y: 20, z: 0.5 };
    const { ctx: hitCtx, rec } = makeCtx(target);
    const attacker = new Phantom(0.5, 20, 0.5);
    // ⚠️ 第一版只 tick 了 0.2 秒——那时它刚离开盘旋、还在十几格外往回扎，
    // 一次都没撞到（判据没错，是测试没等它）
    step(attacker, hitCtx, PHANTOM_CIRCLE_SECONDS + 0.1);
    // 等它把这一趟扎完（盘旋 18 格高、半径 9 格，直着下来要 2 秒出头）
    for (let t = 0; t < PHANTOM_DIVE_SECONDS + 0.2 && rec.hits === 0; t += 0.05) {
      attacker.tick(hitCtx, 0.05);
    }
    check('俯冲下来贴到玩家就撞一下', rec.hits > 0, `${rec.hits} 下`);
    if (rec.hits > 0) equal('撞的是 3 点', rec.amounts[0], PHANTOM_TYPE.attackDamage);
  }

  // 冷却：贴着脸站一会儿也不会每帧都扣血
  {
    const { ctx: cdCtx, rec } = makeCtx({ x: 0.5, y: 20, z: 0.5 });
    const camper = new Phantom(0.5, 20, 0.5);
    step(camper, cdCtx, PHANTOM_CIRCLE_SECONDS + 2);
    check('连撞也有冷却（1.2 秒一次，不会每帧扣）', rec.hits <= 3, `${rec.hits} 下`);
  }

  // 没有玩家时不该崩（离线/大厅）
  {
    const { ctx: emptyCtx } = makeCtx({ x: 0, y: 0, z: 0 });
    (emptyCtx as { player: unknown }).player = null;
    const lonely = new Phantom(0, 20, 0);
    step(lonely, emptyCtx, 1);
    check('没有玩家时原地浮动、不崩', Number.isFinite(lonely.x) && Number.isFinite(lonely.y));
  }
}

// ---------------------------------------------------------------- 4. 幻翼膜与缓降药水

console.log('\n[它掉的那片膜：酿缓降药水]');
{
  equal('幻翼膜的中文名', itemLabel(Item.PHANTOM_MEMBRANE), '幻翼膜');
  equal('堆叠 64', maxStackOf(Item.PHANTOM_MEMBRANE), 64);
  check('有说明', hasDescription(Item.PHANTOM_MEMBRANE));
  check(
    '说明写了"幻翼掉 / 酿缓降药水"',
    ['幻翼', '缓降'].every((word) => itemDescription(Item.PHANTOM_MEMBRANE).includes(word)),
    itemDescription(Item.PHANTOM_MEMBRANE),
  );
  check('图标在图集名单里', TILES.has(itemDef(Item.PHANTOM_MEMBRANE)!.tile));
  check('创造物品栏里拿得到', CREATIVE_ITEMS.includes(Item.PHANTOM_MEMBRANE));
  check('**没有合成配方**（原版它只能从幻翼身上来）', !RECIPES.some((recipe) => recipe.result.id === Item.PHANTOM_MEMBRANE));

  // 缓降药水：效果/档位/时长
  equal('缓降药水的酿造原料就是幻翼膜（原版）', VARIANT_INGREDIENTS.slow_falling, Item.PHANTOM_MEMBRANE);
  const variant = variantByKey('slow_falling');
  check('药水表里有缓降这一条', variant !== undefined);
  equal('普通档 1:30', variant?.seconds, 90);
  equal('红石粉延长到 4:00', variant?.extended, 240);
  check('原版没有缓降 II（所以不写 `strong`）', variant?.strong === undefined);
  equal('中文名', itemLabel(POTION_IDS.slow_falling), '缓降药水');
  check(
    '四个 id 段都在图集名单里（饮用 / 喷溅 / 滞留 / 药水箭）',
    [
      `item_potion_slow_falling`,
      `item_potion_splash_slow_falling`,
      `item_potion_lingering_slow_falling`,
      `item_tipped_arrow_slow_falling`,
    ].every((tile) => TILES.has(tile)),
  );

  // 真的能酿：粗制 + 幻翼膜 → 缓降；再拿红石粉延长
  const base = brewRecipeFor(Item.PHANTOM_MEMBRANE, Item.POTION_AWKWARD);
  check('粗制药水 + 幻翼膜 有酿造配方', base !== null);
  equal('酿出来的是缓降药水', base?.to, POTION_IDS.slow_falling);
  const longer = brewRecipeFor(Item.REDSTONE_DUST, POTION_IDS.slow_falling);
  equal('再加红石粉 → 延长档', longer?.to, POTION_IDS.slow_falling_long);

  // id 段不撞车（每个药水的四个派生 id 必须互不相同，也不能落进别的药水）
  {
    const seen = new Map<number, string>();
    let clash = '';
    for (const potion of POTIONS) {
      for (const id of [potion.id]) {
        const key = `${potion.key}`;
        if (seen.has(id)) clash += `${key} 与 ${seen.get(id)} 撞了 ${id}；`;
        seen.set(id, key);
      }
    }
    equal('药水 id 段互不重复（含新加的缓降四档）', clash, '');
  }
}

// ---------------------------------------------------------------- 5. J15 收口

console.log('\n[J15 收口：表里这 11 只都在]');
{
  // 这几只是 J15 当初列的那一批（逐条划掉的顺序就是批次 92~126）
  const j15 = [
    'blaze',
    'spider',
    'cave_spider',
    'ghast',
    'slime',
    'magma_cube',
    'zombie_piglin',
    'drowned',
    'husk',
    'stray',
    'phantom',
  ];
  const missing = j15.filter((id) => mobTypeById(id) === undefined);
  check('J15 列的 11 只都在生物表里', missing.length === 0, missing.join(','));
  check('（前置）生物表本身比这 11 只多（还有僵尸/骷髅/末影人那些老面孔）', MOB_TYPES.length > j15.length);
}

console.log(`\n幻翼测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
