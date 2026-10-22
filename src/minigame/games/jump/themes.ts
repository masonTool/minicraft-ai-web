/**
 * 跳一跳的**群系主题**（J1，批次 20261022-2220）
 *
 * 一局里每 20 分换一个主题：柱子顶面/侧面换成对应群系的图集贴图，天空跟着变色。
 * 全部复用主世界图集，**不新增任何贴图**。
 *
 * 为什么用"顶面 / 侧面 / 底面"三张而不是一张：草方块顶面是草、侧面是土，
 * 只贴一张会变成"一整个草块"，看着不像 Minecraft（旧渲染层只取 `tiles[0]` 的教训）。
 */

export type ThemeId = 'meadow' | 'snow' | 'desert' | 'stone';

export interface JumpTheme {
  readonly id: ThemeId;
  /** 顶面 tile（图集名） */
  readonly top: string;
  /** 四个侧面 */
  readonly side: string;
  /** 底面（跳不上去，但镜头低时会看到边） */
  readonly bottom: string;
  /** 天空渐变的两端（CSS 颜色） */
  readonly skyTop: string;
  readonly skyBottom: string;
  /** 雾色（与天空下沿接近，远处才不突兀） */
  readonly fog: number;
}

export const JUMP_THEMES: readonly JumpTheme[] = [
  {
    id: 'meadow',
    top: 'grass_top',
    side: 'grass_side',
    bottom: 'dirt',
    skyTop: '#7fb8f0',
    skyBottom: '#dcecff',
    fog: 0xcfe4ff,
  },
  {
    id: 'snow',
    top: 'snow',
    side: 'snow',
    bottom: 'stone',
    skyTop: '#9dbde0',
    skyBottom: '#eef6ff',
    fog: 0xe6f1ff,
  },
  {
    id: 'desert',
    top: 'sand',
    side: 'sand',
    bottom: 'sandstone',
    skyTop: '#f0c184',
    skyBottom: '#ffe9c4',
    fog: 0xf6dcae,
  },
  {
    id: 'stone',
    top: 'stone',
    side: 'stone',
    bottom: 'stone',
    skyTop: '#8b97ab',
    skyBottom: '#d7dee8',
    fog: 0xc9d2de,
  },
];

/** 每多少分换一个主题 */
export const THEME_SCORE_STEP = 20;

/** 按分数取主题（负数/NaN 按 0） */
export function themeForScore(score: number): JumpTheme {
  const safe = Number.isFinite(score) ? Math.max(0, score) : 0;
  const index = Math.floor(safe / THEME_SCORE_STEP) % JUMP_THEMES.length;
  return JUMP_THEMES[index]!;
}

export function themeById(id: ThemeId): JumpTheme {
  return JUMP_THEMES.find((theme) => theme.id === id) ?? JUMP_THEMES[0]!;
}
