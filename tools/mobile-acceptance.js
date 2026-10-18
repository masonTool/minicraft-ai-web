/**
 * 移动端可自动化验收脚本（M17）
 *
 * 用法（dev server 已经跑起来的前提下）：
 *   playwright-cli eval "$(cat tools/mobile-acceptance.js)"
 *
 * 说明：
 *  - 真机上的帧率 / 发热 / 触控延迟**只能**在真机上量，这里覆盖的是"能在桌面浏览器里
 *    自动验证的部分"：触摸 UI 的创建与布局、可点区域尺寸、摇杆是否真的驱动移动与疾跑、
 *    拖动是否真的转视角、轻点与长按是否走对分支、帧率与内存基线。
 *  - 触摸层默认只在手势设备上创建，这里用 `mc.enableTouchControls()` 临时启用，
 *    控件与实际手机上是同一套 DOM 与同一套事件处理。
 *  - 用合成 PointerEvent 驱动：手游的输入最终都落到 pointer 事件上，
 *    因此这与"手指真的按上去"走的是同一条代码路径。
 */
(async function mobileAcceptance() {
  // ⚠️ 必须用 `let`：下面第 0 步可能还要等世界启动，`__mc` 是那时候才挂上的
  let mc = window.__mc;
  const lines = [];
  // 标记用 ASCII：终端/日志里中文与 ✓✗ 都可能被按单字节解读而变成乱码
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const fire = (target, type, x, y, id = 9001) => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      isPrimary: true,
      clientX: x,
      clientY: y,
      pointerId: id,
      pointerType: 'touch',
    });
    target.dispatchEvent(event);
  };

  // ---------------------------------------------------------------- 0. 先进入世界
  // 全新浏览器会话里主菜单是空的、游戏不会自己开始（`window.__mc` 由 startWorld 挂上），
  // 所以脚本自己走一遍"进世界"——否则这一整套验收会在空页面上全红。
  //
  // ⚠️ 批次 108 起主菜单分层：主页「游戏」→ 二级页面里"进第一张存档"或"新建"。
  // 三步都是同步的 DOM 切换（`setView` 切 class、`render()` 同步），不必等动画。
  if (typeof window.__mc === 'undefined') {
    document.querySelector('#world-screen .world-primary')?.click(); // 主页「游戏」
    const firstSave = document.querySelector('#world-list .world-enter');
    if (firstSave) firstSave.click();
    else {
      document.getElementById('world-new-button')?.click();
      document.getElementById('world-create-button')?.click();
    }
    const deadline = Date.now() + 90000;
    while (typeof window.__mc === 'undefined' && Date.now() < deadline) await sleep(250);
    if (typeof window.__mc === 'undefined') return '[FAIL] game did not start (window.__mc missing)';
    mc = window.__mc;
  }

  // 读档是异步的：它回来时会把玩家传送回存档位置。
  // 不等它结束就 teleport，几秒后会被"恢复位置"覆盖——摇杆位移会量成 0
  // （曾经就是这么假红的：传送到 150 格，读档又把人放回洞里）。
  for (let i = 0; i < 150 && mc.waitingForSaveRestore; i++) await sleep(200);

  // ---------------------------------------------------------------- 1. 触摸层
  mc.enableTouchControls();
  const ui = document.getElementById('touch-ui');
  check('touch layer created', !!ui, ui ? `${ui.children.length} layers` : '#touch-ui missing');
  if (!ui) return lines.join('\n');

  const layers = ['touch-look', 'touch-stick', 'touch-buttons', 'touch-hint'].map((id) => {
    const el = document.getElementById(id);
    const r = el?.getBoundingClientRect();
    return `${id}${r ? ` ${Math.round(r.width)}x${Math.round(r.height)}` : ' MISSING'}`;
  });
  check('four functional layers (look/stick/buttons/hint)', layers.every((text) => !text.includes('MISSING')), layers.join(' | '));

  // ---------------------------------------------------------------- 2. 可点区域
  const buttons = [...document.querySelectorAll('.touch-button')];
  // 隐藏的"上升/下降"键 rect 为 0：只量真正露出来的按钮
  const shown = buttons.filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const rects = shown.map((b) => b.getBoundingClientRect());
  // 按钮现在是图标（没有文字节点），所以报告里用 aria-label 而不是 textContent
  const names = shown.map((b) => b.getAttribute('aria-label') ?? b.dataset.icon ?? '?');
  const minSide = Math.min(...rects.map((r) => Math.min(r.width, r.height)));
  check(
    `touch target ${minSide.toFixed(0)}px >= 44px (platform minimum)`,
    minSide >= 44,
    names.join('/'),
  );

  // 控件之间不重叠（重叠会导致误触）
  let overlap = '';
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        overlap = `${names[i]}-${names[j]}`;
      }
    }
  }
  check('buttons do not overlap', overlap === '', overlap);

  const stickRect = document.getElementById('touch-stick').getBoundingClientRect();
  const stickCx = stickRect.left + stickRect.width / 2;
  const stickCy = stickRect.top + stickRect.height / 2;

  // ---------------------------------------------------------------- 3. 摇杆驱动移动
  // 先把玩家挪到高空再开飞行：存档恢复可能把玩家放在水下或洞里，
  // 那种环境下"推满摇杆"走不动（水里慢、洞里撞墙），测出来的位移没有意义。
  // 高空是"一定没有阻挡"的环境，测的才是摇杆本身。
  // 批次 181：飞行只在创造模式内可用
  mc.setGameMode('creative');
  mc.setFlying(true);
  const spawn = mc.info.position;
  mc.teleportForce(spawn[0], 150, spawn[2]);
  await sleep(1200);
  mc.look(0, 0);
  const before = mc.info.position.slice();
  const stick = document.getElementById('touch-stick');
  fire(stick, 'pointerdown', stickCx, stickCy, 101);
  fire(stick, 'pointermove', stickCx, stickCy - stickRect.height, 101);
  await sleep(700);
  const t = window.__mc.info;
  const moved = Math.hypot(t.position[0] - before[0], t.position[2] - before[2]);
  fire(stick, 'pointerup', stickCx, stickCy - stickRect.height, 101);
  check(`stick drives movement: ${moved.toFixed(2)} blocks`, moved > 2, `from (${before.map((n) => n.toFixed(1)).join(',')})`);

  // 停下之后不该继续滑行（说明抬手后 forward 归零了）
  await sleep(250);
  const afterStop = mc.info.position.slice();
  await sleep(300);
  const drift = Math.hypot(mc.info.position[0] - afterStop[0], mc.info.position[2] - afterStop[2]);
  check(`no drift after release: ${drift.toFixed(3)} blocks`, drift < 0.05);

  // ---------------------------------------------------------------- 4. 拖动转视角
  const look = document.getElementById('touch-look');
  const yawBefore = mc.lookAngles.yaw;
  fire(look, 'pointerdown', window.innerWidth * 0.5, window.innerHeight * 0.35, 202);
  for (let i = 1; i <= 6; i++) {
    fire(look, 'pointermove', window.innerWidth * 0.5 - i * 12, window.innerHeight * 0.35, 202);
    await sleep(16);
  }
  fire(look, 'pointerup', window.innerWidth * 0.5 - 72, window.innerHeight * 0.35, 202);
  await sleep(60);
  const yawDelta = Math.abs(mc.lookAngles.yaw - yawBefore);
  check(`drag rotates view: ${yawDelta.toFixed(1)} deg`, yawDelta > 5, 'drag 72px');

  // ---------------------------------------------------------------- 5. 轻点 / 长按
  const pitchBefore = mc.lookAngles.pitch;
  fire(look, 'pointerdown', window.innerWidth * 0.5, window.innerHeight * 0.5, 303);
  await sleep(60);
  fire(look, 'pointerup', window.innerWidth * 0.5, window.innerHeight * 0.5, 303);
  await sleep(60);
  check(`tap (<220ms, no movement) does not rotate view`, Math.abs(mc.lookAngles.pitch - pitchBefore) < 2);

  // 长按破坏需要"射线命中一个方块"：先把玩家传送到一块真正的地面上，
  // 再朝脚下看——否则在空中/水面上射线经常落空（这条断言之前就因此偶发失败）
  // 批次 181：创造模式是**瞬间破坏**，长按只会看到"方块已经没了"。
  // 想量"按住 → 进度条出现"，必须回到生存模式。
  mc.setGameMode('survival');
  mc.setFlying(false);
  // 批次 181：生存开局是空手，而脚下的方块可能是石头（徒手挖不动 → 永远不会出进度）。
  // 给一把铁镐并拿在手上，才是"长按能破坏"的稳定前置。
  {
    const { toolItemId } = await import('/src/core/registry/tools.ts');
    const pick = toolItemId('pickaxe', 'iron');
    mc.inventory.add(pick, 1);
    const index = mc.inventory.find(pick);
    if (index >= 9) mc.inventory.move(index, 0);
    if (index >= 0) mc.selectSlot(index >= 9 ? 0 : index);
  }
  const self0 = mc.info.position;
  const gx = Math.round(self0[0]);
  const gz = Math.round(self0[2]);
  let groundY = mc.column(gx, gz).ground;
  if (groundY === -999 || groundY < 0) groundY = Math.round(self0[1]);
  mc.teleportForce(gx + 0.5, groundY + 2, gz + 0.5);
  mc.look(0, -75);
  // 落体 + 网格重建都要时间：轮询等"落地 **且** 射线命中"。
  // ⚠️ 只等命中有个坑：玩家还在下落时射线可能正好穿过脚下那一格又落空，
  // 于是 600ms 后 `isBreaking` 是 false（这条断言以前偶发假红）。落地之后再测才稳定。
  let hitForBreaking = null;
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    if (mc.info.onGround && mc.info.hit) {
      hitForBreaking = mc.info.hit;
      break;
    }
  }
  check('raycast hits a block (breaking precondition)', hitForBreaking !== null, hitForBreaking ? `(${hitForBreaking.join(',')})` : 'no hit after 5s');

  fire(look, 'pointerdown', window.innerWidth * 0.5, window.innerHeight * 0.5, 404);
  // 轮询"有没有出现过破坏进度"，而不是固定 600ms 再看：
  // 软方块（草/泥土）在铁镐下 400ms 内就挖完了，固定采样会正好落在"已经挖掉"之后。
  let sawBreaking = false;
  for (let i = 0; i < 12; i++) {
    await sleep(60);
    if (mc.isBreaking) {
      sawBreaking = true;
      break;
    }
  }
  fire(look, 'pointerup', window.innerWidth * 0.5, window.innerHeight * 0.5, 404);
  await sleep(120);
  const stillBreaking = mc.isBreaking;
  check('long press starts breaking', sawBreaking === true, `during=${sawBreaking} after=${stillBreaking}`);
  check('release stops breaking', stillBreaking === false, `after=${stillBreaking}`);

  // ---------------------------------------------------------------- 5.5 触控延迟
  // 合成事件测不到"手指→屏幕"的硬件延迟，但能测出**从事件进来到生效**的处理链路耗时
  // （射线、物理、区块查询、重网格化的排队），这部分在真机上同样存在。
  const pad = document.getElementById('touch-stick');
  const padRect = pad.getBoundingClientRect();
  const padCx = padRect.left + padRect.width / 2;
  const padCy = padRect.top + padRect.height / 2;
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const before = mc.info.position.slice();
    const t0 = performance.now();
    fire(pad, 'pointerdown', padCx, padCy, 500 + i);
    fire(pad, 'pointermove', padCx, padCy - padRect.height, 500 + i);
    // 等玩家真的动起来（位置变化）即认为输入已生效
    let latency = -1;
    for (let wait = 0; wait < 40; wait++) {
      await sleep(8);
      const now = mc.info.position;
      if (Math.hypot(now[0] - before[0], now[2] - before[2]) > 0.02) {
        latency = performance.now() - t0;
        break;
      }
    }
    fire(pad, 'pointerup', padCx, padCy - padRect.height, 500 + i);
    if (latency >= 0) samples.push(latency);
    await sleep(120);
  }
  const avgLatency = samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : -1;
  const worstLatency = samples.length > 0 ? Math.max(...samples) : -1;
  // 阈值 100ms：这里量的是"事件进来 → 物理产生可见位移"的整条链路（含几帧加速），
  // 不是"手指→屏幕"的硬件延迟。真机上的触控采样延迟必须上手才知道。
  check(
    `stick input latency avg ${avgLatency.toFixed(1)}ms / worst ${worstLatency.toFixed(1)}ms (${samples.length}/5 samples)`,
    samples.length >= 3 && avgLatency < 100,
    '量的是处理链路（事件→物理生效），硬件触控延迟需真机',
  );

  // ---------------------------------------------------------------- 6. 性能基线
  await sleep(1200);
  // 网格重建是异步的：连读几次，避免正好读到"重建中"的 0。
  // ⚠️ 重试窗口给到 5 秒：前面刚把玩家传送到高空并开飞行，整片视野的网格都在重建，
  // 1.5 秒偶尔不够（实测在无头浏览器里会假红一次）。这个指标本身是活的（重建完是千万级三角形）。
  let info = mc.info;
  for (let i = 0; i < 60 && info.triangles === 0; i++) {
    await sleep(250);
    const next = mc.info;
    // 取"见过的最大值"：这个计数在一次重建里会从 0 跳到几百万，取最后一次可能又读到 0
    if (next.triangles > info.triangles) info = next;
    else info = next.fps ? next : info;
  }
  const memory = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
  check(`fps ${info.fps} >= 30`, info.fps >= 30, `${info.chunks} chunks | ${info.triangles} triangles`);
  check(`mesh triangles rendered`, info.triangles > 0, `${info.triangles}`);
  lines.push(`  heap: ${memory === null ? 'performance.memory unavailable (normal on Safari/Firefox)' : `${memory.toFixed(1)} MB`}`);
  lines.push(`  viewport: ${window.innerWidth}x${window.innerHeight} | dpr ${window.devicePixelRatio}`);

  mc.setFlying(false);
  return lines.join('\n');
})();
