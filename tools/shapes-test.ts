/**
 * 非完整方块（台阶 / 楼梯 / 栅栏 / 墙 / 门 / 火把 / 梯子）的离线测试
 *
 * 运行：npm run test:shapes
 * 覆盖：碰撞盒几何、按命中面推导状态、非法放置的拒绝、以及相关配方。
 */

import { Block, SHAPED_PARENTS, blockDef, slabId, stairsId } from '../src/core/registry/blocks.ts';
import { collisionBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
import {
  facingOf,
  isDoorOpen,
  isDoorUpper,
  isTop,
  isWallMounted,
  withFacing,
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
  const alone = meshBoxes('fence', 0, () => false);
  equal('孤立栅栏只有柱子', alone.length, 1);

  const connected = meshBoxes('fence', 0, () => true);
  equal('四个方向都连上时 = 柱子 + 4×2 根横杆', connected.length, 9);

  const oneSide = meshBoxes('fence', 0, (facing) => facing === 1);
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

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
