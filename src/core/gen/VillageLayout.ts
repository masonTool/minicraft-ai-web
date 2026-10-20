/**
 * 村庄布局（批次 455：结构"拼图化"的第一刀，只做村庄）
 *
 * 原来的村庄是"中心水井 + 绕圈撒 4~7 栋房子 + 四条放射路"——
 * 撒候选点撞地形就丢，实测平均只剩 **2 栋**（原版 5~15 栋），
 * 而"村庄里住几个人"完全由房子数决定，于是走到村庄只见一两个村民。
 *
 * 这一版改成**街道驱动的槽位布局**：
 *
 *  1. 四条街道从水井向四个方向铺开（北/东/南/西）；
 *  2. 每条街两侧各一排槽位，槽位间距固定（`spacing`），房子**门朝街道**；
 *  3. 每个槽位依次问"地形能不能建"（世界坐标纯函数）与"会不会压到已放的零件"；
 *  4. 零件种类按固定序列轮转（住宅为主，农场/铁匠铺/图书馆各一份）。
 *
 * ⚠️ 布局只依赖**中心坐标 + 随机源 + 地形判据**，不读本区块的方块数据——
 * 跨区块生成时"拥有者与邻居各重放一遍"必须得出同一份布局（HANDOFF §3.5 的硬约定）。
 *
 * ⚠️ 这还不是原版那种 jigsaw：没有"门与门对接"的接口匹配，也没有高度分层。
 * 但"门朝街、互不重叠、数量可控"这三条是布局的骨架，先把它做对。
 */

/** 住宅/农场/铁匠铺/图书馆占地的半宽（9×9 的房子，半宽 4） */
export const VILLAGE_PIECE_HALF = 4;
/**
 * 建筑**清地**的半宽（`buildHouse` 会先 clear 掉 x0-1..x1+1 一整块）。
 *
 * 不重叠判据必须用它而不是 `VILLAGE_PIECE_HALF`：按占地 4 算的话，
 * 中心距正好 8 的两栋会同时清地，后建的那栋会把先建的墙/家具清掉
 * （`test:village` 抓到过一张床少半张——头被邻居的 clear 抹了）。
 */
export const VILLAGE_PIECE_CLEAR_HALF = 5;
/** 中心水井的占地半宽（5×5 水井 + 1 格广场边距） */
export const VILLAGE_WELL_HALF = 3;

export type VillagePieceKind = 'house' | 'farm' | 'smithy' | 'library';

/** 门朝向：0 = 北（-Z）、1 = 东（+X）、2 = 南（+Z）、3 = 西（-X），与 `blockState` 的 facing 同序 */
export type VillageDoorFacing = 0 | 1 | 2 | 3;

export interface VillagePiece {
  readonly kind: VillagePieceKind;
  /** 零件中心（方块坐标） */
  readonly x: number;
  readonly z: number;
  /** 门朝向：门开在朝街那一面 */
  readonly door: VillageDoorFacing;
  /** 占地半宽 */
  readonly half: number;
}

export interface VillageLayoutOptions {
  readonly centerX: number;
  readonly centerZ: number;
  /** 想要的零件数（水井不算） */
  readonly target: number;
  /** 这个位置能不能建（地形判据由调用方注入：海平面以上、高差不大、已加载……） */
  readonly buildable: (x: number, z: number, half: number) => boolean;
  /**
   * 街道上相邻槽位的间距（默认 **11**）。
   *
   * 9 会让两栋 9×9 房子只隔 1 格：地形有 2~3 格高差时，高那栋的地基会压到
   * 低那栋的门口（`test:village` 抓到过 1 扇"堵住的门"）。11 留出 3 格缓冲。
   */
  readonly spacing?: number;
}

/**
 * 零件轮转序列：住宅为主，农场/铁匠铺/图书馆各一份。
 *
 * 顺序固定（不随机）是为了让"每个村庄都有这三个工作点"成立——
 * 随机抽的话，小村庄可能一个铁匠铺都抽不到，村民职业就永远缺一档。
 */
const KIND_CYCLE: readonly VillagePieceKind[] = ['house', 'house', 'farm', 'house', 'smithy', 'house', 'library'];

/** 街道方向（dx,dz 是街道延伸方向），以及这条街两侧槽位的垂直方向 */
const STREET_DIRECTIONS = [
  { dx: 0, dz: -1 },
  { dx: 1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: -1, dz: 0 },
] as const;

/** 房子站在 (ox, oz) 这一侧时，门要朝**街道**（即反方向） */
function doorTowardStreet(ox: number, oz: number): VillageDoorFacing {
  if (ox === 1) return 3; // 房子在东侧 → 门朝西
  if (ox === -1) return 1; // 西侧 → 朝东
  if (oz === 1) return 0; // 南侧 → 朝北
  return 2; // 北侧 → 朝南
}

/**
 * 排一份村庄布局。
 *
 * 槽位按"离水井近的先"逐圈铺（ring 0 是紧挨广场的第一圈），
 * 这样地形受限时得到的是一个**小而紧凑**的村庄，而不是"稀稀拉拉几个远处房子"。
 */
export function planVillageLayout(options: VillageLayoutOptions): VillagePiece[] {
  const spacing = options.spacing ?? 11;
  const pieces: VillagePiece[] = [];
  const placed: Array<{ x: number; z: number; half: number }> = [
    // 水井只清到井沿（半径 2），没有 `buildHouse` 那圈 clear，所以按占地算
    { x: options.centerX, z: options.centerZ, half: VILLAGE_WELL_HALF },
  ];

  /**
   * 最多铺 3 圈。
   *
   * ⚠️ 不能按"每圈 8 个"算圈数：十字街道的**邻街槽位互相打架**
   * （(5,-8) 与 (8,-5) 只隔 4.2 格，清地包络必然相交），所以一圈实际只排得下
   * 4 个。按 8 算的话 target=8 只铺一圈、只得到 4 栋——实测踩过。
   */
  const MAX_RINGS = 3;

  outer: for (let ring = 0; ring < MAX_RINGS; ring++) {
    for (const dir of STREET_DIRECTIONS) {
      // 每圈从水井外沿 8 格开始（水井半径 2 + 广场 4 + 门口 2）
      const along = 8 + ring * spacing;
      for (const side of [1, -1] as const) {
        if (pieces.length >= options.target) break outer;
        // 街道的垂直方向：把 (dx,dz) 转 90° 得到 (-dz, dx)
        const ox = -dir.dz * side;
        const oz = dir.dx * side;
        // 垂直偏移 5 = 房子半宽 4 + 街道半宽 1：房子正好**贴着街边**，不压街心
        const x = options.centerX + dir.dx * along + ox * 5;
        const z = options.centerZ + dir.dz * along + oz * 5;
        if (!options.buildable(x, z, VILLAGE_PIECE_HALF)) continue;
        // 矩形不重叠判定（保守）：两个零件的包络盒不能相交
        const overlaps = placed.some(
          (other) =>
            Math.abs(other.x - x) < other.half + VILLAGE_PIECE_CLEAR_HALF &&
            Math.abs(other.z - z) < other.half + VILLAGE_PIECE_CLEAR_HALF,
        );
        if (overlaps) continue;
        placed.push({ x, z, half: VILLAGE_PIECE_CLEAR_HALF });
        pieces.push({
          kind: KIND_CYCLE[pieces.length % KIND_CYCLE.length]!,
          x,
          z,
          door: doorTowardStreet(ox, oz),
          half: VILLAGE_PIECE_HALF,
        });
      }
    }
  }
  return pieces;
}
