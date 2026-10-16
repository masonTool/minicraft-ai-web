/**
 * 支撑与连锁掉落离线测试（批次 78，B49）
 *
 * 这一批补的是**放置侧的另一半**：`Placement.ts` 早就挡住了"悬空放植物"，
 * 而"支撑被拆掉之后上面那株还挂着"一直没做（TASKS 里只记了藤蔓那一条）。
 * 所以第一组断言是**两边的判据必须一致**，第二组是连锁收拾（一柱甘蔗要一节节掉完）。
 *
 * 运行：npm run test:support
 */

import { Block, STEM_STAGES } from '../src/core/registry/blocks.ts';
import { supportIsValid, supportKindOf, sweepUnsupported, type SupportWorld } from '../src/core/world/Support.ts';
import { planPlacement, type PlacementInput } from '../src/core/interaction/Placement.ts';

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

/** 只有方块的小世界 */
class FakeWorld implements SupportWorld {
  readonly cells = new Map<string, number>();

  at(x: number, y: number, z: number, id: number): this {
    this.cells.set(`${x},${y},${z}`, id);
    return this;
  }

  getBlock(x: number, y: number, z: number): number {
    return this.cells.get(`${x},${y},${z}`) ?? Block.AIR;
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    this.cells.set(`${x},${y},${z}`, id);
  }
}

// ---------------------------------------------------------------- 1. 什么算支撑

console.log('\n[形状 → 支撑]');
{
  // `cross`：与放置侧同一条判据（下方实心）
  equal('花（cross）→ 要下方实心', supportKindOf(Block.DANDELION), 'solid');
  equal('小麦（cross）→ 同上', supportKindOf(Block.WHEAT_STAGE0), 'solid');
  equal('树苗（cross）→ 同上', supportKindOf(Block.OAK_SAPLING), 'solid');
  equal('瓜藤（cross）→ 同上', supportKindOf(STEM_STAGES.pumpkin![3]!), 'solid');
  equal('甘蔗（cross）→ 同上', supportKindOf(Block.SUGAR_CANE), 'solid');
  equal('仙人掌（cross）→ 同上', supportKindOf(Block.CACTUS), 'solid');
  equal('红石线（flat）→ 要下方实心', supportKindOf(Block.REDSTONE_WIRE), 'solid');

  // 水里的植物是另一套：它们是 cross 形状，但支撑是水
  equal('海带 → 水或下方海带', supportKindOf(Block.KELP), 'waterOrSelf');
  equal('海草 → 水', supportKindOf(Block.SEAGRASS), 'water');
  equal('睡莲 → 下方是水', supportKindOf(Block.LILY_PAD), 'waterBelow');

  // 贴附面那一类明确不处理（要看状态里的朝向）
  equal('火把 → 暂不处理', supportKindOf(Block.TORCH), 'none');
  equal('梯子 → 暂不处理', supportKindOf(Block.LADDER), 'none');
  equal('石头 → 不需要支撑', supportKindOf(Block.STONE), 'none');
  equal('空气 → 不需要支撑', supportKindOf(Block.AIR), 'none');
  equal('箱子 → 不需要支撑', supportKindOf(Block.CHEST), 'none');
}

// ---------------------------------------------------------------- 2. 立得住吗

console.log('\n[立得住吗]');
{
  const cases: readonly (readonly [string, number, number, boolean])[] = [
    ['花在草方块上', Block.DANDELION, Block.GRASS_BLOCK, true],
    ['花在泥土上', Block.DANDELION, Block.DIRT, true],
    ['花悬空（下面是空气）', Block.DANDELION, Block.AIR, false],
    ['花放在水上（水不是实心）', Block.DANDELION, Block.WATER, false],
    ['小麦在耕地上', Block.WHEAT_STAGE0, Block.FARMLAND, true],
    ['小麦悬空', Block.WHEAT_STAGE0, Block.AIR, false],
    ['甘蔗在沙子上', Block.SUGAR_CANE, Block.SAND, true],
    ['红石线在石头上', Block.REDSTONE_WIRE, Block.STONE, true],
    ['红石线悬空', Block.REDSTONE_WIRE, Block.AIR, false],
    ['海草长在水里（下方是海底）', Block.SEAGRASS, Block.SAND, true],
    ['睡莲浮在水面上', Block.LILY_PAD, Block.WATER, true],
    ['睡莲悬在空气上', Block.LILY_PAD, Block.AIR, false],
  ];
  for (const [label, id, below, expected] of cases) {
    const world = new FakeWorld().at(0, 64, 0, id).at(0, 63, 0, below);
    if (id === Block.SEAGRASS) world.at(0, 64, 0, Block.WATER).at(0, 63, 0, Block.WATER);
    equal(label, supportIsValid(world, 0, 64, 0), expected);
  }

  // 海带那一支要单独测：它可以是"下方还是海带"（续长的那一节）
  const kelpOnKelp = new FakeWorld().at(0, 64, 0, Block.KELP).at(0, 63, 0, Block.KELP);
  check('海带上面再续一节海带 → 立得住', supportIsValid(kelpOnKelp, 0, 64, 0));
  const kelpOnStone = new FakeWorld().at(0, 64, 0, Block.KELP).at(0, 63, 0, Block.STONE);
  check('海带下面是石头（不是水也不是海带）→ 立不住', !supportIsValid(kelpOnStone, 0, 64, 0));
  const kelpInWater = new FakeWorld().at(0, 64, 0, Block.KELP).at(0, 63, 0, Block.WATER);
  check('海带长在水上 → 立得住', supportIsValid(kelpInWater, 0, 64, 0));

  // 不需要支撑的方块永远立得住（调用方不必自己筛）
  check('石头永远"立得住"', supportIsValid(new FakeWorld().at(0, 64, 0, Block.STONE), 0, 64, 0));
  check('空气永远"立得住"', supportIsValid(new FakeWorld(), 0, 64, 0));
}

// ---------------------------------------------------------------- 3. 与放置侧成对

console.log('\n[与放置侧成对：放得下 ⇔ 立得住]');
{
  const NORTH: readonly [number, number, number] = [0, 0, -1];
  const inputWith = (below: number): PlacementInput => ({
    blockId: Block.DANDELION,
    normal: [0, 1, 0],
    hitX: 0.5,
    hitY: 63,
    hitZ: 0.5,
    hitBlock: below,
    hitState: 0,
    yaw: 0,
    sneaking: false,
    blockAt: (dx, dy, dz) => (dx === 0 && dy === -1 && dz === 0 ? below : Block.AIR),
    stateAt: () => 0,
  });
  void NORTH;

  check('放置侧：草方块上放得下', planPlacement(inputWith(Block.GRASS_BLOCK)) !== null);
  check('放置侧：悬空放不下', planPlacement(inputWith(Block.AIR)) === null);

  // 同一种情形，两边的结论必须一样（否则会出现"能放但站不住"这种怪状态）
  for (const below of [Block.GRASS_BLOCK, Block.DIRT, Block.AIR, Block.WATER]) {
    const canPlace = planPlacement(inputWith(below)) !== null;
    const canStand = supportIsValid(new FakeWorld().at(0, 64, 0, Block.DANDELION).at(0, 63, 0, below), 0, 64, 0);
    equal(`下方是 ${below}：放得下与立得住的结论一致`, canPlace, canStand);
  }
}

// ---------------------------------------------------------------- 4. 连锁收拾

console.log('\n[拆掉支撑之后：该掉的就掉]');
{
  // ---- 一朵花在草方块上：拆掉草方块 → 花掉下来
  const flower = new FakeWorld().at(0, 63, 0, Block.GRASS_BLOCK).at(0, 64, 0, Block.DANDELION);
  flower.setBlock(0, 63, 0, Block.AIR); // 相当于"玩家拆掉了草方块"
  const removed: string[] = [];
  equal('收掉 1 株', sweepUnsupported(flower, 0, 64, 0, (x, y, z, id) => removed.push(`${x},${y},${z}:${id}`)), 1);
  equal('  回调拿到了它的坐标与本体（掉落要用）', removed[0], `0,64,0:${Block.DANDELION}`);
  equal('  那一格变成空气了', flower.getBlock(0, 64, 0), Block.AIR);

  // ---- 支撑还在 → 什么都不做
  const ok = new FakeWorld().at(0, 63, 0, Block.GRASS_BLOCK).at(0, 64, 0, Block.DANDELION);
  equal('支撑还在时收不掉任何东西', sweepUnsupported(ok, 0, 64, 0), 0);
  equal('  花照旧在原处', ok.getBlock(0, 64, 0), Block.DANDELION);

  // ---- 一柱甘蔗：拆掉最下面的沙子 → **一整柱**都要掉（只收一格的话上面几节会悬空）
  const cane = new FakeWorld().at(0, 63, 0, Block.SAND);
  for (let i = 0; i < 3; i++) cane.at(0, 64 + i, 0, Block.SUGAR_CANE);
  cane.setBlock(0, 63, 0, Block.AIR);
  equal('一整柱三节甘蔗全部收掉', sweepUnsupported(cane, 0, 64, 0), 3);
  check('  三格都空了', [64, 65, 66].every((y) => cane.getBlock(0, y, 0) === Block.AIR));

  // ---- 中间隔着"立得住"的方块就停下：花长在泥土上、泥土下面是石头
  const layered = new FakeWorld().at(0, 62, 0, Block.STONE).at(0, 63, 0, Block.DIRT).at(0, 64, 0, Block.DANDELION);
  layered.setBlock(0, 62, 0, Block.AIR);
  equal('拆掉石头：泥土不需要支撑 → 一格都不收', sweepUnsupported(layered, 0, 63, 0), 0);
  check('  泥土与花都还在（原版泥土也不会掉）', layered.getBlock(0, 63, 0) === Block.DIRT && layered.getBlock(0, 64, 0) === Block.DANDELION);

  // ---- 拆掉藏在水下的海底：海草要收掉
  const sea = new FakeWorld().at(0, 60, 0, Block.SAND).at(0, 61, 0, Block.WATER).at(0, 61, 0, Block.SEAGRASS);
  sea.setBlock(1, 1, 1, Block.AIR); // 无关的一格
  const seaWeed = new FakeWorld().at(0, 61, 0, Block.SEAGRASS).at(0, 60, 0, Block.WATER);
  check('海草下方是水 → 立得住（对照）', supportIsValid(seaWeed, 0, 61, 0));
  seaWeed.setBlock(0, 60, 0, Block.AIR);
  equal('把水抽干之后海草就收掉了', sweepUnsupported(seaWeed, 0, 61, 0), 1);

  // ---- 仙人掌与瓜藤这类也吃同一条规则
  const cactus = new FakeWorld().at(0, 63, 0, Block.SAND).at(0, 64, 0, Block.CACTUS);
  cactus.setBlock(0, 63, 0, Block.AIR);
  equal('拆掉仙人掌下面的沙子 → 仙人掌掉', sweepUnsupported(cactus, 0, 64, 0), 1);

  const stem = new FakeWorld().at(0, 63, 0, Block.FARMLAND).at(0, 64, 0, STEM_STAGES.pumpkin![3]!);
  stem.setBlock(0, 63, 0, Block.AIR);
  equal('拆掉耕地 → 瓜藤掉', sweepUnsupported(stem, 0, 64, 0), 1);

  // ---- 不传回调时"直接蒸发"（离线断言常用），也不会炸
  const silent = new FakeWorld().at(0, 64, 0, Block.DANDELION);
  equal('不传回调也能收（静默）', sweepUnsupported(silent, 0, 64, 0), 1);
  equal('  那一格空了', silent.getBlock(0, 64, 0), Block.AIR);

  // ---- 起点是空气：立刻停（避免把整根柱子往下白扫）
  const empty = new FakeWorld();
  equal('起点是空气 → 什么都不做', sweepUnsupported(empty, 0, 64, 0), 0);
}

console.log(`\n支撑测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
