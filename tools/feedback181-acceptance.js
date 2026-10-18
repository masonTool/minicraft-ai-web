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

  // 批次 183：真机日志里 clientX/Y 会偶发变成 0,0。只要 screen 还有值，就必须能转视角。
  const lookEl = document.getElementById('touch-look');
  const fireLook = (type, id, client, screen) =>
    lookEl.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        isPrimary: true,
        clientX: client[0],
        clientY: client[1],
        screenX: screen[0],
        screenY: screen[1],
        pointerId: id,
        pointerType: 'touch',
      }),
    );
  const yawBefore = mc.lookAngles.yaw;
  fireLook('pointerdown', 901, [0, 0], [400, 200]);
  fireLook('pointermove', 901, [0, 0], [470, 200]);
  await sleep(350);
  const turned = Math.abs(mc.lookAngles.yaw - yawBefore) > 1;
  fireLook('pointerup', 901, [0, 0], [470, 200]);
  check('client 坐标全 0 时用 screen 兜底仍能转视角', turned, `${(mc.lookAngles.yaw - yawBefore).toFixed(1)}°`);

  // 三组坐标全 0：这次手势必须作废，并自动重排触摸层（不要求玩家去开关背包）
  fireLook('pointerdown', 902, [0, 0], [0, 0]);
  await sleep(80);
  const rejected = mc.touch.lookPointer === null;
  await sleep(120);
  const restored = getComputedStyle(document.getElementById('touch-ui')).display !== 'none';
  check('三组坐标全 0 时不接管手势', rejected);
  check('坐标异常后触摸层自动恢复显示', restored);

  // 按下时正常、拖动过程中变成 0,0：必须中途换到 screen 继续转，而不是停住
  const yawRebase = mc.lookAngles.yaw;
  fireLook('pointerdown', 903, [400, 200], [400, 200]);
  fireLook('pointermove', 903, [0, 0], [470, 200]);
  fireLook('pointermove', 903, [0, 0], [530, 200]);
  await sleep(350);
  const rebased = Math.abs(mc.lookAngles.yaw - yawRebase) > 1;
  fireLook('pointerup', 903, [0, 0], [530, 200]);
  check('拖动中途 client 变 0 时切到 screen 继续转视角', rebased, `${(mc.lookAngles.yaw - yawRebase).toFixed(1)}°`);

  // 连续两次坐标异常：自动开关一次背包（用户手动恢复路径的自动化）
  fireLook('pointerdown', 904, [0, 0], [0, 0]);
  await sleep(250);
  fireLook('pointerdown', 905, [0, 0], [0, 0]);
  await sleep(350);
  const diagText = window.__diag?.exportJson?.() ?? '';
  check('连续坐标异常会自动开关背包恢复', diagText.includes('autoRecover.uiCycle'));
  await sleep(900);

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

  // 分类区必须**铺满左栏并在内部滚动**（用户反馈"只有 3 行"）
  document
    .querySelector('.inv-recipes-btn[data-role="recipe-toggle"]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(400);
  {
    const gridEl = document.querySelector('.inv-grid.inv-category');
    const panelEl = document.querySelector('.inv-panel');
    const g = gridEl?.getBoundingClientRect();
    const p = panelEl?.getBoundingClientRect();
    check(
      '分类区被约束在面板内',
      !!g && !!p && g.bottom <= p.bottom + 1 && g.height > 160,
      g && p ? `grid ${Math.round(g.height)}px / bottom ${Math.round(g.bottom)} <= ${Math.round(p.bottom)}` : 'missing',
    );
    check(
      '分类区内部可滚动',
      !!gridEl && gridEl.scrollHeight > gridEl.clientHeight + 2,
      gridEl ? `scroll ${gridEl.scrollHeight} vs client ${gridEl.clientHeight}` : 'missing',
    );
  }
  {
    const panelEl = document.querySelector('.inv-panel');
    const p = panelEl?.getBoundingClientRect();
    const railButtons = [...document.querySelectorAll('.inv-rail-left button')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const clipped = railButtons.filter((b) => {
      const r = b.getBoundingClientRect();
      return !!p && (r.bottom > p.bottom + 1 || r.top < p.top - 1);
    });
    check('左侧分类按钮没有被裁掉', railButtons.length >= 5 && clipped.length === 0, `${railButtons.length} 个 / 裁掉 ${clipped.length}`);
  }

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
    // 批次 183：HUD 挂在静态容器上，重进世界必须只有一套
    check(
      '重进世界后只有一套血条',
      document.querySelectorAll('#vital-health').length === 1,
      `${document.querySelectorAll('#vital-health').length} 套`,
    );
    check(
      '重进世界后只有一条经验条',
      document.querySelectorAll('#xp-bar').length === 1,
      `${document.querySelectorAll('#xp-bar').length} 条`,
    );
  }

  const failed = lines.filter((line) => line.startsWith('[FAIL]')).length;
  lines.push(`结果：${lines.length - failed - 1} 通过 / ${failed} 失败`);
  return lines.join('\n');
})();
