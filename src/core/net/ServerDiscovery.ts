/**
 * 服务器发现（用户 2026-10-26）：填服务器地址时，除了手输还能"选一个"。
 *
 * 两个来源：
 *  1. **局域网扫描**：把本机网段 1~254 逐个打一次 `GET /ping`，谁能回谁是服务器；
 *  2. **公开服务器列表**：由某个 HTTP 接口下发（入口先留好，URL 还没定）。
 *
 * 为什么用 HTTP `/ping` 而不是 WebSocket 握手：
 *  · 扫描要在 254 个地址上并发，WebSocket 每条都要走完整握手（还得自己关），浏览器
 *    对同源并发连接数有限制，慢且容易被判成"在打端口"；
 *  · `/ping` 是个无状态的小接口（服务端不建玩家、不占房主位），RTT 直接反映"到那台机器有多远"。
 *
 * ⚠️ 浏览器限制：页面本身是 **https** 时，`http://局域网IP` 会被混合内容拦掉
 * （`ws://` 同理），扫描必然全部失败。这时界面要说明原因，而不是显示"没找到服务器"。
 *
 * 纯逻辑 + 注入依赖（`fetchJson` / `now`），`tests/server-discovery.test.ts` 直接断言。
 */

/** 联机服务端的默认端口（与 `ServerUrl.DEFAULT_NET_PORT` 同值；这里不 import 是为了让本模块能独立测） */
export const DEFAULT_SCAN_PORT = 8887;

/** 扫一个地址的默认超时：局域网正常 < 20ms，600ms 已经能覆盖"那台机器开着但很慢" */
export const DEFAULT_PROBE_TIMEOUT_MS = 600;

/** 并发上限：一次只打这么多个地址（太高会被浏览器排队，反而更慢） */
export const DEFAULT_SCAN_CONCURRENCY = 32;

export interface DiscoveredServer {
  host: string;
  port: number;
  /** 往返毫秒数（越小越近） */
  rttMs: number;
}

/** 探测用的接口路径（服务端 `server/index.mjs` 的 `/ping`） */
export const PING_PATH = '/ping';

/** `192.168.1.5` → `192.168.1`；不像 IPv4 就返回 `null`（域名/`localhost` 没法扫网段） */
export function subnetOf(host: string): string | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(host.trim());
  if (!match) return null;
  // 只支持常见的私网 /24：其它网段扫了也是给别人添麻烦
  const [a, b] = [Number(match[1]), Number(match[2])];
  const isPrivate =
    a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  return isPrivate ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/** `192.168.1` → 254 个候选地址（`192.168.1.1` ~ `192.168.1.254`） */
export function subnetHosts(base: string): string[] {
  const prefix = subnetOf(`${base}.1`);
  if (prefix === null) return [];
  const out: string[] = [];
  for (let i = 1; i <= 254; i += 1) out.push(`${prefix}.${i}`);
  return out;
}

/** 探测地址：`http://host:port/ping`（端口固定，RTT 不含 DNS） */
export function pingEndpoint(host: string, port: number = DEFAULT_SCAN_PORT): string {
  return `http://${host}:${port}${PING_PATH}`;
}

/** 探测依赖（测试里换成假的，避免真的打网络） */
export interface DiscoveryDeps {
  /** 打一个 URL；成功（能连上并拿到响应）返回 true，超时/拒绝返回 false。RTT 由调用方用 `now()` 夹 */
  reach: (url: string, timeoutMs: number) => Promise<boolean>;
  now: () => number;
}

/**
 * 探一台机器：返回 RTT（毫秒），探不到返回 `null`。
 *
 * 只认"能连上"这件事，不校验响应内容——局域网里可能跑着别的服务占了这个端口，
 * 但那时玩家点进去也会立刻失败，不值得为一个探测接口再定义一个响应格式。
 * （真正连的时候走 `HostPreflight`，那才是权威的可用性判断。）
 */
export async function probeHost(
  host: string,
  deps: DiscoveryDeps,
  port: number = DEFAULT_SCAN_PORT,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<number | null> {
  const startedAt = deps.now();
  const ok = await deps.reach(pingEndpoint(host, port), timeoutMs);
  if (!ok) return null;
  return Math.max(0, Math.round(deps.now() - startedAt));
}

/**
 * 扫一个网段，边扫边回调（界面能"发现一个显示一个"，不用等全部扫完）。
 *
 * 返回按 RTT 升序的列表：同一个网段里通常只有一两台，排序让"最近的那台"排最前面。
 */
export async function scanSubnet(
  base: string,
  deps: DiscoveryDeps,
  options: {
    port?: number;
    timeoutMs?: number;
    concurrency?: number;
    onFound?: (server: DiscoveredServer) => void;
    /** 中止（用户关掉面板）：返回 true 就别再打下一个地址了 */
    cancelled?: () => boolean;
  } = {},
): Promise<DiscoveredServer[]> {
  const hosts = subnetHosts(base);
  if (hosts.length === 0) return [];
  const port = options.port ?? DEFAULT_SCAN_PORT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_SCAN_CONCURRENCY, hosts.length));

  const found: DiscoveredServer[] = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < hosts.length) {
      if (options.cancelled?.() === true) return;
      const host = hosts[cursor]!;
      cursor += 1;
      const rttMs = await probeHost(host, deps, port, timeoutMs);
      if (rttMs === null) continue;
      const server: DiscoveredServer = { host, port, rttMs };
      found.push(server);
      options.onFound?.(server);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return found.sort((a, b) => a.rttMs - b.rttMs);
}

/**
 * 浏览器里的默认探测实现。
 *
 * `mode: 'no-cors'` 是必须的：局域网里的服务端不会给每个来源都加 CORS 头，
 * 而我们要的只是"这个地址有人在听"。代价是拿不到响应体（也不需要）。
 * ⚠️ 页面是 https 时，这类请求默认会被混合内容策略拦掉；但**不是绝对**：
 * Chrome 的「本地网络访问」权限（Local Network Access）开通后，https 页面可以访问
 * 局域网里的 `http://` / `ws://` 设备（Firefox 也有对应开关）。所以调用方**不要**
 * 因为页面是 https 就把扫描禁掉——照样扫，扫不到再用 `canScanLan()` 决定是否提示去授权。
 */
export const browserReach: DiscoveryDeps['reach'] = async (url, timeoutMs) => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    await fetch(url, {
      mode: 'no-cors',
      cache: 'no-store',
      // 带 abort 才能在超时后立刻腾出并发名额（否则 254 个地址要排到天荒地老）
      ...(controller ? { signal: controller.signal } : {}),
    });
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
};

/**
 * 这个页面**默认**能不能扫局域网（false = 很可能被混合内容拦掉，但可通过授权解决）。
 *
 * 用途只剩一个：决定"扫不到时要不要提示玩家去开『本地网络访问』权限"。
 * ⚠️ 不要拿它去禁用扫描按钮（用户 2026-10-26 明确：浏览器里可以授权放行）。
 */
export function canScanLan(protocol: string): boolean {
  return protocol !== 'https:';
}
