/**
 * 手持物品的 **3D 像素模型**（批次 20261024-2136）
 *
 * ## 为什么不再用"薄盒子"
 *
 * 之前扁平物品是一个 0.52×0.52×0.03 的盒子、六个面贴同一张 16×16 图标：
 * 它只有"一块板"的厚度，侧着看是一条边，正反两面还会互相透（双面渲染时能看到
 * 背面的镜像 = 两把交叉的剑）。用户要的是"3D 效果 + 更厚一点 + 更精细"。
 *
 * 这里的做法是把图标的**实际轮廓**挤成实体：
 *   · 正反两片：逐个不透明像素各出一个四边形（贴自己那一格的颜色）；
 *   · 侧壁：只在"不透明像素挨着透明像素"的那一条边上出一道墙，于是厚度**跟着轮廓走**
 *     —— 剑就是一把有厚度的剑，而不是一块有厚度的方块；
 *   · 侧壁按朝向压暗（上亮下暗），一眼能看出这是个立体的东西。
 *
 * ## 为什么要 Scale2x
 *
 * 图集里的图标只有 16×16，放大到屏幕上一格近 30px，轮廓是硬台阶。
 * 这里先在**掩码**上跑一遍 Scale2x（EPX）把它变成 32×32：斜边上的台阶会被"补角"
 * 抹平，但像素颜色不变（每个子像素仍采样原来那一格的颜色），于是轮廓更细腻、
 * 观感更像"高清化的像素画"，而不是加了一层模糊。
 *
 * 成本：一件物品最多 ~1000 个子像素 → 正反各 1000 个四边形 + 一圈侧壁，
 * 约 2~3k 三角形；几何按物品缓存，切物品不重建。
 */

import * as THREE from 'three';

/** 只要能按贴图名给出 UV 矩形与像素即可（真实 `TextureAtlas`、测试桩都满足） */
export interface ItemIconSource {
  uv(tile: string): [number, number, number, number];
  contentBounds(tile: string): { left: number; top: number; right: number; bottom: number };
  /** 读整张贴图的 RGBA（`TILE_SIZE × TILE_SIZE`）；读不到时返回 null */
  readTile(tile: string): { width: number; height: number; data: Uint8ClampedArray } | null;
}

export interface ItemModelOptions {
  /** 整张贴图映射到的边长（世界/屏幕比例单位，由调用方决定口径） */
  size: number;
  /** 厚度（同一口径） */
  depth: number;
  /** 贴图边长（像素），默认 16 */
  tilePixels?: number;
  /** 是否把"内容底边中点"挪到原点（手握柄）；玩家模型里也需要，默认开 */
  alignToGrip?: boolean;
}

/** 侧壁的逐面明暗：+x / -x / +y（上）/ -y（下） */
const WALL_SHADE: Record<'+x' | '-x' | '+y' | '-y', number> = {
  '+x': 0.74,
  '-x': 0.8,
  '+y': 0.92,
  '-y': 0.62,
};
const FRONT_SHADE = 1;
const BACK_SHADE = 0.92;

/**
 * Scale2x（EPX）：把二进制掩码放大一倍并抹平斜边台阶。
 *
 * 规则（每个像素 P 看上下左右 A/B/C/D）：四个子像素各自"要不要跟邻居一致"，
 * 一致就补上，于是 45° 的台阶变成两段 22.5°，方块图标的直角保持不变。
 */
function scale2xMask(mask: readonly boolean[], width: number, height: number): boolean[] {
  const out = new Array<boolean>(width * 2 * height * 2).fill(false);
  const at = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= width || y >= height ? false : mask[y * width + x]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = at(x, y);
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      const e0 = c === a && c !== d && a !== b ? c : p;
      const e1 = a === b && a !== c && b !== d ? b : p;
      const e2 = d === c && d !== b && c !== a ? c : p;
      const e3 = b === d && b !== a && d !== c ? b : p;
      const ox = x * 2;
      const oy = y * 2;
      out[oy * width * 2 + ox] = e0;
      out[oy * width * 2 + ox + 1] = e1;
      out[(oy + 1) * width * 2 + ox] = e2;
      out[(oy + 1) * width * 2 + ox + 1] = e3;
    }
  }
  return out;
}

/**
 * 按图标轮廓挤出一个带厚度的实体。
 *
 * 返回的几何体已经按"内容底边中点 = 原点"平移过（`alignToGrip`），
 * 顶点属性是 `position` / `uv` / `aShade`（第一人称那套自定义着色器直接可用）。
 * 图标整张全透明（读不到像素 / 空图）时返回 null，调用方退回薄盒子。
 */
export function buildItemModel(
  source: ItemIconSource,
  tile: string,
  options: ItemModelOptions,
): THREE.BufferGeometry | null {
  const tilePixels = options.tilePixels ?? 16;
  const pixels = source.readTile(tile);
  if (!pixels || pixels.width !== tilePixels) return null;

  const bounds = source.contentBounds(tile);
  // 只处理内容那块，四周的透明留白不必生成几何
  const cropLeft = Math.max(0, bounds.left);
  const cropTop = Math.max(0, bounds.top);
  const cropRight = Math.min(tilePixels, bounds.right);
  const cropBottom = Math.min(tilePixels, bounds.bottom);
  const cropW = cropRight - cropLeft;
  const cropH = cropBottom - cropTop;
  if (cropW <= 0 || cropH <= 0) return null;

  const mask: boolean[] = new Array(cropW * cropH).fill(false);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const px = cropLeft + x;
      const py = cropTop + y;
      const alpha = pixels.data[(py * tilePixels + px) * 4 + 3]!;
      mask[y * cropW + x] = alpha >= 128;
    }
  }
  if (!mask.some((value) => value)) return null;

  // 两遍 Scale2x = 4×：轮廓台阶从 1 个 texel 降到 1/4 个，
  // 侧壁的一圈"锯齿"才不会变成一圈毛刺（一只圆形的苹果最明显）
  let scaled = scale2xMask(mask, cropW, cropH);
  let w = cropW * 2;
  let h = cropH * 2;
  scaled = scale2xMask(scaled, w, h);
  w *= 2;
  h *= 2;
  const subShift = 2; // 4× → 每个原始像素占 4×4 个子像素
  const texel = options.size / tilePixels;
  const half = options.size / 2;
  const zFront = options.depth / 2;
  const zBack = -options.depth / 2;
  const [u0, v0, u1, v1] = source.uv(tile);
  const du = (u1 - u0) / tilePixels;
  const dv = (v1 - v0) / tilePixels;

  const positions: number[] = [];
  const uvs: number[] = [];
  const shades: number[] = [];


  /**
   * 追加一个四边形，并**保证朝向**：先按 (b-a)×(c-a) 算面法线，和期望方向相反就把
   * 顶点顺序反过来。
   *
   * ⚠️ 这一条是必须的（第一批手写绕序的版本就栽在这里）：材质是单面渲染，
   * 绕序反了的面会被剔除 —— 表现是"正反两片互相看不见、侧壁剩一半"，
   * 画面上就是**一圈带缺口的毛刺**而不是一整条厚度边。
   */
  const pushQuad = (
    corners: readonly [number, number, number][],
    normal: readonly [number, number, number],
    u: number,
    v: number,
    shade: number,
  ): void => {
    const [a, b, c] = corners as [
      [number, number, number],
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ];
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const flip = nx * normal[0] + ny * normal[1] + nz * normal[2] < 0;
    const order = flip ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 2, 1, 3];
    for (const index of order) {
      const [x, y, z] = corners[index]!;
      positions.push(x, y, z);
      uvs.push(u, v);
      shades.push(shade);
    }
  };

  const at = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= w || y >= h ? false : scaled[y * w + x]!;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      // 子像素 → 原像素（颜色）与本地坐标
      const sourceX = cropLeft + (x >> subShift);
      const sourceY = cropTop + (y >> subShift);
      const u = u0 + (sourceX + 0.5) * du;
      const v = v0 + (tilePixels - sourceY - 0.5) * dv;
      // 坐标一律用**边**算（不是中心）：整张贴图映射到 [-half, half]，
      // 再把 Scale2x 的子像素对半分进那一格里。用中心 + 半个格子推的话，
      // 内容底边会整体偏半个 texel（第一批测试就是在这里报 y ∈ [-0.016, …]）。
      const step = texel / (1 << subShift);
      const colLeft = -half + (cropLeft + (x >> subShift)) * texel;
      const rowTop = half - (cropTop + (y >> subShift) + 1) * texel;
      const x0 = colLeft + (x % (1 << subShift)) * step;
      const x1 = x0 + step;
      const y0 = rowTop + (y % (1 << subShift)) * step;
      const y1 = y0 + step;

      pushQuad(
        [
          [x0, y1, zFront],
          [x1, y1, zFront],
          [x0, y0, zFront],
          [x1, y0, zFront],
        ],
        [0, 0, 1],
        u,
        v,
        FRONT_SHADE,
      );
      pushQuad(
        [
          [x0, y1, zBack],
          [x1, y1, zBack],
          [x0, y0, zBack],
          [x1, y0, zBack],
        ],
        [0, 0, -1],
        u,
        v,
        BACK_SHADE,
      );

      // 侧壁：只在邻居透明的那一侧出墙，厚度跟着轮廓走
      if (!at(x, y - 1)) {
        pushQuad(
          [
            [x0, y1, zBack],
            [x1, y1, zBack],
            [x0, y1, zFront],
            [x1, y1, zFront],
          ],
          [0, 1, 0],
          u,
          v,
          WALL_SHADE['+y'],
        );
      }
      if (!at(x, y + 1)) {
        pushQuad(
          [
            [x0, y0, zBack],
            [x1, y0, zBack],
            [x0, y0, zFront],
            [x1, y0, zFront],
          ],
          [0, -1, 0],
          u,
          v,
          WALL_SHADE['-y'],
        );
      }
      if (!at(x - 1, y)) {
        pushQuad(
          [
            [x0, y1, zBack],
            [x0, y0, zBack],
            [x0, y1, zFront],
            [x0, y0, zFront],
          ],
          [-1, 0, 0],
          u,
          v,
          WALL_SHADE['-x'],
        );
      }
      if (!at(x + 1, y)) {
        pushQuad(
          [
            [x1, y1, zBack],
            [x1, y0, zBack],
            [x1, y1, zFront],
            [x1, y0, zFront],
          ],
          [1, 0, 0],
          u,
          v,
          WALL_SHADE['+x'],
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // 同一份明暗写两处：`aShade` 给第一人称那套自定义着色器，`color` 给玩家模型那份
  // `MeshBasicMaterial`（它只认顶点色）。两份都用同一个数，别让两个视角出现两种亮度。
  geometry.setAttribute('aShade', new THREE.Float32BufferAttribute(shades, 1));
  const colors: number[] = [];
  for (const shade of shades) colors.push(shade, shade, shade);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  if (options.alignToGrip !== false) {
    // 与旧的薄盒子同一口径：图标里不透明那块的**底边中点**落在原点（= 手握柄的位置）
    const contentBottom = (tilePixels - bounds.bottom) * texel;
    const contentCenterX = ((bounds.left + bounds.right) / 2 - tilePixels / 2) * texel;
    geometry.translate(-contentCenterX, half - contentBottom, 0);
  }
  return geometry;
}
