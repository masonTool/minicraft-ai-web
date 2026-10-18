/**
 * 阳光传感器（批次 54）离线测试
 *
 * 它是本项目**第一个"强度可变"的电源**：拉杆/按钮/红石块都只有 0 或 15，
 * 而阳光传感器的输出 = 所在格的**天光等级**（0~15），反向模式 = 15 − 天光。
 *
 * 要盯住四件事：
 *  1. **输出强度是现算的**（不占状态位）——状态位只放"有没有输出"与"是不是反向"
 *  2. **强度要真的传进电路**：旁边的粉应该拿到"输出 − 1"（引擎既有约定）
 *  3. **天光变了不会产生方块事件**（时间/天气变了不会有人通知电路），
 *     所以引擎必须**每秒主动复查**一次，且只在"强度真变了"时才重算
 *  4. 右键切换反向模式要**立刻重算**（不然要等下一秒）
 *
 * 运行：npm run test:daylight
 */

import { isHandHarvestable } from '../src/core/registry/tools.ts';
import {
  BLOCKS,
  Block,
  DAYLIGHT_DETECTOR_ID,
  blockDef,
  blockHardness,
} from '../src/core/registry/blocks.ts';
import {
  isInverted,
  facingOf,
  isPowered,
  withFacing,
  withInverted,
  withPowered,
} from '../src/core/registry/blockState.ts';
import { collisionBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
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
  RedstoneEngine,
  daylightOutput,
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

const DETECTOR = Block.DAYLIGHT_DETECTOR;
const TILES = new Set<string>(TILE_ORDER);

/** 一块只有红石元件的小世界：方块 + 状态 + 可控天光 */
class RedstoneStub implements RedstoneWorld {
  private readonly blocks = new Map<string, number>();
  private readonly states = new Map<string, number>();
  /** 全世界的天光（测试里整体改，不必按格） */
  skyLight = 15;

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

  getSkyLight(): number {
    return this.skyLight;
  }
}

/** 摆一套"传感器 → 粉 → 红石灯"的最小电路 */
function circuit(skyLight = 15, inverted = false): { world: RedstoneStub; engine: RedstoneEngine } {
  const world = new RedstoneStub();
  world.skyLight = skyLight;
  world.set(0, 64, 0, DETECTOR, withInverted(0, inverted));
  world.set(1, 64, 0, Block.REDSTONE_WIRE);
  world.set(2, 64, 0, Block.REDSTONE_LAMP);
  const engine = new RedstoneEngine();
  engine.recompute(world, 0, 64, 0);
  // ⚠️ 直接调 `recompute` 会留下"待算位置"（灯的状态变了会把自己标脏），
  // 先 tick(0) 把它们排空——否则后面第一次 tick 会顺带重算一次，
  // 看起来像"天光一变就立刻生效"，把"每秒才复查"这条掩盖掉
  engine.tick(world, 0);
  return { world, engine };
}

/** 灯亮着吗 */
function lampOn(world: RedstoneStub): boolean {
  return isPowered(world.getState(2, 64, 0));
}

// ---------------------------------------------------------------- 1. 注册与形状

console.log('\n[注册与形状]');
{
  equal('注册名', blockDef(DETECTOR).name, 'minecraft:daylight_detector');
  equal('id 接着上一批的最后一个', DAYLIGHT_DETECTOR_ID, Block.SCAFFOLDING + 1);
  equal('中文名（官方译名在红石元件那张表里，不重复登记）', itemLabel(DETECTOR), '阳光探测器');
  check('有中文说明（写清"按天光输出""右键反向"）', hasDescription(DETECTOR));
  equal('形状是 daylight_detector', blockDef(DETECTOR).shape, 'daylight_detector');
  check('不遮挡邻居', !blockDef(DETECTOR).opaque);
  equal('不挡光', blockDef(DETECTOR).lightOpacity, 0);
  equal('硬度 0.2（原版）', blockHardness(DETECTOR), 0.2);
  check('徒手可采（原版不要求工具）', isHandHarvestable(DETECTOR));
  equal('归"功能方块"页（与拉杆/中继器同页）', categoryOf(DETECTOR), 'functional');
  check('在创造物品栏里', CREATIVE_ITEMS.includes(DETECTOR));
  equal('它是红石元件（引擎要走它）', isRedstoneComponent(DETECTOR), true);
  equal('id 连续', BLOCKS[DAYLIGHT_DETECTOR_ID]?.id, DAYLIGHT_DETECTOR_ID);

  const tiles = blockDef(DETECTOR).tiles;
  check('三张贴图都在图集名单里', tiles.every((tile) => TILES.has(tile)), tiles.join(' '));
  check(
    '反向模式换的是顶面那张（stateTiles 里有第二张顶面）',
    blockDef(DETECTOR).stateTiles !== undefined &&
      blockDef(DETECTOR).stateTiles!(withInverted(0, true))[0] !== blockDef(DETECTOR).stateTiles!(0)[0],
  );

  // 几何：6/16 高的板，碰撞与渲染同源
  const box = meshBoxes('daylight_detector', 0)[0]!;
  equal('是一块板（高 6/16）', box[4], 0.375);
  equal('整格宽', box[3], 1);
  check(
    '碰撞盒与渲染盒一致（能站上去，不会"看着平、撞着高"）',
    collisionBoxes('daylight_detector', 0)[0]!.join(',') === box.join(','),
  );
}

// ---------------------------------------------------------------- 2. 输出强度（纯函数）

console.log('\n[输出强度 = 天光等级]');
{
  equal('正午满光 → 15', daylightOutput(15, false), 15);
  equal('夜里 → 0', daylightOutput(0, false), 0);
  equal('中等光 → 原样', daylightOutput(8, false), 8);
  equal('反向模式：满光 → 0', daylightOutput(15, true), 0);
  equal('反向模式：夜里 → 15', daylightOutput(0, true), 15);
  equal('反向模式：中等光 → 15 − 8', daylightOutput(8, true), 7);
  equal('输入越界会夹紧（20 → 15）', daylightOutput(20, false), 15);
  equal('输入越界会夹紧（-3 → 0）', daylightOutput(-3, false), 0);

  // 状态位：inverted 与 facing/门轴共用 bit4，互不干扰
  const state = withInverted(withFacing(withPowered(0, true), 2), true);
  equal('反向位置上了', isInverted(state), true);
  equal('朝向没被它弄坏（facing 还是 2）', facingOf(state), 2);
  equal('通电位也没被它弄坏', isPowered(state), true);
  equal('关掉反向', isInverted(withInverted(state, false)), false);
}

// ---------------------------------------------------------------- 3. 电路：强度真的传进粉

console.log('\n[电路：强度传进粉与灯]');
{
  const { world, engine } = circuit(15, false);
  equal('满光时灯亮', lampOn(world), true);
  equal('传感器自己的 powered 位也跟着亮起来', isPowered(world.getState(0, 64, 0)), true);
  equal('旁边的粉拿到"输出 − 1"', engine.wirePower.get('1,64,0'), 14);

  const dim = circuit(8, false);
  equal('天光 8 时灯仍然亮（强度 > 0）', lampOn(dim.world), true);
  equal('粉的强度 = 8 − 1 = 7（可变量电源真的可变了）', dim.engine.wirePower.get('1,64,0'), 7);

  const dark = circuit(0, false);
  equal('天光 0（夜里）→ 灯灭', lampOn(dark.world), false);
  equal('传感器自己没有输出', isPowered(dark.world.getState(0, 64, 0)), false);
  equal('粉也没有强度', dark.engine.wirePower.get('1,64,0'), undefined);

  const inverted = circuit(0, true);
  equal('反向模式 + 夜里 → 灯**亮**', lampOn(inverted.world), true);
  equal('反向模式下满光才是灭的', lampOn(circuit(15, true).world), false);
}

// ---------------------------------------------------------------- 4. 每秒复查（天光变了没人通知）

console.log('\n[每秒复查：天光变了要能自动跟上]');
{
  const { world, engine } = circuit(15, false);
  equal('起始：白天，灯亮', lampOn(world), true);

  // 天黑了：注意这里**没有发生任何方块变化**，只有天光变了
  world.skyLight = 0;
  engine.tick(world, 0.5);
  equal('不到一秒时还没复查（不给每帧都重算）', lampOn(world), true);
  engine.tick(world, 0.6);
  // 红石灯断电后还有 0.2 秒余晖（批次 250）
  engine.tick(world, 0.3);
  equal('满一秒后复查 → 灯灭', lampOn(world), false);
  equal('粉的强度也清了', engine.wirePower.get('1,64,0'), undefined);

  // 天又亮了
  world.skyLight = 15;
  engine.tick(world, 1.01);
  equal('再亮起来 → 灯又亮', lampOn(world), true);

  // 强度没变就不该重算（updates 计数不涨）
  const before = engine.updates;
  engine.tick(world, 1.01);
  equal('天光没变时不重算（省掉每秒一次的全量求解）', engine.updates, before);

  // 方块被挖掉后，复查名单要被清掉且不抛错
  world.set(0, 64, 0, Block.AIR);
  engine.tick(world, 1.01);
  check('传感器被挖掉后复查不会出错（名单顺手清掉）', true);
}

// ---------------------------------------------------------------- 5. 右键切换反向

console.log('\n[右键切换反向模式]');
{
  const world = new RedstoneStub();
  world.skyLight = 15;
  world.set(0, 64, 0, DETECTOR);
  world.set(1, 64, 0, Block.REDSTONE_WIRE);
  world.set(2, 64, 0, Block.REDSTONE_LAMP);
  const engine = new RedstoneEngine();
  engine.recompute(world, 0, 64, 0);
  equal('白天：亮', lampOn(world), true);

  equal('右键返回 true（消费了这次点击）', engine.toggleInverted(world, 0, 64, 0), true);
  equal('反向位翻上去了', isInverted(world.getState(0, 64, 0)), true);
  // 立刻重算了，但灯有 0.2 秒余晖（批次 250）
  engine.tick(world, 0.3);
  equal('**立刻**重算（不用等下一秒）→ 白天反而灭了', lampOn(world), false);

  equal('再右键一次切回来', engine.toggleInverted(world, 0, 64, 0), true);
  equal('又变回白天亮', lampOn(world), true);
  equal('对着别的方块右键返回 false（交给别的交互）', engine.toggleInverted(world, 2, 64, 0), false);
}

// ---------------------------------------------------------------- 6. 配方与掉落

console.log('\n[配方与掉落]');
{
  // 原版：3 玻璃 + 3 石英 + 3 木台阶
  const cells = [
    Block.GLASS, Block.GLASS, Block.GLASS,
    Item.QUARTZ, Item.QUARTZ, Item.QUARTZ,
    0, 0, 0,
  ];
  // 台阶是方块：按名字找到橡木台阶的 id（不写死下标）
  const oakSlab = ((): number => {
    for (let id = 0; id < 256; id++) {
      const def = BLOCKS[id];
      // 变体表里橡木那一行的母方块名叫 oak_planks，所以台阶名是 oak_planks_slab
      if (def?.name === 'minecraft:oak_planks_slab') return id;
    }
    return 0;
  })();
  check('橡木台阶存在（配方要用它）', oakSlab > 0);
  const recipe = matchRecipe([...cells.slice(0, 6), oakSlab, oakSlab, oakSlab], 3);
  equal('3 玻璃 + 3 石英 + 3 橡木台阶 → 阳光传感器', recipe?.id, DETECTOR);
  equal('一次出 1 个', recipe?.count, 1);
  equal('缺了石英做不出来（对照）', matchRecipe([Block.GLASS, Block.GLASS, Block.GLASS, 0, 0, 0, oakSlab, oakSlab, oakSlab], 3), null);

  const ctx = (over: Partial<DropContext> = {}): DropContext => ({
    shears: false,
    silkTouch: false,
    fortune: 0,
    doubleSlab: false,
    roll: () => 0.99,
    ...over,
  });
  equal('破坏掉自身', dropFor(DETECTOR)?.id, DETECTOR);
  equal('blockDrops 也是自身', blockDrops(DETECTOR, ctx())?.id, DETECTOR);
}

console.log(`\n阳光传感器测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
