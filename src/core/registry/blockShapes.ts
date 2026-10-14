/**
 * 非完整方块的几何定义
 *
 * 每种形状提供两套盒子（局部坐标，0-1 对应一个方块）：
 *  - collisionBoxes：碰撞用。栅栏/墙/门是整宽 + 1.5 格高（与原版一致，缝隙不可穿过）；
 *    火把与梯子没有碰撞。
 *  - meshBoxes：渲染用。栅栏/墙会按邻居实时决定要不要长出横杆。
 *
 * 盒子形状统一为 [x0, y0, z0, x1, y1, z1]。
 */

import { blockDef } from './blocks.ts';
import { FACING_OFFSET, facingOf, isDoorOpen, isTop, isWallMounted, doorHinge, type BlockShape, type Facing } from './blockState.ts';

export type LocalBox = readonly [number, number, number, number, number, number];

const FULL: LocalBox = [0, 0, 0, 1, 1, 1];
const HALF_BOTTOM: LocalBox = [0, 0, 0, 1, 0.5, 1];

/** 栅栏/墙的连接判定回调：该方向是否有可连接的方块 */
export type ConnectQuery = (facing: Facing) => boolean;

const NEVER_CONNECT: ConnectQuery = () => false;

/** 栅栏柱子的半宽（原版 4/16 宽） */
const FENCE_POST = 0.375;
/** 栅栏高度（原版 1.5 格） */
const FENCE_HEIGHT = 1.5;
/** 横杆厚度 */
const RAIL_WIDTH = 0.1875;

// ---------------------------------------------------------------- 碰撞盒

export function collisionBoxes(shape: BlockShape, state: number): readonly LocalBox[] {
  switch (shape) {
    case 'cube':
      return [FULL];
    case 'slab':
      return isTop(state) ? [[0, 0.5, 0, 1, 1, 1]] : [HALF_BOTTOM];
    case 'stairs': {
      // 下半层整块 + 上半层的半格（朝向决定在哪一侧）
      const boxes: LocalBox[] = [HALF_BOTTOM];
      const d = FACING_OFFSET[facingOf(state)];
      if (!isTop(state)) {
        boxes.push(halfTopBox(d));
      } else {
        // 倒置楼梯：上半层整块 + 下半层的半格
        boxes[0] = [0, 0.5, 0, 1, 1, 1];
        boxes.push(bottomHalfBox(d));
      }
      return boxes;
    }
    case 'fence':
    case 'wall':
      return [[0, 0, 0, 1, FENCE_HEIGHT, 1]];
    case 'door':
      return [doorBox(state)];
    case 'torch':
    case 'ladder':
      // 火把与梯子没有碰撞体积
      return [];
    default:
      return [FULL];
  }
}

/** 楼梯上半层的那半格：位于朝向的反侧（朝向指向高的一面） */
function halfTopBox(d: readonly [number, number]): LocalBox {
  if (d[0] === 1) return [0.5, 0.5, 0, 1, 1, 1];
  if (d[0] === -1) return [0, 0.5, 0, 0.5, 1, 1];
  if (d[1] === 1) return [0, 0.5, 0.5, 1, 1, 1];
  return [0, 0.5, 0, 1, 1, 0.5];
}

function bottomHalfBox(d: readonly [number, number]): LocalBox {
  if (d[0] === 1) return [0.5, 0, 0, 1, 0.5, 1];
  if (d[0] === -1) return [0, 0, 0, 0.5, 0.5, 1];
  if (d[1] === 1) return [0, 0, 0.5, 1, 0.5, 1];
  return [0, 0, 0, 1, 0.5, 0.5];
}

/** 门板：关着时贴在朝向前方的边缘，开着时旋转 90° 贴到门轴那一侧 */
function doorBox(state: number): LocalBox {
  const facing = facingOf(state);
  const d = FACING_OFFSET[facing]!;
  const hinge = doorHinge(state);
  const thickness = 0.1875;

  if (!isDoorOpen(state)) {
    // 关：面板沿垂直于朝向的方向铺满，贴在朝向所指的边缘
    if (d[0] === 1) return [1 - thickness, 0, 0, 1, 1, 1];
    if (d[0] === -1) return [0, 0, 0, thickness, 1, 1];
    if (d[1] === 1) return [0, 0, 1 - thickness, 1, 1, 1];
    return [0, 0, 0, 1, 1, thickness];
  }

  // 开：绕门轴转 90°，面板改为沿朝向方向铺满，贴到门轴所在的一侧
  const atPositiveSide = (facing === 0 && hinge === 1) || (facing === 2 && hinge === 0);
  if (d[0] !== 0) {
    return atPositiveSide ? [0, 0, 1 - thickness, 1, 1, 1] : [0, 0, 0, 1, 1, thickness];
  }
  return atPositiveSide ? [1 - thickness, 0, 0, 1, 1, 1] : [0, 0, 0, thickness, 1, 1];
}

// ---------------------------------------------------------------- 渲染盒

export function meshBoxes(shape: BlockShape, state: number, connect: ConnectQuery = NEVER_CONNECT): readonly LocalBox[] {
  switch (shape) {
    case 'cube':
      return [FULL];
    case 'slab':
      return isTop(state) ? [[0, 0.5, 0, 1, 1, 1]] : [HALF_BOTTOM];
    case 'stairs':
      return collisionBoxes('stairs', state);
    case 'fence':
      return fenceBoxes(connect);
    case 'wall':
      return wallBoxes(connect);
    case 'door':
      return [doorBox(state)];
    case 'torch':
      return torchBoxes(state);
    case 'ladder':
      return ladderBoxes(state);
    default:
      return [FULL];
  }
}

/** 栅栏：中心柱 + 四个方向按需长横杆（上下两根，与原版一致） */
function fenceBoxes(connect: ConnectQuery): readonly LocalBox[] {
  const boxes: LocalBox[] = [[FENCE_POST, 0, FENCE_POST, 1 - FENCE_POST, FENCE_HEIGHT, 1 - FENCE_POST]];

  for (const facing of [0, 1, 2, 3] as const) {
    if (!connect(facing)) continue;
    const [dx, dz] = FACING_OFFSET[facing]!;
    if (dx !== 0) {
      const x0 = dx > 0 ? 1 - FENCE_POST : 0;
      const x1 = dx > 0 ? 1 : FENCE_POST;
      boxes.push([x0, 0.75 - RAIL_WIDTH, FENCE_POST, x1, 0.75 + RAIL_WIDTH, 1 - FENCE_POST]);
      boxes.push([x0, 1.25 - RAIL_WIDTH, FENCE_POST, x1, 1.25 + RAIL_WIDTH, 1 - FENCE_POST]);
    } else {
      const z0 = dz > 0 ? 1 - FENCE_POST : 0;
      const z1 = dz > 0 ? 1 : FENCE_POST;
      boxes.push([FENCE_POST, 0.75 - RAIL_WIDTH, z0, 1 - FENCE_POST, 0.75 + RAIL_WIDTH, z1]);
      boxes.push([FENCE_POST, 1.25 - RAIL_WIDTH, z0, 1 - FENCE_POST, 1.25 + RAIL_WIDTH, z1]);
    }
  }
  return boxes;
}

/** 墙：柱子较细且矮一点，横杆只有一根 */
function wallBoxes(connect: ConnectQuery): readonly LocalBox[] {
  const post = 0.25;
  const boxes: LocalBox[] = [[post, 0, post, 1 - post, FENCE_HEIGHT, 1 - post]];
  const railY0 = 0.75;
  const railY1 = 0.9375;

  for (const facing of [0, 1, 2, 3] as const) {
    if (!connect(facing)) continue;
    const [dx, dz] = FACING_OFFSET[facing]!;
    if (dx !== 0) {
      const x0 = dx > 0 ? 1 - post : 0;
      const x1 = dx > 0 ? 1 : post;
      boxes.push([x0, railY0, post, x1, railY1, 1 - post]);
    } else {
      const z0 = dz > 0 ? 1 - post : 0;
      const z1 = dz > 0 ? 1 : post;
      boxes.push([post, railY0, z0, 1 - post, railY1, z1]);
    }
  }
  return boxes;
}

/** 火把：落地的在中心，挂墙的偏向墙面并抬高 */
function torchBoxes(state: number): readonly LocalBox[] {
  const half = 0.0625;
  if (!isWallMounted(state)) {
    return [[0.5 - half, 0, 0.5 - half, 0.5 + half, 0.625, 0.5 + half]];
  }
  const d = FACING_OFFSET[facingOf(state)]!;
  const cx = 0.5 + d[0] * 0.32;
  const cz = 0.5 + d[1] * 0.32;
  return [[cx - half, 0.1875, cz - half, cx + half, 0.8125, cz + half]];
}

/** 梯子：贴在朝向那一侧的薄片 */
function ladderBoxes(state: number): readonly LocalBox[] {
  const thickness = 0.125;
  switch (facingOf(state)) {
    case 0:
      return [[0, 0, 0, 1, 1, thickness]];
    case 1:
      return [[1 - thickness, 0, 0, 1, 1, 1]];
    case 2:
      return [[0, 0, 1 - thickness, 1, 1, 1]];
    default:
      return [[0, 0, 0, thickness, 1, 1]];
  }
}

/** 该方块对邻居算不算"可连接"（栅栏/墙用） */
export function canConnectTo(neighborId: number): boolean {
  if (neighborId === 0) return false;
  const def = blockDef(neighborId);
  if (def.shape === 'fence' || def.shape === 'wall') return true;
  // 完整实心方块也能挂上横杆
  return def.solid && def.shape === 'cube';
}
