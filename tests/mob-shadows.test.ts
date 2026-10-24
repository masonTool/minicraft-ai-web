/**
 * 影子抑制（联机38 的 ③）
 *
 * 两端各自生成生物：权威端上报"这只狼在 (10,64,3)"之后，非权威端的本地 AI 仍会
 * 自己再刷一只——玩家看到两只重叠的怪。这里钉住"收到上报就压住本地生成"，
 * 以及"上报断了要能自己过期"（否则那片区域永远不刷怪）。
 */

import { describe, expect, it } from 'vitest';
import { MobShadows, SHADOW_TTL_MS } from '../src/core/net/MobShadows.ts';

describe('MobShadows', () => {
  it('没收到过上报：不压（本地该正常刷怪）', () => {
    const shadows = new MobShadows();
    expect(shadows.isShadowed('1:5', 1000)).toBe(false);
  });

  it('收到上报后压住本地生成', () => {
    const shadows = new MobShadows();
    shadows.touch('1:5', 1000);
    expect(shadows.isShadowed('1:5', 1500)).toBe(true);
  });

  it('过了 TTL 就自动松开，并且条目被清掉', () => {
    const shadows = new MobShadows();
    shadows.touch('1:5', 1000);
    expect(shadows.isShadowed('1:5', 1000 + SHADOW_TTL_MS + 1)).toBe(false);
    expect(shadows.size).toBe(0);
  });

  it('重复上报会刷新时间（玩家在别处走动时，这只怪一直归他管）', () => {
    const shadows = new MobShadows();
    shadows.touch('1:5', 0);
    shadows.touch('1:5', SHADOW_TTL_MS);
    expect(shadows.isShadowed('1:5', SHADOW_TTL_MS * 2)).toBe(true);
  });

  it('按全局键隔离：两个人各自的 5 号互不影响', () => {
    const shadows = new MobShadows();
    shadows.touch('1:5', 0);
    expect(shadows.isShadowed('1:5', 100)).toBe(true);
    expect(shadows.isShadowed('2:5', 100)).toBe(false);
  });

  it('release 立刻松开（权威端退游戏，不能等 3 秒让玩家看见两份）', () => {
    const shadows = new MobShadows();
    shadows.touch('1:5', 0);
    shadows.release('1:5');
    expect(shadows.isShadowed('1:5', 10)).toBe(false);
  });

  it('prune 只清过期的，返回清掉几条', () => {
    const shadows = new MobShadows();
    shadows.touch('old', 0);
    shadows.touch('new', SHADOW_TTL_MS);
    expect(shadows.prune(SHADOW_TTL_MS + 1)).toBe(1);
    expect(shadows.size).toBe(1);
  });

  it('clear 清空（断线 / 切维度）', () => {
    const shadows = new MobShadows();
    shadows.touch('1:5', 0);
    shadows.clear();
    expect(shadows.size).toBe(0);
  });

  it('自定义 TTL 生效', () => {
    const fresh = new MobShadows();
    fresh.touch('1:5', 0);
    expect(fresh.isShadowed('1:5', 50, 100)).toBe(true);

    // 单独一个实例：上一次查询已经把过期条目删掉了，复用同一个会得到"从没收到过"
    const stale = new MobShadows();
    stale.touch('1:5', 0);
    expect(stale.isShadowed('1:5', 150, 100)).toBe(false);
  });
});
