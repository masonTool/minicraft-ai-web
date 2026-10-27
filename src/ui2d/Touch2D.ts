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
import { TOUCH_ICON_SHAPES, TOUCH_ICON_SCALE, type TouchIconName } from './touchArt.ts';
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

/** 一颗圆形触控按钮的状态 */
export interface TouchButtonState {
  /** 按钮矩形（含 2px 描边，与 DOM 的 border-box 一致） */
  readonly rect: Rect;
  /** 图标名（`data-icon`；没有就只画底） */
  readonly icon: TouchIconName | null;
  /** 按下态（CSS 的 `:active` 是 `scale(.96)`） */
  readonly pressed: boolean;
}

/** 触控按钮的观感（照 `.touch-button` 手写一份） */
export const TOUCH_BUTTON_COLORS = {
  /** 玻璃底：上亮下暗 */
  fillTop: 'rgba(44, 52, 60, .82)',
  fillBottom: 'rgba(12, 16, 20, .82)',
  rim: 'rgba(255, 255, 255, .72)',
  icon: '#f5f7fa',
  /** 图标下面那层暗影（CSS 的 `text-shadow: 0 1px 2px`） */
  iconShadow: 'rgba(0, 0, 0, .90)',
} as const;

/** `Path2D` 按 `d` 缓存：一帧要画好几颗按钮，重复解析同一串路径是白花钱 */
const pathCache = new Map<string, Path2D>();

function cachedPath(d: string): Path2D {
  const hit = pathCache.get(d);
  if (hit) return hit;
  const path = new Path2D(d);
  pathCache.set(d, path);
  return path;
}

/**
 * 画一个图标（把 24×24 的形状缩放填进 `rect`）。
 *
 * 与 DOM 用同一份形状数据（`touchArt.ts`），所以两边不会画成两个样子。
 */
export function drawTouchIcon(
  ctx: CanvasRenderingContext2D,
  name: TouchIconName,
  rect: Rect,
  color: string,
  shadow?: string,
): void {
  if (!(rect.w > 0) || !(rect.h > 0)) return;
  const paint = (offsetY: number, fill: string): void => {
    ctx.save();
    ctx.translate(rect.x, rect.y + offsetY);
    ctx.scale(rect.w / 24, rect.h / 24);
    ctx.fillStyle = fill;
    for (const shape of TOUCH_ICON_SHAPES[name]) {
      const alpha = shape.alpha;
      const previous = ctx.globalAlpha;
      if (alpha !== undefined) ctx.globalAlpha = previous * alpha;
      if (shape.kind === 'path') {
        const path = cachedPath(shape.d);
        if (shape.evenodd) ctx.fill(path, 'evenodd');
        else ctx.fill(path);
      } else if (shape.kind === 'rect') {
        const r = shape.rx ?? 0;
        ctx.beginPath();
        if (r > 0 && typeof ctx.roundRect === 'function') ctx.roundRect(shape.x, shape.y, shape.w, shape.h, r);
        else ctx.rect(shape.x, shape.y, shape.w, shape.h);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = previous;
    }
    ctx.restore();
  };
  // 阴影：CSS 是 `text-shadow`，这里用同一形状整体下移 1px 画一遍（比 shadowBlur 便宜且够像）
  if (shadow) paint(1, shadow);
  paint(0, color);
}

/** 画一颗触控按钮（圆底 + 图标） */
export function drawTouchButton(
  ctx: CanvasRenderingContext2D,
  button: TouchButtonState,
): void {
  const { rect } = button;
  if (!(rect.w > 0) || !(rect.h > 0)) return;
  // 按下态缩到 96%（CSS 的 `:active { transform: scale(.96) }`）
  const k = button.pressed ? 0.96 : 1;
  const box: Rect =
    k === 1
      ? rect
      : { x: rect.x + (rect.w * (1 - k)) / 2, y: rect.y + (rect.h * (1 - k)) / 2, w: rect.w * k, h: rect.h * k };

  ctx.save();
  // 外圈暗边 + 投影（`box-shadow: 0 2px 6px … , 0 0 0 1px …`）
  circle(ctx, { x: box.x - 1, y: box.y - 1, w: box.w + 2, h: box.h + 2 });
  ctx.fillStyle = 'rgba(0, 0, 0, .55)';
  ctx.fill();

  // 玻璃底：顶部高光（radial）+ 上下渐变（linear）
  circle(ctx, box);
  const vertical = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  vertical.addColorStop(0, TOUCH_BUTTON_COLORS.fillTop);
  vertical.addColorStop(1, TOUCH_BUTTON_COLORS.fillBottom);
  ctx.fillStyle = vertical;
  ctx.fill();
  const highlight = ctx.createRadialGradient(
    box.x + box.w / 2,
    box.y + box.h * 0.28,
    0,
    box.x + box.w / 2,
    box.y + box.h * 0.28,
    box.w * 0.62,
  );
  highlight.addColorStop(0, 'rgba(255, 255, 255, .22)');
  highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
  circle(ctx, box);
  ctx.fillStyle = highlight;
  ctx.fill();

  // 描边
  ctx.lineWidth = 2;
  ctx.strokeStyle = TOUCH_BUTTON_COLORS.rim;
  circle(ctx, box);
  ctx.stroke();

  // 图标：居中，占按钮直径的一半
  if (button.icon) {
    const size = Math.min(box.w, box.h) * TOUCH_ICON_SCALE;
    drawTouchIcon(
      ctx,
      button.icon,
      { x: box.x + (box.w - size) / 2, y: box.y + (box.h - size) / 2, w: size, h: size },
      TOUCH_BUTTON_COLORS.icon,
      TOUCH_BUTTON_COLORS.iconShadow,
    );
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
  private buttons: readonly TouchButtonState[] = [];
  private signature = '';
  private buttonsSignature = '';
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
    this.buttons = [];
    this.overlay?.clear();
  }

  dispose(): void {
    this.close();
    this.overlay?.dispose();
    this.overlay = null;
  }

  /** 每帧喂一次按钮（按下态、显隐都会变；签名不变就不重画） */
  setButtons(buttons: readonly TouchButtonState[]): void {
    if (!this.opened) return;
    const signature = buttons
      .map(
        (b) =>
          `${Math.round(b.rect.x)},${Math.round(b.rect.y)},${Math.round(b.rect.w)}|${b.icon ?? '-'}|${
            b.pressed ? 'p' : ''
          }`,
      )
      .join(';');
    if (signature === this.buttonsSignature) return;
    this.buttonsSignature = signature;
    this.buttons = buttons;
    this.draw();
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
    for (const button of this.buttons) drawTouchButton(overlay.context, button);
    if (this.stick) drawStick(overlay.context, this.stick);
    if (this.options.tint) applyDebugTint(overlay.context, overlay.width, overlay.height);
  }
}
