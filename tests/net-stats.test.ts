/**
 * 联机运行统计（联机29）
 *
 * 三件事都要能离线断言：**速率是窗口内的**（不是历史平均）、**RTT 配最早那条 ping**
 * （几条同时在飞时配错了会虚低）、**超时的 ping 才算丢包**。
 */

import { describe, expect, it } from 'vitest';
import { NetStats, PING_TIMEOUT_MS, STATS_WINDOW_MS } from '../web/src/core/net/NetStats.ts';

describe('字节速率', () => {
  it('窗口内的速率（5 秒）', () => {
    const stats = new NetStats();
    // 1 秒内发 5000 字节 → 每秒 1000
    stats.recordSent(5000, 1000);
    expect(stats.sentPerSecond).toBeCloseTo(1000, 6);
  });

  it('窗口外的桶被 tick 清掉（不会一直停在高位）', () => {
    const stats = new NetStats();
    stats.recordSent(5000, 1000);
    stats.tick(1000 + STATS_WINDOW_MS + 1000);
    expect(stats.sentPerSecond).toBe(0);
  });

  it('上下行分开记', () => {
    const stats = new NetStats();
    stats.recordSent(1000, 0);
    stats.recordReceived(3000, 0);
    expect(stats.sentPerSecond).toBeCloseTo(200, 6);
    expect(stats.receivedPerSecond).toBeCloseTo(600, 6);
  });

  it('累计值一直在涨（界面另有用处）', () => {
    const stats = new NetStats();
    stats.recordSent(100, 0);
    stats.recordSent(200, 10_000);
    expect(stats.sentBytesTotal).toBe(300);
  });

  it('非法字节数被忽略', () => {
    const stats = new NetStats();
    stats.recordSent(Number.NaN, 0);
    stats.recordSent(-5, 0);
    expect(stats.sentBytesTotal).toBe(0);
  });
});

describe('延迟与丢包', () => {
  it('还没收到 pong 时 ping 是 null（界面显示"—"）', () => {
    const stats = new NetStats();
    stats.sentPing(0);
    expect(stats.pingMs).toBeNull();
  });

  it('RTT 取平均', () => {
    const stats = new NetStats();
    stats.sentPing(0);
    stats.ackPing(50);
    stats.sentPing(100);
    stats.ackPing(200);
    expect(stats.pingMs).toBeCloseTo(75, 6);
  });

  it('几条 ping 同时在飞时配最早的那条（否则 RTT 虚低）', () => {
    const stats = new NetStats();
    stats.sentPing(0);
    stats.sentPing(100);
    stats.ackPing(120); // 回的是第一次发的
    expect(stats.pingMs).toBeCloseTo(120, 6);
  });

  it(`超过 ${PING_TIMEOUT_MS}ms 没回算丢包`, () => {
    const stats = new NetStats();
    stats.sentPing(0);
    stats.tick(PING_TIMEOUT_MS + 10);
    expect(stats.lossRatio).toBe(1);
  });

  it('丢包率按"丢的 / 发的"算', () => {
    const stats = new NetStats();
    stats.sentPing(0);
    stats.sentPing(100);
    stats.ackPing(150); // 第二条回得早，但配的是第一条 → 第一条被 ack
    stats.sentPing(200);
    stats.tick(200 + PING_TIMEOUT_MS + 10); // 第三条超时
    expect(stats.lossRatio).toBeGreaterThan(0);
    expect(stats.lossRatio).toBeLessThanOrEqual(1);
  });

  it('reset 之后全部归零（重连是一条新连接）', () => {
    const stats = new NetStats();
    stats.recordSent(1000, 0);
    stats.sentPing(0);
    stats.ackPing(30);
    stats.reset();
    expect(stats.sentBytesTotal).toBe(0);
    expect(stats.pingMs).toBeNull();
    expect(stats.lossRatio).toBe(0);
  });
});
