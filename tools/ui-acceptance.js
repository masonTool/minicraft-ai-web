/**
 * 界面适配验收（批次 26：物品分页 / 手机端图标按钮 / 整体适配）
 *
 * 用法（dev server 已跑起来，视口由 `tools/ui-check.sh` 设好）：
 *   playwright-cli eval "eval(atob('$(base64 -i tools/ui-acceptance.js | tr -d '\n')'))"
 *
 * 覆盖的是"能在桌面浏览器里自动验证的部分"：
 *  1. 触摸按钮是**图标**（没有文字节点、有 svg、热区 ≥44px、互不重叠、有 aria-label）
 *  2. 聊天/命令入口存在，点开输入框、点"发送"能把这一行发出去
 *  3. 创造物品栏**分页**：只渲染当前页、翻页真的换内容、页码正确、页大小与视口匹配
 *  4. 整体适配：没有横向溢出；触屏模式下开始遮罩显示手势说明而不是键盘提示
 *
 * 真机才能量的（发热、硬件触控延迟）仍然归 M17 的真机清单。
 */
(async function uiAcceptance() {
  const lines = [];
  // 标记用 ASCII：终端里中文与 ✓✗ 可能被按单字节解读成乱码
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);
  const info = (text) => lines.push(`  ${text}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rect = (element) => element?.getBoundingClientRect();
  const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const waitFor = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await sleep(250);
    }
    return predicate();
  };

  // ---------------------------------------------------------------- 主页必须"看得见、点得到"
  //
  // ⚠️ 这一组是给一个**真出现过**的 bug 设的门禁（A10 的回归，批次 85 潜伏到批次 102）：
  //    `UnsupportedScreen` 那一层是 `position: fixed; inset: 0; z-index: 90` 的**不透明**
  //    整屏底，而它的构造函数一上来就把它挂到 `<body>`（内容是空的）——
  //    于是**支持 WebGL2 的正常路径**上，主页被一个空层整片盖黑、点不动任何东西，
  //    而当时所有离线断言都不看"谁盖在谁上面"，一条都没红。
  //
  // 三条判据，一条比一条通用（都只量"用户看得见、点得到吗"，不写死实现）：
  //   ① 菜单层有尺寸、有文字；
  //   ② 视口中心那一刻，**最上层元素必须落在菜单里**（这就是"点得到"）；
  //   ③ 不存在"铺满视口 + 不透明 + 拦点击 + **一个字都没有**"的层 —— A10 回归的形状。
  {
    const label = (el) =>
      el
        ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
            typeof el.className === 'string' && el.className.trim()
              ? `.${el.className.trim().split(/\s+/).join('.')}`
              : ''
          }`
        : '(空)';

    // 启动页的菜单是 `#world-screen`（面板一律挂 body，见 index.html 的约定）。
    // ⚠️ 批次 111 之前这里还会试 `#overlay`（"点击进入游戏"那层遮罩），按用户要求
    // 那层已经整个删掉了——进游戏就是世界，所以现在只有 `#world-screen` 一个候选。
    const menus = ['#world-screen'].map((s) => document.querySelector(s)).filter(Boolean);
    const menu = menus.find((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.textContent.trim().length > 0;
    });
    const box = menu?.getBoundingClientRect();
    check(
      '启动页的菜单有尺寸',
      !!box && box.width > 0 && box.height > 0,
      menu ? `${label(menu)} ${Math.round(box.width)}x${Math.round(box.height)}` : '没有可见的菜单层',
    );

    const top = document.elementFromPoint(Math.floor(innerWidth / 2), Math.floor(innerHeight / 2));
    const onMenu = !!(top && menu && (top === menu || menu.contains(top)));
    check('主页点得到（视口中心的最上层元素在菜单里）', onMenu, onMenu ? label(top) : `被 ${label(top)} 盖住了`);
    if (!onMenu && top) {
      const cs = getComputedStyle(top);
      info(`盖住主页的是 ${label(top)}（position ${cs.position} / z-index ${cs.zIndex} / bg ${cs.backgroundImage.slice(0, 40)}）`);
    }

    // ③ 通用形状：空的不透明整屏层**永远不合理**（不管它叫什么名字、谁挂的）
    const emptyCoverers = [];
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      if (cs.pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < innerWidth * 0.95 || r.height < innerHeight * 0.95) continue;
      const opaque = cs.backgroundImage !== 'none' || !/rgba?\([^)]*,\s*0\s*\)|transparent/.test(cs.backgroundColor);
      if (!opaque) continue;
      if (el.textContent.trim().length > 0) continue; // 有内容的是正常界面
      emptyCoverers.push(`${label(el)}(z-index ${cs.zIndex})`);
    }
    check('没有"空的整屏不透明层"压在界面上（A10 回归的形状）', emptyCoverers.length === 0, emptyCoverers.join(' | '));
  }

  // 0. 先进入一个世界：全新的浏览器会话里主菜单是空的，游戏不会自己开始
  //    （`window.__mc` 是 `startWorld` 里才挂上的，所以它同时也是"游戏起来了"的信号）
  //
  // ⚠️ 批次 108 起主菜单是**分层**的：主页只有「游戏」和「设置」两颗按钮，
  //    "进哪个世界"在二级页面里回答。所以进世界要两步——有存档进第一张，
  //    没有就「＋ 新建世界」→「创建并进入」。三步全是同步的 DOM 切换
  //    （`setView` 只切 class、`render()` 是同步的），不必等动画。
  if (typeof window.__mc === 'undefined') {
    document.querySelector('#world-screen .world-primary')?.click(); // 主页「游戏」
    const firstSave = document.querySelector('#world-list .world-enter');
    if (firstSave) firstSave.click();
    else {
      document.getElementById('world-new-button')?.click();
      document.getElementById('world-create-button')?.click();
    }
    const started = await waitFor(() => typeof window.__mc !== 'undefined', 90000);
    if (!started) return '[FAIL] game did not start (window.__mc missing after clicking 游戏 -> 新建世界 -> 创建并进入)';
  }
  const mc = window.__mc;
  await waitFor(() => mc.info.chunks > 0, 30000);

  mc.enableTouchControls();
  await sleep(300);

  // ---------------------------------------------------------------- 1. 图标按钮
  //
  // 批次 107 起按基岩版重新分位：右下那一簇只有"潜行 + 跳跃"，
  // 背包与聊天挂到快捷栏两侧（`#touch-hotbar-inventory` / `#touch-hotbar-chat`）。
  const buttons = [...document.querySelectorAll('.touch-button')];
  const clusterAll = [...document.querySelectorAll('#touch-buttons .touch-button')];
  const clusterVisible = clusterAll.filter((button) => !button.classList.contains('hidden'));
  check('right cluster has jump + fly-up/down nodes', clusterAll.length === 3, `${clusterAll.length} buttons`);
  check(
    'on ground only jump is visible',
    clusterVisible.length === 1 && clusterVisible[0]?.classList.contains('jump'),
    clusterVisible.map((button) => button.dataset.icon).join(','),
  );
  mc.setFlying(true);
  await sleep(50);
  const flyingVisible = clusterAll.filter((button) => !button.classList.contains('hidden'));
  check(
    'flying shows up + jump + down',
    flyingVisible.length === 3,
    flyingVisible.map((button) => button.className).join(' | '),
  );
  mc.setFlying(false);
  await sleep(50);

  const sideButtons = ['touch-hotbar-inventory', 'touch-hotbar-chat'].map((id) => document.getElementById(id));
  check(
    'inventory & chat sit next to the hotbar',
    sideButtons.every(Boolean),
    sideButtons.map((el) => (el ? el.id : 'MISSING')).join(' | '),
  );
  const badSide = sideButtons.filter((el) => {
    if (!el) return true;
    const r = el.getBoundingClientRect();
    return r.width < 44 || r.height < 44 || r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
  });
  check('side buttons are tappable (>= 44px) and on screen', badSide.length === 0, badSide.map((el) => el?.id ?? 'MISSING').join(', '));

  const noText = buttons.filter((button) => button.textContent.trim().length === 0);
  check('buttons render icons, not text', noText.length === buttons.length, `${noText.length}/${buttons.length} have no text node`);

  const withIcon = buttons.filter((button) => button.querySelector('svg path'));
  check('every button has an inline svg icon', withIcon.length === buttons.length, `${withIcon.length}/${buttons.length}`);

  const labelled = buttons.filter((button) => (button.getAttribute('aria-label') ?? '').length > 0);
  check('every button has an aria-label', labelled.length === buttons.length, `${labelled.length}/${buttons.length}`);

  // 飞行前升降键是 .hidden（display:none → 矩形为 0），不能算进热区/重叠
  const visibleButtons = buttons.filter((button) => {
    if (button.classList.contains('hidden')) return false;
    const r = rect(button);
    return !!r && r.width > 1 && r.height > 1;
  });
  const sizes = visibleButtons.map((button) => rect(button));
  const smallest = Math.min(...sizes.map((r) => Math.min(r.width, r.height)));
  check('every visible touch target >= 44px', smallest >= 44, `smallest ${smallest.toFixed(1)}px`);

  let overlaps = 0;
  for (let i = 0; i < sizes.length; i++) {
    for (let j = i + 1; j < sizes.length; j++) if (overlap(sizes[i], sizes[j])) overlaps++;
  }
  check('visible buttons do not overlap', overlaps === 0, `${overlaps} overlapping pairs`);

  // ---------------------------------------------------------------- 2. 聊天入口
  const chatButton = buttons.find((button) => button.dataset.icon === 'chat');
  check('chat button present (mobile had no way to open chat)', !!chatButton);

  if (chatButton) {
    chatButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 7001, pointerType: 'touch' }));
    await sleep(120);
    const chatRoot = document.getElementById('chat');
    const input = chatRoot?.querySelector('.chat-input');
    const send = chatRoot?.querySelector('.chat-send');
    check('chat input opens from the icon', !!chatRoot?.classList.contains('open') && !input?.classList.contains('hidden'), chatRoot?.className ?? 'no #chat');
    check('send button visible on touch', !!send && !send.classList.contains('hidden'));

    if (input && send) {
      const before = mc.chat.messageLines.length;
      input.value = '/time set 1000';
      send.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 7002, pointerType: 'touch' }));
      await sleep(150);
      check('send button submits the line', mc.chat.messageLines.length > before && !chatRoot.classList.contains('open'), `lines ${before} -> ${mc.chat.messageLines.length}`);
    }
    mc.chat.close();
  }

  // ---------------------------------------------------------------- 3. 创造物品栏分页
  mc.toggleInventory();
  await sleep(300);

  const grid = document.querySelector('.inv-grid.inv-creative');
  const pager = document.querySelector('.inv-pager');
  const label = pager?.querySelector('[data-role="label"]');
  const prev = pager?.querySelector('[data-role="prev"]');
  const next = pager?.querySelector('[data-role="next"]');
  check('creative grid + pager present', !!grid && !!pager && !!label && !!prev && !!next);

  if (grid && pager && label) {
    const narrow = window.innerWidth <= 900;
    const pageSize = narrow ? 32 : 60;
    const slots = () => [...grid.querySelectorAll('.inv-slot')];
    const count = slots().length;
    check(`only one page of items is in the DOM (<= ${pageSize})`, count > 0 && count <= pageSize, `${count} slots in DOM`);

    check('pager is visible on the "all" category', !pager.classList.contains('hidden'), label.textContent ?? '');
    info(`page label: ${label.textContent}`);

    const firstBefore = slots()[0]?.querySelector('canvas')?.toDataURL();
    next.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 7003, pointerType: 'touch' }));
    await sleep(120);
    const firstAfter = slots()[0]?.querySelector('canvas')?.toDataURL();
    check('next page really changes the items', !!firstBefore && !!firstAfter && firstBefore !== firstAfter, `slots ${count} -> ${slots().length}`);
    // 用数字解析而不是正则匹配整句：文案里那空格/分隔符一旦调整，正则就会假红
    const pageMatch = /(\d+)\s*\/\s*(\d+)/.exec(label.textContent ?? '');
    check('page label advanced to page 2', pageMatch?.[1] === '2' && Number(pageMatch[2]) > 1, label.textContent ?? '');
    check('prev button enabled after paging', !prev.disabled);

    // 回到第 1 页：第一格应该与翻页前一致
    prev.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 7004, pointerType: 'touch' }));
    await sleep(120);
    const backFirst = slots()[0]?.querySelector('canvas')?.toDataURL();
    check('prev page restores the first page', backFirst === firstBefore, 'first slot icon identical');
    check('prev disabled on the first page', prev.disabled);

    // 页码与页大小必须自洽：`第 1/N 页 · 共 M 件` 里的 N 应该等于 ceil(M / 页大小)
    const summary = /第\s*\d+\s*\/\s*(\d+)\s*页\s*·\s*共\s*(\d+)\s*件/.exec(label.textContent ?? '');
    if (summary) {
      const expectedPages = Math.max(1, Math.ceil(Number(summary[2]) / pageSize));
      check(`page count matches the page size (${pageSize})`, Number(summary[1]) === expectedPages, `${summary[1]} pages for ${summary[2]} items`);
    } else {
      check('page label has the expected shape', false, label.textContent ?? '');
    }

    // 搜索时只有一页 → 翻页条自动隐藏。
    // 查询词用 ASCII：脚本是通过 `atob` 钻进页面的，非 ASCII 字面量很容易变成乱码，
    // 那样"搜到 0 件"会伪装成"只有一页"（这一条本身也曾经假绿过），所以顺带断言真的搜到了东西
    const search = document.querySelector('.inv-search');
    if (search) {
      search.value = 'diamond';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(120);
      const found = slots().length;
      check('search actually matched items', found > 0 && found <= pageSize, `${found} slots for "diamond"`);
      check('pager hides when everything fits one page', pager.classList.contains('hidden'), `${found} slots`);
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(120);
    }

    // 分类标签在窄屏是单行横向滚动（不换行占三行）
    const tabs = document.querySelector('.inv-tabs');
    const style = tabs ? getComputedStyle(tabs) : null;
    info(`tabs: ${style?.flexWrap} | ${tabs ? Math.round(tabs.getBoundingClientRect().height) : 0}px tall`);
    if (narrow && style) check('category tabs stay on one scrollable row', style.flexWrap === 'nowrap', style.flexWrap);
  }

  // ------------------------------------------- 3.5 美化：耐久条、稀有度、设计令牌
  {
    const { toolItemId } = await import('/src/core/registry/tools.ts');
    // 一把损到 23% 的附魔镐 + 一把完好的剑：前者该显示红条与青色标题，后者什么都不显示
    mc.inventory.set(0, { id: toolItemId('pickaxe', 'diamond'), count: 1, damage: 1200, enchants: { efficiency: 4 } });
    mc.inventory.set(1, { id: toolItemId('sword', 'iron'), count: 1 });
    await sleep(250);

    const bar = document.querySelector('#hotbar .slot .dur-bar:not(.hidden)');
    check('damaged tool shows a durability bar in the hotbar', !!bar);
    if (bar) {
      const style = bar.querySelector('b')?.getAttribute('style') ?? '';
      const level = /dur-(high|mid|low)/.exec(bar.className)?.[1];
      check(
        'bar reflects the ratio (~23% => low/red)',
        /width:\s*2[0-9]%/.test(style) && level === 'low',
        `${style.trim()} | ${level}`,
      );
    }
    const undamaged = document.querySelectorAll('#hotbar .slot')[1]?.querySelector('.dur-bar');
    check('undamaged tools get no bar', !!undamaged && undamaged.classList.contains('hidden'));

    // 提示框：稀有度底色 + 附魔行 + 耐久行（三样都是这一批新加的）
    const slot = document.querySelector('#hotbar .slot');
    const slotRect = slot.getBoundingClientRect();
    slot.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, pointerId: 9101,
      clientX: slotRect.left + 8, clientY: slotRect.top + 8,
    }));
    await sleep(150);
    const tip = document.getElementById('item-tooltip');
    check('tooltip opens on hover', !!tip && !tip.classList.contains('hidden'));
    check('tooltip is tinted by rarity (enchanted => rare)', tip?.dataset.rarity === 'rare', tip?.dataset.rarity ?? 'missing');
    check('tooltip has an enchant row', !!tip?.querySelector('.tooltip-enchant'));
    check('tooltip durability row carries a mini bar', !!tip?.querySelector('.tooltip-durability .dur-bar'));

    // 设计令牌真的生效：面板背景必须与 `--panel-bg` 解析出来的**完全一致**，
    // 而不是被某处写死的色值盖住。
    // ⚠️ 批次 109 起原版面板是**纯色** `#c6c6c6`（不再是渐变），所以这里不能只认
    // `backgroundImage.includes('gradient')`。改成拿同一个令牌造一个探针元素对比——
    // 这个判据对"令牌改成纯色/渐变/图片"都成立，比盯住某一种渲染结果牢靠。
    const panelStyle = getComputedStyle(document.querySelector('.inv-panel'));
    const probe = document.createElement('div');
    probe.style.background = 'var(--panel-bg)';
    probe.style.position = 'absolute';
    probe.style.left = '-9999px';
    document.body.appendChild(probe);
    const probeStyle = getComputedStyle(probe);
    const tokenBg = getComputedStyle(document.documentElement).getPropertyValue('--panel-bg').trim();
    check(
      'theme tokens reach the panel',
      panelStyle.backgroundColor === probeStyle.backgroundColor &&
        panelStyle.backgroundImage === probeStyle.backgroundImage &&
        panelStyle.backgroundColor !== 'rgba(0, 0, 0, 0)',
      `--panel-bg: ${tokenBg} -> ${panelStyle.backgroundColor}`,
    );
    probe.remove();
    info(`panel background: ${panelStyle.backgroundColor}`);
  }

  // ------------------------------------------- 3.6 配方书：图标网格 + 分页
  {
    document.querySelector('.inv-recipes-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(400);
    const book = document.getElementById('recipe-book');
    check('recipe book opens from the inventory', !!book && !book.classList.contains('hidden'));

    const { Block } = await import('/src/core/registry/blocks.ts');
    const narrow = window.innerWidth <= 900;
    const cells = [...document.querySelectorAll('.recipe-cell')];
    check(`recipe book renders one page only (<= ${narrow ? 32 : 60})`, cells.length > 0 && cells.length <= (narrow ? 32 : 60), `${cells.length} cells`);
    check('the recipes live in an icon grid (not a card list)', !!document.querySelector('.recipe-grid'));
    check('every cell carries the result id', cells.every((cell) => cell.dataset.resultId), 'missing data-result-id');
    // 基岩版：能做的亮着、做不了的压暗，不做别的标记
    check('uncraftable recipes are dimmed, not hidden', cells.some((cell) => cell.classList.contains('locked')) && cells.some((cell) => cell.classList.contains('on')));
    check('the book has one line telling what a cell is', !!document.querySelector('.recipe-detail'));

    // 火把是最好核对的一条：煤炭在上、木棍在下（2×2）
    const search = document.querySelector('.recipe-search');
    search.value = 'torch';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    const torch = document.querySelector(`.recipe-cell[data-result-id="${Block.TORCH}"]`);
    check('the torch recipe shows up in the grid', !!torch);
    if (torch) {
      const title = torch.getAttribute('title') ?? '';
      check('a cell names the recipe and its result count', title.includes('火把') && title.includes('×4'), title.slice(0, 40));
      check('a cell still tells how to place it', title.includes('第 1 行'), title.slice(0, 60));
    }

    // 无序配方：摆哪一格都行（这句话得留在说明里，网格本身不画摆法）
    search.value = 'planks';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    const loose = [...document.querySelectorAll('.recipe-cell')].find((cell) => (cell.getAttribute('title') ?? '').includes('无序'));
    check('shapeless recipes say "placement does not matter"', !!loose, 'no shapeless note');

    // 分页：181 条配方不能一次全塞进 DOM
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    const pager = document.querySelector('#recipe-book .inv-pager');
    check('recipe book has a pager', !!pager && !pager.classList.contains('hidden'), pager?.textContent ?? 'missing');
    const before = document.querySelector('.recipe-cell')?.dataset.resultId ?? '';
    pager?.querySelector('[data-role="next"]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 9202, pointerType: 'touch' }));
    await sleep(200);
    const after = document.querySelector('.recipe-cell')?.dataset.resultId ?? '';
    check('paging really changes the recipes', before.length > 0 && after.length > 0 && before !== after, `${before} -> ${after}`);

    document.querySelector('.recipe-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(150);
  }

  // ---------------------------------------------------------------- 4. 整体适配
  const overflow = document.documentElement.scrollWidth - window.innerWidth;
  check('no horizontal overflow', overflow <= 1, `scrollWidth ${document.documentElement.scrollWidth} vs ${window.innerWidth}`);
  check('viewport is recorded for the report', true, `${window.innerWidth}x${window.innerHeight} dpr ${window.devicePixelRatio}`);

  mc.toggleInventory();
  await sleep(200);

  // 按键/手势说明（批次 111 从"开始遮罩"搬到了暂停菜单底部）：触屏上要显示手势、
  // 藏掉键盘对照表（手机没有那些键）
  mc.openSettings();
  await sleep(200);
  const desktopHelp = document.querySelector('.pause-help .desktop-only');
  const touchHelp = document.querySelector('.pause-help .touch-only');
  check('touch devices get gesture help, not keyboard hints', !!touchHelp && !!desktopHelp && getComputedStyle(touchHelp).display !== 'none' && getComputedStyle(desktopHelp).display === 'none',
    `touch-help ${touchHelp ? getComputedStyle(touchHelp).display : 'missing'} | keyboard-help ${desktopHelp ? getComputedStyle(desktopHelp).display : 'missing'}`);
  // 关掉暂停菜单，回到"世界还在跑"的状态（后面的断言依赖它）
  mc.closeSettings();
  await sleep(120);

  return lines.join('\n');
})();
