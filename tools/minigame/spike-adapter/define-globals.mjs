/**
 * 适配器运行前的最小全局补丁（WX-006 spike）
 *
 * 小游戏原生有 `GameGlobal`，但用 esbuild 在浏览器/Node 里打包时没有；
 * 适配器 `index.js` 第一行就 `const global = GameGlobal`，缺了会直接 ReferenceError。
 */
if (typeof globalThis.GameGlobal === 'undefined') {
  globalThis.GameGlobal = globalThis;
}
