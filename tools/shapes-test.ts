/**
 * 非完整方块（台阶 / 楼梯 / 栅栏 / 墙 / 门 / 火把 / 梯子）的离线测试
 *
 * 运行：npm run test:shapes
 * 覆盖：碰撞盒几何、按命中面推导状态、非法放置的拒绝、以及相关配方。
 */

import {
  Block,
  JUNGLE_LOG_ID,
  SHAPED_PARENTS,
  blockDef,
  blockHardness,
  carpetId,
  slabId,
  stairsId,
  woolId,
} from '../src/core/registry/blocks.ts';
import { FLAT_HEIGHT, collisionBoxes, isFullBlockShape, meshBoxes, stairsShape } from '../src/core/registry/blockShapes.ts';
import {
  MAX_SNOW_LAYERS,
  facingFromYaw,
  facingOf,
  isDoorOpen,
  isDoorUpper,
  isFenceGateOpen,
  isSlabDouble,
  isTop,
  isTrapdoorOpen,
  isWallMounted,
  snowHeight,
  snowLayers,
  withFacing,
  withFenceGateOpen,
  withSlabDouble,
  withSnowLayers,
  withTop,
  withTrapdoorOpen,
} from '../src/core/registry/blockState.ts';
import { planPlacement } from '../src/core/interaction/Placement.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { CREATIVE_ITEMS, Item, blockDrops, categoryOf } from '../src/core/registry/items.ts';
import { DYE_COLORS } from '../src/core/registry/colors.ts';
import { itemLabel, itemTooltip } from '../src/core/registry/itemNames.ts';

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

const STONE_SLAB = slabId(0);
const STONE_STAIRS = stairsId(0);

console.log('\n[方块表与形状]');
equal('台阶是独立方块', blockDef(STONE_SLAB).shape, 'slab');
equal('石台阶名正确', blockDef(STONE_SLAB).name, 'minecraft:stone_slab');
equal('石楼梯名正确', blockDef(STONE_STAIRS).name, 'minecraft:stone_stairs');
equal('台阶不是完整遮挡（否则上方方块的面会被错误剔除）', blockDef(STONE_SLAB).opaque, false);
equal('台阶不阻挡光照', blockDef(STONE_SLAB).lightOpacity, 0);
equal('火把是自发光方块', blockDef(Block.TORCH).light, 14);
equal('火把没有碰撞体', blockDef(Block.TORCH).solid, false);
equal('梯子没有碰撞体', blockDef(Block.LADDER).solid, false);
equal('腿阶母方块数量', SHAPED_PARENTS.length, 12);

console.log('\n[碰撞盒几何]');
{
  const bottom = collisionBoxes('slab', 0);
  equal('下半砖只有 1 个盒子', bottom.length, 1);
  equal('下半砖高度 0.5', bottom[0]![4], 0.5);

  const top = collisionBoxes('slab', withTop(0, true));
  equal('上半砖从 0.5 起', top[0]![1], 0.5);
  equal('上半砖顶到 1.0', top[0]![4], 1);

  const stairs = collisionBoxes('stairs', withFacing(0, 0));
  equal('楼梯是 2 个盒子（下层整块 + 上层半格）', stairs.length, 2);
  equal('楼梯下半层高 0.5', stairs[0]![4], 0.5);

  const inverted = collisionBoxes('stairs', withTop(0, true));
  equal('倒置楼梯也是 2 个盒子', inverted.length, 2);
  equal('倒置楼梯下半层从 0.5 起', inverted[0]![1], 0.5);

  const fence = collisionBoxes('fence', 0);
  equal('栅栏碰撞盒 1.5 格高', fence[0]![4], 1.5);
  equal('栅栏碰撞盒是整宽的（缝隙不可穿过）', fence[0]![3], 1);

  equal('火把没有碰撞盒', collisionBoxes('torch', 0).length, 0);
  equal('梯子没有碰撞盒', collisionBoxes('ladder', 0).length, 0);
}

console.log('\n[栅栏渲染盒：按邻居生长]');
{
  const alone = meshBoxes('fence', 0, { connect: () => false });
  equal('孤立栅栏只有柱子', alone.length, 1);

  const connected = meshBoxes('fence', 0, { connect: () => true });
  equal('四个方向都连上时 = 柱子 + 4×2 根横杆', connected.length, 9);

  const oneSide = meshBoxes('fence', 0, { connect: (facing) => facing === 1 });
  equal('只连一侧时 = 柱子 + 2 根横杆', oneSide.length, 3);
}

console.log('\n[放置规则：台阶]');
{
  const coords = { x: 10.5, y: 64, z: 10.5 };
  const base = {
    blockId: STONE_SLAB,
    hitX: coords.x,
    hitZ: coords.z,
    yaw: 0,
    sneaking: false,
    blockAt: () => 0,
  };

  const onTop = planPlacement({ ...base, normal: [0, 1, 0], hitY: 64.0 });
  equal('命中上表面 → 下半砖', isTop(onTop!.state), false);

  const onBottom = planPlacement({ ...base, normal: [0, -1, 0], hitY: 65.0 });
  equal('命中下表面 → 上半砖', isTop(onBottom!.state), true);

  const sideUpper = planPlacement({ ...base, normal: [1, 0, 0], hitY: 64.8 });
  equal('命中侧面且准星偏上 → 上半砖', isTop(sideUpper!.state), true);

  const sideLower = planPlacement({ ...base, normal: [1, 0, 0], hitY: 64.2 });
  equal('命中侧面且准星偏下 → 下半砖', isTop(sideLower!.state), false);
}

console.log('\n[放置规则：楼梯朝向]');
{
  const plan = (yaw: number) =>
    planPlacement({
      blockId: STONE_STAIRS,
      normal: [0, 1, 0],
      hitX: 0.5,
      hitY: 64,
      hitZ: 0.5,
      yaw,
      sneaking: false,
      blockAt: () => 0,
    })!;

  // yaw=0 看向北(-Z)，原版放置时方块朝向南(2)
  equal('朝北看 → 楼梯朝南', facingOf(plan(0).state), 2);
  equal('朝东看 → 楼梯朝西', facingOf(plan(-Math.PI / 2).state), 3);
  equal('朝南看 → 楼梯朝北', facingOf(plan(Math.PI).state), 0);

  const upsideDown = planPlacement({
    blockId: STONE_STAIRS,
    normal: [0, -1, 0],
    hitX: 0.5,
    hitY: 65,
    hitZ: 0.5,
    yaw: 0,
    sneaking: false,
    blockAt: () => 0,
  })!;
  equal('命中底面 → 倒置楼梯', isTop(upsideDown.state), true);
}

console.log('\n[放置规则：火把]');
{
  const torches = (normal: readonly [number, number, number], below: number) =>
    planPlacement({
      blockId: Block.TORCH,
      normal,
      hitX: 0.5,
      hitY: 64.5,
      hitZ: 0.5,
      yaw: 0,
      sneaking: false,
      blockAt: (dx, dy) => (dy === -1 ? below : dx !== 0 || dy !== 0 ? 1 : 0),
    });

  const floor = torches([0, 1, 0], Block.STONE);
  check('地面上可以插火把', floor !== null);
  equal('落地火把不是挂墙状态', floor ? isWallMounted(floor.state) : true, false);

  const floating = torches([0, 1, 0], 0);
  equal('下方悬空时不能插火把', floating, null);

  const onWall = torches([0, 0, 1], 0);
  check('墙面上可以挂火把', onWall !== null);
  equal('挂墙火把标记正确', onWall ? isWallMounted(onWall.state) : false, true);
  equal('挂在南面 → 火把朝北', onWall ? facingOf(onWall.state) : -1, 0);

  equal('天花板上不能挂火把', torches([0, -1, 0], 0), null);
}

console.log('\n[放置规则：梯子]');
{
  const ladder = (normal: readonly [number, number, number], wall: number) =>
    planPlacement({
      blockId: Block.LADDER,
      normal,
      hitX: 0.5,
      hitY: 64.5,
      hitZ: 0.5,
      yaw: 0,
      sneaking: false,
      blockAt: () => wall,
    });

  check('实心墙面上可以放梯子', ladder([0, 0, 1], Block.STONE) !== null);
  equal('墙面是空气时拒绝放置', ladder([0, 0, 1], 0), null);
  equal('梯子贴南面 → 朝北', facingOf(ladder([0, 0, 1], Block.STONE)!.state), 0);
  equal('朝地面放置被拒绝', ladder([0, 1, 0], Block.STONE), null);
}

console.log('\n[放置规则：门]');
{
  const door = (below: number, above: number) =>
    planPlacement({
      blockId: Block.OAK_DOOR,
      normal: [0, 0, 1],
      hitX: 10.2,
      hitY: 64.5,
      hitZ: 10.9,
      yaw: 0,
      sneaking: false,
      blockAt: (dx, dy) => (dy === -1 ? below : dy === 1 ? above : 0),
    });

  const ok = door(Block.STONE, 0);
  check('脚下有支撑且上方为空时可以放门', ok !== null);
  equal('门会连带放置上半部分', ok?.extra?.dy, 1);
  equal('上半部分带 UPPER 标记', ok ? isDoorUpper(ok.extra!.state) : false, true);
  equal('门默认是关着的', ok ? isDoorOpen(ok.state) : true, false);
  equal('上下两半朝向一致', ok ? facingOf(ok.extra!.state) === facingOf(ok.state) : false, true);

  equal('脚下悬空时拒绝', door(0, 0), null);
  equal('上方被占用时拒绝', door(Block.STONE, Block.STONE), null);
}

console.log('\n[活板门与栅栏门（批次 30）]');
{
  // ---- 活板门：四种状态各画一块薄板，渲染盒与碰撞盒**必须是同一份**
  const closedBottom = withTrapdoorOpen(withTop(withFacing(0, 1), false), false);
  const closedTop = withTop(withFacing(0, 1), true);
  const openedBoxes = meshBoxes('trapdoor', withTrapdoorOpen(closedBottom, true));
  check('关着的活板门是一块贴地的薄板', meshBoxes('trapdoor', closedBottom)[0]![1] === 0);
  check('贴天花板时薄板在上方', meshBoxes('trapdoor', closedTop)[0]![4] === 1);
  check('开着的活板门竖起来（高度占满一格）', openedBoxes[0]![4] === 1 && openedBoxes[0]![1] === 0);
  check(
    '开着的活板门**有碰撞**（原版那是一片竖着的挡板）',
    collisionBoxes('trapdoor', withTrapdoorOpen(closedBottom, true)).length === 1,
  );
  equal(
    '渲染盒与碰撞盒完全一致（免得画一片板、撞在另一处）',
    JSON.stringify(meshBoxes('trapdoor', closedBottom)),
    JSON.stringify(collisionBoxes('trapdoor', closedBottom)),
  );

  // 朝向决定开着的板贴哪一侧：朝东 → 贴在 +X 侧
  const eastOpen = withTrapdoorOpen(withTop(withFacing(0, 1), false), true);
  const box = meshBoxes('trapdoor', eastOpen)[0]!;
  check('朝东的活板门打开后贴在 +X 那一侧', box[0] > 0.7 && box[3] === 1, `[${box.join(', ')}]`);

  // ---- 栅栏门：关着挡路、开着中间能走过去（这是它存在的意义）
  const gateClosed = withFenceGateOpen(withFacing(0, 0), false);
  const gateOpen = withFenceGateOpen(withFacing(0, 0), true);
  const closedBoxes = collisionBoxes('fence_gate', gateClosed);
  const openBoxes = collisionBoxes('fence_gate', gateOpen);
  equal('关着的栅栏门是"两柱 + 门板"三块', closedBoxes.length, 3);
  equal('开着的栅栏门也是三块（门板转到了侧面）', openBoxes.length, 3);
  check('栅栏门 1.5 格高（与原版一致）', closedBoxes[0]![4] === 1.5, String(closedBoxes[0]![4]));

  /**
   * 开着的时候，X 轴中线上必须留出一条 ≥0.6 格宽的空档——
   * 玩家宽 0.6，这就是"门开着能走过去"的充要条件。
   * 光断言"有几个盒子"是不够的：盒子位置错了照样挡路。
   */
  const blockedSpans = openBoxes
    .filter((b) => b[2] < 0.5 && b[5] > 0.5) // 横跨中线（z 从 <0.5 到 >0.5）的盒子会挡路
    .map((b) => [b[0], b[3]] as const)
    .sort((a, b) => a[0] - b[0]);
  // 沿 X 轴把挡路的区间拼起来，取最大空档（不能只看"第一个盒子的起点"）
  let cursor = 0;
  let gap = 0;
  for (const [x0, x1] of blockedSpans) {
    if (x0 > cursor) gap = Math.max(gap, x0 - cursor);
    cursor = Math.max(cursor, x1);
  }
  gap = Math.max(gap, 1 - cursor);
  check('开着的栅栏门中间留出 ≥0.6 格的空档（人走得过去）', gap >= 0.6, `空档 ${gap.toFixed(3)} 格`);

  // 关着的时候反过来：必须挡得住（中线处有东西）
  check(
    '关着的栅栏门挡得住（中线被门板占住）',
    closedBoxes.some((b) => b[0] === 0 && b[3] === 1),
    JSON.stringify(closedBoxes),
  );

  // ---- 放置规则
  const place = (normal: readonly [number, number, number], yaw: number) =>
    planPlacement({
      blockId: Block.OAK_TRAPDOOR,
      normal,
      hitX: 10.5,
      hitY: 64.9,
      hitZ: 10.5,
      yaw,
      sneaking: false,
      blockAt: () => 0,
    });
  const onTopFace = place([0, 1, 0], 0);
  equal('对着顶面放 → 贴地（下半）', onTopFace ? isTop(onTopFace.state) : true, false);
  const onBottomFace = place([0, -1, 0], 0);
  equal('对着底面放 → 贴天花板（上半）', onBottomFace ? isTop(onBottomFace.state) : false, true);
  equal('活板门朝向跟随玩家', onTopFace ? facingOf(onTopFace.state) : -1, facingFromYaw(0));

  const gate = planPlacement({
    blockId: Block.OAK_FENCE_GATE,
    normal: [0, 0, 1],
    hitX: 10.5,
    hitY: 64.5,
    hitZ: 10.9,
    yaw: Math.PI / 2,
    sneaking: false,
    blockAt: () => 0,
  });
  equal('栅栏门默认是关着的', gate ? isFenceGateOpen(gate.state) : true, false);
  equal('栅栏门朝向跟随玩家', gate ? facingOf(gate.state) : -1, facingFromYaw(Math.PI / 2));

  // ---- 注册表层面：能不能真的拿到、拿到的是什么形状
  equal('活板门已注册', blockDef(Block.OAK_TRAPDOOR)?.name, 'minecraft:oak_trapdoor');
  equal('活板门的形状是 trapdoor', blockDef(Block.OAK_TRAPDOOR)?.shape, 'trapdoor');
  equal('栅栏门的形状是 fence_gate', blockDef(Block.OAK_FENCE_GATE)?.shape, 'fence_gate');
  check('两者都在创造物品栏里（否则生存里只能靠作弊拿）', CREATIVE_ITEMS.includes(Block.OAK_TRAPDOOR) && CREATIVE_ITEMS.includes(Block.OAK_FENCE_GATE));
  equal('门类方块归在"建筑"分类（原版也在 Building Blocks）', categoryOf(Block.OAK_TRAPDOOR), 'building');
  check('都有中文名与说明', itemLabel(Block.OAK_TRAPDOOR) === '橡木活板门' && itemTooltip(Block.OAK_FENCE_GATE).description.includes('红石'));
}

console.log('\n[台阶 / 楼梯配方]');
{
  const grid = (size: 2 | 3, rows: readonly string[], legend: Record<string, number>) => {
    const cells = new Array<number>(size * size).fill(0);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r]!.length; c++) {
        const ch = rows[r]![c]!;
        if (ch === '·') continue;
        cells[r * size + c] = legend[ch] ?? 0;
      }
    }
    return cells;
  };

  const slab = grid(3, ['SSS', '···', '···'], { S: Block.STONE });
  equal('3 石头 → 石台阶', matchRecipe(slab, 3)?.id, STONE_SLAB);
  equal('台阶产量 6', matchRecipe(slab, 3)?.count, 6);

  const stairs = grid(3, ['S··', 'SS·', 'SSS'], { S: Block.STONE });
  equal('阶梯摆法 → 石楼梯', matchRecipe(stairs, 3)?.id, STONE_STAIRS);
  equal('楼梯产量 4', matchRecipe(stairs, 3)?.count, 4);

  // 镜像：右上倒三角也应该成立
  const mirrored = grid(3, ['··S', '·SS', 'SSS'], { S: Block.STONE });
  equal('镜像摆法也能合成楼梯', matchRecipe(mirrored, 3)?.id, STONE_STAIRS);

  // 木板台阶走的是另一个母方块
  const plankSlab = grid(3, ['PPP', '···', '···'], { P: Block.OAK_PLANKS });
  equal('3 木板 → 橡木台阶', matchRecipe(plankSlab, 3)?.id, slabId(2));

  // 火把：煤炭 + 木棍
  const torch = grid(2, ['C·', 'S·'], { C: 1000, S: 1008 }); // Item.COAL / Item.STICK
  equal('煤炭 + 木棍 → 火把', matchRecipe(torch, 2)?.id, Block.TORCH);

  // 门：2×3 木板
  const doorRecipe = grid(3, ['PP·', 'PP·', 'PP·'], { P: Block.OAK_PLANKS });
  equal('6 木板 → 橡木门', matchRecipe(doorRecipe, 3)?.id, Block.OAK_DOOR);

  // 梯子：H 形
  const ladderRecipe = grid(3, ['S·S', 'SSS', 'S·S'], { S: 1008 });
  equal('7 木棍 → 梯子', matchRecipe(ladderRecipe, 3)?.id, Block.LADDER);

  // 活板门与栅栏门（批次 30）
  const trapdoorRecipe = grid(3, ['PPP', 'PPP', '···'], { P: Block.OAK_PLANKS });
  equal('6 木板横铺 → 2 个活板门', matchRecipe(trapdoorRecipe, 3)?.id, Block.OAK_TRAPDOOR);
  equal('活板门一次出 2 个', matchRecipe(trapdoorRecipe, 3)?.count, 2);
  // 门是竖着 2×3，活板门是横着 3×2——两者不能互相匹配（同一批木板）
  const doorShape = grid(3, ['PP·', 'PP·', 'PP·'], { P: Block.OAK_PLANKS });
  equal('竖着的 2×3 仍然是门（不会串到活板门）', matchRecipe(doorShape, 3)?.id, Block.OAK_DOOR);

  const gateRecipe = grid(3, ['SPS', 'SPS', '···'], { P: Block.OAK_PLANKS, S: 1008 });
  equal('2 木板 + 4 木棍 → 栅栏门', matchRecipe(gateRecipe, 3)?.id, Block.OAK_FENCE_GATE);
  equal('栅栏门一次出 1 个', matchRecipe(gateRecipe, 3)?.count, 1);
}

console.log('\n[B4b 台阶：叠成双层]');
{
  const single = collisionBoxes('slab', 0);
  equal('单层台阶高 0.5', single[0]![4], 0.5);

  const doubled = withSlabDouble(0, true);
  equal('双层台阶标记生效', isSlabDouble(doubled), true);
  equal('双层台阶碰撞盒是整格', collisionBoxes('slab', doubled)[0]![4], 1);
  equal('双层台阶渲染盒也是整格', meshBoxes('slab', doubled).length, 1);

  // 双层再放一个台阶不该回到单层（状态位是或运算，不是取反）
  equal('已是双层时再标记仍为双层', isSlabDouble(withSlabDouble(doubled, true)), true);

  // 上下半的标记与双层标记互不干扰
  equal('上半 + 双层可以共存', isTop(withSlabDouble(withTop(0, true), true)), true);
}

console.log('\n[B4b 台阶：放置时合并]');
{
  const base = {
    blockId: STONE_SLAB,
    hitX: 0.5,
    hitY: 64,
    hitZ: 0.5,
    yaw: 0,
    sneaking: false,
    blockAt: () => 0,
  };

  // 命中同一个台阶的顶面 → 合并成双层
  const merge = planPlacement({
    ...base,
    normal: [0, 1, 0],
    hitBlock: STONE_SLAB,
    hitState: 0,
  });
  equal('命中同种台阶顶面 → 合并', merge?.mergeInto !== undefined, true);
  equal('合并后是双层', merge ? isSlabDouble(merge.mergeInto!.state) : false, true);

  // 命中别的方块 → 正常放一块新的
  const fresh = planPlacement({
    ...base,
    normal: [0, 1, 0],
    hitBlock: Block.STONE,
    hitState: 0,
  });
  equal('命中别的方块 → 正常放置', fresh?.mergeInto, undefined);

  // 命中侧面不合并（原版只在竖直面上合并）
  const side = planPlacement({
    ...base,
    normal: [1, 0, 0],
    hitBlock: STONE_SLAB,
    hitState: 0,
  });
  equal('命中台阶侧面 → 不合并', side?.mergeInto, undefined);

  // 命中别的台阶（木头台阶）也不该合并
  const other = planPlacement({
    ...base,
    normal: [0, 1, 0],
    hitBlock: slabId(2),
    hitState: 0,
  });
  equal('命中异种台阶 → 不合并', other?.mergeInto, undefined);
}

console.log('\n[B4b 楼梯：内角 / 外角]');
{
  const EAST = 1 as const;
  const stairsAt =
    (map: Record<string, { id: number; state: number }>) =>
    (dx: number, dy: number, dz: number) => {
      const found = map[`${dx},${dy},${dz}`];
      return found ? { ...found, stairs: true } : null;
    };

  const straight = stairsShape(EAST, false, stairsAt({}));
  equal('周围没有楼梯 → 直形', straight, 'straight');
  equal('直形是 2 个盒子', meshBoxes('stairs', withFacing(0, EAST), {}).length, 2);
  equal('不传邻居查询时也按直形处理', stairsShape(EAST, false), 'straight');

  // 正前方（+X）有一个朝北的楼梯：北 = rotateYCCW(东)，对应 inner_left
  const inner = stairsShape(EAST, false, stairsAt({ '1,0,0': { id: STONE_STAIRS, state: withFacing(0, 0) } }));
  equal('正前方垂直楼梯 → 内角', inner, 'inner_left');

  // 背后（-X）有一个朝北的楼梯
  const outer = stairsShape(EAST, false, stairsAt({ '-1,0,0': { id: STONE_STAIRS, state: withFacing(0, 0) } }));
  equal('背后垂直楼梯 → 外角', outer, 'outer_right');

  // 正前方是**同向**楼梯 → 仍是直形（原版要求垂直）
  const sameDir = stairsShape(EAST, false, stairsAt({ '1,0,0': { id: STONE_STAIRS, state: withFacing(0, EAST) } }));
  equal('正前方同向楼梯 → 仍为直形', sameDir, 'straight');

  // 上下半不同 → 不算相接
  const differentHalf = stairsShape(
    EAST,
    false,
    stairsAt({ '1,0,0': { id: STONE_STAIRS, state: withTop(withFacing(0, 0), true) } }),
  );
  equal('正前方倒置楼梯 → 仍为直形', differentHalf, 'straight');

  // 转角会在低侧补一块 1/4，所以盒子数 +1
  const innerBoxes = meshBoxes('stairs', withFacing(0, EAST), {
    neighbor: stairsAt({ '1,0,0': { id: STONE_STAIRS, state: withFacing(0, 0) } }),
  });
  equal('内角是 3 个盒子', innerBoxes.length, 3);

  const outerBoxes = meshBoxes('stairs', withFacing(0, EAST), {
    neighbor: stairsAt({ '-1,0,0': { id: STONE_STAIRS, state: withFacing(0, 0) } }),
  });
  equal('外角是 3 个盒子', outerBoxes.length, 3);

  // 内角与外角补的必须是**相对的两个侧向半边**（这正是原版两个模型文件的差别）。
  // 朝东的楼梯：高侧在 +X，所以补块都落在 x∈[0,0.5] 的低侧，
  // 内角在 z∈[0.5,1]、外角在 z∈[0,0.5]。
  const innerQuarter = innerBoxes[2]!;
  const outerQuarter = outerBoxes[2]!;
  equal('内角补块在低侧 x∈[0,0.5]', `${innerQuarter[0]},${innerQuarter[3]}`, '0,0.5');
  equal('内角补块在 z 的正半边', `${innerQuarter[2]},${innerQuarter[5]}`, '0.5,1');
  equal('外角补块在低侧 x∈[0,0.5]', `${outerQuarter[0]},${outerQuarter[3]}`, '0,0.5');
  equal('外角补块在 z 的负半边（与内角镜像）', `${outerQuarter[2]},${outerQuarter[5]}`, '0,0.5');
  equal('补块补齐上半层（y∈[0.5,1]）', `${innerQuarter[1]},${innerQuarter[4]}`, '0.5,1');
}

console.log('\n[睡莲（B16）：形状与放置]');
{
  // 形状：与"贴地薄板"长得一样（1/16 的一层），但**有碰撞**——原版能站在睡莲上
  const padBoxes = collisionBoxes('lily_pad', 0);
  equal('睡莲有碰撞盒（1 个）', padBoxes.length, 1);
  equal('碰撞盒是 1/16 厚的薄板', padBoxes[0]![4], FLAT_HEIGHT);
  equal('薄板贴地（y 从 0 开始）', padBoxes[0]![1], 0);
  equal('薄板占满整格（四边不内缩）', `${padBoxes[0]![0]},${padBoxes[0]![3]},${padBoxes[0]![2]},${padBoxes[0]![5]}`, '0,1,0,1');
  equal('红石粉那批"贴地薄板"没有碰撞（不挡路）', collisionBoxes('flat', 0).length, 0);
  equal('渲染盒与 flat 同高', meshBoxes('lily_pad', 0)[0]![4], meshBoxes('flat', 0)[0]![4]);
  check('不是整格（否则会走贪心合并）', !isFullBlockShape('lily_pad', 0));

  // 放置：自己那一格必须是空气、下面必须是水
  const place = (self: number, below: number) =>
    planPlacement({
      blockId: Block.LILY_PAD,
      normal: [0, 1, 0],
      hitX: 0.5,
      hitY: 64,
      hitZ: 0.5,
      yaw: 0,
      sneaking: false,
      blockAt: (_dx, dy) => (dy === 0 ? self : dy === -1 ? below : Block.AIR),
      hitBlock: Block.WATER,
      hitState: 0,
    });
  check('水面正上方的空气格能放', place(Block.AIR, Block.WATER) !== null);
  check('下面不是水就放不了', place(Block.AIR, Block.STONE) === null);
  check('下面还是草方块也放不了', place(Block.AIR, Block.GRASS_BLOCK) === null);
  check('自己那一格是水放不了（叶片会被同一格的水面盖住）', place(Block.WATER, Block.WATER) === null);
  check('自己那一格是实体方块也放不了', place(Block.STONE, Block.WATER) === null);
  equal('放下时状态为 0（睡莲没有状态位）', place(Block.AIR, Block.WATER)?.state, 0);
}

console.log('\n[地毯（批次 37）：16 色 + 复用 flat 形状]');
{
  equal('地毯共 16 种', DYE_COLORS.length, 16);
  equal('第 0 种地毯就是 id 起始值', carpetId(0), blockDef(carpetId(0)).id);
  check('每种颜色都有地毯方块', DYE_COLORS.every((_c, i) => blockDef(carpetId(i)).name.endsWith('_carpet')));

  // 几何与物理都复用 `flat`：地毯在原版不挡路，与红石粉/压力板一致
  equal('地毯用 flat 形状（不新开形状）', blockDef(carpetId(0)).shape, 'flat');
  equal('地毯没有碰撞（踩得过去）', collisionBoxes('flat', 0).length, 0);
  equal('地毯渲染盒就是 1/16 的薄板', meshBoxes('flat', 0)[0]![4], FLAT_HEIGHT);
  check('地毯不是整格（不参与贪心合并成全高）', !isFullBlockShape('flat', 0));
  equal('地毯硬度 0.1（一拍就掉）', blockHardness(carpetId(0)), 0.1);

  // 放置：**下方必须有实心方块**（这条以前是漏的，红石粉能悬在墙面上）
  const placeCarpet = (below: number) =>
    planPlacement({
      blockId: carpetId(0),
      normal: [0, 1, 0],
      hitX: 0.5,
      hitY: 64,
      hitZ: 0.5,
      yaw: 0,
      sneaking: false,
      blockAt: (_dx, dy) => (dy === -1 ? below : Block.AIR),
      hitBlock: below,
      hitState: 0,
    });
  check('地面上能放地毯', placeCarpet(Block.STONE) !== null);
  check('悬空放不了（下方是空气）', placeCarpet(Block.AIR) === null);
  check('下方是水也放不了', placeCarpet(Block.WATER) === null);

  // 配方：2 个同色羊毛 → 3 块地毯，且**颜色一一对应**（0 = 空格，与 Block.AIR 同一个值）
  const grid = (a: number, b: number) => [a, b, 0, 0];
  equal('2 红羊毛 → 3 红地毯', matchRecipe(grid(woolId(14), woolId(14)), 2)?.id, carpetId(14));
  equal('产量是 3', matchRecipe(grid(woolId(14), woolId(14)), 2)?.count, 3);
  equal('白羊毛合出的是白地毯（不会串色）', matchRecipe(grid(woolId(0), woolId(0)), 2)?.id, carpetId(0));
  equal('两种颜色的羊毛合不出来', matchRecipe(grid(woolId(0), woolId(1)), 2), null);
}

console.log('\n[雪层（批次 37）：1~8 层的高度]');
{
  equal('雪层默认 1 层', snowLayers(0), 1);
  equal('1 层高度 = 1/8', snowHeight(0), 0.125);
  equal('装到 8 层的状态是满高', snowHeight(withSnowLayers(0, 8)), 1);

  // 状态位往返：层数存的是"层数 - 1"，最容易写成 off-by-one
  let state = 0;
  for (let layers = 1; layers <= MAX_SNOW_LAYERS; layers++) {
    state = withSnowLayers(0, layers);
    equal(`装 ${layers} 层读回来还是 ${layers}`, snowLayers(state), layers);
  }
  equal('超过 8 层被夹到 8', snowLayers(withSnowLayers(0, 99)), MAX_SNOW_LAYERS);
  equal('少于 1 层被夹到 1', snowLayers(withSnowLayers(0, -5)), 1);

  // 碰撞与渲染共用同一个高度：不会出现"看着矮、撞着高"
  equal('1 层碰撞盒高度 = 1/8', collisionBoxes('snow', 0)[0]![4], 0.125);
  equal('4 层碰撞盒高度 = 1/2', collisionBoxes('snow', withSnowLayers(0, 4))[0]![4], 0.5);
  equal('8 层是整格高', collisionBoxes('snow', withSnowLayers(0, 8))[0]![4], 1);
  equal(
    '渲染盒高度与碰撞盒一致',
    meshBoxes('snow', withSnowLayers(0, 3))[0]![4],
    collisionBoxes('snow', withSnowLayers(0, 3))[0]![4],
  );
  check('雪层的碰撞盒从 y=0 贴地开始', collisionBoxes('snow', withSnowLayers(0, 2))[0]![1] === 0);
  check('1 层雪不是整格（不会被贪心合并）', !isFullBlockShape('snow', 0));

  // 放置：叠高（mergeInto 改命中方块自身）、封顶 8 层、没支撑放不了
  const placeSnow = (normal: readonly [number, number, number], below: number, hitState = 0) =>
    planPlacement({
      blockId: Block.SNOW,
      normal,
      hitX: 0.5,
      hitY: 64,
      hitZ: 0.5,
      yaw: 0,
      sneaking: false,
      blockAt: (_dx, dy) => (dy === -1 ? below : Block.AIR),
      hitBlock: Block.SNOW,
      hitState,
    });
  const merge = placeSnow([0, 1, 0], Block.STONE, withSnowLayers(0, 3));
  check('对着 3 层雪的顶面再放 → 叠高而不是新放一格', merge?.mergeInto !== undefined);
  equal('叠到 4 层', merge?.mergeInto ? snowLayers(merge.mergeInto.state) : -1, 4);
  check('已经 8 层就叠不上去了', placeSnow([0, 1, 0], Block.STONE, withSnowLayers(0, 8)) === null);
  equal('从侧面放是"新的一层 1 层"', snowLayers(placeSnow([1, 0, 0], Block.STONE)?.state ?? -1), 1);
  check('下方没有实心方块放不了', placeSnow([1, 0, 0], Block.AIR) === null);

  // 掉落：不管几层都只掉 1 个雪球（原版），精准采集掉自身
  const dropCtx = { shears: false, silkTouch: false, fortune: 0, doubleSlab: false, roll: () => 0.5 };
  equal('雪层 → 1 个雪球', blockDrops(Block.SNOW, dropCtx)?.count, 1);
  equal('掉的确实是雪球（不是雪层自身）', blockDrops(Block.SNOW, dropCtx)?.id, Item.SNOWBALL);
  equal('精准采集 → 掉落雪层自身', blockDrops(Block.SNOW, { ...dropCtx, silkTouch: true })?.id, Block.SNOW);

  // 注册与文案
  equal('雪层的中文名', itemLabel(Block.SNOW), '雪');
  check('说明里写清"最多 8 层"', itemTooltip(Block.SNOW).description.includes('8 层'));
  equal('雪层归"自然"分类（跟着雪块/冰）', categoryOf(Block.SNOW), 'natural');
  check('雪层在创造物品栏里', CREATIVE_ITEMS.includes(Block.SNOW));
  equal('地毯归"羊毛与染料"分类', categoryOf(carpetId(0)), 'wool');

  // 配方：3 块雪块横排 → 6 层雪（3 格宽，所以只能在**工作台**上合成）
  const snowRecipe = matchRecipe([Block.SNOW_BLOCK, Block.SNOW_BLOCK, Block.SNOW_BLOCK, 0, 0, 0, 0, 0, 0], 3);
  equal('3 雪块 → 6 层雪', snowRecipe?.id, Block.SNOW);
  equal('产量 6', snowRecipe?.count, 6);
  equal('竖排三块合不出来（原版就是横排）', matchRecipe([Block.SNOW_BLOCK, 0, Block.SNOW_BLOCK, 0, Block.SNOW_BLOCK, 0, 0, 0, 0], 3), null);
}

console.log('\n[可可豆与植物支撑（批次 49）]');
{
  const place = (blockId: number, normal: readonly [number, number, number], hit: number, below = Block.STONE, hitState = 0) =>
    planPlacement({
      blockId,
      normal,
      hitX: 0.5,
      hitY: 64,
      hitZ: 0.5,
      yaw: 0,
      sneaking: false,
      blockAt: (dx, dy) => (dy === -1 && dx === 0 ? below : Block.AIR),
      hitBlock: hit,
      hitState,
    });

  // ---- 可可豆：只能挂在丛林原木的水平侧面
  equal('贴在丛林原木东侧 → 朝向西（3）', facingOf(place(Block.COCOA_STAGE0, [1, 0, 0], JUNGLE_LOG_ID)!.state), 3);
  equal('贴在丛林原木北侧 → 朝向南（2）', facingOf(place(Block.COCOA_STAGE0, [0, 0, -1], JUNGLE_LOG_ID)!.state), 2);
  equal(
    '贴在丛林原木南侧 → 朝向被记为南北向的那一面',
    facingOf(place(Block.COCOA_STAGE0, [0, 0, 1], JUNGLE_LOG_ID)!.state),
    0,
  );
  check('挂在原木顶面不行（原版只能挂侧面）', place(Block.COCOA_STAGE0, [0, 1, 0], JUNGLE_LOG_ID) === null);
  check('挂在原木底面不行', place(Block.COCOA_STAGE0, [0, -1, 0], JUNGLE_LOG_ID) === null);
  check('贴在别的方块侧面不行（只认丛林原木）', place(Block.COCOA_STAGE0, [1, 0, 0], Block.OAK_LOG) === null);
  check('贴在石头上也不行', place(Block.COCOA_STAGE0, [1, 0, 0], Block.STONE) === null);

  // 几何：豆荚贴着那一面，且**有碰撞**（原版能踩上去）
  equal('朝向 0（贴北面）的渲染盒贴在北侧', meshBoxes('cocoa', withFacing(0, 0))[0]![2], 0);
  equal('朝向 2（贴南面）的渲染盒贴在南侧', meshBoxes('cocoa', withFacing(0, 2))[0]![5], 1);
  equal('碰撞盒与渲染盒同源', collisionBoxes('cocoa', withFacing(0, 1))[0]![3], meshBoxes('cocoa', withFacing(0, 1))[0]![3]);
  check('可可豆不是整格（不参与贪心合并）', !isFullBlockShape('cocoa', 0));

  // ---- 植物（cross）必须有支撑：这条以前是漏的，花能悬空放
  check('地面上能放甜浆果丛', place(Block.SWEET_BERRY_BUSH_STAGE0, [0, 1, 0], Block.GRASS_BLOCK) !== null);
  check('悬空放不了甜浆果丛（下方是空气）', place(Block.SWEET_BERRY_BUSH_STAGE0, [0, 1, 0], Block.GRASS_BLOCK, Block.AIR) === null);
  check('水里也放不了', place(Block.SWEET_BERRY_BUSH_STAGE0, [0, 1, 0], Block.GRASS_BLOCK, Block.WATER) === null);
  check('花也一样：悬空放不了（修掉了"花浮在半空"）', place(Block.DANDELION, [0, 1, 0], Block.GRASS_BLOCK, Block.AIR) === null);
  check('花有支撑就能放', place(Block.DANDELION, [0, 1, 0], Block.GRASS_BLOCK) !== null);
  equal('甜浆果丛没有碰撞（能走过去）', collisionBoxes('cross', 0).length, 0);
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
