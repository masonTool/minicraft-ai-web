/**
 * 指南针 / 时钟的读数（批次 195，B19）
 *
 * 这两件物品在原版里都是"**拿在手里就有读数**"：指南针的指针指向世界出生点、
 * 时钟的表盘按时间转。本项目的物品图标是静态的 2D 贴图（没法让图标自己转），
 * 所以读数挪到了 HUD 上的一小块表盘——**只在主手拿着它们时出现**。
 *
 * 三处刻意的做法：
 *  1. **角度在 `core/items/Navigation.ts` 里算**（纯函数、可离线断言），这里只 `rotate()`；
 *  2. **只在与上一帧不同的粒度上动 DOM**：角度取整到 1°、文字变了才写，
 *     所以每帧调用它也不会引起重排（与 `VitalsHud` 同一条）；
 *  3. 挂在 `#hud` 里（与生命/经验同一个容器），退出世界时随它一起被清掉。
 */

import { timeOfDayLabel } from '../core/items/Navigation.ts';

export type ToolHudKind = 'compass' | 'clock';

export class ToolHud {
  readonly root: HTMLDivElement;

  private readonly needleEl: HTMLDivElement;
  private readonly labelEl: HTMLDivElement;
  private kind: ToolHudKind | null = null;
  private lastDeg = Number.NaN;
  private lastLabel = '';

  constructor(host: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'tool-hud';
    this.root.className = 'tool-hud hidden';

    const dial = document.createElement('div');
    dial.className = 'tool-hud-dial';

    // 表盘上的四个方位/刻度：指南针给 N/E/S/W，时钟给 12/3/6/9 的短刻度
    for (const text of ['N', 'E', 'S', 'W']) {
      const tick = document.createElement('span');
      tick.className = `tool-hud-tick tick-${text.toLowerCase()}`;
      tick.textContent = text;
      dial.appendChild(tick);
    }

    this.needleEl = document.createElement('div');
    this.needleEl.className = 'tool-hud-needle';
    dial.appendChild(this.needleEl);

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'tool-hud-label';

    this.root.append(dial, this.labelEl);
    host.appendChild(this.root);
  }

  /**
   * 更新读数。
   *
   * @param kind `null` = 收起（主手不是这两件东西）
   * @param deg 指针/表针的角度（0 = 朝上，顺时针为正）
   * @param detail 指南针传距离（格），时钟传 `timeOfDay`（0~1）
   */
  update(kind: ToolHudKind | null, deg = 0, detail = 0): void {
    if (!kind) {
      if (this.kind !== null) {
        this.kind = null;
        this.root.classList.add('hidden');
        this.root.dataset.kind = '';
      }
      return;
    }
    if (this.kind !== kind) {
      this.kind = kind;
      this.root.dataset.kind = kind;
      this.root.classList.remove('hidden');
      this.lastDeg = Number.NaN;
      this.lastLabel = '';
    }

    const rounded = Math.round(deg);
    if (rounded !== this.lastDeg) {
      this.lastDeg = rounded;
      this.needleEl.style.transform = `rotate(${rounded}deg)`;
      // 方位刻度只对指南针有意义（时钟那四个字母会误导）
      this.root.classList.toggle('compass', kind === 'compass');
    }

    const label = kind === 'compass' ? `${Math.round(detail)} 格` : timeOfDayLabel(detail);
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.labelEl.textContent = label;
    }
  }

  /** 离开世界时移除 DOM（批次 181 起的拆局流程与其它 HUD 一致） */
  dispose(): void {
    this.root.remove();
  }
}
