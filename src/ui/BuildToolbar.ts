/**
 * 建造工具条（创造5，批次 20261022-1954）
 *
 * 横屏右侧的双列竖排按钮：一个"建造模式"总开关 + 八个工具。**折叠时只剩开关**，
 * 展开才占两列——生存/冒险玩家眼里它就是一个可选的小按钮，不会长期占着屏幕。
 *
 * 三条刻意的做法：
 *
 *  1. **只发回调，不碰世界**：与 `TutorialCard` 同一条分工——按钮知道"玩家点了填充"，
 *     但填充怎么做、能不能做，全在主程序（那里才有模式、地形、撤销栈）。
 *  2. **44px 是硬下限**：这是平台最小手势尺寸。双列 44 + 4 间隙 = 92px 宽，
 *     844×390 横屏下右边界 836、顶部居中排开 236px 高，不压暂停键也不压快捷栏
 *     （几何与 `tutorialLayout` 同一个思路：先算清楚，再写 CSS）。
 *  3. **禁用而不是隐藏**：撤销/重做没得撤时按钮变灰（`disabled`），
 *     玩家能看见"这个能力存在、只是现在用不了"——隐藏会让人以为没做。
 */

import type { MirrorAxis } from '../buildtools/Clipboard.ts';
import { Block } from '../core/registry/blocks.ts';
import { t } from '../core/i18n/I18n.ts';
import type { TextureAtlas } from '../render/TextureAtlas.ts';
import { drawItemIcon } from './ItemIcon.ts';

/** 图标画布的尺寸（CSS 像素） */
const ICON_SIZE = 28;

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
}

interface ButtonSpec {
  readonly kind: 'icon' | 'text';
  readonly iconId?: number;
  readonly glyph?: string;
  readonly label: string;
  readonly extra: boolean;
}

export class BuildToolbar {
  readonly root: HTMLDivElement;

  private readonly toggleBtn: HTMLButtonElement;
  private readonly selectBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly templatePanel: HTMLDivElement;
  private readonly templateBtn: HTMLButtonElement;

  private mode = false;
  private available = true;
  private templateOpen = false;

  constructor(
    host: HTMLElement,
    private readonly atlas: TextureAtlas,
    private readonly actions: BuildToolbarActions,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'build-toolbar';
    this.root.className = 'build-toolbar hidden collapsed';
    this.root.setAttribute('role', 'toolbar');

    // ---- 总开关（折叠时唯一可见的按钮）
    this.toggleBtn = this.makeButton(
      { kind: 'icon', iconId: Block.BRICKS, label: t('buildtools.toggle'), extra: false },
      () => this.setMode(!this.mode, true),
    );
    this.toggleBtn.classList.add('build-toggle');
    this.toggleBtn.setAttribute('aria-pressed', 'false');

    // ---- 八个工具（折叠时隐藏）
    this.selectBtn = this.makeButton({ kind: 'icon', iconId: Block.GLASS, label: t('buildtools.tool.select'), extra: true }, () =>
      this.actions.onSelect(),
    );

    const fillBtn = this.makeButton(
      { kind: 'icon', iconId: Block.SAND, label: t('buildtools.tool.fill'), extra: true },
      () => this.actions.onFill(),
    );
    const copyBtn = this.makeButton(
      { kind: 'icon', iconId: Block.CHEST, label: t('buildtools.tool.copy'), extra: true },
      () => this.actions.onCopy(),
    );
    const pasteBtn = this.makeButton(
      { kind: 'icon', iconId: Block.CRAFTING_TABLE, label: t('buildtools.tool.paste'), extra: true },
      () => this.actions.onPaste(null),
    );
    const mirrorBtn = this.makeButton(
      { kind: 'icon', iconId: Block.OAK_DOOR, label: t('buildtools.tool.mirror'), extra: true },
      () => this.actions.onPaste('x'),
    );
    this.undoBtn = this.makeButton(
      { kind: 'text', glyph: '↶', label: t('buildtools.tool.undo'), extra: true },
      () => this.actions.onUndo(),
    );
    this.redoBtn = this.makeButton(
      { kind: 'text', glyph: '↷', label: t('buildtools.tool.redo'), extra: true },
      () => this.actions.onRedo(),
    );
    this.templateBtn = this.makeButton(
      { kind: 'icon', iconId: Block.OAK_PLANKS, label: t('buildtools.tool.template'), extra: true },
      () => this.setTemplatePanel(!this.templateOpen),
    );
    this.templateBtn.setAttribute('aria-expanded', 'false');

    this.root.append(
      this.toggleBtn,
      this.selectBtn,
      fillBtn,
      copyBtn,
      pasteBtn,
      mirrorBtn,
      this.undoBtn,
      this.redoBtn,
      this.templateBtn,
    );

    // ---- 模板弹层（在工具条左侧展开，不额外占右侧宽度）
    this.templatePanel = document.createElement('div');
    this.templatePanel.className = 'build-templates hidden';
    for (const [id, nameKey] of [
      ['small_house', 'template.smallHouse'],
      ['small_bridge', 'template.bridge'],
      ['big_tree', 'template.tree'],
      ['stone_tower', 'template.tower'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'build-tool';
      button.dataset.template = id;
      button.setAttribute('aria-label', t(nameKey));
      button.title = t(nameKey);
      const canvas = document.createElement('canvas');
      canvas.width = ICON_SIZE;
      canvas.height = ICON_SIZE;
      button.appendChild(canvas);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.setTemplatePanel(false);
        this.actions.onTemplate(id);
      });
      this.templatePanel.appendChild(button);
    }
    // 图标延后一批画：模板面板此刻还没有尺寸，`drawItemIcon` 会按设计尺寸画
    for (const button of this.templatePanel.querySelectorAll<HTMLButtonElement>('button')) {
      const canvas = button.querySelector('canvas');
      if (!canvas) continue;
      const index = ['small_house', 'small_bridge', 'big_tree', 'stone_tower'].indexOf(button.dataset.template ?? '');
      const iconId = [Block.OAK_PLANKS, Block.OAK_LOG, Block.OAK_LEAVES, Block.COBBLESTONE][index] ?? Block.OAK_PLANKS;
      drawItemIcon(canvas, this.atlas, iconId, ICON_SIZE);
    }
    this.root.appendChild(this.templatePanel);

    host.appendChild(this.root);
    this.applyVisibility();
  }

  /** 建造模式开关（`notify=false` 用于程序内部同步状态，避免回调回环） */
  setMode(active: boolean, notify = false): void {
    this.mode = active;
    this.root.classList.toggle('collapsed', !active);
    this.toggleBtn.classList.toggle('active', active);
    this.toggleBtn.setAttribute('aria-pressed', String(active));
    if (!active) this.setTemplatePanel(false);
    if (notify) this.actions.onToggleMode(active);
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

  /** 选区是否已经点了第一个角（按钮高亮，提示"再点一个角"） */
  setSelectionArmed(armed: boolean): void {
    this.selectBtn.classList.toggle('active', armed);
  }

  get isOpen(): boolean {
    return this.mode;
  }

  get isTemplatePanelOpen(): boolean {
    return this.templateOpen;
  }

  dispose(): void {
    this.root.remove();
  }

  // ---------------------------------------------------------------- 内部

  private makeButton(spec: ButtonSpec, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'build-tool';
    if (spec.extra) button.classList.add('extra');
    button.setAttribute('aria-label', spec.label);
    button.title = spec.label;

    if (spec.kind === 'text') {
      const glyph = document.createElement('span');
      glyph.className = 'build-glyph';
      glyph.textContent = spec.glyph ?? '';
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

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private setTemplatePanel(open: boolean): void {
    this.templateOpen = open;
    this.templatePanel.classList.toggle('hidden', !open);
    this.templateBtn.classList.toggle('active', open);
    this.templateBtn.setAttribute('aria-expanded', String(open));
  }

  private applyVisibility(): void {
    this.root.classList.toggle('hidden', !this.available);
  }
}
