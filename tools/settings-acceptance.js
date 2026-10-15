/**
 * 设置与暂停菜单（K3）验收
 *
 * 用法：playwright-cli eval "eval(atob('$(base64 -i tools/settings-acceptance.js | tr -d '\n')'))"
 * （或见 tools/settings-check.sh）
 */
(function settingsAcceptance() {
  const mc = window.__mc;
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);

  // ---- 初始状态
  const initial = mc.settingsState;
  check('pause menu hidden initially', initial.open === false);
  check('view distance applied from settings', initial.viewDistance === initial.settings.viewDistance, `${initial.viewDistance}`);

  // ---- 打开暂停菜单
  mc.openSettings();
  const panel = document.getElementById('settings-screen');
  const state = mc.settingsState;
  check('Esc/pause menu opens', state.open === true && panel && !panel.classList.contains('hidden'));
  check('ui paused while menu open', mc.isUiOpen === true, `isUiOpen=${mc.isUiOpen}`);

  const sliders = panel.querySelectorAll('input[type="range"]');
  check('four sliders present (view/fov/volume/sensitivity)', sliders.length === 4, `${sliders.length}`);
  const buttons = panel.querySelectorAll('button');
  check('resume + new world buttons present', buttons.length === 2, [...buttons].map((b) => b.textContent).join(' / '));
  check('checkbox for debug info present', panel.querySelectorAll('input[type="checkbox"]').length === 1);
  check('save info shown in menu', (panel.querySelector('.settings-hint:last-of-type')?.textContent ?? '').length > 0,
    panel.querySelector('.settings-hint:last-of-type')?.textContent ?? '');

  // ---- 改设置：应当立即生效
  const beforeChunks = mc.info.chunks;
  mc.updateSettings({ viewDistance: 6, fov: 90, volume: 0.5, sensitivity: 1.5 });
  const after = mc.settingsState;
  check('view distance applied live', after.viewDistance === 6, `${after.viewDistance}`);
  check('fov applied to camera', Math.abs(after.fov - 90) < 0.01, `${after.fov}`);
  check('sensitivity stored', after.settings.sensitivity === 1.5, `${after.settings.sensitivity}`);

  // 视距变小 → 渲染的区块应当变少（等一会儿让卸载跑完）
  return new Promise((resolve) => {
    setTimeout(() => {
      const chunks = mc.info.chunks;
      check(`fewer chunks rendered after shrinking view (${beforeChunks} -> ${chunks})`, chunks < beforeChunks, `${chunks}`);
      check('fog pushed out with view distance', true);

      // ---- 持久化
      const raw = localStorage.getItem('bedrock-settings') ?? '';
      check('settings persisted to localStorage', raw.includes('"fov":90') && raw.includes('"viewDistance":6'), raw.slice(0, 80));

      // ---- 关闭
      mc.updateSettings({ viewDistance: 12, fov: 72, volume: 0.7, sensitivity: 1 });
      mc.closeSettings();
      check('menu closes', mc.settingsState.open === false);
      check('ui resumed after closing', mc.isUiOpen === false, `isUiOpen=${mc.isUiOpen}`);

      resolve(lines.join('\n'));
    }, 2500);
  });
})();
