/**
 * 红石电路（J5）离线测试
 *
 * 用内存里的 stub 世界驱动引擎（不需要浏览器），覆盖：
 *  1. 拉杆 → 红石粉 → 红石灯：逐格衰减 15→14→13…，拉杆关掉灯就灭
 *  2. 红石块 / 红石火把 作为电源直接点亮相邻的灯
 *  3. 按钮：按下通电、到点自动弹起
 *  4. 压力板：有实体踩上去才通电
 *  5. 中继器：输入到达后延迟输出，断输入立刻停止
 *  6. 活塞：通电伸出（前方生成活塞头）、断电收回
 *  7. 粘性活塞：收回时把前面的方块拉回来
 *  8. 侦测器：前方方块发生变化时发一个短脉冲，脉冲结束后自动熄灭
 *  9. 推动规则：基岩/黑曜石/活塞/容器推不动，实体方块能推
 *
 * 运行：npm run test:redstone
 */

import { Block, blockDef } from '../src/core/registry/blocks.ts';
import {
  isDoorOpen,
  isDoorUpper,
  isFenceGateOpen,
  isPowered,
  isTrapdoorOpen,
  sixFacingOf,
  withSixFacing,
  withDelay,
  withDoorUpper,
  withFacing,
} from '../src/core/registry/blockState.ts';
import { RedstoneEngine, canPush, wirePowerOf, type RedstoneWorld } from '../src/core/redstone/RedstoneEngine.ts';
import { CONTAINER_BLOCKS } from '../src/core/world/BlockEntityStore.ts';

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

/** 内存世界：方块与状态各一张表，压力板用实体集合模拟 */
class StubWorld implements RedstoneWorld {
  private readonly blocks = new Map<string, number>();
  private readonly states = new Map<string, number>();
  private readonly entities = new Set<string>();

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

  hasEntityAt(x: number, y: number, z: number): boolean {
    return this.entities.has(StubWorld.key(x, y, z));
  }

  placeEntity(x: number, y: number, z: number): void {
    this.entities.add(StubWorld.key(x, y, z));
  }

  removeEntity(x: number, y: number, z: number): void {
    this.entities.delete(StubWorld.key(x, y, z));
  }
}

/** 推进引擎若干秒 */
function step(engine: RedstoneEngine, world: StubWorld, seconds: number): void {
  const dt = 1 / 20;
  for (let i = 0; i < Math.round(seconds / dt); i++) engine.tick(world, dt);
}

const Y = 100;

// ---------------------------------------------------------------- 1. 拉杆与粉

console.log('\n[拉杆 → 红石粉 → 红石灯]');
{
  const world = new StubWorld();
  const engine = new RedstoneEngine();
  world.setBlock(0, Y, 0, Block.LEVER, 0);
  world.setBlock(1, Y, 0, Block.REDSTONE_WIRE, 0);
  world.setBlock(2, Y, 0, Block.REDSTONE_WIRE, 0);
  world.setBlock(3, Y, 0, Block.REDSTONE_LAMP, 0);
  engine.onBlockChanged(world, 0, Y, 0);
  step(engine, world, 0.1);

  check('初始时灯是灭的', !isPowered(world.getState(3, Y, 0)));

  engine.toggleLever(world, 0, Y, 0);
  step(engine, world, 0.1);

  const p1 = wirePowerOf(engine, 1, Y, 0);
  const p2 = wirePowerOf(engine, 2, Y, 0);
  console.log(`  粉的强度：第 1 格 ${p1} · 第 2 格 ${p2}`);
  check('拉杆打开后相邻的粉通电', p1 > 0, `${p1}`);
  check('粉逐格衰减 1', p1 === 14 && p2 === 13, `${p1} / ${p2}`);
  check('灯被点亮', isPowered(world.getState(3, Y, 0)));
  check('拉杆自身状态为开', isPowered(world.getState(0, Y, 0)));

  engine.toggleLever(world, 0, Y, 0);
  step(engine, world, 0.1);
  check('拉杆关掉后灯熄灭', !isPowered(world.getState(3, Y, 0)));
  check('粉的强度清零', wirePowerOf(engine, 1, Y, 0) === 0);
}

// ---------------------------------------------------------------- 1.5 门 / 活板门 / 栅栏门

console.log('\n[红石驱动门类：通电即开、断电即关]');
{
  const world = new StubWorld();
  const engine = new RedstoneEngine();
  // ⚠️ 三种方块都必须**贴着红石粉**才会被算进这次洪泛（红石是六邻域传播）：
  //   拉杆(0,Y,0) → 粉(1,Y,0) → 活板门(2,Y,0)
  //                       └── 粉(1,Y+1,0) → 门的下半(2,Y+1,0) + 上半(2,Y+2,0)
  //                       └── 栅栏门(1,Y,-1)
  world.setBlock(0, Y, 0, Block.LEVER, 0);
  world.setBlock(1, Y, 0, Block.REDSTONE_WIRE, 0);
  world.setBlock(1, Y + 1, 0, Block.REDSTONE_WIRE, 0);
  world.setBlock(2, Y, 0, Block.OAK_TRAPDOOR, 0);
  world.setBlock(1, Y, -1, Block.OAK_FENCE_GATE, 0);
  world.setBlock(2, Y + 1, 0, Block.OAK_DOOR, 0);
  world.setBlock(2, Y + 2, 0, Block.OAK_DOOR, withDoorUpper(0, true));
  engine.onBlockChanged(world, 0, Y, 0);
  step(engine, world, 0.1);

  check('初始时活板门是关的', !isTrapdoorOpen(world.getState(2, Y, 0)));
  check('初始时栅栏门是关的', !isFenceGateOpen(world.getState(1, Y, -1)));
  check(
    '初始时门是关的（上下半都是）',
    !isDoorOpen(world.getState(2, Y + 1, 0)) && !isDoorOpen(world.getState(2, Y + 2, 0)),
  );

  engine.toggleLever(world, 0, Y, 0);
  step(engine, world, 0.1);

  check('通电后活板门开了', isTrapdoorOpen(world.getState(2, Y, 0)));
  check('通电后栅栏门开了', isFenceGateOpen(world.getState(1, Y, -1)));
  check('通电后门的下半开了', isDoorOpen(world.getState(2, Y + 1, 0)));
  // 门的上下两半必须一起开：分开判会得到"半扇门"（上半格自己够不到那格红石粉）
  check('通电后门的上半**也**开了（上下同步）', isDoorOpen(world.getState(2, Y + 2, 0)));
  check('门的上半仍然是"上半"（没被顺手洗掉标记）', isDoorUpper(world.getState(2, Y + 2, 0)));

  engine.toggleLever(world, 0, Y, 0);
  step(engine, world, 0.1);

  check('断电后活板门关上', !isTrapdoorOpen(world.getState(2, Y, 0)));
  check('断电后栅栏门关上', !isFenceGateOpen(world.getState(1, Y, -1)));
  check(
    '断电后门的两半都关上',
    !isDoorOpen(world.getState(2, Y + 1, 0)) && !isDoorOpen(world.getState(2, Y + 2, 0)),
  );
}

// ---------------------------------------------------------------- 2. 红石块与火把

console.log('\n[红石块 / 红石火把 直接点亮相邻的灯]');
{
  const world = new StubWorld();
  const engine = new RedstoneEngine();
  world.setBlock(0, Y, 0, Block.REDSTONE_BLOCK, 0);
  world.setBlock(1, Y, 0, Block.REDSTONE_LAMP, 0);
  world.setBlock(0, Y, 2, Block.REDSTONE_TORCH, 0);
  world.setBlock(1, Y, 2, Block.REDSTONE_LAMP, 0);
  engine.onBlockChanged(world, 0, Y, 0);
  engine.onBlockChanged(world, 0, Y, 2);
  step(engine, world, 0.1);
  check('红石块点亮相邻的灯', isPowered(world.getState(1, Y, 0)));
  check('红石火把点亮相邻的灯', isPowered(world.getState(1, Y, 2)));

  // 挖掉红石块，灯应当熄灭
  world.setBlock(0, Y, 0, Block.AIR, 0);
  engine.onBlockChanged(world, 0, Y, 0);
  step(engine, world, 0.1);
  check('红石块被挖掉后灯熄灭', !isPowered(world.getState(1, Y, 0)));
}

// ---------------------------------------------------------------- 3. 按钮

console.log('\n[按钮：按下通电、自动弹起]');
{
  const world = new StubWorld();
  const engine = new RedstoneEngine();
  world.setBlock(0, Y, 0, Block.STONE_BUTTON, 0);
  world.setBlock(1, Y, 0, Block.REDSTONE_LAMP, 0);
  engine.onBlockChanged(world, 0, Y, 0);
  step(engine, world, 0.1);

  check('按钮按下成功', engine.pressButton(world, 0, Y, 0));
  step(engine, world, 0.1);
  check('按下时灯亮', isPowered(world.getState(1, Y, 0)));
  check('重复按下无效（已经是按下状态）', !engine.pressButton(world, 0, Y, 0));

  step(engine, world, 1.2);
  check('石按钮 1 秒后自动弹起', !isPowered(world.getState(0, Y, 0)));
  step(engine, world, 0.1);
  check('弹起后灯熄灭', !isPowered(world.getState(1, Y, 0)));
}

// ---------------------------------------------------------------- 4. 压力板

console.log('\n[压力板：踩上去才通电]');
{
  const world = new StubWorld();
  const engine = new RedstoneEngine();
  world.setBlock(0, Y, 0, Block.STONE_PRESSURE_PLATE, 0);
  world.setBlock(1, Y, 0, Block.REDSTONE_LAMP, 0);
  engine.onBlockChanged(world, 0, Y, 0);
  step(engine, world, 0.3);
  check('没有实体时压力板不通电', !isPowered(world.getState(0, Y, 0)));

  world.placeEntity(0, Y, 0);
  step(engine, world, 0.3);
  check('实体踩上去后通电', isPowered(world.getState(0, Y, 0)));
  check('灯随之点亮', isPowered(world.getState(1, Y, 0)));

  world.removeEntity(0, Y, 0);
  step(engine, world, 0.3);
  check('实体离开后断电', !isPowered(world.getState(0, Y, 0)));
  check('灯随之熄灭', !isPowered(world.getState(1, Y, 0)));
}

// ---------------------------------------------------------------- 5. 中继器

console.log('\n[中继器：延迟输出]');
{
  const world = new StubWorld();
  const engine = new RedstoneEngine();
  world.setBlock(0, Y, 0, Block.LEVER, 0);
  world.setBlock(1, Y, 0, Block.REDSTONE_WIRE, 0);
  // 中继器朝向 +X（1 = 东），输出到 (3, Y, 0)
  world.setBlock(2, Y, 0, Block.REPEATER, withFacing(withDelay(0, 1), 1));
  world.setBlock(3, Y, 0, Block.REDSTONE_WIRE, 0);
  world.setBlock(4, Y, 0, Block.REDSTONE_LAMP, 0);
  engine.onBlockChanged(world, 0, Y, 0);
  engine.onBlockChanged(world, 2, Y, 0);
  step(engine, world, 0.2);

  check('未通电时灯是灭的', !isPowered(world.getState(4, Y, 0)));

  engine.toggleLever(world, 0, Y, 0);
  step(engine, world, 0.05);
  check('延迟未到时还没有输出', !isPowered(world.getState(4, Y, 0)), '延迟 = 2 红石刻 = 0.2 秒');

  step(engine, world, 0.3);
  check('延迟结束后灯亮（信号被中继器放大回 15）', isPowered(world.getState(4, Y, 0)));
  const afterRepeater = wirePowerOf(engine, 3, Y, 0);
  console.log(`  中继器输出到下一格粉的强度：${afterRepeater}`);
  // 中继器/红石火把是"直接给相邻格充能 15"，所以下一格粉读到的是满强度 15（原版行为）
  check('中继器把信号复位成满强度（下一格粉 15）', afterRepeater === 15, `${afterRepeater}`);

  engine.toggleLever(world, 0, Y, 0);
  step(engine, world, 0.1);
  check('断开输入后立刻停止输出', !isPowered(world.getState(4, Y, 0)));
}

// ---------------------------------------------------------------- 6. 活塞

console.log('\n[活塞：伸出与收回]');
{
  const world = new StubWorld();
  const engine = new RedstoneEngine();
  // 活塞朝向 +X（facing=1），前方一格放石头
  world.setBlock(0, Y, 0, Block.LEVER, 0);
  world.setBlock(1, Y, 0, Block.PISTON, withFacing(0, 1));
  world.setBlock(2, Y, 0, Block.STONE, 0);
  engine.onBlockChanged(world, 1, Y, 0);
  step(engine, world, 0.1);

  engine.toggleLever(world, 0, Y, 0);
  step(engine, world, 0.1);

  check('活塞通电后标记为伸出', isPowered(world.getState(1, Y, 0)));
  check('前方生成活塞头', world.getBlock(2, Y, 0) === Block.PISTON_HEAD, `实际 ${world.getBlock(2, Y, 0)}`);
  check('石头被推到更前面一格', world.getBlock(3, Y, 0) === Block.STONE);

  engine.toggleLever(world, 0, Y, 0);
  step(engine, world, 0.1);
  check('断电后活塞收回', !isPowered(world.getState(1, Y, 0)));
  check('活塞头被移除', world.getBlock(2, Y, 0) === Block.AIR);
  check('石头留在原地（普通活塞不拉回）', world.getBlock(3, Y, 0) === Block.STONE);
}

console.log('\n[粘性活塞：收回时把方块拉回来]');
{
  const world = new StubWorld();
  const engine = new RedstoneEngine();
  world.setBlock(0, Y, 0, Block.LEVER, 0);
  world.setBlock(1, Y, 0, Block.STICKY_PISTON, withFacing(0, 1));
  world.setBlock(2, Y, 0, Block.OAK_PLANKS, 0);
  engine.onBlockChanged(world, 1, Y, 0);
  step(engine, world, 0.1);

  engine.toggleLever(world, 0, Y, 0);
  step(engine, world, 0.1);
  check('伸出时木板被推到前面', world.getBlock(3, Y, 0) === Block.OAK_PLANKS);

  engine.toggleLever(world, 0, Y, 0);
  step(engine, world, 0.1);
  check('收回时木板被拉回活塞前方', world.getBlock(2, Y, 0) === Block.OAK_PLANKS, `实际 ${world.getBlock(2, Y, 0)}`);
  check('更前面那格变成空气', world.getBlock(3, Y, 0) === Block.AIR);
}

// ---------------------------------------------------------------- 6.5 竖直方向（批次 66）

console.log('\n[活塞与侦测器：朝上/朝下也认了（批次 66）]');
{
  // ---- 朝上推：活塞在 (1,Y,0)、上方有石头
  const up = new StubWorld();
  const upEngine = new RedstoneEngine();
  up.setBlock(0, Y, 0, Block.LEVER, 0);
  up.setBlock(1, Y, 0, Block.PISTON, withSixFacing(0, 'up'));
  up.setBlock(1, Y + 1, 0, Block.STONE, 0);
  upEngine.onBlockChanged(up, 1, Y, 0);
  step(upEngine, up, 0.1);
  upEngine.toggleLever(up, 0, Y, 0);
  step(upEngine, up, 0.1);
  check('朝上的活塞：上方生成活塞头', up.getBlock(1, Y + 1, 0) === Block.PISTON_HEAD, `实际 ${up.getBlock(1, Y + 1, 0)}`);
  check('石头被推到更上面一格', up.getBlock(1, Y + 2, 0) === Block.STONE);
  check('活塞头的朝向也是"朝上"（贴图/几何要靠它）', sixFacingOf(up.getState(1, Y + 1, 0)) === 'up');
  upEngine.toggleLever(up, 0, Y, 0);
  step(upEngine, up, 0.1);
  check('断电后上方清空', up.getBlock(1, Y + 1, 0) === Block.AIR);

  // ---- 朝下的粘性活塞：把下面的方块拉回来
  const down = new StubWorld();
  const downEngine = new RedstoneEngine();
  down.setBlock(0, Y, 0, Block.LEVER, 0);
  down.setBlock(1, Y, 0, Block.STICKY_PISTON, withSixFacing(0, 'down'));
  down.setBlock(1, Y - 1, 0, Block.OAK_PLANKS, 0);
  downEngine.onBlockChanged(down, 1, Y, 0);
  step(downEngine, down, 0.1);
  downEngine.toggleLever(down, 0, Y, 0);
  step(downEngine, down, 0.1);
  check('朝下的粘性活塞：木板被推到下面一格', down.getBlock(1, Y - 2, 0) === Block.OAK_PLANKS);
  downEngine.toggleLever(down, 0, Y, 0);
  step(downEngine, down, 0.1);
  check('收回时木板被拉回活塞下方', down.getBlock(1, Y - 1, 0) === Block.OAK_PLANKS, `实际 ${down.getBlock(1, Y - 1, 0)}`);
  check('更下面那格清空', down.getBlock(1, Y - 2, 0) === Block.AIR);

  // ---- 朝上的侦测器：盯着上面那一格，从**下面**（对面）输出
  const watch = new StubWorld();
  const watchEngine = new RedstoneEngine();
  watch.setBlock(4, Y, 0, Block.OBSERVER, withSixFacing(0, 'up'));
  watch.setBlock(4, Y + 1, 0, Block.STONE, 0);
  watch.setBlock(4, Y - 1, 0, Block.REDSTONE_WIRE, 0);
  watchEngine.onBlockChanged(watch, 4, Y, 0);
  step(watchEngine, watch, 0.1);
  check('刚放下时没脉冲（下面的粉无电）', wirePowerOf(watchEngine, 4, Y - 1, 0) === 0);

  watchEngine.onBlockChanged(watch, 4, Y + 1, 0); // 上方那格变了
  step(watchEngine, watch, 0.05);
  check('上方方块变化 → 侦测器发脉冲', isPowered(watch.getState(4, Y, 0)));
  check('脉冲从**下面**输出（对面那一格的粉通电）', wirePowerOf(watchEngine, 4, Y - 1, 0) > 0, `${wirePowerOf(watchEngine, 4, Y - 1, 0)}`);
  step(watchEngine, watch, 0.5);
  check('脉冲结束后自动熄灭', !isPowered(watch.getState(4, Y, 0)));

  // ---- 水平行为不受影响（对照）
  const flat = new StubWorld();
  const flatEngine = new RedstoneEngine();
  flat.setBlock(4, Y, 0, Block.OBSERVER, withFacing(0, 1));
  flat.setBlock(5, Y, 0, Block.STONE, 0);
  flat.setBlock(3, Y, 0, Block.REDSTONE_WIRE, 0);
  flatEngine.onBlockChanged(flat, 4, Y, 0);
  step(flatEngine, flat, 0.1);
  flatEngine.onBlockChanged(flat, 5, Y, 0);
  step(flatEngine, flat, 0.05);
  check('水平的侦测器照旧工作（从背面输出）', wirePowerOf(flatEngine, 3, Y, 0) > 0);
}

// ---------------------------------------------------------------- 7. 侦测器

console.log('\n[侦测器：检测前方方块变化]');
{
  const world = new StubWorld();
  const engine = new RedstoneEngine();
  // 侦测器朝向 +X（facing=1），盯着 (5,Y,0)
  world.setBlock(4, Y, 0, Block.OBSERVER, withFacing(0, 1));
  world.setBlock(5, Y, 0, Block.STONE, 0);
  world.setBlock(3, Y, 0, Block.REDSTONE_WIRE, 0);
  world.setBlock(2, Y, 0, Block.REDSTONE_LAMP, 0);
  engine.onBlockChanged(world, 4, Y, 0);
  step(engine, world, 0.1);
  check('平静时侦测器不输出', !isPowered(world.getState(4, Y, 0)));

  // 改变被观察的方块
  world.setBlock(5, Y, 0, Block.STONE_BRICKS, 0);
  engine.onBlockChanged(world, 5, Y, 0);
  step(engine, world, 0.06);
  check('前方方块变化时侦测器输出脉冲', isPowered(world.getState(4, Y, 0)));
  check('脉冲驱动了红石粉与灯', isPowered(world.getState(2, Y, 0)));

  step(engine, world, 0.4);
  check('脉冲结束后自动熄灭', !isPowered(world.getState(4, Y, 0)));
}

// ---------------------------------------------------------------- 8. 推动规则

console.log('\n[推动规则]');
{
  check('石头能推', canPush(Block.STONE));
  check('木板能推', canPush(Block.OAK_PLANKS));
  check('基岩推不动', !canPush(Block.BEDROCK));
  check('黑曜石推不动', !canPush(Block.OBSIDIAN));
  check('活塞推不动', !canPush(Block.PISTON));
  check('空气不需要推', !canPush(Block.AIR));
  check('水推不动', !canPush(Block.WATER));
  check('红石粉（非整方块）推不动', !canPush(Block.REDSTONE_WIRE));

  // 容器一律推不动（批次 59 补）：容器按**坐标**存在 BlockEntityStore 里，
  // 推走一格等于把东西留在原地——"推一下箱子，里面的钻石全没了"。
  // 断言直接遍历名单，所以以后往 CONTAINER_BLOCKS 加方块时这里自动跟着覆盖
  const pushableContainers = [...CONTAINER_BLOCKS].filter((id) => canPush(id));
  check(
    `容器方块一律推不动（名单里 ${CONTAINER_BLOCKS.size} 个）`,
    pushableContainers.length === 0,
    pushableContainers.map((id) => blockDef(id).name).join(', '),
  );
  check('箱子推不动', !canPush(Block.CHEST));
  check('熔炉推不动', !canPush(Block.FURNACE));
  check('漏斗推不动', !canPush(Block.HOPPER));
  check('投掷器推不动', !canPush(Block.DROPPER));
}

console.log(`\n红石测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
