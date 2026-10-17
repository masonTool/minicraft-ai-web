/**
 * 移动端降级策略（TASKS N7，批次 130）
 *
 * 手机长时间游玩会发热降频，帧率掉下去之后如果什么都不做只会越来越卡。
 * 批次 96 的 N6 先做了**自适应视距**，批次 130 把策略收进这个模块并补上另外几个旋钮。
 *
 * ## 掉帧时先牺牲什么（批次 157 反转过一次）
 *
 * 批次 130 定的是"**先降分辨率、再降视距**"，理由是"画面糊一点比视距短一截更难被察觉"。
 * 这条判断在**手机上不成立**，而且理由很具体：
 *
 *  - **分辨率是全局的**：降它等于把近处一起糊掉——玩家手上的方块、脚下的地面先糊，
 *    而玩家真正盯着看的永远是近处；
 *  - **视距只影响远处**，而远处本来就在雾里（雾距跟着视距走，见 `main.applyEnvironment`），
 *    收短一截几乎看不出来。
 *
 * 所以掉帧时改成：
 *
 *  1. **先收视距**（手机上只在 4~8 之间活动，见 `viewDistanceCapFor`）；
 *  2. 视距到地板之后才动分辨率，而且手机只到 **0.75**（`MOBILE_RESOLUTION_MIN`）——
 *     0.5 那一档近处已经没法看了，留作桌面上的最后手段；
 *  3. 有余量时**严格倒着还**：先把分辨率还满（近处清晰优先），最后才放视距。
 *
 * 另外两个旋钮：
 *  - **限帧**：`maxFps` 只决定"这一帧该不该跳过"（见 `frameIntervalMs`），
 *    省的是 GPU 与电池，不改变画面；
 *  - **粒子总量**：按画质档给一个**硬上限**（`particleBudgetFor`）。
 *    ⚠️ 与设置里那个"粒子强度"（`ParticleLevel`，控制**每次生成多少颗**）是两回事：
 *    那一条管"每次撒多少"，这一条管"场上最多同时存在多少"——下雨 + 打怪 +
 *    挖矿一起发生时，只有前者挡不住爆量。
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
/**
 * 背板像素比上限。
 *
 * 桌面视网膜画到 2 倍没问题。手机 DPR 经常是 3，若沿用 2 倍，
 * 一块 844×390 的横屏要填大约 130 万像素——再叠上方块场景，帧时间会直接超过 30ms。
 * 手机上限 1.5：满档大约只有 2 倍档的一半像素，开局再乘 0.8，先落在能玩的填充率上。
 */
export const DESKTOP_PIXEL_RATIO_CAP = 2;
export const MOBILE_PIXEL_RATIO_CAP = 1.5;
/**
 * 手机开局分辨率档（相对背板上限）。
 *
 * 批次 157 之前是 0.8（"先预折一点，掉帧时再继续降"）。既然降级顺序改成视距优先，
 * 开局就不该先打折了——**近处清晰优先**，压力交给视距（手机开局只有 6 区块）。
 * 这个值现在是 1.0，保留常量是为了将来要调时只有一处。
 */
export const MOBILE_INITIAL_RESOLUTION = 1;
/** 手机开局视距。上限另有一个更小的数（见 `MOBILE_VIEW_DISTANCE_MAX`）。 */
export const MOBILE_VIEW_DISTANCE = 6;
/**
 * **手机的动态视距上限**。
 *
 * 手机屏幕小（横屏典型 844×390），FOV 72° 下 8 区块 = 128 格外的东西在屏幕上只有几个像素，
 * 展示了也看不清，却要付出 289 个区块的 draw call。所以手机不跟桌面共用 12。
 * ⚠️ 玩家设置的视距**仍然生效**，只是被这个上限夹住（`viewDistanceCapFor`）：
 * 想更近就把滑块往左拖，拖到 16 也不会超过 8。
 */
export const MOBILE_VIEW_DISTANCE_MAX = 8;
/** 视距滑杆的上限（与设置界面那颗滑块一致，见 `SettingsScreen`） */
export const VIEW_DISTANCE_MAX = 16;
/** 每次调档的步长 */
export const RESOLUTION_STEP = 0.1;
/** 视距的地板（再低就没法玩了，与 N6 一致） */
export const VIEW_DISTANCE_MIN = 4;
/**
 * 手机上的分辨率地板。
 *
 * 桌面那档 0.5 在手机上等于把近处一起糊掉（DPR 3 的机器只剩下物理屏的 6% 像素），
 * 而分辨率是这一批的**最后手段**（视距与装饰层都让完了才轮到它），
 * 所以手机停在 0.75：还能看出是"糊了一点"，不至于"看不清手里拿的是什么"。
 */
export const MOBILE_RESOLUTION_MIN = 0.75;

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

/** 玩家侧的两个开关 + 两个上限（都在 `SettingsScreen.GameSettings` 里或由设备决定） */
export interface PerfTuning {
  adaptiveResolution: boolean;
  adaptiveViewDistance: boolean;
  /** 自适应视距的上限（手机上已经过 `viewDistanceCapFor` 夹过） */
  viewDistanceCap: number;
  /**
   * 分辨率降到底能降到多少。
   *
   * 手机传 `MOBILE_RESOLUTION_MIN`（0.75），桌面传 `RESOLUTION_MIN`（0.5）。
   * 抽成字段而不是在函数里判设备，是因为"地板在哪一档"是**策略**而不是设备查询，
   * 策略就该能被离线断言（`test:perfpolicy`）。
   */
  resolutionFloor: number;
}

/**
 * 自适应的视距上限：手机另有一个更小的上限。
 *
 * 抽成纯函数的原因与这个模块里其它东西一样——"手机上到底封到几"要能被断言。
 * 玩家把滑块拖到 16 也不会超过手机上限（往左拖仍然有效，那是玩家自己的选择）。
 */
export function viewDistanceCapFor(playerSetting: number, mobile: boolean): number {
  const raw = Number.isFinite(playerSetting) ? Math.floor(playerSetting) : VIEW_DISTANCE_MAX;
  const cap = Math.min(raw, mobile ? MOBILE_VIEW_DISTANCE_MAX : VIEW_DISTANCE_MAX);
  return Math.max(VIEW_DISTANCE_MIN, cap);
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
export function effectivePixelRatio(
  devicePixelRatio: number,
  resolutionScale: number,
  pixelRatioCap = DESKTOP_PIXEL_RATIO_CAP,
): number {
  const cap = Math.min(
    DESKTOP_PIXEL_RATIO_CAP,
    Math.max(1, Number.isFinite(pixelRatioCap) ? pixelRatioCap : DESKTOP_PIXEL_RATIO_CAP),
  );
  const base = Math.min(cap, Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
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
  // 分辨率地板由调用方给（手机 0.75 / 桌面 0.5），再夹一次防止传进非法值
  const floor = Math.min(RESOLUTION_MAX, Math.max(RESOLUTION_MIN, tuning.resolutionFloor));

  // ---- 降档：**先收视距**（远处本来就在雾里，砍掉最不心疼），视距到地板才动分辨率
  if (dropping) {
    if (tuning.adaptiveViewDistance && next.viewDistance > VIEW_DISTANCE_MIN) {
      next.viewDistance -= 1;
      next.cooldown = VIEW_DISTANCE_DROP_COOLDOWN;
      return { state: next, action: 'view-down' };
    }
    if (tuning.adaptiveResolution && next.resolutionScale > floor) {
      // ⚠️ 顺序是"先取整、再夹地板"，不能反过来：
      // `round1(Math.max(floor, ...))` 会把 0.75 再喂给 `round1`，而 `Math.round(7.5)` = 8
      // ——于是最后一档永远落不到 0.75，表现为"每 3 秒降一次、画面却不再变化"。
      // 地板不必落在 0.1 的步长网格上，所以只能由夹紧这一步决定。
      next.resolutionScale = Math.max(floor, round1(next.resolutionScale - RESOLUTION_STEP));
      next.cooldown = RESOLUTION_DROP_COOLDOWN;
      return { state: next, action: 'resolution-down' };
    }
    return { state: next, action: null };
  }

  // ---- 升档：**严格倒着来**——先把分辨率还满（近处清晰优先），最后才放视距
  if (hasRoom) {
    if (tuning.adaptiveResolution && next.resolutionScale < RESOLUTION_MAX) {
      // 与降档同一条规矩：先取整、再夹上限（见降档那一处的说明）
      next.resolutionScale = Math.min(RESOLUTION_MAX, round1(next.resolutionScale + RESOLUTION_STEP));
      next.cooldown = RESOLUTION_RAISE_COOLDOWN;
      return { state: next, action: 'resolution-up' };
    }
    if (tuning.adaptiveViewDistance && next.viewDistance < tuning.viewDistanceCap) {
      next.viewDistance += 1;
      next.cooldown = VIEW_DISTANCE_RAISE_COOLDOWN;
      return { state: next, action: 'view-up' };
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
