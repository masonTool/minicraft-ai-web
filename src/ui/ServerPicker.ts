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

  private opened = false;
  private scanning = false;

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

    this.panel.append(head, lanSection, publicSection);
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
    this.renderPublic();
    // https 页面扫不了局域网（混合内容），先把话说清楚，别让人白等
    if (!canScanLan(location.protocol)) {
      this.status.textContent = t('server.scanBlocked');
      this.scanButton.disabled = true;
    } else {
      this.scanButton.disabled = false;
    }
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
      this.status.textContent =
        found.length === 0 ? t('server.empty') : tp('server.found', { count: String(found.length), seconds });
    } finally {
      this.scanning = false;
      if (this.opened) this.scanButton.disabled = !canScanLan(location.protocol);
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
    row.addEventListener('click', () => this.pick(name));
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
      row.addEventListener('click', () => this.pick(server.address));
      return row;
    });
    this.publicList.replaceChildren(...rows);
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
