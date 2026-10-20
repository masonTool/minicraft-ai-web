/**
 * 命令帮助弹窗（批次 533）
 *
 * 用户要求：
 *  - `/help` 不再往聊天历史里刷几十行，而是弹一个单独的界面；
 *  - 每条命令除了说明，还能用表单生成命令；
 *  - 有可选项的字段用下拉框；
 *  - 点“填入聊天框”只把命令放进输入框，不自动执行。
 *
 * 命令解析在 `core/commands/CommandHelp.ts`（纯逻辑、可离线断言），
 * 这里只负责 DOM、搜索、表单与预览。
 */

import {
  buildCommand,
  commandHelpEntries,
  variantLabel,
  type CommandHelpEntry,
  type CommandHelpField,
  type CommandHelpVariant,
} from '../core/commands/CommandHelp.ts';

export class CommandHelpScreen {
  readonly root: HTMLDivElement;

  /** 弹窗开关（App 用它暂停/恢复玩家输入） */
  onOpenChange: ((open: boolean) => void) | null = null;
  /** 玩家点“填入聊天框”：App 负责关闭弹窗并把命令放进聊天输入框 */
  onUse: ((command: string) => void) | null = null;

  private readonly entries = commandHelpEntries();
  private readonly searchEl: HTMLInputElement;
  private readonly listEl: HTMLDivElement;
  private readonly detailEl: HTMLDivElement;
  private readonly listeners = new AbortController();
  private open = false;
  private selectedName = '';
  private variantIndex = 0;
  private values: Record<string, string> = {};

  constructor(host: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'command-help';
    this.root.className = 'hidden';

    const panel = document.createElement('div');
    panel.className = 'cmd-help-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '命令帮助');

    const header = document.createElement('div');
    header.className = 'cmd-help-header';
    const title = document.createElement('b');
    title.className = 'cmd-help-title';
    title.textContent = '命令帮助';
    this.searchEl = document.createElement('input');
    this.searchEl.type = 'text';
    this.searchEl.className = 'world-input cmd-help-search';
    this.searchEl.placeholder = '搜索命令…';
    this.searchEl.spellcheck = false;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cmd-help-close';
    close.textContent = '✕';
    close.setAttribute('aria-label', '关闭');
    header.append(title, this.searchEl, close);

    const body = document.createElement('div');
    body.className = 'cmd-help-body';
    this.listEl = document.createElement('div');
    this.listEl.className = 'cmd-help-list';
    this.detailEl = document.createElement('div');
    this.detailEl.className = 'cmd-help-detail';
    body.append(this.listEl, this.detailEl);

    panel.append(header, body);
    this.root.appendChild(panel);
    host.appendChild(this.root);

    this.searchEl.addEventListener('input', () => this.renderList());
    close.addEventListener('click', () => this.hide());
    document.addEventListener(
      'keydown',
      (event) => {
        if (!this.open || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        this.hide();
      },
      { capture: true, signal: this.listeners.signal },
    );
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(initial?: string): void {
    if (this.open) {
      if (initial) this.select(initial);
      return;
    }
    this.open = true;
    this.root.classList.remove('hidden');
    this.searchEl.value = '';
    this.renderList();
    // 未知命令（`/help nope`）回落到 help，而不是停在上一页空白
    this.selectedName = '';
    this.select(initial ?? 'help');
    if (this.selectedName === '') this.select('help');
    this.onOpenChange?.(true);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.onOpenChange?.(false);
  }

  close(): void {
    this.hide();
  }

  destroy(): void {
    this.listeners.abort();
    this.root.remove();
  }

  /** 打开某条命令（`/help give` 会走到这里） */
  select(name: string): void {
    const wanted = name.replace(/^\//, '').trim().toLowerCase();
    const entry = this.entries.find((item) => item.name === wanted);
    if (!entry) return;
    this.selectedName = entry.name;
    this.variantIndex = 0;
    this.resetValues(entry);
    this.renderList();
    this.renderDetail();
  }

  private resetValues(entry: CommandHelpEntry): void {
    this.values = {};
    const variant = entry.variants[this.variantIndex];
    for (const field of fieldsOf(variant)) {
      this.values[field.key] = defaultFieldValue(field);
      if (field.kind === 'combo') this.values[`${field.key}__custom`] = '';
    }
  }

  private renderList(): void {
    const query = this.searchEl.value.trim().toLowerCase();
    const items = this.entries.filter((entry) => {
      if (query.length === 0) return true;
      return (
        entry.name.includes(query) ||
        entry.description.toLowerCase().includes(query) ||
        entry.usage.toLowerCase().includes(query)
      );
    });

    this.listEl.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cmd-help-empty';
      empty.textContent = '没有匹配的命令';
      this.listEl.appendChild(empty);
      return;
    }

    for (const entry of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cmd-help-item';
      button.classList.toggle('active', entry.name === this.selectedName);
      const name = document.createElement('span');
      name.className = 'cmd-help-item-name';
      name.textContent = `/${entry.name}`;
      const desc = document.createElement('span');
      desc.className = 'cmd-help-item-desc';
      desc.textContent = entry.description;
      button.append(name, desc);
      button.addEventListener('click', () => this.select(entry.name));
      this.listEl.appendChild(button);
    }
  }

  private renderDetail(): void {
    const entry = this.entries.find((item) => item.name === this.selectedName);
    this.detailEl.replaceChildren();
    if (!entry) return;

    const head = document.createElement('div');
    head.className = 'cmd-help-detail-head';
    const title = document.createElement('b');
    title.textContent = `/${entry.name}`;
    head.appendChild(title);
    if (entry.creativeOnly) {
      const tag = document.createElement('span');
      tag.className = 'cmd-help-tag';
      tag.textContent = '需要创造模式';
      head.appendChild(tag);
    }

    const usage = document.createElement('div');
    usage.className = 'cmd-help-usage';
    usage.textContent = entry.usage;

    const desc = document.createElement('div');
    desc.className = 'cmd-help-desc';
    desc.textContent = entry.description;

    this.detailEl.append(head, usage, desc);

    if (entry.variants.length > 1) {
      const modeField = document.createElement('div');
      modeField.className = 'cmd-help-field';
      const label = document.createElement('label');
      label.textContent = '操作';
      const select = document.createElement('select');
      select.className = 'world-input';
      entry.variants.forEach((variant, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = variantLabel(variant);
        select.appendChild(option);
      });
      select.value = String(this.variantIndex);
      select.addEventListener('change', () => {
        this.variantIndex = Number(select.value);
        this.resetValues(entry);
        this.renderDetail();
      });
      modeField.append(label, select);
      this.detailEl.appendChild(modeField);
    }

    const variant = entry.variants[this.variantIndex];
    if (variant) {
      const form = document.createElement('div');
      form.className = 'cmd-help-form';
      for (const field of fieldsOf(variant)) {
        form.appendChild(this.renderField(field));
      }
      if (form.childElementCount > 0) this.detailEl.appendChild(form);
    }

    const preview = document.createElement('div');
    preview.className = 'cmd-help-preview';
    const error = document.createElement('div');
    error.className = 'cmd-help-error';
    const actions = document.createElement('div');
    actions.className = 'cmd-help-actions';
    const fill = document.createElement('button');
    fill.type = 'button';
    fill.className = 'cmd-help-fill';
    fill.textContent = '填入聊天框';
    fill.addEventListener('click', () => {
      const command = buildCommand(entry, this.variantIndex, this.values);
      if (command) this.onUse?.(command);
    });
    actions.appendChild(fill);
    this.detailEl.append(preview, error, actions);
    this.updatePreview(entry, preview, error, fill);
  }

  private renderField(field: CommandHelpField): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'cmd-help-field';
    const label = document.createElement('label');
    label.textContent = field.optional ? `${field.label}（可选）` : field.label;
    wrap.appendChild(label);

    if (field.kind === 'select' || field.kind === 'combo') {
      const select = document.createElement('select');
      select.className = 'world-input';
      if (field.optional) {
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '不填';
        select.appendChild(empty);
      }
      for (const option of field.options ?? []) {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = option.label;
        select.appendChild(item);
      }
      let custom: HTMLInputElement | null = null;
      if (field.kind === 'combo') {
        const customOption = document.createElement('option');
        customOption.value = '__custom__';
        customOption.textContent = '自定义…';
        select.appendChild(customOption);
        custom = document.createElement('input');
        custom.type = 'text';
        custom.className = 'world-input cmd-help-combo-custom';
        custom.placeholder = field.customPlaceholder ?? '自定义';
        custom.value = this.values[`${field.key}__custom`] ?? '';
        custom.hidden = (this.values[field.key] ?? '') !== '__custom__';
        custom.addEventListener('input', () => {
          this.values[`${field.key}__custom`] = custom!.value;
          this.refreshPreview();
        });
      }
      select.value = this.values[field.key] ?? '';
      select.addEventListener('change', () => {
        this.values[field.key] = select.value;
        if (custom) custom.hidden = select.value !== '__custom__';
        this.refreshPreview();
      });
      wrap.appendChild(select);
      if (custom) wrap.appendChild(custom);
      return wrap;
    }

    const input = document.createElement('input');
    input.type = field.kind === 'number' ? 'number' : 'text';
    input.className = 'world-input';
    input.placeholder = field.placeholder ?? '';
    input.value = this.values[field.key] ?? '';
    if (field.kind === 'number') input.inputMode = 'numeric';
    input.addEventListener('input', () => {
      this.values[field.key] = input.value;
      this.refreshPreview();
    });
    wrap.appendChild(input);
    return wrap;
  }

  private refreshPreview(): void {
    const entry = this.entries.find((item) => item.name === this.selectedName);
    if (!entry) return;
    const preview = this.detailEl.querySelector<HTMLElement>('.cmd-help-preview');
    const error = this.detailEl.querySelector<HTMLElement>('.cmd-help-error');
    const fill = this.detailEl.querySelector<HTMLButtonElement>('.cmd-help-fill');
    if (preview && error && fill) this.updatePreview(entry, preview, error, fill);
  }

  private updatePreview(
    entry: CommandHelpEntry,
    preview: HTMLElement,
    error: HTMLElement,
    fill: HTMLButtonElement,
  ): void {
    const command = buildCommand(entry, this.variantIndex, this.values);
    preview.textContent = command ?? '请先填写必填项';
    preview.classList.toggle('bad', command === null);
    error.textContent = command === null ? '还有必填项没有填' : '';
    fill.disabled = command === null;
  }
}

function fieldsOf(variant: CommandHelpVariant | undefined): CommandHelpField[] {
  if (!variant) return [];
  return variant.parts
    .filter((part): part is { kind: 'field'; field: CommandHelpField } => part.kind === 'field')
    .map((part) => part.field);
}

function defaultFieldValue(field: CommandHelpField): string {
  if (field.kind !== 'select') return '';
  if (field.optional) return '';
  return field.options?.[0]?.value ?? '';
}
