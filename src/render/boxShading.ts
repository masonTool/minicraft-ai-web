/**
 * 共享"单位方块"的**逐面明暗**（顶点色，批次 521）
 *
 * ## 解决的观感问题
 *
 * 生物、玩家、盔甲架都是"几个方块拼起来的小人"，几何体共用一份 `BoxGeometry(1,1,1)`，
 * 颜色只走 `material.color` / `instanceColor`。于是盒子的**六个面一样亮**——
 * 顶面和底面分不出来，远看就是一块纯色剪影，"纸片折的"感觉主要来自这里。
 *
 * 这里把"顶面最亮、底面最暗、四周居中"烘进顶点色（`color` 属性）。three 的
 * `MeshBasicMaterial` 在 `vertexColors` 打开后会算 `color × instanceColor`，
 * 与逐实例的颜色（受击红闪、羊毛染色、昼夜亮度）**相乘叠加**，互不冲突。
 *
 * 成本：几何体是共享的，顶点色只写一次；没有新增 draw call、没有新增贴图。
 *
 * ## 数值口径
 *
 * 与 `ArmorStandRenderer` 原先那份一致（盔甲架早就这么做了，只是没抽出来）：
 * +X 0.86 / -X 0.74 / +Y 1 / -Y 0.62 / +Z 0.92 / -Z 0.8。
 * 左右不对称是刻意的——与方块那套"方向阴影"同一个语言（见 `atlasMesh.FACE_SHADE`），
 * 光从"西边"来的感觉；旋转模型时不会显得忽明忽暗。
 */

import * as THREE from 'three';

/**
 * 六面亮度，顺序与 `BoxGeometry` 的顶点顺序一致（+X -X +Y -Y +Z -Z）。
 *
 * 批次 523：非顶面整体再压 10%（.86→.77、.74→.67、.92→.83、.8→.72、.62→.56）。
 * 方块那一侧同时加深了面明暗（`FACE_SHADE` 0.8/0.6 → 0.72/0.54、底 0.5 → 0.42），
 * 生物/玩家若保持原样，站在墙边会显得比墙更"亮"、像贴上去的——两边要一起走。
 */
export const BOX_FACE_SHADE = {
  px: 0.77,
  nx: 0.67,
  py: 1,
  ny: 0.56,
  pz: 0.83,
  nz: 0.72,
} as const;

/** 按 `BoxGeometry` 的面顺序排好的数组（写顶点色时按面取） */
export const BOX_FACE_SHADE_ORDER: readonly number[] = [
  BOX_FACE_SHADE.px,
  BOX_FACE_SHADE.nx,
  BOX_FACE_SHADE.py,
  BOX_FACE_SHADE.ny,
  BOX_FACE_SHADE.pz,
  BOX_FACE_SHADE.nz,
];

/**
 * 把一个方块几何体的逐面明暗写进 `color` 属性。
 *
 * ⚠️ 只对"6 面 × 每面 4 顶点"的 `BoxGeometry`（`widthSegments = 1`）成立；
 * 顶点数对不上时**什么都不做**——宁可不加这层明暗，也不要算错面把顶面涂成暗的。
 * 材质那边要同时打开 `vertexColors`，否则属性会被忽略。
 *
 * @returns 是否真的写进去了（测试与调用方都可以据此断言）
 */
export function applyBoxFaceShade(geometry: THREE.BufferGeometry): boolean {
  const position = geometry.getAttribute('position');
  if (!position || position.count !== 24) return false;
  if (geometry.getAttribute('color')) return true; // 已经刷过，别重复分配

  const colors = new Float32Array(24 * 3);
  for (let vertex = 0; vertex < 24; vertex++) {
    const shade = BOX_FACE_SHADE_ORDER[Math.floor(vertex / 4)]!;
    colors[vertex * 3] = shade;
    colors[vertex * 3 + 1] = shade;
    colors[vertex * 3 + 2] = shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return true;
}
