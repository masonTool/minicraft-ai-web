/**
 * 联机的运行统计（联机29）：延迟、丢包、上下行速率。
 *
 * 为什么自己做而不是读浏览器 API：`WebSocket` 没有"已发送字节数"这种读数，RTT 也没有
 * 任何暴露——只能自己数：发的时候累加 `JSON.stringify(...)` 的长度，收的时候累加
 * `event.data` 的长度；延迟靠应用层 `ping`/`pong`（WebSocket 协议层的 ping 帧浏览器
 * 不让我们发）。
 *
 * 窗口用**每秒一个桶**而不是"只记总数"：调试面板要的是"现在的速率"，累计值除以总时长
 * 会在断线重连后一直是历史平均值，看不出"这条线路现在很卡"。
 *
 * 纯逻辑（时间可以传进来），`tests/net-stats.test.ts` 直接断言。
 */

/** 速率统计的窗口长度（毫秒）：5 秒足够平滑，又不会把"刚才那一秒爆了"糊掉 */
export const STATS_WINDOW_MS = 5000;

/** ping 多久没回就算丢包（毫秒） */
export const PING_TIMEOUT_MS = 3000;

/** 保留多少个 RTT 样本做平均 */
const RTT_SAMPLES = 8;

export class NetStats {
  /** 每秒一个桶：`floor(now / 1000)` → 字节数 */
  private readonly buckets = new Map<number, { sent: number; received: number }>();
  /** 已发出、还没回应的 ping 时刻 */
  private pendingPings: number[] = [];
  /** 最近的 RTT 样本（毫秒） */
  private readonly rtts: number[] = [];
  /** 累计丢包数（超时未回的 ping） */
  private lostPings = 0;
  /** 累计发出的 ping 数（含已丢的） */
  private sentPings = 0;
  /** 累计收发的字节（从连接建立起） */
  sentBytesTotal = 0;
  receivedBytesTotal = 0;

  /** 记一发（`bytes` 是这条消息的长度） */
  recordSent(bytes: number, now: number = performance.now()): void {
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    this.sentBytesTotal += bytes;
    this.bucketAt(now).sent += bytes;
  }

  /** 记一收 */
  recordReceived(bytes: number, now: number = performance.now()): void {
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    this.receivedBytesTotal += bytes;
    this.bucketAt(now).received += bytes;
  }

  /** 发了一个 ping（`id` 不用传：按发送顺序配对） */
  sentPing(now: number = performance.now()): void {
    this.sentPings++;
    this.pendingPings.push(now);
    this.expirePings(now);
  }

  /**
   * 收到 pong：与**最早的未回 ping** 配对算 RTT。
   *
   * 配最早的那一个而不是最近发的：网络上可能同时有几条在飞，配错了 RTT 会虚低。
   */
  ackPing(now: number = performance.now()): void {
    this.expirePings(now);
    const sentAt = this.pendingPings.shift();
    if (sentAt === undefined) return;
    this.rtts.push(now - sentAt);
    if (this.rtts.length > RTT_SAMPLES) this.rtts.shift();
  }

  /** 清过期桶与超时的 ping（主循环每帧调一次即可） */
  tick(now: number = performance.now()): void {
    this.expirePings(now);
    const oldest = Math.floor((now - STATS_WINDOW_MS) / 1000);
    for (const key of this.buckets.keys()) {
      if (key < oldest) this.buckets.delete(key);
    }
  }

  /** 平均 RTT（毫秒）；还没收到过 pong 时返回 null（界面显示"—"） */
  get pingMs(): number | null {
    if (this.rtts.length === 0) return null;
    return this.rtts.reduce((sum, value) => sum + value, 0) / this.rtts.length;
  }

  /** 丢包率（0~1）：没有任何 ping 时是 0 */
  get lossRatio(): number {
    if (this.sentPings === 0) return 0;
    return Math.min(1, this.lostPings / this.sentPings);
  }

  /** 窗口内的上行速率（字节/秒） */
  get sentPerSecond(): number {
    return this.perSecond('sent');
  }

  /** 窗口内的下行速率（字节/秒） */
  get receivedPerSecond(): number {
    return this.perSecond('received');
  }

  /** 断开重连时清空（累计值也清：那是"这一条连接"的统计） */
  reset(): void {
    this.buckets.clear();
    this.pendingPings = [];
    this.rtts.length = 0;
    this.lostPings = 0;
    this.sentPings = 0;
    this.sentBytesTotal = 0;
    this.receivedBytesTotal = 0;
  }

  private bucketAt(now: number): { sent: number; received: number } {
    const key = Math.floor(now / 1000);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { sent: 0, received: 0 };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private perSecond(kind: 'sent' | 'received'): number {
    let total = 0;
    for (const bucket of this.buckets.values()) total += bucket[kind];
    // 窗口长度是固定的 5 秒：用"实际有数据的秒数"会低估（空闲时速率不该"看起来更高"）
    return total / (STATS_WINDOW_MS / 1000);
  }

  private expirePings(now: number): void {
    while (this.pendingPings.length > 0 && now - this.pendingPings[0]! > PING_TIMEOUT_MS) {
      this.pendingPings.shift();
      this.lostPings++;
    }
  }
}

/** 人读的字节速率（F3 面板与服务端日志用同一套写法） */
export function formatBytesPerSecond(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B/s';
  if (bytes < 1024) return `${Math.round(bytes)}B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB/s`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB/s`;
}
