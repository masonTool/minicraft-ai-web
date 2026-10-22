/**
 * 小游戏选择页（小游戏3，批次 20261022-1954）
 *
 * 两级视图：**游戏卡片** → **关卡网格**。与主菜单同一套视觉（深色框 + 像素边），
 * 挂在 `<body>` 上、层叠层 45（高于主菜单 40、低于设置 50）。
 *
 * 四条刻意的做法：
 *
 *  1. **不锁关**：十关随便点。低龄玩家喜欢先看第 10 关长什么样，锁了只会让人放弃。
 *  2. **进度只作标记**：通关的关卡加一个 ✓ 与绿色边，不改任何可玩性。
 *  3. **返回只有一条路**：`‹ 返回` 在关卡页回卡片页、在卡片页关面板——
 *     与主菜单"面板内只有一个出口"的约定一致。
 *  4. **关卡网格每次重建**：十来个按钮，重建比 diff 省事，也不会出现"通关了但标记没更新"。
 */

import { t, tp } from '../core/i18n/I18n.ts';
import { MINIGAME_CATALOG, type MiniGameEntry } from '../minigame/catalog.ts';
import { clearedCount, isCleared, type MiniGameProgress } from '../minigame/progress.ts';
import type { MiniGameId } from '../minigame/types.ts';
import type { TextureAtlas } from '../render/TextureAtlas.ts';
import { drawItemIcon } from './ItemIcon.ts';

/** 卡片图标尺寸（CSS 像素） */
const CARD_ICON_SIZE = 40;

export interface MiniGameMenuActions {
  readonly onStart: (gameId: MiniGameId, level: number) => void;
  readonly onClose: () => void;
}

type MenuView = 'games' | 'levels';

export class MiniGameMenu {
  readonly root: HTMLDivElement;

  private readonly gamesEl: HTMLDivElement;
  private readonly levelsEl: HTMLDivElement;
  private readonly levelGrid: HTMLDivElement;
  private readonly levelNameEl: HTMLSpanElement;
  private readonly countEls = new Map<string, HTMLSpanElement>();

  private progress: MiniGameProgress;
  private view: MenuView = 'games';
  private active: MiniGameEntry | null = null;

  constructor(
    host: HTMLElement,
    private readonly atlas: TextureAtlas,
    progress: MiniGameProgress,
    private readonly actions: MiniGameMenuActions,
  ) {
    this.progress = progress;

    this.root = document.createElement('div');
    this.root.id = 'minigame-menu';
    this.root.className = 'hidden';

    const panel = document.createElement('div');
    panel.className = 'minigame-menu-panel';

    const head = document.createElement('div');
    head.className = 'minigame-menu-head';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'minigame-back';
    back.textContent = t('minigame.menu.back');
    back.addEventListener('click', () => this.back());

    const title = document.createElement('span');
    title.className = 'minigame-menu-title';
    title.textContent = t('minigame.menu.title');

    head.append(back, title);

    // ---- 视图 1：游戏卡片
    this.gamesEl = document.createElement('div');
    this.gamesEl.className = 'minigame-games';

    for (const entry of MINIGAME_CATALOG) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'minigame-game';
      card.dataset.game = entry.id;

      const icon = document.createElement('canvas');
      icon.width = CARD_ICON_SIZE;
      icon.height = CARD_ICON_SIZE;
      icon.setAttribute('aria-hidden', 'true');
      drawItemIcon(icon, this.atlas, entry.iconBlockId, CARD_ICON_SIZE);

      const text = document.createElement('div');
      text.className = 'minigame-game-text';

      const name = document.createElement('div');
      name.className = 'minigame-game-name';
      name.textContent = t(entry.titleKey);

      const desc = document.createElement('div');
      desc.className = 'minigame-game-desc';
      desc.textContent = t(entry.descKey);

      const count = document.createElement('div');
      count.className = 'minigame-game-count';
      this.countEls.set(entry.id, count);

      text.append(name, desc, count);
      card.append(icon, text);
      card.addEventListener('click', () => this.openLevels(entry));
      this.gamesEl.appendChild(card);
    }

    // ---- 视图 2：关卡网格
    this.levelsEl = document.createElement('div');
    this.levelsEl.className = 'minigame-levels hidden';

    this.levelNameEl = document.createElement('span');
    this.levelNameEl.className = 'minigame-levels-name';

    this.levelGrid = document.createElement('div');
    this.levelGrid.className = 'minigame-level-grid';

    this.levelsEl.append(this.levelNameEl, this.levelGrid);

    panel.append(head, this.gamesEl, this.levelsEl);
    this.root.appendChild(panel);
    host.appendChild(this.root);

    this.setProgress(progress);
    this.applyView();
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  get currentView(): MenuView {
    return this.view;
  }

  /** 打开（总是从卡片页开始，避免"上次停在某个关卡页"的困惑） */
  show(): void {
    this.view = 'games';
    this.active = null;
    this.applyView();
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** 更新进度（通关后回到这里时调用） */
  setProgress(progress: MiniGameProgress): void {
    this.progress = progress;
    for (const entry of MINIGAME_CATALOG) {
      const el = this.countEls.get(entry.id);
      if (!el) continue;
      el.textContent = tp('minigame.menu.clearedCount', {
        cleared: clearedCount(progress, entry.id, entry.levelCount),
        total: entry.levelCount,
      });
    }
    if (this.active) this.renderLevels();
  }

  /**
   * 返回：关卡页 → 卡片页；卡片页 → 关闭。
   *
   * 返回 `true` 表示"还在面板里"，主程序据此决定要不要再补一条返回守卫。
   */
  back(): boolean {
    if (this.view === 'levels') {
      this.view = 'games';
      this.active = null;
      this.applyView();
      return true;
    }
    this.actions.onClose();
    return false;
  }

  dispose(): void {
    this.root.remove();
  }

  // ---------------------------------------------------------------- 内部

  private openLevels(entry: MiniGameEntry): void {
    this.active = entry;
    this.view = 'levels';
    this.renderLevels();
    this.applyView();
  }

  private renderLevels(): void {
    const entry = this.active;
    if (!entry) return;
    this.levelNameEl.textContent = t(entry.titleKey);
    this.levelGrid.replaceChildren();

    for (let level = 0; level < entry.levelCount; level++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'minigame-level';
      button.dataset.level = String(level);
      button.textContent = String(level + 1);
      if (isCleared(this.progress, entry.id, level)) button.classList.add('cleared');
      button.addEventListener('click', () => this.actions.onStart(entry.id, level));
      this.levelGrid.appendChild(button);
    }
  }

  private applyView(): void {
    this.gamesEl.classList.toggle('hidden', this.view !== 'games');
    this.levelsEl.classList.toggle('hidden', this.view !== 'levels');
  }
}
