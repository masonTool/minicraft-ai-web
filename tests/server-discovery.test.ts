/**
 * 服务器发现（用户 2026-10-26）：网段枚举 + 并发探测 + 排序。
 *
 * 全部用注入的假依赖跑（`reach` / `now`），不真的打网络——真的扫 254 个地址会变成
 * "测试依赖家里路由器"，而且慢。
 */
import { describe, expect, it } from 'vitest';
import { fetchPublicServers } from '../web/src/ui/ServerPicker.ts';
import {
  DEFAULT_SCAN_PORT,
  canScanLan,
  pingEndpoint,
  probeHost,
  scanSubnet,
  subnetHosts,
  subnetOf,
} from '../web/src/core/net/ServerDiscovery.ts';

describe('subnetOf / subnetHosts', () => {
  it('常见的三个私网段都认', () => {
    expect(subnetOf('192.168.1.5')).toBe('192.168.1');
    expect(subnetOf('10.0.0.7')).toBe('10.0.0');
    expect(subnetOf('172.20.3.9')).toBe('172.20.3');
  });

  it('公网地址 / 域名 / localhost 不给扫（扫了也是给别人添麻烦）', () => {
    expect(subnetOf('8.8.8.8')).toBeNull();
    expect(subnetOf('172.32.0.1')).toBeNull();
    expect(subnetOf('mc.example.com')).toBeNull();
    expect(subnetOf('localhost')).toBeNull();
  });

  it('网段 → 254 个候选，按序且不重复', () => {
    const hosts = subnetHosts('192.168.1');
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe('192.168.1.1');
    expect(hosts[253]).toBe('192.168.1.254');
    expect(new Set(hosts).size).toBe(254);
  });

  it('非法网段 → 空列表（界面据此提示"填 IP 才能扫"）', () => {
    expect(subnetHosts('mc.example.com')).toEqual([]);
    expect(subnetHosts('8.8.8')).toEqual([]);
  });
});

describe('pingEndpoint', () => {
  it('默认端口 8887，走 /ping', () => {
    expect(pingEndpoint('192.168.1.5')).toBe(`http://192.168.1.5:${DEFAULT_SCAN_PORT}/ping`);
    expect(pingEndpoint('10.0.0.2', 9000)).toBe('http://10.0.0.2:9000/ping');
  });
});

/** 假依赖：只有列在 `alive` 里的地址能连上，RTT 由 `rtt` 给（缺省 10ms） */
const fakeDeps = (alive: Record<string, number>, cost = 10) => {
  let clock = 0;
  return {
    reach: async (url: string) => {
      const host = url.replace(/^http:\/\//, '').split(':')[0]!;
      clock += alive[host] ?? cost; // 每次探测都推时钟（模拟真实等待）
      return host in alive;
    },
    now: () => clock,
  };
};

describe('probeHost', () => {
  it('连得上 → 返回 RTT', async () => {
    expect(await probeHost('192.168.1.5', fakeDeps({ '192.168.1.5': 7 }))).toBe(7);
  });

  it('连不上 → null', async () => {
    expect(await probeHost('192.168.1.9', fakeDeps({ '192.168.1.5': 7 }))).toBeNull();
  });
});

describe('scanSubnet', () => {
  it('只回找到的、按 RTT 升序', async () => {
    const deps = fakeDeps({ '10.0.0.3': 30, '10.0.0.7': 5 });
    const found = await scanSubnet('10.0.0', deps, { concurrency: 8 });
    expect(found.map((s) => s.host)).toEqual(['10.0.0.7', '10.0.0.3']);
    expect(found.every((s) => s.port === DEFAULT_SCAN_PORT)).toBe(true);
  });

  it('边扫边回调（界面能发现一个显示一个）', async () => {
    const seen: string[] = [];
    await scanSubnet('10.0.0', fakeDeps({ '10.0.0.2': 3 }), {
      concurrency: 4,
      onFound: (server) => seen.push(server.host),
    });
    expect(seen).toEqual(['10.0.0.2']);
  });

  it('取消后不再继续扫（关面板不该还打 200 个地址）', async () => {
    let calls = 0;
    const deps = {
      reach: async () => {
        calls += 1;
        return false;
      },
      now: () => 0,
    };
    let cancelled = false;
    const scanned = await scanSubnet('10.0.0', deps, {
      concurrency: 2,
      cancelled: () => {
        // 前 4 个之后就让调用方"关掉面板"
        if (calls >= 4) cancelled = true;
        return cancelled;
      },
    });
    expect(scanned).toEqual([]);
    expect(calls).toBeLessThan(254);
  });

  it('非私网段 → 一个都不打', async () => {
    let calls = 0;
    await scanSubnet('8.8.8', { reach: async () => (calls += 1) > 0, now: () => 0 });
    expect(calls).toBe(0);
  });
});

describe('canScanLan', () => {
  it('https 页面扫不了（混合内容会拦掉 http://局域网IP）', () => {
    expect(canScanLan('https:')).toBe(false);
    expect(canScanLan('http:')).toBe(true);
  });
});


/*
 * 公开服务器列表（用户 2026-10-26）：接口形状先钉住，以后服务端照着这个出数据。
 *
 * 期待 `{ servers: [{ name, address, region? }] }`；坏数据逐条跳过而不是整包失败——
 * 一个运营手抖的条目不该让整个列表消失。
 */
describe('fetchPublicServers', () => {
  const withFetch = async (impl: () => Promise<unknown>, run: () => Promise<void>) => {
    const original = globalThis.fetch;
    globalThis.fetch = impl as unknown as typeof fetch;
    try {
      await run();
    } finally {
      globalThis.fetch = original;
    }
  };

  it('正常返回 → 解析出 name/address/region', async () => {
    await withFetch(
      async () => ({
        ok: true,
        json: async () => ({
          servers: [
            { name: '东京一号', address: 'jp.example.com', region: 'JP' },
            { address: '192.168.1.9' },
          ],
        }),
      }),
      async () => {
        const list = await fetchPublicServers('https://example.com/servers.json');
        expect(list).toHaveLength(2);
        expect(list[0]).toEqual({ name: '东京一号', address: 'jp.example.com', region: 'JP' });
        // 没给名字就用地址顶（列表里不至于空一行）
        expect(list[1]!.name).toBe('192.168.1.9');
        expect(list[1]!.region).toBeUndefined();
      },
    );
  });

  it('缺 address 的条目跳过，其余照收', async () => {
    await withFetch(
      async () => ({ ok: true, json: async () => ({ servers: [{ name: '坏的' }, { address: 'ok.example.com' }] }) }),
      async () => {
        const list = await fetchPublicServers('x');
        expect(list.map((s) => s.address)).toEqual(['ok.example.com']);
      },
    );
  });

  it('非 200 / 抛异常 / 形状不对 → 空列表（不抛）', async () => {
    await withFetch(async () => ({ ok: false, json: async () => ({}) }), async () => {
      expect(await fetchPublicServers('x')).toEqual([]);
    });
    await withFetch(async () => {
      throw new Error('offline');
    }, async () => {
      expect(await fetchPublicServers('x')).toEqual([]);
    });
    await withFetch(async () => ({ ok: true, json: async () => ({ servers: 'nope' }) }), async () => {
      expect(await fetchPublicServers('x')).toEqual([]);
    });
  });
});
