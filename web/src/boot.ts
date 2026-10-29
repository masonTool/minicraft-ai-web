/**
 * 入口。
 *
 * 现在只有一种产物：方块表**已经编进包里**（整包加密，壳解出来直接给 WebView）。
 * 所以这里不再有"取宿主核心数据 → 装表 → 拉起游戏"那套门禁，只保留动态 import：
 *
 * 主包的模块图里有一批模块在**模块初始化期**就读方块表，动态 import 让"入口先执行、
 * 主包后加载"这件事保持显式，将来若再加任何"加载前必须先准备"的步骤，
 * 顺序仍然是清楚的。
 */

/** 启动遮罩的内联脚本会挂一份当前语言的文案（见 index.html），取不到就用中文兜底 */
interface BootTexts {
  failed?: string;
}

void import('./main.ts').catch((error: unknown) => {
  // 启动期抛错：别让"加载中…"永远转下去，也别谎称还在加载
  console.error('[boot] 主包加载失败', error);

  /* 之前这里找的是 `#boot-error`，而 DOM 里根本没有这个节点 ——
     失败时界面没有任何变化，看起来就是"一直卡在加载中"。改成复用启动遮罩本身。 */
  const texts = (window as unknown as { __bootTexts?: BootTexts }).__bootTexts;
  const textEl = document.getElementById('boot-text');
  if (textEl !== null) textEl.textContent = texts?.failed ?? '启动失败，请重启游戏';
  // `.failed` 会把转圈停住、隐藏进度条（见 index.html 的 `#boot-loading.failed`）
  document.getElementById('boot-loading')?.classList.add('failed');
});
