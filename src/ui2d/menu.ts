/**
 * canvas 面板的**输入通道**（`src/ui2d/` 阶段 3 的前置）
 *
 * 为什么它是"整页搬迁"的真正门槛：DOM 面板的键盘导航、焦点、Esc、点按钮全是浏览器送的，
 * canvas 里一样都没有。这一层把三件事收成一套可断言的规则：
 *
 *  1. **焦点行**（`focus`）：一个整数，`ArrowUp/Down` 循环、`Home/End` 跳两端；
 *  2. **激活**（`Enter`/`Space` 或指针点到某一行）：返回**行 id**，由调用方去执行真正的动作
 *     （这一层不碰游戏状态 —— 它连 `main.ts` 都不许 import，见 `index.ts` 的依赖约定）；
 *  3. **退出**（`Esc`，或点到面板外面）：返回 `{ kind: 'close' }`。
 *
 * ⚠️ 这一层**没有**"面板打开时吞掉其它输入"的概念：谁把 `Esc` 递进来、谁在打开期间不处理
 * 移动键，仍然由调用方（游戏主循环）决定。把这两件事混进来，就会重演 DOM 那边
 * "暂停时角色还在走"的老问题。
 */

import { controlRegion } from './controls.ts';
import { drawModalFrame, modalRect } from './controls.ts';
import type { HitRegion } from './input.ts';
import { drawText, uiFont } from './text.ts';
import { PALETTE, drawButton, type Rect } from './widgets.ts';

export interface MenuRow {
  readonly id: string;
  readonly label: string;
}

/** 行高 / 行距 / 面板内边距 / 标题栏高度（与 `drawModalFrame` 的标题栏一致） */
export const MENU_ROW_HEIGHT = 34;
export const MENU_ROW_GAP = 8;
export const MENU_PADDING = 20;
export const MENU_TITLE_HEIGHT = 30;
/** 面板最大宽度（原版暂停页 `--pause-w: min(90vw, 460px)`，按钮列 340） */
export const MENU_MAX_WIDTH = 380;
/** 底部那行操作提示的高度 */
export const MENU_HINT_HEIGHT = 22;

/** 一屏菜单的尺寸（调用方拿它做 `modalRect`） */
export function menuPanelSize(count: number): { w: number; h: number } {
  const rows = Math.max(0, count);
  return {
    w: MENU_MAX_WIDTH,
    h: MENU_TITLE_HEIGHT + MENU_PADDING + rows * MENU_ROW_HEIGHT + Math.max(0, rows - 1) * MENU_ROW_GAP + MENU_HINT_HEIGHT + 16,
  };
}

/** 每行的矩形（在面板里水平居中、从标题栏下面开始） */
export function menuRowRects(panel: Rect, count: number): Rect[] {
  const w = Math.max(0, panel.w - MENU_PADDING * 2);
  const out: Rect[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    out.push({
      x: panel.x + MENU_PADDING,
      y: panel.y + MENU_TITLE_HEIGHT + MENU_PADDING + i * (MENU_ROW_HEIGHT + MENU_ROW_GAP),
      w,
      h: MENU_ROW_HEIGHT,
    });
  }
  return out;
}

/**
 * 按键 → 新的焦点行。
 *
 * 认 `ArrowDown` / `ArrowUp` / `Home` / `End`；**循环**（最后一行往下回到第一行）——
 * 原版的菜单就是这样，而且键盘用户在只有两三行时最烦"到头不动"。
 * 其它键返回原值（由调用方决定它是不是激活/退出）。
 */
export function menuFocusAfterKey(focus: number, count: number, key: string): number {
  if (count <= 0) return 0;
  const current = Math.min(count - 1, Math.max(0, Number.isFinite(focus) ? focus : 0));
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return current;
  }
}

/** 输入处理结果（`null` = 这个键/这一点与菜单无关，调用方继续自己处理） */
export type MenuInput =
  | { readonly kind: 'activate'; readonly id: string }
  | { readonly kind: 'close' }
  | { readonly kind: 'move'; readonly focus: number }
  | null;

/** 一行菜单的"输入 + 绘制"单元：**没有游戏逻辑**，只把按键/指针翻译成行 id */
export class CanvasMenu {
  private opened = false;
  private focusIndex = 0;

  constructor(
    readonly title: string,
    readonly rows: readonly MenuRow[],
  ) {}

  get isOpen(): boolean {
    return this.opened;
  }

  get focus(): number {
    return this.focusIndex;
  }

  /** 打开（可指定初始焦点；默认第一行，与原版一致） */
  open(focus = 0): void {
    this.opened = true;
    this.focusIndex = Math.min(this.rows.length - 1, Math.max(0, focus));
  }

  close(): void {
    this.opened = false;
  }

  /**
   * 键盘输入。
   *
   * `Enter` / `Space` 激活当前焦点行；`Escape` 关闭；方向键移动焦点（`move`）。
   * 注意返回的是**意图**，真正的动作由调用方按 `id` 分派。
   */
  handleKey(key: string): MenuInput {
    if (!this.opened) return null;
    if (key === 'Escape') {
      this.opened = false;
      return { kind: 'close' };
    }
    if (key === 'Enter' || key === ' ') {
      const row = this.rows[this.focusIndex];
      if (!row) return null;
      return { kind: 'activate', id: row.id };
    }
    const next = menuFocusAfterKey(this.focusIndex, this.rows.length, key);
    if (next === this.focusIndex) return null;
    this.focusIndex = next;
    return { kind: 'move', focus: next };
  }

  /**
   * 指针按下。
   *
   * 点在某一行上 = 激活那一行（并把焦点移过去）；点在面板外 = 关闭
   * （`dismissOnOutside` 默认真，与 DOM 遮罩点一下关掉一致）。
   */
  handlePointer(
    x: number,
    y: number,
    viewport: { readonly w: number; readonly h: number },
    dismissOnOutside = true,
  ): MenuInput {
    if (!this.opened) return null;
    const panel = this.panelRect(viewport);
    const rows = menuRowRects(panel, this.rows.length);
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i]!;
      if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) {
        this.focusIndex = i;
        return { kind: 'activate', id: this.rows[i]!.id };
      }
    }
    if (dismissOnOutside) {
      this.opened = false;
      return { kind: 'close' };
    }
    return null;
  }

  /** 命中区域（给 `hitRegionAt` 用；行 id 就是 `row.id`） */
  regions(viewport: { readonly w: number; readonly h: number }): HitRegion[] {
    const panel = this.panelRect(viewport);
    return menuRowRects(panel, this.rows.length).map((rect, i) => controlRegion(this.rows[i]!.id, rect, 10));
  }

  /** 面板矩形（居中、小屏收缩） */
  panelRect(viewport: { readonly w: number; readonly h: number }): Rect {
    const size = menuPanelSize(this.rows.length);
    return modalRect(viewport.w, viewport.h, size.w, size.h);
  }

  /** 画出来（焦点行用按钮的 hover 态 + 左侧 ▶ 标记） */
  render(ctx: CanvasRenderingContext2D, viewportW: number, viewportH: number): void {
    if (!this.opened) return;
    const panel = this.panelRect({ w: viewportW, h: viewportH });
    drawModalFrame(ctx, panel, this.title);
    const rows = menuRowRects(panel, this.rows.length);
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i]!;
      const focused = i === this.focusIndex;
      drawButton(ctx, rect, this.rows[i]!.label, focused ? 'hover' : 'idle');
      if (focused) {
        drawText(ctx, '▶', rect.x - 12, rect.y + rect.h / 2, {
          font: uiFont(12),
          color: PALETTE.textHover,
          align: 'left',
          baseline: 'middle',
        });
      }
    }
    drawText(ctx, '↑↓ 选择 · Enter 确认 · Esc 返回', panel.x + panel.w / 2, panel.y + panel.h - MENU_HINT_HEIGHT / 2 - 6, {
      font: uiFont(11),
      color: '#9aa69a',
      align: 'center',
      baseline: 'middle',
      shadow: false,
    });
  }
}
