/**
 * 生命 / 饥饿 / 护甲 / 氧气四个图标的**唯一真源**（路径 + 色值 + 三态判据）
 *
 * 为什么单独一个文件：这些图标 DOM 版（`ui/VitalsHud.ts` 的内联 SVG）与 canvas 版
 * （`ui2d/Vitals2D.ts` 的 `Path2D`）都要用，路径字符串抄两份必然漂 ——
 * 改一处忘一处的结果是"DOM 版的心胖一点"，而这种差异没人会写断言。
 *
 * 坐标一律是 **9×9 viewBox**（`VITAL_VIEW_BOX`）：SVG 里直接写，canvas 侧按
 * `rect.w / 9` 缩放，两边同一套数字。
 */

/** 图标的坐标系边长（`viewBox="0 0 9 9"`） */
export const VITAL_VIEW_BOX = 9;

/** 心形（9×9） */
export const HEART_PATH =
  'M4.5 8 C4.5 8 1 5.4 1 3.4 C1 2 2.1 1 3.4 1 C4 1 4.5 1.3 4.5 1.6 C4.5 1.3 5 1 5.6 1 C6.9 1 8 2 8 3.4 C8 5.4 4.5 8 4.5 8 Z';

/** 鸡腿（饥饿） */
export const FOOD_PATH =
  'M6.4 1.1 A2.9 2.9 0 1 0 3.2 5.6 L1.5 7.3 a1.2 1.2 0 1 0 1.7 1.7 L4.9 7.3 A2.9 2.9 0 0 0 6.4 1.1 Z';

/** 护甲片（胸甲：顶部中间留出领口） */
export const ARMOR_PATH = 'M1 1.5 H3.5 V3 H5.5 V1.5 H8 V7.5 H1 Z';

/** 气泡（氧气）：一个圆环 + 一个实心圆 */
export const BUBBLE = { cx: 4.5, cy: 4.5, r: 3.6, strokeWidth: 1.2 } as const;

/** 四套配色（与 `index.html` 无对应 CSS 变量：这些颜色只在这几个图标上用） */
export const VITAL_COLORS = {
  heartEmpty: '#3a1414',
  heart: '#e03b3b',
  foodEmpty: '#33281a',
  food: '#b1742f',
  air: '#9fd8ff',
  armorEmpty: '#2c3138',
  armor: '#dfe2ea',
} as const;

/** 一颗护甲图标代表 2 点护甲值（满护甲 20 点 = 10 颗，与 10 颗心同宽） */
export const ARMOR_PER_ICON = 2;

export type VitalState = 'full' | 'half' | 'empty';

/**
 * 心 / 鸡腿 / 护甲的三态判据：`value` 是"这一颗还剩多少点"（2 点满、1 点半）。
 *
 * 同一个函数必须同时服务两边 —— DOM 版决定 `display` 与 `clip-path`，
 * canvas 版决定画整颗、画半颗还是不画，判据分家就会出现"半颗心画成整颗"。
 */
export function vitalIconState(value: number): VitalState {
  return value >= 2 ? 'full' : value >= 1 ? 'half' : 'empty';
}

/** 气泡的三态：一颗气泡 = `perBubble` 点氧气（与其余四种的"2 点一颗"不同） */
export function bubbleIconState(value: number, perBubble: number): VitalState {
  if (!(perBubble > 0)) return 'empty';
  if (value >= perBubble) return 'full';
  return value > 0 ? 'half' : 'empty';
}
