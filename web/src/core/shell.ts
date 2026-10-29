/**
 * "是不是跑在我们的原生壳里"。
 *
 * 三个壳（Android / iOS / 桌面）都会在 UA 末尾追加 `MinicraftTouch/1`。
 * 用 UA 而不是注入全局变量，是因为 UA 在任何脚本之前就可用，不需要和加载时序赛跑。
 *
 * 有两处依赖它：
 *   · 触屏判定（模拟器带鼠标时 `pointer: coarse` 不成立，会被判成 PC 版）
 *   · "是否已装成 App"（壳里不该弹"添加到主屏幕"的引导）
 */
const MARKER = /MinicraftTouch\/1/;

export function isNativeShell(): boolean {
  return typeof navigator !== 'undefined' && MARKER.test(navigator.userAgent);
}
