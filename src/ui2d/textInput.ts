/**
 * canvas 上的**文本输入**（`src/ui2d/` 阶段 3 的硬骨头：输入法）
 *
 * canvas 没有输入框，也**收不到中文输入法的组合态**。唯一的正路是：
 * 在 DOM 里放一个**看不见但可聚焦**的 `<input>` 承接所有输入（含输入法），
 * canvas 只做两件事 —— 把它的 `value` 画出来、把光标/选区/组合态画出来。
 *
 * 三条必须守住的（都是踩过的坑的形状）：
 *  1. **不能用 `display: none` / `visibility: hidden`**：那样元素拿不到焦点，
 *     移动端也不会弹软键盘。用 `opacity: 0` + 1×1 大小 + 固定在视口内。
 *  2. **`pointer-events: none`**：它只是"收字的管子"，不能让它在屏幕上拦住点击；
 *     聚焦靠调用方显式调 `focus()`。
 *  3. **组合态靠事件，不靠 `value`**：输入法拼音阶段 `value` 里已经有字母了，
 *     但"哪一段还在组合中"只有 `compositionstart/update/end` 知道 —— 下划线要画在
 *     那一段下面（原版也是这样），否则玩家看不出"还没上屏"。
 *
 * 与项目其它部分的关系：这一层**不认识任何游戏状态**，只把字符串交出去
 * （`onCommit`），像素与光标算在 `render()` 里。纯几何函数都在下面，可离线断言。
 */

import { cachedMeasure, drawText, uiFont } from './text.ts';
import { roundRectPath, type Rect } from './widgets.ts';

/** 字号与内边距（与 `#chat-entry` / `.world-input` 一个量级） */
export const TEXT_INPUT_FONT_SIZE = 13;
export const TEXT_INPUT_PADDING_X = 8;
/** 光标宽度与闪烁周期 */
export const TEXT_INPUT_CARET_WIDTH = 1;
export const TEXT_INPUT_BLINK_MS = 1000;

export const TEXT_INPUT_COLORS = {
  background: 'rgba(12, 13, 16, .82)',
  border: 'rgba(255, 255, 255, .28)',
  text: '#ffffff',
  placeholder: 'rgba(255, 255, 255, .38)',
  caret: '#ffffff',
  selection: 'rgba(96, 160, 255, .38)',
  composing: 'rgba(255, 255, 255, .75)',
} as const;

/** 量宽所需的最小上下文：字体串 + 量一个字符串的宽度 */
export interface TextMetrics2D {
  readonly font: string;
  measure(text: string): number;
}

/** 用真 canvas 上下文造一份指标（内部走 `cachedMeasure`，逐帧调用不会重复测量） */
export function metricsFor(ctx: CanvasRenderingContext2D, fontSize = TEXT_INPUT_FONT_SIZE): TextMetrics2D {
  const font = uiFont(fontSize);
  return { font, measure: (text: string) => (text.length === 0 ? 0 : cachedMeasure(ctx, text, font)) };
}

/** 第 `index` 个字符处的 x 偏移（相对文本起点） */
export function caretXOf(metrics: TextMetrics2D, text: string, index: number): number {
  const end = clampCaret(index, text.length);
  return end === 0 ? 0 : metrics.measure(text.slice(0, end));
}

/** 把光标位置夹进 `[0, length]`（越界/NaN 一律夹回来） */
export function clampCaret(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), Math.max(0, length));
}

/** 插入文本（替换 `[start, end)`），返回新串与新光标位置 */
export function applyInsert(
  value: string,
  start: number,
  end: number,
  insert: string,
): { value: string; caret: number } {
  const from = clampCaret(Math.min(start, end), value.length);
  const to = clampCaret(Math.max(start, end), value.length);
  const next = value.slice(0, from) + insert + value.slice(to);
  return { value: next, caret: from + insert.length };
}

/**
 * 退格：有选区删选区，没选区删光标前一个字符。
 *
 * ⚠️ 用 `Array.from` 按**码点**切，不要用 `slice(i - 1)`：emoji 与部分 CJK 扩展是
 * 代理对，切一半会留下半个字符（显示成方块，删两次才干净）。
 */
export function backspaceAt(value: string, start: number, end: number): { value: string; caret: number } {
  const from = clampCaret(Math.min(start, end), value.length);
  const to = clampCaret(Math.max(start, end), value.length);
  if (from !== to) return { value: value.slice(0, from) + value.slice(to), caret: from };
  if (from === 0) return { value, caret: 0 };
  const chars = Array.from(value.slice(0, from));
  chars.pop();
  const head = chars.join('');
  return { value: head + value.slice(from), caret: head.length };
}

/**
 * 文本超宽时的可见窗口：返回"从第几个字符开始画 + 该画的子串"。
 *
 * 规则：光标必须可见（窗口右端至少到光标），并且尽量少滚动 ——
 * 只在光标顶到右边界时才开始滚，滚到"光标刚好在最右边"。
 */
export function visibleSlice(
  metrics: TextMetrics2D,
  text: string,
  caret: number,
  maxWidth: number,
): { start: number; text: string } {
  const cursor = clampCaret(caret, text.length);
  if (!(maxWidth > 0) || text.length === 0) return { start: 0, text: '' };
  const caretPx = caretXOf(metrics, text, cursor);
  if (caretPx <= maxWidth) return { start: 0, text };
  // 从右侧往前吃，直到宽度装得下"到光标为止"的那一截
  let start = 0;
  for (let i = 1; i <= cursor; i++) {
    if (caretPx - caretXOf(metrics, text, i) <= maxWidth) {
      start = i;
      break;
    }
  }
  return { start, text: text.slice(start) };
}

/** 某段字符在输入框里的矩形（选区/组合态下划线共用） */
export function rangeRect(
  metrics: TextMetrics2D,
  visible: { start: number; text: string },
  inner: Rect,
  from: number,
  to: number,
): Rect | null {
  const a = clampCaret(Math.min(from, to), visible.start + visible.text.length);
  const b = clampCaret(Math.max(from, to), visible.start + visible.text.length);
  if (b <= visible.start || a === b) return null;
  const startLocal = Math.max(0, a - visible.start);
  const endLocal = Math.max(0, b - visible.start);
  const x0 = metrics.measure(visible.text.slice(0, startLocal));
  const x1 = metrics.measure(visible.text.slice(0, endLocal));
  return { x: inner.x + x0, y: inner.y, w: Math.max(1, x1 - x0), h: inner.h };
}

/** 光标矩形（1px 竖线；宽度小到 0 时给 1px 保证看得见） */
export function caretRect(
  metrics: TextMetrics2D,
  visible: { start: number; text: string },
  inner: Rect,
  caret: number,
): Rect {
  const local = Math.max(0, clampCaret(caret, visible.start + visible.text.length) - visible.start);
  const x = inner.x + metrics.measure(visible.text.slice(0, local));
  return { x, y: inner.y + 2, w: TEXT_INPUT_CARET_WIDTH, h: Math.max(1, inner.h - 4) };
}

/** 光标此刻该不该亮（1s 一个周期，前一半亮） */
export function caretBlinkOn(nowMs: number, period = TEXT_INPUT_BLINK_MS): number {
  if (!Number.isFinite(nowMs) || !(period > 0)) return 1;
  return nowMs % period < period / 2 ? 1 : 0;
}

export interface TextInputOptions {
  readonly fontSize?: number;
  readonly placeholder?: string;
  readonly maxLength?: number;
  /** 回车提交（Enter）；拿到的就是最终字符串 */
  readonly onCommit?: (value: string) => void;
  /** Esc 取消 */
  readonly onCancel?: () => void;
}

/**
 * 一块可输入的 canvas 区域。
 *
 * 用法：
 * ```ts
 * const field = new CanvasTextInput(document.body, { placeholder: '世界名称', onCommit: (v) => setName(v) });
 * // 点在某块矩形上时：
 * field.open(currentName);          // 它会聚焦隐藏 input（移动端会弹键盘）
 * // 每帧：
 * field.render(ctx, rect);
 * ```
 */
export class CanvasTextInput {
  /** 隐藏的收字管子（调试/测试可以读它的 value） */
  readonly element: HTMLInputElement;
  private opened = false;
  private composing = '';
  private placeholder: string;
  private readonly maxLength: number;
  private readonly fontSize: number;
  private readonly onCommit?: (value: string) => void;
  private readonly onCancel?: () => void;
  private readonly cleanups: (() => void)[] = [];

  constructor(host: HTMLElement, options: TextInputOptions = {}) {
    this.placeholder = options.placeholder ?? '';
    this.maxLength = options.maxLength ?? 0;
    this.fontSize = options.fontSize ?? TEXT_INPUT_FONT_SIZE;
    this.onCommit = options.onCommit;
    this.onCancel = options.onCancel;

    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-hidden', 'true');
    /*
     * 1×1、透明、固定在视口内：`display: none` / `visibility: hidden` 都拿不到焦点，
     * iOS 与安卓也**不会弹软键盘**；`pointer-events: none` 保证它不挡任何点击。
     */
    Object.assign(input.style, {
      position: 'fixed',
      left: '50%',
      top: '50%',
      width: '1px',
      height: '1px',
      opacity: '0',
      border: '0',
      padding: '0',
      margin: '0',
      background: 'transparent',
      color: 'transparent',
      caretColor: 'transparent',
      outline: 'none',
      zIndex: '0',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    host.appendChild(input);
    this.element = input;

    const onCompositionStart = (): void => {
      this.composing = '';
    };
    const onCompositionUpdate = (event: CompositionEvent): void => {
      this.composing = event.data ?? '';
    };
    const onCompositionEnd = (): void => {
      this.composing = '';
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      // 输入法组合中（`isComposing`）不要抢 Enter/Esc，那时候它们是输入法在用的
      if (event.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        this.commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.cancel();
      }
    };
    const onBlur = (): void => {
      this.composing = '';
    };
    input.addEventListener('compositionstart', onCompositionStart);
    input.addEventListener('compositionupdate', onCompositionUpdate);
    input.addEventListener('compositionend', onCompositionEnd);
    input.addEventListener('keydown', onKeyDown);
    input.addEventListener('blur', onBlur);
    this.cleanups.push(() => {
      input.removeEventListener('compositionstart', onCompositionStart);
      input.removeEventListener('compositionupdate', onCompositionUpdate);
      input.removeEventListener('compositionend', onCompositionEnd);
      input.removeEventListener('keydown', onKeyDown);
      input.removeEventListener('blur', onBlur);
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get value(): string {
    return this.element.value;
  }

  /** 组合中的那一段（拼音/候选阶段）；空串 = 没有在组合 */
  get composingText(): string {
    return this.composing;
  }

  get caret(): number {
    const index = this.element.selectionStart;
    return index === null ? this.element.value.length : index;
  }

  /** 选区 `[start, end)`；没有选区时两端相等 */
  get selection(): [number, number] {
    const start = this.element.selectionStart ?? this.caret;
    const end = this.element.selectionEnd ?? start;
    return [Math.min(start, end), Math.max(start, end)];
  }

  /** 打开并用 `initial` 预填（会聚焦隐藏 input，移动端此时弹键盘） */
  open(initial = ''): void {
    this.opened = true;
    this.element.value = initial;
    if (this.maxLength > 0) this.element.maxLength = this.maxLength;
    this.element.focus();
    // 光标放到末尾（与"点开已有名字继续改"的直觉一致）
    const end = this.element.value.length;
    this.element.setSelectionRange(end, end);
  }

  close(): void {
    this.opened = false;
    this.composing = '';
    this.element.blur();
  }

  /** 显式聚焦（点击输入框区域时调；它自己不挂 pointer 事件） */
  focus(): void {
    if (this.opened) this.element.focus();
  }

  /** 画进 `rect`：底、边框、选区、文字、组合态下划线、光标 */
  render(ctx: CanvasRenderingContext2D, rect: Rect, nowMs = performance.now()): void {
    if (!this.opened) return;
    const metrics = metricsFor(ctx, this.fontSize);
    const inner: Rect = {
      x: rect.x + TEXT_INPUT_PADDING_X,
      y: rect.y + 3,
      w: Math.max(0, rect.w - TEXT_INPUT_PADDING_X * 2),
      h: Math.max(0, rect.h - 6),
    };
    const text = this.element.value;
    const [selStart, selEnd] = this.selection;
    const caret = this.caret;
    const visible = visibleSlice(metrics, text, caret, inner.w);

    ctx.save();
    roundRectPath(ctx, rect, 3);
    ctx.fillStyle = TEXT_INPUT_COLORS.background;
    ctx.fill();
    ctx.strokeStyle = TEXT_INPUT_COLORS.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(inner.x, inner.y, inner.w, inner.h);
    ctx.clip();

    // 选区（半透明蓝）
    const selection = rangeRect(metrics, visible, inner, selStart, selEnd);
    if (selection) {
      ctx.fillStyle = TEXT_INPUT_COLORS.selection;
      ctx.fillRect(selection.x, selection.y, selection.w, selection.h);
    }

    // 文字（空且没有光标时显示占位提示）
    const baseline = inner.y + inner.h / 2;
    if (text.length === 0 && this.composing.length === 0) {
      drawText(ctx, this.placeholder, inner.x, baseline, {
        font: metrics.font,
        color: TEXT_INPUT_COLORS.placeholder,
        baseline: 'middle',
        shadow: false,
        maxWidth: inner.w,
      });
    } else {
      drawText(ctx, visible.text, inner.x, baseline, {
        font: metrics.font,
        color: TEXT_INPUT_COLORS.text,
        baseline: 'middle',
        shadow: false,
        maxWidth: inner.w + this.fontSize,
      });
    }

    // 组合态下划线：从"组合段起点"到光标
    if (this.composing.length > 0) {
      const underline = rangeRect(metrics, visible, inner, caret - this.composing.length, caret);
      if (underline) {
        ctx.fillStyle = TEXT_INPUT_COLORS.composing;
        ctx.fillRect(underline.x, underline.y + underline.h - 2, underline.w, 1);
      }
    }

    // 光标：有选区时不画（与浏览器一致），否则按闪烁周期画
    if (selStart === selEnd && caretBlinkOn(nowMs) > 0.5) {
      const caretBox = caretRect(metrics, visible, inner, caret);
      ctx.fillStyle = TEXT_INPUT_COLORS.caret;
      ctx.fillRect(caretBox.x, caretBox.y, caretBox.w, caretBox.h);
    }
    ctx.restore();
    ctx.restore();
  }

  private commit(): void {
    const value = this.element.value;
    this.close();
    this.onCommit?.(value);
  }

  private cancel(): void {
    this.close();
    this.onCancel?.();
  }

  dispose(): void {
    this.close();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.element.remove();
  }
}
