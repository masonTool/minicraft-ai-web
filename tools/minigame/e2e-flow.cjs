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
  const cdp = await context.newCDPSession(page);
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

  const point = async (x, y) => {
    const box = await page.locator('iframe').boundingBox();
    assert(box, '找不到 iframe 位置');
    return {
      x: box.x + (x / DESIGN.width) * box.width,
      y: box.y + (y / DESIGN.height) * box.height,
    };
  };

  const tap = async (x, y) => {
    const p = await point(x, y);
    await page.touchscreen.tap(p.x, p.y);
  };

  const ensurePause = async () => {
    await tap(512, 86);
    try {
      await waitState((state) => state.paused, '暂停未打开', 1600);
    } catch {
      await tap(512, 86);
      await waitState((state) => state.paused, '暂停未打开（重试后）', 5000);
    }
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
    // 改亮度 + 左手模式，关闭再打开应保留
    await tap(260, 112.5);
    await waitState((state) => state.settingsTab === 'video', '标题设置未回到视频页');
    await tap(650, 381.5);
    await tap(521, 112.5);
    await waitState((state) => state.settingsTab === 'controls', '标题设置未切到控制页');
    await tap(600, 383.5);
    await tap(687, 160.5);
    const tuned = await waitState(
      (state) => state.brightness > 1 && state.leftHanded && state.aimMode === 'center',
      '亮度/左手/瞄准方式修改未生效',
    );
    await tap(774, 58.5);
    const titleAgain = await waitState(
      (state) => state.menuOpen && state.screen === 'title' && !state.settings,
      '标题页设置关闭后没有回到标题',
    );
    assert(!titleAgain.inGame, '标题页关闭设置后错误进入了游戏', titleAgain);
    await tap(512, DESIGN.height * 0.5 + 78);
    const reopened = await waitState(
      (state) => state.settings && state.brightness === tuned.brightness &&
        state.leftHanded === tuned.leftHanded &&
        state.aimMode === tuned.aimMode,
      '设置关闭再打开后修改丢失',
    );
    // 恢复默认，避免影响后续触摸坐标用例
    await tap(687, 160.5);
    await waitState((state) => state.aimMode === 'finger', '瞄准方式未切回手指', 5000);
    await tap(600, 383.5);
    await tap(260, 112.5);
    await tap(419, 381.5);
    await tap(774, 58.5);

    await tap(512, DESIGN.height * 0.5 + 26);
    const worlds = await waitState(
      (state) => state.screen === 'worlds',
      '点“游戏”后未进入世界列表',
    );
    const beforeCount = worlds.worldCount;

    // 编辑世界：打开 → 保存 → 回世界列表
    await tap(540, 174.5);
    const editOpen = await waitState((state) => state.screen === 'edit', '世界编辑弹窗未打开');
    await tap(512, 368.5);
    const editSaved = await waitState(
      (state) => state.screen === 'worlds' && state.worldCount === beforeCount,
      '世界编辑保存后未回世界列表',
    );

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

    await ensurePause();
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

    // 暂停切换生存/创造，再切回
    await ensurePause();
    await waitState((state) => state.paused, '模式切换用例暂停失败');
    await tap(512, 385.5);
    const modeCreative = await waitState(
      (state) => state.gameMode === 'creative',
      '暂停菜单没有切到创造模式',
    );
    await tap(512, 385.5);
    const modeSurvival = await waitState(
      (state) => state.gameMode === 'survival',
      '暂停菜单没有切回生存模式',
    );
    await tap(512, 156.5);
    await waitState((state) => state.inGame && !state.paused, '模式切换后继续游戏失败');

    // 背包：打开/关闭
    await tap(865, 414);
    const inventory = await waitState((state) => state.inventory, '点击快捷栏背包没有打开背包');
    await tap(875, 66.5);
    const inventoryClosed = await waitState((state) => !state.inventory, '背包关闭失败');

    // 设置四个页签
    await ensurePause();
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

    // 双击摇杆潜行，再双击恢复
    const stickCenter = await point(106, 277);
    const joystickDouble = async () => {
      await page.touchscreen.tap(stickCenter.x, stickCenter.y);
      await page.waitForTimeout(80);
      await page.touchscreen.tap(stickCenter.x, stickCenter.y);
    };
    await joystickDouble();
    const sneakOn = await waitState((state) => state.sneaking, '双击摇杆没有开启潜行');
    await joystickDouble();
    await waitState((state) => !state.sneaking, '双击摇杆没有关闭潜行', 5000);

    // 双击跳跃开飞行，再双击关闭
    const jumpCenter = await point(954, 311);
    const jumpDouble = async () => {
      await page.touchscreen.tap(jumpCenter.x, jumpCenter.y);
      await page.waitForTimeout(80);
      await page.touchscreen.tap(jumpCenter.x, jumpCenter.y);
    };
    await jumpDouble();
    const flyOn = await waitState((state) => state.flying, '双击跳跃没有开启飞行', 5000);
    await jumpDouble();
    await waitState((state) => !state.flying, '双击跳跃没有关闭飞行', 5000);

    // 切回默认世界：验证非当前世界的原地切换
    await ensurePause();
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
    const liveFrame = page.frames().find((item) => item.url().startsWith('about:srcdoc'));
    assert(liveFrame, '删除用例找不到当前 iframe');
    await liveFrame.evaluate(() => {
      wx.showModal = (options) => {
        options?.success?.({ confirm: true, cancel: false });
      };
    });
    await ensurePause();
    await waitState((state) => state.paused, '删除用例暂停失败');
    await tap(512, 272.5);
    const beforeDelete = await waitState((state) => state.screen === 'worlds', '删除用例返回世界列表失败');
    await tap(616, 250.5);
    const afterDelete = await waitState(
      (state) => state.screen === 'worlds' && state.worldCount === beforeDelete.worldCount - 1,
      '删除非当前世界后数量未减少',
      10000,
    );

    // 删除当前世界：进入 → 暂停 → 删除本世界 → 应回世界列表，不重启
    await tap(702, 174.5);
    await waitState((state) => state.inGame && state.chunks > 0, '删除当前世界用例进入失败');
    await ensurePause();
    await waitState((state) => state.paused, '删除当前世界用例暂停失败');
    await tap(512, 330.5);
    const afterCurrentDelete = await waitState(
      (state) => state.screen === 'worlds' && state.menuOpen && !state.inGame,
      '删除当前世界后没有回到世界列表',
      10000,
    );
    assert(
      afterCurrentDelete.worldCount === afterDelete.worldCount - 1,
      '删除当前世界后数量未减少',
      afterCurrentDelete,
    );

    // 删除后立刻进入剩余世界，验证空 currentWorldId 不会卡住
    await tap(702, 174.5);
    const reentered = await waitState(
      (state) => state.inGame && state.chunks > 0 && state.drawn > 0,
      '删除当前世界后无法进入剩余世界',
      30000,
    );

    console.log('PASS');
    console.log(JSON.stringify({ title, titleSettings, tuned, titleAgain, reopened, worlds, editOpen, editSaved, ingame, paused, settings, controls, backToPause, resumed, inventory, inventoryClosed, gameTab, soundTab, backToWorlds, creative, modeCreative, modeSurvival, sneakOn, flyOn, worldsAgain, switched, titleSettings, beforeDelete, afterDelete, afterCurrentDelete, reentered }, null, 2));
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
