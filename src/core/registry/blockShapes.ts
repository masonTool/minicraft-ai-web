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
  CAKE_SLICES,
  FACING_OFFSET,
  axisOf,
  cakeBites,
  doorHinge,
  facingOf,
  fluidHeight,
  hopperOutputOf,
  hopperOutputOffset,
  hasVineUp,
  isBedHead,
  isDoorOpen,
  isFenceGateOpen,
  isSlabDouble,
  isTop,
  isTrapdoorOpen,
  isWallMounted,
  outwardFacingOf,
  sixFacingOf,
  sixFacingOffset,
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

/**
 * 床的高度（B13，批次 79）：原版 9/16 高——比半格高一点点，
 * 所以**走上去不用跳**（自动上台阶是 0.6，9/16 = 0.5625 < 0.6），与原版手感一致。
 */
export const BED_HEIGHT = 0.5625;

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
    case 'scaffolding':
      // ⚠️ 碰撞**不随连接方向变化**（与栅栏同一条约定）：物理这边拿不到邻居，
      // 所以四根角柱一律算上。渲染会按连接裁掉内部那些柱子——看着细、撞着也是细的，
      // 差别只在于"相邻两片脚手架的交界处多撞一根柱"，走位时基本感觉不到
      return [SCAFFOLD_PLATFORM, ...SCAFFOLD_PILLARS];
    case 'daylight_detector':
      // 与渲染同源（6/16 高的板：能站上去）
      return [DAYLIGHT_PLATE];
    case 'tripwire':
      // 绊线**没有碰撞**：踩上去只是触发，不会被绊住（原版如此）
      return [];
    case 'tripwire_hook':
      // 只有贴墙那块底板挡路（钩子那根太细，原版也不挡）——取渲染盒的第 0 个
      return [tripwireHookBoxes(state)[0]!];
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
    // 下界疣（批次 92）：与 `cross` 同一种几何（两片交叉薄面、无碰撞），
    // 差别只在**放置/支撑判据**（只认灵魂沙，见 `blockState.ts` 的形状注释）
    case 'nether_wart':
    case 'flat':
    // 珊瑚扇（批次 51）：一片薄面，原版可以直接游过去
    case 'coral_fan':
    // 告示牌（批次 80）：原版告示牌**不挡路**（能从牌子里走过去），所以没有碰撞盒。
    // 它仍然能被选中/破坏——射线判定走的是"这个形状能不能选中"，与碰撞无关
    // （火把、植物、绊线都是这一档）
    case 'sign':
      // 火把、梯子、植物、贴地薄板都没有碰撞体积（原版红石粉与压力板也不挡路）
      return [];
    case 'lightning_rod':
      // 避雷针（批次 83）：2/16 细杆，**有碰撞**（原版能站在上面、也能挡路）
      return [lightningRodBox(state)];
    case 'item_frame':
    case 'painting':
      // 展示框与画（B14，批次 86）：原版两者都不挡路（能直接走过去/穿过去），
      // 所以**没有碰撞盒**——它们仍然能被选中与破坏（射线判定不看碰撞盒）
      return [];
    case 'lily_pad':
      // 睡莲是"能站上去的薄板"：原版可以踩着一路走过水面，所以它**有**碰撞体积
      return [[0, 0, 0, 1, FLAT_HEIGHT, 1]];
    case 'cake':
      // 与渲染同源（半格高，宽度按吃掉的片数算）——不然会出现"看着还能吃、其实踩空了"
      return [[0, 0, 0, cakeWidth(state), CAKE_HEIGHT, 1]];
    case 'flower_pot':
      // 盆身能站上去（原版花盆是实心的矮块），里面那株植物没有碰撞
      return [FLOWER_POT_BOX];
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
    case 'hopper':
      // 漏斗（批次 58）：只算碗口与收窄那两段——管子不挡路，
      // 所以玩家能**从漏斗底下走过去**（原版也能）
      return hopperCollisionBoxes();
    case 'dropper':
      // 投掷器（批次 59）：**整格碰撞**（原版也是）——那个 2/16 的小凸口撞不到，
      // 所以它的渲染盒比碰撞盒多出来一小块（见 `dropperBoxes`）
      return [FULL];
    case 'dispenser':
      // 发射器（批次 60）：同样是整格碰撞（凸口/挡板撞不到）
      return [FULL];
    case 'composter':
      // 堆肥桶（批次 70）：**桶壁 + 桶底**（中间是空的，能看见里面的堆肥）
      return composterBoxes();
    case 'bed':
      // 床（批次 79）：9/16 高的一整块（能站上去，也能沿着床走）。
      // 与渲染同源，所以"看着是张床、踩着是张床"
      return [[0, 0, 0, 1, BED_HEIGHT, 1]];
    default:
      return [FULL];
  }
}

/**
 * 堆肥桶（批次 70）：四面板条（2/16 厚、整格高）+ 2/16 厚的桶底。
 *
 * ⚠️ 这里**网格盒与碰撞盒是同一套**（原版也是）：桶沿能站、桶里也能站
 * （站在桶底那张 2/16 的板上），所以它不像漏斗那样"能从底下走过去"。
 * 顶面敞口是刻意的：从上往下看能看见桶底那张贴图（空着 = 暗口、满了 = 堆肥），
 * 这正是"这个桶有几分满"唯一能看见的地方。
 */
function composterBoxes(): readonly LocalBox[] {
  const t = 2 / 16;
  return [
    [0, 0, 0, 1, t, 1], // 桶底
    [0, 0, 0, t, 1, 1], // 西壁
    [1 - t, 0, 0, 1, 1, 1], // 东壁
    [t, 0, 0, 1 - t, 1, t], // 北壁
    [t, 0, 1 - t, 1 - t, 1, 1], // 南壁
  ];
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
/**
 * "十字薄面"那一类形状（`cross` 与下界疣）。
 *
 * 两者几何完全一样、**只有放置/支撑判据不同**（`cross` 要求下方实心，
 * 下界疣只认灵魂沙）。凡是"按形状分派几何"的地方都该问这个函数而不是各自写
 * `shape === 'cross'`——批次 92 加下界疣时，网格化那条路径就是靠它一处改到的
 * （漏在这里的表现是"方块放下去了但看不见"）。
 */
export function isCrossShape(shape: BlockShape): boolean {
  return shape === 'cross' || shape === 'nether_wart';
}

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
    case 'coral_fan':
      return coralFanBoxes(state);
    case 'scaffolding':
      return scaffoldingBoxes(ctx.connect ?? NEVER_CONNECT);
    case 'daylight_detector':
      // 阳光传感器（批次 54）：一块 6/16 高的板子（原版就是一块平板，走上去不用跳）
      return [DAYLIGHT_PLATE];
    case 'tripwire':
      // 绊线（批次 55）：细线，方向按邻居实时算；没有碰撞
      return tripwireBoxes(ctx.connect ?? NEVER_CONNECT);
    case 'tripwire_hook':
      // 绊线钩（批次 55）：底板 + 小钩子（朝向决定它们贴在哪一面）
      return tripwireHookBoxes(state);
    case 'cake':
      // 蛋糕（批次 52）：半格高，**宽度随吃掉的片数变窄**（靠西侧那一端留着）
      return [[0, 0, 0, cakeWidth(state), CAKE_HEIGHT, 1]];
    case 'flower_pot':
      // 花盆（批次 52）：四周内缩 2/16、高 6/16 的一个盆身（盆里的植物由网格化器另画）
      return [FLOWER_POT_BOX];
    case 'campfire':
      // 与碰撞盒同源（7/16 的柴堆）
      return [[0, 0, 0, 1, CAMPFIRE_HEIGHT, 1]];
    case 'snow':
      // 高度随层数变化，与碰撞盒同源（见 `collisionBoxes`）
      return [[0, 0, 0, 1, snowHeight(state), 1]];
    case 'cocoa':
      // 与碰撞盒同源（挂在原木侧面的豆荚）
      return cocoaBoxes(state);
    case 'hopper':
      // 漏斗（批次 58）：碗口 + 两级收窄 + 管子（管子朝哪边由状态决定）
      return hopperBoxes(state);
    case 'dropper':
      // 投掷器（批次 59）：整格铁壳 + 朝哪边就往哪边伸出的那个小凸口
      return dropperBoxes(state);
    case 'dispenser':
      // 发射器（批次 60）：整格铁壳 + 朝哪边就往哪边伸出的一块**扁挡板**
      // （原版靠正面那张"带孔的圈"贴图区分两兄弟，本项目做不出"只有正面不同"，
      //  所以改用几何：细管 vs 宽挡板）
      return dispenserBoxes(state);
    case 'composter':
      // 堆肥桶（批次 70）：四面板条围一圈 + 2/16 厚的桶底；**顶面是敞口的**
      // （空着时从上面能看见桶底那张"暗口"贴图，满了换成"堆肥满仓"那张）
      return composterBoxes();
    case 'bed':
      // 床（批次 79）：9/16 的床体 + **床头那一端**多一块 2/16 高的枕头。
      // 枕头用几何而不是贴图表达朝向：本项目没有"按朝向旋转贴图"的能力
      // （与活塞/投掷器同一条取舍，见 HANDOFF 的经验表——
      //  "某一面单独换贴图做不到时，用几何补"）。
      // 枕头的位置由 `facing` 算出来：床头那一格**远离床脚**的那一端。
      return isBedHead(state) ? [BED_BASE, bedPillowBox(state)] : [BED_BASE];
    case 'sign':
      // 告示牌（批次 80）：落地牌 = 立柱 + 牌面；挂墙牌 = 只有牌面（贴在靠墙那一侧）
      return isWallMounted(state) ? [signBoardBox(state)] : [SIGN_POST, signBoardBox(state)];
    case 'lightning_rod':
      // 避雷针（批次 83）：一根细杆（碰撞与渲染同一个盒子，所以"看着是杆、踩着也是杆"）
      return [lightningRodBox(state)];
    case 'item_frame':
      // 展示框（B14，批次 86）：墙上的一块板，中间镂空**靠贴图**（框环画在贴图里）。
      // 用"整面 + 透明中孔"而不是"四个木条盒子"：原版的框就是一圈木边 + 中间的洞，
      // 一个盒子 + 一张带透明通道的贴图就够了，也不必为 4 个朝向各摆一次木条
      return [itemFrameBox(state)];
    case 'painting':
      // 画（B14）：整面 1/16 薄板，贴图按状态换（哪一幅画）
      return [paintingBox(state)];
    // 植物由网格化器单独输出两片交叉薄面（见 ChunkMesher 的 emitCross），不走盒子路径
    case 'cross':
    // 下界疣（批次 92）同理：它也是十字薄面
    case 'nether_wart':
      return [];
    default:
      return [FULL];
  }
}

// ---------------------------------------------------------------- 床（批次 79）

/** 床体：9/16 高的一整块（碰撞与渲染共用） */
const BED_BASE: LocalBox = [0, 0, 0, 1, BED_HEIGHT, 1];

/** 枕头的高度（原版只比床面高一点点；这里 2/16，从上方一眼能认出哪头是床头） */
export const BED_PILLOW_HEIGHT = 2 / 16;

/** 枕头沿着床的长边占多宽（原版枕头大约占床头那一格的 5/16） */
export const BED_PILLOW_LENGTH = 5 / 16;

/**
 * 枕头的位置：床头那一格的**远离床脚**的那一端。
 *
 * `facing` 指向床头方向，所以"远离床脚"就是 `facing` 的正方向：
 * 朝北 → 枕头贴在 z=0 那一侧；朝东 → 贴在 x=1 那一侧（依此类推）。
 */
function bedPillowBox(state: number): LocalBox {
  const facing = facingOf(state);
  const y0 = BED_HEIGHT;
  const y1 = BED_HEIGHT + BED_PILLOW_HEIGHT;
  switch (facing) {
    case 0: // 床头朝北：枕头在北端
      return [0, y0, 0, 1, y1, BED_PILLOW_LENGTH];
    case 2: // 朝南：枕头在南端
      return [0, y0, 1 - BED_PILLOW_LENGTH, 1, y1, 1];
    case 1: // 朝东：枕头在东端
      return [1 - BED_PILLOW_LENGTH, y0, 0, 1, y1, 1];
    default: // 朝西
      return [0, y0, 0, BED_PILLOW_LENGTH, y1, 1];
  }
}

// ---------------------------------------------------------------- 告示牌（批次 80）

/** 落地牌的立柱：2/16 见方、8/16 高（牌面接在它上面） */
const SIGN_POST: LocalBox = [7 / 16, 0, 7 / 16, 9 / 16, 8 / 16, 9 / 16];

/** 牌面的厚度（2/16，与立柱同宽——贴图都是一张木板，所以看不出拼接） */
export const SIGN_BOARD_THICKNESS = 2 / 16;

/** 落地牌的牌面高度范围（上半格） */
const STANDING_BOARD_Y0 = 8 / 16;
/** 挂墙牌的牌面高度范围（原版挂墙牌比落地牌低一点，约 4/16 起、8/16 高） */
const WALL_BOARD_Y0 = 4 / 16;

/**
 * 牌面（写字的那块木板）的盒子。
 *
 * `facing` 记的是**字朝哪边**，所以：
 *  - 落地牌：牌面**垂直于**那个方向（字朝北 → 板子立在南北之间，占满 x 宽度）；
 *  - 挂墙牌：牌面贴在那面墙上，厚度落在**背对 `facing` 的那一侧**。
 *
 * 这个函数是"牌子的几何"唯一出处：网格化器拿它出盒子，
 * `render/SignRenderer` 拿它算文字平面贴在哪（所以两者不会各自漂）。
 */
export function signBoardBox(state: number): LocalBox {
  const facing = facingOf(state);
  const t = SIGN_BOARD_THICKNESS;
  if (isWallMounted(state)) {
    const y0 = WALL_BOARD_Y0;
    const y1 = WALL_BOARD_Y0 + 8 / 16;
    switch (facing) {
      case 0: // 字朝北 → 墙在南边
        return [0, y0, 1 - t, 1, y1, 1];
      case 2: // 字朝南 → 墙在北边
        return [0, y0, 0, 1, y1, t];
      case 1: // 字朝东 → 墙在西边
        return [1 - t, y0, 0, 1, y1, 1];
      default: // 字朝西 → 墙在东边
        return [0, y0, 0, t, y1, 1];
    }
  }
  // 落地牌：牌面居中对齐（厚度在中间那一小段），横向占满一格
  const y0 = STANDING_BOARD_Y0;
  const y1 = 1;
  const half = (1 - t) / 2;
  switch (facing) {
    case 0: // 字朝北/南：板子在南北之间（薄的那一维是 z）
    case 2:
      return [0, y0, half, 1, y1, half + t];
    default: // 朝东/西：薄的那一维是 x
      return [half, y0, 0, half + t, y1, 1];
  }
}

// ---------------------------------------------------------------- 避雷针（批次 83）

/** 避雷针的杆粗（2/16 见方，原版） */
export const ROD_THICKNESS = 2 / 16;
/** 杆从贴着的那一面伸出来多长（原版 6/16） */
export const ROD_LENGTH = 6 / 16;

/**
 * 避雷针的盒子：**从贴着的那一面**伸出来的一根细杆。
 *
 * 朝向用共享的六向编码，语义是"**指向伸出方向**"：
 *  - 朝上（贴在方块顶上）：杆立在 y ∈ [0, 6/16]
 *  - 朝下（贴在天花板下）：杆吊在 y ∈ [1−6/16, 1]
 *  - 朝东：杆在 x ∈ [1−6/16, 1]（贴在西边那块方块上，往东伸）
 * 四个水平朝向同理。**杆的最后 2/16 是"杆头"**——闪电就打在那儿
 * （见 `world/Lightning.ts` 的 `rodTip()`）。
 */
export function lightningRodBox(state: number): LocalBox {
  const t = ROD_THICKNESS;
  const l = ROD_LENGTH;
  const lo = (1 - t) / 2;
  const hi = lo + t;
  switch (sixFacingOf(state)) {
    case 'up':
      return [lo, 0, lo, hi, l, hi];
    case 'down':
      return [lo, 1 - l, lo, hi, 1, hi];
    // ⚠️ `SixFacing` 的水平四向是**数字**（`Facing` = 0..3，见 `FACING_OFFSET`），
    // 只有竖直那两档是字符串 'up' / 'down'——别照着名字写 'east'/'west'（类型会当场拦下）
    case 1: // 东：贴在西边那块方块上，往东伸
      return [1 - l, lo, lo, 1, hi, hi];
    case 3: // 西
      return [0, lo, lo, l, hi, hi];
    case 2: // 南
      return [lo, lo, 1 - l, hi, hi, 1];
    case 0: // 北
    default:
      return [lo, lo, 0, hi, hi, l];
  }
}

/** 文字平面离牌面外移的距离（格）：太小会与牌面 z-fighting，太大就"飘"出牌子 */
export const SIGN_TEXT_OFFSET = 0.008;

/** 文字平面的锚点：局部坐标 + 它该朝的法线（渲染层照着摆一块平面） */
export interface SignTextAnchor {
  x: number;
  y: number;
  z: number;
  /** 法线的水平分量（指向牌面外侧） */
  nx: number;
  nz: number;
}

/**
 * 牌面文字贴在哪儿、朝哪边。
 *
 * 这是**渲染层唯一需要知道的几何**：它从 `signBoardBox`（牌面盒子）与 `facing` 推出来，
 * 所以"牌面在哪、字就贴在哪"只有一处实现——落地牌与挂墙牌也自动都成立
 * （它们只差那个盒子）。放在注册表这一层而不是渲染层，是为了**能离线断言**
 * （渲染层要 `document`，离线跑不起来）。
 */
export function signTextAnchor(state: number): SignTextAnchor {
  const box = signBoardBox(state);
  const [dx, dz] = FACING_OFFSET[facingOf(state)] ?? [0, -1];
  const cx = (box[0] + box[3]) / 2;
  const cy = (box[1] + box[4]) / 2;
  const cz = (box[2] + box[5]) / 2;
  // 沿法线方向的半厚度：法线必在 x 或 z 轴上，"薄"的那一维就是它
  const half = dx !== 0 ? (box[3] - box[0]) / 2 : (box[5] - box[2]) / 2;
  return {
    x: cx + dx * (half + SIGN_TEXT_OFFSET),
    y: cy,
    z: cz + dz * (half + SIGN_TEXT_OFFSET),
    nx: dx,
    nz: dz,
  };
}

// ---------------------------------------------------------------- 物品展示框与画（B14，批次 86）

/** 展示框板子的厚度（2/16，与告示牌牌面同档） */
export const ITEM_FRAME_THICKNESS = 2 / 16;
/** 画的厚度（1/16：就是一层面） */
export const PAINTING_THICKNESS = 1 / 16;
/**
 * 框里那件物品的基准边长（7/16）。
 *
 * 洞口是 8/16（贴图里的木条占 2..13 那一圈），物品取 7/16 是为了**留一道缝**：
 * 正好 8/16 的话，物品的边会与框的木条严丝合缝，转 45° 时看起来像"卡进框里"。
 */
export const ITEM_FRAME_ITEM_SIZE = 7 / 16;

/**
 * 贴墙薄板的盒子：**贴着 `facing` 那一侧的整面墙**，厚度 `t`。
 *
 * 两个方块共用它（展示框与画只差厚度），所以"贴哪一面、薄的那一维是哪个"
 * 只有一处实现——写反的表现是"框嵌进墙里、只露出一层贴图"。
 *
 * 与梯子/珊瑚扇同一套：`facing` 指向**贴着的那一面墙**。
 */
function wallPlateBox(state: number, thickness: number): LocalBox {
  const t = thickness;
  switch (facingOf(state)) {
    case 0: // 墙在北边 → 板子贴在 z 小的那一侧
      return [0, 0, 0, 1, 1, t];
    case 1: // 墙在东边
      return [1 - t, 0, 0, 1, 1, 1];
    case 2: // 墙在南边
      return [0, 0, 1 - t, 1, 1, 1];
    default: // 墙在西边
      return [0, 0, 0, t, 1, 1];
  }
}

/** 展示框的板子：整面 + 镂空靠贴图（框环画在 16×16 贴图里，中间透明） */
export function itemFrameBox(state: number): LocalBox {
  return wallPlateBox(state, ITEM_FRAME_THICKNESS);
}

/** 画的板子：整面 1/16 薄板，贴图就是那幅画 */
export function paintingBox(state: number): LocalBox {
  return wallPlateBox(state, PAINTING_THICKNESS);
}

/** 框里那件物品该摆在哪、朝哪边（渲染层唯一需要知道的几何） */
export interface FrameItemAnchor {
  /** 局部坐标（相对这一格） */
  x: number;
  y: number;
  z: number;
  /** 朝外法线的水平分量（指向框面外，玩家看得到的那一侧） */
  nx: number;
  nz: number;
}

/** 物品平面离框面再往外挪多少（格）：太小会与框的后壁 z-fighting */
export const FRAME_ITEM_OFFSET = 0.012;

/**
 * 框里那件物品的挂点。
 *
 * 与告示牌的 `signTextAnchor` 同一个做法：几何放注册表这一层，
 * 渲染层只做 `position.set` / `rotation.y = atan2(nx, nz)`，
 * 于是"物品一定挂在框的正面"这条能**离线断言**（渲染层要 `document`，跑不了测试）。
 *
 * 位置 = 这一格的中心 + 沿**朝外法线**外移（**板子的厚度 + 一点余量**）。
 * ⚠️ 外移量必须是"整块板厚"而不是"半块板厚"：板子是贴着墙的那 2/16，
 * 半厚会把物品摆在板子**里面**（在洞口那一层），看着像嵌进墙里（这一条是靠断言
 * `depth > ITEM_FRAME_THICKNESS` 抓出来的——第一版写的就是半厚）。
 *
 * 立方体物品要再往外挪半个身位（见 `ItemFrameRenderer.place`）：平面物品薄，
 * 贴着框面正好；而方块体要是也贴着框面，它有一半会埋进板子与墙里。
 */
export function itemFrameItemAnchor(state: number): FrameItemAnchor {
  const outward = outwardFacingOf(state);
  const [dx, dz] = FACING_OFFSET[outward] ?? [0, -1];
  const offset = ITEM_FRAME_THICKNESS + FRAME_ITEM_OFFSET;
  return {
    x: 0.5 + dx * offset,
    y: 0.5,
    z: 0.5 + dz * offset,
    nx: dx,
    nz: dz,
  };
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

/** 蛋糕的高度（原版半格：能踩上去，但挡不住视线） */
const CAKE_HEIGHT = 0.5;

/**
 * 蛋糕还剩多宽（批次 52）。
 *
 * 原版是一块**被切着吃**的蛋糕：每吃一片少 1/7。
 * ⚠️ 吃的是**东侧**（留下靠西的那一端）——原版模型也是朝同一个方向缩，
 * 但方向写反了在单机上根本看不出来（蛋糕照样越吃越小），
 * 只有"和原版截图对照"才会发现整块蛋糕在反方向缩。这里与贴图约定一致：
 * 贴图的左侧是蛋糕的"被切面"。
 */
function cakeWidth(state: number): number {
  const bites = cakeBites(state);
  // 吃满 CAKE_SLICES 片时方块就该消失了，留 1/7 只是兜底（脏存档里可能剩一块"0 宽"的蛋糕）
  return Math.max(1 / CAKE_SLICES, 1 - bites / CAKE_SLICES);
}

/** 花盆盆身：四周内缩 1/8 格、高 6/16（原版花盆就是个矮矮的陶盆） */
const FLOWER_POT_BOX: LocalBox = [0.125, 0, 0.125, 0.875, 0.375, 0.875];

/** 花盆里那株植物画在盆沿之上（与 `blockShapes` 的盆身高度一致） */
export const FLOWER_POT_RIM = 0.375;

/** 阳光传感器那块板（6/16 高，批次 54） */
const DAYLIGHT_PLATE: LocalBox = [0, 0, 0, 1, 0.375, 1];

// ---------------------------------------------------------------- 脚手架（批次 53）

/** 脚手架底部那块板的厚度（1/8 格：能直接走上去，不用跳） */
export const SCAFFOLD_PLATFORM_HEIGHT = 0.125;

/** 柱子粗细（1/16 格） */
const SCAFFOLD_PILLAR = 0.0625;

/** 底部薄板：人站在它上面，所以碰撞与渲染都从它来 */
const SCAFFOLD_PLATFORM: LocalBox = [0, 0, 0, 1, SCAFFOLD_PLATFORM_HEIGHT, 1];

/** 四根角柱（固定那一份，碰撞盒用它；渲染会按连接裁掉内部那些） */
const SCAFFOLD_PILLARS: readonly LocalBox[] = [
  [0, SCAFFOLD_PLATFORM_HEIGHT, 0, SCAFFOLD_PILLAR, 1, SCAFFOLD_PILLAR],
  [1 - SCAFFOLD_PILLAR, SCAFFOLD_PLATFORM_HEIGHT, 0, 1, 1, SCAFFOLD_PILLAR],
  [0, SCAFFOLD_PLATFORM_HEIGHT, 1 - SCAFFOLD_PILLAR, SCAFFOLD_PILLAR, 1, 1],
  [
    1 - SCAFFOLD_PILLAR,
    SCAFFOLD_PLATFORM_HEIGHT,
    1 - SCAFFOLD_PILLAR,
    1,
    1,
    1,
  ],
];

/**
 * 脚手架的渲染盒：底部薄板 + 若干角柱。
 *
 * 每个角柱看**它相邻那两个方向**有没有连着脚手架：两边都连着说明这个角落是两片脚手架的
 * **内部交界**，柱子不用立（邻格的那根会顶在这里）——于是连成一片时只剩外圈的柱子，
 * 与原版"脚手架连起来就是一整块平台"一致。
 *
 * 柱子是"角上一根 1/16 的小方柱"：玩家 0.6 格宽，走在中间不会撞到（原版也是这样）。
 */
function scaffoldingBoxes(connect: (facing: Facing) => boolean): readonly LocalBox[] {
  const boxes: LocalBox[] = [SCAFFOLD_PLATFORM];
  // [柱子左下角 x, z, 相邻的两个方向]：西北 / 东北 / 西南 / 东南
  const corners: readonly (readonly [number, number, Facing, Facing])[] = [
    [0, 0, 3, 0],
    [1 - SCAFFOLD_PILLAR, 0, 1, 0],
    [0, 1 - SCAFFOLD_PILLAR, 3, 2],
    [1 - SCAFFOLD_PILLAR, 1 - SCAFFOLD_PILLAR, 1, 2],
  ];
  for (const [x0, z0, alongX, alongZ] of corners) {
    if (connect(alongX) && connect(alongZ)) continue;
    boxes.push([
      x0,
      SCAFFOLD_PLATFORM_HEIGHT,
      z0,
      x0 + SCAFFOLD_PILLAR,
      1,
      z0 + SCAFFOLD_PILLAR,
    ]);
  }
  return boxes;
}

/** 珊瑚扇的厚度（1/16 格，与藤蔓/贴地薄板同一档） */
const FAN_THICKNESS = 0.0625;

/**
 * 珊瑚扇（批次 51）：**一片** 1/16 厚的薄面。
 *
 * 两种摆法，与火把同一套状态语义（`wallMounted` + `facing`）：
 *  - **落地**（state 0）：贴在自己所在那一格的**底面**（原版的 floor 变体就是躺在地上的一片）
 *  - **贴墙**（wallMounted）：贴在"朝向"那一侧的墙面上（facing 指向被贴的方块）
 *
 * ⚠️ 贴墙时薄片要在**朝向那一侧**，与藤蔓/梯子同一条约定（写反的表现是
 * "扇子长在墙里面"——方块看着正常，贴图穿进墙里）。
 */
function coralFanBoxes(state: number): readonly LocalBox[] {
  const t = FAN_THICKNESS;
  if (!isWallMounted(state)) return [[0, 0, 0, 1, t, 1]];
  switch (facingOf(state)) {
    case 0:
      return [[0, 0, 0, 1, 1, t]];
    case 1:
      return [[1 - t, 0, 0, 1, 1, 1]];
    case 2:
      return [[0, 0, 1 - t, 1, 1, 1]];
    default:
      return [[0, 0, 0, t, 1, 1]];
  }
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

/**
 * 绊线的连接判定（批次 55）：相邻是绊线或绊线钩就算连上。
 *
 * 与脚手架同一条思路：**这一族有自己的"连谁"**（原版绊线只和绊线/钩子连，
 * 不会像栅栏那样挂在实心方块边）。网格化时用它决定线是沿 X 还是沿 Z 画。
 */
export function canTripwireConnectTo(neighborId: number): boolean {
  if (neighborId === 0) return false;
  const shape = blockDef(neighborId).shape;
  return shape === 'tripwire' || shape === 'tripwire_hook';
}

/** 绊线的粗细：贴着地面的 1/16 细线（2/16 宽） */
const TRIPWIRE_HEIGHT = 0.0625;
const TRIPWIRE_HALF_WIDTH = 0.0625;

/**
 * 绊线的渲染盒（批次 55）：一条细线，**方向由邻居决定**（东西向 / 南北向 / 都没连时一个小十字）。
 *
 * 原版也是这个画法：两端连上钩子的那段是一条直线，孤零零一段则是一个小十字。
 * 线**没有碰撞**——踩上去只是触发，不会被绊住（原版如此）。
 */
function tripwireBoxes(connect: (facing: Facing) => boolean): readonly LocalBox[] {
  const alongX = connect(1) || connect(3);
  const alongZ = connect(0) || connect(2);
  const boxes: LocalBox[] = [];
  if (alongX) {
    boxes.push([0, 0, 0.5 - TRIPWIRE_HALF_WIDTH, 1, TRIPWIRE_HEIGHT, 0.5 + TRIPWIRE_HALF_WIDTH]);
  }
  if (alongZ) {
    boxes.push([0.5 - TRIPWIRE_HALF_WIDTH, 0, 0, 0.5 + TRIPWIRE_HALF_WIDTH, TRIPWIRE_HEIGHT, 1]);
  }
  // 一段孤立的线（还没接到钩子）：画个小十字，这样"放下来了但没接上"一眼能看出来
  if (boxes.length === 0) {
    boxes.push([
      0.5 - TRIPWIRE_HALF_WIDTH,
      0,
      0.5 - TRIPWIRE_HALF_WIDTH,
      0.5 + TRIPWIRE_HALF_WIDTH,
      TRIPWIRE_HEIGHT,
      0.5 + TRIPWIRE_HALF_WIDTH,
    ]);
  }
  return boxes;
}

/**
 * 绊线钩的渲染盒（批次 55）：贴着墙的一块小底板 + 一根伸进格子里的小钩子。
 *
 * 朝向沿用本项目那套（`facing` 指向**贴着的那一面墙**），所以"钩子往哪边伸"
 * 是朝向的反方向——线也是往那边延伸的（见 `tripwireWireDirection`）。
 */
function tripwireHookBoxes(state: number): readonly LocalBox[] {
  const t = 0.0625; // 底板厚 1/16
  const half = 0.125; // 底板宽 4/16（一半）
  const reach = 0.375; // 钩子伸进格子 6/16
  switch (facingOf(state)) {
    case 0: // 贴北墙：底板在北侧，钩子往南伸
      return [
        [0.5 - half, 0, 0, 0.5 + half, 0.375, t],
        [0.5 - t, 0, t, 0.5 + t, t, t + reach],
      ];
    case 1: // 贴东墙
      return [
        [1 - t, 0, 0.5 - half, 1, 0.375, 0.5 + half],
        [1 - t - reach, 0, 0.5 - t, 1 - t, t, 0.5 + t],
      ];
    case 2: // 贴南墙
      return [
        [0.5 - half, 0, 1 - t, 0.5 + half, 0.375, 1],
        [0.5 - t, 0, 1 - t - reach, 0.5 + t, t, 1 - t],
      ];
    default: // 贴西墙（3）
      return [
        [0, 0, 0.5 - half, t, 0.375, 0.5 + half],
        [t, 0, 0.5 - t, t + reach, t, 0.5 + t],
      ];
  }
}

// ---------------------------------------------------------------- 漏斗（批次 58）

/**
 * 漏斗的几何（H14 的第一件容器类功能方块）。
 *
 * 原版是一个**斜面漏斗**：上面 6/16 高的碗口，往下斜着收成一个 4/16 见方的管子。
 * 本项目只画轴对齐盒子（与花盆"盆身 + 植物"同一套折中），所以用**四级收窄**去近似：
 *
 *   y ∈ [10/16, 1]     整格宽      碗口外沿（顶面那张贴图上就是"洞里一个洞"）
 *   y ∈ [ 8/16, 10/16] 内缩 2/16   第一级斜面
 *   y ∈ [ 6/16,  8/16] 内缩 4/16   第二级斜面
 *   y ∈ [ 0,     6/16] 4/16 见方   管子：朝下时居中，朝水平方向时**贴到那一侧**
 *
 * 碰撞**只算前三段**（从 6/16 往上）：管子不挡路，所以能从漏斗底下走过去。
 * 这也解释了为什么它比"整格方块"矮——玩家走上去不用跳（与台阶同一个手感）。
 */
const HOPPER_BOWL: LocalBox = [0, 0.625, 0, 1, 1, 1];
const HOPPER_MID_A: LocalBox = [0.125, 0.5, 0.125, 0.875, 0.625, 0.875];
const HOPPER_MID_B: LocalBox = [0.25, 0.375, 0.25, 0.75, 0.5, 0.75];

/** 管子截面边长（4/16） */
export const HOPPER_TUBE_WIDTH = 0.25;
/** 管子顶端高度（6/16，正好接上第二级斜面的底） */
export const HOPPER_TUBE_TOP = 0.375;

/** 管子那一段的盒子：朝下居中，朝水平方向贴到对应的那一侧 */
function hopperTubeBox(state: number): LocalBox {
  const lo = 0.5 - HOPPER_TUBE_WIDTH / 2;
  const hi = 0.5 + HOPPER_TUBE_WIDTH / 2;
  const [dx, , dz] = hopperOutputOffset(hopperOutputOf(state));
  if (dx === 0 && dz === 0) return [lo, 0, lo, hi, HOPPER_TUBE_TOP, hi];
  if (dx !== 0) {
    return dx > 0
      ? [1 - HOPPER_TUBE_WIDTH, 0, lo, 1, HOPPER_TUBE_TOP, hi]
      : [0, 0, lo, HOPPER_TUBE_WIDTH, HOPPER_TUBE_TOP, hi];
  }
  return dz > 0
    ? [lo, 0, 1 - HOPPER_TUBE_WIDTH, hi, HOPPER_TUBE_TOP, 1]
    : [lo, 0, 0, hi, HOPPER_TUBE_TOP, HOPPER_TUBE_WIDTH];
}

/** 渲染盒：碗口 + 两级收窄 + 管子 */
export function hopperBoxes(state: number): readonly LocalBox[] {
  return [HOPPER_BOWL, HOPPER_MID_A, HOPPER_MID_B, hopperTubeBox(state)];
}

/**
 * 碰撞盒：只有前三段。
 *
 * 与渲染盒分开是为了"能从漏斗底下穿过去"——与绊线/藤蔓那种"渲染有、碰撞没有"
 * 同一个方向，只是这里**部分**不挡路。
 */
export function hopperCollisionBoxes(): readonly LocalBox[] {
  return [HOPPER_BOWL, HOPPER_MID_A, HOPPER_MID_B];
}

/**
 * 投掷器（批次 59）：一个铁壳正方体 + **朝向那一面的小凸口**。
 *
 * 为什么要有那个凸口：投掷器的朝向是它唯一的"状态信息"，而本项目的网格化器
 * 按**面朝向**取贴图（顶/底/侧三张，见 `emitFace`），没有"某一面单独用另一张"的能力
 * （活塞、观察者也是同一个取舍）。于是朝向只能靠**几何轮廓**表示：
 * 凸口伸出去的那 2/16 从侧面看就是"嘴朝哪边"。
 *
 * ⚠️ 凸口**里外各 2/16**（不是从铁壳表面长出来）：起点刻意缩进铁壳内部，
 * 否则它的里侧那一面与铁壳的外表面**共面**，会 z-fighting 闪烁。
 *
 * 碰撞是**整格**（原版投掷器也是整格碰撞）：凸口只有 2/16，玩家撞不到它，
 * 所以碰撞与渲染在这里**刻意不同源**——与漏斗（管子不挡路）是同一个方向，
 * 只是漏斗是"渲染有、碰撞没有"，这里是"渲染比碰撞多出来一小块"。
 */
const DROPPER_NOZZLE_WIDTH = 0.25;
const DROPPER_NOZZLE_DEPTH = 0.125;

/** 凸口那一段：朝上/朝下时在格子的上/下边，朝水平方向时贴到对应的那一侧 */
function dropperNozzleBox(state: number): LocalBox {
  const lo = 0.5 - DROPPER_NOZZLE_WIDTH / 2;
  const hi = 0.5 + DROPPER_NOZZLE_WIDTH / 2;
  const [dx, dy, dz] = sixFacingOffset(sixFacingOf(state));
  if (dy > 0) return [lo, 1 - DROPPER_NOZZLE_DEPTH, lo, hi, 1 + DROPPER_NOZZLE_DEPTH, hi];
  if (dy < 0) return [lo, -DROPPER_NOZZLE_DEPTH, lo, hi, DROPPER_NOZZLE_DEPTH, hi];
  if (dx > 0) return [1 - DROPPER_NOZZLE_DEPTH, lo, lo, 1 + DROPPER_NOZZLE_DEPTH, hi, hi];
  if (dx < 0) return [-DROPPER_NOZZLE_DEPTH, lo, lo, DROPPER_NOZZLE_DEPTH, hi, hi];
  if (dz > 0) return [lo, lo, 1 - DROPPER_NOZZLE_DEPTH, hi, hi, 1 + DROPPER_NOZZLE_DEPTH];
  return [lo, lo, -DROPPER_NOZZLE_DEPTH, hi, hi, DROPPER_NOZZLE_DEPTH];
}

/** 渲染盒：整格铁壳 + 凸口（凸口里外各伸 2/16） */
export function dropperBoxes(state: number): readonly LocalBox[] {
  return [FULL, dropperNozzleBox(state)];
}

/** 发射器那块挡板：比投掷器的细管**宽一倍、扁一半**（7/16 见方、1/16 厚） */
const DISPENSER_PLATE_WIDTH = 0.4375;
const DISPENSER_PLATE_DEPTH = 0.0625;

/** 发射器朝那一面伸出的挡板（里外各伸 1/16） */
export function dispenserPlateBox(state: number): LocalBox {
  const lo = 0.5 - DISPENSER_PLATE_WIDTH / 2;
  const hi = 0.5 + DISPENSER_PLATE_WIDTH / 2;
  const [dx, dy, dz] = sixFacingOffset(sixFacingOf(state));
  if (dy > 0) return [lo, 1 - DISPENSER_PLATE_DEPTH, lo, hi, 1 + DISPENSER_PLATE_DEPTH, hi];
  if (dy < 0) return [lo, -DISPENSER_PLATE_DEPTH, lo, hi, DISPENSER_PLATE_DEPTH, hi];
  if (dx > 0) return [1 - DISPENSER_PLATE_DEPTH, lo, lo, 1 + DISPENSER_PLATE_DEPTH, hi, hi];
  if (dx < 0) return [-DISPENSER_PLATE_DEPTH, lo, lo, DISPENSER_PLATE_DEPTH, hi, hi];
  if (dz > 0) return [lo, lo, 1 - DISPENSER_PLATE_DEPTH, hi, hi, 1 + DISPENSER_PLATE_DEPTH];
  return [lo, lo, -DISPENSER_PLATE_DEPTH, hi, hi, DISPENSER_PLATE_DEPTH];
}

/** 渲染盒：整格铁壳 + 挡板 */
export function dispenserBoxes(state: number): readonly LocalBox[] {
  return [FULL, dispenserPlateBox(state)];
}

/**
 * 脚手架的连接判定（批次 53）：**只与脚手架相连**。
 *
 * 与栅栏/玻璃板不同：脚手架不会"挂在墙边"（原版也一样），
 * 所以这里不看实心方块，只看对面是不是脚手架。
 */
export function canScaffoldConnectTo(neighborId: number): boolean {
  return neighborId !== 0 && blockDef(neighborId).shape === 'scaffolding';
}
