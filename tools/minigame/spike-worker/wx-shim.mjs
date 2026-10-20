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

function getWorker() {
  // 微信 worker 的全局对象叫 worker；部分工具里它只存在于作用域而不是 globalThis，
  // 还有的实现直接把 onMessage 挂在全局对象上。
  return (
    scope.worker ??
    (typeof worker !== 'undefined' ? worker : null) ??
    (typeof scope.onMessage === 'function' ? scope : null)
  );
}

// onMessage 的参数在不同基础库/工具里可能是消息本身，也可能是 { message }
function unwrapMessage(res) {
  if (!res || typeof res !== 'object') return res;
  const keys = Object.keys(res);
  if (keys.length === 1 && 'message' in res) return res.message;
  // 某些实现给的是 MessageEvent 形状 { data: payload }
  if (keys.length === 1 && 'data' in res) return res.data;
  return res;
}

// 无条件覆盖：即使宿主提供了同名函数，也走微信 worker 的 onMessage 通道
scope.self = scope;
console.log('[wx-worker] shim ready', Boolean(getWorker()));
scope.addEventListener = function (type, listener) {
  if (type !== 'message') return;
  const worker = getWorker();
  if (!worker || typeof worker.onMessage !== 'function') {
    throw new Error('微信 Worker 全局对象不可用：找不到 worker.onMessage');
  }
  worker.onMessage((res) => listener({ data: unwrapMessage(res) }));
};

scope.postMessage = function (message) {
  const worker = getWorker();
  if (!worker || typeof worker.postMessage !== 'function') {
    throw new Error('微信 Worker 全局对象不可用：找不到 worker.postMessage');
  }
  // 微信 worker 的消息是复制而不是 Transferable；第二个参数直接忽略
  worker.postMessage(message);
};
