/**
 * 天气的状态与转换规则（L6，批次 85）
 *
 * 在此之前天气**只活在 `render/Weather.ts` 那个类里**：重开游戏就重掷一次
 * （`kind = 'clear'`、`timer = 600` 是构造函数的初始值），玩家永远遇不上"上次那场雨还没停"。
 * 这一批把它做成**一小份可以进存档的数据**：`{ 天气种类, 剩余秒数 }`。
 *
 * 为什么规则要单独放一个纯模块（而不是留在渲染类里）：
 *  - 渲染类要 `THREE` 与 `document`，离线跑不起来，而"雨天该持续多久"这种规则
 *    恰恰是最该被断言的东西（改一个数字会让所有存档里的天气节奏一起变）；
 *  - 读档时的**脏数据**（旧档没有这个字段、手改存档写了 `kind: 'snow'`）要能安全回退。
 *
 * ⚠️ 与原版的差异：原版的天气由 `rainTime` / `thunderTime` 两条倒计时各自驱动，
 * 这里是一条"当前天气 + 剩余秒数"的简化模型。**它不是逐位对齐，但节奏范围照原版**：
 * 晴天 8~16 分钟、雨天 2~5 分钟、转雨时有 30% 是雷暴。
 */

/** 天气种类（与 `render/Weather.ts` 共用同一个字符串联合） */
export type WeatherKind = 'clear' | 'rain' | 'thunder';

/** 晴天持续区间（秒）：原版 12000~18000 tick = 10~15 分钟，这里取"8~16"留一点余量 */
export const CLEAR_SECONDS_MIN = 480;
export const CLEAR_SECONDS_MAX = 960;
/** 雨天/雷暴持续区间（秒）：原版 3000~6000 tick = 2.5~5 分钟 */
export const STORM_SECONDS_MIN = 120;
export const STORM_SECONDS_MAX = 300;
/** 晴天结束后转雨的概率；转雨之后有 30% 是雷暴 */
export const RAIN_CHANCE = 0.55;
export const THUNDER_CHANCE = 0.3;

/** 进存档的那一份数据 */
export interface WeatherState {
  readonly kind: WeatherKind;
  /** 当前天气的剩余秒数（> 0） */
  readonly seconds: number;
}

/** 默认状态：晴天、还有 10 分钟 */
export const DEFAULT_WEATHER: WeatherState = { kind: 'clear', seconds: 600 };

const KINDS: readonly WeatherKind[] = ['clear', 'rain', 'thunder'];

export function isWeatherKind(value: unknown): value is WeatherKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

/** 这一种天气该持续多久（秒） */
export function weatherSecondsFor(random: () => number, kind: WeatherKind): number {
  const [min, max] = kind === 'clear' ? [CLEAR_SECONDS_MIN, CLEAR_SECONDS_MAX] : [STORM_SECONDS_MIN, STORM_SECONDS_MAX];
  return min + random() * (max - min);
}

/**
 * 当前天气结束之后换成什么。
 *
 * 三条：晴天可能继续晴（45%）、可能转雨（55%，其中 30% 是雷暴）；雨天与雷暴一律转晴。
 */
export function nextWeatherKind(random: () => number, current: WeatherKind): WeatherKind {
  if (current !== 'clear') return 'clear';
  if (random() >= RAIN_CHANCE) return 'clear';
  return random() < THUNDER_CHANCE ? 'thunder' : 'rain';
}

/** 当前天气结束后进入的下一个状态（种类 + 这一种该持续多久） */
export function nextWeather(random: () => number, current: WeatherKind): WeatherState {
  const kind = nextWeatherKind(random, current);
  return { kind, seconds: weatherSecondsFor(random, kind) };
}

/** 推进 dt 秒；到点了就换（返回**新**状态，不改入参） */
export function tickWeather(state: WeatherState, dt: number, random: () => number): WeatherState {
  const left = state.seconds - dt;
  if (left > 0) return { kind: state.kind, seconds: left };
  return nextWeather(random, state.kind);
}

/** 天气播报的语气：普通提示 / 警告（雷暴） */
export type WeatherNoticeKind = 'system' | 'warning';

export interface WeatherNotice {
  text: string;
  kind: WeatherNoticeKind;
}

/**
 * 天气变化时该在消息栏里说什么（批次 221，用户："把天气变化的信息也提示一下"）。
 *
 * 为什么放在这个纯模块里：文案与"下雪还是下雨"的判据都是**规则**，
 * 和时长区间一样值得离线断言（改一个词不该靠进游戏里等一场雨来验收）。
 *
 * @param snowy 玩家所在地表是否寒冷群系（同一场降水在雪原叫"雪"、在平原叫"雨"）
 * @param seconds 新天气预计持续多少秒（播报里换算成分钟，让玩家知道要不要先躲一下）
 * @returns 没有变化（或变化不值得说）时返回 `null`
 */
export function weatherNotice(
  previous: WeatherKind,
  next: WeatherKind,
  snowy: boolean,
  seconds: number,
): WeatherNotice | null {
  if (previous === next) return null;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (next === 'clear') {
    // 雷暴转晴用"过去了"，雨/雪转晴用"停了"——雷暴的重点从来不是水
    if (previous === 'thunder') return { text: '雷暴过去了，天放晴了', kind: 'system' };
    return { text: snowy ? '雪停了' : '雨停了', kind: 'system' };
  }
  if (next === 'thunder') {
    return { text: `雷暴来了，小心闪电（约 ${minutes} 分钟）`, kind: 'warning' };
  }
  return { text: `${snowy ? '开始下雪了' : '开始下雨了'}（约 ${minutes} 分钟）`, kind: 'system' };
}

/**
 * 从存档里读回来（**脏数据逐条跳过**，与容器/告示牌那两处同一条口径）：
 * 字段缺失、种类不认识、秒数不是正数 —— 一律回退默认值，**不抛错也不静默变成负数**。
 */
export function restoreWeather(raw: unknown): WeatherState {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_WEATHER;
  const record = raw as { kind?: unknown; seconds?: unknown };
  if (!isWeatherKind(record.kind)) return DEFAULT_WEATHER;
  if (typeof record.seconds !== 'number' || !Number.isFinite(record.seconds) || record.seconds <= 0) {
    return { kind: record.kind, seconds: weatherSecondsFor(() => 0.5, record.kind) };
  }
  return { kind: record.kind, seconds: record.seconds };
}
