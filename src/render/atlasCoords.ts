/**
 * 图集坐标（唯一口径，批次 273 / 425）
 *
 * 本项目的渲染管线统一采用 **v=0 在贴图底边** 的 UV 约定：
 *  - 体素网格里，侧面底边顶点的局部 uv.y = 0、顶边 = 1；
 *  - `atlasMesh` 的 `FACE_UV_PATTERN` 也按"左上角取 v1"写；
 *  - three 的 CanvasTexture 默认 `flipY = true`，上传后 v=0 正好是画布的**最后一行**。
 *
 * 但画布是自上而下画的（第 0 行在最上面），所以"第 r 行贴图"的**底边**在
 * `1 - (r + 1) / rows`，而不是 `r / rows`。这两处换算必须只有一份：
 * 之前 `TextureAtlas` 与 `chunk.worker` 各写一遍，且都按"v=0 是画布顶部"来算，
 * 又在纹理上关掉了 flipY；结果 atlas 行号对了，但**每张贴图上下颠倒**——
 * 最明显的表现就是草方块侧面的草长在下面。
 *
 * ## 边距（批次 520）
 *
 * 上传用的图集每格 32 纹素：内容 16×16 居中、四周 8 纹素是边缘外扩（见
 * `atlasLayout.TILE_PADDING`）。所以"这张贴图的起点"不再是格子的角，而是
 * **内容区的左下角**——`pad` 参数就是那 8 个纹素。传 0 得到的就是老口径
 * （内容紧贴格子，像素级读取/离线测试用的就是它）。
 *
 * ⚠️ 改动这里之前先确认 `TextureAtlas.texture.flipY` 仍是 true，并且所有几何体
 * 的局部 v 仍是"0 = 底边、1 = 顶边"。两边只要有一边反了，所有带上下方向的贴图都会翻。
 */

import { TILE_SIZE } from './atlasLayout.ts';

/**
 * 某张贴图**内容区**在图集里的左下角（UV，未内缩）。
 *
 * @param index 贴图在 `TILE_ORDER` 里的下标
 * @param columns 图集列数
 * @param rows 图集行数
 * @param pad 内容区四周的边距（纹素，0 = 紧贴格子）
 */
export function tileOriginAt(index: number, columns: number, rows: number, pad = 0): [number, number] {
  const stride = TILE_SIZE + pad * 2;
  const width = columns * stride;
  const height = rows * stride;
  const col = index % columns;
  const row = Math.floor(index / columns);
  // 画布自上而下：内容区左上角是 (row*stride + pad)，底边还要再加上内容的高度
  return [(col * stride + pad) / width, 1 - (row * stride + pad + TILE_SIZE) / height];
}

/** 单张贴图**内容区**占图集的 UV 尺寸（所有贴图相同） */
export function tileSpanAt(columns: number, rows: number, pad = 0): [number, number] {
  const stride = TILE_SIZE + pad * 2;
  return [TILE_SIZE / (columns * stride), TILE_SIZE / (rows * stride)];
}

/**
 * 某张贴图在图集里的 `[u0, v0, u1, v1]`（左下 → 右上，已按半像素内缩）。
 *
 * 内缩方向：v0 从底边**向上**收、v1 从顶边**向下**收——不能直接 + 同一个方向，
 * 否则翻转之后内缩会跑到贴图外（采到邻居）。
 */
export function tileRectAt(
  index: number,
  columns: number,
  rows: number,
  insetU: number,
  insetV: number,
  pad = 0,
): [number, number, number, number] {
  const [u0, v0] = tileOriginAt(index, columns, rows, pad);
  const [spanU, spanV] = tileSpanAt(columns, rows, pad);
  return [u0 + insetU, v0 + insetV, u0 + spanU - insetU, v0 + spanV - insetV];
}
