/**
 * 废弃矿井的拼图布局（批次 460 立、461 补多层）
 *
 * 原来的矿井是"一条主巷 + 递归随机分叉"：分叉从不检查占用，两条走廊会穿模；
 * 也没有交叉口与房间的概念（尽头那个小房间是唯一"像房间"的东西）。
 * 这一版换成**节点网格 + 走廊边**的拼图：
 *
 *  - 节点落在 8 格网格上，只有两种：`crossing`（3×3 的十字口）与 `room`（7×7 房间）；
 *  - 相邻节点之间铺一段走廊（长 8、3 宽 3 高）；
 *  - 节点**只会被占用一次**（网格 Set），所以走廊绝不会穿模；
 *  - 从起点做广度优先扩展，所以**全部连通**（不会出现玩家走不到的孤岛）。
 *
 * **批次 461 补多层**：约 30% 的分支会带一个 ±4 的层差（`rise`），
 * 那一段画成**逐格抬升的楼梯**（每 2 格升 1 格，玩家直接走上去，不用跳）。
 * 层差只允许 ±4：再多就得做"竖直井 + 梯子"，那是另一套零件。
 * 同一格网格上下相邻的两层必须差 ≥ 4（走廊 3 高 + 地面 1），否则会互相打穿。
 *
 * 该模块是纯函数（只吃坐标 + 随机源），因此跨区块重放逐格一致——
 * 与 `VillageLayout` 同一条硬约定。
 */

/** 走廊段的方向：0 = +X、1 = -X、2 = +Z、3 = -Z */
export type MineshaftDirection = 0 | 1 | 2 | 3;

/** 节点之间的网格间距（格） */
export const MINESHAFT_NODE_SPACING = 8;
/** 走廊段的截面半宽（3 宽 → 半宽 1） */
export const MINESHAFT_CORRIDOR_HALF = 1;
/** 房间的半宽（7×7 → 半宽 3） */
export const MINESHAFT_ROOM_HALF = 3;
/**
 * 一段楼梯能升降的高度（格）。
 *
 * 取 4 是因为"走廊 3 高 + 地面 1"：两层若只差 3，上下层的地板/天花会贴在一起；
 * 差 4 刚好留出一格实体岩层，看起来是"两层矿井"而不是"一串通铺"。
 */
export const MINESHAFT_STAIR_RISE = 4;

export interface MineshaftNode {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: 'crossing' | 'room';
}

export interface MineshaftSegment {
  /** 起点（世界坐标，节点中心） */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dir: MineshaftDirection;
  /** 长度（格）：从起点节点中心到终点节点中心 */
  readonly length: number;
  /**
   * 这一段的高度变化（格）：0 = 平段，±4 = 楼梯段。
   *
   * 终点节点的 y 恒等于 `y + rise`——画法与布局靠这一条对齐。
   */
  readonly rise: number;
}

export interface MineshaftPlan {
  readonly nodes: readonly MineshaftNode[];
  readonly segments: readonly MineshaftSegment[];
}

export interface MineshaftLayoutOptions {
  /** 想要的节点数（含起点；原版矿井是一片，这里 8~13 个节点） */
  readonly target: number;
  /** 水平半径上限（结构包围盒是 28，留 4 格余量） */
  readonly maxRadius?: number;
  /** 每扩展一次就接一个新节点的概率 */
  readonly branchChance?: number;
  /** 层差上下限（相对原点 y；默认 ±16，配合 ±4 的层差就是最多 4 层） */
  readonly maxLevelOffset?: number;
}

/** 四个方向：网格增量 + 段朝向编号（两者必须一一对应） */
const DIRECTIONS: readonly { dx: number; dz: number; dir: MineshaftDirection }[] = [
  { dx: 1, dz: 0, dir: 0 },
  { dx: -1, dz: 0, dir: 1 },
  { dx: 0, dz: 1, dir: 2 },
  { dx: 0, dz: -1, dir: 3 },
];

/**
 * 排一份矿井布局。
 *
 * @param originX 结构原点（世界坐标）
 * @param rng 0~1 的随机源（`PositionalRng#next`；纯函数要求"同样的输入同样结果"）
 * @param options 规模与半径
 */
export function planMineshaft(
  originX: number,
  originY: number,
  originZ: number,
  rng: () => number,
  options: MineshaftLayoutOptions,
): MineshaftPlan {
  const maxRadius = options.maxRadius ?? 24;
  const branchChance = options.branchChance ?? 0.6;
  const maxLevelOffset = options.maxLevelOffset ?? 16;

  const nodes: MineshaftNode[] = [];
  const segments: MineshaftSegment[] = [];
  /**
   * 已占用的网格：`cx,cz` → 该列的节点高度列表。
   *
   * 用列表而不是单个 Set 键，是因为**多层**允许同一 (cx,cz) 上下两层；
   * 但两层必须差 ≥ `MINESHAFT_STAIR_RISE`，否则走廊会互相打穿。
   */
  const occupied = new Map<string, number[]>();

  const nodeAt = (cx: number, cz: number): { x: number; z: number; dist: number } => ({
    x: originX + cx * MINESHAFT_NODE_SPACING,
    z: originZ + cz * MINESHAFT_NODE_SPACING,
    dist: Math.hypot(cx * MINESHAFT_NODE_SPACING, cz * MINESHAFT_NODE_SPACING),
  });

  const start = nodeAt(0, 0);
  nodes.push({ x: start.x, y: originY, z: start.z, kind: 'crossing' });
  occupied.set('0,0', [originY]);

  /** 待扩展的节点（广度优先：先铺满近处，玩家进矿井就有活干） */
  const frontier: Array<{ cx: number; cz: number; x: number; z: number; y: number }> = [
    { cx: 0, cz: 0, x: start.x, z: start.z, y: originY },
  ];
  let attempts = 0;

  while (nodes.length < options.target && frontier.length > 0 && attempts < 400) {
    attempts++;
    // 从"前沿"里随机挑一个（不是每次取队首：队首会让矿井变成一条长蛇）
    const index = Math.floor(rng() * frontier.length);
    const current = frontier[index]!;
    // 每个前沿节点最多接两条新走廊（接三条就成了一片毛球）
    let branches = 0;
    // 方向顺序做一次 Fisher-Yates 洗牌（不用 `sort(随机比较器)`：
    // 那种写法依赖引擎的排序实现，跨引擎可能得到不同顺序）
    const order = [0, 1, 2, 3];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    for (const dirIndex of order) {
      if (branches >= 2 || nodes.length >= options.target) break;
      const dir = DIRECTIONS[dirIndex]!;
      if (rng() > branchChance) continue;
      const ncx = current.cx + dir.dx;
      const ncz = current.cz + dir.dz;
      const key = `${ncx},${ncz}`;
      const next = nodeAt(ncx, ncz);
      // 半径上限：超出的分支直接放弃（否则矿井会拉成一条线，包围盒还装不下）
      if (next.dist > maxRadius) continue;

      // 层差（批次 461）：约 30% 的分支换层，层差固定 ±4
      let nextY = current.y;
      if (rng() < 0.3) {
        const candidate = current.y + (rng() < 0.5 ? MINESHAFT_STAIR_RISE : -MINESHAFT_STAIR_RISE);
        if (Math.abs(candidate - originY) <= maxLevelOffset) nextY = candidate;
      }
      // 同列已有节点：两层必须差 ≥ 4，否则走廊上下打穿
      const heights = occupied.get(key) ?? [];
      if (heights.some((height) => Math.abs(height - nextY) < MINESHAFT_STAIR_RISE)) continue;

      occupied.set(key, [...heights, nextY]);
      branches++;
      nodes.push({
        x: next.x,
        y: nextY,
        z: next.z,
        // 房间大约五分之一（原版矿井里的房间本来就少）
        kind: rng() < 0.2 ? 'room' : 'crossing',
      });
      segments.push({
        x: current.x,
        y: current.y,
        z: current.z,
        dir: dir.dir,
        length: MINESHAFT_NODE_SPACING,
        rise: nextY - current.y,
      });
      frontier.push({ cx: ncx, cz: ncz, x: next.x, z: next.z, y: nextY });
    }
    // 这个前沿节点已经扩展完（或没有可接的方向）→ 移出队列
    if (branches === 0) frontier.splice(index, 1);
  }

  return { nodes, segments };
}
