/**
 * 远端方块改动的缓冲（联机4）
 *
 * 原来的 bug：`onNetBlock` 一开头 `if (!isLoaded) return`，队友在你没加载的区块里
 * 改的方块被直接丢掉——你走过去看到的仍是种子重现的原始地形，只有重连才补。
 *
 * 现在的链路是「先记增量，区块加载时叠回去」，所以这里测两段：
 * ① `planRemoteBlock` 的三档判定（立刻写 / 只记增量 / 越界丢弃）；
 * ② `ChunkEdits.record → applyTo` 这个闭环本身（区块后来才生成时改动还在）。
 *
 * 不 import `World.ts`：它会 `new Worker(...)`，在 node 里跑不起来。区块坐标换算
 * 就按 `toChunkCoord` 的同一条式子（`>> 4`，负数向下取整）在这里重写一次。
 */

import { describe, expect, it } from 'vitest';
import { planRemoteBlock } from '../src/core/net/RemoteBlockWrite.ts';
import { ChunkEdits } from '../src/core/save/ChunkEdits.ts';
import { Chunk } from '../src/core/world/Chunk.ts';

/** 与 `World.toChunkCoord` 同一式：`>> 4` 对负数也是向下取整，`Math.floor` 的等价写法 */
function chunkCoord(worldCoord: number): number {
  return worldCoord >> 4;
}

/** 把一条远端改动记进增量表（与 `main.ts onNetBlock` 里那一句完全一致） */
function recordRemote(edits: ChunkEdits, dimension: string, x: number, y: number, z: number, id: number, state = 0): void {
  edits.record(dimension, chunkCoord(x), chunkCoord(z), Chunk.index(x & 15, y, z & 15), id, state);
}

describe('planRemoteBlock', () => {
  it('同维度且区块已加载：立刻写世界', () => {
    expect(planRemoteBlock('overworld', 'overworld', true, 70)).toBe('apply');
  });

  it('同维度但区块没加载：只记增量（等区块加载时 applyTo 补上）', () => {
    expect(planRemoteBlock('overworld', 'overworld', false, 70)).toBe('buffer');
  });

  it('别的维度：只记增量，等玩家切过去再补', () => {
    expect(planRemoteBlock('nether', 'overworld', true, 70)).toBe('buffer');
    expect(planRemoteBlock('end', 'nether', false, 70)).toBe('buffer');
  });

  it('y 越界直接丢弃（否则区块内下标会落到别的格子上）', () => {
    expect(planRemoteBlock('overworld', 'overworld', true, 320)).toBe('drop');
    expect(planRemoteBlock('overworld', 'overworld', true, -65)).toBe('drop');
    expect(planRemoteBlock('overworld', 'overworld', true, Number.NaN)).toBe('drop');
    // 边界内应当照常
    expect(planRemoteBlock('overworld', 'overworld', true, -64)).toBe('apply');
    expect(planRemoteBlock('overworld', 'overworld', true, 319)).toBe('apply');
  });
});

describe('远端改动进增量表后能被区块加载补上', () => {
  it('未加载区块里的改动，在区块后来生成时出现', () => {
    const edits = new ChunkEdits();
    // 玩家还没走到 (5, 70, -3)：区块 (0, -1) 没加载
    recordRemote(edits, 'overworld', 5, 70, -3, 1, 0);

    // 之后区块生成完，World.onGenerated 会做这一步
    const chunk = new Chunk(0, -1);
    const applied = edits.applyTo('overworld', 0, -1, chunk);

    expect(applied).toBe(1);
    expect(chunk.get(5, 70, 13)).toBe(1);
  });

  it('跨维度的改动不会叠到当前维度的区块上', () => {
    const edits = new ChunkEdits();
    recordRemote(edits, 'nether', 5, 70, -3, 1, 0);

    const overworldChunk = new Chunk(0, -1);
    expect(edits.applyTo('overworld', 0, -1, overworldChunk)).toBe(0);
    expect(overworldChunk.get(5, 70, 13)).toBe(0);

    const netherChunk = new Chunk(0, -1);
    expect(edits.applyTo('nether', 0, -1, netherChunk)).toBe(1);
    expect(netherChunk.get(5, 70, 13)).toBe(1);
  });

  it('同一格被改过多次：区块加载时是最后一稿', () => {
    const edits = new ChunkEdits();
    recordRemote(edits, 'overworld', 5, 70, -3, 1, 0);
    recordRemote(edits, 'overworld', 5, 70, -3, 2, 0);
    recordRemote(edits, 'overworld', 5, 70, -3, 0, 0); // 队友又挖回空气

    const chunk = new Chunk(0, -1);
    chunk.set(5, 70, 13, 1, 0); // 先给个"旧值"，确认会被覆盖
    edits.applyTo('overworld', 0, -1, chunk);

    expect(chunk.get(5, 70, 13)).toBe(0);
    expect(edits.count('overworld', 0, -1)).toBe(1);
  });

  it('方块状态一起还原（含水方块/楼梯不能只剩 id）', () => {
    const edits = new ChunkEdits();
    recordRemote(edits, 'overworld', 1, 64, 1, 5, 3);

    const chunk = new Chunk(0, 0);
    edits.applyTo('overworld', 0, 0, chunk);

    expect(chunk.get(1, 64, 1)).toBe(5);
    expect(chunk.getState(1, 64, 1)).toBe(3);
  });

  it('负坐标的区块键不会串（(-1,-1) 与 (0,0) 是两个区块）', () => {
    const edits = new ChunkEdits();
    recordRemote(edits, 'overworld', -1, 70, -1, 7, 0);

    const wrong = new Chunk(0, 0);
    expect(edits.applyTo('overworld', 0, 0, wrong)).toBe(0);

    const right = new Chunk(-1, -1);
    expect(edits.applyTo('overworld', -1, -1, right)).toBe(1);
    // -1 & 15 === 15
    expect(right.get(15, 70, 15)).toBe(7);
  });
});
