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
    // 暂停菜单那一页（批次 108）：一页只放"几个主要按钮"，竖排
    ['暂停菜单的主按钮竖排', '.pause-actions { display: flex; flex-direction: column; gap: 8px;'],
    ['手机上暂停按钮热区 46px', 'body.touch-mode .pause-action { min-height: 46px; font-size: 15px; }'],
    ['设置页有 ‹ 返回（它在统一的标题栏左槽里）', '.settings-back { padding: 0 10px; height: 32px; min-width: 76px;'],
    ['暂停菜单那一页自己滚（设置页滚的是里面那块）', ".pause-page[data-page='menu'].active { overflow-y: auto; }"],
    ['手机端不显示快捷栏序号（没有数字键）', 'body.touch-mode #hotbar .slot .index { display: none; }'],
  ] as const) {
    check(`index.html 里有"${label}"`, compact.includes(needle), needle);
  }
  // ⚠️ 批次 110：**触摸端不再自己写面板尺寸**——"换个界面就换一个宽高"正是从
  //    `body.touch-mode .settings-panel { width: ... }` 这类规则来的，所以这条要反向断言。
  //    （先剥掉注释：上面说明里正好引用了这句，不去掉会自己撞自己）
  const cssOnly = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  check('触摸端不再覆盖面板尺寸（尺寸只有 --panel-w/--panel-h 一处）', !cssOnly.includes('body.touch-mode .settings-panel {'));

  // ---- ⑤ 手机端不能出现键盘字母（用户直接提的一条：关界面用 ✕，不是字母 R）
  const recipeBook = readFileSync(new URL('../src/ui/RecipeBook.ts', import.meta.url), 'utf8');
  const inventory = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/ui/SettingsScreen.ts', import.meta.url), 'utf8');
  check('配方书的关闭键在手机上是 ✕（PC 才写 "关闭 (R)"）', recipeBook.includes("isTouchUi() ? '✕' : '关闭 (R)'"));
  check('背包标题栏不在手机上说 "配方书 (R)"', inventory.includes("touchDevice ? '配方书' : '配方书 (R)'"));
  check(
    '设置面板的提示在手机上不提 Esc（改成"点 ‹ 返回"）',
    settings.includes("touch ? '改动立即生效") && settings.includes('点 ‹ 返回'),
  );
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
    // 右下那一簇（批次 111 对齐原版）：一排、右对齐——跳跃在右、潜行在它左边
    ['右下按钮簇是一排右对齐（跳跃在右）', '#touch-buttons { position: absolute; right: 20px; bottom: 96px; display: flex; flex-direction: row; align-items: flex-end;'],
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

  // "点击进入游戏"那层遮罩（批次 111 整个删掉）：DOM、样式、文案一处都不该留。
  // ⚠️ 先剥掉注释——说明"这层已经删掉"的注释里正好会提到这些字眼。
  const htmlNoComments = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  check(
    '开始遮罩已经删干净',
    !htmlNoComments.includes('id="overlay"') && !htmlNoComments.includes('.overlay-go') && !htmlNoComments.includes('点击进入游戏'),
  );

  // 按键/手势说明搬到了暂停菜单底部（标记在 SettingsScreen.ts 里，不再是 HTML 外壳）
  const settingsSrc = readFileSync(new URL('../src/ui/SettingsScreen.ts', import.meta.url), 'utf8');
  check(
    '暂停菜单底部同时有键盘提示与手势提示',
    settingsSrc.includes("help.className = 'pause-help'") &&
      settingsSrc.includes("keys.className = 'desktop-only'") &&
      settingsSrc.includes("gestures.className = 'touch-only'"),
  );
  // 触屏那套提示里不能再出现 <kbd>（手机上没有键盘）
  const gestureBlock = /gestures\.innerHTML =([\s\S]*?);\n/.exec(settingsSrc)?.[1] ?? '';
  check('触屏提示里没有键盘按键', gestureBlock.length > 0 && !gestureBlock.includes('<kbd>'), gestureBlock.slice(0, 40));

  // 点空白关闭（批次 111 按用户要求删掉）：三个面板里都不许再有这条
  const noBackdropClose = ['SettingsScreen', 'AdvancementScreen', 'RecipeBook'].every((name) => {
    const source = readFileSync(new URL(`../src/ui/${name}.ts`, import.meta.url), 'utf8');
    return !source.includes('event.target === this.root');
  });
  check('三个面板都不再用"点空白关闭"', noBackdropClose);
  // 删掉它之后每个面板必须还有**看得见**的出口
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  check('背包补上了关闭键（它原来根本没有）', invSrc.includes("closeButton.className = 'inv-close'") && html.includes('.inv-close {'));
  // ⚠️ 只查**提示文案那一句**（注释里会解释"原来写的是错的"，会撞到自己）
  const invHint = /hint\.innerHTML = touchDevice([\s\S]*?);\n/.exec(invSrc)?.[1] ?? '';
  check('背包提示不再说"点空白处关闭"（那句话本来就是错的）', invHint.length > 0 && !invHint.includes('点空白'));
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
  check(
    '设置面板补了"创造模式（飞行）"开关',
    settingsSource.includes("'创造模式（飞行）'") && settingsSource.includes('private makeCreativeRow'),
  );
  check('设置面板里的"视角"下拉还在', settingsSource.includes("this.makeSelect(controls, 'cameraMode', '视角'"));
  check(
    '飞行开关不写进 localStorage（它是世界里的状态，不是设备偏好）',
    !settingsSource.includes("key: 'flying'") && settingsSource.includes('private makeCreativeRow'),
  );
}

console.log('\n[暂停菜单分两层（批次 108）]');
{
  const source = readFileSync(new URL('../src/ui/SettingsScreen.ts', import.meta.url), 'utf8');
  // 两页 = 同一份 DOM 的两个 `.pause-page`，切页只切 `.active`（没有重建、没有动画）
  check('定义了两页（menu / settings）', source.includes("export const PAUSE_PAGES = ['menu', 'settings'] as const;"));
  check('切页只切 class（不重建 DOM）', source.includes("element.classList.toggle('active', key === page);"));
  // 用户点名要的"几个主要按钮"：继续游戏 / 设置 / 保存并退出
  check('暂停菜单有「继续游戏」', source.includes("this.resumeButton.textContent = '继续游戏';"));
  check('暂停菜单有「设置」按钮（点进二级页）', source.includes("settingsButton.textContent = '设置';"));
  check('暂停菜单有「保存并退出到主菜单」', source.includes("exitToMenu.textContent = '保存并退出到主菜单';"));
  // 设置页有返回；「继续游戏」不该再和滑块挤在同一页上
  check('设置页有 ‹ 返回', source.includes("'‹ 返回'"));
  check('设置页上不再并排放着动作按钮', !source.includes("className = 'settings-buttons'"));
  // Esc / Android 返回键共用"退一层"这一个判据
  check('退一层收在 goBack() 里（返回"还开着吗"）', source.includes('goBack(): boolean') && source.includes("this.setPage('menu');\n      return true;"));
  // 从主菜单打开时没有"暂停"可言，直接进设置页
  check('从主菜单打开直接进设置页', source.includes("page ?? (this.actions.onExitToMenu ? 'menu' : 'settings')"));
  // 主程序三条路径都要走 goBack（Esc / Android 返回键 / 关最上层界面）
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check('Esc 走 goBack（设置页 → 菜单页 → 继续游戏）', main.includes('this.settingsScreen.goBack();'));
  check(
    'Android 返回键也走 goBack（先退到菜单页，再按一次才真的关）',
    /closeTopUi\(\): boolean \{[\s\S]*?settingsScreen\.goBack\(\)/.test(main),
  );
}

console.log('\n[主菜单分层（批次 108）]');
{
  const source = readFileSync(new URL('../src/ui/WorldScreen.ts', import.meta.url), 'utf8');
  // 首页**只留两颗按钮**（基岩版标题页就是"游戏 / 设置"）。
  // 批次 107 那版有四颗，其中"开始游戏"会直接进最近玩的世界——用户当场反问
  // "进入游戏，进入什么呢？"，所以这条断言防的就是那四颗回来。
  check('首页第一颗是「游戏」', source.includes("play.textContent = '游戏';"));
  // ⚠️ 防的是批次 107 那版：首页四颗按钮、其中"开始游戏"会**直接进最近玩的世界**
  //（用户当场反问"进入游戏，进入什么呢？"）。`quickStart` 这个方法连同那颗按钮一起删掉了。
  check('首页不再有"开始游戏"那颗一键入口', !source.includes("'开始游戏'") && !source.includes('quickStart'));
  check('首页只 append 了「游戏」这一颗主按钮', /menu\.append\(play\);/.test(source));
  // 二级页面回答"进哪个世界"：新建 + 存档列表
  check('二级页有「＋ 新建世界」主入口', source.includes("newEntry.id = 'world-new-button';"));
  check('二级页有存档列表（验收脚本按 id 找）', source.includes("this.listEl.id = 'world-list';"));
  check('存档的"进入"按钮有专属类名（不再靠"第一个匹配"）', source.includes("enter.className = 'world-enter';"));
  check('新建表单的提交按钮有专属 id', source.includes("createButton.id = 'world-create-button';"));
  // 三个浏览器验收脚本都要走完这三步，一处漏了就会在主页上卡住
  // （⚠️ 路径是 `../tools/`：测试被打包到 `.tmp/ui-test.mjs` 里跑，`import.meta.url`
  //   的基准是那个临时文件，不是本文件——与上面 `../index.html` 同一个道理）
  for (const script of ['ui-acceptance.js', 'mobile-acceptance.js', 'startup-acceptance.js']) {
    const text = readFileSync(new URL(`../tools/${script}`, import.meta.url), 'utf8');
    check(
      `${script} 走完"游戏 → 新建世界 → 创建并进入"三步`,
      text.includes('world-new-button') && text.includes('world-create-button') && text.includes('world-enter'),
    );
  }
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
  // ③ 投影变硬（像素风不要 44px 的柔光）
  check('面板投影是硬边而不是柔光', compact.includes('--panel-shadow: 0 0 0 2px var(--mc-outline);'));
  // ④ 原版那套按钮画法（批次 109）：灰面 + 黑描边 + inset 白/深斜面 + 文字阴影
  check(
    '界面按钮统一成原版画法（灰面 + 黑描边 + 斜面）',
    compact.includes('border: 2px solid var(--mc-outline);') &&
      compact.includes('box-shadow: inset 2px 2px 0 var(--mc-edge-light), inset -2px -2px 0 var(--mc-edge-dark);'),
  );
  check(
    '按下时斜面反转（原版靠这个表达"按下了"，不靠位移）',
    compact.includes('box-shadow: inset 2px 2px 0 var(--mc-edge-dark), inset -2px -2px 0 var(--mc-edge-light);'),
  );
  // ⑤ 开关/滑杆不再是胶囊与圆点（这两处是最容易被当成"遗留下来的老样式"的地方）
  check('滑块是方块而不是圆点', !/range"\]::-webkit-slider-thumb \{[^}]*border-radius: 50%/.test(compact));
  check('设置项没有再用原生 checkbox/select', !compact.includes('input[type="checkbox"]') && !compact.includes('settings-select'));
  check('开关/几选一都走 .settings-cycle（原版形态）', compact.includes('.settings-cycle {'));

  // ⑤ "界面能左右滑"是一条真出现过的 bug：`overflow-y: auto` 会把另一轴
  //    的 `visible` 计算成 `auto`，于是整屏能被左右拖动。锁死这条规则不能被删掉。
  const lockRule = /:is\(#world-screen[\s\S]*?\) \{[^}]*overflow-x: hidden; overscroll-behavior: contain; \}/.exec(compact);
  check('整屏遮罩锁死横向滚动', !!lockRule);
  check('没有把分类标签的单行横向滚动一起锁掉', !!lockRule && !lockRule[0].includes('.inv-tabs'));
}

console.log('\n[暂停/设置面板：固定尺寸 + 统一标题栏（批次 110）]');
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');
  const source = readFileSync(new URL('../src/ui/SettingsScreen.ts', import.meta.url), 'utf8');
  const landscape =
    /@media \(orientation: landscape\) and \(max-height: 560px\) \{([\s\S]*?)\n      \}/.exec(html)?.[1] ?? '';

  // ⚠️ 用户反馈："不管手机还是 PC，设置的界面应该是固定宽高的；不能这个界面一个
  //    宽高、跳另一个界面又是一个宽高，应该是统一大小的。"
  //    根因就是批次 107~109 给两页各写了一套宽度（菜单页 400px、设置页 820px）。
  check(
    '面板尺寸只有一个出处（--panel-w / --panel-h）',
    compact.includes('--panel-w: min(94vw, 760px);') && compact.includes('--panel-h: min(88vh, 620px);'),
  );
  // "只留一点点外部游戏区域"：上限不能小到让 PC 上留下大半屏
  check('面板上限够大（PC 上不会只剩半屏游戏区域）', compact.includes('--panel-w: min(94vw, 760px);'));
  check('宽屏下滑杆不会被拉长（原版没那么长的滑杆）', compact.includes('max-width: 300px;'));
  check(
    '两页共用这对尺寸，且高度是固定值（不再是 auto）',
    compact.includes('.settings-panel { width: var(--panel-w); max-width: var(--panel-w); height: var(--panel-h); max-height: var(--panel-h);'),
  );
  // 反向断言：不许再出现"按页/按方向另写一套尺寸"
  check('没有按页另写宽高', !/settings-panel\[data-page='menu'\] \{ width/.test(compact));
  check('没有按方向另写宽高（横屏不再覆盖设置面板）', !landscape.includes('.settings-panel'));
  check('面板不铺满（四周留出游戏区域）', !compact.includes('.settings-panel { width: 100%'));

  // 统一标题栏：三列栅格 → 标题永远居中，两页共用同一个骨架
  check('标题栏是三列栅格（左槽 | 标题 | 右槽）', compact.includes('.settings-header { display: grid; grid-template-columns: 84px 1fr 84px;'));
  check(
    '标题栏骨架只有一个（两页共用 makeHeader）',
    source.includes('private makeHeader(titleEl: HTMLElement, backLabel: string | null, onBack?: () => void)') &&
      (source.match(/this\.makeHeader\(/g) ?? []).length === 2,
  );
  // 用户点名："暂停那个界面有继续游戏，可能就不需要关闭按钮了" → ✕ 整个删掉
  check('不再有 ✕ 关闭按钮', !compact.includes('.settings-close') && !source.includes('makeCloseButton'));
  check('设置页左槽是 ‹ 返回', source.includes("this.makeHeader(this.settingsTitleEl, '‹ 返回'"));
  // 从主菜单打开时"‹ 返回"直接关掉（否则会看到一个标题写着"游戏已暂停"的菜单页）
  check(
    '‹ 返回 的落点随上下文（游戏内回菜单页，主菜单里直接关）',
    source.includes('private backFromSettings(): void') && source.includes('if (this.actions.onExitToMenu) this.setPage(\'menu\');'),
  );
  check('暂停菜单页左槽留空（标题仍然居中）', source.includes('this.makeHeader(menuTitle, null)'));

  // 固定高度之后"四组一次全展开"放不下了 → 三端统一"左选项卡 + 右内容、一次一组"
  check('三端统一：左选项卡 + 右内容', compact.includes('.settings-columns { display: flex; flex-direction: row; gap: 12px;'));
  check(
    '一次只显示当前分组（固定高度下永远不用滚）',
    compact.includes('.settings-section { display: none; flex-direction: column; gap: 6px; }'),
  );
  check(
    '页签永远显示（不再分"高屏隐藏/矮屏显示"）',
    compact.includes('.settings-tabs { display: flex; flex-direction: column; flex: 0 0 104px; gap: 4px; }'),
  );

  // 横屏这一段现在只该管主菜单（尺寸已经统一，不该再按方向覆盖面板）
  const bareSelectors = landscape
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => /^\s*\.[a-z-]/.test(line));
  check('横屏里没有裸选择器（每条规则都挂在触摸端上）', bareSelectors.length === 0, bareSelectors.join(' / '));
  // 横屏只剩"主菜单"与"把按钮排紧一点"：**不许再碰面板尺寸**
  check('横屏不再覆盖面板尺寸（只允许把里面的按钮排紧）', !landscape.includes('.settings-panel') && !landscape.includes('.settings-columns'));
  check('横屏：暂停按钮收紧到 42px（面板尺寸不变）', landscape.includes('body.touch-mode .pause-action { min-height: 42px; font-size: 14px; }'));
  check('横屏：主菜单标题缩小、按钮高度统一到 44px', landscape.includes('body.touch-mode .world-title { font-size: 20px; }') && landscape.includes('body.touch-mode .world-primary { min-height: 44px;'));
}

console.log('\n[按钮尺寸对齐（批次 111）]');
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');
  // 背包那一块（批次 111）：装备竖排在左、主背包/快捷栏在右，且**不再有文字标签**
  check(
    '背包改"左装备 / 右背包"两列',
    compact.includes('.inv-body { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; }') &&
      compact.includes('.inv-gear { grid-column: 1; grid-row: 1; }') &&
      compact.includes('.inv-main { grid-column: 2; grid-row: 1;'),
  );
  check('装备格竖排成一一列（原版位置）', compact.includes('.inv-grid.inv-armor { grid-template-columns: 42px; }'));
  check('快捷栏与主背包之间留一道缝', compact.includes('.inv-main .inv-hotbar { margin-top: 5px; }'));
  // 成就与配方书也共用同一套固定尺寸（原来三块面板三个尺寸）
  check(
    '成就/配方书与设置面板共用同一套固定尺寸',
    (compact.match(/width: var\(--panel-w\); max-width: var\(--panel-w\);/g) ?? []).length === 3,
  );
  // 文字标签是原来我们自己加的（原版没有），这次按用户要求去掉
  const invSource = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  check(
    '「主背包 / 快捷栏 / 盔甲与副手」三行文字标签已去掉',
    !invSource.includes("buildLabel('主背包')") &&
      !invSource.includes("buildLabel('快捷栏')") &&
      !invSource.includes("buildLabel('盔甲与副手')"),
  );
  // 用户："首页的按钮要对齐，符合正常的按钮大小"。
  // 根因：首页按钮被单独收窄到 280px（横屏 240px），而二级页是满宽——两页对不齐。
  check('首页按钮不再被单独收窄', !compact.includes('.world-menu > * { width'));
  check('标题页那一片收到 360px（接近原版那一列的宽度）', compact.includes('.world-panel { width: min(92vw, 360px);'));
  // 用户："暂停界面按钮可以窄一点"（面板 760 宽，一列按钮拉满太宽）
  check(
    '暂停菜单的按钮列收到 300px 并居中',
    compact.includes('.pause-actions { display: flex; flex-direction: column; gap: 8px; margin: auto; width: 100%; max-width: 300px;'),
  );
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

console.log('\n[物品与配方书的交互（批次 132，按中文 Wiki「物品栏」）]');
{
  const inventorySrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const bookUi = readFileSync(new URL('../src/ui/RecipeBook.ts', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');

  // ---- 配方书：点一条配方 = **把材料摆进合成格**（原版主交互）
  check('配方书的动作接口有 onFill（摆进合成格）', bookUi.includes('onFill: (recipe: Recipe) => boolean'));
  check('卡片可点，且标了 dataset.role（验收脚本要能找到它）', bookUi.includes("card.dataset.role = 'fill'"));
  check('可点的卡片才给 fillable（有按下/悬停反馈）', bookUi.includes("card.classList.add('fillable')") && compact.includes('.recipe-card.fillable:active'));
  check('3×3 的配方在背包里不可点（要站到工作台前）', bookUi.includes('entry.gridSize <= 2'));
  check('点卡片时不会抢那颗"合成"按钮的事', bookUi.includes("closest('.recipe-craft')"));
  check('main 把 onFill 接上了', mainSrc.includes('onFill: (recipe) => this.fillFromBook(recipe)'));
  check('fillFromBook 摆好后收起配方书（露出摆好的合成格）', /private fillFromBook[\s\S]{0,400}this\.recipeBook\.hide\(\)/.test(mainSrc));
  // 打开配方书**不能**再关背包：关界面会把格子里的东西倒回背包，刚摆的立刻被清掉
  check(
    '打开配方书不再先关背包（否则摆好的立刻被倒回去）',
    !/private openRecipeBook[\s\S]{0,200}inventoryScreen\.close\(\)/.test(mainSrc),
  );

  // ---- 物品栏：Wiki「物品管理」里那几条
  // 关界面时合成格里的残留回到背包（原版："关闭界面时，合成格中残留的物品会自动回到背包"）
  check('关背包时把合成格里的东西退回背包', inventorySrc.includes('this.returnCraftingToInventory();'));
  check('放不下的留在格子里（不凭空消失）', /returnCraftingToInventory[\s\S]{0,500}addStack\(stack\) > 0\) continue/.test(inventorySrc));
  // 左键点暗处全部丢出、右键只丢一个
  check('右键点空白只丢 1 个（左键才全丢）', inventorySrc.includes('event.button === 2 ? 1 : this.held.count'));
  // 这几条原版规则本来就在（钉住，防止以后被改掉）
  check('右键点格子拿一半', inventorySrc.includes('button === 2') || inventorySrc.includes('halfOf'));
  check('Shift+左键 = 快速移动', inventorySrc.includes('this.quickMoveSlot(key)'));
  check('双击 = 收集同类', inventorySrc.includes('this.gatherFrom(binding)'));
  check('拖拽分配 / 每格一个', inventorySrc.includes('distributeEvenly(this.held, slots)') && inventorySrc.includes('placeOneEach(this.held, slots)'));
}

console.log(`\n界面测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
