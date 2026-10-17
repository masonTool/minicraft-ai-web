/**
 * 性能（K6 + N7）验收：自适应视距、动态分辨率、限帧、粒子总量
 *
 * 真机上没法稳定复现"掉帧"，所以用 `mc.simulateFrameTime(ms)` 把帧时间固定成
 * 一个高值，观察降级策略的动作顺序（**先收视距、再降分辨率**）、恢复顺序
 * （**先还分辨率、最后放视距**），以及限帧与粒子总量两个旋钮。
 *
 * ⚠️ 顺序在批次 158 反转过一次：分辨率是全局的（会连近处一起糊），视距只影响远处、
 * 而远处本来就在雾里，所以掉帧时先收视距。验收脚本里那三条顺序断言要跟着反。
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

  // ---- 掉帧的第一段：**视距先收**（分辨率还没动）
  // 视距冷却 4 秒一次，9 秒够降两格
  mc.simulateFrameTime(33);
  await sleep(9000);
  const afterDrop = mc.settingsState;
  check(`view distance shrinks under load (12 -> ${afterDrop.viewDistance})`, afterDrop.viewDistance < 12, `${afterDrop.viewDistance}`);
  check('resolution still untouched (near field must stay sharp)', afterDrop.resolutionScale === 1, `${afterDrop.resolutionScale}`);
  check('frame time average reflects the load', afterDrop.frameTimeAvg > 22, `${afterDrop.frameTimeAvg}ms`);

  // ---- 继续掉帧：视距收到地板之后才轮到分辨率
  // 视距 12 → 4 需要 8 档 × 4 秒 ≈ 32 秒，之后再等十来秒分辨率才会动
  await sleep(30000);
  const afterLong = mc.settingsState;
  check(`view distance keeps shrinking (${afterDrop.viewDistance} -> ${afterLong.viewDistance})`, afterLong.viewDistance < afterDrop.viewDistance, `${afterLong.viewDistance}`);
  check(
    `resolution only starts dropping then (1 -> ${afterLong.resolutionScale})`,
    afterLong.resolutionScale < 1,
    `${afterLong.resolutionScale}`,
  );

  // ---- 恢复：先还分辨率、最后才放视距
  // 分辨率冷却 10 秒一次，25 秒够还两档；视距在这期间一动不动
  mc.simulateFrameTime(0);
  await sleep(25000);
  const afterRecover = mc.settingsState;
  check(
    `resolution recovers first (${afterLong.resolutionScale} -> ${afterRecover.resolutionScale})`,
    afterRecover.resolutionScale > afterLong.resolutionScale,
    `${afterRecover.resolutionScale}`,
  );
  check(
    'view distance stays put until the resolution is full',
    afterRecover.viewDistance === afterLong.viewDistance,
    `${afterLong.viewDistance} -> ${afterRecover.viewDistance}`,
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
