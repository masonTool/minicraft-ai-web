/**
 * 物品图标绘制
 *
 * 图标不单独出图，直接从纹理图集里裁一块放大到目标尺寸。
 * 关闭图像平滑，保证放大后仍是清晰的像素风。
 *
 * ⚠️ **手机上要按 `devicePixelRatio` 放大背板**（批次 95，见 `iconBackingScale`）：
 * `canvas.width/height` 的单位是**设备像素**，只写 `size` 的话浏览器得把这张位图
 * 再放大 2~3 倍才显示成 `size` CSS px——物品图标在手机上因此发虚。
 * 注意**不设内联的 CSS 尺寸**：宽高由样式表按屏幕断点控制（小屏的快捷栏会缩小），
 * 内联会盖掉断点。
 */

import { TILE_SIZE, type TextureAtlas } from '../render/TextureAtlas.ts';
import { itemIconTile } from '../core/registry/items.ts';
import { devicePixelRatioValue } from './Device.ts';

export const DEFAULT_ICON_SIZE = 36;

/**
 * 图标的**背板倍率**：`ceil(dpr)` 夹到 1~2。
 *
 * 为什么最多 2 倍：与渲染器 `setPixelRatio(Math.min(devicePixelRatio, 2))` 同一个口径——
 * 3 倍屏上那多出来的一倍几乎看不出来，而图集本身一格只有 16 px，
 * 放到 3 倍就是把 16 个像素摊成 84 个（依然"块状"，只是更大更糊）。
 */
export function iconBackingScale(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 1) return 1;
  return Math.min(2, Math.max(1, Math.round(dpr)));
}

/** 当前设备的背板倍率（浏览器之外一律 1） */
export function currentIconBackingScale(): number {
  return iconBackingScale(devicePixelRatioValue());
}

/** 优先采用 CSS 实际显示尺寸；元素尚未挂进 DOM 时回退调用方给的设计尺寸。 */
export function iconDisplaySize(measuredCssPixels: number, fallback: number): number {
  return Number.isFinite(measuredCssPixels) && measuredCssPixels > 0 ? measuredCssPixels : fallback;
}

export function drawItemIcon(
  canvas: HTMLCanvasElement,
  atlas: TextureAtlas,
  itemId: number,
  size: number = DEFAULT_ICON_SIZE,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // 背板按**实际 CSS 显示尺寸**放大。快捷栏在桌面是 32px、手机是 36px，
  // 创造栏又是 28px；固定拿调用处的 size 会在某些断点形成 64→36 这类非整数缩放。
  const displaySize = iconDisplaySize(canvas.clientWidth, size);
  const pixels = Math.max(1, Math.round(displaySize * currentIconBackingScale()));
  if (canvas.width !== pixels) canvas.width = pixels;
  if (canvas.height !== pixels) canvas.height = pixels;
  // 某些临时界面（交易、附魔花费、提示卡）没有各自的 canvas CSS 规则。
  // 把像素缩放规则落在唯一绘制入口，保证物品图标无论出现在哪都不会被双线性滤糊。
  canvas.style.imageRendering = 'pixelated';

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, pixels, pixels);

  // 图集是网格排布，裁切起点必须走 tileSource（不能用"列号 × 宽度"直接算）
  const source = atlas.tileSource(itemIconTile(itemId));
  ctx.drawImage(atlas.canvas, source.x, source.y, TILE_SIZE, TILE_SIZE, 0, 0, pixels, pixels);
}
