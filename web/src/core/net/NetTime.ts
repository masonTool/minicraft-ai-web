/**
 * 联机时的"时间向服务端靠"（联机10）。
 *
 * 单机里时间由本地 `timeOfDay += dt / dayLength` 推进；联机时**服务端才是权威**，
 * 否则两个人各跑各的：一个人白天一个人黑夜，怪物刷新、床能不能睡、月相全对不上。
 *
 * 但也不能每收到一条广播就把时间直接赋过去——服务端 2 秒一条，客户端 60 帧，
 * 直接赋值等于每 2 秒卡一下（太阳会"跳"）。这里的做法是：目标值不断更新，
 * 本地每帧按 `dt * 4` 的速率去追，差值小于半个像素级就对齐。
 *
 * 时间是 0..1 的环形量（0.98 与 0.02 只差 0.04 而不是 0.96），所以差值必须走
 * 最短弧——这也是这个模块唯一容易写错的地方，值得单独测。
 *
 * 纯函数、不碰渲染与网络，`tests/net-time.test.ts` 直接断言。
 */

/** 本地追赶服务端的倍率：4 倍速一天意味着 20 分钟的世界能在 5 分钟内拉平 */
export const NET_TIME_CATCH_UP = 4;

/** 差值小于这个值就直接对齐（约 26 秒的游戏时间），免得永远在追一个动目标 */
export const NET_TIME_SNAP_EPSILON = 0.0005;

/** 两个 0..1 时间之间的最短环形差，范围 -0.5..0.5（正数表示目标在前方） */
export function timeDelta(local: number, target: number): number {
  let delta = (target - local) % 1;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

/**
 * 推进一帧：把本地时间往目标值靠，单帧位移不超过 `dt * NET_TIME_CATCH_UP`。
 *
 * `local` / `target` 都允许是任意实数（调用方可能传进来 `1.2`），返回了一定归一化到 `[0, 1)`。
 */
export function stepTimeOfDayToward(local: number, target: number, dt: number): number {
  const delta = timeDelta(local, target);
  if (Math.abs(delta) <= NET_TIME_SNAP_EPSILON) return normalizeTime(target);

  const maxStep = Math.max(0, dt) * NET_TIME_CATCH_UP;
  const applied = Math.abs(delta) <= maxStep ? delta : Math.sign(delta) * maxStep;
  return normalizeTime(local + applied);
}

/** 归一化到 `[0, 1)`（负数也要正确，`%` 对负数会给负结果） */
export function normalizeTime(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

/**
 * 服务端时间：开局时刻 + 经过的毫秒 / 一天的毫秒数。
 *
 * 服务端不跑 tick，时间纯推算——它不需要每帧做什么，只要所有人问"现在几点"时
 * 得到的答案一致。
 */
export function timeOfDayAt(nowMs: number, startMs: number, dayLengthMs: number, startTime = 0.12): number {
  if (!(dayLengthMs > 0)) return normalizeTime(startTime);
  return normalizeTime((nowMs - startMs) / dayLengthMs + startTime);
}

/**
 * 服务端的天数（用户 2026-10-25：加入房间时"第几天"对不齐）。
 *
 * 以前时间只有 `timeOfDay`（0..1 的环形量）：谁先把这一天跑完，谁的天数就 +1，
 * 而天数**各端各算**——晚加入的人从第 0 天开始，月相、`hud.moonDay`、村民补货全错开。
 * 现在天数也由服务端推算，与时间同一套参数（起点时刻 / 一天多少毫秒 / 起点是几点 / 起点第几天）：
 *
 *   `day = startDay + floor(经过的天数 + 起点时间)`
 *
 * 取整时机就是"跨过午夜"——与客户端 `advanceDay()` 的判据（`timeOfDay` 取模后变小）**同一条线**，
 * 否则两边会差一天（而这种差一天只会在玩到半夜才暴露）。
 *
 * `startDay` 为负/非整数时按 0 处理：天数只是标签，脏数据不该把 HUD 变成 `第 -1 天`。
 */
export function dayAt(
  nowMs: number,
  startMs: number,
  dayLengthMs: number,
  startTime = 0.12,
  startDay = 0,
): number {
  const base = Number.isFinite(startDay) ? Math.max(0, Math.trunc(startDay)) : 0;
  if (!(dayLengthMs > 0)) return base;
  const elapsed = (nowMs - startMs) / dayLengthMs;
  if (!Number.isFinite(elapsed)) return base;
  return base + Math.max(0, Math.floor(elapsed + normalizeTime(startTime)));
}
