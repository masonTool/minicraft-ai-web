/**
 * 脚手架（批次 53）离线测试
 *
 * 它一次性把"形状框架"里现成的三件事凑齐，所以要盯的也是三条独立的链：
 *  1. **能站上去**：底部 1/8 格高的板（走上去不用跳），碰撞与渲染都从它来
 *  2. **能攀爬**：`isClimbableBlock` 是按**形状**判定的——加一个形状就该自动能爬
 *  3. **水平连接**：与栅栏/墙同一套"网格化时按邻居实时算"（连成片时内部角柱省略）
 *
 * 最容易错的几处（错了都不报错、只是看着别扭）：
 *  - 连接规则写成"只要有一侧连着就去掉柱子" → 连成一排时**整排都没有柱子**，像一块板
 *  - 碰撞盒跟着连接变 → 物理侧拿不到邻居，只能退化成"每次都算 4 根柱"（与栅栏同一条约定）
 *  - 板高写错 → 要么要跳上去（1/8 以上），要么穿模（太低）
 *
 * 运行：npm run test:scaffold
 */

import {
  BLOCKS,
  Block,
  SCAFFOLDING_ID,
  blockDef,
  blockHardness,
  isClimbableBlock,
  isHandHarvestable,
} from '../src/core/registry/blocks.ts';
import {
  SCAFFOLD_PLATFORM_HEIGHT,
  canScaffoldConnectTo,
  collisionBoxes,
  meshBoxes,
  type LocalBox,
} from '../src/core/registry/blockShapes.ts';
import {
  CREATIVE_ITEMS,
  Item,
  blockDrops,
  categoryOf,
  dropFor,
  type DropContext,
} from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { isFlammable } from '../src/core/world/Fire.ts';
import { planPlacement } from '../src/core/interaction/Placement.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';

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

const SCAFFOLD = Block.SCAFFOLDING;
const TILES = new Set<string>(TILE_ORDER);
/** facing：0 北 / 1 东 / 2 南 / 3 西 */
const NORTH = 0;
const EAST = 1;
const SOUTH = 2;
const WEST = 3;

/** 按"哪些方向连着脚手架"造一个连接回调 */
function connectTo(...facings: readonly number[]): (facing: number) => boolean {
  return (facing) => facings.includes(facing);
}

// ---------------------------------------------------------------- 1. 注册与属性

console.log('\n[注册与属性]');
{
  equal('注册名', blockDef(SCAFFOLD).name, 'minecraft:scaffolding');
  equal('id 接着上一批的最后一个', SCAFFOLDING_ID, Block.FLOWER_POT + 1);
  equal('中文名', itemLabel(SCAFFOLD), '脚手架');
  check('有中文说明（写清"能爬、能站、拆底下一片全掉"）', hasDescription(SCAFFOLD));
  equal('形状是 scaffolding（新的第 20 种形状）', blockDef(SCAFFOLD).shape, 'scaffolding');
  check('不遮挡邻居（否则会剔掉旁边方块的面）', !blockDef(SCAFFOLD).opaque);
  equal('不挡光', blockDef(SCAFFOLD).lightOpacity, 0);
  equal('硬度 0（一碰就掉，原版）', blockHardness(SCAFFOLD), 0);
  check('徒手可采', isHandHarvestable(SCAFFOLD));
  equal('归"建筑"分类（搭东西用的）', categoryOf(SCAFFOLD), 'building');
  check('在创造物品栏里', CREATIVE_ITEMS.includes(SCAFFOLD));
  check('竹子做的 → 可燃烧', isFlammable(SCAFFOLD));

  const tiles = blockDef(SCAFFOLD).tiles;
  check('三张贴图都在图集名单里', tiles.every((tile) => TILES.has(tile)), tiles.join(' '));
  equal('顶面用的是站人的木板', tiles[0], 'scaffolding_top');
  equal('侧面用的是带柱子的那一圈', tiles[2], 'scaffolding_side');
  equal('id 连续（数组下标就是 id）', BLOCKS[SCAFFOLDING_ID]?.id, SCAFFOLDING_ID);
}

// ---------------------------------------------------------------- 2. 攀爬：按形状判定

console.log('\n[攀爬：按形状判定]');
{
  check('脚手架可以攀爬', isClimbableBlock(SCAFFOLD));
  check('梯子/藤蔓/锁链照旧可以爬（没被改坏）', [
    Block.LADDER,
    Block.VINE,
    Block.CHAIN,
  ].every((id) => isClimbableBlock(id)));
  check('普通方块的"能爬"没被误伤', !isClimbableBlock(Block.STONE) && !isClimbableBlock(Block.OAK_PLANKS));
  check('栅栏不能爬（它只是挡路）', !isClimbableBlock(Block.OAK_FENCE));
}

// ---------------------------------------------------------------- 3. 几何：板 + 角柱

console.log('\n[几何：底部一块板 + 四角柱]');
{
  equal('板高 1/8 格（原版，走上去不用跳）', SCAFFOLD_PLATFORM_HEIGHT, 0.125);

  const alone = meshBoxes('scaffolding', 0, { connect: connectTo() });
  equal('四面都不连：板 + 4 根角柱 = 5 个盒子', alone.length, 5);
  const plate = alone[0]!;
  equal('第一个盒子是那块板（高度 1/8）', plate[4], 0.125);
  equal('板是整格宽（1×1）', plate[3], 1);
  const pillars = alone.slice(1);
  check(
    '四根柱子都在四角（各贴着一对边）',
    pillars.every((box) => box[0] === 0 || box[0]! > 0.9) && pillars.every((box) => box[2] === 0 || box[2]! > 0.9),
  );
  equal('柱子粗细 1/16（人在中间走不会撞到）', pillars[0]![3], 0.0625);
  equal('柱子从板顶（1/8）一直立到格子顶部', pillars[0]![1], SCAFFOLD_PLATFORM_HEIGHT);
  equal('柱子的顶端正好到格子顶', pillars[0]![4], 1);

  // 只连一侧：柱子不该减少（这个角落还有一个方向没连）
  equal('只连北侧：仍是 5 个盒子', meshBoxes('scaffolding', 0, { connect: connectTo(NORTH) }).length, 5);
  equal('连南北（走廊两侧）：仍是 5 个盒子', meshBoxes('scaffolding', 0, { connect: connectTo(NORTH, SOUTH) }).length, 5);

  // 相邻两个方向都连上：那个角的柱子被邻格顶替
  equal('连西北：西北角那根柱子省掉', meshBoxes('scaffolding', 0, { connect: connectTo(NORTH, WEST) }).length, 4);
  equal('连东北：4 个盒子', meshBoxes('scaffolding', 0, { connect: connectTo(NORTH, EAST) }).length, 4);
  equal('连四邻：**只剩那块板**（连成一片时内部没有柱子）', meshBoxes('scaffolding', 0, { connect: connectTo(NORTH, EAST, SOUTH, WEST) }).length, 1);

  // 碰撞盒：固定 5 个，不随连接变化（物理侧拿不到邻居，与栅栏同一条约定）
  const collide = collisionBoxes('scaffolding', 0);
  equal('碰撞盒固定是"板 + 4 柱"（不随连接变）', collide.length, 5);
  check('碰撞盒与"四面都不连"时的渲染盒完全一致', collide.map((b) => b.join(',')).join('|') === alone.map((b: LocalBox) => b.join(',')).join('|'));
}

// ---------------------------------------------------------------- 4. 连接判定

console.log('\n[连接判定：只与脚手架相连]');
{
  check('脚手架连脚手架', canScaffoldConnectTo(SCAFFOLD));
  check('空格不连（否则会朝空气伸柱子）', !canScaffoldConnectTo(Block.AIR));
  check('石头**不**连（原版脚手架不会挂在墙边，与栅栏/玻璃板不同）', !canScaffoldConnectTo(Block.STONE));
  check('栅栏不算脚手架', !canScaffoldConnectTo(Block.OAK_FENCE));
}

// ---------------------------------------------------------------- 5. 放置规则

console.log('\n[放置规则：下面要有支撑]');
{
  const place = (below: number, normal: readonly [number, number, number] = [0, 1, 0]) =>
    planPlacement({
      blockId: SCAFFOLD,
      normal,
      hitX: 10.5,
      hitY: 64,
      hitZ: 10.5,
      yaw: 0,
      sneaking: false,
      blockAt: (dx, dy, dz) =>
        dx === 0 && dy === 0 && dz === 0 ? Block.AIR : dx === 0 && dy === -1 && dz === 0 ? below : Block.AIR,
      hitBlock: below,
      hitState: 0,
    });

  check('下方是石头 → 能放', place(Block.STONE) !== null);
  check('下方是泥土 → 能放', place(Block.DIRT) !== null);
  check('下方是**另一片脚手架** → 能放（搭高就靠这条）', place(SCAFFOLD) !== null);
  check('悬空（下方空气）→ 拒绝', place(Block.AIR) === null);
  check('下方是水 → 拒绝（水不是支撑）', place(Block.WATER) === null);
  check('命中天花板（下表面）→ 拒绝', place(Block.STONE, [0, -1, 0]) === null);
  check('命中侧面且下方有支撑 → 能放（横向延伸）', place(Block.STONE, [1, 0, 0]) !== null);
  check('放下时不需要状态（连接方向是网格化时算的）', place(Block.STONE)!.state === 0);
}

// ---------------------------------------------------------------- 6. 配方与掉落

console.log('\n[配方与掉落]');
{
  // 原版：上下两排竹子、中间一根**线** → 6 个（线是物品，不是方块）
  const bambooOnly = matchRecipe(
    [Block.BAMBOO, Block.BAMBOO, Block.BAMBOO, 0, 0, 0, Block.BAMBOO, Block.BAMBOO, Block.BAMBOO],
    3,
  );
  equal('只有 6 根竹子做不出脚手架（中间得有线）', bambooOnly, null);

  const craft = matchRecipe(
    [Block.BAMBOO, Block.BAMBOO, Block.BAMBOO, 0, Item.STRING, 0, Block.BAMBOO, Block.BAMBOO, Block.BAMBOO],
    3,
  );
  equal('6 竹子 + 1 线 → 脚手架', craft?.id, SCAFFOLD);
  equal('一次出 6 个（原版：一次够搭一小段）', craft?.count, 6);

  const ctx = (over: Partial<DropContext> = {}): DropContext => ({
    shears: false,
    silkTouch: false,
    fortune: 0,
    doubleSlab: false,
    roll: () => 0.99,
    ...over,
  });
  equal('破坏掉自身', dropFor(SCAFFOLD)?.id, SCAFFOLD);
  equal('blockDrops 也是自身（徒手就掉）', blockDrops(SCAFFOLD, ctx())?.id, SCAFFOLD);
  equal('一次掉 1 个', dropFor(SCAFFOLD)?.count, 1);
  check('脚手架不需要剪刀/精准采集（掉了就是它自己）', blockDrops(SCAFFOLD, ctx({ silkTouch: true }))?.id === SCAFFOLD);
}

console.log(`\n脚手架测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
