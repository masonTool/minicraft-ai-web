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
 * 除了"能玩"，还验这几件这一轮才有的东西（都从 `debugState` 读，不碰内部对象）：
 *   · **相机是正交的**：透视相机会让画面失去等距观感，而截图比对很难一眼看出；
 *   · **间距是绝对格数**（4.6~6.0 格 → 边长比 2.3~5.0）：这一轮把间距从"边长倍数"
 *     改回绝对格数并大幅拉开，命中横屏下"方块之间要留出倒下的空间"；
 *   · **一屏只画 3 块**（上一块 + 当前 + 下一块）；
 *   · **底座有方有圆**（10 分前一律方形）；
 *   · **前进方向只有 x / z 两条轴**：原版没有斜角。
 *
 * ⚠️ 按压时长按"距离 ÷ 最远 7.2 格 × 蓄满 1.25 秒"反算（对应 `config.ts`），
 *    改参数要同步这两个数。
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
const SHAPES = ['square', 'round'];
/** 与 `config.ts` 同一口径：蓄满 maxCharge 秒对应 maxDistance 格 */
const MAX_DISTANCE = 7.2;
const MAX_CHARGE_MS = 1250;

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
    '间距拉到边长的 2.3~5.0 倍（4.6~6.0 格的绝对曲线）',
    ready?.gapRatio >= 2.2 && ready?.gapRatio <= 5.1,
    `gapRatio=${Number(ready?.gapRatio).toFixed(2)}`,
  );
  check('开局间距至少 4.6 格（横屏下要留出倒下的空间）', ready?.gap >= 4.6, `gap=${Number(ready?.gap).toFixed(2)}`);
  // 开局没有"上一块"，所以是 2 块；跳过一次之后才是 3 块（见下面 after5 的断言）
  check('开局只画 2 块（当前 + 下一块）', ready?.onscreen === 2, `onscreen=${ready?.onscreen}`);
  check('开局站在方块中心（standOffset = 0）', ready?.standOffset === 0, `standOffset=${ready?.standOffset}`);
  check('前进方向只沿一条世界轴', ready?.axis === 'x' || ready?.axis === 'z', `axis=${ready?.axis}`);
  check(
    '方块种类在五类之内',
    ['normal', 'well', 'cube', 'store', 'music'].includes(ready?.kind),
    `kind=${ready?.kind}`,
  );
  check('底座形状在两类之内', SHAPES.includes(ready?.shape) && SHAPES.includes(ready?.nextShape), `${ready?.shape}/${ready?.nextShape}`);
  check('10 分前不出圆形底座', ready?.shape === 'square' && ready?.nextShape === 'square');
  await page.screenshot({ path: `${shotDir}/jump-ready.png` });

  // ---- 连跳 5 次：按到中心（蓄力时长 = gap / 最大距离 × 蓄满时间）
  const stage = await page.$('.minigame-stage');
  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.62;

  const axes = new Set();
  const kinds = new Set();
  const shapes = new Set();
  for (let i = 0; i < 5; i++) {
    const before = await state();
    axes.add(before.axis);
    kinds.add(before.kind);
    kinds.add(before.nextKind);
    shapes.add(before.shape);
    shapes.add(before.nextShape);
    const holdMs = Math.max(60, Math.min(MAX_CHARGE_MS, (before.gap / MAX_DISTANCE) * MAX_CHARGE_MS));
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

  check('5 跳的底座形状都在两类之内', [...shapes].every((shape) => SHAPES.includes(shape)), [...shapes].join(','));

  const after5 = await state();
  check('连跳 5 次都在前进', after5.index === 5, `index=${after5.index}`);
  check('分数累加', after5.score > 0, `score=${after5.score}`);
  check('一屏稳定 3 块（上一块 + 当前 + 下一块）', after5.onscreen === 3, `onscreen=${after5.onscreen}`);
  // 落点保留：跳到哪儿站哪儿，站姿偏移必须是个有限的实数（0 = 正好站中心）
  check(
    '站姿偏移被暴露且有限',
    Number.isFinite(after5.standOffset) && after5.standOffset >= 0 && after5.standOffset <= 2,
    `standOffset=${after5.standOffset}`,
  );
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
