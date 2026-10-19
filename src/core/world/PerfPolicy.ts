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
 * 背板像素比上限（批次 216：手机 1.5 → 2）。
 *
 * 用户的原话是"画质不要降低；性能吃紧时第一保帧率、第二保画质，视野可以让"。
 * 真机日志（792×360 / DPR 3）里 `res` 恒为 1、`pixelRatio` 恒为 1.5 —— 也就是
 * **一直在 1/2 线性分辨率上渲染**，而 UI 是 DPR 3 的 DOM，于是"物品边缘发虚"。
 * 手机上限抬到 2 之后：满档填充率约 0.89M 像素（1.5 档是 0.64M，多 1.78 倍），
 * 而省下来的开销由**视距**付——这正是用户愿意让的那一项。
 *
 * ⚠️ 真的扛不住时，分辨率仍然是最后一道：策略顺序没变
 * （视距 → 装饰层 → 分辨率），手机地板 0.75 档 = 1.5 倍，正好是这一批之前的画质。
 */
export const DESKTOP_PIXEL_RATIO_CAP = 2;
export const MOBILE_PIXEL_RATIO_CAP = 2;
/**
 * 手机开局分辨率档（相对背板上限）。
 *
 * 批次 158 之前是 0.8（"先预折一点，掉帧时再继续降"）。既然降级顺序改成视距优先，
 * 开局就不该先打折了——**近处清晰优先**，压力交给视距。
 * 这个值现在是 1.0，保留常量是为了将来要调时只有一处。
 */
export const MOBILE_INITIAL_RESOLUTION = 1;
/** 手机开局视距。上限另有一个更小的数（见 `MOBILE_VIEW_DISTANCE_MAX`）。 */
export const MOBILE_VIEW_DISTANCE = 5;
/**
 * **手机的动态视距上限**（批次 216：8 → 6）。
 *
 * 手机屏幕小（横屏典型 844×390），FOV 72° 下 8 区块 = 128 格外的东西在屏幕上只有几个像素，
 * 展示了也看不清，却要付出 289 个区块的 draw call。所以手机不跟桌面共用 12。
 *
 * 批次 216 再收到 6：真机日志里 `drawn` 225（视距 8）时 CPU 侧 `render` 段要 9~21ms，
 * 而 177（视距 7）只要 8~11ms —— **每收一格省的是实打实的提交开销**。
 * 用户的取舍很明确："可以牺牲视野，先保帧率、再保画质"，所以 8 → 6 省下的预算
 * 全部给了背板倍率（见 `MOBILE_PIXEL_RATIO_CAP`）。
 * ⚠️ 玩家设置的视距**仍然生效**，只是被这个上限夹住（`viewDistanceCapFor`）。
 */
export const MOBILE_VIEW_DISTANCE_MAX = 6;
/** 视距滑杆的上限（与设置界面那颗滑块一致，见 `SettingsScreen`） */
export const VIEW_DISTANCE_MAX = 16;
/**
 * 手机上的视野（FOV）上限（批次 215）。
 *
 * FOV 不是视距，但它同样决定"同屏要画多少"：72° → 110° 时水平可视范围约翻一倍
 * （`tan(55°)/tan(36°) ≈ 1.97`），视锥里能进的区块网格与三角形也跟着翻。
 * 手机屏幕小、离眼近，超过 90° 的"更广"几乎看不出来，却要实打实多画一圈——
 * 而这一项**自适应管不到**（策略只动视距/装饰层/分辨率），所以只能封上限，
 * 并在设置里写一行说明（见 `SettingsScreen`，批次 215）。
 */
export const MOBILE_FOV_MAX = 90;
/** 视野的通用上限（桌面）与下限，与设置界面那颗滑块一致 */
export const FOV_MAX = 110;
export const FOV_MIN = 60;
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

/**
 * CPU 段占总帧时间的比例超过它，就认为"这一帧卡在 CPU"（批次 283）。
 *
 * 判据来自 `FramePhaseMeter`：`cpu ≈ frameMs` 是 CPU 卡（光照/网格/实体），
 * `cpu ≪ frameMs` 是 GPU/合成卡。两者的修法**相反**：
 *  - CPU 卡：降分辨率毫无帮助（它只省填充率），只会把近处糊掉；
 *  - GPU 卡：降分辨率才是有用的那一步。
 *
 * 真机日志（792×360 / Adreno 829）里 `cpu` 16~18ms、帧间距 21~22ms → 占比 0.8，
 * 而策略当时已经把分辨率从 1.0 降到 0.75，帧时间**一点没变**（21.9 → 22.7 → 21.3）。
 */
export const CPU_BOUND_RATIO = 0.7;

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

/**
 * **同一档视距反复掉帧时，把它封多久**（秒，批次 216）。
 *
 * 真机日志（2026-10-18，792×360 / DPR 3）里最响的一条线索：13 分钟里
 * `view-down` / `view-up` 各出现 **40 多次**，全是 7 ↩ 8 之间的来回：
 * 视距 8 时 `frameAvg` 22~29ms（→ 判"卡"，降 7），视距 7 时 16.6ms（→ 判"有余量"，升 8）。
 * 而 16.6ms 是 60Hz 的**刷新下限**——只要满帧就必然 `< FRAME_TIME_RAISE`，
 * 所以"升档条件"在任何一台能跑满 60 的机器上永远成立，光靠冷却时间挡不住。
 *
 * 真正的毛病是：**从 8 降到 7 之后拿到 60fps，是降档起了作用，不是"8 也行"的证据**。
 *
 * 规则：**同一档第二次**降档时把它封 90 秒（第一次可能是 GC / 区块上传的长帧，
 * 而且开局加载期 frameAvg 本来就高，不该把视距锁死在低位）；封禁到期允许再试一次
 * ——世界会变：走出雨林 / 雨停了 / 生物散了。
 * 每次换视距都要按新范围重算一圈区块，这条规则把这份抖动从"每 8 秒一次"压到"每 90 秒一次"。
 */
export const VIEW_RAISE_BLOCK_SECONDS = 90;

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

/** 这台设备的视野上限（见 `MOBILE_FOV_MAX`）：手机 90、桌面 110 */
export function fovCapFor(mobile: boolean): number {
  return mobile ? MOBILE_FOV_MAX : FOV_MAX;
}

/**
 * 把任意来源的视野夹进这台设备的合法区间（批次 215）。
 *
 * 三个来源都会进来：老存档里存着的 110、设置界面那颗滑块、`DEFAULT_SETTINGS`。
 * ⚠️ 下限也一起夹：0 或负数会让相机的投影矩阵退化成一条线（画面全黑），
 * 而这种脏值最容易从一段"手改过的 localStorage"里冒出来。
 */
export function clampFovFor(fov: number, mobile: boolean): number {
  const value = Number.isFinite(fov) ? fov : FOV_MAX;
  return Math.min(fovCapFor(mobile), Math.max(FOV_MIN, value));
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
  /**
   * 上一次是**从哪一档**降下来的（批次 216），例如 8 = 刚从 8 降到 7。
   * 与 `blockedSeconds` 一起判断"这一档是不是反复掉帧"。
   */
  lastDropFrom: number | null;
  /**
   * 视距封禁还剩多少秒（批次 216）。
   *
   * 只在**同一档第二次掉帧**时启动：第一次掉帧可能只是一次 GC / 区块上传的长帧，
   * 不该让开局那一轮（加载期 frameAvg 本来就高）把视距锁死在低位。
   */
  blockedSeconds: number;
}

/** 初值：分辨率 1.0（= 原来那套行为，不引入回归）、装饰层全开、视距取玩家设定值 */
export function initialPerfState(viewDistance: number): PerfState {
  return {
    frameTimeAvg: 16.7,
    resolutionScale: RESOLUTION_MAX,
    viewDistance,
    decorLevel: 0,
    cooldown: 0,
    lastDropFrom: null,
    blockedSeconds: 0,
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
 * @param cpuBound 是否"卡在 CPU"（`cpu 段 / 帧时间 ≥ CPU_BOUND_RATIO`）。
 *        默认 false = 按老规矩办（GPU 卡的可能性更大），这样老测试与老行为不变。
 */
export function perfPolicyStep(
  state: PerfState,
  dt: number,
  frameTimeMs: number,
  tuning: PerfTuning,
  cpuBound = false,
): { state: PerfState; action: PerfAction } {
  const frameTimeAvg = state.frameTimeAvg + (frameTimeMs - state.frameTimeAvg) * FRAME_TIME_SMOOTHING;
  const cooldown = Math.max(0, state.cooldown - dt);
  // 封禁计时**不受调档冷却影响**：冷却只有几秒，封禁要几十秒，必须各走各的
  const blockedSeconds = Math.max(0, state.blockedSeconds - dt);
  const next: PerfState = { ...state, frameTimeAvg, cooldown, blockedSeconds };
  if (cooldown > 0) return { state: next, action: null };

  const dropping = frameTimeAvg > FRAME_TIME_DROP;
  const hasRoom = frameTimeAvg < FRAME_TIME_RAISE;
  // 分辨率地板由调用方给（手机 0.75 / 桌面 0.5），再夹一次防止传进非法值
  const floor = Math.min(RESOLUTION_MAX, Math.max(RESOLUTION_MIN, tuning.resolutionFloor));

  // ---- 降档：**先收视距**（远处本来就在雾里，砍掉最不心疼），视距到地板才动分辨率
  if (dropping) {
    if (tuning.adaptiveViewDistance && next.viewDistance > VIEW_DISTANCE_MIN) {
      // 把"刚离开的这一档"记下来（批次 216，见 `VIEW_RAISE_BLOCK_SECONDS`）：
      // 降到这一档之后拿到满帧，是**降档起了作用**，不是"刚才那一档也行"的证据。
      // 只有**同一档第二次**掉帧才真的封——第一次可能只是一次长帧。
      if (state.lastDropFrom === next.viewDistance) next.blockedSeconds = VIEW_RAISE_BLOCK_SECONDS;
      next.lastDropFrom = next.viewDistance;
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
      // CPU 卡的时候降分辨率**没用**（批次 283）：它只省填充率，不减光照/网格/实体。
      // 真机日志就是这么糊掉的：视距到 4、装饰到 2 之后又连降三档，
      // 帧时间 21.9 → 22.7 → 21.3 —— 一点没变，近处却只剩 25% 像素。
      // 这里就停手：宁可保持在 0.75 以上清楚，也不再为"无效的降档"付画质。
      if (cpuBound) return { state: next, action: null };
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
  //
  // CPU-bound 时分辨率**不吃 CPU**（它只影响填充率），所以即便帧时间还没降到
  // `FRAME_TIME_RAISE` 以下，也可以把它还回去：这是"糊着还卡"唯一的出口。
  const canRestoreResolution = hasRoom || (cpuBound && frameTimeAvg <= FRAME_TIME_DROP);
  if (canRestoreResolution) {
    if (tuning.adaptiveResolution && next.resolutionScale < RESOLUTION_MAX) {
      // 与降档同一条规矩：先取整、再夹上限（见降档那一处的说明）
      next.resolutionScale = Math.min(RESOLUTION_MAX, round1(next.resolutionScale + RESOLUTION_STEP));
      next.cooldown = RESOLUTION_RAISE_COOLDOWN;
      return { state: next, action: 'resolution-up' };
    }
  }
  if (hasRoom) {
    // 倒着来的第二顺位：把装饰层还回来（云与粒子回来了，近处观感才算完整）。
    // 门控与降档那侧同一个（见上面的说明）
    if (tuning.adaptiveViewDistance && next.decorLevel > 0) {
      next.decorLevel = (next.decorLevel - 1) as DecorLevel;
      next.cooldown = DECOR_RAISE_COOLDOWN;
      return { state: next, action: 'decor-up' };
    }
    if (tuning.adaptiveViewDistance && next.viewDistance < tuning.viewDistanceCap) {
      // 刚因为这档反复掉过帧：封禁期内不试（批次 216）。
      // 不设冷却，封禁到期后下一帧自然就会重新考虑
      if (next.viewDistance + 1 === next.lastDropFrom && next.blockedSeconds > 0) {
        return { state: next, action: null };
      }
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
