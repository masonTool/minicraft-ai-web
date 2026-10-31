/**
 * 网格化 Worker 池
 *
 * 与地形生成的 Worker 池分开：网格化是"每帧都可能派发"的短任务，
 * 生成是"加载时集中派发"的长任务，混在一起排队会互相拖慢。
 *
 * 池子只负责派发与回调路由，请求的过期判断交给调用方（ChunkRenderer 用
 * 递增序号判断"这个结果是不是已经作废了"）。
 */

import type { MeshRequest, MeshResponse } from '../worker/chunk.worker.ts';

export class MeshWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly callbacks = new Map<number, (response: MeshResponse) => void>();
  private roundRobin = 0;
  private nextId = 1;

  constructor(workerCount = 1) {
    const count = Math.max(1, workerCount);
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('../worker/chunk.worker.ts', import.meta.url));
      worker.addEventListener('message', (event: MessageEvent<MeshResponse>) => {
        const data = event.data;
        if (data.type !== 'meshed') return;
        const callback = this.callbacks.get(data.id);
        if (!callback) return;
        this.callbacks.delete(data.id);
        callback(data);
      });
      this.workers.push(worker);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /**
   * @param chunks 中心区块 + 邻居的数据（buffer 会被转移，调用方不要再使用）
   * @param onDone 结果回调（对应 buffer 已零拷贝转移回来）
   */
  request(
    cx: number,
    cz: number,
    chunks: MeshRequest['chunks'],
    transfer: Transferable[],
    onDone: (response: MeshResponse) => void,
    /** 挖/放方块引起的重烘：只重烘 `sections`，或整列重烘但保留缓存（`keep`） */
    options?: { sections?: number[]; keep?: boolean },
  ): void {
    const id = this.nextId++;
    this.callbacks.set(id, onDone);
    // ⚠️ 编辑引起的重烘必须落在**同一个** Worker 上：它要复用这个 Worker 上一次留下的底。
    // 轮转发过去就会命中不了缓存，退化成整列重烘（不报错，只是慢）。
    const index = options ? this.workerFor(cx, cz) : this.roundRobin++ % this.workers.length;
    const worker = this.workers[index]!;
    const message: MeshRequest = { type: 'mesh', id, cx, cz, chunks };
    if (options?.sections) message.sections = options.sections;
    if (options?.keep) message.keep = true;
    // 贴图集合只在"这个 worker 还没收到当前版本"时随请求带一次（消息按序到达）
    if (this.opaqueTiles !== null && this.sentOpaque[index] !== this.opaqueVersion) {
      message.opaqueTiles = this.opaqueTiles;
      this.sentOpaque[index] = this.opaqueVersion;
    }
    worker.postMessage(message, transfer);
  }

  /** 区块 → Worker 的固定分配（按坐标哈希，保证同一区块永远同一个 Worker） */
  private workerFor(cx: number, cz: number): number {
    const h = (cx * 73856093) ^ (cz * 19349663);
    return (h >>> 0) % this.workers.length;
  }

  /** 全不透明贴图名变了（批次 20261030-2316）：下一条请求起各 worker 依次换上 */
  setOpaqueTiles(names: string[]): void {
    this.opaqueTiles = names;
    this.opaqueVersion++;
  }

  private opaqueTiles: string[] | null = null;
  private opaqueVersion = 0;
  private readonly sentOpaque: number[] = [];

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.callbacks.clear();
  }
}
