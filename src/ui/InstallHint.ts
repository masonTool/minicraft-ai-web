/**
 * 「添加到主屏幕」引导（批次 160）
 *
 * 用户诉求："现在在手机上需要点一下才进入全屏横屏状态，能不能在加载的时候自动进入？"
 *
 * 浏览器这边的硬事实（`Fullscreen.ts` 文件头也写了）：`requestFullscreen()` 必须在
 * **用户手势**的调用栈里发出，所以"页面一加载就全屏"在标签页里做不到。
 * 但有一条**真的**能零点击的路径：把页面装成 App（PWA）——
 * `public/manifest.webmanifest` 已经写着 `display: fullscreen` + `orientation: landscape`，
 * 从桌面图标启动的窗口本身就是全屏横屏，不需要任何手势。
 *
 * 所以这里只做一件很小的事：**没装的时候提示一次**，装了 / 关了就不再骚扰。
 * 三个刻意的取舍：
 *  1. **只在 `beforeinstallprompt` 到达时出现**：那个事件只有"浏览器认为可以装"才发，
 *     所以不会在 iOS Safari（根本没有安装提示 API）或桌面浏览器上冒出来；
 *  2. **`preventDefault()`**：Chrome 自己的迷你安装条会贴在屏幕底部，正好压住我们的
 *     跳跃键——收下事件、自己画一条，位置与样式都可控；
 *  3. **关掉之后记住**（localStorage）：这类引导第二次出现就只剩烦人了。
 */

import { isStandalone } from './Fullscreen.ts';

/** 关过一次就不再烦（换设备/换浏览器各记各的） */
const DISMISS_KEY = 'bedrock-install-hint-dismissed';
const HINT_ID = 'install-hint';

/** `beforeinstallprompt` 的私有形状（TS 标准库里没有它） */
type InstallPromptEvent = Event & {
  prompt?: () => Promise<void>;
  userChoice?: Promise<{ outcome: string }>;
};

let deferred: InstallPromptEvent | null = null;

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // 无痕模式读不到：当作"没关过"（宁可变烦一次，也不要让引导永远不出现）
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* 写不进去就算了：本次会话仍然收起来 */
  }
}

function doc(): Document | null {
  return typeof document === 'undefined' ? null : document;
}

/** 收起来（不改"关过"的标记：进世界时用它，玩家下次回主菜单还该看到） */
export function hideInstallHint(): void {
  doc()?.getElementById(HINT_ID)?.remove();
}

/** 玩家点了"以后"：收起来并且不再出现 */
export function dismissInstallHint(): void {
  hideInstallHint();
  markDismissed();
}

function showHint(): void {
  const document_ = doc();
  if (!document_ || document_.getElementById(HINT_ID)) return;

  const hint = document_.createElement('div');
  hint.id = HINT_ID;
  hint.className = 'install-hint';

  const text = document_.createElement('span');
  text.textContent = '添加到主屏幕后，打开即全屏横屏';

  const add = document_.createElement('button');
  add.type = 'button';
  add.className = 'install-hint-add';
  add.textContent = '添加';
  add.addEventListener('click', () => {
    const prompt = deferred;
    deferred = null;
    // 先收起来：浏览器自己的弹层会盖住这条引导，留着它会像"点坏了"
    markDismissed();
    hideInstallHint();
    void prompt?.prompt?.().catch(() => undefined);
  });

  const later = document_.createElement('button');
  later.type = 'button';
  later.className = 'install-hint-later';
  later.textContent = '以后';
  later.addEventListener('click', () => dismissInstallHint());

  hint.append(text, add, later);
  document_.body.appendChild(hint);
}

/**
 * 挂上引导（boot 里调一次；已经装成 App / 关过一次时什么都不做）。
 *
 * 注意 `beforeinstallprompt` 可能在脚本执行**之前**就发过了（页面很快）。
 * 那种情况下这个监听不会再触发——**这正是我们想要的**：拿不到 defer 的事件就没法
 * 真的调起安装框，弹一条"点了没反应"的提示比不弹更糟。
 */
export function installInstallHint(): void {
  if (typeof window === 'undefined' || !doc()) return;
  if (isStandalone() || readDismissed()) return;

  window.addEventListener('appinstalled', () => {
    deferred = null;
    markDismissed();
    hideInstallHint();
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    // 拦住 Chrome 那条贴底的迷你提示条（它和触摸按钮抢同一块地方）
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    showHint();
  });
}

/** 调试用：现在有没有挂着引导 */
export function isInstallHintVisible(): boolean {
  const document_ = doc();
  if (!document_) return false;
  return document_.getElementById(HINT_ID) !== null;
}
