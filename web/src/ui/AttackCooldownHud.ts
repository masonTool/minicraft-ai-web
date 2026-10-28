/**
 * 攻击冷却条（G8，批次 506）
 *
 * 位置：准星**正下方**一小段（原版那根白色蓄力条也在这里）。
 * 只在冷却未满时出现，满了就隐藏——常驻一条空槽会挡住准星下的画面。
 *
 * 与 `XpHud` 同一套做法：只在进度变化时改 DOM（每帧写样式在手机上会掉帧），
 * 并用 `#attack-cooldown` 这个 id 保证重进世界时不会挂第二条。
 */

import { attackChargeProgress } from '../core/combat/AttackSpeed.ts';

export class AttackCooldownHud {
  private readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private lastPercent = -1;

  constructor(container: HTMLElement) {
    container.querySelector('#attack-cooldown')?.remove();
    this.root = document.createElement('div');
    this.root.id = 'attack-cooldown';
    this.root.classList.add('hidden');

    this.fill = document.createElement('i');
    this.root.appendChild(this.fill);
    container.appendChild(this.root);
  }

  dispose(): void {
    this.root.remove();
    this.lastPercent = -1;
  }

  /**
   * @param cooldown 剩余冷却（秒）
   * @param max      这一次攻击的总冷却（秒）
   */
  update(cooldown: number, max: number): void {
    const progress = attackChargeProgress(cooldown, max);
    // 量化到 2% 一档：视觉上够细，又不会每帧都写一次 style
    const percent = Math.round(progress * 50) * 2;
    const hidden = progress >= 1;
    if (percent === this.lastPercent && hidden === this.root.classList.contains('hidden')) return;
    this.lastPercent = percent;
    this.root.classList.toggle('hidden', hidden);
    this.fill.style.width = `${percent}%`;
  }
}
