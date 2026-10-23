/**
 * 广播的关注范围（联机27）
 *
 * 原来一条消息发给同房间所有人：A 改一格，5000 格外的 B 也收到。这里钉住"8 区块 +
 * 同维度"这条判据，以及两个容易写错的地方：**切比雪夫（方形）而不是欧氏**、**维度先判**。
 */

import { describe, expect, it } from 'vitest';
import { AOI_RADIUS_CHUNKS, withinAoi } from '../server/aoi.mjs';

const player = (x: number, z: number, dimension = 'overworld') => ({ x, y: 70, z, dimension });

describe('withinAoi', () => {
  it(`半径内收到、外面收不到（${AOI_RADIUS_CHUNKS} 区块 = 128 格）`, () => {
    const p = player(0, 0);
    expect(withinAoi(p, AOI_RADIUS_CHUNKS * 16 - 1, 0, 'overworld')).toBe(true);
    expect(withinAoi(p, AOI_RADIUS_CHUNKS * 16 + 16, 0, 'overworld')).toBe(false);
  });

  it('切比雪夫：对角线方向与正方向一样远（方形视野）', () => {
    const p = player(0, 0);
    // 对角 8 区块（128,128）：欧氏距离是 ~181 格（超过 128），切比雪夫是 8 区块 → 应该收到
    expect(withinAoi(p, 128, 128, 'overworld')).toBe(true);
    expect(withinAoi(p, 144, 144, 'overworld')).toBe(false);
  });

  it('维度不同一律不收到（主世界的方块不该发给下界的人）', () => {
    expect(withinAoi(player(0, 0, 'overworld'), 0, 0, 'nether')).toBe(false);
    expect(withinAoi(player(0, 0, 'nether'), 0, 0, 'nether')).toBe(true);
  });

  it('负坐标也按区块取整（-1 与 0 相邻）', () => {
    expect(withinAoi(player(-1, -1), 1, 1, 'overworld')).toBe(true);
  });

  it('非法坐标 / 缺玩家时不发', () => {
    expect(withinAoi(player(0, 0), Number.NaN, 0, 'overworld')).toBe(false);
    expect(withinAoi(null, 0, 0, 'overworld')).toBe(false);
  });
});
