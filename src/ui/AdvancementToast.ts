/**
 * 达成提示（小弹窗，M7 批次 87）
 *
 * 原版达成进度时右上角会滑出来一张小卡片（图标 + "进度已达成！" + 名字），
 * 几秒后自己消失。这里照做，另外多一条：**同时塞进聊天栏**——
 * 手机上玩家可能正在看别处，弹窗错过就永远看不到了，而聊天栏里那条会留着。
 *
 * 三条口径：
 *  1. **最新的在最上面**（原版如此），最多同时 5 张，挤掉的是最旧的那张；
 *  2. 每张 4.5 秒后淡出（CSS 过渡 0.35 秒），淡出期间不再占位；
 *  3. 一次事件解锁多条时（比如击杀一只僵尸同时点亮"冒险"与"怪物猎人"）
 *     **一条一张地叠出来**，而不是合成一张——玩家能看清分别是什么。
 */

import type { TextureAtlas } from '../render/TextureAtlas.ts';
import { t } from '../core/i18n/I18n.ts';
import { advancementTitle } from '../core/progress/advancementText.ts';
import type { AdvancementDef } from '../core/progress/advancements.ts';
import { drawItemIcon } from './ItemIcon.ts';

/** 一张卡片停留多久（秒） */
const TOAST_SECONDS = 4.5;
/** 淡出动画时长（与 CSS 里的过渡时长一致） */
const FADE_MS = 350;
/** 同时最多几张 */
const MAX_TOASTS = 5;

export class AdvancementToast {
  private readonly root: HTMLDivElement;
  private readonly cards: HTMLDivElement[] = [];

  constructor(
    host: HTMLElement,
    private readonly atlas: TextureAtlas,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'adv-toasts';
    host.appendChild(this.root);
  }

  /** 弹一张（`subtitle` 是卡片上那行小字，根条目与挑战的文字不同） */
  push(def: AdvancementDef): void {
    // 挤掉最旧的：`cards` 是"从新到旧"，所以最后一个最老
    while (this.cards.length >= MAX_TOASTS) {
      const oldest = this.cards.pop();
      oldest?.remove();
    }

    const card = document.createElement('div');
    card.className = 'adv-toast';
    if (def.challenge) card.classList.add('challenge');

    const icon = document.createElement('canvas');
    icon.className = 'adv-toast-icon';
    icon.width = 26;
    icon.height = 26;
    drawItemIcon(icon, this.atlas, def.icon, 26);

    const text = document.createElement('div');
    text.className = 'adv-toast-text';
    const label = document.createElement('div');
    label.className = 'adv-toast-label';
    label.textContent = t(def.challenge ? 'advancement.toastChallenge' : 'advancement.toastDone');
    const name = document.createElement('div');
    name.className = 'adv-toast-name';
    name.textContent = advancementTitle(def);
    text.append(label, name);

    card.append(icon, text);
    // 最新的插到最前面（原版也是新卡片从上面挤进来）
    this.root.prepend(card);
    this.cards.unshift(card);

    window.setTimeout(() => {
      card.classList.add('hiding');
      window.setTimeout(() => {
        card.remove();
        const index = this.cards.indexOf(card);
        if (index >= 0) this.cards.splice(index, 1);
      }, FADE_MS);
    }, TOAST_SECONDS * 1000);
  }

  get count(): number {
    return this.cards.length;
  }

  clear(): void {
    for (const card of this.cards) card.remove();
    this.cards.length = 0;
  }
}
