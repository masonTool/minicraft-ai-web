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
  /** 要不要在箭头下方留一块"火焰"（熔炉的燃料剩余画在这里） */
  readonly flame?: boolean;
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

/**
 * 创造物品栏的排版参数（照抄 `index.html` 的 `.inv-grid.inv-creative`）。
 *
 * 与生存背包最大的不同是**格子更小、列数更多**（12 列 34px），而且要额外排
 * 一行页签和一条搜索框 —— 这两块是创造模式独有的。
 */
export const CREATIVE_LAYOUT = {
  cols: 12,
  slot: 34,
  gap: 2,
  tabsHeight: 30,
  searchHeight: 24,
  sectionGap: 10,
  pagerHeight: 20,
} as const;

export interface CreativeLayout {
  readonly panel: Rect;
  readonly titleRect: Rect;
  /** 分类页签（横向一排，等分面板宽度） */
  readonly tabs: Rect[];
  /** 搜索框 */
  readonly search: Rect;
  /** 12 列网格（按行铺开） */
  readonly grid: Rect[];
  /** 翻页区（网格下方一条：‹ 页码 ›） */
  readonly pager: Rect;
  /** 底部快捷栏 9 格（沿用生存背包的 42px 尺寸） */
  readonly hotbar: Rect[];
}

/** 算创造物品栏的布局（页签 / 搜索框 / 12 列网格 / 底部快捷栏） */
export function layoutCreativePanel(
  x: number,
  y: number,
  options: { readonly rows?: number; readonly tabs?: number } = {},
): CreativeLayout {
  const rows = Math.max(1, options.rows ?? 5);
  const tabCount = Math.max(1, options.tabs ?? 5);
  const step = CREATIVE_LAYOUT.slot + CREATIVE_LAYOUT.gap;
  const gridWidth = CREATIVE_LAYOUT.cols * CREATIVE_LAYOUT.slot + (CREATIVE_LAYOUT.cols - 1) * CREATIVE_LAYOUT.gap;
  // 底部快捷栏仍是 42px 九格，决定面板最小宽度
  const hotbarWidth = INV_LAYOUT.cols * INV_LAYOUT.slot + (INV_LAYOUT.cols - 1) * INV_LAYOUT.gap;
  const innerWidth = Math.max(gridWidth, hotbarWidth);
  const gridHeight = rows * CREATIVE_LAYOUT.slot + (rows - 1) * CREATIVE_LAYOUT.gap;
  const panel: Rect = {
    x,
    y,
    w: innerWidth + INV_LAYOUT.padding * 2,
    h:
      INV_LAYOUT.titleHeight +
      CREATIVE_LAYOUT.tabsHeight +
      CREATIVE_LAYOUT.searchHeight +
      CREATIVE_LAYOUT.sectionGap * 2 +
      gridHeight +
      CREATIVE_LAYOUT.sectionGap +
      CREATIVE_LAYOUT.pagerHeight +
      INV_LAYOUT.slot +
      INV_LAYOUT.padding * 2,
  };
  const contentX = panel.x + INV_LAYOUT.padding;
  const titleRect: Rect = {
    x: contentX,
    y: panel.y + INV_LAYOUT.padding - 4,
    w: innerWidth,
    h: INV_LAYOUT.titleHeight,
  };
  // 页签：等分内容宽度
  const tabsTop = titleRect.y + INV_LAYOUT.titleHeight + 6;
  const tabWidth = innerWidth / tabCount;
  const tabs: Rect[] = [];
  for (let i = 0; i < tabCount; i++) {
    tabs.push({ x: contentX + tabWidth * i, y: tabsTop, w: tabWidth - 2, h: CREATIVE_LAYOUT.tabsHeight - 6 });
  }
  const search: Rect = {
    x: contentX,
    y: tabsTop + CREATIVE_LAYOUT.tabsHeight,
    w: innerWidth,
    h: CREATIVE_LAYOUT.searchHeight,
  };
  // 网格：12 列居中（内容宽度可能比网格宽，因为快捷栏更宽）
  const gridLeft = contentX + (innerWidth - gridWidth) / 2;
  const gridTop = search.y + CREATIVE_LAYOUT.searchHeight + CREATIVE_LAYOUT.sectionGap;
  const grid: Rect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < CREATIVE_LAYOUT.cols; col++) {
      grid.push({
        x: gridLeft + col * step,
        y: gridTop + row * step,
        w: CREATIVE_LAYOUT.slot,
        h: CREATIVE_LAYOUT.slot,
      });
    }
  }
  // 翻页区：网格下方一条（不占格位，只是几个字）
  const pager: Rect = {
    x: contentX,
    y: gridTop + gridHeight + CREATIVE_LAYOUT.sectionGap,
    w: innerWidth,
    h: CREATIVE_LAYOUT.pagerHeight,
  };
  // 底部快捷栏：九格居中
  const hotbarTop = pager.y + pager.h + CREATIVE_LAYOUT.sectionGap;
  const hotbarLeft = contentX + (innerWidth - hotbarWidth) / 2;
  const hotbar: Rect[] = [];
  for (let col = 0; col < INV_LAYOUT.cols; col++) {
    hotbar.push({
      x: hotbarLeft + col * (INV_LAYOUT.slot + INV_LAYOUT.gap),
      y: hotbarTop,
      w: INV_LAYOUT.slot,
      h: INV_LAYOUT.slot,
    });
  }
  return { panel, titleRect, tabs, search, grid, pager, hotbar };
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
    /**
     * 结果格左边那块"箭头区"（熔炉的熔炼进度、酿造台的箭头都画在这里）。
     * 合成台没有进度，但箭头本身仍然画（只是不带填充）。
     */
    readonly progress: Rect | null;
    /** 箭头下方那块火焰（熔炉燃料剩余），没有就是 null */
    readonly flame: Rect | null;
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

  const progressRect: Rect | null = resultRect
    ? {
        x: resultRect.x - resultGap,
        y: resultRect.y + resultRect.h / 2 - 7,
        w: resultGap,
        h: 14,
      }
    : null;

  const flameRect: Rect | null =
    extra?.flame && progressRect
      ? {
          x: progressRect.x + (progressRect.w - 18) / 2,
          y: progressRect.y + progressRect.h + 8,
          w: 18,
          h: 20,
        }
      : null;

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
      progress: progressRect,
      flame: flameRect,
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

/** 画创造物品栏需要的输入（页签、搜索框、格子里放什么） */
export interface CreativePanelInput {
  readonly title: string;
  /** 页签文字（顺序与 `layout.tabs` 一致） */
  readonly tabs: readonly string[];
  /** 当前页签下标（-1 = 没有选中） */
  readonly activeTab: number;
  /** 搜索框里的文字（为空则显示占位文案） */
  readonly query: string;
  readonly placeholder: string;
  /** 当前页（从 0 起）与总页数（显示成 `3 / 8`） */
  readonly page?: number;
  readonly pages?: number;
  /** 网格里每一格（`null` = 空） */
  readonly grid: readonly ({ icon: HTMLCanvasElement | null; count: number } | null)[];
  /** 底部快捷栏 */
  readonly hotbar: readonly ({ icon: HTMLCanvasElement | null; count: number } | null)[];
  readonly hoverIndex: number;
  readonly skin?: InvSlotSkin;
}

/**
 * 画创造物品栏：面板 + 标题 + 页签 + 搜索框 + 12 列网格 + 底部快捷栏。
 *
 * 与生存背包共用的只有"槽位怎么画"（`drawInvSlot`）；页签和搜索框是创造独有的两块，
 * 所以单独一个函数，而不是往 `drawInventoryPanel` 里塞一堆 `if (creative)`。
 */
export function drawCreativePanel(
  ctx: CanvasRenderingContext2D,
  layout: CreativeLayout,
  input: CreativePanelInput,
): void {
  const skin = input.skin ?? INV_SLOT_DEFAULT_SKIN;
  const { panel, titleRect } = layout;
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
  ctx.restore();

  drawText(ctx, input.title, titleRect.x, titleRect.y + titleRect.h / 2, {
    font: uiFont(13),
    color: '#3f3f3f',
    baseline: 'middle',
    shadow: false,
    maxWidth: titleRect.w,
  });

  // 页签：选中的那块深一点、字反白（DOM 是 `.inv-creative-tab.active`）
  layout.tabs.forEach((rect, index) => {
    const active = index === input.activeTab;
    ctx.save();
    roundRectPath(ctx, rect, 2);
    ctx.fillStyle = active ? '#6f6f6f' : '#8b8b8b';
    ctx.fill();
    ctx.strokeStyle = active ? '#3f3f3f' : '#5a5a5a';
    ctx.lineWidth = 2;
    roundRectPath(ctx, rect, 2);
    ctx.stroke();
    ctx.restore();
    drawText(ctx, input.tabs[index] ?? '', rect.x + rect.w / 2, rect.y + rect.h / 2, {
      font: uiFont(11),
      color: active ? '#ffffff' : '#3f3f3f',
      align: 'center',
      baseline: 'middle',
      shadow: false,
      maxWidth: rect.w - 6,
    });
  });

  // 搜索框：白底 + 深边；没输入时显示占位文案（灰）
  const search = layout.search;
  ctx.save();
  roundRectPath(ctx, search, 2);
  ctx.fillStyle = '#f2f2f2';
  ctx.fill();
  ctx.strokeStyle = '#5a5a5a';
  ctx.lineWidth = 2;
  roundRectPath(ctx, search, 2);
  ctx.stroke();
  ctx.restore();
  const query = input.query.length > 0 ? input.query : input.placeholder;
  drawText(ctx, query, search.x + 6, search.y + search.h / 2, {
    font: uiFont(11),
    color: input.query.length > 0 ? '#2b2b2b' : '#8a8a8a',
    baseline: 'middle',
    shadow: false,
    maxWidth: search.w - 12,
  });

  /*
   * 翻页区：`‹ 3 / 8 ›`。
   * 只画，不做命中 —— 创造栏的翻页在游戏里由滚轮/滚动条驱动（DOM 版也没有翻页按钮，
   * 只有一条"第几页"的提示），画出来是为了让玩家知道"下面还有"。
   */
  if (input.page !== undefined && input.pages !== undefined) {
    const pager = layout.pager;
    const label = `${input.page + 1} / ${input.pages}`;
    const mid = pager.y + pager.h / 2;
    drawText(ctx, `‹  ${label}  ›`, pager.x + pager.w / 2, mid, {
      font: uiFont(11),
      color: '#3f3f3f',
      align: 'center',
      baseline: 'middle',
      shadow: false,
      maxWidth: pager.w,
    });
  }

  // 网格（12 列 × N 行）
  layout.grid.forEach((rect, index) => {
    const stack = input.grid[index] ?? null;
    drawInvSlot(
      ctx,
      {
        rect,
        icon: stack?.icon ?? null,
        count: stack?.count ?? 0,
        durability: null,
        hovered: index === input.hoverIndex,
        pressed: false,
        locked: false,
        held: false,
      },
      skin,
    );
  });

  // 底部快捷栏（沿用生存背包的槽位尺寸）
  layout.hotbar.forEach((rect, index) => {
    const stack = input.hotbar[index] ?? null;
    drawInvSlot(
      ctx,
      {
        rect,
        icon: stack?.icon ?? null,
        count: stack?.count ?? 0,
        durability: null,
        hovered: false,
        pressed: false,
        locked: false,
        held: false,
      },
      skin,
    );
  });
}

/**
 * 画结果格左边那颗箭头，并按 `ratio` 填一段。
 *
 * 空箭头与填充用同一条路径：先描边、再按比例把左侧那段填实 —— 这样"进度 0.4"
 * 看起来就是箭头从左边亮到 40%，与 DOM 版熔炉的观感一致。
 */
export function drawProgressArrow(
  ctx: CanvasRenderingContext2D,
  progressRect: Rect | null,
  result: Rect,
  ratio: number,
): void {
  const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const cy = result.y + result.h / 2;
  const left = progressRect ? progressRect.x : result.x - 22;
  const right = result.x - 8;

  ctx.save();
  // 底：暗色箭头轮廓
  ctx.strokeStyle = 'rgba(63, 63, 63, .8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, cy);
  ctx.lineTo(right, cy);
  ctx.moveTo(right - 6, cy - 5);
  ctx.lineTo(right, cy);
  ctx.lineTo(right - 6, cy + 5);
  ctx.stroke();

  // 进度：从左边亮到 40% 之类
  if (clamped > 0) {
    const tipX = left + (right - left) * clamped;
    ctx.strokeStyle = 'rgba(240, 240, 240, .95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(left, cy);
    ctx.lineTo(tipX, cy);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 画熔炉的"火焰"（燃料剩余）：底是竖条纹空槽，橙色从下往上按 `ratio` 涨。
 *
 * 照 DOM 的 `.furnace-flame`：18×20 的框、竖条纹打底、里面一根 `<b>` 按百分比涨高。
 */
export function drawFlameBar(ctx: CanvasRenderingContext2D, rect: Rect, ratio: number): void {
  const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  ctx.save();
  // 底：竖条纹（DOM 是 repeating-linear-gradient 90deg）
  ctx.fillStyle = 'rgba(90, 90, 90, .20)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  for (let x = rect.x + 3; x < rect.x + rect.w; x += 6) {
    ctx.fillStyle = 'rgba(90, 90, 90, .38)';
    ctx.fillRect(x, rect.y, 2, rect.h);
  }
  // 火苗：从底部往上
  if (clamped > 0) {
    const h = rect.h * clamped;
    const gradient = ctx.createLinearGradient(0, rect.y + rect.h - h, 0, rect.y + rect.h);
    gradient.addColorStop(0, 'rgba(255, 200, 80, .92)');
    gradient.addColorStop(1, 'rgba(240, 110, 30, .92)');
    ctx.fillStyle = gradient;
    ctx.fillRect(rect.x + 2, rect.y + rect.h - h, rect.w - 4, h);
  }
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
    /** 结果格左边那颗箭头的填充比例（0..1）；缺省 0 = 空箭头 */
    readonly progress?: number;
    /** 箭头下方火焰的比例（熔炉燃料剩余，0..1） */
    readonly flame?: number;
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

  /*
   * 结果格左边那颗箭头（DOM 里是 `.craft-arrow` 的 "→"）：没有它，结果格看起来像普通槽位。
   * `progress` 给了就按比例填一段（熔炉的熔炼进度就画在这里），没给就是空箭头。
   */
  const result = layout.groups.result;
  if (result) drawProgressArrow(ctx, layout.groups.progress, result, options.progress ?? 0);
  if (layout.groups.flame) drawFlameBar(ctx, layout.groups.flame, options.flame ?? 0);

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
