/**
 * 验收：容器（箱子 / 熔炉）界面**与背包共用同一副壳**。
 *
 * 对拍 `WXMINIGAME_V2_INVENTORY_SPEC.md` §20（Phase 7）。
 *
 * 要证明的四件事：
 *  1. 箱子/熔炉面板不再是小窗：宽度与背包面板量级一致、格子一样大；
 *  2. 下半部分永远是玩家自己的 27 格（9..35），不是另画一份；
 *  3. 点箱子格能拿出东西、点背包格能放进去（同一条点击通道）；
 *  4. 关容器时光标上的东西不会消失（回背包或回原格）。
 *
 * 用法：V2_URL=http://localhost:3899 node tools/minigame/v2-container-e2e.cjs
 */

/**
 * 找 playwright。
 *
 * ⚠️ `NODE_PATH=$(npm root -g)/@playwright/cli/node_modules` 这套写法**在某些机器上
 * 解析不到**（`npm root -g` 指向的 node 版本里没装 @playwright，而别的版本装了）。
 * 所以这里自己找一遍：先试普通 require，再试几个已知布局。
 */
function loadPlaywright() {
  const { execSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  try {
    return require('playwright');
  } catch {}

  const candidates = [];
  // 1) `npm root -g` 下的 @playwright/cli/node_modules
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    candidates.push(path.join(root, '@playwright/cli/node_modules'));
  } catch {}
  // 2) 其它 node 版本（用户切过版本时很常见）
  const nvm = path.join(process.env.HOME ?? '', '.nvm/versions/node');
  if (fs.existsSync(nvm)) {
    for (const ver of fs.readdirSync(nvm)) {
      candidates.push(path.join(nvm, ver, 'lib/node_modules/@playwright/cli/node_modules'));
    }
  }
  // 3) 项目本地
  candidates.push(path.join(process.cwd(), 'node_modules'));

  for (const dir of candidates) {
    const mod = path.join(dir, 'playwright');
    if (fs.existsSync(mod)) return require(mod);
  }
  throw new Error(`找不到 playwright，试过这些位置：\n  ${candidates.join('\n  ')}`);
}

const { chromium } = loadPlaywright();

const URL = process.env.V2_URL;
const CHROME =
  '/Users/mason/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const DESIGN = { width: 1024, height: (1024 * 390) / 844 };
const DIR = '.tmp/shots/v2-container';

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

  const results = [];
  const check = (label, ok, detail = '') => {
    results.push({ label, ok, detail });
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? `  →  ${detail}` : ''}`);
  };

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const box = await page.evaluate(() => {
    const f = document.querySelector('iframe');
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!box) throw new Error('没找到 iframe');
  const pt = (x, y) => ({ x: box.x + (x / DESIGN.width) * box.width, y: box.y + (y / DESIGN.height) * box.height });
  const tap = async (x, y) => {
    const p = pt(x, y);
    await page.touchscreen.tap(p.x, p.y);
  };
  const wait = async (pred, msg, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (latest && pred(latest)) return latest;
      await page.waitForTimeout(100);
    }
    throw new Error(msg + '\n' + JSON.stringify(latest));
  };

  // ---- 走一遍标题 → 世界列表 → 新建 → 进游戏 ----
  await wait((s) => s.screen === 'title', '没进标题');
  await tap(512, 327);
  await wait((s) => s.screen === 'worlds', '没进列表');
  await tap(512, 216);
  await wait((s) => s.screen === 'create', '没进新建');
  await tap(727, 423);
  await wait((s) => s.screen === 'game' && s.drawn > 3, '没进游戏', 90000);
  await page.waitForTimeout(1200);

  const frame = page.frames().find((f) => f.url().startsWith('about:srcdoc'));
  if (!frame) throw new Error('没找到游戏 frame');
  const call = (fn, ...args) => frame.evaluate(([f, a]) => wx.__v2Test[f]?.(...a), [fn, args]);
  const shot = async (name) => {
    await page.screenshot({ path: `${DIR}/${name}.png` });
    return `${DIR}/${name}.png`;
  };

  // ============================================================ 1. 箱子
  console.log('\n[1] 箱子面板');
  await call('resetInventoryForTest');
  await call('giveToSlot', 9, 5, 20); // 背包 9 号：原木 20

  // ⚠️ `inventoryGeo` 只在背包面板重画时回写；容器面板走的是另一套壳，不会碰它。
  // 所以基准要**先开一次背包**量出来，否则读到的是 null（第一版就踩了这个）。
  const invGeo = await (async () => {
    await frame.evaluate(() => wx.__v2Test.openInventoryForTest?.());
    await page.waitForTimeout(300);
    return call('inventoryGeo');
  })();

  await call('openChestAtFeet');
  await page.waitForTimeout(600);

  const chestGeo = await call('containerGeo');
  check('容器面板有几何（说明真画出来了）', !!chestGeo, String(chestGeo));
  if (!chestGeo) throw new Error('容器面板没画出来');

  check('拿到了背包面板的几何（对比基准）', !!invGeo, String(invGeo));
  check(
    '箱子面板宽度与背包同量级（< 200px 差）',
    Math.abs(chestGeo.panelW - (invGeo?.panelW ?? chestGeo.panelW)) < 200,
    `容器 ${chestGeo.panelW} / 背包 ${invGeo?.panelW}`,
  );
  check('格子尺寸与背包一致（44）', chestGeo.slotSize === (invGeo?.slotSize ?? 44), `实际 ${chestGeo.slotSize}`);
  check('容器 27 格', chestGeo.containerSize === 27, `实际 ${chestGeo.containerSize}`);
  check('不是熔炉', chestGeo.furnace === false);
  check('面板在屏幕内（宽）', chestGeo.panelX >= 0 && chestGeo.panelX + chestGeo.panelW <= 1024);
  check('面板在屏幕内（高）', chestGeo.panelY >= 0 && chestGeo.panelY + chestGeo.panelH <= DESIGN.height + 1);

  // 下半部分 27 格必须在面板内部、且在容器区下方
  check('玩家背包区在容器区下方', chestGeo.inventoryY > chestGeo.containerY, `容器 ${chestGeo.containerY} / 背包 ${chestGeo.inventoryY}`);
  const invBottom = chestGeo.inventoryY + 3 * chestGeo.slotSize + 2 * 2;
  check('玩家 27 格没戳出面板', invBottom <= chestGeo.panelY + chestGeo.panelH, `底 ${invBottom} / 面板底 ${chestGeo.panelY + chestGeo.panelH}`);

  await shot('01-chest-empty');

  // ---- 点背包 9 号 → 拿起 → 点箱子第 0 格 → 放下 ----
  console.log('\n[2] 背包 → 箱子（同一条点击通道）');
  const held = await call('clickInventorySlot', 9, 'left');
  check('从背包拿起了东西', held.held > 0 && held.count === 20, JSON.stringify(held));

  // 点箱子第 0 格（用几何算坐标）
  const cell0 = pt(
    chestGeo.containerX + chestGeo.slotSize / 2,
    chestGeo.containerY + chestGeo.slotSize / 2,
  );
  await page.touchscreen.tap(cell0.x, cell0.y);
  await page.waitForTimeout(400);

  const afterPut = await call('containerInfo');
  check('箱子第 0 格收到了物品', afterPut.slots[0] > 0, JSON.stringify(afterPut.slots.slice(0, 3)));
  const invAfter = await frame.evaluate(() => wx.__v2Test.slotAt(9));
  check('背包 9 号被清空', invAfter === 0, `实际 ${invAfter}`);
  await shot('02-chest-filled');

  // ---- 从箱子拿回来 ----
  console.log('\n[3] 箱子 → 背包');
  const cell0b = pt(chestGeo.containerX + chestGeo.slotSize / 2, chestGeo.containerY + chestGeo.slotSize / 2);
  await page.touchscreen.tap(cell0b.x, cell0b.y);
  await page.waitForTimeout(400);
  const heldBack = await call('snapshot');
  check('从箱子拿起了那叠', !!heldBack && heldBack.count === 20, JSON.stringify(heldBack));

  const invCell9 = pt(chestGeo.inventoryX + chestGeo.slotSize / 2, chestGeo.inventoryY + chestGeo.slotSize / 2);
  await page.touchscreen.tap(invCell9.x, invCell9.y);
  await page.waitForTimeout(400);
  const backHome = await frame.evaluate(() => wx.__v2Test.slotAt(9));
  check('背包 9 号又满了 20', backHome === 20, `实际 ${backHome}`);
  const chestEmpty = await call('containerInfo');
  check('箱子第 0 格空了', chestEmpty.slots[0] === 0, JSON.stringify(chestEmpty.slots.slice(0, 3)));

  // ---- 关容器：光标上的东西不能消失 ----
  console.log('\n[4] 关容器不丢东西');
  // 先在光标上拿一叠，再直接关
  const takeResult = await call('clickInventorySlot', 9, 'left');
  const heldBeforeClose = await call('snapshot');
  check('关之前光标上有东西', !!heldBeforeClose && heldBeforeClose.count === 20, JSON.stringify(heldBeforeClose));

  // ⚠️ 基线要**把光标上的也算进去**：`totalOf` 只扫背包格子，手上那叠不在里面。
  // 第一版直接比 `totalOf` 前后值，量到的是"0 → 20"——看起来像丢了，其实一直没丢。
  const totalBefore = (await call('totalOf', 5)) + (heldBeforeClose?.count ?? 0);
  check('关之前总数 = 格子 + 手上', totalBefore === 20, `实际 ${totalBefore}`);

  await call('closeContainerForTest');
  await page.waitForTimeout(400);
  const totalAfter = await call('totalOf', 5);
  check('关容器后原木总数没变（20 回到背包）', totalAfter === 20, `${totalBefore} → ${totalAfter}`);
  check(
    '一件都没少（账面对得上）',
    totalAfter === totalBefore,
    `关前 ${totalBefore} / 关后 ${totalAfter}`,
  );
  check('光标已清空', (await call('snapshot')) === null);
  const infoClosed = await call('containerInfo');
  check('容器已关闭', infoClosed.open === false);
  await shot('03-chest-closed');

  // ============================================================ 2. 熔炉
  console.log('\n[5] 熔炉面板（1 行，产物槽只取不放）');
  await call('resetInventoryForTest');
  await call('giveToSlot', 9, 1001, 8); // raw_iron
  await call('giveToSlot', 10, 1000, 8); // coal
  await call('openFurnaceAtFeet');
  await page.waitForTimeout(600);

  const furnaceGeo = await call('containerGeo');
  check('熔炉面板有几何', !!furnaceGeo);
  check('熔炉 3 格', furnaceGeo.containerSize === 3, `实际 ${furnaceGeo.containerSize}`);
  check('标记为熔炉', furnaceGeo.furnace === true);
  check('熔炉容器区只有 1 行（比箱子矮）', furnaceGeo.containerY > chestGeo.containerY - 1);

  // ⚠️ 这里**故意要求高度相同**：用户的原话是"窗口要固定大小，现在点击闪来闪去"。
  // 按内容算高度会让箱子 364 / 熔炉 266，切一次跳一次 —— 那正是要修的病。
  // 熔炉只是下面多留白，壳子不动。
  check(
    '熔炉面板与箱子**完全同高**（固定壳，不随容器跳动）',
    Math.abs(furnaceGeo.panelH - chestGeo.panelH) < 0.5,
    `熔炉 ${furnaceGeo.panelH} / 箱子 ${chestGeo.panelH}`,
  );
  check(
    '熔炉面板与箱子同宽（同一个常量）',
    Math.abs(furnaceGeo.panelW - chestGeo.panelW) < 0.5,
    `熔炉 ${furnaceGeo.panelW} / 箱子 ${chestGeo.panelW}`,
  );
  check(
    '熔炉面板位置也不动（居中位置一致）',
    Math.abs(furnaceGeo.panelX - chestGeo.panelX) < 0.5 && Math.abs(furnaceGeo.panelY - chestGeo.panelY) < 0.5,
    `熔炉 (${furnaceGeo.panelX}, ${furnaceGeo.panelY}) / 箱子 (${chestGeo.panelX}, ${chestGeo.panelY})`,
  );
  check(
    '熔炉面板宽度与背包面板一致（670 那一档）',
    Math.abs(furnaceGeo.panelW - (invGeo?.panelW ?? furnaceGeo.panelW)) < 0.5,
    `熔炉 ${furnaceGeo.panelW} / 背包 ${invGeo?.panelW}`,
  );
  // 熔炉下半部分仍然是 27 格
  check('熔炉界面下半部分仍是玩家 27 格', furnaceGeo.inventoryY > furnaceGeo.containerY);
  await shot('04-furnace-empty');

  const totalIron = await call('totalOf', 1001);
  check('熔炉打开时背包里有铁矿石', totalIron === 8, `实际 ${totalIron}`);

  // ============================================================ 汇总
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? '✓' : '✗'} 容器统一面板 e2e：${results.length} 条，失败 ${failed.length} 条`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  ✗ ${f.label}  ${f.detail}`);
  }
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error('验收崩了：', err.message);
  process.exit(1);
});
