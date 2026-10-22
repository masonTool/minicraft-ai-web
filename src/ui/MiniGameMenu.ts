/**
 * 小游戏选择页（小游戏3，批次 20261022-1954；J0 收成一层，批次 20261022-2220）
 *
 * 只有**一层**：游戏卡片列表，点卡片直接开局。与主菜单同一套视觉（深色框 + 像素边），
 * 挂在 `<body>` 上、层叠层 45（高于主菜单 40、低于设置 50）。
 *
 * 四条刻意的做法：
 *
 *  1. **没有关卡页**：跳一跳是无尽模式，卡片点下去就是新的一局。
 *  2. **最高分只作标记**：不锁任何内容、不改可玩性。
 *  3. **返回只有一条路**：`‹ 返回` 直接关面板（与主菜单"面板内只有一个出口"一致）。
 *  4. **卡片每次 show 都重读进度**：上一局可能在别的标签页里刷新了记录。
 */

import { t, tp } from '../core/i18n/I18n.ts';
import { MINIGAME_CATALOG } from '../minigame/catalog.ts';
import { bestScore, type MiniGameProgress } from '../minigame/progress.ts';
import type { MiniGameId } from '../minigame/types.ts';
import type { TextureAtlas } from '../render/TextureAtlas.ts';
import { drawItemIcon } from './ItemIcon.ts';

/** 卡片图标尺寸（CSS 像素） */
const CARD_ICON_SIZE = 40;

export interface MiniGameMenuActions {
  readonly onStart: (gameId: MiniGameId) => void;
  readonly onClose: () => void;
}

export class MiniGameMenu {
  readonly root: HTMLDivElement;

  private readonly gamesEl: HTMLDivElement;
  private readonly bestEls = new Map<string, HTMLDivElement>();

  constructor(
    host: HTMLElement,
    private readonly atlas: TextureAtlas,
    progress: MiniGameProgress,
    private readonly actions: MiniGameMenuActions,
  ) {
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

      const best = document.createElement('div');
      best.className = 'minigame-game-count';
      this.bestEls.set(entry.id, best);

      text.append(name, desc, best);
      card.append(icon, text);
      card.addEventListener('click', () => this.actions.onStart(entry.id));
      this.gamesEl.appendChild(card);
    }

    panel.append(head, this.gamesEl);
    this.root.appendChild(panel);
    host.appendChild(this.root);

    this.setProgress(progress);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** 更新进度（开局回来 / 每次打开面板时调用） */
  setProgress(progress: MiniGameProgress): void {
    for (const entry of MINIGAME_CATALOG) {
      const el = this.bestEls.get(entry.id);
      if (!el) continue;
      el.textContent = tp('minigame.menu.best', { best: bestScore(progress, entry.id) });
    }
  }

  /** 返回：直接关面板（只有一层，没有"逐级返回"） */
  back(): void {
    this.actions.onClose();
  }

  dispose(): void {
    this.root.remove();
  }
}
