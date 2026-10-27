/**
 * 背包面板的**自绘宿主**（M26b 的第一步：不再读 DOM 布局）
 *
 * 与镜像（`MenuScreen2D`）的区别：镜像"读 DOM 再原位重画"，这一版**自己排版、自己命中**。
 * 数据来自 `SlotAccess`（真实的 `Inventory` 结构上就满足 `get/set`，不需要适配器），
 * 交互走 `inventoryModel` 的四个纯函数（左键/右键/快速移动/拖拽均分）。
 *
 * 本批只做到"能被预览页驱动"：游戏里的接线与"19 种工作站的布局"仍然由镜像负责 ——
 * 两者并存是刻意的，等自绘这条路稳定了再逐块换掉。
 */

import { Ui2DOverlay } from './overlay.ts';
import { applyDebugTint } from './debug.ts';
import { drawInventoryPanel, layoutInventoryPanel, slotIndexAt, type InventoryLayout } from './InventoryPanel2D.ts';
import { INV_SLOT_DEFAULT_SKIN, type InvSlotSkin } from './Inventory2D.ts';
import { distributeDrag, leftClick, quickMove, rightClick, type Cursor, type MoveRules, type SlotAccess, type StackLike } from './inventoryModel.ts';
import type { Rect } from './widgets.ts';

export interface InventoryPanelHostOptions extends MoveRules {
  readonly title: string;
  /** 主背包行数（生存 3 行；工作台可能更多） */
  readonly mainRows?: number;
  readonly hotbarRows?: number;
  readonly zIndex?: number;
  readonly tint?: boolean;
  /** 物品 id → 图标位图（游戏里由 `ui/ItemIconCache` 提供） */
  readonly iconOf: (itemId: number) => HTMLCanvasElement | null;
  /** 快捷移动的目标范围（主背包 ↔ 快捷栏） */
  readonly targetRange?: (index: number) => readonly number[];
  readonly skin?: InvSlotSkin;
}

export class InventoryPanelHost {
  private overlay: Ui2DOverlay | null = null;
  private layout: InventoryLayout | null = null;
  private readonly cursor: Cursor = { stack: null };
  private hoverIndex = -1;
  private dragIndices: number[] = [];
  private dragButton: number | null = null;
  private dragging = false;
  private pointerX = 0;
  private pointerY = 0;
  private opened = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly slots: SlotAccess,
    private readonly options: InventoryPanelHostOptions,
  ) {}

  get isOpen(): boolean {
    return this.opened;
  }

  /** 当前光标上拿着的那一叠（调用方可以拿来同步回真实数据，见 `takeCursor()`） */
  get heldStack(): StackLike | null {
    return this.cursor.stack;
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    if (!this.overlay) this.overlay = new Ui2DOverlay(this.host);
    if (this.options.zIndex !== undefined) this.overlay.canvas.style.zIndex = String(this.options.zIndex);
    this.relayout();
    this.render();
  }

  close(): void {
    this.opened = false;
    this.hoverIndex = -1;
    this.dragIndices = [];
    this.dragButton = null;
    this.overlay?.clear();
  }

  dispose(): void {
    this.close();
    this.overlay?.dispose();
    this.overlay = null;
  }

  /** 视口变了就重排（面板居中；行数变化也走这里） */
  relayout(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.syncSize();
    const rows = this.options.mainRows ?? 3;
    const hotbarRows = this.options.hotbarRows ?? 1;
    const probe = layoutInventoryPanel(0, 0, { mainRows: rows, hotbarRows });
    const x = Math.max(0, Math.round((overlay.width - probe.panel.w) / 2));
    const y = Math.max(0, Math.round((overlay.height - probe.panel.h) / 2));
    this.layout = layoutInventoryPanel(x, y, { mainRows: rows, hotbarRows });
  }

  /** 指针 → 槽位（`phase` 对应按下/移动/抬起） */
  handlePointer(x: number, y: number, phase: 'down' | 'move' | 'up'): boolean {
    const layout = this.layout;
    if (!layout || !this.opened) return false;
    this.pointerX = x;
    this.pointerY = y;
    const index = slotIndexAt(layout, x, y);
    this.hoverIndex = index;

    if (phase === 'down') {
      if (index < 0) {
        this.render();
        return false;
      }
      this.dragButton = 0;
      this.dragIndices = [index];
      this.dragging = false;
      leftClick(this.slots, this.options, this.cursor, index);
      this.render();
      return true;
    }
    if (phase === 'move') {
      if (index >= 0 && this.dragButton !== null && !this.dragIndices.includes(index)) {
        this.dragIndices.push(index);
        this.dragging = true;
      }
      this.render();
      return false;
    }
    // up：拖过多格 = 均分（与 `distributeDrag` 同一语义）
    if (this.dragging && this.dragIndices.length > 1) {
      distributeDrag(this.slots, this.options, this.cursor, this.dragIndices);
    }
    this.dragButton = null;
    this.dragIndices = [];
    this.dragging = false;
    this.render();
    return false;
  }

  /** 右键 / Shift 之类的"非拖动"动作（供键盘或外部按钮调用） */
  activate(index: number, button: 0 | 2, shift = false): void {
    if (shift && button === 0) {
      quickMove(this.slots, this.options, index, this.targetRange(index));
    } else if (button === 2) {
      rightClick(this.slots, this.options, this.cursor, index);
    } else {
      leftClick(this.slots, this.options, this.cursor, index);
    }
    this.render();
  }

  /** 右键拖拽 / 快速移动等留给调用方的入口（本批只用到 `activate`） */
  targetRange(index: number): readonly number[] {
    if (this.options.targetRange) return this.options.targetRange(index);
    const main = (this.options.mainRows ?? 3) * 9;
    const range: number[] = [];
    if (index < main) for (let i = main; i < main + 9; i++) range.push(i);
    else for (let i = 0; i < main; i++) range.push(i);
    return range;
  }

  /** 重画（数据变了就调它；本批不做签名缓存 —— 36 格 + 36 次 drawImage 很便宜） */
  render(): void {
    const overlay = this.overlay;
    const layout = this.layout;
    if (!overlay || !layout || !this.opened) return;
    overlay.syncSize();
    const ctx = overlay.context;
    overlay.clear();

    const views = layout.slots.map((_, index) => {
      const stack = this.slots.get(index);
      if (!stack) return null;
      return {
        icon: this.options.iconOf(stack.id),
        count: stack.count,
        durability: null,
        held: false,
      };
    });
    const held = this.cursor.stack;
    drawInventoryPanel(ctx, layout, {
      title: this.options.title,
      slots: views,
      hoverIndex: this.hoverIndex,
      cursor: held ? { icon: this.options.iconOf(held.id), count: held.count } : null,
      cursorX: this.pointerX,
      cursorY: this.pointerY,
      skin: this.options.skin ?? INV_SLOT_DEFAULT_SKIN,
    });
    if (this.options.tint) applyDebugTint(ctx, overlay.width, overlay.height);
  }

  /** 面板矩形（调用方用它做命中/定位） */
  get panelRect(): Rect | null {
    return this.layout?.panel ?? null;
  }
}
