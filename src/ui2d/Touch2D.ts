/**
 * 触控控件（阶段 6 第一块：摇杆）
 *
 * 用户 2026-10-27：「还有游戏场景内的摇杆，跳跃按键，顶部的三个按钮」。
 *
 * 摇杆与前面所有块都不同：它的**芯子一直在动**（跟着拇指走）。所以不能��镜像那样
 * "读一次 DOM、按原位重画"——那样要么每帧读一遍计算样式（贵），要么落后好几帧（黏手）。
 *
 * 这一块的做法是「**自己画，但几何量 DOM**」：
 *  - 每帧只读两个矩形（底座 `#touch-stick` + 芯子 `.knob`），不做 `getComputedStyle`；
 *  - 画法（渐变、描边、阴影）按 CSS 的观感手写一份，颜色集中在下表里；
 *  - 输入**完全不动**：底座仍由 DOM 接 pointer 事件（`opacity: 0` 不影响命中）。
 *
 * 为什么不做成"通用镜像"：摇杆是唯一"连续跟随手指"的控件，镜像的签名 + 定期重读
 * 那套在这里只会带来延迟；而它的形状（两个圆）简单到可以几行画完。
 */

import { applyDebugTint } from './debug.ts';
import { Ui2DOverlay } from './overlay.ts';
import { drawText, uiFont } from './text.ts';
import { roundRectPath } from './widgets.ts';
import type { Rect } from './widgets.ts';

/** 摇杆的观感（照 `index.html` 的 `#touch-stick` / `.knob` 手写一份） */
export const STICK_COLORS = {
  /** 底座：深色玻璃 */
  baseFill: 'rgba(12, 16, 20, .52)',
  baseFillActive: 'rgba(18, 24, 30, .68)',
  baseRim: 'rgba(255, 255, 255, .62)',
  baseRimActive: 'rgba(255, 255, 255, .85)',
  /** 芯子：浅灰实体（上亮下暗的渐变用两段纯色近似） */
  knobTop: '#f7f9fb',
  knobBottom: '#c7ccd2',
  knobEdge: 'rgba(0, 0, 0, .55)',
  /** 潜行态的芯子（`#touch-stick.sneaking`） */
  knobTopSneak: '#e2ffdc',
  knobBottomSneak: '#9fe094',
  knobEdgeSneak: 'rgba(26, 64, 20, .85)',
  /** 潜行小牌 */
  badgeBg: 'rgba(20, 60, 16, .82)',
  badgeText: '#c8f2be',
} as const;

export interface StickState {
  /** 底座矩形（`#touch-stick`） */
  readonly base: Rect;
  /** 芯子矩形（`.knob`，已含位移） */
  readonly knob: Rect;
  readonly active: boolean;
  readonly sneaking: boolean;
  /** 潜行小牌上的字（`#touch-stick .sneak-badge` 的 `textContent`，跟着 i18n 走） */
  readonly sneakLabel?: string;
}

/** 芯子圆心相对底座圆心的偏移（纯几何，可断言） */
export function knobOffset(base: Rect, knob: Rect): { dx: number; dy: number } {
  return {
    dx: knob.x + knob.w / 2 - (base.x + base.w / 2),
    dy: knob.y + knob.h / 2 - (base.y + base.h / 2),
  };
}

/** 把偏移夹进"底座内圈"（半径 = (底座半径 - 芯子半径)），防止芯子越出底座 */
export function clampKnobOffset(dx: number, dy: number, baseSize: number, knobSize: number): { dx: number; dy: number } {
  const limit = Math.max(0, (baseSize - knobSize) / 2);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { dx: 0, dy: 0 };
  const distance = Math.hypot(dx, dy);
  if (distance <= limit || distance === 0) return { dx, dy };
  const k = limit / distance;
  return { dx: dx * k, dy: dy * k };
}

/** 画一个圆（用矩形描述） */
function circle(ctx: CanvasRenderingContext2D, rect: Rect): void {
  ctx.beginPath();
  ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.min(rect.w, rect.h) / 2, 0, Math.PI * 2);
}

/** 画摇杆（底座 + 芯子 + 潜行小牌） */
export function drawStick(ctx: CanvasRenderingContext2D, stick: StickState): void {
  const { base, knob } = stick;
  if (!(base.w > 0) || !(base.h > 0)) return;

  ctx.save();
  // 底座：外圈暗边（`box-shadow: 0 0 0 1px rgba(0,0,0,.5)`）+ 深色玻璃 + 浅色描边
  circle(ctx, { x: base.x - 1, y: base.y - 1, w: base.w + 2, h: base.h + 2 });
  ctx.fillStyle = 'rgba(0, 0, 0, .50)';
  ctx.fill();
  circle(ctx, base);
  ctx.fillStyle = stick.active ? STICK_COLORS.baseFillActive : STICK_COLORS.baseFill;
  ctx.fill();
  // 顶部那道高光：CSS 是 `radial-gradient(circle at 50% 42%, rgba(255,255,255,.10), transparent 62%)`
  const highlight = ctx.createRadialGradient(
    base.x + base.w / 2,
    base.y + base.h * 0.42,
    0,
    base.x + base.w / 2,
    base.y + base.h * 0.42,
    base.w * 0.62,
  );
  highlight.addColorStop(0, 'rgba(255, 255, 255, .10)');
  highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
  circle(ctx, base);
  ctx.fillStyle = highlight;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stick.active ? STICK_COLORS.baseRimActive : STICK_COLORS.baseRim;
  circle(ctx, base);
  ctx.stroke();

  // 芯子：上亮下暗（CSS 是一条 linear-gradient，这里用两半圆近似）
  circle(ctx, knob);
  // 芯子是 `linear-gradient(180deg, #f7f9fb, #c7ccd2)`：用真渐变，别用两段纯色
  //（两段拼起来在正中间会留一条硬缝，截图里能看出来）
  const gradient = ctx.createLinearGradient(0, knob.y, 0, knob.y + knob.h);
  gradient.addColorStop(0, stick.sneaking ? STICK_COLORS.knobTopSneak : STICK_COLORS.knobTop);
  gradient.addColorStop(1, stick.sneaking ? STICK_COLORS.knobBottomSneak : STICK_COLORS.knobBottom);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stick.sneaking ? STICK_COLORS.knobEdgeSneak : STICK_COLORS.knobEdge;
  circle(ctx, knob);
  ctx.stroke();

  // 潜行小牌：只在 `.sneaking` 时出现在底座正上方
  if (stick.sneaking) {
    const label = stick.sneakLabel ?? '潜行';
    const h = 16;
    const w = 34;
    const badge = { x: base.x + base.w / 2 - w / 2, y: base.y - h - 6, w, h };
    roundRectPath(ctx, badge, 4);
    ctx.fillStyle = STICK_COLORS.badgeBg;
    ctx.fill();
    drawText(ctx, label, badge.x + badge.w / 2, badge.y + badge.h / 2, {
      font: uiFont(11),
      color: STICK_COLORS.badgeText,
      align: 'center',
      baseline: 'middle',
      shadow: false,
    });
  }
  ctx.restore();
}

/**
 * 摇杆的绘制单元（自带一层覆盖层，`z-index` 默认 30 —— 要压在 `#app` 与 `#touch-ui` 之上）。
 *
 * 用法：每帧 `update()` 一次（内部只在状态变了才重画）。
 */
export class Touch2D {
  private overlay: Ui2DOverlay | null = null;
  private stick: StickState | null = null;
  private signature = '';
  private opened = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: { readonly zIndex?: number; readonly tint?: boolean } = {},
  ) {}

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    if (!this.overlay) {
      this.overlay = new Ui2DOverlay(this.host);
      if (this.options.zIndex !== undefined) this.overlay.canvas.style.zIndex = String(this.options.zIndex);
    }
    this.signature = '';
  }

  close(): void {
    this.opened = false;
    this.stick = null;
    this.overlay?.clear();
  }

  dispose(): void {
    this.close();
    this.overlay?.dispose();
    this.overlay = null;
  }

  /** 每帧喂一次状态（`null` = 摇杆不显示） */
  setStick(stick: StickState | null): void {
    if (!this.opened) return;
    const signature = stick
      ? `${Math.round(stick.base.x)},${Math.round(stick.base.y)},${Math.round(stick.base.w)}|${Math.round(
          stick.knob.x,
        )},${Math.round(stick.knob.y)}|${stick.active ? 'a' : ''}${stick.sneaking ? 's' : ''}`
      : '-';
    if (signature === this.signature) return;
    this.signature = signature;
    this.stick = stick;
    this.draw();
  }

  private draw(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.syncSize();
    overlay.clear();
    if (this.stick) drawStick(overlay.context, this.stick);
    if (this.options.tint) applyDebugTint(overlay.context, overlay.width, overlay.height);
  }
}
