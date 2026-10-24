/**
 * 浏览器启动的共用部分（Q8 抽出来的，给 screenshot / console-guard 共用）。
 *
 * 抽出来的理由很实在：`findChrome` 那套候选路径 + PATH 兜底 + "找不到就跳过"的
 * 契约一共有三个调用方（截图、控制台门禁、以后的像素差），
 * 复制三份的话，改一个平台路径就要记得改三处——一定会漏。
 *
 * ⚠️ 这里**不 import `playwright-core`**（只在真要启动时才 `import()`）：
 * 没装浏览器的机器上，连模块解析都不该发生。
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** 启动参数：无头环境里 WebGL2 要能初始化，但不需要真显卡 */
const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];

/**
 * 找可用的 Chrome/Chromium。
 *
 * 顺序：测试开关 → 环境变量 → 各平台常见路径 → PATH 上的命令。
 * 返回 null 表示"这台机器没有浏览器"——调用方按**跳过**处理（不能当失败）。
 */
export function findChrome() {
  // 测试用：强制走"没有浏览器"分支（`SHOT_FORCE_NO_BROWSER=1`）。
  // 那条分支的契约是"必须 exit 0"，而它最难在真机上复现（总不能为测它卸个 Chrome）。
  if (process.env.SHOT_FORCE_NO_BROWSER === '1') return null;

  const explicit = process.env.CHROME_PATH;
  if (explicit && existsSync(explicit)) return explicit;

  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ]
      : process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
          ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser', 'chrome']) {
    try {
      const found = execFileSync('which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (found) return found;
    } catch {
      /* 下一个 */
    }
  }
  return null;
}

/**
 * 起一个浏览器 + 一个页面，并挂好错误收集。
 *
 * @returns `{ ok: false, reason }` 表示没浏览器/起不来（调用方应放过）；
 *   `{ ok: true, browser, page, problems, close }` 表示可用。
 *
 * `problems` 是**数组**、由调用方读：截图只打印它，控制台门禁拿它当判据。
 */
export async function openPage({
  viewport = { width: 1280, height: 720 },
  collectConsole = true,
  /**
   * 自定义 UA（批次 20261025-0329 · 宿主5）。
   *
   * 安卓宿主会在 UA 末尾拼 `MinicraftHost/1.0 core/N`，页面靠它判"宿主是不是太老了"。
   * 要验这条判定就得能用不同 UA 打开同一个页面——否则只能靠改代码或装 APK。
   */
  userAgent = undefined,
} = {}) {
  const executablePath = findChrome();
  if (!executablePath) {
    return { ok: false, reason: '没找到 Chrome/Chromium' };
  }

  // 延迟到确定要跑时才 import：没浏览器时连模块都不加载
  const { chromium } = await import('playwright-core');

  let browser;
  try {
    browser = await chromium.launch({ executablePath, args: LAUNCH_ARGS });
  } catch (error) {
    return { ok: false, reason: `浏览器起不来：${error?.message ?? error}` };
  }

  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(userAgent ? { userAgent } : {}) });
  const page = await context.newPage();

  const problems = [];
  if (collectConsole) {
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  }

  const close = async () => {
    try {
      await context.close();
    } finally {
      await browser.close();
    }
  };

  return { ok: true, browser, page, problems, close };
}
