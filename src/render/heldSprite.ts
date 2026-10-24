/**
 * 手持物品的 **2.5D 贴图**（批次 20261024-2210）
 *
 * ## 为什么不再挤出面片
 *
 * 2225 那版按图标轮廓挤出实体，轮廓是 1/4 个像素格的台阶，侧壁在斜视角度下
 * 变成一圈"毛刺"；用户反馈："搞得太丑了……想要的是尽量**边缘平滑**、3D 效果**厚一点**"。
 *
 * 关键事实：**第一人称手里的东西相对镜头是不动的**（`HandRenderer` 用固定姿态、
 * 固定深度）。所以"厚度"不必是真几何，可以**烘进一张贴图**：
 *
 *   1. 把图标按 `facePixels` 放大（双线性，边缘就有了平滑过渡）；
 *   2. 用同样的图标做一张**纯色剪影**，沿着一个方向反复平移 `depthPixels` 次叠出来 ——
 *      这就是"厚度"，每一层比上一层更暗，读起来像从光里挤出来的一块；
 *   3. 最后把放大后的图标盖在最前面。
 *
 * 好处：边缘平滑（画布自带抗锯齿）、厚度只受像素数限制（想做多厚都行）、
 * 只有一个四边形 + 一张小贴图（80×80），没有几万个三角形。
 *
 * 代价：这是"一个固定视角的假 3D"。第一人称完全够用；第三人称里物品会随手臂转，
 * 但那个尺寸下（屏高 5% 左右）看不出是烘的，仍然比一块纯平面强。
 */

import * as THREE from 'three';
import { itemIconTile } from '../core/registry/items.ts';
import type { TextureAtlas } from './TextureAtlas.ts';

export interface HeldSpriteOptions {
  /** 正面的像素边长（越大越平滑；16 texel 的图标建议 64~96） */
  facePixels?: number;
  /** 厚度（像素，与 `facePixels` 同尺度）；0 = 不要厚度 */
  depthPixels?: number;
  /** 厚度往哪个方向挤（画布像素方向，会自动归一化） */
  direction?: readonly [number, number];
  /** 正面用双线性（true，边缘平滑）还是最近邻（false，硬像素） */
  smooth?: boolean;
}

export interface HeldSprite {
  readonly texture: THREE.CanvasTexture;
  /** 画布像素边长 */
  readonly canvasPixels: number;
  /** 正面在画布里的像素矩形（左上角恒为 0,0） */
  readonly facePixels: number;
  /** 厚度裙边在画布右侧/下侧各占多少像素 */
  readonly padPixels: number;
  dispose(): void;
}

/**
 * 把一个物品图标烘成"有厚度的 2.5D 贴图"。
 *
 * 没有 DOM（离线测试）时返回 null —— 调用方退回薄盒子。
 */
export function buildHeldSprite(
  atlas: TextureAtlas,
  itemId: number,
  options: HeldSpriteOptions = {},
): HeldSprite | null {
  if (typeof document === 'undefined') return null;
  const tile = itemIconTile(itemId);
  const source = atlas.tileSource(tile);
  const facePixels = Math.max(16, Math.round(options.facePixels ?? 64));
  const depthPixels = Math.max(0, Math.round(options.depthPixels ?? 14));
  const smooth = options.smooth ?? true;
  const [dirX, dirY] = options.direction ?? [0.55, 0.83];
  const length = Math.hypot(dirX, dirY) || 1;
  const dx = (dirX / length) * depthPixels;
  const dy = (dirY / length) * depthPixels;
  const padPixels = depthPixels;
  const canvasPixels = facePixels + padPixels;

  const makeCanvas = (size: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
  };

  // ---- 正面：放大后的图标（双线性 → 边缘是渐变而不是硬台阶）
  const face = makeCanvas(facePixels);
  const faceCtx = face.getContext('2d');
  if (!faceCtx) return null;
  faceCtx.imageSmoothingEnabled = smooth;
  faceCtx.imageSmoothingQuality = 'high';
  faceCtx.drawImage(
    atlas.canvas,
    source.x,
    source.y,
    16,
    16,
    0,
    0,
    facePixels,
    facePixels,
  );

  // ---- 厚度：同一张图标的**纯色剪影**，沿方向一层层叠出来
  const output = makeCanvas(canvasPixels);
  const ctx = output.getContext('2d');
  if (!ctx) return null;
  if (depthPixels > 0) {
    for (let step = depthPixels; step >= 1; step--) {
      const t = step / depthPixels;
      // 越靠后的层越暗：读起来是"被光挤出来的一块"，而不是一圈描边
      const shade = 0.42 + 0.3 * (1 - t);
      ctx.globalAlpha = 1;
      ctx.drawImage(colorize(face, shade, step), dx * t, dy * t);
    }
    ctx.globalAlpha = 1;
  }
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(face, 0, 0);

  const texture = new THREE.CanvasTexture(output);
  // 与图集保持同一套色彩口径（图集是 NoColorSpace），否则手里那件会偏色
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return {
    texture,
    canvasPixels,
    facePixels,
    padPixels,
    dispose: () => texture.dispose(),
  };
}

/**
 * 把一张"图标画布"变成纯色剪影（保留 alpha）。
 *
 * 每层单独做一份：`source-in` 会把画布内容替换成纯色，直接改原画布就没法再画正面了。
 */
function colorize(face: HTMLCanvasElement, shade: number, _step: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = face.width;
  canvas.height = face.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(face, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  const value = Math.round(255 * Math.min(1, shade));
  ctx.fillStyle = `rgb(${value},${value},${value})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}
