/**
 * 性能（K6）验收：自适应视距
 *
 * 真机上没法稳定复现"掉帧"，所以用 `mc.simulateFrameTime(ms)` 把帧时间固定成
 * 一个高值，观察视距是否按迟滞策略下降、以及帧率恢复后是否回升。
 *
 * 用法：playwright-cli eval "eval(atob('$(base64 -i tools/perf-acceptance.js | tr -d '\n')'))"
 */
(async function perfAcceptance() {
  const mc = window.__mc;
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 先把状态摆正：上限 12、开自适应
  mc.updateSettings({ viewDistance: 12, adaptiveViewDistance: true });
  await sleep(500);
  const start = mc.settingsState;
  check('adaptive enabled with cap 12', start.settings.adaptiveViewDistance && start.viewDistance === 12, `${start.viewDistance}`);

  // ---- 模拟持续掉帧（33ms ≈ 30fps）
  mc.simulateFrameTime(33);
  await sleep(7000);
  const afterDrop = mc.settingsState;
  check(`view distance drops under load (12 -> ${afterDrop.viewDistance})`, afterDrop.viewDistance < 12, `frameTimeAvg=${afterDrop.frameTimeAvg}ms`);
  check('frame time average reflects the load', afterDrop.frameTimeAvg > 22, `${afterDrop.frameTimeAvg}ms`);

  // ---- 恢复
  mc.simulateFrameTime(0);
  await sleep(11000);
  const afterRecover = mc.settingsState;
  check(`view distance recovers (${afterDrop.viewDistance} -> ${afterRecover.viewDistance})`, afterRecover.viewDistance > afterDrop.viewDistance, `cap=${afterRecover.settings.viewDistance}`);
  check('never exceeds the player-set cap', afterRecover.viewDistance <= afterRecover.settings.viewDistance, `${afterRecover.viewDistance} <= ${afterRecover.settings.viewDistance}`);

  // ---- 关掉自适应后不该再下降
  mc.updateSettings({ adaptiveViewDistance: false, viewDistance: 8 });
  mc.simulateFrameTime(40);
  await sleep(6000);
  const manual = mc.settingsState;
  check('with adaptive off the view distance stays put', manual.viewDistance === 8, `${manual.viewDistance}`);
  mc.simulateFrameTime(0);
  mc.updateSettings({ viewDistance: 12, adaptiveViewDistance: true });

  // ---- 基线数字
  await sleep(500);
  const info = mc.info;
  lines.push(`  fps=${info.fps} chunks=${info.chunks} triangles=${info.triangles} heap=${
    performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB` : 'n/a'
  }`);

  return lines.join('\n');
})();
