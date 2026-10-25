/**
 * 服务端地址的拆解（联机26）。
 *
 * 房间码与口令都塞在地址里，而不是在界面上再加两个输入框：
 *  - `ws://192.168.1.5:8787/red?pw=1234` → 房间 `red`，口令 `1234`；
 *  - `ws://192.168.1.5:8787` → 默认房间、无口令。
 *
 * 为什么这样定：联机9 的面板只有"地址 + 昵称"两行（横屏塞不下更多），而"换个房间"在
 * 实际使用里就是"换一条地址"——发给队友的也是一整条地址，复制粘贴即可。口令明文放在
 * 地址里，局域网自建场景可接受（**不是鉴权**，只防隔壁同事随手连）。
 *
 * 纯函数、不碰 WebSocket，`tests/net-server-url.test.ts` 直接断言。
 */

/**
 * 联机服务端的固定端口（**与 `server/protocol.mjs` 的 `DEFAULT_PORT` 相等**）。
 *
 * 为什么换掉 8787：
 *  - 8787 是各种 dashboard / 开发脚手架的常见默认口，和本机其它服务撞车的概率不低；
 *  - 更重要的是**不给玩家填端口**——地址栏只收 IP/主机名，端口由这里统一。
 *
 * 为什么是 25187：落在注册端口段（1024~49151）、避开 3000/5000/8000/8080/8888/9000/
 * 25565（Minecraft）这些"一看就知道"的默认值，扫端口的脚本也不常光顾。
 */
export const DEFAULT_NET_PORT = 25187;

export interface ParsedServerUrl {
  /** 去掉 path / query 的裸地址（真正用来连的） */
  url: string;
  /** 房间名（空串 = 服务端的默认房间） */
  room: string;
  /** 房间口令（空串 = 不发送） */
  password: string;
}

export function parseServerUrl(raw: string): ParsedServerUrl {
  try {
    const parsed = new URL(raw);
    // 房间名就是第一段 path；多余的层级视为非法（拼出来的房名服务端也不认）
    const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
    const room = segments.length === 1 ? segments[0]! : '';
    const password = parsed.searchParams.get('pw') ?? '';

    const bare = new URL(parsed.toString());
    bare.pathname = '/';
    bare.search = '';
    bare.hash = '';
    // `URL` 对裸主机也会补一个 `/`，去掉它才不会拼出 `ws://host:8787/`
    return { url: bare.toString().replace(/\/$/, ''), room, password };
  } catch {
    // 地址不合法时原样返回：真正的校验在 `MultiplayerScreen.normalizeServerUrl` 那一层，
    // 这里不该悄悄改写用户输入
    return { url: raw, room: '', password: '' };
  }
}

/**
 * 拼一条带房间与口令的地址（`parseServerUrl` 的逆运算，L9）。
 *
 * 房间与口令以前只能靠玩家手写进地址（`ws://host:8787/red?pw=1234`），手机上几乎不可能
 * 敲对。现在「开房 / 加入」面板收集到这两项后再拼——所以这里必须与 `parseServerUrl`
 * 成对：`parseServerUrl(formatServerUrl(u, r, p))` 一定还原本来的三个值。
 *
 * 空房间 / 空口令就不拼那一段（与"没填就别发"同一口径）。
 */
export function formatServerUrl(base: string, room: string, password: string): string {
  const bare = base.replace(/\/+$/, '');
  const path = room.length > 0 ? `/${encodeURIComponent(room)}` : '';
  const query = password.length > 0 ? `?pw=${encodeURIComponent(password)}` : '';
  return `${bare}${path}${query}`;
}

/**
 * 给"只写了 IP/主机名"的地址补上默认端口（玩家不该关心端口）。
 *
 * 只补 `ws://`：`wss://` 是 https 站点经反代进来的，端口由域名决定（443），
 * 硬补一个默认端口会把本来能用的地址弄坏。
 *
 * 已经写了端口（`host:9000`）的保持原样——那是显式指定，服务端可能真跑在别处。
 * ⚠️ 不处理 IPv6 字面量（`[::1]`），本项目的联机场景是局域网 IPv4 / 域名。
 */
export function withDefaultPort(url: string): string {
  const match = /^(wss?:\/\/)([^/:]+)$/i.exec(url);
  if (!match) return url;
  if (match[1]!.toLowerCase() === 'wss://') return url;
  return `${match[1]}${match[2]}:${DEFAULT_NET_PORT}`;
}

/**
 * 由 WebSocket 地址推出 `/rooms` 的 HTTP 地址（L9）。
 *
 * `GET /rooms` 与 WebSocket 在**同一个端口**上，所以只换协议头：`ws → http`、
 * `wss → https`；房间名在 path 里（`ws://h:8787/red`）要去掉，列表是服务器级的。
 * 解析不出来返回 `null` —— 调用方据此直接走"手填房间名"，不必先报错。
 */
export function roomsEndpoint(wsUrl: string): string | null {
  try {
    const parsed = new URL(wsUrl);
    const protocol = parsed.protocol === 'wss:' ? 'https:' : parsed.protocol === 'ws:' ? 'http:' : parsed.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return `${protocol}//${parsed.host}/rooms`;
  } catch {
    return null;
  }
}

/**
 * 默认的服务端地址（联机28）。
 *
 * 三种部署形态各一条规则，都是踩过的坑：
 *  - **页面在 https**：必须用 `wss://<同源>/ws`。浏览器会拦 `ws://`（混合内容），而且
 *    同源反代是唯一不需要额外开放端口的做法；
 *  - **页面在 http（本地开发 / 局域网直连）**：`ws://<hostname>:<DEFAULT_NET_PORT>`；
 *  - **`?server=` 显式指定**（部署到子路径或别的主机时）：原样用，不做任何推断。
 *
 * 纯函数、不碰 `window`，`tests/net-server-url.test.ts` 直接断言。
 */
export function resolveDefaultServerUrl(protocol: string, host: string, hostname: string): string {
  if (protocol === 'https:') return `wss://${host}/ws`;
  return `ws://${hostname}:${DEFAULT_NET_PORT}`;
}
