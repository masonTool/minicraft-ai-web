/**
 * 画布内容探针（批次 295）
 *
 * **要解决的问题**：安卓 Chrome 在页面长时间隐藏后（tab 冻结 / 显存回收）会把 2D canvas
 * 的**后备存储丢掉**，回到前台时画布是透明的。而本项目的图标全是"从图集裁一刀、
 * 画一次就缓存"的产物——画布一空、又没人重画，表现就是真机日志里那句
 * "3D 世界好好的，好多图标都不见了"。
 *
 * **为什么判据是像素而不是事件**：`contextlost` / `contextrestored` 已经进标准，
 * 但兼容性有限（部分 WebView 根本不发）。而"画布被清空"在任何实现里都是同一个样子：
 * 原来不透明的像素变成 `alpha = 0`。所以画完时记下几个"一定不透明"的取样点，
 * 回前台时只回读这几格，就知道要不要把整张图集重画一遍。
 *
 * 阈值与 `TextureAtlas.averageColor` / `tileOpacity` 的"算不透明"保持一致（`alpha >= 8`），
 * 免得出现"这里说没丢、那里说全透明"的两套口径。
 */

/** "算不透明"的门槛（0~255）：与 `averageColor` / `tileOpacity` 同一个数 */
export const PROBE_ALPHA_MIN = 8;

/** 一个取样点（画布像素坐标） */
export interface PixelSample {
  readonly x: number;
  readonly y: number;
}

/** 回读某一格像素；返回 `null` 表示读不出来（上下文正丢着 / 已抛异常） */
export type ReadPixel = (sample: PixelSample) => ArrayLike<number> | null;

/**
 * 从 RGBA 数据里挑若干个"当时一定不透明"的取样点。
 *
 * 分成 `limit` 个窗口各自找第一个不透明像素：这样几个点会**分散在图集的不同位置**，
 * 不会被某一张被资源包换成透明图的贴图一起废掉（判据只看"还有没有一个不透明"）。
 * 全是透明（或数据为空）时返回空数组——调用方据此认为"没法判断"，不要瞎重画。
 */
export function pickOpaqueSamples(data: ArrayLike<number>, width: number, limit = 4): PixelSample[] {
  const pixels = Math.floor(data.length / 4);
  if (pixels <= 0 || !Number.isFinite(width) || width <= 0 || limit <= 0) return [];

  const samples: PixelSample[] = [];
  const window = Math.max(1, Math.floor(pixels / limit));
  for (let part = 0; part < limit; part++) {
    const start = part * window;
    const end = part === limit - 1 ? pixels : Math.min(pixels, start + window);
    for (let index = start; index < end; index++) {
      if ((data[index * 4 + 3] ?? 0) < PROBE_ALPHA_MIN) continue;
      samples.push({ x: index % width, y: Math.floor(index / width) });
      break;
    }
  }
  return samples;
}

/**
 * 取样点现在是不是**全透明**了（= 画布内容被系统清空）。
 *
 * - 没有任何取样点 → `false`：没有判据时宁可不动（重画整张图集要几十毫秒）；
 * - 只要有一个点还读得到不透明像素 → `false`；
 * - 全部读回 alpha 0、或者全读不出来（上下文丢了）→ `true`。
 */
export function canvasLooksLost(samples: readonly PixelSample[], read: ReadPixel): boolean {
  if (samples.length === 0) return false;
  for (const sample of samples) {
    const rgba = read(sample);
    if (rgba !== null && (rgba[3] ?? 0) >= PROBE_ALPHA_MIN) return false;
  }
  return true;
}

/**
 * 2D 上下文是不是正丢着。
 *
 * `isContextLost()` 兼容性有限：没有这个方法就按"没丢"处理，交给上面的像素判据兜底，
 * 不要在旧 WebView 上把"能正常画"误判成丢上下文。
 */
export function is2dContextLost(context: unknown): boolean {
  const api = context as { isContextLost?: () => boolean } | null;
  return typeof api?.isContextLost === 'function' ? api.isContextLost() : false;
}

/**
 * 把"源图集画布"上的取样点换算到"上传图集画布"上（批次 523）。
 *
 * **为什么需要这条换算**：图集有两张画布——源画布每格 16×16 紧挨着，
 * 上传画布每格 `stride`（= 16 + 两侧边距）且内容居中。系统回收 2D 后备存储时
 * 是**按单张画布**决定的：真机上出现过"源画布还在、上传画布空了"，
 * 于是 GPU 重新上传时拿到的是一整张透明图集（表现：整个世界被 alphaTest 丢掉，
 * 只剩天空/云/雨这类不采样图集的东西）。
 *
 * 要在上传画布上问同一句话，就得把取样点搬过去：先按 `tileSize` 定位是哪一格，
 * 再取格内偏移。
 */
export function uploadSampleAt(
  sample: PixelSample,
  columns: number,
  tileSize: number,
  stride: number,
  padding: number,
): PixelSample {
  const index = Math.floor(sample.y / tileSize) * columns + Math.floor(sample.x / tileSize);
  const col = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: col * stride + padding + (sample.x % tileSize),
    y: row * stride + padding + (sample.y % tileSize),
  };
}
