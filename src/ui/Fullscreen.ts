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

type OrientationTarget = {
  type?: string;
  lock?: (orientation: string) => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
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

function orientationTarget(): OrientationTarget | null {
  if (typeof screen === 'undefined') return null;
  return (screen.orientation as OrientationTarget | undefined) ?? null;
}

/**
 * 页面现在是不是横屏布局。
 *
 * 以视口宽高为准：模拟器、带地址栏的浏览器里 `screen.orientation.type`
 * 可能和真正用来排版的 `innerWidth/innerHeight` 不一致。提示层如果听错这一边，
 * 竖屏上就不会出现。
 */
export function isLandscapeOrientation(): boolean {
  if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
    return window.innerWidth >= window.innerHeight;
  }
  const type = orientationTarget()?.type ?? '';
  if (type.startsWith('landscape')) return true;
  if (type.startsWith('portrait')) return false;
  return true;
}

/**
 * 锁成横屏。
 *
 * 手机浏览器里这一步通常要满足两件事：已经全屏（或装成了 PWA）、而且调用栈里还有用户手势。
 * 做不到就静默失败——iOS Safari 的标签页根本没有这个 API，不能让它打断进游戏。
 */
export function lockLandscape(): void {
  const orientation = orientationTarget();
  if (!orientation || typeof orientation.lock !== 'function') return;
  if (orientation.type?.startsWith('landscape')) return;
  try {
    const result = orientation.lock('landscape');
    void result?.catch(() => {
      /* 还没全屏、或这台浏览器不给锁：下面还有全屏回调里的再试一次 */
    });
  } catch {
    /* 同步抛错（老 WebKit）同样忽略 */
  }
}

/** 请求全屏；不支持或被拒时静默忽略。返回的 Promise 在已经进了全屏、或根本没发出去时为 null。 */
export function enterFullscreen(): Promise<void> | null {
  const doc = fullscreenDocument();
  if (!doc || isFullscreen()) return null;
  const element = doc.documentElement as FullscreenCapableElement;
  try {
    if (typeof element.requestFullscreen === 'function') {
      const result = element.requestFullscreen({ navigationUI: 'hide' }) as unknown as Promise<void> | undefined;
      void result?.catch(() => {
        /* 被拒（iframe 权限、用户设置…）：全屏只是加成，忽略 */
      });
      return result ?? null;
    }
    if (typeof element.webkitRequestFullscreen === 'function') {
      element.webkitRequestFullscreen();
    }
  } catch {
    /* 同上 */
  }
  return null;
}

/**
 * 手机上一次手势要同时做完的两件事：全屏 + 横屏。
 *
 * 锁方向必须跟在全屏成功之后再要一次——Chrome 会拒绝"还没全屏就 lock"，
 * 但这次拒绝发生在微任务里，用户手势已经不在了，所以**同一轮里先直接锁一次**
 * （已安装的 PWA 不需要全屏也允许锁），再在全屏 Promise 完成时补一次。
 */
export function enterMobilePresentation(): void {
  const pending = enterFullscreen();
  lockLandscape();
  // 全屏被拒时不要再冒出一条未处理的 rejection（then 自己也会再包一层）
  void pending?.then(() => lockLandscape()).catch(() => undefined);
}

/** 装到主屏之后打开：没有浏览器按钮可点，能锁就立刻锁（这个上下文里通常允许）。 */
export function preferInstalledLandscape(): void {
  if (typeof window === 'undefined') return;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone || isFullscreen()) lockLandscape();
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
    enterMobilePresentation();
    syncRotateHint();
  };

  for (const element of elements) element.addEventListener('pointerdown', trigger);
  return detach;
}

const ROTATE_HINT_ID = 'rotate-hint';

/**
 * 竖屏手机上盖一层提示，点它本身就是那一次用户手势（全屏 + 锁横屏）。
 *
 * 只在触摸设备上挂：桌面把窗口拉成竖条时不该挡主菜单。
 * 锁成功或玩家自己转过来之后，横屏媒体查询不再命中，这一层收起。
 */
export function installRotateHint(): void {
  const doc = fullscreenDocument();
  if (!doc || doc.getElementById(ROTATE_HINT_ID)) return;
  if (!isCoarsePointer()) return;

  const hint = doc.createElement('div');
  hint.id = ROTATE_HINT_ID;
  hint.className = 'rotate-hint';
  const title = doc.createElement('b');
  title.textContent = '请横持手机';
  const detail = doc.createElement('span');
  detail.textContent = '点一下进入全屏';
  hint.append(title, detail);
  hint.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    enterMobilePresentation();
    syncRotateHint();
  });
  doc.body.appendChild(hint);

  const sync = (): void => syncRotateHint();
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  orientationTarget()?.addEventListener?.('change', sync);
  syncRotateHint();
}

/** 竖屏才露出；横屏（锁上了或玩家转过来了）立刻拿掉，免得盖住菜单。 */
export function syncRotateHint(): void {
  const doc = fullscreenDocument();
  const hint = doc?.getElementById(ROTATE_HINT_ID);
  if (!hint) return;
  hint.classList.toggle('visible', !isLandscapeOrientation());
}

function isCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  return coarse && hasTouch;
}
