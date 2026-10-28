/**
 * 创造物品栏的**自绘面板**（布局 + 绘制 + 命中）
 *
 * 与 `InventoryPanelHost` 的区别：那个是"玩家背包 36 格 + 工作站槽位"的通用宿主，
 * 而创造栏是另一套东西 —— 12 列小格子、页签、搜索框、翻页，而且**物品不是存在格子里的**
 * （它是注册表的一个视图：点一下就"复制一整叠"）。
 *
 * 所以这里只做三件事：
 *  1. 维护 `tab / page` 两个状态（搜索词由调用方给，输入法那一层不在这里）；
 *  2. 调 `layoutCreativePanel` + `drawCreativePanel` 画出来；
 *  3. 命中：点页签 → 换页签；点格子 → 回调 `onPick(itemId)`；点翻页区左右 → 翻页。
 *
 * 数据（每个页签有哪些物品）由调用方注入 —— `ui2d` 不依赖注册表。
 */
import { CREATIVE_LAYOUT, drawCreativePanel, layoutCreativePanel, type CreativeLayout } from './InventoryPanel2D.ts';
import { Ui2DOverlay } from './overlay.ts';
import { applyDebugTint } from './debug.ts';
import type { Rect } from './widgets.ts';

/** 一格里的东西（创造栏只需要图标；数量恒为 1，原版也不在创造栏标数量） */
export interface CreativeCellView {
  readonly itemId: number;
  readonly icon: HTMLCanvasElement | null;
  readonly name: string;
}

export interface CreativePanelOptions {
  /** 页签标题（顺序即页签顺序） */
  readonly tabs: readonly string[];
  /**
   * 取某一页的物品。
   *
   * 由调用方完成"按页签筛 + 按搜索词筛 + 分页"（`ui2d/creativeModel.ts` 里有现成的纯函数）——
   * 面板只负责把它们摆进格子，这样"筛"与"摆"的边界是清楚的。
   */
  readonly cellsOf: (tab: number, page: number) => readonly (CreativeCellView | null)[];
  /** 总页数（`cellsOf` 知道的，面板不自己算：它不知道总共有多少件） */
  readonly pagesOf: (tab: number) => number;
  /** 点了一格（拿到的是物品 id；"复制一整叠"由调用方做） */
  readonly onPick?: (itemId: number) => void;
  /** 换了页签（调用方可能要重置页码或搜素词） */
  readonly onTab?: (tab: number) => void;
  readonly tint?: boolean;
  readonly zIndex?: number;
  /** 面板标题（i18n 由调用方给） */
  readonly title?: string;
  readonly placeholder?: string;
  /** 搜索词（只用于显示；真正筛选在 `cellsOf` 里） */
  readonly query?: string;
  /**
   * 底部快捷栏（9 格）。不传就画 9 个空格子。
   *
   * 创造栏**不消耗**物品，但玩家仍然要能看到自己快捷栏里有什么 —— DOM 版把
   * 玩家那 9 格原样摆在下面，这里保持同样的位置。
   */
  readonly hotbarOf?: () => readonly (CreativeCellView | null)[];
}

/** 翻页区的左右热区（与 `layoutCreativePanel` 的 `pager` 对齐） */
export function creativePagerHits(pager: Rect): { prev: Rect; next: Rect } {
  const w = Math.min(40, pager.w / 3);
  return {
    prev: { x: pager.x, y: pager.y, w, h: pager.h },
    next: { x: pager.x + pager.w - w, y: pager.y, w, h: pager.h },
  };
}

export class CreativePanel2D {
  private overlay: Ui2DOverlay | null = null;
  private layout: CreativeLayout | null = null;
  private tab = 0;
  private page = 0;
  private hoverIndex = -1;
  private opened = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: CreativePanelOptions,
  ) {}

  get isOpen(): boolean {
    return this.opened;
  }

  get canvas(): HTMLCanvasElement | null {
    return this.overlay?.canvas ?? null;
  }

  get currentTab(): number {
    return this.tab;
  }

  get currentPage(): number {
    return this.page;
  }

  /** 各区块矩形（截图脚本与命中调试用；正常业务不该依赖它） */
  get rects(): { readonly tabs: readonly Rect[]; readonly pager: Rect; readonly grid: readonly Rect[] } | null {
    const layout = this.layout;
    if (!layout) return null;
    return { tabs: layout.tabs, pager: layout.pager, grid: layout.grid };
  }

  open(): void {
    if (!this.overlay) {
      this.overlay = new Ui2DOverlay(this.host);
      if (this.options.zIndex !== undefined) this.overlay.canvas.style.zIndex = String(this.options.zIndex);
    }
    this.opened = true;
    this.relayout();
    this.render();
  }

  close(): void {
    this.opened = false;
    this.overlay?.clear();
  }

  dispose(): void {
    this.close();
    this.overlay?.dispose();
    this.overlay = null;
  }

  /** 页签 / 页码变化后由调用方同步进来（保持面板与游戏侧状态一致） */
  setState(next: { tab?: number; page?: number }): void {
    if (next.tab !== undefined) this.tab = Math.max(0, Math.min(this.options.tabs.length - 1, next.tab));
    if (next.page !== undefined) this.page = Math.max(0, next.page);
    this.clampPage();
    if (this.opened) this.render();
  }

  private clampPage(): void {
    const pages = Math.max(1, this.options.pagesOf(this.tab));
    if (this.page > pages - 1) this.page = pages - 1;
    if (this.page < 0) this.page = 0;
  }

  relayout(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.syncSize();
    const probe = layoutCreativePanel(0, 0, { rows: 5, tabs: this.options.tabs.length });
    const x = Math.max(0, Math.round((overlay.width - probe.panel.w) / 2));
    const y = Math.max(0, Math.round((overlay.height - probe.panel.h) / 2));
    this.layout = layoutCreativePanel(x, y, { rows: 5, tabs: this.options.tabs.length });
  }

  render(): void {
    const overlay = this.overlay;
    const layout = this.layout;
    if (!overlay || !layout) return;
    this.clampPage();
    const ctx = overlay.context;
    overlay.clear();
    const cells = this.options.cellsOf(this.tab, this.page);
    const grid = Array.from({ length: layout.grid.length }, (_, index) => {
      const cell = cells[index];
      if (!cell) return null;
      return { icon: cell.icon, count: 1 };
    });
    drawCreativePanel(ctx, layout, {
      title: this.options.title ?? '创造模式物品栏',
      tabs: this.options.tabs,
      activeTab: this.tab,
      query: this.options.query ?? '',
      placeholder: this.options.placeholder ?? '搜索物品',
      page: this.page,
      pages: Math.max(1, this.options.pagesOf(this.tab)),
      grid,
      hotbar: (this.options.hotbarOf?.() ?? []).map((cell) => (cell ? { icon: cell.icon, count: 1 } : null)),
      hoverIndex: this.hoverIndex,
    });
    // 翻页区的左右箭头（`‹ 1 / 3 ›` 里那两个符号就是热区位置）
    const hits = creativePagerHits(layout.pager);
    ctx.save();
    ctx.fillStyle = this.page > 0 ? 'rgba(63, 63, 63, .9)' : 'rgba(63, 63, 63, .25)';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('‹', hits.prev.x + hits.prev.w / 2, hits.prev.y + hits.prev.h / 2);
    const pages = Math.max(1, this.options.pagesOf(this.tab));
    ctx.fillStyle = this.page < pages - 1 ? 'rgba(63, 63, 63, .9)' : 'rgba(63, 63, 63, .25)';
    ctx.fillText('›', hits.next.x + hits.next.w / 2, hits.next.y + hits.next.h / 2);
    ctx.restore();
    if (this.options.tint) applyDebugTint(ctx, overlay.width, overlay.height);
  }

  /** 指针移动（只更新悬停高亮，不做别的） */
  move(x: number, y: number): void {
    const layout = this.layout;
    if (!layout) return;
    const index = this.slotAt(layout, x, y);
    if (index === this.hoverIndex) return;
    this.hoverIndex = index;
    this.render();
  }

  /** 按下（页签 / 翻页 / 格子）；返回是否消费了这个事件 */
  down(x: number, y: number): boolean {
    const layout = this.layout;
    if (!layout) return false;
    // 页签
    const tabIndex = layout.tabs.findIndex((rect) => contains(rect, x, y));
    if (tabIndex >= 0) {
      if (tabIndex !== this.tab) {
        this.tab = tabIndex;
        this.page = 0;
        this.options.onTab?.(tabIndex);
        this.render();
      }
      return true;
    }
    // 翻页
    const hits = creativePagerHits(layout.pager);
    if (contains(hits.prev, x, y)) {
      if (this.page > 0) {
        this.page -= 1;
        this.render();
      }
      return true;
    }
    if (contains(hits.next, x, y)) {
      const pages = Math.max(1, this.options.pagesOf(this.tab));
      if (this.page < pages - 1) {
        this.page += 1;
        this.render();
      }
      return true;
    }
    // 格子
    const index = this.slotAt(layout, x, y);
    if (index < 0) return false;
    const cell = this.options.cellsOf(this.tab, this.page)[index];
    if (!cell) return true;
    this.options.onPick?.(cell.itemId);
    return true;
  }

  private slotAt(layout: CreativeLayout, x: number, y: number): number {
    return layout.grid.findIndex((rect) => contains(rect, x, y));
  }
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** 一页多少格（面板固定 5 行 × `CREATIVE_LAYOUT.cols` 列） */
export const CREATIVE_GRID_SLOTS = CREATIVE_LAYOUT.cols * 5;
