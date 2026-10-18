/**
 * 书与笔 / 成书的界面（批次 190，H16）
 *
 * 一个面板干两件事，靠手里的物品决定：
 *  - **书与笔**：写。一页一个文本框，底部翻页；「署名」→ 写书名 → 变成成书；
 *  - **成书**：读。同一套翻页，只是文本框换成只读区，也没有「署名」。
 *
 * 三处与本项目其它面板一致的做法：
 *  1. 面板**挂在 `<body>`** 上（与告示牌编辑器/背包一样）：放进 `#app` 会被 `#death`
 *     那类后写的遮罩盖住；
 *  2. 打开/关闭都**不自己动输入权**——由主程序的 `onClose` 把指针锁与触摸层交回去
 *     （与 `SignEditor` 同一个分工，见 `main.handleInventoryOpen`）；
 *  3. **内容不在这里落地**：`onCommit` 把"新的那一叠"交给主程序，由它写回物品栏那一格。
 *     界面不碰 `Inventory`，所以离线测试可以直接驱动这个面板而不需要整个游戏。
 *
 * ⚠️ 手机横屏是主场景：面板高度取 `min(70vh, ...)`，横屏下不会把画面挤没；
 * 文本区自己滚，按钮永远在底部（不跟着内容滚走）。
 */

import {
  BOOK_MAX_PAGES,
  BOOK_PAGE_CHARS,
  BOOK_TITLE_CHARS,
  UNTITLED_BOOK,
  bookPages,
  bookTitleOf,
  isWritableBook,
  signBook,
  withPages,
} from '../core/items/Book.ts';
import type { ItemStack } from '../core/container/Inventory.ts';

export class BookScreen {
  readonly root: HTMLDivElement;

  /** 点「完成」/「署名」时回调：交出去的是**新的一叠**（主程序负责写回背包） */
  onCommit: ((stack: ItemStack) => void) | null = null;
  /** 关闭（保存或取消）时回调：主程序用它把输入权交回去 */
  onClose: (() => void) | null = null;
  /**
   * 翻页时回调（批次 191，讲台用）：讲台要把"玩家停在第几页"记进方块状态里。
   * 打开普通书时主程序会把它置回 null，免得两处串着改。
   */
  onPageChange: ((page: number) => void) | null = null;

  private readonly titleEl: HTMLDivElement;
  private readonly pageEl: HTMLTextAreaElement;
  private readonly readEl: HTMLDivElement;
  private readonly pagerEl: HTMLDivElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly signButton: HTMLButtonElement;
  private readonly doneButton: HTMLButtonElement;
  private readonly titleRow: HTMLDivElement;
  private readonly titleInput: HTMLInputElement;

  private open = false;
  private writing = false;
  /** 打开那一刻的那一叠（署名之后 id 要换，所以留一份原件） */
  private stack: ItemStack | null = null;
  private pages: string[] = [''];
  private pageIndex = 0;

  constructor(host: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'book-screen';
    this.root.className = 'book-screen hidden';

    const panel = document.createElement('div');
    panel.className = 'book-panel';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'book-title';

    // 写模式：一个能滚的文本区
    this.pageEl = document.createElement('textarea');
    this.pageEl.className = 'book-page-input';
    this.pageEl.maxLength = BOOK_PAGE_CHARS;
    this.pageEl.autocapitalize = 'off';
    this.pageEl.autocomplete = 'off';
    this.pageEl.spellcheck = false;
    this.pageEl.placeholder = '在这一页写点什么…';
    // 边打边记：翻页/署名时不必再"提交一次"
    this.pageEl.addEventListener('input', () => {
      this.pages[this.pageIndex] = this.pageEl.value;
    });

    // 读模式：只读的排版区
    this.readEl = document.createElement('div');
    this.readEl.className = 'book-page-read';

    this.pagerEl = document.createElement('div');
    this.pagerEl.className = 'book-pager';
    this.prevButton = this.makeButton('‹', () => this.turnPage(-1));
    this.nextButton = this.makeButton('›', () => this.turnPage(1));
    this.pagerEl.append(this.prevButton, this.buildPageLabel(), this.nextButton);

    // 署名：先展开一行"书名"输入，再确定
    this.titleRow = document.createElement('div');
    this.titleRow.className = 'book-sign-row hidden';
    this.titleInput = document.createElement('input');
    this.titleInput.type = 'text';
    this.titleInput.className = 'book-title-input';
    this.titleInput.maxLength = BOOK_TITLE_CHARS;
    this.titleInput.placeholder = '书名';
    this.titleInput.autocapitalize = 'off';
    this.titleInput.autocomplete = 'off';
    this.titleInput.spellcheck = false;
    const confirmSign = this.makeButton('确定', () => this.confirmSign());
    const cancelSign = this.makeButton('返回', () => this.titleRow.classList.add('hidden'));
    this.titleRow.append(this.titleInput, confirmSign, cancelSign);
    this.titleInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.confirmSign();
    });

    const buttons = document.createElement('div');
    buttons.className = 'book-buttons';
    this.signButton = this.makeButton('署名', () => this.beginSign());
    this.doneButton = this.makeButton('完成', () => this.save());
    const closeButton = this.makeButton('关闭', () => this.close());
    buttons.append(this.signButton, this.doneButton, closeButton);

    panel.append(this.titleEl, this.pageEl, this.readEl, this.pagerEl, this.titleRow, buttons);
    this.root.appendChild(panel);
    host.appendChild(this.root);

    // Esc 只收自己这一层（stopPropagation：否则主程序那条"Esc 打开暂停菜单"会跟着触发）
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
   * 打开一本书（书与笔 → 可写，成书 → 只读）。
   *
   * @param options.startPage 从第几页开始（讲台用：上次翻到哪就从哪继续）
   */
  show(stack: ItemStack, options: { startPage?: number } = {}): void {
    this.stack = stack;
    this.writing = isWritableBook(stack);
    this.pages = bookPages(stack);
    const start = Math.floor(options.startPage ?? 0);
    this.pageIndex = Math.max(0, Math.min(this.pages.length - 1, Number.isFinite(start) ? start : 0));
    this.titleEl.textContent = this.writing ? '书与笔' : bookTitleOf(stack);

    this.pageEl.classList.toggle('hidden', !this.writing);
    this.readEl.classList.toggle('hidden', this.writing);
    this.signButton.classList.toggle('hidden', !this.writing);
    this.doneButton.classList.toggle('hidden', !this.writing);
    this.titleRow.classList.add('hidden');
    this.titleInput.value = '';

    this.syncPage();
    this.open = true;
    this.root.classList.remove('hidden');
    if (this.writing) {
      // 桌面上可以直接打字；手机上会唤起键盘（与告示牌编辑框同一条）
      this.pageEl.focus();
      this.pageEl.setSelectionRange(this.pageEl.value.length, this.pageEl.value.length);
    }
  }

  /** 收起（不提交） */
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.pageEl.blur();
    this.titleInput.blur();
    this.stack = null;
    this.onClose?.();
  }

  /** 离开世界时移除 DOM（监听都挂在 root 内，移除即解绑） */
  dispose(): void {
    this.root.remove();
  }

  // ---------------------------------------------------------------- 内部

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'book-button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private buildPageLabel(): HTMLSpanElement {
    const label = document.createElement('span');
    label.className = 'book-page-label';
    return label;
  }

  private get pageLabelEl(): HTMLSpanElement {
    return this.pagerEl.querySelector('.book-page-label') as HTMLSpanElement;
  }

  /** 把当前页写进界面（写模式填文本框，读模式填只读区） */
  private syncPage(): void {
    const page = this.pages[this.pageIndex] ?? '';
    if (this.writing) {
      // 只有值真的不同才改，否则每翻一页都会重置光标位置
      if (this.pageEl.value !== page) this.pageEl.value = page;
    } else {
      this.readEl.textContent = page === '' ? '（这一页什么也没写）' : page;
    }
    this.pageLabelEl.textContent = `第 ${this.pageIndex + 1} / ${this.pages.length} 页`;
    this.prevButton.disabled = this.pageIndex === 0;
    this.nextButton.disabled = this.pageIndex >= this.pages.length - 1;
  }

  private turnPage(delta: number): void {
    const next = this.pageIndex + delta;
    if (this.writing && next >= this.pages.length && this.pages.length >= BOOK_MAX_PAGES) return;
    // 写模式下"往后翻到新的一页"就是**加一页空白**（原版也是翻到最后一页再往后就多一页）
    if (this.writing && delta > 0 && next === this.pages.length) {
      this.pages.push('');
    }
    const target = Math.max(0, Math.min(this.pages.length - 1, next));
    if (target === this.pageIndex) return;
    // 翻页前把文本框里的内容落到 `pages`（input 事件在手机上偶发丢字，这里再兜一次）
    if (this.writing) this.pages[this.pageIndex] = this.pageEl.value;
    this.pageIndex = target;
    this.syncPage();
    this.onPageChange?.(this.pageIndex);
    if (this.writing) this.pageEl.focus();
  }

  /** 展开"书名"那一行；一页都没写就不让署名（原版也不让） */
  private beginSign(): void {
    if (!this.writing) return;
    this.pages[this.pageIndex] = this.pageEl.value;
    if (this.pages.every((page) => page.trim() === '')) {
      this.titleEl.textContent = '一页都没写，没法署名';
      return;
    }
    this.titleRow.classList.remove('hidden');
    this.titleInput.value = '';
    this.titleInput.focus();
  }

  private confirmSign(): void {
    if (!this.stack) return;
    this.pages[this.pageIndex] = this.pageEl.value;
    const written = signBook(withPages(this.stack, this.pages), this.titleInput.value || UNTITLED_BOOK);
    if (!written) {
      this.titleEl.textContent = '一页都没写，没法署名';
      return;
    }
    const committed = written;
    this.hideAndCommit(committed);
  }

  /** 「完成」：把写好的页收进那一叠（还是书与笔，可以下次接着写） */
  private save(): void {
    if (!this.stack) return;
    this.pages[this.pageIndex] = this.pageEl.value;
    this.hideAndCommit(withPages(this.stack, this.pages));
  }

  private hideAndCommit(stack: ItemStack): void {
    this.open = false;
    this.root.classList.add('hidden');
    this.pageEl.blur();
    this.titleInput.blur();
    this.stack = null;
    this.onCommit?.(stack);
    this.onClose?.();
  }
}
