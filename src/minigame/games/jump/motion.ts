/**
 * 跳一跳的**动画时序与缓动**（批次 20261024-0415，`[跳7]`）
 *
 * 手感的一半在时序里：原版一跳 400ms、上升占 65%（Cubic.Out）、下落占 35%（Cubic.In），
 * 空中空翻 360°（Sinusoidal.InOut），落地压缩 100ms，被踩的方块回弹 500ms，
 * 新方块入场 400ms Bounce.Out。这些数字来自 `.continue/notes/jump-original.md` §8。
 *
 * 为什么单独一个文件、且全是纯函数：
 *
 *  · 时序错了在截图里看不出来（截图是静止的），只能靠"某个时刻的高度/角度应该是多少"来断言；
 *  · 缓动函数写错（把 cubicOut 写成 cubicIn）在画面上只是"看着有点怪"，肉眼很容易放过；
 *  · 400ms 是**总时长**，与跳多远无关——旧实现 `0.3 + 距离 × 0.045` 让远跳更慢，
 *    与"原版一跳 400ms"直接冲突，而且手感会飘。
 */

export const JUMP_TIMING = {
  /** 一次跳跃的总时长（毫秒） */
  totalMs: 400,
  /** 上升段占比（其余为下落段） */
  riseRatio: 0.65,
  /** 落地压缩恢复时长 */
  landSquashMs: 100,
  /** 被踩方块的 NBC 回弹时长 */
  blockBounceMs: 500,
  /** 新方块入场弹入时长 */
  enterMs: 400,
  /** 完美命中的同心圆波纹时长 */
  rippleMs: 600,
  /** 旧方块掉落消失时长 */
  fadeMs: 400,
} as const;

/** 落地时身体压到多少（规格表 §8：s 0.8→1） */
export const LAND_SQUASH = 0.8;
/** 被踩方块先被压到多少，再弹回 1 */
export const BLOCK_DENT = 0.85;
/** 新方块入场从多小开始 */
export const ENTER_SCALE = 0.6;

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

/** 慢进快出（起步慢、到点最快）——下落段用它 */
export function cubicIn(p: number): number {
  const t = clamp01(p);
  return t * t * t;
}

/** 快进慢出（起步快、到点停住）——上升段用它 */
export function cubicOut(p: number): number {
  const t = clamp01(p);
  return 1 - (1 - t) ** 3;
}

/** 两端都慢、中间快（空翻用它，起跳与落地都不突兀） */
export function sinusInOut(p: number): number {
  return -(Math.cos(Math.PI * clamp01(p)) - 1) / 2;
}

/**
 * 标准 Bounce.Out：落地弹几下收敛到 1。
 *
 * 常数是 Penner 的经典取值（1/2.75 = 0.3636…），末段 7.5625 的三次方构成三次弹跳。
 */
export function bounceOut(p: number): number {
  const t = clamp01(p);
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) {
    const u = t - 1.5 / d;
    return n * u * u + 0.75;
  }
  if (t < 2.5 / d) {
    const u = t - 2.25 / d;
    return n * u * u + 0.9375;
  }
  const u = t - 2.625 / d;
  return n * u * u + 0.984375;
}

/**
 * 跳跃弧线的**高度因子**（0 → 1 → 0）。
 *
 * 上升段只占 65% 的时间却要升到峰值，所以上升必须"前快后慢"（Cubic.Out）；
 * 下落段 35% 从峰值落回地面，是"前慢后快"（Cubic.In，像被重力拽下去）。
 * 两段在峰值处的斜率都是 0，所以顶点不会有折角。
 */
export function jumpArc(progress: number): number {
  const t = clamp01(progress);
  const rise = JUMP_TIMING.riseRatio;
  if (t <= rise) return cubicOut(t / rise);
  return 1 - cubicIn((t - rise) / (1 - rise));
}

/** 空翻进度（0~1，Sinusoidal.InOut）：乘 ±2π 就是那一转的角度 */
export function flipProgress(progress: number): number {
  return sinusInOut(progress);
}

/**
 * 落地后的身体压缩量（`JumperModel.setSquash` 的单位：0 = 站直、1 = 最扁）。
 *
 * `ms` 是**距离落地过去了多少毫秒**：0 时压到 `LAND_SQUASH`（0.8 身高），
 * `landSquashMs` 之后回 0。用 cubicOut 恢复 = 先快速弹回、再慢慢定住。
 */
export function landingSquash(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return (1 - LAND_SQUASH) / (1 - 0.6);
  const t = clamp01(ms / JUMP_TIMING.landSquashMs);
  return ((1 - LAND_SQUASH) / (1 - 0.6)) * (1 - cubicOut(t));
}

/** 被踩方块的竖向缩放（1 → 凹 → 回弹 → 1） */
export function blockBounceScale(ms: number): number {
  const t = clamp01(ms / JUMP_TIMING.blockBounceMs);
  return BLOCK_DENT + (1 - BLOCK_DENT) * bounceOut(t);
}

/** 新方块入场缩放（0.6 → 弹一下 → 1） */
export function enterScale(ms: number): number {
  const t = clamp01(ms / JUMP_TIMING.enterMs);
  return ENTER_SCALE + (1 - ENTER_SCALE) * bounceOut(t);
}

/** 旧方块掉落消失（1 → 0，向下同时缩小） */
export function fadeScale(ms: number): number {
  return 1 - cubicIn(ms / JUMP_TIMING.fadeMs);
}

/** 波纹进度（0~1），渲染层用它算半径与透明度 */
export function rippleProgress(ms: number): number {
  return clamp01(ms / JUMP_TIMING.rippleMs);
}
