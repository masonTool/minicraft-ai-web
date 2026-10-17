/**
 * 移动端降级策略（TASKS N7，批次 130）
 *
 * 手机长时间游玩会发热降频，帧率掉下去之后如果什么都不做只会越来越卡。
 * 批次 96 的 N6 先做了**自适应视距**（那一段写在 `main.updateAdaptiveViewDistance` 里），
 * 这一批把策略收进这个模块，并补上另外三个旋钮：
 *
 *  1. **动态分辨率**：掉帧时先把渲染分辨率降下来（0.5~1.0 倍）。它排在最前面——
 *     因为"画面糊一点"比"视距短一截"更难被察觉，而省下的开销一样多（填充率）；
 *  2. **自适应视距**（N6）：分辨率已经降到地板（0.5）之后才继续降视距；
 *  3. **限帧**：`maxFps` 只决定"这一帧该不该跳过"（见 `frameIntervalMs`），
 *     省的是 GPU 与电池，不改变画面；
 *  4. **粒子总量**：按画质档给一个**硬上限**（`particleBudgetFor`）。
 *     ⚠️ 与设置里那个"粒子强度"（`ParticleLevel`，控制**每次生成多少颗**）是两回事：
 *     那一条管"每次撒多少"，这一条管"场上最多同时存在多少"——下雨 + 打怪 +
 *     挖矿一起发生时，只有前者挡不住爆量。
 *
 * ## 为什么抽成纯模块
 *
 * N6 那套迟滞控制**写在主循环里**，只能靠 `perf-acceptance.js` 在浏览器里跑七秒才看得到，
 * 而且"先降哪个、降到哪一档"这类**优先级**问题它测不出来。抽出来之后：
 * 每个档位、每次升降、每一条优先级都能离线断言（`test:perfpolicy`）。
 *
 * ⚠️ 与原版/与直觉的两处取舍：
 *  - **分辨率只降不升过 1.0**：不做"帧有余量就超采样到 1.5"——那会让"刚好卡在阈值上"的
 *    设备慢慢爬到 1.5（画面几乎没变化、开销涨到 2.25 倍），而手机最怕的就是这种隐性开销；
 *  - **降档比升档急**：降是 3 秒一次、升是 8~10 秒一次（原版 N6 的视距也是这么定的）。
 */

/** 渲染分辨率倍率的范围：0.5（最糊、最省）~ 1.0（基准，等于 CSS 像素） */
export const RESOLUTION_MIN = 0.5;
export const RESOLUTION_MAX = 1;
/** 每次调档的步长 */
export const RESOLUTION_STEP = 0.1;
/** 视距的地板（再低就没法玩了，与 N6 一致） */
export const VIEW_DISTANCE_MIN = 4;

/** 帧时间超过它就算"卡"（毫秒，约 45fps）→ 降档 */
export const FRAME_TIME_DROP = 22;
/** 帧时间低于它就算"有余量"（约 59fps）→ 升档 */
export const FRAME_TIME_RAISE = 17;
/** 帧时间滑动平均的平滑系数：约 20 帧的时间常数，半秒内的抖动会被抹平 */
export const FRAME_TIME_SMOOTHING = 0.05;

/** 各种动作的冷却（秒）：降档快、升档慢（避免在阈值上抖来抖去） */
export const RESOLUTION_DROP_COOLDOWN = 3;
export const RESOLUTION_RAISE_COOLDOWN = 10;
export const VIEW_DISTANCE_DROP_COOLDOWN = 4;
export const VIEW_DISTANCE_RAISE_COOLDOWN = 8;

/** 一次调整做了什么（给主程序打日志、给测试断言） */
export type PerfAction = 'resolution-down' | 'resolution-up' | 'view-down' | 'view-up' | null;

/** 玩家侧的两个开关 + 视距上限（都在 `SettingsScreen.GameSettings` 里） */
export interface PerfTuning {
  adaptiveResolution: boolean;
  adaptiveViewDistance: boolean;
  /** 玩家设定的视距（自适应只在这个值以下活动） */
  viewDistanceCap: number;
}

export interface PerfState {
  /** 帧时间滑动平均（毫秒）——界面与验收脚本读它 */
  frameTimeAvg: number;
  /** 当前渲染分辨率倍率（0.5~1） */
  resolutionScale: number;
  /** 当前视距（区块） */
  viewDistance: number;
  /** 距离下一次可以调档还有多久（秒） */
  cooldown: number;
}

/** 初值：分辨率 1.0（= 原来那套行为，不引入回归）、视距取玩家设定值 */
export function initialPerfState(viewDistance: number): PerfState {
  return { frameTimeAvg: 16.7, resolutionScale: RESOLUTION_MAX, viewDistance, cooldown: 0 };
}

/**
 * 动态分辨率是“设备原生背板”的倍率，不是直接传给 three 的绝对 pixelRatio。
 *
 * 例如 DPR=3 的手机以 2 作为画质上限：0.9 档应当得到 1.8，而不是从 2 突然跳到 0.9。
 * 后一种旧写法会在第一次掉帧时把横纵清晰度各砍掉一半以上，表现为整屏闪一下并持续发虚。
 */
export function effectivePixelRatio(devicePixelRatio: number, resolutionScale: number): number {
  const base = Math.min(2, Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
  const scale = Math.min(RESOLUTION_MAX, Math.max(RESOLUTION_MIN, resolutionScale));
  return base * scale;
}

/**
 * 推进一步（每帧调用）。
 *
 * @param state 当前状态（函数**不改它**，返回新的）
 * @param dt 秒
 * @param frameTimeMs 这一帧的真实耗时（毫秒）。`main.simulateFrameTime` 会把
 *        它固定成一个高值，用来在浏览器里复现"掉帧"
 */
export function perfPolicyStep(
  state: PerfState,
  dt: number,
  frameTimeMs: number,
  tuning: PerfTuning,
): { state: PerfState; action: PerfAction } {
  const frameTimeAvg = state.frameTimeAvg + (frameTimeMs - state.frameTimeAvg) * FRAME_TIME_SMOOTHING;
  const cooldown = Math.max(0, state.cooldown - dt);
  const next: PerfState = { ...state, frameTimeAvg, cooldown };
  if (cooldown > 0) return { state: next, action: null };

  const dropping = frameTimeAvg > FRAME_TIME_DROP;
  const hasRoom = frameTimeAvg < FRAME_TIME_RAISE;

  // ---- 降档：先降分辨率（最不易察觉），它到底了才降视距
  if (dropping) {
    if (tuning.adaptiveResolution && next.resolutionScale > RESOLUTION_MIN) {
      next.resolutionScale = round1(Math.max(RESOLUTION_MIN, next.resolutionScale - RESOLUTION_STEP));
      next.cooldown = RESOLUTION_DROP_COOLDOWN;
      return { state: next, action: 'resolution-down' };
    }
    if (tuning.adaptiveViewDistance && next.viewDistance > VIEW_DISTANCE_MIN) {
      next.viewDistance -= 1;
      next.cooldown = VIEW_DISTANCE_DROP_COOLDOWN;
      return { state: next, action: 'view-down' };
    }
    return { state: next, action: null };
  }

  // ---- 升档：**反过来**——先把视距还回去（那更显眼），最后才把分辨率升满
  if (hasRoom) {
    if (tuning.adaptiveViewDistance && next.viewDistance < tuning.viewDistanceCap) {
      next.viewDistance += 1;
      next.cooldown = VIEW_DISTANCE_RAISE_COOLDOWN;
      return { state: next, action: 'view-up' };
    }
    if (tuning.adaptiveResolution && next.resolutionScale < RESOLUTION_MAX) {
      next.resolutionScale = round1(Math.min(RESOLUTION_MAX, next.resolutionScale + RESOLUTION_STEP));
      next.cooldown = RESOLUTION_RAISE_COOLDOWN;
      return { state: next, action: 'resolution-up' };
    }
  }
  return { state: next, action: null };
}

/**
 * 限帧：这一帧该不该跳过（毫秒）。
 *
 * `maxFps <= 0` 表示不限帧（返回 0）。⚠️ 限帧**不改变画面**，它省的是 GPU 与电池——
 * 手机上"能跑 60 但只给 30"通常比"忽快忽慢"更省电，玩家也更容易接受。
 */
export function frameIntervalMs(maxFps: number): number {
  if (!Number.isFinite(maxFps) || maxFps <= 0) return 0;
  return Math.round(1000 / maxFps);
}

/** 画质档对应的**粒子硬上限**（场上同时存在的粒子上限） */
export function particleBudgetFor(level: 'off' | 'reduced' | 'all'): number {
  if (level === 'off') return 0;
  if (level === 'reduced') return 120;
  return 400;
}

/** 保留一位小数（浮点累减会出现 0.6000000000000001 这种值，界面与断言都不好看） */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
