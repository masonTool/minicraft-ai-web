/**
 * 「选择服务器」面板（用户 2026-10-26）。
 *
 * 用来回答"服务器地址填什么"：两个区域——
 *  1. **局域网**：填网段（默认从当前地址推出来）→ 扫描 254 个地址 → 谁回 `/ping` 谁列出来，带 RTT；
 *  2. **公开服务器**：由接口下发（入口先留好，URL 还没定，所以显示"暂未提供"）。
 *
 * 选中一台就把**地址写回调用方的输入框**（只写 IP/域名，协议头与端口照旧由
 * `normalizeServerUrl` 补），所以开房与加入两处能共用同一个面板。
 *
 * 为什么是弹层而不是页面：它是个"看一眼、点一下"的辅助面板，玩家选完马上就要回到
 * 原来的表单继续填房名/昵称；做成第三个视图反而要多两次"返回"。
 */

import {
  DEFAULT_SCAN_PORT,
  browserReach,
  canScanLan,
  scanSubnet,
  subnetOf,
  type DiscoveredServer,
} from '../core/net/ServerDiscovery.ts';
import { displayServerAddress } from '../core/net/ServerUrl.ts';
import { t, tp } from '../core/i18n/I18n.ts';

/** 本机「允许其它人建房」的状态键（只有内建服务端能力的客户端会读它） */
const ALLOW_HOSTING_KEY = 'mc.mp.allowHosting';

export interface ServerPickerActions {
  /** 当前输入框里的地址（用来推导默认网段，以及"当前"标记） */
  currentAddress: () => string;
  /** 选中一台服务器：把地址写回调用方 */
  onPick: (address: string) => void;
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
   * 为 false（web 版）时**整块「本机 / 允许其它人建房」都不渲染**：浏览器起不了监听
   * socket，做成能点的开关只会骗玩家。原生客户端把这个位改成 true，界面自动长出来。
   */
  localServer?: boolean;
}

interface PublicServer {
  name: string;
  address: string;
  region?: string;
}

export class ServerPicker {
  readonly element: HTMLDivElement;

  private readonly panel: HTMLDivElement;
  private readonly subnetInput: HTMLInputElement;
  private readonly scanButton: HTMLButtonElement;
  private readonly status: HTMLDivElement;
  private readonly lanList: HTMLDivElement;
  private readonly publicList: HTMLDivElement;
  private readonly confirmButton: HTMLButtonElement;

  private opened = false;
  private scanning = false;
  /**
   * 当前选中项（本批）：点一行只是**选中**，不立刻回填——底部「确定」才应用。
   *
   * 为什么改：以前点一下就关面板并回填，手机上很容易误触（列表行本来就窄，
   * 扫描结果是"边扫边冒出来"的，手指还没抬起来列表就重排了）。
   */
  private selected: { address: string; row: HTMLElement } | null = null;

  constructor(private readonly actions: ServerPickerActions) {
    this.element = document.createElement('div');
    this.element.id = 'server-picker';
    this.element.className = 'server-picker hidden';

    this.panel = document.createElement('div');
    this.panel.className = 'server-picker-panel';

    // ---- 标题行
    const head = document.createElement('div');
    head.className = 'server-picker-head';
    const title = document.createElement('span');
    title.className = 'server-picker-title';
    title.textContent = t('server.title');
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'mp-mini';
    closeButton.id = 'server-picker-close';
    closeButton.textContent = t('mp.close');
    closeButton.addEventListener('click', () => this.close());
    head.append(title, closeButton);

    // ---- 局域网
    const lanSection = document.createElement('div');
    lanSection.className = 'server-picker-section';
    const lanHead = document.createElement('div');
    lanHead.className = 'server-picker-label';
    lanHead.textContent = t('server.lan');

    const scanRow = document.createElement('div');
    scanRow.className = 'server-picker-row';
    this.subnetInput = document.createElement('input');
    this.subnetInput.type = 'text';
    this.subnetInput.className = 'world-input';
    this.subnetInput.id = 'server-subnet';
    this.subnetInput.inputMode = 'numeric';
    this.subnetInput.autocomplete = 'off';
    this.subnetInput.spellcheck = false;
    this.subnetInput.placeholder = t('server.scanHint');
    // 直接回车就扫（少点一次）
    this.subnetInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void this.scan();
    });
    this.scanButton = document.createElement('button');
    this.scanButton.type = 'button';
    this.scanButton.className = 'mp-mini';
    this.scanButton.id = 'server-scan';
    this.scanButton.textContent = t('server.scan');
    this.scanButton.addEventListener('click', () => void this.scan());
    scanRow.append(this.subnetInput, this.scanButton);

    this.status = document.createElement('div');
    this.status.className = 'server-picker-status';
    this.status.id = 'server-scan-status';

    this.lanList = document.createElement('div');
    this.lanList.className = 'server-picker-list';
    this.lanList.id = 'server-lan-list';

    lanSection.append(lanHead, scanRow, this.status, this.lanList);

    // ---- 公开服务器（接口预留）
    const publicSection = document.createElement('div');
    publicSection.className = 'server-picker-section';
    const publicHead = document.createElement('div');
    publicHead.className = 'server-picker-label';
    publicHead.textContent = t('server.public');
    this.publicList = document.createElement('div');
    this.publicList.className = 'server-picker-list';
    this.publicList.id = 'server-public-list';
    publicSection.append(publicHead, this.publicList);

    /*
     * ---- 底部：取消 / 确定（本批）
     *
     * 「确定」未选中时禁用：选中是这一层的唯一前提，先让玩家看见自己选的是哪台机器
     * 再应用，比"点一下就走"更可控（选错服务器的代价是连错一台机器）。
     */
    const actionsRow = document.createElement('div');
    actionsRow.className = 'server-picker-actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'mp-mini';
    cancelButton.id = 'server-picker-cancel';
    cancelButton.textContent = t('menu.cancel');
    cancelButton.addEventListener('click', () => this.close());
    this.confirmButton = document.createElement('button');
    this.confirmButton.type = 'button';
    this.confirmButton.className = 'mp-mini';
    this.confirmButton.id = 'server-picker-confirm';
    this.confirmButton.textContent = t('server.confirm');
    this.confirmButton.disabled = true;
    this.confirmButton.addEventListener('click', () => this.confirm());
    actionsRow.append(cancelButton, this.confirmButton);

    // 「本机」只在能内建服务端的客户端出现（web 版没有这一块）
    const localSection = this.buildLocalSection();
    this.panel.append(
      head,
      ...(localSection ? [localSection] : []),
      lanSection,
      publicSection,
      actionsRow,
    );
    this.element.append(this.panel);
    // 点遮罩关掉：这一层是"辅助面板"，不该有必须点按钮才能离开的感觉
    this.element.addEventListener('click', (event) => {
      if (event.target === this.element) this.close();
    });
  }

  open(): void {
    this.opened = true;
    this.element.classList.remove('hidden');
    this.subnetInput.value = this.suggestSubnet();
    this.status.textContent = '';
    this.lanList.replaceChildren();
    // 每次打开都是"重新挑一台"：上一次的选中不能留着，否则「确定」会悄悄沿用旧地址
    this.clearSelection();
    this.renderPublic();
    /*
     * https 页面**照样允许扫**（用户 2026-10-26）。
     *
     * 以前这里直接把按钮禁掉了，理由写的是"混合内容一定拦"。但这条并非绝对：
     * Chrome 的「本地网络访问」权限（Local Network Access，地址栏左侧的权限图标 /
     * 设置 → 隐私与安全 → 本地网络访问）开通之后，https 页面可以访问局域网里的
     * `http://` / `ws://` 设备——那正是"给没有证书的局域网设备开口子"的官方通道。
     * Firefox 也有对应开关。所以这里改成"照样扫，扫不到再提示去授权"，
     * 不能替玩家把一条其实可用的路堵死。
     */
    this.scanButton.disabled = false;
    this.status.textContent = canScanLan(location.protocol) ? '' : t('server.httpsHint');
  }

  close(): void {
    this.opened = false;
    this.element.classList.add('hidden');
  }

  get isOpen(): boolean {
    return this.opened;
  }

  dispose(): void {
    this.element.remove();
  }

  /**
   * 「本机」区（本批）：只有能内建服务端的客户端才有。
   *
   * 开关表达的是"这台设备是否作为服务器开放给别人建房"——状态存在本机，默认允许。
   * 真正的执行在原生客户端的内建服务器里；本批只把入口、默认值与语义定下来，
   * web 版整块不渲染（`localServer` 为 false）。
   */
  private buildLocalSection(): HTMLDivElement | null {
    if (this.actions.localServer !== true) return null;

    const section = document.createElement('div');
    section.className = 'server-picker-section';
    const label = document.createElement('div');
    label.className = 'server-picker-label';
    label.textContent = t('server.local');

    const row = document.createElement('div');
    row.className = 'server-picker-row';
    const title = document.createElement('span');
    title.className = 'server-picker-status';
    title.textContent = t('server.allowHosting');

    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'mp-mini';
    yes.id = 'server-allow-hosting-yes';
    yes.textContent = t('misc.yes');
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'mp-mini';
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

    row.append(title, yes, no);
    section.append(label, row);
    return section;
  }

  /** 本机开关状态（默认允许）：读不到（无痕模式）就当允许 */
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
      // 同上：记不住不影响这一局
    }
  }

  /** 默认网段：当前地址 → 页面地址 → 常见私网兜底 */
  private suggestSubnet(): string {
    const current = displayServerAddress(this.actions.currentAddress() ?? '');
    const fromCurrent = subnetOf(current.split(':')[0] ?? '');
    if (fromCurrent !== null) return fromCurrent;
    const fromPage = subnetOf(location.hostname);
    if (fromPage !== null) return fromPage;
    return '192.168.1';
  }

  /** 扫一个网段：边扫边显示（发现一个就加一行，不用等 254 个扫完） */
  private async scan(): Promise<void> {
    if (this.scanning) return;
    const base = this.subnetInput.value.trim() || this.suggestSubnet();
    this.scanning = true;
    this.scanButton.disabled = true;
    this.lanList.replaceChildren();
    this.status.textContent = t('server.scanning');
    const startedAt = performance.now();
    try {
      const found = await scanSubnet(
        base,
        { reach: browserReach, now: () => performance.now() },
        {
          onFound: (server) => this.appendLanRow(server),
          cancelled: () => !this.opened,
        },
      );
      if (!this.opened) return;
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
      if (found.length > 0) {
        this.status.textContent = tp('server.found', { count: String(found.length), seconds });
      } else if (!canScanLan(location.protocol)) {
        // 一个都没扫到，且页面是 https：最可能就是没授权，把"去哪授权"写在同一行
        this.status.textContent = `${t('server.empty')} · ${t('server.httpsHint')}`;
      } else {
        this.status.textContent = t('server.empty');
      }
    } finally {
      this.scanning = false;
      if (this.opened) this.scanButton.disabled = false;
    }
  }

  /** 一行 = 一台服务器：地址 + RTT；点一下填回去 */
  private appendLanRow(server: DiscoveredServer): void {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'server-picker-item';
    row.dataset.host = server.host;
    const name = server.port === DEFAULT_SCAN_PORT ? server.host : `${server.host}:${server.port}`;
    const label = document.createElement('span');
    label.textContent = name;
    const rtt = document.createElement('span');
    rtt.className = 'server-picker-rtt';
    rtt.textContent = tp('server.rtt', { ms: String(server.rttMs) });
    row.append(label, rtt);
    // 选中而不是直接回填（本批）：扫描结果是边扫边冒出来的，点一下就关面板太容易误触
    row.addEventListener('click', () => this.select(name, row));
    this.lanList.append(row);
  }

  /** 公开服务器：有接口就拉，没有就说明"预留" */
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
    const servers = await fetchPublicServers(url);
    if (!this.opened) return;
    if (servers.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'server-picker-status';
      hint.textContent = t('server.empty');
      this.publicList.replaceChildren(hint);
      return;
    }
    const rows = servers.map((server) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'server-picker-item';
      const name = document.createElement('span');
      name.textContent = server.region ? `${server.name} · ${server.region}` : server.name;
      const address = document.createElement('span');
      address.className = 'server-picker-rtt';
      address.textContent = server.address;
      row.append(name, address);
      row.addEventListener('click', () => this.select(server.address, row));
      return row;
    });
    this.publicList.replaceChildren(...rows);
  }

  /**
   * 选中一行（不应用）：高亮 + 点亮「确定」。
   *
   * 单选语义靠"移除上一行的高亮"维持——扫描过程中列表还在增长，玩家可能连点两行。
   */
  private select(address: string, row: HTMLElement): void {
    if (this.selected) {
      this.selected.row.classList.remove('selected');
      this.selected.row.removeAttribute('aria-selected');
    }
    this.selected = { address, row };
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

  /** 「确定」：把选中的地址交给调用方并关面板（未选中时按钮是禁用的，这里再兜一层） */
  private confirm(): void {
    if (!this.selected) return;
    this.pick(this.selected.address);
  }

  private pick(address: string): void {
    this.actions.onPick(address);
    this.close();
  }
}

/**
 * 拉公开服务器列表。形状不对就当"没有"（别让一个坏接口把面板卡住）。
 *
 * 期待 `{ servers: [{ name, address, region? }] }`；`address` 就是玩家要填的那段
 * （`192.168.1.5` 或 `mc.example.com`），协议头/端口照旧交给 `normalizeServerUrl`。
 */
export async function fetchPublicServers(url: string): Promise<PublicServer[]> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return [];
    const body = (await response.json()) as { servers?: unknown };
    if (!Array.isArray(body.servers)) return [];
    const out: PublicServer[] = [];
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
