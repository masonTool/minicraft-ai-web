/**
 * 指南针 / 时钟的**表盘**（`src/ui2d/` 阶段 2 的最后一样）
 *
 * 与 `ui/ToolHud.ts` 一一对应：52×52 的圆盘、铜色边（指南针）或铁蓝边（时钟）、
 * 四个方位字母（只有指南针有）、一根上红下白的三角指针、下面一行 10px 读数。
 *
 * 两处必须自己算的东西：
 *  1. **指针的旋转**：CSS 那边是 `rotate(deg)` + `transform-origin: 50% 100%`，
 *     canvas 没有元素级的 transform-origin，只能按角度把三角的三个顶点算出来；
 *  2. **刻度的位置**：四个字母分别贴在上下左右的内缘，坐标随表盘尺寸变（手机上会缩）。
 * 两条都做成纯函数，断言直接打角度与坐标（见 `tests/ui2d.test.ts`）。
 */

import { drawText, uiFont } from './text.ts';
import { type Rect } from './widgets.ts';

export type ToolDialKind = 'compass' | 'clock';

/** 表盘边长（`.tool-hud-dial { width: 52px; height: 52px }`，含 3px 边框） */
export const DIAL_SIZE = 52;
/** 边框宽度（`border: 3px solid`） */
export const DIAL_BORDER = 3;
/** 指针长度与半宽（`.tool-hud-needle::before { width: 4px; height: 22px }`） */
export const NEEDLE_LENGTH = 22;
export const NEEDLE_HALF_WIDTH = 2;
/** 读数文字（`.tool-hud-label { font-size: 10px }`） */
export const DIAL_LABEL_FONT_SIZE = 10;

export const DIAL_COLORS = {
  /** 指南针盘面（径向渐变的三个停靠点） */
  faceInner: '#f2eee2',
  faceMid: '#cfc7b2',
  faceOuter: '#a89f8c',
  borderCompass: '#6b5a36',
  borderClock: '#3c4a5e',
  /** 时钟盘面偏冷色（`.tool-hud[data-kind='clock'] .tool-hud-dial`） */
  clockInner: '#dfe8f5',
  clockMid: '#9fb0c8',
  clockOuter: '#6f7f96',
  /** 方位字母 */
  tick: '#57492c',
  needleNorth: '#e03b3b',
  needleSouth: '#f6f4ec',
  label: '#f2efe4',
} as const;

/** 表盘边框色 */
export function dialBorderColor(kind: ToolDialKind): string {
  return kind === 'clock' ? DIAL_COLORS.borderClock : DIAL_COLORS.borderCompass;
}

/** 表盘圆心 */
export function dialCenter(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * 指针三角的三个顶点（0° 指上，顺时针为正）。
 *
 * 与 CSS `rotate(deg)` 同一套方向：`sin/cos` 的符号按"屏幕 y 向下"取。
 */
export function dialNeedlePoints(
  rect: Rect,
  deg: number,
  length = NEEDLE_LENGTH,
  halfWidth = NEEDLE_HALF_WIDTH,
): { apex: { x: number; y: number }; left: { x: number; y: number }; right: { x: number; y: number } } {
  const { x: cx, y: cy } = dialCenter(rect);
  const rad = ((Number.isFinite(deg) ? deg : 0) * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  // 尖端：从圆心朝"上"出发，按角度旋转
  const apex = { x: cx + sin * length, y: cy - cos * length };
  // 底边两端：与指针方向垂直
  const left = { x: cx + cos * halfWidth, y: cy + sin * halfWidth };
  const right = { x: cx - cos * halfWidth, y: cy - sin * halfWidth };
  return { apex, left, right };
}

/** 四个方位字母的锚点（贴内缘；时钟不用） */
export function dialTickAnchors(rect: Rect): Record<'n' | 'e' | 's' | 'w', { x: number; y: number }> {
  const inset = DIAL_BORDER + 3;
  const { x: cx, y: cy } = dialCenter(rect);
  return {
    n: { x: cx, y: rect.y + inset },
    s: { x: cx, y: rect.y + rect.h - inset },
    e: { x: rect.x + rect.w - inset, y: cy },
    w: { x: rect.x + inset, y: cy },
  };
}

/** 画表盘（含边框、盘面、刻度、指针）—— 读数文字由调用方另画或传 `label` */
export function drawToolDial(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  kind: ToolDialKind,
  deg: number,
  label = '',
): void {
  if (!(rect.w > 0) || !(rect.h > 0)) return;
  const center = dialCenter(rect);
  const radius = Math.min(rect.w, rect.h) / 2;
  const inner = Math.max(0, radius - DIAL_BORDER);

  ctx.save();
  // 盘面：径向渐变（高光在左上，与原版 CSS 的 `circle at 35% 30%` 同向）
  const gradient = ctx.createRadialGradient(
    rect.x + rect.w * 0.35,
    rect.y + rect.h * 0.3,
    0,
    center.x,
    center.y,
    radius,
  );
  const clock = kind === 'clock';
  gradient.addColorStop(0, clock ? DIAL_COLORS.clockInner : DIAL_COLORS.faceInner);
  gradient.addColorStop(0.7, clock ? DIAL_COLORS.clockMid : DIAL_COLORS.faceMid);
  gradient.addColorStop(1, clock ? DIAL_COLORS.clockOuter : DIAL_COLORS.faceOuter);
  ctx.beginPath();
  ctx.arc(center.x, center.y, inner, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  // 边框
  ctx.lineWidth = DIAL_BORDER;
  ctx.strokeStyle = dialBorderColor(kind);
  ctx.beginPath();
  ctx.arc(center.x, center.y, inner + DIAL_BORDER / 2, 0, Math.PI * 2);
  ctx.stroke();

  // 方位字母（时钟没有）
  if (!clock) {
    const anchors = dialTickAnchors(rect);
    ctx.font = uiFont(9, 700);
    ctx.fillStyle = DIAL_COLORS.tick;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', anchors.n.x, anchors.n.y);
    ctx.fillText('E', anchors.e.x, anchors.e.y);
    ctx.fillText('S', anchors.s.x, anchors.s.y);
    ctx.fillText('W', anchors.w.x, anchors.w.y);
  }

  // 指针：三角，上半红、下半白（时钟是整根浅色细针）
  const length = clock ? 19 : NEEDLE_LENGTH;
  const halfWidth = clock ? 1.5 : NEEDLE_HALF_WIDTH;
  const points = dialNeedlePoints(rect, deg, length, halfWidth);
  ctx.beginPath();
  ctx.moveTo(points.apex.x, points.apex.y);
  ctx.lineTo(points.right.x, points.right.y);
  ctx.lineTo(points.left.x, points.left.y);
  ctx.closePath();
  ctx.fillStyle = clock ? DIAL_COLORS.needleSouth : DIAL_COLORS.needleNorth;
  ctx.fill();
  if (!clock) {
    // 下半截白：从圆心到两底边端点的三角形
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(points.right.x, points.right.y);
    ctx.lineTo(points.left.x, points.left.y);
    ctx.closePath();
    ctx.fillStyle = DIAL_COLORS.needleSouth;
    ctx.fill();
  }
  // 圆心轴
  ctx.beginPath();
  ctx.arc(center.x, center.y, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = '#57492c';
  ctx.fill();

  // 读数（表盘正下方一行 10px）
  if (label.length > 0) {
    drawText(ctx, label, rect.x + rect.w / 2, rect.y + rect.h + 4, {
      font: uiFont(DIAL_LABEL_FONT_SIZE),
      color: DIAL_COLORS.label,
      align: 'center',
      baseline: 'top',
      shadow: true,
    });
  }
  ctx.restore();
}
