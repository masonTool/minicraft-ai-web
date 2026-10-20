/**
 * 成就 / 进度面板（界面，M7 批次 87）
 *
 * 数据与判定都在 `core/progress/`（纯逻辑，可离线断言），这里只管画：
 * 一个覆盖式面板 + 分类页签 + 一棵缩进的列表。
 *
 * 三个界面口径：
 *  1. **未解锁的条目只显示"???"**，但**它的位置与存在本身要看得见**——
 *     玩家得知道"这里还有东西可拿"。原版 Java 把未解锁的条目画成一个灰框
 *     （连名字都没有），本项目的说明文字里写着"怎么拿到"，所以这里把说明留着、
 *     只把标题藏起来：既给目标，又不剧透。
 *  2. **分类按原版标签页分组**（我的世界 / 下界 / 末地 / 冒险 / 农牧），
 *     页签上直接写"3 / 12"，省得玩家点进去才发现这一支没做几件。
 *  3. **一次画完 26 行**（不像配方书那样要分页）：26 个小 canvas 在手机上没问题；
 *     这条是有断言的——`renderedRows` 会被验收脚本读走（"DOM 里有多少行"最好使）。
 */

import { t } from '../core/i18n/I18n.ts';
import type { TextureAtlas } from '../render/TextureAtlas.ts';
import {
  ADVANCEMENTS,
  ADVANCEMENT_TABS,
  advancementById,
  type AdvancementDef,
  type AdvancementTab,
} from '../core/progress/advancements.ts';
import type { AdvancementState, AdvancementTracker } from '../core/progress/AdvancementTracker.ts';
import { drawItemIcon } from './ItemIcon.ts';
import { isTouchUi } from './TouchControls.ts';

/** 页签：`null` 表示"全部" */
type TabFilter = AdvancementTab | null;

const ICON_SIZE = 30;

export class AdvancementScreen {
  readonly root: HTMLDivElement;

  private readonly listEl: HTMLDivElement;
  private readonly summaryEl: HTMLSpanElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly panelEl: HTMLDivElement;
  private open = false;
  private filter: TabFilter = null;
  /** 上一次画出来的行数（验收脚本用：DOM 里到底有多少行） */
  private renderedRows = 0;

  constructor(
    host: HTMLElement,
    private readonly atlas: TextureAtlas,
    private readonly tracker: AdvancementTracker,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'advancements';
    this.root.classList.add('hidden');

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'adv-panel';

    // ---- 标题栏
    const header = document.createElement('div');
    header.className = 'adv-header';

    const title = document.createElement('b');
    title.textContent = t('advancement.title');

    this.summaryEl = document.createElement('span');
    this.summaryEl.className = 'adv-summary';

    const close = document.createElement('button');
    close.type = 'button';
    // 批次 528：与背包的关闭键同一套外观/尺寸（.inv-close 提供基础样式）
    close.className = 'adv-close inv-close';
    // 手机上统一成 ✕（与配方书、设置面板同一个形状：右上一个叉关掉，
    // 基岩版也是这么给的），PC 上保留"关闭"两个字（有 Esc 也用得着点）
    close.textContent = isTouchUi() ? '✕' : '关闭';
    close.setAttribute('aria-label', '关闭成就');
    close.addEventListener('click', () => this.hide());

    header.append(title, this.summaryEl, close);

    // ---- 分类页签
    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'adv-tabs';

    // ---- 列表
    this.listEl = document.createElement('div');
    this.listEl.className = 'adv-list';

    this.panelEl.append(header, this.tabsEl, this.listEl);
    this.root.append(this.panelEl);
    host.appendChild(this.root);

    // ⚠️ 批次 111 删掉了"点面板外关闭"（用户要求"不要点击空白关闭，就用关闭按钮"）：
    // 这里的出口是标题栏右上角的 ✕（`.adv-close`），手机上热区已经放到 48×44。
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 面板里当前的行数（验收脚本用） */
  get renderedRowCount(): number {
    return this.renderedRows;
  }

  /**
   * 打开面板。
   *
   * @param anchor 传入时（从背包里点成就），面板会**精确复制**锚点当前的位置与尺寸，
   *   于是与背包面板完全重叠——携带版背包的宽度会随单/双栏、创造/生存变化，
   *   另写一套 CSS 尺寸必然对不齐。
   */
  show(anchor?: HTMLElement): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.alignTo(anchor);
    this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
    this.clearAlignment();
  }

  /**
   * 与背包面板对齐（批次 528）。
   *
   * 只在这个面板的生命周期内写行内样式；`hide()` 会清掉，
   * 否则下一次从暂停菜单打开会沿用上一次背包的尺寸。
   */
  private alignTo(anchor?: HTMLElement): void {
    this.clearAlignment();
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const style = this.panelEl.style;
    style.position = 'fixed';
    style.left = `${Math.round(rect.left)}px`;
    style.top = `${Math.round(rect.top)}px`;
    style.width = `${Math.round(rect.width)}px`;
    style.height = `${Math.round(rect.height)}px`;
    style.maxWidth = 'none';
    style.maxHeight = 'none';
    this.root.classList.add('aligned');
  }

  private clearAlignment(): void {
    const style = this.panelEl.style;
    style.position = '';
    style.left = '';
    style.top = '';
    style.width = '';
    style.height = '';
    style.maxWidth = '';
    style.maxHeight = '';
    this.root.classList.remove('aligned');
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  /** 重新画（解锁了新条目的瞬间、或换页签时调） */
  refresh(): void {
    if (this.open) this.render();
  }

  private render(): void {
    this.renderTabs();
    this.renderList();
    this.summaryEl.textContent = `已达成 ${this.tracker.earnedCount} / ${this.tracker.totalCount}`;
  }

  private renderTabs(): void {
    this.tabsEl.textContent = '';
    const entries: ReadonlyArray<{ filter: TabFilter; label: string }> = [
      { filter: null, label: '全部' },
      ...ADVANCEMENT_TABS.map((tab) => ({ filter: tab.id as TabFilter, label: tab.title })),
    ];
    for (const entry of entries) {
      const defs = this.defsOf(entry.filter);
      const earned = defs.filter((def) => this.tracker.isEarned(def.id)).length;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'adv-tab';
      button.textContent = `${entry.label} ${earned}/${defs.length}`;
      if (entry.filter === this.filter) button.classList.add('active');
      button.dataset.tab = entry.filter ?? 'all';
      button.addEventListener('click', () => {
        this.filter = entry.filter;
        this.render();
      });
      this.tabsEl.appendChild(button);
    }
  }

  private renderList(): void {
    this.listEl.textContent = '';
    const defs = this.defsOf(this.filter);
    let rows = 0;
    for (const def of defs) {
      this.listEl.appendChild(this.makeRow(def));
      rows++;
    }
    if (rows === 0) {
      const empty = document.createElement('div');
      empty.className = 'adv-empty';
      empty.textContent = t('advancement.empty');
      this.listEl.appendChild(empty);
    }
    this.renderedRows = rows;
  }

  /** 某一支的条目（"全部"按表顺序；其余按该支顺序，父在前） */
  private defsOf(filter: TabFilter): AdvancementDef[] {
    return filter === null ? [...ADVANCEMENTS] : ADVANCEMENTS.filter((def) => def.tab === filter);
  }

  /**
   * 一行。
   *
   * 缩进按"这一条在树里有多深"：父条目在列表里就在上面，缩进让父子关系一眼可见
   * （原版是横着的树，手机上横着放不下，所以改成竖着缩进）。
   */
  private makeRow(def: AdvancementDef): HTMLDivElement {
    const state = this.tracker.stateOf(def.id);
    const row = document.createElement('div');
    row.className = 'adv-row';
    row.dataset.state = state;
    row.dataset.id = def.id;
    row.style.paddingLeft = `${8 + this.depthOf(def) * 16}px`;

    const icon = document.createElement('canvas');
    icon.className = 'adv-icon';
    icon.width = ICON_SIZE;
    icon.height = ICON_SIZE;
    drawItemIcon(icon, this.atlas, def.icon, ICON_SIZE);
    // 未解锁的图标压暗（原版也是"灰框"）——CSS 里按 `[data-state]` 处理
    row.appendChild(icon);

    const main = document.createElement('div');
    main.className = 'adv-main';

    const title = document.createElement('div');
    title.className = 'adv-title';
    // 未解锁的不剧透：标题藏起来，说明留着（说明写的是"怎么做"，那不是秘密）
    title.textContent = state === 'locked' ? '???' : def.title;

    const desc = document.createElement('div');
    desc.className = 'adv-desc';
    desc.textContent = state === 'locked' ? '达成前面的条目才会看到它' : def.desc;

    main.append(title, desc);
    row.appendChild(main);

    const badge = document.createElement('span');
    badge.className = 'adv-badge';
    badge.textContent = this.badgeOf(def, state);
    row.appendChild(badge);
    return row;
  }

  private badgeOf(def: AdvancementDef, state: AdvancementState): string {
    if (state === 'earned') return def.challenge ? '挑战完成' : '已达成';
    if (state === 'locked') return '未解锁';
    // 计数型：把"打了一半"的进度露出来（原版也是这样）
    const { seen, need } = this.tracker.countFor(def.id);
    if (need > 1) return `${seen} / ${need}`;
    return def.challenge ? '挑战' : '可达成';
  }

  /** 拆面板（`main.dispose` 调；与配方书同一条：把 DOM 摘干净） */
  dispose(): void {
    this.root.remove();
  }

  /** 缩进深度（根是 0）；父不在表里（脏数据）就当根 */
  private depthOf(def: AdvancementDef): number {
    let depth = 0;
    let parent = def.parent;
    // 树最多几层，这里加个保险防止脏数据绕成环
    while (parent && depth < 16) {
      depth++;
      parent = advancementById(parent)?.parent ?? null;
    }
    return depth;
  }
}
