/**
 * 天空调色板与缓动（**批次 101** 从 `src/main.ts` 里搬出来的）
 *
 * 这些颜色只被"环境色"那一段用（`main.ts` 的 `applyEnvironment`）。
 * ⚠️ 它们是 `THREE.Color` **实例**：主程序一律 `copy(...).lerp(...)`（只读地当"目标色"），
 * 不会原地改它们——搬出来之后依然是同一批实例，语义不变。
 */

import * as THREE from 'three';

export const DAY_SKY = new THREE.Color(0x8fc7ff);
export const NIGHT_SKY = new THREE.Color(0x040814);
/** 阴天：天空整体压成灰蓝 */
export const OVERCAST_SKY = new THREE.Color(0x5d6773);
/** 闪电：瞬间的冷白 */
export const FLASH_SKY = new THREE.Color(0xd8e6ff);
export const WHITE_SKY = new THREE.Color(0xffffff);

/** 平滑阶跃（天空随时间过渡用） */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
