/**
 * 推箱子的**规则**（小游戏4，批次 20261022-1954）
 *
 * 纯逻辑：不碰渲染、不碰 DOM、不碰计时。给它一个状态和一个方向，它告诉你
 * "推没推动 / 赢没赢 / 死没死"；撤销靠**快照栈**，不靠反向推导。
 *
 * 五条口径（都有断言守着）：
 *
 *  1. **推动的唯一判据是"箱子后面那格空着"**：墙或另一个箱子都不行。
 *     不满足就**整步不生效**（玩家也不动）——只把玩家挪过去会让人以为"推动了一半"。
 *  2. **胜利 = 所有目标格都有箱子**（箱子多于目标时，多出来的不碍事）。
 *  3. **步数上限**：`stepLimit > 0` 时超过即判负；0 表示不限。
 *  4. **撤销用快照**：每步存一份（玩家位置 + 箱子集合 + 步数），撤销直接还原。
 *     比"反向推导上一步"可靠得多（反向推不出"这一步是不是推了箱子"）。
 *  5. **死锁只认"角落"**：箱子不在目标上、且相邻的两个垂直方向都被挡
 *     （墙或另一个箱子）。更复杂的死锁（冻结的整排箱子）不做——
 *     宁可漏报让玩家自己发现，也不要误报把还能救的局面判死。
 */

import type { Level } from '../../level.ts';

export type SokobanDirection = 'up' | 'down' | 'left' | 'right';

export const SOKOBAN_DIRECTIONS: readonly SokobanDirection[] = ['up', 'down', 'left', 'right'];

const OFFSETS: Readonly<Record<SokobanDirection, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** 一格的历史快照（撤销用） */
export interface SokobanSnapshot {
  readonly playerX: number;
  readonly playerZ: number;
  /** 排序后的箱子键；排序是为了让两份快照能直接逐项比较 */
  readonly boxes: readonly string[];
  readonly steps: number;
  readonly pushes: number;
}

export interface SokobanState {
  readonly width: number;
  readonly depth: number;
  readonly walls: ReadonlySet<string>;
  readonly goals: ReadonlySet<string>;
  readonly boxes: ReadonlySet<string>;
  readonly playerX: number;
  readonly playerZ: number;
  readonly steps: number;
  readonly pushes: number;
  /** 0 = 不限 */
  readonly stepLimit: number;
  readonly history: readonly SokobanSnapshot[];
}

export type SokobanMove =
  | {
      readonly ok: true;
      readonly state: SokobanState;
      readonly pushed: boolean;
      readonly won: boolean;
      /** 这一步让步数超过了上限（移动本身仍生效） */
      readonly limitReached: boolean;
    }
  | { readonly ok: false; readonly reason: 'wall' | 'blocked' };

export function keyOf(x: number, z: number): string {
  return `${x},${z}`;
}

function parseKey(key: string): readonly [number, number] {
  const [x, z] = key.split(',');
  return [Number(x), Number(z)];
}

/** 从关卡造初始状态（只取 y=0 那一层：推箱子是平面游戏） */
export function createSokobanState(level: Level): SokobanState {
  const walls = new Set<string>();
  const goals = new Set<string>();
  const boxes = new Set<string>();

  for (const cell of level.cells) {
    if (cell.y !== 0) continue;
    const key = keyOf(cell.x, cell.z);
    if (cell.kind === 'wall') walls.add(key);
    else if (cell.kind === 'goal') goals.add(key);
    else if (cell.kind === 'box') boxes.add(key);
  }

  return {
    width: level.width,
    depth: level.depth,
    walls,
    goals,
    boxes,
    playerX: level.start.x,
    playerZ: level.start.z,
    steps: 0,
    pushes: 0,
    stepLimit: level.stepLimit,
    history: [],
  };
}

/** 所有目标都被箱子盖住了吗 */
export function isSokobanWon(state: SokobanState): boolean {
  for (const goal of state.goals) {
    if (!state.boxes.has(goal)) return false;
  }
  return true;
}

/** 这一格能不能站/推过去（墙或箱子都算挡） */
function blocked(state: SokobanState, x: number, z: number): boolean {
  const key = keyOf(x, z);
  return state.walls.has(key) || state.boxes.has(key);
}

/**
 * 角落死锁：箱子不在目标上，且上下有一边被挡、左右有一边被挡。
 *
 * 这是最常见的"推死"形态（把箱子推进墙角），也是最容易让新手放弃的一种。
 */
export function isSokobanDeadlocked(state: SokobanState): boolean {
  for (const box of state.boxes) {
    if (state.goals.has(box)) continue;
    const [x, z] = parseKey(box);
    const vertical = blocked(state, x, z - 1) || blocked(state, x, z + 1);
    const horizontal = blocked(state, x - 1, z) || blocked(state, x + 1, z);
    if (vertical && horizontal) return true;
  }
  return false;
}

/** 走一步（推不动时整步不生效，连玩家也不动） */
export function moveSokoban(state: SokobanState, direction: SokobanDirection): SokobanMove {
  const [dx, dz] = OFFSETS[direction];
  const nextX = state.playerX + dx;
  const nextZ = state.playerZ + dz;
  const target = keyOf(nextX, nextZ);

  if (state.walls.has(target)) return { ok: false, reason: 'wall' };

  let boxes = state.boxes;
  let pushed = false;

  if (state.boxes.has(target)) {
    const beyondX = nextX + dx;
    const beyondZ = nextZ + dz;
    const beyond = keyOf(beyondX, beyondZ);
    if (state.walls.has(beyond) || state.boxes.has(beyond)) {
      return { ok: false, reason: 'blocked' };
    }
    const nextBoxes = new Set(state.boxes);
    nextBoxes.delete(target);
    nextBoxes.add(beyond);
    boxes = nextBoxes;
    pushed = true;
  }

  const snapshot: SokobanSnapshot = {
    playerX: state.playerX,
    playerZ: state.playerZ,
    boxes: [...state.boxes].sort(),
    steps: state.steps,
    pushes: state.pushes,
  };
  const steps = state.steps + 1;
  const nextState: SokobanState = {
    ...state,
    boxes,
    playerX: nextX,
    playerZ: nextZ,
    steps,
    pushes: state.pushes + (pushed ? 1 : 0),
    // 留最近 500 步足够悔棋；再多也没人点回去，反而白占内存
    history: [...state.history.slice(-499), snapshot],
  };

  return {
    ok: true,
    state: nextState,
    pushed,
    won: isSokobanWon(nextState),
    limitReached: state.stepLimit > 0 && steps > state.stepLimit,
  };
}

/** 撤销一步；没有历史返回 null */
export function undoSokoban(state: SokobanState): SokobanState | null {
  const last = state.history[state.history.length - 1];
  if (!last) return null;
  return {
    ...state,
    playerX: last.playerX,
    playerZ: last.playerZ,
    boxes: new Set(last.boxes),
    steps: last.steps,
    pushes: last.pushes,
    history: state.history.slice(0, -1),
  };
}

/** 箱子是不是压在目标上（渲染换贴图 / HUD 提示用） */
export function boxOnGoal(state: SokobanState, x: number, z: number): boolean {
  const key = keyOf(x, z);
  return state.boxes.has(key) && state.goals.has(key);
}
