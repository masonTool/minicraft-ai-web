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

export function dyeColor(name: string): DyeColor | undefined {
  return DYE_COLORS.find((color) => color.name === name);
}
