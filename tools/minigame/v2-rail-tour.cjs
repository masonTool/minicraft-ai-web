/**
 * v2：把左右轨每一颗都点一遍并截图（与 Web 版同样的走法）。
 *
 * 目的：对拍 `docs/WEB-INVENTORY-SCREENS.md` 里那几张，确认 v2 的每个界面
 * 都照着实现了。
 */
const { chromium } = require('playwright');

const URL = process.env.V2_URL;
const CHROME =
  '/Users/mason/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const DESIGN = { width: 1024, height: (1024 * 390) / 844 };
const DIR = '.tmp/shots/v2-rail';

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
  await call('resetInventoryForTest');
  await call('giveToSlot', 9, 1, 64);
  await call('giveToSlot', 10, 4, 32);
  await call('giveToSlot', 36, 1132, 1); // 铁头盔（看预览有没有套灰）
  await call('setGameMode', 'creative');

  await tap(815, 424);
  await wait((s) => s.inventoryOpen, '背包没打开');
  await page.waitForTimeout(500);
  const g = await frame.evaluate(() => wx.__v2Test.inventoryGeo());

  let n = 0;
  const shot = async (name) => {
    const p = `${DIR}/${String(++n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: p });
    console.log('[shot]', p);
  };

  // 初始（合成页）
  await shot('物品栏-合成');

  // 左轨 5 颗分类（x = 左轨中心，y = railTop + i*38 + 18）
  const catNames = ['全部', '建筑', '装备', '物品', '自然'];
  for (let i = 0; i < 5; i++) {
    await tap(g.leftRailX + 18, g.railTopY + i * 38 + 18);
    await page.waitForTimeout(700);
    await shot(`分类-${catNames[i]}`);
  }

  // 左轨底部：物品栏（面板底部那颗）
  await tap(g.leftRailX + 18, g.panelY + g.panelH - 24);
  await page.waitForTimeout(700);
  await shot('物品栏');

  // 右轨 3 颗：成就 / 合成 / 盔甲（垂直居中，gap 4）
  const totalH = 3 * 36 + 2 * 4;
  const top = g.panelY + (g.panelH - totalH) / 2;
  const modeNames = ['成就', '合成', '盔甲'];
  for (let i = 0; i < 3; i++) {
    await tap(g.rightRailX + 18, top + i * 40 + 18);
    await page.waitForTimeout(700);
    await shot(`右轨-${modeNames[i]}`);
  }

  await browser.close();
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
