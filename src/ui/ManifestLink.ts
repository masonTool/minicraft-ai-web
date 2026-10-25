/**
 * 按**语言 + 设备**选择 `<link rel="manifest">` 指向哪一份（用户要求 2026-10-25："PC 版不需要全屏"）。
 *
 * 背景：全屏请求那条路（`ui/Fullscreen.ts`）早就用 `isCoarsePointer()` 挡住了桌面端——
 * 普通标签页里 PC 根本不会全屏。但"在桌面上把网页装成 App"绕过了代码：
 * Chrome 桌面端照 `display_override: ["fullscreen"]` 直接把窗口开成全屏，
 * 而那不是 Fullscreen API（`document.exitFullscreen()` 关不掉），游戏里也没入口能退出。
 *
 * 所以收口在 manifest 上：六种语言各多生成一份**桌面变体**
 * （`tools/gen-manifests.mjs`，`display_override` 只留 `standalone`、不写 `orientation`），
 * 页面启动时按设备二选一。手机那份一个字没动，避免"装完打开不是全屏"的回归。
 *
 * 文件名规则必须与生成器**逐字一致**：`manifest.webmanifest` ↔ `manifest.desktop.webmanifest`，
 * `manifest.en.webmanifest` ↔ `manifest.en.desktop.webmanifest`。
 */

/** 某种语言 + 某种设备下该用哪份 manifest（纯函数，离线测试直接钉住） */
export function manifestHref(language: string, touch: boolean): string {
  const desktop = touch ? '' : '.desktop';
  return language === 'zh'
    ? `./manifest${desktop}.webmanifest`
    : `./manifest.${language}${desktop}.webmanifest`;
}

/** 把当前页面的 manifest 链接换成该用的那一份；没有这个 link 时什么都不做 */
export function applyManifestLink(language: string, touch: boolean): void {
  if (typeof document === 'undefined') return;
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link) link.href = manifestHref(language, touch);
}
