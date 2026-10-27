/**
 * canvas 预览页的**空白检测**（`npm run check:ui2d-visual`）
 *
 * 为什么需要它：今天连着两次遇到"页面一片空白但截图照样成功"——
 *  1. 预览页里 `as const` / `type` 这类 TS 语法直接写进了内联 `<script>`，
 *     浏览器当 JS 解析失败，脚本根本没跑（截图是纯背景）；
 *  2. 捕获时机太早，canvas 还没画第一帧。
 * 这两种都不是 `npm run check` 能覆盖的（它不跑浏览器），而肉眼只看截图时，
 * "整片天空和草地"很容易被当成"只是没画东西"。
 *
 * 做法：对每个页面读 canvas 的像素，统计**非透明像素的占比**与**颜色种类**：
 *  - 非透明占比太低 → 什么都没画；
 *  - 颜色种类太少（比如只有 1~2 种）→ 画了但只有一块底色。
 * 再把页面里的 `pageerror` 计入失败（脚本报错必然画不出来）。
 *
 * 约定：没有浏览器时**跳过**（exit 0），与截图脚本同一个契约。
 */

import { openPage } from './browser.mjs';

/** 需要检查的页面：`min` 是非透明像素占比下限（按各页实际留了余量） */
const PAGES = [
  { url: 'tools/preview/inventory-mirror.html', min: 0.05, label: '背包整页镜像' },
  { url: 'tools/preview/inventory-mirror.html?creative=1&scroll=80', min: 0.05, label: '创造栏（滚动+裁剪）' },
  { url: 'tools/preview/menu-mirror.html', min: 0.03, label: '主菜单镜像' },
  { url: 'tools/preview/menu-mirror.html?view=worlds', min: 0.03, label: '世界列表镜像' },
  { url: 'tools/preview/multiplayer-mirror.html', min: 0.02, label: '多人面板镜像' },
  { url: 'tools/preview/touch.html?fly=1', min: 0.005, label: '触控摇杆 + 按钮' },
  { url: 'tools/preview/textpanels.html', min: 0.002, label: '纯文字 HUD' },
];

const BASE = process.env.UI2D_BASE ?? 'http://localhost:5199';

/** 读页面里第一块（也是唯一一块）覆盖层 canvas 的像素统计 */
async function pixelStats(page) {
  return page.evaluate(() => {
    /*
     * 取**面积最大的那块** canvas：背包预览页里还有几十块 36×36 的物品图标，
     * `querySelector('canvas')` 会拿到第一块图标 —— 第一版就踩了，统计出来是 36×36、3 种色，
     * 却"通过"了，因为 45% 的非透明率看着很健康。
     */
    let canvas = null;
    for (const el of document.querySelectorAll('canvas')) {
      if (!canvas || el.width * el.height > canvas.width * canvas.height) canvas = el;
    }
    if (!canvas) return { ok: false, reason: '页面上没有 canvas' };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: '拿不到 2d 上下文' };
    const { width, height } = canvas;
    if (width === 0 || height === 0) return { ok: false, reason: 'canvas 尺寸为 0' };
    const data = ctx.getImageData(0, 0, width, height).data;
    let opaque = 0;
    const colors = new Set();
    // 每 7 个像素采一个：够判断"画没画东西"，又不会慢
    for (let i = 0; i < data.length; i += 4 * 7) {
      const alpha = data[i + 3];
      if (alpha > 8) {
        opaque += 1;
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
    }
    const total = Math.ceil(data.length / (4 * 7));
    return { ok: true, ratio: opaque / total, colors: colors.size, size: `${width}x${height}` };
  });
}

const results = [];
let browserless = false;

for (const item of PAGES) {
  const opened = await openPage({ viewport: { width: 864, height: 410 } });
  if (!opened.ok) {
    browserless = true;
    results.push({ ...item, skip: true, detail: opened.reason });
    break;
  }
  const { page, problems } = opened;
  const errors = [];
  try {
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 120)));
    await page.goto(`${BASE}/${item.url}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // 覆盖层是 rAF 驱动的：给它几帧
    await page.waitForTimeout(900);
    const stats = await pixelStats(page);
    if (!stats.ok) {
      results.push({ ...item, pass: false, detail: stats.reason });
    } else {
      const pass = stats.ratio >= item.min && stats.colors >= 3 && errors.length === 0;
      results.push({
        ...item,
        pass,
        detail: `非透明 ${(stats.ratio * 100).toFixed(1)}%（下限 ${(item.min * 100).toFixed(1)}%）· ${stats.colors} 种色 · ${stats.size}`,
        errors,
      });
    }
  } catch (error) {
    results.push({ ...item, pass: false, detail: `打不开：${error?.message ?? error}` });
  } finally {
    void problems;
    await opened.close();
  }
}

console.log('\n[canvas 预览页空白检测]');
let failed = 0;
for (const r of results) {
  if (r.skip) {
    console.log(`  · 跳过 ${r.label}（${r.detail}）`);
    continue;
  }
  console.log(`  ${r.pass ? '✓' : '✗'} ${r.label}  →  ${r.detail}`);
  if (!r.pass) {
    failed += 1;
    for (const e of r.errors ?? []) console.log(`      脚本错误：${e}`);
  }
}

if (browserless) {
  console.log('\n没有浏览器，跳过（不算失败）。');
  process.exit(0);
}
if (failed > 0) {
  console.log(`\n失败 ${failed} 个页面：画不出来就不能算迁完。`);
  process.exit(1);
}
console.log('\n全部通过。');
