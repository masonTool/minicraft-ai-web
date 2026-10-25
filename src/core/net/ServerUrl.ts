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
    /*
     * 房间名（2026-10-26 改口径）：**优先读 query**（`?room=red`）。
     *
     * 为什么要改：地址栏现在收的是"IP 或域名"，而域名那一路会被派生成
     * `wss://domain/ws`——path 已经被反代端点占住了。老口径"第一段 path 是房间"会把
     * `/ws` 当成房名，玩家就会莫名其妙进一个叫 "ws" 的房间。老地址（`/red?pw=1`）
     * 继续按 path 解析，只跳过 `/ws` 这个端点段。
     */
    const pathRoom = legacyRoomFromPath(parsed);
    const room = parsed.searchParams.get('room') ?? pathRoom;
    const password = parsed.searchParams.get('pw') ?? '';

    const bare = new URL(parsed.toString());
    // 老格式的房间段要去掉；`/ws` 这类反代端点**必须留着**，它是真正要连的地址
    bare.pathname = pathRoom.length > 0 ? '/' : parsed.pathname;
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
  /*
   * 房间与口令走 **query**，不再拼进 path（2026-10-26）。
   *
   * 域名那一路的地址是 `wss://domain/ws`，path 已经属于反代端点；再往后拼 `/red`
   * 就变成 `wss://domain/ws/red`，反代与 `parseServerUrl` 都会读错。
   * `?room=red` 与端点路径互不干扰，老地址（`/red?pw=1`）仍能被 `parseServerUrl` 认出来。
   */
  const bare = base.replace(/\/+$/, '');
  const params = new URLSearchParams();
  if (room.length > 0) params.set('room', room);
  if (password.length > 0) params.set('pw', password);
  const query = params.toString();
  return query.length > 0 ? `${bare}?${query}` : bare;
}

/**
 * 域名那一路的默认 WS 端点（反代把 `/ws` 指到联机服务端）。
 *
 * 与 `resolveDefaultServerUrl()` 给 https 页面用的路径**必须一致**：同一个部署，
 * 一处拼 `/ws`、另一处拼 `/ws/`，玩家就会看到"默认能连、手填连不上"。
 */
export const DEFAULT_WS_PATH = '/ws';

/**
 * 这是不是一个"网段地址"（走明文 ws + 固定端口的那一类）。
 *
 * 判据只有两个来源：局域网 IP（IPv4 / `[IPv6]`）与本机名（`localhost`、`*.local`）。
 * **域名一律不算**——域名意味着它挂在公网、多半有 TLS，按 `wss://域名/ws` 派生。
 */
export function isLanHost(host: string): boolean {
  if (host.length === 0) return false;
  if (host === 'localhost' || host.toLowerCase().endsWith('.local')) return true;
  if (/^\[[0-9a-f:.]+\]$/i.test(host)) return true; // [::1] / [fe80::1]
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host); // 192.168.1.5
}

/**
 * 老格式的房名段（`ws://host:8787/red`）：**只有一段 path 且不是 `/ws`** 才算。
 *
 * 这条只为"粘一条老地址进来还能用"而留；新格式的房间在 `?room=` 里。
 */
function legacyRoomFromPath(parsed: URL): string {
  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 1) return '';
  const only = segments[0]!;
  return only.toLowerCase() === DEFAULT_WS_PATH.slice(1) ? '' : only;
}

/**
 * 裸输入（没有协议头）→ 完整地址（用户 2026-10-26："填 IP 或域名，前后缀自动补"）。
 *
 * 两条规则，各自对应一种部署形态：
 *  - **局域网地址**（IP / localhost）：`ws://host:<DEFAULT_NET_PORT>`，玩家不填端口；
 *  - **域名**：`wss://host/ws`，端口走 443 由反代终结——域名几乎总是公网 + TLS，
 *    补成 `ws://域名:25187` 是必然连不上的那种"看起来填对了"。
 * 玩家显式写了端口/路径就保留（那是他清楚自己在做什么）。
 */
function deriveFromBare(input: string): string | null {
  const match = /^(\[[^\]]+\]|[^/\s:]+)(:\d+)?(\/\S*)?$/.exec(input);
  if (!match) return null;
  const host = match[1]!;
  const port = match[2] ?? '';
  const path = match[3] ?? '';
  if (isLanHost(host)) return `ws://${host}${port.length > 0 ? port : `:${DEFAULT_NET_PORT}`}${path}`;
  return `wss://${host}${port}${path.length > 0 ? path : DEFAULT_WS_PATH}`;
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
 * 把用户输入的地址收成 `ws://` 或 `wss://`（联机26，2026-10-25 从 `ui/MultiplayerScreen` 搬来）。
 *
 * 为什么搬：开房对话框现在也要填地址（用户要求），而 UI 层之间互相 import 会在
 * "世界列表 → 联机面板" 之间拉出一条没必要的依赖。归一化本来就是地址模块的事。
 *
 * 地址栏只收**IP 或域名**（用户 2026-10-26 再次明确），协议头与端口都由这里派生：
 *  - 没有协议头 + 是 IP/localhost → `ws://host:<DEFAULT_NET_PORT>`（局域网直连）；
 *  - 没有协议头 + 是域名 → `wss://host/ws`（公网站点一律有 TLS，端口交给反代）；
 *  - 写了 `http(s)://`（很多人记成网页地址）→ 映射到 `ws(s)://`；
 *  - 写了 `ws(s)://` → 原样尊重，只补 `ws://` 缺的默认端口。
 * 这几种"猜"都能命中真实意图，而报错只会让人退出去重来。
 *
 * 空串、带空白、没有主机名的一律返回 `null`（交给界面提示）。
 */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  let value: string;
  if (/^https:\/\//i.test(trimmed)) value = `wss://${trimmed.slice('https://'.length)}`;
  else if (/^http:\/\//i.test(trimmed)) value = `ws://${trimmed.slice('http://'.length)}`;
  else if (/^wss?:\/\//i.test(trimmed)) value = trimmed;
  else {
    // 裸输入（只有 IP 或域名）：前后缀自动补，见 `deriveFromBare`
    const derived = deriveFromBare(trimmed);
    if (derived === null) return null;
    value = derived;
  }

  // 末尾的斜杠对 WebSocket 没意义（`ws://host:25187/` 与不带斜杠等价），统一去掉
  value = value.replace(/\/+$/, '');
  // 主机名必须存在、且不含空白（`ws://foo bar` 这种是粘贴坏了）
  if (!/^wss?:\/\/[^\s/]+(\/\S*)?$/i.test(value)) return null;
  return withDefaultPort(value);
}

/**
 * 反过来：把内部用的 `ws://` 地址**显示成地址栏该有的样子**（用户要求 2026-10-25）。
 *
 * 症状（用户实测）：加入面板的地址框每次打开都被填成 `ws://192.168.1.5:25187`——
 * 可输入框的占位文案写着"只填 IP，端口已固定"。两处口径打架，玩家会以为要照着长串改。
 *
 * 语义上地址栏回答的是"**那台机器在哪**"，协议头、端口、反代端点都是实现细节：
 *  · `ws://host:25187` → `host`（默认端口不显示）；
 *  · `ws://host:9000` → `host:9000`（显式端口是玩家写的，得留着，否则他看不出自己改过）；
 *  · `wss://domain/ws` → `domain`（`/ws` 是反代端点，`normalizeServerUrl` 会补回来）；
 *  · `wss://domain:8443/ws` → `domain:8443`；
 *  · `wss://domain/custom` → `domain/custom`（非默认路径得留着，否则改不回去）。
 *
 * ⚠️ 只用于**回填输入框**。存储、`_recent`、`formatServerUrl` 仍用完整 URL——
 * `normalizeServerUrl(displayServerAddress(u)) === u` 这条往返由测试钉住。
 */
export function displayServerAddress(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return trimmed;
    /*
     * 2026-10-26 起地址栏收"IP 或域名"，协议头由 `normalizeServerUrl` 按地址类型**派生**，
     * 所以这里不必再保留 `wss://`（以前留着是因为裸域名会被补成明文，现在不会了）。
     * 显示规则：host（+ 非默认端口）（+ 非默认路径）。
     */
    const defaultPort = parsed.protocol === 'wss:' ? '443' : String(DEFAULT_NET_PORT);
    const host = parsed.port === '' || parsed.port === defaultPort ? parsed.hostname : `${parsed.hostname}:${parsed.port}`;
    const path = parsed.pathname.replace(/\/+$/, '');
    const defaultPath = path === '' || (parsed.protocol === 'wss:' && path === DEFAULT_WS_PATH);
    return defaultPath ? host : `${host}${path}`;
  } catch {
    return trimmed;
  }
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
    /*
     * 2026-10-26：保留 WS 的**端点路径**（`wss://domain/ws` → `https://domain/ws/rooms`）。
     * 公网那一路的反代通常只映射 `/ws*`（`handle_path /ws*` 会去掉前缀再转发），
     * 写死根路径的 `/rooms` 会 404——表现是"房间列表永远为空"，很难归因。
     */
    // 老格式的 `/red` 是房名、不是端点，要去掉；`/ws` 这类端点路径要留着
    const legacyRoom = legacyRoomFromPath(parsed);
    const path = legacyRoom.length > 0 ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${protocol}//${parsed.host}${path}/rooms`;
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
