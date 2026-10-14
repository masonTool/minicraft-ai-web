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
   * 初始化天光。
   *
   * ⚠️ 高于 maxY 的格子必须也要写满级天光。
   * 曾经的实现只算到 maxY（理由是"那里的格子恒为空气、网格化读不到"），
   * 结果玩家一旦飞到地形之上搭建，那些格子读到的天光是 0，
   * 整片建筑与平台就会永远漆黑——这是实测踩到的 bug。
   */
  private fillSkyColumns(chunk: Chunk, maxY: number): void {
    // 地形之上的开放天空：整片区域都是空气，直接给满级
    for (let y = maxY + 1; y < WORLD_MAX_Y; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) chunk.setSkyLight(x, y, z, 15);
      }
    }

    // 从区块内容顶部往下逐列推天光
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

  /**
   * 某个方块发生变化后的增量光照更新。
   *
   * 相比"整块重算"，这里做的是局部修正：
   *  1. 用"光照移除 BFS"清掉该点及其下游依赖它的光（否则放上方块后光会从缝隙漏过去）；
   *  2. 若该点现在透光，重新从上方与四周汇聚光照；
   *  3. 把 6 个邻居重新入队，让它们重新扩散。
   * 队列由 process() 分帧消费，因此这里只做登记，不会阻塞。
   */
  onBlockChanged(worldX: number, worldY: number, worldZ: number): void {
    this.unlight(worldX, worldY, worldZ, true);
    this.unlight(worldX, worldY, worldZ, false);

    const def = blockDef(this.world.getBlock(worldX, worldY, worldZ));
    const opacity = def.lightOpacity;

    // ---- 方块光：自发光方块直接播种。
    // ⚠️ 这一步不能放在"透光"判断里面：荧石、南瓜灯这类方块是**不透光但自发光**的，
    // 若跟着 opacity<15 一起跳过，运行时放下荧石就不会亮（区块生成走的是另一条路径，所以不易察觉）。
    if (def.light > 0) {
      this.world.setBlockLight(worldX, worldY, worldZ, def.light);
      this.blockQueue.push(worldX, worldY, worldZ);
    } else if (opacity < 15) {
      let block = 0;
      for (const [dx, dy, dz] of DIRS) {
        const nx = worldX + dx;
        const ny = worldY + dy;
        const nz = worldZ + dz;
        if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
        if (!this.world.isLoaded(nx, nz)) continue;
        const neighbor = this.world.getBlockLight(nx, ny, nz) - Math.max(1, opacity);
        if (neighbor > block) block = neighbor;
      }
      if (block > 0) {
        this.world.setBlockLight(worldX, worldY, worldZ, block);
        this.blockQueue.push(worldX, worldY, worldZ);
      }
    }

    // ---- 天光：只有透光方块才可能存有天光
    if (opacity < 15) {
      const above = worldY + 1 >= WORLD_MAX_Y ? 15 : this.world.getSkyLight(worldX, worldY + 1, worldZ);
      let sky = 0;
      if (opacity === 0 && above === 15) sky = 15;
      else if (above > 0) sky = Math.max(0, above - Math.max(1, opacity));

      for (const [dx, dy, dz] of DIRS) {
        const nx = worldX + dx;
        const ny = worldY + dy;
        const nz = worldZ + dz;
        if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
        if (!this.world.isLoaded(nx, nz)) continue;
        const neighbor = this.world.getSkyLight(nx, ny, nz);
        if (neighbor <= sky) continue;
        const candidate = neighbor - Math.max(1, opacity);
        if (candidate > sky) sky = candidate;
      }

      if (sky > 0) {
        this.world.setSkyLight(worldX, worldY, worldZ, sky);
        this.skyQueue.push(worldX, worldY, worldZ);
      }
    }

    // ---- 邻居重新扩散：它们可能因为新增遮挡而需要变暗
    for (const [dx, dy, dz] of DIRS) {
      const nx = worldX + dx;
      const ny = worldY + dy;
      const nz = worldZ + dz;
      if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
      if (!this.world.isLoaded(nx, nz)) continue;
      if (this.world.getSkyLight(nx, ny, nz) > 1) this.skyQueue.push(nx, ny, nz);
      if (this.world.getBlockLight(nx, ny, nz) > 0) this.blockQueue.push(nx, ny, nz);
    }
  }

  /**
   * 光照移除 BFS：从 (worldX, worldY, worldZ) 开始，清掉所有"光来自这里"的格子。
   * 遇到比当前链更亮（说明是独立光源）的格子时，把它记到 reAdd 重新扩散。
   */
  private unlight(worldX: number, worldY: number, worldZ: number, isSky: boolean): void {
    const get = isSky
      ? (x: number, y: number, z: number) => this.world.getSkyLight(x, y, z)
      : (x: number, y: number, z: number) => this.world.getBlockLight(x, y, z);
    const set = isSky
      ? (x: number, y: number, z: number, v: number) => this.world.setSkyLight(x, y, z, v)
      : (x: number, y: number, z: number, v: number) => this.world.setBlockLight(x, y, z, v);

    const startLevel = get(worldX, worldY, worldZ);
    set(worldX, worldY, worldZ, 0);
    if (startLevel === 0) return;

    const removal: number[] = [worldX, worldY, worldZ, startLevel];
    const reAdd: number[] = [];

    while (removal.length > 0) {
      const level = removal.pop()!;
      const z = removal.pop()!;
      const y = removal.pop()!;
      const x = removal.pop()!;

      for (const [dx, dy, dz] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
        if (!this.world.isLoaded(nx, nz)) continue;

        const neighborLevel = get(nx, ny, nz);
        if (neighborLevel === 0) continue;

        // 天光竖直向下时水平保持 15，所以这里允许"相等"也算继承
        const inherited = isSky && dy === -1 && level === 15 ? 15 : level - 1;
        if (neighborLevel <= inherited) {
          set(nx, ny, nz, 0);
          removal.push(nx, ny, nz, neighborLevel);
        } else {
          reAdd.push(nx, ny, nz);
        }
      }
    }

    for (let i = 0; i < reAdd.length; i += 3) {
      const x = reAdd[i]!;
      const y = reAdd[i + 1]!;
      const z = reAdd[i + 2]!;
      if (isSky) this.skyQueue.push(x, y, z);
      else this.blockQueue.push(x, y, z);
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
