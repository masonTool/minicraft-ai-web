/**
 * 微信小游戏 Worker 全局 shim（WX-018）
 *
 * 两种运行环境：
 *   1. 开发者工具/浏览器 Worker：原生有 `self`（WorkerGlobalScope），
 *      自带 addEventListener/postMessage，直接用原生通道；
 *   2. 微信真机 Worker：全局对象是 `worker`，只有 worker.onMessage/postMessage，
 *      没有浏览器式的 self —— 这时才把 self/addEventListener/postMessage 桥接过去。
 *
 * 注意：开发者工具的 `self` 是只读 getter，直接 `scope.self = scope` 会抛
 * "Cannot set property self of #<WorkerGlobalScope> which has only a getter"。
 *
 * ⚠️ 必须由 entry.mjs 先 import 本文件，再 import chunk.worker.ts。
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

// onMessage 的参数在不同基础库/工具里可能是消息本身、{ message } 或 { data }
function unwrapMessage(res) {
  if (!res || typeof res !== 'object') return res;
  const keys = Object.keys(res);
  if (keys.length === 1 && 'message' in res) return res.message;
  if (keys.length === 1 && 'data' in res) return res.data;
  return res;
}

function getSelf() {
  try {
    return scope.self;
  } catch {
    return undefined;
  }
}

const selfObject = getSelf();
const nativeSelf =
  selfObject &&
  typeof selfObject.addEventListener === 'function' &&
  typeof selfObject.postMessage === 'function';

if (nativeSelf) {
  // 开发者工具/浏览器 Worker：不要覆盖原生 self，否则会破坏 devtools 的消息通道
  console.log('[wx-worker] mode native self');
} else {
  const worker = getWorker();

  const addEventListener = function (type, listener) {
    if (type !== 'message') return;
    if (!worker || typeof worker.onMessage !== 'function') {
      throw new Error('微信 Worker 全局对象不可用：找不到 worker.onMessage');
    }
    worker.onMessage((res) => listener({ data: unwrapMessage(res) }));
  };

  const postMessage = function (message) {
    if (!worker || typeof worker.postMessage !== 'function') {
      throw new Error('微信 Worker 全局对象不可用：找不到 worker.postMessage');
    }
    // 微信 worker 的消息是复制而不是 Transferable；第二个参数直接忽略
    worker.postMessage(message);
  };

  // 优先挂到 self 上（chunk.worker.ts 用的是 self）；self 不存在时挂到 globalThis
  const target = selfObject ?? scope;
  try {
    target.addEventListener = addEventListener;
    target.postMessage = postMessage;
  } catch (error) {
    console.error('[wx-worker] 无法在 self 上安装桥接', error);
  }
  if (target !== scope) {
    try {
      scope.addEventListener = addEventListener;
      scope.postMessage = postMessage;
    } catch {
      /* 只读全局属性：忽略 */
    }
  }
  if (!selfObject) {
    try {
      scope.self = scope;
    } catch (error) {
      console.error('[wx-worker] 无法设置 self', error);
    }
  }
  console.log('[wx-worker] mode bridge', Boolean(worker), Boolean(selfObject));
}
