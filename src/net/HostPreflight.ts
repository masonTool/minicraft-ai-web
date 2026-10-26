import { formatServerUrl, roomsEndpoint as roomsEndpointFrom } from '../core/net/ServerUrl.ts';

/**
 * 开房前的预检（用户 2026-10-26："开房失败不该能进入世界，应该拦住并提示"）。
 *
 * 为什么需要：开房以前是"先把世界建起来，再在后台连服务器"——服务器没起、地址填错、
 * 房名被占，玩家都已经站在世界里了，然后才收到一句 `host-taken` 或者干脆静默断开。
 * 建世界要跑地形生成（几秒 + 一堆内存），失败时这些都白做，体验还是"进去了又被打回来"。
 *
 * 所以在 `startWorld` **之前**问三件事（第二件是 best-effort）：
 *  ① 那台机器上真的能建立 WebSocket 吗（服务端在不在、地址对不对）；
 *  ② 这个房名是不是已经有房主（服务端 `/rooms` 里 `hasHost`）；
 *  ③ 都不是 → 放行，交给正式的 `connectOnline`。
 *
 * ⚠️ 预检**不发 `join`**：只连一次就关，不占房主位、不留玩家记录。
 * 发 join 再断开会把房主位占进 30 秒宽限期，正式开房反而会被 `host-taken` 拒掉
 * ——那正是"预检反而把功能弄坏"的经典翻车方式。
 */

/**
 * 被挡住的原因：连不上 / 房名已被占 / 页面协议不允许（https 页面连 `ws://`）。
 *
 * 最后那条单独列出来不是为了好看：**它跟网络无关**，是浏览器的混合内容策略，
 * 玩家改地址、换端口、重启服务器都白搭。以前这两种情况都回 `unreachable`，
 * 于是手机（页面在 https 上）开房失败时，看到的是一句"连不上服务器"，
 * 而真正的解决办法是"换个 http 地址打开游戏"或"给服务器上 wss"。
 */
export type HostBlockReason = 'unreachable' | 'taken' | 'https-blocked';

/** 服务端 `/rooms` 里我们关心的那一行 */
export interface RoomListingEntry {
  room: string;
  hasHost: boolean;
}

export interface HostPreflightDeps {
  /** 只为可测：默认用全局 `WebSocket` */
  createSocket?: (url: string) => WebSocket;
  /** 只为可测：默认去 `roomsEndpoint()` 拉列表；`null` = 拿不到（不影响判定） */
  fetchRooms?: (baseUrl: string) => Promise<RoomListingEntry[] | null>;
  timeoutMs?: number;
  /** 只为可测：页面协议，默认读 `location.protocol` */
  pageProtocol?: string;
}

const OPEN_TIMEOUT_MS = 3000;

/**
 * 能不能和目标建立 WebSocket（**不**发 join，连上就关）。
 *
 * `onopen` 才算成功：`onerror` 在浏览器里对"连接被拒"和"DNS 解析失败"都会触发，
 * 而 `onclose` 只有握手之后才有——只等 open 是最短且最准的判据。
 */
function canOpen(url: string, createSocket: (url: string) => WebSocket, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: WebSocket | null = null;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // 已经关了：预检不在乎
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      socket = createSocket(url);
    } catch {
      finish(false);
      return;
    }
    socket.onopen = () => finish(true);
    socket.onerror = () => finish(false);
    socket.onclose = () => finish(false);
  });
}

/** 拉一次房间列表（best-effort：跨源/离线/老服务端都可能失败，失败就当"没人占"） */
async function fetchRoomsDefault(baseUrl: string): Promise<RoomListingEntry[] | null> {
  const endpoint = roomsEndpointFrom(baseUrl);
  if (endpoint === null || typeof fetch !== 'function') return null;
  try {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = (await response.json()) as { rooms?: Array<{ room?: unknown; hasHost?: unknown }> };
    if (!Array.isArray(payload.rooms)) return null;
    return payload.rooms
      .filter((entry): entry is { room: string; hasHost?: unknown } => typeof entry.room === 'string')
      .map((entry) => ({ room: entry.room, hasHost: entry.hasHost === true }));
  } catch {
    return null;
  }
}

/**
 * 开房预检。返回 `null` 表示"可以开"，否则是被挡的原因。
 *
 * 顺序是先探测连通性再查房名：连不上时列表也一定拿不到，先探能少一次无谓的 fetch。
 */
export async function preflightHost(
  options: { baseUrl: string; room: string },
  deps: HostPreflightDeps = {},
): Promise<HostBlockReason | null> {
  const createSocket = deps.createSocket ?? ((target: string) => new WebSocket(target));
  const timeoutMs = deps.timeoutMs ?? OPEN_TIMEOUT_MS;
  const fetchRooms = deps.fetchRooms ?? fetchRoomsDefault;

  const url = formatServerUrl(options.baseUrl, options.room, '');

  const pageProtocol = deps.pageProtocol ?? (typeof location === 'undefined' ? '' : location.protocol);
  const insecureTarget = /^ws:\/\//i.test(url);

  /*
   * **先尝试**，不要因为"页面是 https + 目标是 ws://"就提前拒绝（用户 2026-10-26）。
   *
   * 以前这里直接返回 `https-blocked`，理由写的是"混合内容一定拦"。但这条不绝对：
   * Chrome 的「本地网络访问」权限（Local Network Access）开通之后，https 页面可以访问
   * 局域网设备（`http://` / `ws://` 都行），Firefox 也有对应开关——那正是给"没有证书的
   * 局域网服务器"留的官方口子。提前拒绝等于把一条其实可用的路堵死。
   *
   * 所以：照常连；连不上**且**是这种"https 连 ws://"的组合时，才把原因归到那一头
   * （因为这时候"去授权"比"改 IP"更可能是正解），文案里两条办法都给。
   */
  const reachable = await canOpen(url, createSocket, timeoutMs);
  if (!reachable) {
    return pageProtocol === 'https:' && insecureTarget ? 'https-blocked' : 'unreachable';
  }

  const rooms = await fetchRooms(options.baseUrl);
  if (rooms !== null && rooms.some((entry) => entry.room === options.room && entry.hasHost)) return 'taken';
  return null;
}
