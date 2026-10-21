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

function triangle(y: number, seed = 0): GeometryArrays {
  return {
    position: new Float32Array([0, y, 0, 1, y, 0, 0, y, 1]),
    uv: new Float32Array([0, 0, 1, 0, 0, 1]),
    // ⚠️ `aTile` / `aLight` 都是**每顶点 2 分量**（`createGeometry` 里就是 2）。
    // 这份测试以前按 3 分量造数据，正好和 `mergeSectionLayer` 的 `* 3` 笔误互相掩护。
    tile: new Float32Array(6).fill(seed),
    light: new Uint8Array(6).fill(seed),
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

  it('aTile / aLight 按每顶点 2 分量拼接，第二个 section 不错位', () => {
    // 回归守卫（批次 618）：两者曾经按 3 分量分配与写入，单个 section 时偏移为 0
    // 恰好正确；两个以上 section 时后面整段错位，顶点读到 0 → 方块表面纯黑
    const merged = mergeSectionLayer([
      { section: 0, arrays: triangle(0, 15) },
      { section: 1, arrays: triangle(0, 7) },
    ])!;
    expect(merged.tile.length).toBe(12);
    expect(merged.light.length).toBe(12);
    expect(Array.from(merged.tile)).toEqual([15, 15, 15, 15, 15, 15, 7, 7, 7, 7, 7, 7]);
    expect(Array.from(merged.light)).toEqual([15, 15, 15, 15, 15, 15, 7, 7, 7, 7, 7, 7]);
  });

  it('空输入返回 null', () => {
    expect(mergeSectionLayer([])).toBeNull();
  });
});
