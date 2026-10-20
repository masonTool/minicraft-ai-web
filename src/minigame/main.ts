/**
 * 微信小游戏正式入口（WX-020B）
 *
 * 与 Web 入口 `src/main.ts` 完全分开：
 *   - Web：`src/main.ts`（14k 行 App/UI，不进入小游戏包）
 *   - 小游戏：这里先注入 vendored 适配器，再启动 world-boot
 *
 * 不要在这个文件里静态 import `src/main.ts`，否则 esbuild 会把整套 Web UI
 * 打进小游戏主包（4MB 上限直接爆掉）。
 */

import '../platform/wx/bootstrap.ts';
import { detectPlatformKind } from '../platform/detect.ts';
import './world-boot.ts';

const kind = detectPlatformKind();
if (kind !== 'wx') {
  // 兜底：这个入口只给微信小游戏构建使用
  console.warn('[WX-020] minigame entry detected', kind, 'expected wx');
}
