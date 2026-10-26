/**
 * 「选择房间 / 选择服务器」浮窗（用户 2026-10-27 定稿版式）。
 *
 * 交互按设计图落地：
 *  - 点表单里服务器配置右边的「选择」→ **贴着那个按钮弹出的浮窗**（不是全屏遮罩层），
 *    标题是「选择房间」或「选择服务器(8887)」，副标题写明"所有端口 8887 的房间/服务器"；
 *  - 浮窗内容分三块：**本机**（只有能内建服务端的客户端才有）、**局域网**、**公共服务器**；
 *  - 每台服务器占一行：`IP -------- 延迟ms`，它下面缩进列这台机器上的房间：
 *    `房间: xxx    4/10 在线`；
 *  - 点服务器行 = 选中这台机器（进它的默认房间）；点房间行 = 选中"这台机器 + 这间房"；
 *  - 底部「取消 / 确定」：确定才回填表单，未选中时禁用。
 *
 * **局域网自动检索**（用户 2026-10-27）：打开即扫，网段取"当前位置自己 IP 去掉最后一位"——
 * 顺序是 ① 地址框里已填的地址 → ② 页面自身的 hostname → ③ `192.168.1` 兜底。
 * 扫描过程中每发现一台就立刻列出来，并马上去拉它的 `/rooms`（边扫边出房间）。
 *
 * 浏览器发不出 UDP 广播、也收不到 mDNS，所以"发现"只能落地成"按网段探 `/ping`"。
 */
import {
  browserReach,
  canScanLan,
  scanSubnet,
  subnetOf,
  type DiscoveredServer,
} from '../core/net/ServerDiscovery.ts';
import { parseRoomsResponse } from '../core/net/RoomList.ts';
import { DEFAULT_WS_PATH, displayServerHost, isLanHost, roomsEndpoint } from '../core/net/ServerUrl.ts';
import { t, tp } from '../core/i18n/I18n.ts';

/** 本机「允许其它人建房」的状态键（只有内建服务端能力的客户端会读它） */
const ALLOW_HOSTING_KEY = 'mc.mp.allowHosting';
/** 拉单台服务器房间列表的超时：局域网正常 < 30ms，3 秒足够 */
const ROOMS_TIMEOUT_MS = 3000;

/** `server`：只选机器；`room`：机器 + 房间（点房间行才有 room） */
export type ServerPickerMode = 'server' | 'room';

/** 选中结果：地址**不含端口**，端口单独给（表单里端口是独立输入框） */
export interface PickedServer {
  address: string;
  port: number;
  /** 只有 room 模式下点了具体房间才有；空 = 进这台机器的默认房间 */
  room?: string;
}

export interface ServerPickerActions {
  /** 当前地址框里的地址（用来推导默认网段；没有就退回页面自身） */
  currentAddress: () => string;
  /** 当前端口（扫描与 `/rooms` 都跟着它走） */
  currentPort: () => number;
  /** 列表里要不要列房间（加入房间 = 要；开房只要机器） */
  mode: ServerPickerMode;
  /** 选中并「确定」：回填表单，**不**发起连接 */
  onPick: (picked: PickedServer) => void;
  /**
   * 公开服务器列表接口（返回 `{ servers: [{ name, address, region? }] }`）。
   *
   * 现在返回 `''`：**接口还没提供**，面板显示一句"暂未提供"，不做任何请求。
   * 以后定了地址只要让这个方法返回 URL，列表就长出来了，别处不用改。
   */
  publicServersUrl?: () => string;
  /**
   * 这个客户端能不能内建服务端（`clientCapabilities().localServer`）。
   *
   * 为 false（web 版）时**整块「本机」都不渲染**：浏览器起不了监听 socket，
   * 做成能点的开关只会骗玩家。原生客户端把这个位改成 true，界面自动长出来。
   */
  localServer?: boolean;
}

export class ServerPicker {
  readonly element: HTMLDivElement;

  private readonly panel: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly status: HTMLDivElement;
  private readonly lanList: HTMLDivElement;
  private readonly publicList: HTMLDivElement;
  private readonly confirmButton: HTMLButtonElement;

  private opened = false;
  private scanning = false;
  /** 本次打开的自增标记：关掉之后旧的扫描/房间请求不再写 DOM */
  private token = 0;
  /** 当前选中项（服务器行或房间行） */
  private selected: { picked: PickedServer; row: HTMLElement } | null = null;

  constructor(private readonly actions: ServerPickerActions) {
    this.element = document.createElement('div');
    this.element.id = 'server-picker';
    this.element.className = 'server-picker hidden';

    this.panel = document.createElement('div');
    this.panel.className = 'server-picker-panel';

    // ---- 标题：选择房间 / 选择服务器(8887) + 副标题
    const head = document.createElement('div');
    head.className = 'server-picker-head';
    this.titleEl = document.createElement('b');
    this.titleEl.className = 'server-picker-title';
    this.subtitleEl = document.createElement('span');
    this.subtitleEl.className = 'server-picker-sub';
    head.append(this.titleEl, this.subtitleEl);

    // ---- 可滚动的正文（列表长了只滚这一块，标题与底部按钮固定）
    const body = document.createElement('div');
    body.className = 'server-picker-body';

    const lanLabel = document.createElement('div');
    lanLabel.className = 'server-picker-label';
    lanLabel.textContent = t('server.lan');
    this.lanList = document.createElement('div');
    this.lanList.className = 'server-picker-list';
    this.lanList.id = 'server-lan-list';

    const publicLabel = document.createElement('div');
    publicLabel.className = 'server-picker-label';
    publicLabel.textContent = t('server.public');
    this.publicList = document.createElement('div');
    this.publicList.className = 'server-picker-list';
    this.publicList.id = 'server-public-list';

    this.status = document.createElement('div');
    this.status.className = 'server-picker-status';
    this.status.id = 'server-scan-status';

    const localSection = this.buildLocalSection();
    body.append(
      ...(localSection ? [localSection] : []),
      lanLabel,
      this.status,
      this.lanList,
      publicLabel,
      this.publicList,
    );

    // ---- 底部：取消 / 确定（未选中时确定禁用）
    const actionsRow = document.createElement('div');
    actionsRow.className = 'server-picker-actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'server-picker-button';
    cancelButton.id = 'server-picker-cancel';
    cancelButton.textContent = t('menu.cancel');
    cancelButton.addEventListener('click', () => this.close());
    this.confirmButton = document.createElement('button');
    this.confirmButton.type = 'button';
    this.confirmButton.className = 'server-picker-button primary';
    this.confirmButton.id = 'server-picker-confirm';
    this.confirmButton.textContent = t('server.confirm');
    this.confirmButton.disabled = true;
    this.confirmButton.addEventListener('click', () => this.confirm());
    actionsRow.append(cancelButton, this.confirmButton);

    this.panel.append(head, body, actionsRow);
    this.element.append(this.panel);
    // 点浮窗外（透明层）关掉：这一层是"看一眼、点一下"的辅助面板
    this.element.addEventListener('click', (event) => {
      if (event.target === this.element) this.close();
    });
  }

  /**
   * 打开浮窗并贴到 `anchor`（「选择」按钮）旁边。
   *
   * 定位规则：优先"右边缘对齐按钮 + 出现在按钮下方"；下方放不下就翻到上方，
   * 横向超出视口就往里收。手机横屏高度只有 360~430，必须夹住，否则整个浮窗会飘到屏幕外。
   */
  open(anchor: HTMLElement): void {
    this.opened = true;
    this.token++;
    this.element.classList.remove('hidden');
    this.applyModeText();
    this.resetList();
    this.renderPublic();
    this.position(anchor);
    this.status.textContent = '';
    // 打开即扫（用户 2026-10-27）：网段由当前地址推出来，不需要玩家再点一次
    void this.scan();
  }

  close(): void {
    this.opened = false;
    // 关掉之后旧扫描/房间请求的回调一律作废（它们可能还在路上）
    this.token++;
    this.element.classList.add('hidden');
  }

  get isOpen(): boolean {
    return this.opened;
  }

  dispose(): void {
    this.close();
    this.element.remove();
  }

  // ---------------------------------------------------------------- 定位与文案

  private applyModeText(): void {
    const port = this.port();
    const roomMode = this.actions.mode === 'room';
    this.titleEl.textContent = roomMode ? t('server.titleRoom') : tp('server.titleServer', { port });
    this.subtitleEl.textContent = roomMode
      ? tp('server.subtitleRoom', { port })
      : tp('server.subtitleServer', { port });
  }

  private position(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const panel = this.panel.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.right - panel.width;
    left = Math.max(margin, Math.min(left, vw - panel.width - margin));

    let top = rect.bottom + 6;
    if (top + panel.height > vh - margin) {
      const above = rect.top - panel.height - 6;
      top = above >= margin ? above : Math.max(margin, vh - panel.height - margin);
    }
    this.panel.style.left = `${Math.round(left)}px`;
    this.panel.style.top = `${Math.round(top)}px`;
  }

  private port(): number {
    const port = Math.trunc(Number(this.actions.currentPort()));
    return Number.isFinite(port) && port > 0 ? port : 8887;
  }

  private resetList(): void {
    this.lanList.replaceChildren();
    this.publicList.replaceChildren();
    this.clearSelection();
    this.scanning = false;
  }

  /**
   * 「本机」区：只有能内建服务端的客户端才有。
   *
   * 开关表达的是"这台设备是否作为服务器开放给别人建房"——状态存在本机，默认允许。
   * 真正的执行在原生客户端的内建服务器里；web 版整块不渲染。
   */
  private buildLocalSection(): HTMLDivElement | null {
    if (this.actions.localServer !== true) return null;

    const section = document.createElement('div');
    section.className = 'server-picker-section';
    const row = document.createElement('div');
    row.className = 'server-picker-local';
    const label = document.createElement('b');
    label.className = 'server-picker-local-name';
    label.textContent = t('server.local');
    const title = document.createElement('span');
    title.className = 'server-picker-local-ask';
    title.textContent = t('server.allowHosting');

    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'server-picker-toggle';
    yes.id = 'server-allow-hosting-yes';
    yes.textContent = t('misc.yes');
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'server-picker-toggle';
    no.id = 'server-allow-hosting-no';
    no.textContent = t('misc.no');

    const sync = (value: boolean): void => {
      yes.setAttribute('aria-pressed', String(value));
      no.setAttribute('aria-pressed', String(!value));
    };
    yes.addEventListener('click', () => {
      this.writeAllowHosting(true);
      sync(true);
    });
    no.addEventListener('click', () => {
      this.writeAllowHosting(false);
      sync(false);
    });
    sync(this.readAllowHosting());

    row.append(label, title, yes, no);
    section.append(row);
    return section;
  }

  private readAllowHosting(): boolean {
    try {
      return window.localStorage.getItem(ALLOW_HOSTING_KEY) !== '0';
    } catch {
      return true;
    }
  }

  private writeAllowHosting(value: boolean): void {
    try {
      window.localStorage.setItem(ALLOW_HOSTING_KEY, value ? '1' : '0');
    } catch {
      // 无痕模式：记不住不影响这一局
    }
  }

  // ---------------------------------------------------------------- 局域网扫描

  /**
   * 扫当前网段（打开即扫）。
   *
   * 网段来源三级兜底（用户 2026-10-27："按当前自己的 IP 段，去掉最后一位"）：
   *  ① 地址框里已经填了 IP → 用它的前三段；
   *  ② 否则用页面自身的 hostname（手机连 `http://192.168.1.5:5173` 时就是它）；
   *  ③ 兜底 `192.168.1`。
   */
  private async scan(): Promise<void> {
    if (this.scanning) return;
    const token = this.token;
    this.scanning = true;
    this.status.textContent = t('server.scanning');
    const startedAt = performance.now();
    try {
      const found = await scanSubnet(
        this.suggestSubnet(),
        { reach: browserReach, now: () => performance.now() },
        {
          port: this.port(),
          onFound: (server) => {
            if (token !== this.token) return;
            this.appendServerRow(server, this.lanList);
          },
          cancelled: () => token !== this.token,
        },
      );
      if (token !== this.token) return;
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
      if (found.length > 0) {
        this.status.textContent = tp('server.found', { count: String(found.length), seconds });
      } else if (!canScanLan(location.protocol)) {
        // 一台都没扫到、且页面是 https：最可能就是没授权，把"去哪授权"写在同一行
        this.status.textContent = `${t('server.empty')} · ${t('server.httpsHint')}`;
      } else {
        this.status.textContent = t('server.empty');
      }
    } finally {
      if (token === this.token) this.scanning = false;
    }
  }

  /** 默认网段：地址框 → 页面地址 → 常见私网兜底 */
  private suggestSubnet(): string {
    const current = displayServerHost(this.actions.currentAddress() ?? '');
    const fromCurrent = subnetOf(current.split(':')[0] ?? '');
    if (fromCurrent !== null) return fromCurrent;
    const fromPage = subnetOf(location.hostname);
    if (fromPage !== null) return fromPage;
    return '192.168.1';
  }

  // ---------------------------------------------------------------- 列表渲染

  /** 一台服务器：`IP -------- 延迟` + 它下面的房间列表（room 模式才拉） */
  private appendServerRow(server: DiscoveredServer, host: HTMLElement): void {
    const address = server.host;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'server-picker-item';
    row.dataset.host = address;

    const name = document.createElement('span');
    name.className = 'server-picker-host';
    name.textContent = address;
    // 图里 IP 与延迟之间是一串虚线，代表"网速"
    const dash = document.createElement('span');
    dash.className = 'server-picker-dash';
    const rtt = document.createElement('span');
    rtt.className = 'server-picker-rtt';
    // 公开服务器没有测延迟（rttMs 为 0）：显示 `--`，别假装"0ms"
    rtt.textContent = server.rttMs > 0 ? tp('server.rtt', { ms: String(server.rttMs) }) : '--';
    row.append(name, dash, rtt);
    row.addEventListener('click', () => this.select({ address, port: this.port() }, row));

    const rooms = document.createElement('div');
    rooms.className = 'server-picker-rooms';

    host.append(row, rooms);
    /*
     * 两种模式都列房间（设计图里"选择服务器"也带房间行）。
     * 差别在可点性：room 模式点房间 = 选中这间房；server 模式只展示"这台机器上有谁"，
     * 房间行不可点——开房时房名要自己起，选了别人的房名只会撞 `host-taken`。
     */
    void this.loadRooms(address, rooms);
  }

  /** 拉某台服务器的 `/rooms`，把房间行缩进列在服务器下面 */
  private async loadRooms(address: string, container: HTMLDivElement): Promise<void> {
    const token = this.token;
    const url = this.serverUrlFor(address);
    const endpoint = roomsEndpoint(url);
    if (!endpoint || typeof fetch !== 'function') return;
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), ROOMS_TIMEOUT_MS);
      const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' });
      window.clearTimeout(timer);
      if (token !== this.token) return;
      const parsed = parseRoomsResponse(await response.json());
      if (token !== this.token) return;
      if (!parsed) {
        this.showNoRooms(container, t('server.roomsFailed'));
        return;
      }
      if (parsed.rooms.length === 0) {
        this.showNoRooms(container, t('server.noRooms'));
        return;
      }
      container.replaceChildren(
        ...parsed.rooms.map((entry) => this.makeRoomRow(address, entry.room, entry.players, parsed.maxPlayers)),
      );
    } catch {
      // 跨源被挡 / 服务端不在 / 超时：一行灰字，不影响选这台机器本身
      if (token !== this.token) return;
      this.showNoRooms(container, t('server.roomsFailed'));
    }
  }

  /** 房间行；`server` 模式下只展示不可点（开房不能选别人的房名） */
  private makeRoomRow(address: string, room: string, players: number, maxPlayers: number): HTMLElement {
    const selectable = this.actions.mode === 'room';
    const row = document.createElement(selectable ? 'button' : 'div');
    if (row instanceof HTMLButtonElement) row.type = 'button';
    row.className = `server-picker-room${selectable ? '' : ' readonly'}`;
    row.dataset.room = room;
    const name = document.createElement('span');
    name.className = 'server-picker-room-name';
    name.textContent = tp('server.roomName', { room });
    const online = document.createElement('span');
    online.className = 'server-picker-room-online';
    online.textContent = tp('mp.roomsPlayersOf', { n: players, max: maxPlayers });
    row.append(name, online);
    if (selectable) row.addEventListener('click', () => this.select({ address, port: this.port(), room }, row));
    return row;
  }

  private showNoRooms(container: HTMLDivElement, text: string): void {
    const hint = document.createElement('div');
    hint.className = 'server-picker-room-empty';
    hint.textContent = text;
    container.replaceChildren(hint);
  }

  /** 拼一个能问 `/rooms` 的地址：局域网明文 + 当前端口；域名走反代端点 */
  private serverUrlFor(address: string): string {
    if (isLanHost(address) || address.includes(':')) return `ws://${address}:${this.port()}`;
    return `wss://${address}${DEFAULT_WS_PATH}`;
  }

  // ---------------------------------------------------------------- 公开服务器

  private renderPublic(): void {
    const url = this.actions.publicServersUrl?.() ?? '';
    if (url.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'server-picker-status';
      hint.textContent = t('server.publicSoon');
      this.publicList.replaceChildren(hint);
      return;
    }
    const loading = document.createElement('div');
    loading.className = 'server-picker-status';
    loading.textContent = t('server.loading');
    this.publicList.replaceChildren(loading);
    void this.loadPublic(url);
  }

  private async loadPublic(url: string): Promise<void> {
    const token = this.token;
    const servers = await fetchPublicServers(url);
    if (token !== this.token) return;
    if (servers.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'server-picker-status';
      hint.textContent = t('server.empty');
      this.publicList.replaceChildren(hint);
      return;
    }
    this.publicList.replaceChildren();
    for (const server of servers) {
      this.appendServerRow(
        { host: server.address, port: this.port(), rttMs: 0 },
        this.publicList,
      );
    }
  }

  // ---------------------------------------------------------------- 选中与应用

  /** 选中一行（不应用）：高亮 + 点亮「确定」 */
  private select(picked: PickedServer, row: HTMLElement): void {
    if (this.selected) {
      this.selected.row.classList.remove('selected');
      this.selected.row.removeAttribute('aria-selected');
    }
    this.selected = { picked, row };
    row.classList.add('selected');
    row.setAttribute('aria-selected', 'true');
    this.confirmButton.disabled = false;
  }

  private clearSelection(): void {
    if (this.selected) {
      this.selected.row.classList.remove('selected');
      this.selected.row.removeAttribute('aria-selected');
    }
    this.selected = null;
    this.confirmButton.disabled = true;
  }

  /** 「确定」：把选中的机器（+ 房间）交给调用方并关浮窗 */
  private confirm(): void {
    if (!this.selected) return;
    const picked = this.selected.picked;
    this.close();
    this.actions.onPick(picked);
  }
}

/**
 * 拉公开服务器列表。形状不对就当"没有"（别让一个坏接口把面板卡住）。
 *
 * 期待 `{ servers: [{ name, address, region? }] }`；`address` 就是玩家要填的那段
 * （`192.168.1.5` 或 `mc.example.com`），协议头/端口照旧交给 `normalizeServerUrl`。
 */
export async function fetchPublicServers(url: string): Promise<Array<{ name: string; address: string; region?: string }>> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return [];
    const body = (await response.json()) as { servers?: unknown };
    if (!Array.isArray(body.servers)) return [];
    const out: Array<{ name: string; address: string; region?: string }> = [];
    for (const raw of body.servers) {
      if (typeof raw !== 'object' || raw === null) continue;
      const entry = raw as Record<string, unknown>;
      const address = typeof entry.address === 'string' ? entry.address.trim() : '';
      if (address.length === 0) continue;
      out.push({
        name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : address,
        address,
        ...(typeof entry.region === 'string' && entry.region.length > 0 ? { region: entry.region } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}
