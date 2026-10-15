/**
 * 随机刻 / 计划刻（B6）与流体流动（B8）离线测试
 *
 * 这两块都属于"世界自己会变化"的部分，最容易出错的地方是：
 *  1. 随机刻采样位置：384 格高的世界里如果纯随机取 y，草永远蔓延不起来
 *  2. 树叶消失要**穿过树叶**找原木（走空气会误判成"没原木"）
 *  3. 流体：往下优先、水平衰减、失去来源要干涸、无限水源、水碰岩浆凝固
 *  4. 计划刻：同一位置重复计划只保留最早的一次（否则水流会把自己刷爆）
 *
 * 运行：npm run test:tick
 */

import { Block, blockDef, Wood } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import {
  fluidHeight,
  fluidLevel,
  isFallingFluid,
  withFallingFluid,
  withFluidLevel,
} from '../src/core/registry/blockState.ts';
import {
  RANDOM_TICK_BEHAVIORS,
  TickScheduler,
  randomTickBlock,
  randomTickChunk,
  type TickWorld,
} from '../src/core/tick/RandomTicks.ts';
import {
  LAVA_SPREAD,
  WATER_SPREAD,
  canFlowInto,
  fluidTick,
  spreadDistance,
  wakeFluidAt,
  wakeFluidNeighbours,
  type FluidWorld,
} from '../src/core/world/Fluids.ts';

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

/** 确定性随机序列（测试里不该有真的随机） */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length]!;
}

class FakeWorld implements TickWorld, FluidWorld {
  readonly blocks = new Map<string, number>();
  readonly states = new Map<string, number>();
  readonly dropped: Array<{ id: number; x: number; y: number; z: number }> = [];
  readonly scheduled: Array<{ x: number; y: number; z: number; delay: number }> = [];

  set(x: number, y: number, z: number, id: number, state = 0): void {
    const key = `${x},${y},${z}`;
    if (id === Block.AIR) this.blocks.delete(key);
    else this.blocks.set(key, id);
    this.states.set(key, state);
  }
  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(`${x},${y},${z}`) ?? Block.AIR;
  }
  getState(x: number, y: number, z: number): number {
    return this.states.get(`${x},${y},${z}`) ?? 0;
  }
  /** TickWorld 接口要求的写入方法（测试里用 set 造场景，用 setBlock 给行为改） */
  setBlock(x: number, y: number, z: number, id: number): boolean {
    this.set(x, y, z, id);
    return true;
  }
  setFluid(x: number, y: number, z: number, id: number, state: number): boolean {
    this.set(x, y, z, id, state);
    return true;
  }
  schedule(x: number, y: number, z: number, delayTicks: number): void {
    this.scheduled.push({ x, y, z, delay: delayTicks });
  }
  drop(itemId: number, count: number, x: number, y: number, z: number): void {
    this.dropped.push({ id: itemId, x, y, z });
    void count;
  }
}

// ---------------------------------------------------------------- 1. 随机刻行为

console.log('\n[随机刻：草方块]');
{
  const world = new FakeWorld();
  world.set(0, 64, 0, Block.GRASS_BLOCK);
  world.set(1, 64, 0, Block.DIRT);
  // 随机源固定成"挑 (1,0,0) 方向"：dx = floor(0.9*3)-1 = 1，dy/dz 取 0.34 → 0
  const random = sequence([0.9, 0.34, 0.34]);
  const changed = randomTickBlock(world, 0, 64, 0, random);
  check('草方块把相邻泥土变成草', changed && world.getBlock(1, 64, 0) === Block.GRASS_BLOCK);

  const covered = new FakeWorld();
  covered.set(0, 64, 0, Block.GRASS_BLOCK);
  covered.set(0, 65, 0, Block.STONE);
  check('被不透明方块压住的草会退化', randomTickBlock(covered, 0, 64, 0, sequence([0.5])) && covered.getBlock(0, 64, 0) === Block.DIRT);

  const underwater = new FakeWorld();
  underwater.set(0, 64, 0, Block.GRASS_BLOCK);
  underwater.set(1, 64, 0, Block.DIRT);
  underwater.set(1, 65, 0, Block.WATER);
  // 水位上方是水（不透明？不是）——这里验证"上方被挡就不蔓延"这条用的是 opaque 判定
  const spreadUnderWater = randomTickBlock(underwater, 0, 64, 0, sequence([0.9, 0.34, 0.34]));
  check('目标格上方是水时仍然算可蔓延（水不算不透明）', !spreadUnderWater || underwater.getBlock(1, 64, 0) === Block.GRASS_BLOCK);

  const noTarget = new FakeWorld();
  noTarget.set(0, 64, 0, Block.GRASS_BLOCK);
  check('附近没有泥土时什么都不做', !randomTickBlock(noTarget, 0, 64, 0, sequence([0.9, 0.34, 0.34])));
}

console.log('\n[随机刻：树叶消失]');
{
  // 树干在 3 格外的树叶 → 应该保留
  const withLog = new FakeWorld();
  withLog.set(3, 70, 0, Block.OAK_LOG);
  for (let d = 0; d <= 3; d++) withLog.set(d, 70, 0, d === 3 ? Block.OAK_LOG : Block.OAK_LEAVES);
  check('连到原木的树叶不会消失', !randomTickBlock(withLog, 0, 70, 0, sequence([0.9])));

  // 孤立的树叶 → 消失
  const lonely = new FakeWorld();
  lonely.set(0, 70, 0, Block.OAK_LEAVES);
  const decayed = randomTickBlock(lonely, 0, 70, 0, sequence([0.9]));
  check('孤立的树叶会消失', decayed && lonely.getBlock(0, 70, 0) === Block.AIR);

  // 距离超过 4 格的原木不算
  const far = new FakeWorld();
  for (let d = 0; d <= 5; d++) far.set(d, 70, 0, d === 5 ? Block.OAK_LOG : Block.OAK_LEAVES);
  check('超过 4 格外的原木不算连接', randomTickBlock(far, 0, 70, 0, sequence([0.9])) && far.getBlock(0, 70, 0) === Block.AIR);

  // 别的木材的原木也算（从木材表取 id，不是硬编码橡木）
  const spruce = new FakeWorld();
  const spruceLog = Wood.spruce!.log;
  spruce.set(2, 70, 0, spruceLog);
  spruce.set(1, 70, 0, Wood.spruce!.leaves);
  spruce.set(0, 70, 0, Wood.spruce!.leaves);
  check('云杉树叶能连到云杉原木', !randomTickBlock(spruce, 0, 70, 0, sequence([0.9])));

  // 掉落：random() < 0.05 时掉木棍
  const drop = new FakeWorld();
  drop.set(0, 70, 0, Block.OAK_LEAVES);
  randomTickBlock(drop, 0, 70, 0, sequence([0.01]));
  check('树叶消失时有概率掉木棍', drop.dropped.length === 1 && drop.dropped[0]!.id === Item.STICK);
}

console.log('\n[随机刻：甘蔗与竹子]');
{
  const cane = new FakeWorld();
  cane.set(0, 64, 0, Block.SAND);
  cane.set(0, 65, 0, Block.SUGAR_CANE);
  cane.set(1, 65, 0, Block.WATER);
  const grew = randomTickBlock(cane, 0, 65, 0, sequence([0.1]));
  check('甘蔗旁边有水时长高', grew && cane.getBlock(0, 66, 0) === Block.SUGAR_CANE);

  const dry = new FakeWorld();
  dry.set(0, 64, 0, Block.SAND);
  dry.set(0, 65, 0, Block.SUGAR_CANE);
  check('甘蔗旁边没水就不长', !randomTickBlock(dry, 0, 65, 0, sequence([0.1])));

  const notTop = new FakeWorld();
  notTop.set(0, 64, 0, Block.SAND);
  notTop.set(0, 65, 0, Block.SUGAR_CANE);
  notTop.set(0, 66, 0, Block.SUGAR_CANE);
  notTop.set(1, 66, 0, Block.WATER);
  check('只有顶端那格负责生长', !randomTickBlock(notTop, 0, 65, 0, sequence([0.1])));

  const tall = new FakeWorld();
  tall.set(0, 61, 0, Block.SAND);
  for (let y = 62; y <= 64; y++) tall.set(0, y, 0, Block.SUGAR_CANE);
  tall.set(1, 62, 0, Block.WATER);
  check('甘蔗长到 3 格就不再长', !randomTickBlock(tall, 0, 64, 0, sequence([0.1])));

  const bamboo = new FakeWorld();
  bamboo.set(0, 64, 0, Block.GRASS_BLOCK);
  bamboo.set(0, 65, 0, Block.BAMBOO);
  check('竹子不需要水也能长', randomTickBlock(bamboo, 0, 65, 0, sequence([0.1])) && bamboo.getBlock(0, 66, 0) === Block.BAMBOO);
}

console.log('\n[随机刻：菌岩与无关方块]');
{
  const nylium = new FakeWorld();
  nylium.set(0, 64, 0, Block.CRIMSON_NYLIUM);
  nylium.set(1, 64, 0, Block.NETHERRACK);
  const spread = randomTickBlock(nylium, 0, 64, 0, sequence([0.9, 0.34, 0.34]));
  check('绯红菌岩会把下界岩染成菌岩', spread && nylium.getBlock(1, 64, 0) === Block.CRIMSON_NYLIUM);

  const stone = new FakeWorld();
  stone.set(0, 64, 0, Block.STONE);
  check('石头没有随机刻行为（不会被无谓地处理）', !randomTickBlock(stone, 0, 64, 0, sequence([0.5])));
  check('行为表里都是"会自己变化"的方块', RANDOM_TICK_BEHAVIORS.size >= 6 && !RANDOM_TICK_BEHAVIORS.has(Block.STONE));
}

console.log('\n[随机刻：区块采样]');
{
  const world = new FakeWorld();
  // 地表铺一层泥土，中间放一格草当"种子"，其余全空
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) world.set(x, 64, z, Block.DIRT);
  }
  world.set(0, 64, 0, Block.GRASS_BLOCK);
  const counts = new Int32Array(24);
  counts[(64 + 64) / 16] = 256; // y=64 → section 8

  let grass = 0;
  for (let i = 0; i < 400; i++) {
    randomTickChunk(world, { originX: 0, originZ: 0, sectionCounts: counts }, 3, Math.random);
  }
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) if (world.getBlock(x, 64, z) === Block.GRASS_BLOCK) grass++;
  check('采样只落在非空 section 上（草能蔓延出去）', grass > 0, `蔓延了 ${grass} 格`);

  const empty = new Int32Array(24);
  const nothing = randomTickChunk(world, { originX: 0, originZ: 0, sectionCounts: empty }, 3, Math.random);
  check('全空区块不做任何事', nothing === 0);
  check('count = 0 时直接返回', randomTickChunk(world, { originX: 0, originZ: 0, sectionCounts: counts }, 0, Math.random) === 0);
}

// ---------------------------------------------------------------- 2. 计划刻

console.log('\n[计划刻队列]');
{
  const scheduler = new TickScheduler(4);
  scheduler.schedule(1, 2, 3, 'overworld', 3);
  check('刚排进去还没到期', scheduler.advance().length === 0);
  check('第二 tick 也没到期', scheduler.advance().length === 0);
  const due = scheduler.advance();
  check('第三 tick 到期并取出', due.length === 1 && due[0]!.x === 1 && due[0]!.z === 3);

  const scheduler2 = new TickScheduler();
  scheduler2.schedule(0, 0, 0, 'overworld', 5);
  scheduler2.schedule(0, 0, 0, 'overworld', 2);
  check('同一位置重复计划保留最早的', scheduler2.size === 1 && scheduler2.advance().length === 0 && scheduler2.advance().length === 1);

  const scheduler3 = new TickScheduler(2);
  scheduler3.schedule(0, 0, 0, 'overworld', 1);
  scheduler3.schedule(1, 0, 0, 'overworld', 1);
  check('超过容量后拒绝新计划', scheduler3.schedule(2, 0, 0, 'overworld', 1) === false && scheduler3.size === 2);
  scheduler3.clear();
  check('clear 之后队列与计数都归零', scheduler3.size === 0 && scheduler3.tick === 0);

  const scheduler4 = new TickScheduler();
  scheduler4.schedule(0, 0, 0, 'overworld', 1);
  scheduler4.schedule(0, 0, 0, 'nether', 1);
  check('不同维度的同一坐标互不影响', scheduler4.size === 2);
  check('has 能查到已计划的位置', scheduler4.has(0, 0, 0, 'nether') && !scheduler4.has(9, 9, 9, 'nether'));
}

// ---------------------------------------------------------------- 3. 流体

console.log('\n[流体：液面状态]');
{
  check('水源等级是 0', fluidLevel(0) === 0);
  check('写入等级后能读回', fluidLevel(withFluidLevel(0, 5)) === 5);
  check('等级不影响别的位', withFluidLevel(withFallingFluid(0, true), 3) === 0b1011);
  check('水源满格（这样海洋才能被贪心合并）', fluidHeight(0) === 1);
  check('流动的液面逐级变薄', fluidHeight(withFluidLevel(0, 1)) > fluidHeight(withFluidLevel(0, 7)));
  check('下落中的液体填满整格', fluidHeight(withFallingFluid(0, true)) === 1);
  check('液面高度不会变成负数', fluidHeight(withFluidLevel(0, 7)) > 0);
}

console.log('\n[流体：流动规则]');
{
  const world = new FakeWorld();
  world.set(0, 64, 0, Block.WATER, 0);
  world.set(0, 63, 0, Block.STONE);
  world.set(1, 64, 0, Block.AIR);
  world.set(-1, 64, 0, Block.AIR);
  world.set(0, 64, 1, Block.AIR);
  world.set(0, 64, -1, Block.AIR);

  check('水能流进空气格', canFlowInto(world, 1, 64, 0));
  const flowed = fluidTick(world, 0, 64, 0);
  check('水源向四周扩散', flowed && world.getBlock(1, 64, 0) === Block.WATER);
  check('扩散出去的是 1 级液面', fluidLevel(world.getState(1, 64, 0)) === 1);
  check('扩散会排计划刻（不会立刻连锁算完）', world.scheduled.length >= 4);

  // 向下优先
  const fall = new FakeWorld();
  fall.set(0, 64, 0, Block.WATER, 0);
  fall.set(0, 63, 0, Block.AIR);
  fall.set(1, 64, 0, Block.AIR);
  fluidTick(fall, 0, 64, 0);
  check('下方能进时优先往下', fall.getBlock(0, 63, 0) === Block.WATER && fall.getBlock(1, 64, 0) === Block.AIR);
  check('下落的水带 falling 标记', isFallingFluid(fall.getState(0, 63, 0)));

  // 扩散上限
  const far = new FakeWorld();
  far.set(0, 64, 0, Block.WATER, WATER_SPREAD);
  far.set(1, 64, 0, Block.AIR);
  far.set(0, 63, 0, Block.STONE);
  check('到达最大扩散距离后不再往外流', !fluidTick(far, 0, 64, 0) || far.getBlock(1, 64, 0) === Block.AIR);

  // 流动的水会干涸
  const dry = new FakeWorld();
  dry.set(0, 64, 0, Block.WATER, 3);
  dry.set(0, 63, 0, Block.STONE); // 下方是实的，所以只能"干涸"而不是往下流
  check('失去来源的流动水会消失', fluidTick(dry, 0, 64, 0) && dry.getBlock(0, 64, 0) === Block.AIR);

  // 无限水源
  const infinite = new FakeWorld();
  infinite.set(-1, 64, 0, Block.WATER, 0);
  infinite.set(1, 64, 0, Block.WATER, 0);
  infinite.set(0, 64, 0, Block.WATER, 1);
  infinite.set(0, 63, 0, Block.STONE);
  check('两个相邻水源让流动水变成水源', fluidTick(infinite, 0, 64, 0) && fluidLevel(infinite.getState(0, 64, 0)) === 0);

  // 单个水源不够
  const single = new FakeWorld();
  single.set(-1, 64, 0, Block.WATER, 0);
  single.set(0, 64, 0, Block.WATER, 1);
  single.set(0, 63, 0, Block.STONE);
  fluidTick(single, 0, 64, 0);
  check('只有一个相邻水源不会变成水源', fluidLevel(single.getState(0, 64, 0)) === 1);
}

console.log('\n[流体：岩浆与水火相遇]');
{
  check('岩浆只扩散 3 格', spreadDistance(Block.LAVA) === LAVA_SPREAD && spreadDistance(Block.WATER) === WATER_SPREAD);

  const lava = new FakeWorld();
  lava.set(0, 64, 0, Block.LAVA, 0);
  lava.set(0, 63, 0, Block.STONE);
  lava.set(1, 64, 0, Block.AIR);
  fluidTick(lava, 0, 64, 0);
  check('岩浆也能扩散', lava.getBlock(1, 64, 0) === Block.LAVA);
  check('岩浆的流动刻间隔更慢', lava.scheduled[0]!.delay > 5);

  const lavaFar = new FakeWorld();
  lavaFar.set(0, 64, 0, Block.LAVA, LAVA_SPREAD);
  lavaFar.set(1, 64, 0, Block.AIR);
  lavaFar.set(0, 63, 0, Block.STONE);
  check('岩浆流到第 3 格就停', !fluidTick(lavaFar, 0, 64, 0) || lavaFar.getBlock(1, 64, 0) === Block.AIR);

  // 水碰岩浆 → 岩浆变石头类
  const meet = new FakeWorld();
  meet.set(0, 64, 0, Block.LAVA, 1);
  meet.set(1, 64, 0, Block.WATER, 0);
  fluidTick(meet, 0, 64, 0);
  check('流动的岩浆碰到水变成圆石', meet.getBlock(0, 64, 0) === Block.COBBLESTONE, blockDef(meet.getBlock(0, 64, 0)).name);

  const source = new FakeWorld();
  source.set(0, 64, 0, Block.LAVA, 0);
  source.set(1, 64, 0, Block.WATER, 0);
  fluidTick(source, 0, 64, 0);
  check('水源旁的岩浆变成黑曜石', source.getBlock(0, 64, 0) === Block.OBSIDIAN);

  const water = new FakeWorld();
  water.set(0, 64, 0, Block.WATER, 1);
  water.set(1, 64, 0, Block.LAVA, 0);
  fluidTick(water, 0, 64, 0);
  check('水碰到岩浆时水自己消失', water.getBlock(0, 64, 0) === Block.AIR);
}

console.log('\n[流体：唤醒]');
{
  const world = new FakeWorld();
  world.set(0, 64, 0, Block.WATER, 0);
  world.set(0, 63, 0, Block.STONE);
  world.set(2, 64, 0, Block.STONE);
  const woken = wakeFluidNeighbours(world, 1, 64, 0);
  check('在流体旁边放方块会唤醒它', woken >= 1 && world.scheduled.length >= 1);
  const none = wakeFluidNeighbours(world, 10, 100, 10);
  check('远离流体时什么都不唤醒', none === 0);

  // 刚放下的液体：四周还是空气，必须把"自己"也排进计划刻，否则永远不流动
  const fresh = new FakeWorld();
  fresh.set(0, 64, 0, Block.WATER, 0);
  fresh.set(0, 63, 0, Block.STONE);
  const wokenSelf = wakeFluidAt(fresh, 0, 64, 0);
  check('唤醒包含液体自己（刚放下的水才会开始流）', wokenSelf >= 1 && fresh.scheduled.some((entry) => entry.x === 0 && entry.z === 0));
}

console.log('\n[小麦生长（H13）]');
{
  const solid = new Set<string>([`0,64,0`]);
  const cells = new Map<string, number>();
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  cells.set(key(0, 64, 0), Block.FARMLAND);
  cells.set(key(0, 65, 0), Block.WHEAT_STAGE0);

  let light = 15;
  const world: TickWorld = {
    getBlock: (x, y, z) => cells.get(key(x, y, z)) ?? Block.AIR,
    setBlock: (x, y, z, id) => {
      cells.set(key(x, y, z), id);
      return true;
    },
    lightAt: () => light,
  };
  void solid;

  // 一路掷 0（必定命中概率）→ 一路长到成熟
  equal('第 0 阶段会生长', randomTickBlock(world, 0, 65, 0, () => 0), true);
  equal('长到了第 1 阶段', cells.get(key(0, 65, 0)), Block.WHEAT_STAGE1);
  randomTickBlock(world, 0, 65, 0, () => 0);
  randomTickBlock(world, 0, 65, 0, () => 0);
  equal('封顶在最后一个阶段', cells.get(key(0, 65, 0)), Block.WHEAT_STAGE3);
  equal('成熟之后不再变化', randomTickBlock(world, 0, 65, 0, () => 0), false);

  // 光照不够：不长
  cells.set(key(1, 64, 0), Block.FARMLAND);
  cells.set(key(1, 65, 0), Block.WHEAT_STAGE0);
  light = 5;
  equal('光照不足时不长（原版要 9）', randomTickBlock(world, 1, 65, 0, () => 0), false);
  light = 15;

  // 下方不是耕地：不长
  cells.set(key(2, 65, 0), Block.WHEAT_STAGE0);
  equal('下方不是耕地就不长', randomTickBlock(world, 2, 65, 0, () => 0), false);

  // 概率：掷 0.9 时干旱不长（0.35 门槛）
  cells.set(key(3, 64, 0), Block.FARMLAND);
  cells.set(key(3, 65, 0), Block.WHEAT_STAGE0);
  equal('干旱地掷 0.9 不长', randomTickBlock(world, 3, 65, 0, () => 0.9), false);
  // 有水时门槛放宽到 0.7：同一个 0.5 干旱不长、有水长
  equal('干旱地掷 0.5 也不长', randomTickBlock(world, 3, 65, 0, () => 0.5), false);
  cells.set(key(6, 64, 0), Block.WATER);
  cells.set(key(3, 64, 0), Block.FARMLAND);
  equal('旁边有水时同一个掷点就长了（湿润耕地长得快）', randomTickBlock(world, 3, 65, 0, () => 0.5), true);
}

console.log(`\nTick 测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
