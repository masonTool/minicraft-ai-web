/**
 * 物品提示框（悬停显示名称与说明）
 *
 * 用**事件委托**而不是给每个槽位绑监听：背包界面每次打开/切换模式都会重建几十个槽位，
 * 逐个绑定既容易漏（新槽位忘了绑）又要写一堆解绑。委托只有一个监听器，
 * 由调用方给出"这个元素当前是什么物品"的解析函数。
 *
 * 为什么不用浏览器自带的 `title`：它只能显示一行纯文本、要等一秒才出来、
 * 手机上也弹不出来——而我们要显示的是"名称 + 英文 id + 说明 + 类别/堆叠"好几行。
 */

import type { ItemTooltip } from '../core/registry/itemNames.ts';
import { rarityClassName } from '../core/registry/itemVisuals.ts';

export class Tooltip {
  private readonly root: HTMLDivElement;
  private visible = false;
  /** 当前正在显示的元素：指针在同一元素里移动时不用重新渲染 */
  private currentElement: HTMLElement | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(host: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'item-tooltip';
    this.root.classList.add('hidden');
    host.appendChild(this.root);
  }

  /**
   * 在一个容器上委托监听。
   * @param resolve 由"指针下面的元素"算出要显示的内容；返回 null 表示这个位置没有物品
   */
  delegate(container: HTMLElement, resolve: (target: HTMLElement) => ItemTooltip | null): void {
    const onMove = (event: PointerEvent): void => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip]') ?? null;
      if (!target || !container.contains(target)) {
        this.hide();
        return;
      }
      if (target !== this.currentElement) {
        const data = resolve(target);
        if (!data) {
          this.hide();
          return;
        }
        this.currentElement = target;
        this.render(data);
      }
      this.place(event.clientX, event.clientY);
    };

    const onLeave = (): void => this.hide();

    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerover', onMove);
    container.addEventListener('pointerleave', onLeave);
    container.addEventListener('pointercancel', onLeave);
    // 滚动/点击之后内容可能变了（例如刚合成掉一组材料），直接收起，避免显示过期信息
    container.addEventListener('pointerdown', onLeave);

    this.cleanups.push(() => {
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerover', onMove);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('pointercancel', onLeave);
      container.removeEventListener('pointerdown', onLeave);
    });
  }

  private render(data: ItemTooltip): void {
    this.root.textContent = '';
    // 稀有度决定整块框的强调色（标题 + 左侧色条），CSS 只认类名
    this.root.dataset.rarity = data.rarity;

    const title = document.createElement('div');
    title.className = `tooltip-title ${rarityClassName(data.rarity)}`;
    title.textContent = data.count > 1 ? `${data.title} ×${data.count}` : data.title;

    const subtitle = document.createElement('div');
    subtitle.className = 'tooltip-subtitle';
    subtitle.textContent = data.subtitle;

    this.root.append(title, subtitle);

    // 说明只放说明（耐久与附魔各自一行，见下）
    if (data.description.length > 0) {
      const description = document.createElement('div');
      description.className = 'tooltip-desc';
      description.textContent = data.description;
      this.root.appendChild(description);
    }

    // 附魔：一条一行、青蓝色（一排附魔挤在说明里会被看漏）
    if (data.enchants.length > 0) {
      const enchants = document.createElement('div');
      enchants.className = 'tooltip-enchants';
      for (const line of data.enchants) {
        const row = document.createElement('div');
        row.className = 'tooltip-enchant';
        row.textContent = line;
        enchants.appendChild(row);
      }
      this.root.appendChild(enchants);
    }

    // 耐久：文案 + 一条迷你条（快坏了能一眼看出来，不用去读数字）
    if (data.durability.length > 0) {
      const durability = document.createElement('div');
      durability.className = 'tooltip-durability';
      const text = document.createElement('span');
      text.textContent = data.durability;
      durability.appendChild(text);
      if (data.durabilityBar) {
        const bar = document.createElement('div');
        bar.className = `dur-bar dur-${data.durabilityBar.level}`;
        const fill = document.createElement('b');
        fill.style.width = `${Math.round(data.durabilityBar.ratio * 100)}%`;
        bar.appendChild(fill);
        durability.appendChild(bar);
      }
      this.root.appendChild(durability);
    }

    if (data.showMeta) {
      const meta = document.createElement('div');
      meta.className = 'tooltip-meta';
      meta.textContent = `${data.category} · ${data.maxStack <= 1 ? '不可堆叠' : `最多 ${data.maxStack} 个/格`}`;
      this.root.appendChild(meta);
    }

    this.root.classList.remove('hidden');
    this.visible = true;
  }

  /** 跟着指针走，并保证整块提示框留在窗口里 */
  private place(clientX: number, clientY: number): void {
    if (!this.visible) return;
    const rect = this.root.getBoundingClientRect();
    const margin = 12;
    let x = clientX + margin;
    let y = clientY + margin;
    if (x + rect.width > window.innerWidth - 4) x = Math.max(4, clientX - rect.width - margin);
    if (y + rect.height > window.innerHeight - 4) y = Math.max(4, clientY - rect.height - margin);
    this.root.style.left = `${Math.round(x)}px`;
    this.root.style.top = `${Math.round(y)}px`;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.currentElement = null;
    this.root.classList.add('hidden');
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** 当前显示的文字（验收脚本用） */
  get text(): string {
    return this.visible ? this.root.textContent ?? '' : '';
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.root.remove();
  }
}
