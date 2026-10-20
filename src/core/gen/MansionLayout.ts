/**
 * 林地府邸的房间布局（批次 463）
 *
 * 原来的府邸是"三层收缩的圆角盒子 + 两条十字隔墙切成四间"：形状每次一样、
 * 房间也一样（只有箱子数与楼梯位置随半径变）。
 *
 * 这一版把**内部**换成房间网格：每层独立做一次广度优先扩展，房间落在 8 格网格上，
 * 相邻房间之间铺 3 宽走廊；层间用固定的一处楼梯连接（站在 (0,0) 房间里）。
 *
 *  - 房间种类：`hall` / `study` / `bedroom` / `dining` / `library` / `prison` / `storage`；
 *  - 每层房间数不同（一层多、顶层少），半径也跟着收——外壳仍是"三层收缩"的观感；
 *  - 房间**只占一次**（网格 Set）→ 不会重叠；广度优先 → 同层全部连通；
 *  - 楼梯在每层的 (0,0) 房间，**垂直对齐**（玩家从一层爬到三层不会走丢）。
 *
 * ⚠️ 与原版的差异：原版府邸有 50+ 个房间与大量门/走廊变体，这里是 3~6 间/层；
 * 房间之间是"开口"而不是门框（门框要额外一套门洞朝向规则）。
 *
 * 该模块是纯函数（坐标 + 随机源），跨区块重放逐格一致。
 */

/** 房间之间的网格间距（格） */
export const MANSION_CELL = 8;
/** 每层的层高（格）：地板 1 + 净高 4 + 天花 1 */
export const MANSION_FLOOR_HEIGHT = 6;

export type MansionRoomKind = 'hall' | 'study' | 'bedroom' | 'dining' | 'library' | 'prison' | 'storage';

/** 每种房间的占地半宽（7×7 → 半宽 3；大厅 9×9） */
export const MANSION_ROOM_HALF: Readonly<Record<MansionRoomKind, number>> = {
  hall: 4,
  study: 3,
  bedroom: 3,
  dining: 3,
  library: 3,
  prison: 3,
  storage: 3,
};

export type MansionDirection = 0 | 1 | 2 | 3;

export interface MansionRoom {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: MansionRoomKind;
  /** 第几层（0 起） */
  readonly floor: number;
  /** 同层的 BFS 深度（起点 = 0） */
  readonly depth: number;
}

export interface MansionLink {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dir: MansionDirection;
  readonly length: number;
  readonly floor: number;
}

/** 层间楼梯：从 `y` 升到 `y + MANSION_FLOOR_HEIGHT` */
export interface MansionStair {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dir: MansionDirection;
  /** 出发楼层 */
  readonly floor: number;
}

export interface MansionPlan {
  readonly rooms: readonly MansionRoom[];
  readonly links: readonly MansionLink[];
  readonly stairs: readonly MansionStair[];
}

export interface MansionLayoutOptions {
  /** 每层房间数（长度 = 层数） */
  readonly roomCounts: readonly number[];
  /** 每层的水平半径上限（格；长度 = 层数） */
  readonly radii: readonly number[];
}

const DIRECTIONS: readonly { dx: number; dz: number; dir: MansionDirection }[] = [
  { dx: 1, dz: 0, dir: 0 },
  { dx: -1, dz: 0, dir: 1 },
  { dx: 0, dz: 1, dir: 2 },
  { dx: 0, dz: -1, dir: 3 },
];

/** 房间种类轮转表：大厅开头，其余按顺序出现（不额外吃随机数，改文案不会变形） */
const KIND_CYCLE: readonly MansionRoomKind[] = ['hall', 'study', 'bedroom', 'dining', 'library', 'prison', 'storage'];

/**
 * 排一份府邸布局。
 *
 * @param rng 0~1 的随机源（纯函数：同样的输入必须得到同样的布局）
 */
export function planMansion(
  originX: number,
  originY: number,
  originZ: number,
  rng: () => number,
  options: MansionLayoutOptions,
): MansionPlan {
  const rooms: MansionRoom[] = [];
  const links: MansionLink[] = [];
  const stairs: MansionStair[] = [];

  for (let floor = 0; floor < options.roomCounts.length; floor++) {
    const target = Math.max(1, options.roomCounts[floor] ?? 1);
    const radius = options.radii[floor] ?? 8;
    const y = originY + floor * MANSION_FLOOR_HEIGHT;
    const occupied = new Set<string>();

    const posOf = (cx: number, cz: number): { x: number; z: number; dist: number } => ({
      x: originX + cx * MANSION_CELL,
      z: originZ + cz * MANSION_CELL,
      dist: Math.hypot(cx * MANSION_CELL, cz * MANSION_CELL),
    });

    const start = posOf(0, 0);
    occupied.add('0,0');
    rooms.push({
      x: start.x,
      y,
      z: start.z,
      kind: floor === 0 ? 'hall' : 'hall',
      floor,
      depth: 0,
    });

    const frontier: Array<{ cx: number; cz: number; x: number; z: number; depth: number }> = [
      { cx: 0, cz: 0, x: start.x, z: start.z, depth: 0 },
    ];
    let attempts = 0;

    while (rooms.filter((room) => room.floor === floor).length < target && frontier.length > 0 && attempts < 200) {
      attempts++;
      const index = Math.floor(rng() * frontier.length);
      const current = frontier[index]!;

      const order = [0, 1, 2, 3];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = order[i]!;
        order[i] = order[j]!;
        order[j] = tmp;
      }

      let branches = 0;
      for (const dirIndex of order) {
        if (branches >= 1) break;
        if (rooms.filter((room) => room.floor === floor).length >= target) break;
        const dir = DIRECTIONS[dirIndex]!;
        if (rng() > 0.7) continue;
        const ncx = current.cx + dir.dx;
        const ncz = current.cz + dir.dz;
        const key = `${ncx},${ncz}`;
        if (occupied.has(key)) continue;
        const next = posOf(ncx, ncz);
        if (next.dist > radius) continue;

        occupied.add(key);
        branches++;
        const roomIndex = rooms.filter((room) => room.floor === floor).length;
        rooms.push({
          x: next.x,
          y,
          z: next.z,
          kind: floor === 0 && roomIndex === 0 ? 'hall' : KIND_CYCLE[roomIndex % KIND_CYCLE.length]!,
          floor,
          depth: current.depth + 1,
        });
        links.push({ x: current.x, y, z: current.z, dir: dir.dir, length: MANSION_CELL, floor });
        frontier.push({ cx: ncx, cz: ncz, x: next.x, z: next.z, depth: current.depth + 1 });
      }
      if (branches === 0) frontier.splice(index, 1);
    }

    // 层间楼梯：每层 (0,0) 那间房的角落，垂直对齐（最后一层不需要）
    if (floor < options.roomCounts.length - 1) {
      stairs.push({ x: start.x, y, z: start.z, dir: DIRECTIONS[Math.floor(rng() * 4)]!.dir, floor });
    }
  }

  return { rooms, links, stairs };
}

/** 某个房间的占地半宽（画法共用） */
export function mansionRoomHalf(kind: MansionRoomKind): number {
  return MANSION_ROOM_HALF[kind];
}
