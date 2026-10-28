/**
 * 宿主桥（`window.MinicraftAndroid`）。
 *
 * 这里测的是**开房那一跳的时序**，不是"能不能连上服务器"：
 *  - 起服务是异步的（JNI 绑端口最多 3 秒），所以必须轮询到端口就绪再返回，
 *    否则紧接着的 `preflightHost` 会去连一个还没监听的端口，必然失败；
 *  - 起不来时必须把半启动的服务停掉，不能留一个端口开着、界面却报失败的残局；
 *  - 没开过房的人（加入方）不能误伤自己的服务：`stopHostServer` 要是空操作。
 *
 * 浏览器（没有桥）那几条同样重要：网页版只能加入、不能开房。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

type RawBridge = Record<string, () => string>;

function installBridge(bridge: RawBridge | null): void {
  const scope = globalThis as { MinicraftAndroid?: unknown };
  if (bridge === null) {
    delete scope.MinicraftAndroid;
  } else {
    scope.MinicraftAndroid = bridge;
  }
}

/** 每个用例都拿一份"新模块"：`hosting` 是模块内状态，不能跨用例串 */
async function freshHostBridge() {
  vi.resetModules();
  return import('../src/core/net/HostBridge.ts');
}

const ip = (value: string | null): string => JSON.stringify({ ip: value });
const port = (value: number): string => JSON.stringify({ port: value });

afterEach(() => {
  installBridge(null);
});

describe('没有宿主（浏览器）', () => {
  it('不认为有桥，也起不了服务', async () => {
    installBridge(null);
    const bridge = await freshHostBridge();
    expect(bridge.hasHostBridge()).toBe(false);
    expect(bridge.hostServerUrl()).toBeNull();
    expect(await bridge.startHostServer({ timeoutMs: 50, intervalMs: 10 })).toBeNull();
  });
});

describe('有宿主', () => {
  it('端口一就绪就返回地址，并且只调一次 startServer', async () => {
    let startCalls = 0;
    installBridge({
      startServer: () => {
        startCalls += 1;
        return '{"started":true}';
      },
      serverPort: () => port(8887),
      localIp: () => ip('192.168.1.5'),
      stopServer: () => '{"stopped":true}',
    });

    const bridge = await freshHostBridge();
    const info = await bridge.startHostServer({ timeoutMs: 500, intervalMs: 10 });

    expect(info).toEqual({ ip: '192.168.1.5', port: 8887 });
    expect(startCalls).toBe(1);
    expect(bridge.hostServerUrl()).toBe('ws://192.168.1.5:8887');
  });

  it('端口要等一会儿才绑好时，会轮询到就绪再返回（不抢跑）', async () => {
    let polls = 0;
    installBridge({
      startServer: () => '{"started":true}',
      // 前两次还没起来，第三次给 8887
      serverPort: () => {
        polls += 1;
        return port(polls >= 3 ? 8887 : 0);
      },
      localIp: () => ip('10.0.0.7'),
      stopServer: () => '{"stopped":true}',
    });

    const bridge = await freshHostBridge();
    const info = await bridge.startHostServer({ timeoutMs: 800, intervalMs: 10 });

    expect(info).toEqual({ ip: '10.0.0.7', port: 8887 });
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it('一直起不来就返回 null，并且把半启动的服务停掉', async () => {
    let stopCalls = 0;
    installBridge({
      startServer: () => '{"started":true}',
      serverPort: () => port(0),
      localIp: () => ip('192.168.1.5'),
      stopServer: () => {
        stopCalls += 1;
        return '{"stopped":true}';
      },
    });

    const bridge = await freshHostBridge();
    const info = await bridge.startHostServer({ timeoutMs: 80, intervalMs: 10 });

    expect(info).toBeNull();
    expect(stopCalls).toBe(1);
  });

  it('局域网 IP 拿不到时也算失败（不能给出 ws://null:8887）', async () => {
    let stopCalls = 0;
    installBridge({
      startServer: () => '{"started":true}',
      serverPort: () => port(8887),
      localIp: () => ip(null),
      stopServer: () => {
        stopCalls += 1;
        return '{"stopped":true}';
      },
    });

    const bridge = await freshHostBridge();
    expect(await bridge.startHostServer({ timeoutMs: 80, intervalMs: 10 })).toBeNull();
    expect(stopCalls).toBe(1);
  });

  it('没开过房时 stop 是空操作，开过房之后才真的停（加入方不误伤自己）', async () => {
    let stopCalls = 0;
    installBridge({
      startServer: () => '{"started":true}',
      serverPort: () => port(8887),
      localIp: () => ip('192.168.1.5'),
      stopServer: () => {
        stopCalls += 1;
        return '{"stopped":true}';
      },
    });

    const bridge = await freshHostBridge();
    bridge.stopHostServer();
    expect(stopCalls).toBe(0);

    await bridge.startHostServer({ timeoutMs: 500, intervalMs: 10 });
    bridge.stopHostServer();
    bridge.stopHostServer();
    expect(stopCalls).toBe(1);
  });

  it('端口/返回值形状不对时不会当成"起来了"', async () => {
    installBridge({
      startServer: () => 'not-json',
      serverPort: () => 'oops',
      localIp: () => 'oops',
      stopServer: () => '{"stopped":true}',
    });

    const bridge = await freshHostBridge();
    expect(bridge.hostServerPort()).toBe(0);
    expect(bridge.hostLocalIp()).toBeNull();
    expect(await bridge.startHostServer({ timeoutMs: 60, intervalMs: 10 })).toBeNull();
  });
});
