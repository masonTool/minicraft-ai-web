/**
 * canvas 设置表单的几何（`src/ui2d/form.ts`）
 *
 * 只测纯函数（矩形、比例换算）：DOM 读取与写回要靠真浏览器，
 * 那部分由预览页 `tools/preview/form.html` 用真实 DOM 走一遍。
 */
import { describe, expect, it } from 'vitest';
import {
  FORM_CONTROL_WIDTH,
  FORM_ROW_GAP,
  FORM_ROW_HEIGHT,
  formContentHeight,
  formControlRect,
  formRatioFromX,
  formRowRects,
} from '../src/ui2d/form.ts';

describe('设置表单布局', () => {
  const list = { x: 40, y: 100, w: 420, h: 300 };

  it('每行等距往下排（行高 + 行距）', () => {
    const rows = formRowRects(list, 3);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ x: 40, y: 100, w: 420, h: FORM_ROW_HEIGHT });
    expect(rows[1]!.y - rows[0]!.y).toBe(FORM_ROW_HEIGHT + FORM_ROW_GAP);
  });

  it('内容总高包含行距（滚动上限靠它算）', () => {
    expect(formContentHeight(0)).toBe(0);
    expect(formContentHeight(3)).toBe(3 * (FORM_ROW_HEIGHT + FORM_ROW_GAP));
  });

  it('控件贴右边、宽度固定，行很短时自动收窄', () => {
    const row = { x: 0, y: 0, w: 420, h: FORM_ROW_HEIGHT };
    const control = formControlRect(row);
    expect(control.w).toBe(FORM_CONTROL_WIDTH);
    expect(control.x + control.w).toBe(row.w - 8);
    // 行宽 100 时控件不可能还占 104
    expect(formControlRect({ x: 0, y: 0, w: 100, h: FORM_ROW_HEIGHT }).w).toBe(76);
  });

  it('滑杆比例：左右端 0 / 1，越界夹住，NaN 当 0', () => {
    const control = { x: 100, y: 0, w: 200, h: 20 };
    expect(formRatioFromX(control, 100)).toBe(0);
    expect(formRatioFromX(control, 200)).toBeCloseTo(0.5, 6);
    expect(formRatioFromX(control, 300)).toBe(1);
    expect(formRatioFromX(control, 0)).toBe(0);
    expect(formRatioFromX(control, 999)).toBe(1);
    expect(formRatioFromX(control, Number.NaN)).toBe(0);
    expect(formRatioFromX({ x: 0, y: 0, w: 0, h: 20 }, 10)).toBe(0);
  });
});
