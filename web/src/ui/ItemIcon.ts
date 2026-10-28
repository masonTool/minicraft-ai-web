/**
 * 物品图标绘制
 *
 * 图标不单独出图，直接从纹理图集里裁一块放大到目标尺寸。
 * 关闭图像平滑，保证放大后仍是清晰的像素风。
 *
 * **方块物品另走一条路**（`ui/BlockIcon.ts`）：它有 顶/底/侧 三张贴图，
 * 会被拼成一个等轴立方体再画进来——原版物品栏里的方块就是立体的。
 * 拿不到（平面形状 / 无 DOM）才回退到下面的单格裁切。
 *
 * ⚠️ **手机上要按 `devicePixelRatio` 放大背板**（批次 95，见 `iconBackingScale`）：
 * `canvas.width/height` 的单位是**设备像素**，只写 `size` 的话浏览器得把这张位图
 * 再放大 2~3 倍才显示成 `size` CSS px——物品图标在手机上因此发虚。
 * 注意**不设内联的 CSS 尺寸**：宽高由样式表按屏幕断点控制（小屏的快捷栏会缩小），
 * 内联会盖掉断点。
 */

import { TILE_SIZE, type TextureAtlas } from '../render/TextureAtlas.ts';
import { blockForItem, itemIconTile } from '../core/registry/items.ts';
import { blockIconCanvas } from './BlockIcon.ts';
import { devicePixelRatioValue } from './Device.ts';

export const DEFAULT_ICON_SIZE = 36;

/**
 * 图标的**背板倍率**：`ceil(dpr)` 夹到 1~**3**（批次 216：原来夹到 2）。
 *
 * 原来夹到 2 的理由是"3 倍屏上多一倍看不出来"——这条在**大图标**上成立，
 * 但在 3 倍屏手机上不成立：快捷栏/背包里的图标只有 32~36 CSS px，
 * 2 倍背板（72 px 位图）摊到 108 个物理像素上，边缘会被插值糊掉一圈，
 * 用户的原话正是"物品的边缘不清楚，有点粗糙"。
 * 图标是 16×16 的图集格子放大画出来的，背板提到 3 倍只多几 KB 位图与一次
 * `drawImage`，代价可以忽略；而这一项**不占 GPU 每帧预算**（画一次就缓存住），
 * 正好符合"先保帧率、再保画质"的取舍。
 */
export function iconBackingScale(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 1) return 1;
  return Math.min(3, Math.max(1, Math.round(dpr)));
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

  // 方块物品：画等轴立方体（顶面 + 左右两个侧面，逐面明暗）。
  // 缓存住在 BlockIcon 里，这里只是一次 drawImage，和原来一样便宜。
  const block = blockForItem(itemId);
  const iso = block === undefined ? null : blockIconCanvas(atlas, block);
  if (iso) {
    ctx.drawImage(iso, 0, 0, iso.width, iso.height, 0, 0, pixels, pixels);
    return;
  }

  // 非方块物品 / 平面形状：图集是网格排布，裁切起点必须走 tileSource
  // （不能用"列号 × 宽度"直接算）
  const source = atlas.tileSource(itemIconTile(itemId));
  ctx.drawImage(atlas.canvas, source.x, source.y, TILE_SIZE, TILE_SIZE, 0, 0, pixels, pixels);
}
