/**
 * 背包**面板**的 canvas 版（阶段 4 第二块：布局 + 绘制 + 命中）
 *
 * 与 `Inventory2D`（读 DOM 槽位）不同，这一块是**自己排版**：面板底、标题、9 列网格、
 * 快捷栏行、光标上那一叠，全部由这里算出来并画。交互由调用方接
 * `inventoryModel.ts` 的 `leftClick` / `rightClick` / `quickMove` / `distributeDrag`。
 *
 * 为什么自己排版而不是继续镜像：用户要求"背包逻辑和界面用 canvas **复原实现**"，
 * 而镜像的天花板是"DOM 长什么样就是什么样"（改个间距还得改两份 CSS）。
 * 自己排版之后，`ui2d` 里只有一份几何 —— 但也因此**必须**和 DOM 版对齐：
 * 这里所有数字都照抄 `index.html` 的 `.inv-*` 规则（见 `INV_LAYOUT`）。
 */

import { INV_SLOT_DEFAULT_SKIN, drawInvSlot, type InvSlotSkin } from './Inventory2D.ts';
import { drawText, uiFont } from './text.ts';
import { roundRectPath, type Rect } from './widgets.ts';

/** 照抄 `index.html` 的 `.inv-slot` / `.inv-grid` / `.inv-panel` 那几个 px */
export const INV_LAYOUT = {
  slot: 42,
  gap: 2,
  padding: 14,
  titleHeight: 24,
  /** 主背包 27 格 = 9×3，快捷栏 9 格单独一行 */
  cols: 9,
  mainRows: 3,
  hotbarRows: 1,
  /** 主背包与快捷栏之间那段空档（`.inv-grid + .inv-grid { margin-top: 10px }`） */
  sectionGap: 10,
  panelRadius: 3,
} as const;

export interface InventoryLayout {
  readonly panel: Rect;
  readonly titleRect: Rect;
  /** 27 + 9 = 36 个槽位的矩形（前 27 个是主背包，后 9 个是快捷栏） */
  readonly slots: Rect[];
  readonly rows: number;
}

/** 算一次布局（面板矩形 → 每个槽位的位置） */
export function layoutInventoryPanel(
  x: number,
  y: number,
  options: { readonly mainRows?: number; readonly hotbarRows?: number } = {},
): InventoryLayout {
  const mainRows = options.mainRows ?? INV_LAYOUT.mainRows;
  const hotbarRows = options.hotbarRows ?? INV_LAYOUT.hotbarRows;
  const rows = (mainRows + hotbarRows) * INV_LAYOUT.cols;
  const gridWidth = INV_LAYOUT.cols * INV_LAYOUT.slot + (INV_LAYOUT.cols - 1) * INV_LAYOUT.gap;
  const gridHeight =
    (mainRows + hotbarRows) * INV_LAYOUT.slot +
    (mainRows + hotbarRows - 1) * INV_LAYOUT.gap +
    (hotbarRows > 0 ? INV_LAYOUT.sectionGap - INV_LAYOUT.gap : 0);
  const panel: Rect = {
    x,
    y,
    w: gridWidth + INV_LAYOUT.padding * 2,
    h: INV_LAYOUT.titleHeight + gridHeight + INV_LAYOUT.padding * 2,
  };
  const titleRect: Rect = {
    x: panel.x + INV_LAYOUT.padding,
    y: panel.y + INV_LAYOUT.padding - 4,
    w: gridWidth,
    h: INV_LAYOUT.titleHeight,
  };

  const slots: Rect[] = [];
  for (let row = 0; row < mainRows + hotbarRows; row++) {
    const isHotbarRow = row >= mainRows;
    const step = INV_LAYOUT.slot + INV_LAYOUT.gap;
    const rowY =
      panel.y +
      INV_LAYOUT.padding +
      INV_LAYOUT.titleHeight +
      row * step +
      (isHotbarRow ? INV_LAYOUT.sectionGap - INV_LAYOUT.gap : 0);
    for (let col = 0; col < INV_LAYOUT.cols; col++) {
      slots.push({
        x: panel.x + INV_LAYOUT.padding + col * step,
        y: rowY,
        w: INV_LAYOUT.slot,
        h: INV_LAYOUT.slot,
      });
    }
  }
  return { panel, titleRect, slots, rows };
}

/** 命中：指针落在第几格（不在任何格子上返回 -1） */
export function slotIndexAt(layout: InventoryLayout, x: number, y: number): number {
  for (let i = 0; i < layout.slots.length; i++) {
    const rect = layout.slots[i]!;
    if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) return i;
  }
  return -1;
}

/** 画面板：底 + 斜面边框 + 标题 + 逐格 + 光标上那一叠 */
export function drawInventoryPanel(
  ctx: CanvasRenderingContext2D,
  layout: InventoryLayout,
  options: {
    readonly title: string;
    readonly slots: readonly ({ icon: HTMLCanvasElement | null; count: number; durability: { ratio: number; level: 'high' | 'mid' | 'low' } | null; locked?: boolean; held?: boolean } | null)[];
    readonly hoverIndex: number;
    readonly cursor: { icon: HTMLCanvasElement | null; count: number } | null;
    readonly cursorX: number;
    readonly cursorY: number;
    readonly skin?: InvSlotSkin;
  },
): void {
  const skin = options.skin ?? INV_SLOT_DEFAULT_SKIN;
  const { panel, titleRect } = layout;

  // 面板底：`#c6c6c6` + 3px 斜面（左上暗、右下亮）
  ctx.save();
  roundRectPath(ctx, panel, INV_LAYOUT.panelRadius);
  ctx.fillStyle = '#c6c6c6';
  ctx.fill();
  ctx.fillStyle = '#373737';
  ctx.fillRect(panel.x, panel.y, panel.w, 3);
  ctx.fillRect(panel.x, panel.y, 3, panel.h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(panel.x, panel.y + panel.h - 3, panel.w, 3);
  ctx.fillRect(panel.x + panel.w - 3, panel.y, 3, panel.h);

  drawText(ctx, options.title, titleRect.x, titleRect.y + titleRect.h / 2, {
    font: uiFont(13),
    color: '#3f3f3f',
    baseline: 'middle',
    shadow: false,
    maxWidth: titleRect.w,
  });

  for (let i = 0; i < layout.slots.length; i++) {
    const stack = options.slots[i] ?? null;
    drawInvSlot(
      ctx,
      {
        rect: layout.slots[i]!,
        icon: stack?.icon ?? null,
        count: stack?.count ?? 0,
        durability: stack?.durability ?? null,
        hovered: i === options.hoverIndex,
        pressed: false,
        locked: stack?.locked ?? false,
        held: stack?.held ?? false,
      },
      skin,
    );
  }

  // 光标上那一叠：跟着指针、画在最上面
  if (options.cursor) {
    const half = INV_LAYOUT.slot / 2;
    drawInvSlot(
      ctx,
      {
        rect: { x: options.cursorX - half, y: options.cursorY - half, w: INV_LAYOUT.slot, h: INV_LAYOUT.slot },
        icon: options.cursor.icon,
        count: options.cursor.count,
        durability: null,
        hovered: false,
        pressed: false,
        locked: false,
        held: false,
      },
      skin,
    );
  }
  ctx.restore();
}
