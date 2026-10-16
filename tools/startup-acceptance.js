/**
 * 启动耗时验收（N8 的判据，批次 103）
 *
 * 由来：N8 留了四条启动优化（预热 worker 池 / 非关键工作推后 / 图集分帧或缓存 /
 * 启动期网格化预算 3 → 6），而**项目里没有任何地方量过"开个新世界要多久"**——
 * 于是照 N9 那套先建判据：把两个玩家真正等得着的阶段量出来。
 *
 * 量什么（台账在 `src/game/startupTrace.ts`，读数在 `window.__startup`）：
 *   · `bootMs`     —— 页面开始脚本 → **主菜单能点**（首次访问的一次性成本）
 *   · `playableMs` —— 点了"创建并进入" → **第一块地形画出来**（加载遮罩撤掉）
 *
 * 用法（由 `tools/startup-check.sh` 调用；**必须在新开的页面里跑**，
 * 因为 `bootMs` 只在冷启动那一次有值）：
 *   playwright-cli goto <url> && playwright-cli eval "eval(atob('...'))"
 *
 * ⚠️ 预算的写法照 `tools/bundle-budget.mjs`：**实测值 + 一点余量**，
 * 写预算时的实测值留在注释里。它是**一道"不许变慢"的闸门，不是性能目标**。
 */
(async function startupAcceptance() {
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);
  const info = (text) => lines.push(`  ${text}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await sleep(20);
    }
    return predicate();
  };

  // 预算（毫秒）。写法照 `tools/bundle-budget.mjs`：**实测值 + 余量**，
  // 写下这批时的实测值留在注释里（headless Chromium，生产构建）：
  //   bootMs     32（图集 29 + 菜单前其它 3）—— 首次访问其实非常快
  //   playableMs 241（App 构造 24 + 到第一块地形 217）
  // 余量给得宽：CI 与手机都比这台机器慢得多，而这道闸门要挡的是**数量级**的退化
  // ——它要能抓住批次 103 修掉的那个 bug（那时 playableMs 是 **16218ms**）。
  const BUDGET = { bootMs: 2000, playableMs: 3000 };

  const trace = window.__startup;
  if (!trace) return '[FAIL] window.__startup 不存在（台账没挂上，或页面是旧构建）';

  // ---- 首次访问：等主菜单能点
  const menuOk = await waitFor(() => document.querySelector('#world-screen .world-primary'), 30000);
  check('主菜单能点（30s 内出现"创建并进入"）', !!menuOk);
  const bootMs = trace.bootMs;
  check(
    `首次访问到主菜单 ≤ ${BUDGET.bootMs}ms`,
    typeof bootMs === 'number' && bootMs <= BUDGET.bootMs,
    `实测 ${bootMs === null ? '—' : `${Math.round(bootMs)}ms`}`,
  );

  // ---- 进世界：点"创建并进入"，等加载遮罩撤掉
  if (typeof window.__mc === 'undefined') {
    document.querySelector('#world-screen .world-primary')?.click();
  }
  const started = await waitFor(() => typeof window.__mc !== 'undefined', 90000);
  if (!started) return lines.concat('[FAIL] 点了"创建并进入"之后世界没起来（window.__mc 一直没出现）').join('\n');

  const playableOk = await waitFor(() => !document.getElementById('loading'), 60000);
  check('加载遮罩撤掉了（第一块地形画出来了）', playableOk);
  const playableMs = trace.playableMs;
  check(
    `点进世界到能玩 ≤ ${BUDGET.playableMs}ms`,
    typeof playableMs === 'number' && playableMs <= BUDGET.playableMs,
    `实测 ${playableMs === null ? '—' : `${Math.round(playableMs)}ms`}`,
  );

  // ---- 台账明细（诊断用：一眼看出钱花在哪一段）
  info('阶段明细（相对页面开始脚本，ms）：');
  for (const mark of trace.marks) info(`  ${mark.name.padEnd(22)} ${Math.round(mark.at)}`);
  const gap = (from, to) => {
    const a = trace.marks.find((m) => m.name === from);
    const b = trace.marks.find((m) => m.name === to);
    return a && b ? `${Math.round(b.at - a.at)}ms` : '—';
  };
  info(`分段：图集 ${gap('boot:gl', 'boot:atlas')} · 菜单前其它 ${gap('boot:atlas', 'boot:menu')} · 存档库 ${gap('world:begin', 'world:save')} · App 构造 ${gap('world:save', 'world:constructed')} · 到第一块地形 ${gap('world:constructed', 'world:playable')}`);

  return lines.join('\n');
})();
