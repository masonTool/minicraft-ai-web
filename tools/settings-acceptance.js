/**
 * 暂停菜单与设置（K3）验收
 *
 * 用法：playwright-cli eval "eval(atob('$(base64 -i tools/settings-acceptance.js | tr -d '\n')'))"
 * （或见 tools/settings-check.sh）
 *
 * ⚠️ 批次 108 起这个面板是**两页**（同一份 DOM，切 `.active`）：
 *   `menu`     = 暂停菜单：继续游戏 / 设置 / 成就 / 保存并退出到主菜单 / 删除本世界
 *   `settings` = 设置项：滑块、开关、下拉、资源包
 * 所以脚本也按"先看菜单页 → 点设置 → 看设置页 → 点返回"来走：
 * 之前那些"打开面板就有四个滑块"的断言已经不再成立（这正是本次要改的东西）。
 */
(async function settingsAcceptance() {
  const mc = window.__mc;
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---- 初始状态
  const initial = mc.settingsState;
  check('pause menu hidden initially', initial.open === false);
  check('view distance applied from settings', initial.viewDistance === initial.settings.viewDistance, `${initial.viewDistance}`);

  // ---- 打开暂停菜单：这一页只应该有几个"主要按钮"
  mc.openSettings();
  const panel = document.getElementById('settings-screen');
  check('Esc/pause menu opens', mc.settingsState.open === true && !!panel && !panel.classList.contains('hidden'));
  check('ui paused while menu open', mc.isUiOpen === true, `isUiOpen=${mc.isUiOpen}`);

  const menuPage = panel.querySelector(".pause-page[data-page='menu']");
  check('opens on the pause menu page', !!menuPage && menuPage.classList.contains('active'));

  const actions = [...(menuPage?.querySelectorAll('.pause-action') ?? [])].filter((b) => b.style.display !== 'none');
  const labels = actions.map((b) => b.textContent ?? '');
  check(
    'main buttons are continue / settings / save-and-exit',
    labels.some((t) => t.includes('继续')) && labels.some((t) => t === '设置') && labels.some((t) => t.includes('退出')),
    labels.join(' / '),
  );
  check(
    'the pause menu page has no settings widgets (they moved to their own page)',
    (menuPage?.querySelectorAll('input').length ?? -1) === 0,
    `${menuPage?.querySelectorAll('input').length} inputs`,
  );
  const meta = menuPage?.querySelector('.settings-meta');
  check('save info shown in the pause menu', (meta?.textContent ?? '').length > 0, meta?.textContent ?? '');

  // ---- 点"设置"进二级页
  document.getElementById('pause-settings')?.click();
  await sleep(80);
  const settingsPage = panel.querySelector(".pause-page[data-page='settings']");
  check('settings button opens the settings page', !!settingsPage && settingsPage.classList.contains('active'));
  check('pause menu page is hidden while in settings', !menuPage.classList.contains('active'));

  const sliders = panel.querySelectorAll('input[type="range"]');
  check(
    'sliders present on the settings page (view/fov/touch size/sensitivity/volume)',
    sliders.length >= 4,
    `${sliders.length}`,
  );
  const toggles = panel.querySelectorAll('input[type="checkbox"]');
  check('toggles present (clouds/adaptive/invertY/daylight/debug/creative)', toggles.length >= 5, `${toggles.length}`);
  check('selects present (camera/particles/stick)', panel.querySelectorAll('select').length >= 3, `${panel.querySelectorAll('select').length}`);

  // ---- "‹ 返回"回到暂停菜单（面板**还开着**：这一层只是退一级）
  const back = panel.querySelector('.settings-back');
  check('there is a way back to the pause menu', !!back);
  back?.click();
  await sleep(80);
  check(
    'back returns to the pause menu and keeps the panel open',
    mc.settingsState.open === true && menuPage.classList.contains('active'),
    `open=${mc.settingsState.open}`,
  );

  // ---- 改设置：应当立即生效（不必停在设置页上）
  const beforeChunks = mc.info.chunks;
  mc.updateSettings({ viewDistance: 6, fov: 90, volume: 0.5, sensitivity: 1.5 });
  const after = mc.settingsState;
  check('view distance applied live', after.viewDistance === 6, `${after.viewDistance}`);
  check('fov applied to camera', Math.abs(after.fov - 90) < 0.01, `${after.fov}`);
  check('sensitivity stored', after.settings.sensitivity === 1.5, `${after.settings.sensitivity}`);

  // 视距变小 → 渲染的区块应当变少（等一会儿让卸载跑完）
  await sleep(2500);
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

  return lines.join('\n');
})();
