/**
 * 钓鱼的**规则**（批次 81，G11）
 *
 * 收在这里的东西有一个共同点：**它们都是"时间"或者"数"**——
 * 抛出去要飞多久、要等几个 tick、咬钩之后有几秒可以收杆、附魔各减多少。
 * 浮标怎么飞、水在哪一格、鱼给不给，这些要世界的能力，留在主程序里。
 *
 * 状态机只有四态：
 *
 * ```
 *   idle ──cast──▶ flying ──落水──▶ waiting ──等够了──▶ biting ──收杆──▶ idle
 *                    │                                    │
 *                    └──撞到方块/飞太远──▶ idle            └──超时（鱼跑了）──▶ idle
 * ```
 *
 * ⚠️ 与原版的差异（都写进 TASKS B12 旁边的 G11 条目）：
 *  - 咬钩窗口取 **2 秒**（原版是 `nibble` 那一组 tick，量级接近但没逐位对齐）；
 *  - 等待时间取"`random(100,600)` tick − 诱饵 × 100 tick、下限 20 tick"（与原版同式），
 *    但**没有**做原版那套"雨天才有的额外加成"（`K11` 的降水刻还没接进来）。
 */

/** 咬钩之后的收杆窗口（秒）：这段时间内收杆才算钓上来 */
export const BITE_WINDOW_SECONDS = 2;

/** 等待时间的上下限（tick；原版 `random(100, 600)`） */
export const MIN_WAIT_TICKS = 100;
export const MAX_WAIT_TICKS = 600;

/** 诱饵每级减多少 tick（原版 100 tick = 5 秒） */
export const LURE_TICKS_PER_LEVEL = 100;

/** 等再久也至少留 1 秒（原版也是这个下限，不然 3 级诱饵会变成"秒咬"） */
export const FLOOR_WAIT_TICKS = 20;

/**
 * 浮标的初速与重力（格/秒、格/秒²）。
 *
 * 与投掷物（雪球/鸡蛋/药水）**同一组数**：那套数值已经在真机上校过手感，
 * 这里再发明一组只会让"丢东西"和"抛竿"两件事看着不像同一个游戏。
 */
export const CAST_SPEED = 30;
export const CAST_GRAVITY = 12;

/** 浮标最远飞多少格就自己收回来（原版约 32 格；不设上限的话能飞过整个海洋） */
export const MAX_CAST_DISTANCE = 33;

export type FishingPhase = 'idle' | 'flying' | 'waiting' | 'biting';

export interface FishingState {
  readonly phase: FishingPhase;
  /** 当前阶段的计时（秒） */
  readonly timer: number;
  /** `waiting` 阶段要等多久才咬钩（秒） */
  readonly waitFor: number;
}

/** 没在钓鱼 */
export const IDLE_FISHING: FishingState = { phase: 'idle', timer: 0, waitFor: 0 };

/** 从钓竿上读出两条与钓鱼有关的附魔 */
export interface FishingBonuses {
  /** 诱饵：每级少等 5 秒 */
  lure: number;
  /** 海之眷顾：改池子权重 */
  luck: number;
}

export function fishingBonuses(enchants?: Readonly<Record<string, number>>): FishingBonuses {
  const level = (id: string): number => {
    const value = enchants?.[id];
    return typeof value === 'number' && value > 0 ? Math.floor(value) : 0;
  };
  return { lure: level('lure'), luck: level('luck_of_the_sea') };
}

/**
 * 这一次要等多久（秒）。原版式子：`nextInt(100, 600) − 诱饵 × 100`。
 *
 * `random()` 必须注入（离线才能把"3 级诱饵会不会低于下限"钉住）。
 */
export function waitSecondsFor(random: () => number, lure = 0): number {
  const span = MAX_WAIT_TICKS - MIN_WAIT_TICKS + 1;
  const ticks = MIN_WAIT_TICKS + Math.floor(random() * span) - Math.max(0, Math.floor(lure)) * LURE_TICKS_PER_LEVEL;
  return Math.max(FLOOR_WAIT_TICKS, ticks) / 20;
}

/** 抛出方向（与弓/投掷物同一套 yaw/pitch 约定） */
export function castVelocity(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch * CAST_SPEED,
    y: Math.sin(pitch) * CAST_SPEED,
    z: -Math.cos(yaw) * cosPitch * CAST_SPEED,
  };
}

/** 抛竿：进入 `flying` */
export function beginCast(random: () => number, lure = 0): FishingState {
  return { phase: 'flying', timer: 0, waitFor: waitSecondsFor(random, lure) };
}

/**
 * 浮标这一帧"落在哪"。
 *
 * `'blocked'` 是**两个原因合成的一档**：撞到方块、以及飞出去超过 `MAX_CAST_DISTANCE`
 * ——两者的后果一样（这一竿不成立、浮标收回来），合起来状态机就少一条分支。
 * 判断位置与距离要世界的能力，所以那两个判断在主程序里。
 */
export type FishingLanding = 'water' | 'blocked' | null;

/**
 * 推进一步。
 *
 * 主程序负责判断浮标这一帧落在哪，这里只负责**状态怎么走**。
 */
export function advanceFishing(state: FishingState, dt: number, landing: FishingLanding): FishingState {
  if (state.phase === 'idle') return state;
  const timer = state.timer + dt;

  if (state.phase === 'flying') {
    if (landing === 'blocked') return IDLE_FISHING;
    if (landing === 'water') return { phase: 'waiting', timer: 0, waitFor: state.waitFor };
    return { ...state, timer };
  }

  if (state.phase === 'waiting') {
    if (timer >= state.waitFor) return { phase: 'biting', timer: 0, waitFor: state.waitFor };
    return { ...state, timer };
  }

  // biting：窗口过了鱼就跑了
  if (timer >= BITE_WINDOW_SECONDS) return IDLE_FISHING;
  return { ...state, timer };
}

/** 收杆：只有 `biting` 才算钓上来（其余情况只是把浮标收回来） */
export function reelFishing(state: FishingState): { caught: boolean; next: FishingState } {
  return { caught: state.phase === 'biting', next: IDLE_FISHING };
}
