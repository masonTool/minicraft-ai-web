/**
 * 暂停弹窗的**端到端验收**（`npm run check:pause`）
 *
 * 为什么单开一个脚本：`?ui2d=1` 时 Esc 唤出的暂停菜单页与设置页都由 canvas 接管，
 * 这条链涉及**三处 DOM 让位 + 一个 engaged 标志 + 两套键鼠路由**，任何一处错都表现为
 * "Esc 打不开 / 关不掉 / HUD 不回来"。而它只能在**真游戏里**验（dev 模式缺 `__host/core.bin`
 * 时页面停在落地页），所以把这条链写成一个可重复跑的命令，等有 `core.bin` 的环境一条命令过一遍。
 *
 * 判据（每一步都断言，失败即退出非零）：
 *   1. 进得去世界（落地页 → 跳过，并说明需要 core.bin）
 *   2. Esc → `#settings-screen` 出现，且 `.settings-panel` 被 `visibility: hidden` 让位
 *   3. canvas 上真的画了东西（像素统计，避免"面板藏了、canvas 没画"= 全黑）
 *   4. ↓ + Enter → 进设置页（`data-page === 'settings'`）
 *   5. Esc → 回菜单页；再 Esc → 关闭，且 `#hud` 的 `visibility` 恢复
 *
 * 用法：
 *   npm run dev            # 另开一个终端
 *   npm run check:pause    # 默认 http://localhost:5173，可用 UI2D_BASE 覆盖
 */

import { openPage } from './browser.mjs';

const BASE = process.env.UI2D_BASE ?? 'http://localhost:5173';
const results = [];

function check(label, ok, detail = '') {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  →  ${detail}` : ''}`);
}

const opened = await openPage({ viewport: { width: 900, height: 600 } });
if (!opened.ok) {
  console.log(`没有浏览器，跳过（${opened.reason}）。`);
  process.exit(0);
}
const { page, close } = opened;

/** canvas 上非透明像素的占比（覆盖层是 rAF 驱动的） */
async function coverage() {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')];
    let best = null;
    for (const el of canvases) if (!best || el.width * el.height > best.width * best.height) best = el;
    if (!best) return 0;
    const ctx = best.getContext('2d');
    if (!ctx) return 0;
    const data = ctx.getImageData(0, 0, best.width, best.height).data;
    let opaque = 0;
    let total = 0;
    for (let i = 3; i < data.length; i += 4 * 13) {
      total += 1;
      if (data[i] > 8) opaque += 1;
    }
    return total === 0 ? 0 : opaque / total;
  });
}

try {
  console.log(`\n[暂停弹窗端到端验收] ${BASE}/?ui2d=1`);
  await page.goto(`${BASE}/?ui2d=1`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(2500);

  // ① 进得去世界吗（落地页 = 缺 core.bin，按跳过处理）
  const inGame = await page.evaluate(() => {
    const world = document.querySelector('#world-screen');
    const hud = document.querySelector('#hud');
    // `#settings-screen` 由 `SettingsScreen` 构造时创建，**只在游戏里**才有；
    // 落地页（缺 core.bin）连它都没有。少这一条会把"落地页"误判成"进了世界"。
    const settings = document.querySelector('#settings-screen');
    return !!hud && !!settings && (!world || world.classList.contains('hidden'));
  });
  if (!inGame) {
    console.log('  · 跳过：页面停在落地页（dev 缺 `__host/core.bin`），这条链需要有 core.bin 的环境。');
    await close();
    process.exit(0);
  }
  check('进得去世界（HUD 在场、主菜单不在）', true);

  // ② Esc → 暂停菜单页由 canvas 接管
  await page.keyboard.press('Escape');
  await wait(600);
  const menuState = await page.evaluate(() => {
    const screen = document.querySelector('#settings-screen');
    const panel = document.querySelector('#settings-screen .settings-panel');
    return {
      open: !!screen && !screen.classList.contains('hidden'),
      panelHidden: !!panel && getComputedStyle(panel).visibility === 'hidden',
      hudHidden: (() => {
        const hud = document.querySelector('#hud');
        return !!hud && getComputedStyle(hud).visibility === 'hidden';
      })(),
    };
  });
  check('Esc 打开暂停面板', menuState.open);
  check('面板让位（visibility: hidden，DOM 不画）', menuState.panelHidden);
  check('HUD 让位（不压在 canvas 上）', menuState.hudHidden);

  // ③ canvas 真画了东西
  const painted = await coverage();
  check('canvas 上画出了面板', painted > 0.02, `非透明 ${(painted * 100).toFixed(1)}%`);

  // ④ ↓ + Enter → 设置页
  await page.keyboard.press('ArrowDown');
  await wait(120);
  await page.keyboard.press('Enter');
  await wait(700);
  const pageNow = await page.evaluate(() =>
    document.querySelector('#settings-screen')?.getAttribute('data-page'),
  );
  check('Enter 进「设置」子页', pageNow === 'settings', `data-page=${pageNow}`);
  const settingsPainted = await coverage();
  check('设置页由 canvas 画出', settingsPainted > 0.02, `非透明 ${(settingsPainted * 100).toFixed(1)}%`);

  // ⑤ Esc 回菜单，再 Esc 关闭，HUD 恢复
  await page.keyboard.press('Escape');
  await wait(600);
  const backToMenu = await page.evaluate(() =>
    document.querySelector('#settings-screen')?.getAttribute('data-page'),
  );
  check('Esc 从设置页回到菜单页', backToMenu === 'menu', `data-page=${backToMenu}`);

  await page.keyboard.press('Escape');
  await wait(700);
  const closed = await page.evaluate(() => {
    const screen = document.querySelector('#settings-screen');
    const hud = document.querySelector('#hud');
    const panel = document.querySelector('#settings-screen .settings-panel');
    return {
      hidden: !!screen && screen.classList.contains('hidden'),
      hudBack: !!hud && getComputedStyle(hud).visibility !== 'hidden',
      panelBack: !!panel && getComputedStyle(panel).visibility !== 'hidden',
    };
  });
  check('Esc 关闭暂停面板', closed.hidden);
  check('HUD 恢复（这一条错过的表现是"退出暂停后 HUD 永久消失"）', closed.hudBack);
  check('面板 DOM 恢复', closed.panelBack);
} catch (error) {
  const message = String(error?.message ?? error);
  // 连不上 dev server 属于"环境没准备好"，不是验收失败
  if (/ERR_CONNECTION_REFUSED|net::|Timeout/i.test(message) && results.length === 0) {
    console.log(`  · 跳过：连不上 ${BASE}（先 npm run dev）`);
    await close();
    process.exit(0);
  }
  check('脚本异常', false, message.slice(0, 160));
} finally {
  await close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\n全部通过。' : `\n失败 ${failed} 项：这条链错一处就是"Esc 打不开/关不掉"。`);
process.exit(failed === 0 ? 0 : 1);
