//! 令牌桶限频（联机25）。
//!
//! 为什么用令牌桶而不是"每秒 N 次"的固定窗口：
//!  - 固定窗口在边界上会放过双倍流量（59.9 秒 20 条 + 60.1 秒 20 条 = 0.2 秒 40 条）；
//!  - 桶能表达"平时够用、短暂突发也允许"：红石连锁一次几十格不该被限，持续刷屏才该。
//!
//! 与 `server/ratelimit.mjs` 同一套数值：block 200/s（容量 400）、container 20/s、chat 5/s。

/// 一个令牌桶。`last < 0` 表示"还没被用过"，第一次取令牌时不补历史。
#[derive(Debug)]
pub struct Bucket {
    tokens: f64,
    capacity: f64,
    per_second: f64,
    last: i64,
}

impl Bucket {
    pub fn new(per_second: f64, capacity: f64) -> Self {
        Self { tokens: capacity, capacity, per_second, last: -1 }
    }

    /// 取 `count` 个令牌：够就扣并返回 true；不够一个都不扣。
    pub fn take(&mut self, now_ms: i64, count: usize) -> bool {
        let cost = count.max(1) as f64;
        if self.last < 0 {
            self.last = now_ms;
        }
        let elapsed = (now_ms - self.last).max(0) as f64 / 1000.0;
        if elapsed > 0.0 {
            self.tokens = (self.tokens + elapsed * self.per_second).min(self.capacity);
            self.last = now_ms;
        }
        if self.tokens < cost {
            return false;
        }
        self.tokens -= cost;
        true
    }
}

/// 每个连接的限频额度。
pub struct Buckets {
    pub block: Bucket,
    pub container: Bucket,
    pub chat: Bucket,
}

impl Buckets {
    pub fn new() -> Self {
        Self {
            block: Bucket::new(200.0, 400.0),
            container: Bucket::new(20.0, 40.0),
            chat: Bucket::new(5.0, 10.0),
        }
    }
}

impl Default for Buckets {
    fn default() -> Self {
        Self::new()
    }
}

/// "1 秒窗口 + 计数"（掉落物 / 生物命中 / 拾取 / 特效）。
#[derive(Debug, Default)]
pub struct Window {
    reset_at: i64,
    count: u32,
}

impl Window {
    /// 记一次；超过 `limit` 返回 false（被限）。
    pub fn allow(&mut self, now_ms: i64, limit: u32) -> bool {
        if now_ms >= self.reset_at {
            self.reset_at = now_ms + 1000;
            self.count = 0;
        }
        self.count += 1;
        self.count <= limit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bucket_allows_burst_then_limits() {
        let mut bucket = Bucket::new(200.0, 400.0);
        // 第一批 256 格放行
        assert!(bucket.take(1_000, 256));
        // 紧接着第二批 256 格：桶里只剩 144，不够
        assert!(!bucket.take(1_000, 256));
        // 过 1 秒补 200 → 344，够 256
        assert!(bucket.take(2_000, 256));
    }

    #[test]
    fn bucket_refills_over_time() {
        let mut bucket = Bucket::new(5.0, 10.0);
        for _ in 0..10 {
            assert!(bucket.take(1_000, 1));
        }
        assert!(!bucket.take(1_000, 1));
        // 200ms 补 1 个
        assert!(bucket.take(1_200, 1));
    }

    #[test]
    fn window_resets_each_second() {
        let mut window = Window::default();
        for _ in 0..3 {
            assert!(window.allow(1_000, 3));
        }
        assert!(!window.allow(1_000, 3));
        assert!(window.allow(2_000, 3));
    }
}
