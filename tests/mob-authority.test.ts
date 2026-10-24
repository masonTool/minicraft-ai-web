/**
 * 生物同步的两个前置（联机38）：全局键 + 权威判定
 *
 * 位置同步还没接（下一轮），这里先把"这只生物是谁的""谁该模拟它"钉死——
 * 这两件判错，后面无论怎么传坐标都是错的。
 */

import { describe, expect, it } from 'vitest';
import {
  distanceSquared,
  isAuthority,
  mobKey,
  parseMobKey,
  pickAuthority,
  type AuthorityCandidate,
} from '../src/core/net/MobAuthority.ts';

describe('mobKey / parseMobKey', () => {
  it('拼出 ownerId:localId', () => {
    expect(mobKey(7, 3)).toBe('7:3');
  });

  it('反解回两个整数', () => {
    expect(parseMobKey('7:3')).toEqual({ ownerId: 7, localId: 3 });
  });

  it('两个人的 3 号不是同一只（这正是不用裸 localId 的原因）', () => {
    expect(mobKey(1, 3)).not.toBe(mobKey(2, 3));
  });

  it('坏输入返回 null：网络来的东西一律不可信', () => {
    for (const bad of ['', ':', '3', ':3', '3:', 'a:b', '1.5:2', '-1:2', '1:-2', '1:2:3']) {
      expect(parseMobKey(bad), bad).toBeNull();
    }
  });
});

describe('pickAuthority', () => {
  const mob = { x: 0, y: 64, z: 0 };

  it('最近的玩家赢', () => {
    const candidates: AuthorityCandidate[] = [
      { id: 1, x: 100, y: 64, z: 0 },
      { id: 2, x: 5, y: 64, z: 0 },
      { id: 3, x: 50, y: 64, z: 0 },
    ];
    expect(pickAuthority(mob, candidates)).toBe(2);
  });

  it('同距离时 id 小的赢（两端必须算出同一个答案）', () => {
    const candidates: AuthorityCandidate[] = [
      { id: 9, x: 3, y: 64, z: 0 },
      { id: 4, x: -3, y: 64, z: 0 },
    ];
    expect(pickAuthority(mob, candidates)).toBe(4);
    // 顺序反过来结论也一样
    expect(pickAuthority(mob, [...candidates].reverse())).toBe(4);
  });

  it('没人在线：没有权威（生物停在原地）', () => {
    expect(pickAuthority(mob, [])).toBeNull();
  });

  it('坐标是 NaN 的候选被跳过（坏包不该抢走权威）', () => {
    const candidates: AuthorityCandidate[] = [
      { id: 1, x: Number.NaN, y: 64, z: 0 },
      { id: 2, x: 10, y: 64, z: 0 },
    ];
    expect(pickAuthority(mob, candidates)).toBe(2);
  });

  it('三维距离都算（同一水平距离、不同高度）', () => {
    const candidates: AuthorityCandidate[] = [
      { id: 1, x: 5, y: 64, z: 0 },
      { id: 2, x: 0, y: 66, z: 0 },
    ];
    // 一个水平 5 格、一个垂直 2 格：垂直那个更近
    expect(pickAuthority(mob, candidates)).toBe(2);
  });
});

describe('isAuthority', () => {
  it('自己是最近的那个才是权威', () => {
    const candidates: AuthorityCandidate[] = [
      { id: 5, x: 1, y: 64, z: 0 },
      { id: 6, x: 30, y: 64, z: 0 },
    ];
    expect(isAuthority(5, { x: 0, y: 64, z: 0 }, candidates)).toBe(true);
    expect(isAuthority(6, { x: 0, y: 64, z: 0 }, candidates)).toBe(false);
  });

  it('不在候选里就不是权威', () => {
    expect(isAuthority(99, { x: 0, y: 64, z: 0 }, [{ id: 1, x: 0, y: 64, z: 0 }])).toBe(false);
  });
});

describe('distanceSquared', () => {
  it('是欧氏距离的平方', () => {
    expect(distanceSquared({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(25);
  });
});
