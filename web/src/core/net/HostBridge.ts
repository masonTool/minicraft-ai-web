/**
 * 宿主桥：Android 壳注入的 `window.MinicraftAndroid`。
 *
 * 为什么不再用 Capacitor 的形状：这个游戏**已经不再走 Capacitor**，
 * 壳是自己写的一层 WebView。为了一张"像 Capacitor"的脸去多写一段 shim，
 * 只会让两边都不好懂。现在直接读注入对象，没有它就是普通浏览器。
 *
 * 能力只有四个，都是同步调用、返回 JSON 字符串（`@JavascriptInterface` 的约束）：
 *   - `localIp()`     → `{"ip":"192.168.1.5"}`，拿不到时 `{"ip":null}`
 *   - `serverPort()`  → `{"port":8887}`，0 = 没在跑
 *   - `startServer()` → 立即返回，端口要靠轮询 `serverPort()` 等（JNI 绑端口最多 3 秒）
 *   - `stopServer()`  → 立即返回
 *
 * ⚠️ 浏览器里这些全是 null/0：联机只能"加入别人的房间"，**不能开房**
 * （https 页面连 `ws://局域网` 会被浏览器按混合内容拦掉，只有我们自己的 WebView 放行）。
 */

export interface HostServerInfo {
  ip: string;
  port: number;
}

interface RawHostBridge {
  localIp?: () => unknown;
  serverPort?: () => unknown;
  startServer?: () => unknown;
  stopServer?: () => unknown;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** 轮询间隔：JNI 绑端口通常几十毫秒就好，这个频率既及时又不烧 CPU */
const POLL_INTERVAL_MS = 120;
/** 起服务端的上限：与原生侧"最多 3 秒"对齐，再留一点余量 */
const START_TIMEOUT_MS = 4000;

function hostBridge(): RawHostBridge | null {
  const scope = globalThis as { MinicraftAndroid?: RawHostBridge };
  const bridge = scope.MinicraftAndroid;
  if (bridge === undefined || bridge === null) return null;
  return typeof bridge.localIp === 'function' ? bridge : null;
}

/** 有没有原生宿主（UI 用它决定要不要弹"完整版"、要不要显示"本机"） */
export function hasHostBridge(): boolean {
  return hostBridge() !== null;
}

function readJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 本机局域网 IPv4；拿不到返回 null（HTTP 失败、桥没实现、还没联网都算） */
export function hostLocalIp(): string | null {
  const bridge = hostBridge();
  if (bridge === null) return null;
  try {
    const ip = readJson(bridge.localIp?.())?.['ip'];
    return typeof ip === 'string' && IPV4.test(ip) ? ip : null;
  } catch {
    return null;
  }
}

/** 服务端当前端口；0 = 没在跑 */
export function hostServerPort(): number {
  const bridge = hostBridge();
  if (bridge === null) return 0;
  try {
    const port = readJson(bridge.serverPort?.())?.['port'];
    return typeof port === 'number' && port > 0 ? port : 0;
  } catch {
    return 0;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 我们是不是"开过房并且在等它关"（只有这种时候 stop 才有意义） */
let hosting = false;

/**
 * 起服务端并**等到端口就绪**。
 *
 * 为什么必须等：开房流程紧接着就是 `preflightHost`（连一次服务端）。
 * 如果这里"发了就返回"，预检会去连一个还没监听的端口，必然失败——
 * 玩家看到的是"连不上服务器"，而真正原因只是服务端还没绑好。
 *
 * @returns 就绪的地址；失败（超时/桥缺失）返回 null，并且会把半启动的服务停掉
 */
export async function startHostServer(
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<HostServerInfo | null> {
  const bridge = hostBridge();
  if (bridge === null) return null;

  const timeoutMs = options.timeoutMs ?? START_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;

  try {
    bridge.startServer?.();
  } catch {
    return null;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const port = hostServerPort();
    if (port > 0) {
      const ip = hostLocalIp();
      if (ip !== null) {
        hosting = true;
        return { ip, port };
      }
    }
    await sleep(intervalMs);
  }

  // 起来了但一直拿不到 IP / 端口：别把半死不活的服务留着
  try {
    bridge.stopServer?.();
  } catch {
    // 已经停了
  }
  return null;
}

/** 停服务端（没开过房就是空操作，加入别人房间的人不会误伤自己的服务） */
export function stopHostServer(): void {
  if (!hosting) return;
  hosting = false;
  try {
    hostBridge()?.stopServer?.();
  } catch {
    // 停不了就算了：进程退出时前台服务也会跟着结束
  }
}

/** 宿主给的服务器地址（`ws://<本机局域网IP>:<端口>`）；没有/没在跑时返回 null */
export function hostServerUrl(): string | null {
  const ip = hostLocalIp();
  const port = hostServerPort();
  return ip !== null && port > 0 ? `ws://${ip}:${port}` : null;
}
