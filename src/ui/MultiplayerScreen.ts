/**
 * 联机入口（联机9）：地址 / 昵称 / **开房或加入** / 断开 / 状态。
 *
 * 刻意**不做大厅**：没有房间列表、没有玩家列表、没有服务器浏览器。这一版只要能
 * "填个地址连上去、能断开、知道现在是什么状态"，其余（房间码、密码、观战）留给
 * 后面的条目——大厅会把这块界面撑得又高又复杂，而手机横屏只有 360~430 高。
 *
 * **两个连接动作（L8 房主权威）**：`开房` 与 `加入` 填的是同一份地址与昵称，差别只有
 * 一个布尔位——`join` 里的 `host`。房主是这一局**唯一**跑模拟的人（红石、生物、容器
 * 计时都在他那边算），加入的人只渲染。所以不能合成一颗"连接"：点错了就会占住房主位，
 * 而别人随即进不来（服务端会回 `host-taken`）。
 *
 * 布局按横屏设计（用户主要在横屏手机上玩）：两行输入横排（标签固定宽 + 输入框吃掉
 * 剩余宽度）、一行状态、一行按钮，整体约 200px 高。
 *
 * 职责边界：**只管界面与输入清洗**。真的连接/断开交给调用方（`main.ts` 的
 * `connect()` / `disconnect()`），状态由 `onStatus` 回调推进来。这样这个模块在
 * Node 里也能测（纯函数 + DOM），不需要 WebSocket。
 */

import { t } from '../core/i18n/I18n.ts';

/** 面板状态；与 `NetSession` 的会话状态一一对应（`idle` 表示没连过） */
export type MultiplayerScreenState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface MultiplayerScreenActions {
  /**
   * 点了"开房"或"加入"：地址已经过 `normalizeServerUrl`，昵称已经过
   * `sanitizeMultiplayerName`。
   *
   * `host` 是这两颗按钮**唯一**的差别，最终落到 `join` 消息的 `host` 位：
   * 房主跑模拟，其他人只渲染（见 `core/net/NetRole.ts`）。
   */
  onConnect: (url: string, name: string, host: boolean) => void;
  onDisconnect: () => void;
  onClose: () => void;
}

/** localStorage 记住上次填的地址与昵称（手机上每次手输 ws:// 加 IP 太痛苦） */
const STORAGE_URL = 'mc.mp.url';
const STORAGE_NAME = 'mc.mp.name';
/** 昵称上限与服务端 `sanitizeName` 对齐（按字符算，不按字节） */
export const MULTIPLAYER_NAME_MAX = 16;
const DEFAULT_NAME = '玩家';

/**
 * 把用户输入的地址收成 `ws://` 或 `wss://`。
 *
 * 手机上最容易漏的就是协议头：填 `192.168.1.5:8787` 是常态，所以不合法的话直接补
 * `ws://`；反过来填了 `http(s)://`（很多人记成网页地址）也顺手映射到 `ws(s)://`
 * ——这两种"猜"都能命中真实意图，而报错只会让人退出去重来。
 *
 * 空串、带空白、没有主机名的一律返回 `null`（交给界面提示 `mp.error.url`）。
 */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  let value = trimmed;
  if (/^https:\/\//i.test(value)) value = `wss://${value.slice('https://'.length)}`;
  else if (/^http:\/\//i.test(value)) value = `ws://${value.slice('http://'.length)}`;
  else if (!/^wss?:\/\//i.test(value)) value = `ws://${value}`;

  // 末尾的斜杠对 WebSocket 没意义（`ws://host:8787/` 与不带斜杠等价），统一去掉
  value = value.replace(/\/+$/, '');
  // 主机名必须存在、且不含空白（`ws://foo bar:8787` 这种是粘贴坏了）
  if (!/^wss?:\/\/[^\s/]+(\/\S*)?$/i.test(value)) return null;
  return value;
}

/** 昵称清洗：去控制字符与尖括号、按字符截到 16、空则“玩家”（与服务端同口径） */
export function sanitizeMultiplayerName(input: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = input.replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  const chars = [...cleaned].slice(0, MULTIPLAYER_NAME_MAX).join('');
  return chars.length > 0 ? chars : DEFAULT_NAME;
}

/**
 * 三颗按钮此刻该不该可点（`connect` 同时管"开房"与"加入"）。
 *
 * 连接中不许再点连接（会叠一个 socket），已连接时点连接也没意义（要么断开、要么改地址后重连
 * ——这版走"先断开再连"，避免一边连一边换地址的竞态）。
 */
export function multiplayerButtons(state: MultiplayerScreenState): { connect: boolean; disconnect: boolean } {
  return {
    connect: state === 'idle' || state === 'offline',
    // 重连中也要能"断开"——否则自动重连起来就停不下来了
    disconnect: state !== 'idle' && state !== 'offline',
  };
}

export class MultiplayerScreen {
  readonly root: HTMLDivElement;
  private readonly urlInput: HTMLInputElement;
  private readonly nameInput: HTMLInputElement;
  private readonly statusEl: HTMLDivElement;
  private readonly hostButton: HTMLButtonElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly disconnectButton: HTMLButtonElement;
  private state: MultiplayerScreenState = 'idle';
  private openState = false;

  constructor(
    host: HTMLElement,
    private readonly actions: MultiplayerScreenActions,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'multiplayer-screen';
    this.root.classList.add('hidden');

    const panel = document.createElement('div');
    panel.className = 'mp-panel';

    const title = document.createElement('b');
    title.className = 'mp-title';
    title.textContent = t('mp.title');

    // ---- 地址行（标签固定宽 + 输入框吃掉剩余宽度，横屏下只占一行）
    const urlRow = document.createElement('label');
    urlRow.className = 'mp-row';
    const urlLabel = document.createElement('span');
    urlLabel.textContent = t('mp.server');
    this.urlInput = document.createElement('input');
    this.urlInput.type = 'text';
    this.urlInput.id = 'mp-url';
    this.urlInput.inputMode = 'url';
    this.urlInput.autocomplete = 'off';
    this.urlInput.spellcheck = false;
    this.urlInput.placeholder = t('mp.serverHint');
    this.urlInput.value = readStored(STORAGE_URL) ?? '';
    urlRow.append(urlLabel, this.urlInput);

    // ---- 昵称行
    const nameRow = document.createElement('label');
    nameRow.className = 'mp-row';
    const nameLabel = document.createElement('span');
    nameLabel.textContent = t('mp.name');
    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.id = 'mp-name';
    this.nameInput.maxLength = MULTIPLAYER_NAME_MAX;
    this.nameInput.autocomplete = 'off';
    this.nameInput.spellcheck = false;
    this.nameInput.value = readStored(STORAGE_NAME) ?? '';
    nameRow.append(nameLabel, this.nameInput);

    // ---- 状态行（服务端错误（版本/重复连接）也走这里）
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'mp-status';
    this.statusEl.setAttribute('aria-live', 'polite');

    // ---- 按钮行
    const actionsRow = document.createElement('div');
    actionsRow.className = 'mp-actions';

    // 「开房」：当这一局的房主（唯一跑模拟的人），primary 因为这是"自己一个人玩"的默认意图
    this.hostButton = document.createElement('button');
    this.hostButton.type = 'button';
    this.hostButton.id = 'mp-host';
    this.hostButton.className = 'mp-action primary';
    this.hostButton.textContent = t('mp.host');
    this.hostButton.addEventListener('click', () => this.submit(true));

    // 「加入」：进别人的房，只渲染。点错成"开房"会占住房主位，别人随后进不来
    this.joinButton = document.createElement('button');
    this.joinButton.type = 'button';
    this.joinButton.id = 'mp-join';
    this.joinButton.className = 'mp-action';
    this.joinButton.textContent = t('mp.join');
    this.joinButton.addEventListener('click', () => this.submit(false));

    this.disconnectButton = document.createElement('button');
    this.disconnectButton.type = 'button';
    this.disconnectButton.id = 'mp-disconnect';
    this.disconnectButton.className = 'mp-action';
    this.disconnectButton.textContent = t('mp.disconnect');
    this.disconnectButton.addEventListener('click', () => this.actions.onDisconnect());

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.id = 'mp-close';
    closeButton.className = 'mp-action';
    closeButton.textContent = t('mp.close');
    closeButton.addEventListener('click', () => this.actions.onClose());

    actionsRow.append(this.hostButton, this.joinButton, this.disconnectButton, closeButton);

    const hint = document.createElement('div');
    hint.className = 'mp-hint';
    hint.textContent = t('mp.hint');

    panel.append(title, urlRow, nameRow, this.statusEl, actionsRow, hint);
    this.root.append(panel);
    host.append(this.root);

    /*
     * 桌面端：回车 = **加入**（手机上回车只是收起键盘）。
     *
     * 刻意不绑"开房"：回车是从"连接"时代延续下来的习惯动作，而开房会占住整局的房主位，
     * 别人随后进不来——这种后果不该由一个回车触发。
     */
    for (const input of [this.urlInput, this.nameInput]) {
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.submit(false);
      });
    }

    this.setState('idle');
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    this.openState = true;
    this.root.classList.remove('hidden');
    this.setState(this.state);
  }

  close(): void {
    this.openState = false;
    this.root.classList.add('hidden');
  }

  /** 由主程序在 `onStatus` 里推进：状态文案 + 按钮可用性 */
  setState(state: MultiplayerScreenState, detail?: string): void {
    this.state = state;
    const buttons = multiplayerButtons(state);
    this.hostButton.disabled = !buttons.connect;
    this.joinButton.disabled = !buttons.connect;
    this.disconnectButton.disabled = !buttons.disconnect;
    // 服务端给的细节（版本不匹配之类）优先于通用文案——只说"已断开"等于没说
    this.statusEl.textContent = detail && detail.length > 0 ? detail : t(`mp.status.${state}`);
    this.statusEl.dataset.state = state;
  }

  /** 当前填的地址与昵称（主程序重连时也要用同一份） */
  readForm(): { url: string | null; name: string } {
    return {
      url: normalizeServerUrl(this.urlInput.value),
      name: sanitizeMultiplayerName(this.nameInput.value),
    };
  }

  private submit(host: boolean): void {
    const { url, name } = this.readForm();
    if (!url) {
      this.statusEl.textContent = t('mp.error.url');
      this.statusEl.dataset.state = 'error';
      return;
    }
    // 记住这次填的（存规范化之后的地址，下次打开就是能直接用的形式）
    writeStored(STORAGE_URL, url);
    writeStored(STORAGE_NAME, name);
    this.actions.onConnect(url, name, host);
  }
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // 无痕模式/被禁用：记不住就记不住，不影响这一局
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 同上
  }
}
