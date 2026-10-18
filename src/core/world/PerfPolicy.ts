/**
 * 移动端降级策略（TASKS N7，批次 130）
 *
 * 手机长时间游玩会发热降频，帧率掉下去之后如果什么都不做只会越来越卡。
 * 批次 96 的 N6 先做了**自适应视距**，批次 130 把策略收进这个模块并补上另外几个旋钮。
 *
 * ## 掉帧时先牺牲什么（批次 158 反转过一次）
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
 * 批次 158 之前是 0.8（"先预折一点，掉帧时再继续降"）。既然降级顺序改成视距优先，
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
export const DECOR_DROP_COOLDOWN = 4;
export const DECOR_RAISE_COOLDOWN = 8;

/** 一次调整做了什么（给主程序打日志、给测试断言） */
export type PerfAction =
  | 'resolution-down'
  | 'resolution-up'
  | 'view-down'
  | 'view-up'
  | 'decor-down'
  | 'decor-up'
  | null;

/**
 * **装饰层档位**：0 = 全开、1 = 关掉"远处与天上的"、2 = 再关掉"瞬时的"。
 *
 * 它插在"视距"与"分辨率"之间，是因为这三者的代价/观感排序很明确：
 *  - 视距：只影响远处（且远处本来就在雾里），最先让；
 *  - 装饰层：云在天上、粒子是一瞬、远处的牌子本来就看不见字 —— **近处一点都不变**；
 *  - 分辨率：全局生效，会把近处一起糊掉，最后才动。
 *
 * ⚠️ 这一档**没有**对应的设置开关：它关的东西玩家几乎察觉不到，
 * 不值得占一个设置项（粒子仍然尊重设置里那个 `particles`）。
 */
export type DecorLevel = 0 | 1 | 2;
export const DECOR_LEVEL_MAX: DecorLevel = 2;

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
  /** 当前装饰层档位（0 全开 ~ 2 最省，见 `DecorLevel`） */
  decorLevel: DecorLevel;
  /** 距离下一次可以调档还有多久（秒） */
  cooldown: number;
}

/** 初值：分辨率 1.0（= 原来那套行为，不引入回归）、装饰层全开、视距取玩家设定值 */
export function initialPerfState(viewDistance: number): PerfState {
  return {
    frameTimeAvg: 16.7,
    resolutionScale: RESOLUTION_MAX,
    viewDistance,
    decorLevel: 0,
    cooldown: 0,
  };
}

/** 装饰层档位 → 云还画不画。云是一层 900×900 的双面半透明面，且从不参与视锥剔除 */
export function decorCloudsVisible(decor: DecorLevel): boolean {
  return decor === 0;
}

/**
 * 装饰层档位 → 粒子硬上限（再与玩家设置取小，设置仍然是"最严的那个"）。
 *
 * 档位 2 直接给 0：粒子是全屏散的小方块、带透明混合，爆量时（下雨 + 打怪 + 挖矿）
 * 正是最卡的那一刻，而"没有粒子"玩家几乎不会察觉。
 */
export function decorParticleBudget(setting: 'off' | 'reduced' | 'all', decor: DecorLevel): number {
  const base = particleBudgetFor(setting);
  if (decor >= 2) return 0;
  if (decor === 1) return Math.min(base, particleBudgetFor('reduced'));
  return base;
}

/**
 * 装饰层档位 → 雨/雪的密度比例（1 = 全部 3200 个点精灵）。
 *
 * 雨点是 `transparent + depthWrite:false` 的 `Points`，密度直接等于 overdraw；
 * 减半之后"雨变小了"几乎看不出来，但省掉一半的透明填充。
 */
export function decorRainFraction(decor: DecorLevel): number {
  if (decor >= 2) return 0.25;
  if (decor === 1) return 0.5;
  return 1;
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
    // 第二顺位：**关装饰层**（云 / 粒子 / 雨量）——它们都不在近处，砍掉几乎无感。
    // ⚠️ 门控复用 `adaptiveViewDistance`：装饰层与视距同属"让出远处"那一族，
    // 玩家关掉"自适应视距"的意思就是"别自动替我省远景"，不该再冒出一个新的开关。
    if (tuning.adaptiveViewDistance && next.decorLevel < DECOR_LEVEL_MAX) {
      next.decorLevel = (next.decorLevel + 1) as DecorLevel;
      next.cooldown = DECOR_DROP_COOLDOWN;
      return { state: next, action: 'decor-down' };
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
    // 倒着来的第二顺位：把装饰层还回来（云与粒子回来了，近处观感才算完整）。
    // 门控与降档那侧同一个（见上面的说明）
    if (tuning.adaptiveViewDistance && next.decorLevel > 0) {
      next.decorLevel = (next.decorLevel - 1) as DecorLevel;
      next.cooldown = DECOR_RAISE_COOLDOWN;
      return { state: next, action: 'decor-up' };
    }
    if (tuning.adaptiveViewDistance && next.viewDistance < tuning.viewDistanceCap) {
      next.viewDistance += 1;
      next.cooldown = VIEW_DISTANCE_RAISE_COOLDOWN;
      return { state: next, action: 'view-up' };
    }
  }
  return { state: next, action: null };
}

// ---------------------------------------------------------------- 雾的平滑

/**
 * 雾半径的**收缩**速率（区块/秒）。
 *
 * 视距变小（掉帧被降级、或玩家自己调小）时，雾要**立刻**涌上来。快，是因为
 * 随后被卸载的那一圈必须"已经在雾里"——慢一步玩家就看见地形突然少一圈。
 */
export const FOG_SHRINK_CHUNKS_PER_SEC = 4;
/**
 * 雾半径的**扩张**速率（区块/秒），刻意比收缩慢得多。
 *
 * 视距变大时先发区块请求，等那一圈真的画好了雾才推过去——新地形于是"从雾里浮出来"，
 * 而不是在空地上一块块长出来。
 */
export const FOG_GROW_CHUNKS_PER_SEC = 1.2;
/**
 * 扩张时最多等"远处区块就绪"多久（秒）。
 *
 * ⚠️ 这个兜底必须有：玩家一直在挖方块时网格队列几乎永远非空，只认就绪的话雾会
 * **永远**推不出去，表现为"视距变大了但画面一直灰蒙蒙"。
 */
export const FOG_GROW_WAIT_LIMIT = 5;

/**
 * 雾半径朝目标推进一步（纯函数，可离线断言）。
 *
 * 为什么抽出来：视距是**整数**、一跳就是一整圈（16 格），而雾是连续量。让连续量
 * **滞后于**离散量，"视距变了"在画面上就从"跳一格"变成"雾涌上来 / 雾散开"——
 * 而"收缩快、扩张慢且要等就绪"这几条不对称的规则，写在主循环里只能靠眼睛看。
 *
 * @param ready 目标那一圈的区块是否已经画好（为 false 时扩张会被挡住，但有等待上限）
 * @param waited 已经等了多久（秒），由调用方存着并回传
 */
export function fogRadiusStep(
  current: number,
  target: number,
  dt: number,
  ready: boolean,
  waited: number,
): { radius: number; waited: number } {
  // 0 = 还没初始化（第一帧直接对齐），dt<=0 = 只是"重算一次"、不推进动画
  if (current <= 0) return { radius: target, waited };
  if (dt <= 0) return { radius: current, waited };

  const diff = target - current;
  if (Math.abs(diff) < 1e-3) return { radius: target, waited: 0 };

  if (diff < 0) {
    return { radius: Math.max(target, current - FOG_SHRINK_CHUNKS_PER_SEC * dt), waited: 0 };
  }

  const nextWaited = ready ? 0 : waited + dt;
  if (!ready && nextWaited < FOG_GROW_WAIT_LIMIT) return { radius: current, waited: nextWaited };
  return { radius: Math.min(target, current + FOG_GROW_CHUNKS_PER_SEC * dt), waited: nextWaited };
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

// ---------------------------------------------------------------- 帧内分段计时

/** 一次采样窗口的分段报告（毫秒，都是**每帧平均**） */
export interface PhaseReport {
  /** 这个窗口里统计了多少帧（0 = 没跑过） */
  frames: number;
  /** 每段每帧平均毫秒（顺序按名字，数值保留 1 位小数） */
  avg: Record<string, number>;
  /** 所有段之和（每帧平均）：与真实帧间距一比就知道是 CPU 还是 GPU 在拖 */
  total: number;
}

/**
 * 帧内分段时间桶（批次 205，纯诊断）。
 *
 * 由来：真机日志能看出"60 帧 → 20 帧 → 9 帧"，但看不出**时间花在哪一段**。
 * 掉帧可能是 CPU（物理/实体/网格化/光照/tick）也可能是 GPU（填充率/驱动），
 * 而这两种的修法完全相反。有了分段计时，判据就一句话：
 * **`total` 明显小于真实帧间距 → 卡在 GPU（或浏览器合成）；`total` 基本等于帧间距 → 卡在 CPU。**
 *
 * 为什么做成一个只有累加/取走的小类：
 *  - 每帧要调 6~8 次，必须是"加一个数"这种开销（不能分配对象、不能 stringify）；
 *  - "每 5 秒取一次并清零"这件事的边界（除零、负数、小数位）能离线断言，
 *    写在主循环里只能靠眼睛看。
 */
export class FramePhaseMeter {
  private readonly totals = new Map<string, number>();
  private frames = 0;

  /**
   * 记一段耗时。
   *
   * ⚠️ 负数与 NaN 一律丢掉：这里喂的是 `performance.now()` 的差值，
   * 理论上不会为负，但计时器精度回退/运行环境差异出现过，而**一条脏数据就能把
   * 一张报表毁掉**（其它段全变成 0.x 都很正常，只有它跳到 -1e9）。
   */
  add(phase: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.totals.set(phase, (this.totals.get(phase) ?? 0) + ms);
  }

  /** 这一帧走完了（分母 +1）。分段漏记也照样计一帧，否则平均值会被系统性放大 */
  endFrame(): void {
    this.frames++;
  }

  /** 取走并清零。窗口内一帧都没跑过时返回 `frames: 0` 与空报表（不是 NaN） */
  take(): PhaseReport {
    const avg: Record<string, number> = {};
    let total = 0;
    if (this.frames > 0) {
      for (const [phase, ms] of this.totals) {
        const value = ms / this.frames;
        avg[phase] = round1(value);
        total += value;
      }
    }
    this.totals.clear();
    const frames = this.frames;
    this.frames = 0;
    return { frames, avg, total: round1(total) };
  }
}
