/**
 * 世界原地重载的清单（联机34）
 *
 * 这条真正难的不是"清一个",而是"别漏"。清单是执行时的打勾表，所以这里钉住：
 * **无重复**（否则打勾两次也发现不了漏项）、**漏项能报出来**、**全处理时为空**。
 */

import { describe, expect, it } from 'vitest';
import {
  WORLD_RESET_TARGETS,
  isResetPlanComplete,
  missingResetTargets,
} from '../web/src/game/worldReset.ts';

describe('WORLD_RESET_TARGETS', () => {
  it('非空且每一项都是非空字符串', () => {
    expect(WORLD_RESET_TARGETS.length).toBeGreaterThan(20);
    for (const target of WORLD_RESET_TARGETS) {
      expect(typeof target).toBe('string');
      expect(target.length).toBeGreaterThan(0);
    }
  });

  it('没有重复项（重复会让"漏项"永远查不出来）', () => {
    expect(new Set(WORLD_RESET_TARGETS).size).toBe(WORLD_RESET_TARGETS.length);
  });

  it('覆盖几块最容易忘的：实体 / 联机镜像 / 时间', () => {
    const all = new Set<string>(WORLD_RESET_TARGETS);
    // 实体：不清会让旧生物站在新地形里
    expect(all.has('entities')).toBe(true);
    // 联机镜像：不清会让远端玩家停在旧坐标
    expect(all.has('remotePlayers')).toBe(true);
    // TNT 引信：不清会让旧引信在新世界炸
    expect(all.has('primedTnt')).toBe(true);
    // 时间：不清会继承上一局的时间
    expect(all.has('timeOfDay')).toBe(true);
  });
});

describe('missingResetTargets', () => {
  it('什么都没做时，整份清单都是漏的', () => {
    expect(missingResetTargets([])).toHaveLength(WORLD_RESET_TARGETS.length);
  });

  it('做了一半时只报剩下的', () => {
    const missing = missingResetTargets(['world', 'entities']);
    expect(missing).not.toContain('world');
    expect(missing).not.toContain('entities');
    expect(missing).toContain('chunkRenderer');
    expect(missing).toHaveLength(WORLD_RESET_TARGETS.length - 2);
  });

  it('不认识的项被忽略（执行路径里可能有额外动作）', () => {
    expect(missingResetTargets(['not-a-target'])).toHaveLength(WORLD_RESET_TARGETS.length);
  });

  it('全处理时为空，isResetPlanComplete 为 true', () => {
    expect(missingResetTargets(WORLD_RESET_TARGETS)).toEqual([]);
    expect(isResetPlanComplete(WORLD_RESET_TARGETS)).toBe(true);
    expect(isResetPlanComplete(['world'])).toBe(false);
  });
});
