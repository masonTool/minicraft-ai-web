/**
 * 服务端的天气权威（联机35）。
 *
 * 客户端那边有一套完整的天气状态机（`core/world/WeatherState.ts`：晴天 8~16 分钟、
 * 之后 45% 继续晴 / 55% 转雨、其中 30% 是雷暴）。联机时**必须只有一个人掷骰子**——
 * 否则两个人各自每十分钟换一次天气，永远对不上（一个人下雨、一个人晴天）。
 *
 * 这里把规则**照抄一份**到服务端。为什么不共享：服务端是纯 .mjs（不进打包），客户端是 TS
 * （要过 i18n/类型检查），两边没有共同的运行时。代价是"改规则要改两处"——
 * `tests/net-weather.test.ts` 用同一串随机数比对两边的结果，改漏一处会变红。
 *
 * 纯函数、无副作用，测试可直接调。
 */

/** 晴天持续多久（秒）：与客户端 `CLEAR_SECONDS_MIN/MAX` 一致 */
export const CLEAR_SECONDS_MIN = 480;
export const CLEAR_SECONDS_MAX = 960;
/** 雨天/雷暴持续多久（秒）：与客户端 `STORM_SECONDS_MIN/MAX` 一致 */
export const STORM_SECONDS_MIN = 120;
export const STORM_SECONDS_MAX = 300;
/** 晴天结束后转雨的概率（与客户端一致） */
export const RAIN_CHANCE = 0.55;
/** 转雨时是雷暴的比例（与客户端一致） */
export const THUNDER_CHANCE = 0.3;

export const WEATHER_KINDS = ['clear', 'rain', 'thunder'];

export function isWeatherKind(value) {
  return typeof value === 'string' && WEATHER_KINDS.includes(value);
}

/** 这一种天气该持续多久（秒） */
export function weatherSecondsFor(random, kind) {
  const [min, max] = kind === 'clear' ? [CLEAR_SECONDS_MIN, CLEAR_SECONDS_MAX] : [STORM_SECONDS_MIN, STORM_SECONDS_MAX];
  return min + random() * (max - min);
}

/** 当前天气结束之后换成什么（三条规则与客户端一致） */
export function nextWeatherKind(random, current) {
  if (current !== 'clear') return 'clear';
  if (random() >= RAIN_CHANCE) return 'clear';
  return random() < THUNDER_CHANCE ? 'thunder' : 'rain';
}

/** 当前天气结束后进入的下一个状态 */
export function nextWeather(random, current) {
  const kind = nextWeatherKind(random, current);
  return { kind, seconds: weatherSecondsFor(random, kind) };
}

/** 推进 dt 秒；到点就换（返回新状态，不改入参） */
export function tickWeather(state, dt, random) {
  const left = state.seconds - dt;
  if (left > 0) return { kind: state.kind, seconds: left };
  return nextWeather(random, state.kind);
}
