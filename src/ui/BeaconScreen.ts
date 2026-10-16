/**
 * 信标界面（K5，批次 117）
 *
 * 原版右键信标会弹出一块小面板：上面一行主效果按钮、下面一行次级效果，
 * 选好按"完成"。这里就是那块面板——**没有物品格**，所以它不走
 * `InventoryScreen` 那套"网格 + 容器"的路（与告示牌编辑器同一个写法：
 * DOM 在 TS 里建、样式在 `index.html` 的 `.beacon-screen*` 里、`Esc` 收起）。
 *
 * 三条与这个项目一致的取舍：
 *  1. **点一下就生效**（原版要按"完成"）：信标的效果是"选了就一直在"的东西，
 *     多一步确认只会让人以为没选上；面板留着不关，可以接着换别的效果看；
 *  2. **够不到的能力直接置灰**：没有金字塔时所有按钮都点不动、三级以下没有生命恢复
 *     ——按钮上写清楚"要几级"，比点了没反应好；
 *  3. **`onClose` 交回输入权**：与背包/告示牌同一条（App 里那个 `uiOpen` 判据）。
 */

import {
  BEACON_MAX_LEVEL,
  BEACON_POWERS,
  BEACON_REGEN_MIN_LEVEL,
  BEACON_REGEN_POWER,
  beaconPrimaryAmplifier,
  beaconSummary,
} from '../core/world/Beacon.ts';

/** 界面要显示的状态（由主程序按方块状态与金字塔等级拼出来） */
export interface BeaconScreenState {
  /** 金字塔等级 0~4 */
  readonly level: number;
  /** 主效果下标（0 = 还没选） */
  readonly primary: number;
  /** 要不要生命恢复 */
  readonly regen: boolean;
}

export class BeaconScreen {
  readonly root: HTMLDivElement;

  /** 选了效果（点一下就回调，见文件头第 1 条） */
  onChoose: ((primaryIndex: number, regen: boolean) => void) | null = null;
  /** 面板关闭（无论是按完成还是 `Esc`）时回调：App 用它把输入权交回去 */
  onClose: (() => void) | null = null;

  private readonly summaryEl: HTMLDivElement;
  private readonly primaryButtons: HTMLButtonElement[] = [];
  private readonly regenButton: HTMLButtonElement;
  private open = false;

  constructor(host: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'beacon-screen';
    this.root.className = 'beacon-screen hidden';

    const panel = document.createElement('div');
    panel.className = 'beacon-screen-panel';

    const title = document.createElement('div');
    title.className = 'beacon-screen-title';
    title.textContent = '信标';

    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'beacon-screen-summary';

    const primaryRow = this.buildRow('主效果');
    for (let i = 0; i < BEACON_POWERS.length; i++) {
      const power = BEACON_POWERS[i]!;
      const button = this.buildButton(power.label);
      button.addEventListener('click', () => this.choose(i + 1));
      this.primaryButtons.push(button);
      primaryRow.buttons.appendChild(button);
    }

    const secondaryRow = this.buildRow('次级效果');
    this.regenButton = this.buildButton(BEACON_REGEN_POWER.label);
    this.regenButton.addEventListener('click', () => this.choose(this.selectedPrimary, !this.selectedRegen));
    secondaryRow.buttons.appendChild(this.regenButton);
    const regenHint = document.createElement('div');
    regenHint.className = 'beacon-screen-hint';
    regenHint.textContent = `要 ${BEACON_REGEN_MIN_LEVEL} 级以上的金字塔才有`;
    secondaryRow.buttons.appendChild(regenHint);

    const hint = document.createElement('div');
    hint.className = 'beacon-screen-hint';
    hint.textContent = `效果等级：${BEACON_MAX_LEVEL} 级金字塔内 1~2 级给 I、3 级以上给 II · 点一下就生效`;

    const done = this.buildButton('完成');
    done.classList.add('beacon-screen-done');
    done.addEventListener('click', () => this.close());

    panel.appendChild(title);
    panel.appendChild(this.summaryEl);
    panel.appendChild(primaryRow.root);
    panel.appendChild(secondaryRow.root);
    panel.appendChild(hint);
    panel.appendChild(done);
    this.root.appendChild(panel);
    host.appendChild(this.root);

    // Esc = 收起。挂在自己的根节点上并 stopPropagation，
    // 否则主程序那条"Esc 打开暂停菜单"会跟着一起触发（与告示牌编辑器同一处讲究）
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
  }

  private selectedPrimary = 0;
  private selectedRegen = false;

  private buildRow(label: string): { root: HTMLDivElement; buttons: HTMLDivElement } {
    const root = document.createElement('div');
    root.className = 'beacon-screen-row';
    const caption = document.createElement('div');
    caption.className = 'beacon-screen-caption';
    caption.textContent = label;
    const buttons = document.createElement('div');
    buttons.className = 'beacon-screen-buttons';
    root.appendChild(caption);
    root.appendChild(buttons);
    return { root, buttons };
  }

  private buildButton(text: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'beacon-screen-button';
    button.textContent = text;
    return button;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 打开面板（每次打开都按当前状态刷新一遍按钮的可用与选中态） */
  show(state: BeaconScreenState): void {
    this.selectedPrimary = state.primary;
    this.selectedRegen = state.regen;
    this.open = true;
    this.root.classList.remove('hidden');
    this.refresh(state.level);
  }

  /** 按等级刷新：能不能点、哪一个是选中的 */
  private refresh(level: number): void {
    this.summaryEl.textContent = beaconSummary(level);
    const usable = level > 0;
    this.summaryEl.classList.toggle('beacon-screen-summary-off', !usable);
    for (let i = 0; i < this.primaryButtons.length; i++) {
      const button = this.primaryButtons[i]!;
      button.disabled = !usable;
      button.classList.toggle('beacon-screen-button-on', this.selectedPrimary === i + 1);
    }
    // 生命恢复：三级起，而且它永远是 I 级（原版如此），所以文案里把等级写出来
    const regenUsable = level >= BEACON_REGEN_MIN_LEVEL;
    this.regenButton.disabled = !regenUsable;
    this.regenButton.classList.toggle('beacon-screen-button-on', this.selectedRegen && regenUsable);
    const level2 = beaconPrimaryAmplifier(level) + 1;
    this.regenButton.textContent = `${BEACON_REGEN_POWER.label} I`;
    this.summaryEl.dataset.primaryLevel = String(level2);
  }

  /** 点某个效果：先记进"当前选择"（界面立刻高亮），再回调主程序去写方块状态 */
  private choose(primaryIndex: number, regen = this.selectedRegen): void {
    this.selectedPrimary = primaryIndex;
    this.selectedRegen = regen;
    this.onChoose?.(primaryIndex, regen);
  }

  /** 收起面板（按完成或 `Esc`） */
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.onClose?.();
  }
}
