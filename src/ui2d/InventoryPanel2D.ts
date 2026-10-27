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

/**
 * 玩家背包**上方**那块额外槽位（工作站用）：合成台的 3×3、熔炉的原料+燃料……
 *
 * 结果格单列出来：它总是"网格右侧、隔一段箭头的位置"，而且**不是**普通槽位
 * （不能往里放，只能往外拿）—— 把它混进网格会让命中与规则都变复杂。
 */
export interface ExtraSlotsSpec {
  readonly cols: number;
  readonly rows: number;
  /** 要不要在右边留一个结果格（合成 / 熔炉产物） */
  readonly result?: boolean;
}

/**
 * 右侧竖排那一列（盔甲 4 格 + 副手 1 格）。
 *
 * DOM 里它们贴着玩家网格的右侧：盔甲从上往下排（头盔 → 胸甲 → 护腿 → 靴子），
 * 副手单独在下面、隔一小段。`count` 含副手。
 */
export interface SideSlotsSpec {
  /** 总格数（生存是 5 = 4 盔甲 + 副手）；0 表示不要这一列 */
  readonly count: number;
  /** 副手前面那段额外的空档（缺省 6px） */
  readonly offhandGap?: number;
}

export interface InventoryLayout {
  readonly panel: Rect;
  readonly titleRect: Rect;
  /**
   * 全部槽位，顺序固定：**工作站那几格（含结果格）→ 右侧竖排（盔甲+副手）→ 主背包 27 → 快捷栏 9**。
   * 顺序定死之后，`SlotAccess` 的下标就是稳定的（调用方按这个顺序接数据）。
   */
  readonly slots: Rect[];
  readonly rows: number;
  /** 分组视图（命中判定与"能不能放"的规则要用得到） */
  readonly groups: {
    readonly extra: readonly Rect[];
    readonly result: Rect | null;
    /** 右侧竖排（盔甲 + 副手） */
    readonly side: readonly Rect[];
    readonly main: readonly Rect[];
    readonly hotbar: readonly Rect[];
  };
}

/** 算一次布局（面板矩形 → 每个槽位的位置） */
export function layoutInventoryPanel(
  x: number,
  y: number,
  options: {
    readonly mainRows?: number;
    readonly hotbarRows?: number;
    readonly extra?: ExtraSlotsSpec;
    readonly side?: SideSlotsSpec;
  } = {},
): InventoryLayout {
  const mainRows = options.mainRows ?? INV_LAYOUT.mainRows;
  const hotbarRows = options.hotbarRows ?? INV_LAYOUT.hotbarRows;
  const rows = (mainRows + hotbarRows) * INV_LAYOUT.cols;
  const step = INV_LAYOUT.slot + INV_LAYOUT.gap;
  const gridWidth = INV_LAYOUT.cols * INV_LAYOUT.slot + (INV_LAYOUT.cols - 1) * INV_LAYOUT.gap;
  const playerHeight =
    (mainRows + hotbarRows) * INV_LAYOUT.slot +
    (mainRows + hotbarRows - 1) * INV_LAYOUT.gap +
    (hotbarRows > 0 ? INV_LAYOUT.sectionGap - INV_LAYOUT.gap : 0);
  const extra = options.extra;
  const extraWidth = extra ? extra.cols * INV_LAYOUT.slot + (extra.cols - 1) * INV_LAYOUT.gap : 0;
  // 结果格与网格之间那段（DOM 里是"箭头 + 空隙"，这里按 28px 算）
  const resultGap = extra?.result ? 28 : 0;
  const extraHeight = extra ? extra.rows * INV_LAYOUT.slot + (extra.rows - 1) * INV_LAYOUT.gap : 0;
  const extraRowHeight = extra ? extraHeight + INV_LAYOUT.sectionGap : 0;
  const side = options.side;
  const sideCount = side ? Math.max(0, side.count) : 0;
  const offhandGap = side?.offhandGap ?? 6;
  // 侧栏与玩家网格之间空 8px（DOM 里是 grid 的 gap + 一段留白）
  const sideGap = sideCount > 0 ? 8 : 0;
  const sideWidth = sideCount > 0 ? INV_LAYOUT.slot + sideGap : 0;
  // 侧栏可能比玩家网格高（4 盔甲 + 副手 + 那段空档）：面板高度要取两者的较大值，
  // 否则副手会挂在面板外面（第一版就是这样，截图里那颗黄格子伸到面板底下了）
  const sideHeight =
    sideCount > 0 ? sideCount * INV_LAYOUT.slot + (sideCount - 1) * INV_LAYOUT.gap + offhandGap : 0;
  const panel: Rect = {
    x,
    y,
    w:
      Math.max(gridWidth, extraWidth + resultGap + (extra?.result ? INV_LAYOUT.slot : 0)) +
      sideWidth +
      INV_LAYOUT.padding * 2,
    h: INV_LAYOUT.titleHeight + extraRowHeight + Math.max(playerHeight, sideHeight) + INV_LAYOUT.padding * 2,
  };
  const titleRect: Rect = {
    x: panel.x + INV_LAYOUT.padding,
    y: panel.y + INV_LAYOUT.padding - 4,
    w: gridWidth,
    h: INV_LAYOUT.titleHeight,
  };

  const slots: Rect[] = [];
  const extraSlots: Rect[] = [];
  let resultRect: Rect | null = null;
  const contentX = panel.x + INV_LAYOUT.padding;
  const playerTop = panel.y + INV_LAYOUT.padding + INV_LAYOUT.titleHeight + extraRowHeight;
  if (extra) {
    // 工作站那几格在面板里**居中**（DOM 是 flex 居中，不是靠左）
    const blockWidth = extraWidth + resultGap + (extra.result ? INV_LAYOUT.slot : 0);
    const originX = contentX + Math.max(0, (gridWidth - blockWidth) / 2);
    const originY = panel.y + INV_LAYOUT.padding + INV_LAYOUT.titleHeight;
    for (let row = 0; row < extra.rows; row++) {
      for (let col = 0; col < extra.cols; col++) {
        extraSlots.push({
          x: originX + col * step,
          y: originY + row * step,
          w: INV_LAYOUT.slot,
          h: INV_LAYOUT.slot,
        });
      }
    }
    if (extra.result) {
      resultRect = {
        x: originX + extraWidth + resultGap,
        y: originY + (extraHeight - INV_LAYOUT.slot) / 2,
        w: INV_LAYOUT.slot,
        h: INV_LAYOUT.slot,
      };
    }
    slots.push(...extraSlots);
    if (resultRect) slots.push(resultRect);
  }

  const sideSlots: Rect[] = [];
  if (sideCount > 0) {
    const sideX = panel.x + panel.w - INV_LAYOUT.padding - INV_LAYOUT.slot;
    for (let i = 0; i < sideCount; i++) {
      // 最后一格是副手：往下多让一段，与盔甲分开
      const extraOffset = i === sideCount - 1 && sideCount > 1 ? offhandGap : 0;
      sideSlots.push({
        x: sideX,
        y: playerTop + i * step + extraOffset,
        w: INV_LAYOUT.slot,
        h: INV_LAYOUT.slot,
      });
    }
    slots.push(...sideSlots);
  }

  const mainSlots: Rect[] = [];
  const hotbarSlots: Rect[] = [];
  for (let row = 0; row < mainRows + hotbarRows; row++) {
    const isHotbarRow = row >= mainRows;
    const rowY =
      playerTop +
      row * step +
      (isHotbarRow ? INV_LAYOUT.sectionGap - INV_LAYOUT.gap : 0);
    for (let col = 0; col < INV_LAYOUT.cols; col++) {
      const rect: Rect = {
        x: contentX + col * step,
        y: rowY,
        w: INV_LAYOUT.slot,
        h: INV_LAYOUT.slot,
      };
      slots.push(rect);
      if (isHotbarRow) hotbarSlots.push(rect);
      else mainSlots.push(rect);
    }
  }
  return {
    panel,
    titleRect,
    slots,
    rows,
    groups: {
      extra: extraSlots,
      result: resultRect,
      side: sideSlots,
      main: mainSlots,
      hotbar: hotbarSlots,
    },
  };
}

/**
 * 长按选数量：把"手指相对按下点横向移了多远"换算成数量。
 *
 * 与 DOM 版的手感一致：**越往右越多，1 格 ≈ 12px**，夹在 `1..max`。
 * 纯函数，离线可断言（DOM 版那条滑条也是这么算的）。
 */
export function splitCountFromDrag(dx: number, max: number): number {
  if (!(max > 0)) return 0;
  if (!Number.isFinite(dx)) return 1;
  return Math.min(max, Math.max(1, Math.round(1 + dx / 12)));
}

/** 长按选数量时那格的高亮（原版是把选中那格压暗再罩一层） */
export function drawSplitTarget(ctx: CanvasRenderingContext2D, slot: Rect): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, .35)';
  ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
  ctx.restore();
}

/** 画"长按选数量"的小牌：格子正上方，写着数量与一条占比条 */
export function drawSplitHint(ctx: CanvasRenderingContext2D, slot: Rect, count: number, max: number): void {
  const w = Math.max(46, slot.w + 12);
  const h = 18;
  const rect: Rect = { x: slot.x + slot.w / 2 - w / 2, y: slot.y - h - 6, w, h };
  ctx.save();
  roundRectPath(ctx, rect, 4);
  ctx.fillStyle = 'rgba(12, 13, 16, .88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, .55)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, rect, 4);
  ctx.stroke();
  const ratio = max > 0 ? Math.min(1, count / max) : 0;
  ctx.fillStyle = 'rgba(120, 200, 110, .85)';
  ctx.fillRect(rect.x + 3, rect.y + rect.h - 4, (rect.w - 6) * ratio, 2);
  drawText(ctx, `${count}`, rect.x + rect.w / 2, rect.y + rect.h / 2 - 1, {
    font: uiFont(11),
    color: '#f2f5f8',
    align: 'center',
    baseline: 'middle',
    shadow: false,
  });
  ctx.restore();
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

  // 结果格左边那颗箭头（DOM 里是 `.craft-arrow` 的 "→"）：没有它，结果格看起来像普通槽位
  const result = layout.groups.result;
  if (result) {
    const cy = result.y + result.h / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(63, 63, 63, .8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(result.x - 22, cy);
    ctx.lineTo(result.x - 8, cy);
    ctx.moveTo(result.x - 14, cy - 5);
    ctx.lineTo(result.x - 8, cy);
    ctx.lineTo(result.x - 14, cy + 5);
    ctx.stroke();
    ctx.restore();
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
