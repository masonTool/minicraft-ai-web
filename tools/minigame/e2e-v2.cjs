/**
 * v2 主流程自动验收
 *
 * 前置：helper 预览运行的是 minigame-v2。
 *   npm run test:minigame:v2-flow
 */

const fs = require('node:fs');
const { chromium } = require('playwright');

const URL = 'http://localhost:3847/';
const DEFAULT_CHROME =
  '/Users/mason/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const CHROME_PATH =
  process.env.CHROME_PATH || (fs.existsSync(DEFAULT_CHROME) ? DEFAULT_CHROME : undefined);
const DESIGN = { width: 1024, height: (1024 * 390) / 844 };

const assert = (condition, message, state) => {
  if (condition) return;
  const suffix = state ? `\nstate=${JSON.stringify(state)}` : '';
  throw new Error(message + suffix);
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1080, height: 700 }, hasTouch: true });
  const page = await context.newPage();
  let latest = null;
  page.on('console', (message) => {
    const text = message.text();
    const index = text.indexOf('[V2] ');
    if (index < 0) return;
    try {
      latest = JSON.parse(text.slice(index + 5));
    } catch {
      /* ignore */
    }
  });
  page.on('pageerror', (error) => console.error('[pageerror]', error.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  latest = null;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const box = await page.locator('iframe').boundingBox();
  assert(box, '找不到 iframe');
  const point = (x, y) => ({
    x: box.x + (x / DESIGN.width) * box.width,
    y: box.y + (y / DESIGN.height) * box.height,
  });
  const tap = async (x, y) => {
    const p = point(x, y);
    await page.touchscreen.tap(p.x, p.y);
  };
  const waitState = async (predicate, message, timeout = 15000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      if (latest && predicate(latest)) return latest;
      await page.waitForTimeout(150);
    }
    throw new Error(`${message}\nlast=${JSON.stringify(latest)}`);
  };

  const title = await waitState((state) => state.screen === 'title', '未进入标题页');
  await tap(512, 327);
  const worlds = await waitState((state) => state.screen === 'worlds', '未进入世界列表');
  await tap(512, 216);
  const create = await waitState((state) => state.screen === 'create', '未进入新建表单');
  await tap(727, 423);
  const inGame = await waitState(
    (state) => state.screen === 'game' && state.chunks > 0 && state.drawn > 0,
    '创建世界后没有进入/绘制世界',
    40000,
  );
  assert(inGame.worldCount === 1, '世界数量应为 1', inGame);

  await tap(510, 36);
  const paused = await waitState((state) => state.paused && state.screen === 'pause', '暂停没有打开');
  await tap(402, 313);
  const resumed = await waitState((state) => !state.paused && state.screen === 'game', '暂停没有继续');

  const liveFrame = page.frames().find((item) => item.url().startsWith('about:srcdoc'));
  assert(liveFrame, '容器用例找不到 iframe');
  const hook = await liveFrame.evaluate(() => {
    try {
      const api = wx.__v2Test;
      return { has: typeof api?.openChestAtFeet, value: api?.openChestAtFeet?.() };
    } catch (error) {
      return { error: String(error) };
    }
  });
  console.log('container hook', JSON.stringify(hook));
  const containerOpen = await waitState((state) => state.containerOpen, '容器没有打开', 5000);
  await liveFrame.evaluate(() => wx.__v2Test?.fillChestFirst?.(1, 2));
  await waitState((state) => state.containerSlots?.[0] === 1, '箱子预置物品失败', 5000);
  await tap(292, 192);
  const containerTaken = await waitState(
    (state) => state.inventory?.[0] === 1 && state.containerSlots?.[0] === 0,
    '从箱子取出物品失败',
    5000,
  );
  await tap(775, 108);
  const containerClosed = await waitState((state) => !state.containerOpen, '容器没有关闭', 5000);

  await tap(815, 424);
  const inventory = await waitState((state) => state.inventoryOpen && state.screen === 'inventory', '背包没有打开');
  await tap(902, 56);
  const inventoryClosed = await waitState((state) => !state.inventoryOpen && state.screen === 'game', '背包没有关闭');

  // 暂停 → 保存返回菜单 → 编辑 → 删除
  await tap(510, 36);
  await waitState((state) => state.paused && state.screen === 'pause', '返回菜单用例暂停失败');
  await tap(512, 366);
  const worldsAfterPause = await waitState(
    (state) => state.screen === 'worlds' && state.worldCount === 1,
    '暂停保存后没有回到世界列表',
    10000,
  );
  await tap(682, 163);
  const editScreen = await waitState((state) => state.screen === 'edit', '世界编辑没有打开');
  await tap(252, 391);
  const worldsAfterEdit = await waitState((state) => state.screen === 'worlds', '编辑取消没有回列表');
  const deleteFrame = page.frames().find((item) => item.url().startsWith('about:srcdoc'));
  assert(deleteFrame, '删除用例找不到 iframe');
  await deleteFrame.evaluate(() => {
    wx.showModal = (options) => options?.success?.({ confirm: true, cancel: false });
  });
  await tap(782, 163);
  const afterDelete = await waitState(
    (state) => state.screen === 'worlds' && state.worldCount === 0,
    '删除世界后数量未归零',
    10000,
  );

  // helper 的存储是 mock，重载后世界清单可能重置；真机才验证跨进程恢复。
  latest = null;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const afterReload = await waitState((state) => state.screen === 'title', '重载后未回到标题');
  let reentered = null;
  if (afterReload.worldCount > 0) {
    await tap(512, 327);
    await waitState((state) => state.screen === 'worlds', '重载后未进入世界列表');
    await tap(512, 163);
    reentered = await waitState(
      (state) => state.screen === 'game' && state.chunks > 0 && state.drawn > 0,
      '重载后重进世界失败',
      40000,
    );
    assert(reentered.currentWorldId === inGame.currentWorldId, '重进世界 id 不一致', reentered);
  }

  console.log(
    'PASS',
    JSON.stringify(
      { title, worlds, create, inGame, paused, resumed, inventory, inventoryClosed, worldsAfterPause, editScreen, worldsAfterEdit, afterDelete, afterReload, reentered },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((error) => {
  console.error('FAIL', error.message);
  process.exit(1);
});
