/**
 * 新手引导卡（批次 20261022-1954 · 引导2）
 *
 * 一张**不阻塞操作**的小卡片：右上角、带图标、一行标题、一行说明。
 * 它只负责"显示哪一步、收起/展开、不再提示"，**不知道进度怎么算**
 * （判定在 `tutorial/TutorialTracker.ts`，接线在主程序）——与成就提示同一条分工。
 *
 * 四条刻意的做法：
 *
 *  1. **挂在 `#hud-right` 那一列里**（而不是自己 fixed 到右上角）：
 *     调试信息与状态效果也在那一列，flex 会自动上下排开，不会互相压住。
 *     代价是宿主必须是 `#hud-right`，拿不到时才退回 fixed 定位。
 *  2. **收起 ≠ 关闭**：收起后变成一个只有图标 + "3/8" 的小徽章，
 *     点一下就能展开。低龄玩家很爱点右上角的叉，收掉之后找不到引导就再也不看了。
 *  3. **"不再提示"是持久化的**（由主程序写存档），但组件只发回调、不碰存储。
 *  4. **几何约束不在这里算**：宽度上限在 `tutorialLayout.ts`（纯函数、可断言），
 *     CSS 里的 `min(38vw, 320px)` 必须与那个文件保持一致。
 */

import { t, tp } from '../core/i18n/I18n.ts';
import type { TextureAtlas } from '../render/TextureAtlas.ts';
import type { TutorialStep } from '../tutorial/steps.ts';
import { drawItemIcon } from './ItemIcon.ts';

/** 卡片上的图标尺寸（CSS 像素；背板会按 DPR 放大） */
const ICON_SIZE = 26;
/** 折叠徽章上的图标尺寸 */
const BADGE_ICON_SIZE = 20;

export interface TutorialCardActions {
  /** 点了「收起」：本次会话折叠（不持久化，重新展开即可） */
  onCollapse?: () => void;
  /** 点了「不再提示」：由主程序决定怎么持久化（组件不碰存档） */
  onDismiss?: () => void;
}

export interface TutorialPosition {
  /** 当前步骤下标（0 起） */
  readonly index: number;
  readonly total: number;
}

export class TutorialCard {
  /** 整块容器（隐藏时只挂 `hidden`，不拆 DOM） */
  readonly root: HTMLDivElement;

  private readonly card: HTMLDivElement;
  private readonly badge: HTMLButtonElement;
  private readonly iconCanvas: HTMLCanvasElement;
  private readonly badgeCanvas: HTMLCanvasElement;
  private readonly labelEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly descEl: HTMLDivElement;
  private readonly badgeLabel: HTMLSpanElement;

  private collapsed = false;
  private visible = false;
  /** 面板打开时临时让位（背包/配方书的遮罩是半透明的，底下透出卡片会很乱） */
  private suppressed = false;

  constructor(
    host: HTMLElement,
    private readonly atlas: TextureAtlas,
    private readonly actions: TutorialCardActions = {},
  ) {
    this.root = document.createElement('div');
    this.root.id = 'tutorial';
    this.root.className = 'tutorial-root hidden';

    // ---- 展开态
    this.card = document.createElement('div');
    this.card.className = 'tutorial-card';
    this.card.setAttribute('role', 'region');

    this.iconCanvas = document.createElement('canvas');
    this.iconCanvas.className = 'tutorial-icon';
    this.iconCanvas.width = ICON_SIZE;
    this.iconCanvas.height = ICON_SIZE;

    const body = document.createElement('div');
    body.className = 'tutorial-body';

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'tutorial-label';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'tutorial-title';
    // 换步骤时让读屏念出新的目标（`polite`：不打断玩家正在做的事）
    this.titleEl.setAttribute('aria-live', 'polite');

    this.descEl = document.createElement('div');
    this.descEl.className = 'tutorial-desc';

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'tutorial-dismiss';
    dismiss.textContent = t('tutorial.dismiss');
    dismiss.addEventListener('click', (event) => {
      event.stopPropagation();
      this.dismiss();
    });

    body.append(this.labelEl, this.titleEl, this.descEl, dismiss);

    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'tutorial-collapse';
    collapse.textContent = '×';
    collapse.setAttribute('aria-label', t('tutorial.collapse'));
    collapse.title = t('tutorial.collapse');
    collapse.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setCollapsed(true);
      this.actions.onCollapse?.();
    });

    this.card.append(this.iconCanvas, body, collapse);

    // ---- 折叠态：一个只有图标 + "3/8" 的小徽章，点一下展开
    this.badge = document.createElement('button');
    this.badge.type = 'button';
    this.badge.className = 'tutorial-badge hidden';
    this.badge.setAttribute('aria-label', t('tutorial.expand'));
    this.badge.title = t('tutorial.expand');

    this.badgeCanvas = document.createElement('canvas');
    this.badgeCanvas.className = 'tutorial-badge-icon';
    this.badgeCanvas.width = BADGE_ICON_SIZE;
    this.badgeCanvas.height = BADGE_ICON_SIZE;

    this.badgeLabel = document.createElement('span');
    this.badgeLabel.className = 'tutorial-badge-label';

    this.badge.append(this.badgeCanvas, this.badgeLabel);
    this.badge.addEventListener('click', () => this.setCollapsed(false));

    this.root.append(this.card, this.badge);
    host.appendChild(this.root);
  }

  /** 显示某一步（`position` 只影响"第 N 步 / 共 M 步"那一行） */
  show(step: TutorialStep, position: TutorialPosition): void {
    const total = Math.max(1, Math.floor(position.total));
    const index = Math.min(Math.max(0, Math.floor(position.index)), total - 1);

    this.labelEl.textContent = tp('tutorial.progress', { current: index + 1, total });
    this.titleEl.textContent = t(step.titleKey);
    this.descEl.textContent = t(step.descKey);
    this.badgeLabel.textContent = `${index + 1}/${total}`;

    drawItemIcon(this.iconCanvas, this.atlas, step.icon, ICON_SIZE);
    drawItemIcon(this.badgeCanvas, this.atlas, step.icon, BADGE_ICON_SIZE);

    this.visible = true;
    this.root.classList.remove('hidden');
    this.card.classList.toggle('hidden', this.collapsed);
    this.badge.classList.toggle('hidden', !this.collapsed);
  }

  /** 收起整张卡（不持久化；下次 `show` 仍按当前折叠状态） */
  hide(): void {
    this.visible = false;
    this.root.classList.add('hidden');
  }

  /** 折叠 / 展开（折叠态是一个可点的小徽章） */
  setCollapsed(value: boolean): void {
    this.collapsed = value;
    if (!this.visible) return;
    this.card.classList.toggle('hidden', value);
    this.badge.classList.toggle('hidden', !value);
    if (!value) this.badge.blur();
  }

  /**
   * 让位：打开任何面板（背包 / 配方书 / 暂停页）时收起整张卡。
   *
   * ⚠️ 与 `hide()` 分开：`hide()` 是"这一局不再显示"，让位只是"现在遮一下"，
   * 关掉面板后**要自己回来**——所以这里不动 `visible`。
   */
  setSuppressed(value: boolean): void {
    if (this.suppressed === value) return;
    this.suppressed = value;
    this.root.classList.toggle('suppressed', value);
  }

  /** 「不再提示」：先收起，再交给主程序（写存档 / 换下一条） */
  private dismiss(): void {
    this.hide();
    this.actions.onDismiss?.();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  get isCollapsed(): boolean {
    return this.collapsed;
  }

  dispose(): void {
    this.root.remove();
  }
}
