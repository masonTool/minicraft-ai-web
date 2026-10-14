/**
 * 染料配色表
 *
 * 原版 16 种染料的颜色，羊毛与染料图标共用同一份数据（原版羊毛会略偏灰，
 * 这里用染料色统一，视觉差异很小且省掉一份表）。
 *
 * 顺序是原版的染料顺序，注册表按这个顺序生成 id，改动顺序会导致存档不兼容。
 */

export interface DyeColor {
  /** 英文名，用于拼接贴图名与方块名 */
  readonly name: string;
  readonly rgb: readonly [number, number, number];
}

export const DYE_COLORS: readonly DyeColor[] = [
  { name: 'white', rgb: [249, 255, 254] },
  { name: 'orange', rgb: [249, 128, 29] },
  { name: 'magenta', rgb: [199, 78, 189] },
  { name: 'light_blue', rgb: [58, 179, 218] },
  { name: 'yellow', rgb: [254, 216, 61] },
  { name: 'lime', rgb: [128, 199, 31] },
  { name: 'pink', rgb: [243, 139, 170] },
  { name: 'gray', rgb: [71, 79, 82] },
  { name: 'light_gray', rgb: [157, 157, 151] },
  { name: 'cyan', rgb: [22, 156, 156] },
  { name: 'purple', rgb: [137, 50, 184] },
  { name: 'blue', rgb: [60, 68, 170] },
  { name: 'brown', rgb: [131, 84, 50] },
  { name: 'green', rgb: [94, 124, 22] },
  { name: 'red', rgb: [176, 46, 38] },
  { name: 'black', rgb: [29, 29, 33] },
] as const;

export const DYE_COLOR_COUNT = DYE_COLORS.length;

// ---------------------------------------------------------------- 木材种类

/**
 * 木材基色表。
 *
 * 一套木材派生 5 个方块（原木 / 木板 / 树叶 / 台阶 / 楼梯），
 * 贴图也全部由这三组颜色生成——加一种木头只需在这里加一行。
 */
export interface WoodColor {
  readonly name: string;
  /** 树皮（原木侧面）基色 */
  readonly bark: readonly [number, number, number];
  /** 木芯（原木顶面 / 木板）基色 */
  readonly wood: readonly [number, number, number];
  /** 树叶基色 */
  readonly leaf: readonly [number, number, number];
  /** 树叶的不透明度（针叶林更密实） */
  readonly leafAlpha?: number;
}

export const WOOD_TYPES: readonly WoodColor[] = [
  { name: 'oak', bark: [104, 78, 48], wood: [150, 118, 72], leaf: [104, 158, 74] },
  { name: 'spruce', bark: [58, 42, 26], wood: [116, 90, 54], leaf: [62, 104, 66], leafAlpha: 255 },
  { name: 'birch', bark: [214, 212, 206], wood: [196, 178, 122], leaf: [128, 168, 82] },
  { name: 'jungle', bark: [86, 66, 40], wood: [154, 110, 78], leaf: [88, 150, 48] },
  { name: 'acacia', bark: [104, 96, 84], wood: [172, 100, 56], leaf: [110, 156, 60] },
  { name: 'dark_oak', bark: [52, 40, 26], wood: [72, 54, 32], leaf: [72, 130, 50] },
];

export function woodColor(name: string): WoodColor | undefined {
  return WOOD_TYPES.find((wood) => wood.name === name);
}

export function dyeColor(name: string): DyeColor | undefined {
  return DYE_COLORS.find((color) => color.name === name);
}
