/**
 * 联机时间向服务端收敛（联机10）
 *
 * 时间是 0..1 的环形量，这里最容易写错的就是"差值走短弧"（0.98 → 0.02 只差 0.04，
 * 不是 0.96）与"追赶限速"（不能一帧跳到目标，太阳会跳）。这两件事都能离线钉死。
 */

import { describe, expect, it } from 'vitest';
import {
  NET_TIME_CATCH_UP,
  NET_TIME_SNAP_EPSILON,
  normalizeTime,
  stepTimeOfDayToward,
  timeDelta,
  timeOfDayAt,
} from '../src/core/net/NetTime.ts';

describe('timeDelta 最短环形差', () => {
  it('普通差值就是减法', () => {
    expect(timeDelta(0.2, 0.5)).toBeCloseTo(0.3, 6);
    expect(timeDelta(0.5, 0.2)).toBeCloseTo(-0.3, 6);
  });

  it('跨午夜走短弧（0.98 → 0.02 是 +0.04，不是 -0.96）', () => {
    expect(timeDelta(0.98, 0.02)).toBeCloseTo(0.04, 6);
    expect(timeDelta(0.02, 0.98)).toBeCloseTo(-0.04, 6);
  });

  it('差值始终在 -0.5..0.5', () => {
    for (const [local, target] of [
      [0, 0.75],
      [0.75, 0],
      [0.1, 0.9],
      [0.9, 0.1],
    ] as const) {
      const delta = timeDelta(local, target);
      expect(Math.abs(delta)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('stepTimeOfDayToward 限速追赶', () => {
  it('差得远时每帧最多走 dt * 倍率', () => {
    const next = stepTimeOfDayToward(0, 0.5, 0.1);
    expect(next).toBeCloseTo(0.1 * NET_TIME_CATCH_UP, 6);
  });

  it('快追上时直接落到目标（不会冲过头）', () => {
    const target = 0.5;
    const next = stepTimeOfDayToward(target - 0.001, target, 1 / 60);
    expect(next).toBeCloseTo(target, 6);
  });

  it('足够近就对齐到目标值本身', () => {
    const target = 0.25;
    expect(stepTimeOfDayToward(target - NET_TIME_SNAP_EPSILON / 2, target, 1 / 60)).toBe(target);
  });

  it('跨午夜也是往短的那边走', () => {
    // 0.98 追 0.02：应该向前越过 1.0 落到 0.0x，而不是倒退到 0.9x
    const next = stepTimeOfDayToward(0.98, 0.02, 0.01);
    expect(next).toBeLessThan(0.05);
    // 再走一帧就落到目标上（0.04 的差距一共两步）
    expect(stepTimeOfDayToward(next, 0.02, 0.01)).toBeCloseTo(0.02, 6);
  });

  it('结果永远归一化在 [0, 1)', () => {
    for (const local of [0, 0.5, 0.999]) {
      for (const target of [0, 0.5, 0.999]) {
        const next = stepTimeOfDayToward(local, target, 1);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(1);
      }
    }
  });

  it('dt 为 0 时不动（暂停/掉帧时不能自己走）', () => {
    expect(stepTimeOfDayToward(0.3, 0.6, 0)).toBeCloseTo(0.3, 6);
  });
});

describe('normalizeTime / timeOfDayAt', () => {
  it('负数取模也能回到 [0, 1)', () => {
    expect(normalizeTime(-0.25)).toBeCloseTo(0.75, 6);
    expect(normalizeTime(1.25)).toBeCloseTo(0.25, 6);
  });

  it('服务端时间按"开局 + 经过时长"推算', () => {
    const dayMs = 20 * 60 * 1000;
    expect(timeOfDayAt(0, 0, dayMs)).toBeCloseTo(0.12, 6);
    // 过了 1/4 天：往后 0.25
    expect(timeOfDayAt(dayMs / 4, 0, dayMs)).toBeCloseTo(0.37, 6);
    // 过了整整一天应该回到开局时刻
    expect(timeOfDayAt(dayMs, 0, dayMs)).toBeCloseTo(0.12, 6);
  });

  it('一天长度非法时回落开局时刻（不返回 NaN）', () => {
    expect(timeOfDayAt(1234, 0, 0)).toBeCloseTo(0.12, 6);
  });
});
