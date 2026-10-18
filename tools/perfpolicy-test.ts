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
import { SKY_MAX_RADIUS, cameraFarFor } from '../src/render/Sky.ts';

import {
  LIGHT_BUDGET_PER_FRAME,
  MOBILE_LIGHT_BUDGET_PER_FRAME,
  MOBILE_STARTUP_LIGHT_BUDGET_PER_FRAME,
  STARTUP_LIGHT_BUDGET_PER_FRAME,
  lightBudgetForFrame,
} from '../src/game/tuning.ts';
import {
  DECOR_LEVEL_MAX,
  FRAME_TIME_DROP,
  RESOLUTION_MAX,
  RESOLUTION_MIN,
  VIEW_DISTANCE_MIN,
  MOBILE_INITIAL_RESOLUTION,
  MOBILE_PIXEL_RATIO_CAP,
  MOBILE_RESOLUTION_MIN,
  MOBILE_VIEW_DISTANCE_MAX,
  FramePhaseMeter,
  decorCloudsVisible,
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

console.log('\n[动态分辨率按设备背板缩放]');
{
  equal('桌面 DPR 1 × 满分辨率 = 1', effectivePixelRatio(1, 1), 1);
  equal('手机 DPR 3 夹到 2 × 满分辨率 = 2', effectivePixelRatio(3, 1), 2);
  equal('手机降到 0.9 档是 1.8（不会从 2 突然跳成 0.9）', effectivePixelRatio(3, 0.9), 1.8);
  equal('最低档仍保留 1 倍 CSS 像素', effectivePixelRatio(3, 0.5), 1);
  equal('非法 DPR 回退为 1', effectivePixelRatio(Number.NaN, 1), 1);
  equal('手机背板上限 1.5，不再画到 2', effectivePixelRatio(3, 1, MOBILE_PIXEL_RATIO_CAP), 1.5);
  equal(
    '手机开局不再预折：1.0 档直接给到背板上限 1.5（近处清晰优先）',
    effectivePixelRatio(3, MOBILE_INITIAL_RESOLUTION, MOBILE_PIXEL_RATIO_CAP),
    1.5,
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
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
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

console.log(`\n降级策略测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
