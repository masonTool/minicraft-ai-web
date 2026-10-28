/**
 * 僵尸猪灵离线测试（批次 122，J15 的下一只）
 *
 * 它是**第一只"平时不打人"的敌对生物**，也是"记仇"那套状态第一次**在同类之间传播**。
 * 所以这一套的重点是这两件事，外加一条金子的路：
 *
 *  1. **数据**（按原版普通难度）：20 血、接触伤害 **8**（比僵尸的 3 高得多）、追击 24、
 *     亡灵家族、只在下界刷；掉落里有一条金子的路（腐肉 0~1 / **金粒 0~1** /
 *     金锭 2.5% / **金剑 8.5%**）；
 *  2. **中立**（`neutral`）：不惹它，它从你身边走过去（一下都不打）；打它一下才翻脸——
 *     这一条与末影人共用同一套 `angerTimer`（批次 112 铺的）；
 *  3. **群体激怒**（`angerRadius: 32`）：同类挨打，半径内的同伴一起翻脸。
 *     "该惊动谁"是纯函数 `provokedBy`（只算同种、按三维距离、跳过已死的），
 *     所以这一套能把它三条判据一条条验掉；
 *  4. **金粒那条链**：9 金粒 ↔ 1 金锭的配方早就在，猪灵让"在下界攒金子"有了读法。
 *
 * 运行：npm run test:piglin
 */

import { Block } from '../web/src/core/registry/blocks.ts';
import { Item, itemDef, maxStackOf } from '../web/src/core/registry/items.ts';
import { itemLabel } from '../web/src/core/registry/itemNames.ts';
import { toolItemId } from '../web/src/core/registry/tools.ts';
import { matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { BARTER_TABLE, BARTER_TOTAL_WEIGHT, barterRoll } from '../web/src/core/items/Barter.ts';
import { describeMobModel } from '../web/src/render/MobRenderer.ts';
import { HOSTILE_MOBS, MOB_TYPES, ZOMBIE_PIGLIN_TYPE, mobTypeById } from '../web/src/core/entity/mobs.ts';
import { Mob, provokedBy, mobLabel } from '../web/src/core/entity/Mob.ts';
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

/** 一片平地（物理与方块查询同源） */
function flatPhysics(): PhysicsWorld {
  return {
    collisionAt: (_x: number, y: number) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  } as unknown as PhysicsWorld;
}

interface Recorded {
  /** 玩家挨了几下（僵尸猪灵的打人走的正是这个钩子） */
  hits: number;
  /** `provokeNearby` 被怎么调用 */
  provoked: { x: number; y: number; z: number; radius: number; typeId: string }[];
}

/** 一个记下"玩家挨了几下 / 惊动了谁"的上下文 */
function makeCtx(overrides: Record<string, unknown> = {}): { ctx: EntityContext; rec: Recorded } {
  const rec: Recorded = { hits: 0, provoked: [] };
  const ctx = {
    world: flatPhysics(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (_x: number, y: number) => (y < 0 ? Block.STONE : Block.AIR),
    player: { x: 0.5, y: 0, z: 0.5 },
    hurtPlayer: () => {
      rec.hits++;
    },
    spawnDrop: () => {},
    provokeNearby: (x: number, y: number, z: number, radius: number, typeId: string) => {
      rec.provoked.push({ x, y, z, radius, typeId });
    },
    ...overrides,
  } as unknown as EntityContext;
  return { ctx, rec };
}

function run(mob: Mob, ctx: EntityContext, seconds: number, step = 1 / 20): void {
  for (let t = 0; t < seconds; t += step) mob.tick(ctx, step);
}

// ---------------------------------------------------------------- 1. 数据

console.log('\n[僵尸猪灵的数据（按原版普通难度）]');
{
  equal('名字', mobLabel(ZOMBIE_PIGLIN_TYPE), '僵尸猪灵');
  equal('20 点生命（原版）', ZOMBIE_PIGLIN_TYPE.health, 20);
  equal('接触伤害 8（原版普通难度；**比僵尸的 3 高得多**——它拿着金剑）', ZOMBIE_PIGLIN_TYPE.attackDamage, 8);
  equal('（对照）僵尸只有 3', mobTypeById('zombie')!.attackDamage, 3);
  equal('追击 24 格（与僵尸同一条）', ZOMBIE_PIGLIN_TYPE.followRange, 24);
  equal('亡灵家族（亡灵杀手对它有效）', ZOMBIE_PIGLIN_TYPE.family, 'undead');
  equal('击杀经验 5', ZOMBIE_PIGLIN_TYPE.xp, 5);
  equal('只在下界刷', ZOMBIE_PIGLIN_TYPE.dimension, 'nether');
  check('在"会自然刷的敌对生物"表里', HOSTILE_MOBS.includes(ZOMBIE_PIGLIN_TYPE));
  check('生物表里有它', MOB_TYPES.includes(ZOMBIE_PIGLIN_TYPE) && mobTypeById('zombie_piglin') !== undefined);
  check('**平时中立**（`neutral`：不主动打人）', ZOMBIE_PIGLIN_TYPE.neutral === true);
  equal('**被打了会惊动 32 格里的同类**（原版那个数字）', ZOMBIE_PIGLIN_TYPE.angerRadius, 32);

  // 掉落：三样 + 手里那把剑
  equal('掉落 4 样', ZOMBIE_PIGLIN_TYPE.drops.length, 4);
  const byItem = (id: number) => ZOMBIE_PIGLIN_TYPE.drops.find((drop) => drop.itemId === id);
  equal('腐肉 0~1', `${byItem(Item.ROTTEN_FLESH)?.min}~${byItem(Item.ROTTEN_FLESH)?.max}`, '0~1');
  equal('**金粒** 0~1', `${byItem(Item.GOLD_NUGGET)?.min}~${byItem(Item.GOLD_NUGGET)?.max}`, '0~1');
  equal('金锭 1 个 / 2.5%（原版）', byItem(Item.GOLD_INGOT)?.chance, 0.025);
  equal(
    '金锭那一条写的是 `min:1,max:1`（不然数量也掷一次，概率会被砍半）',
    `${byItem(Item.GOLD_INGOT)?.min}~${byItem(Item.GOLD_INGOT)?.max}`,
    '1~1',
  );
  equal('金剑 1 把 / 8.5%（原版）', byItem(toolItemId('sword', 'golden'))?.chance, 0.085);
  check('（对照）它掉的确实是"金剑"那件物品', itemDef(toolItemId('sword', 'golden')) !== undefined);

  // 模型：通用人形
  const model = describeMobModel(ZOMBIE_PIGLIN_TYPE);
  equal('模型是通用人形', model.kind, 'humanoid');
  equal('两条腿', model.legs, 2);
}

// ---------------------------------------------------------------- 2. 中立

console.log('\n[中立：不惹它就不打人，打一下才翻脸]');
{
  // 玩家就在 1.5 格外（近战范围内）：普通僵尸这时早就动手了
  const attackRange = { player: { x: 1.5, y: 0, z: 0.5 }, playerBox: null };
  const { ctx, rec } = makeCtx(attackRange);
  const piglin = new Mob(ZOMBIE_PIGLIN_TYPE, 0.5, 0, 0.5);
  run(piglin, ctx, 3);
  equal('**三秒里一下都没打到玩家**（中立就是站在旁边也不动手）', rec.hits, 0);
  equal('它没有记仇（`angry` 为假）', piglin.angry, false);

  // 打它一下 → 翻脸（与末影人/蜘蛛共用同一套 `angerTimer`）
  const { ctx: angryCtx, rec: angryRec } = makeCtx(attackRange);
  const angry = new Mob(ZOMBIE_PIGLIN_TYPE, 0.5, 0, 0.5);
  check('打它之前不记仇', !angry.angry);
  angry.hurt(1, 0, 0, angryCtx, 0, 0, { kind: 'player' });
  check('打一下立刻记仇', angry.angry);
  equal(
    '而且报了一次"惊动同类"（半径 32、种类是它自己）',
    `${angryRec.provoked[0]?.radius},${angryRec.provoked[0]?.typeId}`,
    '32,zombie_piglin',
  );
  check('报的位置就是它站的地方', angryRec.provoked[0] !== undefined && Math.abs((angryRec.provoked[0]?.x ?? 99) - 0.5) < 1);
  run(angry, angryCtx, 2);
  check('记仇之后就会动手了（打到了玩家）', angryRec.hits > 0, `${angryRec.hits} 下`);

  // 对照：**没写 `angerRadius` 的生物不会调那个钩子**
  const zombie = new Mob(mobTypeById('zombie')!, 0.5, 0, 0.5);
  const { ctx: zombieCtx, rec: zombieRec } = makeCtx();
  zombie.hurt(1, 0, 0, zombieCtx, 0, 0, { kind: 'player' });
  equal('僵尸挨打不会惊动同类（它没有 `angerRadius`）', zombieRec.provoked.length, 0);
  check('（对照）僵尸仍然是敌对的（不是"中立"那一类）', mobTypeById('zombie')!.neutral !== true);
}

// ---------------------------------------------------------------- 3. 群体激怒

console.log('\n[群体激怒：只惊动同种、32 格以内、活着的那几只]');
{
  const piglin = (x: number, y = 0, z = 0, dead = false) => ({ x, y, z, dead, type: ZOMBIE_PIGLIN_TYPE });
  const ghast = (x: number) => ({ x, y: 0, z: 0, dead: false, type: mobTypeById('ghast')! });

  const all = [
    piglin(0.5), // 自己
    piglin(20.5), // 20 格：在半径内
    piglin(40.5), // 40 格：太远
    piglin(10.5, 0, 0, true), // 10 格但已经死了
    ghast(3.5), // 3 格，但是**恶魂**（不同种）
  ];
  const hit = provokedBy(all, 0.5, 0, 0.5, 32, 'zombie_piglin');
  equal('只挑出"该惊动"的那 2 只', hit.length, 2);
  check('20 格的同伴在里面', hit.some((entry) => entry.x === 20.5));
  check('40 格的太远、不在', !hit.some((entry) => entry.x === 40.5));
  check('已经死了的不算', !hit.some((entry) => entry.x === 10.5));
  check('**不同种的不算**（旁边的恶魂看着同伴挨打并不生气）', !hit.some((entry) => entry.type.id === 'ghast'));

  // 半径是**三维**距离，不是"平面 32 格"
  equal('竖直方向 40 格同样不算（三维距离）', provokedBy([piglin(0.5, 40)], 0.5, 0, 0.5, 32, 'zombie_piglin').length, 0);

  // 边界：恰好 32 格以内算（`<=`），32 格外不算
  equal('恰好 32 格以内算', provokedBy([piglin(32.4)], 0.4, 0, 0, 32, 'zombie_piglin').length, 1);
  equal('32 格外不算', provokedBy([piglin(33)], 0, 0, 0, 32, 'zombie_piglin').length, 0);

  // `provoke()` 是"被打"之外的第二个入口，两者状态一样
  const bystander = new Mob(ZOMBIE_PIGLIN_TYPE, 0, 0, 0);
  check('同伴默认不记仇', !bystander.angry);
  bystander.provoke();
  check('`provoke()` 之后记仇（与"自己挨打"是同一个状态）', bystander.angry);
  const corpse = new Mob(ZOMBIE_PIGLIN_TYPE, 0, 0, 0);
  corpse.dead = true;
  corpse.provoke();
  check('已经死了的不会被惊动（免得白跑一圈）', !corpse.angry);
}

// ---------------------------------------------------------------- 4. 金子那条路

console.log('\n[它带来的那条金子路]');
{
  equal('金粒的中文名', itemLabel(Item.GOLD_NUGGET), '金粒');
  equal('金粒堆叠 64', maxStackOf(Item.GOLD_NUGGET), 64);
  equal('金剑的中文名', itemLabel(toolItemId('sword', 'golden')), '金剑');

  // 9 金粒 ↔ 1 金锭（原版两向都有；这条配方早就在，猪灵让它在生存里真的用得上）
  const nine = Array.from({ length: 9 }, () => Item.GOLD_NUGGET);
  equal('9 金粒 → 1 金锭', matchRecipe(nine, 3)?.id, Item.GOLD_INGOT);
  equal('1 金锭 → 9 金粒', matchRecipe([Item.GOLD_INGOT], 2)?.count, 9);
}

// ---------------------------------------------------------------- 5. 以物易物（批次 344）

console.log('\n[猪灵以物易物（批次 344）]');
{
  equal('表里有 9 项', BARTER_TABLE.length, 9);
  check('权重和大于 0', BARTER_TOTAL_WEIGHT > 0);
  equal('每项数量区间合法', BARTER_TABLE.every((e) => e.min >= 1 && e.max >= e.min), true);
  equal('每项都有中文名', BARTER_TABLE.every((e) => itemLabel(e.itemId).length > 0), true);

  // 用"落在某一项权重区间中点"的随机值，逐项验证选取边界
  let prefix = 0;
  for (const entry of BARTER_TABLE) {
    const r = (prefix + entry.weight / 2) / BARTER_TOTAL_WEIGHT;
    equal(`权重落在 ${itemLabel(entry.itemId)} 上`, barterRoll(() => r).itemId, entry.itemId);
    prefix += entry.weight;
  }
  equal('random=0 抽第一项', barterRoll(() => 0).itemId, BARTER_TABLE[0]!.itemId);
  equal('random=0 取数量下限', barterRoll(() => 0).count, BARTER_TABLE[0]!.min);
  const lastEntry = BARTER_TABLE[BARTER_TABLE.length - 1]!;
  equal('random≈1 抽最后一项', barterRoll(() => 0.999999).itemId, lastEntry.itemId);
  check('random≈1 不越过数量上限', barterRoll(() => 0.999999).count <= lastEntry.max);
  equal('金锭是交易货币（原版如此）', itemLabel(Item.GOLD_INGOT), '金锭');
}

console.log(`\n僵尸猪灵测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
