/**
 * 网格化 Worker 池
 *
 * 与地形生成的 Worker 池分开：网格化是"每帧都可能派发"的短任务，
 * 生成是"加载时集中派发"的长任务，混在一起排队会互相拖慢。
 *
 * 池子只负责派发与回调路由，请求的过期判断交给调用方（ChunkRenderer 用
 * 递增序号判断"这个结果是不是已经作废了"）。
 */

import type { CreateWorker, WorkerLike } from '../core/worker/WorkerLike.ts';
import type { MeshRequest, MeshResponse } from '../worker/chunk.worker.ts';

export class MeshWorkerPool {
  private readonly workers: WorkerLike[] = [];
  private readonly callbacks = new Map<number, (response: MeshResponse) => void>();
  private roundRobin = 0;
  private nextId = 1;

  constructor(
    workerCount = 1,
    createWorker: CreateWorker = () =>
      new Worker(new URL('../worker/chunk.worker.ts', import.meta.url), { type: 'module' }),
  ) {
    const count = Math.max(1, workerCount);
    for (let i = 0; i < count; i++) {
      const worker = createWorker();
      worker.addEventListener('message', (event) => {
        const data = event.data as MeshResponse;
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
  ): void {
    const id = this.nextId++;
    this.callbacks.set(id, onDone);
    const worker = this.workers[this.roundRobin++ % this.workers.length]!;
    const message: MeshRequest = { type: 'mesh', id, cx, cz, chunks };
    worker.postMessage(message, transfer);
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.callbacks.clear();
  }
}
