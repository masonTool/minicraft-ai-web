/**
 * 跳一跳的**规则**（J0 起，批次 20261024-1331 重调难度）
 *
 * 纯逻辑：不碰渲染、不碰 DOM、不碰计时。给它一局状态和一个蓄力距离，
 * 它告诉你"落在哪、得几分、这局结束没有"。
 *
 * 六条口径（都有离线断言守着）：
 *
 *  1. **方向自动对准下一个方块**：玩家只控制距离（一个自由度）。方向在
 *     `0° / 90°` 两选一（等距两向），落点判定仍在方块局部坐标里做。
 *  2. **蓄力→距离线性**：`d = t / maxCharge × maxDistance`，不做缓动——
 *     玩家要靠"按多久"估算距离，曲线越直越好预测。
 *  3. **可达性由生成器保证**：中心距上限永远 ≤ `maxDistance − reachMargin`，
 *     并且"从上一块最靠后的落脚点起跳"也够得着下一块中心。难度只抬间距、缩方块，
 *     不会生成"理论跳不到"的格子。
 *  4. **中心判定用比例**：距方块中心 ≤ 半边长 × `centerRatio`。这样方块变小时
 *     中心圈也跟着变小，手感与原版一致。
 *  5. **连击只认连续中心**：第 n 次得 `2n` 分，封顶 32；落到非中心立刻重置。
 *  6. **随机是确定性的**：自带 mulberry32（同 seed 同序列）。否则"生成器不产生
 *     不可达间距"这种断言只能靠跑一万次碰运气。
 */

import { JUMP_CONFIG } from './config.ts';

/**
 * 方块种类：普通 + 原版的四类特殊方块（井盖 5 / 魔方 10 / 便利店 15 / 音乐盒 30）。
 *
 * 特殊方块只影响"停留 3 秒给多少分"，不影响跳跃判定——所以它可以是纯表现层的东西，
 * 但奖励必须写在规则里（否则断言只能靠截图数飘字）。
 */
export type JumpBlockKind = 'normal' | 'well' | 'cube' | 'store' | 'music';

/**
 * 底座形状：方形 / 圆形。
 *
 * 圆形是**内切圆**（半径 = 边长 / 2），有效面积只有方形的 π/4 ≈ 78.5%——
 * 这是刻意的：同一边长下圆形更难站，才不会让"换个形状"变成纯装饰。
 * 判定必须跟着形状走（方形看轴对齐、圆形看欧氏距离），否则画圆判方。
 */
export type JumpBlockShape = 'square' | 'round';

export interface JumpBlock {
  readonly id: number;
  /** 方块中心（格子坐标，与渲染层同一口径） */
  readonly x: number;
  readonly z: number;
  /** 边长（格）；方形 = 边长，圆形 = 直径 */
  readonly size: number;
  readonly kind: JumpBlockKind;
  readonly shape: JumpBlockShape;
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
  /**
   * 小人脚底的**实际落点**（世界 xz，格）。
   *
   * 落到哪儿就站哪儿：下一跳从这里起跳，距离也量到这里，不再悄悄复位到方块中心。
   * 判定中心仍然按方块中心（`centerRatio`），所以"站偏了"只影响距离，不影响是否命中。
   */
  readonly stand: { readonly x: number; readonly z: number };
}

export interface LandingOutcome {
  readonly run: JumpRun;
  readonly center: boolean;
  readonly points: number;
  readonly over: boolean;
  /** 三档判定：`topple` 与 `miss` 都结束这一局，只有倒下动画不同 */
  readonly kind: LandingKind;
  /** 脚底落点（世界 xz）：场景据此把小人的站姿摆在"落下去的那个点"，不回中心 */
  readonly point: { readonly x: number; readonly z: number };
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

/** 0~1 的进度：分数越高越接近 1，到 `cap` 分封顶 */
function progressToward(score: number, cap: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.min(1, score / Math.max(1, cap));
}

/** 0~1 的进度：分数越高越接近 1，到 `shrinkScore` 封顶 */
function progressOf(score: number): number {
  return progressToward(score, JUMP_CONFIG.shrinkScore);
}

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** 当前分数下新方块的边长（曲线值，不含 ±6% 抖动） */
export function blockSizeForScore(score: number): number {
  return mix(JUMP_CONFIG.blockSizeStart, JUMP_CONFIG.blockSizeMin, progressOf(score));
}

/**
 * 边长抖动：`base × (1 ± sizeJitter)`。
 *
 * 只是"别让整排方块一模一样"，不参与难度设计——抖动幅度远小于方块缩小量，
 * 所以它不会把可达性算崩（间距下限用的是实际边长，抖动已被算进去）。
 */
export function jitteredSize(base: number, rand: number): number {
  const t = Math.min(1, Math.max(0, Number.isFinite(rand) ? rand : 0));
  return base * (1 + (t * 2 - 1) * JUMP_CONFIG.sizeJitter);
}

/** 这一格用不用圆形底座：门槛前一律方形，之后按概率 */
export function shapeFor(score: number, rand: number): JumpBlockShape {
  if (score < JUMP_CONFIG.roundAfterScore) return 'square';
  const t = Number.isFinite(rand) ? rand : 0;
  return t < JUMP_CONFIG.roundChance ? 'round' : 'square';
}

/** 间距上限的硬天花板：再难也不能超过"蓄满能跳的距离"（从中心起算的绝对上限） */
export function maxReachableGap(): number {
  return JUMP_CONFIG.maxDistance - JUMP_CONFIG.reachMargin;
}

/**
 * 真正的可达性口径：**从上一块最靠后的落脚点**起跳，还要够得到下一块中心。
 *
 * 落点保留（`stand`）之后，"站在中心起跳"不再是最坏情况：上一跳可以停在方块的
 * 后半边，那里离下一块更远（多出半个边长）。所以中心距的上限要再减掉半边，
 * 否则生成器会造出"只有站正才跳得到"的格子——玩家一旦站偏就再也够不着。
 */
export function maxGapFromEdge(previousSize: number): number {
  const size = Number.isFinite(previousSize) && previousSize > 0 ? previousSize : JUMP_CONFIG.blockSizeStart;
  return maxReachableGap() - size / 2;
}

/**
 * 间距硬下限：两块之间要放得下"一块边长 + 倒下的小人"。
 *
 * 低于这个值时人一倾倒就砸在下一块侧面，看起来像穿模——所以它不是难度参数，
 * 是"倾倒动画有没有地方演"的几何约束。
 */
export function gapFloorFor(previousSize: number): number {
  const size = Number.isFinite(previousSize) && previousSize > 0 ? previousSize : JUMP_CONFIG.blockSizeStart;
  return size * JUMP_CONFIG.gapFloorRatio + JUMP_CONFIG.gapFloorMargin;
}

/** 间距曲线的原始区间（绝对格数，不含可达性与下限夹取） */
export function gapCurveForScore(score: number): { from: number; to: number } {
  const t = progressToward(score, JUMP_CONFIG.gapGrowScore);
  return {
    from: mix(JUMP_CONFIG.gapStartMin, JUMP_CONFIG.gapEndMin, t),
    to: mix(JUMP_CONFIG.gapStartMax, JUMP_CONFIG.gapEndMax, t),
  };
}

/**
 * 当前分数下的间距范围：**绝对格数**，分数越高中心距越大。
 *
 * 为什么不用"边长倍数"：方块从 2.0 缩到 1.2 之后，同样 1.9 倍的间距只剩 2.3 格，
 * "越往后越远"会变成"越往后越近"。这一版把难度交给两条独立的曲线：
 * 目标变小（`blockSizeForScore`）+ 中心距变大（本函数）。
 *
 * `previousSize` 同时参与两头：**下限**是"倒下要占的空间"，**上限**是"从上一块
 * 最靠后的落脚点起跳还够得着"（`maxGapFromEdge`）。
 */
export function gapRangeForScore(
  score: number,
  previousSize: number = JUMP_CONFIG.blockSizeStart,
): { from: number; to: number } {
  const curve = gapCurveForScore(score);
  const gapTo = Math.min(curve.to, maxGapFromEdge(previousSize));
  const gapFrom = Math.min(Math.max(curve.from, gapFloorFor(previousSize)), gapTo);
  // 理论上参数怎么配都不会出现 from > to，但夹一下更安全（配置被人手改成倒挂时不会生成倒着跳）
  return { from: gapFrom, to: gapTo };
}

/** 在间距范围内按 `rand` 取一个值 */
export function gapForScore(score: number, rand: number, previousSize?: number): number {
  const { from, to } = gapRangeForScore(score, previousSize);
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
  // 间距下限看**上一块**的边长（倒下要占掉的空间由它决定），不是新块
  const gap = gapForScore(score, r2.value, current.size);

  const r3 = nextRandom(r2.seed);
  const kind = specialKindFor(score, r3.value, current.kind);

  // 抖动与形状各吃一个随机数（顺序固定，否则同 seed 不再是同一条序列）
  const r4 = nextRandom(r3.seed);
  const size = jitteredSize(blockSizeForScore(score), r4.value);
  const r5 = nextRandom(r4.seed);
  // 特殊方块的顶面是直角图集贴图（井盖/唱片/魔方/门脸），做成圆形会把 UV 采到格子边
  const shape: JumpBlockShape = kind === 'normal' ? shapeFor(score, r5.value) : 'square';

  return {
    block: {
      id: current.id + 1,
      // base = (0, -1)，绕 Y 轴转 angle：x' = -sin(angle)，z' = -cos(angle)
      x: current.x - Math.sin(angle) * gap,
      z: current.z - Math.cos(angle) * gap,
      size,
      kind,
      shape,
    },
    seed: r5.seed,
  };
}

/**
 * 这一格要不要做成特殊方块。
 *
 * 三条约束：分数门槛前不出现、不连续两个特殊方块（否则容易连吃两次奖励）、
 * 概率命中后按奖励从小到大抽：井盖 40% / 魔方 30% / 便利店 20% / 音乐盒 10%。
 *
 * 权重不是在模仿原版的真实概率（攻略文只给了"有哪几种"，没给比例），而是**让高分
 * 稀有**：5 分最常见、30 分最难遇到，否则等 3 秒拿 30 分就成了唯一最优解。
 */
export function specialKindFor(score: number, rand: number, previousKind: JumpBlockKind): JumpBlockKind {
  if (score < JUMP_CONFIG.specialAfterScore) return 'normal';
  if (previousKind !== 'normal') return 'normal';
  if (!(rand < JUMP_CONFIG.specialChance)) return 'normal';
  const t = JUMP_CONFIG.specialChance > 0 ? rand / JUMP_CONFIG.specialChance : 1;
  if (t < 0.4) return 'well';
  if (t < 0.7) return 'cube';
  if (t < 0.9) return 'store';
  return 'music';
}

/** 特殊方块停留奖励（0 = 普通方块），数值即原版的 +5 / +10 / +15 / +30 */
export function specialBonus(kind: JumpBlockKind): number {
  switch (kind) {
    case 'well':
      return JUMP_CONFIG.specialWellBonus;
    case 'cube':
      return JUMP_CONFIG.specialCubeBonus;
    case 'store':
      return JUMP_CONFIG.specialStoreBonus;
    case 'music':
      return JUMP_CONFIG.specialMusicBonus;
    default:
      return 0;
  }
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
    // 起点块不抖动：它是"参照物"，抖了会让每一局的开门大小都不一样
    size: JUMP_CONFIG.blockSizeStart,
    kind: 'normal',
    shape: 'square',
  };
  return appendBlock({
    blocks: [first],
    index: 0,
    score: 0,
    combo: 0,
    status: 'playing',
    seed,
    // 开局站在起点块正中
    stand: { x: first.x, z: first.z },
  });
}

// ------------------------------------------------------------------ 落点与计分

/**
 * 落点超出底座的量（0 = 在底座内，正值 = 悬空几格）。
 *
 * 形状必须真的参与判定：方形看**轴对齐**（人站在方块边缘的角上算站得住），
 * 圆形看**欧氏距离**（内切圆之外的地方是空的）。若都用方形口径，圆形底座就是
 * 纯视觉变化，脚下会站着人却判"没踩到"。
 */
export function blockOverhang(block: JumpBlock, x: number, z: number): number {
  const half = Math.max(0, block.size) / 2;
  const dx = Math.abs(x - block.x);
  const dz = Math.abs(z - block.z);
  if (block.shape === 'round') return Math.hypot(dx, dz) - half;
  return Math.max(dx, dz) - half;
}

/**
 * 落点判定的三档结果。
 *
 *  · `hit`：脚底在底座内（再分是不是正中）；
 *  · `topple`：脚底出界了，但悬空量没超过底座半径——**重心还在块边附近**，
 *    人不会直接掉下去，而是先朝前倾斜、再倒下去；
 *  · `miss`：完全悬空（两块之间、或者跳过头太远），没有任何支点，直接坠落。
 *
 * 三档都要结束这一局，区别只在"怎么倒"：`topple` 播倾覆再落，`miss` 直接落。
 */
export type LandingKind = 'hit' | 'topple' | 'miss';

/** 一次跳跃的落点判定结果 */
export interface Landing {
  readonly kind: LandingKind;
  readonly center: boolean;
  /** 脚底落点 */
  readonly point: { readonly x: number; readonly z: number };
}

/**
 * 落点判定。
 *
 * 从**实际站着的点**（`stand`）朝目标块中心跳，落点必定在这条线上：
 * 方向是自动对准中心的，玩家只控制距离。判定再按落点算——站在哪儿就跳哪儿，
 * 所以"上一跳站偏了"会实打实地改变这一跳的重心。
 *
 * 三档的分界线只看**悬空量**（`blockOverhang`），不看朝向：
 * 冲过头和没跳够都往前进方向扑，不需要按偏移法线分方向。
 */
export function resolveLanding(
  stand: { readonly x: number; readonly z: number },
  to: JumpBlock,
  distance: number,
): Landing {
  const dx = to.x - stand.x;
  const dz = to.z - stand.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 0)) return { kind: 'miss', center: false, point: { x: stand.x, z: stand.z } };

  const d = Math.min(JUMP_CONFIG.maxDistance, Math.max(0, Number.isFinite(distance) ? distance : 0));
  const point = { x: stand.x + (dx / length) * d, z: stand.z + (dz / length) * d };

  const half = to.size / 2;
  const overhang = blockOverhang(to, point.x, point.z);
  // 悬空量还没超过底座半径 → 有支点可倾覆；超过就只剩空气
  if (overhang > half) return { kind: 'miss', center: false, point };
  if (overhang > 0) return { kind: 'topple', center: false, point };

  const offCenter = Math.hypot(point.x - to.x, point.z - to.z);
  return { kind: 'hit', center: offCenter <= half * JUMP_CONFIG.centerRatio, point };
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
  if (run.status !== 'playing') {
    return { run, center: false, points: 0, over: true, kind: 'miss', point: run.stand };
  }

  const to = run.blocks[run.index + 1];
  if (!run.blocks[run.index] || !to) {
    return { run, center: false, points: 0, over: true, kind: 'miss', point: run.stand };
  }

  // 从**实际站着的点**起跳，落点也原样保留下来（不复位到方块中心）
  const landing = resolveLanding(run.stand, to, distance);
  if (landing.kind !== 'hit') {
    // 倾覆与坠落都结束这一局：状态一样、动画不同（倾覆由场景播完再落）
    return {
      run: { ...run, status: 'over' },
      center: false,
      points: 0,
      over: true,
      kind: landing.kind,
      point: landing.point,
    };
  }

  const scored = scoreForLanding(run.combo, landing.center);
  const next = appendBlock({
    ...run,
    index: run.index + 1,
    score: run.score + scored.points,
    combo: scored.combo,
    stand: landing.point,
  });

  return {
    run: next,
    center: landing.center,
    points: scored.points,
    over: false,
    kind: 'hit',
    point: landing.point,
  };
}

/** 当前站着的方块 / 下一个目标（渲染层与判定都用这两个） */
export function currentBlock(run: JumpRun): JumpBlock {
  return run.blocks[run.index]!;
}

export function targetBlock(run: JumpRun): JumpBlock {
  return run.blocks[run.index + 1]!;
}
