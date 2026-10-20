import { blockTiles } from '../../core/registry/blocks.ts';
import { ATLAS_COLUMNS, TILE_ORDER, TILE_SIZE, type TextureAtlas } from '../../render/TextureAtlas.ts';

/** 从图集裁一个方块顶面 tile 画到 2D canvas；快捷栏/背包共用 */
export function drawBlockIcon(
  context: CanvasRenderingContext2D,
  atlas: TextureAtlas,
  blockId: number,
  x: number,
  y: number,
  size: number,
): void {
  const tile = blockTiles(blockId, 0)[0];
  const tileIndex = (TILE_ORDER as readonly string[]).indexOf(tile);
  if (tileIndex < 0) return;
  const sx = (tileIndex % ATLAS_COLUMNS) * TILE_SIZE;
  const sy = Math.floor(tileIndex / ATLAS_COLUMNS) * TILE_SIZE;
  const inset = Math.max(2, Math.floor(size * 0.1));
  context.drawImage(
    atlas.canvas,
    sx,
    sy,
    TILE_SIZE,
    TILE_SIZE,
    x + inset,
    y + inset,
    size - inset * 2,
    size - inset * 2,
  );
}
