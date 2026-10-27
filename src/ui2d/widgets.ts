/**
 * canvas 界面控件（`src/ui2d/` 阶段 0）
 *
 * 这一层只放**画法**，不放状态：每个函数都是"给一块矩形 + 一份状态，画完就走"
 * （立即模式）。状态留在调用方（HUD / 面板）手里 —— canvas 没有 DOM 那种
 * "元素自己记得自己是不是 hover"，把状态和绘制混在一起，第二份真相迟早打架。
 *
 * 配色直接抄 `index.html` 的设计令牌（原版 GUI 那套）：
 * 面板 `#c6c6c6`、按钮面 `#8b8b8b`、斜面高光 `#ffffff`、斜面阴影 `#555555`、
 * 1px 纯黑描边、文字 `#3f3f3f`（浅底）/ `#e0e0e0`（深底）。
 * ⚠️ 改色只改这里的常量；`index.html` 那边同步改 `:root` —— 两边会并存一段时间，
 * 所以色值必须一一对应（这条写进 `notes/canvas-ui.md` 的迁移 checklist）。
 */

import { drawText, uiFont } from './text.ts';

/** 原版 GUI 的五个色 + 两种文字色（与 `index.html` 的 `--mc-*` 一一对应） */
export const PALETTE = {
  panel: '#c6c6c6',
  face: '#8b8b8b',
  faceHover: '#a0a0a0',
  faceDown: '#6c6c6c',
  edgeLight: '#ffffff',
  edgeDark: '#555555',
  outline: '#000000',
  text: '#3f3f3f',
  textLight: '#e0e0e0',
  textHover: '#ffffa0',
  textDisabled: '#a0a0a0',
  /** HUD 深底（`--hud-bg` 是一条上下渐变，这里给两端） */
  hudTop: 'rgba(16, 17, 21, .62)',
  hudBottom: 'rgba(8, 9, 12, .74)',
  hudBorder: 'rgba(255, 255, 255, .16)',
} as const;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 圆角矩形路径。
 *
 * 不直接用 `ctx.roundRect`：它要求 Chrome 99+/Safari 16+，而这个项目的
 * 主场景是**安卓 WebView**（系统版本参差不齐）。手写四段 arcTo 只有几行，
 * 且半径可以按 `min(w,h)/2` 夹住，不会出现"半径大于边长"的烂路径。
 */
export function roundRectPath(ctx: CanvasRenderingContext2D, rect: Rect, radius = 0): void {
  const r = Math.max(0, Math.min(radius, Math.min(rect.w, rect.h) / 2));
  const { x, y, w, h } = rect;
  ctx.beginPath();
  if (r === 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** HUD 的深色半透明底板（Boss 条、提示条那类） */
export function drawHudPanel(ctx: CanvasRenderingContext2D, rect: Rect, radius = 0): void {
  const gradient = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  gradient.addColorStop(0, PALETTE.hudTop);
  gradient.addColorStop(1, PALETTE.hudBottom);
  roundRectPath(ctx, rect, radius);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = PALETTE.hudBorder;
  ctx.lineWidth = 1;
  // 1px 描边落在半像素上才不会糊（背板已经按 DPR 缩放过，这里是 CSS px 的中点）
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
}

export interface ProgressBarStyle {
  /** 填充渐变的上下两端 */
  readonly fillTop: string;
  readonly fillBottom: string;
  /** 轨道底色（默认半透明黑） */
  readonly track?: string;
  readonly radius?: number;
  /** 填充的发光（原版那条白条有一圈轻微辉光） */
  readonly glow?: string;
}

/** 横向进度条（破坏进度 / 进食进度 / 任何 0~1 的量） */
export function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  ratio: number,
  style: ProgressBarStyle,
): void {
  const value = Math.max(0, Math.min(1, ratio));
  const radius = style.radius ?? rect.h / 2;
  ctx.save();
  roundRectPath(ctx, rect, radius);
  ctx.fillStyle = style.track ?? 'rgba(0, 0, 0, .62)';
  ctx.fill();
  ctx.strokeStyle = PALETTE.hudBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  const filled = rect.w * value;
  if (filled > 0.5) {
    // 填充部分自己再裁一次：直接画会把圆角盖掉（左右两端都要跟着轨道圆角）
    ctx.save();
    roundRectPath(ctx, { x: rect.x, y: rect.y, w: filled, h: rect.h }, radius);
    ctx.clip();
    const gradient = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
    gradient.addColorStop(0, style.fillTop);
    gradient.addColorStop(1, style.fillBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(rect.x, rect.y, filled, rect.h);
    ctx.restore();
  }
  if (style.glow) {
    ctx.shadowColor = style.glow;
    ctx.shadowBlur = 8;
    // 只补一条 1px 的高光，制造"发亮"的观感（整块加 shadowBlur 在手机上很贵）
    ctx.fillStyle = style.glow;
    ctx.fillRect(rect.x + 1, rect.y + 1, Math.max(0, filled - 2), 1);
  }
  ctx.restore();
}

export type ButtonState = 'idle' | 'hover' | 'down' | 'disabled';

/** 原版风格按钮：面板面 + 左上高光 + 右下阴影 + 1px 纯黑描边 */
export function drawButton(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  state: ButtonState = 'idle',
): void {
  const face =
    state === 'down'
      ? PALETTE.faceDown
      : state === 'hover'
        ? PALETTE.faceHover
        : state === 'disabled'
          ? PALETTE.face
          : PALETTE.face;
  ctx.save();
  ctx.fillStyle = face;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  // 斜面：上/左白、下/右灰；按下时反过来（原版就是"凹进去"）
  const pressed = state === 'down';
  ctx.fillStyle = pressed ? PALETTE.edgeDark : PALETTE.edgeLight;
  ctx.fillRect(rect.x, rect.y, rect.w, 1);
  ctx.fillRect(rect.x, rect.y, 1, rect.h);
  ctx.fillStyle = pressed ? PALETTE.edgeLight : PALETTE.edgeDark;
  ctx.fillRect(rect.x, rect.y + rect.h - 1, rect.w, 1);
  ctx.fillRect(rect.x + rect.w - 1, rect.y, 1, rect.h);
  ctx.strokeStyle = PALETTE.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

  const color =
    state === 'disabled' ? PALETTE.textDisabled : state === 'hover' ? PALETTE.textHover : PALETTE.textLight;
  drawText(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2, {
    font: uiFont(13),
    color,
    align: 'center',
    baseline: 'middle',
    // 浅灰面板上的原版按钮文字是**深色 + 无阴影**；这里按钮面是 #8b8b8b，
    // 用浅色字 + 阴影读起来更接近现在的 HUD 观感（迁移时若追求像素一致再调）
    shadow: true,
    maxWidth: rect.w - 8,
  });
  ctx.restore();
}
