/**
 * 区块增量 → 联机条目（用户 2026-10-26 懒上行）
 *
 * 服务端不再存世界之后，"队友走进某块时问房主要那一块"成了唯一的补发路径。
 * 这条链上最容易错的是**解包**：区块增量把坐标压成"区块内下标 + 打包值"，
 * 解错一格的表现是"邻居那栋楼缺一个角"，很难在现场看出来。
 * 所以这里逐条钉住：坐标、方块 id、状态位、维度名。
 */

import { describe, expect, it } from 'vitest';
import { ChunkEdits, packEdit } from '../web/src/core/save/ChunkEdits.ts';
import { Chunk } from '../web/src/core/world/Chunk.ts';
import { chunkSnapshotBlocks } from '../web/src/core/net/ChunkSnapshot.ts';

describe('chunkSnapshotBlocks', () => {
  it('没有附件（区块没改过）时回空列表——这是"这块没改动"的有效回答', () => {
    expect(chunkSnapshotBlocks(null, 'overworld', 3, 4)).toEqual([]);
  });

  it('空的增量表也回空列表', () => {
    const edits = new ChunkEdits();
    expect(chunkSnapshotBlocks(edits.serialize('overworld', 3, 4), 'overworld', 3, 4)).toEqual([]);
  });

  it('把区块增量解回世界坐标 + 方块 id + 状态位', () => {
    const edits = new ChunkEdits();
    // 世界 (500, 70, 500) 落在区块 (31, 31)，区块内坐标是 (4, 70, 4)
    edits.record('overworld', 31, 31, Chunk.index(4, 70, 4), 5, 0);
    // 再记一格带状态位的（楼梯朝向）：状态位必须原样带过去
    edits.record('overworld', 31, 31, Chunk.index(15, 64, 0), 118, 3);

    const blocks = chunkSnapshotBlocks(edits.serialize('overworld', 31, 31), 'overworld', 31, 31);

    expect(blocks).toHaveLength(2);
    expect(blocks).toContainEqual([500, 70, 500, 5, 0, 'overworld']);
    expect(blocks).toContainEqual([511, 64, 496, 118, 3, 'overworld']);
  });

  it('区块坐标必须加到局部坐标上（原点附近的房间看不出这个错）', () => {
    const edits = new ChunkEdits();
    edits.record('overworld', 100, -3, Chunk.index(0, 80, 15), 1, 0);
    const [entry] = chunkSnapshotBlocks(edits.serialize('overworld', 100, -3), 'overworld', 100, -3);
    // x = 100*16 + 0 = 1600；z = -3*16 + 15 = -33（负区块坐标也必须对）
    expect(entry?.[0]).toBe(1600);
    expect(entry?.[2]).toBe(-33);
  });

  it('条目形状与 blocks 消息一致（6 项，维度在末位）', () => {
    const edits = new ChunkEdits();
    edits.record('nether', 0, 0, Chunk.index(1, 50, 2), 1, 0);
    const [entry] = chunkSnapshotBlocks(edits.serialize('nether', 0, 0), 'nether', 0, 0);
    expect(entry).toHaveLength(6);
    expect(entry?.[5]).toBe('nether');
  });

  it('只解自己这一块：相邻区块的改动不会混进来', () => {
    const edits = new ChunkEdits();
    edits.record('overworld', 31, 31, Chunk.index(4, 70, 4), 5, 0);
    edits.record('overworld', 32, 31, Chunk.index(4, 70, 4), 6, 0);

    const blocks = chunkSnapshotBlocks(edits.serialize('overworld', 31, 31), 'overworld', 31, 31);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.[0]).toBe(500);
  });

  it('打包值与解出来的 id/state 能对上（与存档同一套位运算）', () => {
    const packed = packEdit(200, 17);
    expect(packed >>> 8).toBe(200);
    expect(packed & 0xff).toBe(17);
  });
});
