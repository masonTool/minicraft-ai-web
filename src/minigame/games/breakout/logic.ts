/**
 * 打砖块的**规则**（小游戏5，批次 20261022-1954）
 *
 * 这是 2D 平面上的物理（x 横向、y 纵向），3D 只是一个斜俯视的视角。
 * 纯逻辑：不碰渲染、不碰 DOM。
 *
 * 六条口径（都有断言守着）：
 *
 *  1. **固定子步积分**：外部传进来的 `dt` 先攒进累加器，内部只按 1/120 秒走。
 *     于是"30fps 走一帧"和"60fps 走两帧"得到**同一条轨迹**——条目要求的
 *     "时间步长无关性"就是这个，不靠调参。
 *  2. **挡板反弹按命中位置改角度**：正中 → 垂直向上；边缘 → 最大 ±60°。
 *     这是打砖块唯一"有操作感"的地方，不做它游戏就变成看球自己转。
 *  3. **撞砖只反转一个轴**：按球从哪一侧进入（比较上一帧位置）决定横/竖反转，
 *     并把球沿那一轴退回上一帧位置——否则下一帧还在砖里，一帧连撞好几次。
 *  4. **漏球扣命、命没了判负**；球复位到挡板上方，带着原来的速度重新出发。
 *  5. **砖块清空即过关**（`bricks.size === 0`）。
 *  6. **绝不出现水平锁死**：挡板反弹保证垂直分量至少是 `cos(60°) × speed`，
 *     初始也给了 34% 的横向分量——纯垂直的球会永远在中间上下弹，看着像卡死。
 */

import type { BreakoutLevel } from './levels.ts';

export const BREAKOUT_FIXED_STEP = 1 / 120;

/** 球半径（格） */
export const BALL_RADIUS = 0.32;
/** 挡板半宽（格） */
export const PADDLE_HALF_WIDTH = 1.3;
/** 挡板中心 y（砖块区在 y ≥ 0） */
export const PADDLE_Y = -1.2;
export const PADDLE_HALF_HEIGHT = 0.18;
/** 漏球线 */
export const BOTTOM_Y = -2.4;
/** 挡板边缘的最大反弹角（偏离竖直方向） */
export const MAX_BOUNCE_ANGLE = Math.PI / 3;
/** 初始横向速度占比 */
const START_VX_RATIO = 0.34;
/** 一次 `advance` 最多走多少子步（防切后台回来一口气跑几百步） */
const MAX_SUBSTEPS = 64;

export type BreakoutStatus = 'playing' | 'won' | 'lost';

export interface BreakoutState {
  readonly width: number;
  readonly height: number;
  /** `"x,y"` → 耐久（1 或 2） */
  readonly bricks: ReadonlyMap<string, number>;
  readonly ballX: number;
  readonly ballY: number;
  readonly ballVx: number;
  readonly ballVy: number;
  readonly paddleX: number;
  readonly lives: number;
  readonly score: number;
  readonly status: BreakoutStatus;
  /** 关卡球速（格/秒），复位时用 */
  readonly speed: number;
  /** 固定步长累加器 */
  readonly accumulator: number;
}

export interface BreakoutInput {
  /** 挡板中心 x（会被夹在场地内） */
  readonly paddleX?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function createBreakoutState(level: BreakoutLevel): BreakoutState {
  const bricks = new Map<string, number>();
  for (let y = 0; y < level.height; y++) {
    const row = level.rows[y]!;
    for (let x = 0; x < level.width; x++) {
      const hp = row[x] ?? 0;
      if (hp > 0) bricks.set(`${x},${y}`, hp);
    }
  }
  const speed = level.speed;
  return {
    width: level.width,
    height: level.height,
    bricks,
    ballX: level.width / 2,
    ballY: PADDLE_Y + 1.1,
    ballVx: speed * START_VX_RATIO,
    ballVy: speed * Math.sqrt(1 - START_VX_RATIO * START_VX_RATIO),
    paddleX: level.width / 2,
    lives: level.lives,
    score: 0,
    status: 'playing',
    speed,
    accumulator: 0,
  };
}

export function isBreakoutCleared(state: BreakoutState): boolean {
  return state.bricks.size === 0;
}

/** 球当前覆盖到的第一块砖（没有返回 null） */
function brickAt(
  bricks: ReadonlyMap<string, number>,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const minX = Math.floor(x - BALL_RADIUS + 0.001);
  const maxX = Math.floor(x + BALL_RADIUS - 0.001);
  const minY = Math.floor(y - BALL_RADIUS + 0.001);
  const maxY = Math.floor(y + BALL_RADIUS - 0.001);
  for (let gy = minY; gy <= maxY; gy++) {
    for (let gx = minX; gx <= maxX; gx++) {
      if (bricks.has(`${gx},${gy}`)) return { x: gx, y: gy };
    }
  }
  return null;
}

/** 走一个固定子步 */
export function substepBreakout(state: BreakoutState): BreakoutState {
  if (state.status !== 'playing') return state;

  const previousX = state.ballX;
  const previousY = state.ballY;
  const step = BREAKOUT_FIXED_STEP;

  let x = previousX + state.ballVx * step;
  let y = previousY + state.ballVy * step;
  let vx = state.ballVx;
  let vy = state.ballVy;
  let bricks = state.bricks;
  let score = state.score;
  let lives = state.lives;
  // 显式标注：TS 会把 `state.status` 在这里缩窄成 `'playing'`，后面赋 'won'/'lost' 就报错
  let status: BreakoutStatus = state.status;

  // 左右墙
  if (x < BALL_RADIUS) {
    x = BALL_RADIUS;
    vx = Math.abs(vx);
  } else if (x > state.width - BALL_RADIUS) {
    x = state.width - BALL_RADIUS;
    vx = -Math.abs(vx);
  }

  // 顶部（砖块区再往上一格）
  const top = state.height;
  if (y > top - BALL_RADIUS) {
    y = top - BALL_RADIUS;
    vy = -Math.abs(vy);
  }

  // 砖块：按进入方向只反转一个轴，并把那一轴退回去（避免连撞）
  const hit = brickAt(bricks, x, y);
  if (hit) {
    const key = `${hit.x},${hit.y}`;
    const hp = bricks.get(key) ?? 0;
    const next = new Map(bricks);
    if (hp <= 1) next.delete(key);
    else next.set(key, hp - 1);
    bricks = next;
    score += hp <= 1 ? 10 : 5;

    const centerX = hit.x + 0.5;
    const centerY = hit.y + 0.5;
    const dx = Math.abs(previousX - centerX);
    const dy = Math.abs(previousY - centerY);
    if (dx > dy) {
      vx = -vx;
      x = previousX;
    } else {
      vy = -vy;
      y = previousY;
    }
  }

  // 挡板：只有向下飞时才接
  if (
    vy < 0 &&
    y - BALL_RADIUS <= PADDLE_Y + PADDLE_HALF_HEIGHT &&
    y + BALL_RADIUS >= PADDLE_Y - PADDLE_HALF_HEIGHT &&
    Math.abs(x - state.paddleX) <= PADDLE_HALF_WIDTH + BALL_RADIUS
  ) {
    const offset = clamp((x - state.paddleX) / (PADDLE_HALF_WIDTH + BALL_RADIUS), -1, 1);
    const speed = Math.hypot(vx, vy) || state.speed;
    const angle = offset * MAX_BOUNCE_ANGLE;
    vx = Math.sin(angle) * speed;
    vy = Math.abs(Math.cos(angle) * speed);
    y = PADDLE_Y + PADDLE_HALF_HEIGHT + BALL_RADIUS;
  }

  // 漏球
  if (y < BOTTOM_Y) {
    lives -= 1;
    if (lives <= 0) {
      status = 'lost';
    } else {
      const speed = state.speed;
      x = state.width / 2;
      y = PADDLE_Y + 1.1;
      vx = speed * START_VX_RATIO;
      vy = speed * Math.sqrt(1 - START_VX_RATIO * START_VX_RATIO);
    }
  }

  if (status === 'playing' && bricks.size === 0) status = 'won';

  return {
    ...state,
    bricks,
    ballX: x,
    ballY: y,
    ballVx: vx,
    ballVy: vy,
    lives,
    score,
    status,
  };
}

/**
 * 按真实时间推进（内部固定子步）。
 *
 * `dt` 会被夹到 0.25 秒：切后台回来时 `dt` 可能是几十秒，
 * 一口气追上会让球瞬移過整个场地。
 */
export function advanceBreakout(state: BreakoutState, dt: number, input: BreakoutInput = {}): BreakoutState {
  let current = state;

  if (input.paddleX !== undefined && Number.isFinite(input.paddleX)) {
    const half = Math.min(PADDLE_HALF_WIDTH, current.width / 2);
    current = { ...current, paddleX: clamp(input.paddleX, half, current.width - half) };
  }

  let accumulator = current.accumulator + clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
  let steps = 0;
  while (accumulator >= BREAKOUT_FIXED_STEP && steps < MAX_SUBSTEPS) {
    current = substepBreakout(current);
    accumulator -= BREAKOUT_FIXED_STEP;
    steps += 1;
    if (current.status !== 'playing') break;
  }

  return { ...current, accumulator };
}
