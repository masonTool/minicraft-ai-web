/**
 * 验收：生存模式左栏是**配方卡列表**（不是物品网格），创造模式是物品网格。
 *
 * 对拍 `docs/WEB-INVENTORY-SCREENS.md` 第 ④⑤ 两节。
 */
const { chromium } = require('playwright');

const URL = process.env.V2_URL;
const CHROME =
  '/Users/mason/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const DESIGN = { width: 1024, height: (1024 * 390) / 844 };
const DIR = '.tmp/shots/v2-cards';

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

  // 给材料：原木 + 圆石（能做出木板/木棍/工作台/熔炉之类）
  await call('resetInventoryForTest');
  // ⚠️ id 要按 blocks.ts 的真实值：OAK_LOG=5、COBBLESTONE=8。
  // 第一版写了 17/4（那是 oak_planks / sand），于是只做得出"砂岩"一张卡——
  // 代码是对的，是测试数据写错了。
  await call('giveToSlot', 9, 5, 32); // oak_log
  await call('giveToSlot', 10, 8, 32); // cobblestone
  await call('setGameMode', 'survival');

  await tap(815, 424);
  await wait((s) => s.inventoryOpen, '背包没打开');
  await page.waitForTimeout(400);
  const g = await geo();

  // 点左轨第 1 颗（全部）→ 生存下应显示**配方卡**
  await tap(g.leftRailX + 18, g.railTopY + 18);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/1-survival-cards.png` });
  console.log('[shot] 1-survival-cards');
  const cardsInfo = await frame.evaluate(() => wx.__v2Test.recipeCardInfo?.() ?? null);
  console.log('[cards]', JSON.stringify(cardsInfo));

  // 切创造 → 同一颗按钮应显示**物品网格**
  await call('setGameMode', 'creative');
  await page.waitForTimeout(400);
  await call('closeInventoryForTest');
  await tap(815, 424);
  await wait((s) => s.inventoryOpen, '再次打开背包失败');
  await page.waitForTimeout(400);
  await tap(g.leftRailX + 18, g.railTopY + 18);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/2-creative-grid.png` });
  console.log('[shot] 2-creative-grid');

  if (!cardsInfo) {
    console.error('FAIL 没有 recipeCardInfo 钩子，无法断言');
    process.exit(1);
  }
  if ((cardsInfo.total ?? 0) <= 0) {
    console.error('FAIL 生存模式下配方卡列表为空（给了原木+圆石，至少该有木板）', JSON.stringify(cardsInfo));
    process.exit(1);
  }
  console.log(`\n✓ 生存模式显示 ${cardsInfo.total} 张配方卡（其中可做 ${cardsInfo.craftable} 张）`);
  await browser.close();
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
