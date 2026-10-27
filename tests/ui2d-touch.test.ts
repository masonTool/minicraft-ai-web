/**
 * 摇杆几何（`src/ui2d/Touch2D.ts`）
 *
 * 摇杆只有两件事会错，而且都只在手指下才会露馅：
 *  1. 芯子偏移算错 → 拇指还没到边，芯子先贴死（或反过来越出底座）；
 *  2. 夹取算错 → 斜着推的时候芯子跑到圆外面（看起来"从盘子里掉出去"）。
 * 两个都是纯函数，直接钉。
 */
import { describe, expect, it } from 'vitest';
import { clampKnobOffset, knobOffset } from '../src/ui2d/Touch2D.ts';

const base = { x: 100, y: 400, w: 120, h: 120 };
const knobAt = (cx: number, cy: number, size = 56) => ({ x: cx - size / 2, y: cy - size / 2, w: size, h: size });

describe('芯子偏移', () => {
  it('同心时为零', () => {
    expect(knobOffset(base, knobAt(160, 460))).toEqual({ dx: 0, dy: 0 });
  });

  it('按圆心差算（不是按左上角）', () => {
    // 底座圆心 (160,460)，芯子圆心 (190,430)
    expect(knobOffset(base, knobAt(190, 430))).toEqual({ dx: 30, dy: -30 });
  });

  it('芯子尺寸不同也不影响结果（只认圆心）', () => {
    expect(knobOffset(base, knobAt(190, 430, 40))).toEqual({ dx: 30, dy: -30 });
  });
});

describe('偏移夹取', () => {
  it('在允许范围内原样返回（内圈半径 = (底座 - 芯子) / 2）', () => {
    expect(clampKnobOffset(10, -12, 120, 56)).toEqual({ dx: 10, dy: -12 });
  });

  it('推到边界时按方向缩到最大半径（斜着推也是圆的，不是方的）', () => {
    // 半径上限 = (120 - 56) / 2 = 32
    const far = clampKnobOffset(100, 0, 120, 56);
    expect(far.dx).toBeCloseTo(32, 6);
    expect(far.dy).toBe(0);

    const diagonal = clampKnobOffset(100, 100, 120, 56);
    expect(Math.hypot(diagonal.dx, diagonal.dy)).toBeCloseTo(32, 6);
    // 方向不变
    expect(diagonal.dx).toBeCloseTo(diagonal.dy, 6);
  });

  it('非法输入回到居中（不能把芯子扔到 NaN）', () => {
    expect(clampKnobOffset(Number.NaN, 5, 120, 56)).toEqual({ dx: 0, dy: 0 });
    expect(clampKnobOffset(5, Number.POSITIVE_INFINITY, 120, 56)).toEqual({ dx: 0, dy: 0 });
  });

  it('芯子比底座还大时上限为 0（只能居中，不许越界）', () => {
    expect(clampKnobOffset(20, 20, 40, 56)).toEqual({ dx: 0, dy: 0 });
  });
});
