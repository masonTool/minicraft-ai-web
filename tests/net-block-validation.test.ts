/**
 * 方块/容器消息的校验（联机24）
 *
 * 服务端原来只做 `Number.isFinite`：y 越界、方块 id 乱填、state 超 8 位、隔空改方块
 * 全都收。这里把四道闸逐条钉住，并**守住一个漂移风险**：`MAX_BLOCK_ID` 是写死在
 * 服务端的常量，客户端注册表一旦长过它，合法方块就会被服务端拒收。
 */

import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../src/core/registry/blocks.ts';
import {
  MAX_BLOCK_ID,
  MAX_BLOCK_STATE,
  MAX_EDIT_DISTANCE,
  WORLD_MAX_Y,
  WORLD_MIN_Y,
  blockEditRejection,
  withinEditReach,
} from '../server/node/protocol.mjs';

const player = { x: 0, y: 70, z: 0 };

describe('blockEditRejection', () => {
  it('正常改动通过', () => {
    expect(blockEditRejection(player, 10, 70, 10, 1, 0)).toBeNull();
  });

  it('y 超出世界高度被拒（越界的 y 会被算成别的格子）', () => {
    expect(blockEditRejection(player, 0, WORLD_MIN_Y - 1, 0, 1, 0)).toBe('y-range');
    expect(blockEditRejection(player, 0, WORLD_MAX_Y, 0, 1, 0)).toBe('y-range');
    // 边界本身是合法的
    expect(blockEditRejection(player, 0, WORLD_MIN_Y, 0, 1, 0)).toBeNull();
    expect(blockEditRejection(player, 0, WORLD_MAX_Y - 1, 0, 1, 0)).toBeNull();
  });

  it('方块 id 上界（不是精确白名单，只挡明显不是方块的）', () => {
    expect(blockEditRejection(player, 0, 70, 0, -1, 0)).toBe('id-range');
    expect(blockEditRejection(player, 0, 70, 0, MAX_BLOCK_ID + 1, 0)).toBe('id-range');
    expect(blockEditRejection(player, 0, 70, 0, MAX_BLOCK_ID, 0)).toBeNull();
  });

  it('state 只有 8 位', () => {
    expect(blockEditRejection(player, 0, 70, 0, 1, MAX_BLOCK_STATE + 1)).toBe('state-range');
    expect(blockEditRejection(player, 0, 70, 0, 1, MAX_BLOCK_STATE)).toBeNull();
  });

  it('离玩家太远被拒（隔空改主城）', () => {
    expect(blockEditRejection(player, MAX_EDIT_DISTANCE + 1, 70, 0, 1, 0)).toBe('distance');
    expect(blockEditRejection(player, MAX_EDIT_DISTANCE, 70, 0, 1, 0)).toBeNull();
  });

  it('非有限数被拒', () => {
    expect(blockEditRejection(player, Number.NaN, 70, 0, 1, 0)).toBe('not-finite');
    expect(blockEditRejection(player, 0, Number.POSITIVE_INFINITY, 0, 1, 0)).toBe('not-finite');
  });
});

describe('withinEditReach', () => {
  it('水平距离才算（上下挖矿是常事，垂直方向不限制）', () => {
    expect(withinEditReach({ x: 0, y: 70, z: 0 }, 0, 0)).toBe(true);
    // 垂直差异很大但水平在同一点：仍然允许
    expect(withinEditReach({ x: 0, y: 300, z: 0 }, 0, 0)).toBe(true);
  });

  it('没有玩家（未 join）一律不接受', () => {
    expect(withinEditReach(null, 0, 0)).toBe(false);
  });
});

describe('与客户端注册表的一致性', () => {
  it(`真实方块 id 都有余量（当前最大 < ${MAX_BLOCK_ID}）`, () => {
    const maxId = Math.max(...BLOCKS.map((block) => block.id));
    // 这条红了说明注册表长过了服务端上界——此时合法方块会被服务端拒收，
    // 必须同步调大 MAX_BLOCK_ID（不是改这条断言）
    expect(maxId).toBeLessThan(MAX_BLOCK_ID);
  });
});
