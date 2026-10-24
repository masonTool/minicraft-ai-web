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
 * 默认的服务端地址（联机28）。
 *
 * 三种部署形态各一条规则，都是踩过的坑：
 *  - **页面在 https**：必须用 `wss://<同源>/ws`。浏览器会拦 `ws://`（混合内容），而且
 *    同源反代是唯一不需要额外开放端口的做法；
 *  - **页面在 http（本地开发 / 局域网直连）**：`ws://<hostname>:8787`，与服务端默认端口一致；
 *  - **`?server=` 显式指定**（部署到子路径或别的主机时）：原样用，不做任何推断。
 *
 * 纯函数、不碰 `window`，`tests/net-server-url.test.ts` 直接断言。
 */
export function resolveDefaultServerUrl(protocol: string, host: string, hostname: string): string {
  if (protocol === 'https:') return `wss://${host}/ws`;
  return `ws://${hostname}:8787`;
}
