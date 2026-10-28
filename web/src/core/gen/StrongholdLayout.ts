/**
 * 要塞的拼图布局（批次 462）
 *
 * 原来的要塞是"一条 44 格主走廊 + 图书馆 + 喷泉房 + 传送门房"这几件**写死**的
 * 建筑：每次进去都是同一个形状，玩家第二座要塞就认得路了。
 *
 * 这一版换成**房间网格**：节点落在 12 格网格上，相邻房间之间铺走廊；
 *
 *  - 房间种类：`corridor`（3×3 小节点）/ `crossing`（5×5 十字口）/
 *    `library`（11×11，书架 + 蠹虫刷怪笼 + 2 只箱子）/ `fountain`（9×9 水池）/
 *    `cell`（7×7 牢房）/ `portal`（11×11，末地传送门房）；
 *  - **传送门房永远在离入口最远的叶节点上**（原版也是"要塞最深处"），
 *    所以玩家越往里走越接近目标；
 *  - 房间**只占一次**（网格 Set）→ 不会互相重叠；广度优先扩展 → 全部连通。
 *
 * 半径预算：12 格间距 × ±3 格 = ±36，加上房间半宽 5 = 41，正好在结构包围盒
 * （radius 40）与 `height` 之内——所以网格不能铺得更大，房间数上限也就 7 个。
 *
 * 该模块是纯函数（只吃坐标 + 随机源），跨区块重放逐格一致。
 */

/** 房间之间的网格间距（格） */
export const STRONGHOLD_CELL = 12;

export type StrongholdRoomKind = 'corridor' | 'crossing' | 'library' | 'fountain' | 'cell' | 'portal';

/** 每种房间的占地半宽（画法与不重叠判据都用它） */
export const STRONGHOLD_ROOM_HALF: Readonly<Record<StrongholdRoomKind, number>> = {
  corridor: 1,
  crossing: 2,
  library: 5,
  fountain: 4,
  cell: 3,
  portal: 5,
};

/** 房间朝向：0 = +X、1 = -X、2 = +Z、3 = -Z（走廊边用） */
export type StrongholdDirection = 0 | 1 | 2 | 3;

export interface StrongholdRoom {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: StrongholdRoomKind;
  /** BFS 深度（起点 = 0）：传送门房取最深的那个 */
  readonly depth: number;
}

export interface StrongholdLink {
  /** 起点（父房间中心） */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dir: StrongholdDirection;
  /** 长度（格）：父中心到子中心 */
  readonly length: number;
}

export interface StrongholdPlan {
  readonly rooms: readonly StrongholdRoom[];
  readonly links: readonly StrongholdLink[];
}

export interface StrongholdLayoutOptions {
  /** 房间总数（含起点与传送门房；5~7，见文件头的半径预算） */
  readonly target: number;
  /** 半径上限（默认 36：结构 radius 40 留出房间半宽） */
  readonly maxRadius?: number;
  /**
   * 要不要生成传送门房（批次 521：下层不放传送门）。
   *
   * 一座要塞只能有一个末地传送门；第二层只提供图书馆/喷泉/牢房这些"往下探索"的内容，
   * 免得玩家在两层各找到一个传送门。
   */
  readonly includePortal?: boolean;
}

const DIRECTIONS: readonly { dx: number; dz: number; dir: StrongholdDirection }[] = [
  { dx: 1, dz: 0, dir: 0 },
  { dx: -1, dz: 0, dir: 1 },
  { dx: 0, dz: 1, dir: 2 },
  { dx: 0, dz: -1, dir: 3 },
];

/**
 * 排一份要塞布局。
 *
 * @param rng 0~1 的随机源（纯函数：同样的输入必须得到同样的布局）
 */
export function planStronghold(
  originX: number,
  originY: number,
  originZ: number,
  rng: () => number,
  options: StrongholdLayoutOptions,
): StrongholdPlan {
  const maxRadius = options.maxRadius ?? 36;
  const target = Math.max(3, options.target);

  const rooms: StrongholdRoom[] = [];
  const links: StrongholdLink[] = [];
  const occupied = new Set<string>(['0,0']);

  const posOf = (cx: number, cz: number): { x: number; z: number; dist: number } => ({
    x: originX + cx * STRONGHOLD_CELL,
    z: originZ + cz * STRONGHOLD_CELL,
    dist: Math.hypot(cx * STRONGHOLD_CELL, cz * STRONGHOLD_CELL),
  });

  const start = posOf(0, 0);
  rooms.push({ x: start.x, y: originY, z: start.z, kind: 'corridor', depth: 0 });

  const frontier: Array<{ cx: number; cz: number; x: number; z: number; depth: number }> = [
    { cx: 0, cz: 0, x: start.x, z: start.z, depth: 0 },
  ];
  let attempts = 0;

  while (rooms.length < target && frontier.length > 0 && attempts < 300) {
    attempts++;
    const index = Math.floor(rng() * frontier.length);
    const current = frontier[index]!;
    let branches = 0;
    // Fisher-Yates（不用 `sort(随机比较器)`：依赖引擎排序实现）
    const order = [0, 1, 2, 3];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    for (const dirIndex of order) {
      if (branches >= 1 || rooms.length >= target) break;
      const dir = DIRECTIONS[dirIndex]!;
      if (rng() > 0.6) continue;
      const ncx = current.cx + dir.dx;
      const ncz = current.cz + dir.dz;
      const key = `${ncx},${ncz}`;
      if (occupied.has(key)) continue;
      const next = posOf(ncx, ncz);
      if (next.dist > maxRadius) continue;

      occupied.add(key);
      branches++;
      // 先把类型占位成 crossing，最后统一分配特殊房间（见下）
      rooms.push({ x: next.x, y: originY, z: next.z, kind: 'crossing', depth: current.depth + 1 });
      links.push({ x: current.x, y: originY, z: current.z, dir: dir.dir, length: STRONGHOLD_CELL });
      frontier.push({ cx: ncx, cz: ncz, x: next.x, z: next.z, depth: current.depth + 1 });
    }
    if (branches === 0) frontier.splice(index, 1);
  }

  // ---- 特殊房间分配（确定性：按房间序号，不额外吃随机数，
  //      这样"改一句话不会让整座要塞的形状全变"）
  const assign = (index: number, kind: StrongholdRoomKind): void => {
    rooms[index] = { ...rooms[index]!, kind };
  };
  // 传送门房：最深的那个房间（并列取序号大的，结果稳定）
  const includePortal = options.includePortal !== false;
  let portalIndex = includePortal ? rooms.length - 1 : -1;
  if (includePortal) {
    for (let i = 1; i < rooms.length; i++) {
      if (rooms[i]!.depth >= rooms[portalIndex]!.depth) portalIndex = i;
    }
    assign(portalIndex, 'portal');
  }
  // 图书馆 / 喷泉房 / 牢房：按序号取（跳过起点与传送门房）
  const specials: StrongholdRoomKind[] = ['library', 'fountain', 'cell'];
  let special = 0;
  for (let i = 1; i < rooms.length && special < specials.length; i++) {
    if (i === portalIndex) continue;
    if (rooms[i]!.kind !== 'crossing') continue;
    assign(i, specials[special]!);
    special++;
  }

  return { rooms, links };
}

/** 某个房间的占地半宽（画法与"能否放下"共用） */
export function roomHalf(kind: StrongholdRoomKind): number {
  return STRONGHOLD_ROOM_HALF[kind];
}
