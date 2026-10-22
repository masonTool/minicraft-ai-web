/**
 * 验收：熔炉左栏"可做列表"。
 *
 * 对拍 `WXMINIGAME_V2_INVENTORY_SPEC.md` §22。
 *
 * 要证明的五件事：
 *  1. 左栏真的列出了配方卡（条数 > 0，分页生效）；
 *  2. **站台过滤**：烟熏炉不列矿物、高炉不列食物；
 *  3. **缺料判定**：没有燃料时 `craftable` 变少（不是全都白底）；
 *  4. 点一张可做的卡 → 原料和燃料被摆进炉子；
 *  5. 点一张缺料的卡 → 拒绝 + 说清缺什么（不能静默）。
 *
 * 用法：V2_URL=http://localhost:3899 npm run e2e:v2-station
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
const DIR = '.tmp/shots/v2-station';

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

  // ============================================================ 1. 列表存在
  console.log('\n[1] 普通熔炉：左栏列出配方卡');
  await call('resetInventoryForTest');
  await call('openFurnaceAtFeet');
  await page.waitForTimeout(600);

  let info = await call('stationCardInfo');
  check('拿到列表统计', !!info, String(info));
  if (!info) throw new Error('stationCardInfo 是 null');
  check('列表非空（45 条左右的熔炼配方）', info.total > 0, String(info.total));
  check('站台是 furnace', info.station === 'furnace', info.station);
  check('一页最多显示 12 张（3 列 × 4 行）', info.shown <= 12, String(info.shown));
  check('空背包时一条都做不了', info.craftable === 0, String(info.craftable));
  await shot('01-empty-list');

  // ============================================================ 2. 给材料 → 有可做的
  console.log('\n[2] 给原料 + 燃料 → 出现可做的卡');
  await call('giveToSlot', 9, RAW_IRON, 8);
  await call('giveToSlot', 10, COAL, 8);
  await call('openFurnaceAtFeet');
  await page.waitForTimeout(600);

  info = await call('stationCardInfo');
  check('有原料有燃料后可做数 > 0', info.craftable > 0, String(info.craftable));
  check('可做数不超过总数', info.craftable <= info.total, `${info.craftable}/${info.total}`);
  await shot('02-craftable');

  // ============================================================ 3. 点卡摆料
  console.log('\n[3] 点一张卡 → 原料和燃料被摆进炉子');
  const beforeSlots = await call('containerInfo');
  check('点之前原料槽是空的', beforeSlots.slots[0] === 0, JSON.stringify(beforeSlots.slots));
  check('点之前燃料槽是空的', beforeSlots.slots[1] === 0, JSON.stringify(beforeSlots.slots));

  // 用钩子点第一张可做的卡（配方卡在界面里，坐标要算；这里走钩子更稳）
  const picked = await call('pickFirstCraftableStationCard');
  check('点卡成功', picked && picked.ok === true, JSON.stringify(picked));

  const afterSlots = await call('containerInfo');
  check('原料槽被摆上了东西', afterSlots.slots[0] > 0, JSON.stringify(afterSlots.slots));
  check('燃料槽被摆上了东西', afterSlots.slots[1] > 0, JSON.stringify(afterSlots.slots));

  const st = await call('furnaceState');
  check('摆料后仍然冻结（要点目标框才开工）', st.paused === true, JSON.stringify(st));
  await shot('03-filled-by-card');

  // ============================================================ 4. 缺料拒绝
  console.log('\n[4] 点一张缺料的卡 → 拒绝并说清缺什么');
  await call('resetInventoryForTest');
  await call('openFurnaceAtFeet');
  // ⚠️ 炉子按坐标缓存，重开拿到的是**同一个实例**，上一轮摆的料还在里面。
  // `resetInventoryForTest` 只清背包，所以这里必须显式清容器。
  const cleared = await call('clearContainerForTest');
  check('清空上一轮摆进炉子的料', cleared.cleared >= 0, JSON.stringify(cleared));
  await page.waitForTimeout(400);
  const rejected = await call('pickLockedStationCard');
  check('点缺料卡被拒', rejected && rejected.ok === false, JSON.stringify(rejected));
  check('给了拒绝原因', !!rejected && typeof rejected.hint === 'string' && rejected.hint.length > 0, JSON.stringify(rejected));
  const afterReject = await call('containerInfo');
  check('被拒后炉子没被塞东西', afterReject.slots[0] === 0 && afterReject.slots[1] === 0, JSON.stringify(afterReject.slots));

  // ============================================================ 5. 站台过滤
  console.log('\n[5] 站台过滤：烟熏炉 / 高炉');
  const counts = await call('stationCountsByStation');
  check('拿到三种站台的条数', !!counts, String(counts));
  if (counts) {
    check('烟熏炉条数 < 普通熔炉（只列食物）', counts.smoker < counts.furnace, JSON.stringify(counts));
    check('高炉条数 < 普通熔炉（只列矿物）', counts.blast_furnace < counts.furnace, JSON.stringify(counts));
    check('烟熏炉与高炉的条数不同（各自过滤不同的类）', counts.smoker !== counts.blast_furnace, JSON.stringify(counts));
    // ⚠️ **不能**断言"烟熏炉 + 高炉 ≥ 普通熔炉"：普通熔炉还吃 `none` 类
    // （黏土→陶瓦、沙子→玻璃这类既不是食物也不是矿物的烧炼），
    // 烟熏炉和高炉都不吃。45 = 7(food) + 4(metal) + 34(none)，所以 11 < 45 是对的。
    check(
      '普通熔炉吃三类，所以条数最多（含 food+metal+none）',
      counts.furnace > counts.smoker && counts.furnace > counts.blast_furnace,
      JSON.stringify(counts),
    );
  }

  // ============================================================ 汇总
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? '✓' : '✗'} 熔炉可做列表 e2e：${results.length} 条，失败 ${failed.length} 条`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  ✗ ${f.label}  ${f.detail}`);
  }
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error('验收崩了：', err.message);
  process.exit(1);
});
