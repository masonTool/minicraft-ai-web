/**
 * 配方书（界面）——**按基岩版经典 UI 复刻**（批次 135）。
 *
 * 版面（与用户给的截图一致，左半屏那块）：
 *   ① 顶栏：标题「配方书」+ 条数 + 关闭
 *   ② 搜索框 + 右侧一颗**方形筛选按钮**（=「仅显示可合成」开关）
 *   ③ 一排**方形图标页签**：全部（放大镜）/ 建筑 / 装备 / 物品 / 自然
 *   ④ **产物图标网格**：一格一件产物，右下角是数量；材料够的亮着、不够的压暗
 *   ⑤ 底部一行"这一格是什么 + 材料够不够"（手机上没有悬停，必须有这一行）
 *   ⑥ 翻页条 + 熔炼表
 *
 * ⚠️ 主交互（批次 132，中文 Wiki「物品栏 → 配方书」）：
 * **点一格 = 把材料摆进合成格**，摆法看得见、还能自己改，最后点输出格取成品。
 * 原来那版是"点一下直接扣料出成品"，看不见摆放过程——与 Wiki 描述不符。
 * 更早那版是"一张配方一张卡片"（摆法网格 + 材料 chip + 合成按钮），
 * 用户明确否决：截图里就是**纯图标网格**，不是卡片列表。
 *
 * 数据都在 `core/crafting/RecipeBook.ts` 里（纯函数，可离线测），这里只管画。
 */

import type { Inventory } from '../core/container/Inventory.ts';
import {
  RECIPE_BOOK_TABS,
  RECIPE_BOOK_TAB_LABELS,
  buildRecipeEntries,
  matchesRecipe,
  type RecipeBookTab,
  type RecipeEntry,
} from '../core/crafting/RecipeBook.ts';
import { recipeLayout } from '../core/crafting/RecipeLayout.ts';
import { clampPage, pageCount, pageLabel, pageSizeFor, slicePage } from './ItemPager.ts';
import { SMELTING_RECIPES, SMELTING_TIME } from '../core/crafting/Smelting.ts';
import { itemLabel } from '../core/registry/itemNames.ts';
import type { Recipe } from '../core/crafting/Recipes.ts';
import type { TextureAtlas } from '../render/TextureAtlas.ts';
import { drawItemIcon } from './ItemIcon.ts';
import { isTouchUi } from './TouchControls.ts';
import { RECIPE_TAB_ICONS } from './CreativeTabs.ts';

/**
 * "全部"那一栏的放大镜图标（批次 134）。
 *
 * 基岩版经典 UI 的配方书最右侧就是一颗放大镜（它的语义是"搜索配方 + 列出全部
 * 已解锁配方"）。图集里没有"放大镜"这件物品，所以这一处用内联 SVG——
 * 其余四栏都复用创造栏的真实物品图标（见 `CreativeTabs.ts`）。
 */
const SEARCH_TAB_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
  '<path fill="currentColor" d="M10 2.6a7.4 7.4 0 1 0 4.4 13.35l4.32 4.32 1.7-1.7-4.32-4.32A7.4 7.4 0 0 0 10 2.6zm0 2.4a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/>' +
  '</svg>';

export interface RecipeBookActions {
  /**
   * 一键做完（按住 Shift 点格子才走这条）；返回是否成功（材料不够时返回 false）。
   *
   * 原版配方书**没有**这颗按钮——批量是在合成格里连点输出格做的。
   * 留着它是因为"这条能做 12 次"时一次一次点太累，且它是纯加速路径，
   * 不占版面（没有对应的可见控件）。
   */
  onCraft: (recipe: Recipe) => boolean;
  /**
   * 把材料**摆进合成格**（批次 132，对齐原版）；返回是否摆成功。
   *
   * ⚠️ 这是**唯一的常规交互**：原版配方书点一条配方就是"把材料摆进合成格"，
   * 摆法看得见、还能自己改，最后点输出格取成品（见中文 Wiki「物品栏 → 配方书」）。
   */
  onFill: (recipe: Recipe) => boolean;
}

export class RecipeBook {
  readonly root: HTMLDivElement;

  private readonly gridEl: HTMLDivElement;
  private readonly searchEl: HTMLInputElement;
  private readonly summaryEl: HTMLSpanElement;
  private readonly smeltingEl: HTMLDivElement;
  private open = false;
  private query = '';
  /** 上次画出来的条目数（验收脚本用） */
  private entryCount = 0;
  /** 当前页（0 起）；改搜索词会回到第 1 页 */
  private page = 0;
  private readonly panelEl: HTMLDivElement;
  private readonly pagerEl: HTMLDivElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly pageLabel: HTMLSpanElement;
  /** 标签栏（批次 133）：基岩版就是"建筑 / 装备 / 物品 / 自然 / 全部" */
  private readonly tabsEl: HTMLDivElement;
  /** 「仅显示可合成」开关：搜索框右边那颗**方形按钮**（基岩版就是这个位置） */
  private readonly filterButton: HTMLButtonElement;
  /**
   * 底部那一行"点着的这格是什么"（批次 135）。
   *
   * 图标网格省掉了卡片上那些文字，但**名字与材料**不能跟着一起没——
   * 手机（横屏）上没有鼠标悬停，`title` 拿不到，只能靠这一行说出来。
   */
  private readonly detailEl: HTMLDivElement;
  private tab: RecipeBookTab = 'all';
  /**
   * 「仅显示可合成」（批次 133）。
   *
   * 默认**关**：Wiki「配方书」一节的措辞是"配方书…会显示玩家拥有所需材料的相关
   * 合成配方"，但基岩版实际是"列出已解锁的配方、能做的排在前面（材料不足的灰着）"。
   * 默认藏掉大半会让人以为"我的配方丢了"，所以做成开关，打开就只看能做的。
   */
  private onlyCraftable = false;

  constructor(
    host: HTMLElement,
    private readonly atlas: TextureAtlas,
    private readonly inventory: Inventory,
    private readonly actions: RecipeBookActions,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'recipe-book';
    this.root.classList.add('hidden');

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'recipe-panel';
    const panel = this.panelEl;

    // ---- 标题栏
    const header = document.createElement('div');
    header.className = 'recipe-header';

    const title = document.createElement('b');
    title.textContent = '配方书';

    this.summaryEl = document.createElement('span');
    this.summaryEl.className = 'recipe-hint';

    this.searchEl = document.createElement('input');
    this.searchEl.type = 'text';
    this.searchEl.className = 'recipe-search';
    this.searchEl.placeholder = '搜索物品或材料（中文/英文都行）';
    this.searchEl.addEventListener('input', () => {
      this.query = this.searchEl.value;
      // 搜索是从头筛一遍，页码当然要回到第 1 页
      this.page = 0;
      this.render();
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'recipe-close';
    // 手机上是一个 ✕（基岩版也是右上角一个叉），PC 上保留 "关闭 (R)" 的键盘提示
    //（批次 104：手机端不该出现键盘字母——"关闭 (R)"会让人以为要按 R 才关得掉）。
    // 两种情况下读屏与无障碍拿到的都是"关闭配方书"。
    close.textContent = isTouchUi() ? '✕' : '关闭 (R)';
    close.setAttribute('aria-label', '关闭配方书');
    close.addEventListener('click', () => this.hide());

    header.append(title, this.summaryEl, close);

    // ---- 搜索框 + 筛选按钮（批次 135，对齐截图）
    //
    // 基岩版经典 UI：配方书顶上是"搜索框 + 右边一颗方形按钮"，那颗按钮就是
    // 「仅显示可合成」的开关（图标是工作台）。原来这颗按钮挂在页签那一行的右端，
    // 与截图对不上，这里挪回来。
    const controls = document.createElement('div');
    controls.className = 'recipe-controls';
    this.filterButton = document.createElement('button');
    this.filterButton.type = 'button';
    this.filterButton.className = 'recipe-filter';
    this.filterButton.dataset.role = 'craftable-filter';
    const filterIcon = document.createElement('canvas');
    filterIcon.className = 'recipe-filter-icon';
    filterIcon.width = 18;
    filterIcon.height = 18;
    drawItemIcon(filterIcon, this.atlas, RECIPE_TAB_ICONS.items, 16);
    this.filterButton.appendChild(filterIcon);
    this.filterButton.addEventListener('click', () => {
      this.onlyCraftable = !this.onlyCraftable;
      this.page = 0;
      this.render();
    });
    controls.append(this.searchEl, this.filterButton);

    // ---- 标签栏（批次 133，对齐基岩版）
    //
    // Wiki「物品栏 → 配方书」写得很明确：基岩版的配方书按标签栏展示，且
    // "合成配方书的标签栏与创造分类相同"——建筑 / 装备 / 物品 / 自然 / 全部。
    // 分类归并在 `core/crafting/RecipeBook.ts` 的 `recipeBookTab()` 里（纯函数、可断言）。
    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'recipe-tabs';

    for (const tab of RECIPE_BOOK_TABS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recipe-tab';
      button.dataset.tab = tab;

      // 图标（批次 134，对齐截图纸质界面的那一排）：Wiki 说"合成配方书的标签栏与
      // 创造分类相同"，所以复用创造栏那几件物品；"全部"那一栏在经典 UI 里是**放大镜**，
      // 而图集里没有这件物品 → 内联一个 SVG。
      if (tab === 'all') {
        const glyph = document.createElement('span');
        glyph.className = 'recipe-tab-icon';
        glyph.innerHTML = SEARCH_TAB_ICON;
        button.appendChild(glyph);
      } else {
        const canvas = document.createElement('canvas');
        canvas.className = 'recipe-tab-icon';
        canvas.width = 16;
        canvas.height = 16;
        drawItemIcon(canvas, this.atlas, RECIPE_TAB_ICONS[tab], 16);
        button.appendChild(canvas);
      }

      const label = document.createElement('span');
      label.className = 'recipe-tab-label';
      button.appendChild(label);

      button.addEventListener('click', () => {
        this.tab = tab;
        // 换了标签栏等于换了一份列表，页码当然要回到第 1 页（与改搜索词同一个道理）
        this.page = 0;
        this.render();
      });
      this.tabsEl.appendChild(button);
    }

    // ---- 配方列表：基岩版是**产物图标网格**（截图里那一屏方格子），
    // 不是"一条配方一张卡片"
    this.gridEl = document.createElement('div');
    this.gridEl.className = 'recipe-grid';

    // ---- 底部说明行（见 `detailEl` 的注记）
    this.detailEl = document.createElement('div');
    this.detailEl.className = 'recipe-detail';

    // ---- 熔炼
    this.smeltingEl = document.createElement('div');
    this.smeltingEl.className = 'recipe-smelting';

    // ---- 翻页条（与创造物品栏同一套类名与样式）
    this.pagerEl = document.createElement('div');
    this.pagerEl.className = 'inv-pager hidden';
    this.prevButton = this.makePagerButton('‹ 上一页', () => this.flipPage(-1));
    this.nextButton = this.makePagerButton('下一页 ›', () => this.flipPage(1));
    this.pageLabel = document.createElement('span');
    this.pageLabel.className = 'inv-page-label';
    this.pageLabel.dataset.role = 'label';
    this.prevButton.dataset.role = 'prev';
    this.nextButton.dataset.role = 'next';
    this.pagerEl.append(this.prevButton, this.pageLabel, this.nextButton);

    panel.append(header, controls, this.tabsEl, this.gridEl, this.detailEl, this.pagerEl, this.smeltingEl);
    this.root.append(panel);
    host.appendChild(this.root);

    // ⚠️ 批次 111 删掉了"点面板外关闭"（用户要求"不要点击空白关闭，就用关闭按钮"）：
    // 这里的出口是标题栏右上角的 ✕（`.recipe-close`）。
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 当前列出的配方条数（验收脚本用） */
  get count(): number {
    return this.entryCount;
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  /** 重建配方列表（打开、搜索、换标签栏、切筛选、合成之后都要调：合成会改变"能不能做"） */
  render(): void {
    const all = buildRecipeEntries(this.inventory);
    // 先过"筛选"那一层（仅显示可合成 + 搜索词），再按标签栏切。
    // 标签栏上的条数也跟着筛选走——筛完之后哪一栏还有东西，一眼就能看出来。
    const base = all.filter(
      (entry) => (!this.onlyCraftable || entry.craftable) && matchesRecipe(entry.recipe, this.query),
    );
    const entries = this.tab === 'all' ? base : base.filter((entry) => entry.tab === this.tab);
    this.entryCount = entries.length;

    this.renderTabs(base);
    const craftable = entries.filter((entry) => entry.craftable).length;
    this.summaryEl.textContent = `共 ${entries.length} 条 · 现在能做 ${craftable} 条`;

    // 分页（批次 29）：181 条配方一次全建进 DOM 要 400ms 以上，而搜索框每敲一个字
    // 都会重建。只画当前页就回到可忽略。页大小跟着 CSS 的列数走（宽屏 12 列 × 5 行、
    // 窄屏 8 列 × 4 行），否则最后一行会出现"半行空位"看着像 bug。
    const pageSize = pageSizeFor(this.viewportWidth);
    this.page = clampPage(this.page, entries.length, pageSize);
    const visible = slicePage(entries, this.page, pageSize);

    this.gridEl.replaceChildren();
    this.resetDetail();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recipe-empty';
      // 空列表要说清"为什么空"：是筛掉了，还是这一栏本来就没有——
      // 否则玩家只会以为配方书坏了（"仅显示可合成"默认关着，所以多半是搜索/标签栏的问题）
      empty.textContent = this.onlyCraftable
        ? '现在没有能做的配方（关掉「仅显示可合成」可以看到全部）'
        : '这一栏里没有匹配的配方';
      this.gridEl.appendChild(empty);
    } else {
      for (const entry of visible) this.gridEl.appendChild(this.makeCell(entry));
    }

    this.renderPager(entries.length, pageSize);
    this.renderSmelting();
  }

  /**
   * 刷新标签栏与"仅显示可合成"的状态（批次 133；批次 135 改成**方形图标按钮**）。
   *
   * 基岩版的页签是**只有图标的方块**（截图里那一排），名字与条数挂在
   * `title` / `aria-label` 上：鼠标悬停看得到、读屏念得出，但画面上不占宽度
   * （五个页签都写文字，手机上得横向滚才能换栏）。
   */
  private renderTabs(base: readonly RecipeEntry[]): void {
    const counts = new Map<RecipeBookTab, number>([['all', base.length]]);
    for (const entry of base) counts.set(entry.tab, (counts.get(entry.tab) ?? 0) + 1);

    for (const button of this.tabsEl.querySelectorAll<HTMLButtonElement>('.recipe-tab')) {
      const tab = button.dataset.tab as RecipeBookTab;
      const on = tab === this.tab;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
      // ⚠️ 条数只写进 title / aria 与那个不可见的 label：页面上仍是"纯图标方块"。
      // 整块 `textContent` 覆盖会把 canvas / svg 抹掉，所以只改 label 那一层。
      const text = `${RECIPE_BOOK_TAB_LABELS[tab]}（${counts.get(tab) ?? 0}）`;
      const label = button.querySelector('.recipe-tab-label');
      if (label) label.textContent = text;
      button.title = text;
      button.setAttribute('aria-label', text);
    }

    const filterText = this.onlyCraftable ? '仅显示可合成（已开启）' : '仅显示可合成';
    this.filterButton.classList.toggle('on', this.onlyCraftable);
    this.filterButton.setAttribute('aria-pressed', String(this.onlyCraftable));
    this.filterButton.title = filterText;
    this.filterButton.setAttribute('aria-label', filterText);
  }

  /**
   * 网格里的一格 = 一条配方的**产物图标**（批次 135，对齐截图）。
   *
   * 与原来那张卡片的区别：卡片自己把摆法、材料、按钮全画出来（一屏放不下几条），
   * 而基岩版是"一格一件产物、材料够的亮着不够的压暗"——点下去把材料摆进合成格，
   * 摆法在合成格里看得见。
   */
  private makeCell(entry: RecipeEntry): HTMLDivElement {
    const cell = document.createElement('div');
    cell.className = 'recipe-cell';
    // 验收脚本靠产物 id 找到"某条配方"（界面里没有别的稳定标识）
    cell.dataset.resultId = String(entry.result.id);
    cell.dataset.role = 'fill';

    const layout = recipeLayout(entry.recipe);

    const icon = document.createElement('canvas');
    icon.width = 32;
    icon.height = 32;
    drawItemIcon(icon, this.atlas, entry.result.id, 28);
    cell.appendChild(icon);

    // 数量徽章（一次出 4 个火把这种）：基岩版也是画在格子右下角
    if (entry.result.count > 1) {
      const badge = document.createElement('span');
      badge.className = 'recipe-cell-count';
      badge.textContent = String(entry.result.count);
      cell.appendChild(badge);
    }

    // 3×3 要工作台，2×2 在背包里就能摆——原版背包里的配方书同样只让摆 2×2
    const usable = entry.craftable && entry.gridSize <= 2;
    cell.classList.add(entry.craftable ? 'on' : 'locked');
    if (entry.gridSize > 2) cell.classList.add('needs-table');
    if (usable) cell.classList.add('fillable');
    else cell.classList.add('disabled');

    const summary = this.describe(entry, layout.text);
    cell.title = summary;
    cell.setAttribute('aria-label', summary);

    // 悬停/点住时把这一格说清楚（手机上没有悬停，但 pointerenter 在触屏 tap 时也会先来一次）
    cell.addEventListener('pointerenter', () => {
      this.detailEl.textContent = summary;
    });
    cell.addEventListener('pointerdown', (event) => {
      if (!usable) return;
      event.preventDefault();
      // Shift + 点 = 一次做完（不占版面的加速路径，见 `RecipeBookActions.onCraft`）
      const done = event.shiftKey
        ? this.actions.onCraft(entry.recipe)
        : this.actions.onFill(entry.recipe);
      if (done && event.shiftKey) this.render();
    });
    return cell;
  }

  /** 一格配方的说明（名字 + 数量 + 摆法 + 材料够不够） */
  private describe(entry: RecipeEntry, layoutText: string): string {
    const name = itemLabel(entry.result.id);
    const head = entry.result.count > 1 ? `${name} ×${entry.result.count}` : name;
    if (!entry.craftable) {
      const missing = entry.ingredients
        .filter((ingredient) => this.inventory.countOf(ingredient.id) < ingredient.count)
        .map((ingredient) => itemLabel(ingredient.id))
        .join('、');
      return `${head} · ${layoutText} · 材料不足${missing ? `（缺 ${missing}）` : ''}`;
    }
    if (entry.gridSize > 2) return `${head} · ${layoutText} · 需要工作台 3×3`;
    return entry.maxCraftable > 1
      ? `${head} · ${layoutText} · 可做 ${entry.maxCraftable} 次`
      : `${head} · ${layoutText}`;
  }

  /** 说明行的默认文案（没点着任何一格时） */
  private resetDetail(): void {
    this.detailEl.textContent = '点一格：材料会摆进右边的合成格';
  }

  /** 翻页条：与创造物品栏共用 `.inv-pager` 那套样式（一处样式，两处使用） */
  private renderPager(total: number, pageSize: number): void {
    const pages = pageCount(total, pageSize);
    this.pageLabel.textContent = pageLabel(this.page, total, pageSize);
    this.prevButton.disabled = this.page <= 0;
    this.nextButton.disabled = this.page >= pages - 1;
    // 只有一页时整条隐藏：搜索到 3 条配方时不该还挂着一条翻不动的按钮
    this.pagerEl.classList.toggle('hidden', pages <= 1);
  }

  private flipPage(delta: number): void {
    this.page += delta;
    this.render();
    this.gridEl.scrollTop = 0;
    this.panelEl.scrollTop = 0;
  }

  private get viewportWidth(): number {
    if (typeof window === 'undefined') return Number.POSITIVE_INFINITY;
    return window.innerWidth;
  }

  private makePagerButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inv-page-button';
    button.textContent = label;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (button.disabled) return;
      onClick();
    });
    return button;
  }

  /** 熔炼表：输入 → 产物（熔炼要时间，这里只做展示，真正的烧炼在熔炉界面里） */
  private renderSmelting(): void {
    this.smeltingEl.replaceChildren();

    const title = document.createElement('div');
    title.className = 'recipe-hint';
    // 熔炼没有摆放顺序问题，但"哪一格放什么"同样要说清楚：原料在上、燃料在下
    title.textContent = `熔炼：原料放上面的格子、燃料放下面的格子（每个约 ${SMELTING_TIME} 秒）`;
    this.smeltingEl.appendChild(title);

    const row = document.createElement('div');
    row.className = 'recipe-smelt-row';
    for (const recipe of SMELTING_RECIPES) {
      const chip = document.createElement('span');
      chip.className = 'recipe-chip';
      const from = document.createElement('canvas');
      from.width = 20;
      from.height = 20;
      drawItemIcon(from, this.atlas, recipe.input, 18);
      const arrow = document.createElement('i');
      arrow.textContent = `${itemLabel(recipe.input)} → ${itemLabel(recipe.output.id)}`;
      const to = document.createElement('canvas');
      to.width = 20;
      to.height = 20;
      drawItemIcon(to, this.atlas, recipe.output.id, 18);
      chip.append(from, arrow, to);
      row.appendChild(chip);
    }
    this.smeltingEl.appendChild(row);
  }

  /** 验收脚本用：设置搜索词并重画 */
  setQuery(query: string): void {
    this.query = query;
    this.searchEl.value = query;
    this.page = 0;
    this.render();
  }

  dispose(): void {
    this.root.remove();
  }
}
