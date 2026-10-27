/**
 * canvas 文本输入的几何与编辑原语（`src/ui2d/textInput.ts`）
 *
 * 这一层真正难的是"和浏览器输入法对齐"（组合事件、软键盘、聚焦）——那只能在真机上验。
 * 离线能钉住的是**算得出来的部分**：光标画在哪、选区多宽、超宽时从第几个字开始画、
 * 退格删掉的是不是"一个字"（而不是半个代理对）。
 *
 * 用假 metrics（每字符 8px），断言里就能直接算数。
 */
import { describe, expect, it } from 'vitest';
import {
  TEXT_INPUT_BLINK_MS,
  TEXT_INPUT_CARET_WIDTH,
  applyInsert,
  backspaceAt,
  caretBlinkOn,
  caretRect,
  caretXOf,
  clampCaret,
  rangeRect,
  visibleSlice,
  type TextMetrics2D,
} from '../src/ui2d/textInput.ts';

/** 每字符固定 8px 的假指标（与真实字体无关，只为把算式写清楚） */
const metrics: TextMetrics2D = {
  font: '13px test',
  measure: (text: string) => text.length * 8,
};

const inner = { x: 100, y: 50, w: 80, h: 20 };

describe('光标位置', () => {
  it('第 0 / 中 / 末尾三个位置', () => {
    expect(caretXOf(metrics, 'abcdef', 0)).toBe(0);
    expect(caretXOf(metrics, 'abcdef', 3)).toBe(24);
    expect(caretXOf(metrics, 'abcdef', 6)).toBe(48);
  });

  it('越界与 NaN 都夹回来（不能让光标飞出输入框）', () => {
    expect(clampCaret(-3, 6)).toBe(0);
    expect(clampCaret(99, 6)).toBe(6);
    expect(clampCaret(Number.NaN, 6)).toBe(0);
    expect(clampCaret(2.7, 6)).toBe(2); // 小数截断，不四舍五入（否则会跳到下一个字前）
    expect(caretXOf(metrics, 'abc', 99)).toBe(24);
  });
});

describe('编辑原语', () => {
  it('在光标处插入', () => {
    expect(applyInsert('abcd', 2, 2, 'XY')).toEqual({ value: 'abXYcd', caret: 4 });
  });

  it('插入替换选区', () => {
    expect(applyInsert('abcd', 1, 3, 'Z')).toEqual({ value: 'aZd', caret: 2 });
  });

  it('退格：删光标前一个字', () => {
    expect(backspaceAt('abcd', 4, 4)).toEqual({ value: 'abc', caret: 3 });
  });

  it('退格：有选区时删整段', () => {
    expect(backspaceAt('abcdef', 1, 4)).toEqual({ value: 'aef', caret: 1 });
  });

  it('退格：光标在开头时什么都不做', () => {
    expect(backspaceAt('abc', 0, 0)).toEqual({ value: 'abc', caret: 0 });
  });

  it('退格按**码点**删，不会留下半个 emoji', () => {
    // "a😀" 在 JS 里长度是 3（emoji 是代理对）
    const result = backspaceAt('a😀', 3, 3);
    expect(result.value).toBe('a');
    expect(result.caret).toBe(1);
  });
});

describe('超宽时的可见窗口', () => {
  it('装得下就原样返回（不从左边裁）', () => {
    expect(visibleSlice(metrics, 'abcd', 4, 80)).toEqual({ start: 0, text: 'abcd' });
  });

  it('光标顶到右边界时开始滚，且光标可见', () => {
    const visible = visibleSlice(metrics, 'abcdefghij', 10, 40);
    expect(visible.start).toBe(5);
    // 光标在窗口里的位置 = 10-5 = 5 个字符 = 40px，正好贴右边界
    expect(caretXOf(metrics, visible.text, 10 - visible.start)).toBe(40);
  });

  it('光标在中间时窗口不滚（只在顶到右边界才动）', () => {
    expect(visibleSlice(metrics, 'abcdefghij', 3, 40).start).toBe(0);
  });

  it('宽度非法时不画字（返回空窗口）', () => {
    expect(visibleSlice(metrics, 'abc', 1, 0)).toEqual({ start: 0, text: '' });
  });
});

describe('矩形换算', () => {
  it('选区矩形从起点到终点', () => {
    const visible = { start: 0, text: 'abcdef' };
    expect(rangeRect(metrics, visible, inner, 1, 3)).toEqual({
      x: inner.x + 8,
      y: inner.y,
      w: 16,
      h: inner.h,
    });
  });

  it('空选区返回 null（不画一条 0 宽的线）', () => {
    expect(rangeRect(metrics, { start: 0, text: 'abc' }, inner, 2, 2)).toBeNull();
  });

  it('超出可见窗口的部分被裁掉', () => {
    const rect = rangeRect(metrics, { start: 4, text: 'ef' }, inner, 0, 6);
    expect(rect).toEqual({ x: inner.x, y: inner.y, w: 16, h: inner.h });
  });

  it('光标矩形有最小宽度，且竖直方向留了 2px 内边距', () => {
    const box = caretRect(metrics, { start: 0, text: 'abc' }, inner, 2);
    expect(box.x).toBe(inner.x + 16);
    expect(box.w).toBe(TEXT_INPUT_CARET_WIDTH);
    expect(box.y).toBe(inner.y + 2);
    expect(box.h).toBe(inner.h - 4);
  });
});

describe('光标闪烁', () => {
  it('一个周期前一半亮、后一半灭', () => {
    expect(caretBlinkOn(0)).toBe(1);
    expect(caretBlinkOn(TEXT_INPUT_BLINK_MS / 2 - 1)).toBe(1);
    expect(caretBlinkOn(TEXT_INPUT_BLINK_MS / 2)).toBe(0);
    expect(caretBlinkOn(TEXT_INPUT_BLINK_MS)).toBe(1);
  });

  it('时间非法时保持常亮（不要闪成"看不见"）', () => {
    expect(caretBlinkOn(Number.NaN)).toBe(1);
    expect(caretBlinkOn(100, 0)).toBe(1);
  });
});
