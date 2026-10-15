/**
 * 方块状态
 *
 * 原版每个方块位置除了方块 id 还存一份"状态"（朝向、上下半、开关等）。
 * 这里用一字节表示，位布局按方块形状族分配（不同族只用自己的位，互不冲突）：
 *
 *   bit0      所有族通用：TOP（上半砖 / 楼梯的上半 / 门的……）
 *   bit1-2    FACING（朝向 0=北 -Z、1=东 +X、2=南 +Z、3=西 -X）
 *   bit3      火把：是否挂在墙上（WALL_MOUNT）；门：是否打开（OPEN）
 *   bit4      门：门轴在左/右（HINGE）
 *   bit5      门：是否为上半（UPPER）
 *
 * 栅栏与墙的"连接方向"**不存状态**，而是在网格化/碰撞查询时按邻居实时计算——
 * 这样放一个邻居方块后，栅栏会自动长出新的一节，不需要额外的状态同步逻辑。
 */

/** 朝向：0=北(-Z)、1=东(+X)、2=南(+Z)、3=西(-X) */
export type Facing = 0 | 1 | 2 | 3;

/** 方块的几何形状族 */
export type BlockShape =
  | 'cube'
  | 'slab'
  | 'stairs'
  | 'fence'
  | 'wall'
  | 'door'
  /** 活板门：一块薄板，关时贴地/贴顶、开时竖起来贴在朝向那一侧 */
  | 'trapdoor'
  /** 栅栏门：两根柱子 + 一块可开关的门板，关着时挡路、开着时中间能走过去 */
  | 'fence_gate'
  | 'torch'
  | 'ladder'
  | 'pane'
  /** 十字交叉的两片薄面：草、花、蘑菇、甘蔗这类植物（无碰撞、双面可见） */
  | 'cross'
  /** 仙人掌：四面向内缩 1 像素，且不遮挡邻居（否则贴着的方块会被剔除掉一面） */
  | 'cactus'
  /**
   * 贴地的薄板（红石粉 / 中继器 / 比较器 / 按钮 / 压力板）。
   * 渲染成 1/16 高的一层，**无碰撞**：原版这些方块也确实不挡路（压力板能踩上去）。
   */
  | 'flat'
  /** 流体（水/岩浆）：渲染高度随液面等级变化，无碰撞 */
  | 'fluid';

/** 朝向对应的水平偏移（与 Facing 一一对应） */
export const FACING_OFFSET: readonly (readonly [number, number])[] = [
  [0, -1], // 北
  [1, 0], // 东
  [0, 1], // 南
  [-1, 0], // 西
];

const FACING_MASK = 0b110;
const TOP_MASK = 0b1;
const WALL_MOUNT_MASK = 0b1000;
const DOOR_OPEN_MASK = 0b1000;
const DOOR_HINGE_MASK = 0b10000;
const DOOR_UPPER_MASK = 0b100000;
/**
 * 通用"通电 / 按下 / 开关"标记（bit3）。
 *
 * 与门的 OPEN、火把的 WALL_MOUNT **共用同一位**：它们属于不同的形状族，
 * 同一个方块只会是其中一种，因此不需要各占一位。
 * 红石系统统一用它表示"这个元件当前是否被激活"。
 */
const POWERED_MASK = 0b1000;

/**
 * 台阶的"双层"标记（bit6）。
 *
 * 原版把上下两块台阶合并后变成独立的 double_slab 方块；这里改成**同一方块加一个状态位**，
 * 好处是不用为 12 种台阶各加一个方块 id，网格化与碰撞只需判断这一位就能输出整格。
 * 破坏时按 2 个台阶掉落（见 blocks.ts 的掉落表）。
 */
const SLAB_DOUBLE_MASK = 0b1000000;

// ---------------------------------------------------------------- 流体
//
// 流体独占整格，因此低位可以随便用：
//   低 3 位 = 液面等级（0 = 水源，1~7 越流越薄）
//   第 4 位   = "下落"标记（上方是同一液体，这一格是瀑布的一节）
const FLUID_LEVEL_MASK = 0b111;
const FLUID_FALLING_MASK = 0b1000;

/** 液面等级 */
export function fluidLevel(state: number): number {
  return state & FLUID_LEVEL_MASK;
}

export function withFluidLevel(state: number, level: number): number {
  return (state & ~FLUID_LEVEL_MASK) | (level & FLUID_LEVEL_MASK);
}

export function isFallingFluid(state: number): boolean {
  return (state & FLUID_FALLING_MASK) !== 0;
}

export function withFallingFluid(state: number, falling = true): number {
  return falling ? state | FLUID_FALLING_MASK : state & ~FLUID_FALLING_MASK;
}

/**
 * 流体的渲染高度（0~1）。
 *
 * ⚠️ **水源与下落液体保持满格**，只有"流动中"的液体才变薄。
 * 原版水源其实是 14/16 格高，但那样会让海洋里每一格水都退化成独立的面，
 * 贪心网格化再也合并不了（实测三角形从 100% 涨到 175%）。
 * 换来的收益只是水面低 1 像素，不划算——把"能看出液面高度"这件事
 * 留给真正有意义的流动水。
 */
export function fluidHeight(state: number): number {
  if (isFallingFluid(state)) return 1;
  const level = fluidLevel(state);
  if (level === 0) return 1;
  return Math.max(0.15, 0.9 - level * 0.1);
}

export const DEFAULT_STATE = 0;

// ---------------------------------------------------------------- 朝向 / 上下半（通用）

export function facingOf(state: number): Facing {
  return ((state & FACING_MASK) >> 1) as Facing;
}

export function withFacing(state: number, facing: Facing): number {
  return (state & ~FACING_MASK) | ((facing << 1) & FACING_MASK);
}

export function isTop(state: number): boolean {
  return (state & TOP_MASK) !== 0;
}

export function withTop(state: number, top: boolean): number {
  return top ? state | TOP_MASK : state & ~TOP_MASK;
}

/** 由玩家水平朝向推方块朝向（原版放置时取玩家面朝的相反方向） */
export function facingFromYaw(yaw: number): Facing {
  // yaw=0 → 看向 -Z（北）。换算成 0-3 并取反方向。
  const index = Math.round(-yaw / (Math.PI / 2)) & 3;
  return ((index + 2) & 3) as Facing;
}

// ---------------------------------------------------------------- 台阶双层

export function isSlabDouble(state: number): boolean {
  return (state & SLAB_DOUBLE_MASK) !== 0;
}

export function withSlabDouble(state: number, doubled: boolean): number {
  return doubled ? state | SLAB_DOUBLE_MASK : state & ~SLAB_DOUBLE_MASK;
}

// ---------------------------------------------------------------- 火把

export function isWallMounted(state: number): boolean {
  return (state & WALL_MOUNT_MASK) !== 0;
}

export function withWallMounted(state: number, mounted: boolean): number {
  return mounted ? state | WALL_MOUNT_MASK : state & ~WALL_MOUNT_MASK;
}

// ---------------------------------------------------------------- 红石元件

/** 元件是否处于激活态（拉杆开、按钮按下、压力板被踩、红石灯亮、活塞伸出） */
export function isPowered(state: number): boolean {
  return (state & POWERED_MASK) !== 0;
}

export function withPowered(state: number, powered: boolean): number {
  return powered ? state | POWERED_MASK : state & ~POWERED_MASK;
}

/**
 * 中继器 / 比较器的延迟档位（0~3 → 1~4 红石刻，1 红石刻 = 0.1 秒）。
 * 占 bit4-5：再往下 bit6 是台阶双层、bit7 空闲。
 */
const DELAY_MASK = 0b110000;

export function delayOf(state: number): number {
  return (state & DELAY_MASK) >> 4;
}

export function withDelay(state: number, delay: number): number {
  return (state & ~DELAY_MASK) | ((delay & 0b11) << 4);
}

// ---------------------------------------------------------------- 门

export function isDoorOpen(state: number): boolean {
  return (state & DOOR_OPEN_MASK) !== 0;
}

export function withDoorOpen(state: number, open: boolean): number {
  return open ? state | DOOR_OPEN_MASK : state & ~DOOR_OPEN_MASK;
}

export function doorHinge(state: number): 0 | 1 {
  return ((state & DOOR_HINGE_MASK) >> 4) as 0 | 1;
}

export function withDoorHinge(state: number, hinge: 0 | 1): number {
  return (state & ~DOOR_HINGE_MASK) | (hinge << 4);
}

export function isDoorUpper(state: number): boolean {
  return (state & DOOR_UPPER_MASK) !== 0;
}

export function withDoorUpper(state: number, upper: boolean): number {
  return upper ? state | DOOR_UPPER_MASK : state & ~DOOR_UPPER_MASK;
}

// ---------------------------------------------------------------- 活板门 / 栅栏门
//
// 两者各只需要"朝向 + 开关"，而开关与门的 OPEN **共用同一位**——
// 沿用本文件开头那条既有设计（不同形状族不会同时出现在一个方块上，所以不必各占一位）。
// 仍然给它们各自的取名函数：调用处写 `isTrapdoorOpen(state)` 比 `isDoorOpen(state)` 诚实，
// 也让"门"与"活板门"的代码在搜索时不会互相误伤。

/** 活板门是不是开着（竖起来贴着侧面） */
export function isTrapdoorOpen(state: number): boolean {
  return isDoorOpen(state);
}

export function withTrapdoorOpen(state: number, open: boolean): number {
  return withDoorOpen(state, open);
}

/** 栅栏门是不是开着 */
export function isFenceGateOpen(state: number): boolean {
  return isDoorOpen(state);
}

export function withFenceGateOpen(state: number, open: boolean): number {
  return withDoorOpen(state, open);
}

// ---------------------------------------------------------------- 下界传送门

/**
 * 下界传送门的门面沿哪个水平轴（原版的 `HORIZONTAL_AXIS`）。
 *
 * 与 POWERED / OPEN / WALL_MOUNT 共用 bit3——沿用本文件开头那条既有设计。
 * 这一位只有两处用得上，但两处都离不开它：
 *  1. 传出/传入时要知道往哪个方向把玩家推出去（垂直于门面）
 *  2. 在目的地新建门时要尽量与原门的朝向一致（免得"从东西向的门进去、从南北向的门出来"）
 */
const PORTAL_AXIS_Z_MASK = 0b1000;

/** 门面是否沿 Z 轴展开（false = 沿 X 轴展开，即门面法线是 Z） */
export function portalAxisIsZ(state: number): boolean {
  return (state & PORTAL_AXIS_Z_MASK) !== 0;
}

export function withPortalAxis(state: number, axisZ: boolean): number {
  return axisZ ? state | PORTAL_AXIS_Z_MASK : state & ~PORTAL_AXIS_Z_MASK;
}

/** 门面沿哪个水平轴（'x' = 门面在 X 方向展开，门在 XZ 平面上是南北走向的墙） */
export function portalAxis(state: number): 'x' | 'z' {
  return portalAxisIsZ(state) ? 'z' : 'x';
}

// ---------------------------------------------------------------- 调试

export function describeState(shape: BlockShape, state: number): string {
  switch (shape) {
    case 'slab':
      return isTop(state) ? '上半' : '下半';
    case 'stairs':
      return `${FACING_NAMES[facingOf(state)]}${isTop(state) ? '·上半' : ''}`;
    case 'torch':
      return isWallMounted(state) ? `挂墙·${FACING_NAMES[facingOf(state)]}` : '落地';
    case 'ladder':
      return `贴·${FACING_NAMES[facingOf(state)]}`;
    case 'door':
      return `${FACING_NAMES[facingOf(state)]}${isDoorUpper(state) ? '·上' : '·下'}${isDoorOpen(state) ? '·开' : '·关'}`;
    case 'trapdoor':
      return `贴${FACING_NAMES[facingOf(state)]}${isTop(state) ? '·上半' : '·下半'}${isTrapdoorOpen(state) ? '·开' : '·关'}`;
    case 'fence_gate':
      return `${FACING_NAMES[facingOf(state)]}${isFenceGateOpen(state) ? '·开' : '·关'}`;
    default:
      return '';
  }
}

const FACING_NAMES = ['北', '东', '南', '西'] as const;
