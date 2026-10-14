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

  /** 已完成的生成任务数 / 已派发任务数，供加载进度显示 */
  completed = 0;
  dispatched = 0;

  constructor(
    readonly seed: number,
    workerCount: number = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 1)),
  ) {
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

    const chunk = Chunk.fromData(data.cx, data.cz, new Uint8Array(data.blocks));
    this.chunks.set(key, chunk);
    this.events.onChunkLoaded?.(chunk);
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
    const message: GenerateRequest = { type: 'generate', id, cx, cz, seed: this.seed };
    worker.postMessage(message);
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  getBlock(worldX: number, worldY: number, worldZ: number): number {
    const chunk = this.chunks.get(chunkKey(toChunkCoord(worldX), toChunkCoord(worldZ)));
    if (!chunk) return 0;
    return chunk.get(worldX & 15, worldY, worldZ & 15);
  }

  /** @returns 是否写入成功（区块未加载时返回 false） */
  setBlock(worldX: number, worldY: number, worldZ: number, id: number): boolean {
    const chunk = this.chunks.get(chunkKey(toChunkCoord(worldX), toChunkCoord(worldZ)));
    if (!chunk) return false;
    chunk.set(worldX & 15, worldY, worldZ & 15, id);
    return true;
  }

  get pendingCount(): number {
    return this.loading.size;
  }

  get isIdle(): boolean {
    return this.loading.size === 0;
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.chunks.clear();
    this.loading.clear();
    this.pending.clear();
    this.wanted.clear();
  }
}
