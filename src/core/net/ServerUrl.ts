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
 * 把用户输入的地址收成 `ws://` 或 `wss://`（联机26，2026-10-25 从 `ui/MultiplayerScreen` 搬来）。
 *
 * 为什么搬：开房对话框现在也要填地址（用户要求），而 UI 层之间互相 import 会在
 * "世界列表 → 联机面板" 之间拉出一条没必要的依赖。归一化本来就是地址模块的事。
 *
 * 手机上最容易漏的是**协议头与端口**：填 `192.168.1.5` 是常态，所以：
 *  - 没有协议头 → 补 `ws://`；
 *  - 没有端口 → 补 `DEFAULT_NET_PORT`（玩家不该关心端口）；
 *  - 填了 `http(s)://`（很多人记成网页地址）也顺手映射到 `ws(s)://`。
 * 这几种"猜"都能命中真实意图，而报错只会让人退出去重来。
 *
 * 空串、带空白、没有主机名的一律返回 `null`（交给界面提示）。
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

/**
 * 反过来：把内部用的 `ws://` 地址**显示成地址栏该有的样子**（用户要求 2026-10-25）。
 *
 * 症状（用户实测）：加入面板的地址框每次打开都被填成 `ws://192.168.1.5:25187`——
 * 可输入框的占位文案写着"只填 IP，端口已固定"。两处口径打架，玩家会以为要照着长串改。
 *
 * 语义上地址栏回答的是"**那台机器在哪**"，`ws://` 与固定端口都是实现细节：
 *  · `ws://host:25187` → `host`（默认端口不显示）；
 *  · `ws://host:9000` → `host:9000`（显式端口是玩家写的，得留着，否则他看不出自己改过）；
 *  · `wss://domain` → `wss://domain`（**协议头必须留**：地址栏对裸域名会补 `ws://`，
 *    显示成裸域名就等于让玩家下次重填时把 https 部署改成明文，直接连不上）；
 *  · `wss://domain:8443` → `wss://domain:8443`。
 *
 * ⚠️ 只用于**回填输入框**。存储、`_recent`、`formatServerUrl` 仍用完整 URL——
 * `normalizeServerUrl(displayServerAddress(u)) === u` 这条往返由测试钉住。
 */
export function displayServerAddress(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'wss:') return trimmed.replace(/\/+$/, '');
    if (parsed.protocol !== 'ws:') return trimmed;
    const defaultPort = parsed.port === String(DEFAULT_NET_PORT);
    return defaultPort || parsed.port === '' ? parsed.hostname : `${parsed.hostname}:${parsed.port}`;
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
