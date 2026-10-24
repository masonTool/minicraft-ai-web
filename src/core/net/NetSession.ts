/**
 * 联机会话状态机（联机7）。
 *
 * 原来这些判断散在 `NetClient` 的三个回调里（`onopen` / `onclose` / `onerror`），
 * 每个分支都写 `if (this.disposed) return; if (this.fatal) return;`——"要不要重连"
 * 这件事没有单一出口，加一种状态（比如心跳超时）就得再抄一遍那几个 if，漏一处就是
 * "明明致命错误还在无限重连"。
 *
 * 这里把状态与迁移收在一处，`NetClient` 只负责按返回值去开/关 socket。纯逻辑、不碰
 * WebSocket 与计时器，可以离线断言。
 *
 * 状态：
 * ```text
 * idle ──connect──▶ connecting ──opened──▶ connected
 *                        │                    │
 *                        └──closed(可重连)──┐  │
 *  offline ◀──disconnect──┘                 ▼  ▼
 *    ▲                                  reconnecting ──opened──▶ connected
 *    └──────────── closed(致命/主动) ─────┘
 * ```
 */

export type NetSessionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

/** 连接关闭后该做什么 */
export type CloseAction = 'reconnect' | 'stop';

/** 关闭原因（谁导致的、还可不可以重连） */
export interface CloseReason {
  /** 本端主动断开（`disconnect()`）：不再重连 */
  intentional?: boolean;
  /** 致命协议错误（版本/身份/重复连接）：重连多少次结果都一样 */
  fatal?: boolean;
  /**
   * 房间已经没了（L8 · MS4：房主退出、服务端关房）。
   *
   * 与 `fatal` 分开表达：它不是"协议谈了"，重连也不会变好——但重连**会**在建起
   * 连接后立刻被同一个理由踢回来，所以要停。分开记是为了让日志/提示能说人话。
   */
  roomClosed?: boolean;
}

export class NetSession {
  private current: NetSessionState = 'idle';
  /** 连续失败次数（重连成功后清零）；只为观测与退避留位置 */
  private failures = 0;

  get state(): NetSessionState {
    return this.current;
  }

  /** 连了多少次都没成功（`connected` 里恒为 0） */
  get retryCount(): number {
    return this.failures;
  }

  /** 开始连接：从 idle / offline / reconnecting 都进 `connecting` */
  connect(): NetSessionState {
    if (this.current !== 'connected') this.current = 'connecting';
    return this.current;
  }

  /** socket 真的开了（`welcome` 之前也算连上：状态只描述"有没有连接"） */
  opened(): NetSessionState {
    this.current = 'connected';
    this.failures = 0;
    return this.current;
  }

  /**
   * socket 关了。
   *
   * 返回 `reconnect` 时调用方应当排一次重连；`stop` 表示到此为止（状态停在 `offline`）。
   * **`connected` 掉线也走这里**——那时既不是主动断开也不是致命错误，当然要重连。
   */
  closed(reason: CloseReason = {}): CloseAction {
    if (reason.intentional || reason.fatal || reason.roomClosed) {
      this.current = 'offline';
      return 'stop';
    }
    this.failures++;
    this.current = 'reconnecting';
    return 'reconnect';
  }

  /** 主动断开：状态落到 `offline`，之后不会再被 `closed()` 改回 `reconnecting` */
  disconnect(): NetSessionState {
    this.current = 'offline';
    return this.current;
  }

  /** 重连计时器被清掉后调用：状态回到 `offline`（不算一次失败） */
  aborted(): NetSessionState {
    if (this.current === 'reconnecting') this.current = 'offline';
    return this.current;
  }
}
