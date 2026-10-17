/**
 * 移动端降级策略离线测试（批次 130，TASKS N7）
 *
 * 这一批把 N6 那套"写在主循环里的自适应"收进 `core/world/PerfPolicy.ts`，
 * 并补上另外三个旋钮（动态分辨率 / 限帧 / 粒子总量）。抽出来之后，
 * **真正难测的那部分**才有断言：优先级、地板与上限、冷却、以及"来回折腾会不会漂"。
 *
 * 运行：npm run test:perfpolicy
 */

import {
  LIGHT_BUDGET_PER_FRAME,
  MOBILE_LIGHT_BUDGET_PER_FRAME,
  MOBILE_STARTUP_LIGHT_BUDGET_PER_FRAME,
  STARTUP_LIGHT_BUDGET_PER_FRAME,
  lightBudgetForFrame,
} from '../src/game/tuning.ts';
import {
  FRAME_TIME_DROP,
  RESOLUTION_MAX,
  RESOLUTION_MIN,
  VIEW_DISTANCE_MIN,
  MOBILE_PIXEL_RATIO_CAP,
  effectivePixelRatio,
  frameIntervalMs,
  initialPerfState,
  particleBudgetFor,
  perfPolicyStep,
  type PerfState,
  type PerfTuning,
} from '../src/core/world/PerfPolicy.ts';

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

const BOTH: PerfTuning = { adaptiveResolution: true, adaptiveViewDistance: true, viewDistanceCap: 12 };

/** 跑 `seconds` 秒（每帧 16.7ms），帧时间固定在 `frameTimeMs` */
function run(state: PerfState, seconds: number, frameTimeMs: number, tuning = BOTH): PerfState {
  const dt = 1 / 60;
  let current = state;
  for (let t = 0; t < seconds; t += dt) current = perfPolicyStep(current, dt, frameTimeMs, tuning).state;
  return current;
}

// ---------------------------------------------------------------- 1. 降级优先级

console.log('\n[掉帧时先牺牲什么：先分辨率、再视距]');
{
  const start = initialPerfState(12);
  equal('初值：分辨率 1.0（= 原来那套行为，不引入回归）', start.resolutionScale, RESOLUTION_MAX);
  equal('初值：视距取玩家设定值', start.viewDistance, 12);

  // 掉帧 3 秒：只该动分辨率（冷却 3 秒一次）
  const after3 = run(start, 3.5, 33);
  check('掉帧后分辨率降了', after3.resolutionScale < RESOLUTION_MAX, `${after3.resolutionScale}`);
  equal('视距**还没动**（分辨率先扛）', after3.viewDistance, 12);
  check('帧时间平均确实反映了掉帧', after3.frameTimeAvg > FRAME_TIME_DROP, `${after3.frameTimeAvg.toFixed(1)}ms`);

  // 一直掉帧：分辨率降到地板之后才开始降视距
  const long = run(start, 40, 33);
  equal('分辨率降到地板 0.5', long.resolutionScale, RESOLUTION_MIN);
  check('视距这时才降下来', long.viewDistance < 12, `${long.viewDistance}`);
  check('而且视距不会低于 4（再低没法玩）', long.viewDistance >= VIEW_DISTANCE_MIN, `${long.viewDistance}`);
}

console.log('\n[动态分辨率按设备背板缩放]');
{
  equal('桌面 DPR 1 × 满分辨率 = 1', effectivePixelRatio(1, 1), 1);
  equal('手机 DPR 3 夹到 2 × 满分辨率 = 2', effectivePixelRatio(3, 1), 2);
  equal('手机降到 0.9 档是 1.8（不会从 2 突然跳成 0.9）', effectivePixelRatio(3, 0.9), 1.8);
  equal('最低档仍保留 1 倍 CSS 像素', effectivePixelRatio(3, 0.5), 1);
  equal('非法 DPR 回退为 1', effectivePixelRatio(Number.NaN, 1), 1);
  equal('手机背板上限 1.5，不再画到 2', effectivePixelRatio(3, 1, MOBILE_PIXEL_RATIO_CAP), 1.5);
  check(
    '手机开局 0.8 档约 1.2（大约只有 2 倍档三分之一的像素）',
    Math.abs(effectivePixelRatio(3, 0.8, MOBILE_PIXEL_RATIO_CAP) - 1.2) < 1e-9,
    String(effectivePixelRatio(3, 0.8, MOBILE_PIXEL_RATIO_CAP)),
  );
  equal('上限不会超过桌面的 2', effectivePixelRatio(3, 1, 4), 2);
}

// ---------------------------------------------------------------- 2. 恢复顺序相反

console.log('\n[帧率回来之后：先还视距、最后才还分辨率]');
{
  const stressed: PerfState = { frameTimeAvg: 40, resolutionScale: RESOLUTION_MIN, viewDistance: 6, cooldown: 0 };

  // 恢复的第一段：视距先涨。
  // ⚠️ 帧时间平均是**滞后信号**（平滑系数 0.05）：刚切回 8ms 的头十来帧它还在 22ms 以上，
  // 所以那几帧仍算"掉帧"（甚至可能再多降一格视距）。这是迟滞控制的正常代价，
  // 断言要跨过这段过渡期看趋势（第一版只跑 9 秒，正好落在过渡期里）
  const early = run(stressed, 60, 8);
  check('视距先回来（更显眼的东西先还）', early.viewDistance > 6, `${early.viewDistance}`);
  equal('分辨率这时还没升（要等视距回到上限）', early.resolutionScale, RESOLUTION_MIN);

  // 长期恢复：两者都回到上限
  const full = run(stressed, 200, 8);
  equal('视距回到玩家设定值（不会超过）', full.viewDistance, 12);
  equal('分辨率回到 1.0', full.resolutionScale, RESOLUTION_MAX);
}

// ---------------------------------------------------------------- 3. 开关与边界

console.log('\n[两个开关各管一头、互不牵连]');
{
  const start = initialPerfState(12);

  const noRes = run(start, 12, 33, { ...BOTH, adaptiveResolution: false });
  equal('关掉自适应分辨率 → 分辨率一直是 1.0', noRes.resolutionScale, RESOLUTION_MAX);
  check('但视距照降（另一条路还在）', noRes.viewDistance < 12, `${noRes.viewDistance}`);

  const noView = run(start, 12, 33, { ...BOTH, adaptiveViewDistance: false });
  check('关掉自适应视距 → 分辨率照降', noView.resolutionScale < RESOLUTION_MAX, `${noView.resolutionScale}`);
  equal('视距一动不动', noView.viewDistance, 12);

  const allOff = run(start, 12, 33, { adaptiveResolution: false, adaptiveViewDistance: false, viewDistanceCap: 12 });
  equal('两个都关 → 什么都不动（帧时间照样统计）', `${allOff.resolutionScale},${allOff.viewDistance}`, '1,12');
  check('但帧时间平均仍在更新（HUD 与验收要读它）', allOff.frameTimeAvg > 30, `${allOff.frameTimeAvg.toFixed(1)}ms`);

  // 视距上限：玩家把它调到 6，自适应不该涨过 6
  const capped = run({ ...start, viewDistance: 6 }, 100, 8, { ...BOTH, viewDistanceCap: 6 });
  equal('恢复时不会超过玩家设定的视距', capped.viewDistance, 6);
}

// ---------------------------------------------------------------- 4. 冷却（别在阈值上抖）

console.log('\n[冷却：一次调整之后要等一会儿才允许下一次]');
{
  // ⚠️ 帧时间平均是滞后信号：单帧 33ms 只会把它从 16.7 推到 17.5，还够不到阈值 22。
  // 所以"第一次动作"要在**积累一秒左右**之后才发生（这也正是"抗抖动"的来源）
  let state = initialPerfState(12);
  let firstAction: string | null = null;
  for (let t = 0; t < 2 && firstAction === null; t += 1 / 60) {
    const step = perfPolicyStep(state, 1 / 60, 33, BOTH);
    state = step.state;
    firstAction = step.action;
  }
  const dropping = { state, action: firstAction };
  check('掉帧积累一会儿之后动了一次', dropping.action === 'resolution-down', `${dropping.action}`);
  check('并且进入冷却', dropping.state.cooldown > 0, `${dropping.state.cooldown}s`);

  // 冷却期内就算继续掉帧也不动
  const during = perfPolicyStep(dropping.state, 0.5, 33, BOTH);
  equal('冷却期内不再调档', during.action, null);
  equal('状态不变（除了帧时间平均）', during.state.resolutionScale, dropping.state.resolutionScale);

  // 冷却过去之后继续降
  const after = perfPolicyStep({ ...dropping.state, cooldown: 0 }, 1 / 60, 33, BOTH);
  equal('冷却过后继续降一档', after.action, 'resolution-down');
}

// ---------------------------------------------------------------- 5. 来回折腾会不会漂

console.log('\n[反复掉帧与恢复之后，能回到原样（不漂）]');
{
  let state = initialPerfState(12);
  for (let round = 0; round < 4; round++) {
    state = run(state, 60, 33);
    state = run(state, 300, 8);
  }
  equal('四轮之后分辨率仍然是 1.0', state.resolutionScale, RESOLUTION_MAX);
  equal('四轮之后视距仍然是玩家设定值', state.viewDistance, 12);
}

// ---------------------------------------------------------------- 6. 限帧与粒子总量

console.log('\n[限帧与粒子总量（另外两个旋钮）]');
{
  equal('不限帧：0', frameIntervalMs(0), 0);
  equal('负数也当不限', frameIntervalMs(-30), 0);
  equal('60 帧 → 16.7ms 取整 17', frameIntervalMs(60), 17);
  equal('30 帧 → 33ms', frameIntervalMs(30), 33);
  check('帧率上限越高、间隔越小', frameIntervalMs(120) < frameIntervalMs(60));

  equal('粒子关掉 → 上限 0', particleBudgetFor('off'), 0);
  equal('粒子减半 → 120', particleBudgetFor('reduced'), 120);
  equal('粒子全开 → 400', particleBudgetFor('all'), 400);
}

console.log('\n[手机光照预算不能沿用桌面的启动档]');
{
  equal('桌面启动期仍是 12 万步', lightBudgetForFrame(true, false), STARTUP_LIGHT_BUDGET_PER_FRAME);
  equal('桌面进游戏后回到 6000', lightBudgetForFrame(false, false), LIGHT_BUDGET_PER_FRAME);
  equal('手机遮罩期间用较小的启动预算', lightBudgetForFrame(true, true), MOBILE_STARTUP_LIGHT_BUDGET_PER_FRAME);
  equal('手机进游戏后用游玩预算', lightBudgetForFrame(false, true), MOBILE_LIGHT_BUDGET_PER_FRAME);
  check(
    '手机启动预算不超过桌面的四分之一（否则一帧仍会被打满）',
    MOBILE_STARTUP_LIGHT_BUDGET_PER_FRAME * 4 <= STARTUP_LIGHT_BUDGET_PER_FRAME,
  );
  check('手机游玩预算低于桌面', MOBILE_LIGHT_BUDGET_PER_FRAME < LIGHT_BUDGET_PER_FRAME);
}

console.log(`\n降级策略测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
