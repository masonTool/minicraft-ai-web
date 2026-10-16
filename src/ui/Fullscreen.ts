/**
 * 全屏（用户要求：进游戏首页就默认进全屏）
 *
 * ⚠️ 浏览器**不允许**"页面加载完就自动进全屏"：`requestFullscreen()` 只能在
 * **用户手势**（点击/按键）的调用栈里发出，否则一律被拒。所以这里不去跟浏览器较劲，
 * 而是把全屏请求挂到主菜单的"第一次点击"上——玩家点第一下（无论是"开始游戏"还是
 * 点开始遮罩）时全屏就已经进去了，体感就是"进游戏就全屏"。
 *
 * 三个刻意的选择：
 *  1. **一次性**：触发后立刻摘掉监听。否则每次点菜单按钮都再请求一次全屏
 *     （已经在全屏里时会被浏览器拒掉并抛 unhandled rejection）；
 *  2. **静默失败**：iOS Safari 只给 `<video>` 全屏、iframe 少了 `allow="fullscreen"`
 *     也会拒绝。全屏只是体验加成，失败绝不该打断"进游戏"这件事；
 *  3. **前缀兜底**：老 WebKit 只有 `webkitRequestFullscreen`
 *     （本项目是按"能跑在手机浏览器上"写的，这层兜底不贵）。
 */

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};

type FullscreenCapableDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

function fullscreenDocument(): FullscreenCapableDocument | null {
  return typeof document === 'undefined' ? null : (document as FullscreenCapableDocument);
}

/** 现在是不是全屏（含 WebKit 前缀） */
export function isFullscreen(): boolean {
  const doc = fullscreenDocument();
  if (!doc) return false;
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** 请求全屏；不支持或被拒时静默忽略 */
export function enterFullscreen(): void {
  const doc = fullscreenDocument();
  if (!doc || isFullscreen()) return;
  const element = doc.documentElement as FullscreenCapableElement;
  try {
    if (typeof element.requestFullscreen === 'function') {
      const result = element.requestFullscreen() as unknown as Promise<void> | undefined;
      result?.catch(() => {
        /* 被拒（iframe 权限、用户设置…）：全屏只是加成，忽略 */
      });
    } else if (typeof element.webkitRequestFullscreen === 'function') {
      element.webkitRequestFullscreen();
    }
  } catch {
    /* 同上 */
  }
}

/** 退出全屏；没在全屏里时什么都不做 */
export function exitFullscreen(): void {
  const doc = fullscreenDocument();
  if (!doc || !isFullscreen()) return;
  try {
    if (typeof doc.exitFullscreen === 'function') {
      const result = doc.exitFullscreen() as unknown as Promise<void> | undefined;
      result?.catch(() => undefined);
    } else if (typeof doc.webkitExitFullscreen === 'function') {
      doc.webkitExitFullscreen();
    }
  } catch {
    /* 忽略：退出失败也只是留在全屏里 */
  }
}

export function toggleFullscreen(): void {
  if (isFullscreen()) exitFullscreen();
  else enterFullscreen();
}

/**
 * 把"第一次点一下就进全屏"挂到给定元素上（主菜单 + 开始遮罩）。
 *
 * 只挂一次、只触发一次：第一个 `pointerdown` 一到就把所有监听摘掉，
 * 之后玩家在全屏里的所有点击都与这里无关。
 *
 * 返回一个"撤销"函数，方便测试与将来换触发点（现在没人调，但比写死成不可撤销好）。
 */
export function armAutoFullscreen(targets: ReadonlyArray<HTMLElement | null | undefined>): () => void {
  const elements = targets.filter((target): target is HTMLElement => Boolean(target));
  if (elements.length === 0) return () => undefined;

  const detach = (): void => {
    for (const element of elements) element.removeEventListener('pointerdown', trigger);
  };
  const trigger = (): void => {
    detach();
    enterFullscreen();
  };

  for (const element of elements) element.addEventListener('pointerdown', trigger);
  return detach;
}
