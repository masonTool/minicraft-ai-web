/**
 * 令牌桶限频（联机25）。
 *
 * 服务端原来每个消息类型都有自己的"1 秒窗口 + 计数"（掉落物、生物命中、拾取、
 * 特效用的是同一套手写代码，四份几乎一样的实现）。这份是给 `block` / `container` /
 * `chat` 用的通用版本——**单个函数的桶**，一行构造、一行 `take()`。
 *
 * 为什么用令牌桶而不是"每秒 20 次"的固定窗口：
 *  - 固定窗口在边界上会放过双倍流量（59.9 秒 20 条 + 60.1 秒 20 条 = 0.2 秒 40 条）；
 *  - 桶能表达"平时够用、短暂突发也允许"：红石连锁一次几十格不该被限，持续刷屏才该。
 *
 * 纯逻辑、无副作用（时间可以传进来），`tests/net-ratelimit.test.ts` 直接断言。
 */

/**
 * 建一个令牌桶。
 *
 * @param {number} perSecond 每秒补充多少令牌（= 长期平均速率）
 * @param {number} [capacity] 最多攒多少（= 允许的突发量），默认 2 秒的量
 */
export function createBucket(perSecond, capacity = Math.max(1, Math.ceil(perSecond * 2))) {
  return {
    tokens: capacity,
    capacity,
    perSecond,
    /** 上次补充的时刻（毫秒）；初次用"现在"，避免第一帧就把攒了几小时的令牌全吐出来 */
    last: -1,

    /**
     * 取 `count` 个令牌。
     *
     * @param {number} [now] 当前毫秒时间戳（测试里可以随意推进）
     * @param {number} [count] 这次要花几个（批量消息按条数计费）
     * @returns {boolean} 够就扣、返回 true；不够一个都不扣、返回 false
     */
    take(now = Date.now(), count = 1) {
      if (!Number.isFinite(now)) return false;
      const cost = Math.max(1, Math.trunc(Number(count)) || 1);
      if (this.last < 0) this.last = now;
      const elapsed = Math.max(0, now - this.last) / 1000;
      if (elapsed > 0) {
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.perSecond);
        this.last = now;
      }
      if (this.tokens < cost) return false;
      this.tokens -= cost;
      return true;
    },
  };
}

/** 每个连接的限频额度（联机25）：数值按"正常play绝对够用、刷屏顶不住"定 */
export const RATE_LIMITS = {
  /** 方块改动按**条数**计费：红石连锁一次几十格是正常的，持续每帧几百格不是 */
  block: { perSecond: 200, capacity: 400 },
  /** 容器内容：拖拽整理一次十几格，一秒几次 */
  container: { perSecond: 20 },
  /** 聊天：原版也是每人每秒几条 */
  chat: { perSecond: 5 },
  /**
   * 掉落物（用户 2026-10-26）：平时每秒 30 条够用，但**进房那一刻要能一次性吐完**。
   *
   * 房主进房间时，客户端会把世界里已有的掉落物重新广播一遍（`syncNetItems` 的 100ms
   * 扫描），一个住过的世界地上可能有上百堆。固定 1 秒窗口只能过 30 条，剩下的被丢掉
   * 且不会重试——队友那边就"少了一地的东西"。桶的 `capacity` 就是为这一波准备的。
   */
  item: { perSecond: 30, capacity: 400 },
};

/** 给一个新连接建全套桶 */
export function createBuckets() {
  return {
    block: createBucket(RATE_LIMITS.block.perSecond, RATE_LIMITS.block.capacity),
    container: createBucket(RATE_LIMITS.container.perSecond),
    chat: createBucket(RATE_LIMITS.chat.perSecond),
    item: createBucket(RATE_LIMITS.item.perSecond, RATE_LIMITS.item.capacity),
  };
}
