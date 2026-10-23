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

import { t, tp } from '../core/i18n/I18n.ts';
import type { Inventory } from '../core/container/Inventory.ts';
import {
  recipeBookTabLabel,
  buildRecipeEntries,
  matchesRecipe,
  recipeBookTabsFor,
  type RecipeBookTab,
  type RecipeEntry,
} from '../core/crafting/RecipeBook.ts';
import { recipeLayout } from '../core/crafting/RecipeLayout.ts';
import {
  RECIPE_PANE_PAGE_SIZE,
  clampPage,
  pageCount,
  pageLabel,
  pageSizeFor,
  slicePage,
} from './ItemPager.ts';
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
  /** 当前合成区能容纳 2×2 还是 3×3；工作台打开时必须允许 3×3 配方。 */
  gridSize: () => 2 | 3;
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
  /**
   * 配方书被**自己那颗 ✕**关掉时通知主程序（批次 157）。
   *
   * 嵌在背包左栏时，光靠这里 `hide()` 不够——背包还以为左栏被占着，
   * 得让它重排一次把左栏还回"我的物品"。
   */
  onHidden?: () => void;
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
   * 配方书是不是**嵌在背包左栏里**（批次 157）。
   *
   * 以前它是"另一个窗口"：手机上点一下就整屏铺开或把背包挤到半屏，
   * 整个界面跟着跳一次。现在它默认挂在背包的左栏——栏目对齐，
   * 切的就是栏目里的内容，面板几何一动不动。
   */
  private host: HTMLElement | null = null;
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
    title.textContent = t('recipeBook.title');

    this.summaryEl = document.createElement('span');
    this.summaryEl.className = 'recipe-hint';

    this.searchEl = document.createElement('input');
    this.searchEl.type = 'text';
    this.searchEl.className = 'recipe-search';
    this.searchEl.placeholder = t('notice.recipe.searchPlaceholder');
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
    close.textContent = isTouchUi() ? '✕' : t('notice.recipe.close');
    close.setAttribute('aria-label', t('notice.recipe.closeAria'));
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

    // ---- 标签栏（批次 133，对齐基岩版；批次 136 按 UI 形态排顺序）
    //
    // Wiki「物品栏 → 配方书」写得很明确：基岩版的配方书按标签栏展示，且
    // "合成配方书的标签栏与创造分类相同"——建筑 / 装备 / 物品 / 自然 / 全部。
    // 分类归并在 `core/crafting/RecipeBook.ts` 的 `recipeBookTab()` 里（纯函数、可断言）。
    //
    // ⚠️ **顺序两种**（Wiki 逐条写了位置）：经典 UI 是"全部"在**最右侧**、
    // 携带版 UI 是"全部"在**第一个**。手机上转屏/开合窗口会换形态，所以页签
    // 的先后不写死在 DOM 里——`renderTabs` 每次按当前宽度重排 CSS `order`。
    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'recipe-tabs';

    for (const tab of recipeBookTabsFor()) {
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
    this.prevButton = this.makePagerButton(t('notice.recipe.prev'), () => this.flipPage(-1));
    this.nextButton = this.makePagerButton(t('notice.recipe.next'), () => this.flipPage(1));
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

  /**
   * 把配方书**挂进背包左栏**（批次 157）。
   *
   * 传元素 = 嵌进去（整屏那一层保持隐藏，只有面板挪过去）；传 `null` = 还回
   * 整屏那一层。目的是让"打开配方书"不再重排背包——点左侧分类图标时栏目不动，
   * 只有左栏里的内容换了一份。
   */
  attach(host: HTMLElement | null): void {
    if (this.host === host) return;
    this.host = host;
    if (host) {
      host.appendChild(this.panelEl);
      // 整屏那一层空了就收起来：它铺满屏幕，留着会吃掉背包上的点击
      this.root.classList.add('hidden');
    } else {
      this.root.appendChild(this.panelEl);
      this.root.classList.toggle('hidden', !this.open);
    }
    this.panelEl.classList.toggle('embedded', host !== null);
  }

  /** 是不是嵌在背包左栏里（嵌入时不画熔炼表，见 `render`） */
  get isEmbedded(): boolean {
    return this.host !== null;
  }

  /** 当前停在哪一栏（左轨那排分类图标要靠它点亮当前分类） */
  get currentTab(): RecipeBookTab {
    return this.tab;
  }

  /** 「只显示我拥有的」开着吗（材料不足的配方会被筛掉，见 `render`） */
  get onlyOwned(): boolean {
    return this.onlyCraftable;
  }

  /**
   * 从外面切「只显示我拥有的」（批次 159：背包标题栏那颗配方开关）。
   *
   * 开着 = 本分类下**不拥有的**（材料不足）配方整条不出现；
   * 关着 = 全部列出，不拥有的用红底标出来（`.recipe-cell.locked`）。
   */
  setOnlyOwned(on: boolean): void {
    if (this.onlyCraftable === on) return;
    this.onlyCraftable = on;
    this.page = 0;
    this.render();
  }

  /** 每页几条：嵌在左栏时按左栏的列数，否则按视口（与 CSS 的列数一一对应） */
  private panePageSize(): number {
    return this.isEmbedded ? RECIPE_PANE_PAGE_SIZE : pageSizeFor(this.viewportWidth);
  }

  /** 触摸端整表滚动、PC 底部翻页（批次 159） */
  private get useScroll(): boolean {
    return isTouchUi();
  }

  /**
   * @param tab 打开时切到这一栏（携带版物品栏左上角的分类图标会传进来，批次 140）
   */
  show(tab?: RecipeBookTab): void {
    if (tab) this.tab = tab;
    this.open = true;
    // 嵌在背包左栏里时，整屏那一层不该露出来——露出来就是"又一个窗口盖上来"
    if (!this.host) this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    const wasOpen = this.open;
    this.open = false;
    this.root.classList.add('hidden');
    if (wasOpen) this.actions.onHidden?.();
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
    // 携带版用左侧外置分类轨；CSS 需要知道当前是不是“搜索/全部”页：
    // 只有该页显示搜索框，其余分类像原版一样直接从物品格开始。
    this.panelEl.dataset.tab = this.tab;

    this.renderTabs(base);
    const craftable = entries.filter((entry) => entry.craftable).length;
    this.summaryEl.textContent = tp('notice.recipe.summary', { total: entries.length, craftable });

    // 分页（批次 29）：181 条配方一次全建进 DOM 要 400ms 以上，而搜索框每敲一个字
    // 都会重建。只画当前页就回到可忽略。页大小跟着 CSS 的列数走（宽屏 12 列 × 5 行、
    // 窄屏 8 列 × 4 行），否则最后一行会出现"半行空位"看着像 bug。
    // 嵌在背包左栏时按左栏的列数分页（12/8 列在半栏宽里会被横向裁掉）
    //
    // 批次 159：**触摸端改成整表滚动**——手指滑一格是本能，"上一页/下一页"两颗小按钮
    // 在手机上既难点也反直觉；PC 才用底部那对翻页键。做法是把页大小开成整表长度，
    // `slicePage` 自然返回全部、`pageCount` 变 1 → 翻页条自己隐藏。
    const pageSize = this.useScroll ? entries.length : this.panePageSize();
    this.page = clampPage(this.page, entries.length, pageSize);
    const visible = slicePage(entries, this.page, pageSize);

    this.gridEl.replaceChildren();
    this.resetDetail();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recipe-empty';
      // 空列表要说清"为什么空"：是筛掉了，还是这一栏本来就没有——
      // 否则玩家只会以为配方书坏了（"仅显示可合成"默认关着，所以多半是搜索/标签栏的问题）
      empty.textContent = this.onlyCraftable ? t('notice.recipe.emptyCraftable') : t('notice.recipe.emptyFiltered');
      this.gridEl.appendChild(empty);
    } else {
      for (const entry of visible) this.gridEl.appendChild(this.makeCell(entry));
    }

    this.renderPager(entries.length, pageSize);
    // 嵌在背包左栏时只放合成配方网格；熔炼表属于熔炉界面。
    // 这里若仍创建整张熔炼表，不仅内容混杂，还会把可操作的配方网格压到几乎没有高度。
    if (this.isEmbedded) {
      this.smeltingEl.replaceChildren();
      this.smeltingEl.classList.add('hidden');
    } else {
      this.smeltingEl.classList.remove('hidden');
      this.renderSmelting();
    }
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
    // 页签的先后只有一套（携带版："全部"在最前），不再随视口宽度变
    const order = recipeBookTabsFor();

    for (const button of this.tabsEl.querySelectorAll<HTMLButtonElement>('.recipe-tab')) {
      const tab = button.dataset.tab as RecipeBookTab;
      const on = tab === this.tab;
      button.style.order = String(order.indexOf(tab));
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
      // ⚠️ 条数只写进 title / aria 与那个不可见的 label：页面上仍是"纯图标方块"。
      // 整块 `textContent` 覆盖会把 canvas / svg 抹掉，所以只改 label 那一层。
      const text = `${recipeBookTabLabel(tab)}（${counts.get(tab) ?? 0}）`;
      const label = button.querySelector('.recipe-tab-label');
      if (label) label.textContent = text;
      button.title = text;
      button.setAttribute('aria-label', text);
    }

    const filterText = this.onlyCraftable ? t('notice.recipe.filterOn') : t('notice.recipe.filterOff');
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

    // 普通背包只允许 2×2；站在工作台前时允许 3×3。
    // 之前这里写死 <=2，导致工作台虽然画了 3×3 格，左侧所有 3×3 配方仍然点不动。
    const usable = entry.craftable && entry.gridSize <= this.actions.gridSize();
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
        .join(t('item.desc.tpl.listSep'));
      return missing
        ? tp('notice.recipe.lineMissing', { head, layout: layoutText, missing })
        : tp('notice.recipe.lineMissingNoList', { head, layout: layoutText });
    }
    // “需要工作台”只在当前确实还是 2×2 时提示；进入工作台后同一条 3×3
    // 配方已经可填格，应像普通可合成配方一样显示可制作次数。
    if (entry.gridSize > this.actions.gridSize()) {
      return tp('notice.recipe.lineNeedTable', { head, layout: layoutText });
    }
    return entry.maxCraftable > 1
      ? tp('notice.recipe.lineCraftable', { head, layout: layoutText, times: entry.maxCraftable })
      : tp('notice.recipe.line', { head, layout: layoutText });
  }

  /** 说明行的默认文案（没点着任何一格时） */
  private resetDetail(): void {
    this.detailEl.textContent = t('recipeBook.detail');
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
    title.textContent = tp('notice.recipe.smeltingHint', { seconds: SMELTING_TIME });
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
