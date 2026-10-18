/**
 * 全屏（用户要求：进游戏首页就默认进全屏）
 *
 * ⚠️ 浏览器**不允许**"页面加载完就自动进全屏"：`requestFullscreen()` 只能在
 * **用户手势**（点击/按键）的调用栈里发出，否则一律被拒。
 * 批次 167 起分三层做（用户反馈"手机上需要点一下才进入全屏横屏"）：
 *  1. `enterFullscreenOnBoot()`：加载时**先试一次**——PWA（manifest 是
 *     `display: fullscreen` + `orientation: landscape`）与微信/QQ 的 X5 内核里它真能成；
 *  2. `armAutoFullscreen()`：被拒时挂在 **`document` 的捕获阶段**上，
 *     任何第一次交互（点击 / 触摸 / 按键）都再要一次；
 *  3. `ui/InstallHint.ts`：没装成 PWA 时引导一次"添加到主屏幕"——
 *     这是普通浏览器里**唯一真正零点击**的全屏路径（装完打开就是全屏横屏）。
 *
 * ⚠️ 批次 181：竖屏提示层从**整屏黑幕**改成底部横条（见 `installRotateHint`）。
 * 黑幕会把主菜单一起盖住，用户体感是"退出到了另一个页面"；横条让菜单始终可用。
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

/**
 * 现在是不是"已经装成 App"（standalone / fullscreen 显示模式，或 iOS 的 `navigator.standalone`）。
 *
 * 两种用途：① 装好之后能直接锁方向（不需要先全屏）；② 反过来——**只有没装的时候**
 * 才该去引导"添加到主屏幕"（见 `ui/InstallHint.ts`）。
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
    (typeof navigator !== 'undefined' &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true);
  return standalone;
}

/** 装到主屏之后打开：没有浏览器按钮可点，能锁就立刻锁（这个上下文里通常允许）。 */
export function preferInstalledLandscape(): void {
  if (typeof window === 'undefined') return;
  if (isStandalone() || isFullscreen()) lockLandscape();
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
 * 页面一加载就**试着**进全屏 + 锁横屏（批次 167，用户："能不能在加载的时候自动进入"）。
 *
 * ⚠️ 老实说：`requestFullscreen()` 的规范要求"用户激活"，所以普通浏览器标签页里
 * 这一次调用**一定被拒**（`enterFullscreen()` 内部已经静默 catch 掉了）。
 * 但它不是白调的——下面三种上下文里它真的会成功，而它们正是手机玩家的主要入口：
 *   · 已装成 PWA（manifest 是 `display: fullscreen` + `orientation: landscape`）；
 *   · 微信 / QQ 的 X5 内核（`x5-fullscreen` / `x5-orientation` 两个 meta 已经写在
 *     `index.html` 里，那边**不需要**手势）；
 *   · 部分把页面当成"应用窗口"打开的内核。
 * 被拒时不算失败：第一笔落地的 `pointerdown/touchstart/keydown` 会再要一次
 * （见 `armAutoFullscreen`），所以玩家体感是"随便碰一下就全屏"。
 */
export function enterFullscreenOnBoot(): void {
  const doc = fullscreenDocument();
  if (!doc) return;
  enterMobilePresentation();
  // 切回前台时补一次：有些内核在"页面重新可见"这一刻放行（浏览器切后台再回来很常见）
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible' || isFullscreen()) return;
    enterMobilePresentation();
  });
}

/** 一次手势要监听的事件（触摸 / 鼠标 / 键盘都算"第一次交互"） */
const BOOT_GESTURES = ['pointerdown', 'touchstart', 'keydown'] as const;

/**
 * 把"第一次交互就进全屏"挂到给定目标上（默认 `document`）。
 *
 * 只挂一次、只触发一次：第一个手势一到就把所有监听摘掉，
 * 之后玩家在全屏里的所有点击都与这里无关。
 *
 * ⚠️ 批次 167 起**挂在 `document` 的捕获阶段**，而不是"主菜单那块 DOM"上：
 * 用户反馈"手机上需要点一下才进全屏"，而原来只有点在菜单上才算数——
 * 现在点任何地方（包括竖屏提示层、系统返回、键盘）都算第一次交互。
 *
 * 返回一个"撤销"函数，方便测试与将来换触发点。
 */
export function armAutoFullscreen(
  targets?: ReadonlyArray<EventTarget | null | undefined>,
): () => void {
  const fallback: EventTarget[] = typeof document === 'undefined' ? [] : [document];
  const elements = (targets ?? fallback).filter((target): target is EventTarget => Boolean(target));
  if (elements.length === 0) return () => undefined;

  function detach(): void {
    for (const element of elements) {
      for (const type of BOOT_GESTURES) element.removeEventListener(type, trigger, true);
    }
  }
  function trigger(): void {
    detach();
    enterMobilePresentation();
    syncRotateHint();
  }

  for (const element of elements) {
    for (const type of BOOT_GESTURES) element.addEventListener(type, trigger, true);
  }
  return detach;
}

/**
 * 竖屏时"点任何地方都进横屏全屏"（批次 184，用户要求）。
 *
 * 与 `armAutoFullscreen` 的区别是**它不是一次性的**：
 *  - `armAutoFullscreen` 只管"第一次交互"那一下，成功失败都摘掉监听；
 *    而手机上第一次请求常见地被拒（不在全屏、方向锁要等全屏完成），
 *    之后再点就没人管了，玩家体感是"点了很多下才横过来"。
 *  - 这一条一直挂着，只在"已经横屏且已经全屏"时什么都不做；
 *    其余时候每一笔落地的点击都再要一次（`enterMobilePresentation` 内部静默失败）。
 *
 * 只挂给**粗指针**（触摸）设备：桌面把窗口拉成竖条时不该每点一下都请求全屏。
 * 返回撤销函数，方便测试与将来换触发点。
 */
export function armPresentOnTap(target: EventTarget | null = null): () => void {
  const element = target ?? (typeof document === 'undefined' ? null : document);
  if (!element || !isCoarsePointer()) return () => undefined;
  const types = ['pointerdown', 'touchstart'] as const;
  const trigger = (): void => {
    if (isFullscreen() && isLandscapeOrientation()) return;
    enterMobilePresentation();
    // 全屏/转向都是异步的：提示条晚一点再对一次账
    if (typeof window !== 'undefined') window.setTimeout(syncRotateHint, 200);
  };
  for (const type of types) element.addEventListener(type, trigger, true);
  return () => {
    for (const type of types) element.removeEventListener(type, trigger, true);
  };
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
  const phone = doc.createElement('div');
  phone.className = 'rotate-phone';
  const title = doc.createElement('b');
  title.textContent = '请横屏游玩';
  const detail = doc.createElement('span');
  detail.textContent = '点一下进入全屏并横屏 · 把手机横过来也会自动开始';
  hint.append(phone, title, detail);
  // 批次 212：**整屏任何位置**都算点击（不再依赖点中提示层本身）。
  // 用 document 的捕获阶段：即使有别的浮层压在它上面，这一下也先落到这里。
  // ⚠️ 暂停菜单开着时 CSS 会把这一层 `display:none`，那种情况下不要抢按钮的点击。
  doc.addEventListener(
    'pointerdown',
    (event) => {
      if (!hint.classList.contains('visible')) return;
      if (getComputedStyle(hint).display === 'none') return;
      event.preventDefault();
      enterMobilePresentation();
      syncRotateHint();
    },
    true,
  );
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
