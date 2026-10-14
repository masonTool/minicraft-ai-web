/**
 * 物品图标绘制
 *
 * 图标不单独出图，直接从纹理图集里裁一块放大到目标尺寸。
 * 关闭图像平滑，保证放大后仍是清晰的像素风。
 */

import { TILE_SIZE, type TextureAtlas } from '../render/TextureAtlas.ts';
import { itemIconTile } from '../core/registry/items.ts';

export const DEFAULT_ICON_SIZE = 36;

export function drawItemIcon(
  canvas: HTMLCanvasElement,
  atlas: TextureAtlas,
  itemId: number,
  size: number = DEFAULT_ICON_SIZE,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);

  const column = atlas.tileIndex(itemIconTile(itemId));
  ctx.drawImage(atlas.canvas, column * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE, 0, 0, size, size);
}
