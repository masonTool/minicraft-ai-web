/**
 * 雪层的天气行为（K11 收尾）离线测试
 *
 * 批次 37 做了"雪层方块本身 + 雪原地表铺雪"，但**动态的两条**一直没接：
 *  1. 下雪时雪层**越积越高**（原版是区块级降水刻，本项目用随机刻代替）
 *  2. 方块光 > 11 时**融化**（原版只看方块光——白天的天光不会把雪晒化）
 *
 * 这一套断言盯的就是这两条，外加几条最容易写错的边界：
 *  - 融化**只看方块光**（天光 15 不能化雪）
 *  - 融化是**减一层**（不是整块清掉），只剩 1 层才整块消失，且**掉 1 个雪球**
 *  - 融化优先于积雪（火把旁边的雪不该边化边长）
 *  - 积雪要求"露天"（天光 15）且"这一列正在下雪"
 *
 * 运行：npm run test:snow
 */

import { Block } from '../web/src/core/registry/blocks.ts';
import { MAX_SNOW_LAYERS, snowLayers, withSnowLayers } from '../web/src/core/registry/blockState.ts';
import { Item } from '../web/src/core/registry/items.ts';
import {
  RANDOM_TICK_BEHAVIORS,
  SNOW_ACCUMULATE_CHANCE,
  SNOW_MELT_LIGHT,
  type TickWorld,
} from '../web/src/core/tick/RandomTicks.ts';
import {
  PRECIPITATION_ATTEMPTS,
  PRECIPITATION_INTERVAL,
  PrecipitationTicker,
} from '../web/src/core/tick/Precipitation.ts';
import { WHEAT_STAGES } from '../web/src/core/registry/blocks.ts';

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

/** 只够雪层用的最小世界：方块 + 状态 + 光照 + 掉落记录 */
class SnowWorld implements TickWorld {
  private readonly blocks = new Map<string, number>();
  private readonly states = new Map<string, number>();
  readonly drops: { id: number; count: number }[] = [];
  /** 方块光（默认 0：没有光源） */
  blockLight = 0;
  /** 天光（默认 15：露天） */
  skyLight = 15;
  /** 这一列正在下雪吗 */
  snowing = true;

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  set(x: number, y: number, z: number, id: number, state = 0): void {
    this.blocks.set(SnowWorld.key(x, y, z), id);
    this.states.set(SnowWorld.key(x, y, z), state);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(SnowWorld.key(x, y, z)) ?? 0;
  }

  setBlock(x: number, y: number, z: number, id: number): boolean {
    this.blocks.set(SnowWorld.key(x, y, z), id);
    return true;
  }

  getState(x: number, y: number, z: number): number {
    return this.states.get(SnowWorld.key(x, y, z)) ?? 0;
  }

  setBlockWithState(x: number, y: number, z: number, id: number, state: number): boolean {
    this.blocks.set(SnowWorld.key(x, y, z), id);
    this.states.set(SnowWorld.key(x, y, z), state);
    return true;
  }

  drop(id: number, count: number): void {
    this.drops.push({ id, count });
  }

  blockLightAt(): number {
    return this.blockLight;
  }

  skyLightAt(): number {
    return this.skyLight;
  }

  snowingAt(): boolean {
    return this.snowing;
  }

  /** 耕地"被雨浸润"那条用的（批次 47） */
  raining = false;
}

/** 固定随机序列 */
function sequence(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

/** 一个"正在下雪、露天"的雪原世界，雪层放在 (0, 64, 0) */
function snowyWorld(layers: number): SnowWorld {
  const world = new SnowWorld();
  world.set(0, 64, 0, Block.SNOW, withSnowLayers(0, layers));
  return world;
}

const snowBehavior = RANDOM_TICK_BEHAVIORS.get(Block.SNOW)!;
/** 一定过概率门的序列 */
const pass = () => sequence([0]);
/** 一定不过概率门的序列 */
const fail = () => sequence([SNOW_ACCUMULATE_CHANCE + 0.01]);

console.log('\n[注册与常量]');
{
  check('雪层注册了随机刻行为', RANDOM_TICK_BEHAVIORS.get(Block.SNOW) !== undefined);
  equal('融化阈值是 11（原版 > 11）', SNOW_MELT_LIGHT, 11);
  check('积雪概率在合理区间（0 < p < 1）', SNOW_ACCUMULATE_CHANCE > 0 && SNOW_ACCUMULATE_CHANCE < 1);
}

console.log('\n[融化：只看方块光，减一层]');
{
  // 火把旁边（方块光 12）→ 少一层
  const world = snowyWorld(4);
  world.blockLight = 12;
  const changed = snowBehavior(world, 0, 64, 0, fail());
  check('方块光 12 → 雪层被烤化一层', changed && snowLayers(world.getState(0, 64, 0)) === 3);
  equal('融化会掉 1 个雪球（原版行为）', world.drops.length, 1);
  equal('掉的是雪球', world.drops[0]?.id, Item.SNOWBALL);

  // 只剩 1 层 → 整块消失
  const last = snowyWorld(1);
  last.blockLight = 15;
  check('最后 1 层被烤掉后变成空气', snowBehavior(last, 0, 64, 0, fail()) && last.getBlock(0, 64, 0) === Block.AIR);
  equal('整块消失时也掉 1 个雪球', last.drops.length, 1);

  // 边界：方块光正好 11 不融（原版是 > 11）
  const boundary = snowyWorld(3);
  boundary.blockLight = 11;
  check('方块光 11 不融化（阈值是"大于 11"）', !snowBehavior(boundary, 0, 64, 0, fail()) && snowLayers(boundary.getState(0, 64, 0)) === 3);
  check('没有掉落', boundary.drops.length === 0);

  // 白天不化：天光 15、方块光 0
  const daytime = snowyWorld(5);
  daytime.blockLight = 0;
  daytime.skyLight = 15;
  check(
    '白天的天光 15 **不会**把雪晒化（这是"雪在白天不化"的原因）',
    !snowBehavior(daytime, 0, 64, 0, fail()) && snowLayers(daytime.getState(0, 64, 0)) === 5,
  );

  // 溶化优先于积雪：方块光 12 + 正在下雪 → 应该变薄，而不是变厚
  const both = snowyWorld(3);
  both.blockLight = 12;
  both.snowing = true;
  snowBehavior(both, 0, 64, 0, pass());
  equal('火把边上的雪不会被"边化边长"（融化优先）', snowLayers(both.getState(0, 64, 0)), 2);

  // 层数不会掉到 0 以下
  const one = snowyWorld(1);
  one.blockLight = 15;
  snowBehavior(one, 0, 64, 0, fail());
  check('融到 0 层就是空气（不会出现"0 层雪"这种状态）', one.getBlock(0, 64, 0) === Block.AIR);
}

console.log('\n[积雪：下雪 + 露天 + 概率]');
{
  const growing = snowyWorld(2);
  const changed = snowBehavior(growing, 0, 64, 0, pass());
  check('下雪 + 露天 + 概率过 → 长高一层', changed && snowLayers(growing.getState(0, 64, 0)) === 3);
  equal('积雪不掉东西', growing.drops.length, 0);

  // 概率没过
  const noLuck = snowyWorld(2);
  check(
    '概率没过就不长（随机刻该有的稀疏感）',
    !snowBehavior(noLuck, 0, 64, 0, fail()) && snowLayers(noLuck.getState(0, 64, 0)) === 2,
  );

  // 封顶 8 层
  const full = snowyWorld(MAX_SNOW_LAYERS);
  check(
    `已经 ${MAX_SNOW_LAYERS} 层（整格）就不再长`,
    !snowBehavior(full, 0, 64, 0, pass()) && snowLayers(full.getState(0, 64, 0)) === MAX_SNOW_LAYERS,
  );

  // 有遮挡（天光 < 15）不长：屋檐下的雪不会越积越高
  const covered = snowyWorld(2);
  covered.skyLight = 14;
  check(
    '头顶有遮挡（天光 14）时不积雪',
    !snowBehavior(covered, 0, 64, 0, pass()) && snowLayers(covered.getState(0, 64, 0)) === 2,
  );

  // 不在下雪（雨地/晴天）不长
  const noSnow = snowyWorld(2);
  noSnow.snowing = false;
  check(
    '不下雪时（雨地或晴天）不积雪',
    !snowBehavior(noSnow, 0, 64, 0, pass()) && snowLayers(noSnow.getState(0, 64, 0)) === 2,
  );

  // 一路长到满格：连续随机刻只受封顶限制
  const rising = snowyWorld(1);
  let guard = 0;
  while (snowLayers(rising.getState(0, 64, 0)) < MAX_SNOW_LAYERS && guard++ < 100) {
    snowBehavior(rising, 0, 64, 0, pass());
  }
  equal(`反复下雪能一路积到 ${MAX_SNOW_LAYERS} 层（整格）`, snowLayers(rising.getState(0, 64, 0)), MAX_SNOW_LAYERS);
  check('封顶后再怎么下也不长', !snowBehavior(rising, 0, 64, 0, pass()));
}

console.log('\n[状态往返：层数写在状态里]');
{
  for (let layers = 1; layers <= MAX_SNOW_LAYERS; layers++) {
    const state = withSnowLayers(0, layers);
    equal(`第 ${layers} 层的状态能读回来`, snowLayers(state), layers);
  }
  check('层数会被夹在 1~8 之间', snowLayers(withSnowLayers(0, 99)) === MAX_SNOW_LAYERS);
}

console.log('\n[区块级降水刻：空气里自己长出第一层雪（批次 47）]');
{
  equal('每 0.5 秒跑一批', PRECIPITATION_INTERVAL, 0.5);
  equal('每批 6 个样点', PRECIPITATION_ATTEMPTS, 6);

  /** 一片"地面在 y=63、上面全是空气"的雪原，随机源固定在中心点 */
  const makeWorld = () => {
    const world = new SnowWorld();
    world.skyLight = 15;
    world.snowing = true;
    // 地平面：y<=63 是石头，之上是空气（SnowWorld 默认取不到就是 0 = 空气）
    return world;
  };
  /** 每个样点都落在 (0, 64, 0)——`random = 0.5` 时偏移量正好是 0 */
  const center = () => 0.5;

  // 1) 三个必要条件都满足 → 放下一层雪
  const world = makeWorld();
  world.set(0, 63, 0, Block.STONE);
  const ticker = new PrecipitationTicker(world, center);
  equal('不到间隔不取样', ticker.tick(0.4, 0, 64, 0), 0);
  equal('到点放下一层雪', ticker.tick(0.2, 0, 64, 0), 1);
  equal('放下的是雪层', world.getBlock(0, 64, 0), Block.SNOW);
  equal('而且只有 1 层（不是整格）', snowLayers(world.getState(0, 64, 0)), 1);
  equal('再跑一批不会重复放（那一格已经不是空气了）', ticker.tick(0.5, 0, 64, 0), 0);

  // 2) 四个必要条件缺一不可
  const cases: readonly (readonly [string, (w: SnowWorld) => void])[] = [
    ['不露天（天光 14）不落雪', (w) => (w.skyLight = 14)],
    ['这一列没在下雪就不落雪', (w) => (w.snowing = false)],
    ['悬空（下方没有支撑）不落雪', () => {}],
    ['那一格已经有方块了（不覆盖）', (w) => w.set(0, 64, 0, Block.STONE)],
  ];
  for (const [label, mutate] of cases) {
    const w = makeWorld();
    if (label !== '悬空（下方没有支撑）不落雪') w.set(0, 63, 0, Block.STONE);
    mutate(w);
    equal(label, ticker.tick(0.5, 0, 64, 0), 0);
  }
  // 悬空的那条单独再确认一次（上面的循环里它是"忘了放地面"）
  const floating = makeWorld();
  equal('悬空空中的空气格不落雪', new PrecipitationTicker(floating, center).tick(0.5, 0, 64, 0), 0);

  // 3) 累积补跑：卡顿一下（dt 很大）要补上该跑的那几批，而不是永远落后
  const burst = makeWorld();
  burst.set(0, 63, 0, Block.STONE);
  const burstTicker = new PrecipitationTicker(burst, center);
  // 1.1 秒 = 两批（2 × 0.5），第二批那一格已经有雪 → 只算第一批的 1 层
  equal('1.1 秒补跑两批', burstTicker.tick(1.1, 0, 64, 0), 1);
  equal('累计计数也记下来了', burstTicker.placed, 1);

  // 4) 一批最多 PRECIPITATION_ATTEMPTS 层（每批 6 个样点）
  const many = new SnowWorld();
  many.skyLight = 15;
  many.snowing = true;
  // 随机源让样点散开：横竖都往正方向偏（每批的 6 个点各不相同）
  let counter = 0;
  const spread = () => 0.9 - (counter++ % 6) * 0.06;
  const manyTicker = new PrecipitationTicker(many, spread);
  const placedInOneBatch = manyTicker.tick(0.5, 0, 64, 0);
  check(`一批最多 ${PRECIPITATION_ATTEMPTS} 层（实测 ${placedInOneBatch}）`, placedInOneBatch <= PRECIPITATION_ATTEMPTS);
}

console.log('\n[雨打湿耕地（批次 47）]');
{
  // 耕地"湿润"的两条路：旁边有水、或者**正在下雨且露天**（原版 farmland 的 randomTick 就是这么写的）
  const growWheat = RANDOM_TICK_BEHAVIORS.get(WHEAT_STAGES[0]!)!;
  /** 干地（没有水）：只有"在下雨"这一个变量 */
  const dryField = (raining: boolean, skyLight: number) => {
    const world = new SnowWorld();
    world.set(0, 63, 0, Block.FARMLAND);
    world.set(0, 64, 0, WHEAT_STAGES[0]!);
    world.raining = raining;
    world.skyLight = skyLight;
    return world;
  };
  // 随机值 0.5：干旱概率 0.35 → 不长；湿润概率 0.7 → 长
  const roll = () => 0.5;

  const rainy = dryField(true, 15);
  check('下雨 + 露天 → 小麦按"湿润"概率生长', growWheat(rainy, 0, 64, 0, roll));
  equal('长到了下一阶段', rainy.getBlock(0, 64, 0), WHEAT_STAGES[1]);

  const sunny = dryField(false, 15);
  check('不下雨 → 同一随机值下不生长（走的是"干旱"概率）', !growWheat(sunny, 0, 64, 0, roll));
  equal('还是原来那一段', sunny.getBlock(0, 64, 0), WHEAT_STAGES[0]);

  // 屋檐下（天光不足）即使下雨也不算淋到雨
  const roofed = dryField(true, 8);
  check('下雨但在屋檐下（天光 8）→ 不算湿润', !growWheat(roofed, 0, 64, 0, roll));
}

console.log(`\n雪层天气行为测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
