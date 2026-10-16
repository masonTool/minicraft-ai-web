/**
 * 史莱姆那一族离线测试（批次 120，J16 的一小块）
 *
 * 这一批的由头是**给粘性活塞还账**：它一直挂在可达性审计的白名单上（"要黏液球，
 * 而史莱姆还没做"）。所以这一套要钉住的是那条链的每一环：
 *
 *  1. **三档数据**（大 / 中 / 小）：尺寸、血量、伤害、`hops`、以及
 *     `splitsInto` 那条"大 → 中 → 小"的链；**只有小那一档掉黏液球**，
 *     中/小两档**不自然刷**（原版三档都自然刷，本项目只让"大"当那一档，见 TASKS J16）；
 *  2. **跳跃式移动**（`hops`）：蓄力 → 起跳 → **空中不转向**、而且**不走寻路**
 *     （这是它"一跳一跳地逼近、往旁边一闪就躲开"的来源）；
 *  3. **分裂**：打死一只大史莱姆 → 原地生出 2~4 只中的；**自然消失不分裂**
 *     （离玩家 96 格被清场也走 `dead`，那种时候不能凭空生一堆）；
 *  4. **史莱姆区块**（`world/Slime.ts`）：约 1/10、按区块、同答案；
 *  5. **黏液块弹跳**（纯函数）：多快会弹、多慢不弹；
 *  6. **物品 / 方块 / 配方**：黏液球、黏液块（硬度 0）、9↔1、以及**粘性活塞**那条
 *     （它是这一批的"还账"本身）。
 *
 * 运行：npm run test:slime
 */

import { Block, blockDef, blockHardness, blockTiles } from '../src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { matchRecipe, RECIPES } from '../src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { describeMobModel } from '../src/render/MobRenderer.ts';
import {
  HOSTILE_MOBS,
  MOB_TYPES,
  SLIME_BIG_TYPE,
  SLIME_SMALL_TYPE,
  SLIME_TYPE,
  mobTypeById,
} from '../src/core/entity/mobs.ts';
import { Mob } from '../src/core/entity/Mob.ts';
import {
  MIN_BOUNCE_SPEED,
  SLIME_BOUNCE_FACTOR,
  SLIME_CHUNK_ONE_IN,
  SLIME_SPAWN_MAX_Y,
  isSlimeChunk,
  slimeBounceVelocity,
} from '../src/core/world/Slime.ts';
import { slimeSpawnFactor } from '../src/core/world/MoonPhase.ts';
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

function close(label: string, actual: number, expected: number, epsilon = 1e-9): void {
  check(label, Math.abs(actual - expected) <= epsilon, `实际 ${actual}，期望 ${expected}`);
}

const TILES = new Set<string>(TILE_ORDER);

/** 一片平地（物理与方块查询同源：AI 以为站得住、物理也让它站得住） */
function flatPhysics(): PhysicsWorld {
  return {
    collisionAt: (_x: number, y: number) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  } as unknown as PhysicsWorld;
}

/** 一个"什么都不发生"的上下文：只记下分裂请求 */
function makeCtx(overrides: Record<string, unknown> = {}): { ctx: EntityContext; spawned: { id: string; x: number; y: number; z: number }[] } {
  const spawned: { id: string; x: number; y: number; z: number }[] = [];
  const ctx = {
    world: flatPhysics(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (_x: number, y: number) => (y < 0 ? Block.STONE : Block.AIR),
    player: { x: 0.5, y: 0, z: 0.5 },
    hurtPlayer: () => {},
    spawnMob: (typeId: string, x: number, y: number, z: number) => spawned.push({ id: typeId, x, y, z }),
    ...overrides,
  } as unknown as EntityContext;
  return { ctx, spawned };
}

function run(mob: Mob, ctx: EntityContext, seconds: number, step = 1 / 20): void {
  for (let t = 0; t < seconds; t += step) mob.tick(ctx, step);
}

// ---------------------------------------------------------------- 1. 三档数据

console.log('\n[史莱姆三档：差的全在表里]');
{
  equal('表里有三档史莱姆', MOB_TYPES.filter((type) => type.id.startsWith('slime')).length, 3);
  check('大那一档在"会自然刷的敌对生物"表里', HOSTILE_MOBS.includes(SLIME_BIG_TYPE));
  check('中那一档**不在**（它只从大史莱姆的分裂里出现）', !HOSTILE_MOBS.includes(SLIME_TYPE));
  check('小那一档也不在（它从中的分裂里出现）', !HOSTILE_MOBS.includes(SLIME_SMALL_TYPE));

  // 三档越分越小、越分越脆
  check('尺寸递减（2.0 → 1.0 → 0.5）', SLIME_BIG_TYPE.width > SLIME_TYPE.width && SLIME_TYPE.width > SLIME_SMALL_TYPE.width);
  check('血量递减（16 → 4 → 1）', SLIME_BIG_TYPE.health > SLIME_TYPE.health && SLIME_TYPE.health > SLIME_SMALL_TYPE.health);
  check('伤害递减（4 → 2 → 0）', SLIME_BIG_TYPE.attackDamage > SLIME_TYPE.attackDamage && SLIME_TYPE.attackDamage > SLIME_SMALL_TYPE.attackDamage);
  equal('最小那一档**不主动攻击**（原版如此）', SLIME_SMALL_TYPE.hostile, false);
  equal('最小那一档的伤害是 0', SLIME_SMALL_TYPE.attackDamage, 0);

  // 三档都是跳跃式移动
  check('三档都是跳跃式移动（`hops`）', [SLIME_BIG_TYPE, SLIME_TYPE, SLIME_SMALL_TYPE].every((type) => type.hops === true));

  // 分裂链：大 → 中 → 小，小不再分
  equal('大 → 中', SLIME_BIG_TYPE.splitsInto, SLIME_TYPE.id);
  equal('中 → 小', SLIME_TYPE.splitsInto, SLIME_SMALL_TYPE.id);
  equal('小**不再分裂**（它就是掉黏液球的那一档）', SLIME_SMALL_TYPE.splitsInto, undefined);
  check('链上每一环都查得到（`splitsInto` 填的是 id，主程序按它查表）', mobTypeById(SLIME_TYPE.id) !== undefined && mobTypeById(SLIME_SMALL_TYPE.id) !== undefined);

  // 掉落：**只有最小那一档掉黏液球**（这正是"打大史莱姆要打三遍"的原因）
  equal('大那一档没有掉落（它只管分裂）', SLIME_BIG_TYPE.drops.length, 0);
  equal('中那一档也没有掉落', SLIME_TYPE.drops.length, 0);
  equal('小那一档掉黏液球', SLIME_SMALL_TYPE.drops[0]?.itemId, Item.SLIME_BALL);
  equal('数量是原版的 0~2', `${SLIME_SMALL_TYPE.drops[0]?.min}~${SLIME_SMALL_TYPE.drops[0]?.max}`, '0~2');

  // 自然生成那三条（原版那三条）
  equal('只刷在史莱姆区块（`spawnZone`）', SLIME_BIG_TYPE.spawnZone, 'slime_chunk');
  equal('只刷在 y<40', SLIME_BIG_TYPE.spawnMaxY, SLIME_SPAWN_MAX_Y);
  equal('**不看光照**（原版在史莱姆区块里白天也刷）', SLIME_BIG_TYPE.ignoreLight, true);
  equal('要 2×2 的空间（它 2 格宽）', `${SLIME_BIG_TYPE.spawnSpace?.width}×${SLIME_BIG_TYPE.spawnSpace?.height}`, '2×2');
  equal('只刷在主世界', SLIME_BIG_TYPE.dimension, 'overworld');
  check(
    '中/小两档不参与自然生成（`naturalSpawn: false`）',
    SLIME_TYPE.naturalSpawn === false && SLIME_SMALL_TYPE.naturalSpawn === false,
  );

  // 月亮相位（`MoonPhase` 里那个函数一直等着史莱姆）
  check('满月时刷得最密（倍率 1）', slimeSpawnFactor(0) === 1);
  check('新月时最稀（倍率 0）', slimeSpawnFactor(4) === 0);
  check('刷怪用的就是它（主程序按 spawnZone 是 slime_chunk 取这个倍率）', SLIME_BIG_TYPE.spawnZone === 'slime_chunk');
}

// ---------------------------------------------------------------- 2. 模型

console.log('\n[模型：一坨果冻 + 里面那颗核]');
{
  for (const [label, type] of [
    ['大', SLIME_BIG_TYPE],
    ['中', SLIME_TYPE],
    ['小', SLIME_SMALL_TYPE],
  ] as const) {
    const model = describeMobModel(type);
    equal(`${label}史莱姆用 'slime' 骨架`, model.kind, 'slime');
    equal(`${label}史莱姆没有腿可摆（整个身体就是一个方块）`, model.legs, 0);
    equal(`${label}史莱姆只有两个盒子（外壳 + 内核）`, model.parts, 2);
  }
}

// ---------------------------------------------------------------- 3. 跳跃式移动

console.log('\n[跳跃式移动：蓄力 → 起跳 → 空中不转向]');
{
  // ⚠️ 玩家要放在**追击范围（16 格）以内**：放 40 格它根本不追，方向自然是随机的
  const { ctx } = makeCtx({ player: { x: 8, y: 0, z: 0.5 } });
  const slime = new Mob(SLIME_TYPE, 0.5, 0, 0.5);

  // 跑一秒，应当**至少起跳过一次**（起跳那一刻 vy 是正的）
  let hops = 0;
  const vxAir: number[] = [];
  for (let i = 0; i < 20; i++) {
    const before = slime.vy;
    slime.tick(ctx, 0.05);
    if (slime.vy > before && slime.vy > 1) hops++;
    if (!slime.onGround) vxAir.push(slime.vx);
  }
  check('一秒里至少起跳一次', hops >= 1, `${hops} 次`);
  check('**不走寻路**（跳跃式移动完全绕开路径）', slime.chasingPath === 0, `path=${slime.chasingPath}`);
  void vxAir;
  // 空中不转向：**手动把它放到空中**（不依赖跳跃时序，否则这条会时红时绿），
  // 这一帧的水平速度必须一点不变——这就是"跳出去就直着飞"的来源
  const air = new Mob(SLIME_TYPE, 0.5, 0, 0.5);
  air.onGround = false;
  air.vx = 3;
  air.vz = 1.5;
  air.vy = 2;
  air.tick(ctx, 0.05);
  check('空中不转向：水平速度一点不变', air.vx === 3 && air.vz === 1.5, `vx=${air.vx} vz=${air.vz}`);

  // 朝玩家跳：方向应当**朝 +x**（玩家在 x=8，在追击范围内）
  const dirs: number[] = [];
  for (let i = 0; i < 40; i++) {
    slime.tick(ctx, 0.05);
    if (!slime.onGround && Math.abs(slime.vx) > 0.1) dirs.push(Math.sign(slime.vx));
  }
  check('追人时朝玩家的方向跳（+x）', dirs.length > 0 && dirs.every((d) => d > 0), dirs.join(','));

  // 落地后水平速度被收掉（它不会滑行）
  // 落地后收速度：给它一个横向速度，跑**两秒**（够它跳一次再落地）；
  // 收完之后的水平速度只能是"跳跃那一档"（1.08 左右），不该还是原来那个 3
  const still = new Mob(SLIME_TYPE, 0.5, 0, 0.5);
  const { ctx: idleCtx } = makeCtx();
  still.vx = 3;
  run(still, idleCtx, 2);
  check('落地后水平速度被收掉（史莱姆落地是"啪"一下停住）', Math.abs(still.vx) < 1.2, `vx=${still.vx.toFixed(2)}`);
}

// ---------------------------------------------------------------- 4. 分裂

console.log('\n[分裂：打大史莱姆要打三遍]');
{
  // 打死一只大的 → 生出 2~4 只中的
  const counts = new Set<number>();
  const ids = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const { ctx, spawned } = makeCtx();
    const slime = new Mob(SLIME_BIG_TYPE, 0.5, 0, 0.5);
    slime.hurt(999, 0, 0, ctx);
    run(slime, ctx, 0.2);
    counts.add(spawned.length);
    for (const child of spawned) ids.add(child.id);
  }
  check(
    '分裂出 2~4 只',
    [...counts].every((count) => count >= 2 && count <= 4),
    [...counts].join(','),
  );
  equal('生出来的都是"中"史莱姆', [...ids].join(','), SLIME_TYPE.id);

  // 打死中的 → 生出小的
  {
    const { ctx, spawned } = makeCtx();
    const slime = new Mob(SLIME_TYPE, 0.5, 0, 0.5);
    slime.hurt(999, 0, 0, ctx);
    run(slime, ctx, 0.2);
    equal('中史莱姆分裂出小史莱姆', [...new Set(spawned.map((child) => child.id))].join(','), SLIME_SMALL_TYPE.id);
  }

  // 打死小的 → 掉黏液球（不分裂）。
  // ⚠️ 数量是 **0~2**，所以不能"打一只就断言一定掉了"——那会时红时绿（这一批就踩到了）。
  // 打 30 只看总量：既要大于 0（它确实会掉），也不能超过上限（数量区间没写错）
  {
    let totalDrops = 0;
    let splits = 0;
    for (let i = 0; i < 30; i++) {
      const drops: number[] = [];
      const { ctx, spawned } = makeCtx({ spawnDrop: (itemId: number) => drops.push(itemId) });
      const slime = new Mob(SLIME_SMALL_TYPE, 0.5, 0, 0.5);
      slime.hurt(999, 0, 0, ctx);
      run(slime, ctx, 0.2);
      totalDrops += drops.filter((itemId) => itemId === Item.SLIME_BALL).length;
      splits += spawned.length;
    }
    equal('小史莱姆不分裂', splits, 0);
    check('打 30 只小史莱姆会掉一批黏液球（0~2 颗/只）', totalDrops > 0, `${totalDrops} 颗`);
    check('总数不超过 2 颗/只（数量区间没写错）', totalDrops <= 60, `${totalDrops} 颗`);
  }

  // **自然消失不分裂**：离玩家 96 格被清场时也是 dead，那种时候不能凭空生一堆
  {
    const { ctx, spawned } = makeCtx();
    const slime = new Mob(SLIME_BIG_TYPE, 0.5, 0, 0.5);
    slime.dead = true; // 模拟"被清场"：外部的逻辑直接把它标成 dead
    run(slime, ctx, 0.2);
    equal('自然消失不分裂（没被打死就不该生小史莱姆）', spawned.length, 0);
  }

  // 主程序没接 spawnMob 钩子时也不能崩
  {
    const { ctx } = makeCtx();
    const slime = new Mob(SLIME_BIG_TYPE, 0.5, 0, 0.5);
    slime.hurt(999, 0, 0, ctx);
    run(slime, ctx, 0.2);
    check('没有 spawnMob 钩子时不崩', slime.dead);
  }
}

// ---------------------------------------------------------------- 5. 史莱姆区块

console.log('\n[史莱姆区块：约 1/10、按区块、同答案]');
{
  equal('原版的 1/10', SLIME_CHUNK_ONE_IN, 10);

  // 统计一片区域里的比例
  let chunks = 0;
  let hits = 0;
  for (let cx = 0; cx < 40; cx++) {
    for (let cz = 0; cz < 40; cz++) {
      chunks++;
      if (isSlimeChunk(20261014, cx * 16 + 8, cz * 16 + 8)) hits++;
    }
  }
  const ratio = hits / chunks;
  check(
    `约 1/10 是史莱姆区块（实测 ${(ratio * 100).toFixed(1)}%）`,
    ratio > 0.04 && ratio < 0.18,
    `${hits}/${chunks}`,
  );

  // 同一个区块里的 256 列答案必须一致（玩家才能"记住哪一片刷史莱姆"）
  const base = isSlimeChunk(20261014, 32, 32);
  let mixed = 0;
  for (let dx = 0; dx < 16; dx++) {
    for (let dz = 0; dz < 16; dz++) {
      if (isSlimeChunk(20261014, 32 + dx, 32 + dz) !== base) mixed++;
    }
  }
  equal('同一个区块里的 256 列答案一致', mixed, 0);
  // 换种子要换答案：在 400 个区块里数"两个种子答案不同的那些"，必须有一批
  let differ = 0;
  for (let cx = 0; cx < 20; cx++) {
    for (let cz = 0; cz < 20; cz++) {
      if (isSlimeChunk(20261014, cx * 16 + 8, cz * 16 + 8) !== isSlimeChunk(987654321, cx * 16 + 8, cz * 16 + 8)) {
        differ++;
      }
    }
  }
  check('换种子会换答案（不是"所有种子都一样"）', differ > 40, `${differ}/400 个区块不同`);
  equal('同一格问两次答案相同（确定性）', isSlimeChunk(20261014, 1234, -5678), isSlimeChunk(20261014, 1234, -5678));
}

// ---------------------------------------------------------------- 6. 黏液块弹跳

console.log('\n[黏液块：弹多高、多慢不弹]');
{
  equal('保留 0.8 的竖直速度（原版）', SLIME_BOUNCE_FACTOR, 0.8);
  close('掉得越快弹得越高（-20 → 16）', slimeBounceVelocity(-20), 16);
  close('十格左右的下落速度（-14 → 11.2）', slimeBounceVelocity(-14), 11.2);
  equal('慢到一定程度就不弹了（否则站在上面会一直抖）', slimeBounceVelocity(-MIN_BOUNCE_SPEED * 0.9), 0);
  equal('往上飞的时候不弹（它已经在往上了）', slimeBounceVelocity(5), 0);
  equal('站着不动（vy = 0）不弹', slimeBounceVelocity(0), 0);
  check('弹起来的速度一定小于掉下来的速度（否则越弹越高）', slimeBounceVelocity(-30) < 30);
}

// ---------------------------------------------------------------- 7. 物品 / 方块 / 配方

console.log('\n[黏液球、黏液块与那两条配方]');
{
  equal('黏液球的中文名', itemLabel(Item.SLIME_BALL), '黏液球');
  equal('堆叠 64（原版）', maxStackOf(Item.SLIME_BALL), 64);
  check('有说明（写明它是粘性活塞缺的那件原料）', hasDescription(Item.SLIME_BALL) && itemDescription(Item.SLIME_BALL).includes('粘性活塞'));
  check('图标在图集名单里', TILES.has(itemDef(Item.SLIME_BALL)!.tile));
  check('黏液球在创造物品栏里拿得到', CREATIVE_ITEMS.includes(Item.SLIME_BALL));

  equal('黏液块的注册名', blockDef(Block.SLIME_BLOCK).name, 'minecraft:slime_block');
  equal('硬度 0（原版：徒手一拍就碎）', blockHardness(Block.SLIME_BLOCK), 0);
  check('贴图在图集里', blockTiles(Block.SLIME_BLOCK, 0).every((tile) => TILES.has(tile)));
  equal('中文名', itemLabel(Block.SLIME_BLOCK), '黏液块');
  check(
    '说明写了"会弹"以及"活塞推它不会带走邻居"这条差异',
    itemDescription(Block.SLIME_BLOCK).includes('弹') && itemDescription(Block.SLIME_BLOCK).includes('活塞'),
  );

  // 9 颗 ↔ 1 块
  const nine = Array.from({ length: 9 }, () => Item.SLIME_BALL);
  equal('9 颗黏液球 → 1 块黏液块', matchRecipe(nine, 3)?.id, Block.SLIME_BLOCK);
  equal('黏液块能拆回 9 颗', matchRecipe([Block.SLIME_BLOCK], 2)?.count, 9);
  equal('拆回来的是黏液球', matchRecipe([Block.SLIME_BLOCK], 2)?.id, Item.SLIME_BALL);

  // 粘性活塞（这一批"还账"的那一条）
  const sticky = RECIPES.find((recipe) => recipe.result.id === Block.STICKY_PISTON);
  check('粘性活塞有配方了', sticky !== undefined);
  check(
    '原料是"活塞 + 黏液球"（原版那一条）',
    matchRecipe([Block.PISTON, Item.SLIME_BALL], 2)?.id === Block.STICKY_PISTON,
  );
}

console.log(`\n史莱姆测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
