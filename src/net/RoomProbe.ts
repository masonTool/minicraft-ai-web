/**
 * 「探房」（L9）：进世界**之前**先问服务器"这一局是哪个世界"。
 *
 * 为什么需要它：加入别人的房时，地形由**房主的那个世界**决定，而本地还不知道那是哪片
 * 大陆（种子在 `welcome` 里）。想做到"从主菜单点一下就进房"，就必须先连一次、拿到
 * `welcome.world`，再据此加载世界——否则又会回到"先随便进一个世界，发现种子不对，
 * 断开重来"那条老路。
 *
 * 三个刻意的做法：
 *  1. **用一次性的 clientId**（`probe…`），不复用本机那份：探完立刻断开，若与随后真正
 *     连上来的连接用同一个 id，服务端会判 `duplicate` 并**直接拒连**（旧 socket 的关闭
 *     还没走完）。探针的身份本来就该是"用完就扔"。
 *  2. **以从属身份 join**：探针不占房主位——开房的路径不需要探（那个世界就在本地，
 *     种子是自己上报的）。
 *  3. **任何失败都返回 `null`**：调用方据此留在主菜单并给一句人话，绝不抛异常穿到 UI。
 */

import { browserClientId } from '../core/net/ClientId.ts';
import { NET_PROTOCOL_VERSION } from '../core/net/Protocol.ts';
import { formatServerUrl } from '../core/net/ServerUrl.ts';
import type { NetWorldMeta } from './NetClient.ts';

export interface RoomProbeOptions {
  /** 裸服务器地址（`ws://host:25187`，不带房间） */
  baseUrl: string;
  room: string;
  password: string;
  name: string;
  /** 超时（毫秒）；局域网里 3~4 秒足够，超了就当连不上 */
  timeoutMs?: number;
}

/**
 * 可注入的依赖（只为可测）：默认用全局 `WebSocket` 与全局定时器。
 * 单测里塞一个假 socket 就能覆盖"连上→拿 welcome→断开"与"被拒/超时"三条路径，
 * 不必真的起服务器。
 */
export interface RoomProbeDeps {
  createSocket?: (url: string) => WebSocket;
}

export interface RoomProbeResult {
  /** 房间的世界（老服务端可能没有，返回 `null` 字段 → 调用方退回老流程） */
  world: NetWorldMeta | null;
  isHost: boolean;
  hostId: number | null;
}

/** 一次性身份：`probe` + 随机串（8~64 位字母数字，满足服务端的 clientId 校验） */
function probeClientId(): string {
  // `browserClientId()` 这里只用来"确保本机 id 已生成"，探针本身用另一个身份
  void browserClientId();
  return `probe${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 连一次、拿到 `welcome`、断开。
 *
 * @returns `null` = 连不上 / 被拒（版本、口令、房主位…）/ 超时——调用方只当"没探到"。
 */
export function probeRoom(
  options: RoomProbeOptions,
  deps: RoomProbeDeps = {},
): Promise<RoomProbeResult | null> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const createSocket = deps.createSocket ?? ((target: string) => new WebSocket(target));
  const url = formatServerUrl(options.baseUrl, options.room, options.password);

  return new Promise((resolve) => {
    let settled = false;
    let socket: WebSocket | null = null;

    const finish = (result: RoomProbeResult | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // 已经关了：探针不在乎
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      socket = createSocket(url);
    } catch {
      finish(null);
      return;
    }

    socket.onopen = () => {
      socket?.send(
        JSON.stringify({
          t: 'join',
          v: NET_PROTOCOL_VERSION,
          clientId: probeClientId(),
          name: options.name,
          x: 0,
          y: 80,
          z: 0,
          dimension: 'overworld',
          ...(options.room ? { room: options.room } : {}),
          ...(options.password ? { password: options.password } : {}),
        }),
      );
    };

    socket.onmessage = (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.t === 'error') {
        finish(null);
        return;
      }
      if (message.t !== 'welcome') return;
      // 版本不一致时服务端其实会先拒（error），这里再挡一层：字段不兼容就不要拿它的世界
      const raw = message.world as Partial<NetWorldMeta> | undefined;
      /*
       * 种子只认**数字类型**的整数（`Number(null)` 是 0、`Number('')` 是 0：
       * 用 `??` 兜底再 `Number()` 会把"没给种子"读成"种子 0"，于是去生成一片
       * 种子 0 的大陆——不报错、只是和房主完全不一样）。
       */
      const seed = typeof raw?.seed === 'number' ? raw.seed : message.seed;
      const hostId = Number(message.hostId);
      finish({
        world: typeof seed === 'number' && Number.isInteger(seed)
          ? {
              name: typeof raw?.name === 'string' ? raw.name : '',
              seed,
              mode: typeof raw?.mode === 'string' ? raw.mode : '',
              difficulty: typeof raw?.difficulty === 'string' ? raw.difficulty : '',
              worldType: typeof raw?.worldType === 'string' ? raw.worldType : '',
            }
          : null,
        isHost: message.isHost === true,
        hostId: Number.isInteger(hostId) && hostId > 0 ? hostId : null,
      });
    };

    socket.onerror = () => finish(null);
    socket.onclose = () => finish(null);
  });
}
