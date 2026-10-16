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

import { Block } from '../src/core/registry/blocks.ts';
import { MAX_SNOW_LAYERS, snowLayers, withSnowLayers } from '../src/core/registry/blockState.ts';
import { Item } from '../src/core/registry/items.ts';
import {
  RANDOM_TICK_BEHAVIORS,
  SNOW_ACCUMULATE_CHANCE,
  SNOW_MELT_LIGHT,
  type TickWorld,
} from '../src/core/tick/RandomTicks.ts';

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

console.log(`\n雪层天气行为测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
