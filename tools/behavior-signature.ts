/**
 * 方块行为签名（批次 20261025-0329 · 宿主2）
 *
 * 纯函数、无副作用：生成器（`gen-behavior-golden`）与测试（`behaviors-test`）共用同一份，
 * 否则"生成时怎么算"与"校验时怎么算"会慢慢漂，快照就失去意义了。
 *
 * 签名口径（**改动它会一次性地让全部快照失配**，所以要改就必须同时重生成快照并说明原因）：
 *   1. `stateTiles(state)`，state 取 0..15
 *   2. `faceTile(state, dir)`，state 取 0..15 × 六个外法线
 *   3. `stateLight(state)`，state 取 0..15
 * 按上面的顺序拼成多行文本，取 sha256 前 16 位。
 *
 * 为什么不是直接存输出：46 个方块 × 16 状态 × (1+6+1) ≈ 5900 条输出、约 130 KB，
 * 而哈希只占 2 KB；失配时能指名道姓说是哪个方块，已经够定位了。
 */

import { createHash } from 'node:crypto';
import type { BlockDef } from '../web/src/core/registry/blocks.ts';

/** 六个外法线（与网格化器 `FACES` 的 `dir` 同义） */
export const FACE_DIRS: readonly (readonly [number, number, number])[] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
];

/** 状态位是 4 位（0..15），全扫一遍就够；更多位也不会被这些方块读到 */
export const STATE_COUNT = 16;

export function hasBehavior(block: BlockDef): boolean {
  return block.stateTiles !== undefined || block.faceTile !== undefined || block.stateLight !== undefined;
}

/** 把一个方块的全部行为输出拍平成字符串数组（顺序即协议） */
export function behaviorSignature(block: BlockDef): string {
  const lines: string[] = [];
  for (let state = 0; state < STATE_COUNT; state++) {
    lines.push(block.stateTiles?.(state)?.join('|') ?? '-');
  }
  for (let state = 0; state < STATE_COUNT; state++) {
    for (const dir of FACE_DIRS) {
      lines.push(block.faceTile?.(state, dir) ?? '-');
    }
  }
  for (let state = 0; state < STATE_COUNT; state++) {
    lines.push(String(block.stateLight?.(state) ?? '-'));
  }
  return lines.join('\n');
}

export function behaviorHash(block: BlockDef): string {
  return createHash('sha256').update(behaviorSignature(block)).digest('hex').slice(0, 16);
}
