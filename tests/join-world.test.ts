/**
 * 加入房间时"本地要加载哪个世界"（L9）
 *
 * 加入的人不选世界：地形由房主的那个世界决定。但没有世界对象就进不去游戏，
 * 所以按房间的世界信息临时造一个。这里钉三件事：
 *  · 种子与**世界类型**都必须跟着房主（只对齐种子，超平坦 vs 默认仍是两片大陆）；
 *  · `id` 用 `mpjoin-<房间>`，不进世界清单，不会在列表里多出一个假世界；
 *  · 脏的 mode / difficulty / worldType 退回安全默认，不让 `undefined` 流进 WorldConfig。
 */

import { describe, expect, it } from 'vitest';
import { JOIN_WORLD_PREFIX, summaryFromRoom } from '../src/core/net/JoinWorld.ts';

const NOW = 1_700_000_000_000;

describe('summaryFromRoom', () => {
  it('种子与世界类型来自房主', () => {
    const world = summaryFromRoom(
      'redrock',
      { name: '草原小屋', seed: 424242, mode: 'creative', difficulty: 'hard', worldType: 'flat' },
      NOW,
    );
    expect(world.seed).toBe(424242);
    expect(world.worldType).toBe('flat');
    expect(world.gameMode).toBe('creative');
    expect(world.difficulty).toBe('hard');
  });

  it('id 带前缀与房间名（不进世界清单，也不与单机 id 撞车）', () => {
    const world = summaryFromRoom('redrock', { name: '', seed: 1 }, NOW);
    expect(world.id).toBe(`${JOIN_WORLD_PREFIX}redrock`);
  });

  it('房主没给世界名时用房间名顶上（状态栏要能写"你进的是谁的世界"）', () => {
    expect(summaryFromRoom('redrock', { name: '  ', seed: 1 }, NOW).name).toBe('redrock');
  });

  it('脏的 mode / difficulty / worldType 退回默认', () => {
    const world = summaryFromRoom(
      'r',
      { name: 'x', seed: 1, mode: 'nonsense', difficulty: 'nightmare', worldType: 'moon' },
      NOW,
    );
    expect(world.gameMode).toBe('survival');
    expect(world.difficulty).toBe('normal');
    expect(world.worldType).toBe('default');
  });

  it('新建的世界统计是干净的（0 分钟、0 改动）', () => {
    const world = summaryFromRoom('r', { name: 'x', seed: 1 }, NOW);
    expect(world.playTime).toBe(0);
    expect(world.edits).toBe(0);
    expect(world.createdAt).toBe(NOW);
  });
});
