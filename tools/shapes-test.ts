/**
 * 非完整方块（台阶 / 楼梯 / 栅栏 / 墙 / 门 / 火把 / 梯子）的离线测试
 *
 * 运行：npm run test:shapes
 * 覆盖：碰撞盒几何、按命中面推导状态、非法放置的拒绝、以及相关配方。
 */

import { Block, SHAPED_PARENTS, blockDef, slabId, stairsId } from '../src/core/registry/blocks.ts';
import { collisionBoxes, meshBoxes, stairsShape } from '../src/core/registry/blockShapes.ts';
import {
  facingOf,
  isDoorOpen,
  isDoorUpper,
  isSlabDouble,
  isTop,
  isWallMounted,
  withFacing,
  withSlabDouble,
  withTop,
} from '../src/core/registry/blockState.ts';
import { planPlacement } from '../src/core/interaction/Placement.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';

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

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
