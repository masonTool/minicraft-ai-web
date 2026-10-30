/**
 * 移动端降级策略离线测试（批次 130，TASKS N7）
 *
 * 这一批把 N6 那套"写在主循环里的自适应"收进 `core/world/PerfPolicy.ts`，
 * 并补上另外三个旋钮（动态分辨率 / 限帧 / 粒子总量）。抽出来之后，
 * **真正难测的那部分**才有断言：优先级、地板与上限、冷却、以及"来回折腾会不会漂"。
 *
 * 运行：npm run test:perfpolicy
 */

import { readFileSync } from 'node:fs';
import { IDLE_AFTER_MS, IDLE_MAX_FPS, IdleFrameRate } from '../web/src/core/world/IdleFrameRate.ts';
import { CAMERA_NEAR, SKY_MAX_RADIUS, cameraFarFor } from '../web/src/render/Sky.ts';

import {
  LIGHT_BUDGET_PER_FRAME,
  MOBILE_LIGHT_BUDGET_PER_FRAME,
  MOBILE_STARTUP_LIGHT_BUDGET_PER_FRAME,
  STARTUP_LIGHT_BUDGET_PER_FRAME,
  lightBudgetForFrame,
} from '../web/src/game/tuning.ts';
import {
  DECOR_LEVEL_MAX,
  FRAME_TIME_DROP,
  RESOLUTION_MAX,
  RESOLUTION_MIN,
  VIEW_DISTANCE_MIN,
  VIEW_RAISE_BLOCK_SECONDS,
  MOBILE_INITIAL_RESOLUTION,
  MOBILE_PIXEL_RATIO_CAP,
  MOBILE_RESOLUTION_MIN,
  MOBILE_VIEW_DISTANCE_MAX,
  MOBILE_FOV_MAX,
  FOV_MAX,
  FOV_MIN,
  FramePhaseMeter,
  clampFovFor,
  decorCloudsVisible,
  fovCapFor,
  decorParticleBudget,
  decorRainFraction,
  FOG_GROW_CHUNKS_PER_SEC,
  FOG_GROW_WAIT_LIMIT,
  FOG_SHRINK_CHUNKS_PER_SEC,
  effectivePixelRatio,
  fogRadiusStep,
  frameIntervalMs,
  initialPerfState,
  particleBudgetFor,
  perfPolicyStep,
  viewDistanceCapFor,
  type PerfState,
  type PerfTuning,
} from '../web/src/core/world/PerfPolicy.ts';

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

/** 桌面：两档都开、上限 12、分辨率地板 0.5 */
const BOTH: PerfTuning = {
  adaptiveResolution: true,
  adaptiveViewDistance: true,
  viewDistanceCap: 12,
  resolutionFloor: RESOLUTION_MIN,
};
/** 手机：上限被 `viewDistanceCapFor` 夹到 8，分辨率地板 0.75 */
const MOBILE: PerfTuning = {
  adaptiveResolution: true,
  adaptiveViewDistance: true,
  viewDistanceCap: viewDistanceCapFor(12, true),
  resolutionFloor: MOBILE_RESOLUTION_MIN,
};

/** 跑 `seconds` 秒（每帧 16.7ms），帧时间固定在 `frameTimeMs` */
function run(state: PerfState, seconds: number, frameTimeMs: number, tuning = BOTH): PerfState {
  const dt = 1 / 60;
  let current = state;
  for (let t = 0; t < seconds; t += dt) current = perfPolicyStep(current, dt, frameTimeMs, tuning).state;
  return current;
}

/**
 * 与 `run` 同样跑一遍，但把**每一步的动作**按顺序收集起来。
 *
 * "先降哪个"这类优先级，只断言最终状态是看不出来的（三条路最后都会走到底），
 * 必须看动作序列。
 */
function collectActions(
  state: PerfState,
  seconds: number,
  frameTimeMs: number,
  tuning = BOTH,
): string[] {
  const dt = 1 / 60;
  const actions: string[] = [];
  let current = state;
  for (let t = 0; t < seconds; t += dt) {
    const step = perfPolicyStep(current, dt, frameTimeMs, tuning);
    current = step.state;
    if (step.action) actions.push(step.action);
  }
  return actions;
}

// ---------------------------------------------------------------- 1. 降级优先级

console.log('\n[掉帧时先牺牲什么：先视距、后分辨率]');
{
  const start = initialPerfState(12);
  equal('初值：分辨率 1.0（= 原来那套行为，不引入回归）', start.resolutionScale, RESOLUTION_MAX);
  equal('初值：视距取玩家设定值', start.viewDistance, 12);

  // 掉帧 4.5 秒：只该动视距（视距冷却 4 秒一次，这时刚降完第二格）
  const after = run(start, 4.5, 33);
  check('掉帧后视距降了', after.viewDistance < 12, `${after.viewDistance}`);
  equal('分辨率**还没动**（视距先扛：近处不能糊）', after.resolutionScale, RESOLUTION_MAX);
  check('帧时间平均确实反映了掉帧', after.frameTimeAvg > FRAME_TIME_DROP, `${after.frameTimeAvg.toFixed(1)}ms`);

  // 一直掉帧：视距收到地板 → 关装饰层 → 最后才轮到分辨率
  const long = run(start, 90, 33);
  equal('视距先收到地板 4', long.viewDistance, VIEW_DISTANCE_MIN);
  equal('装饰层也关到底（云/粒子/雨量）', long.decorLevel, DECOR_LEVEL_MAX);
  check('分辨率这时才降下来', long.resolutionScale < RESOLUTION_MAX, `${long.resolutionScale}`);
  equal('分辨率降到地板 0.5（桌面那一档）', long.resolutionScale, RESOLUTION_MIN);

  // 顺序本身：先动视距、再动装饰层、最后才动分辨率
  const seq = collectActions(initialPerfState(12), 90, 33);
  check('第一个动作是收视距', seq[0] === 'view-down', `${seq[0]}`);
  check('视距让完之后才轮到装饰层', seq.indexOf('decor-down') > seq.lastIndexOf('view-down'), seq.join(','));
  check('装饰层让完之后才轮到分辨率', seq.indexOf('resolution-down') > seq.lastIndexOf('decor-down'), seq.join(','));
}

console.log('\n[视距 7↔8 反复横跳：降过的档位要封一会儿（批次 216）]');
{
  // 真机日志（2026-10-18）：8 档 frameAvg 22~29ms（判"卡"→降 7），
  // 7 档 16.6ms（判"有余量"→升 8），13 分钟里来回 40 多次。
  // 关键不是"升档太早"，而是**7 档的 60fps 正是降档换来的**，不能当作"8 也行"的证据。
  let state = initialPerfState(8);
  const actions: string[] = [];
  const feed = (seconds: number, ms: number): void => {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      const step = perfPolicyStep(state, dt, ms, BOTH);
      state = step.state;
      if (step.action) actions.push(step.action);
    }
  };
  feed(1, 26);
  equal('8 档第一次掉帧 → 降到 7', state.viewDistance, 7);
  equal('第一次不封（可能只是一次长帧）', state.blockedSeconds, 0);
  equal('但记住了"是从 8 降下来的"', state.lastDropFrom, 8);
  feed(8.5, 16.6);
  equal('满帧 8 秒后允许重试一次 → 回到 8', state.viewDistance, 8);

  // 升档后的冷却 8 秒要等过去，才会再判一次掉帧
  feed(5, 26);
  equal('同一档第二次掉帧 → 又降到 7', state.viewDistance, 7);
  check('这次开始封（约 90 秒）', state.blockedSeconds > 85, `${state.blockedSeconds.toFixed(0)}s`);
  // 只统计"封禁开始之后"的动作（前面那次合法的 view-up 不算）
  const afterBlock = actions.length;
  feed(40, 16.6);
  equal('满帧 40 秒也不许升回 8', state.viewDistance, 7);
  check('封禁期内一个 view-up 都没有', !actions.slice(afterBlock).includes('view-up'), actions.slice(afterBlock).join(','));
  feed(VIEW_RAISE_BLOCK_SECONDS, 16.6);
  check('封禁到期后才允许再试一次', actions.slice(afterBlock).includes('view-up'), actions.slice(afterBlock).join(','));
  // 这套 tuning 用的是桌面上限 12，所以解封后会一路往上涨；关键是"能涨回 8 以上"
  check('试过之后确实升回了被封锁的那一档以上', state.viewDistance > 7, `${state.viewDistance}`);
}

console.log('\n[动态分辨率按设备背板缩放]');
{
  equal('桌面 DPR 1 × 满分辨率 = 1', effectivePixelRatio(1, 1), 1);
  equal('手机 DPR 3 夹到 2 × 满分辨率 = 2', effectivePixelRatio(3, 1), 2);
  equal('手机降到 0.9 档是 1.8（不会从 2 突然跳成 0.9）', effectivePixelRatio(3, 0.9), 1.8);
  equal('最低档仍保留 1 倍 CSS 像素', effectivePixelRatio(3, 0.5), 1);
  equal('非法 DPR 回退为 1', effectivePixelRatio(Number.NaN, 1), 1);
  // 批次 216：用户要求"画质不要降低，先保帧率、再保画质，视野可以让"
  // → 手机背板从 1.5 抬到 2（多 1.78 倍像素），省下的预算由视距（8 → 6）付
  equal('手机背板上限抬到 2（0.64M → 0.89M 像素）', effectivePixelRatio(3, 1, MOBILE_PIXEL_RATIO_CAP), 2);
  equal(
    '手机开局不再预折：1.0 档直接给到背板上限 2（近处清晰优先）',
    effectivePixelRatio(3, MOBILE_INITIAL_RESOLUTION, MOBILE_PIXEL_RATIO_CAP),
    2,
  );
  equal('手机开局档就是满档', MOBILE_INITIAL_RESOLUTION, RESOLUTION_MAX);
  equal('上限不会超过桌面的 2', effectivePixelRatio(3, 1, 4), 2);
}

// ---------------------------------------------------------------- 2. 恢复顺序相反

console.log('\n[帧率回来之后：先还分辨率、最后才放视距]');
{
  // 起点：视距已经在地板、分辨率已经到底（最惨的那一档，两者都有得可还）
  const stressed: PerfState = {
    frameTimeAvg: 40,
    resolutionScale: RESOLUTION_MIN,
    viewDistance: VIEW_DISTANCE_MIN,
    decorLevel: DECOR_LEVEL_MAX,
    cooldown: 0,
    lastDropFrom: null,
    blockedSeconds: 0,
  };

  // 恢复的第一段（12 秒）：只够涨两次分辨率（冷却 10 秒一次）
  // ⚠️ 帧时间平均是**滞后信号**（平滑系数 0.05）：刚切回 8ms 的头二十来帧它还在 22ms 以上，
  // 所以那几帧仍算"掉帧"。起点特意选在"视距与分辨率都到底"，过渡期就无处可降，
  // 断言因此只看得到"恢复"这一侧（更稳）
  const early = run(stressed, 12, 8);
  check('分辨率先回来（近处清晰优先）', early.resolutionScale > RESOLUTION_MIN, `${early.resolutionScale}`);
  equal('视距这时还没动（要等分辨率还满）', early.viewDistance, VIEW_DISTANCE_MIN);
  equal('装饰层也还没开回来（排在分辨率之后）', early.decorLevel, DECOR_LEVEL_MAX);

  // 长期恢复：三者都回到上限
  const full = run(stressed, 240, 8);
  equal('分辨率回到 1.0', full.resolutionScale, RESOLUTION_MAX);
  equal('装饰层回到 0（云与粒子都回来）', full.decorLevel, 0);
  equal('视距回到玩家设定值（不会超过）', full.viewDistance, 12);

  // 顺序本身：分辨率 → 装饰层 → 视距
  const seq = collectActions(stressed, 240, 8);
  check('第一个动作是还分辨率', seq[0] === 'resolution-up', `${seq[0]}`);
  check('分辨率还满之后才开装饰层', seq.indexOf('decor-up') > seq.lastIndexOf('resolution-up'), seq.join(','));
  check('装饰层开完之后才放视距', seq.indexOf('view-up') > seq.lastIndexOf('decor-up'), seq.join(','));
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

  const allOff = run(start, 12, 33, {
    adaptiveResolution: false,
    adaptiveViewDistance: false,
    viewDistanceCap: 12,
    resolutionFloor: RESOLUTION_MIN,
  });
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
  check('掉帧积累一会儿之后动了一次（先动视距）', dropping.action === 'view-down', `${dropping.action}`);
  check('并且进入冷却', dropping.state.cooldown > 0, `${dropping.state.cooldown}s`);

  // 冷却期内就算继续掉帧也不动
  const during = perfPolicyStep(dropping.state, 0.5, 33, BOTH);
  equal('冷却期内不再调档', during.action, null);
  equal('状态不变（除了帧时间平均）', during.state.viewDistance, dropping.state.viewDistance);

  // 冷却过去之后继续降
  const after = perfPolicyStep({ ...dropping.state, cooldown: 0 }, 1 / 60, 33, BOTH);
  equal('冷却过后继续降一档', after.action, 'view-down');
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

// ---------------------------------------------------------------- 6. 手机的两个上限

console.log('\n[手机：视距上限更小、分辨率地板更高]');
{
  equal('桌面不受影响（玩家设 12 就是 12）', viewDistanceCapFor(12, false), 12);
  equal('手机夹到 8（屏幕小，不需要展示那么远）', viewDistanceCapFor(12, true), MOBILE_VIEW_DISTANCE_MAX);
  equal('滑块拖到 16 也只到 8（手机上限挡住它）', viewDistanceCapFor(16, true), MOBILE_VIEW_DISTANCE_MAX);
  equal('玩家自己往小调仍然生效', viewDistanceCapFor(5, true), 5);
  equal('不会低于视距地板 4', viewDistanceCapFor(1, true), VIEW_DISTANCE_MIN);
  equal('非法取值回退到手机上限', viewDistanceCapFor(Number.NaN, true), MOBILE_VIEW_DISTANCE_MAX);
  check('手机上限确实小于桌面常用的 12', MOBILE_VIEW_DISTANCE_MAX < 12);

  // 手机上持续掉帧：视距先收到 4，分辨率只在最后动，且只到 0.75
  const start: PerfState = {
    frameTimeAvg: 16.7,
    resolutionScale: RESOLUTION_MAX,
    viewDistance: viewDistanceCapFor(12, true),
    decorLevel: 0,
    cooldown: 0,
    lastDropFrom: null,
    blockedSeconds: 0,
  };
  const stressed = run(start, 60, 33, MOBILE);
  equal('手机视距先收到地板 4', stressed.viewDistance, VIEW_DISTANCE_MIN);
  equal('手机分辨率只降到 0.75（不到 0.5）', stressed.resolutionScale, MOBILE_RESOLUTION_MIN);
  check('手机那一档比桌面高（近处不能糊）', MOBILE_RESOLUTION_MIN > RESOLUTION_MIN);

  // ⚠️ 这一条是踩出来的坑（开发时真的红过）：`Math.round(7.5)` = **8**，
  // 所以"先夹地板再取整"会把 0.75 重新算成 0.8 —— 症状是"每 3 秒降一档、画面却不再变化"。
  // 地板不必落在 0.1 的步长网格上，因此只能由**夹紧**那一步决定，取整必须在它之前。
  const atFloor: PerfState = {
    frameTimeAvg: 30,
    resolutionScale: 0.8,
    viewDistance: VIEW_DISTANCE_MIN,
    decorLevel: DECOR_LEVEL_MAX,
    cooldown: 0,
    lastDropFrom: null,
    blockedSeconds: 0,
  };
  const stepped = perfPolicyStep(atFloor, 1 / 60, 33, MOBILE);
  equal('最后一档真的落到地板 0.75（不会被 round1 弹回 0.8）', stepped.state.resolutionScale, MOBILE_RESOLUTION_MIN);
  const afterFloor = perfPolicyStep({ ...stepped.state, cooldown: 0 }, 1 / 60, 33, MOBILE);
  equal('两个旋钮都到底之后不再折腾（动作为空）', afterFloor.action, null);

  // 手机恢复：分辨率先回到 1.0，视距最后才放，且只放到手机上限 8
  const recovered = run(stressed, 200, 8, MOBILE);
  equal('手机分辨率先回到 1.0', recovered.resolutionScale, RESOLUTION_MAX);
  equal('视距回到手机上限 8（不会一路爬到 12）', recovered.viewDistance, MOBILE_VIEW_DISTANCE_MAX);
}

// ---------------------------------------------------------------- 7. 限帧与粒子总量

console.log('\n[限帧与粒子总量（另外两个旋钮）]');
{
  equal('不限帧：0', frameIntervalMs(0), 0);
  equal('负数也当不限', frameIntervalMs(-30), 0);
  // ⚠️ 这里断的是**行为**不是常数：`1000/60` 取整成 17ms 会让 60Hz 屏隔帧全跳，
  // 选"60 帧"实际只剩 30 帧（120Hz 屏上变成 40 帧且节奏不均）。见 `framecap` 那段
  check('60 帧的间隔必须小于 60Hz 的 16.67ms', frameIntervalMs(60) < 1000 / 60, `实际 ${frameIntervalMs(60)}ms`);
  check('帧率上限越高、间隔越小', frameIntervalMs(120) < frameIntervalMs(60));

  /** 按 rAF 时间戳模拟限帧：一秒里真正画了多少帧 */
  const simulatedFps = (maxFps: number, refreshHz: number): number => {
    const interval = frameIntervalMs(maxFps);
    let last = 0;
    let drawn = 0;
    for (let i = 1; i <= refreshHz; i++) {
      const now = (i * 1000) / refreshHz;
      if (interval > 0 && now - last < interval) continue;
      last = now;
      drawn++;
    }
    return drawn;
  };
  equal('60Hz 屏选"60 帧"→ 真的 60 帧', simulatedFps(60, 60), 60);
  equal('60Hz 屏选"30 帧"→ 30 帧', simulatedFps(30, 60), 30);
  equal('120Hz 屏选"60 帧"→ 60 帧（不是 40）', simulatedFps(60, 120), 60);

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

// ---------------------------------------------------------------- 8. 雾滞后于视距

console.log('\n[雾滞后于视距：收缩快、扩张慢、而且要等远处画好]');
{
  // 第一帧直接对齐（否则开局雾会从 0 慢慢涨上来，等于"先看一片白再看见世界"）
  equal('未初始化时直接对齐目标', fogRadiusStep(0, 6, 1 / 60, true, 0).radius, 6);
  equal('dt=0 只是重算一次、不推进动画', fogRadiusStep(6, 12, 0, true, 0).radius, 6);

  // 收缩：4 区块/秒，而且是连续的（不是一跳到底）
  check('收缩 0.5 秒收 2 格', Math.abs(fogRadiusStep(8, 6, 0.5, true, 0).radius - 6) < 1e-9, `${fogRadiusStep(8, 6, 0.5, true, 0).radius}`);
  check('收缩是连续的（0.25 秒只收 1 格）', Math.abs(fogRadiusStep(8, 6, 0.25, true, 0).radius - 7) < 1e-9, `${fogRadiusStep(8, 6, 0.25, true, 0).radius}`);
  check('收缩比扩张快（方向不对称是刻意的）', FOG_SHRINK_CHUNKS_PER_SEC > FOG_GROW_CHUNKS_PER_SEC);

  // 扩张：1.2 区块/秒
  check(
    '扩张 1 秒只推 1.2 格',
    Math.abs(fogRadiusStep(6, 8, 1, true, 0).radius - 7.2) < 1e-9,
    `${fogRadiusStep(6, 8, 1, true, 0).radius}`,
  );

  // 扩张要等就绪：远处没画好就推雾 = 让玩家看见空地上逐块长出地形
  const blocked = fogRadiusStep(6, 8, 1, false, 0);
  equal('远处还没画好时雾不推', blocked.radius, 6);
  check('等待计时在累加', blocked.waited > 0, `${blocked.waited}`);

  // 但不能永远等：等待上限到了就强制推进
  check(
    '等过上限之后强制推进（否则一直挖方块就永远灰蒙蒙）',
    fogRadiusStep(6, 8, 1, false, FOG_GROW_WAIT_LIMIT).radius > 6,
    `${fogRadiusStep(6, 8, 1, false, FOG_GROW_WAIT_LIMIT).radius}`,
  );

  // 边界：到目标就停，两个方向都不冲过去
  equal('已经到目标就不动', fogRadiusStep(8, 8, 1, true, 0).radius, 8);
  equal('扩张不会冲过目标', fogRadiusStep(7.9, 8, 1, true, 0).radius, 8);
  equal('收缩不会冲过目标', fogRadiusStep(4.1, 4, 1, true, 0).radius, 4);
}

// ---------------------------------------------------------------- 9. 装饰层档位

console.log('\n[装饰层档位：关的都是"不在近处"的东西]');
{
  // 云：一层 900×900 的双面半透明面，而且 frustumCulled = false（每帧必画）
  check('档位 0 画云', decorCloudsVisible(0));
  check('档位 1 起就不画云', !decorCloudsVisible(1) && !decorCloudsVisible(2));

  // 粒子：与玩家设置取小（设置永远是最严的那个）
  equal('档位 0 尊重设置（全开 = 400）', decorParticleBudget('all', 0), 400);
  equal('档位 1 压到减半档 120', decorParticleBudget('all', 1), 120);
  equal('档位 2 直接归零', decorParticleBudget('all', 2), 0);
  equal('设置里关掉的，档位回到 0 也不打开', decorParticleBudget('off', 0), 0);
  equal('设置是减半、档位 1 → 仍是 120（取小）', decorParticleBudget('reduced', 1), 120);

  // 雨 / 雪：密度直接等于 overdraw
  equal('档位 0 全量', decorRainFraction(0), 1);
  equal('档位 1 减半', decorRainFraction(1), 0.5);
  equal('档位 2 只剩四分之一', decorRainFraction(2), 0.25);
  check('雨量随档位单调递减', decorRainFraction(0) > decorRainFraction(1) && decorRainFraction(1) > decorRainFraction(2));

  // 门控：关掉"自适应视距"之后，装饰层也不该被自动关掉（共用同一个开关）
  const noView = run(initialPerfState(12), 20, 33, { ...BOTH, adaptiveViewDistance: false });
  equal('关掉自适应视距 → 装饰层也不动', noView.decorLevel, 0);
  check('但分辨率照降（最后手段还在）', noView.resolutionScale < RESOLUTION_MAX, `${noView.resolutionScale}`);
}

// ---------------------------------------------------------------- 10. 接线那一处（源码级）

console.log('\n[接线：雾的推进不能假设渲染层已经建好]');
{
  // ⚠️ 这一条是**真机崩出来的**：`applyEnvironment()` 在构造函数里比 `chunkRenderer`
  // 还早跑一次（它排在建 Worker 池之后），而 `updateFogRadius` 要读它的 `queueLength`
  // ——于是每一局的第一帧都是 `Cannot read properties of undefined`。
  // 纯函数（`fogRadiusStep`）测不到"被调用得太早"这件事，只能盯住接线那一处必须有守卫。
  const mainSrc = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  const from = mainSrc.indexOf('private updateFogRadius');
  check('找得到 updateFogRadius', from >= 0);
  const after = mainSrc.slice(from);
  const method = after.slice(0, after.indexOf('\n  }'));
  check(
    '访问 chunkRenderer 之前先确认它在（构造早期还没建）',
    method.includes('!this.chunkRenderer'),
    '缺少守卫会在开世界第一帧崩',
  );
  check('守卫在前、读 queueLength 在后', method.indexOf('!this.chunkRenderer') < method.indexOf('queueLength'));
}

// ---------------------------------------------------------------- 11. 远裁面必须罩得住天空

console.log('\n[远裁面罩得住天空层（"屏幕正中那个圆洞"的来源）]');
{
  // ⚠️ 这一条对应用户实际看到的现象："视角正中有一个很明显的圆形边缘，
  // 白天偏白、平视时偏暗"。根因：穹顶半径 180 且**球心就在相机上**，
  // 而远裁面原本按"视距×16+32"算 —— 视距 8 时只有 160，正前方那块天空被裁掉，
  // 露出的是 scene.background 的纯色（周围才是穹顶渐变）。
  // 桌面视距 12 得 224，本来就罩得住，所以它只在小视距（手机）下出现。
  for (const vd of [4, 5, 6, 8, 12, 16]) {
    check(
      `视距 ${vd}：远裁面罩得住天空层`,
      cameraFarFor(vd) > SKY_MAX_RADIUS,
      `${cameraFarFor(vd)} > ${SKY_MAX_RADIUS}`,
    );
  }
  equal('视距 12（桌面）仍由地形那一式决定，不引入回归', cameraFarFor(12), 12 * 16 + 32);
  equal('视距 16 同样不回归', cameraFarFor(16), 16 * 16 + 32);
  equal('小视距时由"罩住天空"那一式兜底', cameraFarFor(4), SKY_MAX_RADIUS + 32);
  check('日月（150）也在范围内', cameraFarFor(6) > 150, `${cameraFarFor(6)}`);
  // 近裁面 0.25 格：既要**不裁到身边的面**（玩家站在方块边界时最近面约 0.5 格），
  // 又要比桌面习惯的 0.1 大，否则抬它就没有意义
  check('近裁面不裁到身边的面（< 半格）', CAMERA_NEAR < 0.5, `near ${CAMERA_NEAR}`);
  check('近裁面确实比原来的 0.1 更远（精度更高）', CAMERA_NEAR > 0.1, `near ${CAMERA_NEAR}`);
}

// ---------------------------------------------------------------- 帧内分段计时（批次 205）

console.log('\n[帧内分段计时]');
{
  // 这张报表要回答的是："卡在 CPU 还是 GPU"——判据是 `total` 与真实帧间距的关系，
  // 所以每一处除法都不能出 NaN / 负数。
  const empty = new FramePhaseMeter().take();
  equal('没跑过帧时 frames = 0（不是 NaN）', empty.frames, 0);
  equal('没跑过帧时 total = 0', empty.total, 0);
  equal('没跑过帧时报表是空对象', Object.keys(empty.avg).length, 0);

  const meter = new FramePhaseMeter();
  for (let i = 0; i < 4; i++) {
    meter.add('sim', 2);
    meter.add('render', 6.5);
    meter.endFrame();
  }
  const report = meter.take();
  equal('统计了 4 帧', report.frames, 4);
  equal('每帧平均：sim 2ms', report.avg.sim, 2);
  equal('每帧平均：render 6.5ms', report.avg.render, 6.5);
  equal('总计是各段之和（8.5ms）', report.total, 8.5);

  const after = meter.take();
  equal('取走之后清零（不会把上一个窗口算进来）', after.frames, 0);

  // 脏数据：负数 / NaN / Infinity 一律丢掉，且**不能影响分母**
  const dirty = new FramePhaseMeter();
  dirty.add('sim', -100);
  dirty.add('sim', Number.NaN);
  dirty.add('render', Number.POSITIVE_INFINITY);
  dirty.add('render', 4);
  dirty.endFrame();
  const cleaned = dirty.take();
  equal('脏数据被丢掉，只留合法的 4ms', cleaned.avg.render, 4);
  check('负的那一段干脆不出现（不是 0）', !('sim' in cleaned.avg));

  // 漏记分段的帧仍然计一帧：否则平均值会被系统性放大
  const partial = new FramePhaseMeter();
  partial.add('sim', 10);
  partial.endFrame();
  partial.endFrame();
  equal('只记了一段的帧 + 一帧空跑 → 平均 5ms', partial.take().avg.sim, 5);
}

// ---------------------------------------------------------------- 视野上限（批次 215）

console.log('\n[视野封顶]');
{
  // FOV 也是"同屏要画多少"的乘数（60°→110° ≈ 1.73 倍可视范围），而自适应管不到它，
  // 所以只能封上限。批次 521：用户要求范围 45~90，桌面上限也不再放宽。
  equal('手机视野上限 90°', fovCapFor(true), MOBILE_FOV_MAX);
  equal('桌面视野上限 90°（批次 521 起与手机同一条）', fovCapFor(false), FOV_MAX);
  equal('手机与桌面共用同一条上限', MOBILE_FOV_MAX, FOV_MAX);
  equal('下限是 45°（给晕动症玩家）', FOV_MIN, 45);

  equal('老存档里的 110 在手机上被夹到 90', clampFovFor(110, true), MOBILE_FOV_MAX);
  equal('桌面上 110 也被夹到 90', clampFovFor(110, false), 90);
  equal('小视野在手机上不被抬高', clampFovFor(70, true), 70);
  equal('60° 原样保留（新的默认值）', clampFovFor(60, false), 60);
  equal('44° 被抬到下限', clampFovFor(44, false), 45);

  // 脏值：0 / 负数 / NaN 都会让投影矩阵退化（画面全黑或倒过来）
  equal('0 回退到下限', clampFovFor(0, false), FOV_MIN);
  equal('负数回退到下限', clampFovFor(-30, true), FOV_MIN);
  equal('NaN 回退到上限', clampFovFor(Number.NaN, true), MOBILE_FOV_MAX);
  equal('超大的值被夹到上限', clampFovFor(999, false), FOV_MAX);
}

// ---------------------------------------------------------------- CPU-bound：别再糊了（批次 283）

console.log('\n[CPU 卡住时不再降分辨率]');
{
  // 真机日志：视距到 4、装饰到 2 之后，策略又连降三档分辨率（1.0 → 0.75），
  // 帧时间 21.9 → 22.7 → 21.3 —— 一点没变，近处却只剩 25% 像素。
  // 因为瓶颈在 CPU（光照 BFS），降分辨率只省填充率。
  const stuck: PerfState = {
    ...initialPerfState(VIEW_DISTANCE_MIN),
    // 稳态：平滑帧时间已经跟到 23ms（> FRAME_TIME_DROP），不是刚掉帧那一瞬间
    frameTimeAvg: 23,
    viewDistance: VIEW_DISTANCE_MIN,
    decorLevel: DECOR_LEVEL_MAX,
    resolutionScale: 0.9,
  };

  const stepOnce = (cpuBound: boolean, frameMs = 23): { action: string; state: PerfState } => {
    let current = stuck;
    let action = '';
    for (let t = 0; t < 6; t += 1 / 60) {
      const step = perfPolicyStep(current, 1 / 60, frameMs, MOBILE, cpuBound);
      current = step.state;
      if (step.action) {
        action = step.action;
        break;
      }
    }
    return { action, state: current };
  };

  const gpu = stepOnce(false);
  equal('GPU 卡：视距/装饰到底之后仍然降分辨率（老行为）', gpu.action, 'resolution-down');
  check('GPU 卡：降到了 0.8', Math.abs(gpu.state.resolutionScale - 0.8) < 1e-9, String(gpu.state.resolutionScale));

  const cpu = stepOnce(true);
  equal('CPU 卡：不再降分辨率（降了也不省 CPU）', cpu.action, '');
  check('CPU 卡：分辨率保持 0.9', Math.abs(cpu.state.resolutionScale - 0.9) < 1e-9, String(cpu.state.resolutionScale));
}

console.log('\n[CPU 卡但没继续恶化：把分辨率还回去]');
{
  // 0.75 档、帧时间 20ms：> FRAME_TIME_RAISE(17) 所以"没有余量"，< 22 所以也不降档。
  // 老逻辑永远停在这里（"糊着还卡"）；而分辨率本来就不吃 CPU，应该还回去。
  const state: PerfState = {
    ...initialPerfState(VIEW_DISTANCE_MIN),
    frameTimeAvg: 20,
    viewDistance: VIEW_DISTANCE_MIN,
    decorLevel: DECOR_LEVEL_MAX,
    resolutionScale: MOBILE_RESOLUTION_MIN,
  };

  const firstAction = (cpuBound: boolean): { action: string; state: PerfState } => {
    let current = state;
    let action = '';
    for (let t = 0; t < 12; t += 1 / 60) {
      const step = perfPolicyStep(current, 1 / 60, 20, MOBILE, cpuBound);
      current = step.state;
      if (step.action) {
        action = step.action;
        break;
      }
    }
    return { action, state: current };
  };

  equal('GPU 卡：卡在"不升不降"区间，保持 0.75', firstAction(false).action, '');
  const cpu = firstAction(true);
  equal('CPU 卡：把分辨率还回一档（近处清晰优先）', cpu.action, 'resolution-up');
  // ⚠️ 从地板 0.75 加上 0.1 再 `round1` 会得到 0.9（`Math.round(8.5) = 9`），
  // 这是既有的取整口径（见降档那一处的注释），这里只断言"确实还回去了"。
  check('还回后高于 0.75（近处恢复清晰）', cpu.state.resolutionScale > MOBILE_RESOLUTION_MIN, String(cpu.state.resolutionScale));
}

console.log('\n[空闲降帧（批次 20261031-0055）]');
{
  const still = { position: { x: 1, y: 2, z: 3 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
  const idle = new IdleFrameRate();
  idle.afterRender(0, still);
  check('刚画完一帧：不降', idle.capFor(100, false) === 0);
  check('静止超过阈值：降到上限', idle.capFor(IDLE_AFTER_MS + 1, false) === IDLE_MAX_FPS);
  check('世界在加载：不降', idle.capFor(IDLE_AFTER_MS + 1, true) === 0);
  idle.noteInput(5000);
  check('有输入：立刻恢复', idle.capFor(5001, false) === 0);
  idle.pointerDown(6000);
  check('手指按住不放（挖方块）：一直不降', idle.capFor(60000, false) === 0);
  idle.pointerUp(60000);
  check('松手后静止超过阈值：降', idle.capFor(60000 + IDLE_AFTER_MS + 1, false) === IDLE_MAX_FPS);
  idle.afterRender(70000, { position: { x: 1, y: 1.5, z: 3 }, quaternion: still.quaternion });
  check('相机在动（坠落 / 载具）：不降', idle.capFor(70001, false) === 0);
  idle.afterRender(70040, { position: { x: 1, y: 1.5, z: 3 }, quaternion: still.quaternion });
  check('相机停下后静止超过阈值：降', idle.capFor(70040 + IDLE_AFTER_MS + 1, false) === IDLE_MAX_FPS);
  idle.pointerDown(80000);
  idle.resetPointers();
  check('失焦清掉按住状态', idle.capFor(80000 + IDLE_AFTER_MS + 1, false) === IDLE_MAX_FPS);
  const main = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  check('空闲帧不喂自适应降档', /if \(!paused && !idleFrame\)/.test(main));
}

console.log(`\n降级策略测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
