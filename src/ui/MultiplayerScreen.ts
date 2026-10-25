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

import { t, tp } from '../core/i18n/I18n.ts';
import { parseRoomsResponse, type RoomListResult } from '../core/net/RoomList.ts';
import { parseRecentRooms, pushRecentRoom, serializeRecentRooms, type RecentRoom } from '../core/net/RecentRooms.ts';
import { sanitizeRoomName } from '../core/net/RoomName.ts';
import {
  formatServerUrl,
  healthEndpoint,
  parseServerUrl,
  roomsEndpoint,
  withDefaultPort,
} from '../core/net/ServerUrl.ts';
import {
  filterSelfPeers,
  parsePeersResponse,
  peerAddress,
  probeLatency,
  type NearbyPeer,
} from '../core/net/NearbyRooms.ts';
import type { NetRole } from '../core/net/NetRole.ts';

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

/**
 * localStorage 记住上次填的地址 / 房间 / 口令 / 昵称（手机上每次手输 ws:// 加 IP 太痛苦）。
 *
 * 房间与口令从"藏在地址里"提成独立字段（L9）之后也要记住：局域网里就那一两个房间，
 * 每次重开都要重新抄一遍房间名是纯折磨。
 */
const STORAGE_URL = 'mc.mp.url';
const STORAGE_ROOM = 'mc.mp.room';
const STORAGE_PASSWORD = 'mc.mp.pw';
const STORAGE_NAME = 'mc.mp.name';
/** 最近连过的服务器/房间（L9）：只记地址与房间，**不记口令** */
const STORAGE_RECENT = 'mc.mp.recent';
/** 昵称上限与服务端 `sanitizeName` 对齐（按字符算，不按字节） */
export const MULTIPLAYER_NAME_MAX = 16;
const DEFAULT_NAME = '玩家';

/**
 * 把用户输入的地址收成 `ws://` 或 `wss://`。
 *
 * 手机上最容易漏的是**协议头与端口**：填 `192.168.1.5` 是常态，所以：
 *  - 没有协议头 → 补 `ws://`；
 *  - 没有端口 → 补 `DEFAULT_NET_PORT`（玩家不该关心端口，见 `ServerUrl.ts`）；
 *  - 填了 `http(s)://`（很多人记成网页地址）也顺手映射到 `ws(s)://`。
 * 这几种"猜"都能命中真实意图，而报错只会让人退出去重来。
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

  // 末尾的斜杠对 WebSocket 没意义（`ws://host:25187/` 与不带斜杠等价），统一去掉
  value = value.replace(/\/+$/, '');
  // 主机名必须存在、且不含空白（`ws://foo bar` 这种是粘贴坏了）
  if (!/^wss?:\/\/[^\s/]+(\/\S*)?$/i.test(value)) return null;
  return withDefaultPort(value);
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
  private readonly roomInput: HTMLInputElement;
  private readonly passwordInput: HTMLInputElement;
  private readonly roomsEl: HTMLDivElement;
  private readonly recentEl: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  /** 最近连接（点一颗就填回地址与房间） */
  private recents: RecentRoom[];
  private readonly refreshButton: HTMLButtonElement;
  private readonly nameInput: HTMLInputElement;
  private readonly statusEl: HTMLDivElement;
  private readonly hostButton: HTMLButtonElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly disconnectButton: HTMLButtonElement;
  private state: MultiplayerScreenState = 'idle';
  private openState = false;
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

    this.titleEl = document.createElement('b');
    const title = this.titleEl;
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
    // 「找房间」（L9）：浏览器发不了 UDP/mDNS，所以"自动发现"= 连上这台服务器后拉它的房间列表
    this.refreshButton = document.createElement('button');
    this.refreshButton.type = 'button';
    this.refreshButton.id = 'mp-refresh-rooms';
    this.refreshButton.className = 'mp-mini';
    this.refreshButton.textContent = t('mp.refreshRooms');
    this.refreshButton.addEventListener('click', () => void this.refreshRooms());
    urlRow.append(urlLabel, this.urlInput, this.refreshButton);

    // ---- 房间 / 口令行（L9：不再让玩家把房间写进地址）
    const roomRow = document.createElement('label');
    roomRow.className = 'mp-row';
    const roomLabel = document.createElement('span');
    roomLabel.textContent = t('mp.room');
    this.roomInput = document.createElement('input');
    this.roomInput.type = 'text';
    this.roomInput.id = 'mp-room';
    this.roomInput.maxLength = 24;
    this.roomInput.autocomplete = 'off';
    this.roomInput.spellcheck = false;
    this.roomInput.placeholder = t('mp.roomHint');
    this.roomInput.value = readStored(STORAGE_ROOM) ?? '';
    const passwordLabel = document.createElement('span');
    passwordLabel.className = 'mp-row-label-sub';
    passwordLabel.textContent = t('mp.password');
    this.passwordInput = document.createElement('input');
    this.passwordInput.type = 'text';
    this.passwordInput.id = 'mp-password';
    this.passwordInput.maxLength = 32;
    this.passwordInput.autocomplete = 'off';
    this.passwordInput.spellcheck = false;
    this.passwordInput.placeholder = t('mp.passwordHint');
    this.passwordInput.value = readStored(STORAGE_PASSWORD) ?? '';
    roomRow.append(roomLabel, this.roomInput, passwordLabel, this.passwordInput);

    // ---- 房间列表（点一行就把房名/口令填好；列不出来也不挡手填）
    this.roomsEl = document.createElement('div');
    this.roomsEl.className = 'mp-rooms hidden';
    this.roomsEl.id = 'mp-rooms';

    // ---- 最近连接（L9）：局域网里就那么一两台服务器，别每次重敲 ws:// 加 IP
    this.recents = parseRecentRooms(readStored(STORAGE_RECENT));
    this.recentEl = document.createElement('div');
    this.recentEl.className = 'mp-recent hidden';
    this.recentEl.id = 'mp-recent';

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

    /*
     * 左右两栏（本轮）：左 = 表单（地址 / 房间 / 昵称 / 状态 / 按钮），右 = 房间列表 + 最近连接。
     *
     * 以前是单列：房间列表被压在表单下面，短屏（手机横屏高度只有 360~430）固定 96px
     * 三行，填完地址再"找房间"根本看不到几间，列表也就失去了意义。
     * 分栏之后列表拿到整列高度（列内自己滚），表单也不必为了塞下列表而挤成一团。
     */
    const roomsTitle = document.createElement('div');
    roomsTitle.className = 'mp-col-title';
    roomsTitle.textContent = t('mp.roomsTitle');

    const columns = document.createElement('div');
    columns.className = 'mp-columns';
    const mainCol = document.createElement('div');
    mainCol.className = 'mp-col mp-col-main';
    const roomsCol = document.createElement('div');
    roomsCol.className = 'mp-col mp-col-rooms';
    mainCol.append(title, urlRow, roomRow, nameRow, this.statusEl, actionsRow, hint);
    roomsCol.append(roomsTitle, this.roomsEl, this.recentEl);
    columns.append(mainCol, roomsCol);
    panel.append(columns);
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
    this.renderRecent();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  /**
   * 打开面板。
   *
   * `mode = 'join'`（L9）：主菜单里点「加入房间」只有"加入"这一件事——
   * 开房要指定用哪个世界，那件事在世界卡片的「开房」上；断开在没有连接时也没有意义。
   * 把这两颗藏掉，面板才真的是"填个地址就进去"的小面板，而不是一屏看不懂的开关。
   */
  open(mode: 'full' | 'join' = 'full'): void {
    this.root.dataset.mode = mode;
    this.titleEl.textContent = t(mode === 'join' ? 'mp.joinTitle' : 'mp.title');
    this.hostButton.classList.toggle('hidden', mode === 'join');
    this.disconnectButton.classList.toggle('hidden', mode === 'join');
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
    this.detailText = detail && detail.length > 0 ? detail : '';
    this.refreshStatus();
  }

  /**
   * 由主程序在 `welcome` 之后推进（L8）：房主 / 从属。
   *
   * 单独一个入口而不是塞进 `setState`：角色比会话状态**晚**到（`welcome` 才带
   * `isHost`），而 `setState` 在 `connecting` 阶段就会被调用。两个状态源分开推进，
   * 面板才不会出现"已连接"却仍写着单机。
   */
  setRole(role: NetRole): void {
    this.role = role;
    this.refreshStatus();
  }

  private refreshStatus(): void {
    const base = this.detailText.length > 0 ? this.detailText : t(`mp.status.${this.state}`);
    // 角色只在连上之后才有意义：没连上就是单机，不该在状态行里标"从属"
    const role = this.state === 'connected' ? this.role : 'solo';
    const tag = role === 'host' ? t('mp.role.host') : role === 'client' ? t('mp.role.client') : '';
    this.statusEl.textContent = tag.length > 0 ? `${base} · ${tag}` : base;
    this.statusEl.dataset.state = this.state;
  }

  /**
   * 预填地址（L9）：从世界列表的「开房」过来时，房间与口令已经拼进地址了。
   *
   * 只填空、不自动连：让玩家看一眼"房间名对不对"再按「开房」。真正"一点就进房"要等
   * 连接时机挪到主菜单（同批的后一条），那时这里会多一个 `auto` 参数。
   */
  prefill(intent: { url: string }): void {
    if (intent.url.length > 0) this.urlInput.value = intent.url;
  }

  /**
   * 当前填的地址与昵称（主程序重连时也要用同一份）。
   *
   * 地址在这里才拼上房间与口令（`formatServerUrl`）：输入框只放裸地址，
   * 这样「找房间」拉列表时不会把房名带到服务器请求里，玩家也不用懂 URL 语法。
   */
  readForm(): { url: string | null; name: string; room: string; password: string } {
    const base = normalizeServerUrl(this.urlInput.value);
    const rawRoom = this.roomInput.value.trim();
    // 空 = 进默认房间（服务端 `DEFAULT_ROOM`），不硬塞一个名字
    const room = rawRoom.length > 0 ? sanitizeRoomName(rawRoom) : '';
    const password = this.passwordInput.value.trim().slice(0, 32);
    return {
      url: base ? formatServerUrl(base, room, password) : null,
      name: sanitizeMultiplayerName(this.nameInput.value),
      room,
      password,
    };
  }

  /**
   * 地址里带了房间/口令时把它们拆到独立输入框（粘贴老格式地址的兼容）。
   *
   * 老格式 `ws://host:8787/red?pw=1234` 现在是"一个世界一份日志"的老习惯，
   * 直接报错太粗暴——拆出来继续用即可。
   */
  private splitAddress(): void {
    const normalized = normalizeServerUrl(this.urlInput.value);
    if (!normalized) return;
    const parsed = parseServerUrl(normalized);
    if (parsed.room.length === 0 && parsed.password.length === 0) return;
    this.urlInput.value = parsed.url;
    if (parsed.room.length > 0 && this.roomInput.value.trim().length === 0) {
      this.roomInput.value = parsed.room;
    }
    if (parsed.password.length > 0 && this.passwordInput.value.trim().length === 0) {
      this.passwordInput.value = parsed.password;
    }
  }

  /**
   * 画「最近连接」（L9）。
   *
   * 一颗 = 一个「地址 + 房间」；点一下把地址、房间、昵称都填回去，玩家只需要按「加入」。
   * 空列表时整行不占高度（横屏高度紧张）。
   */
  private renderRecent(): void {
    this.recentEl.replaceChildren();
    if (this.recents.length === 0) {
      this.recentEl.classList.add('hidden');
      return;
    }
    this.recentEl.classList.remove('hidden');
    const label = document.createElement('span');
    label.className = 'mp-recent-label';
    label.textContent = t('mp.recent');
    this.recentEl.append(label);
    for (const entry of this.recents) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mp-recent-chip';
      chip.dataset.room = entry.room;
      chip.textContent = entry.room.length > 0 ? entry.room : t('room.defaultRoom');
      chip.addEventListener('click', () => {
        this.urlInput.value = entry.url;
        this.roomInput.value = entry.room;
        if (entry.name.length > 0 && this.nameInput.value.trim().length === 0) {
          this.nameInput.value = entry.name;
        }
      });
      this.recentEl.append(chip);
    }
  }

  /**
   * 拉这台服务器的房间列表（L9）。
   *
   * 浏览器发不出 UDP 广播、也收不到 mDNS，所以"局域网自动发现"只能落地成
   * "**连上这台服务器之后问它有哪些房间**"——地址对了，房名就不用问人。
   * 任何失败都只降级成一句提示，手填房间名那条路永远可用。
   */
  private async refreshRooms(): Promise<void> {
    this.splitAddress();
    const base = normalizeServerUrl(this.urlInput.value);
    const endpoint = base ? roomsEndpoint(base) : null;
    if (!base || !endpoint) {
      this.showRoomsMessage(t('mp.roomsFailed'));
      return;
    }
    this.refreshButton.disabled = true;
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 3000);
      const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' });
      window.clearTimeout(timer);
      const parsed = parseRoomsResponse(await response.json());
      if (!parsed) {
        this.showRoomsMessage(t('mp.roomsFailed'));
        return;
      }
      this.renderRooms(parsed);
      // 这台服务器用 UDP 组播听到的其它设备（N6）：浏览器自己发不出 UDP，只能借它的耳朵
      this.renderPeers(await this.loadNearbyPeers(base));
    } catch {
      // 跨源被挡 / 服务端不在 / 超时：一句人话，别把玩家堵在异常里
      this.showRoomsMessage(t('mp.roomsFailed'));
    } finally {
      this.refreshButton.disabled = false;
    }
  }

  /**
   * 读这台服务器的 `/healthz`，取它听到的其它设备（N6）。
   *
   * 为什么借道服务端：浏览器既发不出也收不到 UDP 组播；每台手机上的 Rust 服务端
   * 一直在组播上听（`rust-server/src/beacon.rs`），把结果写进 `/healthz` 的 `peers`。
   *
   * 任何失败都返回空数组：附近房间是**加分项**，不能让它把"手填地址"这条路堵住。
   */
  private async loadNearbyPeers(base: string): Promise<NearbyPeer[]> {
    const endpoint = healthEndpoint(base);
    if (!endpoint) return [];
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 2000);
      const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' });
      window.clearTimeout(timer);
      const peers = parsePeersResponse(await response.json());
      if (!peers) return [];
      /*
       * 过滤"自己"：从**别人**的 `/healthz` 看，`peers` 里会有我们自己那一间。
       * 我们只能可靠地知道自己"正对着哪台"（面板里那个地址），所以按它过滤——
       * 一台手机有多个网卡地址，枚举自身 IP 既不可靠也没必要。
       */
      return filterSelfPeers(peers, [base]);
    } catch {
      return [];
    }
  }

  /**
   * 画"附近设备"的行：世界名 / 人数 / 有无口令 / 延迟，点一下直接进房。
   *
   * 延迟异步补：先画 `— ms`，探到再改文字——不让"某台设备不回 /healthz"
   * 把整个列表卡住 1 秒以上。
   */
  private renderPeers(peers: NearbyPeer[]): void {
    if (peers.length === 0) return;
    // 前面可能刚画了"这台服务器上还没有人开房"，附近有设备时那句话就不对了
    const placeholder = this.roomsEl.querySelector('.mp-rooms-empty');
    if (placeholder) placeholder.remove();
    this.roomsEl.classList.remove('hidden');

    for (const peer of peers) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'mp-room-row';
      row.dataset.room = peer.room;
      row.dataset.nearby = '1';
      const name = document.createElement('b');
      name.textContent = peer.name.length > 0 ? peer.name : `${peer.host}:${peer.port}`;
      const meta = document.createElement('span');
      const parts = [tp('mp.roomsPlayers', { n: peer.players }), `${peer.host}:${peer.port}`];
      // 有口令的房：先说清楚，别让玩家点进去才知道要口令
      if (peer.passwordRequired) parts.push(t('mp.password'));
      const showLatency = (latencyMs: number | null): void => {
        meta.textContent = [...parts, latencyMs === null ? '— ms' : `${latencyMs} ms`].join(' · ');
      };
      showLatency(null);
      row.append(name, meta);
      row.addEventListener('click', () => {
        // 地址里带房间名（`ws://host:port/room`），`splitAddress` 会把它拆回房间栏
        this.urlInput.value = peerAddress(peer);
        this.roomInput.value = '';
        if (peer.passwordRequired && this.passwordInput.value.trim().length === 0) {
          this.passwordInput.focus();
          return;
        }
        this.submit(false);
      });
      this.roomsEl.append(row);
      void probeLatency(peer, fetch).then(showLatency);
    }
  }

  private renderRooms(result: RoomListResult): void {
    this.roomsEl.replaceChildren();
    if (result.rooms.length === 0) {
      this.showRoomsMessage(t('mp.roomsEmpty'));
      return;
    }
    this.roomsEl.classList.remove('hidden');
    for (const entry of result.rooms) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'mp-room-row';
      row.dataset.room = entry.room;
      const name = document.createElement('b');
      name.textContent = entry.room;
      const meta = document.createElement('span');
      const parts = [tp('mp.roomsPlayers', { n: entry.players })];
      if (entry.worldName.length > 0) parts.push(entry.worldName);
      // 没房主的房进去之后没人跑模拟，值得事先说一句
      if (!entry.hasHost) parts.push(t('mp.roomsNoHost'));
      meta.textContent = parts.join(' · ');
      row.append(name, meta);
      row.addEventListener('click', () => {
        this.roomInput.value = entry.room;
        // 要口令的服务器：把焦点送过去，省一次点击
        if (result.passwordRequired && this.passwordInput.value.trim().length === 0) {
          this.passwordInput.focus();
        }
      });
      this.roomsEl.append(row);
    }
  }

  private showRoomsMessage(text: string): void {
    this.roomsEl.replaceChildren();
    const message = document.createElement('div');
    message.className = 'mp-rooms-empty';
    message.textContent = text;
    this.roomsEl.append(message);
    this.roomsEl.classList.remove('hidden');
  }

  private submit(host: boolean): void {
    // 粘贴来的老格式地址先拆成"裸地址 + 房间 + 口令"，再当表单读
    this.splitAddress();
    const { url, name, room } = this.readForm();
    if (!url) {
      this.statusEl.textContent = t('mp.error.url');
      this.statusEl.dataset.state = 'error';
      return;
    }
    // 记住这次填的（地址只存裸地址，房间/口令各存各的，下次打开都是能直接用的形式）
    const base = normalizeServerUrl(this.urlInput.value);
    if (base) writeStored(STORAGE_URL, base);
    writeStored(STORAGE_ROOM, this.roomInput.value.trim());
    writeStored(STORAGE_PASSWORD, this.passwordInput.value.trim().slice(0, 32));
    writeStored(STORAGE_NAME, name);
    // 记住这一条"去过哪"（不记口令，见 `RecentRooms` 的注释）
    if (base) {
      this.recents = pushRecentRoom(this.recents, { url: base, room, name, at: Date.now() });
      writeStored(STORAGE_RECENT, serializeRecentRooms(this.recents));
      this.renderRecent();
    }
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
