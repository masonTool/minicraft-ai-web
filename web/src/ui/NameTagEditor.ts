/**
 * 命名牌输入框（批次 615）
 *
 * 拿命名牌点生物会弹出这个框：**一行输入 + 完成/取消**。
 * 结构与告示牌编辑器（`SignEditor.ts`）**同一套 CSS 类**（`.sign-editor*`），
 * 只是行数从四行变一行——为此新写一个类而不是给 `SignEditor` 加"单行模式"分支：
 * 那个类里"Enter 跳到下一行""全部留空＝擦掉"这些规则都依赖四行结构，
 * 加分支会让两条语义互相污染（改一处忘另一处）。
 *
 * 三条与仓库一致的约定：
 *  1. **DOM 在 TS 里建、样式复用 `index.html` 的 `.sign-editor*`**；
 *  2. **不吃按键**：输入框有焦点时主程序早就不抢键了，打字不会关掉界面；
 *  3. **手机可用**：点输入框唤起系统虚拟键盘，"完成"是真按钮
 *     （虚拟键盘的确定键不一定派发 Enter，聊天那批踩过）。
 */

import { t, tp } from '../core/i18n/I18n.ts';
import { MAX_NAME_LENGTH } from '../core/entity/NameTag.ts';

export class NameTagEditor {
  readonly root: HTMLDivElement;

  /** 点"完成"时回调（已 trim；空串表示玩家没填） */
  onSave: ((name: string) => void) | null = null;
  /** 关闭（无论保存还是取消）时回调：App 用它把输入权交回去 */
  onClose: (() => void) | null = null;

  private readonly titleEl: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private open = false;

  constructor(host: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'name-tag-editor';
    this.root.className = 'sign-editor hidden';

    const panel = document.createElement('div');
    panel.className = 'sign-editor-panel';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'sign-editor-title';

    const rows = document.createElement('div');
    rows.className = 'sign-editor-rows';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'sign-editor-row';
    this.input.maxLength = MAX_NAME_LENGTH;
    // 手机上不自动大写/纠错：名字被"修"过是最烦人的
    this.input.autocapitalize = 'off';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = t('nameTag.placeholder');
    this.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.save();
    });
    rows.appendChild(this.input);

    const hint = document.createElement('div');
    hint.className = 'sign-editor-hint';
    hint.textContent = tp('nameTag.hint', { n: MAX_NAME_LENGTH });

    const buttons = document.createElement('div');
    buttons.className = 'sign-editor-buttons';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'sign-editor-button';
    saveButton.textContent = t('sign.done');
    saveButton.addEventListener('click', () => this.save());

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'sign-editor-button';
    cancelButton.textContent = t('editor.cancel');
    cancelButton.addEventListener('click', () => this.close());

    buttons.appendChild(saveButton);
    buttons.appendChild(cancelButton);

    panel.appendChild(this.titleEl);
    panel.appendChild(rows);
    panel.appendChild(hint);
    panel.appendChild(buttons);
    this.root.appendChild(panel);
    host.appendChild(this.root);

    // Esc = 取消。挂在自己的根节点上并 stopPropagation，
    // 否则主程序那条"Esc 打开暂停菜单"会跟着一起触发（两层界面叠在一起）
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * 打开输入框。
   *
   * @param current 这只生物现在的名字（没名字传 null → 空输入框）
   * @param title 标题（"给牛起个名字"）
   */
  show(current: string | null, title: string): void {
    this.titleEl.textContent = title;
    this.input.value = current ?? '';
    this.root.classList.remove('hidden');
    this.open = true;
    // 手机上立刻聚焦会同时弹键盘，挡住刚出现的面板；先让一帧再聚焦
    // （与告示牌编辑器同一处理，批次 184 踩过键盘遮住输入框）
    requestAnimationFrame(() => this.input.focus());
  }

  private save(): void {
    const value = this.input.value.trim();
    const handler = this.onSave;
    this.close();
    handler?.(value);
  }

  /** 关掉输入框（Esc / 取消 / 主程序统一收界面都会走这里） */
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.input.blur();
    this.onClose?.();
  }

  /**
   * 退出世界时摘掉 DOM（批次 615 漏项，617 补）。
   *
   * 本类是 `App` 的字段，构造时就把 `#name-tag-editor` 挂到了 `<body>`：
   * 不摘掉的话下一局会叠出第二个同 id 节点；更糟的是**退出时输入框还开着**
   * （`show()` 已经摘掉 `hidden`），那层 `.sign-editor` 的全屏 55% 黑遮罩
   * 会留在页面上，表现为"再进世界时画面发暗 / 有东西一闪而过"。
   *
   * 与 `CommandBlockEditor.dispose()` 同一套：只收自己，不回调 `onClose`
   * （那会把已经销毁的 App 再拉起来一次）。
   */
  dispose(): void {
    this.open = false;
    this.onSave = null;
    this.onClose = null;
    this.input.blur();
    this.root.remove();
  }
}
