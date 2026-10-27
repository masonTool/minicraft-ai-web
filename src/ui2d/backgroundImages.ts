/**
 * 背景图的小缓存（CSS `background-image: url(...)` → `<img>` 位图）
 *
 * 镜像要画"世界卡片的缩略图"，而它是一张写在**内联样式**里的 `data:` URL：
 * canvas 没法直接按 CSS 画背景图，只能自己 `new Image()` 载进来再 `drawImage`。
 *
 * 两个约束：
 *  - 图片是**异步**的：第一次读到时通常还没解码完，所以 `get()` 先返回 null、下一帧再画；
 *  - `data:` URL 很长（一张缩略图几十 KB 的 base64），所以按 URL 缓存，别每次重载。
 */

const cache = new Map<string, HTMLImageElement>();
/**
 * 已经载完的图片数。
 *
 * 为什么需要它：镜像靠"签名变了才重画"，而图片是**异步**载入的 —— 不把"载完了几张"
 * 放进签名，第一帧画完底色就再也不会重画，缩略图永远是空的。
 */
let loaded = 0;

/** 按 URL 取图片；没载完返回 `null`（调用方先画底色，下一帧自然就有了） */
export function getBackgroundImage(url: string): HTMLImageElement | null {
  const hit = cache.get(url);
  if (hit) return hit.complete && hit.naturalWidth > 0 ? hit : null;
  const image = new Image();
  image.decoding = 'async';
  image.addEventListener('load', () => {
    loaded += 1;
  });
  image.src = url;
  cache.set(url, image);
  return null;
}

/** 清空缓存（资源包热重载/换世界列表时用；测试里也用得上） */
export function clearBackgroundImages(): void {
  cache.clear();
  loaded = 0;
}

/** 已经载完的图片数（放进镜像签名，载完时触发一次重画） */
export function loadedBackgroundImages(): number {
  return loaded;
}

/** 当前缓存了多少张（调试/断言用） */
export function backgroundImageCount(): number {
  return cache.size;
}

/**
 * 把图片按 `cover` 塞进矩形（裁掉溢出的部分，保持比例）。
 *
 * 缩略图的 CSS 是 `background-size: cover`，直接用 `drawImage(img, x, y, w, h)` 会拉变形。
 */
export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): void {
  const sourceW = image.naturalWidth;
  const sourceH = image.naturalHeight;
  if (!(sourceW > 0) || !(sourceH > 0) || !(rect.w > 0) || !(rect.h > 0)) return;
  const scale = Math.max(rect.w / sourceW, rect.h / sourceH);
  const w = sourceW * scale;
  const h = sourceH * scale;
  ctx.drawImage(image, rect.x + (rect.w - w) / 2, rect.y + (rect.h - h) / 2, w, h);
}
