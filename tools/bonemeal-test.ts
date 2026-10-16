/**
 * 骨粉离线测试（批次 69，B42 / H13）
 *
 * 这一批做的是"一件物品 + 一条使用规则"：
 *  1. **物品与配方**：骨粉（`minecraft:bone_meal`，1077）由**1 根骨头磨成 3 份**（原版）；
 *  2. **施肥规则**（`world/BoneMeal.ts` 的纯函数 `fertilizeAt`）：对一格作物推进
 *     **2~5 个阶段**（原版 `CropBlock#performBonemeal` 的 `nextInt(2, 5)`）、**截到成熟**、
 *     不检查光照与耕地、成熟/非作物一律**失败且什么都不改**（失败就不消耗，原版口径）；
 *  3. **接线**：玩家右键与**发射器**（行为表里的 `fertilize`）走同一个方法。
 *
 * 断言分四块：物品与配方 / 施肥规则 / 边界（失败语义）/ 发射器那一档。
 *
 * 运行：npm run test:bonemeal
 */

import { Block, CROP_STAGES, cropOf, berryStageOf } from '../src/core/registry/blocks.ts';
import { Item, categoryOf, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import {
  BONE_MEAL_MAX_STAGES,
  BONE_MEAL_MIN_STAGES,
  fertilizeAt,
  type BoneMealWorld,
} from '../src/core/world/BoneMeal.ts';
import { dispenseBehaviorFor } from '../src/core/registry/dispense.ts';
import { runDispenseAction, type DispenseContext } from '../src/core/world/Dispense.ts';

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

/** 常量随机源（钉住"推进几阶"两条边界） */
const alwaysLow = (): number => 0;
const alwaysHigh = (): number => 0.999999;

/** 只实现两个方法的假世界：**只要这两个**，正好证明施肥不看光照/耕地那些信息 */
class FakeWorld implements BoneMealWorld {
  readonly writes: { x: number; y: number; z: number; blockId: number }[] = [];
  constructor(private readonly cells: Map<string, number> = new Map()) {}

  at(x: number, y: number, z: number, blockId: number): this {
    this.cells.set(`${x},${y},${z}`, blockId);
    return this;
  }

  getBlock(x: number, y: number, z: number): number {
    return this.cells.get(`${x},${y},${z}`) ?? Block.AIR;
  }

  setBlock(x: number, y: number, z: number, blockId: number): void {
    this.cells.set(`${x},${y},${z}`, blockId);
    this.writes.push({ x, y, z, blockId });
  }
}

/** 线性同余随机源：同一序列永远跑出同一结果（统计断言既不飘也不假） */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const WHEAT = CROP_STAGES.wheat!;
/** 一格小麦（第 0 阶段）在 (0, 64, 0)、下面是有耕地的世界 */
function wheatWorld(stage = 0): FakeWorld {
  return new FakeWorld().at(0, 63, 0, Block.FARMLAND).at(0, 64, 0, WHEAT[stage]!);
}

// ---------------------------------------------------------------- 1. 物品与配方

console.log('\n[物品：骨粉]');
{
  equal('物品 id 是 1077（接在弓之后）', Item.BONE_MEAL, 1077);
  equal('注册名', itemDef(Item.BONE_MEAL)?.name, 'minecraft:bone_meal');
  equal('中文名', itemLabel(Item.BONE_MEAL), '骨粉');
  check('有物品说明', hasDescription(Item.BONE_MEAL));
  equal('可堆叠 64（原版）', maxStackOf(Item.BONE_MEAL), 64);
  equal('分类与骨头同档（都不在任何一套集合里 → 矿石与材料）', categoryOf(Item.BONE_MEAL), categoryOf(Item.BONE));
  const tile = itemDef(Item.BONE_MEAL)?.tile ?? '';
  check(`图标那张贴图在图集里（${tile}）`, TILE_ORDER.includes(tile as never));
}

console.log('\n[配方：1 根骨头 → 3 份骨粉]');
{
  // 无序配方：格子数组里只要出现这些材料就行（3×3 的第 0 格开始放）
  equal('放进 1 根骨头 → 出 3 份骨粉', matchRecipe([Item.BONE], 3)?.id, Item.BONE_MEAL);
  equal('出 3 份', matchRecipe([Item.BONE], 3)?.count, 3);
  equal('放进 2 根骨头合不出来（原版是 1 → 3）', matchRecipe([Item.BONE, Item.BONE], 3), null);
  equal('骨粉自己不能再合成骨粉（对照）', matchRecipe([Item.BONE_MEAL], 3), null);
  check('骨头仍然没有发射行为（发射的是骨粉，不是骨头）', dispenseBehaviorFor(Item.BONE) === undefined);
}

// ---------------------------------------------------------------- 2. 施肥规则

console.log('\n[施肥：一次推进 2~5 个阶段]');
{
  equal('下界是 2（原版 nextInt(2, 5) 的下界）', BONE_MEAL_MIN_STAGES, 2);
  equal('上界是 5（闭区间）', BONE_MEAL_MAX_STAGES, 5);

  const low = wheatWorld(0);
  check('随机数落到最小 → 施肥成功', fertilizeAt(low, 0, 64, 0, alwaysLow));
  equal('推进 2 个阶段（0 → 2）', low.getBlock(0, 64, 0), WHEAT[2]);
  equal('只写了一格', low.writes.length, 1);
  equal('写的是那一格', `${low.writes[0]!.x},${low.writes[0]!.y},${low.writes[0]!.z}`, '0,64,0');

  const high = wheatWorld(0);
  check('随机数落到最大 → 施肥成功', fertilizeAt(high, 0, 64, 0, alwaysHigh));
  equal('推进 5 个阶段 → **截到成熟**（小麦只有 4 阶）', high.getBlock(0, 64, 0), WHEAT[3]);

  // 中段：从第 1 阶推 2 阶 → 第 3 阶（成熟）
  const mid = wheatWorld(1);
  fertilizeAt(mid, 0, 64, 0, alwaysLow);
  equal('第 1 阶 + 2 → 第 3 阶（成熟）', mid.getBlock(0, 64, 0), WHEAT[3]);
  check('成熟的那一阶就是最后一阶', cropOf(mid.getBlock(0, 64, 0))?.ripe === true);

  // 四种耕地作物都能催，而且**不会串种**
  for (const [name, stages] of Object.entries(CROP_STAGES)) {
    const world = new FakeWorld().at(5, 64, 5, stages[0]!);
    const ok = fertilizeAt(world, 5, 64, 5, alwaysLow);
    const after = world.getBlock(5, 64, 5);
    check(
      `${name}：能从第 0 阶催到第 2 阶且不串种`,
      ok && after === stages[2] && cropOf(after)?.crop === name,
      `实际 ${after}`,
    );
  }

  // 推进的**步数**在 2~5 之间均匀分布。小麦只有 4 阶（0~3），所以从第 0 阶出发时
  // 落点只有两种：走 2 步停在 2 阶（1/4），走 3~5 步都被**截**到成熟（3/4）。
  // 这个"3/4 落在成熟"的比例正好能反推出步数区间是 2~5（若是 1~3 会是 1/2，若是 2~2 会是 1）——
  // 截断把上限藏起来了，所以统计断言要按"截断之后"来写。
  const random = lcg(20261016);
  const landing = [0, 0, 0, 0];
  let minStep = 99;
  let maxStep = -1;
  const rounds = 4000;
  for (let i = 0; i < rounds; i++) {
    const world = wheatWorld(0);
    fertilizeAt(world, 0, 64, 0, random);
    const stage = cropOf(world.getBlock(0, 64, 0))!.stage;
    landing[stage] = (landing[stage] ?? 0) + 1;
    minStep = Math.min(minStep, stage);
    maxStep = Math.max(maxStep, stage);
  }
  equal('不会一步都不走（最少也推 2 阶）', minStep, 2);
  equal('实际落点最大就是成熟那一阶', maxStep, WHEAT.length - 1);
  check('走 2 步的比例约 1/4（=> 步数区间是 2~5，四档等概率）', Math.abs(landing[2]! / rounds - 0.25) < 0.03, `${(landing[2]! / rounds).toFixed(3)}`);
  check('落在成熟那一阶的比例约 3/4', Math.abs(landing[3]! / rounds - 0.75) < 0.03, `${(landing[3]! / rounds).toFixed(3)}`);
  equal('没有别的位置出现过', landing[0]! + landing[1]!, 0);
}

// ---------------------------------------------------------------- 3. 边界：失败时什么都不改

console.log('\n[失败语义：不该催的一律不消耗、也不改世界]');
{
  const ripe = wheatWorld(3);
  check('已经成熟的小麦 → 施肥失败', !fertilizeAt(ripe, 0, 64, 0, alwaysHigh));
  equal('失败时没有写任何东西（调用方据此不消耗骨粉）', ripe.writes.length, 0);

  for (const [name, blockId] of [
    ['石头', Block.STONE],
    ['空气', Block.AIR],
    ['水', Block.WATER],
    ['耕地', Block.FARMLAND],
    ['成熟的小麦（另一格）', WHEAT[3]!],
  ] as const) {
    const world = new FakeWorld().at(1, 64, 1, blockId);
    check(`对着${name}施肥 → 失败`, !fertilizeAt(world, 1, 64, 1, alwaysHigh));
    equal(`  ${name}：世界没被改`, world.writes.length, 0);
  }

  // 原版不检查光照与耕地：下方没有耕地也照样能催（耕地被挖掉的作物不会因此"免疫骨粉"）
  const floating = new FakeWorld().at(2, 64, 2, WHEAT[0]!);
  check('悬空的作物（下方是空气）也能催', fertilizeAt(floating, 2, 64, 2, alwaysLow));

  // 还没接上的那一批（本批只做四种耕地作物，原版还能催别的）
  const berry = new FakeWorld().at(3, 64, 3, Block.SWEET_BERRY_BUSH_STAGE0 + 1);
  check('甜浆果丛还不能催（原版可以，记在 TASKS B42）', !fertilizeAt(berry, 3, 64, 3, alwaysHigh));
  check('确认那真的是甜浆果丛的一个阶段（免得这条断言写空）', berryStageOf(Block.SWEET_BERRY_BUSH_STAGE0 + 1) === 1);
  const cocoa = new FakeWorld().at(4, 64, 4, Block.COCOA_STAGE0);
  check('可可豆还不能催（同上）', !fertilizeAt(cocoa, 4, 64, 4, alwaysHigh));
}

// ---------------------------------------------------------------- 4. 发射器那一档

console.log('\n[发射器：骨粉 → 给凸口那一格施肥]');
{
  const behavior = dispenseBehaviorFor(Item.BONE_MEAL);
  equal('行为表认骨粉', behavior?.action, 'fertilize');
  check('文案写给玩家看（界面上会用到）', (behavior?.cn ?? '').length > 0);
  equal('骨粉不是"射/扔"那一档（没有投射物类型）', behavior?.projectile, undefined);
  equal('也不磨耐久（整件用掉）', behavior?.wear, undefined);

  /** 只盯 "施没施肥、施在哪一格" 的假上下文 */
  function fakeContext(options: { fertilizeOk?: boolean } = {}) {
    const calls: string[] = [];
    const ctx: DispenseContext = {
      blockAt: () => Block.AIR,
      shootArrow: () => {},
      throwProjectile: () => {},
      primeTnt: () => true,
      igniteFire: () => true,
      shearAt: () => 0,
      fertilizeAt: (x, y, z) => {
        calls.push(`${x},${y},${z}`);
        return options.fertilizeOk ?? true;
      },
      playSound: () => {},
    };
    return { ctx, calls };
  }

  const hit = fakeContext();
  check(
    '施肥成功 → 执行器返回 true（主程序据此消耗这一份）',
    runDispenseAction(behavior!, { id: Item.BONE_MEAL, count: 1 }, 10, 64, 10, 0, 0, -1, hit.ctx),
  );
  equal('施的是**凸口正对的那一格**（朝北 → z-1）', hit.calls.join('|'), '10,64,9');

  const miss = fakeContext({ fertilizeOk: false });
  check(
    '那一格不能催 → 执行器返回 false（失败的这份骨粉**留着**）',
    !runDispenseAction(behavior!, { id: Item.BONE_MEAL, count: 1 }, 10, 64, 10, 0, -1, 0, miss.ctx),
  );
  equal('失败时也确实去问了那一格（朝下 → y-1）', miss.calls.join('|'), '10,63,10');
}

console.log(`\n骨粉测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
