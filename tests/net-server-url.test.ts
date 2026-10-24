/**
 * 服务端地址的拆解（联机26）
 *
 * 房间码与口令都放在地址里（`ws://host:8787/red?pw=1234`），所以"拆得对不对"决定了
 * 玩家进的是不是他想进的那个房间。
 */

import { describe, expect, it } from 'vitest';
import { formatServerUrl, parseServerUrl, resolveDefaultServerUrl, roomsEndpoint } from '../src/core/net/ServerUrl.ts';

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

  it('非法地址原样返回（真正的校验在界面那一层）', () => {
    expect(parseServerUrl('这不是地址')).toEqual({ url: '这不是地址', room: '', password: '' });
  });
});

describe('resolveDefaultServerUrl（联机28）', () => {
  it('https 页面走同源 wss（混合内容会被浏览器拦）', () => {
    expect(resolveDefaultServerUrl('https:', 'mc.example.com', 'mc.example.com')).toBe('wss://mc.example.com/ws');
  });

  it('http 页面走本地默认端口', () => {
    expect(resolveDefaultServerUrl('http:', '192.168.1.5:5173', '192.168.1.5')).toBe('ws://192.168.1.5:8787');
  });

  it('局域网 IP + 端口：host 带端口时仍只取 hostname（服务端端口固定 8787）', () => {
    expect(resolveDefaultServerUrl('http:', 'localhost:5173', 'localhost')).toBe('ws://localhost:8787');
  });
});

/*
 * 拼地址（L9）：房间与口令过去只能手写进 URL，手机上根本敲不对。
 * 现在由「开房 / 加入」面板收集后再拼，所以这一对函数必须互补。
 */
describe('formatServerUrl', () => {
  it('房间与口令都填：拼成 parseServerUrl 认得的样子', () => {
    expect(formatServerUrl('ws://192.168.1.5:8787', 'red', '1234')).toBe('ws://192.168.1.5:8787/red?pw=1234');
  });

  it('只填房间', () => {
    expect(formatServerUrl('ws://192.168.1.5:8787', 'red', '')).toBe('ws://192.168.1.5:8787/red');
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

  it('wss → https', () => {
    expect(roomsEndpoint('wss://mc.example.com/ws')).toBe('https://mc.example.com/rooms');
  });

  it('地址里带房间名也指向服务器级列表', () => {
    expect(roomsEndpoint('ws://192.168.1.5:8787/red?pw=1')).toBe('http://192.168.1.5:8787/rooms');
  });

  it('解析不出来返回 null（调用方退回手填）', () => {
    expect(roomsEndpoint('不是地址')).toBeNull();
    expect(roomsEndpoint('')).toBeNull();
  });
});
