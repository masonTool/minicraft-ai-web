/**
 * 角色形象验收（批次 333）
 *
 * 用法（dev server 已跑、playwright-cli 已用 --mobile 打开并设成横屏视口）：
 *   sh tools/appearance-check.sh
 * 或：
 *   playwright-cli eval "eval(new TextDecoder().decode(Uint8Array.from(atob('$(base64 -i tools/appearance-acceptance.js | tr -d '\n')'), (c) => c.charCodeAt(0))))"
 *
 * 覆盖的是"设置里能看到 3D 形象、改完立刻生效"这一整条链路：
 *  1. 外观页有 3D 画布，且**只展示原始角色**（不穿盔甲、不拿盾牌）
 *  2. 四颗预设（成年男性/成年女性/少年男性/少年女性）能点选、能反查高亮
 *  3. 换预设后设置值、模型眼型/体型、画布像素三者一起变（立刻生效）
 *  4. 手动改任一项 → 预设全部取消高亮（自定义）
 *  5. 「全身 / 面部」两档视角与拖动旋转
 *
 * 只读私有字段（`settingsScreen.avatar` / `avatar.model` / `avatar.renderer`）——
 * dev server 不做压缩，验收脚本可以拿它们当"内部状态探针"。
 */
(async function appearanceAcceptance() {
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await sleep(250);
    }
    return predicate();
  };

  // ---------------------------------------------------------------- 0. 进入世界
  if (typeof window.__mc === 'undefined') {
    document.querySelector('#world-screen .world-primary')?.click();
    const firstSave = document.querySelector('#world-list .world-enter');
    if (firstSave) firstSave.click();
    else {
      document.getElementById('world-new-button')?.click();
      document.getElementById('world-create-button')?.click();
    }
    const started = await waitFor(() => typeof window.__mc !== 'undefined', 90000);
    if (!started) return '[FAIL] game did not start (window.__mc missing)';
  }
  const mc = window.__mc;
  await waitFor(() => mc.info.chunks > 0, 30000);
  mc.enableTouchControls();
  await sleep(300);
  document.getElementById('rotate-hint')?.remove();

  // ---------------------------------------------------------------- 1. 打开设置 → 外观
  if (!mc.settingsState.open) mc.openSettings();
  await sleep(200);
  const panel = document.getElementById('settings-screen');
  check('暂停菜单能打开', mc.settingsState.open === true && !!panel && !panel.classList.contains('hidden'));
  document.getElementById('pause-settings')?.click();
  await sleep(250);
  const settingsPage = panel?.querySelector(".pause-page[data-page='settings']");
  check('能进入设置页', !!settingsPage && settingsPage.classList.contains('active'));
  document.querySelector('.settings-tab[data-group="appearance"]')?.click();
  await sleep(300);

  const section = panel?.querySelector(".settings-section[data-group='appearance']");
  const canvas = section?.querySelector('canvas.appearance-avatar');
  const hero = section?.querySelector('.appearance-hero');
  const stage = section?.querySelector('.appearance-stage');
  const fields = section?.querySelector('.appearance-fields');
  const avatars = [...(section?.querySelectorAll('.appearance-preset') ?? [])];
  check('外观页有「左形象 + 右控件」布局', !!hero && !!canvas && !!(stage || fields) && !!fields);
  check(
    '形象画布有实际尺寸',
    !!canvas && canvas.clientWidth > 40 && canvas.clientHeight > 80,
    canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : '没有画布',
  );

  const avatar = mc.settingsScreen?.avatar;
  check('3D 形象实例已创建（WebGL 可用）', !!avatar);
  if (!avatar) return lines.join('\n');
  const model = avatar.model;

  // ---------------------------------------------------------------- 2. 只展示原始角色
  const visibleArmor = model.armorPlates.filter((mesh) => mesh.visible);
  check('设置页不显示盔甲（四件套都不可见）', visibleArmor.length === 0, `${visibleArmor.length} 块可见`);
  check('设置页不显示副手盾牌', model.offhandVisible === false);
  check('默认是全身视角', avatar.currentFocus === 'full', avatar.currentFocus);

  // ---- 排版：横屏主场景下"形象在左、控件在右"，且面板与控件都不越界
  const layoutProbe = () => {
    const rect = section.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const fieldsRect = fields.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const rows = [...fields.querySelectorAll('.settings-row, .appearance-presets')];
    return {
      overflowX: section.scrollWidth > section.clientWidth + 1,
      rowsInside: rows.every((el) => {
        const b = el.getBoundingClientRect();
        return b.left >= rect.left - 1 && b.right <= rect.right + 1;
      }),
      sideBySide: stageRect.right <= fieldsRect.left + 1,
      panelInside:
        panelRect.top >= -1 &&
        panelRect.bottom <= innerHeight + 1 &&
        panelRect.left >= -1 &&
        panelRect.right <= innerWidth + 1,
      stage: `${Math.round(stageRect.width)}x${Math.round(stageRect.height)}`,
      fields: `${Math.round(fieldsRect.width)}`,
    };
  };
  const layout = layoutProbe();
  check('外观页没有横向溢出', !layout.overflowX, `section ${section.clientWidth}px`);
  check('所有外观控件都在内容区内（没有被右边界裁掉）', layout.rowsInside);
  check('横屏：形象在左、控件在右', layout.sideBySide, `stage ${layout.stage} / fields ${layout.fields}`);
  check('设置面板完整落在视口内', layout.panelInside, `${innerWidth}x${innerHeight}`);

  // ---------------------------------------------------------------- 3. 画布像素探针
  // WebGL 默认 preserveDrawingBuffer=false：必须**先 render、同一个任务里 readPixels**。
  const pixelStats = () => {
    avatar.render();
    const gl = avatar.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let count = 0;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    let hash = 0;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        if (buf[i + 3] < 8) continue;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        hash = (hash * 31 + buf[i] * 3 + buf[i + 1] * 5 + buf[i + 2] * 7) | 0;
      }
    }
    return { w, h, count, hash, bboxW: maxX - Math.min(minX, maxX), bboxH: maxY - Math.min(minY, maxY) };
  };

  const fullPixels = pixelStats();
  check('形象真的画出来了（有非透明像素）', fullPixels.count > 500, `${fullPixels.count} 采样点 / ${fullPixels.w}x${fullPixels.h}`);
  check(
    '全身视角里角色占够高度',
    fullPixels.bboxH > fullPixels.h * 0.45,
    `bbox ${fullPixels.bboxW}x${fullPixels.bboxH} / 画布 ${fullPixels.w}x${fullPixels.h}`,
  );

  // ---------------------------------------------------------------- 4. 四颗预设
  const labels = avatars.map((button) => button.textContent ?? '');
  check(
    '四个预设：成年男性 / 成年女性 / 少年男性 / 少年女性',
    labels.join('|') === '成年男性|成年女性|少年男性|少年女性',
    labels.join(' / '),
  );
  const activePreset = () => document.querySelector('.appearance-preset.active')?.textContent ?? '';
  const clickPreset = async (id) => {
    document.querySelector(`.appearance-preset[data-preset="${id}"]`)?.click();
    await sleep(350);
  };

  // 先回到成年男性，给"成人 vs 少年"的比较一个确定的基准（上一次会话可能停在别的预设）
  await clickPreset('man');
  const man = mc.settingsState.settings;
  check(
    '成年男性：短发 + 胡茬 + 沉稳眼',
    man.hairStyle === 0 && man.beard === 1 && man.eyes === 0,
    `hair=${man.hairStyle} beard=${man.beard} eyes=${man.eyes}`,
  );
  check('预设高亮切到成年男性', activePreset().includes('成年男性'), activePreset() || '(无)');
  const adultBody = { ...model.bodyMetrics };
  const manPixels = pixelStats();

  await clickPreset('woman');
  const woman = mc.settingsState.settings;
  check(
    '成年女性：长发 + 无胡须 + 明亮眼 + 纤细',
    woman.hairStyle === 1 && woman.beard === 0 && woman.eyes === 1 && woman.frame === 1,
    `hair=${woman.hairStyle} beard=${woman.beard} eyes=${woman.eyes} frame=${woman.frame}`,
  );
  check('预设高亮切到成年女性', activePreset().includes('成年女性'), activePreset() || '(无)');
  check(
    '形象同步：眼型 = 明亮，且睫毛出现',
    avatar.palette.eyes === 'bright' && model.eyeMetrics.lash === true,
    `${avatar.palette.eyes} / lash=${model.eyeMetrics.lash}`,
  );
  const womanPixels = pixelStats();
  check('换预设后画布重绘（像素发生变化）', womanPixels.hash !== manPixels.hash, `${manPixels.hash} -> ${womanPixels.hash}`);

  await clickPreset('boy');
  const boy = mc.settingsState.settings;
  check(
    '少年男性：翘发 + 圆眼 + 少年体型',
    boy.hairStyle === 5 && boy.eyes === 2 && boy.build === 1,
    `hair=${boy.hairStyle} eyes=${boy.eyes} build=${boy.build}`,
  );
  const teenBody = { ...model.bodyMetrics };
  check(
    '形象同步：圆眼 + 少年体型；四肢比成年更细',
    model.eyeMetrics.style === 'round' && teenBody.build === 'teen' && teenBody.limb < adultBody.limb,
    `${model.eyeMetrics.style} / limb ${adultBody.limb.toFixed(3)} -> ${teenBody.limb.toFixed(3)}`,
  );
  check('预设高亮切到少年男性', activePreset().includes('少年男性'), activePreset() || '(无)');

  await clickPreset('girl');
  const girl = mc.settingsState.settings;
  check(
    '少年女性：马尾 + 无胡须 + 明亮眼 + 蓝瞳',
    girl.hairStyle === 2 && girl.beard === 0 && girl.eyes === 1 && girl.eyeColor === 1 && girl.build === 1,
    `hair=${girl.hairStyle} eyes=${girl.eyes} eyeColor=${girl.eyeColor}`,
  );
  check(
    '形象同步：少女瞳孔换色且为明亮眼型',
    avatar.palette.eye !== 0x3a2a1e && avatar.palette.eyes === 'bright',
    `eye=${avatar.palette.eye.toString(16)}`,
  );

  // ---------------------------------------------------------------- 5. 手动改 → 自定义 + 立刻生效
  const rowByLabel = (label) =>
    [...section.querySelectorAll('.appearance-fields .settings-row')].find(
      (row) => row.querySelector('span')?.textContent === label,
    );
  // 批次 334：多选项改成"下拉按钮"——先展开菜单，再点一个不是当前的选项
  const chooseNext = async (label) => {
    const row = rowByLabel(label);
    const button = row?.querySelector('.settings-dropdown-button');
    if (!button) return;
    button.click();
    await sleep(120);
    const menu = [...document.querySelectorAll('.settings-dropdown-menu')].find(
      (m) => m.style.display !== 'none' && m.style.display !== '',
    );
    const option = [...(menu?.querySelectorAll('.settings-dropdown-option') ?? [])].find(
      (o) => !o.classList.contains('selected'),
    );
    option?.click();
    await sleep(300);
  };

  const hairBefore = mc.settingsState.settings.hairStyle;
  await chooseNext('发型');
  const hairAfter = mc.settingsState.settings.hairStyle;
  check('通过下拉改「发型」立刻写回设置', hairAfter !== hairBefore, `${hairBefore} -> ${hairAfter}`);
  check('手动改任一项后四颗预设都不高亮（自定义）', activePreset() === '', activePreset() || '(自定义)');
  const hairNames = ['short', 'long', 'ponytail', 'bald', 'bob', 'messy'];
  check(
    '手动改发型后形象同步',
    avatar.palette.hairStyle === hairNames[hairAfter],
    `${avatar.palette.hairStyle} / index ${hairAfter}`,
  );

  const eyeBefore = model.eyeMetrics.style;
  await chooseNext('眼型');
  check(
    '点「眼型」立刻作用到模型（眼白/睫毛/眉毛一起变）',
    model.eyeMetrics.style !== eyeBefore,
    `${eyeBefore} -> ${model.eyeMetrics.style}`,
  );

  // ---------------------------------------------------------------- 6. 全身 / 面部视角
  document.querySelector('.appearance-focus-button[data-focus="face"]')?.click();
  await sleep(300);
  check(
    '「面部」视角生效（相机推到头部）',
    avatar.currentFocus === 'face' && avatar.camera.fov === 26,
    `${avatar.currentFocus} / fov=${avatar.camera.fov}`,
  );
  check(
    '「面部」按钮高亮',
    document.querySelector('.appearance-focus-button[data-focus="face"]')?.classList.contains('active') === true,
  );
  const facePixels = pixelStats();
  check('面部视角画面有内容', facePixels.count > 300, `${facePixels.count} 采样点`);

  document.querySelector('.appearance-focus-button[data-focus="full"]')?.click();
  await sleep(250);
  check(
    '切回全身视角',
    avatar.currentFocus === 'full' && avatar.camera.fov === 30,
    `${avatar.currentFocus} / fov=${avatar.camera.fov}`,
  );

  // ---------------------------------------------------------------- 7. 拖动旋转
  const yawBefore = avatar.yaw;
  const realCapture = canvas.setPointerCapture;
  canvas.setPointerCapture = () => {};
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: 20, clientY: 20, bubbles: true }));
  canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 70, clientY: 20, bubbles: true }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 70, clientY: 20, bubbles: true }));
  canvas.setPointerCapture = realCapture;
  await sleep(100);
  check('拖动画布能旋转形象', Math.abs(avatar.yaw - yawBefore) > 0.2, `${yawBefore.toFixed(2)} -> ${avatar.yaw.toFixed(2)}`);

  // 保持设置页打开：调用方可能还要切视口复查排版，或在页面上截图。
  return lines.join('\n');
})();
