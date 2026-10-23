/**
 * 令牌桶限频（联机25）
 *
 * 为什么不用"每秒 N 次"的固定窗口：它在窗口边界会放过双倍流量（59.9 秒 20 条 +
 * 60.1 秒 20 条 = 0.2 秒 40 条）。桶能表达"平时够用、短暂突发也允许"。
 */

import { describe, expect, it } from 'vitest';
import { RATE_LIMITS, createBucket, createBuckets } from '../server/ratelimit.mjs';

describe('createBucket', () => {
  it('满桶时能连续取 capacity 次，再取就失败', () => {
    const bucket = createBucket(10, 5);
    for (let i = 0; i < 5; i++) expect(bucket.take(0)).toBe(true);
    expect(bucket.take(0)).toBe(false);
  });

  it('过一秒补回 perSecond 个（不是一次补满）', () => {
    const bucket = createBucket(10, 5);
    for (let i = 0; i < 5; i++) bucket.take(0);
    expect(bucket.take(1000)).toBe(true);
    // 补了 10 个但容量只有 5：最多攒到 5
    expect(bucket.tokens).toBeLessThanOrEqual(5);
  });

  it('很久不用的桶不会攒超过容量（否则等于无限突发）', () => {
    const bucket = createBucket(10, 5);
    bucket.take(0);
    bucket.take(60_000); // 一分钟后再来
    expect(bucket.tokens).toBeLessThanOrEqual(5);
  });

  it('按条数计费：不够就一个都不扣', () => {
    const bucket = createBucket(10, 100);
    expect(bucket.take(0, 60)).toBe(true);
    const before = bucket.tokens;
    expect(bucket.take(0, 60)).toBe(false);
    expect(bucket.tokens).toBe(before); // 失败的请求不该扣掉一部分
  });

  it('时间倒退不补令牌（时钟回拨保护）', () => {
    const bucket = createBucket(10, 5);
    for (let i = 0; i < 5; i++) bucket.take(1000);
    expect(bucket.take(0)).toBe(false);
  });

  it('单次成本至少为 1（传 0 或负数也按 1 算）', () => {
    const bucket = createBucket(1, 1);
    expect(bucket.take(0, 0)).toBe(true);
    expect(bucket.take(0, -5)).toBe(false);
  });
});

describe('createBuckets', () => {
  it('三类桶各自独立（聊天刷屏不该把方块限掉）', () => {
    const buckets = createBuckets();
    for (let i = 0; i < RATE_LIMITS.chat.perSecond * 3; i++) buckets.chat.take(0);
    expect(buckets.chat.take(0)).toBe(false);
    expect(buckets.block.take(0)).toBe(true);
    expect(buckets.container.take(0)).toBe(true);
  });

  it('方块桶的容量够一次红石连锁（几百格）', () => {
    const buckets = createBuckets();
    // 一次 256 格的批量（合帧上限）必须放行，否则正常的红石/爆炸会被掐
    expect(buckets.block.take(0, 256)).toBe(true);
  });
});
