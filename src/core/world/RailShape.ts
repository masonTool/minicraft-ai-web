/**
 * 铁轨的形状（批次 478 弯道 / 481 坡道，G12）
 *
 * 原版铁轨有 10 种形状（直/弯/坡 × 朝向）。这里全部做了：
 * 2 条直轨（南北 / 东西）+ 4 个弯（东南 / 西南 / 东北 / 西北）+ 4 条坡道。
 *
 * 状态编码：**bit0-2 放低 3 位、bit4 放第 4 位**。
 *  - `flat`/`rail` 这个形状是铁轨 / 红石粉 / 压力板 / 地毯共用的，而**按族复用状态位**
 *    是本项目的老规矩；红石粉用 bit0-3 存强度，但它与铁轨不会出现在同一格；
 *  - **bit3 是 `powered`**（动力/探测/激活铁轨用它），所以形状的高位只能放 bit4；
 *  - 老存档里直轨的 state 是 0 → 读成"南北向直轨"，与改造前的渲染完全一致。
 */

/** 铁轨的十种形状：6 种平面 + 4 种坡道 */
export type RailShape =
  | 'north_south'
  | 'east_west'
  | 'south_east'
  | 'south_west'
  | 'north_east'
  | 'north_west'
  | 'ascending_north'
  | 'ascending_south'
  | 'ascending_east'
  | 'ascending_west';

/** 按状态位里的编号排列（顺序就是写进状态的数字，改动会让老存档错位） */
export const RAIL_SHAPES: readonly RailShape[] = [
  'north_south',
  'east_west',
  'south_east',
  'south_west',
  'north_east',
  'north_west',
  'ascending_north',
  'ascending_south',
  'ascending_east',
  'ascending_west',
];

/** 形状编码的低三位 */
const RAIL_SHAPE_LOW_MASK = 0b111;
/** 形状编码的第四位（bit4；bit3 是 powered） */
const RAIL_SHAPE_HIGH_BIT = 0b10000;
const RAIL_SHAPE_MASK = RAIL_SHAPE_LOW_MASK | RAIL_SHAPE_HIGH_BIT;

/** 每种形状的编号（写状态用） */
export const RAIL_SHAPE_INDEX: Readonly<Record<RailShape, number>> = {
  north_south: 0,
  east_west: 1,
  south_east: 2,
  south_west: 3,
  north_east: 4,
  north_west: 5,
  ascending_north: 6,
  ascending_south: 7,
  ascending_east: 8,
  ascending_west: 9,
};

/** 状态位 → 形状（越界读成南北向，与默认值一致） */
export function railShapeOf(state: number): RailShape {
  const index = (state & RAIL_SHAPE_LOW_MASK) | (((state & RAIL_SHAPE_HIGH_BIT) >> 4) << 3);
  return RAIL_SHAPES[index] ?? 'north_south';
}

/** 改形状；只动 bit0-2 与 bit4，`powered`（bit3）原样保留 */
export function withRailShape(state: number, shape: RailShape): number {
  const index = RAIL_SHAPE_INDEX[shape];
  return (state & ~RAIL_SHAPE_MASK) | (index & RAIL_SHAPE_LOW_MASK) | (((index >> 3) & 1) << 4);
}

/** 一条边的方向（弯道的两条边、坡道的抬升方向都用它） */
export interface RailDirection {
  readonly dx: number;
  readonly dz: number;
}

const NORTH: RailDirection = { dx: 0, dz: -1 };
const SOUTH: RailDirection = { dx: 0, dz: 1 };
const EAST: RailDirection = { dx: 1, dz: 0 };
const WEST: RailDirection = { dx: -1, dz: 0 };

/** 这一种是不是坡道（两端不在同一高度） */
export function isSlopeRail(shape: RailShape): boolean {
  return shape.startsWith('ascending_');
}

/**
 * 坡道**抬升的方向**（朝哪一端升高）；平面形状返回 null。
 *
 * `ascending_north` = 北端高一格，所以沿 -z 走是上坡。
 */
export function railRiseDirection(shape: RailShape): RailDirection | null {
  switch (shape) {
    case 'ascending_north':
      return NORTH;
    case 'ascending_south':
      return SOUTH;
    case 'ascending_east':
      return EAST;
    case 'ascending_west':
      return WEST;
    default:
      return null;
  }
}

/** 形状 → 它连接的边（直轨两个相对、弯道两个相邻、坡道沿抬升轴） */
export function railDirections(shape: RailShape): readonly [RailDirection, RailDirection] {
  switch (shape) {
    case 'ascending_north':
    case 'ascending_south':
      return [NORTH, SOUTH];
    case 'ascending_east':
    case 'ascending_west':
      return [EAST, WEST];
    case 'north_south':
      return [NORTH, SOUTH];
    case 'east_west':
      return [EAST, WEST];
    case 'south_east':
      return [SOUTH, EAST];
    case 'south_west':
      return [SOUTH, WEST];
    case 'north_east':
      return [NORTH, EAST];
    default:
      return [NORTH, WEST];
  }
}

/** 直轨返回 true（矿车在直轨与坡道上都不做"拐弯"，坡道只做爬升） */
export function isStraightRail(shape: RailShape): boolean {
  return shape === 'north_south' || shape === 'east_west' || isSlopeRail(shape);
}

/** 放置时的四邻连接情况（由调用方按邻居是否是铁轨填） */
export interface RailConnections {
  readonly north: boolean;
  readonly south: boolean;
  readonly east: boolean;
  readonly west: boolean;
}

/**
 * 按四邻连接决定放下去用哪种形状（原版的自动连接规则，简化版）。
 *
 * 优先级：
 *  1. 只有**一个**连接（或没有）→ 沿玩家的水平朝向铺直轨
 *     （原版是"沿你面朝的方向"，因为玩家铺轨时几乎总是朝前铺）；
 *  2. **两个相对**的连接 → 直轨（南北或东西）；
 *  3. **两个相邻**的连接 → 弯道；
 *  4. 三个以上 → 取"南北"或"东西"里与玩家朝向一致的那条（十字路口原版也没有，
 *     真接成四通时取一条直轨，玩家再放一格就能改出来）。
 */
export function pickRailShape(connections: RailConnections, playerAxis: 'x' | 'z'): RailShape {
  const { north, south, east, west } = connections;
  const vertical = north || south;
  const horizontal = east || west;

  // 三个以上连接（十字/丁字路口）：原版也没有十字轨，退回沿玩家朝向的直轨。
  // ⚠️ 这一段必须放在最前面：下面"相邻两个 → 弯道"会把 (北+东) 判成弯道，
  // 而四邻全有时它同样成立（第一版就是这么红的）
  const count = (north ? 1 : 0) + (south ? 1 : 0) + (east ? 1 : 0) + (west ? 1 : 0);
  if (count >= 3) return playerAxis === 'x' ? 'east_west' : 'north_south';

  // 相邻的两个连接 → 弯道（先判这个：弯道比直轨更"具体"）
  if (north && east) return 'north_east';
  if (north && west) return 'north_west';
  if (south && east) return 'south_east';
  if (south && west) return 'south_west';

  // 相对的两个连接 → 直轨
  if (north && south) return 'north_south';
  if (east && west) return 'east_west';

  // 只有一个（或零个）：沿玩家朝向
  if (vertical && !horizontal) return 'north_south';
  if (horizontal && !vertical) return 'east_west';
  return playerAxis === 'x' ? 'east_west' : 'north_south';
}

/**
 * 放置时要不要铺成坡道（批次 481）。
 *
 * 判据是原版那条：**沿某一侧的地面比这一格高一格**（高一格 = 那一列的方块顶面
 * 正好高 1）——这时铺坡道，矿车才能爬上去；铺平轨的话车会撞在台阶上停下。
 *
 * @param highSide 哪一侧的地面高一格（由调用方按方块查询算出来）
 * @param playerAxis 都没有高差时用不到，只用来保持一致的行为
 */
export function pickRailSlope(
  highSide: { north: boolean; south: boolean; east: boolean; west: boolean },
  playerAxis: 'x' | 'z',
): RailShape | null {
  const { north, south, east, west } = highSide;
  // 同一轴两侧都高（夹在沟里）→ 不做坡道（原版也只认一侧）
  if (north && !south) return 'ascending_north';
  if (south && !north) return 'ascending_south';
  if (east && !west) return 'ascending_east';
  if (west && !east) return 'ascending_west';
  void playerAxis;
  return null;
}

/**
 * 弯道上"从某一侧进来之后往哪边走"（矿车转向用）。
 *
 * @param shape 弯道形状
 * @param inDx 进入速度的方向（不必归一化，只用来定"从哪条边进来"）
 * @returns 出弯的方向（单位向量）；直轨/坡道返回 null（不需要拐弯）
 */
export function railExitDirection(shape: RailShape, inDx: number, inDz: number): RailDirection | null {
  if (isStraightRail(shape)) return null;
  const [first, second] = railDirections(shape);
  // 进弯的那条边：与进入方向**同向**（点积最大）的那条
  const dotFirst = first.dx * inDx + first.dz * inDz;
  const dotSecond = second.dx * inDx + second.dz * inDz;
  // 进来时速度是"朝格内"，而边的方向是"从格心朝边界"，所以进弯边 = 点积**相反**的那条。
  // 换句话说：出弯边就是点积**为正**的那条（与进入方向同向的那条边是出口）
  return dotFirst >= dotSecond ? first : second;
}

/**
 * 坡道上"这一格内的相对高度"（0 = 低端、1 = 高端）。
 *
 * @param shape 坡道形状
 * @param localX 格内局部坐标（0~1）
 * @param localZ 格内局部坐标（0~1）
 */
export function railSlopeHeight(shape: RailShape, localX: number, localZ: number): number {
  const rise = railRiseDirection(shape);
  if (!rise) return 0;
  // 沿抬升方向投影：低端是 0、高端是 1
  const t = rise.dx > 0 ? localX : rise.dx < 0 ? 1 - localX : rise.dz > 0 ? localZ : 1 - localZ;
  return Math.max(0, Math.min(1, t));
}
