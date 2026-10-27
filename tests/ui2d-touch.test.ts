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
import {
  TOUCH_ICON_NAMES,
  TOUCH_ICON_SHAPES,
  TOUCH_ICON_SCALE,
  shapeToSvgMarkup,
  touchIconSvgMarkup,
} from '../src/ui2d/touchArt.ts';

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


/**
 * 触控按钮的图标数据（`ui2d/touchArt.ts`）。
 *
 * 这六条路径现在**同时**供 DOM（拼 `<svg>`）与 canvas（`Path2D`）使用，所以钉两件事：
 * 每个名字都有形状（少一个 = 那颗按钮上什么都没有），以及两种拼法都非空且互不相同
 * （互不相同这条最实用：抄错图标时往往两个变成一模一样）。
 */
describe('触控图标共享数据', () => {
  it('六个名字都有形状（暂停是两条矩形，不必有 path）', () => {
    expect(TOUCH_ICON_NAMES.length).toBe(6);
    for (const name of TOUCH_ICON_NAMES) {
      expect(TOUCH_ICON_SHAPES[name].length).toBeGreaterThan(0);
    }
    // 六颗里至少四颗是描出来的路径（其余可以是矩形/圆，比如暂停的两条杠）
    const withPath = TOUCH_ICON_NAMES.filter((name) =>
      TOUCH_ICON_SHAPES[name].some((shape) => shape.kind === 'path'),
    );
    expect(withPath.length).toBeGreaterThanOrEqual(4);
  });

  it('两种拼法都非空，且六个图标互不相同', () => {
    const markups = TOUCH_ICON_NAMES.map((name) => touchIconSvgMarkup(name));
    for (const markup of markups) {
      expect(markup.startsWith('<svg')).toBe(true);
      expect(markup.length).toBeGreaterThan(60);
    }
    expect(new Set(markups).size).toBe(TOUCH_ICON_NAMES.length);
  });

  it('形状转 SVG 时保留 evenodd 与透明度（眼睛的虹膜、背包的前袋靠它们）', () => {
    expect(shapeToSvgMarkup({ kind: 'path', d: 'M0 0h1', evenodd: true })).toContain('fill-rule="evenodd"');
    expect(shapeToSvgMarkup({ kind: 'rect', x: 1, y: 2, w: 3, h: 4, alpha: 0.6 })).toContain('opacity="0.6"');
    expect(shapeToSvgMarkup({ kind: 'circle', cx: 1, cy: 2, r: 3 })).toBe('<circle cx="1" cy="2" r="3"/>');
  });

  it('图标占按钮直径的一半（与 `.touch-button svg` 的 CSS 一致）', () => {
    expect(TOUCH_ICON_SCALE).toBe(0.5);
  });
});
