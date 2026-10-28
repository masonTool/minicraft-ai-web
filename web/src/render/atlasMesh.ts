/**
 * 图集几何工具：把「贴图名」写进几何体的 UV，并烘焙逐面明暗。
 *
 * 掉落物（`EntityRenderer`）与第一人称手持物品（`HandRenderer`）都要做同一件事：
 * 用图集里的一张贴图铺满一个立方体/平面，并让不同朝向的面有明暗差，
 * 否则一个纯色立方体看上去就是一块饼干。这份逻辑只写一次，两边共用。
 *
 * 注意「逐面明暗」在这里是**顶点色**而不是真光照：手持物品几乎贴着脸，
 * 真光照反而会随环境忽明忽暗（原版第一人称也是这样处理的）。
 */

import * as THREE from 'three';
import { blockDef } from '../core/registry/blocks.ts';

/** 只要能按贴图名给出 UV 矩形即可（真实的 `TextureAtlas`、测试用的桩都满足） */
export interface AtlasUvSource {
  uv(tile: string): [number, number, number, number];
}

/**
 * BoxGeometry / PlaneGeometry 每个面的 UV 排布（顶点顺序固定）。
 *
 * ⚠️ 这个顺序与 three 的 `BoxGeometry` 顶点排列绑定：每个面 4 个顶点按
 * (左上 → 右上 → 左下 → 右下) 排列，所以 UV 必须写成 [0,1] [1,1] [0,0] [1,0]，
 * 否则贴图会上下镜像。
 */
export const FACE_UV_PATTERN: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 1],
  [0, 0],
  [1, 0],
];

/**
 * 六面亮度：顶面最亮、底面最暗，模仿原版的假光照。
 *
 * 顺序与 `BoxGeometry` 的面顺序一致：+X -X +Y -Y +Z -Z。
 * 数值与 `ChunkMesher.RAW_FACES` **必须一样**（同一个方块拿在手上和放在地上不该有两种亮度）：
 * 批次 524 一起加深（侧面 0.8/0.6 → 0.72/0.54、底面 0.5 → 0.42），
 * 让方块看起来"被上面的光照着"、更压得住。
 */
export const FACE_SHADE: readonly number[] = [0.54, 0.54, 1, 0.42, 0.72, 0.72];

/** 把图集里各贴图的 UV 写进几何体（几何体每个面固定 4 个顶点） */
export function applyFaceUvs(
  geometry: THREE.BufferGeometry,
  atlas: AtlasUvSource,
  faceTiles: readonly string[],
): void {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const faceCount = Math.min(faceTiles.length, uv.count / 4);

  for (let face = 0; face < faceCount; face++) {
    const [u0, v0, u1, v1] = atlas.uv(faceTiles[face]!);
    for (let corner = 0; corner < 4; corner++) {
      const [cu, cv] = FACE_UV_PATTERN[corner]!;
      uv.setXY(face * 4 + corner, u0 + cu * (u1 - u0), v0 + cv * (v1 - v0));
    }
  }
  uv.needsUpdate = true;
}

/**
 * 写逐面亮度到顶点属性 `aShade`（标量）。
 * 着色器把它乘到贴图颜色上，就得到了「顶面亮、侧面中、底面暗」的立体感。
 *
 * 用自定义属性名而不是 three 的 `color`：`color` 需要在材质里开 `vertexColors`，
 * 会牵扯 three 自带的颜色管线（含色彩空间转换），而我们的图集是 NoColorSpace、
 * 全流程直接写 sRGB，自己声明一个属性最省事也最可控。
 */
export function applyFaceShade(geometry: THREE.BufferGeometry, shades: readonly number[]): void {
  const count = geometry.getAttribute('position').count;
  const faces = Math.floor(count / 4);
  const values = new Float32Array(count);

  for (let face = 0; face < faces; face++) {
    // 没给到亮度的面保持 1（白），不会突然变黑
    const shade = shades[face] ?? 1;
    for (let corner = 0; corner < 4; corner++) {
      values[face * 4 + corner] = shade;
    }
  }

  geometry.setAttribute('aShade', new THREE.BufferAttribute(values, 1));
}

/**
 * 方块六面在 `BoxGeometry` 面顺序（+X, -X, +Y, -Y, +Z, -Z）下分别取哪张贴图。
 * `blockDef(id).tiles` 的约定是 [顶, 底, 侧]。
 */
export function blockFaceTiles(blockId: number): string[] {
  const tiles = blockDef(blockId).tiles;
  return [tiles[2]!, tiles[2]!, tiles[0]!, tiles[1]!, tiles[2]!, tiles[2]!];
}

/**
 * 扁平物品六面 UV：正反两面（±z）贴整张图标，四周的"厚度面"各取图标**最外那一列/行**。
 *
 * 为什么不能六面都贴整张：16px 的图标压到 2px 宽的厚度边上，斜向的剑会被拉成
 * 一条细长的"彩带"（批次 20261024-1455/1531 的两次事故）；而"厚度面填一道纯色"也不行，
 * 斜向物品会在空气里多画一条孤零零的线（1726 实测）。取边缘列之后，厚度面的颜色就是
 * 图标轮廓那一圈的颜色，而且**图标那里是透明的地方 alphaTest 会直接裁掉**——
 * 厚度只出现在内容真正顶到边的地方。
 *
 * 第一人称手持物与第三人称玩家模型手里的东西共用这一份（两处若各写一遍，
 * 迟早会出现"第一人称看着对、第三人称翻一样"的差异）。
 */
export function applySpriteFaceUvs(
  geometry: THREE.BufferGeometry,
  atlas: AtlasUvSource,
  tile: string,
  bounds: { left: number; top: number; right: number; bottom: number },
  tilePixels: number,
): void {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = atlas.uv(tile);
  const du = (u1 - u0) / tilePixels;
  const dv = (v1 - v0) / tilePixels;
  // 贴图行号 → UV 的 v（画布第 0 行是图标顶部，对应 v = 1）
  const vOf = (row: number): number => (tilePixels - row) / tilePixels;
  const full: [number, number] = [0, tilePixels];

  // 面序与 `BoxGeometry` 一致：+X -X +Y -Y +Z -Z
  const faces: readonly (readonly [number, number, number, number])[] = [
    [bounds.right - 1, bounds.right, ...full], // +X：右侧那一列
    [bounds.left, bounds.left + 1, ...full], // -X：左侧那一列
    [...full, vOf(bounds.top + 1), vOf(bounds.top)], // +Y：上面那一行
    [...full, vOf(bounds.bottom), vOf(bounds.bottom - 1)], // -Y：下面那一行
    [...full, ...full], // +Z：整张图标
    [...full, ...full], // -Z：整张图标
  ];

  for (let face = 0; face < faces.length; face++) {
    const [fu0, fu1, fv0, fv1] = faces[face]!;
    for (let corner = 0; corner < 4; corner++) {
      const [cu, cv] = FACE_UV_PATTERN[corner]!;
      uv.setXY(
        face * 4 + corner,
        u0 + (fu0 + cu * (fu1 - fu0)) * du,
        v0 + (fv0 + cv * (fv1 - fv0)) * dv,
      );
    }
  }
  uv.needsUpdate = true;
}
