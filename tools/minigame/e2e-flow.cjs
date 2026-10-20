#!/usr/bin/env node
/**
 * 小程序初始流程自动验收（需要 helper 预览已在跑）
 *
 * 运行：
 *   NODE_PATH=$(npm root -g) node tools/minigame/e2e-flow.cjs
 *
 * 环境变量：
 *   MINIGAME_URL 默认 http://localhost:3847/
 *   CHROME_PATH  可选 Chromium 可执行文件；不填则用 Playwright 默认
 *
 * 覆盖：标题 → 游戏 → 新建世界 → 创建并进入 → 暂停 → 设置 → 控制页 → 返回 → 继续
 * 判定：读取 wx.testState，不靠截图猜。
 */

const fs = require('node:fs');
const { chromium } = require('playwright');

const URL = process.env.MINIGAME_URL || 'http://localhost:3847/';
const DEFAULT_CHROME =
  '/Users/mason/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const CHROME_PATH =
  process.env.CHROME_PATH || (fs.existsSync(DEFAULT_CHROME) ? DEFAULT_CHROME : undefined);
const DESIGN_HEIGHT = (1024 * 390) / 844;
const DESIGN = { width: 1024, height: DESIGN_HEIGHT };

function assert(condition, message, state) {
  if (condition) return;
  const detail = state ? `\nstate=${JSON.stringify(state)}` : '';
  throw new Error(`${message}${detail}`);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1080, height: 700 },
    hasTouch: true,
  });
  const page = await context.newPage();
  let latestState = null;
  page.on('console', (message) => {
    const text = message.text();
    const index = text.indexOf('[FLOW] ');
    if (index < 0) return;
    try {
      latestState = JSON.parse(text.slice(index + 7));
    } catch {
      /* ignore malformed state */
    }
  });
  page.on('pageerror', (error) => console.error('[pageerror]', error.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  latestState = null;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(9000);

  const frame = page.frames().find((item) => item.url().startsWith('about:srcdoc'));
  assert(frame, '找不到小游戏 iframe');

  const readState = async () => {
    if (latestState) return latestState;
    return null;
  };

  const tap = async (x, y) => {
    const box = await page.locator('iframe').boundingBox();
    assert(box, '找不到 iframe 位置');
    const px = box.x + (x / DESIGN.width) * box.width;
    const py = box.y + (y / DESIGN.height) * box.height;
    await page.touchscreen.tap(px, py);
  };

  const waitState = async (predicate, message, timeout = 15000) => {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeout) {
      last = await readState();
      if (last && predicate(last)) return last;
      await page.waitForTimeout(250);
    }
    assert(false, message, last);
  };

  try {
    const title = await waitState((state) => state.screen === 'title', '未停在标题页');
    assert(title.menuOpen, '标题页 menuOpen 应为 true', title);

    // 标题 → 设置 → 返回：必须回到标题，不能进入世界
    await tap(512, DESIGN.height * 0.5 + 78);
    const titleSettings = await waitState((state) => state.settings, '标题页设置未打开');
    await tap(388, 112.5);
    await waitState((state) => state.settingsTab === 'game', '标题设置游戏页未切换');
    await tap(521, 112.5);
    await waitState((state) => state.settingsTab === 'controls', '标题设置控制页未切换');
    await tap(654, 112.5);
    await waitState((state) => state.settingsTab === 'sound', '标题设置声音页未切换');
    await tap(774, 58.5);
    const titleAgain = await waitState(
      (state) => state.menuOpen && state.screen === 'title' && !state.settings,
      '标题页设置关闭后没有回到标题',
    );
    assert(!titleAgain.inGame, '标题页关闭设置后错误进入了游戏', titleAgain);

    await tap(512, DESIGN.height * 0.5 + 26);
    const worlds = await waitState(
      (state) => state.screen === 'worlds',
      '点“游戏”后未进入世界列表',
    );
    const beforeCount = worlds.worldCount;

    await tap(512, 110.5);
    await waitState((state) => state.screen === 'create', '点“新建世界”后未进入表单');

    await tap(512, 414.5);
    const ingame = await waitState(
      (state) => state.inGame && state.chunks > 0 && state.drawn > 0,
      '创建并进入后没有进入可绘制的新世界',
      30000,
    );
    assert(
      ingame.worldCount === beforeCount + 1,
      `创建后世界数量应 +1（before=${beforeCount}, after=${ingame.worldCount}）`,
      ingame,
    );
    assert(ingame.health === 20, '新世界生命应为 20', ingame);
    await page.screenshot({ path: '/tmp/e2e-created.png' });

    await tap(512, 86);
    const paused = await waitState((state) => state.paused, '点暂停后没有打开暂停面板');

    await tap(512, 214.5);
    const settings = await waitState((state) => state.settings, '暂停→设置未打开');
    await tap(260, 112.5);
    await waitState((state) => state.settingsTab === 'video', '视频页 tab 未切换');

    await tap(521, 112);
    const controls = await waitState(
      (state) => state.settings && state.settingsTab === 'controls',
      '控制页 tab 未切换',
    );

    await tap(774, 58.5);
    const backToPause = await waitState((state) => state.paused, '设置返回后没有回到暂停');
    await tap(512, 156.5);
    const resumed = await waitState((state) => state.inGame && !state.paused, '继续游戏没有回到世界');

    // 背包：打开/关闭
    await tap(865, 414);
    const inventory = await waitState((state) => state.inventory, '点击快捷栏背包没有打开背包');
    await tap(875, 66.5);
    const inventoryClosed = await waitState((state) => !state.inventory, '背包关闭失败');

    // 设置四个页签
    await tap(512, 86);
    await waitState((state) => state.paused, '第二次暂停失败');
    await tap(512, 214.5);
    await waitState((state) => state.settings, '第二次打开设置失败');
    await tap(388, 112.5);
    const gameTab = await waitState((state) => state.settingsTab === 'game', '游戏页 tab 未切换');
    await tap(521, 112.5);
    await waitState((state) => state.settingsTab === 'controls', '控制页 tab 未切换');
    await tap(654, 112.5);
    const soundTab = await waitState((state) => state.settingsTab === 'sound', '声音页 tab 未切换');
    await tap(774, 58.5);
    await waitState((state) => state.paused, '设置返回暂停失败');

    // 暂停 → 保存并返回世界列表
    await tap(512, 272.5);
    const backToWorlds = await waitState((state) => state.screen === 'worlds', '保存并返回世界列表失败');

    // 新建创造世界：模式行切到创造，创建后 gameMode 应为 creative
    const worldsBeforeCreative = backToWorlds.worldCount;
    await tap(512, 110.5);
    await waitState((state) => state.screen === 'create', '第二次新建世界失败');
    // 类型：默认→超平坦；难度：普通→困难；模式：生存→创造
    await tap(600, 234.5);
    await tap(600, 284.5);
    await tap(600, 335);
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/e2e-create-creative.png' });
    await tap(512, 414.5);
    const creative = await waitState(
      (state) =>
        state.inGame &&
        state.gameMode === 'creative' &&
        state.worldType === 'flat' &&
        state.difficulty === 'hard' &&
        state.chunks > 0 &&
        state.drawn > 0,
      '超平坦/困难/创造世界没有按选择创建并进入',
      30000,
    );
    assert(creative.worldCount === worldsBeforeCreative + 1, '创造世界数量未增加', creative);

    // 切回默认世界：验证非当前世界的原地切换
    await tap(512, 86);
    await waitState((state) => state.paused, '创造世界暂停失败');
    await tap(512, 272.5);
    const worldsAgain = await waitState((state) => state.screen === 'worlds', '返回世界列表失败');
    await tap(702, 174.5);
    const switched = await waitState(
      (state) => state.inGame && state.currentWorldId === 'wx-default' && state.chunks > 0 && state.drawn > 0,
      '进入其他世界失败',
      30000,
    );
    assert(switched.currentWorldId !== creative.currentWorldId, '切换世界后 currentWorldId 未变化', switched);

    // 世界卡片删除：自动确认，校验世界数量减少
    await frame.evaluate(() => {
      wx.showModal = (options) => {
        options?.success?.({ confirm: true, cancel: false });
      };
    });
    await tap(512, 86);
    await waitState((state) => state.paused, '删除用例暂停失败');
    await tap(512, 272.5);
    const beforeDelete = await waitState((state) => state.screen === 'worlds', '删除用例返回世界列表失败');
    await tap(616, 250.5);
    const afterDelete = await waitState(
      (state) => state.screen === 'worlds' && state.worldCount === beforeDelete.worldCount - 1,
      '删除非当前世界后数量未减少',
      10000,
    );

    console.log('PASS');
    console.log(JSON.stringify({ title, titleSettings, titleAgain, worlds, ingame, paused, settings, controls, backToPause, resumed, inventory, inventoryClosed, gameTab, soundTab, backToWorlds, creative, worldsAgain, switched, titleSettings, beforeDelete, afterDelete }, null, 2));
  } catch (error) {
    await page.screenshot({ path: '/tmp/e2e-fail.png' }).catch(() => undefined);
    console.error('FAIL:', error.message);
    try {
      console.error('last state:', JSON.stringify(await readState(), null, 2));
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
