/**
 * 联机种子对齐（联机5）
 *
 * 地形由种子纯函数重现，两边种子不同等于在两片不同的大陆上玩：坐标对得上、
 * 风景对不上，方块改动还会互相错位。这里测的是"什么时候算冲突"与"以服务端
 * 种子重载后清单项该长什么样"，落盘与重载动作在 `main.ts` / `boot()` 里。
 */

import { describe, expect, it } from 'vitest';
import { realignedWorldSummary, seedConflict } from '../src/core/net/SeedReconcile.ts';
import type { WorldSummary } from '../src/core/save/WorldRegistry.ts';

const world: WorldSummary = {
  id: 'w1',
  name: '我的世界',
  seed: 12345,
  worldType: 'default',
  createdAt: 1000,
  lastPlayed: 2000,
  playTime: 3600,
  edits: 80000,
  difficulty: 'normal',
  gameMode: 'survival',
};

describe('seedConflict', () => {
  it('种子一致：不冲突', () => {
    expect(seedConflict(12345, 12345)).toBeNull();
  });

  it('种子不同：报冲突并带两侧种子', () => {
    expect(seedConflict(777, 12345)).toEqual({ serverSeed: 777, localSeed: 12345 });
  });

  it('老服务端不带种子（null/undefined/NaN）：不算冲突', () => {
    expect(seedConflict(null, 12345)).toBeNull();
    expect(seedConflict(undefined, 12345)).toBeNull();
    expect(seedConflict(Number.NaN, 12345)).toBeNull();
  });

  it('0 也是合法种子（别用 falsy 判）', () => {
    expect(seedConflict(0, 0)).toBeNull();
    expect(seedConflict(0, 12345)).toEqual({ serverSeed: 0, localSeed: 12345 });
  });
});

describe('realignedWorldSummary', () => {
  it('换成服务端种子，旧地形的统计归零', () => {
    const next = realignedWorldSummary(world, 777, 9999);

    expect(next.seed).toBe(777);
    expect(next.edits).toBe(0);
    expect(next.playTime).toBe(0);
    expect(next.lastPlayed).toBe(9999);
  });

  it('id / 名字 / 世界类型 / 难度 / 模式都保留（玩家认的是这个世界）', () => {
    const next = realignedWorldSummary(world, 777, 9999);

    expect(next.id).toBe('w1');
    expect(next.name).toBe('我的世界');
    expect(next.worldType).toBe('default');
    expect(next.difficulty).toBe('normal');
    expect(next.gameMode).toBe('survival');
    expect(next.createdAt).toBe(1000);
  });

  it('不改原对象（清单靠引用比较，原地改会漏 persist）', () => {
    const next = realignedWorldSummary(world, 777, 9999);

    expect(next).not.toBe(world);
    expect(world.seed).toBe(12345);
  });

  it('可选字段（极限 / 单一群系）跟着带过去', () => {
    const hardcoreWorld: WorldSummary = {
      ...world,
      hardcore: true,
      worldType: 'single_biome',
      singleBiome: 'plains',
    };
    const next = realignedWorldSummary(hardcoreWorld, 5, 1);

    expect(next.hardcore).toBe(true);
    expect(next.worldType).toBe('single_biome');
    expect(next.singleBiome).toBe('plains');
  });
});
