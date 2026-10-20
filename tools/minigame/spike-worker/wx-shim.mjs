/**
 * 微信小游戏 Worker 全局 shim（WX-018）
 *
 * 浏览器 Worker 里是 `self.addEventListener('message')` / `self.postMessage(...)`；
 * 微信小游戏 Worker 暴露的是全局 `worker` 对象（`worker.onMessage` / `worker.postMessage`）。
 * 这里在加载真实 worker 代码之前，把 `self` / `addEventListener` / `postMessage` 补齐。
 *
 * ⚠️ 必须由 entry.mjs 先 import 本文件，再 import chunk.worker.ts；
 * ES module 的求值顺序能保证 shim 先跑。
 */

const scope = globalThis;

if (typeof scope.self === 'undefined') scope.self = scope;

if (typeof scope.addEventListener !== 'function') {
  scope.addEventListener = function (type, listener) {
    if (type !== 'message') return;
    const worker = scope.worker;
    if (!worker || typeof worker.onMessage !== 'function') {
      throw new Error('微信 Worker 全局对象不可用：找不到 worker.onMessage');
    }
    worker.onMessage((data) => listener({ data }));
  };
}

if (typeof scope.postMessage !== 'function') {
  scope.postMessage = function (message) {
    const worker = scope.worker;
    if (!worker || typeof worker.postMessage !== 'function') {
      throw new Error('微信 Worker 全局对象不可用：找不到 worker.postMessage');
    }
    // 微信 worker 的消息是复制而不是 Transferable；第二个参数直接忽略
    worker.postMessage(message);
  };
}
