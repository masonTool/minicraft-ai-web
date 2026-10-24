/**
 * TNT（批次 56）离线测试
 *
 * TNT 把三件已有能力串了起来，所以要盯住的也是三段：
 *  1. **三种点燃方式**：打火石（main 的交互）、红石信号（引擎回调）、火与岩浆（随机刻）
 *  2. **引信（4 秒）**：跨帧状态活在 `PrimedTnt` 里，**不在方块状态里**——
 *     状态位只放"点燃了没（powered）"与"闪烁相位（flash）"
 *  3. **爆炸**：走既有的 `explodeAt`（这里是回调），威力 4（原版 TNT）
 *
 * 最容易错的两处：
 *  - 引信表用**方块状态**存 → 一存就发现 8 位不够（还要朝向/闪烁），
 *    而且"闪烁"本来就不该进存档（重开游戏不该记着相位）
 *  - 红石点燃不做**上升沿判定** → 每轮重算都调一次回调，白转好几轮
 *
 * 运行：npm run test:tnt
 */

import { isHandHarvestable } from '../src/core/registry/tools.ts';
import {
  BLOCKS,
  Block,
  TNT_ID,
  blockDef,
  blockHardness,
} from '../src/core/registry/blocks.ts';
import { isFlash, isPowered, withFacing, withFlash, withPowered } from '../src/core/registry/blockState.ts';
import {
  CREATIVE_ITEMS,
  Item,
  blockDrops,
  categoryOf,
  dropFor,
  type DropContext,
} from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import {
  PrimedTnt,
  TNT_FLASH_INTERVAL,
  TNT_FUSE_SECONDS,
  TNT_POWER,
  isTntPrimed,
  tntTiles,
  type TntWorld,
} from '../src/core/world/PrimedTnt.ts';
import { RANDOM_TICK_BEHAVIORS, type TickWorld } from '../src/core/tick/RandomTicks.ts';
import {
  RedstoneEngine,
  isRedstoneComponent,
  type RedstoneWorld,
} from '../src/core/redstone/RedstoneEngine.ts';
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

const TNT = Block.TNT;
const TILES = new Set<string>(TILE_ORDER);

/** 只够引信用的最小世界 */
class TntStub implements TntWorld {
  private readonly blocks = new Map<string, number>();
  private readonly states = new Map<string, number>();

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  set(x: number, y: number, z: number, id: number, state = 0): void {
    this.blocks.set(TntStub.key(x, y, z), id);
    this.states.set(TntStub.key(x, y, z), state);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(TntStub.key(x, y, z)) ?? Block.AIR;
  }

  getState(x: number, y: number, z: number): number {
    return this.states.get(TntStub.key(x, y, z)) ?? 0;
  }

  setBlock(x: number, y: number, z: number, id: number, state: number): boolean {
    this.set(x, y, z, id, state);
    return true;
  }

  setState(x: number, y: number, z: number, state: number): boolean {
    this.states.set(TntStub.key(x, y, z), state);
    return true;
  }
}

/** 一次爆炸记录 */
interface Boom {
  x: number;
  y: number;
  z: number;
  power: number;
}

/** 造一个"已经点燃"的场景，返回世界与爆炸记录数组 */
function primed(x = 0, y = 64, z = 0): { world: TntStub; tracker: PrimedTnt; booms: Boom[] } {
  const world = new TntStub();
  world.set(x, y, z, TNT);
  const tracker = new PrimedTnt();
  const booms: Boom[] = [];
  tracker.prime(world, x, y, z);
  return { world, tracker, booms };
}

/** 推进一步（把 booms 传进去） */
function step(
  tracker: PrimedTnt,
  world: TntStub,
  booms: Boom[],
  seconds: number,
): number {
  return tracker.update(seconds, world, (x, y, z, power) => booms.push({ x, y, z, power }));
}

// ---------------------------------------------------------------- 1. 注册与贴图

console.log('\n[注册与贴图]');
{
  equal('注册名', blockDef(TNT).name, 'minicraft:tnt');
  equal('id 接着上一批的最后一个', TNT_ID, Block.TRIPWIRE_HOOK + 1);
  equal('中文名', itemLabel(TNT), 'TNT');
  check('有中文说明（写清三种点法、4 秒引信、威力与连锁）', hasDescription(TNT));
  equal('形状是完整立方体', blockDef(TNT).shape, 'cube');
  equal('硬度 0（原版徒手一碰就掉）', blockHardness(TNT), 0);
  check('徒手可采（拆下来还能用）', isHandHarvestable(TNT));
  equal('归"功能方块"页（红石元件同页）', categoryOf(TNT), 'functional');
  check('在创造物品栏里', CREATIVE_ITEMS.includes(TNT));
  equal('它是红石元件（通电即点燃）', isRedstoneComponent(TNT), true);
  equal('id 连续', BLOCKS[TNT_ID]?.id, TNT_ID);

  const tiles = blockDef(TNT).tiles;
  check('五张贴图都在图集名单里', tiles.every((t) => TILES.has(t)) && ['tnt_primed_top', 'tnt_primed_side'].every((t) => TILES.has(t)));

  // 贴图按状态取：**未闪相位时是正常贴图**（这就是"一闪一闪"的实现）
  equal('正常状态是普通贴图', tntTiles(0)[2], 'tnt_side');
  equal('点燃但不在闪相位 → 仍然是普通贴图', tntTiles(withPowered(0, true))[2], 'tnt_side');
  equal('点燃且正在闪相位 → 换成发白的那张', tntTiles(withFlash(withPowered(0, true), true))[2], 'tnt_primed_side');
  equal('只是闪、没点燃 → 还是普通贴图（闪相位只在引信中有意义）', tntTiles(withFlash(0, true))[2], 'tnt_side');
  equal('点燃位就是红石那套 powered 位', isTntPrimed(withPowered(0, true)), true);
}

// ---------------------------------------------------------------- 2. 引信

console.log('\n[引信：4 秒 + 闪烁]');
{
  equal('引信 4 秒（原版）', TNT_FUSE_SECONDS, 4);
  equal('闪烁间隔 0.2 秒', TNT_FLASH_INTERVAL, 0.2);
  equal('爆炸威力 4（原版 TNT）', TNT_POWER, 4);

  const { world, tracker, booms } = primed();
  equal('点燃后 powered 位亮起来（渲染与红石调试都看它）', isPowered(world.getState(0, 64, 0)), true);
  equal('引信表里记着这 4 秒', tracker.fuseOf(0, 64, 0), TNT_FUSE_SECONDS);
  equal('这一格被标记为"引信中"', tracker.isPrimed(0, 64, 0), true);
  equal('重复点燃返回 false（幂等，不会重置引信）', tracker.prime(world, 0, 64, 0), false);
  equal('对着非 TNT 点燃返回 false', tracker.prime(world, 1, 64, 0), false);

  // 闪烁：每 0.2 秒翻一次相位
  const flash0 = isFlash(world.getState(0, 64, 0));
  step(tracker, world, booms, 0.21);
  const flash1 = isFlash(world.getState(0, 64, 0));
  check('过 0.2 秒后闪相位翻了', flash0 !== flash1);
  step(tracker, world, booms, 0.21);
  equal('再过一个间隔翻回来', isFlash(world.getState(0, 64, 0)), flash0);
  equal('闪烁期间还没炸', booms.length, 0);

  // 到点爆炸
  equal('推进 3.5 秒还没到', step(tracker, world, booms, 3.5), 0);
  equal('引信只剩一点点了', tracker.fuseOf(0, 64, 0) < 0.5, true);
  equal('最后一下引爆', step(tracker, world, booms, 0.5), 1);
  equal('爆炸回调收到一次', booms.length, 1);
  equal('爆炸点在方块中心（x）', booms[0]?.x, 0.5);
  equal('爆炸点在方块中心（y）', booms[0]?.y, 64.5);
  equal('爆炸威力是 4', booms[0]?.power, TNT_POWER);
  equal('那一格变成空气（先清掉再炸，避免留下"炸不掉的 TNT"）', world.getBlock(0, 64, 0), Block.AIR);
  equal('引信表也清空了', tracker.count(), 0);
  equal('引爆计数 +1', tracker.ignited, 1);
  equal('同一格不会炸第二次', step(tracker, world, booms, 1), 0);
}

console.log('\n[引信的两个边界]');
{
  // 方块被挖掉 → 引信作废（不会凭空炸一格空气）
  const mined = primed();
  mined.world.setBlock(0, 64, 0, Block.AIR, 0);
  equal('方块没了 → 引信作废', step(mined.tracker, mined.world, mined.booms, 1), 0);
  equal('也不会留下爆炸记录', mined.booms.length, 0);
  equal('引信表清干净了', mined.tracker.count(), 0);

  // 换成了别的方块 → 同样作废
  const replaced = primed();
  replaced.world.setBlock(0, 64, 0, Block.STONE, 0);
  equal('方块被换成别的 → 引信作废', step(replaced.tracker, replaced.world, replaced.booms, 1), 0);

  // 一次推进很长的时间（卡顿）→ 照样按 dt 结算
  const laggy = primed();
  equal('卡顿 5 秒（超过引信）→ 直接引爆', step(laggy.tracker, laggy.world, laggy.booms, 5), 1);

  // 多个 TNT 各自独立
  const many = new TntStub();
  const tracker = new PrimedTnt();
  const booms: Boom[] = [];
  for (let x = 0; x < 3; x++) {
    many.set(x, 64, 0, TNT);
    tracker.prime(many, x, 64, 0);
  }
  equal('三格 TNT 都在引信中', tracker.count(), 3);
  step(tracker, many, booms, 0.5);
  equal('半秒后都没炸', booms.length, 0);
  step(tracker, many, booms, 4);
  equal('过完引信 → 三个都炸了', booms.length, 3);
  equal('三格的爆炸位置各不相同', new Set(booms.map((b) => b.x)).size, 3);
}

// ---------------------------------------------------------------- 3. 红石点燃

console.log('\n[红石点燃：上升沿，不重复调]');
{
  class RedstoneStub implements RedstoneWorld {
    private readonly blocks = new Map<string, number>();
    private readonly states = new Map<string, number>();
    private static key(x: number, y: number, z: number): string {
      return `${x},${y},${z}`;
    }
    set(x: number, y: number, z: number, id: number, state = 0): void {
      this.blocks.set(RedstoneStub.key(x, y, z), id);
      this.states.set(RedstoneStub.key(x, y, z), state);
    }
    getBlock(x: number, y: number, z: number): number {
      return this.blocks.get(RedstoneStub.key(x, y, z)) ?? Block.AIR;
    }
    getState(x: number, y: number, z: number): number {
      return this.states.get(RedstoneStub.key(x, y, z)) ?? 0;
    }
    setBlock(x: number, y: number, z: number, id: number, state: number): boolean {
      this.set(x, y, z, id, state);
      return true;
    }
    setState(x: number, y: number, z: number, state: number): boolean {
      this.states.set(RedstoneStub.key(x, y, z), state);
      return true;
    }
    isLoaded(): boolean {
      return true;
    }
    hasEntityAt(): boolean {
      return false;
    }
  }

  const world = new RedstoneStub();
  world.set(0, 64, 0, TNT);
  world.set(1, 64, 0, Block.LEVER);
  const engine = new RedstoneEngine();
  const fired: string[] = [];
  engine.onTntIgnite = (x, y, z) => fired.push(`${x},${y},${z}`);

  engine.recompute(world, 1, 64, 0);
  equal('拉杆没合上时不会点燃', fired.length, 0);

  engine.toggleLever(world, 1, 64, 0);
  equal('合上拉杆 → 点燃一次', fired.length, 1);
  equal('点燃的是 TNT 那一格', fired[0], '0,64,0');

  // 再算几次（同时还有别的变化）：不该重复调
  engine.recompute(world, 1, 64, 0);
  engine.recompute(world, 1, 64, 0);
  equal('反复重算不会重复点燃（上升沿判定）', fired.length, 1);

  engine.toggleLever(world, 1, 64, 0);
  engine.toggleLever(world, 1, 64, 0);
  equal('断电再通电 → 可以再点一次', fired.length, 2);
}

// ---------------------------------------------------------------- 4. 火与岩浆

console.log('\n[火与岩浆：随机刻]');
{
  const behavior = RANDOM_TICK_BEHAVIORS.get(TNT);
  check('TNT 登记了随机刻行为', behavior !== undefined);

  /**
   * 只够这一条用的最小世界：`getBlock` 一律返回同一个邻居方块，
   * `igniteTnt` 把点燃次数记在闭包变量里。
   */
  let ignited = 0;
  const makeWorld = (neighbor: number): TickWorld => ({
    getBlock: () => neighbor,
    setBlock: () => true,
    igniteTnt: () => {
      ignited++;
    },
  });

  ignited = 0;
  check('旁边是火 → 点燃', behavior!(makeWorld(Block.FIRE), 0, 64, 0, () => 0) && ignited === 1);
  ignited = 0;
  check('旁边是岩浆 → 点燃', behavior!(makeWorld(Block.LAVA), 0, 64, 0, () => 0) && ignited === 1);
  ignited = 0;
  check('旁边是石头 → 不点', !behavior!(makeWorld(Block.STONE), 0, 64, 0, () => 0) && ignited === 0);
  check(
    '世界没提供 igniteTnt 通道时不报错（离线测试/别的世界）',
    !behavior!({ getBlock: () => Block.FIRE, setBlock: () => true }, 0, 64, 0, () => 0),
  );
}

// ---------------------------------------------------------------- 5. 配方与掉落

console.log('\n[配方与掉落]');
{
  // 原版：5 火药（四角 + 中心）+ 4 沙（十字）
  const cells = [
    Item.GUNPOWDER, Block.SAND, Item.GUNPOWDER,
    Block.SAND, Item.GUNPOWDER, Block.SAND,
    Item.GUNPOWDER, Block.SAND, Item.GUNPOWDER,
  ];
  const recipe = matchRecipe(cells, 3);
  equal('5 火药 + 4 沙 → TNT', recipe?.id, TNT);
  equal('一次做 1 个', recipe?.count, 1);
  equal(
    '少一个火药做不出来（对照）',
    matchRecipe([Item.GUNPOWDER, Block.SAND, Item.GUNPOWDER, Block.SAND, 0, Block.SAND, Item.GUNPOWDER, Block.SAND, Item.GUNPOWDER], 3),
    null,
  );

  const ctx = (over: Partial<DropContext> = {}): DropContext => ({
    shears: false,
    silkTouch: false,
    fortune: 0,
    doubleSlab: false,
    roll: () => 0.99,
    ...over,
  });
  equal('破坏掉自身', dropFor(TNT)?.id, TNT);
  equal('blockDrops 也是自身', blockDrops(TNT, ctx())?.id, TNT);
  // 一个"提醒"断言：TNT 的朝向位不该被引信状态碰坏（位复用的前提）
  equal('引信状态不会弄坏朝向位', withPowered(withFacing(0, 2), true) & 0b110, 4);
}

console.log(`\nTNT 测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
