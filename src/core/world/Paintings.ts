/**
 * 多格拼贴的画（B51 的 ②，批次 494）
 *
 * 一幅画占 w×h 个方块。**方块状态只有一个字节**，塞不下"哪一幅 + 占在第几格"，
 * 所以这里照抄告示牌/展示框/盔甲架那一套：**按坐标存表**。
 *
 * 与前几批不同的是"一格不属于自己"：拆掉任意一格，整幅画都要跟着掉。
 * 于是表里**每一格存一条**（带锚点坐标），而不是只存锚点——
 * 这样"这一格属于哪幅画"是一次 O(1) 查表，不需要遍历所有锚点去比对包围盒
 * （一幅 4×4 的画有 16 格，几百幅就是上万次比较，而那是在破坏方块的热路径上）。
 *
 * 表里存的是**画的名字**（不是 id）：名字稳定、可读，改表顺序不会让老存档错位。
 */

import { isDimension } from '../gen/Dimension.ts';
import { multiPaintingByName, type MultiPainting } from '../registry/paintings.ts';

/** 一格画所属的那幅画 */
export interface PaintingCell {
  readonly dimension: string;
  /** 锚点（左上角那一格；放置时命中的就是它） */
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  /** 画的名字（`donkey_kong` 这类，与 `MULTI_PAINTINGS` 一致） */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** 本格在整幅画里的位置：col 向右、row 向下（都从 0 起） */
  readonly col: number;
  readonly row: number;
}

/** 表里的键：与容器、牌子、展示框同一套写法（`维度|x,y,z`） */
export function paintingCellKey(dimension: string, x: number, y: number, z: number): string {
  return `${dimension}|${x},${y},${z}`;
}

/**
 * 一幅画在"从锚点向右向下铺"时占到的格子。
 *
 * @param rightX 向右（画幅宽度方向）的单位向量 x 分量
 * @param rightZ 同上 z 分量
 *
 * 朝向只影响"右"是哪个方向；"下"永远是 -y（原版画也是这样挂的）。
 */
export function paintingCells(
  anchor: { x: number; y: number; z: number },
  painting: MultiPainting,
  rightX: number,
  rightZ: number,
): { x: number; y: number; z: number; col: number; row: number }[] {
  const cells: { x: number; y: number; z: number; col: number; row: number }[] = [];
  for (let row = 0; row < painting.height; row++) {
    for (let col = 0; col < painting.width; col++) {
      cells.push({
        x: anchor.x + rightX * col,
        y: anchor.y - row,
        z: anchor.z + rightZ * col,
        col,
        row,
      });
    }
  }
  return cells;
}

/**
 * 按"从大到小"找一幅放得下的画。
 *
 * `fits` 由调用方给（它要知道"这几格是不是同一个墙面、是不是空气"），
 * 这个函数只负责**顺序**：先试 4×4，放不下再试 4×3……最后 2×2。
 * 原版也是这个思路（越大越先试），"能挂一幅大画"正是这个玩法的一半。
 *
 * @returns 放得下的第一幅；一幅都放不下返回 null
 */
export function pickPaintingThatFits(
  paintingsLargeFirst: readonly MultiPainting[],
  fits: (painting: MultiPainting) => boolean,
): MultiPainting | null {
  for (const painting of paintingsLargeFirst) {
    if (fits(painting)) return painting;
  }
  return null;
}

/** 画表：每一格一条（见文件头"为什么每格存一条"） */
export class PaintingStore {
  private readonly cells = new Map<string, PaintingCell>();

  get(dimension: string, x: number, y: number, z: number): PaintingCell | null {
    return this.cells.get(paintingCellKey(dimension, x, y, z)) ?? null;
  }

  has(dimension: string, x: number, y: number, z: number): boolean {
    return this.cells.has(paintingCellKey(dimension, x, y, z));
  }

  /**
   * 挂上一幅画（写入它的每一格）。
   *
   * 调用方保证这些格子是空的（`pickPaintingThatFits` 已经判过），
   * 但这里**仍然覆盖写**：脏存档里同一格出现两条时，后写的赢——总比留一条永远读不到的好。
   */
  place(
    dimension: string,
    anchor: { x: number; y: number; z: number },
    painting: MultiPainting,
    rightX: number,
    rightZ: number,
  ): PaintingCell[] {
    const cells = paintingCells(anchor, painting, rightX, rightZ);
    const written: PaintingCell[] = [];
    for (const cell of cells) {
      const entry: PaintingCell = {
        dimension,
        ax: anchor.x,
        ay: anchor.y,
        az: anchor.z,
        name: painting.name,
        width: painting.width,
        height: painting.height,
        col: cell.col,
        row: cell.row,
      };
      this.cells.set(paintingCellKey(dimension, cell.x, cell.y, cell.z), entry);
      written.push(entry);
    }
    return written;
  }

  /**
   * 拆掉某一格所属的**整幅画**，返回那幅画的锚点与名字。
   *
   * 拆画的人只关心"画的哪一格"（他瞄准的就是那一格），所以这里反查锚点、
   * 再把整幅的格子删干净——不删干净的话剩下的格子会变成"查不到画的方块"。
   */
  removeAt(dimension: string, x: number, y: number, z: number): { anchor: PaintingCell; cells: PaintingCell[] } | null {
    const cell = this.get(dimension, x, y, z);
    if (!cell) return null;
    const painting = multiPaintingByName(cell.name);
    const width = painting?.width ?? cell.width;
    const height = painting?.height ?? cell.height;
    const removed: PaintingCell[] = [];
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        // 锚点 + 右下：这里不需要朝向——表里每格都记着自己的坐标，
        // 只要把"锚点矩形"里存在的条目删掉就行
        const key = paintingCellKey(dimension, cell.ax + col, cell.ay - row, cell.az);
        const hit = this.cells.get(key);
        if (!hit) continue;
        removed.push(hit);
        this.cells.delete(key);
      }
    }
    // ⚠️ 画可能是"向左铺"的（朝向不同，锚点在右边），上面那个循环只覆盖"向右向下"。
    // 兜底：把同一锚点、同一维度的条目全部删掉（数量上限几十条，代价可忽略）
    for (const [key, entry] of [...this.cells]) {
      if (entry.dimension !== cell.dimension) continue;
      if (entry.ax !== cell.ax || entry.ay !== cell.ay || entry.az !== cell.az) continue;
      if (!removed.includes(entry)) removed.push(entry);
      this.cells.delete(key);
    }
    return { anchor: cell, cells: removed };
  }

  get size(): number {
    return this.cells.size;
  }

  clear(): void {
    this.cells.clear();
  }

  forEach(visit: (cell: PaintingCell) => void): void {
    for (const cell of this.cells.values()) visit(cell);
  }

  /** 去重后的锚点列表（渲染层按"每幅一张大平面"画，所以要先按锚点归组） */
  anchors(): PaintingCell[] {
    const seen = new Set<string>();
    const out: PaintingCell[] = [];
    for (const cell of this.cells.values()) {
      const key = `${cell.dimension}|${cell.ax},${cell.ay},${cell.az}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cell);
    }
    return out;
  }
}

/** 存档格式：只存锚点（每格能从锚点 + 尺寸重建） */
export interface SerializedPainting {
  dimension: string;
  x: number;
  y: number;
  z: number;
  name: string;
  /** 向右是哪个方向（±1 的 x 或 z）：不存的话左右会在读档后翻过来 */
  rightX: number;
  rightZ: number;
}

export function serializePaintings(store: PaintingStore): SerializedPainting[] {
  const out: SerializedPainting[] = [];
  for (const anchor of store.anchors()) {
    // 从锚点那一格与它右边那一格推出朝向（宽度为 1 时推不出来，记 0）
    let rightX = 0;
    let rightZ = 0;
    if (anchor.width > 1) {
      const right = store.get(anchor.dimension, anchor.ax + 1, anchor.ay, anchor.az);
      if (right) {
        rightX = 1;
      } else {
        rightZ = -1;
      }
    }
    out.push({
      dimension: anchor.dimension,
      x: anchor.ax,
      y: anchor.ay,
      z: anchor.az,
      name: anchor.name,
      rightX,
      rightZ,
    });
  }
  return out;
}

/** 读存档：逐条校验、坏的跳过（维度不认识 / 名字不认识 / 坐标不是有限数） */
export function restorePaintings(store: PaintingStore, raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let restored = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Partial<SerializedPainting>;
    const dimension = typeof record.dimension === 'string' ? record.dimension : '';
    if (!isDimension(dimension)) continue;
    const x = typeof record.x === 'number' ? record.x : NaN;
    const y = typeof record.y === 'number' ? record.y : NaN;
    const z = typeof record.z === 'number' ? record.z : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const painting = typeof record.name === 'string' ? multiPaintingByName(record.name) : undefined;
    if (!painting) continue;
    const rightX = record.rightX === 1 ? 1 : record.rightX === -1 ? -1 : 0;
    const rightZ = record.rightZ === 1 ? 1 : record.rightZ === -1 ? -1 : 0;
    store.place(dimension, { x: Math.round(x), y: Math.round(y), z: Math.round(z) }, painting, rightX, rightZ);
    restored++;
  }
  return restored;
}
