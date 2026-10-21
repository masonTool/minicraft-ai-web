/**
 * 区块生命周期状态（C5，批次 606）
 *
 * 状态只允许向前：empty → generating → generated → lit → meshed。
 * 网格可能早于光照，因此这里只断言“不倒退”，不强制每一步都出现。
 */

import { describe, expect, it } from 'vitest';
import { advanceChunkState, type ChunkState } from '../src/core/world/Chunk.ts';

describe('区块状态推进', () => {
  it('按顺序向前推进', () => {
    let state: ChunkState = 'empty';
    for (const next of ['generating', 'generated', 'lit', 'meshed'] as const) {
      state = advanceChunkState(state, next);
      expect(state).toBe(next);
    }
  });

  it('重复设置同一状态不变', () => {
    expect(advanceChunkState('lit', 'lit')).toBe('lit');
  });

  it('不允许倒退', () => {
    expect(advanceChunkState('meshed', 'lit')).toBe('meshed');
    expect(advanceChunkState('lit', 'generated')).toBe('lit');
    expect(advanceChunkState('generated', 'empty')).toBe('generated');
  });

  it('网格早于光照时停在 meshed，光照不会把它降级', () => {
    const meshed = advanceChunkState('generated', 'meshed');
    expect(meshed).toBe('meshed');
    expect(advanceChunkState(meshed, 'lit')).toBe('meshed');
  });
});
