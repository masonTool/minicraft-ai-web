/**
 * 快照裁剪与容量策略（联机14）
 *
 * 两件事：`welcome` 只发玩家附近的改动（否则跑久了的房间一进来就是几 MB），
 * 以及增量满了之后淘汰最旧的一条并告警（原来静默丢新改动，客户端完全不知道）。
 *
 * 逻辑在 `server/snapshot.mjs`——服务端只能跑 .mjs，所以不能放进 `src/` 的 TS 模块；
 * 这里直接 import 那个文件断言（vitest 用 esbuild 转译，不看 tsconfig 的 include）。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_EDITS,
  editsInChunk,
  SNAPSHOT_RADIUS_CHUNKS,
  chunkDistance,
  rememberEdit,
  selectSnapshotEdits,
} from '../server/snapshot.mjs';

const edit = (x: number, z: number, dimension = 'overworld', id = 1) => ({ x, y: 70, z, id, state: 0, dimension });

describe('chunkDistance', () => {
  it('同一区块是 0，相邻是 1', () => {
    expect(chunkDistance(0, 0, 15, 15)).toBe(0);
    expect(chunkDistance(0, 0, 16, 0)).toBe(1);
    expect(chunkDistance(0, 0, -1, 0)).toBe(1);
  });

  it('斜向取较大的那一侧（方形视距）', () => {
    expect(chunkDistance(0, 0, 32, 48)).toBe(3);
  });
});

describe('selectSnapshotEdits 裁剪', () => {
  const player = { x: 0, z: 0, dimension: 'overworld' };
  const radius = SNAPSHOT_RADIUS_CHUNKS;

  it(`半径 ${radius} 区块内保留、外面丢掉`, () => {
    const inside = edit(radius * 16 - 1, 0); // 第 radius 个区块里
    const outside = edit(radius * 16 + 16, 0); // 再往外一个区块
    const picked = selectSnapshotEdits([inside, outside], player);
    expect(picked).toEqual([inside]);
  });

  it('别的维度的改动不发（对当前世界没意义）', () => {
    const nether = edit(0, 0, 'nether');
    expect(selectSnapshotEdits([nether], player)).toEqual([]);
  });

  it('空表返回空表（新房间）', () => {
    expect(selectSnapshotEdits([], player)).toEqual([]);
  });

  it('按玩家自己的位置裁，不是按原点', () => {
    const far = edit(1000, 1000);
    expect(selectSnapshotEdits([far], { x: 1000, z: 1000, dimension: 'overworld' })).toEqual([far]);
    expect(selectSnapshotEdits([far], { x: 0, z: 0, dimension: 'overworld' })).toEqual([]);
  });
});

describe('rememberEdit 容量策略', () => {
  it('没满就直接存', () => {
    const map = new Map<string, object>();
    expect(rememberEdit(map, 'a', { id: 1 }, 3)).toBe('stored');
    expect(map.size).toBe(1);
  });

  it('满了淘汰最旧的一条，并把被淘汰的 key 报出去', () => {
    const map = new Map<string, object>();
    const evicted: string[] = [];
    for (const key of ['a', 'b', 'c']) rememberEdit(map, key, { key }, 3);
    expect(rememberEdit(map, 'd', { key: 'd' }, 3, (key) => evicted.push(key))).toBe('evicted');

    expect([...map.keys()]).toEqual(['b', 'c', 'd']);
    expect(evicted).toEqual(['a']);
    expect(map.size).toBe(3);
  });

  it('覆盖已有 key 不触发淘汰（只是更新，不占新位置）', () => {
    const map = new Map<string, object>();
    const evicted: string[] = [];
    for (const key of ['a', 'b', 'c']) rememberEdit(map, key, { key }, 3);
    expect(rememberEdit(map, 'a', { key: 'a', updated: true }, 3, (key) => evicted.push(key))).toBe('stored');

    expect(evicted).toEqual([]);
    // 位置不变：`a` 仍是最旧的，下次淘汰还是它
    expect([...map.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('默认上限是 20 万条', () => {
    // 2026-10-26：20 万 → 50 万（按视野补发之后，首包仍按半径裁剪，抬上限不抬首包）
    expect(DEFAULT_MAX_EDITS).toBe(500_000);
  });
});


/*
 * 按视野补发（2026-10-26）：快照只发玩家附近 8 个区块内的改动，更远的要等他走过去。
 * 这条纯函数决定"某一块里有哪些增量"，服务端在玩家跨区块时调它。
 */
describe('editsInChunk', () => {
  const list = [
    { x: 3, y: 70, z: 5, id: 1, state: 0, dimension: 'overworld', room: 'red' },
    { x: 20, y: 70, z: 5, id: 1, state: 0, dimension: 'overworld', room: 'red' },
    { x: 3, y: 70, z: 5, id: 1, state: 0, dimension: 'nether', room: 'red' },
    { x: 3, y: 70, z: 5, id: 1, state: 0, dimension: 'overworld', room: 'blue' },
  ];

  it('只挑同一房、同维度、同一区块的', () => {
    const found = editsInChunk(list, 'red', 'overworld', 0, 0);
    expect(found).toHaveLength(1);
    expect(found[0]!.x).toBe(3);
  });

  it('区块坐标按 >>4 算（x=20 落在第 1 块）', () => {
    expect(editsInChunk(list, 'red', 'overworld', 1, 0)).toHaveLength(1);
    expect(editsInChunk(list, 'red', 'overworld', 2, 0)).toHaveLength(0);
  });

  it('空表返回空数组（不抛）', () => {
    expect(editsInChunk([], 'red', 'overworld', 0, 0)).toEqual([]);
  });
});
