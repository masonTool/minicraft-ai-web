/**
 * 批次 185 用户反馈专项验收（真浏览器，844×390 横屏 + 触摸模拟）
 *
 * 覆盖离线断言够不到的那几条：
 *  - 竖屏浮层（这一轮在 360×732 下另测，见 tools/feedback185-check.sh 的两段）
 *  - 新建世界表单：标签与输入框同一行、一屏放完
 *  - 背包左轨单列、标题栏压半、分类搜索不占位、底部统计、切分类回顶
 *  - 红底物品：不选中、有工作台/熔炉标记
 *  - 丢弃（点界面外）、创造工作台左侧分类、箱子格子比例
 *  - 设置恢复默认、触摸点生物攻击、水流动、后台回来暂停门
 *
 * 运行：sh tools/feedback185-check.sh（dev server + playwright-cli）
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
  const rect = (el) => (el ? el.getBoundingClientRect() : null);

  if (!(await waitFor(() => window.__worldMenu, 15000))) return '[FAIL] 主菜单没出来';
  const menu = window.__worldMenu;

  // ------------------------------------------------------------ 新建世界表单
  menu.setView('create');
  await sleep(300);
  {
    const rows = [...document.querySelectorAll('.world-row')];
    const sameLine = rows.every((row) => {
      const label = rect(row.querySelector('span'));
      const input = rect(row.querySelector('.world-input'));
      if (!label || !input) return true;
      return Math.abs((label.top + label.bottom) / 2 - (input.top + input.bottom) / 2) < 6;
    });
    const view = document.querySelector(".world-view[data-view='create']");
    const btn = rect(document.getElementById('world-create-button'));
    const panel = rect(document.querySelector('.world-panel'));
    check('新建世界：标签与输入框同一行', rows.length >= 4 && sameLine, `${rows.length} 行`);
    check(
      '新建世界：一屏放完（不出现滚动，创建键在面板内）',
      !!view && view.scrollHeight <= view.clientHeight + 1 && !!btn && !!panel && btn.bottom <= panel.bottom,
      view ? `scroll ${view.scrollHeight}/${view.clientHeight}` : 'missing',
    );
    const lefts = [...new Set(rows.map((r) => Math.round(rect(r.querySelector('.world-input')).left)))];
    check('新建世界：两列输入框左缘对齐', lefts.length === 2, lefts.join(','));
  }

  // ------------------------------------------------------------ 进世界
  menu.fillNewWorldForm('验收185', '20261018', 'default', 'normal', 'survival');
  menu.submitNewWorld();
  if (!(await waitFor(() => window.__mc && window.__mc.info?.chunks > 0, 40000))) {
    return lines.concat('[FAIL] 世界没加载出来').join('\n');
  }
  const mc = window.__mc;
  mc.enableTouchControls();
  await sleep(600);
  check('新世界默认生存', mc.gameMode === 'survival');

  // ------------------------------------------------------------ 背包左轨 + 标题栏
  mc.toggleInventory();
  await sleep(500);
  {
    const btns = [...document.querySelectorAll('.inv-rail-left button')].filter((b) => rect(b).width > 0);
    const panel = rect(document.querySelector('.inv-panel'));
    const xs = [...new Set(btns.map((b) => Math.round(rect(b).left)))];
    const clipped = btns.filter((b) => {
      const r = rect(b);
      return r.bottom > panel.bottom + 1 || r.top < panel.top - 1;
    });
    check('左轨是**一个竖列**（所有按钮同一个 x）', btns.length >= 5 && xs.length === 1, `${btns.length} 个 / x=${xs.join(',')}`);
    check('左轨按钮没有被裁掉', clipped.length === 0, `裁掉 ${clipped.length}`);
    const close = rect(document.querySelector('.inv-close'));
    const header = rect(document.querySelector('.inv-header'));
    check('关闭键缩到 24×20', Math.round(close.width) <= 26 && Math.round(close.height) <= 22, `${Math.round(close.width)}×${Math.round(close.height)}`);
    check('标题栏压到 26px 以内（原 34）', header.height <= 26, `${header.height.toFixed(1)}px`);
  }

  // ------------------------------------------------------------ 分类：搜索不占位 / 统计 / 回顶
  const clickTab = (tab) => {
    const el = document.querySelector(`.inv-rail-left .inv-pocket-recipe-tab[data-tab='${tab}']`);
    el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', button: 0, pointerId: 41 }));
  };
  clickTab('building');
  await sleep(400);
  {
    const host = document.querySelector('.inv-category-section');
    const search = host?.querySelector('.inv-search');
    const grid = host?.querySelector('.inv-grid');
    const info = host?.querySelector('.inv-category-info');
    const gap = host && grid ? Math.round(rect(grid).top - rect(host).top) : -1;
    check('非搜索分类：搜索框收起、网格顶到栏顶', search && getComputedStyle(search).display === 'none' && gap <= 1, `gap=${gap}`);
    check('分类底部有统计（我有 N / 共 M）', !!info && /我有 \d+ \/ 共 \d+/.test(info.textContent), info?.textContent ?? 'missing');
  }
  // 打开"显示全部"→ 滚下去 → 换分类必须回顶
  document.querySelector(".inv-recipes-btn[data-role='recipe-toggle']")?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(400);
  {
    const grid = document.querySelector('.inv-grid.inv-category');
    grid.scrollTop = 120;
    clickTab('all');
    await sleep(400);
    check('切分类回到顶部', document.querySelector('.inv-grid.inv-category').scrollTop === 0);
  }

  // ------------------------------------------------------------ 红底物品：不选中 + 工作台标记
  {
    const inv = mc.inventoryScreen;
    inv.pickCategoryItem(270); // 斧/镐一类 3×3 配方
    await sleep(300);
    const badges = [...document.querySelectorAll('.inv-craft-station-icon')];
    check('红底物品没有选中态', document.querySelectorAll('.inv-slot.selected, .inv-slot.pressing').length === 0);
    check(
      '3×3 配方在箭头旁点亮"工作台"',
      badges.length > 0 && badges.some((badge) => badge.title.includes('工作台')),
      badges.map((badge) => badge.title).join(',') || 'missing',
    );
  }

  // ------------------------------------------------------------ 丢弃
  {
    const inv = mc.inventoryScreen;
    // 生存模式没有 /give，直接塞进背包（走的是同一条 Inventory.add）
    const id = 2; // minecraft:dirt
    mc.inventory.add(id, 5);
    inv.refresh();
    await sleep(250);
    // 选中的那一叠在 `held` 上不算"在背包里"，总量要把两边加起来
    const total = () => mc.inventory.countOf(id) + (inv.held && inv.held.id === id ? inv.held.count : 0);
    const before = total();
    inv.pickCategoryItem(id);
    await sleep(250);
    const root = document.getElementById('inventory-screen');
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', button: 0, clientX: 4, clientY: 4 }));
    await sleep(350);
    check('选中后点界面外空处 = 丢弃', before >= 5 && total() < before, `${before} → ${total()}`);
  }

  // ------------------------------------------------------------ 创造模式工作台：左侧分类能切
  mc.inventoryScreen.close();
  mc.setGameMode('creative');
  await sleep(200);
  mc.inventoryScreen.openWith('crafting');
  await sleep(500);
  {
    const tab = document.querySelector(".inv-rail-left .inv-tab[data-category='building']");
    tab?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', button: 0, pointerId: 42 }));
    await sleep(400);
    const pane = document.querySelector('.inv-panel').dataset.pocketLeft;
    const grid = document.querySelector('.inv-grid.inv-creative');
    check(
      '创造 3×3 工作台：点分类能切到创造物品栏（原来只显示仓库）',
      pane === 'creative' && !!grid && rect(grid).height > 40 && getComputedStyle(grid.parentElement).display !== 'none',
      `pane=${pane}`,
    );
  }

  // ------------------------------------------------------------ 箱子：格子不能又高又长
  mc.inventoryScreen.close();
  await sleep(200);
  {
    const x = Math.floor(mc.physics.x) + 2;
    const y = Math.floor(mc.physics.y) + 1;
    const z = Math.floor(mc.physics.z);
    const chest = mc.world.containers.getOrCreateChest(mc.dimension, x, y, z);
    mc.inventoryScreen.openWith('chest', chest);
    await sleep(600);
    const slots = [...document.querySelectorAll('#inventory-screen .inv-grid .inv-slot')].filter((s) => rect(s).width > 0);
    const bad = slots.filter((s) => {
      const r = rect(s);
      return r.height / r.width > 1.25;
    });
    const aspect = slots[0] ? (rect(slots[0]).height / rect(slots[0]).width).toFixed(2) : '0';
    check(
      '箱子格子在手机上是方的（不又高又长）',
      mc.inventoryScreen.isOpen && slots.length >= 27 && bad.length === 0,
      `open=${mc.inventoryScreen.isOpen} ${slots.length} 格 / 21? ${aspect}`,
    );
  }

  // ------------------------------------------------------------ 设置：恢复默认
  mc.inventoryScreen.close();
  await sleep(200);
  mc.openSettings();
  mc.settingsScreen.setPage('settings');
  await sleep(300);
  {
    mc.settings.viewDistance = 5;
    const slider = [...document.querySelectorAll('#settings-screen input[type=range]')][0];
    if (slider) slider.value = '5';
    document.getElementById('settings-reset')?.click();
    await sleep(300);
    check(
      '设置：恢复默认把配置改回 12',
      mc.settings.viewDistance === 12 && (!slider || slider.value === '12'),
      `viewDistance=${mc.settings.viewDistance} slider=${slider?.value}`,
    );
  }

  // ------------------------------------------------------------ 触摸攻击（不用准星对准）
  mc.closeSettings();
  await sleep(300);
  const px = Math.floor(mc.physics.x);
  const py = Math.floor(mc.physics.y);
  const pz = Math.floor(mc.physics.z);
  {
    // 猪会走：每轮都重新召唤在**视线正前方 1.5 格**（攻击范围 3.2，留一点余量），
    // 偏开视角后取"点中它的那一像素"，最多试 3 轮。
    let picked = null;
    let tapX = 0;
    let tapY = 0;
    let before = 0;
    let sx = 0;
    let sy = 0;
    let centerPicked = false;
    for (let attempt = 0; attempt < 3 && !picked; attempt++) {
      mc.yaw += attempt === 0 ? 0.25 : 0; // 只在第一轮偏开准星
      const fx = -Math.sin(mc.yaw) * 1.5;
      const fz = -Math.cos(mc.yaw) * 1.5;
      const pigX = px + fx;
      const pigZ = pz + fz;
      mc.runCommand(`/summon pig ${pigX.toFixed(1)} ${py + 1} ${pigZ.toFixed(1)}`);
      await sleep(400);
      // ⚠️ 世界里本来就有野猪：取**离召唤点最近**的那一只
      const mob = mc.entities.all
        .filter((e) => !e.dead && e.type && /pig|猪/.test(String(e.type.id ?? e.type.name ?? '')))
        .sort((a, b) => Math.hypot(a.x - pigX, a.z - pigZ) - Math.hypot(b.x - pigX, b.z - pigZ))
        .find((e) => Math.hypot(e.x - pigX, e.z - pigZ) < 2.2);
      if (!mob) continue;
      await sleep(100);
      const v = mc.camera.position.clone().set(mob.x, mob.y + 0.5, mob.z);
      v.project(mc.camera);
      sx = (v.x * 0.5 + 0.5) * innerWidth;
      sy = (-v.y * 0.5 + 0.5) * innerHeight;
      centerPicked = !!mc.mobAtScreen(innerWidth / 2, innerHeight / 2);
      for (let dy = -40; dy <= 40 && !picked; dy += 10) {
        for (let dx = -40; dx <= 40 && !picked; dx += 10) {
          const hit = mc.mobAtScreen(sx + dx, sy + dy);
          if (hit === mob) {
            picked = hit;
            tapX = sx + dx;
            tapY = sy + dy;
          }
        }
      }
      if (picked) {
        before = mob.health;
        mc.touchPlaceRequest = false;
        mc.touch.actions.onTap(tapX, tapY);
        await sleep(500);
        check(
          '触摸点到生物就能攻击（准星没对准）',
          mob.health < before,
          `tap ${Math.round(tapX)},${Math.round(tapY)} (proj ${Math.round(sx)},${Math.round(sy)}) center=${centerPicked} hp ${before}→${mob.health}`,
        );
        check('这一下没有变成"放方块"', mc.touchPlaceRequest === false, `place=${mc.touchPlaceRequest}`);
      }
    }
    if (!picked) check('触摸点到生物就能攻击（准星没对准）', false, '三轮都没能在屏幕上点中那只猪');
  }

  // ------------------------------------------------------------ 水流动
  {
    const bx = px + 4;
    const by = py + 3;
    const bz = pz;
    const { setBlock } = mc.commandContext();
    setBlock(bx, by - 1, bz, 1); // 石头地板
    setBlock(bx, by - 1, bz + 1, 1);
    setBlock(bx, by, bz, 10); // 水源（Block.WATER）
    setBlock(bx, by, bz + 1, 1); // 塞子
    await sleep(600);
    const before = mc.world.getBlock(bx, by, bz + 1);
    mc.world.setBlockAndUpdate(bx, by, bz + 1, 0);
    mc.wakeFluidsAround(bx, by, bz + 1);
    await sleep(1200);
    const after = mc.world.getBlock(bx, by, bz + 1);
    check('挖掉水旁边的方块：水会流过去', before === 1 && after === 10, `${before} → ${after}`);
  }

  // ------------------------------------------------------------ 3D 角色预览（可旋转 / 披风 / 副手）
  {
    const inv = mc.inventoryScreen;
    inv.openWith('inventory');
    await sleep(500);
    const canvas = document.querySelector('.inv-player-preview');
    const has3d = !!inv.preview3d;
    const before = has3d ? inv.preview3d.rotation : 0;
    if (canvas && has3d) {
      const r = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 71, pointerType: 'touch', clientX: r.left + 20, clientY: r.top + 60 }));
      canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 71, pointerType: 'touch', clientX: r.left + 100, clientY: r.top + 60 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 71, pointerType: 'touch', clientX: r.left + 100, clientY: r.top + 60 }));
    }
    const after = inv.preview3d ? inv.preview3d.rotation : 0;
    check('角色预览是 3D 的，拖动可以转一圈', has3d && Math.abs(after - before) > 0.5, `3d=${has3d} ${before.toFixed(2)}→${after.toFixed(2)}`);

    mc.settings.cape = true;
    inv.refreshPlayerPreview();
    const capeOn = !!inv.preview3d && inv.preview3d.cape === true;
    check('"披风"外观同时作用在预览上', capeOn);
    mc.settings.cape = false;
    inv.refreshPlayerPreview();

    // 外观（批次 187）：改肤色/上衣 → 世界模型与预览同时变
    const prevSkin = mc.settings.skinTone;
    const prevShirt = mc.settings.shirtColor;
    mc.settings.skinTone = (prevSkin + 1) % 6;
    mc.settings.shirtColor = (prevShirt + 1) % 6;
    mc.applySettings(mc.settings); // 走真实的"改设置"链路
    inv.refresh();
    await sleep(200);
    const base = mc.playerRenderer.roleMeshes.skin[0].material.userData.base;
    const expectedSkin =
      (Math.round(base.r * 255) << 16) | (Math.round(base.g * 255) << 8) | Math.round(base.b * 255);
    check(
      '外观（肤色/上衣）同时作用到第三人称与 3D 预览',
      !!inv.preview3d && inv.preview3d.palette.skin === expectedSkin && mc.settings.skinTone === (prevSkin + 1) % 6,
      `skin=${mc.settings.skinTone} palette=${inv.preview3d?.palette?.skin?.toString(16)} model=${expectedSkin.toString(16)}`,
    );
    mc.settings.skinTone = prevSkin;
    mc.settings.shirtColor = prevShirt;
    mc.applySettings(mc.settings);
    inv.close();
    await sleep(400);
  }

  // ------------------------------------------------------------ 潜行姿态
  {
    // 第一人称时模型是隐藏的（`update` 会提前 return），先切第三人称再量姿态
    mc.setCameraMode('third');
    await sleep(500);
    const body = mc.playerRenderer.object;
    // `input` 是 getter（返回一份快照），要真的改状态必须走 `setSneaking`
    const prev = mc.touch?.isSneaking ?? false;
    mc.touch?.setSneaking(true);
    await sleep(350);
    const lean = body.rotation.x;
    const drop = mc.physics.y - body.position.y;
    mc.touch?.setSneaking(prev);
    await sleep(250);
    const restored = body.rotation.x;
    mc.setCameraMode('first');
    await sleep(250);
    check(
      '潜行有姿态（前倾 + 下沉，松开恢复）',
      lean > 0.15 && drop > 0.08 && Math.abs(restored) < 0.02,
      `lean=${lean.toFixed(2)} drop=${drop.toFixed(2)} restore=${restored.toFixed(2)}`,
    );
  }

  // ------------------------------------------------------------ 成就入口（右轨）
  {
    mc.inventoryScreen.openWith('inventory');
    await sleep(450);
    const railBtn = document.querySelector('.inv-rail-right .inv-rail-action');
    const headerBtn = document.querySelector("[data-role='advancements']");
    const railVisible = !!railBtn && railBtn.getBoundingClientRect().width > 0;
    const headerHidden =
      !headerBtn || headerBtn.classList.contains('hidden') || headerBtn.getBoundingClientRect().width === 0;
    const railRect = railBtn ? railBtn.getBoundingClientRect() : null;
    const craftRect = document.querySelector(".inv-rail-right .inv-pocket-tab[data-tab='crafting']")?.getBoundingClientRect();
    check(
      '成就入口在右轨、位于合成上方',
      railVisible && headerHidden && !!railRect && !!craftRect && railRect.top < craftRect.top,
      `rail=${railVisible} headerHidden=${headerHidden}`,
    );
    railBtn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', button: 0 }));
    await sleep(450);
    const adv = document.getElementById('advancements');
    check('点它打开成就面板', !!adv && !adv.classList.contains('hidden'));
    mc.advancementScreen.hide();
    mc.inventoryScreen.close();
    await sleep(450);
  }

  // ------------------------------------------------------------ 后台回来：暂停门
  mc.toggleInventory && (mc.inventoryScreen.isOpen && mc.inventoryScreen.close());
  await sleep(200);
  {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await sleep(250);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await sleep(500);
    check(
      '从后台回来：直接显示游戏内暂停页（没有全屏暂停门）',
      !document.getElementById('resume-gate') && mc.settingsScreen.isOpen === true,
    );
    mc.settingsScreen.hide();
    await sleep(300);
    check('暂停页可以正常关闭回到游戏', mc.settingsScreen.isOpen === false);
  }

  // ------------------------------------------------------------ 返回键层级（最后做：会退出世界）
  {
    mc.openSettings();
    await sleep(500);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const backToMenu = await waitFor(() => !window.__mc && !!document.getElementById('world-screen'), 8000);
    check('暂停菜单再按返回 = 保存并回到主菜单', backToMenu, `mc=${!!window.__mc}`);
  }

  return lines.join('\n');
})();
