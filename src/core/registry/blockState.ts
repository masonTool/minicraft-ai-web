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
  /**
   * 睡莲（B16）：水面上的薄叶片，渲染成贴在水面的 1/16 薄板。
   *
   * ⚠️ 与 `flat` 的唯一差别是**有碰撞**：原版是能站在睡莲上的（还能踩着一路过河），
   * 而红石粉/压力板那批是"不挡路"的。形状分开是为了让碰撞由形状驱动，
   * 而不是在物理里特判"这个方块是不是睡莲"。
   */
  | 'lily_pad'
  /**
   * 雪层（B11）：1~8 层，高度 = 层数/8，**层数存在方块状态里**。
   *
   * 与 `slab` 的区别不只是"能叠 8 层"：雪层是**同一格越叠越高**（不是上下半）。
   * 它占的 3 个状态位（bit5-7）与门的"上半格"、台阶的"双层"重合——
   * 沿用本文件开头那条设计：不同形状族不会出现在同一个方块上，所以可以共用位。
   *
   * 为什么"一个方块 + 状态位"，而不是像小麦那样"一个阶段一个 id"：
   * 小麦的贴图按 id 静态查（`blockDef(id).tiles`），而雪层 8 个阶段**共用同一张贴图**，
   * 变的只有几何高度——而几何本来就吃状态（`meshBoxes(shape, state)`）。
   */
  | 'snow'
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

// ---------------------------------------------------------------- 箱子（结构战利品）

/**
 * 箱子装着哪张战利品表（bits 4-7，0 = 没有表 = 玩家自己放的箱子）。
 *
 * 为什么把"表序号"塞进方块状态，而不是另外传一份"箱子 → 表"的清单：
 *  1. 方块状态**本来就会**跟着区块数据从 Worker 传过来、也会进增量存档，
 *     另开一条通道要同时改 Worker 协议 + 存档格式 + 加载流程，三处都可能漏；
 *  2. 结构生成（Worker 里）只需要知道"这一格放哪张表"，不需要碰容器；
 *     容器在主线程按需创建（`LootFill.ts`），跨线程不需要传物品数组。
 *
 * 箱子当前不使用低位（朝向/开关都没做），所以 bits 4-7 是干净的。
 * ⚠️ 以后要是给箱子加上 facing，务必避开这四位。
 */
const CHEST_LOOT_SHIFT = 4;
const CHEST_LOOT_MASK = 0b1111 << CHEST_LOOT_SHIFT;

/** 箱子带的战利品表序号（0 = 没有） */
export function chestLootIndex(state: number): number {
  return (state & CHEST_LOOT_MASK) >> CHEST_LOOT_SHIFT;
}

export function withChestLoot(state: number, index: number): number {
  const clamped = Math.max(0, Math.min(15, index | 0));
  return (state & ~CHEST_LOOT_MASK) | (clamped << CHEST_LOOT_SHIFT);
}

// ---------------------------------------------------------------- 雪层（B11）

/**
 * 雪层的层数占 bit5-7（与门的"上半格"、台阶的"双层"共用位，见文件开头的说明）。
 * 存的是 **层数 - 1**：0 表示 1 层（刚放下的那一格），7 表示 8 层（满格高度）。
 */
const SNOW_LAYERS_SHIFT = 5;
const SNOW_LAYERS_MASK = 0b111 << SNOW_LAYERS_SHIFT;

/** 雪层最多 8 层（原版），8 层时高度正好是整格 */
export const MAX_SNOW_LAYERS = 8;

/** 雪层有几层（1~8；状态里存的是层数-1，所以这里要 +1） */
export function snowLayers(state: number): number {
  return ((state & SNOW_LAYERS_MASK) >> SNOW_LAYERS_SHIFT) + 1;
}

/** 设置雪层数（自动夹紧到 1~8） */
export function withSnowLayers(state: number, layers: number): number {
  const clamped = Math.max(1, Math.min(MAX_SNOW_LAYERS, Math.round(layers)));
  return (state & ~SNOW_LAYERS_MASK) | ((clamped - 1) << SNOW_LAYERS_SHIFT);
}

/** 雪层的渲染/碰撞高度（层数 / 8） */
export function snowHeight(state: number): number {
  return snowLayers(state) / MAX_SNOW_LAYERS;
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
    case 'snow':
      return `${snowLayers(state)} 层`;
    default:
      return '';
  }
}

const FACING_NAMES = ['北', '东', '南', '西'] as const;
