/**
 * 界面适配离线断言（批次 26：物品分页 / 图标按钮 / 整体适配）
 *
 * 界面大多要靠浏览器看，但有三块**能离线钉死**，而且正是最容易悄悄退化的地方：
 *  1. **分页数学**（`ui/ItemPager.ts`）：页大小、页数、页码夹取、切片、文案——
 *     纯函数，边界（0 件、只有一页、页码越界、转屏后页大小变化）都能算清楚
 *  2. **图标集**（`ui/TouchIcons.ts`）：六个图标都必须是合法且互不相同的 SVG，
 *     否则按钮会变成空白（"点了没反应"里最难查的一种）
 *  3. **HTML 外壳里的关键规则**（`index.html`）：安全区、竖屏断点、分页样式、
 *     触屏/桌面两套开始提示、图标尺寸——CSS 被误删时这里会红，而不是等玩家发现
 *
 * 运行：npm run test:ui
 */

import { readFileSync } from 'node:fs';
import { UnsupportedScreen } from '../src/ui/UnsupportedScreen.ts';
import {
  CARD_PAGE_SIZE_NARROW,
  CARD_PAGE_SIZE_WIDE,
  NARROW_MAX_WIDTH,
  PAGE_SIZE_NARROW,
  PAGE_SIZE_WIDE,
  cardPageSizeFor,
  clampPage,
  isNarrowViewport,
  pageCount,
  pageLabel,
  pageSizeFor,
  slicePage,
} from '../src/ui/ItemPager.ts';
import { TOUCH_ICON_LABELS, TOUCH_ICON_NAMES, touchIconSvg } from '../src/ui/TouchIcons.ts';
import { iconBackingScale } from '../src/ui/ItemIcon.ts';
import { TOUCH_TOOLTIP_MS } from '../src/ui/Tooltip.ts';
import { TOUCH_LONG_PRESS_MS } from '../src/ui/InventoryScreen.ts';
import { BackButton } from '../src/ui/BackButton.ts';
import { STICK_MODES, STICK_MODE_LABELS, isTouchUi } from '../src/ui/TouchControls.ts';
import {
  DEFAULT_SETTINGS,
  SETTING_GROUP_LABELS,
  SETTING_GROUPS,
  TOUCH_SCALE_MAX,
  TOUCH_SCALE_MIN,
  loadSettings,
} from '../src/ui/SettingsScreen.ts';
import { CREATIVE_TAB_ICONS, missingTabIcons } from '../src/ui/CreativeTabs.ts';
import { armAutoFullscreen, isFullscreen } from '../src/ui/Fullscreen.ts';
import { ITEM_CATEGORIES, itemDef, itemIconTile } from '../src/core/registry/items.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

// ---------------------------------------------------------------- 1. 分页数学

console.log('\n[物品分页：页大小与页数]');
{
  equal('宽屏每页 60（12 列 × 5 行）', PAGE_SIZE_WIDE, 60);
  equal('窄屏每页 32（8 列 × 4 行）', PAGE_SIZE_NARROW, 32);
  equal('窄屏阈值与 CSS 的媒体查询同一个数（900）', NARROW_MAX_WIDTH, 900);

  check('900 算窄屏', isNarrowViewport(900));
  check('901 不算窄屏', !isNarrowViewport(901));
  equal('手机竖屏（390）走窄屏页大小', pageSizeFor(390), PAGE_SIZE_NARROW);
  equal('桌面（1440）走宽屏页大小', pageSizeFor(1440), PAGE_SIZE_WIDE);

  // 创造物品栏"全部"分类的真实规模：495 件
  const TOTAL = 495;
  equal('495 件按宽屏分页 = 9 页', pageCount(TOTAL, PAGE_SIZE_WIDE), 9);
  equal('495 件按窄屏分页 = 16 页', pageCount(TOTAL, PAGE_SIZE_NARROW), 16);
  equal('正好整除时不多出一页', pageCount(120, 60), 2);
  equal('空列表也算 1 页（文案才说人话）', pageCount(0, 60), 1);
  equal('只有一件也是 1 页', pageCount(1, 60), 1);
}

console.log('\n[物品分页：页码夹取与切片]');
{
  equal('页码越界（太大）夹到最后一页', clampPage(99, 495, 60), 8);
  equal('页码为负夹到第 1 页', clampPage(-3, 495, 60), 0);
  equal('NaN 也当成第 1 页', clampPage(Number.NaN, 495, 60), 0);
  equal('小数页码向下取整', clampPage(2.9, 495, 60), 2);
  equal('空列表时页码只能是 0', clampPage(5, 0, 60), 0);

  const items = Array.from({ length: 495 }, (_, index) => index);
  equal('第 1 页 60 件', slicePage(items, 0, 60).length, 60);
  equal('第 1 页第一件是 0 号', slicePage(items, 0, 60)[0], 0);
  equal('第 2 页第一件是 60 号', slicePage(items, 1, 60)[0], 60);
  equal('最后一页只有 15 件（495 - 480）', slicePage(items, 8, 60).length, 15);
  equal('最后一页最后一件是 494 号', slicePage(items, 8, 60).at(-1), 494);
  equal('越界的页码拿到的仍是最后一页（不会空）', slicePage(items, 99, 60).length, 15);
  equal('窄屏最后一页 15 件（495 - 480）', slicePage(items, 15, 32).length, 15);

  equal('页码文案：第 1 页', pageLabel(0, 495, 60), '第 1/9 页 · 共 495 件');
  equal('页码文案：第 9 页', pageLabel(8, 495, 60), '第 9/9 页 · 共 495 件');
  equal('页码文案：越界时也自洽', pageLabel(50, 495, 60), '第 9/9 页 · 共 495 件');
  equal('页码文案：空列表', pageLabel(0, 0, 60), '第 1/1 页 · 共 0 件');

  // 卡片列表（配方书）的页大小：卡片比格子高，所以单独定一套
  equal('宽屏每页 18 张卡片', CARD_PAGE_SIZE_WIDE, 18);
  equal('窄屏每页 8 张卡片', CARD_PAGE_SIZE_NARROW, 8);
  equal('窄屏走小页', cardPageSizeFor(430), CARD_PAGE_SIZE_NARROW);
  equal('宽屏走大页', cardPageSizeFor(1440), CARD_PAGE_SIZE_WIDE);
  equal('181 条配方按宽屏分页 = 11 页', pageCount(181, CARD_PAGE_SIZE_WIDE), 11);
  equal('181 条配方按窄屏分页 = 23 页', pageCount(181, CARD_PAGE_SIZE_NARROW), 23);
  equal('最后一页只放 1 张（181 - 180）', slicePage(Array.from({ length: 181 }), 10, CARD_PAGE_SIZE_WIDE).length, 1);
}

// ---------------------------------------------------------------- 2. 图标集

console.log('\n[触摸按钮图标]');
{
  // 批次 107：右下那一簇精简成"潜行 + 跳跃"，背包/聊天搬到快捷栏两侧
  //（`view`/`fly` 两个图标随之作废：视角与"创造飞行"都搬进了设置面板）
  equal('五个图标（右下两颗 + 快捷栏两侧两颗 + 顶部暂停）', TOUCH_ICON_NAMES.length, 5);
  for (const name of ['chat', 'sneak', 'inventory', 'jump', 'pause'] as const) {
    check(`图标集里有 ${name}`, TOUCH_ICON_NAMES.includes(name));
  }

  const svgs = new Set<string>();
  for (const name of TOUCH_ICON_NAMES) {
    const svg = touchIconSvg(name);
    check(`${name} 是合法 SVG（有 viewBox 与闭合标签）`, svg.startsWith('<svg') && svg.includes('viewBox="0 0 24 24"') && svg.endsWith('</svg>'));
    check(`${name} 至少画了一条路径`, svg.includes('<path') || svg.includes('<rect'));
    check(`${name} 用 currentColor（颜色交给 CSS）`, svg.includes('currentColor') || svg.includes('opacity'), '填充色应与按钮文字同色');
    check(`${name} 有中文说明（aria-label 用）`, (TOUCH_ICON_LABELS[name] ?? '').length > 0);
    svgs.add(svg);
  }
  equal('图标互不相同（不会有两个按钮长一样）', svgs.size, TOUCH_ICON_NAMES.length);
}

// ---------------------------------------------------------------- 2.5 手机端操作界面

console.log('\n[手机端操作界面（批次 104）：暂停键 / 去键盘化 / 设置分页]');
{
  // ---- ① 手机端"设置/暂停"必须有入口（原来只有 PC 的 Esc，手机上打不开）
  check('图标集里有 pause（顶部暂停键）', TOUCH_ICON_NAMES.includes('pause'));
  check('pause 有中文说明（aria-label 用）', (TOUCH_ICON_LABELS.pause ?? '').length > 0);

  // ---- ② 触摸判据只有一处：`isTouchUi()` 读的是 <body class="touch-mode">
  //      （构造在触摸层**之前**的面板也要拿到正确答案，所以它同时兜底 `isTouchDevice()`）
  {
    const globals = globalThis as unknown as { document?: unknown };
    const hadDocument = 'document' in globals;
    const previousDocument = globals.document;
    globals.document = { body: { classList: { contains: (name: string) => name === 'touch-mode' } } };
    check('body.touch-mode 时 isTouchUi() 为真', isTouchUi());
    globals.document = { body: { classList: { contains: () => false } } };
    check('没有标记、又不在触摸设备上时为假', !isTouchUi());
    if (hadDocument) globals.document = previousDocument;
    else delete globals.document;
  }

  // ---- ③ 设置分组：页签与 section 一一对应（漏一组 = 有一页设置永远看不到）
  equal('四个分组（图形/操作/声音/游戏）', SETTING_GROUPS.length, 4);
  check('每个分组都有中文名', SETTING_GROUPS.every((group) => (SETTING_GROUP_LABELS[group] ?? '').length > 0));
  equal('分组名不重复', new Set(SETTING_GROUPS.map((group) => SETTING_GROUP_LABELS[group])).size, SETTING_GROUPS.length);

  // ---- ④ CSS 守卫（少哪一条就是哪一种"半手机半桌面"的怪界面）
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');
  for (const [label, needle] of [
    ['顶部暂停键容器', '#touch-pause {'],
    ['暂停键尺寸吃 --touch-scale（与"触摸按钮大小"同一个设置项）', '#touch-pause .touch-button { width: calc(52px * var(--touch-scale, 1));'],
    // 手机端设置面板（批次 107 改成紧凑卡片，见 index.html 里那一段的说明）
    ['手机端设置面板是紧凑卡片（不再占满全屏）', 'body.touch-mode .settings-panel { width: min(96vw, 520px); max-width: 520px; height: auto; max-height: min(92vh, 760px);'],
    ['手机端四组设置一次全显示', 'body.touch-mode .settings-section { display: flex; }'],
    ['动作按钮钉在设置之前（"继续游戏"不必滚）', 'body.touch-mode .settings-buttons { order: 1;'],
    ['矮屏才退回分组页签', 'body.touch-mode .settings-tabs { display: flex; flex: 0 0 auto; padding: 0 0 8px; }'],
    ['手机端不显示快捷栏序号（没有数字键）', 'body.touch-mode #hotbar .slot .index { display: none; }'],
  ] as const) {
    check(`index.html 里有"${label}"`, compact.includes(needle), needle);
  }

  // ---- ⑤ 手机端不能出现键盘字母（用户直接提的一条：关界面用 ✕，不是字母 R）
  const recipeBook = readFileSync(new URL('../src/ui/RecipeBook.ts', import.meta.url), 'utf8');
  const inventory = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/ui/SettingsScreen.ts', import.meta.url), 'utf8');
  check('配方书的关闭键在手机上是 ✕（PC 才写 "关闭 (R)"）', recipeBook.includes("isTouchUi() ? '✕' : '关闭 (R)'"));
  check('背包标题栏不在手机上说 "配方书 (R)"', inventory.includes("touchDevice ? '配方书' : '配方书 (R)'"));
  check('设置面板的副标题在手机上不提 Esc', settings.includes("isTouchUi() ? '改动立即生效"));
}

// ---------------------------------------------------------------- 3. HTML 外壳

console.log('\n[index.html：手机端与 PC 端的布局规则]');
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');

  // 安全区：底部贴边的 HUD 必须让开"home 横条"
  const safeAreaCount = (html.match(/env\(safe-area-inset-bottom/g) ?? []).length;
  check(`底部安全区规则至少 4 处（实测 ${safeAreaCount}）`, safeAreaCount >= 4, '快捷栏/经验条/状态条/聊天');

  for (const [label, needle] of [
    ['分页条', '.inv-pager'],
    ['翻页键', '.inv-page-button'],
    ['页码文案', '.inv-page-label'],
    ['聊天发送键', '.chat-send'],
    ['触摸按钮的图标尺寸', '.touch-button svg'],
    ['触屏提示只在触屏显示', 'body.touch-mode .touch-only'],
    ['桌面键盘提示在触屏隐藏', 'body.touch-mode .desktop-only'],
    ['竖屏断点', '@media (orientation: portrait)'],
    ['窄屏分类标签单行滚动', 'flex-wrap: nowrap'],
    // 尺寸都走 `--touch-scale`（批次 98）：默认 1× 下与写死像素完全一致
    // 右下那一簇（批次 107）：一列右对齐，跳跃在下
    ['右下按钮簇是一列右对齐', '#touch-buttons { position: absolute; right: 20px; bottom: 96px;'],
    // 快捷栏两侧的背包/聊天：挂进 #hotbar 内并绝对定位（不参与那 9 格的宽度计算）
    ['背包/聊天按钮挂进快捷栏', '#hotbar .touch-side-btn { position: absolute; bottom: calc(100% + 4px);'],
    ['屏幕够宽时背包摆快捷栏右侧', '#touch-hotbar-inventory { right: auto; left: calc(100% + 8px); }'],
    ['聊天摆快捷栏左侧', '#touch-hotbar-chat { left: auto; right: calc(100% + 8px); }'],
    // 切石机（H11，批次 44）：候选列表与候选按钮的样式被误删时这里会红
    ['切石机候选列表', '.stonecutter-list'],
    ['切石机候选按钮', '.stonecutter-option'],
    // 营火（批次 47）：4 格 + 每格自己的进度条
    ['营火格子排布', '.campfire-grid'],
    ['营火进度条', '.campfire-cook'],
  ] as const) {
    // 用压过空白的版本比对：断言里可以跨行引用一整段规则，不用把换行也抄进来
    check(`index.html 里有"${label}"`, compact.includes(needle), needle);
  }

  // 开始遮罩：两套提示都要在（按设备切换）
  check('开始遮罩同时有键盘提示与手势提示', html.includes('overlay-help desktop-only') && html.includes('overlay-help touch-only'));
  check('开始遮罩上有一个"进入游戏"按钮样式', html.includes('.overlay-go'));
  // 触屏提示里不能再出现 <kbd>（手机上没有键盘）
  const touchBlock = /<div class="overlay-help touch-only">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  check('触屏提示里没有键盘按键', touchBlock.length > 0 && !touchBlock.includes('<kbd>'), touchBlock.slice(0, 40));
}

console.log('\n[手机端物品显示与提示（批次 95 体检）]');
{
  // ---- ① 图标在高分屏上要清晰：背板按 DPR 放大（1~2 倍）
  equal('DPR 1 → 1 倍（桌面不变）', iconBackingScale(1), 1);
  equal('DPR 1.5 → 2 倍', iconBackingScale(1.5), 2);
  equal('DPR 2 → 2 倍', iconBackingScale(2), 2);
  equal('DPR 3 → 仍夹到 2 倍（图集一格只有 16px，再高只是更大更糊）', iconBackingScale(3), 2);
  equal('DPR 0.5 / NaN / 0 → 1 倍（异常输入不吃亏）', `${iconBackingScale(0.5)},${iconBackingScale(Number.NaN)},${iconBackingScale(0)}`, '1,1,1');

  // ---- ② 触摸端的"长按看详情"阈值必须**长于**长按右键，否则同一个手势会互相打架
  check(
    `看详情（${TOUCH_TOOLTIP_MS}ms）比长按右键（${TOUCH_LONG_PRESS_MS}ms）晚一步`,
    TOUCH_TOOLTIP_MS > TOUCH_LONG_PRESS_MS,
    `${TOUCH_TOOLTIP_MS} vs ${TOUCH_LONG_PRESS_MS}`,
  );
  check('但也不能长到"按不出来"（≤ 1200ms）', TOUCH_TOOLTIP_MS <= 1200, String(TOUCH_TOOLTIP_MS));

  // ---- ③ CSS：触摸端的快捷栏必须可点、槽位够大、物品名浮标在
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');
  for (const [label, needle] of [
    // ⚠️ 这一条是这次体检的核心：`#hud` 是 pointer-events: none，不显式打开的话
    // 点快捷栏的手势会落到铺满全屏的视角面上（= 在身后挖方块），切槽永远点不动
    ['快捷栏可点（命中打开）', '#hotbar { pointer-events: auto; z-index: 1; }'],
    ['触摸端槽位按下有反馈', 'body.touch-mode #hotbar .slot:active'],
    ['触摸端槽位放大到 44px（平台最小手势尺寸）', '#hotbar .slot { width: 44px; height: 44px; }'],
    ['选中物品名浮标', '#selected-item-name'],
    ['物品名浮标有显示态', '#selected-item-name.show'],
  ] as const) {
    check(`index.html 里有"${label}"`, compact.includes(needle), needle);
  }
  // 浮标只是提示，不能抢手势（它在 HUD 里本来就不吃事件；写显式一点，免得以后挪位置踩坑）
  const nameRule = /#selected-item-name \{([^}]*)\}/.exec(compact)?.[1] ?? '';
  check('物品名浮标不吃手势（pointer-events: none）', nameRule.includes('pointer-events: none'), nameRule.slice(0, 60));
  check('物品名浮标贴在快捷栏上方（用了底部安全区）', nameRule.includes('safe-area-inset-bottom'));
}

console.log('\n[返回键守卫（批次 96）：返回先关界面、界面全关完才轮到浏览器]');
{
  /** 一个可断言的假浏览器：`history` 只有"压一条/退一格"两个动作 */
  function makeHarness(panels: number) {
    let open = panels;
    const log: string[] = [];
    const back = new BackButton({
      pushState: () => log.push('push'),
      back: () => log.push('back'),
      closeTopUi: () => {
        log.push('close');
        open = Math.max(0, open - 1);
        return open > 0;
      },
    });
    return { back, log, state: () => open };
  }

  // ① 打开界面 → 压一条历史；界面自己关掉 → 把那条历史收回去（不留"假条目"）
  const one = makeHarness(1);
  one.back.sync(true);
  equal('打开界面时压一条历史', one.log.join(','), 'push');
  one.back.sync(true);
  equal('保持开着不再压（不会攒一堆）', one.log.join(','), 'push');
  one.back.sync(false);
  equal('界面关掉时把历史收回去', one.log.join(','), 'push,back');
  equal('守卫撤掉', String(one.back.isGuarded), 'false');

  // ② 按返回 → 关掉最上面那一层；还有别的层就继续守着
  const two = makeHarness(2);
  two.back.sync(true);
  two.back.onBrowserBack();
  equal('有界面时按返回：关一层、下面还有就重新守着', two.log.join(','), 'push,close,push');
  equal('守卫还在', String(two.back.isGuarded), 'true');
  two.back.onBrowserBack();
  equal('再按返回：关最后一层', two.log.join(','), 'push,close,push,close');
  equal('全关完 → 守卫撤掉（下一次返回交给浏览器）', String(two.back.isGuarded), 'false');

  // ③ 没界面时按返回 → 什么都不做（= 让浏览器退出页面）
  const none = makeHarness(0);
  none.back.onBrowserBack();
  equal('没界面时不拦返回', none.log.join(','), '');

  // ④ 玩家自己关完界面之后，历史里不该留下"按好几下才退得出去"的假条目
  const manual = makeHarness(1);
  manual.back.sync(true);
  manual.back.sync(false);
  const before = manual.log.length;
  manual.back.onBrowserBack();
  equal('关完之后的返回交给浏览器（我们不再插手）', manual.log.length, before);
}

console.log('\n[动态摇杆与飞行提示（批次 96）]');
{
  equal('摇杆两档（与基岩版一致）', STICK_MODES.join(','), 'fixed,dynamic');
  check('两档都有中文名', STICK_MODES.every((mode) => STICK_MODE_LABELS[mode].length > 0));
  equal('默认固定（肌肉记忆优先）', DEFAULT_SETTINGS.touchStick, 'fixed');
  equal('按钮大小默认 1×（不改任何既有尺寸）', DEFAULT_SETTINGS.touchScale, 1);
  // ⚠️ 触摸相关的每一处尺寸都必须乘 `--touch-scale`：竖屏/横屏那两段媒体查询里
  // 原来写死了像素值（同优先级、后出现 → 会盖掉带变量的那条），
  // 于是"触摸按钮大小"在手机上等于没接线（拉滑块毫无反应）。这条断言盯的就是它
  {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const blocks = [...html.matchAll(/(#touch-stick[^{]*|#touch-buttons|.touch-button\.[a-z]+|.touch-button)\s*\{([^}]*)\}/g)];
    const offenders: string[] = [];
    for (const [, selector, body] of blocks) {
      for (const line of (body ?? '').split(';')) {
        if (!/(width|height|grid-template-columns|gap)\s*:/.test(line)) continue;
        if (line.includes('var(--touch-scale')) continue;
        offenders.push(`${selector!.trim()}: ${line.trim()}`);
      }
    }
    check('触摸按钮/摇杆的尺寸全部吃 --touch-scale', offenders.length === 0, offenders.join(' | '));
  }
  check(
    `按钮大小可调范围合理（${TOUCH_SCALE_MIN}~${TOUCH_SCALE_MAX}）`,
    TOUCH_SCALE_MIN >= 0.8 && TOUCH_SCALE_MAX <= 1.5 && TOUCH_SCALE_MIN < DEFAULT_SETTINGS.touchScale,
    `${TOUCH_SCALE_MIN}~${TOUCH_SCALE_MAX}`,
  );

  // 设置项要能读回：动态模式必须**真的被存下来**（不然滑一下又回到固定）
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => void saved.set(key, value),
  };
  const globals = globalThis as unknown as { localStorage?: unknown; window?: unknown };
  const hadLocalStorage = 'localStorage' in globals;
  const previous = globals.localStorage;
  globals.localStorage = storage;
  storage.setItem('bedrock-settings', JSON.stringify({ touchStick: 'dynamic' }));
  equal('读回来是动态模式', loadSettings().touchStick, 'dynamic');
  storage.setItem('bedrock-settings', JSON.stringify({ touchStick: '胡说' }));
  equal('非法取值回退到默认', loadSettings().touchStick, DEFAULT_SETTINGS.touchStick);
  if (hadLocalStorage) globals.localStorage = previous;
  else delete globals.localStorage;

  // CSS：动态摇杆靠透明度隐藏（不能 display: none——那样量出来的矩形是 0），
  // 飞行提示用伪元素画（不往按钮里塞文字节点）
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');
  for (const [label, needle] of [
    ['动态摇杆平时隐形', '#touch-stick.dynamic { opacity: 0; }'],
    ['动态摇杆按下现身', '#touch-stick.dynamic.active { opacity: 1; }'],
    ['飞行时跳跃键画上升箭头', "#touch-ui.flying .touch-button.jump::after { content: '▲';"],
    ['飞行时潜行键画下降箭头', "#touch-ui.flying .touch-button[data-icon=\"sneak\"]::after { content: '▼';"],
    // 按钮大小（批次 97）：尺寸必须走 CSS 变量，否则设置里的滑块拖了没反应
    ['触摸按钮尺寸吃变量', '.touch-button { width: calc(62px * var(--touch-scale, 1));'],
    ['跳跃键尺寸吃变量', 'width: calc(76px * var(--touch-scale, 1));'],
    ['摇杆尺寸吃变量', 'width: calc(132px * var(--touch-scale, 1));'],
  ] as const) {
    check(`index.html 里有"${label}"`, compact.includes(needle), needle);
  }
}

console.log('\n[创造栏分类图标（批次 98，对齐基岩版的组织形式）]');
{
  equal('每个分类都配了图标（漏一个就是界面上一个空白标签）', missingTabIcons(ITEM_CATEGORIES).join(','), '');
  const categories = Object.keys(CREATIVE_TAB_ICONS) as (keyof typeof CREATIVE_TAB_ICONS)[];
  equal('图标表没有多余项（多一个说明分类被删了但图标没跟着删）', String(categories.length), String(ITEM_CATEGORIES.length));

  const tiles = new Set<string>(TILE_ORDER);
  const bad: string[] = [];
  for (const category of ITEM_CATEGORIES) {
    const itemId = CREATIVE_TAB_ICONS[category];
    // 图标必须是**真实存在的物品**，而且它那张贴图得在图集里（否则标签上是一片空白）
    if (!itemDef(itemId)) {
      bad.push(`${category}:物品不存在`);
      continue;
    }
    if (!tiles.has(itemIconTile(itemId))) bad.push(`${category}:贴图不在图集`);
  }
  check('图标的物品都存在、贴图都在图集里', bad.length === 0, bad.join(', '));

  // CSS：窄屏只留图标（十个分类一行放得下），宽屏图标 + 文字
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');
  for (const [label, needle] of [
    ['标签里有图标尺寸', '.inv-tab-icon { width: 18px; height: 18px; image-rendering: pixelated;'],
    ['标签是图标+文字横排', 'display: inline-flex; align-items: center; gap: 4px;'],
    ['窄屏只留图标', '.inv-tab-label { display: none; }'],
  ] as const) {
    check(`index.html 里有"${label}"`, compact.includes(needle), needle);
  }
}

console.log('\n[主页不能被"整屏层"盖住（批次 102，A10 的回归门禁）]');
{
  /**
   * 这一节是给一个**真出现过**的 bug 设的门禁。
   *
   * `UnsupportedScreen`（A10）这一层是 `position: fixed; inset: 0; z-index: 90` 的
   * **不透明**整屏底。原来的构造函数一上来就把它挂到 `<body>`，内容是空的；于是
   * **支持 WebGL2 的正常路径**上也会留下一个空层，压住主菜单（`#overlay` 的 z-index 只有 5）
   * ——**主页一打开全黑、点不动任何东西**。批次 85 潜伏到批次 102，中间所有离线断言
   * 都不看"谁盖在谁上面"，一条都没红。
   *
   * 两条判据（缺一不可）：
   *  ① **构造它不许碰 DOM**（这个测试跑在 Node 里，没有 `document`，碰了就会抛）；
   *  ② CSS 上那一层**默认不铺满**，只能靠 `.visible` 显式打开。
   * 真正的"看得见、点得到"由 `tools/ui-acceptance.js` 在浏览器里量（那是端到端的闸门）。
   */
  const parent = {
    appended: [] as unknown[],
    appendChild(node: unknown) {
      parent.appended.push(node);
      return node;
    },
  };
  let constructed = true;
  try {
    new UnsupportedScreen(parent as unknown as HTMLElement);
  } catch {
    constructed = false;
  }
  check('构造 UnsupportedScreen 不碰 DOM（Node 里没有 document，碰了就会抛）', constructed);
  equal('构造它不往父节点加任何东西（否则空层就上屏了）', String(parent.appended.length), '0');

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');
  check(
    '整屏提示层默认不显示（少一句 display: none，一个空层就能把主页盖黑）',
    compact.includes('.unsupported-screen { position: fixed; inset: 0; z-index: 90; display: none;'),
  );
  check(
    '整屏提示层要显式 .visible 才铺满',
    compact.includes('.unsupported-screen.visible { display: grid; }'),
  );
}

console.log('\n[触摸端按钮布局（批次 107，对齐基岩版）]');
{
  const source = readFileSync(new URL('../src/ui/TouchControls.ts', import.meta.url), 'utf8');
  // 右下那一簇只剩"潜行 + 跳跃"；背包/聊天挂到快捷栏两侧（挂进 #hotbar 内部并绝对定位）
  check('右下按钮簇只放潜行与跳跃', source.includes('buttons.append(this.sneakButton, jump);'));
  check('背包/聊天挂进快捷栏（不参与那 9 格的宽度计算）', source.includes("document.getElementById('hotbar')"));
  check('触摸层里不再有"飞行"按钮（已搬进设置面板）', !source.includes("makeIconButton('fly'"));
  check('触摸层里不再有"切换视角"按钮（已搬进设置面板）', !source.includes("makeIconButton('view'"));

  // 搬走之后必须**在设置里有对应入口**，否则这两项在手机上等于消失
  const settingsSource = readFileSync(new URL('../src/ui/SettingsScreen.ts', import.meta.url), 'utf8');
  check('设置面板补了"创造模式（飞行）"开关', settingsSource.includes("name.textContent = '创造模式'"));
  check('设置面板里的"视角"下拉还在', settingsSource.includes("this.makeSelect(controls, 'cameraMode', '视角'"));
  check(
    '飞行开关不写进 localStorage（它是世界里的状态，不是设备偏好）',
    !settingsSource.includes("key: 'flying'") && settingsSource.includes('private makeCreativeRow'),
  );
}

console.log('\n[像素风与"界面不许左右滑"（批次 108）]');
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');

  // ① 直角：令牌是唯一口径，逐条钉住（漏一条就会出现"面板直、按钮圆"的混搭）
  for (const token of ['--panel-radius: 0;', '--slot-radius: 0;', '--btn-radius: 0;', '--radius-sm: 0;', '--radius-md: 0;', '--radius-lg: 0;']) {
    check(`圆角令牌压平：${token}`, compact.includes(token));
  }
  // ② 像素斜角：四边颜色的令牌 + 三个使用点（浅色面板 / 深色面板 / 深色底上的按钮）
  check(
    '定义了对角斜角令牌（左上亮、右下暗）',
    compact.includes('--pixel-bevel: var(--panel-edge-light) var(--panel-edge-dark) var(--panel-edge-dark) var(--panel-edge-light);'),
  );
  check(
    '浅色面板（背包/配方书/成就/告示牌）用浅色斜角',
    compact.includes('border: 3px solid; border-color: var(--pixel-bevel);'),
  );
  check(
    '深色面板（主菜单/暂停菜单）用深色斜角',
    compact.includes('border: 3px solid; border-color: var(--pixel-bevel-dark); border-radius: 0;'),
  );
  check('深色底上的按钮用半透明斜角', compact.includes('border-color: var(--pixel-bevel-on-dark);'));
  // ③ 投影变硬（像素风不要 44px 的柔光）
  check('面板投影是硬边而不是柔光', compact.includes('--panel-shadow: 0 8px 0 rgba(0, 0, 0, .35), 0 0 0 2px rgba(0, 0, 0, .55);'));
  // ④ 开关/滑杆不再是胶囊与圆点（这两处是最容易被当成"遗留下来的老样式"的地方）
  check('开关的滑块是方块', !/checkbox"\]::after \{[^}]*border-radius: 50%/.test(compact));
  check('滑杆的滑块是方块', !/range"\]::-webkit-slider-thumb \{[^}]*border-radius: 50%/.test(compact));

  // ⑤ "界面能左右滑"是一条真出现过的 bug：`overflow-y: auto` 会把另一轴
  //    的 `visible` 计算成 `auto`，于是整屏能被左右拖动。锁死这条规则不能被删掉。
  const lockRule = /:is\(#world-screen[\s\S]*?\) \{[^}]*overflow-x: hidden; overscroll-behavior: contain; \}/.exec(compact);
  check('整屏遮罩锁死横向滚动', !!lockRule);
  check('没有把分类标签的单行横向滚动一起锁掉', !!lockRule && !lockRule[0].includes('.inv-tabs'));
}

console.log('\n[进游戏首页默认全屏]');
{
  // Node 里没有 document：这两个函数必须安静地退化，而不是抛（`boot()` 会在桌面上也调它）
  check('没有 document 时 isFullscreen() 为假（不抛）', !isFullscreen());

  // "第一次点击就进全屏"的关键是**一次性**：触发后必须摘掉监听，
  // 否则每次点菜单按钮都再请求一次全屏（已经在全屏里时会被浏览器拒掉并抛）。
  let handler: (() => void) | null = null;
  const fake = {
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'pointerdown') handler = fn;
    },
    removeEventListener: (type: string, fn: () => void) => {
      if (type === 'pointerdown' && handler === fn) handler = null;
    },
  } as unknown as HTMLElement;

  armAutoFullscreen([fake, null, undefined]);
  check('装上了一次性的 pointerdown 监听', typeof handler === 'function');
  (handler as unknown as () => void)();
  check('触发后自己摘掉监听（不会每次点击都再请求一次全屏）', handler === null);

  // 一个目标都没给时不该炸（`#overlay` 在某些外壳里可能不在）
  check('没有目标时安静返回', typeof armAutoFullscreen([]) === 'function');
}

console.log(`\n界面测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
