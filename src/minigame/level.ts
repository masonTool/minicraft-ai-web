/**
 * 小游戏的**关卡格式**（小游戏2，批次 20261022-1954）
 *
 * 关卡用**字符画**写：一层层往下、每层一行行往下、每行从左到右。
 * 这样在源码里能"看出来"关卡长什么样，改一格不用数坐标；
 * 解析器负责把字符变成格子、并**在加载时就报错**（而不是玩到一半穿墙）。
 *
 * 符号（`LEVEL_SYMBOLS`）：
 *   `#` 墙（石头） · `.` 地板（木板） · ` ` 空（不渲染）
 *   `P` 起点（地板） · `G` 目标（金块） · `B` 箱子初始位（地板）
 *
 * 五条校验（都有断言，对应条目里的"合法性校验"）：
 *  1. 尺寸必须是正整数；
 *  2. 层数 / 每层行数 / 每行字符数都要与声明的尺寸一致（**逐行报错**，不是"整份失败"）；
 *  3. 未知字符要指出具体坐标；
 *  4. 起点必须恰好 1 个（0 个没法开始，2 个说明画错了）；
 *  5. 目标至少 1 个（没有目标的关卡对任何玩法都没意义）。
 *
 * 推箱子特有的规则（箱子数 ≤ 目标数、箱子不在墙上）**不在这里**——
 * 那是 `sokoban/logic.ts` 的事，因为打砖块没有箱子。
 */

import { Block } from '../core/registry/blocks.ts';

export type LevelCellKind = 'wall' | 'floor' | 'empty' | 'start' | 'goal' | 'box';

export interface LevelCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: LevelCellKind;
  /** 这一格要渲染的方块；`null` = 空气（不渲染） */
  readonly blockId: number | null;
}

export interface LevelPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Level {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** 步数上限；0 = 不限 */
  readonly stepLimit: number;
  /** 所有格子（顺序：y → z → x） */
  readonly cells: readonly LevelCell[];
  readonly start: LevelPosition;
  readonly goals: readonly LevelPosition[];
  readonly boxes: readonly LevelPosition[];
}

export interface RawLevel {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** `height` 层；每层 `depth` 行；每行 `width` 个字符 */
  readonly rows: readonly (readonly string[])[];
  readonly stepLimit: number;
}

/** 字符画的符号表（测试与关卡作者都看这张） */
export const LEVEL_SYMBOLS = {
  wall: '#',
  floor: '.',
  empty: ' ',
  start: 'P',
  goal: 'G',
  box: 'B',
} as const;

const SYMBOL_INFO: Readonly<Record<string, { readonly kind: LevelCellKind; readonly blockId: number | null }>> = {
  '#': { kind: 'wall', blockId: Block.STONE },
  '.': { kind: 'floor', blockId: Block.OAK_PLANKS },
  ' ': { kind: 'empty', blockId: null },
  P: { kind: 'start', blockId: Block.OAK_PLANKS },
  G: { kind: 'goal', blockId: Block.GOLD_BLOCK },
  B: { kind: 'box', blockId: Block.OAK_PLANKS },
};

export type LevelParseResult =
  | { readonly ok: true; readonly level: Level }
  | { readonly ok: false; readonly errors: readonly string[] };

export function parseLevel(raw: RawLevel): LevelParseResult {
  const errors: string[] = [];

  if (!Number.isInteger(raw.width) || raw.width <= 0) errors.push(`宽度非法：${raw.width}`);
  if (!Number.isInteger(raw.height) || raw.height <= 0) errors.push(`层数非法：${raw.height}`);
  if (!Number.isInteger(raw.depth) || raw.depth <= 0) errors.push(`深度非法：${raw.depth}`);
  if (errors.length > 0) return { ok: false, errors };

  if (raw.rows.length !== raw.height) {
    errors.push(`应有 ${raw.height} 层，实际 ${raw.rows.length} 层`);
  }

  const cells: LevelCell[] = [];
  const goals: LevelPosition[] = [];
  const boxes: LevelPosition[] = [];
  let start: LevelPosition | null = null;
  let startCount = 0;

  // 少给了一层也继续解析已有的那些（一次把所有问题都报出来，而不是修一个再跑一次）
  const layers = Math.min(raw.height, raw.rows.length);
  for (let y = 0; y < layers; y++) {
    const layer = raw.rows[y]!;
    if (layer.length !== raw.depth) {
      errors.push(`第 ${y} 层应有 ${raw.depth} 行，实际 ${layer.length} 行`);
      continue;
    }
    for (let z = 0; z < raw.depth; z++) {
      const row = layer[z]!;
      if (row.length !== raw.width) {
        errors.push(`第 ${y} 层第 ${z} 行应有 ${raw.width} 个字符，实际 ${row.length} 个`);
        continue;
      }
      for (let x = 0; x < raw.width; x++) {
        const symbol = row[x]!;
        const info = SYMBOL_INFO[symbol];
        if (!info) {
          errors.push(`未知字符 '${symbol}'（第 ${y} 层第 ${z} 行第 ${x} 列）`);
          continue;
        }
        cells.push({ x, y, z, kind: info.kind, blockId: info.blockId });
        if (info.kind === 'start') {
          startCount += 1;
          start = { x, y, z };
        } else if (info.kind === 'goal') {
          goals.push({ x, y, z });
        } else if (info.kind === 'box') {
          boxes.push({ x, y, z });
        }
      }
    }
  }

  if (startCount !== 1) errors.push(`起点（P）应恰好 1 个，实际 ${startCount} 个`);
  if (goals.length === 0) errors.push('至少要有 1 个目标（G）');

  if (errors.length > 0 || !start) {
    return { ok: false, errors: errors.length > 0 ? errors : ['缺少起点'] };
  }

  return {
    ok: true,
    level: {
      id: raw.id,
      width: raw.width,
      height: raw.height,
      depth: raw.depth,
      stepLimit: Number.isFinite(raw.stepLimit) && raw.stepLimit > 0 ? Math.floor(raw.stepLimit) : 0,
      cells,
      start,
      goals,
      boxes,
    },
  };
}

/** 关卡里要渲染的方块（`BlockScene.setBlocks` 的输入） */
export function levelBlocks(level: Level): Array<{ x: number; y: number; z: number; blockId: number }> {
  const blocks: Array<{ x: number; y: number; z: number; blockId: number }> = [];
  for (const cell of level.cells) {
    if (cell.blockId === null) continue;
    blocks.push({ x: cell.x, y: cell.y, z: cell.z, blockId: cell.blockId });
  }
  return blocks;
}
