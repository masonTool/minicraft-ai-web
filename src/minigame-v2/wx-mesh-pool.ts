import type { Platform } from '../platform/types.ts';
import type { MeshRequest, MeshResponse } from '../worker/chunk.worker.ts';

/**
 * 小程序真实 Worker 网格化池。
 *
 * ChunkRenderer 只依赖 `size`/`request`，这里用 platform.workers 的 WorkerHost
 * 替代浏览器 Web Worker；拿不到 wx.createWorker 时由调用方回退主线程。
 */
export class WxMeshWorkerPool {
  readonly size = 1;
  private readonly host;

  private readonly callbacks = new Map<number, (response: MeshResponse) => void>();
  private nextId = 1;

  constructor(platform: Platform) {
    this.host = platform.workers.create('workers/chunk.worker.js');
    this.host.onMessage((data: MeshResponse) => {
      if (!data || data.type !== 'meshed') return;
      const callback = this.callbacks.get(data.id);
      if (!callback) return;
      this.callbacks.delete(data.id);
      callback(data);
    });
  }

  request(
    cx: number,
    cz: number,
    chunks: MeshRequest['chunks'],
    _transfer: Transferable[],
    onDone: (response: MeshResponse) => void,
  ): void {
    const id = this.nextId++;
    this.callbacks.set(id, onDone);
    this.host.post({ type: 'mesh', id, cx, cz, chunks } satisfies MeshRequest);
  }
}
