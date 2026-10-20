/**
 * 微信小游戏 Worker 全局 shim（WX-018）
 *
 * 开发者工具里 `self` 是 WorkerGlobalScope，同时可能还存在微信的全局 `worker`。
 * 两者谁在传消息并不稳定，所以这里做**双通道**：
 *   - 同时监听原生 `self` 的 message 与 `worker.onMessage`；
 *   - 谁先收到消息就记成 activeChannel，回包只走同一条通道；
 *   - `self` 不存在时（真机上的 worker 全局）把 self/addEventListener/postMessage
 *     桥接到 worker。
 *
 * 注意：开发者工具的 `self` 是只读 getter，不能 `scope.self = scope`。
 *
 * ⚠️ 必须由 entry.mjs 先 import 本文件，再 import chunk.worker.ts。
 */

const scope = globalThis;

function getWorker() {
  return (
    scope.worker ??
    (typeof worker !== 'undefined' ? worker : null) ??
    (typeof scope.onMessage === 'function' ? scope : null)
  );
}

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

if (!scope.__wxWorkerShimInstalled) {
  scope.__wxWorkerShimInstalled = true;
  scope.__wxWorkerEntry = true;

  const worker = getWorker();
  const selfObject = getSelf();
  const nativeAdd =
    selfObject && typeof selfObject.addEventListener === 'function'
      ? selfObject.addEventListener.bind(selfObject)
      : null;
  const nativePost =
    selfObject && typeof selfObject.postMessage === 'function'
      ? selfObject.postMessage.bind(selfObject)
      : null;

  let activeChannel = null;
  let messageListener = null;

  const deliverFromWorker = (res) => {
    activeChannel = 'worker';
    if (messageListener) messageListener({ data: unwrapMessage(res) });
  };

  const deliverFromSelf = (event) => {
    activeChannel = 'self';
    if (messageListener) messageListener({ data: unwrapMessage(event?.data) });
  };

  const addEventListener = (type, listener) => {
    if (type !== 'message') {
      nativeAdd?.(type, listener);
      return;
    }
    messageListener = listener;
    if (nativeAdd) nativeAdd('message', deliverFromSelf);
    if (worker && typeof worker.onMessage === 'function') {
      try {
        worker.onMessage(deliverFromWorker);
      } catch (error) {
        console.error('[wx-worker] worker.onMessage 注册失败', error);
      }
    }
  };

  const postMessage = (message, transfer) => {
    if (activeChannel === 'worker') {
      worker?.postMessage(message);
      return;
    }
    if (activeChannel === 'self' && nativePost) {
      try {
        nativePost(message, transfer);
      } catch (error) {
        console.error('[wx-worker] self.postMessage 失败', error);
      }
      return;
    }
    // 还没收到过消息：两边都发，保证第一条 ping 能回来
    if (nativePost) {
      try {
        nativePost(message, transfer);
      } catch {
        /* 忽略 */
      }
    }
    if (worker && typeof worker.postMessage === 'function') {
      try {
        worker.postMessage(message);
      } catch {
        /* 忽略 */
      }
    }
  };

  const target = selfObject ?? scope;
  try {
    target.addEventListener = addEventListener;
    target.postMessage = postMessage;
  } catch (error) {
    console.error('[wx-worker] 无法安装双通道', error);
  }
  if (!selfObject) {
    try {
      scope.self = scope;
    } catch (error) {
      console.error('[wx-worker] 无法设置 self', error);
    }
  }

  console.log(
    '[wx-worker] dual',
    'nativeSelf=' + Boolean(nativeAdd),
    'worker=' + Boolean(worker),
    'self=' + Boolean(selfObject),
  );
}
