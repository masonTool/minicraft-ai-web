/**
 * 背包槽位的 canvas 版（`src/ui2d/` 阶段 4 的第一块）
 *
 * 背包是整个迁移里最大的一块（40 个槽位 × 19 种工作站 × 拖拽/分堆/连发），但它有一个
 * 非常有利的结构：**每个槽位就是一格 42×42 的盒子 + 一张图标 canvas + 一个数量文本**，
 * 与快捷栏（阶段 1.5）几乎是同一个东西。所以这一块照搬快捷栏的两条结论：
 *
 *  1. **几何全部量 DOM**（`.inv-slot` 的 `getBoundingClientRect`）：格子尺寸随断点变
 *     （桌面 42、手机上更大的那套），抄常量必错；
 *  2. **像素换手，不换输入**：`.inv-slot` 设 `opacity: 0`（**不是** `visibility`/`display`
 *     —— 那会让拖拽、长按分堆、悬停提示一起失效），点击/拖拽/分堆/连发依旧全走 DOM。
 *
 * 于是这一块**没有一行交互逻辑**：它只负责"把每一格画出来"。19 种工作站不用逐个适配 ——
 * 它们用的都是同一批 `.inv-slot`。
 *
 * 与 `Hotbar2D` 的差别：背包是**模态面板**，槽位数量随工作台类型变化（27 / 36 / 45 格），
 * 所以不做"整块快照"，而是每帧读一次状态、按签名决定要不要重画。
 */

import { applyDebugTint } from './debug.ts';
import { Ui2DOverlay } from './overlay.ts';
import { uiFont } from './text.ts';
import { roundRectPath, type Rect } from './widgets.ts';

/** 一格槽位的绘制状态（全部从 DOM 读，不猜） */
export interface InvSlotState {
  readonly rect: Rect;
  /** 图标位图：直接引用 DOM 里那张 36×36 的 canvas */
  readonly icon: HTMLCanvasElement | null;
  readonly count: number;
  /** 耐久：`ratio` 0~1，`level` 三档（颜色跟快捷栏同一套） */
  readonly durability: { readonly ratio: number; readonly level: 'high' | 'mid' | 'low' } | null;
  readonly hovered: boolean;
  readonly pressed: boolean;
  /** 不可放置的红底格（合成书里"缺材料"那种） */
  readonly locked: boolean;
  /** 当前被"拿着"的那一格（选择态：沉下去 + 白框） */
  readonly held: boolean;
}

/** 槽位外观（从 CSS 变量读出来的实际颜色，见 `readSlotSkin`） */
export interface InvSlotSkin {
  readonly bg: string;
  readonly bgHover: string;
  readonly edgeLight: string;
  readonly edgeDark: string;
  readonly borderWidth: number;
  readonly radius: number;
  readonly lockedBg: string;
}

export const INV_SLOT_DEFAULT_SKIN: InvSlotSkin = {
  bg: '#8b8b8b',
  bgHover: '#a9a9a9',
  edgeLight: '#c6c6c6',
  edgeDark: '#373737',
  borderWidth: 2,
  radius: 2,
  lockedBg: '#9b3b35',
};

export const INV_COUNT_FONT_SIZE = 12;
export const INV_DURABILITY_HEIGHT = 3;

/** 内容盒（扣掉边框） */
export function invContentRect(rect: Rect, borderWidth = INV_SLOT_DEFAULT_SKIN.borderWidth): Rect {
  return {
    x: rect.x + borderWidth,
    y: rect.y + borderWidth,
    w: Math.max(0, rect.w - borderWidth * 2),
    h: Math.max(0, rect.h - borderWidth * 2),
  };
}

/** 图标：等比放进内容盒并居中（图标本身是 36×36 的位图，格子可能是 42 或更大） */
export function invIconRect(rect: Rect, skin: InvSlotSkin = INV_SLOT_DEFAULT_SKIN, iconSize = 32): Rect {
  const content = invContentRect(rect, skin.borderWidth);
  const size = Math.min(iconSize, content.w, content.h);
  return {
    x: content.x + (content.w - size) / 2,
    y: content.y + (content.h - size) / 2,
    w: size,
    h: size,
  };
}

/** 数量贴右下角（`.inv-count` 的 `right/bottom` 那套） */
export function invCountAnchor(rect: Rect, skin: InvSlotSkin = INV_SLOT_DEFAULT_SKIN): { x: number; y: number } {
  const content = invContentRect(rect, skin.borderWidth);
  return { x: content.x + content.w - 2, y: content.y + content.h - 1 };
}

/** 耐久条贴底（与快捷栏同一条规则：左右各留 3px、高 3px） */
export function invDurabilityRect(rect: Rect, skin: InvSlotSkin = INV_SLOT_DEFAULT_SKIN): Rect {
  const content = invContentRect(rect, skin.borderWidth);
  return {
    x: content.x + 3,
    y: content.y + content.h - INV_DURABILITY_HEIGHT - 2,
    w: Math.max(0, content.w - 6),
    h: INV_DURABILITY_HEIGHT,
  };
}

/** 签名：这一帧要不要重画（图标是同一个 canvas 反复重绘的，所以只比引用 + 计数 + 旗标） */
export function invSignature(state: { readonly slots: readonly InvSlotState[] }): string {
  const part = (slot: InvSlotState): string =>
    `${Math.round(slot.rect.x)},${Math.round(slot.rect.y)},${Math.round(slot.rect.w)}|${slot.count}|${
      slot.durability ? Math.round(slot.durability.ratio * 50) + slot.durability.level : '-'
    }|${slot.hovered ? 'h' : ''}${slot.pressed ? 'p' : ''}${slot.locked ? 'l' : ''}${slot.held ? 'e' : ''}|${
      slot.icon ? 'i' : '-'
    }`;
  return state.slots.map(part).join(';');
}

/** 画一格：底 + 四边斜面 + 图标 + 数量 + 耐久 + 选择白框 */
export function drawInvSlot(
  ctx: CanvasRenderingContext2D,
  slot: InvSlotState,
  skin: InvSlotSkin = INV_SLOT_DEFAULT_SKIN,
): void {
  const { rect } = slot;
  if (!(rect.w > 0) || !(rect.h > 0)) return;
  const border = skin.borderWidth;

  ctx.save();
  roundRectPath(ctx, rect, skin.radius);
  ctx.fillStyle = slot.locked ? skin.lockedBg : slot.hovered ? skin.bgHover : skin.bg;
  ctx.fill();

  // 斜面：上/左暗、下/右亮（`.inv-slot` 的 border-color 就是四边不同色，这里手画四段）
  if (border > 0) {
    ctx.fillStyle = skin.edgeDark;
    ctx.fillRect(rect.x, rect.y, rect.w, border);
    ctx.fillRect(rect.x, rect.y, border, rect.h);
    ctx.fillStyle = skin.edgeLight;
    ctx.fillRect(rect.x, rect.y + rect.h - border, rect.w, border);
    ctx.fillRect(rect.x + rect.w - border, rect.y, border, rect.h);
  }

  // 图标
  if (slot.icon && slot.icon.width > 0) {
    const icon = invIconRect(rect, skin);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(slot.icon, icon.x, icon.y, icon.w, icon.h);
  }

  // 数量（四向黑描边，与快捷栏同一套）
  if (slot.count > 1) {
    const anchor = invCountAnchor(rect, skin);
    const font = uiFont(INV_COUNT_FONT_SIZE);
    ctx.font = font;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#000000';
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      ctx.fillText(String(slot.count), anchor.x + dx, anchor.y + dy);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(slot.count), anchor.x, anchor.y);
  }

  // 耐久条
  if (slot.durability) {
    const track = invDurabilityRect(rect, skin);
    ctx.fillStyle = 'rgba(0, 0, 0, .65)';
    ctx.fillRect(track.x, track.y, track.w, track.h);
    const ratio = Math.min(1, Math.max(0, slot.durability.ratio));
    ctx.fillStyle =
      slot.durability.level === 'low' ? '#e03b3b' : slot.durability.level === 'mid' ? '#e0d24a' : '#63c335';
    ctx.fillRect(track.x, track.y, track.w * ratio, track.h);
  }

  // 选择态：一圈白框 + 一道内阴影（`.inv-slot.held` 的"沉下去"）
  if (slot.held) {
    ctx.strokeStyle = 'rgba(255, 255, 255, .92)';
    ctx.lineWidth = 2;
    roundRectPath(ctx, { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 2 }, skin.radius);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 0, 0, .25)';
    ctx.fillRect(rect.x + border, rect.y + border, rect.w - border * 2, 2);
  }
  ctx.restore();
}

/** 把 DOM 的槽位读成状态（图标、数量、耐久、旗标全部现读） */
export function readInvSlots(host: ParentNode, origin: DOMRect): InvSlotState[] {
  const slots: InvSlotState[] = [];
  for (const el of host.querySelectorAll<HTMLElement>('.inv-slot')) {
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    const rect: Rect = { x: box.left - origin.left, y: box.top - origin.top, w: box.width, h: box.height };
    const icon = el.querySelector('canvas');
    const countEl = el.querySelector<HTMLElement>('.inv-count');
    const count = countEl ? Number.parseInt(countEl.textContent ?? '', 10) || 0 : 0;
    const durabilityEl = el.querySelector<HTMLElement>('.dur-bar');
    let durability: InvSlotState['durability'] = null;
    if (durabilityEl && !durabilityEl.classList.contains('hidden')) {
      const fill = durabilityEl.querySelector<HTMLElement>('b');
      const trackW = durabilityEl.clientWidth;
      const fillW = fill?.getBoundingClientRect().width ?? 0;
      const level = durabilityEl.classList.contains('dur-low')
        ? 'low'
        : durabilityEl.classList.contains('dur-mid')
          ? 'mid'
          : 'high';
      durability = { ratio: trackW > 0 ? Math.min(1, fillW / trackW) : 0, level };
    }
    slots.push({
      rect,
      icon: icon ?? null,
      count,
      durability,
      hovered: el.matches(':hover'),
      pressed: el.matches(':active'),
      locked: el.classList.contains('locked'),
      held: el.classList.contains('held'),
    });
  }
  return slots;
}

/** 从 CSS 变量读一次槽位外观（颜色随主题/断点变，抄常量会漂） */
export function readSlotSkin(sample: Element | null): InvSlotSkin {
  if (!sample || typeof window === 'undefined') return INV_SLOT_DEFAULT_SKIN;
  const style = window.getComputedStyle(sample);
  return {
    bg: style.backgroundColor || INV_SLOT_DEFAULT_SKIN.bg,
    bgHover: INV_SLOT_DEFAULT_SKIN.bgHover,
    // 四边不同色：上/左是 dark、下/右是 light
    edgeLight: style.borderBottomColor || INV_SLOT_DEFAULT_SKIN.edgeLight,
    edgeDark: style.borderTopColor || INV_SLOT_DEFAULT_SKIN.edgeDark,
    borderWidth: Number.parseFloat(style.borderTopWidth) || INV_SLOT_DEFAULT_SKIN.borderWidth,
    radius: Number.parseFloat(style.borderTopLeftRadius) || INV_SLOT_DEFAULT_SKIN.radius,
    lockedBg: INV_SLOT_DEFAULT_SKIN.lockedBg,
  };
}

/** 背包槽位的绘制单元：自己开一层覆盖层（`#inventory-screen` 的层叠顺序在它之上） */
export class Inventory2D {
  private overlay: Ui2DOverlay | null = null;
  private state: InvSlotState[] = [];
  private held: InvSlotState | null = null;
  private skin: InvSlotSkin = INV_SLOT_DEFAULT_SKIN;
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
    this.state = [];
    this.held = null;
    this.overlay?.clear();
  }

  dispose(): void {
    this.close();
    this.overlay?.dispose();
    this.overlay = null;
  }

  /** 每帧：读 DOM → 画（签名不变就不重画） */
  update(): void {
    const overlay = this.overlay;
    if (!this.opened || !overlay) return;
    overlay.syncSize();
    const host = overlay.canvas.getBoundingClientRect();
    const root = document.getElementById('inventory-screen') ?? document.body;
    this.state = readInvSlots(root, host);
    const heldEl = document.getElementById('inv-held');
    this.held = this.readHeld(heldEl, host);
    const sample = root.querySelector('.inv-slot');
    if (sample) this.skin = readSlotSkin(sample);
    const signature = `${invSignature({ slots: this.state })}|${this.held ? invSignature({ slots: [this.held] }) : '-'}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.draw();
  }

  /** `#inv-held` 结构与 `.inv-slot` 相同，但没有 `.inv-slot` 类 —— 单独读一次 */
  private readHeld(el: HTMLElement | null, origin: DOMRect): InvSlotState | null {
    if (!el || el.offsetParent === null) return null;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    const icon = el.querySelector('canvas');
    const countEl = el.querySelector<HTMLElement>('.inv-count, .inv-held-count');
    const count = countEl ? Number.parseInt(countEl.textContent ?? '', 10) || 0 : 0;
    return {
      rect: { x: box.left - origin.left, y: box.top - origin.top, w: box.width, h: box.height },
      icon: icon ?? null,
      count,
      durability: null,
      hovered: false,
      pressed: false,
      locked: false,
      held: false,
    };
  }

  private draw(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.clear();
    const ctx = overlay.context;
    for (const slot of this.state) drawInvSlot(ctx, slot, this.skin);
    // 拿在手上的那一叠：跟着指针走，画在所有槽位之上
    if (this.held) drawInvSlot(ctx, this.held, this.skin);
    if (this.options.tint) applyDebugTint(ctx, overlay.width, overlay.height);
  }
}
