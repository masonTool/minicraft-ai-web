#!/usr/bin/env node
/**
 * 跳一跳的端到端自查（J3/J4，批次 20261022-2220）
 *
 * 用法：
 *   npm run dev            # 另一个终端先把服务跑起来
 *   npm run jump:e2e       # 本脚本
 *
 * 它做的事就是人手动会做的那几步（横屏 844×390）：
 *   进小游戏 → 连跳 5 次（按 `debugState.gap` 反算蓄力时长）→ 故意跳空 → 结算
 *   → 再来一局 → 退出；同时把 菜单 / 待跳 / 蓄力 / 结算 四张截图落到 `.tmp/shots`。
 *
 * ⚠️ 与截图 / 控制台门禁同一条契约：**没有浏览器就 exit 0**（跳过，不算失败）。
 *    真正的失败只有一种：脚本跑完了、有 ✗。
 */
import { mkdirSync } from 'node:fs';
import { openPage } from './browser.mjs';

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = valueOf('--url', 'http://localhost:5173/');
const shotDir = '.tmp/shots';

mkdirSync(shotDir, { recursive: true });

const opened = await openPage({ viewport: { width: 844, height: 390 } });
if (!opened.ok) {
  console.log(`[skip] ${opened.reason}（不是代码问题，退出码仍然是 0）`);
  process.exit(0);
}

const { page, problems, close } = opened;
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? `  →  ${detail}` : ''}`);
};

const state = () => page.evaluate(() => window.__minigame?.debugState ?? null);

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);

  // ---- 菜单 → 卡片 → 开局
  await page.click('#world-minigames-button');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotDir}/jump-menu.png` });
  check('小游戏面板打开了', await page.isVisible('#minigame-menu'));

  await page.click('.minigame-game');
  await page.waitForTimeout(1400);
  const ready = await state();
  check('卡片点下去直接开局（没有关卡页）', ready?.phase === 'ready', JSON.stringify(ready));
  check('开局分数 0', ready?.score === 0);
  await page.screenshot({ path: `${shotDir}/jump-ready.png` });

  // ---- 连跳 5 次：按到中心（蓄力时长 = gap / 最大距离 × 蓄满时间）
  const stage = await page.$('.minigame-stage');
  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.62;

  for (let i = 0; i < 5; i++) {
    const before = await state();
    const holdMs = Math.max(60, Math.min(900, (before.gap / 4.5) * 900));
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    if (i === 0) {
      await page.waitForTimeout(Math.round(holdMs * 0.55));
      await page.screenshot({ path: `${shotDir}/jump-charging.png` });
      await page.waitForTimeout(Math.round(holdMs * 0.45));
    } else {
      await page.waitForTimeout(Math.round(holdMs));
    }
    await page.mouse.up();
    await page.waitForTimeout(950);
  }

  const after5 = await state();
  check('连跳 5 次都在前进', after5.index === 5, `index=${after5.index}`);
  check('分数累加', after5.score > 0, `score=${after5.score}`);
  await page.screenshot({ path: `${shotDir}/jump-after5.png` });

  // ---- 故意跳空（40ms 蓄力，落点远不够）
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.up();
  await page.waitForTimeout(1800);

  const over = await state();
  check('跳空后进入结算', over.phase === 'over', `phase=${over.phase}`);
  check('结算面板可见', await page.isVisible('.jump-over'));
  await page.screenshot({ path: `${shotDir}/jump-over.png` });

  // ---- 再来一局
  await page.click('.jump-over-actions button[data-action="retry"]');
  await page.waitForTimeout(700);
  const retried = await state();
  check('重开后分数归零', retried.score === 0, `score=${retried.score}`);
  check('重开后最高分保留', retried.best > 0, `best=${retried.best}`);

  // ---- 退出
  await page.click('.minigame-exit');
  await page.waitForTimeout(700);
  check('退出后实例已清空', await page.evaluate(() => window.__minigame === undefined));
  check('退出后小游戏层隐藏', await page.isHidden('#minigame-layer'));
  check('没有 console.error / pageerror', problems.length === 0, problems.slice(0, 3).join(' | '));
} catch (error) {
  check(`脚本异常：${error?.message ?? error}`, false);
} finally {
  await close();
}

const failed = results.filter((one) => !one.ok);
console.log(`\n结果：通过 ${results.length - failed.length} / ${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
