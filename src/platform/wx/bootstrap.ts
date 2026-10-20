/**
 * 微信小游戏平台启动（WX-010 起）
 *
 * 必须在 three 之前 import：适配器在模块求值时创建上屏 canvas 并注入
 * `window` / `document` / `canvas` / `navigator` / `localStorage` 等全局。
 *
 * 适配器已经 vendored 到 `vendor/minigame-adapter/`，并打过 WX-006 记录的补丁
 * （matchMedia、pointer 事件、visibilitychange、HTTP 脚本动态 require、Worker.addEventListener）。
 *
 * ⚠️ 这里的 `document` 仍然是假 DOM：没有布局、`getElementById` 返回占位节点。
 * 游戏/UI 代码只能通过 `src/platform/**` 使用平台能力，不要拿它当浏览器 DOM。
 */

import './globals.ts';
import '../../../vendor/minigame-adapter/index.js';

/** 注入后的全局对象（适配器把 window/document 挂在 globalThis 上） */
export const platformGlobal = globalThis as unknown as Record<string, any>;
export const platformWindow = platformGlobal.window as Record<string, any>;
export const platformDocument = platformGlobal.document as Record<string, any>;

/** 适配器是否已经注入（用于启动自检/日志） */
export function isWxAdapterReady(): boolean {
  return Boolean(platformDocument?.canvas && platformWindow?.matchMedia);
}
