#!/usr/bin/env node
/**
 * 截图脚本（Q8 / A7 的第一块）。
 *
 * 用法：
 *   npm run shot                       # 截主页到 .tmp/shots/home.png
 *   npm run shot -- --url http://localhost:5173/ --out world.png --wait 8000
 *   npm run shot -- --full             # 整页（默认只截视口）
 *
 * 为什么用 `playwright-core` 而不是 `playwright`：
 *   后者会在 `npm install` 时下载约 300MB 的 Chromium。这个仓库的 CI 跑在
 *   `npm run check`（纯离线、约 12 秒）上，为一张截图拖进 300MB 不划算。
 *   `playwright-core` 不带浏览器，复用**机器上已装的 Chrome**（`channel: 'chrome'`）；
 *   找不到就按下面那条规则退出。
 *
 * ⚠️ **找不到浏览器时必须 exit 0**（这是队列里明写的验收条件）：
 *   门禁不能因为"这台机器没装 Chrome"就变红——那会把"环境缺东西"和
 *   "页面坏了"混成同一件事。这里打印一句 `[skip]` 就正常退出，
 *   真正的失败只来自"浏览器起来了、但页面报错/截不到图"。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 解析 `--key value` / `--key=value` / 布尔开关 */
function parseArgs(argv) {
  const out = { url: 'http://localhost:5173/', out: 'home.png', wait: 6000, full: false, width: 1280, height: 720 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = (eq >= 0 ? arg.slice(2, eq) : arg.slice(2)).trim();
    if (key === 'full') {
      out.full = true;
      continue;
    }
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined) continue;
    if (key === 'url') out.url = value;
    else if (key === 'out') out.out = value;
    else if (key === 'wait') out.wait = Number(value);
    else if (key === 'width') out.width = Number(value);
    else if (key === 'height') out.height = Number(value);
  }
  return out;
}

/**
 * 找可用的 Chrome/Chromium。
 *
 * 顺序：环境变量 → 各平台常见路径 → PATH 上的命令。
 * 任一条命中就返回；都没命中返回 null（调用方按"跳过"处理）。
 */
function findChrome() {
  // 测试用：强制走"没有浏览器"这条分支（`SHOT_FORCE_NO_BROWSER=1`）。
  // 为什么留这个口子：那条分支的契约是"必须 exit 0"，而它恰恰是最难在真机上
  // 复现的一条（总不能为了测它去卸一个 Chrome）。有了它，`test:screenshot`
  // 就能把"环境缺东西 ≠ 门禁变红"这条规则钉死。
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
  // PATH 兜底（Linux 容器里常见）
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = isAbsolute(args.out) ? args.out : join(projectRoot, '.tmp', 'shots', args.out);

  const executablePath = findChrome();
  if (!executablePath) {
    console.log('[skip] 没找到 Chrome/Chromium，跳过截图。');
    console.log('       装一个浏览器，或设 CHROME_PATH=/path/to/chrome 再来。');
    console.log('       （这是环境问题，不是页面问题，所以退出码仍然是 0）');
    return 0;
  }

  // 延迟到确定要跑时才 import：没浏览器时连模块都不加载
  const { chromium } = await import('playwright-core');

  mkdirSync(dirname(outPath), { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      args: [
        // 无头环境里的 GL：截图不要求真渲染性能，但要能初始化 WebGL2
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
  } catch (error) {
    console.log(`[skip] 浏览器起不来：${error.message}`);
    console.log('       （同样是环境问题，退出码 0）');
    return 0;
  }

  const context = await browser.newContext({
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  /** 收集控制台错误与未捕获异常——截图顺手把它们带出来，不用另开一个脚本 */
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

  try {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // 等世界与 UI 就绪：固定等待比"等某个选择器"稳，因为进世界前没有稳定锚点
    await page.waitForTimeout(args.wait);
    await page.screenshot({ path: outPath, fullPage: args.full });
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`[ok] 截图已保存：${outPath}`);
  if (problems.length > 0) {
    console.log(`\n⚠️ 页面有 ${problems.length} 条错误（Q9 会把这些变成门禁）：`);
    for (const line of problems.slice(0, 10)) console.log(`   · ${line}`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    // 真正的失败：浏览器起来了，但 goto/截图抛错
    console.error('[fail] 截图失败：', error?.message ?? error);
    process.exit(1);
  });
