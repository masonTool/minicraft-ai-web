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

    const title = document.createElement('div');
    title.className = 'tooltip-title';
    title.textContent = data.count > 1 ? `${data.title} ×${data.count}` : data.title;

    const subtitle = document.createElement('div');
    subtitle.className = 'tooltip-subtitle';
    subtitle.textContent = data.subtitle;

    this.root.append(title, subtitle);
    // 没写过说明的物品不占一行（提示框只显示名称 + 类别/堆叠）
    if (data.description.length > 0) {
      const description = document.createElement('div');
      description.className = 'tooltip-desc';
      description.textContent = data.description;
      this.root.appendChild(description);
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
