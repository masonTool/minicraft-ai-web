/**
 * "这台设备玩不了"的整屏提示（A10，批次 85）
 *
 * 判定在 `core/render/webglSupport.ts`（纯逻辑、离线可断言），这里只负责**显示**：
 * 标题、原因、两三条"该怎么办"、以及一个刷新按钮。
 *
 * 为什么不是 `alert()`：手机上 `alert` 会被浏览器拦（而且拦掉之后就只剩白屏），
 * 而且它显示不了"条目化的建议"。
 *
 * ⚠️⚠️ **构造时绝不碰 DOM**（批次 102 修的 A10 回归）——
 * 这一层是 `position: fixed; inset: 0; z-index: 90` 的**不透明**整屏底
 * （见 `index.html` 的 `.unsupported-screen`）。原来的构造函数一上来就把它挂到 `<body>`，
 * 于是**支持 WebGL2 的正常路径**上也会留下一个**空的**整屏层：
 * 它压住主菜单（`#overlay` 的 z-index 只有 5）——**主页一打开就是全黑，而且点不动任何东西**。
 *
 * 原来的 `hide()` 也救不了：它只清 `textContent`，元素还挂在那儿、还是铺满屏幕。
 * 所以现在改成**只有真要显示时才创建 DOM**、`hide()` 直接摘掉 ——
 * 从结构上让"一个空的整屏层盖住一切"这件事不可能发生（配套的 CSS 也是默认 `display: none`，
 * 见 `index.html`；两道闸门）。
 */

import type { GlSupportFail } from '../core/render/webglSupport.ts';

export class UnsupportedScreen {
  /** 只有 `show()` 之后才有值 —— 没有它的时候页面上一个字节的 DOM 都没多 */
  private root: HTMLDivElement | null = null;

  constructor(private readonly parent: HTMLElement = document.body) {}

  /** 显示（同一份界面复用：探测失败与渲染器创建失败走的是同一个入口） */
  show(failure: GlSupportFail): void {
    this.hide();

    const root = document.createElement('div');
    // ⚠️ `visible` 不能少：CSS 里这一层默认 `display: none`（见 index.html）
    root.className = 'unsupported-screen visible';

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

    root.appendChild(panel);
    this.parent.appendChild(root);
    this.root = root;
  }

  /** 收起：**把元素摘掉**（不是清空内容——那正是 A10 回归的写法） */
  hide(): void {
    this.root?.remove();
    this.root = null;
  }
}
