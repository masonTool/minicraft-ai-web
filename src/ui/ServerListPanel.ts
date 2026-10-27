/**
 * 多人界面的**右半**：局域网 / 公共服务器列表（2026-10-27 第三版）。
 *
 * 为什么从"浮窗"改成"常驻右栏"（用户原话）：加入和开房两件事界面几乎一样，
 * 与其各弹一层，不如**左边填、右边看**——点右侧任意一项，左边自动填好，
 * 这样没有第二层弹窗、也就不需要背景遮罩，一屏里把"有哪些房 / 填什么"同时给到。
 *
 * 两条容易踩的规则：
 *  - **点击即回填**（不再是"选中 + 确定"）：列表就摆在旁边，多一次确认只是多余；
 *  - **没有房主的房间不可点**：那一局没有人在跑模拟，进去是一个不推进的世界
 *    （服务端也会拒 `no-host`，这里提前挡是为了不让人白等一次连接）。
 *
 * 扫描用**本机 IP 段**，不看左侧输入框里填的地址——见 `subnet()`。
 */
import { t, tp } from '../core/i18n/I18n.ts';
import { filterSelfPeers, parsePeersResponse } from '../core/net/NearbyRooms.ts';
import { parseRoomsResponse } from '../core/net/RoomList.ts';
import {
  browserReach,
  canScanLan,
  scanSubnet,
  subnetOf,
  type DiscoveredServer,
} from '../core/net/ServerDiscovery.ts';
import { healthEndpoint, roomsEndpoint } from '../core/net/ServerUrl.ts';

/** 点中右侧某一项之后，左边该填什么 */
export interface PickedTarget {
  /** 只 IP / 主机名（端口由表单的端口框负责） */
  address: string;
  port: number;
  /** 点了具体某间房才有；点服务器则是 `undefined` */
  room?: string;
}

export class ServerListPanel {
  readonly element: HTMLDivElement;

  private readonly status: HTMLDivElement;
  private readonly lanList: HTMLDivElement;
  private readonly publicList: HTMLDivElement;
  private readonly rescanButton: HTMLButtonElement;
  /** 开房时右栏顶部那颗「选择本机」（加入模式下不显示） */
  private localRow!: HTMLButtonElement;

  /** 已画过的 `host:port`：自己扫到的 + 从别的服务器 `/healthz` 听来的，两者会重叠 */
  private readonly seen = new Set<string>();
  private token = 0;
  private scanning = false;
  private port = 8887;

  /** 点中某一项：宿主把内容填进左侧表单（列表常驻，不关） */
  onPick?: (target: PickedTarget) => void;
  /** 空状态下点「修改端口」 */
  onPortRequest?: () => void;
  /** 取左侧地址框里填的值（用来推网段，见 `subnets()`） */
  addressProvider?: () => string;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'server-list';

    const head = document.createElement('div');
    head.className = 'server-list-head';
    const title = document.createElement('span');
    title.className = 'server-list-title';
    title.textContent = t('server.nearby');
    /*
     * 「修改端口」放在「重新扫描」**左边**（用户 2026-10-27）：两者是一组动作——
     * 改端口就是为了重扫，排在一起才顺。
     */
    const headPort = document.createElement('button');
    headPort.type = 'button';
    headPort.className = 'server-list-port';
    headPort.id = 'server-list-change-port';
    headPort.textContent = t('server.changePort');
    headPort.addEventListener('click', () => this.onPortRequest?.());
    this.rescanButton = document.createElement('button');
    this.rescanButton.type = 'button';
    this.rescanButton.className = 'server-list-rescan';
    this.rescanButton.id = 'server-list-rescan';
    this.rescanButton.textContent = t('server.rescan');
    this.rescanButton.addEventListener('click', () => {
      void this.refresh();
    });
    head.append(title, headPort, this.rescanButton);

    const body = document.createElement('div');
    body.className = 'server-list-body';

    /*
     * 两类服务器（用户 2026-10-27）：**本地服务器**（这台机器所在网段扫到的）与
     * **远程服务器**（公网/别人的机器）。各自可折叠，**默认展开**。
     * 折叠用 `aria-expanded` + 隐藏 body，不用 `<details>`——原生 summary 的三角
     * 在各平台的样式差异太大，这里要的是统一的像素风箭头。
     */
    const local = this.makeGroup(t('server.lan'));
    this.status = document.createElement('div');
    this.status.className = 'server-list-status';
    this.status.id = 'server-list-status';
    this.lanList = document.createElement('div');
    this.lanList.className = 'server-list-items';
    this.lanList.id = 'server-lan-list';
    local.body.append(this.status, this.lanList);

    const remote = this.makeGroup(t('server.public'));
    this.publicList = document.createElement('div');
    this.publicList.className = 'server-list-items';
    this.publicList.id = 'server-public-list';
    const publicSoon = document.createElement('div');
    publicSoon.className = 'server-list-room-empty';
    publicSoon.textContent = t('server.publicSoon');
    this.publicList.append(publicSoon);
    remote.body.append(this.publicList);

    /*
     * 「选择本机」（用户 2026-10-27）：开房时右栏第一项——本机跑着服务端
     * （web 端 `npm run server` / 手机 App 内建）时直接用它，不必等扫网段。
     * 加入模式下隐藏：本机没有服务端，填它必然连不上。
     */
    this.localRow = document.createElement('button');
    this.localRow.type = 'button';
    this.localRow.className = 'server-list-local hidden';
    this.localRow.id = 'server-list-local';
    const localName = document.createElement('span');
    localName.textContent = t('server.localHost');
    const localHint = document.createElement('span');
    localHint.className = 'server-list-local-hint';
    localHint.textContent = '127.0.0.1';
    this.localRow.append(localName, localHint);
    this.localRow.addEventListener('click', () => {
      this.onPick?.({ address: '127.0.0.1', port: this.port });
    });

    body.append(this.localRow, local.group, remote.group);
    this.element.append(head, body);
  }

  /** 端口变了要重扫（改端口就是换一批机器，旧结果一律作废） */
  setPort(port: number): void {
    if (port === this.port) return;
    this.port = port;
    void this.refresh();
  }

  /** 清空并重新扫描（第一次挂载、点「重新扫描」、换端口都走这里） */
  async refresh(): Promise<void> {
    if (this.scanning) {
      // 还在扫：作废旧的一轮，让它在下一次探测时自己退出
      this.token++;
    }
    const token = this.token;
    this.scanning = true;
    this.lanList.replaceChildren();
    // `publicList` 目前是静态说明（公共服务器接口还没提供），重扫时**不要**清空它
    this.seen.clear();
    this.status.textContent = t('server.scanning');

    const startedAt = performance.now();
    try {
      /*
       * 分批扫（用户 2026-10-27）：一次只并行 2 个网段——6 个段 × 254 个地址一起打，
       * 浏览器会把请求排队到几十秒，反而更慢。找到就停，所以常见情况是 1~2 批。
       */
      const bases = this.subnets();
      const found: DiscoveredServer[] = [];
      for (let index = 0; index < bases.length; index += 2) {
        if (token !== this.token) break;
        const batch = bases.slice(index, index + 2);
        const results = await Promise.all(
          batch.map((base) =>
            scanSubnet(
              base,
              { reach: browserReach, now: () => performance.now() },
              {
                port: this.port,
                onFound: (server) => {
                  if (token !== this.token) return;
                  this.appendServerRow(server);
                },
                cancelled: () => token !== this.token,
              },
            ),
          ),
        );
        for (const list of results) found.push(...list);
        if (found.length > 0) break;
      }
      if (token !== this.token) return;
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
      if (found.length > 0) {
        this.status.textContent = tp('server.found', { count: String(found.length), seconds });
        this.status.classList.remove('empty');
      } else {
        this.showEmpty();
      }
    } finally {
      if (token === this.token) this.scanning = false;
    }
  }

  /** 开房模式才显示「选择本机」 */
  setLocalVisible(visible: boolean): void {
    this.localRow.classList.toggle('hidden', !visible);
  }

  /** 一个可折叠分组（本地 / 远程）：标题条 + 可隐藏的正文，**默认展开** */
  private makeGroup(titleText: string): { group: HTMLDivElement; body: HTMLDivElement } {
    const group = document.createElement('div');
    group.className = 'server-list-group';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'server-list-group-head';
    head.setAttribute('aria-expanded', 'true');
    const caret = document.createElement('span');
    caret.className = 'server-list-caret';
    caret.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'server-list-group-label';
    label.textContent = titleText;
    head.append(caret, label);
    const body = document.createElement('div');
    body.className = 'server-list-group-body';
    head.addEventListener('click', () => {
      const open = head.getAttribute('aria-expanded') === 'true';
      // 三角的朝向由 CSS 按 aria-expanded 决定，切换只改这一个属性
      head.setAttribute('aria-expanded', String(!open));
      body.classList.toggle('hidden', open);
    });
    group.append(head, body);
    return { group, body };
  }

  /**
   * 要扫哪些网段（用户 2026-10-27："先找到本机 IP，取前三段去扫"）。
   *
   * 问题在于**浏览器根本拿不到本机内网 IP**：
   *  - `location.hostname` 只在"页面本身就是用 IP 打开"时才是本机 IP；
   *    App 的 webview / 域名访问时它是 `localhost`，按它扫只能扫到回环；
   *  - WebRTC 的 host candidate 被 Chrome/Safari 混淆成 `xxx.local`（mDNS 隐私保护，
   *    实测拿不到 192.168.x.x），不能当来源。
   *
   * 所以这里给一串**候选**，按"最可能是哪一个"排序，分批扫、找到就停：
   *  1. 页面 hostname 是私网 IP → 它最准（浏览器直接访问局域网服务时就是这样）
   *  2. 地址框里已填的私网 IP → 上一版能扫到就是靠它（通常是上次连过的机器）
   *  3. 常见私网段兜底：192.168.1 命中率最高，其次 .0 / .2 / 10.0.0… 
   */
  private subnets(): string[] {
    const candidates: string[] = [];
    const push = (base: string | null): void => {
      if (base !== null && base.length > 0 && candidates.indexOf(base) < 0) candidates.push(base);
    };

    push(subnetOf(location.hostname));
    push(subnetOf(this.addressHint()));
    /*
     * localhost / 域名打开：先扫回环（开发时服务端就在本机），
     * 但**不能只扫它**——手机 webview 也是 localhost，局域网里那台才是要找的。
     */
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      push('127.0.0');
    }
    // 兜底：家用路由器最常见的几个段
    for (const base of ['192.168.1', '192.168.0', '192.168.2', '192.168.31', '10.0.0', '10.0.1']) {
      push(base);
    }
    return candidates;
  }

  /** 地址框里填的地址（去掉端口），用来推网段 */
  private addressHint(): string {
    return this.addressProvider?.() ?? '';
  }

  private showEmpty(): void {
    this.status.classList.add('empty');
    this.status.replaceChildren();
    const title = document.createElement('div');
    title.className = 'server-list-empty-title';
    title.textContent = t('server.empty');
    const list = document.createElement('ul');
    list.className = 'server-list-hints';
    const hints = [
      t('server.emptyHintHost'),
      tp('server.emptyHintPort', { port: String(this.port) }),
    ];
    if (!canScanLan(location.protocol)) hints.push(t('server.httpsHint'));
    for (const text of hints) {
      const item = document.createElement('li');
      item.textContent = text;
      list.append(item);
    }
    this.status.append(title, list);
  }

  /**
   * 追加一行。`fromPeer = true` 表示这台是从别的服务器 `/healthz` 听来的——
   * 它只入列表，**不再**继续做 `/healthz` 扩散（否则 peers 的 peers 会指数级长出来，
   * 表现是同一台机器在列表里出现好几遍）。
   */
  private appendServerRow(server: DiscoveredServer, fromPeer = false): void {
    const address = server.host;
    // 只认私网 / 回环：组播里偶尔会混进奇怪的地址（NAT、虚拟网卡），不要画到列表里
    if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(address)) return;
    const port = server.port > 0 ? server.port : this.port;
    const key = `${address}:${port}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);

    const host = document.createElement('div');
    host.className = 'server-list-host';
    host.dataset.address = address;
    host.dataset.port = String(port);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'server-list-item';
    const name = document.createElement('span');
    name.className = 'server-list-ip';
    name.textContent = address;
    const dash = document.createElement('span');
    dash.className = 'server-list-dash';
    const rtt = document.createElement('span');
    rtt.className = 'server-list-rtt';
    rtt.textContent = server.rttMs > 0 ? tp('server.rtt', { ms: String(server.rttMs) }) : '--';
    row.append(name, dash, rtt);
    row.addEventListener('click', () => {
      this.markPicked(row);
      // 点服务器 = 填地址+端口，房间名留在左侧让玩家自己决定
      this.onPick?.({ address, port });
    });

    const rooms = document.createElement('div');
    rooms.className = 'server-list-rooms';
    host.append(row, rooms);
    this.lanList.append(host);

    void this.loadRooms(address, port, rooms, fromPeer);
  }

  /** 高亮当前选中的那一行（服务器行或房间行互斥） */
  private markPicked(row: HTMLElement): void {
    for (const el of this.element.querySelectorAll('.server-list-item.picked, .server-list-room.picked')) {
      el.classList.remove('picked');
    }
    row.classList.add('picked');
  }

  /** 拉这一台的房间列表（失败就留一行灰字，不影响选这台机器） */
  private async loadRooms(
    address: string,
    port: number,
    container: HTMLDivElement,
    fromPeer: boolean,
  ): Promise<void> {
    const token = this.token;
    const url = `ws://${address}:${port}`;
    let maxPlayers = 10;
    try {
      const endpoint = roomsEndpoint(url);
      if (endpoint === null) return;
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 2500);
      const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' });
      window.clearTimeout(timer);
      if (token !== this.token) return;
      const parsed = parseRoomsResponse(await response.json());
      if (parsed === null || token !== this.token) return;
      maxPlayers = parsed.maxPlayers;
      if (parsed.rooms.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'server-list-room-empty';
        empty.textContent = t('server.noRooms');
        container.replaceChildren(empty);
      } else {
        container.replaceChildren(
          ...parsed.rooms.map((entry) =>
            this.makeRoomRow(address, port, entry.room, entry.players, maxPlayers, entry.hasHost),
          ),
        );
      }
    } catch {
      if (token !== this.token) return;
      const failed = document.createElement('div');
      failed.className = 'server-list-room-empty';
      failed.textContent = t('server.roomsFailed');
      container.replaceChildren(failed);
    }
    // 顺手借这台服务器的耳朵：它用 UDP 组播听到的其它设备（浏览器自己发不出 UDP）。
    // 只听**一层**：peer 来源的服务器不再扩散，否则会绕回来重复列出同一台。
    if (!fromPeer) void this.loadPeers(url, token);
  }

  /**
   * 房间行。没有房主的一律不可点（渲成 `div`），并标「无房主」说明为什么点不动。
   */
  private makeRoomRow(
    address: string,
    port: number,
    room: string,
    players: number,
    maxPlayers: number,
    hasHost: boolean,
  ): HTMLElement {
    const row = document.createElement(hasHost ? 'button' : 'div');
    if (row instanceof HTMLButtonElement) row.type = 'button';
    row.className = `server-list-room${hasHost ? '' : ' readonly'}`;
    row.dataset.room = room;
    const name = document.createElement('span');
    name.className = 'server-list-room-name';
    name.textContent = tp('server.roomName', { room });
    const online = document.createElement('span');
    online.className = 'server-list-room-online';
    const playersText = tp('mp.roomsPlayersOf', { n: players, max: maxPlayers });
    online.textContent = hasHost ? playersText : `${playersText} · ${t('mp.roomsNoHost')}`;
    row.append(name, online);
    if (hasHost) {
      row.addEventListener('click', () => {
        this.markPicked(row);
        this.onPick?.({ address, port, room });
      });
    }
    return row;
  }

  /** 读某台服务器的 `/healthz`，把它听到的其它设备补进列表（失败一律静默） */
  private async loadPeers(serverUrl: string, token: number): Promise<void> {
    const endpoint = healthEndpoint(serverUrl);
    if (endpoint === null) return;
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 2000);
      const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' });
      window.clearTimeout(timer);
      if (token !== this.token) return;
      const peers = parsePeersResponse(await response.json());
      if (peers === null || token !== this.token) return;
      for (const peer of filterSelfPeers(peers, [serverUrl])) {
        if (this.seen.has(`${peer.host}:${peer.port}`)) continue;
        this.appendServerRow({ host: peer.host, port: peer.port, rttMs: 0 }, true);
      }
    } catch {
      // 这台不回 /healthz（或跨源被挡）：跳过
    }
  }
}
