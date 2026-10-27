/**
 * 三样"提示条"的 canvas 版（`src/ui2d/` 阶段 2 收尾）
 *
 *  - **目标名**（`#target-info`）：准星下方一行小字，告诉你看见的是什么东西；
 *  - **攻击蓄力条**（`#attack-cooldown`）：准星下方 44×3 的白条，冷却满了就消失；
 *  - **物品名浮标**（`#selected-item-name`）：换槽时在快捷栏上方浮 2 秒再淡出。
 *
 * 三者共同点：**纯展示、不吃事件、尺寸都只有几十像素**。所以这里不做快照缓存 ——
 * 每帧重画也就两次 `fillText` + 一块小矩形，缓存反而多一层签名要比。
 *
 * ⚠️ 与 DOM 版唯一的实质差异：物品名浮标的淡出**由时间算**（`itemNameAlpha`），
 * 而 DOM 是 CSS `transition`。两者时长一样（350ms），但 canvas 这边的进度取决于
 * 帧率与传入的 `shownAt`，暂停时不会"继续淡"——这反而是对的。
 */

import { drawText, uiFont } from './text.ts';
import { PALETTE, roundRectPath, type Rect } from './widgets.ts';

/** 三样提示条的配色（对应 `#target-info` / `#attack-cooldown` / `#selected-item-name`） */
export const TIP_COLORS = {
  targetBg: 'rgba(0, 0, 0, .42)',
  targetText: '#f0f0f0',
  chargeTrack: 'rgba(0, 0, 0, .45)',
  chargeFill: '#e6e6e6',
  nameBg: 'rgba(0, 0, 0, .58)',
  nameText: '#ffffff',
} as const;

/** 攻击蓄力条的几何（`#attack-cooldown`：44×3、`left: 50%` 再 `-22px`、`top: 50% + 16px`） */
export const ATTACK_CHARGE_WIDTH = 44;
export const ATTACK_CHARGE_HEIGHT = 3;
export const ATTACK_CHARGE_TOP_OFFSET = 16;

/** 蓄力条矩形（视口居中、准星正下方） */
export function attackChargeRect(viewportW: number, viewportH: number): Rect {
  return {
    x: Math.round(viewportW / 2 - ATTACK_CHARGE_WIDTH / 2),
    y: Math.round(viewportH / 2 + ATTACK_CHARGE_TOP_OFFSET),
    w: ATTACK_CHARGE_WIDTH,
    h: ATTACK_CHARGE_HEIGHT,
  };
}

/**
 * 蓄力进度 → 显示用的百分比（0~100，**量化到 2%**）。
 *
 * 与 DOM 版同一条口径（`AttackCooldownHud` 里 `Math.round(progress * 50) * 2`）：
 * 量化是为了不因为浮点抖动每帧重画，同时也让"快满了"这个观感稳定。
 */
export function attackChargePercent(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.round(Math.min(1, Math.max(0, progress)) * 50) * 2;
}

/** 物品名浮标的时长（`#selected-item-name`：`.show` 的过渡 0.35s + 2s 后收） */
export const ITEM_NAME_HOLD_MS = 2000;
export const ITEM_NAME_FADE_MS = 350;
/** 快捷栏上方的高度（`bottom: 78px`）—— 由调用方换算成矩形，这里只用来做参照 */
export const ITEM_NAME_BOTTOM = 78;

/**
 * 物品名浮标的当前不透明度（0~1）。
 *
 * 时间线：0 → `fadeMs` 淡入；`fadeMs` → `holdMs` 保持 1；`holdMs` → `holdMs + fadeMs` 淡出；
 * 之后是 0（调用方据此整块不画）。
 */
export function itemNameAlpha(ageMs: number, holdMs = ITEM_NAME_HOLD_MS, fadeMs = ITEM_NAME_FADE_MS): number {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  if (!(fadeMs > 0)) return ageMs <= holdMs ? 1 : 0;
  if (ageMs < fadeMs) return ageMs / fadeMs;
  if (ageMs <= holdMs) return 1;
  const out = 1 - (ageMs - holdMs) / fadeMs;
  return out > 0 ? out : 0;
}

/** 目标名 / 物品名的文字尺寸（`draw*` 内部测量，调用方不必关心字体） */
export const TIP_TARGET_FONT_SIZE = 12;
export const TIP_NAME_FONT_SIZE = 13;
/** 物品名浮标的圆角（`#selected-item-name { border-radius: 14px }`） */
export const ITEM_NAME_RADIUS = 14;

/** 目标名：半透明黑底 + 一行浅色字（矩形由调用方量 DOM 得来，含 CSS 的 padding） */
export function drawTargetLabel(ctx: CanvasRenderingContext2D, rect: Rect, text: string): void {
  if (text.length === 0 || !(rect.w > 0)) return;
  ctx.save();
  ctx.fillStyle = TIP_COLORS.targetBg;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  drawText(ctx, text, rect.x + rect.w / 2, rect.y + rect.h / 2, {
    font: uiFont(TIP_TARGET_FONT_SIZE),
    color: TIP_COLORS.targetText,
    align: 'center',
    baseline: 'middle',
    maxWidth: rect.w - 4,
  });
  ctx.restore();
}

/** 蓄力条：暗槽 + 白填充（没有边框，原版就是一条"正在充能"的白线） */
export function drawAttackCharge(ctx: CanvasRenderingContext2D, rect: Rect, percent: number): void {
  if (!(rect.w > 0) || !(rect.h > 0)) return;
  const value = Math.min(100, Math.max(0, percent));
  ctx.save();
  roundRectPath(ctx, rect, Math.min(rect.h / 2, 2));
  ctx.fillStyle = TIP_COLORS.chargeTrack;
  ctx.fill();
  const filled = (rect.w * value) / 100;
  if (filled > 0.5) {
    ctx.save();
    roundRectPath(ctx, rect, Math.min(rect.h / 2, 2));
    ctx.clip();
    ctx.fillStyle = TIP_COLORS.chargeFill;
    ctx.fillRect(rect.x, rect.y, filled, rect.h);
    ctx.restore();
  }
  ctx.restore();
}

/** 物品名浮标：胶囊黑底 + 居中白字，整块按 `alpha` 淡入淡出 */
export function drawItemNamePop(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  text: string,
  alpha: number,
): void {
  if (text.length === 0 || !(rect.w > 0) || !(alpha > 0.004)) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  roundRectPath(ctx, rect, Math.min(ITEM_NAME_RADIUS, rect.h / 2));
  ctx.fillStyle = TIP_COLORS.nameBg;
  ctx.fill();
  drawText(ctx, text, rect.x + rect.w / 2, rect.y + rect.h / 2, {
    font: uiFont(TIP_NAME_FONT_SIZE),
    color: TIP_COLORS.nameText,
    align: 'center',
    baseline: 'middle',
    maxWidth: rect.w - 8,
    shadow: false,
  });
  ctx.restore();
}

/** 提示条的三样状态（`null`/缺省 = 这一帧不画） */
export interface TipsState {
  /** 目标名：矩形由 DOM 量得（含 padding），文本取自 `#target-info` */
  readonly target: { readonly rect: Rect; readonly text: string } | null;
  /** 蓄力条：`rect` 由 `attackChargeRect` 给出，`percent` 已量化到 2% */
  readonly charge: { readonly rect: Rect; readonly percent: number } | null;
  /**
   * 物品名浮标：`shownAtMs` 是**显示那一刻**的时间戳（`performance.now()`），
   * 不透明度每帧由 `itemNameAlpha(now - shownAtMs)` 算
   */
  readonly itemName: {
    readonly rect: Rect;
    readonly text: string;
    readonly shownAtMs: number;
    readonly holdMs?: number;
    readonly fadeMs?: number;
  } | null;
}

/** 画三样提示条（顺序无所谓：它们在屏幕上互不重叠） */
export function drawTips(ctx: CanvasRenderingContext2D, state: TipsState, nowMs: number): void {
  const name = state.itemName;
  if (name) {
    const age = nowMs - name.shownAtMs;
    const alpha = itemNameAlpha(age, name.holdMs, name.fadeMs);
    drawItemNamePop(ctx, name.rect, name.text, alpha);
  }
  if (state.target) drawTargetLabel(ctx, state.target.rect, state.target.text);
  if (state.charge) drawAttackCharge(ctx, state.charge.rect, state.charge.percent);
}

/** 供调试：这一帧提示条有没有东西可画（全空时调用方直接跳过整段） */
export function tipsVisible(state: TipsState | null, nowMs = 0): boolean {
  if (!state) return false;
  if (state.target && state.target.text.length > 0) return true;
  if (state.charge) return true;
  const name = state.itemName;
  if (!name || name.text.length === 0) return false;
  return itemNameAlpha(nowMs - name.shownAtMs, name.holdMs, name.fadeMs) > 0.004;
}

/** 画布上的"空提示条"（断言与初始状态用） */
export const EMPTY_TIPS: TipsState = { target: null, charge: null, itemName: null };

/** 供断言：描边颜色与面板色是否用同一套（避免有人在这里新造色） */
export const TIP_TEXT_OUTLINE = PALETTE.outline;
