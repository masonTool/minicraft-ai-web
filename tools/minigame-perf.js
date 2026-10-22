/**
 * 小游戏对主世界的影响：进/出前后帧率与显存计数对比（小游戏6 收尾）
 *
 * 用法（游戏内、控制台或 playwright-cli）：
 *   playwright-cli eval "eval(atob('$(base64 -i tools/minigame-perf.js | tr -d '\n')'))"
 *
 * 为什么用"进/出"而不是"同时跑"：小游戏激活时主循环会**整帧跳过**世界
 * （见 `main.ts` 的早退分支），两者从不并行。所以真正要证明的是
 * **退出之后主世界没有留下任何东西**——几何体/纹理要回落到基线，帧率不掉。
 *
 * ⚠️ 判据用"基线的 85%"而不是"完全相等"：帧率本身有 ±5% 的抖动，
 * 拿精确值当门禁只会变成每天重跑的名场面。
 */
(async function minigamePerf() {
  const mc = window.__mc;
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  if (!mc) {
    console.log('[FAIL] 需要在游戏内运行（window.__mc 不存在）');
    return;
  }

  const snapshot = () => {
    const perf = mc.perfSnapshot();
    const mini = mc.minigameStateForTest;
    return { fps: perf.fps, frameMs: perf.frameMs, geometries: mini.geometries, textures: mini.textures };
  };

  // ---- 基线：主世界 10 秒
  await sleep(10000);
  const base = snapshot();
  // ⚠️ 不设"绝对帧率"门槛：无头浏览器是 SwiftShader 软件渲染（约 10fps），
  // 那个数字与真机完全不是一回事。这里只要求"能测到"，真正的判据是**不劣化**。
  check('基线帧率可测', Number.isFinite(base.fps) && base.fps > 0, `${base.fps}fps / ${base.frameMs}ms`);

  // ---- 进小游戏 3 秒
  check('进入小游戏', mc.startMinigameForTest() === true);
  await sleep(3000);
  const during = snapshot();
  check('小游戏在跑', mc.minigameStateForTest.active === true);
  check(
    '小游戏有自己的几何体（说明它真的在建东西）',
    during.geometries > base.geometries,
    `${base.geometries} -> ${during.geometries}`,
  );

  // ---- 退出
  mc.stopMinigameForTest();
  await sleep(800);
  const exited = mc.minigameStateForTest;
  check('退出后不再激活', exited.active === false);
  check('退出后舞台清空（不留 DOM）', exited.stageChildren === 0, `${exited.stageChildren} 个子节点`);
  check(
    '退出后几何体回落到基线（不超出 2 个）',
    exited.geometries <= base.geometries + 2,
    `${base.geometries} -> ${exited.geometries}`,
  );
  check(
    '退出后纹理回落到基线（不超出 2 张）',
    exited.textures <= base.textures + 2,
    `${base.textures} -> ${exited.textures}`,
  );

  // ---- 再来 10 秒：帧率不该劣化
  await sleep(10000);
  const post = snapshot();
  check(
    '回主世界帧率没有劣化（≥ 基线的 85%）',
    post.fps >= base.fps * 0.85,
    `${base.fps} -> ${post.fps}fps`,
  );

  window.__minigamePerfResult = lines;
  console.log(lines.join('\n'));
  console.log(`\n${lines.filter((line) => line.startsWith('[FAIL]')).length} 项失败 / ${lines.length} 项`);
  return lines;
})();
