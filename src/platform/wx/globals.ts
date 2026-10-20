/**
 * 适配器要求运行前存在 `GameGlobal`。
 *
 * 微信小游戏自带；在浏览器/Node 里做离线检查时补一个，保证同一份代码能被打包和解析。
 * 这个文件必须比 `vendor/minigame-adapter/index.js` 先求值。
 */

const globalObject = globalThis as unknown as { GameGlobal?: unknown };

if (typeof globalObject.GameGlobal === 'undefined') {
  globalObject.GameGlobal = globalThis;
}
