/**
 * 同材质 section 合并（N4，批次 608）
 *
 * 两个 section 各一个三角形 → 合并后一份几何、索引偏移正确、
 * 第二个 section 的 y 加上 baseY（16 格）。
 */

import { describe, expect, it } from 'vitest';
import { WORLD_MIN_Y } from '../src/core/world/Chunk.ts';
import { mergeSectionLayer } from '../src/render/ChunkRenderer.ts';
import type { GeometryArrays } from '../src/core/mesh/ChunkMesher.ts';

function triangle(y: number): GeometryArrays {
  return {
    position: new Float32Array([0, y, 0, 1, y, 0, 0, y, 1]),
    uv: new Float32Array([0, 0, 1, 0, 0, 1]),
    tile: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]),
    light: new Uint8Array([15, 15, 15, 15, 15, 15, 15, 15, 15]),
    shade: new Uint8Array([128, 128, 128]),
    index: new Uint32Array([0, 1, 2]),
  };
}

describe('section 几何合并', () => {
  it('顶点/索引拼成一份，索引按顶点偏移', () => {
    const merged = mergeSectionLayer([
      { section: 0, arrays: triangle(0) },
      { section: 1, arrays: triangle(0) },
    ])!;
    expect(merged.position.length).toBe(18);
    expect(merged.index.length).toBe(6);
    expect(Array.from(merged.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('第二个 section 的 y 加上 baseY（16 格）', () => {
    const merged = mergeSectionLayer([
      { section: 0, arrays: triangle(0) },
      { section: 1, arrays: triangle(0) },
    ])!;
    // 第一个三角形三个顶点 y = WORLD_MIN_Y；第二个 = WORLD_MIN_Y + 16
    expect(merged.position[1]).toBe(WORLD_MIN_Y);
    expect(merged.position[4]).toBe(WORLD_MIN_Y);
    expect(merged.position[10]).toBe(WORLD_MIN_Y + 16);
  });

  it('空输入返回 null', () => {
    expect(mergeSectionLayer([])).toBeNull();
  });
});
