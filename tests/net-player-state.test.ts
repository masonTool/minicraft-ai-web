/**
 * 远端玩家外观状态（联机17）
 *
 * 网络 100ms 一条，而挥手只有 0.25 秒、受伤闪红 0.3 秒。这里钉住两条规则：
 * **边沿触发**（连续 swing:true 不续期，否则手一直举着）与**本地计时**（tick 递减）。
 */

import { describe, expect, it } from 'vitest';
import {
  REMOTE_ARMOR_SLOTS,
  REMOTE_HURT_SECONDS,
  REMOTE_SWING_SECONDS,
  RemoteAppearance,
  emptyAppearance,
  normalizeItemId,
} from '../src/core/net/RemoteAppearance.ts';

describe('normalizeItemId', () => {
  it('0 / 负数 / NaN / undefined 都当空手', () => {
    expect(normalizeItemId(0)).toBe(0);
    expect(normalizeItemId(-3)).toBe(0);
    expect(normalizeItemId(Number.NaN)).toBe(0);
    expect(normalizeItemId(undefined)).toBe(0);
  });

  it('正常 id 取整保留', () => {
    expect(normalizeItemId(7.8)).toBe(7);
    expect(normalizeItemId('12')).toBe(12);
  });
});

describe('RemoteAppearance 静态字段', () => {
  it('默认全空', () => {
    const appearance = new RemoteAppearance();
    expect(appearance.state).toEqual(emptyAppearance());
    expect(appearance.swinging).toBe(false);
    expect(appearance.hurt).toBe(false);
  });

  it('手持/副手/盔甲/状态直接覆盖', () => {
    const appearance = new RemoteAppearance();
    appearance.update({ held: 5, offhand: 6, armor: [1, 2, 3, 4], sneak: true, fire: true, ride: true, sleep: true });
    const state = appearance.state;
    expect(state.held).toBe(5);
    expect(state.offhand).toBe(6);
    expect(state.armor).toEqual([1, 2, 3, 4]);
    expect(state.sneaking).toBe(true);
    expect(state.onFire).toBe(true);
    expect(state.riding).toBe(true);
    expect(state.sleeping).toBe(true);
  });

  it('盔甲不足 4 件补 0、多了截掉（槽位顺序固定）', () => {
    const appearance = new RemoteAppearance();
    appearance.update({ armor: [9] });
    expect(appearance.state.armor).toEqual([9, 0, 0, 0]);

    appearance.update({ armor: [1, 2, 3, 4, 5, 6] });
    expect(appearance.state.armor).toEqual([1, 2, 3, 4]);
    expect(REMOTE_ARMOR_SLOTS).toHaveLength(4);
  });
});

describe('RemoteAppearance 动作计时', () => {
  it('swing 从 false 变 true 时开始计时', () => {
    const appearance = new RemoteAppearance();
    appearance.update({ swing: true });
    expect(appearance.swinging).toBe(true);
    expect(appearance.state.swingLeft).toBeCloseTo(REMOTE_SWING_SECONDS, 6);
  });

  it('连续 swing:true 不续期（否则手一直举着）', () => {
    const appearance = new RemoteAppearance();
    appearance.update({ swing: true });
    appearance.tick(0.1);
    const left = appearance.state.swingLeft;
    appearance.update({ swing: true }); // 网络下一条还是 true
    expect(appearance.state.swingLeft).toBeCloseTo(left, 6);
  });

  it('松开再挥会重新计时', () => {
    const appearance = new RemoteAppearance();
    appearance.update({ swing: true });
    appearance.tick(REMOTE_SWING_SECONDS + 0.01);
    expect(appearance.swinging).toBe(false);

    appearance.update({ swing: false });
    appearance.update({ swing: true });
    expect(appearance.swinging).toBe(true);
  });

  it('tick 递减到 0 就停（不会变负）', () => {
    const appearance = new RemoteAppearance();
    appearance.update({ swing: true, hurt: true });
    appearance.tick(1);
    expect(appearance.state.swingLeft).toBe(0);
    expect(appearance.state.hurtLeft).toBe(0);
    expect(appearance.swinging).toBe(false);
    expect(appearance.hurt).toBe(false);
  });

  it('受伤也是边沿触发 + 计时', () => {
    const appearance = new RemoteAppearance();
    appearance.update({ hurt: true });
    expect(appearance.hurt).toBe(true);
    expect(appearance.state.hurtLeft).toBeCloseTo(REMOTE_HURT_SECONDS, 6);

    appearance.tick(0.1);
    const left = appearance.state.hurtLeft;
    appearance.update({ hurt: true });
    expect(appearance.state.hurtLeft).toBeCloseTo(left, 6);
  });

  it('dt 为负时不加时间（暂停/时钟回拨保护）', () => {
    const appearance = new RemoteAppearance();
    appearance.update({ swing: true });
    appearance.tick(-5);
    expect(appearance.state.swingLeft).toBeCloseTo(REMOTE_SWING_SECONDS, 6);
  });

  it('reset 之后回到全空（远端玩家离开）', () => {
    const appearance = new RemoteAppearance();
    appearance.update({ held: 3, armor: [1, 1, 1, 1], swing: true, fire: true });
    appearance.reset();
    expect(appearance.state).toEqual(emptyAppearance());
  });
});
