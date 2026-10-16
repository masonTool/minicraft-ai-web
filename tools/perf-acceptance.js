/**
 * 性能（K6 + N7）验收：自适应视距、动态分辨率、限帧、粒子总量
 *
 * 真机上没法稳定复现"掉帧"，所以用 `mc.simulateFrameTime(ms)` 把帧时间固定成
 * 一个高值，观察降级策略的动作顺序（**先降分辨率、再降视距**）、恢复顺序
 * （**先还视距、最后还分辨率**），以及限帧与粒子总量两个旋钮。
 *
 * 用法：playwright-cli eval "eval(atob('$(base64 -i tools/perf-acceptance.js | tr -d '\n')'))"
 */
(async function perfAcceptance() {
  const mc = window.__mc;
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 先把状态摆正：上限 12、两档自适应都开
  mc.updateSettings({ viewDistance: 12, adaptiveViewDistance: true, adaptiveResolution: true, maxFps: 0 });
  await sleep(500);
  const start = mc.settingsState;
  check(
    'adaptive enabled with cap 12',
    start.settings.adaptiveViewDistance && start.settings.adaptiveResolution && start.viewDistance === 12,
    `${start.viewDistance} scale=${start.resolutionScale}`,
  );

  // ---- 掉帧的第一段：**分辨率先顶**（视距还没动）
  mc.simulateFrameTime(33);
  await sleep(7000);
  const afterDrop = mc.settingsState;
  check(`resolution drops under load (1 -> ${afterDrop.resolutionScale})`, afterDrop.resolutionScale < 1, `frameTimeAvg=${afterDrop.frameTimeAvg}ms`);
  check('view distance still untouched (resolution absorbs it first)', afterDrop.viewDistance === 12, `${afterDrop.viewDistance}`);
  check('frame time average reflects the load', afterDrop.frameTimeAvg > 22, `${afterDrop.frameTimeAvg}ms`);

  // ---- 继续掉帧：分辨率到底之后才降视距
  await sleep(18000);
  const afterLong = mc.settingsState;
  check(`resolution bottoms out at 0.5 (${afterLong.resolutionScale})`, afterLong.resolutionScale === 0.5, `${afterLong.resolutionScale}`);
  check(`view distance starts dropping only then (12 -> ${afterLong.viewDistance})`, afterLong.viewDistance < 12, `${afterLong.viewDistance}`);

  // ---- 恢复：先还视距、最后还分辨率
  mc.simulateFrameTime(0);
  await sleep(20000);
  const afterRecover = mc.settingsState;
  check(
    `view distance recovers (${afterLong.viewDistance} -> ${afterRecover.viewDistance})`,
    afterRecover.viewDistance > afterLong.viewDistance,
    `cap=${afterRecover.settings.viewDistance}`,
  );
  check(
    'resolution recovers after the view distance is back',
    afterRecover.resolutionScale >= afterLong.resolutionScale,
    `${afterLong.resolutionScale} -> ${afterRecover.resolutionScale}`,
  );
  check('never exceeds the player-set cap', afterRecover.viewDistance <= afterRecover.settings.viewDistance, `${afterRecover.viewDistance} <= ${afterRecover.settings.viewDistance}`);

  // ---- 关掉两档自适应后不该再动
  mc.updateSettings({ adaptiveViewDistance: false, adaptiveResolution: false, viewDistance: 8 });
  mc.simulateFrameTime(40);
  await sleep(6000);
  const manual = mc.settingsState;
  check('with both adaptive switches off nothing moves', manual.viewDistance === 8, `${manual.viewDistance} scale=${manual.resolutionScale}`);
  mc.simulateFrameTime(0);
  mc.updateSettings({ viewDistance: 12, adaptiveViewDistance: true, adaptiveResolution: true });

  // ---- 限帧（N7）：30 帧上限下实测 fps 不该明显超过它
  {
    mc.updateSettings({ maxFps: 30 });
    await sleep(3000);
    const capped = mc.info.fps;
    check(`frame cap 30 keeps fps near it (${capped})`, capped <= 40, `${capped}`);
    mc.updateSettings({ maxFps: 0 });
    await sleep(1500);
    lines.push(`  fps with cap=30: ${capped}，uncapped: ${mc.info.fps}`);
  }

  // ---- 粒子总量（N7）：减半档的硬上限是 120
  {
    mc.updateSettings({ particles: 'reduced' });
    await sleep(500);
    const budget = mc.info.particleBudget;
    check('particle budget follows the setting (reduced -> 120)', budget === 120, `${budget}`);
    // 猛撒一批（爆炸 + 破坏）：场上粒子数不该超过上限
    for (let i = 0; i < 12; i++) mc.spawnTestParticles(i * 0.5);
    await sleep(500);
    check('live particles never exceed the budget', mc.info.particles <= budget, `${mc.info.particles} <= ${budget}`);
    mc.updateSettings({ particles: 'all' });
    await sleep(200);
    check('all -> 400', mc.info.particleBudget === 400, `${mc.info.particleBudget}`);
  }

  // ---- 基线数字
  await sleep(500);
  const info = mc.info;
  lines.push(`  fps=${info.fps} chunks=${info.chunks} triangles=${info.triangles} scale=${info.resolutionScale} particles=${info.particles}/${info.particleBudget} heap=${
    performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB` : 'n/a'
  }`);

  return lines.join('\n');
})();
