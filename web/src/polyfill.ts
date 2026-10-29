/**
 * 老 WebView 缺的内置 API（2026-10-30 真机实测后加）。
 *
 * ## 为什么必须在模块里，而不是 index.html 的 `<script>`
 *
 * 主线程和 **Worker 是两套独立的 JS 环境**：`<script>` 只影响主线程，
 * Worker 里 `Object.fromEntries` 照样不存在（实测：worker 立刻抛
 * `Uncaught TypeError: Object.fromEntries is not a function`，区块永远生成不出来）。
 * 所以做成模块，`main.ts` 与 `chunk.worker.ts` 都在**第一行**导入它。
 *
 * ES 模块的求值顺序保证：第一个 import 的模块体先跑完，后面的依赖才求值。
 *
 * ## 为什么需要这些
 *
 * 目标设备实测 WebView 72（2019 年）。这些 API 是后来才有的：
 *  · `Object.fromEntries`   Chrome 73
 *  · `Array/String.prototype.at` Chrome 92
 *  · `Element.prototype.replaceChildren` Chrome 86（本项目用了 70+ 处）
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const globalScope = globalThis as any;

if (typeof globalScope.Object.fromEntries !== 'function') {
  globalScope.Object.fromEntries = function fromEntries(iterable: Iterable<[PropertyKey, unknown]>) {
    const out: Record<PropertyKey, unknown> = {};
    if (iterable == null) return out;
    for (const pair of iterable) out[pair[0]] = pair[1];
    return out;
  };
}

function at(this: { length: number; [index: number]: unknown }, index: number): unknown {
  const length = this.length >>> 0;
  const relative = Math.trunc(index) || 0;
  const resolved = relative >= 0 ? relative : length + relative;
  return resolved < 0 || resolved >= length ? undefined : this[resolved];
}

if (typeof globalScope.Array.prototype.at !== 'function') {
  Object.defineProperty(globalScope.Array.prototype, 'at', { value: at, writable: true, configurable: true });
}
if (typeof globalScope.String.prototype.at !== 'function') {
  Object.defineProperty(globalScope.String.prototype, 'at', { value: at, writable: true, configurable: true });
}

/**
 * `replaceChildren(...nodes)`：清空并塞入新子节点。
 *
 * 用的是 `while (firstChild) removeChild` 而不是 `innerHTML = ''`——
 * 后者会连带销毁事件监听与 canvas 上下文，行为与原生不一致。
 */
if (typeof globalScope.Element !== 'undefined' && typeof globalScope.Element.prototype.replaceChildren !== 'function') {
  const replaceChildren = function replaceChildren(this: Element, ...nodes: (Node | string)[]) {
    while (this.firstChild !== null) this.removeChild(this.firstChild);
    for (const node of nodes) {
      this.appendChild(typeof node === 'string' ? document.createTextNode(node) : node);
    }
  };
  Object.defineProperty(globalScope.Element.prototype, 'replaceChildren', {
    value: replaceChildren,
    writable: true,
    configurable: true,
  });
  if (typeof globalScope.Document !== 'undefined') {
    Object.defineProperty(globalScope.Document.prototype, 'replaceChildren', {
      value: replaceChildren,
      writable: true,
      configurable: true,
    });
  }
}

export {};
