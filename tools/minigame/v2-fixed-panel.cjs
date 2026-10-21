/**
 * 验收：面板尺寸在切页签时**不许变**。
 *
 * 用户反馈"点击闪来闪去"——根因是 panelW/panelH 依赖当前页签。
 * 这里把每个页签的几何都读一遍，直接比较面板矩形。
 */
const { chromium } = require('playwright');

const URL = process.env.V2_URL;
const CHROME =
  '/Users/mason/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const DESIGN = { width: 1024, height: (1024 * 390) / 844 };
const DIR = '.tmp/shots/v2';

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
      await page.waitForTimeout(120);
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

  const gameFrame = page.frames().find((f) => f.url().startsWith('about:srcdoc'));
  await gameFrame.evaluate(() => {
    const api = wx.__v2Test;
    api.resetInventoryForTest();
    api.giveToSlot(9, 1, 64);
    api.giveToSlot(10, 3, 32);
    api.giveToSlot(0, 1, 10);
    api.giveToSlot(36, 1132, 1);
  });

  await tap(815, 424);
  await wait((s) => s.inventoryOpen, '背包没打开');
  await page.waitForTimeout(400);

  const readGeo = () => gameFrame.evaluate(() => wx.__v2Test.inventoryGeo());

  const seen = [];
  const record = async (label) => {
    const g = await readGeo();
    seen.push({
      label,
      x: Math.round(g.panelX),
      y: Math.round(g.panelY),
      w: Math.round(g.panelW),
      h: Math.round(g.panelH),
    });
    await page.screenshot({ path: `${DIR}/fixed-${label}.png` });
    console.log(`[${label}] panel ${Math.round(g.panelW)}x${Math.round(g.panelH)} @${Math.round(g.panelX)},${Math.round(g.panelY)}`);
    return g;
  };

  const g0 = await record('01-items');
  const geo = g0;

  // 左轨第 2 颗（建筑分类）
  await tap(geo.leftRailX + 18, geo.railTopY + 18 + 38);
  await page.waitForTimeout(600);
  await record('02-creative');

  // 再点第 1 颗（全部）
  await tap(geo.leftRailX + 18, geo.railTopY + 18);
  await page.waitForTimeout(600);
  await record('03-creative-all');

  // 右轨最下（盔甲）
  await tap(geo.rightRailX + 18, geo.railTopY + 18 + 2 * 40);
  await page.waitForTimeout(600);
  await record('04-armor');

  // 左轨底部（物品栏）
  await tap(geo.leftRailX + 18, geo.panelY + geo.panelH - 24);
  await page.waitForTimeout(600);
  await record('05-items-back');

  // 断言：宽高与位置完全一致
  const base = seen[0];
  const drift = seen.filter((s) => s.w !== base.w || s.h !== base.h || s.x !== base.x || s.y !== base.y);
  console.log('\n[seens]', JSON.stringify(seen, null, 1));
  if (drift.length > 0) {
    console.error('FAIL 面板尺寸/位置随页签变化：', JSON.stringify(drift));
    process.exit(1);
  }
  console.log('\n✓ 五个页签的面板矩形完全一致（不再闪）');
  await browser.close();
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
