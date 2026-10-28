/**
 * 天空调色板与缓动（**批次 101** 从 `src/main.ts` 里搬出来的）
 *
 * 这些颜色只被"环境色"那一段用（`main.ts` 的 `applyEnvironment`）。
 * ⚠️ 它们是 `THREE.Color` **实例**：主程序一律 `copy(...).lerp(...)`（只读地当"目标色"），
 * 不会原地改它们——搬出来之后依然是同一批实例，语义不变。
 */

import * as THREE from 'three';
import { srgbColor } from './srgb.ts';

export const DAY_SKY = new THREE.Color(0x8fc7ff);
export const NIGHT_SKY = new THREE.Color(0x040814);
/** 阴天：天空整体压成灰蓝 */
export const OVERCAST_SKY = new THREE.Color(0x5d6773);
/** 闪电：瞬间的冷白 */
export const FLASH_SKY = new THREE.Color(0xd8e6ff);
export const WHITE_SKY = new THREE.Color(0xffffff);

/**
 * 日出 / 日落时地平线那圈暖色（批次 237）。
 *
 * 原版的"霞"不只画在太阳周围，**整条地平线都偏橙金**——地形消失处正好落在那条带上，
 * 于是远景会被染暖。这里只在地平线色上叠一点（`sunGlow * 0.5`），不是把整片天染橙。
 *
 * ⚠️ 用 `srgbColor` 而不是 `new THREE.Color(hex)`：穹顶是自定义着色器，值原样写帧缓冲
 * （同 E15 那条经验）。上面那几个历史颜色是旧写法，先不动，避免整片天空突然变亮。
 */
export const SUNSET_HORIZON = srgbColor(0xffa15e);

/**
 * 光照色温（批次 237）：天光 / 块光各一种颜色，乘在烘焙好的亮度上。
 *
 * 以前只有"亮度"没有"颜色"，于是火把照的房间是灰的、夜里只是"变暗"而不是"变蓝"。
 * 这三个值都是**平色进自定义着色器**，一律走 `srgbColor`。
 */
/** 夜间天光（冷月光）。白天是纯白，日出日落叠一点暖色 */
export const NIGHT_LIGHT = srgbColor(0x93a9e0);
/** 日出 / 日落时的天光（低角度太阳偏暖） */
export const SUNSET_LIGHT = srgbColor(0xffc78a);
/** 块光（火把 / 岩浆 / 荧石）：原版光照贴图的暖橙 */
export const BLOCK_LIGHT = srgbColor(0xffd9a6);

/** 平滑阶跃（天空随时间过渡用） */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
