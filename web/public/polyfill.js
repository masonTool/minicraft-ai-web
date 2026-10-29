/**
 * 老 WebView 的内置 API 兜底（2026-10-30 真机实测后加）。
 *
 * ## 为什么需要它
 *
 * `vite.config.ts` 的 `build.target` 和 `tools/downlevel.mjs` 只处理**语法**，
 * 不管**内置函数**是否存在。实测一台 Android 9 的手机 WebView 停在 72.0.3626.121：
 *
 *   Uncaught (in promise) TypeError: Object.fromEntries is not a function
 *
 * 页面于是永远停在"加载中…"。缺的就是下面这几个（Chrome 73 / 92 才有的 API）。
 *
 * ## 为什么放在 public/ 而不是打进 bundle
 *
 * 它必须**早于**任何模块执行——打包进 bundle 也拦不住"模块解析阶段就用到"的情况，
 * 而 classic script 的顺序是确定的。文件保持 ES5 语法，老引擎才解析得了。
 */
(function () {
  if (typeof Object.fromEntries !== 'function') {
    Object.fromEntries = function fromEntries(iterable) {
      var out = {};
      if (iterable === null || iterable === undefined) return out;
      // 兼容 Map / 数组 / 任意可迭代对象
      var items = typeof iterable[Symbol.iterator] === 'function' ? iterable : [];
      var iterator = items[Symbol.iterator]();
      var step = iterator.next();
      while (!step.done) {
        var pair = step.value;
        // 与规范一致：键按 ToPropertyKey 处理（这里用字符串化近似 ES 的行为）
        out[pair[0]] = pair[1];
        step = iterator.next();
      }
      return out;
    };
  }

  function at(index) {
    var length = this.length >>> 0;
    var relative = Math.trunc(index) || 0;
    var resolved = relative >= 0 ? relative : length + relative;
    return resolved < 0 || resolved >= length ? undefined : this[resolved];
  }

  if (typeof Array.prototype.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', { value: at, writable: true, configurable: true });
  }
  if (typeof String.prototype.at !== 'function') {
    Object.defineProperty(String.prototype, 'at', { value: at, writable: true, configurable: true });
  }
})();
