/**
 * 微信小游戏 Worker 入口（WX-018）
 *
 * import 顺序不能变：先 shim 全局，再加载真实的区块 Worker。
 */

import './wx-shim.mjs';
import '../../../src/worker/chunk.worker.ts';
