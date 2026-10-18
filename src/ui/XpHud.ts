/**
 * 经验条与等级（I5）
 *
 * 位置与观感对齐原版：快捷栏正上方一条细长的绿色进度条，**等级数字压在条的正中间**
 * （绿字 + 黑描边，条本身只有 5 像素高）。
 *
 * 与 `VitalsHud` 同一套做法：只在数值变化时改 DOM，避免每帧写样式。
 * 0 级且进度为 0 时整条隐藏（原版也是没经验就不显示）。
 */

import type { Experience } from '../core/survival/Experience.ts';

export class XpHud {
  private readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly levelEl: HTMLElement;
  private lastKey = '';

  constructor(container: HTMLElement) {
    // 批次 183：`#hud` 是静态容器，重进世界时会再挂一条经验条。
    // 只删自己那一块（不能 `replaceChildren`，`#hud` 里还有准星、提示、触摸层）。
    container.querySelector('#xp-bar')?.remove();
    this.root = document.createElement('div');
    this.root.id = 'xp-bar';

    this.fill = document.createElement('i');
    this.fill.id = 'xp-fill';

    this.levelEl = document.createElement('b');
    this.levelEl.id = 'xp-level';

    this.root.append(this.fill, this.levelEl);
    container.appendChild(this.root);
  }

  /** 拆局：把经验条从公共 HUD 上摘掉 */
  dispose(): void {
    this.root.remove();
    this.lastKey = '';
  }

  /**
   * @param creative 创造模式：原版不显示经验条（创造模式没有消耗经验的地方，等级只是噪音）
   */
  update(xp: Experience, creative = false): void {
    // creative 必须进 key：切模式时等级/进度不变，漏了它就不会重算显隐
    const key = `${xp.level}|${xp.progress}|${creative}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.root.classList.toggle('hidden', creative || (xp.level === 0 && xp.progress === 0));
    // 进度条宽度按"当前级内的比例"；满级时 ratio 可能因浮点略微超过 1，夹一下
    this.fill.style.width = `${Math.round(Math.min(1, xp.ratio) * 100)}%`;
    this.levelEl.textContent = String(xp.level);
  }
}
