/**
 * 通用下拉控件（批次 528）
 *
 * 设置页与新建世界表单共用同一个组件：外观/行为完全一致，避免"两套下拉
 * 各修一半"的老问题。样式沿用 `settings-dropdown*` 那一组类名。
 *
 * 菜单挂在 `<body>` 上并 `position: fixed`：设置内容区与背包都是滚动容器，
 * 菜单留在行内会被 `overflow-y: auto` 裁掉。
 */

export interface DropdownOptions {
  /** 额外的包装类名（例如世界表单里的 `world-dropdown`） */
  className?: string;
  /** 按钮铺满父容器（世界表单的控件列用） */
  fullWidth?: boolean;
}

/** 当前展开的下拉（同一时间只允许一个） */
let activeDropdown: { close: () => void } | null = null;

export class Dropdown<T extends string> {
  /** 包装节点（`.settings-dropdown`），直接放进设置行/世界表单行 */
  readonly element: HTMLDivElement;
  readonly button: HTMLButtonElement;

  private readonly menu: HTMLDivElement;
  private readonly optionButtons: Array<{ value: T; button: HTMLButtonElement }> = [];
  private current: T;
  /** 展开期间才挂的全局监听（关闭就 abort，不在每个实例上常驻） */
  private openListeners: AbortController | null = null;

  constructor(
    values: readonly T[],
    private readonly labels: Record<T, string>,
    initial: T,
    private readonly onChange: (value: T) => void,
    options: DropdownOptions = {},
  ) {
    this.current = initial;

    this.element = document.createElement('div');
    this.element.className = 'settings-dropdown';
    if (options.fullWidth) this.element.classList.add('settings-dropdown-full');
    if (options.className) this.element.classList.add(options.className);

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'settings-dropdown-button';
    this.button.setAttribute('aria-haspopup', 'listbox');
    this.button.setAttribute('aria-expanded', 'false');

    this.menu = document.createElement('div');
    this.menu.className = 'settings-dropdown-menu';
    this.menu.setAttribute('role', 'listbox');
    this.menu.style.display = 'none';
    document.body.appendChild(this.menu);

    for (const value of values) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'settings-dropdown-option';
      option.setAttribute('role', 'option');
      option.textContent = labels[value];
      option.addEventListener('click', () => {
        if (this.current !== value) {
          this.current = value;
          this.sync();
          this.onChange(value);
        }
        this.close();
      });
      this.menu.appendChild(option);
      this.optionButtons.push({ value, button: option });
    }

    this.button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.isOpen) this.close();
      else this.open();
    });

    this.element.appendChild(this.button);
    this.sync();
  }

  get value(): T {
    return this.current;
  }

  get isOpen(): boolean {
    return this.openListeners !== null;
  }

  /** 外部状态变了（例如游戏模式被 /gamemode 改掉）：按真实值重画 */
  setValue(value: T): void {
    this.current = value;
    this.sync();
  }

  /** 按当前值重画按钮与选中态 */
  sync(): void {
    this.button.textContent = `${this.labels[this.current]} ▾`;
    for (const option of this.optionButtons) {
      const on = option.value === this.current;
      option.button.classList.toggle('selected', on);
      option.button.setAttribute('aria-selected', String(on));
    }
  }

  /** 展开菜单（同一时间只保留一个） */
  open(): void {
    if (this.isOpen) return;
    activeDropdown?.close();
    this.sync();
    this.place();
    this.openListeners = new AbortController();
    const signal = this.openListeners.signal;

    document.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target as Node | null;
        if (target && (this.button.contains(target) || this.menu.contains(target))) return;
        this.close();
      },
      { capture: true, signal },
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        this.close();
      },
      { capture: true, signal },
    );
    document.addEventListener('scroll', () => this.close(), { capture: true, signal });
    window.addEventListener('resize', () => this.close(), { signal });

    activeDropdown = this;
    this.button.setAttribute('aria-expanded', 'true');
  }

  close(): void {
    if (!this.isOpen) return;
    this.openListeners?.abort();
    this.openListeners = null;
    this.menu.style.display = 'none';
    this.button.setAttribute('aria-expanded', 'false');
    if (activeDropdown === this) activeDropdown = null;
  }

  /** 展开时的定位：上下取空间更大的一侧，菜单高度夹在可用空间内 */
  private place(): void {
    const rect = this.button.getBoundingClientRect();
    this.menu.style.display = 'block';
    this.menu.style.visibility = 'hidden';
    this.menu.style.width = `${Math.max(rect.width, 132)}px`;
    this.menu.style.maxHeight = 'none';

    const desired = Math.min(240, this.menu.scrollHeight);
    const spaceBelow = innerHeight - rect.bottom - 6;
    const spaceAbove = rect.top - 6;
    const openUp = spaceBelow < desired && spaceAbove > spaceBelow;
    const available = Math.max(80, openUp ? spaceAbove : spaceBelow);
    this.menu.style.maxHeight = `${Math.min(desired, available)}px`;

    const menuRect = this.menu.getBoundingClientRect();
    const left = Math.min(
      Math.max(4, rect.right - menuRect.width),
      Math.max(4, innerWidth - menuRect.width - 4),
    );
    let top = openUp ? rect.top - menuRect.height - 2 : rect.bottom + 2;
    top = Math.max(4, Math.min(top, innerHeight - menuRect.height - 4));
    this.menu.style.left = `${left}px`;
    this.menu.style.top = `${top}px`;
    this.menu.style.visibility = 'visible';
    this.menu.style.display = 'block';
  }

  dispose(): void {
    this.close();
    this.menu.remove();
    this.element.remove();
  }
}
