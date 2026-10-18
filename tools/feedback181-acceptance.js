/**
 * 批次 181 的用户反馈专项验收（真浏览器）
 *
 * 覆盖离线测试够不到的那几条：
 *  - 退出世界是**应用内回菜单**（页面没有 reload），还能再次进入同一个世界；
 *  - 创造模式切"个人仓库"后，左轨分类仍能切回创造物品栏；
 *  - 左栏主背包与分类都是 7 列、没有横向裁切；
 *  - 准星目标名称、2 秒提示浮窗真的出现；
 *  - 返回键层级：游戏内无面板 → 暂停菜单。
 *
 * 运行：sh tools/feedback181-check.sh（需要 dev server + playwright-cli）
 */

(async () => {
  const lines = [];
  const check = (label, ok, detail = '') => {
    lines.push(`${ok ? '[OK]' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (fn, timeout = 20000) => {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      try {
        if (fn()) return true;
      } catch {
        /* 还没就绪 */
      }
      await sleep(200);
    }
    return false;
  };
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  if (!(await waitFor(() => window.__worldMenu, 15000))) {
    return '[FAIL] 主菜单没出来';
  }
  // 刷新会丢掉这个标记："应用内回菜单"必须保住它
  window.__noReloadMarker = 'alive';

  const menu = window.__worldMenu;
  menu.fillNewWorldForm('验收181', '424242', 'default', 'normal');
  menu.submitNewWorld();
  if (!(await waitFor(() => window.__mc && window.__mc.info?.chunks > 0, 30000))) {
    return lines.concat('[FAIL] 世界没加载出来').join('\n');
  }

  const mc = window.__mc;
  mc.enableTouchControls();
  await sleep(400);

  // ---------------------------------------------------------------- 模式与 HUD
  check('新世界默认是生存模式', mc.gameMode === 'survival' && mc.isCreative === false, `${mc.gameMode}`);

  mc.look(0, -80);
  await sleep(500);
  const target = document.getElementById('target-info');
  check('准星下方显示目标方块名', visible(target) && (target.textContent ?? '').length > 0, target?.textContent ?? '');

  mc.cycleCameraMode();
  await sleep(150);
  const toast = document.getElementById('hud-toast');
  check('视角切换弹出 2 秒提示', visible(toast) && (toast.textContent ?? '').includes('视角'), toast?.textContent ?? '');
  mc.setCameraMode('first');

  // ---------------------------------------------------------------- 背包左栏
  mc.setGameMode('creative');
  mc.toggleInventory();
  await sleep(500);
  const panel = document.querySelector('.inv-panel');
  const colCount = (el) => (el ? getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length : 0);
  const paneNow = () => panel?.dataset.pocketLeft ?? '';

  // 先切到"个人仓库"再量：创造物品栏那一屏里主背包是隐藏的（clientHeight = 0）
  const toggle = document.querySelector('.inv-recipes-btn[data-role="creative-toggle"]');
  toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(300);
  check('切到"个人仓库"', paneNow() === 'items', paneNow());
  const mainGrid = document.querySelector('.inv-main > .inv-grid');
  check('个人仓库是 7 列', colCount(mainGrid) === 7, `${colCount(mainGrid)} 列`);
  if (mainGrid && panel) {
    const g = mainGrid.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    check('个人仓库第一格没有被裁到面板外', g.left >= p.left - 1 && g.right <= p.right + 1, `${Math.round(g.left)}..${Math.round(g.right)} in ${Math.round(p.left)}..${Math.round(p.right)}`);
  }

  // 创造 → 个人仓库 → 再点左侧分类：必须能回到创造物品栏（批次 181 的 F6）
  const railTab = document.querySelector('.inv-rail-left .inv-tab[data-category="building"]');
  railTab?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 8101, pointerType: 'touch', button: 0 }));
  railTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(300);
  check('再点左侧分类能回到创造物品栏', paneNow() === 'creative', paneNow());

  // 生存模式的分类栏也必须是 7 列
  mc.toggleInventory();
  await sleep(600);
  mc.setGameMode('survival');
  mc.toggleInventory();
  await sleep(500);
  const catTab = document.querySelector('.inv-rail-left .inv-pocket-recipe-tab[data-tab="building"]');
  catTab?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 8102, pointerType: 'touch', button: 0 }));
  await sleep(400);
  check('分类网格也是 7 列', colCount(document.querySelector('.inv-grid.inv-category')) === 7, paneNow());

  mc.toggleInventory();
  await sleep(600);

  // ---------------------------------------------------------------- 返回键：游戏内无面板 → 暂停菜单
  mc.setGameMode('survival');
  history.back();
  await sleep(500);
  check('游戏内按返回先打开暂停菜单', mc.settingsScreen.isOpen === true && mc.uiOpen === true);
  if (mc.settingsScreen.isOpen) {
    mc.closeSettings();
    await sleep(300);
  }

  // ---------------------------------------------------------------- 应用内回菜单（不 reload）
  await mc.exitToMenu();
  await sleep(900);
  check('退出世界没有刷新页面', window.__noReloadMarker === 'alive');
  check('局内实例已拆掉', !window.__mc);
  const worldScreen = document.getElementById('world-screen');
  check('回到主菜单首页', visible(worldScreen) && !worldScreen.classList.contains('hidden'));

  // 再次进入同一个世界：验证 dispose 之后 atlas / renderer / worker 还能重建
  menu.setView('worlds');
  await sleep(300);
  const enter = document.querySelector('#world-screen .world-enter');
  enter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const back = await waitFor(() => window.__mc && window.__mc.info?.chunks > 0, 30000);
  check('回菜单后还能再次进入同一个世界', back, back ? 'chunks > 0' : 'timeout');
  if (back) {
    check('再次进入后背包仍是空的（没有重复发开局物资）', window.__mc.inventory.slots.every((slot) => !slot));
  }

  const failed = lines.filter((line) => line.startsWith('[FAIL]')).length;
  lines.push(`结果：${lines.length - failed - 1} 通过 / ${failed} 失败`);
  return lines.join('\n');
})();
