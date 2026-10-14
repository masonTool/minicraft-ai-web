/**
 * 区块生成 Worker
 *
 * 把地形生成从主线程剥离，避免加载时卡顿。数据通过 Transferable 零拷贝回传。
 * 后续（P1 优化）网格化也会搬到这里，届时 Worker 需要自己维护一份区块副本以便跨区块取邻居。
 */

import { CHUNK_BLOCK_COUNT, generateChunkBlocks } from '../core/gen/TerrainGenerator.ts';

export interface GenerateRequest {
  type: 'generate';
  id: number;
  cx: number;
  cz: number;
  seed: number;
}

export interface GenerateResponse {
  type: 'generated';
  id: number;
  cx: number;
  cz: number;
  blocks: ArrayBuffer;
}

/** 避免依赖 WebWorker lib（会与 DOM lib 冲突），只声明用到的接口 */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<GenerateRequest>) => void): void;
}

const ctx = self as unknown as WorkerScope;

ctx.addEventListener('message', (event) => {
  const req = event.data;
  if (req.type !== 'generate') return;

  const blocks = generateChunkBlocks(req.cx, req.cz, req.seed, new Uint8Array(CHUNK_BLOCK_COUNT));

  const response: GenerateResponse = {
    type: 'generated',
    id: req.id,
    cx: req.cx,
    cz: req.cz,
    // 转移所有权：零拷贝交给主线程
    blocks: blocks.buffer as ArrayBuffer,
  };

  ctx.postMessage(response, [response.blocks]);
});
