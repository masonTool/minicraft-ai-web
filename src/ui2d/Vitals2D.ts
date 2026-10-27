/**
 * 状态栏四行的 canvas 版（生命 / 饥饿 / 护甲 / 氧气）—— 阶段 2 的第一块
 *
 * 与快捷栏（`Hotbar2D`）同一套套路：
 *  - **几何由调用方量 DOM**（`.vital-icon` 的矩形），因为图标尺寸随断点变
 *    （18px / 小屏 14px / 竖屏手机 22px），抄常量必错；
 *  - **离屏快照 + 签名**：数值没变就每帧一次 `drawImage`；
 *  - **低血量脉冲不重建快照**：它只是"把快照按 1→1.06 缩放"，按帧在 blit 时套变换即可，
 *    否则每帧都要重画 20 个图标（而脉冲每秒一次、一直跳）。
 *
 * 图标形状不在这里定义：路径与色值都在 `vitalsArt.ts`，DOM 版
 * （`ui/VitalsHud.ts`）与这里共用同一份，改形状只改一处。
 */

import type { Rect } from './widgets.ts';
import {
  ARMOR_PATH,
  BUBBLE,
  FOOD_PATH,
  HEART_PATH,
  VITAL_COLORS,
  VITAL_VIEW_BOX,
  type VitalState,
} from './vitalsArt.ts';

export interface VitalIcon {
  /** 图标方框（CSS px，相对覆盖层；由 `.vital-icon` 的 `getBoundingClientRect` 换算） */
  readonly rect: Rect;
  readonly state: VitalState;
}

export interface VitalsState {
  readonly hearts: readonly VitalIcon[];
  readonly foods: readonly VitalIcon[];
  /** 空数组 = 整行不显示（没穿盔甲） */
  readonly armors: readonly VitalIcon[];
  /** 空数组 = 整行不显示（氧气是满的） */
  readonly bubbles: readonly VitalIcon[];
  /** 低血量脉冲（`#vitals.low-health`，1 秒一个来回） */
  readonly pulse: boolean;
}

/** 脉冲周期与幅度（`@keyframes low-health-pulse`：`1s`、`scale(1.06)`） */
export const VITALS_PULSE_PERIOD = 1;
export const VITALS_PULSE_SCALE = 1.06;

/** 快照四周留的余量（脉冲放大 6% 时边缘不能糊掉） */
export const VITALS_SNAPSHOT_PAD = 6;

/**
 * 低血量脉冲的当前倍率（1 ~ 1.06）。
 *
 * CSS 是 `ease-in-out` 的 1s 循环，这里用 `1 - cos` 近似同一条曲线：
 * 两端斜率为 0（与 ease-in-out 一致），肉眼分辨不出差别，但**可断言**。
 */
export function vitalsPulseScale(seconds: number): number {
  if (!Number.isFinite(seconds)) return 1;
  const phase = ((seconds / VITALS_PULSE_PERIOD) % 1 + 1) % 1;
  const wave = (1 - Math.cos(phase * Math.PI * 2)) / 2;
  return 1 + (VITALS_PULSE_SCALE - 1) * wave;
}

/** 一行里第 `index` 个图标的矩形（按前一行的实际间距推，供预览/断言用） */
export function vitalIconRect(row: Rect, index: number, icon: number, gap: number): Rect {
  return { x: row.x + index * (icon + gap), y: row.y, w: icon, h: icon };
}

/** 所有图标的包围盒（没有图标时返回 `null`） */
export function vitalsBounds(state: VitalsState): Rect | null {
  const all = [...state.hearts, ...state.foods, ...state.armors, ...state.bubbles];
  if (all.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const icon of all) {
    minX = Math.min(minX, icon.rect.x);
    minY = Math.min(minY, icon.rect.y);
    maxX = Math.max(maxX, icon.rect.x + icon.rect.w);
    maxY = Math.max(maxY, icon.rect.y + icon.rect.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 状态签名：只有它变了才重建快照（脉冲不进签名，它是 blit 时的变换） */
export function vitalsSignature(state: VitalsState): string {
  const row = (icons: readonly VitalIcon[]): string =>
    icons.map((icon) => `${Math.round(icon.rect.x)},${Math.round(icon.rect.y)},${Math.round(icon.rect.w)},${icon.state}`).join(';');
  return [row(state.hearts), row(state.foods), row(state.armors), row(state.bubbles)].join('|');
}

/** 路径对象只建一次（`Path2D` 是浏览器 API，测试里不碰） */
let paths: { heart: Path2D; food: Path2D; armor: Path2D } | null = null;

function shapePaths(): { heart: Path2D; food: Path2D; armor: Path2D } | null {
  if (paths) return paths;
  if (typeof Path2D === 'undefined') return null;
  paths = { heart: new Path2D(HEART_PATH), food: new Path2D(FOOD_PATH), armor: new Path2D(ARMOR_PATH) };
  return paths;
}

type IconKind = 'heart' | 'food' | 'armor' | 'bubble';

const KIND_COLORS: Record<IconKind, { empty: string; main: string }> = {
  heart: { empty: VITAL_COLORS.heartEmpty, main: VITAL_COLORS.heart },
  food: { empty: VITAL_COLORS.foodEmpty, main: VITAL_COLORS.food },
  armor: { empty: VITAL_COLORS.armorEmpty, main: VITAL_COLORS.armor },
  bubble: { empty: VITAL_COLORS.heartEmpty, main: VITAL_COLORS.air },
};

/**
 * 画一颗图标。
 *
 * ⚠️ 半颗的裁剪在 **9×9 坐标系**里做（`rect(0,0,4.5,9)`），与 DOM 版共用同一个
 * `clipPath` 的数值 —— 换成 CSS px 去裁会在不同 DPR 下差半个像素，出现"半颗心漏个边"。
 */
function drawIcon(ctx: CanvasRenderingContext2D, icon: VitalIcon, kind: IconKind): void {
  const scale = icon.rect.w / VITAL_VIEW_BOX;
  if (!(scale > 0)) return;
  const colors = KIND_COLORS[kind];
  ctx.save();
  ctx.translate(icon.rect.x, icon.rect.y);
  ctx.scale(scale, scale);

  if (kind === 'bubble') {
    ctx.beginPath();
    ctx.arc(BUBBLE.cx, BUBBLE.cy, BUBBLE.r, 0, Math.PI * 2);
    ctx.strokeStyle = VITAL_COLORS.heartEmpty;
    ctx.lineWidth = BUBBLE.strokeWidth;
    ctx.stroke();
    if (icon.state !== 'empty') {
      if (icon.state === 'half') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, 4.5, VITAL_VIEW_BOX);
        ctx.clip();
      }
      ctx.beginPath();
      ctx.arc(BUBBLE.cx, BUBBLE.cy, BUBBLE.r, 0, Math.PI * 2);
      ctx.fillStyle = colors.main;
      ctx.fill();
      if (icon.state === 'half') ctx.restore();
    }
    ctx.restore();
    return;
  }

  const shapes = shapePaths();
  if (!shapes) {
    ctx.restore();
    return;
  }
  const path = kind === 'heart' ? shapes.heart : kind === 'food' ? shapes.food : shapes.armor;
  // 空槽（底）先画：这样半颗心也有一圈深色底，与原版一致
  ctx.fillStyle = colors.empty;
  ctx.fill(path);
  if (icon.state !== 'empty') {
    if (icon.state === 'half') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, 4.5, VITAL_VIEW_BOX);
      ctx.clip();
    }
    ctx.fillStyle = colors.main;
    ctx.fill(path);
    if (icon.state === 'half') ctx.restore();
  }
  ctx.restore();
}

/** 在给定的 CSS px 坐标里画整条状态栏（快照与直接绘制共用） */
export function drawVitals(ctx: CanvasRenderingContext2D, state: VitalsState): void {
  for (const icon of state.hearts) drawIcon(ctx, icon, 'heart');
  for (const icon of state.foods) drawIcon(ctx, icon, 'food');
  for (const icon of state.armors) drawIcon(ctx, icon, 'armor');
  for (const icon of state.bubbles) drawIcon(ctx, icon, 'bubble');
}

/**
 * 绘制单元：状态进、像素出。
 *
 * `draw()` 的第三个参数是**当前时间（秒）**：低血量脉冲要靠它算缩放。
 * 传 `0` 或非有限值时按"不脉冲"画（预览/截图用）。
 */
export class Vitals2D {
  private state: VitalsState | null = null;
  private snapshot: HTMLCanvasElement | null = null;
  private snapshotScale = 1;
  private signature = '';
  private box: Rect | null = null;

  setState(state: VitalsState | null): void {
    this.state = state;
    if (!state) {
      this.signature = '';
      this.snapshot = null;
      this.box = null;
    }
  }

  get active(): boolean {
    return this.state !== null && vitalsBounds(this.state) !== null;
  }

  draw(ctx: CanvasRenderingContext2D, scale: number, seconds = 0): boolean {
    const state = this.state;
    if (!state) return false;
    const ratio = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const signature = vitalsSignature(state);
    if (!this.snapshot || signature !== this.signature || Math.abs(ratio - this.snapshotScale) > 1e-3) {
      if (!this.rebuild(state, ratio)) return false;
      this.signature = signature;
    }
    const snapshot = this.snapshot;
    const box = this.box;
    if (!snapshot || !box) return false;

    ctx.save();
    // 脉冲：只改 blit 的变换，不重建快照（见文件头）
    if (state.pulse) {
      const s = vitalsPulseScale(seconds);
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(snapshot, box.x, box.y, snapshot.width / this.snapshotScale, snapshot.height / this.snapshotScale);
    ctx.restore();
    return true;
  }

  private rebuild(state: VitalsState, scale: number): boolean {
    const bounds = vitalsBounds(state);
    if (!bounds) return false;
    const box: Rect = {
      x: bounds.x - VITALS_SNAPSHOT_PAD,
      y: bounds.y - VITALS_SNAPSHOT_PAD,
      w: bounds.w + VITALS_SNAPSHOT_PAD * 2,
      h: bounds.h + VITALS_SNAPSHOT_PAD * 2,
    };
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(box.w * scale));
    canvas.height = Math.max(1, Math.ceil(box.h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
    drawVitals(ctx, state);
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
