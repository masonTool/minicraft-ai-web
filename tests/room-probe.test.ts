/**
 * 探房（L9）
 *
 * 用假 socket 覆盖三条路径：正常拿到 welcome、被服务端拒、超时没回。
 * 真连接的那部分由浏览器手测（自测约定里不做端到端），这里钉的是**协议与收尾**：
 *  · 用一次性 clientId（复用本机那份会被判 duplicate）；
 *  · `world` 只认整数种子，脏的当没有；
 *  · 无论哪条路径都要关 socket、清定时器——否则面板上"正在连接房主的世界…"永远不散。
 */

import { describe, expect, it } from 'vitest';
import { probeRoom } from '../src/net/RoomProbe.ts';

interface FakeSocket {
  url: string;
  sent: string[];
  closed: boolean;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send: (data: string) => void;
  close: () => void;
}

function makeFakeSocket(): { socket: FakeSocket; factory: (url: string) => WebSocket } {
  const socket: FakeSocket = {
    url: '',
    sent: [],
    closed: false,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data: string) {
      socket.sent.push(data);
    },
    close() {
      socket.closed = true;
    },
  };
  const factory = (url: string): WebSocket => {
    socket.url = url;
    return socket as unknown as WebSocket;
  };
  return { socket, factory };
}

const options = { baseUrl: 'ws://127.0.0.1:25187', room: 'red', password: 'pw', name: '探针' };

describe('probeRoom', () => {
  it('连上 → 发 join → 收到 welcome 就带着世界返回，并关掉 socket', async () => {
    const { socket, factory } = makeFakeSocket();
    const pending = probeRoom(options, { createSocket: factory });
    socket.onopen!();
    const join = JSON.parse(socket.sent[0]!) as Record<string, unknown>;
    expect(join.t).toBe('join');
    expect(join.room).toBe('red');
    expect(join.password).toBe('pw');
    expect(join.host).toBeUndefined();
    expect(String(join.clientId)).toMatch(/^probe/);

    socket.onmessage!({
      data: JSON.stringify({
        t: 'welcome',
        v: 2,
        id: 3,
        seed: 424242,
        isHost: false,
        hostId: 1,
        world: { name: '草原小屋', seed: 424242, mode: 'survival', difficulty: 'hard', worldType: 'flat' },
      }),
    });
    const result = await pending;
    expect(result?.world).toMatchObject({ seed: 424242, name: '草原小屋', worldType: 'flat' });
    expect(result?.hostId).toBe(1);
    expect(socket.closed).toBe(true);
    // 地址里带上了房间与口令（面板拼地址那一层）
    // 2026-10-26：房间与口令改走 query（path 留给反代端点 `/ws`）
    expect(socket.url).toBe('ws://127.0.0.1:25187?room=red&pw=pw');
  });

  it('服务端拒（error）→ null', async () => {
    const { socket, factory } = makeFakeSocket();
    const pending = probeRoom(options, { createSocket: factory });
    socket.onopen!();
    socket.onmessage!({ data: JSON.stringify({ t: 'error', code: 'host-taken', message: 'no' }) });
    expect(await pending).toBeNull();
    expect(socket.closed).toBe(true);
  });

  it('连不上（error 事件）→ null', async () => {
    const { socket, factory } = makeFakeSocket();
    const pending = probeRoom(options, { createSocket: factory });
    socket.onerror!();
    expect(await pending).toBeNull();
  });

  it('一直不回 → 超时返回 null（面板不会永远转圈）', async () => {
    const { socket, factory } = makeFakeSocket();
    const pending = probeRoom({ ...options, timeoutMs: 20 }, { createSocket: factory });
    socket.onopen!();
    expect(await pending).toBeNull();
    expect(socket.closed).toBe(true);
  });

  it('脏种子（缺 world.seed 且 seed 不是整数）→ world 为 null，但连接结果照旧返回', async () => {
    const { socket, factory } = makeFakeSocket();
    const pending = probeRoom(options, { createSocket: factory });
    socket.onopen!();
    socket.onmessage!({ data: JSON.stringify({ t: 'welcome', v: 2, id: 1, seed: null }) });
    const result = await pending;
    expect(result).not.toBeNull();
    expect(result?.world).toBeNull();
  });
});
