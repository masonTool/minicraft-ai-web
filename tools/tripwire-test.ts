/**
 * 绊线与绊线钩（批次 55）离线测试
 *
 * 这是红石元件表里的**最后一个**缺口（做完整张表就是 20/20）。它要盯住四条：
 *  1. **回路要"两根朝向相对的钩子 + 中间全是线"**——朝向一致、中间夹了别的方块、
 *     或者线太长，都不算接上（原版如此）
 *  2. **实体踩上去才知道**：踩线不会产生方块变化事件，所以引擎要按 10Hz 主动轮询
 *  3. **剪断只是"这一格不再触发"**，回路不断（剪断后 attached 仍然是 true）
 *  4. **绊线没有物品**（只能用线放下来），拆掉退回 1 根线
 *
 * 运行：npm run test:tripwire
 */

import { isHandHarvestable } from '../web/src/core/registry/tools.ts';
import {
  BLOCKS,
  Block,
  TRIPWIRE_HOOK_ID,
  TRIPWIRE_ID,
  TRIPWIRE_MAX_LENGTH,
  blockDef,
  blockHardness,
} from '../web/src/core/registry/blocks.ts';
import {
  facingOf,
  isDisarmed,
  isPowered,
  isTripwireAttached,
  tripwireWireDirection,
  withDisarmed,
  withFacing,
  withPowered,
  withTripwireAttached,
} from '../web/src/core/registry/blockState.ts';
import { collisionBoxes, meshBoxes } from '../web/src/core/registry/blockShapes.ts';
import {
  CREATIVE_ITEMS,
  Item,
  blockDrops,
  categoryOf,
  dropFor,
  itemDef,
  type DropContext,
} from '../web/src/core/registry/items.ts';
import { blockLabel, hasDescription, itemLabel } from '../web/src/core/registry/itemNames.ts';
import {
  RedstoneEngine,
  isRedstoneComponent,
  type RedstoneWorld,
} from '../web/src/core/redstone/RedstoneEngine.ts';
import { planPlacement } from '../web/src/core/interaction/Placement.ts';
import { matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';

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

const WIRE = Block.TRIPWIRE;
const HOOK = Block.TRIPWIRE_HOOK;
const TILES = new Set<string>(TILE_ORDER);
/** facing：0 北 / 1 东 / 2 南 / 3 西（facing = **贴着的那一面**） */
const NORTH = 0;
const EAST = 1;
const SOUTH = 2;
const WEST = 3;

/** 只够红石用的最小世界：方块 + 状态 + 可控"有没有实体" */
class TripwireStub implements RedstoneWorld {
  private readonly blocks = new Map<string, number>();
  private readonly states = new Map<string, number>();
  /** 哪些格子上站着实体（测试直接改它） */
  readonly entities = new Set<string>();

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  set(x: number, y: number, z: number, id: number, state = 0): void {
    this.blocks.set(TripwireStub.key(x, y, z), id);
    this.states.set(TripwireStub.key(x, y, z), state);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(TripwireStub.key(x, y, z)) ?? Block.AIR;
  }

  getState(x: number, y: number, z: number): number {
    return this.states.get(TripwireStub.key(x, y, z)) ?? 0;
  }

  setBlock(x: number, y: number, z: number, id: number, state: number): boolean {
    this.set(x, y, z, id, state);
    return true;
  }

  setState(x: number, y: number, z: number, state: number): boolean {
    this.states.set(TripwireStub.key(x, y, z), state);
    return true;
  }

  isLoaded(): boolean {
    return true;
  }

  hasEntityAt(x: number, y: number, z: number): boolean {
    return this.entities.has(TripwireStub.key(x, y, z));
  }
}

/** 一根钩子的状态：`facing` = 贴着的那一面墙（线往反方向延伸） */
function hookState(facing: number): number {
  return withFacing(0, facing as 0 | 1 | 2 | 3);
}

/**
 * 造一条标准回路：西墙上的钩子在 x=0（线往东）、东墙上的钩子在 x=4（线往西），
 * 中间的 x=1..3 是绊线；灯挂在 x=0 的南侧（与钩子相邻，直接吃它的输出）。
 */
function circuit(entityOn = false): { world: TripwireStub; engine: RedstoneEngine } {
  const world = new TripwireStub();
  world.set(0, 64, 0, HOOK, hookState(WEST));
  world.set(4, 64, 0, HOOK, hookState(EAST));
  for (let x = 1; x <= 3; x++) world.set(x, 64, 0, WIRE);
  world.set(0, 64, 1, Block.REDSTONE_LAMP);
  if (entityOn) world.entities.add('2,64,0');
  const engine = new RedstoneEngine();
  engine.recompute(world, 0, 64, 0);
  engine.tick(world, 0); // 排空待算位置（直接调 recompute 会留下它们）
  return { world, engine };
}

/** 灯亮着吗（灯挂在 (0,64,1)） */
function lampOn(world: TripwireStub): boolean {
  return isPowered(world.getState(0, 64, 1));
}

// ---------------------------------------------------------------- 1. 注册

console.log('\n[注册与属性]');
{
  equal('绊线的注册名', blockDef(WIRE).name, 'minicraft:tripwire');
  equal('绊线钩的注册名', blockDef(HOOK).name, 'minicraft:tripwire_hook');
  equal('两个 id 接着上一批的最后一个', TRIPWIRE_ID, Block.DAYLIGHT_DETECTOR + 1);
  equal('绊线钩紧跟着绊线', TRIPWIRE_HOOK_ID, TRIPWIRE_ID + 1);
  equal('绊线 id 连续', BLOCKS[TRIPWIRE_ID]?.id, TRIPWIRE_ID);
  // ⚠️ 绊线没有物品，所以要用**方块名**那条路（`itemLabel` 会回落到"未知物品(473)"）
  equal('绊线的中文名（方块名那条路）', blockLabel(WIRE), '绊线');
  equal('绊线钩的中文名', itemLabel(HOOK), '绊线钩');
  check('绊线钩有说明（写清"两根相对 + 用线铺 + 剪刀剪断"）', hasDescription(HOOK));

  // 绊线**没有物品**（原版只能用线放下来）
  equal('绊线是 itemless 的方块', blockDef(WIRE).itemless, true);
  equal('绊线查不到物品', itemDef(WIRE), undefined);
  check('绊线不在创造物品栏里（它本来就没有物品）', !CREATIVE_ITEMS.includes(WIRE));
  check('绊线钩在创造物品栏里', CREATIVE_ITEMS.includes(HOOK));
  equal('绊线钩归"功能方块"页（红石元件）', categoryOf(HOOK), 'functional');

  equal('绊线硬度 0', blockHardness(WIRE), 0);
  equal('绊线钩硬度 0', blockHardness(HOOK), 0);
  check('两者都徒手可采', isHandHarvestable(WIRE) && isHandHarvestable(HOOK));
  equal('绊线是红石元件（洪泛要走它）', isRedstoneComponent(WIRE), true);
  equal('绊线钩是红石元件', isRedstoneComponent(HOOK), true);
  check('两者的贴图都在图集名单里', [...blockDef(WIRE).tiles, ...blockDef(HOOK).tiles].every((t) => TILES.has(t)));
  check(
    '绊线钩通电时换一张贴图（看状态取）',
    blockDef(HOOK).stateTiles !== undefined && blockDef(HOOK).stateTiles!(withPowered(0, true))[0] !== blockDef(HOOK).stateTiles!(0)[0],
  );
}

// ---------------------------------------------------------------- 2. 几何

console.log('\n[几何：线按邻居换方向，钩子贴墙]');
{
  /** 按"哪些方向连着"造连接回调 */
  const connect = (...facings: readonly number[]) => (facing: number) => facings.includes(facing);

  equal('绊线没有碰撞（踩上去只是触发，不会被绊住）', collisionBoxes('tripwire', 0).length, 0);

  const alongX = meshBoxes('tripwire', 0, { connect: connect(EAST, WEST) });
  equal('东西连上 → 一条沿 X 的线（1 个盒子）', alongX.length, 1);
  check('线沿 X：占满 X、Z 方向只有 2/16 宽', alongX[0]![0] === 0 && alongX[0]![3] === 1 && Math.abs(alongX[0]![5]! - alongX[0]![2]!) - 0.125 < 1e-6);
  check('线很薄（1/16 高）', alongX[0]![4] === 0.0625);

  const alongZ = meshBoxes('tripwire', 0, { connect: connect(NORTH, SOUTH) });
  equal('南北连上 → 一条沿 Z 的线', alongZ.length, 1);
  check('线沿 Z：占满 Z、X 方向只有 2/16 宽', alongZ[0]![2] === 0 && alongZ[0]![5] === 1 && Math.abs(alongZ[0]![3]! - alongZ[0]![0]!) - 0.125 < 1e-6);

  equal('两个方向都连 → 两条线（十字）', meshBoxes('tripwire', 0, { connect: connect(NORTH, EAST, SOUTH, WEST) }).length, 2);
  const alone = meshBoxes('tripwire', 0, { connect: connect() });
  equal('谁都没连 → 画一个小十字（"放了但没接上"一眼看得出来）', alone.length, 1);
  check('孤立的线只有 2/16×2/16 那么小', Math.abs(alone[0]![3]! - alone[0]![0]!) - 0.125 < 1e-6);

  // 钩子：四个朝向
  const expectations: readonly (readonly [number, string, (box: readonly number[]) => boolean])[] = [
    [WEST, '贴西墙 → 底板在西侧', (b) => b[0] === 0 && b[3]! <= 0.07],
    [EAST, '贴东墙 → 底板在东侧', (b) => b[0]! >= 0.93 && b[3] === 1],
    [NORTH, '贴北墙 → 底板在北侧', (b) => b[2] === 0 && b[5]! <= 0.07],
    [SOUTH, '贴南墙 → 底板在南侧', (b) => b[2]! >= 0.93 && b[5] === 1],
  ];
  for (const [facing, label, ok] of expectations) {
    const boxes = meshBoxes('tripwire_hook', hookState(facing));
    check(label, boxes.length === 2 && ok(boxes[0]!));
  }
  const westHook = meshBoxes('tripwire_hook', hookState(WEST));
  check(
    '钩子往"线的方向"伸出去（贴西墙 → 往东伸 6/16）',
    westHook[1]![0] === 0.0625 && Math.abs(westHook[1]![3]! - 0.4375) < 1e-6,
  );
  equal('钩子只有底板挡路（细钩子不挡）', collisionBoxes('tripwire_hook', hookState(WEST)).length, 1);
  check(
    '碰撞盒就是那块底板（与渲染同源）',
    collisionBoxes('tripwire_hook', hookState(WEST))[0]!.join(',') === westHook[0]!.join(','),
  );
}

// ---------------------------------------------------------------- 3. 状态位

console.log('\n[状态位与朝向换算]');
{
  equal('线的方向 = 朝向的反方向（贴西墙 → 线往东）', tripwireWireDirection(hookState(WEST)), EAST);
  equal('贴东墙 → 线往西', tripwireWireDirection(hookState(EAST)), WEST);
  equal('贴北墙 → 线往南', tripwireWireDirection(hookState(NORTH)), SOUTH);
  equal('贴南墙 → 线往北', tripwireWireDirection(hookState(SOUTH)), NORTH);

  const state = withTripwireAttached(withPowered(withDisarmed(0, true), true), true);
  equal('剪断位独立', isDisarmed(state), true);
  equal('通电位独立', isPowered(state), true);
  equal('接上位独立', isTripwireAttached(state), true);
  const hookWithFacing = withFacing(withTripwireAttached(0, true), EAST);
  equal('接上位不会弄坏朝向', facingOf(hookWithFacing), EAST);
  equal('关掉剪断', isDisarmed(withDisarmed(state, false)), false);
}

// ---------------------------------------------------------------- 4. 回路

console.log('\n[回路：两根相对的钩子 + 中间的线]');
{
  const { world } = circuit(false);
  equal('回路接上了（hook 的 attached 位亮起来）', isTripwireAttached(world.getState(0, 64, 0)), true);
  equal('对面那根钩子也认为接上了', isTripwireAttached(world.getState(4, 64, 0)), true);
  equal('没实体时不上电', lampOn(world), false);
  equal('线上的 powered 位也是灭的', isPowered(world.getState(2, 64, 0)), false);

  // 对面钩子朝向一致 → 不算一条回路
  const sameFacing = new TripwireStub();
  sameFacing.set(0, 64, 0, HOOK, hookState(WEST));
  sameFacing.set(4, 64, 0, HOOK, hookState(WEST)); // 两根都"贴西墙"，线都往东
  for (let x = 1; x <= 3; x++) sameFacing.set(x, 64, 0, WIRE);
  sameFacing.set(0, 64, 1, Block.REDSTONE_LAMP);
  new RedstoneEngine().recompute(sameFacing, 0, 64, 0);
  equal('两根朝向一致的钩子不算回路', isTripwireAttached(sameFacing.getState(0, 64, 0)), false);

  // 中间夹了别的方块 → 断
  const broken = new TripwireStub();
  broken.set(0, 64, 0, HOOK, hookState(WEST));
  broken.set(4, 64, 0, HOOK, hookState(EAST));
  broken.set(1, 64, 0, WIRE);
  broken.set(2, 64, 0, Block.STONE); // 断了
  broken.set(3, 64, 0, WIRE);
  new RedstoneEngine().recompute(broken, 0, 64, 0);
  equal('中间夹了别的方块 → 接不上', isTripwireAttached(broken.getState(0, 64, 0)), false);

  // 线太长 → 接不上（原版 40 格）
  const tooLong = new TripwireStub();
  tooLong.set(0, 64, 0, HOOK, hookState(WEST));
  for (let x = 1; x <= TRIPWIRE_MAX_LENGTH + 1; x++) tooLong.set(x, 64, 0, WIRE);
  tooLong.set(TRIPWIRE_MAX_LENGTH + 2, 64, 0, HOOK, hookState(EAST));
  new RedstoneEngine().recompute(tooLong, 0, 64, 0);
  equal(`超过 ${TRIPWIRE_MAX_LENGTH} 格的线接不上（原版上限）`, isTripwireAttached(tooLong.getState(0, 64, 0)), false);

  // 只有一根钩子（另一端是空气）→ 接不上
  const single = new TripwireStub();
  single.set(0, 64, 0, HOOK, hookState(WEST));
  single.set(1, 64, 0, WIRE);
  new RedstoneEngine().recompute(single, 0, 64, 0);
  equal('另一端没有钩子 → 接不上', isTripwireAttached(single.getState(0, 64, 0)), false);
}

// ---------------------------------------------------------------- 5. 踩上去（实体轮询）

console.log('\n[踩上去：实体轮询触发]');
{
  const { world, engine } = circuit(true);
  // 重算时是**直接看世界**的（实体在不在线上一看就知道），所以初始就已经触发了；
  // "轮询"要解决的是**别的**问题：实体来去**不会产生方块变化事件**，没人通知电路
  equal('重算时直接看世界：实体在线上 → 立刻触发', lampOn(world), true);
  equal('线上那一格的 powered 位也亮起来（原版绊线也有这个状态）', isPowered(world.getState(2, 64, 0)), true);
  equal('钩子自己的 powered 位也亮起来（渲染要换贴图）', isPowered(world.getState(0, 64, 0)), true);

  // 实体走开：**没有任何方块变化**，只能靠轮询发现
  world.entities.clear();
  equal('实体走开后（还没轮到轮询）灯还是亮着——这正是"为什么需要轮询"', lampOn(world), true);
  engine.tick(world, 0.11);
  // 红石灯断电后 0.2 秒才灭（批次 250）
  engine.tick(world, 0.3);
  equal('轮询到了 → 灯灭', lampOn(world), false);
  equal('线上的 powered 位也跟着灭', isPowered(world.getState(2, 64, 0)), false);

  // 再踩上去
  world.entities.add('3,64,0');
  equal('踩上去（同样没有方块变化）', lampOn(world), false);
  engine.tick(world, 0.11);
  equal('轮询到 → 又亮', lampOn(world), true);

  // 没变化就不重算
  const before = engine.updates;
  engine.tick(world, 0.11);
  equal('实体状态没变时不重算', engine.updates, before);

  // 没有被剪断的线上有实体才算触发；被剪的那一格不算
  const armed = circuit(true);
  equal('剪断前：有实体 → 触发', (() => {
    armed.engine.tick(armed.world, 0.11);
    return lampOn(armed.world);
  })(), true);
}

console.log('\n[剪断：这一格不再触发，但回路还连着]');
{
  const { world, engine } = circuit(true);
  engine.tick(world, 0.11);
  equal('先确认触发着', lampOn(world), true);

  equal('剪刀剪断（走在线的格上）', engine.disarmTripwire(world, 2, 64, 0), true);
  equal('剪断位写上了', isDisarmed(world.getState(2, 64, 0)), true);
  // 立刻重算了，但灯有 0.2 秒余晖（批次 250）
  engine.tick(world, 0.3);
  equal('剪断后立刻重算 → 灯灭（这一格不再触发）', lampOn(world), false);
  equal('但回路**没有断**（还是 attached）', isTripwireAttached(world.getState(0, 64, 0)), true);
  equal('重复剪同一格返回 false（已经剪过了）', engine.disarmTripwire(world, 2, 64, 0), false);
  equal('对着别的方块剪返回 false', engine.disarmTripwire(world, 0, 64, 0), false);

  // 另一格上放个实体，仍然会触发（剪断只影响那一格）
  world.entities.clear();
  world.entities.add('1,64,0');
  engine.tick(world, 0.11);
  equal('把实体挪到**没剪断**的那一格 → 又触发', lampOn(world), true);
}

// ---------------------------------------------------------------- 6. 放置、掉落与配方

console.log('\n[放置、掉落与配方]');
{
  const place = (normal: readonly [number, number, number]) =>
    planPlacement({
      blockId: HOOK,
      normal,
      hitX: 10.5,
      hitY: 64,
      hitZ: 10.5,
      yaw: 0,
      sneaking: false,
      blockAt: () => Block.STONE,
      hitBlock: Block.STONE,
      hitState: 0,
    });

  const onWall = place([1, 0, 0]);
  check('绊线钩：贴在侧面 → 能放', onWall !== null);
  // 法线指向"新方块所在那一侧"：命中东面 = 新方块在命中方块的东边，
  // 也就是它贴的是自己**西边**那面墙 → 朝向记西（线往东延伸）
  equal('命中的是东面 → 钩子贴西墙（朝向记西）', onWall ? facingOf(onWall.state) : -1, WEST);
  equal('于是线往东延伸', onWall ? tripwireWireDirection(onWall.state) : -1, EAST);
  check('绊线钩：放地上 → 拒绝（原版只能贴墙）', place([0, 1, 0]) === null);
  check('绊线钩：放天花板下 → 拒绝', place([0, -1, 0]) === null);

  const ctx = (over: Partial<DropContext> = {}): DropContext => ({
    shears: false,
    silkTouch: false,
    fortune: 0,
    doubleSlab: false,
    roll: () => 0.99,
    ...over,
  });
  equal('绊线拆掉退回 1 根线（它没有物品）', blockDrops(WIRE, ctx())?.id, Item.STRING);
  equal('退回的线只有 1 根', blockDrops(WIRE, ctx())?.count, 1);
  equal('绊线钩拆掉掉自身', blockDrops(HOOK, ctx())?.id, HOOK);
  equal('dropFor(绊线) 也是线', dropFor(WIRE)?.id, Item.STRING);

  // 配方：铁锭 / 木棍 / 木板 竖着摆 → 2 个
  const cells = [Item.IRON_INGOT, 0, 0, Item.STICK, 0, 0, Block.OAK_PLANKS, 0, 0];
  const recipe = matchRecipe(cells, 3);
  equal('铁锭 + 木棍 + 木板 → 绊线钩', recipe?.id, HOOK);
  equal('一次做 2 个（原版）', recipe?.count, 2);
  equal(
    '顺序不对做不出来（铁锭必须在最上面）',
    matchRecipe([Item.STICK, 0, 0, Item.IRON_INGOT, 0, 0, Block.OAK_PLANKS, 0, 0], 3),
    null,
  );
}

console.log(`\n绊线与绊线钩测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
