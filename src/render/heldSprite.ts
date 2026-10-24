/**
 * 手持物品的 **2.5D 贴图**（批次 20261024-2238）
 *
 * ## 为什么是"烘贴图"
 *
 * 第一人称手里的东西相对镜头是**不动的**（`HandRenderer` 用固定姿态、固定深度），
 * 所以"厚度"不必是真几何，可以画进一张贴图里：
 *   1. 图标的像素先跑 **Scale2x（EPX）** 放大（默认两遍 = 4×）：它把斜边的台阶补成
 *      更小的台阶，用的还是原来的颜色 —— **清晰、不糊**。上一版用双线性放大，
 *      结果整件东西糊成一团（用户："太糊了，起码要像一把剑吧，而且要清晰"）。
 *   2. 用同一张图的**剪影**沿右下方向错位叠 `depthPixels` 层（远暗近亮），这就是厚度；
 *   3. 放大后的图标盖在最前面。
 *
 * ## 为什么不用几何挤出
 *
 * 试过按轮廓挤出面片：轮廓是 1/4 像素格的台阶，斜视时侧壁变成一圈"毛刺"，
 * 既不平滑也谈不上厚实。贴图方案没有这个问题，厚度也只受像素数限制。
 *
 * 代价：这是"一个固定视角的假 3D"。第一人称完全够用；第三人称里物品会随手臂转，
 * 但那个尺寸下（屏高 5% 左右）看不出是烘的。
 */

import * as THREE from 'three';
import { itemIconTile } from '../core/registry/items.ts';
import type { TextureAtlas } from './TextureAtlas.ts';

export interface HeldSpriteOptions {
  /** Scale2x 跑几遍（1 → 2×，2 → 4×，3 → 8×）；越大斜边越顺、画布越大 */
  passes?: number;
  /** 厚度（画布像素）；0 = 不要厚度 */
  depthPixels?: number;
  /** 厚度往哪个方向挤（画布像素方向，会自动归一化） */
  direction?: readonly [number, number];
  /**
   * 握点怎么定：
   *  · `center`（默认）= 内容包围盒的底边中点；
   *  · `handle` = **图标最下面那几行不透明像素的中心**——剑/镐的柄在那里，
   *    包围盒中点会落在刀身上（第三人称看起来"剑柄没握在手里"，用户 20261025 反馈）。
   */
  grip?: 'center' | 'handle';
}

export interface HeldSprite {
  readonly texture: THREE.CanvasTexture;
  /** 画布像素边长 */
  readonly canvasPixels: number;
  /** 正面在画布里的像素边长（左上角恒为 0,0） */
  readonly facePixels: number;
  /** 厚度裙边在右侧/下侧各占多少像素 */
  readonly padPixels: number;
  /** 握点（画布像素，正面左上角为原点）：摆位置时把这个点放到手心 */
  readonly grip: { readonly x: number; readonly y: number };
  dispose(): void;
}

/**
 * 厚度裙边的三档明暗（远 → 近）。
 *
 * ⚠️ 做法是"把图标自己压暗"，不是"填一道灰":填灰会让厚度看起来像一圈投影，
 * 压暗则像是同一件东西被光挤出来的侧面（剑的厚度边仍然是剑的青色）。
 */
const SKIRT_SHADES = [0.44, 0.56, 0.68];

/**
 * Scale2x（EPX）：像素画放大一倍，斜边台阶补成小台阶，**颜色保持不变**。
 *
 * 规则（像素 P 看上下左右 A/B/C/D）：
 * ```
 * e0 = (C==A && C!=D && A!=B) ? C : P   // 左上
 * e1 = (A==B && A!=C && B!=D) ? B : P   // 右上
 * e2 = (D==C && D!=B && C!=A) ? C : P   // 左下
 * e3 = (B==D && B!=A && D!=C) ? B : P   // 右下
 * ```
 * 越界的邻居一律当成"跟谁都不等"，否则边缘会被补出一圈假像素。
 */
function scale2x(source: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): { data: Uint8ClampedArray; width: number; height: number } {
  const { data, width, height } = source;
  const out = new Uint8ClampedArray(width * 2 * height * 2 * 4);
  const outW = width * 2;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const equal = (x1: number, y1: number, x2: number, y2: number): boolean => {
    if (!inside(x1, y1) || !inside(x2, y2)) return false;
    const a = (y1 * width + x1) * 4;
    const b = (y2 * width + x2) * 4;
    return (
      data[a] === data[b] &&
      data[a + 1] === data[b + 1] &&
      data[a + 2] === data[b + 2] &&
      data[a + 3] === data[b + 3]
    );
  };
  const put = (x: number, y: number, fromX: number, fromY: number): void => {
    if (!inside(fromX, fromY)) return;
    const from = (fromY * width + fromX) * 4;
    const to = (y * outW + x) * 4;
    out[to] = data[from]!;
    out[to + 1] = data[from + 1]!;
    out[to + 2] = data[from + 2]!;
    out[to + 3] = data[from + 3]!;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ox = x * 2;
      const oy = y * 2;
      // e0：左上
      put(ox, oy, equal(x - 1, y, x, y - 1) && !equal(x - 1, y, x, y + 1) && !equal(x, y - 1, x + 1, y) ? x - 1 : x, y);
      // e1：右上
      put(
        ox + 1,
        oy,
        equal(x, y - 1, x + 1, y) && !equal(x, y - 1, x - 1, y) && !equal(x + 1, y, x, y + 1) ? x + 1 : x,
        y,
      );
      // e2：左下
      put(
        ox,
        oy + 1,
        equal(x, y + 1, x - 1, y) && !equal(x, y + 1, x + 1, y) && !equal(x - 1, y, x, y - 1) ? x - 1 : x,
        y,
      );
      // e3：右下
      put(
        ox + 1,
        oy + 1,
        equal(x + 1, y, x, y + 1) && !equal(x + 1, y, x, y - 1) && !equal(x, y + 1, x - 1, y) ? x + 1 : x,
        y,
      );
    }
  }
  return { data: out, width: outW, height: height * 2 };
}

/** 把物品图标烘成"有厚度的 2.5D 贴图"。没有 DOM（离线测试）时返回 null。 */
export function buildHeldSprite(
  atlas: TextureAtlas,
  itemId: number,
  options: HeldSpriteOptions = {},
): HeldSprite | null {
  if (typeof document === 'undefined') return null;
  const pixels = atlas.readTile(itemIconTile(itemId));
  if (!pixels) return null;

  const passes = Math.max(1, Math.min(3, Math.round(options.passes ?? 2)));
  let image = scale2x(pixels);
  for (let pass = 1; pass < passes; pass++) image = scale2x(image);
  const facePixels = image.width;

  const depthPixels = Math.max(0, Math.round(options.depthPixels ?? 15));
  const [dirX, dirY] = options.direction ?? [0.55, 0.83];
  const length = Math.hypot(dirX, dirY) || 1;

  const makeCanvas = (size: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
  };

  // ---- 正面：Scale2x 放大的图标（清晰，斜边更顺）
  const face = makeCanvas(facePixels);
  const faceCtx = face.getContext('2d');
  if (!faceCtx) return null;
  // 复制一份到独立 buffer：`ImageData` 的类型要求 ArrayBuffer（不能是 SharedArrayBuffer）
  const faceBuffer = new Uint8ClampedArray(image.data.length);
  faceBuffer.set(image.data);
  faceCtx.putImageData(new ImageData(faceBuffer, facePixels, facePixels), 0, 0);

  // ---- 剪影（三档明暗各一份），用来叠出厚度
  const silhouettes = SKIRT_SHADES.map((shade) => {
    const canvas = makeCanvas(facePixels);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.drawImage(face, 0, 0);
    // `source-atop`：只在图标有像素的地方压暗，颜色与 alpha 都保留
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0,0,0,${(1 - shade).toFixed(3)})`;
    ctx.fillRect(0, 0, facePixels, facePixels);
    return canvas;
  });

  const canvasPixels = facePixels + depthPixels;
  const output = makeCanvas(canvasPixels);
  const ctx = output.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;

  // ---- 厚度：从远到近一层层错位叠（整数像素，保持硬边）
  for (let step = depthPixels; step >= 1; step--) {
    const t = step / depthPixels;
    const index = Math.min(SKIRT_SHADES.length - 1, Math.floor((1 - t) * SKIRT_SHADES.length));
    ctx.drawImage(
      silhouettes[index]!,
      Math.round((dirX / length) * step),
      Math.round((dirY / length) * step),
    );
  }
  ctx.drawImage(face, 0, 0);

  // ---- 握点：内容的底边（y）与"底部那几行"的中心（x）
  //
  // 为什么不是包围盒中点：剑的图标是"柄在左下、刃在右上"的对角线，
  // 包围盒中点落在刀身上，第三人称看起来就是"剑柄没握在手里"。
  let minY = facePixels;
  let bottomY = -1;
  for (let y = 0; y < facePixels; y++) {
    for (let x = 0; x < facePixels; x++) {
      if (image.data[(y * facePixels + x) * 4 + 3]! < 128) continue;
      if (y < minY) minY = y;
      if (y > bottomY) bottomY = y;
    }
  }
  const contentHeight = Math.max(1, bottomY - minY + 1);
  const bandRows = Math.max(2, Math.round(contentHeight * 0.22));
  let bandSum = 0;
  let bandCount = 0;
  for (let y = Math.max(0, bottomY - bandRows + 1); y <= bottomY; y++) {
    for (let x = 0; x < facePixels; x++) {
      if (image.data[(y * facePixels + x) * 4 + 3]! < 128) continue;
      bandSum += x + 0.5;
      bandCount++;
    }
  }
  const contentCenterX = (() => {
    let left = facePixels;
    let right = -1;
    for (let y = 0; y < facePixels; y++) {
      for (let x = 0; x < facePixels; x++) {
        if (image.data[(y * facePixels + x) * 4 + 3]! < 128) continue;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    return right < 0 ? facePixels / 2 : (left + right + 1) / 2;
  })();
  const handleX = bandCount > 0 ? bandSum / bandCount : contentCenterX;
  const gripX = (options.grip ?? 'center') === 'handle' ? handleX : contentCenterX;
  const gripY = bottomY < 0 ? facePixels / 2 : bottomY + 1;

  const texture = new THREE.CanvasTexture(output);
  // 与图集同一套色彩口径（图集是 NoColorSpace），否则手里那件会偏色
  texture.colorSpace = THREE.NoColorSpace;
  // 最近邻 + 无 mipmap：放大时保持像素的硬边（用户："要清晰"）
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return {
    texture,
    canvasPixels,
    facePixels,
    padPixels: depthPixels,
    grip: { x: gripX, y: gripY },
    dispose: () => texture.dispose(),
  };
}
