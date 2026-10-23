/**
 * 区块加载后补建容器实体（联机33）
 *
 * 远端改动经增量表补上的区块里，漏斗/投掷器/发射器只有方块、没有容器表项——表现是
 * "看着是漏斗，就是不搬东西"。这里钉住"从增量里挑出该建容器的格子"这条逻辑：
 * 只挑容器、坐标换算对（含负区块）、非容器一律不碰。
 */

import { describe, expect, it } from 'vitest';
import { Chunk } from '../src/core/world/Chunk.ts';
import { packEdit, type SerializedEdits } from '../src/core/save/ChunkEdits.ts';
import { collectContainerSpawns } from '../src/core/save/EditSpawns.ts';

/** 手工拼一份 SerializedEdits（区块内坐标 → 打包值） */
function makeEdits(entries: { x: number; y: number; z: number; id: number; state?: number }[]): SerializedEdits {
  const indices = new Uint32Array(entries.length);
  const packed = new Uint32Array(entries.length);
  entries.forEach((entry, i) => {
    indices[i] = Chunk.index(entry.x, entry.y, entry.z);
    packed[i] = packEdit(entry.id, entry.state ?? 0);
  });
  return { indices, packed };
}

const HOPPER = 501;
const AIR = 0;
const isContainer = (id: number) => id === HOPPER;

describe('collectContainerSpawns', () => {
  it('只挑容器方块，非容器不建', () => {
    const data = makeEdits([
      { x: 1, y: 70, z: 1, id: HOPPER },
      { x: 2, y: 70, z: 1, id: AIR },
    ]);
    const spawns = collectContainerSpawns(0, 0, data, isContainer);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toEqual({ x: 1, y: 70, z: 1, id: HOPPER });
  });

  it('坐标换算到世界坐标（区块偏移）', () => {
    const data = makeEdits([{ x: 0, y: 64, z: 15, id: HOPPER }]);
    expect(collectContainerSpawns(2, 3, data, isContainer)[0]).toMatchObject({ x: 32, y: 64, z: 63 });
  });

  it('负区块坐标也对（-1 区块 → -16 起）', () => {
    const data = makeEdits([{ x: 15, y: 70, z: 15, id: HOPPER }]);
    expect(collectContainerSpawns(-1, -1, data, isContainer)[0]).toMatchObject({ x: -1, y: 70, z: -1 });
  });

  it('空增量返回空（绝大多数区块都没被改过）', () => {
    expect(collectContainerSpawns(0, 0, { indices: new Uint32Array(0), packed: new Uint32Array(0) }, isContainer)).toEqual(
      [],
    );
  });

  it('同一区块里多个容器都挑出来', () => {
    const data = makeEdits([
      { x: 0, y: 70, z: 0, id: HOPPER },
      { x: 5, y: 20, z: 9, id: HOPPER },
    ]);
    expect(collectContainerSpawns(0, 0, data, isContainer)).toHaveLength(2);
  });
});
