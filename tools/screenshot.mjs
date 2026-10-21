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
 *   `playwright-core` 不带浏览器，复用**机器上已装的 Chrome**；
 *   找不到就按下面那条规则退出。浏览器查找逻辑在 `tools/browser.mjs`（Q9 共用）。
 *
 * ⚠️ **找不到浏览器时必须 exit 0**（这是队列里明写的验收条件）：
 *   门禁不能因为"这台机器没装 Chrome"就变红——那会把"环境缺东西"和
 *   "页面坏了"混成同一件事。这里打印一句 `[skip]` 就正常退出，
 *   真正的失败只来自"浏览器起来了、但页面报错/截不到图"。
 */

import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = isAbsolute(args.out) ? args.out : join(projectRoot, '.tmp', 'shots', args.out);

  const opened = await openPage({ viewport: { width: args.width, height: args.height } });
  if (!opened.ok) {
    console.log(`[skip] ${opened.reason}，跳过截图。`);
    console.log('       装一个浏览器，或设 CHROME_PATH=/path/to/chrome 再来。');
    console.log('       （这是环境问题，不是页面问题，所以退出码仍然是 0）');
    return 0;
  }

  mkdirSync(dirname(outPath), { recursive: true });

  const { page, problems, close } = opened;
  try {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // 等世界与 UI 就绪：固定等待比"等某个选择器"稳，因为进世界前没有稳定锚点
    await page.waitForTimeout(args.wait);
    await page.screenshot({ path: outPath, fullPage: args.full });
  } finally {
    await close();
  }

  console.log(`[ok] 截图已保存：${outPath}`);
  if (problems.length > 0) {
    console.log(`\n⚠️ 页面有 ${problems.length} 条错误（要当门禁请用 npm run guard）：`);
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
