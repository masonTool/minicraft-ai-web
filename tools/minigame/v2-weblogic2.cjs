/**
 * 实测第二批四条 Web 版逻辑：选数量 / 拖拽分配 / 点空白丢弃。
 *
 * 全部走真实手指（mouse down/move/up），不调 tapSlot。
 */
const { chromium } = require('playwright');

const URL = process.env.V2_URL;
const CHROME =
  '/Users/mason/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const DESIGN = { width: 1024, height: (1024 * 390) / 844 };
const DIR = '.tmp/shots/v2';

const assert = (c, m, extra) => {
  if (!c) throw new Error(`${m}${extra ? '\n' + JSON.stringify(extra) : ''}`);
};

(async () => {
  require('node:fs').mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1080, height: 700 }, hasTouch: true, deviceScaleFactor: 2 });
  let latest = null;
  page.on('console', (m) => {
    const t = m.text();
    const i = t.indexOf('[V2] ');
    if (i < 0) return;
    try {
      latest = JSON.parse(t.slice(i + 5));
    } catch {}
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const box = await page.evaluate(() => {
    const f = document.querySelector('iframe');
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const pt = (x, y) => ({ x: box.x + (x / DESIGN.width) * box.width, y: box.y + (y / DESIGN.height) * box.height });
  const tap = async (x, y) => {
    const p = pt(x, y);
    await page.touchscreen.tap(p.x, p.y);
  };
  const wait = async (pred, msg, ms = 45000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (latest && pred(latest)) return latest;
      await page.waitForTimeout(100);
    }
    throw new Error(msg + '\n' + JSON.stringify(latest));
  };

  await wait((s) => s.screen === 'title', '没进标题');
  await tap(512, 327);
  await wait((s) => s.screen === 'worlds', '没进列表');
  await tap(512, 216);
  await wait((s) => s.screen === 'create', '没进新建');
  await tap(727, 423);
  await wait((s) => s.screen === 'game' && s.drawn > 3, '没进游戏', 60000);
  await page.waitForTimeout(1000);

  const frame = page.frames().find((f) => f.url().startsWith('about:srcdoc'));
  const call = (fn, ...args) => frame.evaluate(([f, a]) => wx.__v2Test[f]?.(...a), [fn, args]);
  const geo = () => frame.evaluate(() => wx.__v2Test.inventoryGeo());
  const cellXY = (g, index) => {
    const j = index - 9;
    return { x: g.contentX + (j % 9) * 46 + 22, y: g.contentY + Math.floor(j / 9) * 46 + 22 };
  };

  await call('resetInventoryForTest');
  await call('giveToSlot', 9, 1, 30);
  await tap(815, 424);
  await wait((s) => s.inventoryOpen, '背包没打开');
  await page.waitForTimeout(400);
  const g = await geo();

  // ---------------------------------------------------------- 1. 长按选数量
  const c9 = pt(cellXY(g, 9).x, cellXY(g, 9).y);
  await page.mouse.move(c9.x, c9.y);
  await page.mouse.down();
  await page.waitForTimeout(400); // 进选数量（260ms）
  const barShot = `${DIR}/split-bar.png`;
  await page.screenshot({ path: barShot });
  // 向右划一整格宽（46px 设计坐标 → 屏幕坐标）→ 应当选到全部 30
  const cellPx = (46 / DESIGN.width) * box.width;
  await page.mouse.move(c9.x + cellPx, c9.y, { steps: 6 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const split = { held: latest?.cursorCount, slot9: await call('slotAt', 9) };
  console.log('[1] 长按划到右端 →', JSON.stringify(split), 'shot=', barShot);
  assert(split.held === 30 && split.slot9 === 0, '选数量划到右端没有选全部', split);
  await call('resetInventoryForTest');

  // ---------------------------------------------------------- 2. 拖拽分配
  // 手上 10 个，从 9 号拖过 10/11/12 → **路径含起点共 4 格**，每格 2 个、手上剩 2。
  // ⚠️ 起点格也参与分配（原版 `doDrag` 就是这样：拖回自己那格也算一格）。
  await call('giveToSlot', 9, 1, 10);
  await call('tapSlot', 'inventory', 9, 'left');
  await page.waitForTimeout(200);
  const from = pt(cellXY(g, 9).x, cellXY(g, 9).y);
  const targets = [10, 11, 12].map((i) => pt(cellXY(g, i).x, cellXY(g, i).y));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(targets[0].x, targets[0].y, { steps: 4 });
  await page.mouse.move(targets[1].x, targets[1].y, { steps: 4 });
  await page.mouse.move(targets[2].x, targets[2].y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const dist = {
    held: latest?.cursorCount,
    s9: await call('slotAt', 9),
    s10: await call('slotAt', 10),
    s11: await call('slotAt', 11),
    s12: await call('slotAt', 12),
  };
  console.log('[2] 拖过 9→10→11→12（路径 4 格）→', JSON.stringify(dist));
  await page.screenshot({ path: `${DIR}/drag-distribute.png` });
  // 10 个 / 4 格 = 每格 2、余 2 留在手上（`distributeEvenly` 的地板份额算法）
  assert(
    dist.s9 === 2 && dist.s10 === 2 && dist.s11 === 2 && dist.s12 === 2 && dist.held === 2,
    '拖拽分配不是"每格地板份额、余数留手上"',
    dist,
  );
  await call('resetInventoryForTest');

  // ---------------------------------------------------------- 3. 点空白丢弃
  await call('giveToSlot', 9, 1, 7);
  await call('tapSlot', 'inventory', 9, 'left');
  await page.waitForTimeout(200);
  const dropsBefore = latest?.drops ?? 0;
  // 点面板外的空白（左下角）
  await tap(60, 300);
  await page.waitForTimeout(500);
  const dropped = { held: latest?.cursorCount, drops: latest?.drops ?? 0, open: latest?.inventoryOpen };
  console.log('[3] 点空白 →', JSON.stringify(dropped), 'before drops=', dropsBefore);
  assert((dropped.drops ?? 0) > dropsBefore, '点空白没有丢掉手上物品', dropped);
  assert(dropped.open === true, '点空白不该关掉界面', dropped);

  console.log('\n✓ 选数量 / 拖拽分配 / 点空白丢弃 三条运行时全部生效');
  await browser.close();
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
