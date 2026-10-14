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
  | 'torch'
  | 'ladder';

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
 * 台阶的"双层"标记（bit6）。
 *
 * 原版把上下两块台阶合并后变成独立的 double_slab 方块；这里改成**同一方块加一个状态位**，
 * 好处是不用为 12 种台阶各加一个方块 id，网格化与碰撞只需判断这一位就能输出整格。
 * 破坏时按 2 个台阶掉落（见 blocks.ts 的掉落表）。
 */
const SLAB_DOUBLE_MASK = 0b1000000;

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
    default:
      return '';
  }
}

const FACING_NAMES = ['北', '东', '南', '西'] as const;
