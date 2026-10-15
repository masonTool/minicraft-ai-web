/**
 * 音效（K5）浏览器验收
 *
 * 离线测试只能覆盖"材质 → 音效"的映射逻辑（node 里没有 AudioContext），
 * 这里验证真正发声的那部分：AudioContext 能否被用户手势解锁、播放计数、
 * 音量联动、以及距离衰减（超出可听范围不该发声）。
 */
(async function audioAcceptance() {
  const mc = window.__mc;
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 浏览器要求音频必须由用户手势解锁：模拟一次点击
  window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await sleep(400);

  const state = mc.audioState;
  check('audio engine enabled', state.enabled === true, `enabled=${state.enabled}`);
  check('AudioContext is running', state.context === 'running', `state=${state.context}`);

  const before = state.played;
  mc.playSound('break_stone');
  mc.playSound('break_wood');
  mc.playSound('explode');
  mc.playSound('mob_zombie');
  await sleep(150);
  const afterFour = mc.audioState.played;
  check('four sounds counted as played', afterFour - before === 4, `${before} -> ${afterFour}`);

  // 距离衰减：可听范围 32 格，放到 100 格外不该发声
  const beforeFar = mc.audioState.played;
  mc.playSound('break_stone', 100, 64, 100);
  await sleep(80);
  check('sounds beyond hearing range are skipped', mc.audioState.played === beforeFar, `${beforeFar} -> ${mc.audioState.played}`);

  // 近处应当发声（用玩家自己的坐标，别拿世界的 y=64——玩家可能在空中，会被判成"太远"）
  const self = mc.info.position;
  mc.playSound('break_stone', self[0], self[1], self[2]);
  await sleep(80);
  check('nearby sound is played', mc.audioState.played > beforeFar, `${beforeFar} -> ${mc.audioState.played}`);

  // 六类材质音效都能播出去（引擎层面）
  const beforeKinds = mc.audioState.played;
  for (const kind of ['break_stone', 'break_wood', 'break_grass', 'break_sand', 'break_glass', 'break_wool']) {
    mc.playSound(kind, self[0], self[1], self[2]);
  }
  await sleep(150);
  check('all six block-material sounds play', mc.audioState.played - beforeKinds === 6, `${mc.audioState.played - beforeKinds}`);

  // 音量联动：设置里改音量，引擎跟着变
  mc.updateSettings({ volume: 0.25 });
  await sleep(80);
  check('volume follows settings', Math.abs(mc.audioState.volume - 0.25) < 0.001, `${mc.audioState.volume}`);
  mc.updateSettings({ volume: 0.7 });

  // 受伤音效走的是 damagePlayer 路径；这里验证"音效种类覆盖了游戏事件"即可
  const beforeEvents = mc.audioState.played;
  for (const kind of ['hurt', 'death', 'fall', 'door', 'explode', 'splash', 'click', 'mob_zombie', 'mob_skeleton', 'mob_creeper']) {
    mc.playSound(kind, self[0], self[1], self[2]);
  }
  await sleep(200);
  check('all event sounds play', mc.audioState.played - beforeEvents === 10, `${mc.audioState.played - beforeEvents}`);

  return lines.join('\n');
})();
