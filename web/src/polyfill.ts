/**
 * `Array.prototype.at()` 兜底。
 *
 * 只保留这一个，原因：项目的兼容基线是 **Chrome/WebView 88**（caniuse 口径覆盖 97.07%），
 * 而 `.at()` 要 Chrome 92 才有——为了 8 处用法把基线抬到 92 不划算，补个 10 行的 polyfill 更省。
 *
 * 其它曾在这里的 API 已按基线删掉：
 *  · `Object.fromEntries`（Chrome 73）  —— 88 基线原生支持
 *  · `Element.replaceChildren`（Chrome 86）—— 同上
 *
 * ⚠️ 必须做成模块、且被 `main.ts` 与 `chunk.worker.ts` **各自第一行**导入：
 * Worker 是独立的 JS 环境，主线程里的 polyfill 管不到它。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const scope = globalThis as any;

function at(this: { length: number; [index: number]: unknown }, index: number): unknown {
  const length = this.length >>> 0;
  const relative = Math.trunc(index) || 0;
  const resolved = relative >= 0 ? relative : length + relative;
  return resolved < 0 || resolved >= length ? undefined : this[resolved];
}

if (typeof scope.Array.prototype.at !== 'function') {
  Object.defineProperty(scope.Array.prototype, 'at', { value: at, writable: true, configurable: true });
}
if (typeof scope.String.prototype.at !== 'function') {
  Object.defineProperty(scope.String.prototype, 'at', { value: at, writable: true, configurable: true });
}

export {};
