/**
 * v2 主流程自动验收
 *
 * 前置：helper 预览运行的是 minigame-v2。
 *   npm run test:minigame:v2-flow
 *
 * helper 的预览端口**每次启动都可能变**（`run_game` 会给新端口），
 * 所以地址走环境变量：`V2_URL=http://localhost:50856/ npm run test:minigame:v2-flow`。
 */

const fs = require('node:fs');
const { chromium } = require('playwright');

const URL = process.env.V2_URL || 'http://localhost:3847/';
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

  let iframeBox = null;
  for (let attempt = 0; attempt < 15 && !iframeBox; attempt++) {
    iframeBox = await page.evaluate(() => {
      const frame = document.querySelector('iframe');
      if (!frame) return null;
      const rect = frame.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null;
    });
    if (!iframeBox) await page.waitForTimeout(200);
  }
  const srcdocFrame = page.frames().find((item) => item.url().startsWith('about:srcdoc'));
  let canvasBox = null;
  if (!iframeBox) {
    canvasBox = await page.evaluate(() => {
      for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }
      }
      return null;
    });
  }
  const viewport = page.viewportSize() || { width: 1080, height: 700 };
  const box = iframeBox ?? canvasBox ?? { x: 0, y: 0, ...viewport };
  assert(box, '找不到游戏画布');
  const gameFrame = iframeBox ? srcdocFrame : srcdocFrame ?? page.mainFrame();
  assert(gameFrame, '找不到游戏 frame');
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
  await page.waitForTimeout(800);
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
  assert(inGame.health === 20 && inGame.food === 20, '初始生命/饥饿应为 20', inGame);

  // Phase 1：41 格模型（护甲 36-39 + 副手 40）可读写
  await gameFrame.evaluate(() => {
    wx.__v2Test?.clearInventory?.();
    wx.__v2Test?.giveToSlot?.(36, 1132, 1);
    wx.__v2Test?.giveToSlot?.(40, 7, 2);
  });
  const slots41 = await waitState(
    (state) => state.inventorySlots?.[36] === 1132 && state.inventorySlots?.[40] === 7,
    '41 格护甲/副手读写失败',
    5000,
  );

  // 背包点物品 → 合成格 → 产物
  // ⚠️ Phase 2 起交互是**光标语义**（SPEC §4）：点背包物品是"拿在手上"，
  // 再点合成格才放进去——不再是"点一下直接进合成格"。
  await gameFrame.evaluate(() => {
    wx.__v2Test?.clearInventory?.();
    wx.__v2Test?.giveToSlot?.(9, 5, 1);
  });
  await tap(815, 424);
  const bagOpened = await waitState((state) => state.inventoryOpen, '合成用例打开背包失败', 5000);
  await tap(277, 131);
  const pickedUp = await waitState(
    (state) => state.cursorHeld === 5 && state.inventorySlots?.[9] === 0,
    '点背包物品没有拿到手上',
    5000,
  );
  await tap(779, 128);
  const recipeFilled = await waitState(
    (state) => state.crafting?.[0] === 5 && state.craftResult === 7 && state.cursorHeld === 0,
    '点击合成格没有放入物品/出产物',
    5000,
  );
  await tap(935, 154);
  const crafted = await waitState(
    (state) => state.cursorHeld === 7 && state.cursorCount === 4 && state.craftResult === 0,
    '点击产物没有合成/取出',
    5000,
  );
  await tap(902, 56);
  await waitState((state) => !state.inventoryOpen, '合成用例关闭背包失败', 5000);

  // Phase 2（INVENTORY_SPEC §4）：光标语义 —— 拿起 / 放下 / 合并 / 交换 / 拿一半 / 只取不放
  // 走的是玩家真实路径（`tapSlot` 就是界面点击的那个 `clickSlot`），不绕过状态机
  const phase2 = await gameFrame.evaluate(() => {
    const api = wx.__v2Test;
    const out = {};
    // ① 拿起整叠 → 手上 30、格子空
    api.resetInventoryForTest();
    api.giveToSlot(9, 1, 30);
    api.tapSlot('inventory', 9, 'left');
    out.pickedUp = { held: api.snapshot(), slot: api.slotAt(9) };
    // ② 放到空格 10
    api.tapSlot('inventory', 10, 'left');
    out.placed = { held: api.snapshot(), slot: api.slotAt(10) };
    // ③ 同类合并：9 号有 60、手上 20 → 补满 64、手上剩 16
    api.resetInventoryForTest();
    api.giveToSlot(9, 1, 60);
    api.giveToSlot(10, 1, 20);
    api.tapSlot('inventory', 10, 'left');
    api.tapSlot('inventory', 9, 'left');
    out.merged = { slot: api.slotAt(9), held: api.snapshot() };
    // ④ 长按（右键）拿一半：30 → 15 / 15
    api.resetInventoryForTest();
    api.giveToSlot(9, 1, 30);
    api.tapSlot('inventory', 9, 'right');
    out.half = { slot: api.slotAt(9), held: api.snapshot() };
    // ⑤ 关闭回收：手上那半回背包，数量不丢
    api.closeInventoryForTest();
    out.closed = { held: api.snapshot(), total: api.totalOf(1) };
    return out;
  });

  console.log('phase2', JSON.stringify(phase2));
  assert(phase2.pickedUp.held?.count === 30 && phase2.pickedUp.slot === 0, 'Phase2 拿起整叠失败', phase2);
  assert(phase2.placed.slot === 30 && phase2.placed.held === null, 'Phase2 放下整叠失败', phase2);
  assert(phase2.merged.slot === 64 && phase2.merged.held?.count === 16, 'Phase2 同类合并失败', phase2);
  assert(phase2.half.slot === 15 && phase2.half.held?.count === 15, 'Phase2 长按拿一半失败', phase2);
  assert(phase2.closed.held === null && phase2.closed.total === 30, 'Phase2 关闭回收丢物品', phase2);

  // 猪生成与击杀掉落
  const pigSpawned = await waitState((state) => state.pigs > 0, '猪没有生成', 20000);
  const pigKilled = await gameFrame.evaluate(() => wx.__v2Test?.killPig?.());
  const pigGone = await waitState(
    (state) => state.pigs === 0 && state.drops > 0,
    '猪没有死亡掉落',
    5000,
  );

  // 羊生成/击杀
  const sheepSpawned = await waitState((state) => state.sheep > 0, '羊没有生成', 20000);
  const sheepKilled = await gameFrame.evaluate(() => wx.__v2Test?.killSheep?.());
  const sheepGone = await waitState(
    (state) => state.sheep === 0 && state.drops > 0,
    '羊没有死亡掉落',
    5000,
  );

  // 僵尸生成/击杀
  await gameFrame.evaluate(() => wx.__v2Test?.spawnZombie?.());
  const zombieSpawned = await waitState((state) => state.zombies > 0, '僵尸没有生成', 5000);
  await gameFrame.evaluate(() => wx.__v2Test?.killZombie?.());
  const zombieGone = await waitState((state) => state.zombies === 0, '僵尸没有死亡', 5000);

  // 创造双击跳跃：起飞/落地
  await gameFrame.evaluate(() => wx.__v2Test?.setGameMode?.('creative'));
  const jumpPoint = point(962, 319);
  await page.touchscreen.tap(jumpPoint.x, jumpPoint.y);
  await page.waitForTimeout(80);
  await page.touchscreen.tap(jumpPoint.x, jumpPoint.y);
  const flyingOn = await waitState((state) => state.flying, '双击跳跃没有起飞', 5000);
  await page.waitForTimeout(100);
  await page.touchscreen.tap(jumpPoint.x, jumpPoint.y);
  await page.waitForTimeout(80);
  await page.touchscreen.tap(jumpPoint.x, jumpPoint.y);
  const flyingOff = await waitState((state) => !state.flying, '双击跳跃没有落地', 5000);

  // 死亡 → 重生
  await gameFrame.evaluate(() => {
    wx.__v2Test?.setGameMode?.('survival');
    wx.__v2Test?.setHealth?.(0);
  });
  const deathScreen = await waitState((state) => state.dead, '生命归零后没有死亡界面', 5000);
  await tap(512, 321);
  const respawned = await waitState(
    (state) => !state.dead && state.health === 20 && state.food === 20,
    '重生没有恢复生命/饥饿',
    5000,
  );

  // 摇杆拖动：玩家坐标应变化
  const stickCenter = point(84, 317);
  const beforeMove = await waitState((state) => state.screen === 'game', '摇杆用例未进入游戏');
  await page.mouse.move(stickCenter.x, stickCenter.y);
  await page.mouse.down();
  await page.mouse.move(stickCenter.x, stickCenter.y - 70, { steps: 8 });
  await page.waitForTimeout(900);
  await page.mouse.up();
  const afterMove = await waitState(
    (state) => Math.hypot(state.x - beforeMove.x, state.z - beforeMove.z) > 0.15,
    '摇杆拖动没有移动玩家',
    5000,
  );

  // 双击摇杆开/关潜行
  const joystickDouble = async () => {
    await page.touchscreen.tap(stickCenter.x, stickCenter.y);
    await page.waitForTimeout(80);
    await page.touchscreen.tap(stickCenter.x, stickCenter.y);
  };
  const setSneak = async (target) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (latest && latest.sneaking === target) return latest;
      await joystickDouble();
      await page.waitForTimeout(450);
    }
    throw new Error(`双击摇杆没有${target ? '开启' : '关闭'}潜行\nlast=` + JSON.stringify(latest));
  };
  const sneakOn = await setSneak(true);
  await setSneak(false);

  await tap(530, 36);
  const paused = await waitState((state) => state.paused && state.screen === 'pause', '暂停没有打开');
  await tap(402, 313);
  const resumed = await waitState((state) => !state.paused && state.screen === 'game', '暂停没有继续');

  const closeContainer = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await tap(775, 82);
      await page.waitForTimeout(250);
      if (latest && !latest.containerOpen) return latest;
    }
    throw new Error('容器没有关闭\nlast=' + JSON.stringify(latest));
  };

  const hook = await gameFrame.evaluate(() => {
    try {
      const api = wx.__v2Test;
      return { has: typeof api?.openChestAtFeet, value: api?.openChestAtFeet?.() };
    } catch (error) {
      return { error: String(error) };
    }
  });
  console.log('container hook', JSON.stringify(hook));
  const containerOpen = await waitState((state) => state.containerOpen, '容器没有打开', 5000);
  await gameFrame.evaluate(() => wx.__v2Test?.fillChestFirst?.(1, 2));
  await waitState((state) => state.containerSlots?.[0] === 1, '箱子预置物品失败', 5000);
  let containerTaken = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await tap(292, 158);
    await page.waitForTimeout(350);
    if (latest && latest.inventory?.includes(1) && latest.containerSlots?.[0] === 0) {
      containerTaken = latest;
      break;
    }
  }
  assert(containerTaken, '从箱子取出物品失败', latest);
  const containerClosed = await closeContainer();

  const selectSlotZero = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await tap(269, 424);
      await page.waitForTimeout(250);
      if (latest && latest.selectedSlot === 0) return latest;
    }
    throw new Error('快捷栏槽位选择失败\nlast=' + JSON.stringify(latest));
  };

  // 背包 → 箱子存入：先给物品并选中槽 0，再点箱子空槽
  await gameFrame.evaluate(() => {
    wx.__v2Test?.clearInventory?.();
    wx.__v2Test?.giveItem?.(3, 1);
  });
  await page.waitForTimeout(300);
  await selectSlotZero();
  await gameFrame.evaluate(() => wx.__v2Test?.openChestAtFeet?.());
  await waitState((state) => state.containerOpen, '存入用例打开箱子失败', 5000);
  let containerStored = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await selectSlotZero();
    await page.waitForTimeout(250);
    await tap(292, 158);
    await page.waitForTimeout(350);
    if (latest && latest.containerSlots?.[0] === 3 && latest.inventory?.[0] === 0) {
      containerStored = latest;
      break;
    }
  }
  assert(containerStored, '背包物品没有存入箱子', latest);
  await closeContainer();

  // 熔炉打开/关闭
  await gameFrame.evaluate(() => wx.__v2Test?.openFurnaceAtFeet?.());
  const furnaceOpen = await waitState((state) => state.containerOpen, '熔炉没有打开', 5000);
  const smelted = await gameFrame.evaluate(() => wx.__v2Test?.smeltFurnace?.());
  const furnaceCooked = await waitState(
    (state) => state.containerSlots?.[2] === 1009,
    '铁矿石没有熔炼成铁锭',
    5000,
  );
  const furnaceClosed = await closeContainer();

  await tap(815, 424);
  const inventory = await waitState((state) => state.inventoryOpen && state.screen === 'inventory', '背包没有打开');
  await tap(902, 56);
  const inventoryClosed = await waitState((state) => !state.inventoryOpen && state.screen === 'game', '背包没有关闭');

  // 暂停 → 保存返回菜单 → 编辑 → 删除
  await tap(530, 36);
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
  await gameFrame.evaluate(() => {
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
      { title, worlds, create, inGame, pigSpawned, pigKilled, pigGone, sheepSpawned, sheepKilled, sheepGone, zombieSpawned, zombieGone, flyingOn, flyingOff, deathScreen, respawned, afterMove, sneakOn, paused, resumed, slots41, bagOpened, recipeFilled, crafted, inventory, inventoryClosed, worldsAfterPause, editScreen, worldsAfterEdit, afterDelete, afterReload, reentered },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((error) => {
  console.error('FAIL', error.message);
  process.exit(1);
});
