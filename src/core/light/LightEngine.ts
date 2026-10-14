/**
 * 光照引擎（对齐原版规则）
 *
 * 两种光：
 *  - 天光（skylight）  ：从世界顶部竖直往下，穿透明方块不衰减（"直射天光"保持 15），
 *                       横向/向上每格衰减 1（或按方块 lightOpacity 衰减）。
 *  - 方块光（blocklight）：由发光方块发出，任何方向每格衰减 1。
 *
 * 做法：列扫描初始化 → 播种 BFS → 扩散。队列跨区块共享，所以光能自然流过区块边界；
 * 新区块点亮时会把已点亮邻居的接壤边界重新入队，让邻区的光横向流进来。
 * BFS 可按预算分帧执行，避免一次性阻塞主线程。
 */

import { blockDef } from '../registry/blocks.ts';
import { Chunk, SECTION_COUNT, SECTION_HEIGHT, WORLD_MAX_Y, WORLD_MIN_Y } from '../world/Chunk.ts';

/** 光照引擎需要的世界访问能力（由 World 实现，接口化以避免循环依赖） */
export interface LightAccessor {
  getBlock(worldX: number, worldY: number, worldZ: number): number;
  isLoaded(worldX: number, worldZ: number): boolean;
  getChunk(cx: number, cz: number): Chunk | undefined;
  getSkyLight(worldX: number, worldY: number, worldZ: number): number;
  setSkyLight(worldX: number, worldY: number, worldZ: number, value: number): void;
  getBlockLight(worldX: number, worldY: number, worldZ: number): number;
  setBlockLight(worldX: number, worldY: number, worldZ: number, value: number): void;
}

const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** 四个水平方向 + 对应的边界列偏移 */
const HORIZONTAL: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** 队列消费后回收空间的阈值（元素个数） */
const COMPACT_THRESHOLD = 24576;

export class LightEngine {
  private skyQueue: number[] = [];
  private blockQueue: number[] = [];
  private skyHead = 0;
  private blockHead = 0;

  constructor(private readonly world: LightAccessor) {}

  get hasWork(): boolean {
    return this.skyHead < this.skyQueue.length || this.blockHead < this.blockQueue.length;
  }

  get pendingCells(): number {
    return (this.skyQueue.length - this.skyHead) / 3 + (this.blockQueue.length - this.blockHead) / 3;
  }

  /** 对光照有意义的 Y 区间：从最低非空 section 的底，到最高非空 section 之上那一节的顶 */
  private static verticalRange(chunk: Chunk): [number, number] {
    let minSection = SECTION_COUNT;
    let maxSection = -1;
    for (let s = 0; s < SECTION_COUNT; s++) {
      if (chunk.sectionCounts[s]! > 0) {
        if (s < minSection) minSection = s;
        if (s > maxSection) maxSection = s;
      }
    }
    if (maxSection < 0) return [WORLD_MAX_Y - 1, WORLD_MAX_Y - 1];
    return [
      Math.max(WORLD_MIN_Y, Chunk.sectionMinY(minSection)),
      Math.min(WORLD_MAX_Y - 1, Chunk.sectionMinY(maxSection) + SECTION_HEIGHT * 2 - 1),
    ];
  }

  /**
   * 初始化一个区块的光照，并播种需要扩散的格子。
   * 相邻区块若已点亮，其接壤边界会一并重新入队，保证跨区块的光照连续。
   */
  initChunk(chunk: Chunk): void {
    const [minY, maxY] = LightEngine.verticalRange(chunk);

    this.fillSkyColumns(chunk, maxY);
    this.seedSelf(chunk, minY, maxY);

    for (const [dx, dz] of HORIZONTAL) {
      const neighbor = this.world.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (neighbor?.lit) this.seedBorder(neighbor, -dx, -dz);
    }

    chunk.lit = true;
  }

  /**
   * 竖直列扫描：从区块内容顶部往下推天光。
   * 说明：高于 maxY 的格子不参与计算（恒为全亮空气，网格化时不会读到），
   * 因此无需付出遍历整个世界高度的代价。
   */
  private fillSkyColumns(chunk: Chunk, maxY: number): void {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let level = 15;
        for (let y = maxY; y >= WORLD_MIN_Y; y--) {
          const opacity = blockDef(chunk.get(x, y, z)).lightOpacity;
          if (opacity >= 15) level = 0;
          else level = Math.max(0, level - opacity);
          chunk.setSkyLight(x, y, z, level);
          if (level === 0) break;
        }
      }
    }
  }

  /** 播种本区块：天光 > 1 的格子（可能在横向照亮邻居）+ 发光方块 */
  private seedSelf(chunk: Chunk, minY: number, maxY: number): void {
    const originX = chunk.cx * 16;
    const originZ = chunk.cz * 16;

    for (let y = minY; y <= maxY; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          if (chunk.getSkyLight(x, y, z) > 1) {
            this.skyQueue.push(originX + x, y, originZ + z);
          }
          const id = chunk.get(x, y, z);
          if (id !== 0) {
            const emit = blockDef(id).light;
            if (emit > 0) {
              chunk.setBlockLight(x, y, z, emit);
              this.blockQueue.push(originX + x, y, originZ + z);
            }
          }
        }
      }
    }
  }

  /**
   * 把 neighbor 朝向 (dirX, dirZ) 那一侧的边界列重新入队。
   * 用于新区块加载后，让邻区已有的光横向流进新区块。
   */
  private seedBorder(neighbor: Chunk, dirX: number, dirZ: number): void {
    const [minY, maxY] = LightEngine.verticalRange(neighbor);
    const originX = neighbor.cx * 16;
    const originZ = neighbor.cz * 16;

    // 取出朝向本区块的那一列（x 或 z 固定为 0 或 15）
    const fixedX = dirX === 1 ? 15 : 0;
    const fixedZ = dirZ === 1 ? 15 : 0;

    for (let y = minY; y <= maxY; y++) {
      for (let t = 0; t < 16; t++) {
        const x = dirX !== 0 ? fixedX : t;
        const z = dirZ !== 0 ? fixedZ : t;
        if (neighbor.getSkyLight(x, y, z) > 1) {
          this.skyQueue.push(originX + x, y, originZ + z);
        }
        if (neighbor.getBlockLight(x, y, z) > 0) {
          this.blockQueue.push(originX + x, y, originZ + z);
        }
      }
    }
  }

  /** 处理光照队列；返回是否仍有剩余工作 */
  process(budget: number): boolean {
    let steps = 0;
    while (steps < budget && this.spreadOnce(true)) steps++;
    while (steps < budget && this.spreadOnce(false)) steps++;
    this.compact();
    return this.hasWork;
  }

  private spreadOnce(isSky: boolean): boolean {
    const queue = isSky ? this.skyQueue : this.blockQueue;
    const head = isSky ? this.skyHead : this.blockHead;
    if (head >= queue.length) return false;

    const x = queue[head]!;
    const y = queue[head + 1]!;
    const z = queue[head + 2]!;
    if (isSky) this.skyHead += 3;
    else this.blockHead += 3;

    const level = isSky ? this.world.getSkyLight(x, y, z) : this.world.getBlockLight(x, y, z);
    if (level > 1) this.spread(level, x, y, z, isSky);
    return true;
  }

  private spread(level: number, x: number, y: number, z: number, isSky: boolean): void {
    for (const [dx, dy, dz] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
      if (!this.world.isLoaded(nx, nz)) continue;

      const opacity = blockDef(this.world.getBlock(nx, ny, nz)).lightOpacity;
      if (opacity >= 15) continue;

      let target = level - Math.max(1, opacity);
      // 竖直向下的直射天光不衰减
      if (isSky && dy === -1 && level === 15 && opacity === 0) target = 15;
      if (target <= 0) continue;

      if (isSky) {
        if (target > this.world.getSkyLight(nx, ny, nz)) {
          this.world.setSkyLight(nx, ny, nz, target);
          this.skyQueue.push(nx, ny, nz);
        }
      } else if (target > this.world.getBlockLight(nx, ny, nz)) {
        this.world.setBlockLight(nx, ny, nz, target);
        this.blockQueue.push(nx, ny, nz);
      }
    }
  }

  /** 回收已消费的队列头部，避免数组无限增长 */
  private compact(): void {
    if (this.skyHead > COMPACT_THRESHOLD) {
      this.skyQueue = this.skyQueue.slice(this.skyHead);
      this.skyHead = 0;
    }
    if (this.blockHead > COMPACT_THRESHOLD) {
      this.blockQueue = this.blockQueue.slice(this.blockHead);
      this.blockHead = 0;
    }
  }

  reset(): void {
    this.skyQueue = [];
    this.blockQueue = [];
    this.skyHead = 0;
    this.blockHead = 0;
  }
}
