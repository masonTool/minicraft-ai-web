/**
 * 经验条 + 等级数字的 canvas 版（阶段 2）
 *
 * 照抄 `index.html` 的 `#xp-bar` / `#xp-fill` / `#xp-level`：
 *  - 轨道：深棕黑 `#14150f`、高 6px、圆角 3、内阴影一圈；
 *  - 填充：`#c2ff7a → #63c335` 竖向渐变 + 一圈绿色柔光；
 *  - 等级：**压在条的正中间**，绿字 `#80ff20` + 四向黑描边 + 一小块半透明黑牌
 *    （原版就是"数字压在条上"，所以要牌子，不然绿压绿看不清）。
 *
 * ⚠️ 与 DOM 版的两处已知差异（都写进 `notes/canvas-ui.md`）：
 *  1. DOM 的填充宽度有 `transition: width`（约 0.16s 的缓动），canvas 是**跳变**；
 *  2. 轨道的 `inset 0 1px 2px` 内阴影用"顶部一条暗线"近似，不是真正的高斯模糊。
 */

import { drawText, uiFont } from './text.ts';
import { roundRectPath, type Rect } from './widgets.ts';

/** 与 `#xp-bar` / `#xp-fill` / `#xp-level` 一一对应 */
export const XP_PALETTE = {
  track: '#14150f',
  trackEdge: 'rgba(0, 0, 0, .6)',
  trackInner: 'rgba(0, 0, 0, .55)',
  fillTop: '#c2ff7a',
  fillBottom: '#63c335',
  fillGlow: 'rgba(120, 220, 60, .55)',
  levelText: '#80ff20',
  levelBadge: 'rgba(0, 0, 0, .42)',
  outline: '#000000',
} as const;

/** 等级牌的排版（`#xp-level`：font-size 13 / bold / padding 0 5px / 圆角 4） */
export const XP_LEVEL_FONT_SIZE = 13;
export const XP_LEVEL_PADDING_X = 5;
export const XP_LEVEL_HEIGHT = 18;
export const XP_LEVEL_RADIUS = 4;

export interface XpState {
  /** `#xp-bar` 的矩形（CSS px，相对覆盖层） */
  readonly rect: Rect;
  /** 当前级内的进度 0~1 */
  readonly ratio: number;
  readonly level: number;
}

/** 进度取整到 1%：DOM 版自己也是 `Math.round(ratio * 100)%`，快照按同一粒度重建 */
export function xpRatioPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/** 状态签名（颜色/位置/等级/进度任一变化才重建快照） */
export function xpSignature(state: XpState): string {
  const r = state.rect;
  return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}|${xpRatioPercent(state.ratio)}|${state.level}`;
}

/** 等级牌矩形（**压在条的正中间**，高度 18 固定，宽度按文字量） */
export function xpLevelBadgeRect(bar: Rect, textWidth: number): Rect {
  const w = textWidth + XP_LEVEL_PADDING_X * 2;
  return {
    x: bar.x + bar.w / 2 - w / 2,
    y: bar.y + bar.h / 2 - XP_LEVEL_HEIGHT / 2,
    w,
    h: XP_LEVEL_HEIGHT,
  };
}

/** 填充矩形（圆角跟着轨道剪，右端不会露出直角） */
export function xpFillRect(bar: Rect, ratio: number): Rect {
  return { x: bar.x, y: bar.y, w: (bar.w * xpRatioPercent(ratio)) / 100, h: bar.h };
}

/** 在给定上下文里画整条经验条（快照与直接绘制共用） */
export function drawXp(ctx: CanvasRenderingContext2D, state: XpState): void {
  const bar = state.rect;
  if (!(bar.w > 0) || !(bar.h > 0)) return;
  const radius = Math.min(bar.h / 2, 3);

  ctx.save();
  // 轨道
  roundRectPath(ctx, bar, radius);
  ctx.fillStyle = XP_PALETTE.track;
  ctx.fill();
  // 内阴影：顶部一条暗线 + 外侧一圈极淡的黑边（近似 `inset 0 1px 2px` 与 `0 0 0 1px`）
  ctx.save();
  roundRectPath(ctx, bar, radius);
  ctx.clip();
  ctx.fillStyle = XP_PALETTE.trackInner;
  ctx.fillRect(bar.x, bar.y, bar.w, 1);
  ctx.restore();
  ctx.strokeStyle = XP_PALETTE.trackEdge;
  ctx.lineWidth = 1;
  roundRectPath(ctx, { x: bar.x - 0.5, y: bar.y - 0.5, w: bar.w + 1, h: bar.h + 1 }, radius + 0.5);
  ctx.stroke();

  // 填充（按轨道圆角裁剪，再画渐变 + 顶部一条高光）
  const fill = xpFillRect(bar, state.ratio);
  if (fill.w > 0.5) {
    ctx.save();
    roundRectPath(ctx, bar, radius);
    ctx.clip();
    const gradient = ctx.createLinearGradient(fill.x, fill.y, fill.x, fill.y + fill.h);
    gradient.addColorStop(0, XP_PALETTE.fillTop);
    gradient.addColorStop(1, XP_PALETTE.fillBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(fill.x, fill.y, fill.w, fill.h);
    ctx.fillStyle = 'rgba(255, 255, 255, .35)';
    ctx.fillRect(fill.x, fill.y, fill.w, 1);
    // 柔光只在快照重建时付一次（`shadowBlur` 在手机上是真开销）
    ctx.shadowColor = XP_PALETTE.fillGlow;
    ctx.shadowBlur = 8;
    ctx.fillStyle = XP_PALETTE.fillGlow;
    ctx.fillRect(Math.max(fill.x, fill.x + fill.w - 2), fill.y, 2, fill.h);
    ctx.restore();
  }

  // 等级牌（压在条中间）
  const font = uiFont(XP_LEVEL_FONT_SIZE, 700);
  ctx.font = font;
  const textWidth = ctx.measureText(String(state.level)).width;
  const badge = xpLevelBadgeRect(bar, textWidth);
  roundRectPath(ctx, badge, XP_LEVEL_RADIUS);
  ctx.fillStyle = XP_PALETTE.levelBadge;
  ctx.fill();

  // 四向黑描边 + 绿字（与原版一致：压在绿条上也读得清）
  const cx = badge.x + badge.w / 2;
  const cy = badge.y + badge.h / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = XP_PALETTE.outline;
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    ctx.fillText(String(state.level), cx + dx, cy + dy);
  }
  drawText(ctx, String(state.level), cx, cy, {
    font,
    color: XP_PALETTE.levelText,
    align: 'center',
    baseline: 'middle',
    shadow: false,
  });
  ctx.restore();
}

/** 经验条 + 等级牌的绘制单元（签名不变时每帧只 blit 一次） */
export class Xp2D {
  private state: XpState | null = null;
  private snapshot: HTMLCanvasElement | null = null;
  private snapshotScale = 1;
  private signature = '';
  /** 快照覆盖的区域（比条本身大一圈：柔光与等级牌的上下溢出） */
  private box: Rect | null = null;

  /** 快照四周的余量（等级牌高 18 > 条高 6，上下各溢出 6px，再加柔光） */
  static readonly PAD = 12;

  setState(state: XpState | null): void {
    this.state = state;
    if (!state) {
      this.signature = '';
      this.snapshot = null;
      this.box = null;
    }
  }

  get active(): boolean {
    return this.state !== null && this.state.rect.w > 0;
  }

  draw(ctx: CanvasRenderingContext2D, scale: number): boolean {
    const state = this.state;
    if (!state) return false;
    const ratio = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const signature = xpSignature(state);
    if (!this.snapshot || signature !== this.signature || Math.abs(ratio - this.snapshotScale) > 1e-3) {
      if (!this.rebuild(state, ratio)) return false;
      this.signature = signature;
    }
    const snapshot = this.snapshot;
    const box = this.box;
    if (!snapshot || !box) return false;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(snapshot, box.x, box.y, snapshot.width / this.snapshotScale, snapshot.height / this.snapshotScale);
    ctx.restore();
    return true;
  }

  private rebuild(state: XpState, scale: number): boolean {
    const bar = state.rect;
    if (!(bar.w > 0)) return false;
    const pad = Xp2D.PAD;
    const box: Rect = { x: bar.x - pad, y: bar.y - pad, w: bar.w + pad * 2, h: bar.h + pad * 2 };
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(box.w * scale));
    canvas.height = Math.max(1, Math.ceil(box.h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
    drawXp(ctx, state);
    this.snapshot = canvas;
    this.snapshotScale = scale;
    this.box = box;
    return true;
  }

  dispose(): void {
    this.state = null;
    this.snapshot = null;
    this.box = null;
    this.signature = '';
  }
}
