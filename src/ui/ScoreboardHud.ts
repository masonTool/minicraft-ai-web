/**
 * 侧边栏记分板（M23，批次 456）
 *
 * 原版 `/scoreboard objectives setdisplay sidebar <目标>` 会在屏幕右侧挂一块
 * 排行面板（标题 + 每个持有人的分数，最多 15 行）。这里做同一件事。
 *
 * 三条刻意的做法（与 `ToolHud` / `VitalsHud` 一致）：
 *  1. **内容由 `Scoreboard.sidebarView()` 算好**（纯数据：标题、排序、截断都在 core 里，
 *     所以离线能断言"显示哪个目标、按什么顺序、最多几行"），这里只负责画；
 *  2. **只在内容变了才动 DOM**：每帧调用也不会重排（签名比对）；
 *  3. 挂在 `#hud` 里，退出世界时随它一起清掉。
 */

import { SIDEBAR_MAX_ROWS, type SidebarView } from '../core/world/Scoreboard.ts';

export class ScoreboardHud {
  readonly root: HTMLDivElement;

  private readonly titleEl: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  /** 上一次画出来的内容签名（标题 + 每行） */
  private signature = '';

  constructor(host: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'scoreboard-hud';
    this.root.className = 'scoreboard-hud hidden';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'scoreboard-title';

    this.listEl = document.createElement('div');
    this.listEl.className = 'scoreboard-rows';

    this.root.append(this.titleEl, this.listEl);
    host.appendChild(this.root);
  }

  /** 每帧调用；`null` = 没有 sidebar 槽位（整块收起） */
  update(view: SidebarView | null): void {
    const signature = view
      ? `${view.title}\u0000${view.rows.map((row) => `${row.holder}=${row.value}`).join('|')}`
      : '';
    if (signature === this.signature) return;
    this.signature = signature;

    if (!view) {
      this.root.classList.add('hidden');
      this.titleEl.textContent = '';
      this.listEl.textContent = '';
      return;
    }

    this.root.classList.remove('hidden');
    this.titleEl.textContent = view.title;
    // 整块重建：只在签名变化时走到这里（最多 15 行，开销可以忽略），
    // 比"按行 diff"少一大截状态，也不会出现"删了目标但残行还在"
    this.listEl.textContent = '';
    for (const row of view.rows.slice(0, SIDEBAR_MAX_ROWS)) {
      const line = document.createElement('div');
      line.className = 'scoreboard-row';

      const name = document.createElement('span');
      name.className = 'scoreboard-name';
      name.textContent = row.holder;

      const value = document.createElement('span');
      value.className = 'scoreboard-value';
      value.textContent = String(row.value);

      line.append(name, value);
      this.listEl.appendChild(line);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
