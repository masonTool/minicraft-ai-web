/**
 * 服务端地址的拆解（联机26）
 *
 * 房间码与口令都放在地址里（`ws://host:8787/red?pw=1234`），所以"拆得对不对"决定了
 * 玩家进的是不是他想进的那个房间。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NET_PORT,
  displayServerAddress,
  formatServerUrl,
  parseServerUrl,
  resolveDefaultServerUrl,
  roomsEndpoint,
  withDefaultPort,
} from '../src/core/net/ServerUrl.ts';
import { normalizeServerUrl } from '../src/ui/MultiplayerScreen.ts';

/**
 * 地址栏显示（用户要求 2026-10-25）：框里该是 IP，不是 `ws://` 长串。
 *
 * 这条比"字符串长什么样"更要紧的是**往返**：显示出去的那一段必须能被
 * `normalizeServerUrl` 再收回来，否则玩家照着框里的内容重填一次就连不上了。
 */
describe('displayServerAddress', () => {
  it('默认端口与协议头都不显示（只留 IP）', () => {
    expect(displayServerAddress(`ws://192.168.1.5:${DEFAULT_NET_PORT}`)).toBe('192.168.1.5');
    expect(displayServerAddress('ws://192.168.1.5')).toBe('192.168.1.5');
    expect(displayServerAddress('ws://mc.example.com')).toBe('mc.example.com');
  });

  it('显式非默认端口要留着（否则玩家看不出自己改过）', () => {
    expect(displayServerAddress('ws://192.168.1.5:9000')).toBe('192.168.1.5:9000');
    expect(displayServerAddress('wss://mc.example.com:8443')).toBe('mc.example.com:8443');
  });

  it('域名只留主机名（协议头由输入类型派生，不必再摆在框里）', () => {
    // 2026-10-26：地址栏收"IP 或域名"——`normalizeServerUrl` 会自动补 `wss://…/ws`
    expect(displayServerAddress('wss://mc.example.com')).toBe('mc.example.com');
    expect(displayServerAddress('wss://mc.example.com/ws')).toBe('mc.example.com');
    expect(displayServerAddress('wss://mc.example.com:8443/ws')).toBe('mc.example.com:8443');
  });

  it('非默认路径要留着（反代端点不一定是 /ws）', () => {
    expect(displayServerAddress('wss://mc.example.com/custom')).toBe('mc.example.com/custom');
  });

  it('空串与认不出的输入原样返回（不吞掉玩家的字）', () => {
    expect(displayServerAddress('')).toBe('');
    expect(displayServerAddress('   ')).toBe('');
    expect(displayServerAddress('这里不是地址')).toBe('这里不是地址');
  });

  it('往返：显示出来的能被地址栏重新收成同一个 URL', () => {
    for (const url of [
      `ws://192.168.1.5:${DEFAULT_NET_PORT}`,
      'ws://192.168.1.5:9000',
      'wss://mc.example.com/ws',
      'wss://mc.example.com:8443/ws',
      'wss://mc.example.com/custom',
    ]) {
      expect(normalizeServerUrl(displayServerAddress(url))).toBe(url);
    }
  });
});

describe('parseServerUrl', () => {
  it('裸地址：默认房间、无口令', () => {
    expect(parseServerUrl('ws://192.168.1.5:8787')).toEqual({ url: 'ws://192.168.1.5:8787', room: '', password: '' });
  });

  it('带尾斜杠也只当裸地址', () => {
    expect(parseServerUrl('ws://192.168.1.5:8787/').url).toBe('ws://192.168.1.5:8787');
  });

  it('第一段 path 是房间名', () => {
    const parsed = parseServerUrl('ws://192.168.1.5:8787/red');
    expect(parsed.room).toBe('red');
    expect(parsed.url).toBe('ws://192.168.1.5:8787');
  });

  it('`pw` 查询参数是口令', () => {
    const parsed = parseServerUrl('ws://192.168.1.5:8787/red?pw=1234');
    expect(parsed.room).toBe('red');
    expect(parsed.password).toBe('1234');
    // 口令不出现在真正要连的地址里（避免被日志原样记下来）
    expect(parsed.url).toBe('ws://192.168.1.5:8787');
  });

  it('多余层级的 path 不作数（拼出来的房名服务端也不认）', () => {
    expect(parseServerUrl('ws://host:1/a/b').room).toBe('');
  });

  it('`/ws` 反代端点不是房名（域名那一路的 path 属于端点）', () => {
    const parsed = parseServerUrl('wss://mc.example.com/ws');
    expect(parsed.room).toBe('');
    expect(parsed.url).toBe('wss://mc.example.com/ws');
  });

  it('`?room=` 优先于 path（新格式），老格式仍然认得', () => {
    const modern = parseServerUrl('wss://mc.example.com/ws?room=red&pw=1');
    expect(modern.room).toBe('red');
    expect(modern.password).toBe('1');
    expect(modern.url).toBe('wss://mc.example.com/ws');
    const legacy = parseServerUrl('ws://192.168.1.5:8787/red?pw=1');
    expect(legacy.room).toBe('red');
    expect(legacy.url).toBe('ws://192.168.1.5:8787');
  });

  it('非法地址原样返回（真正的校验在界面那一层）', () => {
    expect(parseServerUrl('这不是地址')).toEqual({ url: '这不是地址', room: '', password: '' });
  });
});

describe('resolveDefaultServerUrl（联机28）', () => {
  it('https 页面走同源 wss（混合内容会被浏览器拦）', () => {
    expect(resolveDefaultServerUrl('https:', 'mc.example.com', 'mc.example.com')).toBe('wss://mc.example.com/ws');
  });

  it('http 页面走固定的服务端端口', () => {
    expect(resolveDefaultServerUrl('http:', '192.168.1.5:5173', '192.168.1.5')).toBe(
      `ws://192.168.1.5:${DEFAULT_NET_PORT}`,
    );
  });

  it('host 带端口时仍只取 hostname（服务端端口固定，不跟页面端口走）', () => {
    expect(resolveDefaultServerUrl('http:', 'localhost:5173', 'localhost')).toBe(
      `ws://localhost:${DEFAULT_NET_PORT}`,
    );
  });
});

/*
 * 地址栏只收 IP 或域名（用户 2026-10-26）：协议头/端口/端点路径全部派生。
 *   · IP / localhost → 明文 ws + 固定端口（局域网直连）
 *   · 域名 → wss + `/ws`（公网站点有 TLS，端口交给反代）
 */
describe('normalizeServerUrl（IP 或域名）', () => {
  it('IP：ws + 固定端口', () => {
    expect(normalizeServerUrl('192.168.1.5')).toBe(`ws://192.168.1.5:${DEFAULT_NET_PORT}`);
    expect(normalizeServerUrl('localhost')).toBe(`ws://localhost:${DEFAULT_NET_PORT}`);
  });

  it('IP + 显式端口：端口不被替换', () => {
    expect(normalizeServerUrl('192.168.1.5:9000')).toBe('ws://192.168.1.5:9000');
  });

  it('域名：wss + /ws（不补 8887）', () => {
    expect(normalizeServerUrl('mc.example.com')).toBe('wss://mc.example.com/ws');
    expect(normalizeServerUrl('mc.example.com:8443')).toBe('wss://mc.example.com:8443/ws');
  });

  it('域名 + 自定义路径：路径优先，不再补 /ws', () => {
    expect(normalizeServerUrl('mc.example.com/custom')).toBe('wss://mc.example.com/custom');
  });

  it('显式协议原样尊重（老玩家存的 ws://host:8787 仍可用）', () => {
    expect(normalizeServerUrl('ws://192.168.1.5')).toBe(`ws://192.168.1.5:${DEFAULT_NET_PORT}`);
    expect(normalizeServerUrl('wss://mc.example.com/ws')).toBe('wss://mc.example.com/ws');
    expect(normalizeServerUrl('https://mc.example.com/ws')).toBe('wss://mc.example.com/ws');
  });

  it('空串 / 只有空白 → null（交给界面提示）', () => {
    expect(normalizeServerUrl('')).toBeNull();
    expect(normalizeServerUrl('   ')).toBeNull();
  });
});

/*
 * 只填 IP 也要能连（本轮）：玩家不该关心协议头与端口。
 * 显式端口必须保留——老玩家存的 `ws://host:8787` 与自定义部署都在用这条。
 */
describe('withDefaultPort（地址栏只收 IP）', () => {
  it('没写端口就补默认端口', () => {
    expect(withDefaultPort('ws://192.168.1.5')).toBe(`ws://192.168.1.5:${DEFAULT_NET_PORT}`);
  });

  it('显式端口原样保留（老地址 ws://host:8787 仍然可用）', () => {
    expect(withDefaultPort('ws://192.168.1.5:8787')).toBe('ws://192.168.1.5:8787');
    expect(withDefaultPort('ws://mc.example.com:9000')).toBe('ws://mc.example.com:9000');
  });

  it('wss 不补端口（https 站点经反代，端口由域名决定）', () => {
    expect(withDefaultPort('wss://mc.example.com')).toBe('wss://mc.example.com');
    expect(withDefaultPort('wss://mc.example.com/ws')).toBe('wss://mc.example.com/ws');
  });

  it('默认端口常量是 8887（换端口时这条会先红）', () => {
    expect(DEFAULT_NET_PORT).toBe(8887);
  });
});

/*
 * 拼地址（L9）：房间与口令过去只能手写进 URL，手机上根本敲不对。
 * 现在由「开房 / 加入」面板收集后再拼，所以这一对函数必须互补。
 */
describe('formatServerUrl', () => {
  it('房间与口令都填：走 query（path 留给反代端点）', () => {
    expect(formatServerUrl('ws://192.168.1.5:8787', 'red', '1234')).toBe('ws://192.168.1.5:8787?room=red&pw=1234');
    // 域名那一路的 path 是 `/ws`，再往后拼房名会让反代与解析都读错
    expect(formatServerUrl('wss://mc.example.com/ws', 'red', '')).toBe('wss://mc.example.com/ws?room=red');
  });

  it('只填房间', () => {
    expect(formatServerUrl('ws://192.168.1.5:8787', 'red', '')).toBe('ws://192.168.1.5:8787?room=red');
  });

  it('都不填 = 裸地址（不留尾斜杠）', () => {
    expect(formatServerUrl('ws://192.168.1.5:8787/', '', '')).toBe('ws://192.168.1.5:8787');
  });

  it('与 parseServerUrl 互补（含空格与特殊字符要转义）', () => {
    const url = formatServerUrl('ws://10.0.0.2:8787', 'room-a', 'a b&c');
    const parsed = parseServerUrl(url);
    expect(parsed.url).toBe('ws://10.0.0.2:8787');
    expect(parsed.room).toBe('room-a');
    expect(parsed.password).toBe('a b&c');
  });
});

/*
 * `/rooms` 的地址（L9）：房间列表与 WebSocket 在同一个端口，只换协议头。
 * 房间名在 path 里要去掉——列表是服务器级的，不是房间级的。
 */
describe('roomsEndpoint', () => {
  it('ws → http，同一端口', () => {
    expect(roomsEndpoint('ws://192.168.1.5:8787')).toBe('http://192.168.1.5:8787/rooms');
  });

  it('wss → https，且保留反代端点路径（只映射 /ws* 的反代会 404）', () => {
    expect(roomsEndpoint('wss://mc.example.com/ws')).toBe('https://mc.example.com/ws/rooms');
  });

  it('地址里带房间名也指向服务器级列表', () => {
    expect(roomsEndpoint('ws://192.168.1.5:8787/red?pw=1')).toBe('http://192.168.1.5:8787/rooms');
  });

  it('解析不出来返回 null（调用方退回手填）', () => {
    expect(roomsEndpoint('不是地址')).toBeNull();
    expect(roomsEndpoint('')).toBeNull();
  });
});
