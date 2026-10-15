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
  const mc = window.__mc;
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
  const rects = buttons.map((b) => b.getBoundingClientRect());
  const minSide = Math.min(...rects.map((r) => Math.min(r.width, r.height)));
  check(
    `touch target ${minSide.toFixed(0)}px >= 44px (platform minimum)`,
    minSide >= 44,
    buttons.map((b) => b.textContent).join('/'),
  );

  // 控件之间不重叠（重叠会导致误触）
  let overlap = '';
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        overlap = `${buttons[i].textContent}-${buttons[j].textContent}`;
      }
    }
  }
  check('buttons do not overlap', overlap === '', overlap);

  const stickRect = document.getElementById('touch-stick').getBoundingClientRect();
  const stickCx = stickRect.left + stickRect.width / 2;
  const stickCy = stickRect.top + stickRect.height / 2;

  // ---------------------------------------------------------------- 3. 摇杆驱动移动
  mc.look(0, 0);
  mc.setFlying(true);
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

  // 长按破坏需要"射线命中一个方块"：先落地并朝脚下看，否则 hit 是空的
  mc.setFlying(false);
  mc.look(0, -75);
  // 落体 + 网格重建都要时间：轮询等射线命中，最多 3 秒
  let hitForBreaking = null;
  for (let i = 0; i < 15 && !hitForBreaking; i++) {
    await sleep(200);
    hitForBreaking = mc.info.hit;
  }
  check('raycast hits a block (breaking precondition)', hitForBreaking !== null, hitForBreaking ? `(${hitForBreaking.join(',')})` : 'no hit after 3s');

  fire(look, 'pointerdown', window.innerWidth * 0.5, window.innerHeight * 0.5, 404);
  await sleep(600);
  const breakingAfterHold = mc.isBreaking;
  fire(look, 'pointerup', window.innerWidth * 0.5, window.innerHeight * 0.5, 404);
  await sleep(120);
  const stillBreaking = mc.isBreaking;
  check('long press starts breaking', breakingAfterHold === true, `during=${breakingAfterHold} after=${stillBreaking}`);
  check('release stops breaking', stillBreaking === false, `after=${stillBreaking}`);

  // ---------------------------------------------------------------- 6. 性能基线
  await sleep(1200);
  // 网格重建是异步的：连读几次取最大值，避免正好读到"重建中"的 0
  let info = mc.info;
  for (let i = 0; i < 6 && info.triangles === 0; i++) {
    await sleep(250);
    info = mc.info;
  }
  const memory = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
  check(`fps ${info.fps} >= 30`, info.fps >= 30, `${info.chunks} chunks | ${info.triangles} triangles`);
  check(`mesh triangles rendered`, info.triangles > 0, `${info.triangles}`);
  lines.push(`  heap: ${memory === null ? 'performance.memory unavailable (normal on Safari/Firefox)' : `${memory.toFixed(1)} MB`}`);
  lines.push(`  viewport: ${window.innerWidth}x${window.innerHeight} | dpr ${window.devicePixelRatio}`);

  mc.setFlying(false);
  return lines.join('\n');
})();
