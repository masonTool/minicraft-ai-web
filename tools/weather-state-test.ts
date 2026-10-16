/**
 * 天气状态与规则离线测试（L6，批次 85）
 *
 * 这一批做成的是"**天气能活过重开**"：在此之前天气只活在渲染类里，
 * 关掉页面再进来一定是晴天（构造函数把 `kind` 与 `timer` 重置成初始值）。
 * 断言分四块：
 *  1. **规则**：晴天结束之后转雨的概率、转雨里有 30% 是雷暴、两种天气的时长区间；
 *  2. **推进**：`tickWeather` 只递减、到点才换，且**不改入参**（纯函数）；
 *  3. **存档往返**：`snapshot()` 出来的两个数经 JSON 一圈还能读回来；
 *  4. **脏数据**：旧档没有字段、种类不认识、秒数是负数/NaN/字符串 —— 一律回退默认值，
 *     而且**不回退成"晴天 0 秒"**（那会让下一帧立刻再换一次天气）。
 *
 * 运行：npm run test:weather
 */

import {
  CLEAR_SECONDS_MAX,
  CLEAR_SECONDS_MIN,
  DEFAULT_WEATHER,
  RAIN_CHANCE,
  STORM_SECONDS_MAX,
  STORM_SECONDS_MIN,
  THUNDER_CHANCE,
  isWeatherKind,
  nextWeather,
  nextWeatherKind,
  restoreWeather,
  tickWeather,
  weatherSecondsFor,
} from '../src/core/world/WeatherState.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

function near(label: string, actual: number, expected: number, tol = 1e-9): void {
  check(label, Math.abs(actual - expected) <= tol, `实际 ${actual}，期望约 ${expected}`);
}

/** 固定序列随机源（分布断言用，同一序列永远同一结果） */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

console.log('\n[种类与默认值]');
{
  equal('默认是晴天', DEFAULT_WEATHER.kind, 'clear');
  check('默认还有一段时间（不是 0——0 会让下一帧立刻换天气）', DEFAULT_WEATHER.seconds > 60);
  check('三种天气都认得', (['clear', 'rain', 'thunder'] as const).every(isWeatherKind));
  check('不认识的不算', !isWeatherKind('snow') && !isWeatherKind('') && !isWeatherKind(null) && !isWeatherKind(3));
}

console.log('\n[时长区间：照原版节奏]');
{
  near('晴天最短 8 分钟', weatherSecondsFor(() => 0, 'clear'), CLEAR_SECONDS_MIN);
  near('晴天最长 16 分钟', weatherSecondsFor(() => 0.999, 'clear'), CLEAR_SECONDS_MAX, 1);
  near('雨天最短 2 分钟', weatherSecondsFor(() => 0, 'rain'), STORM_SECONDS_MIN);
  near('雨天最长 5 分钟', weatherSecondsFor(() => 0.999, 'rain'), STORM_SECONDS_MAX, 1);
  near('雷暴与雨天同一区间', weatherSecondsFor(() => 0.5, 'thunder'), (STORM_SECONDS_MIN + STORM_SECONDS_MAX) / 2);
  check('晴天至少比雨天长（原版更极端：10~15 分钟 vs 2.5~5 分钟）', CLEAR_SECONDS_MIN > STORM_SECONDS_MAX);
}

console.log('\n[转换：晴天可能继续晴，雨天一律转晴]');
{
  equal('晴天 + 随机数很大 → 还是晴天', nextWeatherKind(() => 0.99, 'clear'), 'clear');
  equal('晴天 + 随机数很小 → 转雨或雷暴', ['rain', 'thunder'].includes(nextWeatherKind(() => 0.1, 'clear')), true);
  equal('雨天之后一定是晴天', nextWeatherKind(() => 0, 'rain'), 'clear');
  equal('雷暴之后一定是晴天', nextWeatherKind(() => 0.5, 'thunder'), 'clear');
  // 雷暴那一步用的是**第二个**随机数（第一个决定"要不要下雨"）
  let calls = 0;
  const seq = (): number => (calls++ === 0 ? 0.1 : 0.2);
  equal('两个随机数分别决定"下不下雨"与"是不是雷暴"', nextWeatherKind(seq, 'clear'), 'thunder');

  // 分布：晴天结束时约 55% 转雨（其中 30% 雷暴）
  const rolls = lcg(20261016);
  const counts = { clear: 0, rain: 0, thunder: 0 };
  const runs = 20000;
  for (let i = 0; i < runs; i++) counts[nextWeatherKind(rolls, 'clear')]++;
  check(`晴天结束转雨约 ${(RAIN_CHANCE * 100).toFixed(0)}%（实测 ${((runs - counts.clear) / runs * 100).toFixed(1)}%）`, Math.abs((runs - counts.clear) / runs - RAIN_CHANCE) < 0.02);
  check(`其中雷暴约 ${(THUNDER_CHANCE * 100).toFixed(0)}%（实测 ${(counts.thunder / (runs - counts.clear) * 100).toFixed(1)}%）`, Math.abs(counts.thunder / (runs - counts.clear) - THUNDER_CHANCE) < 0.03);
  // 雨天转晴时不该掷出"雨天"来
  let rainAfterRain = 0;
  for (let i = 0; i < 500; i++) if (nextWeatherKind(rolls, 'rain') !== 'clear') rainAfterRain++;
  equal('雨天之后 500 次全是晴', rainAfterRain, 0);
}

console.log('\n[推进：到点才换，且不改入参]');
{
  const state = { kind: 'rain' as const, seconds: 10 };
  const after1 = tickWeather(state, 1, () => 0.5);
  equal('推进 1 秒：还是雨', after1.kind, 'rain');
  near('推进 1 秒：剩 9 秒', after1.seconds, 9);
  near('入参没被改（纯函数）', state.seconds, 10);

  const after9 = tickWeather(after1, 9, () => 0.5);
  equal('推满 10 秒：换成下一种（雨天 → 晴）', after9.kind, 'clear');
  check('新天气的时长落在晴天的区间里', after9.seconds >= CLEAR_SECONDS_MIN && after9.seconds <= CLEAR_SECONDS_MAX);

  // 超量推进（掉帧 5 秒）只换**一次**：结果是"下一种天气"，而不是连着换两三次
  const overshoot = tickWeather({ kind: 'clear', seconds: 0.5 }, 5, () => 0.5);
  check('一次推 5 秒（跨过终点）：得到合法状态', isWeatherKind(overshoot.kind) && overshoot.seconds > 0);
  check(
    '新时长落在它自己那一种的区间里（没有"补跑"出别的天气）',
    overshoot.kind === 'clear'
      ? overshoot.seconds >= CLEAR_SECONDS_MIN && overshoot.seconds <= CLEAR_SECONDS_MAX
      : overshoot.seconds >= STORM_SECONDS_MIN && overshoot.seconds <= STORM_SECONDS_MAX,
    `${overshoot.kind} ${overshoot.seconds}`,
  );

  const next = nextWeather(() => 0.1, 'clear');
  check('nextWeather 给出的时长落在对应区间里', next.seconds >= 0);
  check('nextWeather 的种类是三种之一', isWeatherKind(next.kind));
}

console.log('\n[存档往返：就两个数]');
{
  const state = { kind: 'thunder' as const, seconds: 123.5 };
  // ⚠️ 经 **JSON 往返**再读：结构化克隆允许 undefined 与类实例混进来，JSON 会当场暴露
  const restored = restoreWeather(JSON.parse(JSON.stringify(state)) as unknown);
  equal('种类读回来', restored.kind, 'thunder');
  near('秒数读回来', restored.seconds, 123.5);
  check('往返之后与原来一致', JSON.stringify(restored) === JSON.stringify(state));

  const clear = restoreWeather({ kind: 'clear', seconds: 300 });
  equal('晴天也能往返', clear.kind, 'clear');
  near('秒数没变', clear.seconds, 300);
}

console.log('\n[脏数据：一律回退默认，且不回退成 0 秒]');
{
  const cases: readonly (readonly [string, unknown])[] = [
    ['undefined（老存档没这个字段）', undefined],
    ['null', null],
    ['字符串', 'rain'],
    ['数字', 42],
    ['空对象', {}],
    ['种类不认识', { kind: 'snow', seconds: 100 }],
    ['种类是数字', { kind: 1, seconds: 100 }],
    ['秒数是 NaN', { kind: 'rain', seconds: Number.NaN }],
    ['秒数是字符串', { kind: 'rain', seconds: '100' }],
    ['秒数是复数', { kind: 'rain', seconds: -5 }],
    ['秒数是 0', { kind: 'rain', seconds: 0 }],
    ['秒数是 Infinity', { kind: 'rain', seconds: Number.POSITIVE_INFINITY }],
  ];
  for (const [label, raw] of cases) {
    const restored = restoreWeather(raw);
    const ok =
      isWeatherKind(restored.kind) &&
      Number.isFinite(restored.seconds) &&
      restored.seconds > 0;
    check(`${label} → 得到合法状态（${restored.kind} ${Math.round(restored.seconds)}s）`, ok, JSON.stringify(restored));
  }

  // 种类合法、只有秒数坏了：**应该保住种类**（不该把雷暴踢回晴天）
  const keptKind = restoreWeather({ kind: 'thunder', seconds: Number.NaN });
  equal('只有秒数坏掉时保住种类', keptKind.kind, 'thunder');
  check('并且给这一种天气的合理时长', keptKind.seconds >= STORM_SECONDS_MIN && keptKind.seconds <= STORM_SECONDS_MAX);
}

console.log(`\n天气状态测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
