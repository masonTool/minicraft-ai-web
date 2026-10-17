/**
 * 配方书（界面）
 *
 * 一个覆盖式面板：列出所有配方、每条显示"产物 + 摆法 + 材料够不够"。
 *
 * ⚠️ 交互在批次 132 按原版改过（用户拿中文 Wiki「物品栏 → 配方书」当参考）：
 * **点一条配方 = 把材料摆进合成格**，摆法看得见、还能自己改，最后点输出格取成品。
 * 原来那版是"点一下直接扣料出成品"，看不见摆放过程——与 Wiki 描述不符。
 * 那颗"合成"按钮留着（原版没有它），给"这条能做 5 次"这种批量场景用。
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
import { recipeLayout, stationLabel, type RecipeLayout } from '../core/crafting/RecipeLayout.ts';
import { cardPageSizeFor, clampPage, pageCount, pageLabel, slicePage } from './ItemPager.ts';
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
  /** 合成一次；返回是否成功（材料不够时返回 false） */
  onCraft: (recipe: Recipe) => boolean;
  /**
   * 把材料**摆进合成格**（批次 132，对齐原版）；返回是否摆成功。
   *
   * ⚠️ 这是**主交互**：原版配方书点一条配方就是"把材料摆进合成格"，
   * 摆法看得见、还能自己改，最后点输出格取成品（见中文 Wiki「物品栏 → 配方书」）。
   * `onCraft` 那条一键合成留着给"批量做"用。
   */
  onFill: (recipe: Recipe) => boolean;
}

export class RecipeBook {
  readonly root: HTMLDivElement;

  private readonly listEl: HTMLDivElement;
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
  /** 「仅显示可合成」开关 */
  private readonly filterButton: HTMLButtonElement;
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

    header.append(title, this.summaryEl, this.searchEl, close);

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

    // 「仅显示可合成」：Wiki 在配方书那一节提到的筛选项，摆在标签栏那一行的右端
    this.filterButton = document.createElement('button');
    this.filterButton.type = 'button';
    this.filterButton.className = 'recipe-filter';
    this.filterButton.dataset.role = 'craftable-filter';
    this.filterButton.addEventListener('click', () => {
      this.onlyCraftable = !this.onlyCraftable;
      this.page = 0;
      this.render();
    });
    this.tabsEl.appendChild(this.filterButton);

    // ---- 配方列表
    this.listEl = document.createElement('div');
    this.listEl.className = 'recipe-list';

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

    panel.append(header, this.tabsEl, this.listEl, this.pagerEl, this.smeltingEl);
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

    // 分页（批次 29）：摆放位置让每张卡片重了不少——181 张一起画要 400ms 以上
    // （1348 个摆放小格），而搜索框每敲一个字都会重建。只画当前页就回到可忽略。
    const pageSize = cardPageSizeFor(this.viewportWidth);
    this.page = clampPage(this.page, entries.length, pageSize);
    const visible = slicePage(entries, this.page, pageSize);

    this.listEl.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recipe-empty';
      // 空列表要说清"为什么空"：是筛掉了，还是这一栏本来就没有——
      // 否则玩家只会以为配方书坏了（"仅显示可合成"默认关着，所以多半是搜索/标签栏的问题）
      empty.textContent = this.onlyCraftable
        ? '现在没有能做的配方（关掉「仅显示可合成」可以看到全部）'
        : '这一栏里没有匹配的配方';
      this.listEl.appendChild(empty);
    } else {
      for (const entry of visible) this.listEl.appendChild(this.makeCard(entry));
    }

    this.renderPager(entries.length, pageSize);
    this.renderSmelting();
  }

  /**
   * 刷新标签栏与"仅显示可合成"的状态（批次 133）。
   *
   * 每个页签上带**条数**（`建筑（57）`）：配方书有 180 多条、五个页签，
   * 不写条数就得一页一页点进去才知道哪一栏是空的。
   */
  private renderTabs(base: readonly RecipeEntry[]): void {
    const counts = new Map<RecipeBookTab, number>([['all', base.length]]);
    for (const entry of base) counts.set(entry.tab, (counts.get(entry.tab) ?? 0) + 1);

    for (const button of this.tabsEl.querySelectorAll<HTMLButtonElement>('.recipe-tab')) {
      const tab = button.dataset.tab as RecipeBookTab;
      const on = tab === this.tab;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
      // ⚠️ 只改文字那一层：图标是 canvas / svg，整个 `textContent` 覆盖会把它们抹掉
      const label = button.querySelector('.recipe-tab-label');
      if (label) label.textContent = `${RECIPE_BOOK_TAB_LABELS[tab]}（${counts.get(tab) ?? 0}）`;
    }

    this.filterButton.classList.toggle('on', this.onlyCraftable);
    this.filterButton.setAttribute('aria-pressed', String(this.onlyCraftable));
    this.filterButton.textContent = this.onlyCraftable ? '仅显示可合成 ✓' : '仅显示可合成';
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
    this.listEl.scrollTop = 0;
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

  private makeCard(entry: RecipeEntry): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    // 记下产物 id：验收脚本靠它找到"某条配方"的卡片（界面里没有别的稳定标识）
    card.dataset.resultId = String(entry.result.id);
    if (entry.craftable) card.classList.add('craftable');

    // ---- 摆放位置（批次 29）：形状配方画成真正的格子，无序配方说明"摆哪都行"
    const layout = recipeLayout(entry.recipe);
    const layoutEl = this.makeLayout(layout);

    // ---- 产物
    const result = document.createElement('div');
    result.className = 'recipe-result';
    const icon = document.createElement('canvas');
    icon.width = 32;
    icon.height = 32;
    drawItemIcon(icon, this.atlas, entry.result.id, 28);
    const name = document.createElement('span');
    name.textContent = entry.result.count > 1
      ? `${itemLabel(entry.result.id)} ×${entry.result.count}`
      : itemLabel(entry.result.id);
    result.append(icon, name);

    // ---- 材料（数量与"有/需要"）：格子已经说明摆放位置，这里只回答"够不够"
    const ingredients = document.createElement('div');
    ingredients.className = 'recipe-ingredients';
    for (const ingredient of entry.ingredients) {
      const chip = document.createElement('span');
      chip.className = 'recipe-chip';
      chip.dataset.itemId = String(ingredient.id);
      const have = this.inventory.countOf(ingredient.id);
      if (have < ingredient.count) chip.classList.add('missing');
      const chipIcon = document.createElement('canvas');
      chipIcon.width = 20;
      chipIcon.height = 20;
      drawItemIcon(chipIcon, this.atlas, ingredient.id, 18);
      const text = document.createElement('i');
      // 不够的材料直接把"有/需要"写出来，玩家不用自己去数背包
      text.textContent = `${itemLabel(ingredient.id)} ×${ingredient.count}${
        have < ingredient.count ? `（有 ${have}）` : ''
      }`;
      chip.append(chipIcon, text);
      ingredients.appendChild(chip);
    }

    // ---- 合成按钮
    const craft = document.createElement('button');
    craft.type = 'button';
    craft.className = 'recipe-craft';
    craft.textContent = entry.craftable
      ? entry.maxCraftable > 1
        ? `合成（可做 ${entry.maxCraftable} 次）`
        : '合成'
      : '材料不足';
    craft.disabled = !entry.craftable;
    craft.addEventListener('click', () => {
      if (this.actions.onCraft(entry.recipe)) {
        // 合成会改变背包，"能不能做"要重算
        this.render();
      }
    });

    const main = document.createElement('div');
    main.className = 'recipe-main';
    main.append(layoutEl, this.makeArrow(), result);

    const meta = document.createElement('div');
    meta.className = 'recipe-station';
    // "在哪摆"也要说清楚：2×2 在背包里就能做，3×3 必须站到工作台前
    meta.textContent = entry.recipe.kind === 'shapeless' ? '无序配方（摆哪一格都行）' : stationLabel(layout.station);
    main.append(ingredients, meta);

    card.append(main, craft);

    // ---- 点卡片 = **把材料摆进合成格**（批次 132，对齐原版）
    //
    // 原版（中文 Wiki「物品栏 → 配方书」）：点一条配方就把材料摆进合成格，
    // 摆法看得见、还能自己改，最后由输出格取成品。所以可点的判据是
    // "材料够 + 这条配方放得进当前的格子"——3×3 的要站到工作台前，
    // 在背包里点了也没地方摆（原版背包里的配方书同样只列 2×2 能做的）。
    if (entry.craftable && entry.gridSize <= 2) {
      card.classList.add('fillable');
      card.dataset.role = 'fill';
      card.addEventListener('pointerdown', (event) => {
        // 点在那颗"合成"按钮上时别抢它的事（它是另一条路径：一键做完）
        if ((event.target as HTMLElement).closest('.recipe-craft')) return;
        event.preventDefault();
        this.actions.onFill(entry.recipe);
      });
    }

    // 摆放说明挂在 title/aria 上：读屏与鼠标悬停都能拿到"每个格子放什么"
    card.setAttribute('aria-label', `${itemLabel(entry.result.id)}：${layout.text}`);
    card.title = layout.text;
    return card;
  }

  /**
   * 画一条配方的摆放位置。
   *
   * - **形状配方**：`grid × grid` 的格子，格子里就是该放的物品（空格也画出来——
   *   "哪一格要空着"和"哪一格要放东西"一样是配方的一部分）
   * - **无序配方**：画成一排槽位，标题已经写了"摆哪一格都行"，不画成网格
   *   （画成网格会让人以为必须按这个顺序摆）
   */
  private makeLayout(layout: RecipeLayout): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = `recipe-layout ${layout.kind}`;
    wrap.dataset.kind = layout.kind;
    wrap.dataset.grid = String(layout.grid);

    if (layout.kind === 'shapeless') {
      for (const id of layout.items) {
        wrap.appendChild(this.makeLayoutSlot(id));
      }
      return wrap;
    }

    // 形状配方：空格也占位，这样"第 2 行第 2 格"的位置一眼可见
    for (const id of layout.cells) {
      wrap.appendChild(this.makeLayoutSlot(id));
    }
    // 3×3 才需要工作台；2×2 在背包里就能摆
    wrap.classList.toggle('needs-table', layout.station === 'crafting_table');
    return wrap;
  }

  /** 摆放格里的一格（`null` = 空格）；`data-item-id` 让验收脚本能核对位置 */
  private makeLayoutSlot(id: number | null): HTMLDivElement {
    const slot = document.createElement('div');
    slot.className = 'recipe-slot';
    if (id === null) {
      slot.classList.add('empty');
      return slot;
    }
    slot.dataset.itemId = String(id);
    slot.title = itemLabel(id);
    const canvas = document.createElement('canvas');
    canvas.width = 26;
    canvas.height = 26;
    drawItemIcon(canvas, this.atlas, id, 24);
    slot.appendChild(canvas);
    if (this.inventory.countOf(id) === 0) slot.classList.add('missing');
    return slot;
  }

  /** 摆放格与产物之间的箭头 */
  private makeArrow(): HTMLSpanElement {
    const arrow = document.createElement('span');
    arrow.className = 'recipe-arrow';
    arrow.textContent = '➜';
    return arrow;
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
