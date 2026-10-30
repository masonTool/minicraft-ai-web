/**
 * 区段遮挡剔除（批次 20261030-2316）。
 *
 * 从相机所在 section 出发做方向受限的广度优先：只沿"进来的面 → 出去的面"连通的方向走，
 * 且不往已经走过方向的反方向回头（原版 Java 版的做法）。走不到的 section 被地形完全挡住，
 * 不画。地表玩家脚下整片实心岩层、以及与地面不连通的洞穴都会被剔掉。
 *
 * 只在相机换 section、或有区块连通图更新时重算；平时每帧只是查表。
 * 没有连通图的区块（还没网格化）按全连通处理，宁可多画不漏画。
 *
 * **视锥约束**（批次 20261031，原版同款）：只往视锥内的 section 扩展。视线是直线，
 * 到达任何屏幕上可见 section 的那条路径上的 section 都在视锥内，所以不会漏画。
 * 不加这条时，低头看地也会把远处区块"经洞穴连通"的地下层标成可见（真机每帧 164 万三角形）。
 * 代价是相机一转就要重算（只比较视图矩阵，静止时零开销）。
 */

import * as THREE from 'three';
import { PAIR_BIT, VISIBILITY_ALL } from '../core/mesh/SectionVisibility.ts';
import { SECTION_COUNT, WORLD_MIN_Y } from '../core/world/Chunk.ts';

/** 一个区块柱全部 section 都可见 */
export const SECTIONS_ALL = (1 << SECTION_COUNT) - 1;

const DX = [-1, 1, 0, 0, 0, 0] as const;
const DY = [0, 0, -1, 1, 0, 0] as const;
const DZ = [0, 0, 0, 0, -1, 1] as const;

export class SectionOcclusion {
  private radius = -1;
  private side = 0;
  private originCx = 0;
  private originCz = 0;
  private eyeSection = Number.NaN;
  private revision = -1;
  /** 是否在用（相机出了世界高度范围时整列全画） */
  private active = false;
  /** 每列可见 section 位图 */
  private columns = new Int32Array(0);
  private masks: Array<Uint16Array | undefined> = [];
  private visited = new Uint8Array(0);
  private qCell = new Int32Array(0);
  private qInfo = new Int32Array(0);
  private frustum: THREE.Frustum | null = null;
  private readonly box = new THREE.Box3();

  /**
   * 需要时重算。`maskOf` 返回某区块 24 个 section 的连通图（没有就 undefined）。
   * @returns 本次是否重算过（调用方据此决定要不要重新套用 drawRange）
   */
  update(
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    radius: number,
    revision: number,
    maskOf: (cx: number, cz: number) => Uint16Array | undefined,
    /** 视锥（null = 不约束）；调用方在视图变化时传 `viewChanged = true` 强制重算 */
    frustum: THREE.Frustum | null = null,
    viewChanged = false,
  ): boolean {
    const cx = Math.floor(eyeX / 16);
    const cz = Math.floor(eyeZ / 16);
    const sy = Math.floor((eyeY - WORLD_MIN_Y) / 16);
    if (
      radius === this.radius &&
      cx === this.originCx &&
      cz === this.originCz &&
      sy === this.eyeSection &&
      revision === this.revision &&
      !viewChanged
    ) {
      return false;
    }
    if (radius !== this.radius) this.resize(radius);
    this.originCx = cx;
    this.originCz = cz;
    this.eyeSection = sy;
    this.revision = revision;
    this.frustum = frustum;
    this.active = sy >= 0 && sy < SECTION_COUNT;
    if (!this.active) return true;

    const r = this.radius;
    for (let dz = -r, col = 0; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++, col++) this.masks[col] = maskOf(cx + dx, cz + dz);
    }
    this.columns.fill(0);
    this.visited.fill(0);
    this.search(r * this.side + r, sy);
    return true;
  }

  /** 区块 (cx, cz) 的可见 section 位图；超出搜索范围给 0，不在用时给全部 */
  sectionsOf(cx: number, cz: number): number {
    if (!this.active) return SECTIONS_ALL;
    const dx = cx - this.originCx + this.radius;
    const dz = cz - this.originCz + this.radius;
    if (dx < 0 || dz < 0 || dx >= this.side || dz >= this.side) return 0;
    return this.columns[dz * this.side + dx]!;
  }

  private resize(radius: number): void {
    this.radius = radius;
    this.side = radius * 2 + 1;
    const cols = this.side * this.side;
    const cells = cols * SECTION_COUNT;
    this.columns = new Int32Array(cols);
    this.masks = new Array(cols);
    this.visited = new Uint8Array(cells);
    this.qCell = new Int32Array(cells);
    this.qInfo = new Int32Array(cells);
  }

  private search(startCol: number, startSy: number): void {
    const visited = this.visited;
    const columns = this.columns;
    const qCell = this.qCell;
    const qInfo = this.qInfo;
    let head = 0;
    let tail = 0;

    const startCell = startCol * SECTION_COUNT + startSy;
    visited[startCell] = 1;
    columns[startCol] = 1 << startSy;
    // 起点四面八方都能出去（相机可能卡在方块里，不看它自己的连通图）
    for (let d = 0; d < 6; d++) {
      const next = this.step(startCol, startSy, d);
      if (next < 0 || visited[next]) continue;
      visited[next] = 1;
      const nextCol = (next / SECTION_COUNT) | 0;
      columns[nextCol] = columns[nextCol]! | (1 << (next - nextCol * SECTION_COUNT));
      qCell[tail] = next;
      qInfo[tail++] = ((d ^ 1) << 6) | (1 << d);
    }

    while (head < tail) {
      const cell = qCell[head]!;
      const info = qInfo[head++]!;
      const col = (cell / SECTION_COUNT) | 0;
      const sy = cell - col * SECTION_COUNT;
      const entered = info >> 6;
      const dirs = info & 63;
      const masks = this.masks[col];
      const mask = masks ? masks[sy]! : VISIBILITY_ALL;
      if (mask === 0) continue;
      for (let d = 0; d < 6; d++) {
        if (dirs & (1 << (d ^ 1))) continue;
        if (!(mask & PAIR_BIT[entered * 6 + d]!)) continue;
        const next = this.step(col, sy, d);
        if (next < 0 || visited[next]) continue;
        visited[next] = 1;
        const nextCol = (next / SECTION_COUNT) | 0;
        columns[nextCol] = columns[nextCol]! | (1 << (next - nextCol * SECTION_COUNT));
        qCell[tail] = next;
        qInfo[tail++] = ((d ^ 1) << 6) | dirs | (1 << d);
      }
    }
  }

  /** 相邻 section 的格子下标；出了搜索范围或世界高度返回 -1 */
  private step(col: number, sy: number, d: number): number {
    const ny = sy + DY[d]!;
    if (ny < 0 || ny >= SECTION_COUNT) return -1;
    const side = this.side;
    const x = (col % side) + DX[d]!;
    const z = ((col / side) | 0) + DZ[d]!;
    if (x < 0 || z < 0 || x >= side || z >= side) return -1;
    if (this.frustum) {
      const wx = (this.originCx + x - this.radius) * 16;
      const wz = (this.originCz + z - this.radius) * 16;
      const wy = WORLD_MIN_Y + ny * 16;
      this.box.min.set(wx, wy, wz);
      this.box.max.set(wx + 16, wy + 16, wz + 16);
      if (!this.frustum.intersectsBox(this.box)) return -1;
    }
    return (z * side + x) * SECTION_COUNT + ny;
  }
}
