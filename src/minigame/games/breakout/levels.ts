/**
 * 打砖块的 10 关（小游戏5，批次 20261022-1954）
 *
 * 字符画：`.` 空、`1` 普通砖（1 下打掉）、`2` 硬砖（2 下）。**最上面那行是顶层**。
 * 宽度由每行长度决定（所有行必须等宽），高度 = 行数。
 *
 * 难度只调三样：砖块行数、硬砖数量、球速。不玩"砖块随机移动"那种花活——
 * 低龄玩家要的是"看得懂、打得到"。
 *
 * 每一关都通过 `parseBreakoutLevel` 校验，并且测试里会用"挡板跟着球跑"的
 * 模拟玩家跑一遍，断言 10 关都能清屏（不是"看起来能过"）。
 */

export interface BreakoutLevelDef {
  readonly id: string;
  /** 顶部在前；字符 `.` / `1` / `2` */
  readonly rows: readonly string[];
  readonly lives: number;
  /** 球速（格/秒） */
  readonly speed: number;
}

export interface BreakoutLevel {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** `rows[y][x]` = 耐久（0 空 / 1 普通 / 2 硬）；`y = 0` 在**底部** */
  readonly rows: readonly (readonly number[])[];
  readonly lives: number;
  readonly speed: number;
}

export type BreakoutLevelParse =
  | { readonly ok: true; readonly level: BreakoutLevel }
  | { readonly ok: false; readonly errors: readonly string[] };

export function parseBreakoutLevel(raw: BreakoutLevelDef): BreakoutLevelParse {
  const errors: string[] = [];
  if (raw.rows.length === 0) errors.push('关卡没有任何一行');
  if (errors.length > 0) return { ok: false, errors };

  const width = raw.rows[0]!.length;
  if (width === 0) errors.push('第一行是空的（宽度为 0）');

  for (let index = 0; index < raw.rows.length; index++) {
    const row = raw.rows[index]!;
    if (row.length !== width) {
      errors.push(`第 ${index} 行有 ${row.length} 个字符，应为 ${width} 个`);
      continue;
    }
    for (const char of row) {
      if (char !== '.' && char !== '1' && char !== '2') errors.push(`未知字符 '${char}'（第 ${index} 行）`);
    }
  }

  if (!Number.isFinite(raw.lives) || raw.lives < 1) errors.push(`生命数非法：${raw.lives}`);
  if (!Number.isFinite(raw.speed) || raw.speed <= 0) errors.push(`球速非法：${raw.speed}`);

  // 把"顶部在前"翻成"底部在前"，同时把字符转成耐久
  const rows: number[][] = [];
  for (let index = raw.rows.length - 1; index >= 0; index--) {
    rows.push([...raw.rows[index]!].map((char) => (char === '.' ? 0 : Number(char))));
  }

  const hasBrick = rows.some((row) => row.some((hp) => hp > 0));
  if (!hasBrick) errors.push('一块砖都没有');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    level: { id: raw.id, width, height: rows.length, rows, lives: Math.floor(raw.lives), speed: raw.speed },
  };
}

export const BREAKOUT_LEVELS: readonly BreakoutLevelDef[] = [
  {
    id: 'breakout-1',
    lives: 3,
    speed: 6,
    rows: ['1111111', '1111111', '1111111'],
  },
  {
    id: 'breakout-2',
    lives: 3,
    speed: 6.5,
    rows: ['1111111', '1.1.1.1', '1111111'],
  },
  {
    id: 'breakout-3',
    lives: 3,
    speed: 7,
    rows: ['1111111', '1111111', '1.....1', '1111111'],
  },
  {
    id: 'breakout-4',
    lives: 3,
    speed: 7,
    rows: ['2.2.2.2', '1111111', '1111111'],
  },
  {
    id: 'breakout-5',
    lives: 3,
    speed: 7.5,
    rows: ['11111111', '11111111', '11.11.11', '11111111'],
  },
  {
    id: 'breakout-6',
    lives: 2,
    speed: 7.5,
    rows: ['222.222', '1111111', '1111111', '1111111'],
  },
  {
    id: 'breakout-7',
    lives: 2,
    speed: 8,
    rows: ['11111111', '.111111.', '..1111..', '...11...'],
  },
  {
    id: 'breakout-8',
    lives: 2,
    speed: 8,
    rows: ['2222222', '1.....1', '1.111.1', '1.....1', '2222222'],
  },
  {
    id: 'breakout-9',
    lives: 2,
    speed: 8.5,
    rows: ['111111111', '1.1.1.1.1', '111111111', '1.1.1.1.1'],
  },
  {
    id: 'breakout-10',
    lives: 1,
    speed: 9,
    rows: ['22222222', '11111111', '11.11.11', '11111111', '22222222'],
  },
];

export const BREAKOUT_LEVEL_COUNT = BREAKOUT_LEVELS.length;

/** 取第 `index` 关（越界夹到最后一关） */
export function breakoutLevel(index: number): BreakoutLevelDef {
  const safe = Number.isFinite(index) ? Math.max(0, Math.min(BREAKOUT_LEVELS.length - 1, Math.floor(index))) : 0;
  return BREAKOUT_LEVELS[safe]!;
}
