/**
 * 铁轨的形状（批次 478，G12 的弯道）
 *
 * 原版铁轨有 10 种形状（直/弯/坡 × 朝向）。这一批只做**平面**的 6 种：
 * 2 条直轨（南北 / 东西）+ 4 个弯（东南 / 西南 / 东北 / 西北）；坡道还没做
 * （它要"抬升 1 格 + 与相邻格高度连续"，属于另一档）。
 *
 * 状态编码用 **bit0-2**（0~5）：
 *  - `flat` 这个形状是铁轨 / 红石粉 / 压力板 / 地毯共用的，而**按族复用状态位**
 *    是本项目的老规矩（同一位在不同方块族里有不同含义）；红石粉用 bit0-3 存强度，
 *    但它与铁轨不会出现在同一格，所以不冲突；
 *  - **bit3 是 `powered`**（动力/探测/激活铁轨用它），形状必须避开。
 *
 * 老存档里直轨的 state 是 0 → 读成"南北向直轨"，与改造前的渲染完全一致。
 */

/** 铁轨的六种平面形状 */
export type RailShape = 'north_south' | 'east_west' | 'south_east' | 'south_west' | 'north_east' | 'north_west';

/** 按状态位里的编号排列（顺序就是写进状态的数字，改动会让老存档错位） */
export const RAIL_SHAPES: readonly RailShape[] = [
  'north_south',
  'east_west',
  'south_east',
  'south_west',
  'north_east',
  'north_west',
];

const RAIL_SHAPE_MASK = 0b111;
/** 每种形状的编号（写状态用） */
export const RAIL_SHAPE_INDEX: Readonly<Record<RailShape, number>> = {
  north_south: 0,
  east_west: 1,
  south_east: 2,
  south_west: 3,
  north_east: 4,
  north_west: 5,
};

/** 状态位 → 形状（越界读成南北向，与默认值一致） */
export function railShapeOf(state: number): RailShape {
  const index = state & RAIL_SHAPE_MASK;
  return RAIL_SHAPES[index] ?? 'north_south';
}

/** 改形状；只动 bit0-2，`powered` 位原样保留 */
export function withRailShape(state: number, shape: RailShape): number {
  return (state & ~RAIL_SHAPE_MASK) | RAIL_SHAPE_INDEX[shape];
}

/** 一条边的方向（弯道的两条边就是这个表的两个元素） */
export interface RailDirection {
  readonly dx: number;
  readonly dz: number;
}

const NORTH: RailDirection = { dx: 0, dz: -1 };
const SOUTH: RailDirection = { dx: 0, dz: 1 };
const EAST: RailDirection = { dx: 1, dz: 0 };
const WEST: RailDirection = { dx: -1, dz: 0 };

/** 形状 → 它连接的边（直轨两个相对，弯道两个相邻） */
export function railDirections(shape: RailShape): readonly [RailDirection, RailDirection] {
  switch (shape) {
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

/** 直轨返回 true（矿车在直轨上不做转向） */
export function isStraightRail(shape: RailShape): boolean {
  return shape === 'north_south' || shape === 'east_west';
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
 * 弯道上"从某一侧进来之后往哪边走"（批次 479 矿车转向用）。
 *
 * @param shape 弯道形状
 * @param inDx 进入速度的方向（不必归一化，只用来定"从哪条边进来"）
 * @returns 出弯的方向（单位向量）；直轨返回 null（不需要转向）
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
