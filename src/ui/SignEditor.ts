/**
 * 告示牌编辑界面（B12，批次 80）
 *
 * 原版点一下牌子会弹出一个四行的编辑框，敲完点"完成"写上去。
 * 这里就是那个框：**四行 `<input>`**（每行最多 15 字）+ 完成 / 取消。
 *
 * 三条与这个项目的手法一致的决定：
 *  1. **DOM 在 TS 里建、样式在 `index.html` 的 `.sign-editor*` 里**——
 *     `ChatInput` 就是这么做的，界面结构与其显示逻辑在一处，样式则跟着设计令牌走；
 *  2. **不吃按键**：输入框有焦点时全局 keydown 早已放行（主程序里那条
 *     "target 是 INPUT 就不抢键"的规则），所以打字不会把界面关掉；
 *  3. **手机可用**：点输入框会唤起系统虚拟键盘，完成键是一个**真按钮**
 *     （手机虚拟键盘的"确定"不一定派发 Enter 的 keydown——聊天那批踩过）。
 *
 * ⚠️ 与原版差异：原版能点任意一行直接改、方向键在四行之间走；这里四行都在、
 * 点哪行改哪行，但**不拦 Tab/方向键**（留给浏览器默认行为，输入法才不会被顶掉）。
 */

import { SIGN_LINES, SIGN_LINE_LENGTH } from '../core/world/SignText.ts';

/** 标题里要显示的方块名（"橡木告示牌"） */
export interface SignEditorLabels {
  title: string;
}

export class SignEditor {
  readonly root: HTMLDivElement;

  /** 点"完成"时回调（内容已裁剪；四行全空表示擦掉） */
  onSave: ((lines: string[]) => void) | null = null;
  /** 关闭（无论是保存还是取消）时回调：App 用它把输入权交回去 */
  onClose: (() => void) | null = null;

  private readonly titleEl: HTMLDivElement;
  private readonly rowEls: HTMLInputElement[] = [];
  private open = false;

  constructor(host: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'sign-editor';
    this.root.className = 'sign-editor hidden';

    const panel = document.createElement('div');
    panel.className = 'sign-editor-panel';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'sign-editor-title';

    const rows = document.createElement('div');
    rows.className = 'sign-editor-rows';
    for (let i = 0; i < SIGN_LINES; i++) {
      const row = document.createElement('input');
      row.type = 'text';
      row.className = 'sign-editor-row';
      row.maxLength = SIGN_LINE_LENGTH;
      // 手机上不要自动大写/纠错：写英文名时被"修"过是最烦人的
      row.autocapitalize = 'off';
      row.autocomplete = 'off';
      row.spellcheck = false;
      row.placeholder = `第 ${i + 1} 行`;
      // Enter：跳到下一行；最后一行直接完成（原版也能一路敲完）
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (i + 1 < SIGN_LINES) this.rowEls[i + 1]?.focus();
        else this.save();
      });
      this.rowEls.push(row);
      rows.appendChild(row);
    }

    const hint = document.createElement('div');
    hint.className = 'sign-editor-hint';
    hint.textContent = `每行最多 ${SIGN_LINE_LENGTH} 字 · 全部留空＝擦掉牌子上的字`;

    const buttons = document.createElement('div');
    buttons.className = 'sign-editor-buttons';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    // 原版的"完成"就是一颗普通灰按钮（批次 109 去掉了绿色主按钮那一套）
    saveButton.className = 'sign-editor-button';
    saveButton.textContent = '完成';
    saveButton.addEventListener('click', () => this.save());

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'sign-editor-button';
    cancelButton.textContent = '取消';
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
   * 打开编辑框。
   *
   * @param lines 牌子上已有的文字（没写过传 null → 四个空行）
   * @param labels 标题里显示的方块名
   */
  show(lines: readonly string[] | null, labels: SignEditorLabels): void {
    this.titleEl.textContent = labels.title;
    for (let i = 0; i < SIGN_LINES; i++) {
      const row = this.rowEls[i]!;
      row.value = lines?.[i] ?? '';
      // 输入框里可能残留上一张牌子的选区
      row.blur();
    }
    this.open = true;
    this.root.classList.remove('hidden');
    // 自动聚焦第一行：桌面上可以直接打字，手机上会**唤起虚拟键盘**
    // （有些浏览器只允许在用户手势里唤起键盘，而这里是右键/点按的回调里，通常没问题）
    this.rowEls[0]?.focus();
    this.rowEls[0]?.setSelectionRange(this.rowEls[0].value.length, this.rowEls[0].value.length);
  }

  /** 当前四个输入框里的内容（未裁剪，交给 `SignTextStore` 规整） */
  text(): string[] {
    return this.rowEls.map((row) => row.value);
  }

  private save(): void {
    const lines = this.text();
    this.hide();
    this.onSave?.(lines);
  }

  /** 取消：什么都不写，直接收起 */
  close(): void {
    this.hide();
  }

  private hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    for (const row of this.rowEls) row.blur();
    this.onClose?.();
  }

  /** 离开世界时移除 DOM（批次 181；监听都挂在 root 内，移除即解绑） */
  dispose(): void {
    this.root.remove();
  }
}
