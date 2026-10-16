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
import {
  FACING_OFFSET,
  axisOf,
  doorHinge,
  facingOf,
  fluidHeight,
  hasVineUp,
  isDoorOpen,
  isFenceGateOpen,
  isSlabDouble,
  isTop,
  isTrapdoorOpen,
  isWallMounted,
  snowHeight,
  vineSides,
  type BlockShape,
  type Facing,
} from './blockState.ts';

export type LocalBox = readonly [number, number, number, number, number, number];

const FULL: LocalBox = [0, 0, 0, 1, 1, 1];
const HALF_BOTTOM: LocalBox = [0, 0, 0, 1, 0.5, 1];
/** 仙人掌：原版四周各内缩 1 像素（15/16 宽），碰撞与渲染一致 */
const CACTUS_BOX: LocalBox = [0.0625, 0, 0.0625, 0.9375, 1, 0.9375];

/** 贴地薄板的厚度（1/16 格，与原版红石粉/压力板一致）。睡莲也用这个厚度 */
export const FLAT_HEIGHT = 0.0625;

/** 营火的高度（原版 7/16 高：能站上去，也能一脚踩灭） */
export const CAMPFIRE_HEIGHT = 0.4375;

/** 栅栏/墙的连接判定回调：该方向是否有可连接的方块 */
export type ConnectQuery = (facing: Facing) => boolean;

/** 邻居方块信息；stairs 由调用方（网格化）填好，避免这里反向依赖方块表 */
export interface NeighborBlock {
  id: number;
  state: number;
  stairs: boolean;
}

/** 邻居方块查询：返回相对本方块偏移 (dx, dy, dz) 处的方块 */
export type NeighborQuery = (dx: number, dy: number, dz: number) => NeighborBlock | null;

/**
 * 形状计算上下文。
 * 栅栏/墙与楼梯都依赖邻居，但需要的邻居信息不同，所以分成两个可选回调；
 * 不传时按"孤立方块"处理（描边、测试等场景）。
 */
export interface ShapeContext {
  connect?: ConnectQuery;
  neighbor?: NeighborQuery;
}

/** 楼梯的相接形状（原版的 StairsShape） */
export type StairsShape = 'straight' | 'outer_left' | 'outer_right' | 'inner_left' | 'inner_right';

/** 由方块 id 判断是不是楼梯（形状判定只需要知道"邻居是不是楼梯"） */
export type StairsProbe = (id: number) => boolean;

const NEVER_CONNECT: ConnectQuery = () => false;

/** 栅栏柱子的半宽（原版 4/16 宽） */
const FENCE_POST = 0.375;
/** 栅栏高度（原版 1.5 格） */
const FENCE_HEIGHT = 1.5;
/** 横杆厚度 */
const RAIL_WIDTH = 0.1875;
/** 玻璃板的半厚（总厚 2/16，与原版一致） */
const PANE_HALF = 0.0625;

// ---------------------------------------------------------------- 碰撞盒

export function collisionBoxes(shape: BlockShape, state: number): readonly LocalBox[] {
  switch (shape) {
    case 'cube':
      return [FULL];
    case 'fluid':
      // 流体不挡路（玩家在水里会被减速，但不会被挡住）
      return [];
    case 'slab':
      // 双层台阶 = 整格；这也是它与"直接放一个原方块"在碰撞上完全一致的原因
      if (isSlabDouble(state)) return [FULL];
      return isTop(state) ? [[0, 0.5, 0, 1, 1, 1]] : [HALF_BOTTOM];
    case 'stairs': {
      // 下半层整块 + 上半层的半格（朝向决定在哪一侧）
      // 说明：原版的楼梯碰撞盒不随内角/外角变化，所以这里只用朝向与上下半，不看形状
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
    case 'pane':
      // 原版的玻璃板碰撞固定是"十字"两块（1 格长、2/16 厚），不随连接方向变化
      return [
        [0, 0, 0.5 - PANE_HALF, 1, 1, 0.5 + PANE_HALF],
        [0.5 - PANE_HALF, 0, 0, 0.5 + PANE_HALF, 1, 1],
      ];
    case 'door':
      // ⚠️ 开着的门**没有碰撞体积**（原版可以直接穿过门洞）。
      // 这里曾经无论开关都返回那块薄板，导致"门开了但走不过去"——
      // 是 K7 的单元测试（tests/collision.test.ts）把它抓出来的。
      return isDoorOpen(state) ? [] : [doorBox(state)];
    case 'trapdoor':
      // 活板门**开关都有碰撞**（开着的活板门就是一片竖着的挡板，原版也撞得到）。
      // 与渲染共用同一份几何：免得"画一片板、撞在另一处"
      return [trapdoorBox(state)];
    case 'fence_gate':
      // 栅栏门：关着时门板横在两柱之间（1.5 格高，挡路），开着时门板转到侧面、
      // **中间让开一个 0.75 格宽的洞**（玩家 0.6 格宽，正好走过去）
      return fenceGateBoxes(state);
    case 'cactus':
      return [CACTUS_BOX];
    case 'chain':
      // 锁链有碰撞，但只有 3/16 粗：站在它正中间会撞到，偏一点就走过去了
      return chainBoxes(state);
    case 'vine':
      // 藤蔓没有碰撞（原版可以穿过去）——它是"挂在墙上的一层叶子"
      return [];
    case 'torch':
    case 'ladder':
    case 'cross':
    case 'flat':
      // 火把、梯子、植物、贴地薄板都没有碰撞体积（原版红石粉与压力板也不挡路）
      return [];
    case 'lily_pad':
      // 睡莲是"能站上去的薄板"：原版可以踩着一路走过水面，所以它**有**碰撞体积
      return [[0, 0, 0, 1, FLAT_HEIGHT, 1]];
    case 'snow':
      // 雪层的高度就是"层数 / 8"：1 层是 1/8 格（能直接走上去，不需要跳），
      // 8 层正好是整格。碰撞与渲染共用这一份高度，所以"看着矮、撞着高"这类错不会出现。
      return [[0, 0, 0, 1, snowHeight(state), 1]];
    case 'campfire':
      // 营火是一堆 7/16 高的柴：能站上去（原版也能踩），所以它有碰撞
      return [[0, 0, 0, 1, CAMPFIRE_HEIGHT, 1]];
    case 'cocoa':
      // 可可豆荚：贴着原木那一面的一个小盒子（原版能踩上去，所以它有碰撞）
      return cocoaBoxes(state);
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

/**
 * 活板门：一块 3/16 厚的板。
 *
 * - 关：横着——贴在被放置的那一半（`isTop` = 贴天花板，否则贴地）
 * - 开：竖起来，贴在**朝向所指的那一侧**（朝向取自放置时玩家面对的方向）
 *
 * 渲染与碰撞共用这一份（见 `meshBoxes`／`collisionBoxes`）：原版开着的活板门
 * 确实是一块竖着的挡板，所以这里不像门那样"开着就没有碰撞"。
 */
function trapdoorBox(state: number): LocalBox {
  const thickness = 0.1875;
  if (!isTrapdoorOpen(state)) {
    return isTop(state) ? [0, 1 - thickness, 0, 1, 1, 1] : [0, 0, 0, 1, thickness, 1];
  }
  const d = FACING_OFFSET[facingOf(state)]!;
  if (d[0] === 1) return [1 - thickness, 0, 0, 1, 1, 1];
  if (d[0] === -1) return [0, 0, 0, thickness, 1, 1];
  if (d[1] === 1) return [0, 0, 1 - thickness, 1, 1, 1];
  return [0, 0, 0, 1, 1, thickness];
}

/** 栅栏门的柱子宽度（2/16）与门板厚度（4/16）、高度（原版 1.5 格） */
const GATE_POST = 0.125;
const GATE_THICKNESS = 0.25;
const GATE_HEIGHT = 1.5;

/**
 * 栅栏门：两根柱子 + 一块门板。
 *
 * - 关：门板横在两柱之间，整扇 1.5 格高（挡路）
 * - 开：门板绕着一侧的柱子转 90°，贴到朝向那一侧；两柱之间**让开 0.75 格**
 *
 * ⚠️ 简化的地方：原版开门时门板会"绕柱旋转"，这里只把门板挪到那一侧并转 90°，
 * 观感近似（门板贴着一根柱子、朝着玩家面对的方向伸出去）。
 */
function fenceGateBoxes(state: number): LocalBox[] {
  const d = FACING_OFFSET[facingOf(state)]!;
  const alongX = d[0] === 0;
  const half = GATE_THICKNESS / 2;
  const boxes: LocalBox[] = [];

  const post = (at: number): LocalBox =>
    alongX
      ? [at, 0, 0.5 - half, at + GATE_POST, GATE_HEIGHT, 0.5 + half]
      : [0.5 - half, 0, at, 0.5 + half, GATE_HEIGHT, at + GATE_POST];
  boxes.push(post(0), post(1 - GATE_POST));

  if (!isFenceGateOpen(state)) {
    boxes.push(
      alongX
        ? [0, 0, 0.5 - half, 1, GATE_HEIGHT, 0.5 + half]
        : [0.5 - half, 0, 0, 0.5 + half, GATE_HEIGHT, 1],
    );
    return boxes;
  }

  // 开：门板贴着 -X（或 -Z）那根柱子，朝朝向那一侧伸出去
  const forward = alongX ? d[1] : d[0];
  if (alongX) {
    const z0 = forward > 0 ? 0 : 1 - GATE_THICKNESS;
    boxes.push([0, 0, z0, GATE_POST, GATE_HEIGHT, z0 + GATE_THICKNESS]);
  } else {
    const x0 = forward > 0 ? 0 : 1 - GATE_THICKNESS;
    boxes.push([x0, 0, 0, x0 + GATE_THICKNESS, GATE_HEIGHT, GATE_POST]);
  }
  return boxes;
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

/**
 * 这一格能不能按"整格"处理（完整立方体，或满格的流体）。
 *
 * 网格化用它决定"要不要走贪心合并"，测试也用它算逐面基准值——
 * 两边共用一份判定，免得基准与实际实现悄悄跑偏（本轮就踩过一次）。
 */
export function isFullBlockShape(shape: BlockShape, state: number): boolean {
  if (shape === 'cube') return true;
  // 水位为 0（水源）或下落中的液体高度是整格，海洋里绝大多数水都属于这一类
  if (shape === 'fluid') return fluidHeight(state) >= 1;
  return false;
}

export function meshBoxes(shape: BlockShape, state: number, ctx: ShapeContext = {}): readonly LocalBox[] {
  if (shape === 'fluid') {
    // 液面高度由状态位决定：水源接近满格、越流越薄、下落时填满
    return [[0, 0, 0, 1, fluidHeight(state), 1]];
  }
  switch (shape) {
    case 'cube':
      return [FULL];
    case 'slab':
      if (isSlabDouble(state)) return [FULL];
      return isTop(state) ? [[0, 0.5, 0, 1, 1, 1]] : [HALF_BOTTOM];
    case 'stairs':
      return stairsBoxes(state, ctx.neighbor);
    case 'fence':
      return fenceBoxes(ctx.connect ?? NEVER_CONNECT);
    case 'wall':
      return wallBoxes(ctx.connect ?? NEVER_CONNECT);
    case 'pane':
      return paneBoxes(ctx.connect ?? NEVER_CONNECT);
    case 'door':
      // ⚠️ 开着的门**没有碰撞体积**（原版可以直接穿过门洞）。
      // 这里曾经无论开关都返回那块薄板，导致"门开了但走不过去"——
      // 是 K7 的单元测试（tests/collision.test.ts）把它抓出来的。
      return isDoorOpen(state) ? [] : [doorBox(state)];
    case 'trapdoor':
      // 与碰撞盒共用同一份几何（见 `collisionBoxes`）
      return [trapdoorBox(state)];
    case 'fence_gate':
      return fenceGateBoxes(state);
    case 'torch':
      return torchBoxes(state);
    case 'ladder':
      return ladderBoxes(state);
    case 'chain':
      // 与碰撞盒共用同一份几何（免得"看着细、撞着粗"）
      return chainBoxes(state);
    case 'vine':
      // 每个挂面一片 1/16 厚的薄片（最多 5 片：四个侧面 + 顶面）
      return vineBoxes(state);
    case 'cactus':
      return [CACTUS_BOX];
    case 'flat':
    case 'lily_pad':
      // 睡莲与"贴地薄板"长得一样（都是 1/16 的一层），差别只在碰撞（见 `collisionBoxes`）
      return [[0, 0, 0, 1, FLAT_HEIGHT, 1]];
    case 'campfire':
      // 与碰撞盒同源（7/16 的柴堆）
      return [[0, 0, 0, 1, CAMPFIRE_HEIGHT, 1]];
    case 'snow':
      // 高度随层数变化，与碰撞盒同源（见 `collisionBoxes`）
      return [[0, 0, 0, 1, snowHeight(state), 1]];
    case 'cocoa':
      // 与碰撞盒同源（挂在原木侧面的豆荚）
      return cocoaBoxes(state);
    // 植物由网格化器单独输出两片交叉薄面（见 ChunkMesher 的 emitCross），不走盒子路径
    case 'cross':
      return [];
    default:
      return [FULL];
  }
}

// ---------------------------------------------------------------- 楼梯转角

/** 原版的 Direction#rotateYCCW：北→西→南→东→北 */
function rotateYccw(facing: Facing): Facing {
  return ((facing + 3) & 3) as Facing;
}

/**
 * 楼梯的相接形状（复刻原版 StairsBlock#getShape）。
 *
 * 规则：看**朝向一侧**（内角）与**背后一侧**（外角）是否有一个朝向垂直的楼梯，
 * 再看那个邻居的朝向是否等于本朝向的 rotateYCCW 来决定左右。
 *
 * ⚠️ 这里是在**网格化时按邻居实时计算**的，而不是放置时把形状写进状态。
 * 好处是旁边放一个新楼梯后，原来的楼梯会自动变成转角——不需要在每次方块变动时
 * 反过来更新四周楼梯的状态（那一套同步逻辑非常容易漏）。
 */
export function stairsShape(facing: Facing, top: boolean, neighbor?: NeighborQuery): StairsShape {
  if (!neighbor) return 'straight';

  const d = FACING_OFFSET[facing]!;

  // 内角：正前方有同层、朝向垂直的楼梯
  const infront = neighbor(d[0], 0, d[1]);
  if (isMatchingStair(infront, top) && isPerpendicular(facing, facingOf(infront.state))) {
    return facingOf(infront.state) === rotateYccw(facing) ? 'inner_left' : 'inner_right';
  }

  // 外角：背后有同层、朝向垂直的楼梯
  const behind = neighbor(-d[0], 0, -d[1]);
  if (isMatchingStair(behind, top) && isPerpendicular(facing, facingOf(behind.state))) {
    return facingOf(behind.state) === rotateYccw(facing) ? 'outer_right' : 'outer_left';
  }

  return 'straight';
}

/** 两个朝向是否垂直（Facing 的奇偶正好对应两个轴） */
function isPerpendicular(a: Facing, b: Facing): boolean {
  return ((a ^ b) & 1) === 1;
}

/** 邻居是不是「同层的楼梯」——形状判定只关心这一件事 */
function isMatchingStair(other: NeighborBlock | null, top: boolean): other is NeighborBlock {
  return other !== null && other.stairs && isTop(other.state) === top;
}

/**
 * 楼梯的渲染盒：基础两级 + 转角时在「低侧」补 1/4 块。
 *
 * 内角与外角补的是**相对的两个侧向半边**，这正是原版 stairs_inner / stairs_outer
 * 两个模型文件的差别（其余部分完全一致）。
 */
function stairsBoxes(state: number, neighbor?: NeighborQuery): readonly LocalBox[] {
  const boxes: LocalBox[] = [...collisionBoxes('stairs', state)];
  const shape = stairsShape(facingOf(state), isTop(state), neighbor);
  if (shape === 'straight') return boxes;

  const facing = facingOf(state);
  const d = FACING_OFFSET[facing]!;
  const top = isTop(state);

  // 取参与相接的那个邻居的朝向
  const other =
    shape.startsWith('inner') ? neighbor?.(d[0], 0, d[1]) : neighbor?.(-d[0], 0, -d[1]);
  if (!other) return boxes;

  // 邻居朝向等于 rotateYCCW 时补「负侧」半边；内角与外角取相反的一侧
  const negativeSide = (facingOf(other.state) === rotateYccw(facing)) === shape.startsWith('outer');
  boxes.push(quarterBox(d, negativeSide, top));
  return boxes;
}

/** 「低侧 + 指定侧向半边」的 1/4 块（低侧 = 朝向的反侧） */
function quarterBox(d: readonly [number, number], negativeSide: boolean, top: boolean): LocalBox {
  const y0 = top ? 0 : 0.5;
  const y1 = top ? 0.5 : 1;

  if (d[0] !== 0) {
    // 高侧沿 X，低侧与侧向半边都在 X/Z 上切分
    const x0 = d[0] > 0 ? 0 : 0.5;
    const z0 = negativeSide ? 0 : 0.5;
    return [x0, y0, z0, x0 + 0.5, y1, z0 + 0.5];
  }
  const z0 = d[1] > 0 ? 0 : 0.5;
  const x0 = negativeSide ? 0 : 0.5;
  return [x0, y0, z0, x0 + 0.5, y1, z0 + 0.5];
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

/** 玻璃板：中心柱 + 四个方向按需延伸的薄片（高度铺满整格） */
function paneBoxes(connect: ConnectQuery): readonly LocalBox[] {
  const t = PANE_HALF;
  const boxes: LocalBox[] = [[0.5 - t, 0, 0.5 - t, 0.5 + t, 1, 0.5 + t]];

  for (const facing of [0, 1, 2, 3] as const) {
    if (!connect(facing)) continue;
    const [dx, dz] = FACING_OFFSET[facing]!;
    if (dx !== 0) {
      const x0 = dx > 0 ? 0.5 + t : 0;
      const x1 = dx > 0 ? 1 : 0.5 - t;
      boxes.push([x0, 0, 0.5 - t, x1, 1, 0.5 + t]);
    } else {
      const z0 = dz > 0 ? 0.5 + t : 0;
      const z1 = dz > 0 ? 1 : 0.5 - t;
      boxes.push([0.5 - t, 0, z0, 0.5 + t, 1, z1]);
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

/**
 * 锁链（B11）：3/16 粗的细柱，方向由轴向决定。
 *
 * 原版 `ChainBlock` 的碰撞盒是 `box(6.5, 0, 6.5, 9.5, 16, 9.5)`——就是 3/16 见方，
 * 所以照抄这个尺寸：站着不动撞得到，偏一格就走过去了。
 */
const CHAIN_HALF = 3 / 32;

function chainBoxes(state: number): readonly LocalBox[] {
  const lo = 0.5 - CHAIN_HALF;
  const hi = 0.5 + CHAIN_HALF;
  switch (axisOf(state)) {
    case 1:
      return [[0, lo, lo, 1, hi, hi]];
    case 2:
      return [[lo, lo, 0, hi, hi, 1]];
    default:
      return [[lo, 0, lo, hi, 1, hi]];
  }
}

/**
 * 藤蔓（B11）：每个挂面一片 1/16 厚的薄片。
 *
 * 与原版的差别（已记录到 TASKS）：原版是一张**平面四边形**，这里用 1/16 厚的薄盒
 * （与梯子同一套路），代价是薄片的侧边也会露出来一点点。
 * 好处是几何完全走现有的"盒子"通道，网格化器不用为它开一条新路径。
 */
const VINE_THICKNESS = 1 / 16;

function vineBoxes(state: number): readonly LocalBox[] {
  const t = VINE_THICKNESS;
  const boxes: LocalBox[] = [];
  for (const facing of vineSides(state)) {
    switch (facing) {
      case 0:
        // 北面：墙在自己北边（-Z），薄片贴在 z ∈ [0, 1/16]
        boxes.push([0, 0, 0, 1, 1, t]);
        break;
      case 1:
        boxes.push([1 - t, 0, 0, 1, 1, 1]);
        break;
      case 2:
        boxes.push([0, 0, 1 - t, 1, 1, 1]);
        break;
      default:
        boxes.push([0, 0, 0, t, 1, 1]);
        break;
    }
  }
  // 顶面：挂在天花板底下的一层
  if (hasVineUp(state)) boxes.push([0, 1 - t, 0, 1, 1, 1]);
  return boxes;
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

/**
 * 可可豆荚（批次 49）：贴着原木那一面的一个盒子。
 *
 * 尺寸取原版成熟期的近似值（**三个生长阶段共用同一份尺寸**）——
 * 本项目里"阶段"是三个不同的方块 id，而几何只能看到状态、看不到 id，
 * 所以做不到"豆荚随成熟变大"。这条差异很小（豆荚本来就只有 7/16 厚），
 * 记在 TASKS 里；要做得更细就得像雪层那样把阶段压进状态位。
 */
function cocoaBoxes(state: number): readonly LocalBox[] {
  const depth = 0.4375; // 7/16：从原木面伸出多少
  const inner = 0.25; // 左右各留 1/4
  switch (facingOf(state)) {
    case 0: // 贴在北面
      return [[inner, 0.25, 0, 1 - inner, 0.8125, depth]];
    case 1: // 东
      return [[1 - depth, 0.25, inner, 1, 0.8125, 1 - inner]];
    case 2: // 南
      return [[inner, 0.25, 1 - depth, 1 - inner, 0.8125, 1]];
    default: // 西
      return [[0, 0.25, inner, depth, 0.8125, 1 - inner]];
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

/**
 * 玻璃板的连接判定。
 * 与原版一致：相邻的玻璃板之间会连成一片，贴着完整实心方块时也会延伸过去
 * （这样窗户镶在墙里时边缘是齐的）。
 */
export function canPaneConnectTo(neighborId: number): boolean {
  if (neighborId === 0) return false;
  const def = blockDef(neighborId);
  if (def.shape === 'pane') return true;
  return def.solid && def.opaque && def.shape === 'cube';
}
