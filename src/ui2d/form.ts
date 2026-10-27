/**
 * canvas 版的**设置表单**（`src/ui2d/` 阶段 3 第二页）
 *
 * 与暂停菜单同一条思路（决策 D18）：**DOM 是唯一真源**。这里不定义"有哪些设置项、
 * 每项什么范围"，而是把 `.settings-row` 读成一份模型 ——
 *   - `.settings-switch`（开关）→ `switch`
 *   - `.settings-cycle`（循环按钮）→ `cycle`
 *   - `input[type=range]`（滑杆）→ `range`
 * 交互也是"转发"：开关/循环按钮直接 `click()`，滑杆写 `value` 再派发 `input`/`change`。
 * 于是**设置项的增删、文案（6 语言）、取值范围、副作用全部自动继承**，
 * 这一层只负责"画得像"和"点得着"。
 *
 * ⚠️ 范围：**只管画与转发**。滚轮/滚动、页签切换的语义仍在调用方
 * （预览页与 `main.ts` 各有一小段），因为"面板能不能滚"取决于调用方给的视口。
 */

import { drawButton, roundRectPath, type Rect } from './widgets.ts';
import { drawText, uiFont } from './text.ts';
import { PALETTE } from './widgets.ts';
import { drawToggle } from './controls.ts';

export type FormRowKind = 'switch' | 'cycle' | 'range';

export interface FormRow {
  /** 从 DOM 来的稳定 id（行序号），只用于命中与焦点 */
  readonly id: string;
  readonly kind: FormRowKind;
  readonly label: string;
  /** 控件上显示的值（开关为空串、循环按钮取 `textContent`、滑杆取读数） */
  readonly value: string;
  /** 开关是否为开（`aria-checked` / `.on`） */
  readonly on: boolean;
  /** 滑杆的 0~1 比例（其它类型为 0） */
  readonly ratio: number;
  /** 原始控件（写回用；不参与绘制） */
  readonly element: HTMLElement | null;
}

/** 一行的高度与行距（比暂停菜单紧凑：设置项多） */
export const FORM_ROW_HEIGHT = 30;
export const FORM_ROW_GAP = 6;
/** 右侧控件的宽度（标签占左边剩下的部分） */
export const FORM_CONTROL_WIDTH = 104;

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').trim();
}

/** 从一段设置页 DOM 里读出模型（只扫 `.settings-row`，顺序即 DOM 顺序） */
export function readFormRows(host: ParentNode): FormRow[] {
  const rows: FormRow[] = [];
  const nodes = [...host.querySelectorAll<HTMLElement>('.settings-row')];
  for (let i = 0; i < nodes.length; i++) {
    const row = nodes[i]!;
    // 每一行的第一个直接子 `<span>` 就是标签（`makePair` / `makeSlider` 都是这么建的）
    const label = textOf([...row.children].find((child) => child.tagName === 'SPAN') ?? null);
    const sw = row.querySelector<HTMLElement>('.settings-switch');
    if (sw) {
      const on = sw.getAttribute('aria-checked') === 'true' || sw.classList.contains('on');
      rows.push({ id: `row${i}`, kind: 'switch', label, value: '', on, ratio: 0, element: sw });
      continue;
    }
    const range = row.querySelector<HTMLInputElement>('input[type=range]');
    if (range) {
      const min = Number(range.min || 0);
      const max = Number(range.max || 1);
      const value = Number(range.value || 0);
      const ratio = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
      // `.settings-cycle` 可能是同名的读数元素；滑杆行优先认滑杆
      rows.push({ id: `row${i}`, kind: 'range', label, value: String(range.value), on: false, ratio, element: range });
      continue;
    }
    const cycle = row.querySelector<HTMLElement>('.settings-cycle');
    if (cycle) {
      rows.push({ id: `row${i}`, kind: 'cycle', label, value: textOf(cycle), on: false, ratio: 0, element: cycle });
    }
    // 其它行（纯说明 / 外观预览 / 诊断）本批不画：没有可操作的控件就没必要占位
  }
  return rows;
}

/** 每行的矩形（从列表区域顶部开始，整宽） */
export function formRowRects(list: Rect, count: number): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    out.push({
      x: list.x,
      y: list.y + i * (FORM_ROW_HEIGHT + FORM_ROW_GAP),
      w: list.w,
      h: FORM_ROW_HEIGHT,
    });
  }
  return out;
}

/** 内容总高（含行距；给滚动夹取用） */
export function formContentHeight(count: number): number {
  return Math.max(0, count) * (FORM_ROW_HEIGHT + FORM_ROW_GAP);
}

/** 一行里控件所占的矩形（右侧固定宽，右边留 8px 内边距） */
export function formControlRect(row: Rect): Rect {
  const w = Math.min(FORM_CONTROL_WIDTH, Math.max(0, row.w - 24));
  return { x: row.x + row.w - w - 8, y: row.y + 4, w, h: row.h - 8 };
}

/** 滑杆的指针位置 → 0~1（夹在两端） */
export function formRatioFromX(control: Rect, x: number): number {
  if (!(control.w > 0) || !Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, (x - control.x) / control.w));
}

/** 画一行：标签（截断）+ 右侧控件 */
export function drawFormRow(
  ctx: CanvasRenderingContext2D,
  row: Rect,
  model: FormRow,
  focused: boolean,
): void {
  if (focused) {
    ctx.fillStyle = 'rgba(255, 255, 255, .12)';
    ctx.fillRect(row.x, row.y, row.w, row.h);
    ctx.strokeStyle = 'rgba(255, 255, 255, .28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(row.x + 0.5, row.y + 0.5, row.w - 1, row.h - 1);
  }
  const control = formControlRect(row);
  // 滑杆的读数放在**轨道左边**（右端外面是面板边缘，画出去就被裁掉了）
  const valueWidth = model.kind === 'range' ? 34 : 0;
  const labelWidth = Math.max(0, control.x - row.x - 16 - valueWidth);
  drawText(ctx, model.label, row.x + 10, row.y + row.h / 2, {
    font: uiFont(13),
    color: PALETTE.textLight,
    align: 'left',
    baseline: 'middle',
    maxWidth: labelWidth,
    shadow: false,
  });

  if (model.kind === 'switch') {
    const size = { x: control.x + control.w - 44, y: row.y + (row.h - 22) / 2, w: 44, h: 22 };
    drawToggle(ctx, size, model.on);
    return;
  }
  if (model.kind === 'cycle') {
    drawButton(ctx, control, model.value, focused ? 'hover' : 'idle');
    return;
  }
  // 滑杆：轨道 + 已填充段（与经验条同一套配色）
  const track: Rect = { x: control.x, y: row.y + row.h / 2 - 3, w: control.w, h: 6 };
  ctx.save();
  roundRectPath(ctx, track, 3);
  ctx.fillStyle = '#14150f';
  ctx.fill();
  const filled = track.w * model.ratio;
  if (filled > 0.5) {
    ctx.save();
    roundRectPath(ctx, track, 3);
    ctx.clip();
    const gradient = ctx.createLinearGradient(track.x, track.y, track.x, track.y + track.h);
    gradient.addColorStop(0, '#c2ff7a');
    gradient.addColorStop(1, '#63c335');
    ctx.fillStyle = gradient;
    ctx.fillRect(track.x, track.y, filled, track.h);
    ctx.restore();
  }
  ctx.restore();
  drawText(ctx, model.value, control.x - 6, row.y + row.h / 2, {
    font: uiFont(11),
    color: '#9aa69a',
    align: 'right',
    baseline: 'middle',
    shadow: false,
    maxWidth: valueWidth,
  });
}

/** 把滑杆拖到 `ratio`（0~1）并派发 `input`/`change`，让原有的设置逻辑照常跑 */
export function writeRangeRatio(range: HTMLInputElement, ratio: number): void {
  const min = Number(range.min || 0);
  const max = Number(range.max || 1);
  const step = Number(range.step || 0);
  let value = min + (max - min) * Math.min(1, Math.max(0, ratio));
  if (step > 0) value = Math.round(value / step) * step;
  value = Math.min(max, Math.max(min, value));
  const text = String(value);
  if (range.value === text) return;
  range.value = text;
  range.dispatchEvent(new Event('input', { bubbles: true }));
  range.dispatchEvent(new Event('change', { bubbles: true }));
}
