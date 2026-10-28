/**
 * 进房首包的方块增量压缩（用户 2026-10-26 批准的第 ② 条）。
 *
 * 两条契约：
 *  · 客户端与**服务端各写一份**编解码（TS / 纯 JS），必须能互通 —— 这里直接交叉验证；
 *  · 解码器面对"别的版本/坏数据"要**整体拒收**，不能解出半片错位地形。
 */
import { describe, expect, it } from 'vitest';
import { Chunk } from '../web/src/core/world/Chunk.ts';
import { EDIT_PACK_VERSION, decodeEditsPack, encodeEditsPack, packIndex, unpackIndex } from '../web/src/core/net/EditPack.ts';
// 服务端那份是纯 JS，vitest 直接 import 即可（就是要证明两套实现一致）
import { encodeEditsPack as encodeOnServer } from '../server/editpack.mjs';

const SAMPLE = [
  { x: 3, y: 70, z: 5, id: 1, state: 0, dimension: 'overworld' },
  { x: 4, y: 70, z: 5, id: 2, state: 3, dimension: 'overworld' },
  { x: -20, y: -60, z: 33, id: 10, state: 8, dimension: 'overworld' },
  // 别的维度的会被编码端丢掉（快照本来就按玩家维度筛过）
  { x: 3, y: 70, z: 5, id: 9, state: 0, dimension: 'nether' },
];

describe('packIndex / unpackIndex', () => {
  it('与 Chunk.index / Chunk.coordsAt 完全一致', () => {
    for (const [x, y, z] of [
      [0, -64, 0],
      [15, 319, 15],
      [3, 70, 5],
      [-20, -60, 33],
    ] as const) {
      const local = packIndex(x, y, z);
      expect(local).toBe(Chunk.index(((x % 16) + 16) % 16, y, ((z % 16) + 16) % 16));
      const back = unpackIndex(local);
      expect(back).toEqual({ x: ((x % 16) + 16) % 16, y, z: ((z % 16) + 16) % 16 });
    }
  });
});

describe('encodeEditsPack + decodeEditsPack', () => {
  it('客户端编解码往返：坐标/id/state/维度一个不差', () => {
    const pack = encodeEditsPack(SAMPLE, 'overworld');
    const back = decodeEditsPack(pack);
    expect(back).not.toBeNull();
    expect(back).toHaveLength(3);
    expect(back!.map((e) => [e[0], e[1], e[2], e[3], e[4], e[5]])).toEqual(
      SAMPLE.slice(0, 3).map((e) => [e.x, e.y, e.z, e.id, e.state, e.dimension]),
    );
  });

  it('按区块分组（同块的坐标只写一次，条目里是下标）', () => {
    const pack = encodeEditsPack(SAMPLE, 'overworld');
    // (3,5) 与 (4,5) 在同一个区块；(-20,33) 在另一个
    expect(pack.c).toHaveLength(2);
    expect(pack.c[0]![2].length % 3).toBe(0);
  });

  it('**服务端编码 → 客户端解码**必须还原（两套实现的契约）', () => {
    const pack = encodeOnServer(SAMPLE, 'overworld');
    const back = decodeEditsPack(pack);
    expect(back).not.toBeNull();
    expect(back!.map((e) => [e[0], e[1], e[2], e[3], e[4]])).toEqual(
      SAMPLE.slice(0, 3).map((e) => [e.x, e.y, e.z, e.id, e.state]),
    );
  });

  it('密集改动（同一片建筑）：体积降到四成左右', () => {
    // 真实场景里改动是**成片**的（一面墙、一块地、一条矿道），这也是压缩最有效的形态
    const many = Array.from({ length: 200 }, (_, i) => ({
      x: 100 + (i % 8),
      y: 60 + (i % 4),
      z: 200 + (Math.floor(i / 8) % 8),
      id: 1 + (i % 4),
      state: i % 2,
      dimension: 'overworld',
    }));
    const legacy = JSON.stringify(many.map((e) => [e.x, e.y, e.z, e.id, e.state, e.dimension]));
    const packed = JSON.stringify(encodeEditsPack(many, 'overworld'));
    expect(packed.length).toBeLessThan(legacy.length * 0.5);
  });

  it('零散改动（每条各在一个区块）：仍有约三成收益，不会反而变大', () => {
    // 每块只有一条时，"每块一个头"的开销最吃亏——这时候也必须比 JSON 小
    const sparse = Array.from({ length: 100 }, (_, i) => ({
      x: i * 16,
      y: 70,
      z: i * 16,
      id: 1,
      state: 0,
      dimension: 'overworld',
    }));
    const legacy = JSON.stringify(sparse.map((e) => [e.x, e.y, e.z, e.id, e.state, e.dimension]));
    const packed = JSON.stringify(encodeEditsPack(sparse, 'overworld'));
    expect(packed.length).toBeLessThan(legacy.length);
  });
});

describe('decodeEditsPack 拒收坏数据', () => {
  it('版本不认识 → null', () => {
    const pack = encodeEditsPack(SAMPLE, 'overworld');
    expect(decodeEditsPack({ ...pack, v: EDIT_PACK_VERSION + 1 })).toBeNull();
  });

  it('结构坏了（条目不是三的倍数 / 坐标不是整数）→ null', () => {
    expect(decodeEditsPack({ v: 1, d: 'overworld', c: [[0, 0, [5, 1]]] })).toBeNull();
    expect(decodeEditsPack({ v: 1, d: 'overworld', c: [[0.5, 0, [5, 1, 0]]] })).toBeNull();
  });

  it('不是对象 / 缺字段 → null', () => {
    expect(decodeEditsPack(null)).toBeNull();
    expect(decodeEditsPack('x')).toBeNull();
    expect(decodeEditsPack({ v: 1, c: [] })).toBeNull();
  });
});
