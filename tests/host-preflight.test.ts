/**
 * 开房预检（用户 2026-10-26："开房失败不该能进入世界，应该拦住并提示"）。
 *
 * 三条分支各一个用例：连不上 → 拦、房名被占 → 拦、都通过 → 放行。
 * 用假的 socket / fetch 注入，不真的连服务器（真连会变成"测试环境依赖网络"）。
 */
import { describe, expect, it } from 'vitest';
import { preflightHost } from '../src/net/HostPreflight.ts';

/** 假 WebSocket：按 `mode` 决定 open / error / 永不回应 */
class FakeSocket {
  static mode: 'open' | 'error' | 'hang' = 'open';
  static lastUrl = '';
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    FakeSocket.lastUrl = url;
    if (FakeSocket.mode === 'open') setTimeout(() => this.onopen?.(), 0);
    else if (FakeSocket.mode === 'error') setTimeout(() => this.onerror?.(), 0);
  }
  close(): void {
    this.closed = true;
  }
}

const deps = (rooms: Array<{ room: string; hasHost: boolean }> | null) => ({
  createSocket: (url: string) => new FakeSocket(url) as unknown as WebSocket,
  fetchRooms: async () => rooms,
  timeoutMs: 50,
});

describe('preflightHost', () => {
  it('连不上 → unreachable（拦住，别建世界）', async () => {
    FakeSocket.mode = 'error';
    expect(await preflightHost({ baseUrl: 'ws://192.168.1.5:25187', room: 'red' }, deps(null))).toBe('unreachable');
  });

  it('超时没 open → 也算 unreachable', async () => {
    FakeSocket.mode = 'hang';
    expect(await preflightHost({ baseUrl: 'ws://192.168.1.5:25187', room: 'red' }, deps(null))).toBe('unreachable');
  });

  it('房名已被占 → taken', async () => {
    FakeSocket.mode = 'open';
    expect(
      await preflightHost(
        { baseUrl: 'ws://192.168.1.5:25187', room: 'red' },
        deps([{ room: 'red', hasHost: true }, { room: 'blue', hasHost: false }]),
      ),
    ).toBe('taken');
  });

  it('同名房间但没房主 → 放行（宽限期里的空房可以接手）', async () => {
    FakeSocket.mode = 'open';
    expect(
      await preflightHost({ baseUrl: 'ws://192.168.1.5:25187', room: 'red' }, deps([{ room: 'red', hasHost: false }])),
    ).toBeNull();
  });

  it('拿不到房间列表 → 不影响放行（best-effort）', async () => {
    FakeSocket.mode = 'open';
    expect(await preflightHost({ baseUrl: 'ws://192.168.1.5:25187', room: 'red' }, deps(null))).toBeNull();
  });

  it('探测用的 URL 带上了房名，但**不发 join**（连上就关）', async () => {
    FakeSocket.mode = 'open';
    let socket: FakeSocket | null = null;
    await preflightHost(
      { baseUrl: 'wss://mc.example.com/ws', room: 'red' },
      {
        createSocket: (url) => {
          socket = new FakeSocket(url);
          return socket as unknown as WebSocket;
        },
        fetchRooms: async () => null,
        timeoutMs: 50,
      },
    );
    expect(FakeSocket.lastUrl).toBe('wss://mc.example.com/ws?room=red');
    expect(socket!.closed).toBe(true);
  });
});
