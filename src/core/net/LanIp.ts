/**
 * 局域网 IP（用户 2026-10-27：**只从 native 桥拿，不猜**）。
 *
 * 为什么不再猜：之前试过三条路，都不成立——
 *  - `location.hostname`：App 的 webview 里是 `localhost`，按它推网段只能扫回环；
 *  - 地址框里的 IP：那是上一台服务器的地址，不是"我在哪个网"；
 *  - WebRTC：Chrome/Safari 把 host candidate 混淆成 `xxx.local`（mDNS 隐私保护），取不到真 IP。
 *
 * 桥本身在 `HostBridge.ts`（直接读壳注入的 `window.MinicraftAndroid`）。
 * 这里只保留联机界面用的两个判断，避免调用点到处改。
 */

import { hasHostBridge, hostLocalIp } from './HostBridge.ts';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** 调试/自测：浏览器里没有原生壳，用 `?lanip=192.168.1.20` 假装一台设备 */
function debugLanIp(): string | null {
  if (typeof location === 'undefined') return null;
  try {
    const value = new URLSearchParams(location.search).get('lanip');
    return value !== null && IPV4.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** 有没有可以用来查 IP 的桥（UI 用它决定要不要弹"需要完整版"） */
export function hasNativeLanBridge(): boolean {
  return hasHostBridge() || debugLanIp() !== null;
}

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
  return hostLocalIp();
}
