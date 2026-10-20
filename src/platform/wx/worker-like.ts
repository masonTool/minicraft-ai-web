import type { WorkerLike } from '../../core/worker/WorkerLike.ts';
import type { WorkerHost } from '../types.ts';

/**
 * 把平台 `WorkerHost`（wx.createWorker 封装）适配成 `World` / `MeshWorkerPool`
 * 认识的浏览器 Worker 形状。
 *
 * `World` 与 `MeshWorkerPool` 可以共用同一个 `WorkerHost`：
 * 底层 worker 的 onMessage 只注册一次，这里做多订阅者分发。
 */
export function workerHostToLike(host: WorkerHost): WorkerLike {
  const listeners = new Set<(event: { data: any }) => void>();
  const unsubscribeHost = host.onMessage((data) => {
    for (const listener of listeners) listener({ data });
  });

  return {
    postMessage(message: unknown, transfer?: Transferable[]): void {
      // wx.postMessage 不支持 Transferable；第二个参数忽略
      host.post(message, transfer);
    },
    addEventListener(type: 'message', listener: (event: { data: any }) => void): void {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type: 'message', listener: (event: { data: any }) => void): void {
      if (type === 'message') listeners.delete(listener);
    },
    terminate(): void {
      listeners.clear();
      unsubscribeHost();
      host.terminate();
    },
  };
}
