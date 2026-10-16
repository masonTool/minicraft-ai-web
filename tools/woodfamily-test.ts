/**
 * 木制方块族（批次 38）离线测试
 *
 * 批次 38 把木制方块从"只有橡木的四件"扩到 **6 种木材 × 4 件 = 24 个方块**：
 * 栅栏 / 栅栏门 / 门 / 活板门。这一批真正的内容其实不是"加了 20 个方块"，
 * 而是**把四处写死橡木的判定改成按形状、按族判定**：
 *
 *   1. `blocks.ts`：由木材表批量生成（id 追加在最大 id 之后，不动任何老 id）
 *   2. `TextureAtlas`：门 / 活板门 / 栅栏门三张画笔改成"按木材配色"的参数化工厂
 *   3. `main.ts`：右键开合、拆门成对、掉落，全部按**形状**判定
 *   4. `RedstoneEngine`：门类负载也按形状接入（原来是 3 个 `case Block.OAK_*`）
 *
 * 所以断言分两块：**族的一致性**（数量 / 贴图 / 材质 / 中文名 / 配方都随木材表走），
 * 与**族外行为的一致性**（任何一种木材的门都该和橡木门一样能开、能通电）。
 *
 * 运行：npm run test:wood
 */

import {
  BLOCKS,
  Block,
  WOOD_SHAPED_ID_START,
  Wood,
  WoodShaped,
  blockDef,
  blockHardness,
  woodShaped,
} from '../src/core/registry/blocks.ts';
import { isHandHarvestable, breakSeconds, makeToolInfo } from '../src/core/registry/tools.ts';
import { CREATIVE_ITEMS, Item, categoryOf, dropFor } from '../src/core/registry/items.ts';
import { itemLabel } from '../src/core/registry/itemNames.ts';
import { WOOD_TYPES } from '../src/core/registry/colors.ts';
import { isFlammable } from '../src/core/world/Fire.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import {
  facingOf,
  isDoorOpen,
  isDoorUpper,
  isFenceGateOpen,
  isTop,
  isTrapdoorOpen,
  withDoorOpen,
  withDoorUpper,
  withFacing,
  withFenceGateOpen,
  withTop,
} from '../src/core/registry/blockState.ts';
import { collisionBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
import { planPlacement } from '../src/core/interaction/Placement.ts';
import { RedstoneEngine, isRedstoneComponent, type RedstoneWorld } from '../src/core/redstone/RedstoneEngine.ts';

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
const WOOD_NAMES = WOOD_TYPES.map((wood) => wood.name);
const EXTRA_WOOD_NAMES = WOOD_NAMES.filter((name) => name !== 'oak');
const PARTS = ['fence', 'fenceGate', 'door', 'trapdoor'] as const;

/** 部件的中文名（断言输出可读） */
const PART_LABELS: Record<(typeof PARTS)[number], string> = {
  fence: '栅栏',
  fenceGate: '栅栏门',
  door: '门',
  trapdoor: '活板门',
};

/** 方块注册名里的部件名（栅栏门是 fence_gate） */
const PART_NAME: Record<(typeof PARTS)[number], string> = {
  fence: 'fence',
  fenceGate: 'fence_gate',
  door: 'door',
  trapdoor: 'trapdoor',
};

// ---------------------------------------------------------------- 1. 族的一致性

console.log('\n[木制方块族：6 种木材 × 4 件]');
{
  equal('木材表有 6 种木材', WOOD_NAMES.length, 6);
  equal('木制方块族的木材数与木材表一致', Object.keys(WoodShaped).length, WOOD_NAMES.length);
  check(
    '每种木材都有 4 件（栅栏/栅栏门/门/活板门）',
    WOOD_NAMES.every((name) => {
      const ids = woodShaped(name);
      return ids !== undefined && PARTS.every((part) => typeof ids[part] === 'number');
    }),
  );

  // 族的形状必须与橡木那四件逐一相同——这是"同一族"最该守住的东西
  const oak = woodShaped('oak')!;
  check(
    '其余 5 种木材的形状与橡木那四件逐一相同',
    EXTRA_WOOD_NAMES.every((name) => {
      const ids = woodShaped(name)!;
      return PARTS.every((part) => blockDef(ids[part]).shape === blockDef(oak[part]).shape);
    }),
  );
  check(
    '都不遮挡邻居（否则会把旁边方块的面剔掉）',
    WOOD_NAMES.every((name) => PARTS.every((part) => !blockDef(woodShaped(name)![part]).opaque)),
  );
  check(
    '注册名都是 minecraft:<木材>_<部件>',
    WOOD_NAMES.every((name) =>
      PARTS.every((part) => blockDef(woodShaped(name)![part]).name === `minecraft:${name}_${PART_NAME[part]}`),
    ),
  );
}

console.log('\n[id 布局：追加式，不动老 id]');
{
  equal('橡木栅栏沿用历史 id 96', woodShaped('oak')!.fence, 96);
  equal('橡木门沿用历史 id 99', woodShaped('oak')!.door, 99);
  equal('橡木活板门沿用历史 id 289', woodShaped('oak')!.trapdoor, 289);
  equal('橡木栅栏门沿用历史 id 290', woodShaped('oak')!.fenceGate, 290);

  // 其余 5 套：从 313 起、每种连续 4 个
  const expected: number[] = [];
  let next = WOOD_SHAPED_ID_START;
  for (const _name of EXTRA_WOOD_NAMES) {
    for (let i = 0; i < PARTS.length; i++) expected.push(next + i);
    next += 4;
  }
  const actual = EXTRA_WOOD_NAMES.flatMap((name) => PARTS.map((part) => woodShaped(name)![part]));
  equal('新方块的 id 与分配顺序一致', actual.join(','), expected.join(','));
  check(
    '每个 id 都能在方块表里按下标取到同一个方块',
    actual.every((id) => BLOCKS[id] !== undefined && BLOCKS[id]!.id === id),
  );
  check(
    'id 连续（下一个 id 要么存在、要么已经是表尾）',
    actual.every((id) => BLOCKS[id + 1] === undefined || BLOCKS[id + 1]!.id === id + 1),
  );
  check('新 id 都在旧的最大 id 之后（追加式，不打乱老编号）', actual.every((id) => id >= WOOD_SHAPED_ID_START));
  equal('新方块共 20 个（5 木材 × 4 件）', actual.length, 20);
}

console.log('\n[贴图与图集]');
{
  const newTiles: string[] = [];
  for (const name of EXTRA_WOOD_NAMES) {
    const ids = woodShaped(name)!;
    for (const part of ['door', 'trapdoor', 'fenceGate'] as const) {
      const tile = `${name}_${PART_NAME[part]}`;
      newTiles.push(tile);
      equal(`${name} 的${PART_LABELS[part]}用自己的贴图`, blockDef(ids[part]).tiles[0], tile);
    }
    // 栅栏复用该木材的木板贴图（原版观感；单独画一张反而会与木板不一致）
    equal(`${name} 的栅栏复用木板贴图`, blockDef(ids.fence).tiles[0], `${name}_planks`);
  }
  check('15 张新贴图都登记进了图集顺序表', newTiles.every((tile) => TILES.has(tile)));
  equal('新贴图名不重复', new Set(newTiles).size, 15);
  check(
    '每个木制方块的三个面贴图都在图集里（漏登记会静默回退成 tile 0）',
    WOOD_NAMES.every((name) =>
      PARTS.every((part) => blockDef(woodShaped(name)![part]).tiles.every((tile) => TILES.has(tile))),
    ),
  );
}

// ---------------------------------------------------------------- 2. 材质与属性

console.log('\n[硬度 / 采集工具]');
{
  for (const name of WOOD_NAMES) {
    const ids = woodShaped(name)!;
    equal(`${name} 栅栏硬度 2`, blockHardness(ids.fence), 2);
    equal(`${name} 栅栏门硬度 2`, blockHardness(ids.fenceGate), 2);
    equal(`${name} 门硬度 3`, blockHardness(ids.door), 3);
    equal(`${name} 活板门硬度 3`, blockHardness(ids.trapdoor), 3);
  }
  check(
    '全部徒手可采（斧只是加速，与原版一致）',
    WOOD_NAMES.every((name) => PARTS.every((part) => isHandHarvestable(woodShaped(name)![part]))),
  );

  const spruceDoor = woodShaped('spruce')!.door;
  const byHand = breakSeconds(spruceDoor);
  const byAxe = breakSeconds(spruceDoor, makeToolInfo('axe', 'iron'));
  check('铁斧比徒手快', byAxe < byHand, `徒手 ${byHand.toFixed(2)}s，铁斧 ${byAxe.toFixed(2)}s`);
  equal(
    '镐子挖木头没有加成（工具种类不对不该变快）',
    breakSeconds(spruceDoor, makeToolInfo('pickaxe', 'diamond')),
    byHand,
  );
  equal('破坏后掉落自身', dropFor(spruceDoor)?.id, spruceDoor);
}

console.log('\n[可燃：整族一起登记，别漏木材]');
{
  for (const name of WOOD_NAMES) {
    const ids = woodShaped(name)!;
    check(`${name} 的四件都可燃`, PARTS.every((part) => isFlammable(ids[part])));
  }
  check('石头仍然不可燃（别把表写成"什么都烧"）', !isFlammable(Block.STONE));
}

console.log('\n[分类与中文名]');
{
  check(
    '全部归"建筑方块"分类',
    WOOD_NAMES.every((name) => PARTS.every((part) => categoryOf(woodShaped(name)![part]) === 'building')),
  );
  check(
    '全部在创造物品栏里（否则生存里拿不到）',
    WOOD_NAMES.every((name) => PARTS.every((part) => CREATIVE_ITEMS.includes(woodShaped(name)![part]))),
  );
  equal('云杉栅栏', itemLabel(woodShaped('spruce')!.fence), '云杉栅栏');
  equal('白桦栅栏门', itemLabel(woodShaped('birch')!.fenceGate), '白桦栅栏门');
  equal('丛林门', itemLabel(woodShaped('jungle')!.door), '丛林门');
  equal('金合欢活板门', itemLabel(woodShaped('acacia')!.trapdoor), '金合欢活板门');
  equal('深色橡木门', itemLabel(woodShaped('dark_oak')!.door), '深色橡木门');
  equal('橡木门（历史条目）', itemLabel(blockDef(woodShaped('oak')!.door).id), '橡木门');
  equal(
    '24 个中文名两两不同（没有回退成英文 id 的）',
    new Set(WOOD_NAMES.flatMap((name) => PARTS.map((part) => itemLabel(woodShaped(name)![part])))).size,
    24,
  );
}

// ---------------------------------------------------------------- 3. 形状与几何

console.log('\n[形状与碰撞：与橡木那四件同几何]');
{
  const closedDoor = withFacing(0, 0);
  const openDoor = withDoorOpen(closedDoor, true);
  equal('关着的门有碰撞', collisionBoxes('door', closedDoor).length, 1);
  equal('开着的门没有碰撞（可以走过去）', collisionBoxes('door', openDoor).length, 0);

  const trapdoor = withTop(withFacing(0, 1), false);
  equal(
    '活板门的渲染盒与碰撞盒是同一份几何',
    JSON.stringify(meshBoxes('trapdoor', trapdoor)),
    JSON.stringify(collisionBoxes('trapdoor', trapdoor)),
  );

  const closedGate = collisionBoxes('fence_gate', withFacing(0, 0));
  const openGate = collisionBoxes('fence_gate', withFenceGateOpen(withFacing(0, 0), true));
  equal('关着的栅栏门是三块（两柱 + 门板）', closedGate.length, 3);
  equal('开着的栅栏门也是三块（门板转到侧面）', openGate.length, 3);
  check('关着的栅栏门挡路（中线被门板占住）', closedGate.some((box) => box[0] === 0 && box[3] === 1), JSON.stringify(closedGate));

  // 开着的时候，X 轴中线上必须留出一条 ≥0.6 格宽的空档（玩家宽 0.6）
  const blocked = openGate
    .filter((box) => box[2] < 0.5 && box[5] > 0.5)
    .map((box) => [box[0], box[3]] as const)
    .sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  let gap = 0;
  for (const [x0, x1] of blocked) {
    if (x0 > cursor) gap = Math.max(gap, x0 - cursor);
    cursor = Math.max(cursor, x1);
  }
  gap = Math.max(gap, 1 - cursor);
  check('开着的栅栏门留出 ≥0.6 格空档（人走得过去）', gap >= 0.6, `空档 ${gap.toFixed(3)} 格`);

  check(
    '6 种木材的门几何完全一致（形状是共享的）',
    WOOD_NAMES.every(
      (name) =>
        JSON.stringify(meshBoxes(blockDef(woodShaped(name)!.door).shape, closedDoor)) ===
        JSON.stringify(meshBoxes('door', closedDoor)),
    ),
  );
}

// ---------------------------------------------------------------- 4. 配方

console.log('\n[配方：每种木材 4 条，且必须用同一种木材]');
{
  const spruce = woodShaped('spruce')!;
  const spruceP = Wood.spruce!.planks;
  const doors = grid(3, ['PP', 'PP', 'PP'], { P: spruceP });
  const trapdoors = grid(3, ['PPP', 'PPP'], { P: spruceP });
  const fences = grid(3, ['PSP', 'PSP'], { P: spruceP, S: Item.STICK });
  const gates = grid(3, ['SPS', 'SPS'], { P: spruceP, S: Item.STICK });

  equal('云杉门：6 云杉木板竖排 → 云杉门', matchRecipe(doors, 3)?.id, spruce.door);
  equal('云杉门产量 3', matchRecipe(doors, 3)?.count, 3);
  equal('云杉活板门：6 木板铺 3×2 → 2 个', matchRecipe(trapdoors, 3)?.id, spruce.trapdoor);
  equal('云杉活板门产量 2', matchRecipe(trapdoors, 3)?.count, 2);
  equal('云杉栅栏：4 木板 + 2 木棍 → 3 个', matchRecipe(fences, 3)?.id, spruce.fence);
  equal('云杉栅栏产量 3', matchRecipe(fences, 3)?.count, 3);
  equal('云杉栅栏门：2 木板 + 4 木棍 → 1 个', matchRecipe(gates, 3)?.id, spruce.fenceGate);
  equal('云杉栅栏门产量 1', matchRecipe(gates, 3)?.count, 1);

  // 跨木材不成立：橡木木板合出来的必须是橡木门（配方按木材分开）
  equal('橡木木板合出橡木门（不是云杉门）', matchRecipe(doors.map((id) => (id === spruceP ? Block.OAK_PLANKS : id)), 3)?.id, Block.OAK_DOOR);
  // 混木材也不成立：一半云杉一半橡木 → 匹配不到任何配方（`matchRecipe` 找不到时返回 null）
  equal(
    '混木材拼不出门',
    matchRecipe(grid(3, ['PP', 'PP', 'PO'], { P: spruceP, O: Block.OAK_PLANKS }), 3),
    null,
  );

  const familyRecipes = RECIPES.filter((recipe) =>
    WOOD_NAMES.some((name) => PARTS.some((part) => woodShaped(name)![part] === recipe.result.id)),
  );
  equal('木制方块族一共 24 条配方（6 木材 × 4 件）', familyRecipes.length, 24);
  check(
    '每条配方的产物都是已注册的方块',
    familyRecipes.every((recipe) => blockDef(recipe.result.id).name.startsWith('minecraft:')),
  );
  check(
    '同一种木材的四种产物各有一条配方（没有哪一种被漏掉）',
    WOOD_NAMES.every((name) =>
      PARTS.every((part) => familyRecipes.some((recipe) => recipe.result.id === woodShaped(name)![part])),
    ),
  );
}

// ---------------------------------------------------------------- 5. 放置

console.log('\n[放置规则：门会连带上半格]');
{
  const place = (blockId: number, yaw: number) =>
    planPlacement({
      blockId,
      normal: [0, 0, 1],
      hitX: 10.2,
      hitY: 64.5,
      hitZ: 10.9,
      yaw,
      sneaking: false,
      blockAt: (_dx: number, dy: number) => (dy === -1 ? Block.STONE : 0),
      hitBlock: Block.STONE,
      hitState: 0,
    });

  for (const name of WOOD_NAMES) {
    const ids = woodShaped(name)!;
    const plan = place(ids.door, 0);
    check(`${name} 的门放得下`, plan !== null);
    equal(`${name} 的门连带上半格`, plan?.extra?.dy, 1);
    equal(`${name} 的门下半与上半是同一种门`, plan?.extra?.id, ids.door);
    equal(`${name} 的上半格带 UPPER 标记`, plan ? isDoorUpper(plan.extra!.state) : false, true);
    equal(`${name} 的门默认关着`, plan ? isDoorOpen(plan.state) : true, false);
    equal(
      `${name} 的门上下两半朝向一致`,
      plan ? facingOf(plan.extra!.state) : -1,
      plan ? facingOf(plan.state) : -2,
    );
  }

  const trap = planPlacement({
    blockId: woodShaped('spruce')!.trapdoor,
    normal: [0, 1, 0],
    hitX: 10.5,
    hitY: 64.9,
    hitZ: 10.5,
    yaw: 0,
    sneaking: false,
    blockAt: () => 0,
    hitBlock: Block.STONE,
    hitState: 0,
  });
  equal('云杉活板门默认关着', trap ? isTrapdoorOpen(trap.state) : true, false);
  equal('云杉活板门默认贴地（下半）', trap ? isTop(trap.state) : true, false);

  const gate = planPlacement({
    blockId: woodShaped('spruce')!.fenceGate,
    normal: [0, 0, 1],
    hitX: 10.5,
    hitY: 64.5,
    hitZ: 10.9,
    yaw: 0,
    sneaking: false,
    blockAt: () => 0,
    hitBlock: Block.STONE,
    hitState: 0,
  });
  equal('云杉栅栏门默认关着', gate ? isFenceGateOpen(gate.state) : true, false);
}

// ---------------------------------------------------------------- 6. 红石

/** 内存世界（与 redstone-test 同款的最小实现：这一批验的是"形状判定"，不是电路本身） */
class StubWorld implements RedstoneWorld {
  private readonly blocks = new Map<string, number>();
  private readonly states = new Map<string, number>();

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(StubWorld.key(x, y, z)) ?? 0;
  }

  getState(x: number, y: number, z: number): number {
    return this.states.get(StubWorld.key(x, y, z)) ?? 0;
  }

  setBlock(x: number, y: number, z: number, id: number, state: number): boolean {
    this.blocks.set(StubWorld.key(x, y, z), id);
    this.states.set(StubWorld.key(x, y, z), state);
    return true;
  }

  setState(x: number, y: number, z: number, state: number): boolean {
    this.states.set(StubWorld.key(x, y, z), state);
    return true;
  }

  isLoaded(): boolean {
    return true;
  }

  hasEntityAt(): boolean {
    return false;
  }
}

function tick(engine: RedstoneEngine, world: StubWorld, seconds: number): void {
  const dt = 1 / 20;
  for (let i = 0; i < Math.round(seconds / dt); i++) engine.tick(world, dt);
}

console.log('\n[红石：非橡木的门也通电即开（原来写死橡木＝云杉门根本不开）]');
{
  const Y = 100;
  const spruce = woodShaped('spruce')!;
  const world = new StubWorld();
  const engine = new RedstoneEngine();

  check('云杉门被认成红石元件', isRedstoneComponent(spruce.door));
  check('云杉活板门被认成红石元件', isRedstoneComponent(spruce.trapdoor));
  check('云杉栅栏门被认成红石元件', isRedstoneComponent(spruce.fenceGate));
  check('云杉栅栏**不是**红石元件（栅栏本身不能通电开合）', !isRedstoneComponent(spruce.fence));

  // 拉杆(0,Y,0) → 粉(1,Y,0) → 活板门(2,Y,0)、栅栏门(1,Y,-1)
  //              粉(1,Y+1,0) → 云杉门下半(2,Y+1,0) + 上半(2,Y+2,0)
  world.setBlock(0, Y, 0, Block.LEVER, 0);
  world.setBlock(1, Y, 0, Block.REDSTONE_WIRE, 0);
  world.setBlock(1, Y + 1, 0, Block.REDSTONE_WIRE, 0);
  world.setBlock(2, Y, 0, spruce.trapdoor, withFacing(0, 1));
  world.setBlock(1, Y, -1, spruce.fenceGate, withFacing(0, 0));
  world.setBlock(2, Y + 1, 0, spruce.door, withFacing(0, 0));
  world.setBlock(2, Y + 2, 0, spruce.door, withDoorUpper(withFacing(0, 0), true));
  engine.onBlockChanged(world, 0, Y, 0);
  tick(engine, world, 0.1);

  check('初始：云杉活板门关着', !isTrapdoorOpen(world.getState(2, Y, 0)));
  check('初始：云杉栅栏门关着', !isFenceGateOpen(world.getState(1, Y, -1)));
  check(
    '初始：云杉门上下两半都关着',
    !isDoorOpen(world.getState(2, Y + 1, 0)) && !isDoorOpen(world.getState(2, Y + 2, 0)),
  );

  engine.toggleLever(world, 0, Y, 0);
  tick(engine, world, 0.1);

  check('通电：云杉活板门开了', isTrapdoorOpen(world.getState(2, Y, 0)));
  check('通电：云杉栅栏门开了', isFenceGateOpen(world.getState(1, Y, -1)));
  check('通电：云杉门下半开了', isDoorOpen(world.getState(2, Y + 1, 0)));
  check('通电：云杉门上半**也**开了（不是半扇门）', isDoorOpen(world.getState(2, Y + 2, 0)));
  check('上半格仍然是"上半"（标记没被洗掉）', isDoorUpper(world.getState(2, Y + 2, 0)));
  equal('开合没有把门换成别的方块', world.getBlock(2, Y + 2, 0), spruce.door);

  engine.toggleLever(world, 0, Y, 0);
  tick(engine, world, 0.1);
  check(
    '断电：云杉门两半都关上',
    !isDoorOpen(world.getState(2, Y + 1, 0)) && !isDoorOpen(world.getState(2, Y + 2, 0)),
  );
  check('断电：云杉栅栏门关上', !isFenceGateOpen(world.getState(1, Y, -1)));
  check('断电：云杉活板门关上', !isTrapdoorOpen(world.getState(2, Y, 0)));
}

console.log(`\n木制方块族测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
