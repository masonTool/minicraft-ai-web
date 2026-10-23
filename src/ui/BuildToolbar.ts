/**
 * 建造工具（创造5，批次 20261022-1954；抽屉形态，批次 20261024-0344）
 *
 * 形态：**一颗总开关 + 一块居中抽屉**。
 *
 *  1. **折叠态**只有 44×56 的总开关（26px 砖块图标 + 9px 两字标签），贴右缘、垂直居中。
 *     上一版是"双列竖排 92×236"，844×390 下展开就压住跳跃键（重叠 32×76），
 *     而且工具条 `z-index: 9` 会**抢走**跳跃键的点击（`#hud` 没有 z-index）——
 *     玩家按跳没反应，不是"挡住视线"这么轻。
 *  2. **展开态**是模态抽屉：遮罩吃掉一切点击（包括世界观交互），点遮罩即关；
 *     8 个工具排 4 列 × 2 行，每格 = 图标 26 + 两字标签 + 一句短语。
 *     「模板」在面板内翻第二页，不再往左侧弹一列小按钮。
 *  3. **几何只在 `buildToolbarLayout.ts` 里算一份**：宽高/边距/格宽由它算好，
 *     这边写成 CSS 变量交给样式表排版，JS 不再与 CSS 各写一套数字。
 *
 * 三条刻意的分工（与上一版一致）：
 *
 *  · **只发回调、不碰世界**：按钮知道"玩家点了填充"，能不能填充全在主程序
 *    （那里才有模式、地形、撤销栈）。
 *  · **禁用而不是隐藏**：撤销/重做没得撤时变灰，玩家能看见"这个能力存在、只是现在用不了"。
 *  · **收起面板 ≠ 退建造模式**：选完一个工具就收面板是常态，收面板时退模式会让
 *    "点选区 → 收面板 → 点方块"变成"挖方块"。
 */

import type { MirrorAxis } from '../buildtools/Clipboard.ts';
import { Block } from '../core/registry/blocks.ts';
import { t } from '../core/i18n/I18n.ts';
import type { TextureAtlas } from '../render/TextureAtlas.ts';
import { drawItemIcon } from './ItemIcon.ts';
import {
  buildCellSize,
  buildDrawerBox,
  buildDrawerMetrics,
  drawerFits,
} from './buildToolbarLayout.ts';

/** 格子里的图标（CSS 像素）：26 是"26 + 10px 标签 + 9px 短语"塞进 68 高之后的结果 */
const ICON_SIZE = 26;

export interface BuildToolbarActions {
  /** 建造模式开关（激活后左键改为选区，不再破坏） */
  readonly onToggleMode: (active: boolean) => void;
  /** 进入选区：清掉上一个角，等玩家点第一个角 */
  readonly onSelect: () => void;
  /** 用手上的方块填充当前选区 */
  readonly onFill: () => void;
  readonly onCopy: () => void;
  readonly onPaste: (mirror: MirrorAxis | null) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onTemplate: (templateId: string) => void;
  /**
   * 玩家点了「结束建造」：关模式 + 清选区（面板这边自己收）。
   *
   * 与 `onToggleMode(false)` 分开是因为语义不同：程序关模式（切到非创造、切维度）
   * 不该被当成"玩家主动收工"，那边要留选区、也不弹提示。
   */
  readonly onEndBuild: () => void;
}

interface CellSpec {
  /** 图标（方块 id）；给了 `glyph` 就忽略它 */
  readonly iconId?: number;
  readonly glyph?: string;
  /** 完整名称：只进 `aria-label` / `title`，给读屏与桌面悬停用 */
  readonly nameKey: string;
  /** 格子里的两字标签 */
  readonly shortKey: string;
  /** 格子里的那一句短语（触摸屏上唯一看得见的用法说明） */
  readonly hintKey: string;
}

/** 四张内置模板（顺序与 `buildtools/templates.ts` 的展示顺序一致） */
const TEMPLATE_CARDS: ReadonlyArray<{ readonly id: string; readonly nameKey: string; readonly iconId: number }> = [
  { id: 'small_house', nameKey: 'template.smallHouse', iconId: Block.OAK_PLANKS },
  { id: 'small_bridge', nameKey: 'template.bridge', iconId: Block.OAK_LOG },
  { id: 'big_tree', nameKey: 'template.tree', iconId: Block.OAK_LEAVES },
  { id: 'stone_tower', nameKey: 'template.tower', iconId: Block.COBBLESTONE },
];

type DrawerPage = 'tools' | 'templates';

export class BuildToolbar {
  readonly root: HTMLDivElement;

  private readonly toggleBtn: HTMLButtonElement;
  private readonly backdrop: HTMLDivElement;
  private readonly drawer: HTMLDivElement;
  private readonly drawerBody: HTMLDivElement;
  private readonly drawerTitle: HTMLSpanElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly toolsPage: HTMLDivElement;
  private readonly templatesPage: HTMLDivElement;
  private readonly selectBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;

  private mode = false;
  private available = true;
  private panelOpen = false;

  constructor(
    host: HTMLElement,
    private readonly atlas: TextureAtlas,
    private readonly actions: BuildToolbarActions,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'build-toolbar';
    this.root.className = 'build-toolbar hidden';

    // ---- 总开关（折叠态唯一可见的东西）
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.type = 'button';
    this.toggleBtn.className = 'build-toggle';
    this.toggleBtn.setAttribute('aria-label', t('buildtools.toggle'));
    this.toggleBtn.setAttribute('aria-haspopup', 'dialog');
    this.toggleBtn.setAttribute('aria-expanded', 'false');
    const toggleCanvas = document.createElement('canvas');
    toggleCanvas.width = 28;
    toggleCanvas.height = 28;
    toggleCanvas.setAttribute('aria-hidden', 'true');
    drawItemIcon(toggleCanvas, this.atlas, Block.BRICKS, 28);
    const toggleLabel = document.createElement('span');
    toggleLabel.className = 'build-toggle-label';
    toggleLabel.setAttribute('aria-hidden', 'true');
    toggleLabel.textContent = t('buildtools.toggle.short');
    this.toggleBtn.append(toggleCanvas, toggleLabel);
    this.toggleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.panelOpen) this.closePanel();
      else this.openPanel();
    });

    // ---- 遮罩：吃掉全部点击（点一下即关）
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'build-backdrop hidden';
    this.backdrop.addEventListener('click', (event) => {
      event.stopPropagation();
      this.closePanel();
    });

    // ---- 抽屉
    this.drawer = document.createElement('div');
    this.drawer.className = 'build-drawer hidden';
    this.drawer.setAttribute('role', 'dialog');
    this.drawer.setAttribute('aria-modal', 'true');
    this.drawer.setAttribute('aria-label', t('buildtools.panel.title'));

    const head = document.createElement('div');
    head.className = 'build-drawer-head';

    this.backBtn = document.createElement('button');
    this.backBtn.type = 'button';
    this.backBtn.className = 'build-drawer-back hidden';
    this.backBtn.textContent = `← ${t('editor.back')}`;
    this.backBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setPage('tools');
    });

    this.drawerTitle = document.createElement('span');
    this.drawerTitle.className = 'build-drawer-title';
    this.drawerTitle.textContent = t('buildtools.panel.title');

    const endBtn = document.createElement('button');
    endBtn.type = 'button';
    endBtn.className = 'build-drawer-end';
    endBtn.textContent = t('buildtools.panel.endBuild');
    endBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.endBuild();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'build-drawer-close';
    closeBtn.setAttribute('aria-label', t('editor.close'));
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.closePanel();
    });

    head.append(this.backBtn, this.drawerTitle, endBtn, closeBtn);

    // ---- 第一页：8 个工具
    this.toolsPage = document.createElement('div');
    this.toolsPage.className = 'build-page build-page-tools';

    this.selectBtn = this.makeCell(
      { iconId: Block.GLASS, nameKey: 'buildtools.tool.select', shortKey: 'buildtools.tool.select.short', hintKey: 'buildtools.tool.select.hint' },
      () => this.actions.onSelect(),
    );
    const fillBtn = this.makeCell(
      { iconId: Block.SAND, nameKey: 'buildtools.tool.fill', shortKey: 'buildtools.tool.fill.short', hintKey: 'buildtools.tool.fill.hint' },
      () => this.actions.onFill(),
    );
    const copyBtn = this.makeCell(
      { iconId: Block.CHEST, nameKey: 'buildtools.tool.copy', shortKey: 'buildtools.tool.copy.short', hintKey: 'buildtools.tool.copy.hint' },
      () => this.actions.onCopy(),
    );
    const pasteBtn = this.makeCell(
      { iconId: Block.CRAFTING_TABLE, nameKey: 'buildtools.tool.paste', shortKey: 'buildtools.tool.paste.short', hintKey: 'buildtools.tool.paste.hint' },
      () => this.actions.onPaste(null),
    );
    const mirrorBtn = this.makeCell(
      { iconId: Block.OAK_DOOR, nameKey: 'buildtools.tool.mirror', shortKey: 'buildtools.tool.mirror.short', hintKey: 'buildtools.tool.mirror.hint' },
      () => this.actions.onPaste('x'),
    );
    // 撤销/重做是"动作"，连按两次很常见 → 面板不收起；其余是"选一个工具"，选完就收
    this.undoBtn = this.makeCell(
      { glyph: '↶', nameKey: 'buildtools.tool.undo', shortKey: 'buildtools.tool.undo.short', hintKey: 'buildtools.tool.undo.hint' },
      () => this.actions.onUndo(),
      true,
    );
    this.redoBtn = this.makeCell(
      { glyph: '↷', nameKey: 'buildtools.tool.redo', shortKey: 'buildtools.tool.redo.short', hintKey: 'buildtools.tool.redo.hint' },
      () => this.actions.onRedo(),
      true,
    );
    const templateBtn = this.makeCell(
      { iconId: Block.OAK_PLANKS, nameKey: 'buildtools.tool.template', shortKey: 'buildtools.tool.template.short', hintKey: 'buildtools.tool.template.hint' },
      () => this.setPage('templates'),
      true,
    );
    this.toolsPage.append(
      this.selectBtn,
      fillBtn,
      copyBtn,
      pasteBtn,
      mirrorBtn,
      this.undoBtn,
      this.redoBtn,
      templateBtn,
    );

    // ---- 第二页：四张模板卡（占位由 `setPage` 控制显隐）
    this.templatesPage = document.createElement('div');
    this.templatesPage.className = 'build-page build-page-templates hidden';
    for (const card of TEMPLATE_CARDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'build-cell';
      button.dataset.template = card.id;
      button.setAttribute('aria-label', t(card.nameKey));
      const canvas = document.createElement('canvas');
      canvas.width = ICON_SIZE;
      canvas.height = ICON_SIZE;
      canvas.setAttribute('aria-hidden', 'true');
      drawItemIcon(canvas, this.atlas, card.iconId, ICON_SIZE);
      const label = document.createElement('span');
      label.className = 'build-cell-label';
      label.setAttribute('aria-hidden', 'true');
      label.textContent = t(card.nameKey);
      button.append(canvas, label);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.closePanel();
        this.actions.onTemplate(card.id);
      });
      this.templatesPage.appendChild(button);
    }

    this.drawerBody = document.createElement('div');
    this.drawerBody.className = 'build-drawer-body';
    this.drawerBody.append(this.toolsPage, this.templatesPage);

    this.drawer.append(head, this.drawerBody);
    this.root.append(this.toggleBtn, this.backdrop, this.drawer);
    host.appendChild(this.root);

    this.applyVisibility();
    this.applyPanel();
  }

  // ---------------------------------------------------------------- 对外接口

  /** 建造模式开关（`notify=false` 用于程序内部同步状态，避免回调回环） */
  setMode(active: boolean, notify = false): void {
    const changed = this.mode !== active;
    this.mode = active;
    this.toggleBtn.classList.toggle('active', active);
    this.toggleBtn.setAttribute('aria-pressed', String(active));
    // 退模式必然收面板：面板开着而模式关着，左键就回到"挖方块"了
    if (!active) this.closePanel();
    if (notify && changed) this.actions.onToggleMode(active);
  }

  /** 是否可见：非创造模式下整个收起（生存/冒险用不上这些工具） */
  setAvailable(available: boolean): void {
    if (this.available === available) return;
    this.available = available;
    this.applyVisibility();
  }

  /** 撤销/重做能不能按（没得撤时变灰） */
  setUndoState(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  /** 选区是否已经点了第一个角（格子高亮，提示"再点一个角"） */
  setSelectionArmed(armed: boolean): void {
    this.selectBtn.classList.toggle('active', armed);
  }

  /** 建造模式是否开着（左键是否被改成"点选区角"） */
  get isOpen(): boolean {
    return this.mode;
  }

  /** 抽屉是否展开 */
  get isPanelOpen(): boolean {
    return this.panelOpen;
  }

  /** 打开抽屉：顺带把建造模式打开（否则"点选区 → 收面板 → 点方块"会变成挖方块） */
  openPanel(): void {
    if (!this.available) return;
    this.panelOpen = true;
    if (!this.mode) this.setMode(true, true);
    this.setPage('tools');
    this.applyPanel();
  }

  /** 收起抽屉：**不退**建造模式（选完工具收面板是常态） */
  closePanel(): void {
    if (!this.panelOpen) return;
    this.panelOpen = false;
    this.setPage('tools');
    this.applyPanel();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }

  // ---------------------------------------------------------------- 内部

  private readonly onResize = (): void => {
    if (this.panelOpen) this.applyLayout();
  };

  /**
   * 造一个格子。
   *
   * `keepOpen` 为 false 时，点完自动收起面板——用户选的方案原文就是"选完自动收起"，
   * 而且"点选区 → 面板还挡着屏幕"根本没法点第二个角。
   */
  private makeCell(spec: CellSpec, onClick: () => void, keepOpen = false): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'build-cell';
    const name = t(spec.nameKey);
    // 完整名称留给读屏与桌面悬停；触摸屏上看得见的是下面那两行
    button.setAttribute('aria-label', name);
    button.title = name;

    if (spec.glyph) {
      const glyph = document.createElement('span');
      glyph.className = 'build-cell-glyph';
      glyph.textContent = spec.glyph;
      glyph.setAttribute('aria-hidden', 'true');
      button.appendChild(glyph);
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = ICON_SIZE;
      canvas.height = ICON_SIZE;
      canvas.setAttribute('aria-hidden', 'true');
      drawItemIcon(canvas, this.atlas, spec.iconId ?? Block.STONE, ICON_SIZE);
      button.appendChild(canvas);
    }

    const label = document.createElement('span');
    label.className = 'build-cell-label';
    label.setAttribute('aria-hidden', 'true');
    label.textContent = t(spec.shortKey);

    const hint = document.createElement('span');
    hint.className = 'build-cell-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = t(spec.hintKey);

    button.append(label, hint);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
      if (!keepOpen) this.closePanel();
    });
    return button;
  }

  /** 「结束建造」：一个动作里把三件事做完（关模式 / 清选区交给主程序 / 收面板） */
  private endBuild(): void {
    this.closePanel();
    if (this.mode) this.setMode(false);
    this.actions.onEndBuild();
  }

  private setPage(page: DrawerPage): void {
    this.toolsPage.classList.toggle('hidden', page !== 'tools');
    this.templatesPage.classList.toggle('hidden', page !== 'templates');
    this.backBtn.classList.toggle('hidden', page === 'tools');
    this.drawerTitle.classList.toggle('hidden', page !== 'tools');
  }

  private applyPanel(): void {
    this.backdrop.classList.toggle('hidden', !this.panelOpen);
    this.drawer.classList.toggle('hidden', !this.panelOpen);
    this.toggleBtn.setAttribute('aria-expanded', String(this.panelOpen));
    window.removeEventListener('resize', this.onResize);
    if (this.panelOpen) {
      this.applyLayout();
      window.addEventListener('resize', this.onResize);
    }
  }

  /**
   * 把几何写成 CSS 变量 + 抽屉坐标。
   *
   * 只在这一处算尺寸：`buildDrawerBox()` 给盒子，`buildCellSize()` 给格子，
   * `buildDrawerMetrics()` 给内边距/头部/间隙；样式表只负责"长什么样"。
   */
  private applyLayout(): void {
    const scale = this.readTouchScale();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const box = buildDrawerBox(width, height, scale);
    const cell = buildCellSize(width, height, scale);
    const metrics = buildDrawerMetrics(scale);

    this.drawer.style.left = `${box.left}px`;
    this.drawer.style.top = `${box.top}px`;
    this.drawer.style.width = `${box.width}px`;
    this.drawer.style.height = `${box.height}px`;
    this.drawer.style.setProperty('--build-pad', `${metrics.padding}px`);
    this.drawer.style.setProperty('--build-head', `${metrics.header}px`);
    this.drawer.style.setProperty('--build-gap', `${metrics.gap}px`);
    this.drawer.style.setProperty('--build-cell-w', `${cell.width}px`);
    this.drawer.style.setProperty('--build-cell-h', `${cell.height}px`);
    // 装不下就让网格内部滚动（抽屉形态没有"退回折叠"这条退路）
    this.drawerBody.classList.toggle('scroll', !drawerFits(width, height, scale));
  }

  /** 读设置里的触摸缩放（主程序写在 `:root` 的 `--touch-scale` 上） */
  private readTouchScale(): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--touch-scale');
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  private applyVisibility(): void {
    this.root.classList.toggle('hidden', !this.available);
    if (!this.available) this.setMode(false);
  }
}
