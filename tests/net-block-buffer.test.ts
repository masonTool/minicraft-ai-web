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
import { applyRemoteBlock, planRemoteBlock, readEditRequest } from '../src/core/net/RemoteBlockWrite.ts';
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

/*
 * 落地顺序（L8 · MS2）：**先记增量、再写世界**。
 *
 * 顺序是有语义的：反过来的话，"写世界时抛异常 / 区块正好被卸载"这条路径上，
 * 改动只留在内存世界里，读档或重进区块就没了。以前这两步直接写在 `main.onNetBlock`
 * 里，谁调个位置都不会有测试红——现在顺序收在 `applyRemoteBlock` 里。
 */
describe('applyRemoteBlock 的落地顺序', () => {
  const edit = { x: 1, y: 70, z: 2, id: 3, state: 0, dimension: 'overworld' };

  function makeSink() {
    const calls: string[] = [];
    return {
      calls,
      sink: {
        record: () => calls.push('record'),
        apply: () => calls.push('apply'),
      },
    };
  }

  it('apply：先 record 再 apply，返回 true', () => {
    const { calls, sink } = makeSink();
    expect(applyRemoteBlock('apply', edit, sink)).toBe(true);
    expect(calls).toEqual(['record', 'apply']);
  });

  it('buffer：只 record，不碰世界（返回 false）', () => {
    const { calls, sink } = makeSink();
    expect(applyRemoteBlock('buffer', edit, sink)).toBe(false);
    expect(calls).toEqual(['record']);
  });

  it('drop：两个钩子都不调用（越界坐标不能进增量表）', () => {
    const { calls, sink } = makeSink();
    expect(applyRemoteBlock('drop', edit, sink)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('写世界抛异常时，增量已经记下了（顺序不能反）', () => {
    const calls: string[] = [];
    expect(() =>
      applyRemoteBlock('apply', edit, {
        record: () => calls.push('record'),
        apply: () => {
          calls.push('apply');
          throw new Error('渲染炸了');
        },
      }),
    ).toThrow('渲染炸了');
    expect(calls).toEqual(['record', 'apply']);
  });

  it('同格乱序 / 重复到达：增量表只留最后一稿（世界跟着最后一稿）', () => {
    const edits = new ChunkEdits();
    const writes: number[] = [];
    const sink = {
      record: (e: typeof edit) => recordRemote(edits, e.dimension, e.x, e.y, e.z, e.id, e.state),
      apply: (e: typeof edit) => writes.push(e.id),
    };
    applyRemoteBlock('apply', { ...edit, id: 5 }, sink);
    applyRemoteBlock('apply', { ...edit, id: 9 }, sink);
    applyRemoteBlock('apply', { ...edit, id: 7 }, sink);
    // 三次都写了世界（网络是按到达顺序覆盖），增量表里留下最后一稿
    expect(writes).toEqual([5, 9, 7]);
    // 同格只留一稿：`count` 是这一区块的改动**条数**，三次写同一格仍然是 1
    expect(edits.count('overworld', chunkCoord(1), chunkCoord(2))).toBe(1);
    // 用 `applyTo` 把增量叠进一个干净区块，最终值应为最后一稿（7）
    const chunk = new Chunk(chunkCoord(1), chunkCoord(2));
    edits.applyTo('overworld', chunkCoord(1), chunkCoord(2), chunk);
    expect(chunk.get(1 & 15, 70, 2 & 15)).toBe(7);
  });
});

/*
 * 从属端改动请求的载荷解析（L8 · MS2）
 *
 * 房主收到的是**别人**发来的东西：形状可能被改过。坏条目单独丢（与 `blocks` 同口径），
 * 数值范围不在这里判——那是 `planRemoteBlock` 的活。
 */
describe('readEditRequest', () => {
  it('blocks：整组读出（坐标截成整数）', () => {
    expect(readEditRequest({ t: 'blocks', blocks: [[1.7, 70, -2.2, 3, 0, 'overworld']] })).toEqual([
      { x: 1, y: 70, z: -2, id: 3, state: 0, dimension: 'overworld' },
    ]);
  });

  it('block：载荷是**一条**，不是一组', () => {
    expect(readEditRequest({ t: 'block', edit: [5, 64, 6, 1, 2, 'nether'] })).toEqual([
      { x: 5, y: 64, z: 6, id: 1, state: 2, dimension: 'nether' },
    ]);
  });

  it('坏条目单独丢：短数组 / 字符串坐标 / NaN', () => {
    const edits = readEditRequest({
      t: 'blocks',
      blocks: [
        [1, 70, 1, 1, 0, 'overworld'],
        [1, 70, 1],
        ['1', 70, 1, 1, 0, 'overworld'],
        [Number.NaN, 70, 1, 1, 0, 'overworld'],
        [2, 70, 2, 1, 0, 'overworld'],
      ],
    });
    expect(edits.map((edit) => edit.x)).toEqual([1, 2]);
  });

  it('不认识的类型 / 非数组：空列表（不抛异常）', () => {
    expect(readEditRequest({ t: 'nonsense' })).toEqual([]);
    expect(readEditRequest({ t: 'blocks' })).toEqual([]);
    expect(readEditRequest({ t: 'blocks', blocks: 'nope' })).toEqual([]);
  });

  it('维度名原样带出（合法性由调用方用 isDimension 收口）', () => {
    expect(readEditRequest({ t: 'blocks', blocks: [[1, 70, 1, 1, 0, '??']] })[0]?.dimension).toBe('??');
  });
});
