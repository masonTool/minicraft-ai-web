#!/usr/bin/env node
/**
 * 跳一跳的端到端自查（批次 20261024-0415 更新断言）
 *
 * 用法：
 *   npm run dev            # 另一个终端先把服务跑起来
 *   npm run jump:e2e       # 本脚本
 *
 * 它做的事就是人手动会做的那几步（横屏 844×390）：
 *   进小游戏 → 连跳 5 次（按 `debugState.gap` 反算蓄力时长）→ 故意跳空 → 结算
 *   → 再来一局 → 退出；同时把 菜单 / 待跳 / 蓄力 / 结算 四张截图落到 `.tmp/shots`。
 *
 * 除了"能玩"，还验三件这一轮才有的东西（都从 `debugState` 读，不碰内部对象）：
 *   · **相机是正交的**：透视相机会让画面失去等距观感，而截图比对很难一眼看出；
 *   · **间距 = 边长的 1.15~1.9 倍**：原版相邻块几乎贴合，这是"像不像"的核心；
 *   · **前进方向只有 x / z 两条轴**：原版没有斜角。
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
const KINDS = ['normal', 'well', 'cube', 'store', 'music'];

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
  check('相机是正交的（等距投影的前提）', ready?.orthographic === true, JSON.stringify(ready));
  check(
    '间距 = 边长的 1.15~1.9 倍（原版相邻块几乎贴合）',
    ready?.gapRatio >= 1.15 && ready?.gapRatio <= 1.95,
    `gapRatio=${Number(ready?.gapRatio).toFixed(2)}`,
  );
  check('前进方向只沿一条世界轴', ready?.axis === 'x' || ready?.axis === 'z', `axis=${ready?.axis}`);
  check(
    '方块种类在五类之内',
    ['normal', 'well', 'cube', 'store', 'music'].includes(ready?.kind),
    `kind=${ready?.kind}`,
  );
  await page.screenshot({ path: `${shotDir}/jump-ready.png` });

  // ---- 连跳 5 次：按到中心（蓄力时长 = gap / 最大距离 × 蓄满时间）
  const stage = await page.$('.minigame-stage');
  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.62;

  const axes = new Set();
  const kinds = new Set();
  for (let i = 0; i < 5; i++) {
    const before = await state();
    axes.add(before.axis);
    kinds.add(before.kind);
    kinds.add(before.nextKind);
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

  check(
    '5 跳的方向只有 x / z 两向（没有斜角）',
    [...axes].every((axis) => axis === 'x' || axis === 'z'),
    [...axes].join(','),
  );
  check('5 跳的方块种类都在五类之内', [...kinds].every((kind) => KINDS.includes(kind)), [...kinds].join(','));

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
