/**
 * 投掷器离线测试（批次 59，H14 的第二件容器类功能方块）
 *
 * 它是"漏斗的邻居"：**同一条路，两种驱动方式**。所以这里断言的重点是
 * "哪些地方与漏斗一致、哪些地方刻意不同"：
 *
 *  1. **注册与外观**：id / 注册名 / 两张贴图 / 中文名与说明 / 分类 / 必须用镐但不挑等级
 *  2. **六向朝向**：与漏斗**共用同一套编码**（bit0 表示竖直那两档），
 *     所以要钉住"漏斗读到的还是原来那个意思"（朝下的编码没变）与六个偏移
 *  3. **放置**：普通放置 **凸口朝你**（原版就是取玩家朝向的反方向）；
 *     潜行是"手动指定"（点顶面 → 朝下、点底面 → 朝上）——这一档原版只有活塞能做出
 *  4. **几何**：整格铁壳 + 朝那一面伸出去的小凸口；**碰撞是整格**（凸口撞不到）
 *  5. **吐东西**：空的不吐 / 对面是容器就塞进去 / 塞不进就**卡住**（不改吐地上）/
 *     不是容器就吐成掉落物 / 随机挑一格（蓄水池抽样，混装要公平）/ 附加数据不丢
 *  6. **策略表与存档**：9 格全可塞（漏斗灌得进来、也抽得出去）；
 *     **空投掷器不需要写进存档**（与漏斗那条特批刻意不同，理由写在断言旁边）
 *  7. **红石**：脉冲式触发（上升沿吐一次；通着电反复重算不会连吐；断电再来一次还可以）
 *
 * 运行：npm run test:dropper
 */

import { Block, blockDef, blockHardness } from '../src/core/registry/blocks.ts';
import {
  SIX_FACING_NAMES,
  describeState,
  hopperOutputOf,
  isVerticalFacing,
  sixFacingOf,
  sixFacingOffset,
  withHopperOutput,
  withSixFacing,
  type SixFacing,
} from '../src/core/registry/blockState.ts';
import { collisionBoxes, dropperBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
import { planPlacement, type PlacementInput } from '../src/core/interaction/Placement.ts';
import { Item, categoryOf, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { canHarvest, harvestRequirement, makeToolInfo } from '../src/core/registry/tools.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { DROPPER_SIZE, Dropper, type DropperEnv } from '../src/core/container/Dropper.ts';
import { CHEST_SIZE, Chest } from '../src/core/container/Chest.ts';
import { acceptingSlots, containerSlotCount, peekTake, tryInsertOne } from '../src/core/container/Transfer.ts';
import { BlockEntityStore } from '../src/core/world/BlockEntityStore.ts';
import {
  SLOT_COUNTS,
  kindOf,
  restoreContainers,
  serializeContainers,
  type SerializedContainer,
} from '../src/core/save/ContainerSave.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import { RedstoneEngine, isRedstoneComponent, type RedstoneWorld } from '../src/core/redstone/RedstoneEngine.ts';
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

const TILES = new Set<string>(TILE_ORDER);
const DROPPER = Block.DROPPER;

/** 一件物品（"吐一件"这件事到处都是） */
function one(id: number, count = 1): { id: number; count: number } {
  return { id, count };
}

/** 造一个放置输入（默认：对着石头顶面放、玩家朝北、不潜行） */
function placement(overrides: Partial<PlacementInput>): PlacementInput {
  return {
    blockId: DROPPER,
    normal: [0, 1, 0],
    hitX: 0.5,
    hitY: 1,
    hitZ: 0.5,
    yaw: 0,
    sneaking: false,
    blockAt: () => Block.AIR,
    hitBlock: Block.STONE,
    hitState: 0,
    ...overrides,
  };
}

/** 假环境：对面有没有容器、吐出来的东西记在哪儿 */
function envOf(options: {
  target?: Chest | null;
  ejected?: { id: number; count: number }[];
}): DropperEnv {
  return {
    target: () => options.target ?? null,
    eject: (stack) => options.ejected?.push({ id: stack.id, count: stack.count }),
  };
}

/** 确定性随机源：蓄水池抽样的断言必须"同一序列跑出同一结果"，否则会飘 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// ---------------------------------------------------------------- 1. 注册与外观

console.log('\n[注册与外观]');
{
  equal('方块 id 是 477（接在漏斗后面）', DROPPER, 477);
  // ⚠️ 别用 `BLOCKS.length - 1` 判"最后一个"：每加一个方块它都会红
  equal('id 紧接在漏斗之后（476 → 477）', DROPPER, Block.HOPPER + 1);
  equal('注册名', blockDef(DROPPER).name, 'minecraft:dropper');
  equal('中文名', itemLabel(DROPPER), '投掷器');
  check('有物品说明', hasDescription(DROPPER));
  equal('形状是 dropper（整格铁壳 + 凸口）', blockDef(DROPPER).shape, 'dropper');
  check('是整格方块（不透明、挡光）', blockDef(DROPPER).opaque);

  const missing = blockDef(DROPPER).tiles.filter((tile) => !TILES.has(tile));
  check('两张贴图都在图集里（顶/底一面、四个侧面一面）', missing.length === 0, `缺少 ${missing.join(', ')}`);
  // 贴图表固定是 [顶, 底, 侧] 三格，但投掷器的顶/底共用一张
  // ——**没有"正面"那一张**：本项目网格化器按面朝向取贴图，朝向靠几何凸口表示
  equal('五个非凸口面共用同一张外壳', blockDef(DROPPER).tiles[0], blockDef(DROPPER).tiles[2]);
  equal('外壳只有一张', new Set(blockDef(DROPPER).tiles).size, 1);

  const def = itemDef(DROPPER);
  check('有对应的物品', def !== undefined);
  equal('物品指向这个方块', def?.block, DROPPER);
  equal('可堆叠 64', maxStackOf(DROPPER), 64);
  equal('创造分类是"功能方块"', categoryOf(DROPPER), 'functional');
  equal('图标用侧面那张', def?.tile, 'dropper_side');

  equal('硬度 3.5（原版与熔炉/发射器同一档）', blockHardness(DROPPER), 3.5);
  equal('要求工具是镐 0 级', harvestRequirement(DROPPER)?.tool, 'pickaxe');
  equal('等级 0（木质镐就能挖）', harvestRequirement(DROPPER)?.tier, 0);
  check('徒手挖得动但一无所获', !canHarvest(DROPPER, null));
  check('木镐能采', canHarvest(DROPPER, makeToolInfo('pickaxe', 'wooden')));

  equal('是红石元件（它靠脉冲动作，引擎必须认它）', isRedstoneComponent(DROPPER), true);
  equal('9 格', DROPPER_SIZE, 9);
}

// ---------------------------------------------------------------- 2. 六向朝向

console.log('\n[六向朝向：与漏斗共用一套编码]');
{
  const all: SixFacing[] = ['down', 'up', 0, 1, 2, 3];
  const roundTrip = all.filter((facing) => sixFacingOf(withSixFacing(0, facing)) !== facing);
  check('六个方向都能写进状态再读回来', roundTrip.length === 0, `错的是 ${roundTrip.join(', ')}`);

  const down = withSixFacing(0, 'down');
  const east = withSixFacing(down, 1);
  equal('"朝下"之后改朝东，读数跟着变', sixFacingOf(east), 1);
  equal('再改朝上（不会残留"东"的位）', sixFacingOf(withSixFacing(east, 'up')), 'up');
  equal('再改回朝下', sixFacingOf(withSixFacing(withSixFacing(east, 'up'), 'down')), 'down');

  // 与漏斗的兼容：漏斗把"朝下"记在 top=1 + facing=0，投掷器必须一模一样，
  // 否则同一格方块换个 id 读出来的朝向就变了（存档里存的是状态数字）
  equal('"朝下"的编码与漏斗一致', withSixFacing(0, 'down'), withHopperOutput(0, 'down'));
  for (const facing of [0, 1, 2, 3] as const) {
    check(`朝${SIX_FACING_NAMES[facing]}的编码与漏斗一致`, withSixFacing(0, facing) === withHopperOutput(0, facing));
  }
  equal('漏斗读到"朝上"那一格时折回"朝下"（它没有朝上这一档）', hopperOutputOf(withSixFacing(0, 'up')), 'down');

  equal('朝下的偏移是往下', sixFacingOffset('down').join(','), '0,-1,0');
  equal('朝上的偏移是往上', sixFacingOffset('up').join(','), '0,1,0');
  equal('朝北的偏移是 -Z', sixFacingOffset(0).join(','), '0,0,-1');
  equal('朝东的偏移是 +X', sixFacingOffset(1).join(','), '1,0,0');
  equal('朝南的偏移是 +Z', sixFacingOffset(2).join(','), '0,0,1');
  equal('朝西的偏移是 -X', sixFacingOffset(3).join(','), '-1,0,0');

  equal('"竖直"只指上下两档（水平四向不算）', [isVerticalFacing('up'), isVerticalFacing('down'), isVerticalFacing(0)].join(','), 'true,true,false');
  equal('调试读数是"朝上"', describeState('dropper', withSixFacing(0, 'up')), '朝上');
  equal('调试读数是"朝西"', describeState('dropper', withSixFacing(0, 3)), '朝西');
}

// ---------------------------------------------------------------- 3. 放置

console.log('\n[放置：凸口朝你（潜行则手动指定）]');
{
  // yaw = 0 → 玩家看向北 → 玩家在南边 → 凸口朝南（朝着放它的人）
  equal('普通放置：凸口朝你', sixFacingOf(planPlacement(placement({ yaw: 0 }))!.state), 2);
  equal(
    '换个朝向也一样：看向东 → 凸口朝西',
    sixFacingOf(planPlacement(placement({ yaw: -Math.PI / 2 }))!.state),
    3,
  );
  equal(
    '看向南 → 凸口朝北',
    sixFacingOf(planPlacement(placement({ yaw: Math.PI }))!.state),
    0,
  );
  equal(
    '普通放置**不会**给出朝上/朝下（原版手持放置也只有水平四向）',
    isVerticalFacing(sixFacingOf(planPlacement(placement({ normal: [0, -1, 0] }))!.state)),
    false,
  );

  // 潜行 = 手动指定：凸口朝被点的那个方块
  equal(
    '潜行 + 点顶面 → 朝下（架在箱子上，最常用的摆法）',
    sixFacingOf(planPlacement(placement({ normal: [0, 1, 0], sneaking: true }))!.state),
    'down',
  );
  equal(
    '潜行 + 点底面 → 朝上（原版只有活塞能做出这一档）',
    sixFacingOf(planPlacement(placement({ normal: [0, -1, 0], sneaking: true }))!.state),
    'up',
  );
  equal(
    '潜行 + 点北面 → 朝南',
    sixFacingOf(planPlacement(placement({ normal: [0, 0, -1], sneaking: true }))!.state),
    2,
  );
  equal(
    '潜行 + 点西面 → 朝东',
    sixFacingOf(planPlacement(placement({ normal: [-1, 0, 0], sneaking: true }))!.state),
    1,
  );
}

// ---------------------------------------------------------------- 4. 几何

console.log('\n[几何：整格铁壳 + 伸出去的凸口]');
{
  const down = withSixFacing(0, 'down');
  const boxes = meshBoxes('dropper', down);
  equal('渲染盒 2 段（铁壳 + 凸口）', boxes.length, 2);
  equal('铁壳是整格', boxes[0]!.join(','), '0,0,0,1,1,1');
  equal('凸口 4/16 见方、居中', dropperBoxes(down)[1]!.join(','), '0.375,-0.125,0.375,0.625,0.125,0.625');
  equal(
    '朝东时凸口贴东侧并伸出去',
    dropperBoxes(withSixFacing(0, 1))[1]!.join(','),
    '0.875,0.375,0.375,1.125,0.625,0.625',
  );
  equal(
    '朝北时凸口贴北侧并伸出去',
    dropperBoxes(withSixFacing(0, 0))[1]!.join(','),
    '0.375,0.375,-0.125,0.625,0.625,0.125',
  );
  equal(
    '朝上时凸口在顶面',
    dropperBoxes(withSixFacing(0, 'up'))[1]!.join(','),
    '0.375,0.875,0.375,0.625,1.125,0.625',
  );
  check('凸口确实伸到了格子外面（不然"朝哪边"看不出来）', dropperBoxes(withSixFacing(0, 2))[1]![5]! > 1);

  const collision = collisionBoxes('dropper', down);
  equal('碰撞盒只有 1 段（整格：凸口撞不到，玩家也挡得住）', collision.length, 1);
  equal('碰撞是整格', collision[0]!.join(','), '0,0,0,1,1,1');
}

// ---------------------------------------------------------------- 5. 吐东西

console.log('\n[吐一件：空 / 塞容器 / 卡住 / 吐地上 / 随机挑]');
{
  // 空投掷器：什么都不发生
  const empty = new Dropper();
  const nothing = empty.serve(envOf({}));
  check('空投掷器：吐了个寂寞', nothing.served === null && !nothing.intoContainer && !nothing.blocked);
  equal('空投掷器不涨计数', empty.servedCount, 0);

  // 对面是容器 → 塞进去
  const dropper = new Dropper(() => 0.999);
  dropper.set(0, one(Block.STONE, 3));
  const chest = new Chest();
  const intoChest = dropper.serve(envOf({ target: chest }));
  equal('塞进了对面的容器', intoChest.intoContainer, true);
  equal('对面收到一件', chest.get(0)?.id, Block.STONE);
  equal('自己少了一件（3 → 2）', dropper.get(0)?.count, 2);
  equal('返回值里带着出去的那一件', intoChest.served?.id, Block.STONE);
  equal('计数涨了', dropper.servedCount, 1);

  // 堆叠吐到空：最后一格清掉
  const single = new Dropper();
  single.set(0, one(Block.STONE, 1));
  single.serve(envOf({ target: new Chest() }));
  equal('最后一格吐空后变成空格', single.get(0), null);

  // 对面容器满了 → 卡住（不改吐到地上）
  const stuck = new Dropper();
  stuck.set(0, one(Block.STONE, 1));
  const full = new Chest();
  for (let i = 0; i < CHEST_SIZE; i++) full.set(i, one(Block.DIRT, 64));
  const ejected: { id: number; count: number }[] = [];
  const blocked = stuck.serve(envOf({ target: full, ejected }));
  check('对面是容器但塞不进 → blocked', blocked.blocked && blocked.served === null);
  equal('自己那一件还在（不会凭空消失）', stuck.get(0)?.count, 1);
  equal('卡住时**不会**改吐到地上', ejected.length, 0);
  equal('卡住不算吐过', stuck.servedCount, 0);

  // 对面不是容器 → 吐成掉落物
  const spat = new Dropper();
  spat.set(0, one(Block.STONE, 2));
  const out: { id: number; count: number }[] = [];
  const result = spat.serve(envOf({ ejected: out }));
  equal('吐出一件给主程序', out.length, 1);
  equal('吐出去的只带 1 件', out[0]?.count, 1);
  equal('不是塞进容器', result.intoContainer, false);
  equal('自己少了一件', spat.get(0)?.count, 1);

  // 附加数据不丢：吐进容器要把耐久/附魔/改名一起带过去
  const fancy = new Dropper();
  fancy.set(0, { id: Item.IRON_INGOT, count: 1, name: '标配件', enchants: { efficiency: 2 }, damage: 5 });
  const target = new Chest();
  fancy.serve(envOf({ target }));
  equal('名字跟着过去', target.get(0)?.name, '标配件');
  equal('附魔跟着过去', target.get(0)?.enchants?.efficiency, 2);
  equal('耐久损耗也跟着过去', target.get(0)?.damage, 5);
}

console.log('\n[随机挑一格：蓄水池抽样]');
{
  // 常量随机源：0.999 → 只会选中"第一个非空格"；0 → 只会选中"最后一个非空格"
  const firstPick = new Dropper(() => 0.999);
  firstPick.set(0, one(Block.STONE));
  firstPick.set(4, one(Block.DIRT));
  const firstOut: { id: number }[] = [];
  firstPick.serve(envOf({ ejected: firstOut }));
  equal('随机数靠上限时挑第一个非空槽', firstOut[0]?.id, Block.STONE);

  const lastPick = new Dropper(() => 0);
  lastPick.set(0, one(Block.STONE));
  lastPick.set(4, one(Block.DIRT));
  lastPick.set(8, one(Block.SAND));
  const lastOut: { id: number }[] = [];
  lastPick.serve(envOf({ ejected: lastOut }));
  equal('随机数贴近 0 时挑最后一个非空槽', lastOut[0]?.id, Block.SAND);

  // 公平性：三格混装各吐 3000 次，每格被挑中的次数应当接近 1/3
  const fair = new Dropper(lcg(20261016));
  const counts = new Map<number, number>([
    [Block.STONE, 0],
    [Block.DIRT, 0],
    [Block.SAND, 0],
  ]);
  const env: DropperEnv = {
    target: () => null,
    eject: (stack) => counts.set(stack.id, (counts.get(stack.id) ?? 0) + 1),
  };
  for (let round = 0; round < 3000; round++) {
    fair.set(0, one(Block.STONE));
    fair.set(4, one(Block.DIRT));
    fair.set(8, one(Block.SAND));
    fair.serve(env);
  }
  const stone = counts.get(Block.STONE)!;
  const dirt = counts.get(Block.DIRT)!;
  const sand = counts.get(Block.SAND)!;
  console.log(`  3000 次的分布：石头 ${stone} / 泥土 ${dirt} / 沙子 ${sand}`);
  check('三种都被挑到过', stone > 0 && dirt > 0 && sand > 0);
  check(
    '每格被挑中的次数都在 1000 上下 20% 以内（混装是公平的）',
    [stone, dirt, sand].every((count) => count > 800 && count < 1200),
    `${stone} / ${dirt} / ${sand}`,
  );
  equal('3000 次一共吐出 3000 件', fair.servedCount, 3000);
}

// ---------------------------------------------------------------- 6. 策略表与存档

console.log('\n[策略表与存档]');
{
  equal('投掷器 9 格全可塞（漏斗灌得进来）', acceptingSlots(new Dropper()).length, 9);
  equal('格数被 containerSlotCount 认出来', containerSlotCount(new Dropper()), 9);

  const dropper = new Dropper();
  check('漏斗/投掷器之间能互相塞', tryInsertOne(dropper, one(Block.STONE)));
  equal('塞进去的是第一格', dropper.get(0)?.id, Block.STONE);
  const picked = peekTake(dropper);
  equal('反过来也能从投掷器里抽一件（漏斗摆在它下面就能收）', picked?.slot, 0);

  equal('存档里的格数表认识投掷器', SLOT_COUNTS.dropper, DROPPER_SIZE);
  equal('容器种类名', kindOf(new Dropper()), 'dropper');

  const store = new BlockEntityStore();
  const stored = store.getOrCreateDropper(Dimension.OVERWORLD, 5, 64, 5);
  stored.set(3, one(Item.ARROW, 7));
  store.getOrCreateDropper(Dimension.OVERWORLD, 6, 64, 5); // 一个空投掷器

  const data = serializeContainers(store);
  equal('只有装东西的那个写进存档', data.length, 1);
  equal('写的是装东西的那个', data[0]?.x, 5);
  // ⚠️ 与漏斗刻意不同：漏斗必须连空的都写（tick 循环按容器表推），
  // 投掷器是"信号来了才动作"，空的不写也不会停摆
  check('空投掷器**不需要**写进存档（与漏斗那条特批不同）', data.every((entry) => entry.x !== 6));
  equal('格子数按 9 补齐', data[0]?.stacks.length, DROPPER_SIZE);

  const restored = new BlockEntityStore();
  equal('读档还原', restoreContainers(restored, JSON.parse(JSON.stringify(data)) as SerializedContainer[]), 1);
  equal('内容对得上', restored.getDropper(Dimension.OVERWORLD, 5, 64, 5)?.get(3)?.count, 7);
}

// ---------------------------------------------------------------- 7. 红石：脉冲式触发

console.log('\n[红石：上升沿吐一次]');
{
  /** 只够红石用的最小世界 */
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
  world.set(0, 64, 0, DROPPER, withSixFacing(0, 'down'));
  world.set(1, 64, 0, Block.LEVER);
  const engine = new RedstoneEngine();
  const fired: string[] = [];
  engine.onDispense = (x, y, z) => fired.push(`${x},${y},${z}`);

  engine.recompute(world, 1, 64, 0);
  equal('拉杆没合上时不吐', fired.length, 0);

  engine.toggleLever(world, 1, 64, 0);
  equal('合上拉杆 → 吐一次', fired.length, 1);
  equal('吐的是投掷器那一格', fired[0], '0,64,0');

  engine.recompute(world, 1, 64, 0);
  engine.recompute(world, 1, 64, 0);
  equal('通着电反复重算不会连吐（上升沿判定）', fired.length, 1);

  engine.toggleLever(world, 1, 64, 0);
  engine.toggleLever(world, 1, 64, 0);
  equal('断电再通电 → 还能再吐一次（红石钟就是靠这个）', fired.length, 2);
}

// ---------------------------------------------------------------- 8. 配方

console.log('\n[配方：7 圆石围 1 红石粉]');
{
  const C = Block.COBBLESTONE;
  const R = Item.REDSTONE;
  const cells = [C, C, C, C, R, C, C, C, C];
  equal('标准图案做出投掷器', matchRecipe(cells, 3)?.id, DROPPER);
  equal('做出 1 个', matchRecipe(cells, 3)?.count, 1);
  equal('中间换圆石做不出（对照）', matchRecipe([C, C, C, C, C, C, C, C, C], 3), null);
  equal('少一个圆石做不出（对照）', matchRecipe([C, C, C, C, R, C, C, Block.AIR, C], 3), null);
  // 批次 60 起发射器也在表里了：中间那格决定兄弟俩谁出来
  equal(
    '中间换成弓 → 出来的是发射器（不是投掷器）',
    matchRecipe([C, C, C, C, Item.BOW, C, C, C, C], 3)?.id,
    Block.DISPENSER,
  );
}

console.log(`\n投掷器测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
