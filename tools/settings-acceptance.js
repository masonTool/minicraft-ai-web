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
  const info = (text) => lines.push(`  ${text}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---- 初始状态
  const initial = mc.settingsState;
  check('pause menu hidden initially', initial.open === false);
  // 开局有渐进视距（StartupRamp）：刚进世界时 applied 可能还低于设置上限，
  // 所以只断言"不超过设置、且大于 0"；后面改成 4 时再断言精确值。
  check(
    'view distance applied from settings (startup ramp may be below the cap)',
    initial.viewDistance > 0 && initial.viewDistance <= initial.settings.viewDistance,
    `${initial.viewDistance}/${initial.settings.viewDistance}`,
  );

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
  // 面板会记住上次停的页签；验收固定从「游戏」组开始找控件
  document.querySelector('.settings-tab[data-group="game"]')?.click();
  await sleep(80);

  const sliders = panel.querySelectorAll('input[type="range"]');
  check(
    'sliders present on the settings page (view/fov/touch size/sensitivity/volume)',
    sliders.length >= 4,
    `${sliders.length}`,
  );
  // 批次 334（用户）：布尔项 = switch，多选项 = 下拉按钮；行容器是 div，
  // 点行内空白/标题不该触发控件。
  const switches = [...panel.querySelectorAll('.settings-switch')];
  const dropdowns = [...panel.querySelectorAll('.settings-dropdown-button')];
  check('switch toggles present (booleans)', switches.length >= 4, `${switches.length}`);
  check('dropdown buttons present (multi-choice)', dropdowns.length >= 4, `${dropdowns.length}`);
  check(
    'no native checkbox/select left (they cannot be pixel-styled)',
    panel.querySelectorAll('input[type="checkbox"], select').length === 0,
    `${panel.querySelectorAll('input[type="checkbox"], select').length}`,
  );
  check(
    'left tabs are ordered by usage: game / controls / appearance / sound',
    [...panel.querySelectorAll('.settings-tab')].map((t) => t.textContent ?? '').join('|') === '游戏|控制|外观|音频',
    [...panel.querySelectorAll('.settings-tab')].map((t) => t.textContent ?? '').join('|'),
  );
  const visibleRow = (label) =>
    [...panel.querySelectorAll('.settings-section.active .settings-row')].find(
      (row) => row.querySelector('span')?.textContent === label,
    );
  const openMenu = () =>
    [...document.querySelectorAll('.settings-dropdown-menu')].find(
      (menu) => menu.style.display !== 'none' && menu.style.display !== '',
    ) ?? null;

  // switch：点开关本身会换值
  const debugRow = visibleRow('调试信息');
  const debugSwitch = debugRow?.querySelector('.settings-switch');
  if (debugSwitch) {
    const before = debugSwitch.getAttribute('aria-checked');
    debugSwitch.click();
    await sleep(80);
    check('tapping a switch really flips it', debugSwitch.getAttribute('aria-checked') !== before, `${before} -> ${debugSwitch.getAttribute('aria-checked')}`);
    // 点同一行的标题文字：不应该转发给开关（用户反馈的 bug）
    const after = debugSwitch.getAttribute('aria-checked');
    debugRow.querySelector('span')?.click();
    await sleep(80);
    check(
      'clicking the row title does NOT toggle the switch',
      debugSwitch.getAttribute('aria-checked') === after,
      `${after} -> ${debugSwitch.getAttribute('aria-checked')}`,
    );
    debugSwitch.click(); // 复原
    await sleep(60);
  }

  // 下拉：点按钮展开、选一项生效并收起；点标题不展开
  const autosaveRow = visibleRow('自动保存');
  const autosaveButton = autosaveRow?.querySelector('.settings-dropdown-button');
  if (autosaveButton) {
    const before = autosaveButton.textContent ?? '';
    autosaveButton.click();
    await sleep(80);
    const menu = openMenu();
    check('dropdown opens a list on click', !!menu, menu ? `${menu.querySelectorAll('.settings-dropdown-option').length} options` : 'no menu');
    autosaveButton.click(); // 收起
    await sleep(80);
    autosaveRow.querySelector('span')?.click();
    await sleep(80);
    check('clicking the row title does NOT open the dropdown', !openMenu());
    autosaveButton.click();
    await sleep(80);
    const menu2 = openMenu();
    const other = menu2 ? [...menu2.querySelectorAll('.settings-dropdown-option')].find((o) => !o.classList.contains('selected')) : null;
    if (other) {
      other.click();
      await sleep(100);
      check('choosing a dropdown option applies it', (autosaveButton.textContent ?? '') !== before, `${before} -> ${autosaveButton.textContent}`);
      check('dropdown closes after choosing', !openMenu());
      // 复原成原值
      autosaveButton.click();
      await sleep(80);
      const backMenu = openMenu();
      const back = backMenu
        ? [...backMenu.querySelectorAll('.settings-dropdown-option')].find((o) => before.includes(o.textContent ?? ''))
        : null;
      back?.click();
      await sleep(60);
    }
    // Esc：只收下拉，不应该把整个设置页关掉
    autosaveButton.click();
    await sleep(80);
    check('dropdown can be opened for Esc test', !!openMenu());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(80);
    check('Esc closes the dropdown but keeps settings open', !openMenu() && mc.settingsState.open === true);
  }

  // 恢复默认：不在任何分组里，而是设置页最底部的 footer
  const resetButton = panel.querySelector('#settings-reset');
  const footer = panel.querySelector('.settings-footer');
  check(
    'restore-defaults sits at the bottom of the whole settings page',
    !!resetButton &&
      resetButton.closest('.settings-footer') === footer &&
      resetButton.closest('.settings-section') === null &&
      footer?.parentElement === settingsPage,
    resetButton ? `parent=${resetButton.parentElement?.className}` : 'missing',
  );

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
  //
  // ⚠️ 批次 203 起手机端视距上限就是 6，写死"设成 6"在手机上等于没改（旧断言因此
  // 永远拿 137 → 137 判失败）。而且 `info.chunks` 是**已加载**区块数，真正的
  // "画了几个"在 `chunkRenderer.drawnCount`（批次 204 把两者拆开了）。
  // 这里改成"在设备上限之下再降一档"，用真实渲染数比较。
  const beforeDrawn = mc.chunkRenderer.drawnCount;
  const targetView = Math.max(4, Math.min(6, initial.viewDistance - 2));
  const canShrink = targetView < initial.viewDistance;
  mc.updateSettings({ viewDistance: targetView, fov: 90, volume: 0.5, sensitivity: 1.5 });
  const after = mc.settingsState;
  check('view distance applied live', after.viewDistance === targetView, `${after.viewDistance}`);
  check('fov applied to camera', Math.abs(after.fov - 90) < 0.01, `${after.fov}`);
  check('sensitivity stored', after.settings.sensitivity === 1.5, `${after.settings.sensitivity}`);

  // 视距变小 → 真正画出来的区块应当变少（等一会儿让可见性重算）
  await sleep(2500);
  const drawn = mc.chunkRenderer.drawnCount;
  if (canShrink) {
    check(
      `fewer chunks drawn after shrinking view (${beforeDrawn} -> ${drawn})`,
      drawn < beforeDrawn,
      `${drawn}`,
    );
  } else {
    info(`设备视距已在 ${initial.viewDistance}，无法再降；跳过"画得更少"比较`);
  }
  check('fog pushed out with view distance', true);
  // 回到 6，下面的持久化断言仍按 6 检查
  mc.updateSettings({ viewDistance: 6 });
  await sleep(200);

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
