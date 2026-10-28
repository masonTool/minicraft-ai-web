/**
 * 附近房间（N6）
 *
 * `/healthz` 的 `peers` 是**外部数据**（同网段里可能是别的版本、甚至不是我们的服务端），
 * 而每一项都会拼进 `ws://host:port` 并直接进 DOM。所以这里断言的重点不是"正常能解析"，
 * 而是"脏的会被丢掉"与"自己那间不会出现在列表里"。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  filterSelfPeers,
  hostPortKey,
  parsePeersResponse,
  peerAddress,
  probeLatency,
} from '../web/src/core/net/NearbyRooms.ts';

describe('parsePeersResponse', () => {
  it('正常响应：名字 / 地址 / 端口 / 人数 / 房主 / 口令 / 种子', () => {
    const peers = parsePeersResponse({
      peers: [
        {
          name: '草原小屋',
          room: 'red',
          addr: '192.168.1.7',
          port: 25187,
          players: 2,
          hasHost: true,
          passwordRequired: false,
          seed: 424242,
        },
      ],
    });
    expect(peers).toEqual([
      {
        name: '草原小屋',
        host: '192.168.1.7',
        room: 'red',
        port: 25187,
        players: 2,
        hasHost: true,
        passwordRequired: false,
        worldSeed: 424242,
      },
    ]);
  });

  it('不是我们的响应就整份不认（返回 null，而不是空列表）', () => {
    expect(parsePeersResponse(null)).toBeNull();
    expect(parsePeersResponse({})).toBeNull();
    expect(parsePeersResponse({ peers: 'nope' })).toBeNull();
  });

  it('地址不合法 / 端口越界的行单独丢', () => {
    const peers = parsePeersResponse({
      peers: [
        { name: 'ok', addr: '10.0.0.2', port: 25187 },
        // 会把 `ws://` 拼成别的东西：一律不收
        { name: 'evil', addr: '10.0.0.3/../x', port: 25187 },
        { name: 'evil2', addr: 'javascript:alert(1)', port: 25187 },
        { name: 'evil3', addr: '[::1]', port: 25187 },
        { name: 'zero', addr: '10.0.0.4', port: 0 },
        { name: 'big', addr: '10.0.0.5', port: 70000 },
        { name: 'nan', addr: '10.0.0.6', port: 'abc' },
      ],
    });
    expect(peers?.map((peer) => peer.name)).toEqual(['ok']);
  });

  it('人多的排前面，人数相同按名字（列表顺序要稳定）', () => {
    const peers = parsePeersResponse({
      peers: [
        { name: 'b', addr: '10.0.0.2', port: 1, players: 1 },
        { name: 'a', addr: '10.0.0.3', port: 1, players: 1 },
        { name: 'crowded', addr: '10.0.0.4', port: 1, players: 5 },
      ],
    });
    expect(peers?.map((peer) => peer.name)).toEqual(['crowded', 'a', 'b']);
  });

  it('名字超长会截断（它直接进 DOM）', () => {
    const peers = parsePeersResponse({
      peers: [{ name: '长'.repeat(80), addr: '10.0.0.2', port: 1 }],
    });
    expect(peers?.[0]?.name).toHaveLength(32);
  });
});

describe('filterSelfPeers', () => {
  it('把自己那一间过滤掉（从别人的 /healthz 看，peers 里会有我们）', () => {
    const peers = parsePeersResponse({
      peers: [
        { name: '自己', addr: '192.168.1.7', port: 25187 },
        { name: '别人', addr: '192.168.1.8', port: 25187 },
      ],
    });
    const filtered = filterSelfPeers(peers ?? [], ['ws://192.168.1.7:25187']);
    expect(filtered.map((peer) => peer.name)).toEqual(['别人']);
  });

  it('房间名/口令不同但主机端口相同 → 仍是自己', () => {
    const peers = parsePeersResponse({
      peers: [{ name: '自己', addr: '192.168.1.7', port: 25187 }],
    });
    const filtered = filterSelfPeers(peers ?? [], ['ws://192.168.1.7:25187/red?pw=1']);
    expect(filtered).toHaveLength(0);
  });

  it('给不出自身地址时不过滤（宁可多显示一行，也不能整份列表消失）', () => {
    const peers = parsePeersResponse({ peers: [{ name: 'x', addr: '10.0.0.2', port: 1 }] });
    expect(filterSelfPeers(peers ?? [], [])).toHaveLength(1);
    expect(filterSelfPeers(peers ?? [], ['不是地址'])).toHaveLength(1);
  });
});

describe('peerAddress / hostPortKey', () => {
  it('拼出来的是能直接连的 ws 地址（带房间名）', () => {
    expect(
      peerAddress({ name: '', host: '10.0.0.2', room: 'red', port: 25187, players: 1, hasHost: false, passwordRequired: false, worldSeed: 0 }),
    ).toBe('ws://10.0.0.2:25187/red');
    // 没有房间名就不拼那一段（连上就是默认房间）
    expect(
      peerAddress({ name: '', host: '10.0.0.2', room: '', port: 25187, players: 1, hasHost: false, passwordRequired: false, worldSeed: 0 }),
    ).toBe('ws://10.0.0.2:25187');
  });

  it('host:port 归一化（大小写不影响判断）', () => {
    expect(hostPortKey('ws://MyHost:25187/room')).toBe('myhost:25187');
    expect(hostPortKey('不是地址')).toBeNull();
  });
});

describe('probeLatency', () => {
  const peer = {
    name: 'x',
    host: '10.0.0.2',
    room: 'red',
    port: 25187,
    players: 1,
    hasHost: true,
    passwordRequired: false,
    worldSeed: 0,
  };

  it('能探到时给出毫秒数', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const latency = await probeLatency(peer, fetcher as unknown as typeof fetch);
    expect(typeof latency).toBe('number');
    expect(latency).toBeGreaterThanOrEqual(0);
    expect(fetcher).toHaveBeenCalledWith('http://10.0.0.2:25187/healthz', expect.anything());
  });

  it('请求失败 / 非 200 都返回 null（界面显示"—"，不编数字）', async () => {
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    expect(await probeLatency(peer, failing as unknown as typeof fetch)).toBeNull();

    const notOk = vi.fn(async () => new Response('no', { status: 503 }));
    expect(await probeLatency(peer, notOk as unknown as typeof fetch)).toBeNull();
  });
});
