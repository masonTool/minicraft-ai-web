/**
 * 碰撞盒与方块形状单元测试（K7，vitest）
 *
 * 方块形状决定了"能不能站上去、会不会卡住、能不能挤过去"，
 * 是物理与放置逻辑的共同基础，出错的代价（穿墙、卡在门里）比看起来大得多。
 *
 * 碰撞盒的数据结构是六元组 `[minX, minY, minZ, maxX, maxY, maxZ]`（`LocalBox`）。
 */

import { describe, expect, it } from 'vitest';
import { GLASS_PANE_ID, Block, blockDef, slabId, stairsId } from '../web/src/core/registry/blocks.ts';
import { collisionBoxes, meshBoxes, type LocalBox } from '../web/src/core/registry/blockShapes.ts';
import { withDoorOpen, withFacing, withTop } from '../web/src/core/registry/blockState.ts';

function totalHeight(boxes: readonly LocalBox[]): number {
  return boxes.reduce((sum, box) => sum + (box[4] - box[1]), 0);
}

describe('方块形状与碰撞盒', () => {
  it('完整方块是满格立方体', () => {
    const boxes = collisionBoxes('cube', 0);
    expect(boxes).toHaveLength(1);
    expect([...boxes[0]!]).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('植物、火把、梯子、贴地薄板都不阻挡移动', () => {
    for (const shape of ['cross', 'torch', 'ladder', 'flat'] as const) {
      expect(collisionBoxes(shape, 0)).toHaveLength(0);
    }
  });

  it('矮草与红石粉在注册表里用的是无碰撞形状', () => {
    expect(blockDef(Block.SHORT_GRASS).shape).toBe('cross');
    expect(blockDef(Block.REDSTONE_WIRE).shape).toBe('flat');
    expect(collisionBoxes(blockDef(Block.REDSTONE_WIRE).shape, 0)).toHaveLength(0);
  });

  it('半砖只占半格高，上半砖贴着天花板', () => {
    const bottom = collisionBoxes('slab', 0);
    expect(totalHeight(bottom)).toBeCloseTo(0.5, 5);
    expect(bottom[0]![1]).toBeCloseTo(0, 5);

    const top = collisionBoxes('slab', withTop(0, true));
    expect(totalHeight(top)).toBeCloseTo(0.5, 5);
    expect(top[0]![1]).toBeCloseTo(0.5, 5);
    expect(top[0]![4]).toBeCloseTo(1, 5);
  });

  it('台阶碰撞盒在朝向侧更高（能走上去）', () => {
    // 朝向 +X（facing=1）：低半在 -X 一侧、高半贴着 +X
    const boxes = collisionBoxes('stairs', withFacing(0, 1));
    expect(boxes.length).toBeGreaterThan(1);
    const low = boxes.find((box) => box[4] < 0.6);
    const high = boxes.find((box) => box[4] > 0.9);
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(high![3]).toBeCloseTo(1, 5);
  });

  it('关着的门有碰撞、开着的门没有（原版行为：门开了能走过去）', () => {
    const closed = collisionBoxes('door', 0);
    const open = collisionBoxes('door', withDoorOpen(0, true));
    expect(closed.length).toBeGreaterThan(0);
    expect(open).toHaveLength(0);
  });

  it('关着的门是薄板而不是整格（不会挡住整条通道）', () => {
    // 门可能沿 X 或沿 Z 铺开（取决于朝向），因此取"三个方向里最薄的那一维"
    const boxes = collisionBoxes('door', 0);
    const thinnest = Math.min(...boxes.map((box) => Math.min(box[3] - box[0], box[4] - box[1], box[5] - box[2])));
    expect(thinnest).toBeLessThan(0.35);
    expect(thinnest).toBeGreaterThan(0);
  });

  it('开着的门只是没有碰撞，仍然要画出来（门板绕轴转了 90°）', () => {
    // 2026-10-22 用户反馈"点了门、听到声音、上半扇透明还过不去"：
    // 渲染盒曾经抄了碰撞盒那句 `isDoorOpen ? [] : ...`，于是开着的门整扇消失。
    const facing = withFacing(0, 0); // 朝北：门宽沿 X、厚度在 Z
    const closed = meshBoxes('door', facing);
    const open = meshBoxes('door', withDoorOpen(facing, true));

    expect(closed).toHaveLength(1);
    expect(open).toHaveLength(1);
    // 关：薄在 Z；开：绕门轴转 90° 之后薄在 X
    expect(closed[0]![5] - closed[0]![2]).toBeCloseTo(0.1875, 5);
    expect(open[0]![3] - open[0]![0]).toBeCloseTo(0.1875, 5);
    // 碰撞那一侧仍然是"开着就没有"——两条必须一起看，防止碰撞逻辑又被抄回渲染
    expect(collisionBoxes('door', withDoorOpen(facing, true))).toHaveLength(0);
  });

  it('栅栏是 1.5 格高的柱子（能挡住玩家、但不像整方块那样占满）', () => {
    const fence = collisionBoxes('fence', 0);
    expect(fence.length).toBeGreaterThan(0);
    const height = Math.max(...fence.map((box) => box[4]));
    expect(height).toBeCloseTo(1.5, 5);
  });

  it('墙占满整格宽度且高 1.5 格', () => {
    const wall = collisionBoxes('wall', 0);
    expect(wall).toHaveLength(1);
    expect(wall[0]![3]).toBeCloseTo(1, 5);
    expect(wall[0]![4]).toBeCloseTo(1.5, 5);
  });

  it('玻璃板碰撞固定是"十字"两块（不随连接方向变化）', () => {
    const pane = collisionBoxes('pane', 0);
    expect(pane).toHaveLength(2);
    // 一块沿 X 铺满、一块沿 Z 铺满
    expect(pane[0]![3]).toBeCloseTo(1, 5);
    expect(pane[1]![5]).toBeCloseTo(1, 5);
  });

  it('仙人掌比整格窄（能贴着走过去）', () => {
    const cactus = collisionBoxes('cactus', 0);
    expect(cactus).toHaveLength(1);
    expect(cactus[0]![3]).toBeLessThan(1);
  });

  it('所有用到的形状都能算出碰撞盒而不抛错', () => {
    const shapes = new Set<string>();
    for (const id of [
      Block.STONE,
      slabId(0),
      stairsId(0),
      Block.OAK_DOOR,
      Block.OAK_FENCE,
      Block.TORCH,
      Block.SHORT_GRASS,
      Block.LADDER,
      GLASS_PANE_ID,
      Block.CACTUS,
      Block.REDSTONE_WIRE,
    ]) {
      const def = blockDef(id);
      shapes.add(def.shape);
      expect(() => collisionBoxes(def.shape, 0)).not.toThrow();
    }
    expect(shapes.size).toBeGreaterThan(5);
  });
});
