/**
 * 溺尸与三叉戟离线测试（批次 123，J15 的下一只）
 *
 * 溺尸是**僵尸的水生变体**，但它顺手带出了本项目的一件新装备——**三叉戟**。
 * 所以这一套分两大半：
 *
 *  1. **溺尸本体**：20 血 / 近战 3（与僵尸同）/ 亡灵家族；三处招牌各占一根数据线：
 *     **在水里刷**（`spawnInWater`）、**扔三叉戟**（`ranged` + `throwsTrident`）、
 *     **掉三叉戟**（原版 15% 带 × 8.5% 掉 = 每只 1.275%，见数据表那条注记）；
 *  2. **三叉戟**（物品 + 投掷物 + 近战武器）：
 *     - **近战 9 点**（走 `TRIDENT_INFO`，所以 `main.heldTool` 认得它）；
 *     - **右键能扔**（8 点伤害），而且它——**唯一一个两边都能打的投掷物**：
 *       玩家扔的砸生物、溺尸扔的砸玩家（靠 `fromPlayer` 分流）；
 *     - 落地**掉回地上**（所以能捡回来——这是"能重复使用"的那一环）；
 *     - **没有配方**（原版也做不出来，只能从溺尸手里捡）。
 *
 * 运行：npm run test:drowned
 */

import { Block } from '../src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';
import { TRIDENT_ITEM_ID, toolInfoById } from '../src/core/registry/tools.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { describeMobModel } from '../src/render/MobRenderer.ts';
import { DROWNED_TYPE, HOSTILE_MOBS, MOB_TYPES, mobTypeById } from '../src/core/entity/mobs.ts';
import { Mob } from '../src/core/entity/Mob.ts';
import { MobSpawner, type SpawnContext } from '../src/core/entity/MobSpawner.ts';
import {
  TRIDENT_THROW_DAMAGE,
  THROWABLE_LIFETIME,
  Throwable,
} from '../src/core/entity/Throwable.ts';
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

const TILES = new Set<string>(TILE_ORDER);

/** 一片平地 */
function flatPhysics(): PhysicsWorld {
  return {
    collisionAt: (_x: number, y: number) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  } as unknown as PhysicsWorld;
}

/** 一个记录"扔了什么 / 谁挨了几下 / 掉了什么"的上下文 */
function makeCtx(overrides: Record<string, unknown> = {}): {
  ctx: EntityContext;
  rec: { arrows: number; tridents: number; playerHits: { amount: number; cause: string }[]; drops: number[] };
} {
  const rec = {
    arrows: 0,
    tridents: 0,
    playerHits: [] as { amount: number; cause: string }[],
    drops: [] as number[],
  };
  const ctx = {
    world: flatPhysics(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (_x: number, y: number) => (y < 0 ? Block.STONE : Block.AIR),
    player: { x: 0.5, y: 0, z: 0.5 },
    hurtPlayer: (amount: number, _x: number, _z: number, cause = 'generic') =>
      rec.playerHits.push({ amount, cause }),
    spawnDrop: (itemId: number) => rec.drops.push(itemId),
    spawnArrow: () => {
      rec.arrows++;
    },
    spawnTrident: () => {
      rec.tridents++;
    },
    ...overrides,
  } as unknown as EntityContext;
  return { ctx, rec };
}

function run(mob: Mob, ctx: EntityContext, seconds: number, step = 1 / 20): void {
  for (let t = 0; t < seconds; t += step) mob.tick(ctx, step);
}

// ---------------------------------------------------------------- 1. 溺尸的数据

console.log('\n[溺尸：僵尸的水生变体]');
{
  equal('名字', DROWNED_TYPE.name, '溺尸');
  equal('20 点生命（与僵尸同）', DROWNED_TYPE.health, 20);
  equal('近战 3 点（与僵尸同——原版溺尸的威胁在扔三叉戟，不在贴脸）', DROWNED_TYPE.attackDamage, 3);
  equal('（对照）僵尸也是 3', mobTypeById('zombie')!.attackDamage, 3);
  equal('亡灵家族', DROWNED_TYPE.family, 'undead');
  equal('击杀经验 5', DROWNED_TYPE.xp, 5);
  equal('在主世界（它的名字就来自"溺水"）', DROWNED_TYPE.dimension, 'overworld');
  check('在"会自然刷的敌对生物"表里', HOSTILE_MOBS.includes(DROWNED_TYPE));
  check('生物表里有它', MOB_TYPES.includes(DROWNED_TYPE) && mobTypeById('drowned') !== undefined);

  // 三处招牌各占一根数据线
  check('**只在水中刷**（`spawnInWater`）', DROWNED_TYPE.spawnInWater === true);
  check('**会远程攻击**（配了 `ranged`）', DROWNED_TYPE.ranged !== undefined);
  equal('射程 12 格（比骷髅短：它在水里，看不清远处）', DROWNED_TYPE.ranged?.range, 12);
  check('**扔的是三叉戟**（`throwsTrident`）', DROWNED_TYPE.throwsTrident === true);
  // 批次 235：只有约 15% 的溺尸带着三叉戟，而且扔出去就没了。
  // 不写这一条的话，2.5 秒冷却的远程 AI 就是个无限三叉戟生成器（海面会漂满三叉戟）
  check(
    '只有约 15% 的溺尸带三叉戟（`tridentChance`）',
    DROWNED_TYPE.tridentChance === 0.15,
    String(DROWNED_TYPE.tridentChance),
  );
  check('（对照）骷髅**不**扔三叉戟', mobTypeById('skeleton')!.throwsTrident !== true);

  // 掉落：腐肉 + 三叉戟（原版 15% × 8.5%）
  const tridentDrop = DROWNED_TYPE.drops.find((drop) => drop.itemId === Item.TRIDENT);
  equal('掉三叉戟', tridentDrop !== undefined, true);
  check(
    '概率是原版那两个数的乘积（15% 带 × 8.5% 掉 ≈ 1.275%）',
    Math.abs((tridentDrop?.chance ?? 0) - 0.15 * 0.085) < 1e-9,
    String(tridentDrop?.chance),
  );
  equal(
    '概率项写成 `min:1,max:1`（不然数量也掷一次，概率会被砍半）',
    `${tridentDrop?.min}~${tridentDrop?.max}`,
    '1~1',
  );
  equal('腐肉 0~2 / 80%（与僵尸同）', `${DROWNED_TYPE.drops[0]?.min}~${DROWNED_TYPE.drops[0]?.max}`, '0~2');

  // 模型：通用人形
  const model = describeMobModel(DROWNED_TYPE);
  equal('模型是通用人形', model.kind, 'humanoid');
  equal('两条腿', model.legs, 2);
}

// ---------------------------------------------------------------- 2. 三叉戟这件物品

console.log('\n[三叉戟：只能从溺尸手里捡的那件武器]');
{
  equal('物品 id 与 `tools.ts` 里那一份一致', Item.TRIDENT, TRIDENT_ITEM_ID);
  equal('中文名', itemLabel(Item.TRIDENT), '三叉戟');
  equal('**不可堆叠**（原版如此：它是武器不是材料）', maxStackOf(Item.TRIDENT), 1);
  check('有说明', hasDescription(Item.TRIDENT));
  check(
    '说明写了"溺尸掉 / 近战 9 / 能扔出去砸 8 点"',
    ['溺尸', '9', '扔'].every((word) => itemDescription(Item.TRIDENT).includes(word)),
    itemDescription(Item.TRIDENT),
  );
  check('图标在图集名单里', TILES.has(itemDef(Item.TRIDENT)!.tile));
  check('创造物品栏里拿得到', CREATIVE_ITEMS.includes(Item.TRIDENT));

  // 近战：**必须登记进 `TOOL_BY_ID`**，否则 `main.heldTool` 会把它当"手上没东西"
  const info = toolInfoById(Item.TRIDENT);
  check('`toolInfoById` 认得它（不认得的话近战伤害会按徒手 1 点算）', info !== undefined);
  equal('近战 9 点（原版；比下界合金剑的 8 还高）', info?.attack, 9);
  equal('耐久 250（与铁制工具同档）', info?.durability, 250);
  equal('采集档位与徒手相同（拿它挖石头并不比手快）', info?.tier, 0);
  check('（对照）它不在"5 种类 × 5 材质"那张表里', info?.type === 'trident');

  // **刻意不做配方**：原版也做不出来，只能从溺尸手里捡。
  // 这条断言是给未来的人看的：谁"顺手"给它加一条合成表，它会红
  check(
    '**没有配方**（原版也做不出来——它是"打出来的"，不是"做出来的"）',
    !RECIPES.some((recipe) => recipe.result.id === Item.TRIDENT),
    '有配方了：那与原版不符，要么改这条断言、要么把配方删掉',
  );
}

// ---------------------------------------------------------------- 3. 投掷物：两边都能打

console.log('\n[三叉戟的投掷：唯一一个"两边都能打"的投掷物]');
{
  equal('投掷伤害 8 点（原版；与近战 9 分开）', TRIDENT_THROW_DAMAGE, 8);

  // ---- 玩家扔的：砸生物
  const zombie = new Mob(mobTypeById('zombie')!, 2, 1, 0.5);
  const healthBefore = zombie.health;
  const { ctx: mobCtx } = makeCtx({ hitMob: () => zombie });
  const playerTrident = new Throwable(0.5, 1, 0.5, { x: 30, y: 0, z: 0 }, {
    kind: 'trident',
    itemId: Item.TRIDENT,
  });
  check('玩家扔的默认是"玩家扔的"', playerTrident.fromPlayer);
  playerTrident.tick(mobCtx, 0.02);
  equal('命中生物：掉 8 点', zombie.health, healthBefore - TRIDENT_THROW_DAMAGE);
  check('三叉戟命中后消失', playerTrident.dead);

  // ---- 玩家扔的**不会**打玩家（它只砸生物那一侧）
  const zombie2 = new Mob(mobTypeById('zombie')!, 2, 1, 0.5);
  const { ctx: bothCtx, rec: bothRec } = makeCtx({
    hitMob: () => zombie2,
    playerBox: boxAt(0.5, 1, 0.5, 0.6, 1.8),
  });
  const towardPlayer = new Throwable(0.5, 1, 0.5, { x: 0.01, y: 0, z: 0 }, {
    kind: 'trident',
    itemId: Item.TRIDENT,
  });
  towardPlayer.tick(bothCtx, 0.02);
  equal('玩家扔的三叉戟不会伤到玩家自己', bothRec.playerHits.length, 0);

  // ---- 溺尸扔的：砸玩家
  const { ctx: drownedCtx, rec: drownedRec } = makeCtx({ playerBox: boxAt(0.5, 1, 0.5, 0.6, 1.8) });
  const mobTrident = new Throwable(0.5, 1, 0.5, { x: 0.01, y: 0, z: 0 }, {
    kind: 'trident',
    itemId: Item.TRIDENT,
    fromPlayer: false,
  });
  check('溺尸扔的那一支标记为"不是玩家扔的"', !mobTrident.fromPlayer);
  mobTrident.tick(drownedCtx, 0.02);
  check('打到玩家', drownedRec.playerHits.length === 1, `${drownedRec.playerHits.length} 次`);
  equal('伤害 8 点', drownedRec.playerHits[0]?.amount, TRIDENT_THROW_DAMAGE);
  equal('伤害类型是 `projectile`（于是"弹射物保护"能减它）', drownedRec.playerHits[0]?.cause, 'projectile');

  // ---- 落地：**掉回地上**（所以能捡回来）。
  // ⚠️ 要给一面墙：`makeCtx` 默认的世界只有"脚下一层石头"，平着飞的三叉戟什么都不撞
  // （第一版就是这样，四条断言全红）
  const wall = (overrides: Record<string, unknown> = {}) =>
    makeCtx({
      getBlock: (x: number, y: number) => (x >= 4 || y < 0 ? Block.STONE : Block.AIR),
      ...overrides,
    });
  const { ctx: landCtx, rec: landRec } = wall();
  const landed = new Throwable(0.5, 1, 0.5, { x: 30, y: 0, z: 0 }, {
    kind: 'trident',
    itemId: Item.TRIDENT,
  });
  // ⚠️ 要 tick 到撞上为止（它一秒飞 30 格，一帧只走 0.6 格）
  for (let t = 0; t < 1 && !landed.dead; t += 0.02) landed.tick(landCtx, 0.02);
  check('撞到方块就停下', landed.dead);
  equal('并且原地掉回一把三叉戟（能捡回来）', landRec.drops[0], Item.TRIDENT);
  equal('只掉一把', landRec.drops.length, 1);

  // ---- 溺尸扔的那一支落地同样掉（原版如此：捡它扔的也是一条路）
  const { ctx: mobLandCtx, rec: mobLandRec } = wall();
  const mobLanded = new Throwable(0.5, 1, 0.5, { x: 30, y: 0, z: 0 }, {
    kind: 'trident',
    itemId: Item.TRIDENT,
    fromPlayer: false,
  });
  for (let t = 0; t < 1 && !mobLanded.dead; t += 0.02) mobLanded.tick(mobLandCtx, 0.02);
  equal('溺尸扔的那一支落地也掉一把', mobLandRec.drops[0], Item.TRIDENT);

  // ---- 飞太久自然消失（不会永远挂在世界里）
  const { ctx: skyCtx } = makeCtx();
  const flying = new Throwable(0.5, 200, 0.5, { x: 5, y: 0, z: 0 }, {
    kind: 'trident',
    itemId: Item.TRIDENT,
  });
  for (let t = 0; t < THROWABLE_LIFETIME + 0.5; t += 0.05) flying.tick(skyCtx, 0.05);
  check('没碰到任何东西也会超时消失', flying.dead);
}

// ---------------------------------------------------------------- 4. 溺尸的 AI：扔三叉戟而不是箭

console.log('\n[溺尸的远程攻击：扔的是三叉戟，不是箭]');
{
  const { ctx, rec } = makeCtx({ player: { x: 8.5, y: 0, z: 0.5 } });
  const drowned = new Mob(DROWNED_TYPE, 0.5, 0, 0.5);
  // 构造时是按 15% 掷点的，测试要可控 ⇒ 显式给它一支
  drowned.hasTrident = true;
  run(drowned, ctx, 6);
  check('会扔三叉戟', rec.tridents > 0, `扔了 ${rec.tridents} 次`);
  equal('**一支箭都不射**（分流只有一个出口）', rec.arrows, 0);

  // 批次 235：一只溺尸只有一支，扔出去就没了（原版如此）
  equal('6 秒内只扔 1 支（不会每 2.5 秒凭空造一支）', rec.tridents, 1);
  equal('扔完 hasTrident 变成 false', drowned.hasTrident, false);

  // 没带三叉戟的那种（原版约 85%）：一支都不扔，但**贴上来照样打人**
  const { ctx: bareCtx, rec: bareRec } = makeCtx({ player: { x: 1.5, y: 0, z: 0.5 } });
  const bare = new Mob(DROWNED_TYPE, 0.5, 0, 0.5);
  bare.hasTrident = false;
  run(bare, bareCtx, 6);
  equal('没带三叉戟就不扔', bareRec.tridents, 0);
  equal('也不射箭（对照）', bareRec.arrows, 0);
  check('但近战照样打人（不是站在原地看着玩家）', bareRec.playerHits.length > 0, `${bareRec.playerHits.length} 下`);

  // ⚠️ 这条守的是批次 123 踩到的那次"两个出口"：把新分支加在旧的 `spawnArrow` 下面，
  // 结果骷髅每次冷却射两箭（`test:mob` 的"3 秒最多两箭"当场抓走）。
  // 反向也验一遍：骷髅射箭、不扔三叉戟
  const { ctx: skelCtx, rec: skelRec } = makeCtx({ player: { x: 8.5, y: 0, z: 0.5 } });
  const skeleton = new Mob(mobTypeById('skeleton')!, 0.5, 0, 0.5);
  run(skeleton, skelCtx, 6);
  check('骷髅射箭', skelRec.arrows > 0, `${skelRec.arrows} 次`);
  equal('骷髅不扔三叉戟（对照）', skelRec.tridents, 0);
}

// ---------------------------------------------------------------- 5. 刷怪：只在水里

console.log('\n[刷怪：溺尸只在水里出现]');
{
  /** 一个"从 y=64 往下三格是水、再往下是石头"的世界 */
  const waterWorld = (): SpawnContext => ({
    getBlock: (_x: number, y: number, _z: number) =>
      y >= 61 && y <= 63 ? Block.WATER : y < 61 ? Block.STONE : Block.AIR,
    getSkyLight: () => 0,
    getBlockLight: () => 0,
    getSurfaceBlockY: () => 63,
    player: { x: 0.5, y: 62, z: 0.5 },
    spawn: (type, _x, y, _z) => {
      spawned.push({ id: type.id, y });
    },
    hostileCount: 0,
    passiveCount: 0,
  });
  const spawned: { id: string; y: number }[] = [];
  const spawner = new MobSpawner();
  // ⚠️ 刷怪位置随机在玩家周围 16~48 格，所以要跑多轮才碰得到那片水
  for (let i = 0; i < 60; i++) spawner.update(2, waterWorld());

  check('水里刷得出溺尸', spawned.some((entry) => entry.id === 'drowned'), `${spawned.length} 只`);
  check(
    '刷出来的溺尸都在水里（y 落在 61~63 那三格水柱里）',
    spawned.filter((entry) => entry.id === 'drowned').every((entry) => entry.y >= 61 && entry.y <= 63),
    spawned.map((entry) => entry.y).join(','),
  );
  equal(
    '**水里刷不出僵尸**（它要"脚下实心 + 两格空气"，水里两条都不满足）',
    spawned.filter((entry) => entry.id === 'zombie').length,
    0,
  );
}

console.log(`\n溺尸与三叉戟测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
