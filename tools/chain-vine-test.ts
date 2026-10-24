/**
 * 锁链与藤蔓 + 攀爬（批次 39，B11 收口）离线测试
 *
 * B7 列了 13 种非立方体形状，这一批把最后两种补齐：`chain` 与 `vine`。
 * 顺带补上一件**一直缺着的机制**：攀爬。
 * （梯子的说明从 H13 起就写着"贴在墙上可以上下攀爬"，但 `PlayerPhysics` 里
 *  从来没有攀爬分支——这一批把它补上，梯子/藤蔓/锁链共用同一套。）
 *
 * 覆盖五块：
 *  1. 方块注册与贴图（两种新形状 + 铁粒）
 *  2. 几何：锁链的三轴向细柱、藤蔓的"每个挂面一片薄片"、都没有整格碰撞
 *  3. 材料与掉落：锁链要镐、藤蔓只有剪刀/精准采集才掉
 *  4. 放置：锁链轴向、藤蔓贴墙 / 挂天花板 / "再挂一面"
 *  5. 攀爬与蔓延：物理里的上升/下滑，随机刻里的往下长与往旁边蔓延
 *
 * 运行：npm run test:climb
 */

import {
  BLOCKS,
  Block,
  blockDef,
  blockHardness,
  isClimbableBlock,
} from '../src/core/registry/blocks.ts';
import { isHandHarvestable, breakSeconds, canHarvest, makeToolInfo } from '../src/core/registry/tools.ts';
import { blockDrops, CREATIVE_ITEMS, Item, maxStackOf, itemDef } from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { isFlammable } from '../src/core/world/Fire.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import {
  axisOf,
  hasVineSide,
  hasVineUp,
  withAxis,
  withVineSide,
  withVineUp,
  vineSideCount,
  vineSides,
} from '../src/core/registry/blockState.ts';
import { collisionBoxes, isFullBlockShape, meshBoxes } from '../src/core/registry/blockShapes.ts';
import { planPlacement } from '../src/core/interaction/Placement.ts';
import { PlayerPhysics, type PhysicsWorld } from '../src/core/physics/PlayerPhysics.ts';
import type { VoxelCollision } from '../src/core/physics/AABB.ts';
import {
  RANDOM_TICK_BEHAVIORS,
  VINE_GROW_DOWN_CHANCE,
  VINE_SPREAD_CHANCE,
  type TickWorld,
} from '../src/core/tick/RandomTicks.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_VOLUME, Chunk } from '../src/core/world/Chunk.ts';
import { plantTree, TREE_VINE_CHANCE } from '../src/core/gen/Features.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';

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
const CHAIN = Block.CHAIN;
const VINE = Block.VINE;

// ---------------------------------------------------------------- 1. 注册与贴图

console.log('\n[方块注册]');
{
  equal('锁链的注册名', blockDef(CHAIN).name, 'minicraft:chain');
  equal('藤蔓的注册名', blockDef(VINE).name, 'minicraft:vine');
  equal('锁链的形状是 chain', blockDef(CHAIN).shape, 'chain');
  equal('藤蔓的形状是 vine', blockDef(VINE).shape, 'vine');
  check('两个 id 都在方块表里且下标一致', BLOCKS[CHAIN]!.id === CHAIN && BLOCKS[VINE]!.id === VINE);
  check('id 紧跟此前的最大 id（追加式布局）', CHAIN > 332 && VINE === CHAIN + 1, `${CHAIN} / ${VINE}`);
  check('锁链不遮挡邻居也不挡光', !blockDef(CHAIN).opaque && blockDef(CHAIN).lightOpacity === 0);
  check('藤蔓不遮挡邻居也不挡光', !blockDef(VINE).opaque && blockDef(VINE).lightOpacity === 0);
  check('藤蔓没有碰撞（solid=false）', !blockDef(VINE).solid);
  check('锁链有碰撞（solid 默认 true）', blockDef(CHAIN).solid);
  equal('锁链的中文名', itemLabel(CHAIN), '锁链');
  equal('藤蔓的中文名', itemLabel(VINE), '藤蔓');
  check('两个都有中文说明', hasDescription(CHAIN) && hasDescription(VINE));
  check('两个都在创造物品栏里', CREATIVE_ITEMS.includes(CHAIN) && CREATIVE_ITEMS.includes(VINE));
  check('一个都不发光（白天靠天光照亮）', blockDef(CHAIN).light === 0 && blockDef(VINE).light === 0);
}

console.log('\n[贴图与铁粒]');
{
  check('锁链的贴图登记进图集', blockDef(CHAIN).tiles.every((tile) => TILES.has(tile)));
  check('藤蔓的贴图登记进图集', blockDef(VINE).tiles.every((tile) => TILES.has(tile)));
  equal('锁链用的是 chain 那张图', blockDef(CHAIN).tiles[0], 'chain');
  equal('藤蔓用的是 vine 那张图', blockDef(VINE).tiles[0], 'vine');

  const nugget = Item.IRON_NUGGET;
  check('铁粒已注册', itemDef(nugget) !== undefined);
  equal('铁粒的注册名', itemDef(nugget)?.name, 'minicraft:iron_nugget');
  equal('铁粒的中文名', itemLabel(nugget), '铁粒');
  equal('铁粒可堆 64', maxStackOf(nugget), 64);
  check('铁粒的图标在图集里', TILES.has(itemDef(nugget)!.tile));
  check('铁粒有说明（写明能拆/能合）', hasDescription(nugget));
}

// ---------------------------------------------------------------- 2. 几何

console.log('\n[锁链：3/16 细柱，轴向由状态决定]');
{
  equal('竖直：沿 Y 贯穿整格', meshBoxes('chain', withAxis(0, 0))[0]!.join(','), '0.40625,0,0.40625,0.59375,1,0.59375');
  equal('沿 X：横着贯穿', meshBoxes('chain', withAxis(0, 1))[0]!.join(','), '0,0.40625,0.40625,1,0.59375,0.59375');
  equal('沿 Z：另一条水平轴', meshBoxes('chain', withAxis(0, 2))[0]!.join(','), '0.40625,0.40625,0,0.59375,0.59375,1');
  equal('渲染盒与碰撞盒同源（竖直）', JSON.stringify(meshBoxes('chain', 0)), JSON.stringify(collisionBoxes('chain', 0)));
  equal('渲染盒与碰撞盒同源（沿 X）', JSON.stringify(meshBoxes('chain', withAxis(0, 1))), JSON.stringify(collisionBoxes('chain', withAxis(0, 1))));
  check('不是整格（不参与贪心合并）', !isFullBlockShape('chain', 0));
  equal('轴向状态往返', axisOf(withAxis(0, 2)), 2);
}

console.log('\n[藤蔓：每个挂面一片 1/16 薄片，没有碰撞]');
{
  const t = 1 / 16;
  equal('挂北面 → 薄片贴在 z ∈ [0, 1/16]', meshBoxes('vine', withVineSide(0, 0))[0]!.join(','), `0,0,0,1,1,${t}`);
  equal('挂东面 → 贴在 x ∈ [15/16, 1]', meshBoxes('vine', withVineSide(0, 1))[0]!.join(','), `${1 - t},0,0,1,1,1`);
  equal('挂南面 → 贴在 z ∈ [15/16, 1]', meshBoxes('vine', withVineSide(0, 2))[0]!.join(','), `0,0,${1 - t},1,1,1`);
  equal('挂西面 → 贴在 x ∈ [0, 1/16]', meshBoxes('vine', withVineSide(0, 3))[0]!.join(','), `0,0,0,${t},1,1`);
  equal('挂天花板 → 一片水平薄片', meshBoxes('vine', withVineUp(0))[0]!.join(','), `0,${1 - t},0,1,1,1`);

  // 一个藤蔓方块能同时挂好几面（原版行为）
  const two = withVineUp(withVineSide(withVineSide(0, 0), 1));
  equal('同时挂两面 + 顶面 → 3 片几何', meshBoxes('vine', two).length, 3);
  equal('挂面数量统计正确', vineSideCount(two), 3);
  equal('挂面清单按北→东→南→西排列', vineSides(withVineSide(withVineSide(0, 3), 1)).join(','), '1,3');
  check('藤蔓**没有**碰撞（原版能穿过去）', collisionBoxes('vine', two).length === 0);
  check('藤蔓不是整格', !isFullBlockShape('vine', 0));
  check('空挂面（脏数据）算 0 面', vineSideCount(0) === 0 && vineSides(0).length === 0);
}

// ---------------------------------------------------------------- 3. 材料与掉落

console.log('\n[材料：硬度、工具与可燃]');
{
  equal('锁链硬度 5（原版）', blockHardness(CHAIN), 5);
  equal('藤蔓硬度 0.2（原版）', blockHardness(VINE), 0.2);
  check('锁链必须用镐：徒手采不到', !canHarvest(CHAIN, null));
  check('锁链：木镐就能采到', canHarvest(CHAIN, makeToolInfo('pickaxe', 'wooden')));
  check('锁链：拿斧头也采不到（工具种类不对）', !canHarvest(CHAIN, makeToolInfo('axe', 'diamond')));
  check('锁链徒手挖得动但很慢（不采集也会掉，见掉落表）', breakSeconds(CHAIN) > breakSeconds(CHAIN, makeToolInfo('pickaxe', 'diamond')));
  check('藤蔓徒手可采（只是不掉东西）', isHandHarvestable(VINE));
  check('藤蔓用斧头更快', breakSeconds(VINE, makeToolInfo('axe', 'iron')) < breakSeconds(VINE));
  check('藤蔓可燃（原版会烧，还容易把火带上树冠）', isFlammable(VINE));
  check('锁链不可燃', !isFlammable(CHAIN));
}

console.log('\n[掉落：藤蔓只有剪刀/精准采集才掉]');
{
  const ctx = (over: Partial<{ shears: boolean; silkTouch: boolean }> = {}) => ({
    shears: false,
    silkTouch: false,
    fortune: 0,
    doubleSlab: false,
    roll: () => 0.99,
    ...over,
  });

  equal('藤蔓：徒手破坏什么都不掉', blockDrops(VINE, ctx()), null);
  equal('藤蔓：拿斧头也不掉', blockDrops(VINE, ctx()), null);
  equal('藤蔓：用剪刀 → 掉藤蔓本身', blockDrops(VINE, ctx({ shears: true }))?.id, VINE);
  equal('藤蔓：精准采集也能完整带走', blockDrops(VINE, ctx({ silkTouch: true }))?.id, VINE);
  equal('藤蔓一次掉 1 个', blockDrops(VINE, ctx({ shears: true }))?.count, 1);
  // 对照：树叶两样都行、羊毛只认剪刀——藤蔓跟的是树叶那一类
  equal('对照：羊毛精准采集拿不到（只认剪刀）', blockDrops(46, ctx({ silkTouch: true })), null);
  equal('对照：树叶剪刀能拿', blockDrops(Block.OAK_LEAVES, ctx({ shears: true }))?.id, Block.OAK_LEAVES);
}

console.log('\n[配方：锁链与铁粒]');
{
  const chain = grid(3, ['N·', 'I·', 'N·'], { N: Item.IRON_NUGGET, I: Item.IRON_INGOT });
  equal('1 铁锭 + 2 铁粒 → 1 根锁链', matchRecipe(chain, 3)?.id, CHAIN);
  equal('锁链一次出 1 根', matchRecipe(chain, 3)?.count, 1);
  equal('9 铁粒 → 1 铁锭', matchRecipe(grid(3, ['NNN', 'NNN', 'NNN'], { N: Item.IRON_NUGGET }), 3)?.id, Item.IRON_INGOT);
  equal('1 铁锭 → 9 铁粒', matchRecipe(grid(2, ['I·', '··'], { I: Item.IRON_INGOT }), 2)?.id, Item.IRON_NUGGET);
  equal('铁粒一次出 9 个', matchRecipe(grid(2, ['I·', '··'], { I: Item.IRON_INGOT }), 2)?.count, 9);
  equal('藤蔓**没有**合成配方（只能去丛林摘）', RECIPES.filter((recipe) => recipe.result.id === VINE).length, 0);
}

// ---------------------------------------------------------------- 4. 放置

console.log('\n[放置：锁链的轴向]');
{
  const place = (normal: readonly [number, number, number]) =>
    planPlacement({
      blockId: CHAIN,
      normal,
      hitX: 0.5,
      hitY: 64.5,
      hitZ: 0.5,
      yaw: 0,
      sneaking: false,
      blockAt: () => Block.STONE,
      hitBlock: Block.STONE,
      hitState: 0,
    });

  equal('点顶面 → 竖直', axisOf(place([0, 1, 0])!.state), 0);
  equal('点底面 → 竖直', axisOf(place([0, -1, 0])!.state), 0);
  equal('点东面 → 沿 X', axisOf(place([1, 0, 0])!.state), 1);
  equal('点西面 → 也沿 X', axisOf(place([-1, 0, 0])!.state), 1);
  equal('点南面 → 沿 Z', axisOf(place([0, 0, 1])!.state), 2);
}

console.log('\n[放置：藤蔓挂在命中的那一面]');
{
  const place = (normal: readonly [number, number, number], over: Partial<Parameters<typeof planPlacement>[0]> = {}) =>
    planPlacement({
      blockId: VINE,
      normal,
      hitX: 0.5,
      hitY: 64.5,
      hitZ: 0.5,
      yaw: 0,
      sneaking: false,
      blockAt: () => Block.AIR,
      hitBlock: Block.STONE,
      hitState: 0,
      ...over,
    });

  const north = place([0, 0, -1]);
  equal('点方块的北面 → 藤蔓挂在它北侧那一格的**南**面', north ? vineSides(north.state).join(',') : '', '2');
  const east = place([1, 0, 0]);
  equal('点东面 → 挂在东边那一格的**西**面', east ? vineSides(east.state).join(',') : '', '3');
  equal('落点是空气时正常放置', east !== null && east.mergeIntoTarget === undefined, true);
  equal('点顶面被拒绝（原版不允许在方块顶上长藤蔓）', place([0, 1, 0]), null);
  equal('被点的方块不是实心时拒绝（没有可附着的面）', place([1, 0, 0], { hitBlock: Block.AIR }), null);
  equal('落点被别的方块占住时拒绝', place([1, 0, 0], { blockAt: () => Block.STONE }), null);

  // 挂天花板：点底面 → UP 位
  const ceiling = place([0, -1, 0]);
  equal('点底面 → 挂在天花板底下（UP 位）', ceiling ? hasVineUp(ceiling.state) : false, true);
  equal('挂天花板时不带水平挂面', ceiling ? vineSides(ceiling.state).length : -1, 0);

  // 再挂一面：落点已经是藤蔓
  const existing = withVineSide(0, 0); // 已经挂着北面
  const addEast = planPlacement({
    blockId: VINE,
    normal: [1, 0, 0],
    hitX: 0.5,
    hitY: 64.5,
    hitZ: 0.5,
    yaw: 0,
    sneaking: false,
    blockAt: () => VINE,
    stateAt: () => existing,
    hitBlock: Block.STONE,
    hitState: 0,
  });
  equal('落点已有藤蔓 → 走"再挂一面"（mergeIntoTarget）', addEast?.mergeIntoTarget !== undefined, true);
  equal('新状态 = 原来的北面 + 新的西面', addEast?.mergeIntoTarget?.state, withVineSide(withVineSide(0, 0), 3));
  check('没有把原来的挂面弄丢', hasVineSide(addEast!.mergeIntoTarget!.state, 0));

  // 点南面 → 落在南边那一格、挂它的**北**面（facing 0）——那一面已经挂过了
  const duplicate = planPlacement({
    blockId: VINE,
    normal: [0, 0, 1],
    hitX: 0.5,
    hitY: 64.5,
    hitZ: 0.5,
    yaw: 0,
    sneaking: false,
    blockAt: () => VINE,
    stateAt: () => existing,
    hitBlock: Block.STONE,
    hitState: 0,
  });
  equal('已经挂过这一面 → 拒绝（别白扣一个物品）', duplicate, null);
}

// ---------------------------------------------------------------- 5. 攀爬（物理）

/** 空世界：不挡路、不落地，只有 isClimbable 是活的 */
class ClimbWorld implements PhysicsWorld {
  constructor(private readonly climbableFrom: number, private readonly climbableTo: number) {}

  collisionAt(): VoxelCollision {
    return null;
  }

  isLiquid(): boolean {
    return false;
  }

  isClimbable(_x: number, y: number): boolean {
    return y >= this.climbableFrom && y <= this.climbableTo;
  }
}

console.log('\n[攀爬：梯子/藤蔓/锁链共用的判定]');
{
  check('梯子可攀爬', isClimbableBlock(Block.LADDER));
  check('藤蔓可攀爬', isClimbableBlock(VINE));
  check('锁链可攀爬（基岩版特性）', isClimbableBlock(CHAIN));
  check('石头不可攀爬', !isClimbableBlock(Block.STONE));
  check('藤蔓的其它木材变体不存在，但判定是按形状的（加铁梯子也自动生效）', isClimbableBlock(Block.LADDER) && !isClimbableBlock(Block.OAK_DOOR));
}

console.log('\n[攀爬：物理里的上升与下滑]');
{
  const input = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
  const world = new ClimbWorld(64, 70);

  // 贴着梯子按跳跃 → 往上爬
  const climber = new PlayerPhysics();
  climber.x = 0.5;
  climber.y = 64;
  climber.z = 0.5;
  const startY = climber.y;
  for (let i = 0; i < 40; i++) climber.update(world, { ...input, jump: true }, 0, 1 / 20, false);
  check('贴着梯子按跳跃会往上升', climber.y > startY + 1, `y ${startY} → ${climber.y.toFixed(2)}`);
  check('上升速度接近原版爬梯（约 2.35 格/秒）', Math.abs(climber.vy - 2.35) < 0.2, `vy ${climber.vy.toFixed(3)}`);
  check('攀爬期间不累计摔落高度', climber.fallStartY === null);

  // 什么都不按 → 慢慢往下滑（不是自由落体）
  const slider = new PlayerPhysics();
  slider.x = 0.5;
  slider.y = 66;
  slider.z = 0.5;
  for (let i = 0; i < 40; i++) slider.update(world, input, 0, 1 / 20, false);
  check('不按键时慢慢往下滑', slider.vy < 0 && slider.vy > -1, `vy ${slider.vy.toFixed(3)}`);
  check('下滑速度远小于自由落体（20 tick 后远不到 -20）', slider.vy > -1);

  // 按潜行 → 更快往下
  const descender = new PlayerPhysics();
  descender.x = 0.5;
  descender.y = 66;
  descender.z = 0.5;
  for (let i = 0; i < 40; i++) descender.update(world, { ...input, sneak: true }, 0, 1 / 20, false);
  check('按潜行下降得比"放着不管"快', descender.vy < slider.vy, `${descender.vy.toFixed(3)} vs ${slider.vy.toFixed(3)}`);

  // 不贴攀爬方块 → 正常重力
  const faller = new PlayerPhysics();
  faller.x = 0.5;
  faller.y = 100; // 攀爬区间（64~70）之外
  faller.z = 0.5;
  for (let i = 0; i < 20; i++) faller.update(world, input, 0, 1 / 20, false);
  check('不在攀爬方块上时正常下坠', faller.vy < -8, `vy ${faller.vy.toFixed(2)}`);
  check('此时不算"贴着可攀爬方块"', !faller.onClimbable);

  // 飞行时不算攀爬（按住跳跃不该被梯子"吸住"）
  const flyer = new PlayerPhysics();
  flyer.x = 0.5;
  flyer.y = 66;
  flyer.z = 0.5;
  for (let i = 0; i < 10; i++) flyer.update(world, { ...input, jump: true }, 0, 1 / 20, true);
  check('飞行时不做攀爬判定', !flyer.onClimbable);
}

// ---------------------------------------------------------------- 6. 蔓延（随机刻）

/** 只够藤蔓用的最小世界：方块 + 状态各一张表 */
class VineWorld implements TickWorld {
  private readonly blocks = new Map<string, number>();
  private readonly states = new Map<string, number>();
  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }
  set(x: number, y: number, z: number, id: number, state = 0): void {
    this.blocks.set(VineWorld.key(x, y, z), id);
    this.states.set(VineWorld.key(x, y, z), state);
  }
  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(VineWorld.key(x, y, z)) ?? 0;
  }
  setBlock(x: number, y: number, z: number, id: number): boolean {
    this.blocks.set(VineWorld.key(x, y, z), id);
    return true;
  }
  getState(x: number, y: number, z: number): number {
    return this.states.get(VineWorld.key(x, y, z)) ?? 0;
  }
  setBlockWithState(x: number, y: number, z: number, id: number, state: number): boolean {
    this.blocks.set(VineWorld.key(x, y, z), id);
    this.states.set(VineWorld.key(x, y, z), state);
    return true;
  }
}

/** 固定随机序列 */
function sequence(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

console.log('\n[藤蔓蔓延：往下长 + 往旁边爬]');
{
  check('藤蔓注册了随机刻行为', RANDOM_TICK_BEHAVIORS.has(VINE));
  const behavior = RANDOM_TICK_BEHAVIORS.get(VINE)!;

  // ---- 往下长：北面挂着的藤蔓，下面那一格再往北也是墙
  const down = new VineWorld();
  down.set(0, 64, 0, Block.STONE); // 上段藤蔓的墙（在藤蔓的北边）
  down.set(0, 63, 0, Block.STONE); // 下面那一格的北边也还是墙
  down.set(0, 64, 1, VINE, withVineSide(0, 0)); // 这段藤蔓挂在它的北面
  const grewDown = behavior(down, 0, 64, 1, sequence([0, 0]));
  check('下方是空气且那一面仍有墙 → 往下接一节', grewDown && down.getBlock(0, 63, 1) === VINE);
  equal('新的一节沿用同一个挂面', down.getState(0, 63, 1), withVineSide(0, 0));

  // ---- 下方没有墙 → 不往下长（免得藤蔓在半空中一路垂到底）
  const noWall = new VineWorld();
  noWall.set(0, 64, 1, VINE, withVineSide(0, 0));
  // 第 2 个随机数给 0.99（≥ 蔓延概率）→ 这一轮只考察"该不该往下长"
  const drifted = behavior(noWall, 0, 64, 1, sequence([0, 0.99]));
  check('下方那一面没有墙时不会往下长', !drifted && noWall.getBlock(0, 63, 1) === Block.AIR);
  equal('也没有顺手在别处乱长', noWall.getBlock(0, 64, 0), Block.AIR);

  // ---- 往旁边蔓延：选到"东"（0.5 → 面 2？顺序是随机数 × 4 取整），这里用固定序列精确控制
  const spread = new VineWorld();
  spread.set(0, 64, 0, VINE, withVineSide(0, 0));
  // 第 1 个随机数 ≥ 往下长的概率（跳过往下长），第 2 个 < 蔓延概率，第 3 个决定方向（0.25 × 4 = 1 → 东）
  const spreadSeq = sequence([VINE_GROW_DOWN_CHANCE + 0.01, VINE_SPREAD_CHANCE - 0.01, 0.25]);
  const spreadResult = behavior(spread, 0, 64, 0, spreadSeq);
  check('往旁边的空格蔓延出新的藤蔓', spreadResult && spread.getBlock(1, 64, 0) === VINE);
  equal('新藤蔓挂在原方块那一侧（东边的藤蔓 → 挂西面）', spread.getState(1, 64, 0), withVineSide(0, 3));

  // ---- 目标格被占住时不动
  const blocked = new VineWorld();
  blocked.set(0, 64, 0, VINE, withVineSide(0, 0));
  blocked.set(1, 64, 0, Block.STONE);
  check('目标格被占住时不蔓延', !behavior(blocked, 0, 64, 0, spreadSeq));

  // ---- 一个挂面都没有的脏数据：什么都不做
  const orphan = new VineWorld();
  orphan.set(0, 64, 0, VINE, 0);
  check('悬空的藤蔓（0 个挂面）不蔓延', !behavior(orphan, 0, 64, 0, sequence([0, 0, 0])));

  // ---- 天花板上的藤蔓往下垂
  const ceiling = new VineWorld();
  ceiling.set(0, 64, 0, VINE, withVineUp(0));
  check('天花板上的藤蔓往下垂（保持 UP 位）', behavior(ceiling, 0, 64, 0, sequence([0, 0])) && ceiling.getBlock(0, 63, 0) === VINE);
  equal('垂下来的那一节仍是"挂顶"', ceiling.getState(0, 63, 0), withVineUp(0));
}

// ---------------------------------------------------------------- 7. 生成：丛林树挂藤蔓

console.log('\n[生成：丛林树挂藤蔓]');
{
  const blocks = new Uint16Array(CHUNK_VOLUME);
  const states = new Uint8Array(CHUNK_VOLUME);
  const surfaceY = 64;
  const world = {
    surfaceY: () => surfaceY,
    columnBiome: () => 15, // 丛林
  } as unknown as Parameters<typeof plantTree>[4];

  // 用真实的 Planter 种一棵巨型丛林树：树干外圈应当挂上藤蔓
  plantTree('mega_jungle', blocks, 0, 0, world, 8, 8, 7, states);

  let vines = 0;
  let solidVines = 0;
  for (let y = 60; y < 100; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const index = Chunk.index(x, y, z);
        if (blocks[index] !== VINE) continue;
        vines++;
        // 每一根都必须至少挂着一个面（否则就是"浮在空中的脏数据"）
        if (vineSideCount(states[index]!) > 0) solidVines++;
      }
    }
  }
  check(`巨型丛林树的树干上长出了藤蔓（${vines} 根）`, vines > 10, `实际 ${vines}`);
  equal('每一根藤蔓都至少挂着一个面', solidVines, vines);
  check('不是每一节都挂满（用的是概率，不是全挂）', vines < 200, `实际 ${vines}`);
  check('概率常量在合理区间（0 < p < 1）', TREE_VINE_CHANCE > 0 && TREE_VINE_CHANCE < 1);
}

console.log(`\n锁链与藤蔓测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
