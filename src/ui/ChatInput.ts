/**
 * 聊天与命令输入（屏幕左下角）
 *
 * 同时承担两件事：
 *  - **消息栏**：联机聊天、命令反馈、系统提示（如"难度已设置为普通"）都在这里滚
 *  - **命令输入**：`T` 或 `/` 打开，Enter 提交，Esc 取消，↑↓ 翻历史，Tab 补全
 *
 * 为什么不直接做一个 `<input>` 常驻：原版是"按键才出现输入行"，常驻会挡住视野；
 * 而且消息栏要能自己淡出（批次 223：整条消息 3 秒后彻底消失，见 `LINE_LIFETIME`）。
 */

import { t } from '../core/i18n/I18n.ts';
import { commandNames, mobNames } from '../core/commands/Commands.ts';
import { resolveItemId } from '../core/registry/itemNames.ts';
import { isTouchUi } from './TouchControls.ts';

export type ChatLineKind = 'player' | 'system' | 'error' | 'damage' | 'gain' | 'warning';

/** 打开输入框的选项（批次 220） */
export interface ChatOpenOptions {
  /**
   * 是否把焦点放进输入框（默认 `true`）。
   *
   * 手机点消息进来时传 `false`：聚焦会立刻弹起虚拟键盘，而玩家可能只是想翻记录。
   * 想打字时再点一下输入框即可（那一下是玩家自己的意图）。
   */
  focus?: boolean;
}

interface ChatLine {
  text: string;
  kind: ChatLineKind;
  /** 到期时间（毫秒）；到点后变淡，再 4 秒后移出 DOM */
  expires: number;
  /**
   * 这一行被玩家点开了（批次 279）。
   *
   * 状态存在**消息**上而不是 DOM 上：`renderLog` 每次新消息/展开/收起都会重建 DOM，
   * 存在元素上会被下一帧的 `replaceChildren` 丢掉。
   */
  expanded?: boolean;
}

/**
 * 消息在屏幕上停留的时间（毫秒）。
 *
 * 批次 220 曾按"一秒就消失"压到 1 秒，批次 223 用户回头看觉得太赶，改成 **3 秒**。
 * 拆成两段是为了"消失"有个淡出、而不是硬切：
 *  - `LINE_LIFETIME` 内完全清晰（2.2 秒，够扫一眼受伤原因 / 天气变化）；
 *  - 之后按 `FADE_AFTER` 淡出，`2200 + 800 = 3 秒`后连同 DOM 一起移出。
 * 想调长短只改这两个常量（历史消息不会丢：打开输入框仍能翻最近 120 行）。
 */
const LINE_LIFETIME = 2200;
const FADE_AFTER = 800;
/** 收起时最多显示的行数 */
const MAX_LINES = 10;
/**
 * 打开输入框后能翻的历史行数（批次 206）。
 *
 * 用户："点击聊天输入框时，历史信息要能看到，可以通过滑动去查看。"
 * 以前消息 14 秒就从数组里删掉了，打开输入框也只剩正在淡出的那几行；
 * 现在消息留在内存里（最多 `MAX_STORED_LINES` 条），收起时只显示最近 10 行、
 * 打开时把最近 120 行铺出来并允许滚动。
 */
const MAX_OPEN_LINES = 120;
/** 内存里最多留多少条（再多就从最旧的丢） */
const MAX_STORED_LINES = 300;
/** 命令历史条数 */
const MAX_HISTORY = 32;

export class ChatInput {
  readonly root: HTMLDivElement;

  /** 提交一行（由 App 接：命令或联机聊天） */
  onSubmit: ((text: string) => void) | null = null;
  /** 打开/关闭回调（App 用它暂停/恢复玩家输入） */
  onOpenChange: ((open: boolean) => void) | null = null;

  private readonly logEl: HTMLDivElement;
  /** 输入行（输入框 + 发送键）单独一组：打开时放在**最上面**（左上角） */
  private readonly entryEl: HTMLDivElement;
  private readonly inputEl: HTMLInputElement;
  private readonly hintEl: HTMLDivElement;
  /** 触屏的"发送"按钮：手机虚拟键盘的确定键不一定派发 Enter 的 keydown */
  private readonly sendButton: HTMLButtonElement;
  /** 所有消息（含已经淡出的）：打开输入框时要能翻历史 */
  private readonly messages: ChatLine[] = [];
  /** 命令历史（↑↓ 翻的是这个，不是聊天记录） */
  private readonly history: string[] = [];
  private historyIndex = -1;
  /** 上一次渲染从哪一条开始（没变就不重建 DOM） */
  private renderedStart = -1;
  /**
   * 打开时是否贴着**顶部**（批次 209：新消息在上、旧消息在下）。
   * 玩家往下翻看旧消息时不要被新消息拽回去。
   */
  private stickToTop = true;
  private open = false;
  /**
   * 打开的时刻（批次 209）。
   *
   * 手机上"点聊天按钮 → 窗口闪一下又关掉"：打开动作本身发生在 `pointerdown` 里，
   * 同一笔手势还会继续走到 document 的"点外面就关"监听（部分内核的 target 不是按钮）。
   * 这里给一个很短的免疫窗口，把"打开它的那一下"排除掉。
   */
  private openedAt = 0;
  /** 补全候选（按 Tab 在候选之间轮换） */
  private completionIndex = 0;
  /** 上一次补全时的前缀（用来决定是换候选还是重新开始） */
  private lastPrefix = '';
  /**
   * 全局监听的解绑开关（批次 181）。
   *
   * 应用内退出世界会销毁整局 App；不解绑的话，旧聊天框还在听 document 的
   * pointerdown，回到主菜单后点一下就会去关一个已经不在界面上的输入框。
   */
  private readonly listeners = new AbortController();

  constructor(host: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'chat';

    this.logEl = document.createElement('div');
    this.logEl.className = 'chat-log';

    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.className = 'chat-input hidden';
    this.inputEl.maxLength = 256;
    this.inputEl.spellcheck = false;

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'chat-hint hidden';

    this.sendButton = document.createElement('button');
    this.sendButton.type = 'button';
    this.sendButton.className = 'chat-send hidden';
    this.sendButton.textContent = t('chat.send');
    this.sendButton.setAttribute('aria-label', '发送');
    // pointerdown 而不是 click：click 之前浏览器会先把焦点从输入框移走，
    // 手机上会顺手收起键盘、甚至把整个输入行关掉（preventDefault 才不会）
    this.sendButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.submit();
    });

    this.entryEl = document.createElement('div');
    this.entryEl.className = 'chat-entry hidden';
    this.entryEl.append(this.inputEl, this.sendButton);
    // 输入行在最上面（左上角），下面是提示与历史；打开时新消息排在最前
    this.root.append(this.entryEl, this.hintEl, this.logEl);
    host.appendChild(this.root);

    this.inputEl.addEventListener('keydown', (event) => this.onInputKeyDown(event));
    // 显示期间点一下 ⇒ 直接进入聊天（批次 220）。
    // 只在 `#chat.peek` 期间有效（CSS 给 `.chat-log` 开了 pointer-events），
    // 所以没有消息时这一层根本不接手势，不会抢走转视角。
    // `focus: false`：手机不弹键盘；`stopPropagation`：这一下不该再落到视角/放置上。
    this.logEl.addEventListener(
      'pointerdown',
      (event) => {
        // 点到一条"超出一行、可折叠"的消息：这一下归折叠/展开，不是"打开聊天"。
        // 不 preventDefault：拖动滚动时浏览器不会派发 click，正好不会误触发。
        const foldable = (event.target as Element | null)?.closest?.('.chat-line.collapsible');
        if (foldable) {
          event.stopPropagation();
          return;
        }
        if (this.open) return;
        event.preventDefault();
        event.stopPropagation();
        this.openWith('', { focus: false });
      },
      { signal: this.listeners.signal },
    );
    // 折叠消息：点击展开 / 再点收起。用 click 而不是 pointerdown，
    // 这样"在历史里上下滑动"不会把路过的每一行都展开。
    this.logEl.addEventListener(
      'click',
      (event) => {
        const element = (event.target as Element | null)?.closest?.('.chat-line.collapsible');
        if (!element) return;
        event.preventDefault();
        event.stopPropagation();
        const lineEl = element as HTMLElement;
        const index = Number(lineEl.dataset.chatIndex);
        const line = this.messages[index];
        if (!line) return;
        line.expanded = line.expanded !== true;
        lineEl.classList.toggle('expanded', line.expanded);
        lineEl.title = line.expanded ? '点击收起' : '点击展开';
      },
      { signal: this.listeners.signal },
    );
    // 滚动历史时如果停在底部附近，新消息就继续跟随；翻到上面看旧消息时不要跳回底部
    this.logEl.addEventListener(
      'scroll',
      () => {
        // 新消息在顶部：停在最上面（scrollTop≈0）时继续跟随
        this.stickToTop = this.logEl.scrollTop < 24;
      },
      { signal: this.listeners.signal },
    );
    // 点输入框以外的地方就关掉输入（和原版一致）
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.open) return;
        if (this.root.contains(event.target as Node)) return;
        // 打开它的那一下 / 顶部那颗聊天键本身都不算"点外面"
        if (performance.now() - this.openedAt < 350) return;
        if ((event.target as Element | null)?.closest?.('#touch-pause')) return;
        this.close();
      },
      { signal: this.listeners.signal },
    );
  }

  /** 离开世界时移除 DOM 与全局监听（批次 181） */
  dispose(): void {
    this.listeners.abort();
    this.root.remove();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 消息栏里的文字（验收脚本用：只给当前屏幕上那几条） */
  get messageLines(): string[] {
    return this.visibleRange(performance.now()).lines.map((line) => line.text);
  }

  /** 全部历史消息（验收脚本用：打开输入框后能翻到的那些） */
  get historyLines(): string[] {
    return this.messages.map((line) => line.text);
  }

  /** 追加一行消息 */
  push(text: string, kind: ChatLineKind = 'system'): void {
    // 空消息不占行：命令/系统提示偶尔会拼出空串，留在列表里就是一条
    // "看得见高度、看不见字"的空白条（批次 532 用户反馈的"不知名空格"）。
    if (text.trim().length === 0) return;
    this.messages.push({ text, kind, expires: performance.now() + LINE_LIFETIME });
    while (this.messages.length > MAX_STORED_LINES) this.messages.shift();
    this.renderLog();
    console.info(`[chat] ${text}`);
  }

  openWith(prefill = '', options: ChatOpenOptions = {}): void {
    if (this.open) return;
    this.open = true;
    this.openedAt = performance.now();
    this.root.classList.add('open');
    this.root.classList.remove('peek');
    this.entryEl.classList.remove('hidden');
    this.inputEl.classList.remove('hidden');
    this.hintEl.classList.remove('hidden');
    this.sendButton.classList.remove('hidden');
    this.inputEl.value = prefill;
    // 批次 220：点消息进来时不聚焦（手机不弹键盘）；键盘/按 T 进来仍然聚焦
    if (options.focus !== false) {
      this.inputEl.focus();
      // 光标放到末尾（`/` 预填时就在斜杠后面）
      this.inputEl.setSelectionRange(prefill.length, prefill.length);
    }
    this.historyIndex = -1;
    this.lastPrefix = '';
    // 打开这一刻铺出历史并停在最上面（最新的一条）；往下滑才是更早的消息
    this.stickToTop = true;
    this.renderedStart = -1;
    this.renderLog();
    this.updateHint();
    this.onOpenChange?.(true);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('open');
    this.entryEl.classList.add('hidden');
    this.inputEl.classList.add('hidden');
    this.hintEl.classList.add('hidden');
    this.sendButton.classList.add('hidden');
    this.inputEl.blur();
    // 收起后回到"只显示最近 10 行 + 淡出"的观感
    this.renderedStart = -1;
    this.renderLog();
    this.onOpenChange?.(false);
  }

  /** 提交当前输入（Enter 与"发送"按钮共用同一条路径，避免两处行为漂移） */
  private submit(): void {
    const text = this.inputEl.value.trim();
    this.close();
    if (text.length === 0) return;
    this.history.push(text);
    while (this.history.length > MAX_HISTORY) this.history.shift();
    this.onSubmit?.(text);
  }

  /** 每帧调用：收起时把过期消息淡出（打开时保留全部，让玩家慢慢翻） */
  update(now = performance.now()): void {
    const { start, lines } = this.visibleRange(now);
    if (start !== this.renderedStart) {
      this.renderLog(now);
      return;
    }
    // 只更新透明度（不重建 DOM）
    const children = this.logEl.children;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const element = children[i] as HTMLElement | undefined;
      if (!element) continue;
      const fading = !this.open && now > line.expires;
      element.classList.toggle('fading', fading);
    }
  }

  /**
   * 当前应该显示哪一段消息。
   *
   * - **收起**：只留还没完全淡出的，最多 10 行（多出来的旧消息仍然在数组里）；
   * - **打开**：最近 120 行全铺出来，可以滑动查看。
   */
  private visibleRange(now: number): { start: number; lines: ChatLine[] } {
    const end = this.messages.length;
    if (this.open) {
      const start = Math.max(0, end - MAX_OPEN_LINES);
      return { start, lines: this.messages.slice(start) };
    }
    let first = end;
    for (let i = 0; i < end; i++) {
      if (now <= this.messages[i]!.expires + FADE_AFTER) {
        first = i;
        break;
      }
    }
    const start = Math.max(first, end - MAX_LINES);
    return { start, lines: this.messages.slice(start) };
  }

  private renderLog(now = performance.now()): void {
    const { start, lines } = this.visibleRange(now);
    this.renderedStart = start;
    // 收起且有消息 → 开放点击（批次 220）。全部过期后这一行会把 `.peek` 摘掉，
    // 于是左上角那块区域重新变成 `pointer-events: none`，不会吃转视角的手势。
    this.root.classList.toggle('peek', !this.open && lines.length > 0);
    const fragment = document.createDocumentFragment();
    // 批次 209：**新消息在上、旧消息在下**（与常见聊天软件一致）。
    // `visibleRange` 仍按时间正序切片，这里倒过来插 DOM。
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      const element = document.createElement('div');
      element.className = `chat-line chat-${line.kind}`;
      // 记住它对应 `messages` 里的下标：点击展开时要改**消息对象**上的状态
      (element as HTMLElement).dataset.chatIndex = String(start + i);
      element.textContent = line.text;
      if (line.text.includes('\n')) {
        // 多行反馈（/gamerule 那种）保留换行；/help 已经是一条一行了
        element.classList.add('chat-multiline');
      } else {
        // 先按"单行"插进去，再用实际布局判断它到底有没有超出：
        // 放得下就把 `.collapsible` 摘掉（不会出现没必要的点击手势）。
        element.classList.add('collapsible');
        if (line.expanded === true) element.classList.add('expanded');
      }
      // 打开输入框时不要淡出：玩家是来翻历史的，看不清就等于没有
      if (!this.open && now > line.expires) element.classList.add('fading');
      fragment.appendChild(element);
    }
    const previousTop = this.logEl.scrollTop;
    this.logEl.replaceChildren(fragment);
    // 折叠判定必须在 DOM 里量：`nowrap` 下 `scrollWidth > clientWidth` 就是"超出一行"。
    // ⚠️ 已展开的行不要摘 `.collapsible`，否则再点一下就没法收起了。
    for (const element of this.logEl.children) {
      if (!element.classList.contains('collapsible')) continue;
      const html = element as HTMLElement;
      if (element.classList.contains('expanded')) {
        html.title = '点击收起';
        continue;
      }
      if (html.scrollWidth <= html.clientWidth + 1) {
        element.classList.remove('collapsible');
        html.removeAttribute('title');
      } else {
        html.title = '点击展开';
      }
    }
    // 只有停在顶部才自动跟到最新；玩家往下翻旧消息时保留原来的滚动位置
    this.logEl.scrollTop = this.stickToTop ? 0 : previousTop;
  }

  private onInputKeyDown(event: KeyboardEvent): void {
    // 输入框里的按键不要冒泡给游戏（否则打字会带着角色走）
    event.stopPropagation();

    if (event.code === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.code === 'Enter' || event.code === 'NumpadEnter') {
      event.preventDefault();
      this.submit();
      return;
    }

    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      event.preventDefault();
      this.cycleHistory(event.code === 'ArrowUp' ? 1 : -1);
      return;
    }

    if (event.code === 'Tab') {
      event.preventDefault();
      this.complete();
    }
  }

  private cycleHistory(delta: number): void {
    if (this.history.length === 0) return;
    this.historyIndex += delta;
    if (this.historyIndex < 0) this.historyIndex = 0;
    if (this.historyIndex >= this.history.length) {
      this.historyIndex = this.history.length;
      this.inputEl.value = '';
      return;
    }
    this.inputEl.value = this.history[this.history.length - 1 - this.historyIndex]!;
    this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
  }

  /**
   * Tab 补全：命令名 → 命令的第一个参数（物品 / 生物）。
   * 连续按 Tab 在同一前缀的候选之间轮换，与原版一致。
   */
  private complete(): void {
    const value = this.inputEl.value;

    if (!value.startsWith('/')) {
      this.inputEl.value = '/';
      this.lastPrefix = '';
      this.updateHint();
      return;
    }

    const parts = value.slice(1).split(/\s+/);
    const atCommand = parts.length <= 1;

    // 已输入内容 = 前面的部分（含分隔空格）+ 正在补的那一段
    const typedHead = atCommand ? '/' : `/${parts.slice(0, -1).join(' ')} `;
    const typedTail = atCommand ? parts[0] ?? '' : parts[parts.length - 1] ?? '';
    const typed = `${typedHead}${typedTail}`.toLowerCase();

    const pool = atCommand
      ? commandNames().map((name) => `/${name}`)
      : this.argumentCandidates(parts[0]!.toLowerCase()).map((name) => `${typedHead}${name}`);
    const matches = pool.filter((candidate) => candidate.toLowerCase().startsWith(typed));

    if (matches.length > 0) {
      if (this.lastPrefix !== typed) {
        this.lastPrefix = typed;
        this.completionIndex = 0;
      } else {
        this.completionIndex = (this.completionIndex + 1) % matches.length;
      }
      this.inputEl.value = matches[this.completionIndex]!;
      this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
    }
    this.updateHint();
  }

  private argumentCandidates(command: string): string[] {
    switch (command) {
      case 'summon':
        return mobNames();
      case 'difficulty':
        return ['peaceful', 'easy', 'normal', 'hard'];
      case 'weather':
        return ['clear', 'rain', 'thunder'];
      case 'time':
        return ['set', 'add'];
      case 'gamerule':
        return [
          'keepInventory',
          'doMobSpawning',
          'mobGriefing',
          'doDaylightCycle',
          'naturalRegeneration',
          'randomTickSpeed',
        ];
      case 'gamemode':
        return ['creative', 'survival'];
      case 'effect':
        return ['give', 'clear'];
      case 'give':
      case 'setblock':
      case 'fill':
        return commonBlockNames();
      default:
        return [];
    }
  }

  /**
   * 输入框下面那行小字：显示用法提示与"还有 N 个候选"。
   *
   * 触摸端（批次 104）不提 Enter / Esc / Tab：手机虚拟键盘上这几个键要么没有、
   * 要么藏在二级面板里，真正的提交方式是下面那颗"发送"。
   */
  private updateHint(): void {
    const touch = isTouchUi();
    const value = this.inputEl.value;
    if (!value.startsWith('/') || value.length < 2) {
      this.hintEl.textContent = touch
        ? '输入命令（/help 查看全部）或直接发言，点"发送"提交'
        : '输入命令（/help 查看全部）或直接发言，Enter 提交，Esc 取消';
      return;
    }
    const prefix = value.slice(1).split(/\s+/)[0]!.toLowerCase();
    const matches = commandNames().filter((name) => name.startsWith(prefix));
    if (matches.length === 0) {
      this.hintEl.textContent = t('chat.noCommandMatch');
      return;
    }
    if (matches.length === 1 && matches[0] === prefix) {
      this.hintEl.textContent = touch
        ? '点"发送"提交（手机上没有 Tab 补全，参数要打全）'
        : 'Tab 补全参数 · Enter 提交 · ↑↓ 翻历史';
      return;
    }
    this.hintEl.textContent = `候选：${matches.slice(0, 6).join(' / ')}${matches.length > 6 ? ' …' : ''}${
      touch ? '' : '（Tab 补全）'
    }`;
  }
}

/** 常用物品名（补全用）：从创造物品栏里挑前若干个人类常打错的重点 */
function commonBlockNames(): string[] {
  const names = [
    'stone', 'cobblestone', 'dirt', 'grass_block', 'sand', 'gravel', 'oak_log', 'oak_planks',
    'oak_leaves', 'glass', 'bricks', 'stone_bricks', 'sandstone', 'obsidian', 'glowstone',
    'water', 'lava', 'torch', 'crafting_table', 'furnace', 'chest', 'oak_door', 'ladder',
    'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore', 'lapis_ore', 'emerald_ore',
    'diamond', 'iron_ingot', 'gold_ingot', 'coal', 'stick', 'apple', 'diamond_pickaxe',
  ];
  // 只保留真实存在的名字，避免补全出不存在的东西
  return names.filter((name) => resolveItemId(name) !== undefined);
}
