import { blockForItem, itemIconTile } from '../core/registry/items.ts';
import { blockTiles } from '../core/registry/blocks.ts';
import { ATLAS_COLUMNS, TILE_ORDER, TILE_SIZE } from '../render/TextureAtlas.ts';
import type { TextureAtlas } from '../render/TextureAtlas.ts';

/**
 * 背包/HUD 的物品图标。
 * UI 只关心“画哪个物品”，图集布局与 UV 换算留在这里。
 */
export function drawBlockIcon(
  atlas: TextureAtlas,
  ctx: CanvasRenderingContext2D,
  itemId: number,
  x: number,
  y: number,
  size: number,
): void {
  const inset = Math.max(2, Math.floor(size * 0.1));
  const block = blockForItem(itemId);
  if (block !== undefined) {
    const tile = blockTiles(block, 0)[0];
    const tileIndex = (TILE_ORDER as readonly string[]).indexOf(tile);
    if (tileIndex < 0) return;
    const sx = (tileIndex % ATLAS_COLUMNS) * TILE_SIZE;
    const sy = Math.floor(tileIndex / ATLAS_COLUMNS) * TILE_SIZE;
    ctx.drawImage(atlas.canvas, sx, sy, TILE_SIZE, TILE_SIZE, x + inset, y + inset, size - inset * 2, size - inset * 2);
    return;
  }
  const source = atlas.tileSource(itemIconTile(itemId));
  ctx.drawImage(atlas.canvas, source.x, source.y, TILE_SIZE, TILE_SIZE, x + inset, y + inset, size - inset * 2, size - inset * 2);
}
