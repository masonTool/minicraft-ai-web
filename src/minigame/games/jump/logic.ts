/**
 * 跳一跳的**规则**（J0，批次 20261022-2220）
 *
 * 纯逻辑：不碰渲染、不碰 DOM、不碰计时。给它一局状态和一个蓄力距离，
 * 它告诉你"落在哪、得几分、这局结束没有"。
 *
 * 六条口径（都有离线断言守着）：
 *
 *  1. **方向自动对准下一个方块**：玩家只控制距离（一个自由度）。方向在
 *     `−30° / 0° / +30°` 三选一，落点判定仍在方块局部坐标里做（轴对齐）。
 *  2. **蓄力→距离线性**：`d = t / maxCharge × maxDistance`，不做缓动——
 *     玩家要靠"按多久"估算距离，曲线越直越好预测。
 *  3. **可达性由生成器保证**：间距上限永远 ≤ `maxDistance − reachMargin`。
 *     难度只抬下限与缩方块，不会生成"理论跳不到"的格子。
 *  4. **中心判定用比例**：距方块中心 ≤ 半边长 × `centerRatio`。这样方块变小时
 *     中心圈也跟着变小，手感与原版一致。
 *  5. **连击只认连续中心**：第 n 次得 `2n` 分，封顶 32；落到非中心立刻重置。
 *  6. **随机是确定性的**：自带 mulberry32（同 seed 同序列）。否则"生成器不产生
 *     不可达间距"这种断言只能靠跑一万次碰运气。
 */

import { JUMP_CONFIG } from './config.ts';

export type JumpBlockKind = 'normal' | 'music' | 'cube';

export interface JumpBlock {
  readonly id: number;
  /** 方块中心（格子坐标，与渲染层同一口径） */
  readonly x: number;
  readonly z: number;
  /** 边长（格） */
  readonly size: number;
  readonly kind: JumpBlockKind;
}

export type JumpStatus = 'playing' | 'over';

export interface JumpRun {
  /** 已生成的方块；`blocks[index]` 是当前站着的那个 */
  readonly blocks: readonly JumpBlock[];
  readonly index: number;
  readonly score: number;
  /** 已连续命中中心的次数（0 = 下一跳命中中心只 +2） */
  readonly combo: number;
  readonly status: JumpStatus;
  /** 随机数状态（下次生成从这里继续） */
  readonly seed: number;
}

export interface LandingOutcome {
  readonly run: JumpRun;
  readonly center: boolean;
  readonly points: number;
  readonly over: boolean;
}

// ------------------------------------------------------------------ 随机

/**
 * mulberry32 的一步：给定状态返回 `[0,1)` 的值与下一步的状态。
 *
 * 不用 `Math.random`：断言"同 seed 同序列"与"间距永远可达"需要一个可重放的序列。
 */
export function nextRandom(seed: number): { value: number; seed: number } {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, seed: (seed + 0x6d2b79f5) | 0 };
}

// ------------------------------------------------------------------ 难度曲线

/** 0~1 的进度：分数越高越接近 1，到 `shrinkScore` 封顶 */
function progressOf(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.min(1, score / JUMP_CONFIG.shrinkScore);
}

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** 当前分数下新方块的边长 */
export function blockSizeForScore(score: number): number {
  return mix(JUMP_CONFIG.blockSizeStart, JUMP_CONFIG.blockSizeMin, progressOf(score));
}

/** 间距上限的硬天花板：再难也不能超过"蓄满能跳的距离" */
export function maxReachableGap(): number {
  return JUMP_CONFIG.maxDistance - JUMP_CONFIG.reachMargin;
}

/** 当前分数下的间距范围（`to` 已被可达性夹住，`from ≤ to` 恒成立） */
export function gapRangeForScore(score: number): { from: number; to: number } {
  const t = progressOf(score);
  const gapFrom = mix(JUMP_CONFIG.gapMinStart, JUMP_CONFIG.gapMinEnd, t);
  const gapTo = Math.min(mix(JUMP_CONFIG.gapMaxStart, JUMP_CONFIG.gapMaxEnd, t), maxReachableGap());
  // 理论上参数怎么配都不会出现 from > to，但夹一下更安全（配置被人手改成倒挂时不会生成倒着跳）
  return { from: Math.min(gapFrom, gapTo), to: gapTo };
}

/** 在间距范围内按 `rand` 取一个值 */
export function gapForScore(score: number, rand: number): number {
  const { from, to } = gapRangeForScore(score);
  const t = Math.min(1, Math.max(0, Number.isFinite(rand) ? rand : 0));
  return from + (to - from) * t;
}

// ------------------------------------------------------------------ 蓄力

/** 蓄力时长（秒）→ 跳跃距离（格） */
export function distanceForCharge(seconds: number): number {
  const raw = Number.isFinite(seconds) ? seconds : 0;
  const clamped = Math.min(JUMP_CONFIG.maxCharge, Math.max(0, raw));
  return (clamped / JUMP_CONFIG.maxCharge) * JUMP_CONFIG.maxDistance;
}

// ------------------------------------------------------------------ 生成

/**
 * 生成下一个方块。
 *
 * 坐标系：`0°` 是正前方 `-Z`；`+30°` 偏右（`-X`），`-30°` 偏左（`+X`）。
 * 与渲染层的相机约定见 `notes/jump-game.md` §2（横屏左下 → 右上）。
 */
export function nextBlock(
  current: JumpBlock,
  score: number,
  seed: number,
): { block: JumpBlock; seed: number } {
  const r1 = nextRandom(seed);
  const degrees = JUMP_CONFIG.directionDegrees;
  const dirIndex = Math.min(degrees.length - 1, Math.floor(r1.value * degrees.length));
  const angle = (degrees[dirIndex]! * Math.PI) / 180;

  const r2 = nextRandom(r1.seed);
  const gap = gapForScore(score, r2.value);

  const r3 = nextRandom(r2.seed);
  const kind = specialKindFor(score, r3.value, current.kind);

  return {
    block: {
      id: current.id + 1,
      // base = (0, -1)，绕 Y 轴转 angle：x' = -sin(angle)，z' = -cos(angle)
      x: current.x - Math.sin(angle) * gap,
      z: current.z - Math.cos(angle) * gap,
      size: blockSizeForScore(score),
      kind,
    },
    seed: r3.seed,
  };
}

/**
 * 这一格要不要做成特殊方块。
 *
 * 三条约束：分数门槛前不出现、不连续两个特殊方块（否则容易连吃两次奖励）、
 * 概率命中后按 `rand` 在音乐盒 / 魔方之间二选一。
 */
export function specialKindFor(score: number, rand: number, previousKind: JumpBlockKind): JumpBlockKind {
  if (score < JUMP_CONFIG.specialAfterScore) return 'normal';
  if (previousKind !== 'normal') return 'normal';
  if (rand >= JUMP_CONFIG.specialChance) return 'normal';
  const t = JUMP_CONFIG.specialChance > 0 ? rand / JUMP_CONFIG.specialChance : 1;
  return t < 0.6 ? 'music' : 'cube';
}

/** 特殊方块停留奖励（0 = 普通方块） */
export function specialBonus(kind: JumpBlockKind): number {
  if (kind === 'music') return JUMP_CONFIG.specialMusicBonus;
  if (kind === 'cube') return JUMP_CONFIG.specialCubeBonus;
  return 0;
}

/** 追加一个方块（内部：保证 `blocks[index + 1]` 永远存在） */
function appendBlock(run: JumpRun): JumpRun {
  const current = run.blocks[run.blocks.length - 1];
  if (!current) return run;
  const { block, seed } = nextBlock(current, run.score, run.seed);
  return { ...run, blocks: [...run.blocks, block], seed };
}

/** 新开一局：起点方块在原点，另预生成一个可跳目标 */
export function createRun(seed = 1): JumpRun {
  const first: JumpBlock = {
    id: 0,
    x: 0,
    z: 0,
    size: JUMP_CONFIG.blockSizeStart,
    kind: 'normal',
  };
  return appendBlock({
    blocks: [first],
    index: 0,
    score: 0,
    combo: 0,
    status: 'playing',
    seed,
  });
}

// ------------------------------------------------------------------ 落点与计分

/**
 * 落点判定。
 *
 * 方向自动对准 `to` 的中心，所以落点必定在"从 from 中心到 to 中心"这条线上；
 * 但判定仍按方块局部坐标做（轴对齐的两个分量都查），这样角度偏移不会让
 * "看起来在方块上"却判 miss。
 */
export function resolveLanding(
  from: JumpBlock,
  to: JumpBlock,
  distance: number,
): { kind: 'hit'; center: boolean } | { kind: 'miss' } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 0)) return { kind: 'miss' };

  const d = Math.min(JUMP_CONFIG.maxDistance, Math.max(0, Number.isFinite(distance) ? distance : 0));
  const px = from.x + (dx / length) * d;
  const pz = from.z + (dz / length) * d;

  const half = to.size / 2;
  if (Math.abs(px - to.x) > half || Math.abs(pz - to.z) > half) return { kind: 'miss' };

  const offCenter = Math.hypot(px - to.x, pz - to.z);
  return { kind: 'hit', center: offCenter <= half * JUMP_CONFIG.centerRatio };
}

/**
 * 计分（纯函数）：非中心 +1 且断连击；中心按 `2n` 递增、封顶 32。
 *
 * 返回新的 `combo`，调用方直接写回 `JumpRun`——不要把"加分"和"连击状态"
 * 拆到两个地方维护，否则重开一局时最容易漏掉清零。
 */
export function scoreForLanding(combo: number, center: boolean): { points: number; combo: number } {
  if (!center) return { points: 1, combo: 0 };
  const next = Math.max(0, Math.floor(Number.isFinite(combo) ? combo : 0)) + 1;
  return {
    points: Math.min(JUMP_CONFIG.comboMax, JUMP_CONFIG.comboStep * next),
    combo: next,
  };
}

/** 跳一次：判定 → 计分 → 生成下一个方块（失败则整局结束） */
export function jump(run: JumpRun, distance: number): LandingOutcome {
  if (run.status !== 'playing') return { run, center: false, points: 0, over: true };

  const from = run.blocks[run.index];
  const to = run.blocks[run.index + 1];
  if (!from || !to) return { run, center: false, points: 0, over: true };

  const landing = resolveLanding(from, to, distance);
  if (landing.kind === 'miss') {
    return { run: { ...run, status: 'over' }, center: false, points: 0, over: true };
  }

  const scored = scoreForLanding(run.combo, landing.center);
  const next = appendBlock({
    ...run,
    index: run.index + 1,
    score: run.score + scored.points,
    combo: scored.combo,
  });

  return { run: next, center: landing.center, points: scored.points, over: false };
}

/** 当前站着的方块 / 下一个目标（渲染层与判定都用这两个） */
export function currentBlock(run: JumpRun): JumpBlock {
  return run.blocks[run.index]!;
}

export function targetBlock(run: JumpRun): JumpBlock {
  return run.blocks[run.index + 1]!;
}
