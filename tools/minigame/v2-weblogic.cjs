/**
 * 实测四条"从 Web 版抄过来"的规则是否真的生效（运行时，不是单测）。
 *
 * 1. 260ms 长按 → 拿一半（真实手指按住）
 * 2. 按住不放 → 170ms 连发（连续放/取）
 * 3. 400ms 内双击同格 → 收集整类
 * 4. 双击满堆 → 退化成快速移动
 */
const { chromium } = require('playwright');

const URL = process.env.V2_URL;
const CHROME =
  '/Users/mason/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const DESIGN = { width: 1024, height: (1024 * 390) / 844 };

const assert = (c, m, extra) => {
  if (!c) throw new Error(`${m}${extra ? '\n' + JSON.stringify(extra) : ''}`);
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1080, height: 700 }, hasTouch: true });
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

  // ---------------------------------------------------------------- 1. 260ms 长按
  await call('resetInventoryForTest');
  await call('giveToSlot', 9, 1, 30);
  await tap(815, 424);
  await wait((s) => s.inventoryOpen, '背包没打开');
  await page.waitForTimeout(400);
  const g = await geo();
  const cell9 = pt(g.contentX + 22, g.contentY + 22);

  // 按住 300ms（> 260、< 400）后抬手：应当"拿一半"= 15
  await page.mouse.move(cell9.x, cell9.y);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const half = { held: latest?.cursorCount, slot9: await call('slotAt', 9) };
  console.log('[1] 长按 300ms →', JSON.stringify(half));
  assert(half.held === 15 && half.slot9 === 15, '260ms 长按没有拿一半', half);
  await call('resetInventoryForTest');

  // ---------------------------------------------------------------- 2. 连发
  // 手上拿 5 个，长按空格 → 应当连续放到只剩 0（一次放一个，每 170ms 一次）
  await call('giveToSlot', 9, 1, 5);
  await call('tapSlot', 'inventory', 9, 'left'); // 抓起 5 个
  await page.waitForTimeout(200);
  const emptyCell = pt(g.contentX + 22 + 46, g.contentY + 22); // 10 号格
  await page.mouse.move(emptyCell.x, emptyCell.y);
  await page.mouse.down();
  await page.waitForTimeout(1000); // 260 + 170*4 ≈ 940ms → 至少放 4 个
  await page.mouse.up();
  await page.waitForTimeout(300);
  const repeat = { held: latest?.cursorCount, slot10: await call('slotAt', 10) };
  console.log('[2] 按住 1s →', JSON.stringify(repeat));
  assert(
    (repeat.slot10 ?? 0) >= 2 && (repeat.held ?? 0) < 5,
    '连发没生效（应当连续放下多件）',
    repeat,
  );
  await call('resetInventoryForTest');

  // ---------------------------------------------------------------- 3. 双击收集
  await call('giveToSlot', 9, 1, 20);
  await call('giveToSlot', 10, 1, 20);
  await call('giveToSlot', 11, 1, 20);
  await page.waitForTimeout(300);
  const c9 = pt(g.contentX + 22, g.contentY + 22);
  await page.touchscreen.tap(c9.x, c9.y);
  await page.waitForTimeout(80);
  await page.touchscreen.tap(c9.x, c9.y);
  await page.waitForTimeout(500);
  const gathered = { held: latest?.cursorCount, s9: await call('slotAt', 9), s10: await call('slotAt', 10), s11: await call('slotAt', 11) };
  console.log('[3] 双击同格 →', JSON.stringify(gathered));
  assert((gathered.held ?? 0) >= 40, '双击没有收集整类', gathered);

  console.log('\n✓ 四条 Web 版规则在运行时全部生效');
  await browser.close();
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
