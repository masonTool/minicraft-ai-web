/**
 * 快捷栏的 canvas 版（`src/ui2d/` 阶段 1.5）
 *
 * 为什么第一批试点（红闪 / Boss 条 / 破坏进度）看不出效果，而这里能看出来：
 * 那三样都是"事件发生时才出现"的浮层，正常玩的时候屏幕上什么都没有 ——
 * 玩家自然无从对比。快捷栏是**每帧都在眼前**的 9 格 + 图标 + 数量 + 耐久 + 选中框，
 * 换成 canvas 之后"整条底栏的像素来自哪里"是看得见摸得着的。
 *
 * 三条与 DOM 版对齐的口径：
 *  1. **几何全部来自 DOM 实测**（`getBoundingClientRect` 换算到覆盖层坐标），
 *     这里一个 `--hotbar-slot` 都不抄 —— 断点、安全区、触摸端的尺寸变化自动跟上（见决策 D1）；
 *  2. **画法照抄 `index.html`**：面板 `#c6c6c6` + 3px 斜面 + 2px 黑描边；格子 `#8b8b8b` +
 *     2px 斜面；选中格 = 白框 + 半透明白底 + 上抬 2px + 放大 1.08 + 一圈柔光；
 *     数量 12px 带四向黑描边、序号 10px、耐久条 3px 三档。
 *  3. **图标不自己画**：调用方把现成的 `.slot canvas` 当 `CanvasImageSource` 传进来
 *     （`ui/ItemIcon.drawItemIcon` 是唯一入口，见决策 D4）。这样这一层不必依赖 `ui/`。
 *
 * ⚠️ **命中不在这里**。覆盖层是整屏元素，打开 `pointer-events` 会把触摸端的视角手势
 * 一起吃掉（区域级穿透要等阶段 6）；现在点击/长按提示仍走原来的 DOM 绑定，
 * 格子只是被设成 `opacity: 0`（见决策 D2）。
 */

import { drawText, uiFont } from './text.ts';
import { PALETTE, roundRectPath, type Rect } from './widgets.ts';

/** 格子边框宽度（`#hotbar .slot { border: 2px solid }`） */
export const HOTBAR_SLOT_BORDER = 2;
/** 面板边框宽度（`#hotbar { border: 3px solid }`） */
export const HOTBAR_PANEL_BORDER = 3;
/** 图标边长（`#hotbar .slot canvas { width: 32px }`） */
export const HOTBAR_ICON_SIZE = 32;
/** 数量字号 / 序号字号 */
export const HOTBAR_COUNT_FONT_SIZE = 12;
export const HOTBAR_INDEX_FONT_SIZE = 10;
/** 耐久条高度与内缩（`.dur-bar { left/right: 3px; bottom: 2px; height: 3px }`） */
export const HOTBAR_DURABILITY_HEIGHT = 3;
export const HOTBAR_DURABILITY_INSET = 3;
export const HOTBAR_DURABILITY_BOTTOM = 2;
/** 选中格：上抬 2px、放大 8%（`transform: translateY(-2px) scale(1.08)`） */
export const HOTBAR_ACTIVE_LIFT = 2;
export const HOTBAR_ACTIVE_SCALE = 1.08;
/** 快照四周多留的一圈（选中格的柔光 12px + 上抬 2px + 2px 黑描边都在面板外面） */
export const HOTBAR_SNAPSHOT_PAD = 16;

/** 耐久三档的填充色（与 `--dur-high/mid/low` 一一对应） */
export const HOTBAR_DURABILITY_COLORS = {
  high: '#4ce04c',
  mid: '#e8d24c',
  low: '#e0503c',
} as const;

export type DurabilityLevel = keyof typeof HOTBAR_DURABILITY_COLORS;

export interface HotbarDurability {
  /** 剩余耐久比例 0~1（`itemVisuals.durabilityBar().ratio`） */
  readonly ratio: number;
  readonly level: DurabilityLevel;
}

export interface HotbarSlotState {
  /** 格子的**边框盒**矩形（CSS px，相对覆盖层） */
  readonly rect: Rect;
  readonly active: boolean;
  /** 堆叠数量；`<= 1` 不画数字 */
  readonly count: number;
  /** 0 起的槽位号，画成 1~9 */
  readonly index: number;
  /** 图标来源（`null` = 空槽） */
  readonly icon: CanvasImageSource | null;
  /** `null` = 不画耐久条（满耐久或本来没有耐久） */
  readonly durability: HotbarDurability | null;
}

export interface HotbarState {
  /** `#hotbar` 的边框盒矩形 */
  readonly panel: Rect;
  readonly slots: readonly HotbarSlotState[];
  /**
   * 图标位图可能换了（`refreshHotbar` 每跑一次就 +1）。
   *
   * 图标是**同一个 canvas 元素**被反复重绘的，元素引用永远不变，光比对引用看不出
   * "这一格换了物品"。所以由调用方给一个只增不减的版本号，让快照知道该重建了。
   */
  readonly revision: number;
}

/** 格子**内容盒**（边框以内）——`absolute` 定位的子元素都相对它偏移 */
export function hotbarContentRect(slot: Rect): Rect {
  const b = HOTBAR_SLOT_BORDER;
  return { x: slot.x + b, y: slot.y + b, w: Math.max(0, slot.w - b * 2), h: Math.max(0, slot.h - b * 2) };
}

/** 图标矩形：在内容盒里居中，边长固定 32（不随格子缩放，与 DOM 的 `place-items: center` 一致） */
export function hotbarIconRect(slot: Rect): Rect {
  const content = hotbarContentRect(slot);
  return {
    x: content.x + (content.w - HOTBAR_ICON_SIZE) / 2,
    y: content.y + (content.h - HOTBAR_ICON_SIZE) / 2,
    w: HOTBAR_ICON_SIZE,
    h: HOTBAR_ICON_SIZE,
  };
}

/** 选中格实际占的矩形（以中心缩放 1.08 再上抬 2px）——断言与"视觉优先"的判断都用它 */
export function hotbarActiveRect(slot: Rect): Rect {
  const w = slot.w * HOTBAR_ACTIVE_SCALE;
  const h = slot.h * HOTBAR_ACTIVE_SCALE;
  return {
    x: slot.x + (slot.w - w) / 2,
    y: slot.y + (slot.h - h) / 2 - HOTBAR_ACTIVE_LIFT,
    w,
    h,
  };
}

/** 序号文字的左/上锚点（`.index { top: 0; left: 3px }`，相对内容盒） */
export function hotbarIndexAnchor(slot: Rect): { x: number; y: number } {
  const content = hotbarContentRect(slot);
  return { x: content.x + HOTBAR_DURABILITY_INSET, y: content.y };
}

/** 数量文字的右下锚点（`.count { right: 2px; bottom: 1px }`，相对内容盒） */
export function hotbarCountAnchor(slot: Rect): { x: number; y: number } {
  const content = hotbarContentRect(slot);
  return { x: content.x + content.w - 2, y: content.y + content.h - 1 };
}

/** 耐久条的轨道矩形（`.dur-bar { left/right: 3px; bottom: 2px; height: 3px }`） */
export function hotbarDurabilityRect(slot: Rect): Rect {
  const content = hotbarContentRect(slot);
  const inset = HOTBAR_DURABILITY_INSET;
  return {
    x: content.x + inset,
    y: content.y + content.h - HOTBAR_DURABILITY_BOTTOM - HOTBAR_DURABILITY_HEIGHT,
    w: Math.max(0, content.w - inset * 2),
    h: HOTBAR_DURABILITY_HEIGHT,
  };
}

/** 耐久条的填充矩形（宽度按比例，取整到 CSS px 以内以免半像素糊边） */
export function hotbarDurabilityFillRect(slot: Rect, ratio: number): Rect {
  const track = hotbarDurabilityRect(slot);
  const value = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return { x: track.x, y: track.y, w: track.w * value, h: track.h };
}

/**
 * 状态签名：变了才重建快照。
 *
 * 只拼**会影响像素**的字段。省掉 `icon` 的引用比对（永远是同一个 canvas 元素），
 * 改由 `revision` 表达"位图可能换了"。
 */
export function hotbarSignature(state: HotbarState): string {
  const panel = state.panel;
  const head = `${panel.x},${panel.y},${panel.w},${panel.h},${state.revision}`;
  const slots = state.slots.map((slot) => {
    const r = slot.rect;
    const durability = slot.durability
      ? `${slot.durability.level}${Math.round(slot.durability.ratio * 100)}`
      : '-';
    return `${r.x},${r.y},${r.w},${r.h},${slot.active ? 1 : 0},${slot.count},${slot.index},${
      slot.icon ? 1 : 0
    },${durability}`;
  });
  return `${head}|${slots.join(';')}`;
}

/** 四向黑描边（数量数字压在图标上，单方向阴影压不住浅色图标） */
function drawOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  align: CanvasTextAlign,
  baseline: CanvasTextBaseline,
): void {
  if (text.length === 0) return;
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillStyle = '#000000';
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [1, 1],
  ] as const) {
    ctx.fillText(text, x + dx, y + dy);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** 面板：`#c6c6c6` 底 + 3px 斜面 + 外面那一圈 2px 纯黑（`--panel-shadow`） */
function drawPanel(ctx: CanvasRenderingContext2D, panel: Rect): void {
  const b = HOTBAR_PANEL_BORDER;
  const outline = 2;
  ctx.fillStyle = PALETTE.outline;
  ctx.fillRect(panel.x - outline, panel.y - outline, panel.w + outline * 2, outline);
  ctx.fillRect(panel.x - outline, panel.y + panel.h, panel.w + outline * 2, outline);
  ctx.fillRect(panel.x - outline, panel.y, outline, panel.h);
  ctx.fillRect(panel.x + panel.w, panel.y, outline, panel.h);

  ctx.fillStyle = PALETTE.panel;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.fillStyle = PALETTE.edgeLight;
  ctx.fillRect(panel.x, panel.y, panel.w, b);
  ctx.fillRect(panel.x, panel.y, b, panel.h);
  ctx.fillStyle = PALETTE.edgeDark;
  ctx.fillRect(panel.x, panel.y + panel.h - b, panel.w, b);
  ctx.fillRect(panel.x + panel.w - b, panel.y, b, panel.h);
}

/** 一个格子：底 + 斜面 + 图标 + 数量 + 序号 + 耐久条 */
function drawSlot(ctx: CanvasRenderingContext2D, slot: HotbarSlotState): void {
  const rect = slot.rect;
  const b = HOTBAR_SLOT_BORDER;
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;

  ctx.save();
  if (slot.active) {
    // 与 CSS 的 `translateY(-2px) scale(1.08)` 等价：先移位、再绕中心缩放
    ctx.translate(0, -HOTBAR_ACTIVE_LIFT);
    ctx.translate(centerX, centerY);
    ctx.scale(HOTBAR_ACTIVE_SCALE, HOTBAR_ACTIVE_SCALE);
    ctx.translate(-centerX, -centerY);
    // 柔光只在重建快照时付一次（稳态每帧只是一次 drawImage，见决策 D3）
    ctx.shadowColor = 'rgba(255, 255, 255, .45)';
    ctx.shadowBlur = 12;
  }

  // 底：选中格是"半透明白压在面板上"，普通格是 #8b8b8b
  ctx.fillStyle = slot.active ? 'rgba(255, 255, 255, .26)' : PALETTE.face;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';

  // 斜面：普通格左上亮、右下暗；选中格四边全白（与 `.slot.active { border-color: #fff }` 一致）
  if (slot.active) {
    ctx.fillStyle = PALETTE.edgeLight;
    ctx.fillRect(rect.x, rect.y, rect.w, b);
    ctx.fillRect(rect.x, rect.y + rect.h - b, rect.w, b);
    ctx.fillRect(rect.x, rect.y, b, rect.h);
    ctx.fillRect(rect.x + rect.w - b, rect.y, b, rect.h);
  } else {
    ctx.fillStyle = PALETTE.edgeLight;
    ctx.fillRect(rect.x, rect.y, rect.w, b);
    ctx.fillRect(rect.x, rect.y, b, rect.h);
    ctx.fillStyle = PALETTE.edgeDark;
    ctx.fillRect(rect.x, rect.y + rect.h - b, rect.w, b);
    ctx.fillRect(rect.x + rect.w - b, rect.y, b, rect.h);
  }

  if (slot.icon) {
    const icon = hotbarIconRect(rect);
    // 像素风图标不能有插值，否则边缘会糊一圈
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(slot.icon, icon.x, icon.y, icon.w, icon.h);
    ctx.imageSmoothingEnabled = true;
  }

  if (slot.count > 1) {
    const anchor = hotbarCountAnchor(rect);
    drawOutlinedText(
      ctx,
      String(slot.count),
      anchor.x,
      anchor.y,
      uiFont(HOTBAR_COUNT_FONT_SIZE, 700),
      'right',
      'bottom',
    );
  }

  const label = hotbarIndexAnchor(rect);
  drawText(ctx, String(slot.index + 1), label.x, label.y, {
    font: uiFont(HOTBAR_INDEX_FONT_SIZE),
    color: '#ffffff',
    align: 'left',
    baseline: 'top',
    alpha: slot.active ? 1 : 0.7,
  });

  if (slot.durability) {
    const track = hotbarDurabilityRect(rect);
    ctx.fillStyle = 'rgba(0, 0, 0, .65)';
    roundRectPath(ctx, track, 2);
    ctx.fill();
    const fill = hotbarDurabilityFillRect(rect, slot.durability.ratio);
    if (fill.w > 0.5) {
      ctx.save();
      roundRectPath(ctx, track, 2);
      ctx.clip();
      ctx.fillStyle = HOTBAR_DURABILITY_COLORS[slot.durability.level];
      ctx.fillRect(fill.x, fill.y, fill.w, fill.h);
      ctx.restore();
    }
  }

  ctx.restore();
}

/** 把一整条快捷栏画到给定上下文（坐标为 CSS px；快照与直接绘制共用这一个入口） */
export function drawHotbar(ctx: CanvasRenderingContext2D, state: HotbarState): void {
  drawPanel(ctx, state.panel);
  for (const slot of state.slots) drawSlot(ctx, slot);
}

/** 快照左上角在覆盖层里的位置（比面板多留一圈给柔光与描边） */
export function hotbarSnapshotOrigin(panel: Rect): { x: number; y: number } {
  return { x: panel.x - HOTBAR_SNAPSHOT_PAD, y: panel.y - HOTBAR_SNAPSHOT_PAD };
}

/**
 * 快捷栏的绘制单元：**状态进、像素出**。
 *
 * 稳态每帧只做一次 `drawImage`（快照），只有签名变了才重建那张离屏画布 ——
 * 9 个图标的 blit、二十几次矩形填充、十几次文字都只在"换槽/捡东西/掉耐久/转屏"时付。
 */
export class Hotbar2D {
  private state: HotbarState | null = null;
  private snapshot: HTMLCanvasElement | null = null;
  private snapshotScale = 1;
  private signature = '';

  /** 传 `null` = 不画（要么没启用，要么不在世界里） */
  setState(state: HotbarState | null): void {
    this.state = state;
    if (!state) {
      this.signature = '';
      this.snapshot = null;
    }
  }

  /** 当前是否有内容可画 */
  get active(): boolean {
    return this.state !== null && this.state.slots.length > 0;
  }

  /**
   * 画到覆盖层上。
   *
   * @param scale 覆盖层的背板倍率（`Ui2DOverlay.dpr`）—— 快照按它出图，
   *   所以 DPR 变了必须重建（`snapshotScale` 参与判断）。
   * @returns 这一帧有没有画东西（调用方据此决定要不要清屏）
   */
  draw(ctx: CanvasRenderingContext2D, scale: number): boolean {
    const state = this.state;
    if (!state || state.slots.length === 0) return false;
    const ratio = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const signature = hotbarSignature(state);
    if (!this.snapshot || signature !== this.signature || Math.abs(ratio - this.snapshotScale) > 1e-3) {
      if (!this.rebuild(state, ratio)) return false;
      this.signature = signature;
    }
    const snapshot = this.snapshot;
    if (!snapshot) return false;
    const origin = hotbarSnapshotOrigin(state.panel);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      snapshot,
      origin.x,
      origin.y,
      snapshot.width / this.snapshotScale,
      snapshot.height / this.snapshotScale,
    );
    ctx.restore();
    return true;
  }

  private rebuild(state: HotbarState, scale: number): boolean {
    const origin = hotbarSnapshotOrigin(state.panel);
    const width = Math.max(1, Math.ceil((state.panel.w + HOTBAR_SNAPSHOT_PAD * 2) * scale));
    const height = Math.max(1, Math.ceil((state.panel.h + HOTBAR_SNAPSHOT_PAD * 2) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    // 快照里的坐标仍然是 CSS px：把"面板左上角"翻译成"快照左上角"
    ctx.setTransform(scale, 0, 0, scale, -origin.x * scale, -origin.y * scale);
    drawHotbar(ctx, state);
    this.snapshot = canvas;
    this.snapshotScale = scale;
    return true;
  }

  dispose(): void {
    this.state = null;
    this.snapshot = null;
    this.signature = '';
  }
}
