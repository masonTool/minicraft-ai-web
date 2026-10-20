/**
 * Worker 的最小结构（WX-018/WX-020）
 *
 * `World` 与 `MeshWorkerPool` 只需要 postMessage / message 事件 / terminate，
 * 不关心宿主是浏览器 Worker 还是 wx.createWorker。
 *
 * 默认工厂仍在各自文件里用 `new Worker(new URL(...), { type: 'module' })`；
 * 小游戏入口传一个返回共享 wx worker 的工厂即可，Web 行为不变。
 */

export interface WorkerMessageEvent<T = any> {
  readonly data: T;
}

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: WorkerMessageEvent) => void): void;
  removeEventListener?(type: 'message', listener: (event: WorkerMessageEvent) => void): void;
  terminate(): void;
}

export type CreateWorker = () => WorkerLike;
