/**
 * 加入房间（L9，2026-10-27 按设计图重排版式）。
 *
 * 版式严格对齐设计图：**居中标题 + 右上角 ✕**，四行表单
 * `服务器 [IP] : [8887] [选择]` / `房间` / `密码（可空）` / `昵称`，
 * 下面一行红字（昵称冲突 / 密码错误 / 服务器错误都落这一行），最后是一个**大按钮「加入」**。
 *
 * 两个关键交互（用户 2026-10-27）：
 *  - **端口可编辑**：地址框只放 IP/域名，端口在 `:` 后面单独一格，默认 8887；
 *  - **「选择」弹出浮窗**（`ServerPicker`）：浮窗里按「服务器 → 房间」两级列出，
 *    点房间就是"进这间房"，确定才回填表单。
 *
 * 刻意**不做大厅**：房间列表只在浮窗里出现，主面板永远只有这四行 + 一颗按钮。
 *
 * 职责边界：只管界面与输入清洗；真的连接/断开交给调用方（`main.ts` 的 `connect()` /
 * `disconnect()`），状态由 `onStatus` 回调推进来。
 */

import { t } from '../core/i18n/I18n.ts';
import { clientCapabilities } from '../core/net/ClientCapabilities.ts';
import { RoomForm } from './RoomForm.ts';
import { displayServerAddress, normalizeServerUrl } from '../core/net/ServerUrl.ts';
import type { NetRole } from '../core/net/NetRole.ts';

/** 面板状态；与 `NetSession` 的会话状态一一对应（`idle` 表示没连过） */
export type MultiplayerScreenState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface MultiplayerScreenActions {
  /**
   * 点了"加入"或"开房"：地址已经过 `normalizeServerUrl`（含端口），昵称已经过清洗。
   *
   * `host` 是这两颗按钮**唯一**的差别，最终落到 `join` 消息的 `host` 位：
   * 房主跑模拟，其他人只渲染（见 `core/net/NetRole.ts`）。
   */
  onConnect: (url: string, name: string, host: boolean) => void;
  onDisconnect: () => void;
  onClose: () => void;
}

/** localStorage 记住上次填的地址 / 端口 / 房间 / 密码 / 昵称（手机上每次手输太痛苦） */
const STORAGE_URL = 'mc.mp.url';
const STORAGE_PORT = 'mc.mp.port';
const STORAGE_ROOM = 'mc.mp.room';
const STORAGE_PASSWORD = 'mc.mp.pw';
const STORAGE_NAME = 'mc.mp.name';
/** 昵称上限与服务端 `sanitizeName` 对齐（按字符算，不按字节） */
export const MULTIPLAYER_NAME_MAX = 16;
const DEFAULT_NAME = '玩家';

export { normalizeServerUrl } from '../core/net/ServerUrl.ts';

/** 昵称清洗：去控制字符与尖括号、按字符截到 16、空则“玩家”（与服务端同口径） */
export function sanitizeMultiplayerName(input: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = input.replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  const chars = [...cleaned].slice(0, MULTIPLAYER_NAME_MAX).join('');
  return chars.length > 0 ? chars : DEFAULT_NAME;
}

/** 三颗按钮此刻该不该可点（`connect` 同时管"加入"与"开房"） */
export function multiplayerButtons(state: MultiplayerScreenState): { connect: boolean; disconnect: boolean } {
  return {
    connect: state === 'idle' || state === 'offline',
    // 重连中也要能"断开"——否则自动重连起来就停不下来了
    disconnect: state !== 'idle' && state !== 'offline',
  };
}

export class MultiplayerScreen {
  readonly root: HTMLDivElement;
  readonly form: RoomForm;
  private readonly urlInput: HTMLInputElement;
  private readonly roomInput: HTMLInputElement;
  private readonly passwordInput: HTMLInputElement;
  private readonly nameInput: HTMLInputElement;
  private readonly titleEl: HTMLElement;
  private readonly statusEl: HTMLDivElement;
  private readonly hostButton: HTMLButtonElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly disconnectButton: HTMLButtonElement;
  private state: MultiplayerScreenState = 'idle';
  private openState = false;
  /** 当前期望的模式（`join` = 主菜单「加入房间」；`full` = 联机面板全量） */
  private mode: 'full' | 'join' = 'full';
  /** 退出动画的定时器（快速开关时用来掐掉上一次） */
  private closeTimer = 0;
  /** 当前角色（L8）：由 `setRole` 推进，只在"已连接"时显示 */
  private role: NetRole = 'solo';
  /** 最近一次 `setState` 收到的细节文案（角色变化时要在它后面补标签） */
  private detailText = '';

  constructor(
    host: HTMLElement,
    private readonly actions: MultiplayerScreenActions,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'multiplayer-screen';
    this.root.classList.add('hidden');

    const panel = document.createElement('div');
    panel.className = 'mp-panel';

    // ---- 标题行：居中标题 + 右上角 ✕（设计图版式）
    const head = document.createElement('div');
    head.className = 'mp-head';
    this.titleEl = document.createElement('b');
    this.titleEl.className = 'mp-title';
    this.titleEl.textContent = t('mp.title');
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.id = 'mp-close';
    closeButton.className = 'mp-close';
    closeButton.textContent = '✕';
    closeButton.title = t('mp.close');
    closeButton.setAttribute('aria-label', t('mp.close'));
    closeButton.addEventListener('click', () => this.actions.onClose());
    head.append(this.titleEl, closeButton);

    /*
     * 表单字段来自 `RoomForm`（L9）：两个入口收集的是同一组东西，字段与清洗规则只有一份。
     * 这里只负责排版——四行一项一行，与设计图一致。
     */
    this.form = new RoomForm({
      mode: 'join',
      initialAddress: readStored(STORAGE_URL) ?? '',
      initialPort: Number(readStored(STORAGE_PORT) ?? '') || undefined,
      initialRoom: readStored(STORAGE_ROOM) ?? '',
      initialPassword: readStored(STORAGE_PASSWORD) ?? '',
      initialName: readStored(STORAGE_NAME) ?? '',
      pickButtonId: 'mp-pick-server',
      pickButtonClass: 'mp-pick',
      // web 版没有内建服务端：浮窗里「本机 / 允许其它人建房」整块不渲染
      localServer: clientCapabilities().localServer,
      addressError: t('mp.error.url'),
    });
    this.urlInput = this.form.urlInput;
    this.roomInput = this.form.roomInput;
    this.passwordInput = this.form.passwordInput;
    // join 模式一定建昵称框（`withName` 默认 true）
    this.nameInput = this.form.nameInput as HTMLInputElement;

    const form = document.createElement('div');
    form.className = 'mp-form';

    const urlRow = this.makeRow(t('mp.server'));
    const colon = document.createElement('span');
    colon.className = 'mp-colon';
    colon.textContent = ':';
    // 地址行用 grid（标签/地址/`:`/端口/选择），右边缘才能和下面三行对齐
    urlRow.classList.add('mp-row-address');
    urlRow.append(
      this.urlInput,
      colon,
      this.form.portInput,
      this.form.pickButton as HTMLButtonElement,
    );

    const roomRow = this.makeRow(t('mp.room'));
    roomRow.append(this.roomInput);

    const passwordRow = this.makeRow(t('mp.password'));
    this.passwordInput.placeholder = t('mp.passwordHint');
    passwordRow.append(this.passwordInput);

    const nameRow = this.makeRow(t('mp.name'));
    nameRow.append(this.nameInput);

    // ---- 错误/状态行（红字，就在按钮上方——服务端错误也落这一行）
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'mp-status mp-error';
    this.statusEl.setAttribute('aria-live', 'polite');

    // ---- 按钮行：主按钮「加入」占满宽度
    const actionsRow = document.createElement('div');
    actionsRow.className = 'mp-actions';

    this.hostButton = document.createElement('button');
    this.hostButton.type = 'button';
    this.hostButton.id = 'mp-host';
    this.hostButton.className = 'mp-action';
    this.hostButton.textContent = t('mp.host');
    this.hostButton.addEventListener('click', () => this.submit(true));

    this.joinButton = document.createElement('button');
    this.joinButton.type = 'button';
    this.joinButton.id = 'mp-join';
    this.joinButton.className = 'mp-action primary';
    this.joinButton.textContent = t('mp.join');
    this.joinButton.addEventListener('click', () => this.submit(false));

    this.disconnectButton = document.createElement('button');
    this.disconnectButton.type = 'button';
    this.disconnectButton.id = 'mp-disconnect';
    this.disconnectButton.className = 'mp-action';
    this.disconnectButton.textContent = t('mp.disconnect');
    this.disconnectButton.addEventListener('click', () => this.actions.onDisconnect());

    actionsRow.append(this.joinButton, this.hostButton, this.disconnectButton);

    form.append(head, urlRow, roomRow, passwordRow, nameRow, this.statusEl, actionsRow);
    panel.append(form);
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

  /**
   * 打开面板。
   *
   * `mode = 'join'`：主菜单里点「加入房间」主要是"加入"这一件事——开房要指定用哪个世界，
   * 那件事在世界卡片的「开房」上，所以那颗恒藏；「断开」只在真连着时露出来。
   */
  open(mode: 'full' | 'join' = 'full'): void {
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.titleEl.textContent = t(mode === 'join' ? 'mp.joinTitle' : 'mp.title');
    this.syncModeVisibility();
    this.openState = true;
    // 上一次的关闭动画还没播完就又被打开：掐掉它，别让面板在动画中途被隐藏
    window.clearTimeout(this.closeTimer);
    this.root.classList.remove('closing', 'hidden');
    // 每次打开都从存储里刷新一次地址/端口（上一次连接可能刚写过）
    this.form.portInput.value = readStored(STORAGE_PORT) ?? String(this.form.portInput.value || '');
    this.setState(this.state);
  }

  /**
   * 按模式决定两颗按钮的可见性。
   *
   * 「开房」在 join 模式恒藏；「断开」只在真有连接（含重连中）时露出来——
   * 否则联机中打开「加入房间」会是一个全灰的死面板。
   */
  private syncModeVisibility(): void {
    const joinMode = this.mode === 'join';
    this.hostButton.classList.toggle('hidden', joinMode);
    this.disconnectButton.classList.toggle('hidden', joinMode && !multiplayerButtons(this.state).disconnect);
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    /*
     * 淡出而不是"啪"一下没了（2026-10-27）：面板是淡入放大的，退出对称地收回去。
     * 固定 160ms，与 CSS 的动画时长一致。
     */
    this.root.classList.add('closing');
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.root.classList.remove('closing');
      this.root.classList.add('hidden');
    }, 160);
  }

  /** 由主程序在 `onStatus` 里推进：状态文案 + 按钮可用性 */
  setState(state: MultiplayerScreenState, detail?: string): void {
    this.state = state;
    const buttons = multiplayerButtons(state);
    this.hostButton.disabled = !buttons.connect;
    this.joinButton.disabled = !buttons.connect;
    this.disconnectButton.disabled = !buttons.disconnect;
    // 服务端给的细节（版本不匹配之类）优先于通用文案——只说"已断开"等于没说
    this.detailText = detail && detail.length > 0 ? detail : '';
    this.refreshStatus();
    this.syncModeVisibility();
  }

  /**
   * 由主程序在 `welcome` 之后推进（L8）：房主 / 从属。
   *
   * 单独一个入口而不是塞进 `setState`：角色比会话状态**晚**到（`welcome` 才带 `isHost`），
   * 而 `setState` 在 `connecting` 阶段就会被调用。两个状态源分开推进，面板才不会出现
   * "已连接"却仍写着单机。
   */
  setRole(role: NetRole): void {
    this.role = role;
    this.refreshStatus();
  }

  private refreshStatus(): void {
    /*
     * 没连过、也没错误时这一行**留空**（设计图里表单和按钮之间是干净的）。
     * 只有"连接中/已连接/重连中"或服务端给的错误才写东西——玩家不需要一行"未连接"
     * 来告诉他本来就没连。
     */
    if (this.detailText.length === 0 && this.state === 'idle') {
      this.statusEl.textContent = '';
      this.statusEl.dataset.state = 'idle';
      return;
    }
    const base = this.detailText.length > 0 ? this.detailText : t(`mp.status.${this.state}`);
    // 角色只在连上之后才有意义：没连上就是单机，不该在状态行里标"从属"
    const role = this.state === 'connected' ? this.role : 'solo';
    const tag = role === 'host' ? t('mp.role.host') : role === 'client' ? t('mp.role.client') : '';
    this.statusEl.textContent = tag.length > 0 ? `${base} · ${tag}` : base;
    // 有错误文案时标红，普通状态（未连接/连接中）用灰字
    const isError = this.detailText.length > 0;
    this.statusEl.dataset.state = isError ? 'error' : this.state;
  }

  /**
   * 预填地址（L9）：从世界列表的「开房」过来时用。
   *
   * 只填空、不自动连：让玩家看一眼"房间名对不对"再按「开房」。
   */
  prefill(intent: { url: string }): void {
    if (intent.url.length === 0) return;
    this.urlInput.value = displayServerAddress(intent.url);
    this.form.splitAddress();
  }

  /**
   * 当前填的地址与昵称（主程序重连时也要用同一份）。
   *
   * 地址在这里才拼上端口、房间与密码：输入框只放裸地址，这样切换服务器/房间时
   * 玩家不用懂 URL 语法。
   */
  readForm(): { url: string | null; name: string; room: string; password: string } {
    const values = this.form.read();
    return { url: values.baseUrl === null ? null : values.url, name: values.name, room: values.room, password: values.password };
  }

  private makeRow(label: string): HTMLLabelElement {
    const row = document.createElement('label');
    row.className = 'mp-row';
    const name = document.createElement('span');
    name.textContent = label;
    row.append(name);
    return row;
  }

  private submit(host: boolean): void {
    // 粘贴来的老格式地址先拆成"裸地址 + 端口 + 房间 + 密码"，再当表单读
    this.form.splitAddress();
    const values = this.form.read();
    if (values.baseUrl === null) {
      this.showError(t('mp.error.url'));
      this.form.focus('address');
      return;
    }
    // 昵称必填（用户 2026-10-27）：空名兜底成「玩家」必然撞 duplicate-name
    if (this.form.nameIsBlank()) {
      this.showError(t('mp.error.name'));
      this.form.focus('name');
      return;
    }
    // 记住这次填的（端口单独存，下次打开还能用同一个端口）
    const base = normalizeServerUrl(this.urlInput.value);
    if (base) writeStored(STORAGE_URL, base);
    writeStored(STORAGE_PORT, this.form.portInput.value.trim());
    writeStored(STORAGE_ROOM, this.roomInput.value.trim());
    writeStored(STORAGE_PASSWORD, this.passwordInput.value.trim().slice(0, 32));
    writeStored(STORAGE_NAME, values.name);
    this.actions.onConnect(values.url, values.name, host);
  }

  private showError(text: string): void {
    this.detailText = text;
    this.statusEl.textContent = text;
    this.statusEl.dataset.state = 'error';
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
