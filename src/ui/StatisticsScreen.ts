/**
 * 统计面板（批次 552）
 *
 * 复用成就面板的 `.adv-panel` 外壳，只把列表换成几行“标签 · 数值”。
 * 数据由主程序传进来（`Statistics.serialize()`），这里不做任何累计。
 */

import { t } from '../core/i18n/I18n.ts';
import { formatPlayTime, type StatisticsData } from '../core/survival/Statistics.ts';
import { isTouchUi } from './TouchControls.ts';

export class StatisticsScreen {
  readonly root: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private open = false;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'statistics';
    this.root.classList.add('hidden');

    const panel = document.createElement('div');
    panel.className = 'adv-panel stat-panel';

    const header = document.createElement('div');
    header.className = 'adv-header';

    const title = document.createElement('b');
    title.textContent = t('statistics.title');

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'adv-close inv-close';
    close.textContent = isTouchUi() ? '✕' : '关闭';
    close.setAttribute('aria-label', '关闭统计');
    close.addEventListener('click', () => this.hide());

    header.append(title, close);

    this.listEl = document.createElement('div');
    this.listEl.className = 'adv-list stat-list';

    panel.append(header, this.listEl);
    this.root.append(panel);
    host.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(data: StatisticsData): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render(data);
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  private render(data: StatisticsData): void {
    const rows: readonly [string, string][] = [
      [t('statistics.playTime'), formatPlayTime(data.playSeconds)],
      [t('statistics.blocksMined'), String(Math.floor(data.blocksMined))],
      [t('statistics.blocksPlaced'), String(Math.floor(data.blocksPlaced))],
      [t('statistics.mobsKilled'), String(Math.floor(data.mobsKilled))],
      [t('statistics.deaths'), String(Math.floor(data.deaths))],
      [t('statistics.distance'), `${Math.floor(data.distance)} 格`],
    ];
    this.listEl.replaceChildren(
      ...rows.map(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'stat-row';
        const name = document.createElement('span');
        name.textContent = label;
        const number = document.createElement('b');
        number.textContent = value;
        row.append(name, number);
        return row;
      }),
    );
  }
}
