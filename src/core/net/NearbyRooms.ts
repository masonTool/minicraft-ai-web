/**
 * 附近房间（N6）：把 `/healthz` 里的 `peers` 洗成"点一下就能进"的房间。
 *
 * 为什么需要它：浏览器发不出也收不到 UDP 组播，所以"局域网自动发现"只能借道服务端——
 * 每台手机上的 Rust 服务端会用组播听别的实例（`server/rust/src/beacon.rs`），把听到的
 * 写进 `/healthz` 的 `peers`。面板读这份 `peers`，就有了"别的设备上的房间"。
 *
 * 三条纪律（每条都对应一个会进 DOM 的外部字段）：
 *  1. **地址只认 IPv4 / 主机名**：拼出来的是 `ws://host:port`，绝不能让怪字符进去；
 *  2. **过滤自己**：从**别人**的 `/healthz` 看，`peers` 里会有我们自己那一间
 *     （他的服务端听得到我们），不过滤的话列表里会出现"自己"，点进去等于连自己；
 *  3. **探测延迟用真连接**：同网段的延迟是选房间的唯一客观依据，而 `/healthz` 本来
 *     就轻，顺便当探针；探不到（超时/被挡）就显示"—"，不编一个数。
 *
 * 纯函数 + 可注入的 fetch：`tests/nearby-rooms.test.ts` 离线断言。
 */

/** 一台"别的设备上的服务器" */
export interface NearbyPeer {
  /** 显示名（世界名；房主没上报世界名时是房间名，可能为空） */
  name: string;
  /** 主机（IPv4 或主机名） */
  host: string;
  /** 房间名（空串 = 服务端默认房间） */
  room: string;
  /** 联机服务端端口 */
  port: number;
  players: number;
  hasHost: boolean;
  passwordRequired: boolean;
  worldSeed: number;
}

/**
 * 主机名白名单：只允许字母数字与 `.` `-`（IPv4 与常见主机名）。
 *
 * 不处理 IPv6 字面量（`[::1]`）——本项目的联机场景是局域网 IPv4 / 域名，
 * 而放行 `[]`/`:` 只会给"拼出一个怪地址"开一扇门。
 */
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,62})$/;

/** 房间名白名单（与 `server/node/protocol.mjs` 的 `ROOM_RE` 一致） */
const ROOM_RE = /^[A-Za-z0-9_-]{1,24}$/;

/** 从 `/healthz` 的响应里取 `peers`；`null` = 这份响应不像我们的服务端 */
export function parsePeersResponse(raw: unknown): NearbyPeer[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as { peers?: unknown };
  if (!Array.isArray(payload.peers)) return null;

  const peers: NearbyPeer[] = [];
  for (const item of payload.peers) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as {
      name?: unknown;
      port?: unknown;
      addr?: unknown;
      room?: unknown;
      players?: unknown;
      hasHost?: unknown;
      passwordRequired?: unknown;
      seed?: unknown;
    };
    const host = typeof entry.addr === 'string' ? entry.addr.trim() : '';
    if (!HOST_RE.test(host)) continue;
    const port = Number(entry.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const players = Number(entry.players);
    const seed = Number(entry.seed);
    peers.push({
      name: typeof entry.name === 'string' ? entry.name.slice(0, 32) : '',
      host,
      // 房名会拼进地址：走与服务端同一套字符集（不合法就当默认房间）
      room: typeof entry.room === 'string' && ROOM_RE.test(entry.room) ? entry.room : '',
      port,
      players: Number.isFinite(players) && players > 0 ? Math.trunc(players) : 1,
      hasHost: entry.hasHost === true,
      passwordRequired: entry.passwordRequired === true,
      worldSeed: Number.isInteger(seed) ? seed : 0,
    });
  }
  // 人多的排前面；人数相同按名字，保证列表稳定（否则每次刷新顺序都在跳）
  peers.sort((a, b) => b.players - a.players || a.name.localeCompare(b.name));
  return peers;
}

/** 这个 peer 的联机地址（点一下进房用的就是它；带房间名，否则会进错房） */
export function peerAddress(peer: NearbyPeer): string {
  const path = peer.room.length > 0 ? `/${peer.room}` : '';
  return `ws://${peer.host}:${peer.port}${path}`;
}

/**
 * 过滤掉"我们自己"：`selfUrls` 传我们已经知道的自身地址（当前面板里填的地址、
 * 本机服务端地址），比较时只看 `host:port`（房间名与口令不影响"这是不是同一台服务器"）。
 */
export function filterSelfPeers(peers: NearbyPeer[], selfUrls: string[]): NearbyPeer[] {
  const selfKeys = new Set<string>();
  for (const url of selfUrls) {
    const key = hostPortKey(url);
    if (key) selfKeys.add(key);
  }
  if (selfKeys.size === 0) return peers;
  return peers.filter((peer) => !selfKeys.has(`${peer.host}:${peer.port}`.toLowerCase()));
}

/** `ws://1.2.3.4:25187/room` → `1.2.3.4:25187`；解析不出来返回 `null` */
export function hostPortKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.host.length === 0) return null;
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 探一次延迟（毫秒，四舍五入）。探不到返回 `null`——界面显示"—"，**不编数字**。
 *
 * 为什么拿 `/healthz` 当探针：它跟 WebSocket 同一个端口、响应极轻（几百字节），
 * 而且本来就在读它（`peers` 从这来）。为了不让"列表刷不出来"拖住面板，
 * 单次探测有超时（默认 1.2 秒）。
 */
export async function probeLatency(
  peer: NearbyPeer,
  fetcher: typeof fetch,
  timeoutMs = 1200,
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetcher(`http://${peer.host}:${peer.port}/healthz`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    // 读掉 body：只测到首字节的话，慢网络下数字会好看得不真实
    await response.arrayBuffer();
    return Math.round(Date.now() - started);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
