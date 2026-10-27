#!/usr/bin/env node
/**
 * 把**已迁到 canvas 的界面**逐个截图，落到 `.tmp/canvas-version/`。
 *
 * 为什么单独一个脚本：截图清单本身就是"实现到哪一步"的凭证 ——
 * 口头说"搬了快捷栏"没有意义，能一张张摆出来的才算数。加一块新界面时，
 * 往下面的 `SHOTS` 里加一行，跑一遍，目录里就多一张图。
 *
 * 用法（先起 dev server）：
 *   npm run dev &
 *   node tools/preview/shoot-all.mjs                     # 默认 http://localhost:5173
 *   node tools/preview/shoot-all.mjs --base http://localhost:5199
 *
 * 说明：
 *  · 底层复用 `tools/screenshot.mjs`（找不到浏览器时它 exit 0，这里也照旧不报错，
 *    只是把 `[skip]` 原样打出来 —— 环境缺东西不该让"实现进度"变成红灯）；
 *  · 产物在 `.tmp/` 下，**不进 git**；要长期留就看 `tools/preview/*.html` 的复现命令。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(projectRoot, '.tmp', 'canvas-version');

/** 参数：只认 `--base <url>` */
function baseUrl(argv) {
  const index = argv.indexOf('--base');
  return (index >= 0 ? argv[index + 1] : undefined) ?? 'http://localhost:5173';
}

/**
 * 截图清单（**按实现进度排**）。
 *
 * `page` 是预览页的相对路径 + 查询串；`size` 是视口（hud 页固定 864×410，
 * 因为它的"假世界"是 844×390 的手机横屏）。
 */
const SHOTS = [
  {
    file: '01-hotbar-canvas.png',
    page: 'tools/preview/hotbar.html?only=canvas',
    size: [520, 180],
    what: '快捷栏（canvas 版）：9 格 + 图标 + 数量 + 序号 + 耐久三档 + 选中格',
    status: '已迁 · 阶段 1.5',
  },
  {
    file: '01b-hotbar-dom-vs-canvas.png',
    page: 'tools/preview/hotbar.html',
    size: [520, 320],
    what: '快捷栏：上面 DOM 版、下面 canvas 版（同一份数据，用来肉眼对差异）',
    status: '已迁 · 阶段 1.5',
  },
  {
    file: '02-damage-flash.png',
    page: 'tools/preview/hud.html?only=flash',
    size: [864, 410],
    what: '受伤红闪（强度 0.55）',
    status: '已迁 · 阶段 0',
  },
  {
    file: '03-boss-dragon.png',
    page: 'tools/preview/hud.html?only=boss',
    size: [864, 410],
    what: 'Boss 血条（末影龙配色）',
    status: '已迁 · 阶段 0',
  },
  {
    file: '04-boss-wither.png',
    page: 'tools/preview/hud.html?only=boss&variant=wither',
    size: [864, 410],
    what: 'Boss 血条（凋灵配色）',
    status: '已迁 · 阶段 0',
  },
  {
    file: '05-progress.png',
    page: 'tools/preview/hud.html?only=progress',
    size: [864, 410],
    what: '破坏进度条（白，42%）与进食进度条（黄，68%）',
    status: '已迁 · 阶段 0',
  },
  {
    file: '00-hud-overview.png',
    page: 'tools/preview/hud.html',
    size: [864, 410],
    what: '阶段 0 三样同时在屏上的样子（红闪 + Boss 条 + 两条进度）',
    status: '已迁 · 阶段 0',
  },
];

const base = baseUrl(process.argv.slice(2));
mkdirSync(OUT_DIR, { recursive: true });

let skipped = false;
for (const shot of SHOTS) {
  const [width, height] = shot.size;
  try {
    const out = execFileSync(
      process.execPath,
      [
        join(projectRoot, 'tools', 'screenshot.mjs'),
        '--url',
        `${base}/${shot.page}`,
        '--out',
        join(OUT_DIR, shot.file),
        '--wait',
        '1800',
        '--width',
        String(width),
        '--height',
        String(height),
      ],
      { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (/\[skip\]/.test(out)) {
      skipped = true;
      console.log(`  [skip] ${shot.file}（没有浏览器）`);
    } else {
      console.log(`  ✓ ${shot.file}  ← ${shot.what}`);
    }
  } catch (error) {
    // 页面报错/截不到图才算失败：环境问题在 screenshot.mjs 里已经 exit 0
    console.log(`  ✗ ${shot.file}  ${String(error.stderr ?? error.message).slice(0, 160)}`);
    process.exitCode = 1;
  }
}

console.log(`\n产物目录：${OUT_DIR}`);
if (skipped) console.log('（部分截图被跳过：装 Chrome 或设 CHROME_PATH 再来）');
