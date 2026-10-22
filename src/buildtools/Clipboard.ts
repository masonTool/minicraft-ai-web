/**
 * 创造模式的**复制 / 粘贴 / 镜像**（创造3，批次 20261022-1954）
 *
 * 纯逻辑：一块区域 → 一份"相对坐标 + 方块"的快照；粘贴时再按目标落点还原成世界坐标。
 * 不碰世界、不碰 DOM，所以"镜像后坐标对不对""贴着世界顶会裁掉哪几格"都能离线钉住。
 *
 * 四条口径（都有断言守着）：
 *
 *  1. **只存非空气**：一片 16³ 的空选区不该占 4096 条内存，粘贴时也不该用空气
 *     把目标处的建筑"抹掉"（玩家复制的是"一座房子"，不是"一整块空间"）。
 *     代价是复制带空洞的区域时**保留空洞**（不覆盖目标），结果里标 `masked`。
 *  2. **镜像只翻偏移，不翻方块**：`dx → width-1-dx`（Z 同理），方块 id / 状态原样带过去。
 *     镜像两次必须回到原样——这是最便宜的对称性断言。
 *  3. **粘贴按 y 裁剪**：目标落点贴到世界顶/底时，只贴合法的那几层，并把裁掉的格数
 *     报出来（界面提示"有 N 格超出世界"）。这与选区的口径一致：手抖拉过界不该整块失败。
 *  4. **顺序固定（dy → dz → dx）**：与 `Selection` / `Fill` 同一条，分批与断言都靠它。
 */

import { WORLD_MAX_Y, WORLD_MIN_Y } from '../core/world/Chunk.ts';
import { selectionCells, type SelectionBox } from './Selection.ts';

/** 每帧默认粘贴多少格（与 `FILL_BATCH_SIZE` 同量级） */
export const PASTE_BATCH_SIZE = 512;

/** 一格里带着的方块数据（只这两样；方块实体内容不在快照里） */
export interface SnapshotBlock {
  readonly id: number;
  readonly state: number;
}

/** 快照里的一格：`dx/dy/dz` 是**相对锚点（最小角）**的偏移 */
export interface ClipboardCell {
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly id: number;
  readonly state: number;
}

export interface ClipboardSnapshot {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** 只含非空气的格子（顺序：dy → dz → dx） */
  readonly cells: readonly ClipboardCell[];
  /** 复制时是否跳过了空气（有空洞） */
  readonly masked: boolean;
  /** 复制时的世界锚点（最小角）；粘贴默认落在它右边，避免盖住原件 */
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * 复制一块区域。
 *
 * `read` 返回 `null` 表示这一格不要复制（调用方通常对空气返回 null）。
 * 返回的快照尺寸仍是**原选区尺寸**——空洞不改变"这座房子有多宽"，
 * 否则镜像时偏移会错位。
 */
export function createSnapshot(
  box: SelectionBox,
  read: (x: number, y: number, z: number) => SnapshotBlock | null,
): ClipboardSnapshot {
  const cells: ClipboardCell[] = [];
  let skipped = 0;
  for (const pos of selectionCells(box)) {
    const block = read(pos.x, pos.y, pos.z);
    if (!block) {
      skipped += 1;
      continue;
    }
    cells.push({
      dx: pos.x - box.minX,
      dy: pos.y - box.minY,
      dz: pos.z - box.minZ,
      id: block.id,
      state: block.state,
    });
  }
  return {
    width: box.maxX - box.minX + 1,
    height: box.maxY - box.minY + 1,
    depth: box.maxZ - box.minZ + 1,
    cells,
    masked: skipped > 0,
    origin: { x: box.minX, y: box.minY, z: box.minZ },
  };
}

/** 镜像轴：沿 X 翻转（左右）或沿 Z 翻转（前后） */
export type MirrorAxis = 'x' | 'z';

/** 一格在镜像后的样子（只改偏移，方块不变） */
export function mirrorCell(
  cell: ClipboardCell,
  snapshot: Pick<ClipboardSnapshot, 'width' | 'depth'>,
  axis: MirrorAxis,
): ClipboardCell {
  if (axis === 'x') {
    return { ...cell, dx: snapshot.width - 1 - cell.dx };
  }
  return { ...cell, dz: snapshot.depth - 1 - cell.dz };
}

/** 快照里的方块格数（不是"体积"——有空洞时比体积小） */
export function snapshotCellCount(snapshot: ClipboardSnapshot): number {
  return snapshot.cells.length;
}

/** 粘贴后的一格（世界坐标） */
export interface PasteCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly id: number;
  readonly state: number;
}

export interface PasteResult {
  /** 真正会写入的格子（已按 dy → dz → dx 排序） */
  readonly cells: readonly PasteCell[];
  /** 被世界高度裁掉的格数 */
  readonly skipped: number;
  /** 是否发生过裁剪 */
  readonly clamped: boolean;
}

export interface PasteOptions {
  /** 镜像轴；`null`/省略 = 不镜像 */
  readonly mirror?: MirrorAxis | null;
  readonly minY?: number;
  readonly maxY?: number;
}

/**
 * 粘贴计划：快照 + 目标最小角 → 世界坐标列表。
 *
 * 目标落点就是**最小角**（与复制时的锚点语义一致）：`target + (dx,dy,dz)`。
 * 镜像时先翻偏移，再落点——所以"贴着右边界复制、镜像后贴左边界"是同一个目标。
 */
export function planPaste(
  snapshot: ClipboardSnapshot,
  target: { readonly x: number; readonly y: number; readonly z: number },
  options: PasteOptions = {},
): PasteResult {
  const minY = options.minY ?? WORLD_MIN_Y;
  const maxY = options.maxY ?? WORLD_MAX_Y - 1;
  const mirror = options.mirror ?? null;
  const cells: PasteCell[] = [];
  let skipped = 0;

  for (const cell of snapshot.cells) {
    const source = mirror ? mirrorCell(cell, snapshot, mirror) : cell;
    const y = Math.floor(target.y) + source.dy;
    if (y < minY || y > maxY) {
      skipped += 1;
      continue;
    }
    cells.push({
      x: Math.floor(target.x) + source.dx,
      y,
      z: Math.floor(target.z) + source.dz,
      id: source.id,
      state: source.state,
    });
  }
  return { cells, skipped, clamped: skipped > 0 };
}

/** 默认粘贴落点：原件**右边一格宽**处（避免直接盖住原件） */
export function defaultPasteTarget(snapshot: ClipboardSnapshot): { x: number; y: number; z: number } {
  return {
    x: snapshot.origin.x + snapshot.width,
    y: snapshot.origin.y,
    z: snapshot.origin.z,
  };
}

export interface PasteProgress {
  readonly done: boolean;
  readonly cancelled: boolean;
  readonly visited: number;
  readonly written: number;
  readonly total: number;
}

export interface PasteRunnerOptions {
  readonly batchSize?: number;
  /** 写一格；返回 false 表示这一格没写（例如目标处已经是同一个方块） */
  readonly write: (cell: PasteCell) => boolean;
}

/**
 * 跨帧粘贴（与 `FillRunner` 同一条思路，只是输入是**离散的格子**而不是连续盒子）。
 *
 * 为什么不复用 `FillRunner`：粘贴的格子之间可能有空洞，按盒子遍历会写空气；
 * 这里直接按快照里的格子列表推进。
 */
export class PasteRunner {
  private readonly cells: readonly PasteCell[];
  private readonly write: (cell: PasteCell) => boolean;
  private readonly batchSize: number;
  private index = 0;
  private visitedCount = 0;
  private writtenCount = 0;
  private cancelled = false;

  constructor(cells: readonly PasteCell[], options: PasteRunnerOptions) {
    const requested = options.batchSize ?? PASTE_BATCH_SIZE;
    this.cells = cells;
    this.batchSize = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : PASTE_BATCH_SIZE;
    this.write = options.write;
  }

  /** 推进一次（默认一整批）；返回"是否还有后续" */
  step(maxCells: number = this.batchSize): boolean {
    if (this.cancelled) return false;
    let budget = Number.isFinite(maxCells) ? Math.max(1, Math.floor(maxCells)) : this.batchSize;
    while (budget > 0 && !this.cancelled && this.index < this.cells.length) {
      const cell = this.cells[this.index]!;
      this.index += 1;
      this.visitedCount += 1;
      budget -= 1;
      if (this.write(cell)) this.writtenCount += 1;
    }
    return !this.done;
  }

  cancel(): void {
    this.cancelled = true;
  }

  get done(): boolean {
    return this.cancelled || this.index >= this.cells.length;
  }

  get progress(): PasteProgress {
    return {
      done: this.done,
      cancelled: this.cancelled,
      visited: this.visitedCount,
      written: this.writtenCount,
      total: this.cells.length,
    };
  }
}
