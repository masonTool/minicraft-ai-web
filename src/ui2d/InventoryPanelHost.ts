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

import { drawItemTooltip, type TooltipModel } from './itemTooltip.ts';
import { Ui2DOverlay } from './overlay.ts';
import { applyDebugTint } from './debug.ts';
import {
  drawInventoryPanel,
  type ExtraSlotsSpec,
  drawSplitHint,
  drawSplitTarget,
  layoutInventoryPanel,
  slotIndexAt,
  splitCountFromDrag,
  type InventoryLayout,
} from './InventoryPanel2D.ts';
import { INV_SLOT_DEFAULT_SKIN, type InvSlotSkin } from './Inventory2D.ts';
import {
  distributeDrag,
  doubleClickGather,
  leftClick,
  quickMove,
  rightClick,
  rightDragDistribute,
  splitTake,
  type Cursor,
  type MoveRules,
  type SlotAccess,
  type StackLike,
} from './inventoryModel.ts';
import type { Rect } from './widgets.ts';

/** 双击窗口（与 DOM 版一致：400ms 内点同一格） */
export const DOUBLE_CLICK_MS = 400;
/** 长按分堆的等待时长（与 DOM 版一致） */
export const LONG_PRESS_MS = 500;
/** 触摸滑动多少像素算"这不是点击"（与镜像的拖拽阈值同量级） */
export const TOUCH_DRAG_SLOP = 8;

export interface InventoryPanelHostOptions extends MoveRules {
  readonly title: string;
  /** 主背包行数（生存 3 行；工作台可能更多） */
  readonly mainRows?: number;
  readonly hotbarRows?: number;
  /** 工作站那几格（合成 3×3、熔炉原料+燃料…）；不传 = 纯背包 */
  readonly extra?: ExtraSlotsSpec;
  readonly zIndex?: number;
  readonly tint?: boolean;
  /** 物品 id → 图标位图（游戏里由 `ui/ItemIconCache` 提供） */
  readonly iconOf: (itemId: number) => HTMLCanvasElement | null;
  /**
   * 悬停提示的内容（名字/说明/耐久色条）。
   *
   * 为什么由调用方注入：名字与耐久上限在 `core`（`itemName` / `itemDef`），而 `ui2d` 不依赖 `core`。
   * 返回 `null` 就是不提示（例如空格子）。
   */
  readonly describeOf?: (stack: StackLike) => TooltipModel | null;
  /** 耐久条（0..1 + 三档颜色）；游戏里按 `itemDef(id).durability` 与 `stack.damage` 算 */
  readonly durabilityOf?: (stack: StackLike) => { ratio: number; level: 'high' | 'mid' | 'low' } | null;
  /** 快捷移动的目标范围（主背包 ↔ 快捷栏） */
  readonly targetRange?: (index: number) => readonly number[];
  readonly skin?: InvSlotSkin;
}

export class InventoryPanelHost {
  private overlay: Ui2DOverlay | null = null;
  private layout: InventoryLayout | null = null;
  private readonly cursor: Cursor = { stack: null };
  private hoverIndex = -1;
  /** 当前悬停提示（`null` = 不显示） */
  private tooltip: { readonly model: TooltipModel; readonly x: number; readonly y: number } | null = null;
  private dragIndices: number[] = [];
  /** 这次拖动是按的哪个键：左键 = 均分，右键 = 每格放一个（与 DOM 版一致） */
  private dragButton: 0 | 2 | null = null;
  private dragging = false;
  /** 上一次"按下"的格子与时刻（双击收集用，窗口与 DOM 版一致：400ms） */
  private lastDownIndex = -1;
  private lastDownAt = -Infinity;
  /** 长按分堆的计时器（500ms，与 DOM 版一致） */
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 触摸按下但**还没决定是"点"还是"长按"**的那一次。
   *
   * 触摸端不能像鼠标那样"按下就拿起来"：那样长按分堆永远拿不到（东西已经在手上了）。
   * 所以触摸时先按住，松手前没超时也没移动才算点击；超时就是分堆，移动就成了拖拽。
   */
  private pendingTouch: { index: number; x: number; y: number } | null = null;
  /**
   * 长按之后进入的"选数量"状态：手指横move 多少就改数量，松手才落到格子里。
   *
   * DOM 版是弹一条滑条；这里做成"按住那格 + 横move 选 + 松手确认"，
   * 好处是不用额外的命中区域，手指一直在格子上，选的时候不会点歪。
   */
  private split: { readonly index: number; readonly x0: number; readonly max: number; count: number } | null = null;
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
    this.cancelLongPress();
    this.pendingTouch = null;
    this.split = null;
    this.opened = false;
    this.hoverIndex = -1;
    this.tooltip = null;
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
    const extra = this.options.extra;
    const probe = layoutInventoryPanel(0, 0, { mainRows: rows, hotbarRows, ...(extra ? { extra } : {}) });
    const x = Math.max(0, Math.round((overlay.width - probe.panel.w) / 2));
    const y = Math.max(0, Math.round((overlay.height - probe.panel.h) / 2));
    this.layout = layoutInventoryPanel(x, y, { mainRows: rows, hotbarRows, ...(extra ? { extra } : {}) });
  }

  /**
   * 指针 → 槽位（`phase` 对应按下/移动/抬起）。
   *
   * `input.button` 取 0/2（左/右），缺省左键；`input.timeStamp` 用来判双击。
   * 四种操作与 DOM 版对齐：左键取放 / 右键取半与放一 / 左键拖过多格均分 /
   * 右键拖过多格每格放一个 / 双击收集 / 长按取一半。
   */
  handlePointer(
    x: number,
    y: number,
    phase: 'down' | 'move' | 'up',
    input: { readonly button?: 0 | 2; readonly timeStamp?: number; readonly touch?: boolean } = {},
  ): boolean {
    const layout = this.layout;
    if (!layout || !this.opened) return false;
    this.pointerX = x;
    this.pointerY = y;
    const index = slotIndexAt(layout, x, y);
    this.hoverIndex = index;
    // 悬停提示：只在悬停到有东西的格子上时出现（与 DOM 版一致）
    const hovered = index >= 0 ? this.slots.get(index) : null;
    const model = hovered && this.options.describeOf ? this.options.describeOf(hovered) : null;
    this.tooltip = model ? { model, x, y } : null;

    const button = input.button ?? 0;
    const now = input.timeStamp ?? (typeof performance === 'undefined' ? Date.now() : performance.now());

    if (phase === 'down') {
      if (index < 0) {
        this.render();
        return false;
      }
      const isDouble = button === 0 && index === this.lastDownIndex && now - this.lastDownAt <= DOUBLE_CLICK_MS;
      this.lastDownIndex = isDouble ? -1 : index;
      this.lastDownAt = isDouble ? -Infinity : now;

      if (isDouble) {
        // 双击：先把同类凑成一堆；凑不到东西就退化成快速移动（与 DOM 版同一条规则）
        const before = this.cursor.stack?.count ?? 0;
        doubleClickGather(this.slots, this.options, this.cursor, index, this.allIndices());
        if ((this.cursor.stack?.count ?? 0) === before) {
          quickMove(this.slots, this.options, index, this.targetRange(index));
        }
        this.render();
        return true;
      }

      if (input.touch) {
        // 触摸：先按住看它是"点"还是"长按"，两者都要看后面的事件才能定
        this.pendingTouch = { index, x, y };
        this.dragButton = null;
        this.dragIndices = [];
        this.dragging = false;
        this.startLongPress(index);
        this.render();
        return true;
      }

      this.dragButton = button;
      this.dragIndices = [index];
      this.dragging = false;
      if (button === 2) rightClick(this.slots, this.options, this.cursor, index);
      else leftClick(this.slots, this.options, this.cursor, index);
      this.startLongPress(index);
      this.render();
      return true;
    }
    if (phase === 'move') {
      if (this.split) {
        this.split.count = splitCountFromDrag(x - this.split.x0, this.split.max);
        this.render();
        return true;
      }
      const pending = this.pendingTouch;
      if (pending && Math.hypot(x - pending.x, y - pending.y) > TOUCH_DRAG_SLOP) {
        this.pendingTouch = null;
        this.cancelLongPress();
        // 手指滑出来了：等同于"按下拿起"，之后按拖拽处理
        leftClick(this.slots, this.options, this.cursor, pending.index);
        this.dragButton = 0;
        this.dragIndices = [pending.index];
        this.dragging = true;
      }
      if (index >= 0 && this.dragButton !== null && !this.dragIndices.includes(index)) {
        this.dragIndices.push(index);
        this.dragging = true;
        // 一动就不是长按了，先撤掉计时器（否则松手前会突然"分一半"）
        this.cancelLongPress();
        // 右键拖拽是"每经过一格放一个"，不是均分
        if (this.dragButton === 2) rightDragDistribute(this.slots, this.options, this.cursor, [index]);
      }
      this.render();
      return false;
    }
    this.cancelLongPress();
    if (this.split) {
      const { index, count } = this.split;
      this.split = null;
      splitTake(this.slots, this.options, this.cursor, index, count);
      this.dragIndices = [];
      this.dragging = false;
      this.render();
      return true;
    }
    const pending = this.pendingTouch;
    if (pending) {
      // 松手时还在等：这就是一次普通点击
      this.pendingTouch = null;
      leftClick(this.slots, this.options, this.cursor, pending.index);
      this.render();
      return true;
    }
    // up：左键拖过多格 = 均分（右键在 move 里已经逐格放过了）
    if (this.dragging && this.dragButton === 0 && this.dragIndices.length > 1) {
      distributeDrag(this.slots, this.options, this.cursor, this.dragIndices);
    }
    this.dragButton = null;
    this.dragIndices = [];
    this.dragging = false;
    this.render();
    return false;
  }

  /** 全部槽位下标（双击收集的范围） */
  private allIndices(): number[] {
    // 以**当前布局**为准（工作站会多出那几格 + 结果格）
    const total = this.layout?.slots.length ?? ((this.options.mainRows ?? 3) + (this.options.hotbarRows ?? 1)) * 9;
    return Array.from({ length: total }, (_, i) => i);
  }

  /**
   * 长按分堆：按住 500ms 且没动，取走**一半**（向上取整）。
   *
   * DOM 版长按会弹出"拖到某处选数量"的滑条；这里先取一半 —— 一是规则与"右键取半"一致，
   * 二是滑条那一套 UI 还没画（已在 §5.34 的"还没做"里记着）。
   */
  private startLongPress(index: number): void {
    this.cancelLongPress();
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      const stack = this.slots.get(index);
      if (!stack) return;
      // 进入"选数量"：先给一半，之后靠横move 调
      this.split = { index, x0: this.pointerX, max: stack.count, count: Math.ceil(stack.count / 2) };
      this.pendingTouch = null;
      this.dragIndices = [];
      this.dragging = false;
      this.render();
    }, LONG_PRESS_MS);
  }

  private cancelLongPress(): void {
    if (this.longPressTimer === null) return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
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
        durability: this.options.durabilityOf?.(stack) ?? null,
        held: false,
      };
    });
    const held = this.cursor.stack;
    const splitSlot = this.split ? layout.slots[this.split.index] : null;
    drawInventoryPanel(ctx, layout, {
      title: this.options.title,
      slots: views,
      hoverIndex: this.hoverIndex,
      cursor: held ? { icon: this.options.iconOf(held.id), count: held.count } : null,
      cursorX: this.pointerX,
      cursorY: this.pointerY,
      skin: this.options.skin ?? INV_SLOT_DEFAULT_SKIN,
    });
    // 压暗与数量牌要画在面板**之上**（先画的话会被槽位底色盖掉）
    if (splitSlot && this.split) {
      drawSplitTarget(ctx, splitSlot);
      drawSplitHint(ctx, splitSlot, this.split.count, this.split.max);
    }
    // 悬停提示画在最上层（面板、数量牌、光标叠之上）
    if (this.tooltip) {
      drawItemTooltip(ctx, this.tooltip.model, this.tooltip, { w: overlay.width, h: overlay.height });
    }
    if (this.options.tint) applyDebugTint(ctx, overlay.width, overlay.height);
  }

  /** 面板矩形（调用方用它做命中/定位） */
  get panelRect(): Rect | null {
    return this.layout?.panel ?? null;
  }
}
