/**
 * 局域网 IP（用户 2026-10-27：**只从 native 桥拿，不猜**）。
 *
 * 为什么不再猜：之前试过三条路，都不成立——
 *  - `location.hostname`：App 的 webview 里是 `localhost`，按它推网段只能扫回环；
 *  - 地址框里的 IP：那是上一台服务器的地址，不是"我在哪个网"；
 *  - WebRTC：Chrome/Safari 把 host candidate 混淆成 `xxx.local`（mDNS 隐私保护），取不到真 IP。
 *
 * 所以改成问宿主：完整版的原生壳能直接读网卡（Android `NetworkInterface` / iOS `getifaddrs`）。
 * **拿不到就说明不是完整版**，联机界面直接拒绝进入（用户 2026-10-27 的要求）。
 *
 * 桥的形状（与 `NativeServerPlugin` 一致）：
 *   `Capacitor.Plugins.NativeServer.localIp() → Promise<{ ip: string | null } | string | null>`
 */

interface NativeServerBridge {
  localIp?: () => Promise<unknown> | unknown;
}

interface CapacitorGlobal {
  Plugins?: Record<string, NativeServerBridge | undefined>;
}

/** 桥本身（没有就是精简版 / 网页版） */
export function nativeLanBridge(): NativeServerBridge | null {
  const capacitor = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  const plugin = capacitor?.Plugins?.['NativeServer'];
  if (plugin === undefined || plugin === null) return null;
  return typeof plugin.localIp === 'function' ? plugin : null;
}

/** 有没有可以用来查 IP 的桥（UI 用它决定要不要弹"需要完整版"） */
export function hasNativeLanBridge(): boolean {
  if (nativeLanBridge() !== null) return true;
  // 调试/自测：浏览器里没有原生壳，用 `?lanip=192.168.1.20` 假装一台设备
  return debugLanIp() !== null;
}

function debugLanIp(): string | null {
  if (typeof location === 'undefined') return null;
  try {
    const value = new URLSearchParams(location.search).get('lanip');
    return value !== null && /^\d{1,3}(\.\d{1,3}){3}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * 取本机局域网 IPv4。
 *
 * 返回 `null` = **拿不到**（不是完整版，或者宿主还没来得及提供）。
 * 调用方据此决定"拒绝进入联机"还是"继续扫"，所以这里对任何异常都收敛成 `null`，
 * 不抛错——一次桥调用失败不该让整个联机页崩掉。
 */
export async function getLanIp(): Promise<string | null> {
  const debug = debugLanIp();
  if (debug !== null) return debug;

  const bridge = nativeLanBridge();
  if (bridge === null) return null;

  try {
    // 桥可能不同步返回、也可能永远不 resolve（插件没实现）——1.5 秒就放弃
    const raw = await Promise.race([
      Promise.resolve(bridge.localIp?.()),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 1500);
      }),
    ]);
    const ip =
      typeof raw === 'string'
        ? raw
        : raw !== null && typeof raw === 'object' && 'ip' in raw
          ? (raw as { ip?: unknown }).ip
          : null;
    return typeof ip === 'string' && IPV4.test(ip) ? ip : null;
  } catch {
    return null;
  }
}
