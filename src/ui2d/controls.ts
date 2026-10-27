/**
 * canvas 控件库（`src/ui2d/` 阶段 1）
 *
 * 为什么整页搬走之前必须先有这一层：设置页 / 主菜单 / 背包里的每一个交互，拆开都是
 * **开关、滑块、下拉、页签、滚动列表、提示框、弹窗**这七样。没有它们，每个面板都会
 * 自己写一遍"滑块怎么拖""下拉什么时候往上翻"，第二处开始就漂了。
 *
 * 三条约定（与 `widgets.ts` 一致，但这里的控件**有状态**，所以要说清楚）：
 *  1. **画法 + 纯函数放这里，状态留在调用方**。canvas 没有"元素自己记得自己开着没有"，
 *     状态和绘制混在一起就会出现第二份真相（DOM 里那套 `class` 正是这么演化的）。
 *     所以每个控件都提供：`draw*`（给矩形 + 状态，画完就走）与 `*At` / `next*`（纯状态机）。
 *  2. **几何一律 CSS px**，与 `widgets.ts` 同一套：`overlay` 已经 `setTransform(DPR)`。
 *  3. **命中只认矩形**（`input.ts` 的 `hitRegionAt`），圆角只是画法。
 *
 * 颜色沿用 `widgets.ts` 的 `PALETTE`（原版那套灰面板 + 黑描边）；开关的"开"用项目里
 * 唯一的那个绿（`--btn-send`），不另造色。
 */

import type { HitRegion } from './input.ts';
import { drawText, uiFont } from './text.ts';
import { PALETTE, drawButton, drawHudPanel, roundRectPath, type Rect } from './widgets.ts';

/** 控件自己的几个色（都在 `index.html` 里能找到对应物） */
export const CONTROL_COLORS = {
  /** 开关"开"：与聊天发送键同一个绿（`--btn-send: #3a7d33`） */
  on: '#3a7d33',
  off: '#6c6c6c',
  knob: '#e0e0e0',
  /** 滑块的已填充段（原版的经验条那种绿） */
  track: '#14150f',
  fillTop: '#c2ff7a',
  fillBottom: '#63c335',
  /** 列表选中行 / hover 行 */
  rowActive: 'rgba(255, 255, 255, .18)',
  rowHover: 'rgba(255, 255, 255, .09)',
  scrollThumb: 'rgba(255, 255, 255, .35)',
} as const;

/** 弹窗的深色面板（对应 `index.html` 的 `--mc-menu-bg` / `--pixel-bevel-dark`） */
export const MODAL_COLORS = {
  background: '#232323',
  bevelLight: '#4a4a4a',
  bevelDark: '#0d0d0d',
  titleBar: 'rgba(255, 255, 255, .06)',
  divider: 'rgba(255, 255, 255, .16)',
} as const;

/** 把一个矩形登记成命中区域（`input.ts` 只认矩形，圆角不参与命中） */
export function controlRegion(id: string, rect: Rect, layer = 0): HitRegion {
  return { id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, layer };
}

/** 矩形内缩（所有控件都要给描边留位置） */
export function insetRect(rect: Rect, dx: number, dy = dx): Rect {
  return { x: rect.x + dx, y: rect.y + dy, w: Math.max(0, rect.w - dx * 2), h: Math.max(0, rect.h - dy * 2) };
}

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

// ------------------------------------------------------------------ 开关

export const TOGGLE_WIDTH = 44;
export const TOGGLE_HEIGHT = 22;

/** 点一下之后的状态（开关只有两态，写成函数是为了让调用方只需要存一个 bool） */
export function toggleNext(on: boolean): boolean {
  return !on;
}

/** 原版没有开关，这里用"胶囊 + 圆钮"：关=灰、开=绿，钮贴在对应一端 */
export function drawToggle(ctx: CanvasRenderingContext2D, rect: Rect, on: boolean): void {
  const radius = rect.h / 2;
  ctx.save();
  roundRectPath(ctx, rect, radius);
  ctx.fillStyle = on ? CONTROL_COLORS.on : CONTROL_COLORS.off;
  ctx.fill();
  ctx.strokeStyle = PALETTE.outline;
  ctx.lineWidth = 1;
  ctx.stroke();
  const knobR = radius - 3;
  const cx = on ? rect.x + rect.w - radius : rect.x + radius;
  const cy = rect.y + radius;
  ctx.beginPath();
  ctx.arc(cx, cy, knobR, 0, Math.PI * 2);
  ctx.fillStyle = CONTROL_COLORS.knob;
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ 滑块

export const SLIDER_HEIGHT = 20;
/** 拖动块边长（原版风格的方块，不是圆形） */
export const SLIDER_KNOB = 14;

/** 可拖动的横向范围（两端各留半个钮，否则 0% 和 100% 的钮会被裁掉一半） */
export function sliderTrackRange(rect: Rect): { x: number; w: number } {
  const half = SLIDER_KNOB / 2;
  return { x: rect.x + half, w: Math.max(0, rect.w - SLIDER_KNOB) };
}

/** 指针 x → 0~1（夹在两端；`NaN` 当 0） */
export function sliderRatioFromX(rect: Rect, x: number): number {
  const range = sliderTrackRange(rect);
  if (!(range.w > 0) || !Number.isFinite(x)) return 0;
  return clamp01((x - range.x) / range.w);
}

/** 键盘步进（`&larr;/&rarr;`）：按 step 走一格并夹住 —— 与拖动的判据同一个，避免两套边界 */
export function sliderRatioStep(ratio: number, step: number, direction: 1 | -1): number {
  if (!(step > 0) || !Number.isFinite(step)) return clamp01(ratio);
  return clamp01(clamp01(ratio) + step * direction);
}

/** 滑块：深色槽 + 绿色已填充段 + 方块钮 */
export function drawSlider(ctx: CanvasRenderingContext2D, rect: Rect, ratio: number, active = false): void {
  const range = sliderTrackRange(rect);
  const trackH = 6;
  const trackY = rect.y + (rect.h - trackH) / 2;
  const track: Rect = { x: range.x, y: trackY, w: range.w, h: trackH };
  ctx.save();
  roundRectPath(ctx, track, trackH / 2);
  ctx.fillStyle = CONTROL_COLORS.track;
  ctx.fill();
  const value = clamp01(ratio);
  const filled = range.w * value;
  if (filled > 0.5) {
    ctx.save();
    roundRectPath(ctx, track, trackH / 2);
    ctx.clip();
    const gradient = ctx.createLinearGradient(track.x, track.y, track.x, track.y + track.h);
    gradient.addColorStop(0, CONTROL_COLORS.fillTop);
    gradient.addColorStop(1, CONTROL_COLORS.fillBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(track.x, track.y, filled, track.h);
    ctx.restore();
  }
  // 方块钮：白面 + 左上亮 / 右下暗（与按钮同一套斜面）
  const knob: Rect = {
    x: range.x + range.w * value - SLIDER_KNOB / 2,
    y: rect.y + (rect.h - SLIDER_KNOB) / 2,
    w: SLIDER_KNOB,
    h: SLIDER_KNOB,
  };
  ctx.fillStyle = active ? PALETTE.faceHover : PALETTE.face;
  ctx.fillRect(knob.x, knob.y, knob.w, knob.h);
  ctx.fillStyle = PALETTE.edgeLight;
  ctx.fillRect(knob.x, knob.y, knob.w, 1);
  ctx.fillRect(knob.x, knob.y, 1, knob.h);
  ctx.fillStyle = PALETTE.edgeDark;
  ctx.fillRect(knob.x, knob.y + knob.h - 1, knob.w, 1);
  ctx.fillRect(knob.x + knob.w - 1, knob.y, 1, knob.h);
  ctx.strokeStyle = PALETTE.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(knob.x + 0.5, knob.y + 0.5, knob.w - 1, knob.h - 1);
  ctx.restore();
}

// ------------------------------------------------------------------ 下拉

export const DROPDOWN_ITEM_HEIGHT = 22;

/**
 * 展开后的菜单矩形。
 *
 * 默认向下展开；**下面放不下就翻到上方**（DOM 版把菜单挂到 `body` 上就是为了这个，
 * 只是那边交给浏览器算，这边得自己算）。两边都放不下时选空间大的那一侧。
 */
export function dropdownMenuRect(
  field: Rect,
  count: number,
  itemHeight: number,
  viewportHeight: number,
): Rect {
  const h = Math.max(0, count * itemHeight);
  const below = field.y + field.h;
  const roomBelow = viewportHeight - below;
  const roomAbove = field.y;
  const flip = roomBelow < h && roomAbove > roomBelow;
  return {
    x: field.x,
    y: flip ? Math.max(0, field.y - h) : below,
    w: field.w,
    h,
  };
}

/** 菜单里的第几项（`-1` = 这一下没落在任何一项上） */
export function dropdownIndexAt(menu: Rect, y: number, itemHeight: number, count: number): number {
  if (!(itemHeight > 0) || count <= 0) return -1;
  if (y < menu.y || y >= menu.y + menu.h) return -1;
  const index = Math.floor((y - menu.y) / itemHeight);
  return index >= 0 && index < count ? index : -1;
}

/** 未展开的字段：借用按钮画法 + 右侧一个 ▾ */
export function drawDropdownField(ctx: CanvasRenderingContext2D, rect: Rect, label: string, open: boolean): void {
  drawButton(ctx, rect, '', open ? 'hover' : 'idle');
  drawText(ctx, label, rect.x + 8, rect.y + rect.h / 2, {
    font: uiFont(13),
    color: PALETTE.textLight,
    align: 'left',
    baseline: 'middle',
    maxWidth: rect.w - 28,
  });
  drawText(ctx, '▾', rect.x + rect.w - 10, rect.y + rect.h / 2, {
    font: uiFont(12),
    color: PALETTE.textLight,
    align: 'right',
    baseline: 'middle',
  });
}

/** 展开的菜单：深色面板 + 逐项；`active` 是已选中项，`hover` 是手指/鼠标所在项 */
export function drawDropdownMenu(
  ctx: CanvasRenderingContext2D,
  menu: Rect,
  labels: readonly string[],
  active: number,
  hover: number,
): void {
  drawHudPanel(ctx, menu, 0);
  for (let i = 0; i < labels.length; i++) {
    const row: Rect = { x: menu.x, y: menu.y + i * DROPDOWN_ITEM_HEIGHT, w: menu.w, h: DROPDOWN_ITEM_HEIGHT };
    if (i === hover || i === active) {
      ctx.fillStyle = i === hover ? CONTROL_COLORS.rowHover : CONTROL_COLORS.rowActive;
      ctx.fillRect(row.x + 1, row.y, row.w - 2, row.h);
    }
    drawText(ctx, labels[i]!, row.x + 8, row.y + row.h / 2, {
      font: uiFont(13),
      color: i === active ? PALETTE.textHover : PALETTE.textLight,
      align: 'left',
      baseline: 'middle',
      maxWidth: row.w - 16,
    });
  }
}

// ------------------------------------------------------------------ 页签

/** 把一条矩形等分成 `count` 段（页签宽度相同，原版设置页就是这么排的） */
export function tabRects(rect: Rect, count: number): Rect[] {
  if (count <= 0) return [];
  const w = rect.w / count;
  const out: Rect[] = [];
  for (let i = 0; i < count; i++) out.push({ x: rect.x + i * w, y: rect.y, w, h: rect.h });
  return out;
}

/** 点在哪个页签上（落在最右边界算最后一个；范围外返回 -1） */
export function tabIndexAt(rect: Rect, count: number, x: number): number {
  if (count <= 0 || !(rect.w > 0) || !Number.isFinite(x)) return -1;
  if (x < rect.x || x >= rect.x + rect.w) return -1;
  const index = Math.floor(((x - rect.x) / rect.w) * count);
  return Math.min(count - 1, Math.max(0, index));
}

/** 页签条：选中的那格用面板色"凸出来"，其余压暗 */
export function drawTabs(ctx: CanvasRenderingContext2D, rect: Rect, labels: readonly string[], active: number): void {
  const rects = tabRects(rect, labels.length);
  for (let i = 0; i < rects.length; i++) {
    const tab = rects[i]!;
    const on = i === active;
    ctx.fillStyle = on ? PALETTE.panel : PALETTE.faceDown;
    ctx.fillRect(tab.x, tab.y, tab.w, tab.h);
    ctx.fillStyle = on ? PALETTE.edgeLight : PALETTE.edgeDark;
    ctx.fillRect(tab.x, tab.y, tab.w, 1);
    ctx.fillRect(tab.x, tab.y, 1, tab.h);
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(tab.x + 0.5, tab.y + 0.5, tab.w - 1, tab.h - 1);
    drawText(ctx, labels[i]!, tab.x + tab.w / 2, tab.y + tab.h / 2, {
      font: uiFont(13),
      color: on ? PALETTE.text : PALETTE.textLight,
      align: 'center',
      baseline: 'middle',
      maxWidth: tab.w - 8,
    });
  }
}

// ------------------------------------------------------------------ 滚动列表

export const LIST_ITEM_HEIGHT = 24;

/** 内容总高（列表可滚动的上限靠它算） */
export function listContentHeight(count: number, itemHeight = LIST_ITEM_HEIGHT): number {
  return Math.max(0, count) * Math.max(0, itemHeight);
}

/** 最大滚动偏移（内容比视口矮时是 0，不能出现"能滚但没东西"） */
export function listMaxScroll(count: number, viewHeight: number, itemHeight = LIST_ITEM_HEIGHT): number {
  return Math.max(0, listContentHeight(count, itemHeight) - Math.max(0, viewHeight));
}

/** 夹住偏移（拖动/滚轮/程序设置共用同一条，避免三套边界） */
export function clampListScroll(
  offset: number,
  count: number,
  viewHeight: number,
  itemHeight = LIST_ITEM_HEIGHT,
): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(listMaxScroll(count, viewHeight, itemHeight), Math.max(0, offset));
}

/** 滚轮：向下滚为正（与 `deltaY` 同向），按行对齐（列表滚半行看起来最脏） */
export function listScrollByWheel(
  offset: number,
  deltaY: number,
  count: number,
  viewHeight: number,
  itemHeight = LIST_ITEM_HEIGHT,
): number {
  if (!Number.isFinite(deltaY)) return clampListScroll(offset, count, viewHeight, itemHeight);
  const steps = Math.round(deltaY / itemHeight);
  return clampListScroll(offset + steps * itemHeight, count, viewHeight, itemHeight);
}

/** 当前视口里该画哪几行（含半行也照画，靠 clip 裁） */
export function listVisibleRange(
  offset: number,
  viewHeight: number,
  count: number,
  itemHeight = LIST_ITEM_HEIGHT,
): { first: number; last: number } {
  if (count <= 0 || !(viewHeight > 0) || !(itemHeight > 0)) return { first: 0, last: -1 };
  const start = clampListScroll(offset, count, viewHeight, itemHeight);
  const first = Math.max(0, Math.floor(start / itemHeight));
  const last = Math.min(count - 1, Math.ceil((start + viewHeight) / itemHeight) - 1);
  return { first, last };
}

/** 列表行（选中行整条压亮，hover 更淡） */
export function drawListRow(
  ctx: CanvasRenderingContext2D,
  row: Rect,
  label: string,
  active: boolean,
  hover: boolean,
): void {
  if (active || hover) {
    ctx.fillStyle = active ? CONTROL_COLORS.rowActive : CONTROL_COLORS.rowHover;
    ctx.fillRect(row.x, row.y, row.w, row.h);
  }
  drawText(ctx, label, row.x + 8, row.y + row.h / 2, {
    font: uiFont(13),
    color: active ? PALETTE.textHover : PALETTE.textLight,
    align: 'left',
    baseline: 'middle',
    maxWidth: row.w - 16,
  });
}

/** 右侧滚动条（内容装得下时整条不画） */
export function drawScrollbar(
  ctx: CanvasRenderingContext2D,
  track: Rect,
  offset: number,
  contentHeight: number,
  viewHeight: number,
): void {
  if (!(track.h > 0) || !(viewHeight > 0) || contentHeight <= viewHeight) return;
  const ratio = Math.min(1, viewHeight / contentHeight);
  const thumbH = Math.max(12, track.h * ratio);
  const maxScroll = contentHeight - viewHeight;
  const t = maxScroll > 0 ? Math.min(1, Math.max(0, offset / maxScroll)) : 0;
  const thumbY = track.y + (track.h - thumbH) * t;
  ctx.save();
  ctx.fillStyle = CONTROL_COLORS.scrollThumb;
  roundRectPath(ctx, { x: track.x, y: thumbY, w: track.w, h: thumbH }, track.w / 2);
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ 提示框

/**
 * 提示框的位置：默认贴在锚点**下方**，下方放不下就翻到上方；左右夹进视口。
 *
 * 与 `dropdownMenuRect` 同一条思路（DOM 那边靠"挂 body + 浏览器 clamp"，canvas 得自己算）。
 */
export function tooltipRect(
  anchor: Rect,
  width: number,
  height: number,
  viewport: { readonly w: number; readonly h: number },
  gap = 8,
): Rect {
  const below = anchor.y + anchor.h + gap;
  let y = below;
  if (below + height > viewport.h) {
    const above = anchor.y - gap - height;
    y = above >= 0 ? above : Math.max(0, viewport.h - height);
  }
  const x = Math.min(Math.max(0, anchor.x + anchor.w / 2 - width / 2), Math.max(0, viewport.w - width));
  return { x, y, w: width, h: height };
}

/** 提示框本体：深色面板 + 逐行浅色字 */
export function drawTooltip(ctx: CanvasRenderingContext2D, rect: Rect, lines: readonly string[]): void {
  drawHudPanel(ctx, rect, 3);
  let y = rect.y + 6;
  for (const line of lines) {
    drawText(ctx, line, rect.x + 8, y, {
      font: uiFont(12),
      color: PALETTE.textLight,
      align: 'left',
      baseline: 'top',
      maxWidth: rect.w - 16,
      shadow: false,
    });
    y += 16;
  }
}

// ------------------------------------------------------------------ 弹窗

/** 弹窗面板：居中，夹进视口（小屏时四周留 8px） */
export function modalRect(viewportW: number, viewportH: number, width: number, height: number): Rect {
  const w = Math.min(width, Math.max(1, viewportW - 16));
  const h = Math.min(height, Math.max(1, viewportH - 16));
  return { x: Math.round((viewportW - w) / 2), y: Math.round((viewportH - h) / 2), w, h };
}

/**
 * 弹窗外壳：**不透明**深色面板 + 一条标题栏（原版暂停菜单那一套）。
 *
 * 为什么不用 `drawHudPanel`（半透明）：弹窗后面往往还是列表/菜单，半透明会把底下的
 * 行文字透上来，看起来像"字叠字"。原版的面板本来就是不透明的 `#232323` +
 * `--pixel-bevel-dark` 的硬斜角（亮边 #4a4a4a / 暗边近黑）+ 2px 纯黑外描边。
 */
export function drawModalFrame(ctx: CanvasRenderingContext2D, rect: Rect, title: string): void {
  const outline = 2;
  const bevel = 3;
  ctx.save();
  ctx.fillStyle = PALETTE.outline;
  ctx.fillRect(rect.x - outline, rect.y - outline, rect.w + outline * 2, outline);
  ctx.fillRect(rect.x - outline, rect.y + rect.h, rect.w + outline * 2, outline);
  ctx.fillRect(rect.x - outline, rect.y, outline, rect.h);
  ctx.fillRect(rect.x + rect.w, rect.y, outline, rect.h);

  ctx.fillStyle = MODAL_COLORS.background;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = MODAL_COLORS.bevelLight;
  ctx.fillRect(rect.x, rect.y, rect.w, bevel);
  ctx.fillRect(rect.x, rect.y, bevel, rect.h);
  ctx.fillStyle = MODAL_COLORS.bevelDark;
  ctx.fillRect(rect.x, rect.y + rect.h - bevel, rect.w, bevel);
  ctx.fillRect(rect.x + rect.w - bevel, rect.y, bevel, rect.h);

  // 标题栏：比底色亮一点点，底部一条分隔线
  const bar: Rect = { x: rect.x + bevel, y: rect.y + bevel, w: rect.w - bevel * 2, h: 30 };
  ctx.fillStyle = MODAL_COLORS.titleBar;
  ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
  ctx.strokeStyle = MODAL_COLORS.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bar.x, bar.y + bar.h + 0.5);
  ctx.lineTo(bar.x + bar.w, bar.y + bar.h + 0.5);
  ctx.stroke();
  drawText(ctx, title, bar.x + bar.w / 2, bar.y + bar.h / 2, {
    font: uiFont(14, 600),
    color: PALETTE.textLight,
    align: 'center',
    baseline: 'middle',
    maxWidth: bar.w - 24,
  });
  ctx.restore();
}
