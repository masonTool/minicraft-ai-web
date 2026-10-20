import type { WorkerLike } from '../core/worker/WorkerLike.ts';
import { handleWorkerRequest, type WorkerRequest } from '../worker/chunk.worker.ts';

/**
 * 主线程 Worker 降级（WX-020A）
 *
 * 某些预览环境（weixin-minigame-helper / 部分开发者工具版本）没有可用的
 * wx.createWorker 通道。这里用同一个 `handleWorkerRequest` 在宏任务里计算，
 * 让真实地形能出来；真机后续再切回 worker。
 *
 * 注意：生成/网格化会阻塞主线程，只用于验证与降级，不是最终性能方案。
 */
export function createMainThreadWorker(): WorkerLike {
  const listeners = new Set<(event: { data: any }) => void>();
  let closed = false;

  return {
    postMessage(message: unknown): void {
      if (closed) return;
      setTimeout(() => {
        if (closed) return;
        try {
          const { response } = handleWorkerRequest(message as WorkerRequest);
          for (const listener of listeners) listener({ data: response });
        } catch (error) {
          console.error('[main-worker] handle failed', error);
        }
      }, 0);
    },
    addEventListener(type: 'message', listener: (event: { data: any }) => void): void {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type: 'message', listener: (event: { data: any }) => void): void {
      if (type === 'message') listeners.delete(listener);
    },
    terminate(): void {
      closed = true;
      listeners.clear();
    },
  };
}
