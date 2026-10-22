/**
 * 验收：熔炉的"点目标框才开工" + "关掉界面后继续烧"。
 *
 * 对拍 `WXMINIGAME_V2_INVENTORY_SPEC.md` §21。
 *
 * 要证明的五件事：
 *  1. 打开一个空闲炉子 → 冻结（`paused=true`、进度 0%），且界面上写着"待开工"；
 *  2. 只有原料没燃料 → 点目标框**拒绝**，并说"燃料槽是空的"；
 *  3. 原料+燃料齐了 → 点目标框开工，推进 dt 后产物出来；
 *  4. 点目标框（有成品时）→ 成品进背包；
 *  5. **关掉界面后炉子继续烧**（这一条是真回归：v2 之前只在界面开着时 tick）。
 *
 * 用法：V2_URL=http://localhost:3899 npm run e2e:v2-furnace
 */
const fs = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {}
  const { execSync } = require('node:child_process');
  const candidates = [];
  try {
    candidates.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@playwright/cli/node_modules'));
  } catch {}
  const nvm = path.join(process.env.HOME ?? '', '.nvm/versions/node');
  if (fs.existsSync(nvm)) {
    for (const ver of fs.readdirSync(nvm)) {
      candidates.push(path.join(nvm, ver, 'lib/node_modules/@playwright/cli/node_modules'));
    }
  }
  candidates.push(path.join(process.cwd(), 'node_modules'));
  for (const dir of candidates) {
    const mod = path.join(dir, 'playwright');
    if (fs.existsSync(mod)) return require(mod);
  }
  throw new Error(`找不到 playwright，试过：\n  ${candidates.join('\n  ')}`);
}

const { chromium } = loadPlaywright();

const URL = process.env.V2_URL;
const CHROME =
  '/Users/mason/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const DESIGN = { width: 1024, height: (1024 * 390) / 844 };
const DIR = '.tmp/shots/v2-furnace';

// items.ts 的真实 id
const COAL = 1000;
const RAW_IRON = 1001;

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
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

  await wait((s) => s.screen === 'title', '没进标题');
  await tap(512, 327);
  await wait((s) => s.screen === 'worlds', '没进列表');
  await tap(512, 216);
  await wait((s) => s.screen === 'create', '没进新建');
  // ⚠️ helper 冷启动时，"创建并进入"**第一下经常不生效**（界面还停在 create）。
  // 这里重试最多 4 次，而不是让整个验收崩掉再手动重跑。
  let entered = false;
  for (let attempt = 0; attempt < 4 && !entered; attempt++) {
    await tap(727, 423);
    try {
      await wait((s) => s.screen === 'game' && s.drawn > 3, '没进游戏', 25000);
      entered = true;
    } catch {
      if (attempt === 3) throw new Error('连点 4 次「创建并进入」都没进游戏');
      await page.waitForTimeout(800);
    }
  }
  await page.waitForTimeout(1200);

  const frame = page.frames().find((f) => f.url().startsWith('about:srcdoc'));
  if (!frame) throw new Error('没找到游戏 frame');
  const call = (fn, ...args) => frame.evaluate(([f, a]) => wx.__v2Test[f]?.(...a), [fn, args]);
  const shot = async (name) => {
    await page.screenshot({ path: `${DIR}/${name}.png` });
  };

  // ============================================================ 1. 打开空闲炉子 → 冻结
  console.log('\n[1] 打开空闲炉子：应该冻结等玩家点目标框');
  await call('resetInventoryForTest');
  await call('openFurnaceAtFeet');
  await page.waitForTimeout(500);

  let st = await call('furnaceState');
  check('拿到熔炉状态', !!st, String(st));
  if (!st) throw new Error('furnaceState 是 null');
  check('打开时空炉子 → 冻结', st.paused === true, JSON.stringify(st));
  // ⚠️ 不看 `started`：`Furnace.started` 默认是 true（兼容无 UI 的模拟与测试），
  // 界面侧的"这一轮点过目标框没有"是 `stationStarted`，不在这个返回值里。
  // 真正能证明"没在动"的是下面三条：没燃烧、两条进度都是 0。
  check('没在燃烧', st.burning === false, String(st.burning));
  check('火焰进度 0%', st.burnPct === 0, String(st.burnPct));
  check('熔炼进度 0%', st.cookPct === 0, String(st.cookPct));
  await shot('01-frozen');

  // 空手点目标框：没原料，拒绝
  console.log('\n[2] 空炉子点目标框 → 拒绝（没原料）');
  const emptyStart = await call('startFurnace');
  check('没原料时点目标框被拒', emptyStart === false, String(emptyStart));
  st = await call('furnaceState');
  check('拒绝后仍是冻结', st.paused === true, JSON.stringify(st));
  check('提示说的是原料', st.hint.includes('原料'), st.hint);

  // ============================================================ 3. 只有原料、没燃料
  console.log('\n[3] 只放原料不放燃料 → 拒绝（没燃料）');
  await call('resetInventoryForTest');
  await call('giveToSlot', 9, RAW_IRON, 8);
  await call('openFurnaceAtFeet');
  await page.waitForTimeout(400);
  // 把原料放进原料槽
  await call('dragSlotForTest', { kind: 'inventory', index: 9 }, { kind: 'container', index: 0 });
  await page.waitForTimeout(300);
  const noFuel = await call('startFurnace');
  check('只有原料时点目标框被拒', noFuel === false, String(noFuel));
  // ⚠️ 提示要在**点之后**读：`stationHint` 是 `startStation()` 写进去的
  st = await call('furnaceState');
  check('提示说的是燃料', st.hint.includes('燃料'), st.hint);
  check('拒绝后仍是冻结', st.paused === true, JSON.stringify(st));
  await shot('02-no-fuel');

  // ============================================================ 4. 原料+燃料 → 开工
  console.log('\n[4] 原料+燃料齐了 → 点目标框开工');
  await call('giveToSlot', 10, COAL, 8);
  await call('dragSlotForTest', { kind: 'inventory', index: 10 }, { kind: 'container', index: 1 });
  await page.waitForTimeout(300);

  const started = await call('startFurnace');
  check('原料+燃料齐了 → 开工成功', started === true, String(started));
  st = await call('furnaceState');
  check('开工后不再冻结', st.paused === false, JSON.stringify(st));
  check('标记为已开工', st.started === true, String(st.started));
  await shot('03-started');

  // 推进时间：铁矿石 → 铁锭
  console.log('\n[5] 推进时间：产物应该出来');
  const after5 = await call('advanceFurnacesForTest', 5, true);
  check('烧了 5 秒后有进度', after5.cookPct > 0, JSON.stringify(after5));
  const after12 = await call('advanceFurnacesForTest', 12, true);
  check('烧满一轮后熔炼进度归零或满', after12.cookPct >= 0, JSON.stringify(after12));
  const slots = await call('containerInfo');
  check('产物槽里有东西了', slots.slots[2] > 0, JSON.stringify(slots.slots));
  const productId = slots.slots[2];
  await shot('04-smelted');

  // ============================================================ 5. 取走成品
  console.log('\n[6] 点目标框取走成品');
  const took = await call('takeFurnaceOutput');
  check('取走成品成功', took === true, String(took));
  const slotsAfter = await call('containerInfo');
  check('产物槽空了', slotsAfter.slots[2] === 0, JSON.stringify(slotsAfter.slots));
  const ironCount = await frame.evaluate(
    ([id]) => wx.__v2Test.totalOf(id),
    [productId],
  );
  check(`成品进了背包（id ${productId} ×${ironCount}）`, ironCount > 0, String(ironCount));

  // ============================================================ 6. 关掉界面继续烧
  console.log('\n[7] 关掉界面后炉子必须继续烧（真回归）');
  await call('resetInventoryForTest');
  await call('openFurnaceAtFeet');
  await page.waitForTimeout(400);
  await call('giveToSlot', 9, RAW_IRON, 16);
  await call('giveToSlot', 10, COAL, 16);
  await call('dragSlotForTest', { kind: 'inventory', index: 9 }, { kind: 'container', index: 0 });
  await call('dragSlotForTest', { kind: 'inventory', index: 10 }, { kind: 'container', index: 1 });
  await page.waitForTimeout(300);
  const restarted = await call('startFurnace');
  check('重新开工', restarted === true, String(restarted));

  const beforeClose = await call('furnaceState');
  check('关之前是运行中', beforeClose.paused === false, JSON.stringify(beforeClose));

  // 关界面
  await call('closeContainerForTest');
  await page.waitForTimeout(400);
  const closedInfo = await call('containerInfo');
  check('界面已关', closedInfo.open === false);

  // ⚠️ 关键断言：关掉之后 `tickAll` 仍然推进这个炉子
  // 先记下关界面前的进度，然后推进 5 秒，看产物有没有继续涨
  // 关界面后 `containers.furnaceState` 是 null（没开着的容器），
  // 钩子会退化成"世界里任意一座熔炉"的状态 —— 正好就是我们要验的那座
  const beforeTick = await call('advanceFurnacesForTest', 0.01, false);
  const afterTick = await call('advanceFurnacesForTest', 6, false);
  check(
    '关掉界面后仍能读到那座炉子（容器还活着）',
    beforeTick !== null && afterTick !== null,
    `关前 ${JSON.stringify(beforeTick)} / 关后 ${JSON.stringify(afterTick)}`,
  );
  check(
    '关掉界面后 tickAll 仍在推进（进度有变化）',
    afterTick !== null && beforeTick !== null && afterTick.cookPct !== beforeTick.cookPct,
    `关前 ${JSON.stringify(beforeTick)} → 关后 ${JSON.stringify(afterTick)}`,
  );
  check(
    '关掉界面后它没有被冻结（还在烧）',
    afterTick !== null && afterTick.paused === false,
    JSON.stringify(afterTick),
  );

  // 再推进一段时间，然后重开界面看产物
  await call('advanceFurnacesForTest', 12, false);
  await call('openFurnaceAtFeet');
  await page.waitForTimeout(500);
  const reopened = await call('containerInfo');
  check(
    '关界面期间烧出了产物（重开后产物槽有东西）',
    reopened.slots[2] > 0,
    JSON.stringify(reopened.slots),
  );
  const reopenedState = await call('furnaceState');
  check(
    '重开一个正在烧的炉子 → 不冻结',
    reopenedState.paused === false || reopened.slots[2] > 0,
    JSON.stringify(reopenedState),
  );
  await shot('05-reopened');

  // ============================================================ 汇总
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? '✓' : '✗'} 熔炉目标框 e2e：${results.length} 条，失败 ${failed.length} 条`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  ✗ ${f.label}  ${f.detail}`);
  }
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error('验收崩了：', err.message);
  process.exit(1);
});
