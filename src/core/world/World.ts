/**
 * 世界管理器
 *
 * 职责：
 *  - 持有已加载区块（Map<"cx,cz", Chunk>）
 *  - 维护 Worker 池，按玩家位置流式请求/卸载区块
 *  - 提供世界坐标的方块读写入口（碰撞、射线、光照都依赖它）
 *
 * 区块 key 与坐标换算：区块 (cx, cz) 覆盖 worldX ∈ [cx*16, cx*16+16)。
 */

import { Chunk } from './Chunk.ts';
import { ChunkEdits } from '../save/ChunkEdits.ts';
import { BlockEntityStore } from './BlockEntityStore.ts';
import { Dimension, hasSkyLight, type DimensionId } from '../gen/Dimension.ts';
import { LightEngine } from '../light/LightEngine.ts';
import { blockDef } from '../registry/blocks.ts';
import { collisionBoxes } from '../registry/blockShapes.ts';
import type { VoxelCollision } from '../physics/AABB.ts';
import type { GenerateRequest, GenerateResponse } from '../../worker/chunk.worker.ts';

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** 世界坐标 → 区块坐标（对负数取向下取整） */
export function toChunkCoord(worldCoord: number): number {
  return worldCoord >> 4;
}

export interface WorldEvents {
  onChunkLoaded?: (chunk: Chunk) => void;
  onChunkUnloaded?: (cx: number, cz: number) => void;
  /** 方块被玩家修改（放置/破坏），渲染层据此重新网格化受影响的区块 */
  onBlockChanged?: (worldX: number, worldY: number, worldZ: number) => void;
  /** 区块加载时叠加了玩家改动（读档恢复时会大量触发） */
  onEditsApplied?: (cx: number, cz: number, count: number) => void;
}

export class World {
  readonly chunks = new Map<string, Chunk>();

  private readonly workers: Worker[] = [];
  private readonly loading = new Set<string>();
  private readonly pending = new Map<number, string>();
  /** 当前期望保留的区块集合，由 update() 维护 */
  private readonly wanted = new Set<string>();
  private nextId = 1;
  private roundRobin = 0;

  events: WorldEvents = {};

  /** 光照引擎 */
  readonly light: LightEngine;

  /** 当前维度 */
  dimension: DimensionId = Dimension.OVERWORLD;

  /**
   * 玩家对区块的修改（增量存档的基础，K1）。
   * 地形由种子重现，只有被玩家动过的格子需要落盘。
   */
  readonly edits = new ChunkEdits();

  /** 熔炉 / 箱子这类带内容的方块 */
  readonly containers = new BlockEntityStore();

  /** 已完成的生成任务数 / 已派发任务数，供加载进度显示 */
  completed = 0;
  dispatched = 0;

  /** 单条目的区块查询缓存：网格化/光照会大量按世界坐标连续取样，命中率极高 */
  private cacheCx = Number.NaN;
  private cacheCz = Number.NaN;
  private cacheChunk: Chunk | undefined = undefined;

  constructor(
    readonly seed: number,
    workerCount: number = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 1)),
  ) {
    this.light = new LightEngine(this);
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(new URL('../../worker/chunk.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', (event: MessageEvent<GenerateResponse>) => this.onGenerated(event.data));
      this.workers.push(worker);
    }
  }

  private onGenerated(data: GenerateResponse): void {
    const key = chunkKey(data.cx, data.cz);
    this.pending.delete(data.id);
    this.loading.delete(key);
    this.completed++;

    // 请求过程中玩家可能已经离开，丢弃过期结果
    if (!this.wanted.has(key)) return;

    const chunk = Chunk.fromData(data.cx, data.cz, new Uint16Array(data.blocks));
    if (data.states && data.states.byteLength > 0) chunk.adoptStates(new Uint8Array(data.states));
    // 叠加玩家改动（读档恢复 / 本次会话里改过的区块重新进出视野）：
    // 地形由种子重现，因此"生成结果 + 增量"必然还原出玩家看到的那个世界
    const editCount = this.edits.applyTo(this.dimension, data.cx, data.cz, chunk);
    if (editCount > 0) this.events.onEditsApplied?.(chunk.cx, chunk.cz, editCount);
    this.chunks.set(key, chunk);
    this.invalidateChunkCache();
    this.light.initChunk(chunk);
    this.events.onChunkLoaded?.(chunk);
  }

  /** 处理光照队列，返回是否仍有未完成的光照工作 */
  processLighting(budget: number): boolean {
    return this.light.process(budget);
  }

  private invalidateChunkCache(): void {
    this.cacheCx = Number.NaN;
    this.cacheCz = Number.NaN;
    this.cacheChunk = undefined;
  }

  /** 带单条目缓存的区块查询（比裸 Map 查询快很多，key 是字符串） */
  chunkAt(cx: number, cz: number): Chunk | undefined {
    if (cx === this.cacheCx && cz === this.cacheCz) return this.cacheChunk;
    this.cacheCx = cx;
    this.cacheCz = cz;
    this.cacheChunk = this.chunks.get(chunkKey(cx, cz));
    return this.cacheChunk;
  }

  /**
   * 根据玩家所在区块刷新加载范围。
   * @param radius 以区块为单位的半径
   */
  update(centerCx: number, centerCz: number, radius: number): void {
    const nextWanted = new Set<string>();

    // 由近及远派发，保证玩家脚下的地形最先出现
    const candidates: Array<{ cx: number; cz: number; d: number }> = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = centerCx + dx;
        const cz = centerCz + dz;
        const d = dx * dx + dz * dz;
        if (d > radius * radius + radius) continue;
        candidates.push({ cx, cz, d });
      }
    }
    candidates.sort((a, b) => a.d - b.d);

    for (const { cx, cz } of candidates) {
      const key = chunkKey(cx, cz);
      nextWanted.add(key);
      if (this.chunks.has(key) || this.loading.has(key)) continue;
      this.request(cx, cz);
    }

    // 卸载超出范围（多留 2 格缓冲，避免边界反复加载）的区块
    const keepRadius = radius + 2;
    for (const key of [...this.chunks.keys()]) {
      if (nextWanted.has(key)) continue;
      const chunk = this.chunks.get(key)!;
      if (Math.abs(chunk.cx - centerCx) <= keepRadius && Math.abs(chunk.cz - centerCz) <= keepRadius) continue;
      this.chunks.delete(key);
      this.wanted.delete(key);
      this.invalidateChunkCache();
      this.events.onChunkUnloaded?.(chunk.cx, chunk.cz);
    }

    this.wanted.clear();
    for (const key of nextWanted) this.wanted.add(key);
    // 已加载但仍在范围内的区块也要标记为 wanted
    for (const key of this.chunks.keys()) this.wanted.add(key);
  }

  private request(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    this.loading.add(key);
    this.dispatched++;

    const id = this.nextId++;
    this.pending.set(id, key);
    const worker = this.workers[this.roundRobin++ % this.workers.length]!;
    const message: GenerateRequest = { type: 'generate', id, cx, cz, seed: this.seed, dimension: this.dimension };
    worker.postMessage(message);
  }

  /**
   * 切换维度：清空已加载区块并让光照引擎重新按新维度播种。
   *
   * 为什么直接清空：两个维度的同坐标区块内容完全不同，保留会导致
   * "走到下界却看到主世界地形"。清空后 `update()` 会按玩家位置重新流式加载，
   * 另外卸载事件会把渲染层的网格与实体一并回收。
   */
  setDimension(dimension: DimensionId): void {
    if (dimension === this.dimension) return;
    for (const chunk of [...this.chunks.values()]) {
      this.events.onChunkUnloaded?.(chunk.cx, chunk.cz);
    }
    this.chunks.clear();
    this.loading.clear();
    this.pending.clear();
    this.wanted.clear();
    this.light.reset();
    this.light.setSkyEnabled(hasSkyLight(dimension));
    this.containers.clear();
    this.dimension = dimension;
    this.invalidateChunkCache();
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  isLoaded(worldX: number, worldZ: number): boolean {
    return this.chunkAt(toChunkCoord(worldX), toChunkCoord(worldZ)) !== undefined;
  }

  getBlock(worldX: number, worldY: number, worldZ: number): number {
    const chunk = this.chunkAt(toChunkCoord(worldX), toChunkCoord(worldZ));
    if (!chunk) return 0;
    return chunk.get(worldX & 15, worldY, worldZ & 15);
  }

  /** @returns 是否写入成功（区块未加载时返回 false） */
  setBlock(worldX: number, worldY: number, worldZ: number, id: number, state = 0): boolean {
    const chunk = this.chunkAt(toChunkCoord(worldX), toChunkCoord(worldZ));
    if (!chunk) return false;
    chunk.set(worldX & 15, worldY, worldZ & 15, id, state);
    return true;
  }

  /** 读取方块状态（朝向/上下半/开关等） */
  getBlockState(worldX: number, worldY: number, worldZ: number): number {
    const chunk = this.chunkAt(toChunkCoord(worldX), toChunkCoord(worldZ));
    if (!chunk) return 0;
    return chunk.getState(worldX & 15, worldY, worldZ & 15);
  }

  /** 该方块是否参与碰撞（粗判，非完整方块的精确检测走 collisionAt） */
  isSolid(worldX: number, worldY: number, worldZ: number): boolean {
    if (worldY < -64 || worldY >= 320) return false;
    return blockDef(this.getBlock(worldX, worldY, worldZ)).solid;
  }

  /**
   * 物理碰撞查询：完整方块返回 'full' 快路径，非完整方块返回局部盒子列表，
   * 无碰撞返回 null。
   */
  collisionAt(worldX: number, worldY: number, worldZ: number): VoxelCollision {
    if (worldY < -64 || worldY >= 320) return null;
    const id = this.getBlock(worldX, worldY, worldZ);
    if (id === 0) return null;

    const def = blockDef(id);
    if (!def.solid) return null;
    if (def.shape === 'cube') return 'full';

    const boxes = collisionBoxes(def.shape, this.getBlockState(worldX, worldY, worldZ));
    return boxes.length === 0 ? null : boxes;
  }

  /** 该方块是否为流体（水/岩浆） */
  isLiquid(worldX: number, worldY: number, worldZ: number): boolean {
    if (worldY < -64 || worldY >= 320) return false;
    return blockDef(this.getBlock(worldX, worldY, worldZ)).liquid;
  }

  /** 该方块是否阻挡射线（选取方块用） */
  isSelectable(worldX: number, worldY: number, worldZ: number): boolean {
    const def = blockDef(this.getBlock(worldX, worldY, worldZ));
    return def.id !== 0 && !def.liquid;
  }

  /**
   * 玩家修改方块：写入 + 增量光照更新 + 通知渲染层重网格化。
   * @returns 是否成功
   */
  setBlockAndUpdate(worldX: number, worldY: number, worldZ: number, id: number, state = 0): boolean {
    if (!this.setBlock(worldX, worldY, worldZ, id, state)) return false;
    if (worldY < -64 || worldY >= 320) return true;
    // 记进增量存档：只有"玩家动过"的格子需要落盘
    this.edits.record(this.dimension, toChunkCoord(worldX), toChunkCoord(worldZ), Chunk.index(worldX & 15, worldY, worldZ & 15), id, state);
    this.light.onBlockChanged(worldX, worldY, worldZ);
    this.events.onBlockChanged?.(worldX, worldY, worldZ);
    return true;
  }

  /**
   * 只修改方块状态（红石元件用：拉杆开关、红石灯亮灭、活塞伸出）。
   * 与 setBlockAndUpdate 一样会触发光照与重网格化——红石灯亮起来要换贴图也要发光。
   */
  setStateAndUpdate(worldX: number, worldY: number, worldZ: number, state: number): boolean {
    const chunk = this.chunkAt(toChunkCoord(worldX), toChunkCoord(worldZ));
    if (!chunk) return false;
    chunk.setState(worldX & 15, worldY, worldZ & 15, state);
    if (worldY < -64 || worldY >= 320) return true;
    this.edits.record(
      this.dimension,
      toChunkCoord(worldX),
      toChunkCoord(worldZ),
      Chunk.index(worldX & 15, worldY, worldZ & 15),
      chunk.get(worldX & 15, worldY, worldZ & 15),
      state,
    );
    this.light.onBlockChanged(worldX, worldY, worldZ);
    this.events.onBlockChanged?.(worldX, worldY, worldZ);
    return true;
  }

  // ---------------------------------------------------------------- 光照读写（世界坐标）

  getSkyLight(worldX: number, worldY: number, worldZ: number): number {
    const chunk = this.chunkAt(toChunkCoord(worldX), toChunkCoord(worldZ));
    if (!chunk) return 0;
    return chunk.getSkyLight(worldX & 15, worldY, worldZ & 15);
  }

  setSkyLight(worldX: number, worldY: number, worldZ: number, value: number): void {
    const chunk = this.chunkAt(toChunkCoord(worldX), toChunkCoord(worldZ));
    if (!chunk) return;
    chunk.setSkyLight(worldX & 15, worldY, worldZ & 15, value);
  }

  getBlockLight(worldX: number, worldY: number, worldZ: number): number {
    const chunk = this.chunkAt(toChunkCoord(worldX), toChunkCoord(worldZ));
    if (!chunk) return 0;
    return chunk.getBlockLight(worldX & 15, worldY, worldZ & 15);
  }

  setBlockLight(worldX: number, worldY: number, worldZ: number, value: number): void {
    const chunk = this.chunkAt(toChunkCoord(worldX), toChunkCoord(worldZ));
    if (!chunk) return;
    chunk.setBlockLight(worldX & 15, worldY, worldZ & 15, value);
  }

  /** 光照队列是否还有未完成的工作 */
  get hasLightWork(): boolean {
    return this.light.hasWork;
  }

  /** 光照队列里待处理的格子数（调试用） */
  get lightWorkCount(): number {
    return this.light.pendingCells;
  }

  get pendingCount(): number {
    return this.loading.size;
  }

  get isIdle(): boolean {
    return this.loading.size === 0;
  }

  /** 已点亮光照的区块数（调试用，低频调用） */
  get litChunkCount(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) if (chunk.lit) count++;
    return count;
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.chunks.clear();
    this.loading.clear();
    this.pending.clear();
    this.wanted.clear();
    this.light.reset();
    this.invalidateChunkCache();
  }
}
