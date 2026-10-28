/**
 * 铜的氧化（批次 40）离线测试
 *
 * 原版 1.17 的"铜会锈"：铜方块随时间在四档之间推进（新铜 → 斑驳 → 锈蚀 → 氧化），
 * 已经锈了的铜会带动旁边一起锈，斧头右键能把锈刮掉一层。
 *
 * 覆盖五块：
 *  1. 注册与贴图：16 个方块（4 档 × 4 种形状）、名字、分类、中文名与说明
 *  2. 氧化阶梯：下一档 / 上一档（刮锈）的 id 算术，最后一档与第一档的边界
 *  3. 氧化行为：随机刻的概率门槛、"锈会传染"、自启动、已锈到底就不动
 *  4. 材料：硬度 3、要石镐（木镐挖得动但一无所获）
 *  5. 配方：9 铜锭 ↔ 1 铜块、4 铜块 → 4 切制铜、3 → 6 台阶、6 → 4 楼梯（四档都要能合）
 *
 * 运行：npm run test:copper
 */

import { BLOCKS, Block, COPPER_ID_START, COPPER_STAGES, blockDef, blockHardness, copperId } from '../web/src/core/registry/blocks.ts';
import { canHarvest, makeToolInfo } from '../web/src/core/registry/tools.ts';
import { CREATIVE_ITEMS, Item, categoryOf } from '../web/src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../web/src/core/registry/itemNames.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import {
  COPPER_IDS,
  COPPER_SELF_START_CHANCE,
  COPPER_STAGE_COUNT,
  COPPER_WEATHER_CHANCE,
  copperWeatherBehavior,
  isCopperBlock,
  nextOxidation,
  oxidationStageOf,
  scrapeResult,
} from '../web/src/core/world/Copper.ts';
import { RANDOM_TICK_BEHAVIORS, type TickWorld } from '../web/src/core/tick/RandomTicks.ts';
import { RECIPES, matchRecipe } from '../web/src/core/crafting/Recipes.ts';

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

/** 构造 size×size 的扁平网格，'·' 表示空 */
function grid(size: 2 | 3, rows: readonly string[], legend: Record<string, number>): number[] {
  const cells = new Array<number>(size * size).fill(0);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]!;
      if (ch === '·') continue;
      cells[r * size + c] = legend[ch] ?? 0;
    }
  }
  return cells;
}

const TILES = new Set<string>(TILE_ORDER);
const STAGE_CN = ['铜块', '斑驳的铜块', '锈蚀的铜块', '氧化的铜块'];
const CUT_CN = ['切制铜', '斑驳的切制铜', '锈蚀的切制铜', '氧化的切制铜'];

// ---------------------------------------------------------------- 1. 注册与贴图

console.log('\n[注册：4 档 × 4 种形状 = 16 个方块]');
{
  equal('氧化档数', COPPER_STAGE_COUNT, 4);
  equal('铜方块总数', COPPER_IDS.length, 16);
  equal('id 从起点连续排到 350', COPPER_IDS.join(','), Array.from({ length: 16 }, (_v, i) => COPPER_ID_START + i).join(','));
  check('每个 id 都能在方块表里按下标取到', COPPER_IDS.every((id) => BLOCKS[id] !== undefined && BLOCKS[id]!.id === id));
  check('id 之后没有断号', COPPER_IDS.every((id) => BLOCKS[id + 1] === undefined || BLOCKS[id + 1]!.id === id + 1));
  equal('第一档铜块的 id 就是起点', copperId(0, 0), COPPER_ID_START);
  equal('第 2 档切制铜的 id', copperId(1, 1), COPPER_ID_START + 5);

  // 名字：4 档 × 4 形状的注册名都要对（`cut_copper` / `exposed_cut_copper_stairs` 这类）
  COPPER_STAGES.forEach((stage, index) => {
    equal(`${stage.blockTile} 的注册名`, blockDef(copperId(index, 0)).name, `minicraft:${stage.blockTile}`);
    equal(`${stage.cutTile} 的注册名`, blockDef(copperId(index, 1)).name, `minicraft:${stage.cutTile}`);
    equal(`${stage.cutTile}_slab 的注册名`, blockDef(copperId(index, 2)).name, `minicraft:${stage.cutTile}_slab`);
    equal(`${stage.cutTile}_stairs 的注册名`, blockDef(copperId(index, 3)).name, `minicraft:${stage.cutTile}_stairs`);
  });

  check('台阶是 slab 形状', blockDef(copperId(0, 2)).shape === 'slab');
  check('楼梯是 stairs 形状', blockDef(copperId(0, 3)).shape === 'stairs');
  check('台阶与楼梯都不遮挡邻居（否则上方方块会被剔面）', !blockDef(copperId(0, 2)).opaque && !blockDef(copperId(0, 3)).opaque);
  check('整块铜是完整立方体', blockDef(copperId(0, 0)).shape === 'cube' && blockDef(copperId(0, 1)).shape === 'cube');
  check('全部 16 个都在创造物品栏里', COPPER_IDS.every((id) => CREATIVE_ITEMS.includes(id)));
  check('全部归"建筑方块"分类', COPPER_IDS.every((id) => categoryOf(id) === 'building'));
  check('全部有中文名', COPPER_IDS.every((id) => !/^[a-z_]+$/.test(itemLabel(id)) && !itemLabel(id).startsWith('未知')));
  check('全部有说明（写明会氧化/斧头能刮）', COPPER_IDS.every((id) => hasDescription(id)));
}

console.log('\n[中文名与贴图]');
{
  equal('第一档铜块', itemLabel(copperId(0, 0)), '铜块');
  equal('第二档铜块（"斑驳的"在前面）', itemLabel(copperId(1, 0)), '斑驳的铜块');
  equal('第三档铜块', itemLabel(copperId(2, 0)), '锈蚀的铜块');
  equal('第四档铜块', itemLabel(copperId(3, 0)), '氧化的铜块');
  equal('第二档切制铜（语序与铜块不同）', itemLabel(copperId(1, 1)), '斑驳的切制铜');
  equal('第四档切制铜台阶', itemLabel(copperId(3, 2)), '氧化的切制铜台阶');
  equal('第一档切制铜楼梯', itemLabel(copperId(0, 3)), '切制铜楼梯');
  equal('16 个中文名两两不同', new Set(COPPER_IDS.map((id) => itemLabel(id))).size, 16);

  check(
    '8 张贴图（4 铜块 + 4 切制铜）都登记进图集',
    COPPER_STAGES.every((stage) => TILES.has(stage.blockTile) && TILES.has(stage.cutTile)),
  );
  check(
    '每个方块的三个面贴图都在图集里（漏登记会静默回退成 tile 0）',
    COPPER_IDS.every((id) => blockDef(id).tiles.every((tile) => TILES.has(tile))),
  );
  equal('同档的台阶与楼梯共用切制铜的贴图', blockDef(copperId(2, 3)).tiles[0], blockDef(copperId(2, 1)).tiles[0]);
}

// ---------------------------------------------------------------- 2. 氧化阶梯

console.log('\n[氧化阶梯：下一档与上一档]');
{
  equal('新铜是第一档', oxidationStageOf(copperId(0, 0)), 0);
  equal('氧化铜是第四档', oxidationStageOf(copperId(3, 0)), 3);
  check('石头不是铜', oxidationStageOf(Block.STONE) === -1 && !isCopperBlock(Block.STONE));
  check('16 个铜方块都被认出来', COPPER_IDS.every((id) => isCopperBlock(id)));

  // 下一档：同一种形状、档 +1（id + 4）
  for (let stage = 0; stage < 3; stage++) {
    for (let kind = 0; kind < 4; kind++) {
      equal(
        `第 ${stage + 1} 档推进到第 ${stage + 2} 档（形状不变）`,
        nextOxidation(copperId(stage, kind as 0 | 1 | 2 | 3)),
        copperId(stage + 1, kind as 0 | 1 | 2 | 3),
      );
    }
  }
  check('已氧化到底就不再推进', nextOxidation(copperId(3, 0)) === undefined && nextOxidation(copperId(3, 3)) === undefined);

  // 刮锈：档 -1，第一档刮不动
  for (let stage = 1; stage < 4; stage++) {
    equal(`第 ${stage + 1} 档刮回第 ${stage} 档`, scrapeResult(copperId(stage, 1)), copperId(stage - 1, 1));
  }
  check('新铜刮不动（没有更早的一档）', scrapeResult(copperId(0, 0)) === undefined);
  check('非铜方块刮不动', scrapeResult(Block.STONE) === undefined && scrapeResult(Block.COPPER_ORE) === undefined);
}

// ---------------------------------------------------------------- 3. 氧化行为

/** 只够铜用的最小世界 */
class CopperWorld implements TickWorld {
  private readonly blocks = new Map<string, number>();
  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }
  set(x: number, y: number, z: number, id: number): void {
    this.blocks.set(CopperWorld.key(x, y, z), id);
  }
  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(CopperWorld.key(x, y, z)) ?? 0;
  }
  setBlock(x: number, y: number, z: number, id: number): boolean {
    this.blocks.set(CopperWorld.key(x, y, z), id);
    return true;
  }
}

/** 固定随机序列 */
function sequence(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

const Y = 64;

console.log('\n[氧化行为：概率门槛 + 锈会传染]');
{
  check('16 个铜方块都注册了随机刻行为', COPPER_IDS.every((id) => RANDOM_TICK_BEHAVIORS.has(id)));
  check('石头没有随机刻行为', !RANDOM_TICK_BEHAVIORS.has(Block.STONE));

  // ---- 门槛没过：什么都不做
  const gated = new CopperWorld();
  gated.set(0, Y, 0, copperId(0, 0));
  const blocked = copperWeatherBehavior(gated, 0, Y, 0, sequence([COPPER_WEATHER_CHANCE + 0.01]));
  check('随机刻概率没过门槛时不氧化', !blocked && gated.getBlock(0, Y, 0) === copperId(0, 0));

  // ---- 旁边没有锈：要过两道门（门槛 + 自启动）
  const alone = new CopperWorld();
  alone.set(0, Y, 0, copperId(0, 0));
  const started = copperWeatherBehavior(alone, 0, Y, 0, sequence([0.01, COPPER_SELF_START_CHANCE - 0.01]));
  check('孤立的新铜：两道概率都过才自己开始生锈', started && alone.getBlock(0, Y, 0) === copperId(1, 0));

  const noStart = new CopperWorld();
  noStart.set(0, Y, 0, copperId(0, 0));
  const notStarted = copperWeatherBehavior(noStart, 0, Y, 0, sequence([0.01, COPPER_SELF_START_CHANCE + 0.01]));
  check('自启动概率没过就不变', !notStarted && noStart.getBlock(0, Y, 0) === copperId(0, 0));

  // ---- 旁边有更锈的铜：只过第一道门就推进（这就是"锈会传染"）
  const spread = new CopperWorld();
  spread.set(0, Y, 0, copperId(0, 0)); // 新铜
  spread.set(1, Y, 0, copperId(2, 0)); // 旁边已经锈蚀
  const infected = copperWeatherBehavior(spread, 0, Y, 0, sequence([0.01, 0.99]));
  check('旁边有更锈的铜时直接推进（第二道门不看）', infected && spread.getBlock(0, Y, 0) === copperId(1, 0));

  // ---- 已锈到底：邻居再锈也不动
  const done = new CopperWorld();
  done.set(0, Y, 0, copperId(3, 0));
  done.set(1, Y, 0, copperId(3, 1));
  check('已经氧化到底的铜不再推进', !copperWeatherBehavior(done, 0, Y, 0, sequence([0, 0])));

  // ---- 推进的是"同一形状的下一档"，不会串成别的形状
  const shape = new CopperWorld();
  shape.set(0, Y, 0, copperId(1, 3)); // 斑驳的切制铜楼梯
  shape.set(0, Y, 1, copperId(3, 0)); // 旁边有更锈的（氧化铜块）
  copperWeatherBehavior(shape, 0, Y, 0, sequence([0.01, 0.99]));
  equal('楼梯氧化后还是楼梯（只是更锈）', shape.getBlock(0, Y, 0), copperId(2, 3));

  // ---- 非铜方块：不做事
  const stone = new CopperWorld();
  stone.set(0, Y, 0, Block.STONE);
  check('石头不会被氧化', !copperWeatherBehavior(stone, 0, Y, 0, sequence([0, 0])) && stone.getBlock(0, Y, 0) === Block.STONE);
}

// ---------------------------------------------------------------- 4. 材料

console.log('\n[材料：硬度 3、要石镐]');
{
  check('16 个铜方块硬度都是 3', COPPER_IDS.every((id) => blockHardness(id) === 3));
  check('徒手采不到（挖得动但什么都不掉）', !canHarvest(copperId(0, 0), null));
  check('木镐采不到（等级不够）', !canHarvest(copperId(0, 0), makeToolInfo('pickaxe', 'wooden')));
  check('石镐就能采到', canHarvest(copperId(0, 0), makeToolInfo('pickaxe', 'stone')));
  check('钻石镐当然也能', canHarvest(copperId(3, 3), makeToolInfo('pickaxe', 'diamond')));
  check('斧头采不到（工具种类不对）', !canHarvest(copperId(0, 0), makeToolInfo('axe', 'diamond')));
}

// ---------------------------------------------------------------- 5. 配方

console.log('\n[配方：四档都能合出全套]');
{
  const ore = Item.COPPER_INGOT;
  for (let stage = 0; stage < 4; stage++) {
    const block = copperId(stage, 0);
    const cut = copperId(stage, 1);
    // 9 铜锭只能合出**新铜**（锈是放出来的，不是做出来的）——所以这里对每一档都断言"匹配到的仍是新铜"
    equal(
      `${STAGE_CN[stage]}：9 铜锭只能合出新铜`,
      matchRecipe(grid(3, ['III', 'III', 'III'], { I: ore }), 3)?.id,
      copperId(0, 0),
    );
    equal(`${STAGE_CN[stage]}：1 块 → 9 铜锭（任意档都能熔回去）`, matchRecipe(grid(2, ['C·', '··'], { C: block }), 2)?.id, ore);
    equal(`${STAGE_CN[stage]}：4 块 → 4 个${CUT_CN[stage]}`, matchRecipe(grid(2, ['CC', 'CC'], { C: block }), 2)?.id, cut);
    equal(`4 个${CUT_CN[stage]} → 4 个${CUT_CN[stage]}`, matchRecipe(grid(2, ['CC', 'CC'], { C: block }), 2)?.count, 4);
    equal(`${CUT_CN[stage]}：3 个 → 6 个台阶`, matchRecipe(grid(3, ['CCC'], { C: cut }), 3)?.id, copperId(stage, 2));
    equal('台阶一次出 6 个', matchRecipe(grid(3, ['CCC'], { C: cut }), 3)?.count, 6);
    equal(`${CUT_CN[stage]}：6 个 → 4 个楼梯`, matchRecipe(grid(3, ['C··', 'CC·', 'CCC'], { C: cut }), 3)?.id, copperId(stage, 3));
    equal('楼梯一次出 4 个', matchRecipe(grid(3, ['C··', 'CC·', 'CCC'], { C: cut }), 3)?.count, 4);
  }

  // 跨档不能互合：斑驳的铜块合出来的必须是斑驳的切制铜
  equal(
    '斑驳的铜块合出斑驳的切制铜（不会串到新铜）',
    matchRecipe(grid(2, ['CC', 'CC'], { C: copperId(1, 0) }), 2)?.id,
    copperId(1, 1),
  );
  // 锈了的铜块**没有**配方：它只能靠"等它自己锈"得到（原版如此）
  const rustedBlocks = [copperId(1, 0), copperId(2, 0), copperId(3, 0)];
  check(
    '斑驳/锈蚀/氧化的铜块都没有合成配方',
    rustedBlocks.every((id) => !RECIPES.some((recipe) => recipe.result.id === id)),
  );
  check(
    '其余 13 个铜方块各有配方（新铜 4 个 + 三档切制家族各 3 个）',
    COPPER_IDS.filter((id) => !rustedBlocks.includes(id)).every((id) =>
      RECIPES.some((recipe) => recipe.result.id === id),
    ),
  );
  equal('产出铜方块的配方共 13 条', RECIPES.filter((r) => isCopperBlock(r.result.id)).length, 13);
  equal('铜块拆回 9 铜锭的配方 4 条（每档 1 条）', RECIPES.filter((r) => r.result.id === ore).length, 4);
}

console.log(`\n铜的氧化测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
