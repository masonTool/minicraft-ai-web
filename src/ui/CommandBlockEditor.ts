/**
 * 命令方块的输入框（批次 477）
 *
 * 与 `SignEditor` 同一套做法（DOM 在 TS 里建、样式在 `index.html`），
 * 但**只有一行**：本项目的命令方块只存一格命令（见 `world/CommandBlocks.ts`）。
 *
 * 三条与项目一致的约定：
 *  1. **不吃按键**：输入框有焦点时全局 keydown 早已放行（主程序那条
 *     "target 是 INPUT 就不抢键"的规则），所以打字不会把界面关掉；
 *  2. Enter = 完成、Esc = 取消（手机虚拟键盘的"确定"会派发 Enter）；
 *  3. 完成键是一个**真按钮**（手机键盘不一定派发 Enter，聊天那批踩过）。
 */

/** 输入框最多多少字（与 `CommandBlocks.COMMAND_MAX_LENGTH` 一致） */
const MAX_LENGTH = 128;

export class CommandBlockEditor {
  readonly root: HTMLDivElement;

  /** 点"完成"时回调（已裁剪；空字符串 = 清掉这一格的命令） */
  onSave: ((command: string) => void) | null = null;
  /** 关闭（保存或取消）时回调：App 用它把输入权交回去 */
  onClose: (() => void) | null = null;

  private readonly titleEl: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private open = false;

  constructor(host: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'command-block-editor';
    this.root.className = 'command-block-editor hidden';

    const panel = document.createElement('div');
    panel.className = 'command-block-panel';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'command-block-title';

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'command-block-input';
    this.input.maxLength = MAX_LENGTH;
    // 命令是代码：自动大写/纠错会把 `tp` 修成 `Tp`
    this.input.autocapitalize = 'off';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = '/give @s diamond 1';

    const buttons = document.createElement('div');
    buttons.className = 'command-block-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'command-block-button';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => this.hide(false));
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'command-block-button primary';
    ok.textContent = '完成';
    ok.addEventListener('click', () => this.hide(true));
    buttons.append(cancel, ok);

    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.hide(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.hide(false);
      }
      // 其余按键不拦：打字时不该被全局快捷键抢走
      event.stopPropagation();
    });

    panel.append(this.titleEl, this.input, buttons);
    this.root.append(panel);
    host.append(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 打开并填入当前命令（`null` = 这一格还没有命令） */
  show(current: string | null, title = '命令方块'): void {
    this.open = true;
    this.titleEl.textContent = title;
    this.input.value = current ?? '';
    this.root.classList.remove('hidden');
    // 手机上必须**真的聚焦**才会弹键盘；放在下一帧，等 hidden 摘掉
    requestAnimationFrame(() => {
      this.input.focus();
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    });
  }

  hide(save: boolean): void {
    if (!this.open) return;
    this.open = false;
    const value = this.input.value;
    this.root.classList.add('hidden');
    this.input.blur();
    if (save) this.onSave?.(value.trim());
    this.onClose?.();
  }

  dispose(): void {
    this.open = false;
    this.root.remove();
  }
}
