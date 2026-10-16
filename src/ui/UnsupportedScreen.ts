/**
 * "这台设备玩不了"的整屏提示（A10，批次 85）
 *
 * 判定在 `core/render/webglSupport.ts`（纯逻辑、离线可断言），这里只负责**显示**：
 * 标题、原因、两三条"该怎么办"、以及一个刷新按钮。
 *
 * 为什么不是 `alert()`：手机上 `alert` 会被浏览器拦（而且拦掉之后就只剩白屏），
 * 而且它显示不了"条目化的建议"。
 */

import type { GlSupportFail } from '../core/render/webglSupport.ts';

export class UnsupportedScreen {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'unsupported-screen';
    parent.appendChild(this.root);
  }

  /** 显示（同一份界面复用：探测失败与渲染器创建失败走的是同一个入口） */
  show(failure: GlSupportFail): void {
    this.root.textContent = '';
    const panel = document.createElement('div');
    panel.className = 'unsupported-panel';

    const title = document.createElement('div');
    title.className = 'unsupported-title';
    title.textContent = '这台设备暂时打不开这个游戏';
    panel.appendChild(title);

    const reason = document.createElement('div');
    reason.className = 'unsupported-reason';
    reason.textContent = failure.reason;
    panel.appendChild(reason);

    const list = document.createElement('ul');
    list.className = 'unsupported-advice';
    for (const item of failure.advice) {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    }
    panel.appendChild(list);

    const reload = document.createElement('button');
    reload.className = 'unsupported-button';
    reload.type = 'button';
    reload.textContent = '刷新页面';
    reload.addEventListener('click', () => window.location.reload());
    panel.appendChild(reload);

    const code = document.createElement('div');
    code.className = 'unsupported-code';
    // 具体归类写出来（玩家截图给我们时，这一行就是最有用的一句话）
    code.textContent = `诊断码：${failure.kind}`;
    panel.appendChild(code);

    this.root.appendChild(panel);
  }

  hide(): void {
    this.root.textContent = '';
  }
}
