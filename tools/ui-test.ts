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
import { iconBackingScale, iconDisplaySize } from '../src/ui/ItemIcon.ts';
import { ISO_ICON_SIZE, isoBounds, isoBoxesForShape, isoProject } from '../src/ui/BlockIcon.ts';
import { BLOCKS } from '../src/core/registry/blocks.ts';
import { TOUCH_TOOLTIP_MS } from '../src/ui/Tooltip.ts';
import { TOUCH_LONG_PRESS_MS } from '../src/ui/InventoryScreen.ts';
import { damageReason } from '../src/core/survival/DamageNotice.ts';
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
import { CREATIVE_TAB_ICONS, CREATIVE_TABS, creativeTabFor, missingTabIcons } from '../src/ui/CreativeTabs.ts';
import { armAutoFullscreen, isFullscreen } from '../src/ui/Fullscreen.ts';
import { hideLoading, isLoadingVisible, showLoading } from '../src/ui/LoadingOverlay.ts';
import { CREATIVE_ITEMS, itemDef, itemIconTile } from '../src/core/registry/items.ts';
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
  // 批次 181：顶部三颗（暂停/视角/聊天）+ 右下两颗（跳/潜）+ 快捷栏右侧背包
  equal('六个图标（顶部三颗 + 右下两颗 + 快捷栏背包）', TOUCH_ICON_NAMES.length, 6);
  for (const name of ['chat', 'view', 'sneak', 'inventory', 'jump', 'pause'] as const) {
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
  // 批次 187：新增「外观」页（肤色/上衣/裤子/披风）
  // 批次 203：删掉「视频」页（性能四行没了，只剩视野 → 并进「控制」）
  equal('四个分组（外观/控制/音频/游戏）', SETTING_GROUPS.length, 4);
  check('分组里有「外观」', SETTING_GROUPS.includes('appearance') && SETTING_GROUP_LABELS.appearance === '外观');
  check('不再有「视频」页（视野已并进控制）', !SETTING_GROUPS.includes('graphics' as never));
  check('每个分组都有中文名', SETTING_GROUPS.every((group) => (SETTING_GROUP_LABELS[group] ?? '').length > 0));
  equal('分组名不重复', new Set(SETTING_GROUPS.map((group) => SETTING_GROUP_LABELS[group])).size, SETTING_GROUPS.length);

  // ---- ④ CSS 守卫（少哪一条就是哪一种"半手机半桌面"的怪界面）
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');
  for (const [label, needle] of [
    ['顶部暂停键容器', '#touch-pause {'],
    ['顶部三键尺寸吃 --touch-scale（44px 是平台热区下限）', '#touch-pause .touch-button { width: calc(44px * var(--touch-scale, 1));'],
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
    ['右下按钮簇竖排（生存只跳，飞时上中下）', '#touch-buttons { position: absolute; right: 20px; bottom: 96px; display: flex; flex-direction: column; align-items: center;'],
    // 快捷栏右侧只留背包（聊天搬到顶部，批次 181）
    ['背包按钮挂进快捷栏', '#hotbar .touch-side-btn { position: absolute; bottom: calc(100% + 4px);'],
    ['屏幕够宽时背包摆快捷栏右侧', '#touch-hotbar-inventory { right: auto; left: calc(100% + 8px); }'],
    ['顶部三键是方形小键', '#touch-pause { position: absolute; left: 50%; top: calc(8px + env(safe-area-inset-top, 0px)); transform: translateX(-50%); display: flex; align-items: center; gap: 6px;'],
    ['准星下方有目标名称', '#target-info {'],
    ['游戏内一行提示在快捷栏上方', '#hud-toast {'],
    // 切石机（H11，批次 44）：候选列表与候选按钮的样式被误删时这里会红
    ['切石机候选列表', '.stonecutter-list'],
    ['切石机候选按钮', '.stonecutter-option'],
    // 营火（批次 47）：4 格 + 每格自己的进度条
    ['营火格子排布', '.campfire-grid'],
    ['营火进度条', '.campfire-cook'],
    // 进食进度条（批次 219）：与破坏进度条同一套视觉
    ['进食进度条', '#eat-progress i {'],
  ] as const) {
    // 用压过空白的版本比对：断言里可以跨行引用一整段规则，不用把换行也抄进来
    check(`index.html 里有"${label}"`, compact.includes(needle), needle);
  }

  // 进食进度条（批次 219）：DOM 与位置都要在——挖掘条在 74px、进食条在 86px，
  // 两条判据互斥（挖掘要对着方块、进食要不对着），所以不会同时出现
  check(
    '进食进度条挂在 HUD 里，位置在破坏进度条之上',
    compact.includes('<div id="eat-progress"><i></i></div>') &&
      /#eat-progress \{[^}]*bottom: 86px/.test(compact),
  );

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
  check(
    '关闭背包会同步关闭携带版配方页（不留下孤立左板）',
    /close\(\): void \{[\s\S]{0,260}this\.hooks\.onCloseRecipes\?\.\(\)/.test(invSrc),
  );
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
  // 批次 216：夹到 3（3 倍屏手机上图标只有 32~36 CSS px，2 倍背板会被插值糊掉一圈）
  equal('DPR 3 → 3 倍（图标边缘不再糊）', iconBackingScale(3), 3);
  equal('DPR 4 → 仍夹到 3 倍', iconBackingScale(4), 3);
  equal('DPR 0.5 / NaN / 0 → 1 倍（异常输入不吃亏）', `${iconBackingScale(0.5)},${iconBackingScale(Number.NaN)},${iconBackingScale(0)}`, '1,1,1');
  equal('手机快捷栏按 CSS 实际 36px 画背板（不再固定拿桌面 32px）', iconDisplaySize(36, 32), 36);
  equal('元素尚未布局时回退设计尺寸', iconDisplaySize(0, 32), 32);

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
    // 批次 222：槽位尺寸改成走 `#hud` 上的变量（血条/饥饿要跟快捷栏两端对齐）
    ['触摸端槽位放大到 44px（平台最小手势尺寸）', '#hud { --hotbar-slot: 44px; --hotbar-gap: 1px; --hotbar-pad: 2px; }'],
    ['槽位尺寸来自同一个变量', 'width: var(--hotbar-slot); height: var(--hotbar-slot);'],
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

console.log('\n[方块物品的等轴（iso）图标]');
{
  // ① 注册表里每一种形状都必须有明确口径：要么给出盒子，要么明确"走平面图标"。
  //    漏一个 case 的症状是那个形状的方块在背包里画不出来（而不是报错）。
  const shapes = [...new Set(BLOCKS.map((def) => def.shape))].sort();
  const missing = shapes.filter((shape) => isoBoxesForShape(shape) === undefined);
  equal('每种方块形状都有明确口径（undefined = 漏了一个 case）', missing.join(','), '');
  check('形状表不是空的（否则上面的断言会空转）', shapes.length >= 20, String(shapes.length));

  // ② 盒子必须落在单位立方体内：越界的那部分会被画布裁掉，
  //    缩到 32px 之后表现是"图标缺一角"，几乎不可能靠肉眼归因。
  const outside: string[] = [];
  for (const shape of shapes) {
    for (const b of isoBoxesForShape(shape) ?? []) {
      for (const v of [b.x0, b.x1, b.y0, b.y1, b.z0, b.z1]) {
        if (!(v >= 0 && v <= 1)) outside.push(`${shape}:${v}`);
      }
    }
  }
  equal('所有盒子都在单位立方体内', outside.join(','), '');

  // ③ 投影几何：整方块必须投影成 32×32，居中后四周正好留 1px。
  //    "竖直方向也按 16" 这一条最容易写错（写成 8 会得到扁的图标）。
  // 顶面四个角在屏幕上的相对位置（这就是"菱形"的全部定义）：
  // 后角在最上、前角在最下、左右两角各低半格——写反一个就是歪的图标
  equal(
    '顶面四角：后/右/前/左',
    [isoProject(0, 1, 0), isoProject(1, 1, 0), isoProject(1, 1, 1), isoProject(0, 1, 1)]
      .map((p) => `${p.x},${p.y}`)
      .join(' | '),
    '0,-16 | 16,-8 | 0,0 | -16,-8',
  );

  const cubeBoxes = isoBoxesForShape('cube')!;
  const bounds = isoBounds(cubeBoxes);
  equal('整方块投影成 32×32', `${bounds.maxX - bounds.minX}×${bounds.maxY - bounds.minY}`, '32×32');
  equal('画布 34 = 32 + 两侧各 1px', String(ISO_ICON_SIZE - (bounds.maxX - bounds.minX)), '2');
  const offset = ISO_ICON_SIZE / 2 - (bounds.minX + bounds.maxX) / 2;
  check(
    '居中之后不出画布（含 1px 边距）',
    bounds.minX + offset >= 1 && bounds.maxX + offset <= ISO_ICON_SIZE - 1,
    `${bounds.minX + offset} .. ${bounds.maxX + offset}`,
  );

  // ④ 平面名单：门/火把/植物这些**必须**保持精灵图。
  //    把它们塞进盒子会得到"实心木箱"和"糊掉的柱子"，比平面图标更糟。
  for (const shape of ['door', 'trapdoor', 'fence_gate', 'torch', 'ladder', 'pane', 'cross', 'nether_wart'] as const) {
    equal(`${shape} 保持平面图标`, String(isoBoxesForShape(shape)), 'null');
  }
  // 反向：这几个是"看得出来是个块"的，必须走等轴
  for (const shape of ['cube', 'slab', 'stairs', 'hopper', 'bed'] as const) {
    check(`${shape} 走等轴图标`, (isoBoxesForShape(shape)?.length ?? 0) > 0);
  }

  // ⑤ 资源包换贴图之后图标缓存必须失效（否则背包里还是旧材质）
  const packSrc = readFileSync(new URL('../src/core/resourcepack/ResourcePack.ts', import.meta.url), 'utf8');
  check('替换贴图走 markTextureChanged（一次性作废所有按像素派生的缓存）', packSrc.includes('atlas.markTextureChanged()'));
  check('不再直接写 texture.needsUpdate', !packSrc.includes('atlas.texture.needsUpdate = true'));
  const isoSrc = readFileSync(new URL('../src/ui/BlockIcon.ts', import.meta.url), 'utf8');
  check('图标缓存以 atlas.revision 为失效判据', isoSrc.includes('atlas.revision'));
}

console.log('\n[触摸端长按选数量（批次 137，基岩版那个指示条）]');
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');

  // ---- ① 元素真的建出来了（没建 = 长按之后什么都不会出现，且没有任何报错）
  check('槽位里建了指示条', invSrc.includes("splitBar.className = 'inv-split-bar hidden'"));
  check('槽位里建了数字标签', invSrc.includes("splitLabel.className = 'inv-split-count hidden'"));
  check(
    '槽位把两者都挂上了（只建不挂是最常见的一种"写了但没接线"）',
    /slot\.append\(canvas, count, durability, splitBar, splitLabel\)/.test(invSrc),
  );

  // ---- ② CSS：条的绿边是**占比**（宽度百分比），并且默认不显示
  const barRule = /\.inv-split-bar \{([^}]*)\}/.exec(compact)?.[1] ?? '';
  check('指示条是一块绝对定位的细条', barRule.includes('position: absolute') && barRule.includes('height: 5px'), barRule.slice(0, 60));
  check('指示条不吃手势（否则划动会被它截走）', barRule.includes('pointer-events: none'), barRule.slice(0, 60));
  check('指示条默认隐藏（.hidden 有 none）', compact.includes('.inv-split-bar.hidden { display: none; }'));
  check('数字标签默认隐藏', compact.includes('.inv-split-count.hidden { display: none; }'));
  check('选中时长的那一格有亮边（手指常盖住格子本身）', compact.includes('.inv-slot.splitting { outline'));
  // 绿色部分靠 inline width 驱动：写成固定宽度就变成"永远一半"
  check('界面按比例写宽度（inline style + 百分比）', /split\.fill\.style\.width = `\$\{Math\.round\(splitFraction\(split\.count, split\.total\) \* 100\)\}%`/.test(invSrc));

  // ---- ③ 长按的分流顺序：先问"能不能选数量"，再退回右键 + 连发
  const longPressBlock = /this\.touchPressTimer = window\.setTimeout\(\(\) => \{([\s\S]*?)\}, TOUCH_LONG_PRESS_MS\)/.exec(invSrc)?.[1] ?? '';
  const splitAt = longPressBlock.indexOf('this.beginSplit(');
  const rightAt = longPressBlock.indexOf('this.activateSlot(key, 2)');
  check(
    '长按里"选数量"排在右键语义之前',
    splitAt >= 0 && rightAt > splitAt,
    `beginSplit@${splitAt} activateSlot@${rightAt}`,
  );
  // ⚠️ 走了选数量就必须**不再启动连发**，否则每 170ms 又拿走一件
  check('选了数量就不再启动连发', /if \(this\.beginSplit\(slot, key, startX\)\) return;/.test(longPressBlock));
  // 抬手结算必须排在被清掉之前（先 commit 再 clear）
  check(
    '抬手时先结算再清状态（顺序反了就白条）',
    /if \(this\.split\) \{\s*this\.commitSplit\(\);\s*return;/.test(invSrc),
  );

  // ---- ④ 规则真的接到界面上了（模块存在但没人调 = 玩家眼里什么都没发生）
  check('界面调用 canSplitStack 判"这一格能不能选"', invSrc.includes('canSplitStack(stack, this.held !== null)'));
  check('界面调用 splitCountForDrag 换算划动量', invSrc.includes('splitCountForDrag(this.split.total, this.split.startCount, dx, this.split.width)'));
  check('界面调用 splitStack 结算', invSrc.includes('splitStack(stack, count)'));
  // 格宽不能写死：三档尺寸（34/42/46px）各不相同，写死就会有一档"划一寸就到底"
  check('划动按格子的实际宽度归一', /width: slot\.getBoundingClientRect\(\)\.width \|\| 42/.test(invSrc));

  // ---- ⑤ 选数量期间不弹提示框（提示框会正好盖住要看的那个数字）
  const tooltipBlock = /private tooltipFor\(element: HTMLElement\): ItemTooltip \| null \{([\s\S]*?)\n  \}/.exec(invSrc)?.[1] ?? '';
  check('选数量时不弹提示框', tooltipBlock.includes('if (this.split) return null;'), tooltipBlock.slice(0, 40));

  // ---- ⑥ 触摸端的提示要说出这个手势（不说没人会去划）
  const invHint = /hint\.innerHTML = touchDevice([\s\S]*?);\n/.exec(invSrc)?.[1] ?? '';
  check('背包提示写了"长按划动选数量"', invHint.includes('长按划动选数量'), invHint.slice(0, 60));
}

console.log('\n[背包搬运音效（H19 ⑪，批次 138）]');
{
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  check('界面提供了 onMove 钩子', invSrc.includes('onMove?: () => void;'));
  // ⚠️ 判据是"动过"而不是"点过"：散在十几个分支里逐个补一句迟早漏，
  // 所以用一个前后指纹包住整个激活入口
  check('用前后指纹判断"动过没有"', /const before = this\.moveSignature\(\);/.test(invSrc) && /if \(this\.moveSignature\(\) !== before\) this\.hooks\.onMove\?\.\(\)/.test(invSrc));
  check('指纹含光标那一叠（否则"拿走半叠"漏判）', /this\.held \? `@\$\{this\.held\.id\}:\$\{this\.held\.count\}`/.test(invSrc));
  check('选数量的结算也响（它不是普通点击那条路）', /this\.refresh\(\);\s*\n\s*this\.hooks\.onMove\?\.\(\);/.test(invSrc));
  check('主程序把它接到 audio.play', mainSrc.includes("onMove: () => this.audio.play('item_move')"));
}

console.log('\n[创造栏 HCI（批次 139）：门控 / 销毁格 / 中键克隆]');
{
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  check('界面提供了 isCreative 钩子', invSrc.includes('isCreative?: () => boolean;'));
  // 批次 181：创造能力看**模式**，不再看"在不在飞"
  check('主程序接到 isCreative（模式口径）', mainSrc.includes('isCreative: () => this.isCreative'));
  // Wiki：「创造模式物品栏只能在创造模式打开」——不能再写 mode === 'inventory' 就显示
  // 批次 181：能力口径统一成 `creativePlayer`（模式），不再内联判 isCreative
  check(
    '创造区按 isCreative（模式）门控',
    invSrc.includes('const creativePlayer = this.hooks.isCreative?.() ?? false;') &&
      invSrc.includes('const creative = creativePlayer;'),
  );
  check('没接钩子时当作生存（不显示）', invSrc.includes('this.hooks.isCreative?.() ?? false'));
  check('飞行切换时刷新界面（创造区跟着显隐）', /if \(this\.inventoryScreen\.isOpen\) this\.inventoryScreen\.refresh\(\)/.test(mainSrc));
  // 批次 185（用户要求）：创造栏下面那颗「销毁」格已删掉，统一走"点界面外丢弃"
  check(
    '不再有销毁格（DOM 与样式都删了）',
    !invSrc.includes('creative-destroy') && !css.includes('.inv-creative-destroy-row'),
  );
  check('创造格选取上光标（左满组/右一个）', invSrc.includes('创造选取') && invSrc.includes('this.held = { id: itemId, count: max }'));
  check(
    '创造物品作为统一双栏的左栏',
    invSrc.includes("classList.toggle('creative-ui', showCreativeItems)") &&
      invSrc.includes("leftPane === 'creative'"),
  );
  check('创造 ↔ 生存背包可切换', invSrc.includes("dataset.role = 'creative-toggle'"));
}

console.log('\n[携带版统一双栏（批次 140 / 156）]');
{
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const recipeSrc = readFileSync(new URL('../src/ui/RecipeBook.ts', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const core = readFileSync(new URL('../src/core/crafting/RecipeBook.ts', import.meta.url), 'utf8');
  const pagerSrc = readFileSync(new URL('../src/ui/ItemPager.ts', import.meta.url), 'utf8');

  check('左右栏仍复用 PocketInventoryTab 状态', invSrc.includes("export type PocketInventoryTab = 'crafting' | 'armor' | 'inventory'"));
  check('页签 DOM role=pocket-tabs', invSrc.includes("dataset.role = 'pocket-tabs'"));
  check('左上配方图标 role=pocket-recipes', invSrc.includes("dataset.role = 'pocket-recipes'"));
  check('图标页签：右缘合成/盔甲 + 左下物品栏', invSrc.includes('makePocketIconTab') && invSrc.includes('inv-pocket-side'));
  check('右下合成键只切右栏，不自动打开配方书', /private setPocketTab[\s\S]{0,320}applyInventoryChrome\(\);[\s\S]{0,120}\}/.test(invSrc));
  // 批次 159：左栏的职责是**物品分类**——点分类切的是左栏内容，不再去开配方书
  check('只有左侧分类键切左栏（配方书不再嵌进来）', invSrc.includes('private openPocketCategory(tab: RecipeBookTab)') && !invSrc.includes('this.hooks.onOpenRecipes?.(tab)'));
  // 批次 206：分类栏与 3×9 仓库在双栏网格里**占同一格**，工作台也不例外——
  // 同时显示就是"多一个浮层"（用户反馈的 3×3 工作台 bug）。
  check(
    '分类栏显示时 3×9 仓库一起藏掉（工作台也不叠层）',
    invSrc.includes("const hideMainGrid = leftPane === 'creative' || leftPane === 'category';") &&
      invSrc.includes("this.mainGridEl.style.display = hideMainGrid ? 'none' : '';"),
  );
  check('左栏上方那行「物品栏」不再显示', invSrc.includes("this.personalInventoryTitleEl.style.display = 'none';"));
  check('快捷栏在携带版始终显示', /this\.hotbarGridEl\.style\.display = '';/.test(invSrc));
  // 批次 157：界面统一成携带版那一套，不再有"经典 UI"这个分支
  check('不再按视口宽度选 UI 形态', !invSrc.includes('isClassicUi') && !core.includes('CLASSIC_UI_MIN_WIDTH'));
  check('左栏三份内容写在 data-pocket-left 上', invSrc.includes("dataset.pocketLeft = leftPane") && css.includes('.inv-category-section {'));
  check('配方书 show 可带 tab', /show\(tab\?: RecipeBookTab\)/.test(recipeSrc));
  check('主程序把 tab 传给配方书', mainSrc.includes('this.recipeBook.show(tab)'));
  check('生存与创造共用 pocket-dual 双栏', invSrc.includes("classList.add('pocket-ui', 'pocket-dual')") && css.includes('.inv-panel.pocket-ui.pocket-dual'));
  check('经典下隐藏携带版控件', css.includes('.inv-pocket-tabs.hidden') && css.includes('.inv-pocket-recipes.hidden'));
  // 批次 145：页签不得用负偏移伸出灰框
  check('携带版页签不伸出面板（无 right:-N）', !/inv-pocket-side\s*\{[^}]*right:\s*-\d/.test(css.replace(/\s+/g, ' ')));
  check('携带版面板 overflow:hidden + 内容区内滚', css.includes('.inv-panel.pocket-ui {') && css.includes('overflow: hidden;'));
  // 批次 146：页签在灰框外轨、快捷栏屏幕底
  check('携带版 shell + 左右轨', invSrc.includes("className = 'inv-shell'") && invSrc.includes('pocket-rail-left') && invSrc.includes('pocket-rail-right'));
  check('快捷栏 dock 外置', invSrc.includes('pocket-hotbar-dock') && invSrc.includes('placeHotbar'));
  check('打开携带版时藏 HUD 快捷栏', css.includes('body.inv-pocket-open #hotbar'));
  check('创造携带版分类挂左轨', invSrc.includes('syncCreativeRails') && invSrc.includes('creative-tabs'));
  check('合成页竖排箭头', invSrc.includes('inv-craft-vertical') && invSrc.includes("'↓'"));
  // 批次 157：箱子页签不再搬到配方书里、左轨也不再被藏（那是"点左边就跳"的来源）
  check(
    '箱子页签常驻左轨（不再随配方书搬家）',
    !invSrc.includes('parkInvTabOnRecipeBook') && invSrc.includes('private restoreInvTabToRail(): void {'),
  );
  check('换栏目内容有淡入且不碰几何', css.includes('@keyframes inv-pane-in') && css.includes('.inv-pane-enter'));
  check('盔甲页标题', invSrc.includes('inv-armor-title') && css.includes('.inv-armor-title'));
  check('快捷栏 dock 带框', css.includes('.inv-hotbar-dock:not(.hidden) .inv-hotbar'));
  // 批次 149：携带版比例与分类页不能再退回“灰框很大、槽位很小、内容混在一起”
  // 批次 181：双栏左栏统一 7 列 40px（主背包 27 格重排成 4 行）；
  // 9 列在左栏会溢出、第一格被裁掉，而且与分类/创造栏不一致。
  check(
    '双栏左栏统一 7 列 40px（主背包/分类/创造同一几何）',
    css.includes('.inv-panel.pocket-ui.pocket-dual .inv-main > .inv-grid') &&
      css.includes('grid-template-columns: repeat(7, 40px)') &&
      !css.includes('grid-template-columns: repeat(9, 36px)'),
  );
  check(
    '分类栏不再写死 4 行（改为铺满 + 滚动）',
    css.includes('.inv-grid.inv-category {') &&
      css.includes('flex: 1 1 auto;') &&
      !css.includes('max-height: min(32vh, 160px)'),
  );
  check(
    '分类栏在 align-items:start 的父网格里显式拉伸（否则内容多时会一路长到面板外、永远不滚）',
    /\.inv-panel\.pocket-ui\.pocket-dual \.inv-category-section \{[\s\S]{0,600}align-self: stretch;/.test(css),
  );
  // 批次 184：用户要求"左侧按钮要一个竖列展示，不要换列"（批次 181 的两列已撤掉）
  check(
    '左轨分类单列竖排，按钮按可用高度均分（不换列、不截断）',
    !css.includes('grid-template-columns: repeat(2, 36px)') &&
      /\.inv-shell\.pocket-chrome \.inv-pocket-recipes \{[\s\S]{0,500}flex-direction: column/.test(css) &&
      /\.inv-shell\.pocket-chrome \.inv-rail-left \.inv-tabs \{[\s\S]{0,400}flex-direction: column/.test(css) &&
      /\.inv-shell\.pocket-chrome \.inv-rail-left \.inv-pocket-recipe-tab \{[\s\S]{0,300}flex: 1 1 0;/.test(css),
  );

  // 左栏状态机（批次 181）：只有一个 pane，删掉两套互相打架的布尔
  check('左栏只有一个 pane 状态', invSrc.includes("private pane: 'creative' | 'category' | 'items'"));
  check(
    '旧的 leftPaneKind / creativeSurvival 字段已删除',
    !invSrc.includes('private leftPaneKind') && !invSrc.includes('private creativeSurvival'),
  );
  check(
    '创造模式左轨始终挂创造分类（切到个人仓库也不搬走）',
    invSrc.includes('this.syncCreativeRails(creativePlayer)'),
  );
  check(
    '点创造分类会切回无限物品页',
    /this\.pane = 'creative';\s*\n\s*this\.applyInventoryChrome\(\);/.test(invSrc),
  );
  check('点箱子页签回到我的物品', /this\.pane = 'items';\s*\n\s*this\.hooks\.onCloseRecipes/.test(invSrc));
  check('关界面放不下的手持物品会掉在脚边（不留在光标上）', invSrc.includes('if (leftover > 0) this.hooks.onDrop?.(stack.id, leftover)'));
  check('快捷栏 dock 固定到整屏底部', css.includes('position: fixed; left: 0; right: 0; bottom: 0;') && css.includes('width: 100vw;'));
  check(
    '单窗各页共用同一组固定背包尺寸',
    css.includes('--inv-pocket-w:') &&
      css.includes('--inv-pocket-h:') &&
      css.includes('width: var(--inv-pocket-w);') &&
      css.includes('height: var(--inv-pocket-h);'),
  );
  check('携带版面板高度不按页签改（只由 --inv-pocket-h 定）', !/inv-panel\.pocket-ui\s*\{[^}]*height:\s*auto/.test(css));
  check('合成/装备右栏与左侧玩家物品独立切换', invSrc.includes('const rightShowsCrafting') && invSrc.includes("this.gearEl.style.display = rightShowsCrafting ? 'none' : ''"));
  check(
    '工作台自动摊开左侧物品分类并沿用同一副双栏壳（创造模式除外）',
    invSrc.includes("if (mode === 'crafting' && !(this.hooks.isCreative?.() ?? false)) this.openPocketCategory('all');") &&
      invSrc.includes("classList.toggle('workbench-ui', workbench)"),
  );
  check('携带版创造栏是半屏可容纳的 7 列 40px 槽位', css.includes('grid-template-columns: repeat(7, 40px)'));
  // 批次 159：判据从"是不是携带版布局"改成"是不是触摸端"——
  // 界面统一成携带版之后，PC 也会被算成滚动，于是 PC 失去了底部分页键
  check(
    '创造栏：触摸端整表滚动、PC 底部翻页',
    invSrc.includes('const scrollMode = isTouchUi();') &&
      invSrc.includes('const visible = scrollMode ? items : slicePage(') &&
      invSrc.includes("this.creativePager.classList.toggle('hidden', scrollMode || pages <= 1);"),
  );
  check(
    '左栏三份内容占同一个格子（换内容不换位置）',
    css.includes('.inv-category-section {') && css.includes('grid-row: 1 / span 2;') && invSrc.includes("dataset.pocketLeft = leftPane"),
  );
  check('嵌入态只让配方网格滚', css.includes('.recipe-panel.embedded .recipe-grid {'));
  check(
    '嵌入态的列数与页大小是同一组数（半栏宽塞不下 12 列）',
    css.includes('repeat(7, var(--recipe-cell))') &&
      pagerSrc.includes('RECIPE_PANE_PAGE_SIZE = RECIPE_PANE_COLUMNS * 4') &&
      pagerSrc.includes('RECIPE_PANE_COLUMNS = 7'),
  );
  check('非搜索分类隐藏搜索框', css.includes(".recipe-panel.embedded:not([data-tab='all']) .recipe-controls"));
  check('携带版配方页不混入熔炼表', recipeSrc.includes('this.isEmbedded') && recipeSrc.includes("this.smeltingEl.classList.add('hidden')"));
  check('配方页把当前分类写入面板供布局使用', recipeSrc.includes('this.panelEl.dataset.tab = this.tab'));
}

console.log('\n[携带版细节收口（批次 159）]');
{
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  // ① 左栏是物品分类时，右栏只留合成区
  check(
    '分类栏占着左栏时不显示合成区下方的仓库',
    invSrc.includes("leftPane === 'category' && !workbench") && invSrc.includes("hideMainGrid ? 'none' : ''"),
  );

  // ② 两处标题都去掉
  check('嵌入态整条配方书标题行都不显示', css.includes('.recipe-panel.embedded .recipe-header { display: none; }'));
  check('左栏上方不再有「物品栏」那行字', invSrc.includes("this.personalInventoryTitleEl.style.display = 'none';"));

  // ③ 配方开关：标题栏 + 开关语义
  check(
    '配方开关留在标题栏（与关闭键同一行，排在左栏右上角）',
    css.includes('grid-template-columns: 1fr 1fr auto;') &&
      css.includes('.inv-pocket-recipe-toggle { grid-column: 1; justify-self: end; }') &&
      css.includes('.inv-close { grid-column: 3; justify-self: end; }'),
  );
  // 批次 159（三）：开关改成"要不要把该分类下我没有的物品也列出来（红底）"，
  // **不再切换分类、也不再退回我的物品**
  check(
    '配方开关只切"显不显示我没有的"，不切分类',
    invSrc.includes("if (this.pane === 'category') {") &&
      invSrc.includes('this.showUnowned = !this.showUnowned;') &&
      invSrc.includes('this.openPocketCategory(this.lastRecipeTab);'),
  );
  // 批次 206：列表 = "材料够的产物" + （开关开着时）"看过的缺料配方（红底）"
  check(
    '分类栏列的是能合成的产物；缺料的那批按材料齐不齐标红',
    invSrc.includes('private craftableIds(): number[]') &&
      invSrc.includes('if (canCraft(counts, recipe).ok) ids.push(recipe.result.id);') &&
      invSrc.includes('if (recipeGridSize(recipe) > this.crafting.size) continue;') &&
      invSrc.includes('for (const id of this.usedRecipeIds) {') &&
      invSrc.includes("if (!craftable.has(itemId)) slot.classList.add('locked');") &&
      invSrc.includes("classList.toggle('active', leftPane === 'category' && this.showUnowned)") &&
      css.includes('.inv-slot.locked {'),
  );
  // 创造模式搜索框只在「搜索」那一栏出现（与生存模式同一个口径）
  check(
    '创造搜索框只在「搜索」分类显示',
    invSrc.includes("private syncCreativeSearch(): void {") &&
      invSrc.includes("this.creativeCategory === 'all' ? '' : 'none'"),
  );

  // ④ 点物品 → 快捷栏上方的小说明
  check('有这块说明浮层', css.includes('#inv-pick-toast {') && invSrc.includes("this.pickToastEl.id = 'inv-pick-toast'"));
  check('说明锚在快捷栏上方', invSrc.includes('const anchor = dockVisible ? this.hotbarDock : this.hotbarGridEl;'));
  check('几秒后自己消失', invSrc.includes('PICK_TOAST_MS') && invSrc.includes('window.setTimeout(() => this.hidePickToast(), PICK_TOAST_MS)'));
  // 批次 181：2 秒 + 淡出；丢弃也给一条文字确认
  check('提示 2 秒后淡出', invSrc.includes('export const PICK_TOAST_MS = 2000;') && css.includes('#inv-pick-toast.leaving'));
  check('丢弃有文字确认', invSrc.includes('已丢弃'));
  check(
    '分类/页签点击也有说明（不只是物品格）',
    invSrc.includes('showMessage(`分类：') &&
      invSrc.includes('showMessage(`创造分类：') &&
      invSrc.includes("'右栏：合成'"),
  );
  // 点配方预览只显示名字，不再把预览清掉
  check('点合成区不再清空配方预览', !invSrc.includes('this.craftGhost && slot?.closest'));

  // 游戏内一行提示（批次 181）：与背包那块分开，2 秒 + 200ms 淡出
  const hudToastSrc = readFileSync(new URL('../src/ui/HudToast.ts', import.meta.url), 'utf8');
  check('游戏内提示停留 2 秒', hudToastSrc.includes('export const HUD_TOAST_MS = 2000;'));
  check('游戏内提示 200ms 淡出', hudToastSrc.includes('const FADE_MS = 200;'));
  check(
    '顶部视角键接了相机循环',
    readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').includes('onCycleCamera: () => {'),
  );
  check('关界面时收掉', invSrc.includes('this.hidePickToast();') && /finishClose\(\): void \{[\s\S]{0,400}hidePickToast/.test(invSrc));

  // ⑤ 选中 = 原格内显示 + 底色变深；不再有跟着光标飘的图标
  check('选中态是底色变深（且压住 hover）', css.includes('.inv-slot.selected,') && css.includes('--slot-bg-selected'));
  check(
    '手上那叠**画回来源格**而不是跟着光标飘',
    invSrc.includes('this.heldOriginEl = takeOnly ? null : binding.element;') &&
      invSrc.includes('this.renderInto(this.heldOriginEl, this.held);'),
  );
  // 只取不放的槽（熔炉产物）被取空是要产出下一件的，画回去会让人以为没取出来
  check('只取不放的槽不就地显示（用兜底那块）', invSrc.includes('takeOnly ? null : binding.element'));
  // 原来那块 `#inv-held` 是 position:fixed 却没有初始 left/top，触摸端轻点不产生
  // pointermove → 停在容器左上角（用户原话："图标会飘在左边"）
  check(
    '兜底那块图标按下时就写坐标（不再停在左上角）',
    /pointerdown'[\s\S]{0,400}heldElement\.style\.left = `\$\{pointer\.clientX\}px`/.test(invSrc),
  );
}

console.log('\n[携带版细节收口（二）（批次 159）]');
{
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const recipeSrc = readFileSync(new URL('../src/ui/RecipeBook.ts', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  // ① 左轨分类按钮点中后**一直保持按下**的样子
  check('分类按钮有选中态（斜面翻进去 + 底色亮一档）', css.includes('.inv-pocket-recipe-tab.active {'));
  check(
    '高亮跟着配方书当前那一栏走',
    invSrc.includes('private syncRecipeRail(active: RecipeBookTab | null): void {') &&
      recipeSrc.includes('get currentTab(): RecipeBookTab') &&
      mainSrc.includes('currentRecipeTab: () => this.currentRecipeTab()'),
  );

  // ② 配方开关不切分类 + 主程序把"只显示拥有的"接上
  check(
    '主程序接上"只显示我拥有的"的读与写',
    mainSrc.includes('isRecipeOwnedOnly: () => this.isRecipeOwnedOnly()') &&
      mainSrc.includes('onSetRecipeOwnedOnly: (on) => this.setRecipeOwnedOnly(on)'),
  );
  // ⚠️ 真出过一次：`applyInventoryChrome()` 在 InventoryScreen **构造函数**里就会跑
  //（建创造栏时），那时 `App.recipeBook` 还是 undefined，钩子里直接读它就崩在
  // "Cannot read properties of undefined (reading 'onlyOwned')"。
  const recipeHooks = mainSrc
    .split('\n')
    .filter((line) => /^\s+(isRecipesOpen|currentRecipeTab|isRecipeOwnedOnly|onSetRecipeOwnedOnly|onRecipeHost):/.test(line));
  check(
    '背包那些配方书钩子都走兜底包裹（构造期 recipeBook 还没建）',
    recipeHooks.length === 5 && recipeHooks.every((line) => !line.includes('this.recipeBook.')),
  );

  // ③ 选中效果：**底变白 + 边框加粗（相框）**，且**按下那一刻**就有
  check(
    '选中 = 底变白 + 相框式粗边框，按下就先给（触摸端抬手才结算）',
    css.includes('.inv-slot.pressing,') &&
      css.includes('--slot-bg-selected: #ffffff') &&
      // 用 box-shadow 叠粗，而不是改 border-width（后者会顶到隔壁、带着布局一起动）
      css.includes('0 0 0 4px #2b2b2b') &&
      invSrc.includes('private markPressing(slot: HTMLElement | null): void {'),
  );
  check(
    '创造栏取出的复制品放到已有物品的格子 = 覆盖（旧的销毁）',
    invSrc.includes('this.heldFromCreative && slot') && invSrc.includes('this.heldFromCreative = true;'),
  );
  // 从真实格子拿的仍然是**交换**，不能被复制品那条规则带偏
  check('真实格子拿的仍走交换', invSrc.includes('this.heldFromCreative = false;'));

  // ④ 触摸端整表滚动（右侧可见滚动条）、PC 底部翻页
  check(
    '配方书：触摸端滚动、PC 翻页',
    recipeSrc.includes('private get useScroll(): boolean') &&
      recipeSrc.includes('const pageSize = this.useScroll ? entries.length : this.panePageSize();'),
  );
  check('滚动条看得见（否则不知道下面还有）', css.includes('::-webkit-scrollbar-thumb') && css.includes('scrollbar-color:'));

  // ⑤ 右下角盔甲 / 合成只换右栏，左栏一动不动
  check(
    '切盔甲不再顺手关掉配方书（那是右栏的键在改左栏）',
    !invSrc.includes("if (tab === 'armor') this.hooks.onCloseRecipes?.();"),
  );
}

console.log('\n[左栏 = 物品分类（批次 159 三）]');
{
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  // ③ 左栏的职责是**物品分类**：默认只列我拥有的（仓库里的泥土就在它那个分类里）
  check(
    '左栏是"物品分类"而不是"配方"（状态收成一个 pane）',
    invSrc.includes("private pane: 'creative' | 'category' | 'items' = 'items';") &&
      invSrc.includes('const showCreativeItems = creative && this.pane === \'creative\';'),
  );
  check(
    '配方书开关：开=分类全部物品，关=能合成的 + 用过的缺料',
    invSrc.includes('private showUnowned = false;') &&
      invSrc.includes('if (this.showUnowned) return CREATIVE_ITEMS.filter(byCategory);') &&
      invSrc.includes('private readonly usedRecipeIds') &&
      invSrc.includes('this.usedRecipeIds.add(product.id);') &&
      css.includes('.inv-slot.locked {'),
  );
  // 分类栏最多 800 个 canvas，`refresh()` 每次都会走到排布 → 必须按指纹缓存
  // ⚠️ 缓存要带"自愈"：指纹没变但 DOM 空了（被别处清过）也必须重画，
  //    否则一次意外之后就永远是空白
  check(
    '分类栏按指纹缓存，且 DOM 空了会自愈',
    invSrc.includes('private inventoryStamp(): string {') &&
      invSrc.includes('if (key === this.categoryStamp && this.categoryGrid.childElementCount > 0) return;'),
  );

  // ⑤ 点分类里的物品（批次 206 改语义）：
  // 生存模式**不选中**（不把仓库成品拿到手上），只把配方画到右栏；
  // 创造模式才保留"拿一件复制品"的老行为。
  check(
    '生存点分类物品只预览配方、不产生选中态；按住滑动切换预览',
    invSrc.includes("private pickCategoryItem(itemId: number, mode: 'preview' | 'fill' = 'fill')") &&
      invSrc.includes('private beginCategoryScrub(') &&
      invSrc.includes('this.pickCategoryItem(itemId, \'preview\');') &&
      invSrc.includes('if (!cancel && !scrub.moved) this.pickCategoryItem(scrub.itemId, \'fill\');'),
  );
  check(
    '材料不齐时结果槽也画出产物（只读预览）',
    invSrc.includes('this.previewResult = { id: recipe.result.id, count: recipe.result.count };') &&
      invSrc.includes("classList.toggle('preview-result'") &&
      css.includes('.inv-slot.preview-result'),
  );
  check('创造模式仍可把物品拿到手上（复制品语义）', invSrc.includes('this.heldFromCreative = false;'));
  check(
    '抬手确认才把材料摆进合成格（滑动只预览）',
    invSrc.includes("if (mode === 'fill' && fillCraftingGrid(this.inventory, this.crafting, recipe))"),
  );
  {
    const ghostStart = invSrc.indexOf('private showRecipeGhost(');
    const ghostEnd = invSrc.indexOf('private clearCraftGhost(');
    const ghostBody = ghostStart >= 0 && ghostEnd > ghostStart ? invSrc.slice(ghostStart, ghostEnd) : '';
    check(
      '点材料区不再清空预览（空手时保持组成材料可见）',
      invSrc.includes("if (this.craftGhost && key !== 'craft:result' && key.startsWith('craft:'))") &&
        /craftGhost[\s\S]{0,200}if \(this\.held\) \{/.test(invSrc) &&
        ghostBody.length > 0 &&
        !ghostBody.includes('drainTo'),
    );
  }
  check(
    '提示条可以点一下立刻消失',
    invSrc.includes('this.pickToastEl.addEventListener(\'pointerdown\'') &&
      invSrc.includes('this.hidePickToast(true)') &&
      readFileSync(new URL('../src/ui/HudToast.ts', import.meta.url), 'utf8').includes('hide(): void {'),
  );
  // 创造模式下点物品同样要把配方摆出来
  // 批次 166 改口径：**创造模式根本不显示配方**（拥有所有方块，看配方没意义），
  // 点物品就只是"拿起它"——创造栏那个调用点保留，但 `showRecipeFor` 会提前返回
  check(
    '创造模式点物品不展示配方（showRecipeFor 先挡掉创造模式）',
    /private showRecipeFor\(itemId: number, mode: 'preview' \| 'fill' = 'fill'\): void \{[\s\S]{0,600}if \(this\.hooks\.isCreative\?\.\(\) \?\? false\) return;/.test(invSrc),
  );
  // 空槽不可选中：按下那一层"沉下去"只给有东西的格子
  // 空槽不给选中反馈（批次 184：红底那种"我没有的"同样不给，只闪一下）
  check(
    '空槽不给选中反馈',
    /if \(this\.tooltipStacks\.has\(slot\)\) \{[\s\S]{0,400}this\.markPressing\(slot\);/.test(invSrc),
  );
  // 丢物（批次 206）：面板空白与窗外暗色区域都丢；
  // 判据是"不在任何交互元素里"，而不是死认 target === root/shell。
  check(
    '点面板空白 / 窗口外 / 快捷栏两侧空白都丢出手上的整叠',
    invSrc.includes('private dropHeldStack(') &&
      !invSrc.includes('this.hotbarDock.contains(target)') &&
      invSrc.includes("if (target.closest('.inv-slot, button, input, .recipe-cell')) return;"),
  );
  check(
    '分类栏点击只给缩放反馈，不再套白色相框',
    /slot\.classList\.contains\('category-slot'\) \|\| slot\.classList\.contains\('locked'\)/.test(invSrc) &&
      css.includes('.inv-slot.tapped { animation: inv-locked-tap'),
  );
  // 材料不齐 → 把配方**画**进合成格，缺的那件红底（格子里是预览不是实物）
  check(
    '材料不齐时把配方画进合成格，缺的红底',
    invSrc.includes('private showRecipeGhost(recipe: Recipe): void {') &&
      invSrc.includes('private renderCraftGhost(): void {') &&
      css.includes('.inv-slot.ghost-missing {'),
  );
  // R 键：背包开着时切的是分类栏，不再顶出一整屏配方书
  check(
    'R 键在背包开着时切分类栏',
    mainSrc.includes('this.inventoryScreen.toggleCategoryPane();') && invSrc.includes('toggleCategoryPane(): void {'),
  );

  // ② 禁掉 HTML 自带的长按效果（长按是我们的手势）
  check('长按不再是"保存图片"（contextmenu 在触摸端也要屏蔽）', /contextmenu'[\s\S]{0,400}preventDefault/.test(mainSrc));
  check('画布与界面整体关掉 touch-callout / 选中', css.includes('-webkit-touch-callout: none;') && css.includes('user-select: none;'));
  // 输入框要留着能粘贴
  check('输入框例外（还能长按粘贴）', css.includes('-webkit-user-select: text;'));
}

console.log('\n[分类栏"怎么就空了"（批次 159 六）]');
{
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  // ① 创造栏 800 多个格子**不能**每次 refresh 都重建：重建期间整栏是空的，
  //    连点几下就是"分类栏怎么全空了"
  check(
    '创造栏按指纹缓存（800 个格子不再每次搬东西都重画）',
    invSrc.includes('private creativeStamp'),
  );
  check(
    '指纹里带着分类 / 搜索词 / 页码 / 页大小，且空了会自愈',
    invSrc.includes('if (key === this.creativeStamp && this.creativeGrid.childElementCount > 0) return;'),
  );
  // ② 看不见的过滤器：换到不显示搜索框的分类时要把搜索词清掉
  check(
    '换分类时清掉藏起来的搜索词',
    invSrc.includes("if (category !== 'all') {") && invSrc.includes("this.creativeQuery = '';") && invSrc.includes("this.categoryQuery = '';"),
  );
  // ③ 竖排容器里搜索框不能吃剩余高度（会把网格挤出可视区）
  check('分类栏搜索框 flex: 0 0 auto', css.includes('.inv-category-section .inv-search {') && css.includes('flex: 0 0 auto;'));
  // ④ 重建整批格子时顺手把它们在 tooltipStacks 里的条目删掉（否则只增不减）
  check('重建时清掉旧格子的提示数据', invSrc.includes('this.tooltipStacks.delete(child as HTMLElement)'));
}

console.log('\n[合成产物直接进背包（批次 160）]');
{
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const inv = readFileSync(new URL('../src/core/container/Inventory.ts', import.meta.url), 'utf8');

  check(
    '点产物不再挂到光标上，而是直接收进背包',
    invSrc.includes('const leftover = this.inventory.addStack(taken);') &&
      !invSrc.includes('if (!this.held) this.held = taken;'),
  );
  // 填充顺序必须是"快捷栏 → 主仓库"：`addStack` 按槽位下标走，且不碰盔甲槽
  check(
    '先快捷栏再主仓库（AUTO_FILL_SLOTS 截止在盔甲槽之前）',
    inv.includes('export const AUTO_FILL_SLOTS = ARMOR_SLOT_BASE;'),
  );
  check(
    '两边都满了就掉在脚边（与"背包放不下"同一套）',
    invSrc.includes('if (leftover > 0) this.hooks.onDrop?.(taken.id, leftover);'),
  );
}

console.log('\n[丢出口袋要在拾取范围之外（批次 161）]');
{
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const itemSrc = readFileSync(new URL('../src/core/entity/ItemEntity.ts', import.meta.url), 'utf8');

  // 站在原地点"界面外丢出"时，东西原来就丢在自己脚下：0.5 秒冷却一过就被自己吸回去
  check('掉落物有 0.5 秒拾取冷却（所以不能丢在脚下）', itemSrc.includes('const PICKUP_DELAY = 0.5;'));
  check(
    '丢到身前 1.5 格（在"碰撞盒 + 0.7"那圈拾取范围之外）',
    mainSrc.includes('private static readonly DROP_AHEAD = 1.5;') &&
      mainSrc.includes('private dropInFrontOfPlayer(itemId: number, count: number): void {'),
  );
  check('朝向复用 lookDirection 的水平分量（不另抄一份三角函数）', mainSrc.includes('const [dirX, , dirZ] = PlayerPhysics.lookDirection(this.yaw, this.pitch);'));
}

console.log('\n[浅底按钮用深色字（批次 162）]');
{
  const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  // 统一按钮那套给的是浅色文字（--btn-text = #e0e0e0），而背包这几颗是浅底；
  // 选中时底变成 #dcdec4，浅色字就彻底看不见了
  check('统一按钮的默认文字是浅色（所以要单独盖掉）', css.includes('--btn-text: var(--mc-text-light);'));
  check(
    '背包里的浅底按钮统一用深色字',
    /\.inv-recipes-btn,\s*\n\s*\.inv-page-button,\s*\n\s*\.inv-tab,\s*\n\s*\.inv-pocket-recipe-tab,\s*\n\s*\.recipe-close \{\s*\n\s*color: #2b2b2b;/.test(css),
  );
}

console.log('\n[创造模式不给配方入口（批次 163）]');
{
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');

  check(
    '创造模式下标题栏那颗配方按钮整颗藏掉（不只是"创造物品"那一栏）',
    invSrc.includes("this.recipesBtn.classList.toggle('hidden', creativePlayer);") &&
      !invSrc.includes("this.recipesBtn.classList.toggle('hidden', showCreativeItems);"),
  );
  check(
    '创造模式下左轨那排配方分类也不给',
    invSrc.includes('if (!creativePlayer) {') &&
      invSrc.includes("this.pocketRecipeBar.classList.toggle('hidden', !this.hooks.onOpenRecipes);"),
  );
  // 批次 164：工作台在创造模式里**不摊配方分类**，就只是"3×3 + 仓库"拿来合成
  // 批次 181：创造模式左轨**始终**挂创造分类（切到个人仓库也不搬走）
  check(
    '创造模式的工作台不摊配方分类',
    invSrc.includes("if (mode === 'crafting' && !(this.hooks.isCreative?.() ?? false)) this.openPocketCategory('all');") &&
      invSrc.includes('this.syncCreativeRails(creativePlayer)'),
  );
  // "有没有配方书"按**玩家模式**判，不按"当前哪一屏"判——工作台里人也还在创造模式
  check(
    '配方入口按 creativePlayer 判（不是按当前界面）',
    invSrc.includes('const creativePlayer = this.hooks.isCreative?.() ?? false;') &&
      invSrc.includes('const creative = creativePlayer;'),
  );
}

console.log('\n[分类栏永远空：detachRecipeBook 顺手把它藏了（批次 165）]');
{
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');

  // ⚠️ 真事故：`detachRecipeBook()` 是批次 157 留下的（那时这个元素还是"配方书落脚点"），
  // 里面有一句 `categoryHostEl.style.display = 'none'`；而 `applyInventoryChrome()`
  // 恰好**先显示分类栏、后调 detachRecipeBook** → 刚显示就被藏掉，
  // 生存模式点分类**永远是空的**（连着几轮都以为是数据源的问题）。
  check(
    'detachRecipeBook 不再顺手把分类栏藏掉',
    !/detachRecipeBook\(\): void \{[\s\S]{0,200}categoryHostEl\.style\.display/.test(invSrc),
  );
  check(
    '分类栏的显隐只由 leftPane 决定',
    invSrc.includes("this.categoryHostEl.style.display = leftPane === 'category' ? 'flex' : 'none';"),
  );
  // 批次 184（用户要求）：配方开关关着时空栏**留白**，不再写"这一栏里你还没有东西…"。
  // 只有确实存在筛选条件（搜索词、或"显示全部"）时才需要解释为什么空着。
  check(
    '配方开关关着时空栏留白（有筛选条件时才解释）',
    invSrc.includes('if (this.categoryQuery.length > 0 || this.showUnowned) {') &&
      !invSrc.includes('背包里共 ${this.ownedItemIds().length}'),
  );
}

console.log('\n[玩家预览占位（批次 141）]');
{
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const previewSrc = readFileSync(new URL('../src/ui/PlayerPreview.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const playerSrc = readFileSync(new URL('../src/render/PlayerRenderer.ts', import.meta.url), 'utf8');

  check('有 PlayerPreview 模块', previewSrc.includes('export function drawPlayerPreview'));
  check('色板与 PlayerRenderer 同源（肤色）', previewSrc.includes('#dc9a6b') && playerSrc.includes('0xdc9a6b'));
  check('界面挂了 preview canvas', invSrc.includes("dataset.role = 'player-preview'"));
  check('refresh 会重画预览', invSrc.includes('refreshPlayerPreview()'));
  // 批次 185：改成循环取四个槽（`[0,1,2,3].map(...)`），断言落在"确实读了 4 个"
  check(
    '预览读四个盔甲槽',
    invSrc.includes('const armorIds = [0, 1, 2, 3].map((offset) => this.inventory.get(ARMOR_START + offset)?.id ?? null);'),
  );
  check('预览 CSS 在', css.includes('.inv-player-preview'));
  check('注释写明是占位不是真皮肤', previewSrc.includes('不是可换皮肤') || previewSrc.includes('不假装有真皮肤'));
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

  // ⑤ 离开世界（批次 181）：守卫要收回去，否则主菜单的返回先退到一条假记录
  const leaving = makeHarness(1);
  leaving.back.sync(true);
  leaving.back.reset();
  equal('离开世界时把压在历史里的守卫退掉', leaving.log.join(','), 'push,back');
  equal('reset 之后不再守卫', String(leaving.back.isGuarded), 'false');
  leaving.back.reset();
  equal('重复 reset 不会再退一条历史（幂等）', leaving.log.join(','), 'push,back');

  // ⑥ 常驻根守卫（批次 181）：局内**没有面板**时按返回也要先落到我们手里
  const root = makeHarness(0);
  root.back.armRoot();
  equal('进世界时压一条常驻守卫', root.log.join(','), 'push');
  root.back.sync(true);
  root.back.sync(false);
  equal('界面的开/关不再增删历史（守卫常驻）', root.log.join(','), 'push');
  root.back.onBrowserBack();
  equal('无面板时返回也由我们处理，并补回守卫', root.log.join(','), 'push,close,push');
  root.back.reset();
  equal('拆局时把常驻守卫退掉', root.log.join(','), 'push,close,push,back');
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
    ['上升键画 ▲', ".touch-button.fly-up::after { content: '▲';"],
    ['下降键画 ▼', ".touch-button.fly-down::after { content: '▼';"],
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
  equal('基岩版创造栏只有五个顶层分类', CREATIVE_TABS.join(','), 'all,building,equipment,items,nature');
  equal('每个分类都配了图标（漏一个就是界面上一个空白标签）', missingTabIcons(CREATIVE_TABS).join(','), '');
  const categories = Object.keys(CREATIVE_TAB_ICONS) as (keyof typeof CREATIVE_TAB_ICONS)[];
  equal('图标表没有多余项（多一个说明分类被删了但图标没跟着删）', String(categories.length), String(CREATIVE_TABS.length));

  const tiles = new Set<string>(TILE_ORDER);
  const bad: string[] = [];
  for (const category of CREATIVE_TABS) {
    const itemId = CREATIVE_TAB_ICONS[category];
    // 图标必须是**真实存在的物品**，而且它那张贴图得在图集里（否则标签上是一片空白）
    if (!itemDef(itemId)) {
      bad.push(`${category}:物品不存在`);
      continue;
    }
    if (!tiles.has(itemIconTile(itemId))) bad.push(`${category}:贴图不在图集`);
  }
  check('图标的物品都存在、贴图都在图集里', bad.length === 0, bad.join(', '));
  check(
    '创造物品都能归入五个顶层分类',
    CREATIVE_ITEMS.every((itemId) => CREATIVE_TABS.includes(creativeTabFor(itemId))),
  );

  // CSS：窄屏只留图标，宽屏图标 + 文字
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
  check(
    '右下：上升/跳跃/下降三颗（飞行前 CSS 藏升降）',
    source.includes('buttons.append(this.flyUpButton, this.jumpButton, this.flyDownButton)'),
  );
  check('背包挂进快捷栏（不参与那 9 格的宽度计算）', source.includes("document.getElementById('hotbar')"));
  check(
    '顶部三键：暂停 / 视角 / 聊天（批次 181）',
    source.includes('pauseBar.append(this.pauseButton, viewButton, chatButton)'),
  );
  check('聊天不再挂在快捷栏左侧', !source.includes("'touch-hotbar-chat'"));
  check('触摸层里不再有"飞行"按钮（已搬进设置面板）', !source.includes("makeIconButton('fly'"));
  check('视角按钮回到顶部（批次 181，与设置里的视角项共用循环）', source.includes("makeIconButton('view'"));
  // 批次 181：删掉 140ms 的"按住连续放置"（它会抢在长按破坏之前），只留一个长按阈值
  check('只有一个长按阈值（280ms）', source.includes('const LONG_PRESS_MS = 280'));
  check('连续放置已删除（不再有 PLACE_HOLD_MS / onPlaceHoldStart）', !source.includes('PLACE_HOLD_MS') && !source.includes('onPlaceHoldStart'));
  check('轻点与长按分工写在注释里', source.includes('轻点') && source.includes('破坏 / 持续攻击'));
  // 批次 219：进食/举盾/拉弓"按下即生效"，不再等那 280ms 长按判定。
  // 读手势状态而不是回调置位的布尔量——后者在"按下被界面抢走指针"时会卡在 true
  check(
    '触摸层暴露 holding（按下且未拖动）',
    source.includes('get holding(): boolean') && source.includes('return this.lookPointer !== null && !this.lookDragged;'),
  );

  // 轻点落在生物上要"攻击优先"，不能顺手把方块放到它身上
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check(
    'usingItem 在触摸端走"按下即使用"（不等 280ms 长按阈值）',
    mainSource.includes('return this.leftDown || this.touch.holding;'),
  );
  check(
    '进食时长按设置取档（原版 1.6 / 快速 1.0）',
    mainSource.includes('eatSecondsFor(this.settings.fastEat)'),
  );
  check(
    '轻点先判生物：点到生物 → 一次性攻击请求，否则才放置/交互',
    mainSource.includes('const tapped = this.mobAtScreen(clientX, clientY);') &&
      mainSource.includes('if (tapped) this.tapAttackRequest = true;'),
  );
  check(
    '屏幕坐标反投影成射线选生物（不用准星对准）',
    mainSource.includes('private mobAtScreen(clientX: number, clientY: number): Mob | null') &&
      mainSource.includes('ndc.unproject(this.camera)'),
  );
  check(
    '一次性攻击请求由 updateAttacking 统一消费（冷却/暴击/附魔不分叉）',
    mainSource.includes('const tapped = this.tapAttackRequest'),
  );
  // 切模式/开关界面/失焦时要清手势，否则另一根手指的旧基准会把摇杆和视角带歪
  check('切飞行前清手势', mainSource.includes("this.touch?.resetInput('flying')"));
  check('界面开关与失焦也清手势', mainSource.includes("'ui.open' : 'ui.close'") && mainSource.includes("resetInput('blur')"));

  // 模式与飞行分开（批次 181）：老存档按 flying 迁移，新世界在表单里选
  check('老存档迁移：flying=true 视为创造', mainSource.includes("else if (data.flying) this.setGameMode('creative')"));
  check('生存模式拒绝起飞（能力看模式）', mainSource.includes('if (value && !this.isCreative)'));
  const worldSource = readFileSync(new URL('../src/ui/WorldScreen.ts', import.meta.url), 'utf8');
  check('新建世界表单有"游戏模式"', worldSource.includes("'游戏模式'") && worldSource.includes('gameModeSelect'));
  check(
    '首页显示构建时间与提交标题（批次 182）',
    worldSource.includes("build.id = 'world-build'") &&
      worldSource.includes('formatBuildInfo(readBuildInfo())') &&
      readFileSync(new URL('../index.html', import.meta.url), 'utf8').includes('.world-build {'),
  );
  check(
    '世界类型下面有"到底有什么"的说明（超平坦会警告）',
    worldSource.includes('WORLD_TYPE_HINTS') &&
      worldSource.includes('private updateTypeHint') &&
      worldSource.includes('生存模式建议改选默认世界'),
  );
  {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    check('原生下拉声明深色（不再白底弹窗）', html.includes('color-scheme: dark;'));
    check('世界类型说明样式在', html.includes('.world-type-hint {') && html.includes('.world-type-hint.bad'));
  }
  check('双击摇杆切换潜行（右手只留跳跃）', source.includes('lastStickDown') && source.includes('双击摇杆'));
  check('飞行态用 applyFlyChrome 露出升降键', source.includes('private applyFlyChrome') && source.includes('fly-only'));

  // 搬走之后必须**在设置里有对应入口**，否则这两项在手机上等于消失
  const settingsSource = readFileSync(new URL('../src/ui/SettingsScreen.ts', import.meta.url), 'utf8');
  check(
    '设置面板有"游戏模式"与"飞行"两个开关（批次 181 拆开）',
    settingsSource.includes("'游戏模式'") &&
      settingsSource.includes("'飞行'") &&
      settingsSource.includes('private makeCreativeRow') &&
      settingsSource.includes('private makeGameModeRow'),
  );
  check('设置面板里的"视角"下拉还在', settingsSource.includes("this.makeSelect(controls, 'cameraMode', '视角'"));
  check(
    '飞行开关不写进 localStorage（它是世界里的状态，不是设备偏好）',
    !settingsSource.includes("key: 'flying'") && settingsSource.includes('private makeCreativeRow'),
  );

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');
  check(
    '触摸端背包面板收进视口（吃 --panel-*，再用 vw/dvh 夹紧）',
    compact.includes('body.touch-mode .inv-panel {') &&
      compact.includes('min(96vw, var(--panel-w))') &&
      compact.includes('min(86dvh, var(--panel-h))'),
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
  check(
    '退一层收在 goBack() 里（游戏内回菜单、主菜单设置直接关）',
    source.includes('goBack(): boolean') &&
      source.includes("this.setPage('menu');") &&
      source.includes('this.actions.onResume();'),
  );
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
  check('首页品牌信号是 MINECRAFT + 基岩版标识', source.includes("logo.textContent = 'MINECRAFT';") && source.includes('world-edition'));
  check('世界列表按视图展开并带缩略图', source.includes("this.panel.dataset.view = view;") && source.includes('world-card-thumb'));
  check('新建世界返回世界列表（不是跳回首页）', source.includes("this.makeNav('创建新世界', () => this.setView('worlds'))"));
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
    compact.includes('--panel-w: min(94vw, 760px);') && compact.includes('--panel-h: min(88dvh, 620px);'),
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
  check('删除世界只在世界列表，暂停菜单不放不可逆删除', !source.includes("deleteWorld.textContent = '删除本世界';"));
  check(
    '主菜单设置按返回直接关闭（不会露出「游戏已暂停」）',
    source.includes('if (this.actions.onExitToMenu)') && source.includes('this.actions.onResume();'),
  );

  // 固定高度之后"四组一次全展开"放不下了 → 三端统一"左选项卡 + 右内容、一次一组"
  check('三端统一：左选项卡 + 右内容', compact.includes('.settings-columns { display: flex; flex-direction: row; gap: 12px;'));
  check(
    '一次只显示当前分组（固定高度下永远不用滚）',
    compact.includes('.settings-section { display: none; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));'),
  );
  // 批次 167：用户"视频里面这个选项里面有多个按钮，只是很短的空间，可以适当让它们并排"
  check(
    '分组内容两列并排（窄屏自动退回一列）',
    compact.includes('.settings-section.active { display: grid; }') &&
      compact.includes('grid-template-columns: repeat(auto-fit, minmax(230px, 1fr))'),
  );
  check(
    '滑杆这类"越长越好用"的行跨满两列',
    compact.includes('.settings-row.wide { grid-column: 1 / -1; }') &&
      source.includes("row.className = 'settings-row wide';"),
  );
  // 诊断日志（批次 181）：入口在设置里，读数与按钮挤一行且不许撑破
  check('诊断日志入口在设置里', source.includes('诊断日志') && source.includes('makeDiagnosticsRow'));
  // 批次 220（用户）：只保留「导出」——打点与复制对玩家不产出额外信息
  check(
    '诊断日志只留导出（不再有记录问题 / 复制）',
    source.includes("make('导出'") && !source.includes("make('记录问题'") && !source.includes("make('复制'"),
  );
  check(
    '诊断读数放不下时省略（不撑破设置行）',
    compact.includes('.diag-block {') &&
      compact.includes('.diag-status {') &&
      compact.includes('text-overflow: ellipsis;'),
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
  check('横屏：主菜单 logo 缩小、按钮高度统一到 44px', landscape.includes('body.touch-mode .world-logo { font-size: 42px; }') && landscape.includes('body.touch-mode .world-primary { min-height: 44px;'));
}

console.log('\n[按钮尺寸对齐（批次 111）]');
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');
  // 背包那一块（批次 111）：装备竖排在左、主背包/快捷栏在右，且**不再有文字标签**
  check(
    '背包改"左装备 / 右背包"两列',
    compact.includes('.inv-body { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; }') &&
      // 批次 141：gear 里加了预览 canvas，规则拆成多行（flex 横排盔甲+小人）
      compact.includes('.inv-gear {') &&
      compact.includes('grid-column: 1; grid-row: 1;') &&
      compact.includes('.inv-main { grid-column: 2; grid-row: 1;'),
  );
  check('装备格竖排成一一列（原版位置）', compact.includes('.inv-grid.inv-armor { grid-template-columns: 42px; }'));
  check('快捷栏与主背包之间留一道缝', compact.includes('.inv-main .inv-hotbar { margin-top: 5px; }'));
  // 成就 / 配方书 / 设置 / 主菜单：直接吃 --panel-*；触摸背包用 min(vw/dvh, --panel-*) 夹紧
  // （批次 167：主菜单也并进来了——用户"首页两个按钮点下去应该是同一个固定大小的框"）
  check(
    '成就/配方书/设置/主菜单共用同一套固定尺寸',
    (compact.match(/width: var\(--panel-w\); max-width: var\(--panel-w\);/g) ?? []).length === 4,
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
  // ⚠️ 批次 167 改了口径：盒子统一到 `--panel-w` 之后，按钮**不能**再拉满
  //    （760px 一条长条既不像原版那一列，也和二级页对不上），所以宽度收到 320 居中、
  //    首页/世界列表/新建世界共用同一条规则。
  check('首页按钮不再被单独收窄', !compact.includes('.world-menu > * { width'));
  check(
    '主菜单主按钮同宽居中（320px，首页与二级页共用一条规则）',
    compact.includes('.world-primary, .world-secondary { width: min(100%, 320px); max-width: 320px;'),
  );
  check(
    '主菜单三视图共用同一个盒子（不再按视图各写一套宽度）',
    compact.includes('.world-panel { position: relative; z-index: 1; width: var(--panel-w); max-width: var(--panel-w); height: var(--panel-h); max-height: var(--panel-h);') &&
      !compact.includes(".world-panel[data-view='worlds'] { width:") &&
      !compact.includes(".world-panel[data-view='create'] { width:"),
  );
  check(
    '首页不加框、二级页与设置用同一副深色框',
    compact.includes(".world-panel[data-view='worlds'], .world-panel[data-view='create'] { padding: 14px 16px; background: rgba(22, 22, 22, .82);") &&
      !compact.includes(".world-view[data-view='home'] { padding: 14px"),
  );
  check(
    '新建世界表单两列并排（长编辑框不再一条占一行）',
    compact.includes('grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))') &&
      compact.includes('.world-new > .world-primary { grid-column: 1 / -1; }'),
  );
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

  const fullscreenSrc = readFileSync(new URL('../src/ui/Fullscreen.ts', import.meta.url), 'utf8');
  const manifest = readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8');
  const htmlHead = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check('第一次点击同时请求全屏和横屏锁', fullscreenSrc.includes('enterMobilePresentation') && fullscreenSrc.includes("orientation.lock('landscape')"));
  check('竖屏触摸设备有横屏提示，点它就是那一次手势', fullscreenSrc.includes('installRotateHint') && htmlHead.includes('rotate-hint'));
  check('manifest 以横屏全屏打开', manifest.includes('"orientation": "landscape"') && manifest.includes('"display": "fullscreen"'));
  check('微信/QQ 的 X5 内核一打开就横屏全屏', htmlHead.includes('x5-orientation') && htmlHead.includes('content="landscape"') && htmlHead.includes('x5-fullscreen'));
  check(
    '手机进游戏后不再把“视距没涨完”当成启动期光照',
    mainSrc.includes('isTouchDevice() ? !this.loadingCleared : !this.loadingCleared || !this.startupRamp.done'),
  );

  // ---- 批次 167：用户"能不能在加载的时候自动进入（全屏横屏）"
  //
  // 浏览器规范要求手势，所以这里能钉死的是三件事：① boot 里**真的试着**要了一次；
  // ② 被拒时那网挂在 `document` 的捕获阶段、并且覆盖点击/触摸/键盘；
  // ③ 没装成 PWA 时有一条"添加到主屏幕"的引导（那是唯一零点击的路径）。
  check('boot 里会主动尝试全屏（PWA / X5 内核下真的成立）', mainSrc.includes('enterFullscreenOnBoot();'));
  check(
    '自动尝试那一步也在切回前台时补一次',
    fullscreenSrc.includes("doc.addEventListener('visibilitychange'") && fullscreenSrc.includes('doc.visibilityState'),
  );
  check(
    '一次性手势网挂在 document 的捕获阶段（点任何地方都算第一次交互）',
    mainSrc.includes('armAutoFullscreen([document]);') &&
      fullscreenSrc.includes("['pointerdown', 'touchstart', 'keydown']") &&
      fullscreenSrc.includes('addEventListener(type, trigger, true)'),
  );
  const installSrc = readFileSync(new URL('../src/ui/InstallHint.ts', import.meta.url), 'utf8');
  check(
    '没装成 PWA 时引导一次"添加到主屏幕"（标签页里唯一零点击全屏的路径）',
    installSrc.includes("beforeinstallprompt") &&
      installSrc.includes('event.preventDefault()') &&
      installSrc.includes('isStandalone()') &&
      mainSrc.includes('installInstallHint();'),
  );
  check(
    '引导关掉之后记住（不会每次开都弹）',
    installSrc.includes("localStorage.setItem(DISMISS_KEY, '1')") && installSrc.includes('readDismissed()'),
  );
  check('引导的样式与层级在 index.html 里（压在主菜单之上、设置之下）', htmlHead.includes('.install-hint {') && htmlHead.includes('z-index: 46'));
  // 批次 184：键盘只能缩**视觉**视口（resizes-visual）。resizes-content 会把布局
  // 视口一起缩矮，点一下聊天框整块 3D 画面就被压一下。
  check(
    'viewport 用交互键盘不缩排版的写法（resizes-visual）',
    htmlHead.includes('interactive-widget=resizes-visual') && !htmlHead.includes('interactive-widget=resizes-content'),
  );
}

console.log('\n[加载遮罩只属于"进世界"（批次 167）]');
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const overlaySrc = readFileSync(new URL('../src/ui/LoadingOverlay.ts', import.meta.url), 'utf8');

  // 用户："首次加载这个页面的时候，它会显示一个'地图生成中'的东西，能不能一开始不需要？
  // 因为地图生成是在创建游戏的时候才生成的。"
  check(
    'index.html 里不再写死加载遮罩（否则首屏就会显示"正在生成世界…"）',
    !/<div id="loading"/.test(html),
  );
  // 样式还在（`test:theme` 也盯着 loading-sweep），只是"什么时候挂"改成了按需
  check('遮罩的样式还留着（按需创建仍然要它）', html.includes('#loading {') && html.includes('@keyframes loading-sweep'));
  check(
    'main.ts 里只有一处 showLoading（boot 自己的流程一次都不挂）',
    (mainSrc.match(/^\s*showLoading\(/gm) ?? []).length === 1,
  );
  check(
    '进世界那一刻才挂遮罩',
    /const startWorld = async[\s\S]*?showLoading\(WORLD_LOADING_TEXT\)/.test(mainSrc),
  );
  check(
    '遮罩撤掉时整块移除（验收脚本按 getElementById 判）',
    overlaySrc.includes('getElementById(LOADING_ID)?.remove()'),
  );
  // Node 里没有 document：这两个函数必须安静退化，而不是抛
  let safe = true;
  try {
    showLoading('x');
    hideLoading();
  } catch {
    safe = false;
  }
  check('没有 document 时 show/hide 不抛', safe && !isLoadingVisible());
}

console.log('\n[物品与配方书的交互（批次 132，按中文 Wiki「物品栏」）]');
{
  const inventorySrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const quickMoveSrc = readFileSync(new URL('../src/core/container/QuickMove.ts', import.meta.url), 'utf8');
  const bookUi = readFileSync(new URL('../src/ui/RecipeBook.ts', import.meta.url), 'utf8');
  const creativeSrc = readFileSync(new URL('../src/ui/CreativeTabs.ts', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const settingsSrc = readFileSync(new URL('../src/ui/SettingsScreen.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');

  // ---- 配方书：点一格 = **把材料摆进合成格**（原版主交互）
  check('配方书的动作接口有 onFill（摆进合成格）', bookUi.includes('onFill: (recipe: Recipe) => boolean'));
  check('一格配方标了 dataset.role（验收脚本要能找到它）', bookUi.includes("cell.dataset.role = 'fill'"));
  check('能点的格子才给 fillable（有按下/悬停反馈）', bookUi.includes("cell.classList.add('fillable')") && compact.includes('.recipe-cell.fillable:active'));
  check(
    '3×3 配方只在工作台可点（可用网格尺寸来自当前界面）',
    bookUi.includes('gridSize: () => 2 | 3') &&
      bookUi.includes('entry.gridSize <= this.actions.gridSize()') &&
      mainSrc.includes("currentMode === 'crafting' ? 3 : 2"),
  );
  check(
    '进入工作台后 3×3 配方不再误报“需要工作台”',
    bookUi.includes('entry.gridSize > this.actions.gridSize()'),
  );
  // 一键做完改成 Shift+点：原版没有"合成"按钮这条路径，不该再占用版面
  check('一键做完改成 Shift+点（版面里没有这颗按钮）', bookUi.includes('event.shiftKey') && !compact.includes('.recipe-craft {'));
  check('main 把 onFill 接上了', mainSrc.includes('onFill: (recipe) => this.fillFromBook(recipe)'));
  // 批次 144：经典侧栏与携带版合成页都是并排，背包开着时配方书一律不关
  check(
    '背包开着时摆配方不关配方书（只重算）',
    /private fillFromBook[\s\S]{0,400}inventoryScreen\.isOpen[\s\S]{0,200}this\.recipeBook\.render\(\)/.test(mainSrc),
  );
  check(
    '背包已关才收起配方书',
    /private fillFromBook[\s\S]{0,600}this\.recipeBook\.hide\(\)/.test(mainSrc),
  );
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
  // ---- 批次 136 逐条对 Wiki 原文时抓出来的两处**行为**偏差（不是"函数存在"就算数）
  {
    // 位置断言：这一支必须**落在右键那一块里**，且后面紧跟"放下 + 拿起"（= 交换）
    const rightBlock = inventorySrc.indexOf('if (button === 2) {');
    const swapBranch = inventorySrc.indexOf('slot.id !== this.held.id');
    check(
      '右键点在"放着别的东西"的格子上同样是**交换**（Wiki：点击**左右键**时…两者交换）',
      rightBlock >= 0 && swapBranch > rightBlock &&
        inventorySrc.slice(swapBranch, swapBranch + 700).includes('this.held = slot;'),
      `right@${rightBlock} swap@${swapBranch}`,
    );
  }
  check(
    '拖拽经过的格子只记一次（Wiki：每个格子只会被影响一次，原路返回无法取消）',
    inventorySrc.includes('this.dragSlots.some((slot) => slot.source === source && slot.index === index)) return;'),
  );
  // ---- 批次 136 复核通过的那几条（钉住，别以后被改掉）
  check('右键取半数、且是**向上取整**（Wiki：半数（向上取整））', inventorySrc.includes('Math.ceil(slot.count / 2)'));
  // 批次 160 改口径：点产物**直接进背包**（先快捷栏、再主仓库、都满了掉脚边），
  // 不再"先挂到光标上"——"做好了还要再找地方放"不是玩家想要的
  check(
    '合成产物直接进背包（不再挂光标）',
    inventorySrc.includes('const leftover = this.inventory.addStack(taken);'),
  );
  check(
    'Shift+点产物 = 一次做完，终止条件是"背包塞不下 / 材料用完"',
    /handleResultClick\(shift = false\)[\s\S]{0,700}fitCount\(next, this\.inventory, PLAYER_FILL_ORDER\) < next\.count\) break;/.test(inventorySrc),
  );
  check(
    '容器 → 玩家背包优先**快捷栏最靠左**（基岩版那条，与 Java 版相反）',
    quickMoveSrc.includes('PLAYER_FILL_ORDER = [...HOTBAR_ORDER, ...MAIN_ORDER]') ||
      quickMoveSrc.includes('export const PLAYER_FILL_ORDER: readonly number[] = [...HOTBAR_ORDER, ...MAIN_ORDER];'),
  );
  check('Q 丢 1 件 / Ctrl+Q 丢整叠，且作用在悬停的那一格', inventorySrc.includes("dropFromCursor(event.ctrlKey || event.metaKey)"));
  // 这几条原版规则本来就在（钉住，防止以后被改掉）
  check('右键点格子拿一半', inventorySrc.includes('button === 2') || inventorySrc.includes('halfOf'));
  check('Shift+左键 = 快速移动', inventorySrc.includes('this.quickMoveSlot(key)'));
  check('双击 = 收集同类', inventorySrc.includes('this.gatherFrom(binding)'));
  check('拖拽分配 / 每格一个', inventorySrc.includes('distributeEvenly(this.held, slots)') && inventorySrc.includes('placeOneEach(this.held, slots)'));
  // 基岩版那条"双击已满一组/无同类可补/不可堆叠 → 快速移动"（批次 133）
  check('双击在三种情形下退化成快速移动', inventorySrc.includes('private shouldQuickMoveOnDouble('));
  check(
    '退化判断在 gatherFrom **之前**（否则物品已经被抓到光标上了）',
    inventorySrc.indexOf('this.shouldQuickMoveOnDouble(binding)') < inventorySrc.indexOf('this.gatherFrom(binding)) return;'),
  );

  // ---- 配方书：标签栏 + 「仅显示可合成」（批次 133，Wiki「物品栏 → 配方书」）
  check('配方书按标签栏分行', bookUi.includes('for (const tab of recipeBookTabsFor())'));
  check(
    '页签的先后只有一套（携带版：全部在最前）',
    bookUi.includes('button.style.order = String(order.indexOf(tab))'),
  );
  // 批次 157：不再有"跨过断点重画"——页签顺序与视口宽度无关
  check('不再按视口宽度重排页签', !bookUi.includes('isClassicUi') && !bookUi.includes('handleResize'));
  check('页签上带条数（免得点进去才发现是空的）', bookUi.includes('RECIPE_BOOK_TAB_LABELS[tab]}（${counts.get(tab) ?? 0}）'));
  check('有「仅显示可合成」筛选', bookUi.includes("this.filterButton.dataset.role = 'craftable-filter'"));
  check('筛选默认关（默认藏掉大半会让人以为配方丢了）', bookUi.includes('private onlyCraftable = false'));
  check('空列表会说清为什么空（是筛掉了还是这一栏本来就没有）', bookUi.includes('关掉「仅显示可合成」可以看到全部'));
  check('标签栏与筛选按钮的样式在（含选中态）', compact.includes('.recipe-tabs {') && compact.includes('.recipe-tab.active, .recipe-filter.on'));

  // ---- 版面：基岩版经典 UI 那一屏（批次 135，用户给的截图）
  check('配方列表是**产物图标网格**（不是卡片列表）', compact.includes('.recipe-grid {') && !compact.includes('.recipe-card {'));
  check('网格的每一格带产物图标与数量徽章', bookUi.includes("badge.className = 'recipe-cell-count'") && compact.includes('.recipe-cell-count {'));
  check(
    '生存材料不足的配方用红底表示仅展示配方',
    bookUi.includes("classList.add(entry.craftable ? 'on' : 'locked')") &&
      compact.includes('.recipe-cell.locked {') &&
      compact.includes('background: #9b3b35;'),
  );
  check('3×3 的格子标出"要工作台"', compact.includes('.recipe-cell.needs-table::after'));
  check('搜索框与那颗方形筛选按钮同一行（截图里就是这个位置）', compact.includes('.recipe-controls {') && bookUi.includes("controls.append(this.searchEl, this.filterButton)"));
  check('页签是方形图标块（文字只留在 title/aria 里）', compact.includes('.recipe-tab { width: 32px;') && compact.includes('.recipe-tab-label { display: none; }'));
  // 图标网格省掉了卡片上的文字，但名字与材料不能跟着一起没（手机上没有悬停）
  check('底部有一行说明"这格是什么 + 材料够不够"', bookUi.includes("this.detailEl.textContent = summary"));
  check('说明行会说出缺哪样材料', bookUi.includes('材料不足${missing'));
  check('没点着任何一格时说明行也有默认文案', bookUi.includes('this.resetDetail()') && bookUi.includes('点一格：材料会摆进右边的合成格'));

  // ---- 配方书嵌进背包左栏（批次 157：不再有 "第二个窗口并排"）
  check(
    '配方书不再并排分屏（没有 split-ui 那套半屏规则）',
    !compact.includes('body.split-ui #recipe-book {') && !compact.includes('body.split-ui #inventory-screen {'),
  );
  check('嵌入态由 .recipe-panel.embedded 描述', compact.includes('.recipe-panel.embedded {'));
  check('背包提供左栏落脚点', inventorySrc.includes("dataset.role = 'pocket-category-host'"));
  check('配方书可搬进/搬出落脚点', bookUi.includes('attach(host: HTMLElement | null)'));
  check('嵌入时不画熔炼表', bookUi.includes('if (this.isEmbedded)'));
  check(
    '开/关配方书后背包重排左栏',
    mainSrc.includes('this.inventoryScreen.syncRecipePane()') &&
      inventorySrc.includes('syncRecipePane(): void {'),
  );
  check('界面不再有"界面配置"这一项（统一携带版）', !settingsSrc.includes("'界面配置'"));
  check('底部滑入/滑出动画', compact.includes('@keyframes panel-out') && compact.includes('translateY(28%)'));
  check('触摸多余回源格', inventorySrc.includes('returnHeldToTouchOrigin') && inventorySrc.includes('touchOrigin'));
  check('点不可放置槽会取消选中并安全退回', inventorySrc.includes('private cancelHeldSelection()') && /!this\.accepts[\s\S]{0,180}cancelHeldSelection\(\)/.test(inventorySrc));
  check('点面板内非槽位区域只取消、不丢弃', inventorySrc.includes("target.closest('.inv-slot, button, input, .recipe-cell')") && inventorySrc.includes('this.cancelHeldSelection();'));

  // ---- 标签栏图标（Wiki："配方书的标签栏与创造分类相同"）
  check('四个实体标签栏复用了创造栏的真实物品图标', creativeSrc.includes('export const RECIPE_TAB_ICONS'));
  check('"全部"那一栏用放大镜（图集里没有这件物品 → 内联 SVG）', bookUi.includes('SEARCH_TAB_ICON') && bookUi.includes('<svg'));
  check('图标与文字分层（整块 textContent 会把 canvas/svg 抹掉）', bookUi.includes("button.querySelector('.recipe-tab-label')"));
  check('合成区有"合成"标题（截图里就有，其它分组原版没有标题）', inventorySrc.includes("this.buildLabel('合成')"));
}

console.log('\n[HUD 重复挂载与触摸坐标兜底（批次 183）]');
{
  const vitalsSrc = readFileSync(new URL('../src/ui/VitalsHud.ts', import.meta.url), 'utf8');
  const xpSrc = readFileSync(new URL('../src/ui/XpHud.ts', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const touchSrc = readFileSync(new URL('../src/ui/TouchControls.ts', import.meta.url), 'utf8');
  check('血条构造时先清空静态容器（重进世界不再叠第二套）', vitalsSrc.includes('container.replaceChildren();'));
  check('经验条构造时先删旧的那条', xpSrc.includes("container.querySelector('#xp-bar')?.remove()"));
  check(
    '拆局时清掉血条与经验条',
    appSrc.includes('this.vitalsHud.dispose();') && appSrc.includes('this.xpHud.dispose();'),
  );
  check(
    '触摸坐标有 screen/page 兜底，且一次手势锁定来源',
    touchSrc.includes('pointFromEvent(event)') &&
      touchSrc.includes('pointFromEventWithSource(event, this.lookPointSource)'),
  );
  check(
    'clientX/Y 全为 0 时记现场并强制重排（等价于开关一次背包）',
    touchSrc.includes("reportPointerAnomaly('look.down'") &&
      touchSrc.includes("this.nudgeLayout('look.down')"),
  );
  check(
    '回到前台/全屏切换只做轻量重排（后面紧跟暂停菜单，不能叠面板）',
    appSrc.includes("this.touch?.recover('visible')") &&
      appSrc.includes("this.touch?.recover('fullscreen')"),
  );
  check('摇杆不再拿原点算方向', touchSrc.includes('if (event.clientX === 0 && event.clientY === 0) return;'));
  check(
    '拖动中途 client 变 0 会切到 screen/page 继续（不是丢弃）',
    touchSrc.includes("'pointer.rebase'") && touchSrc.includes('this.lookPointSource = alt.source'),
  );
  // 批次 214：真机日志证明"透明 div"救不回坐标全 0（它没被绘制），
  // 唯一有效的是**真的开关一次背包**。所以恢复回到背包路径，只是可以隐身。
  const recoverCss = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  check(
    '自动恢复走"开关背包"，且支持隐身（ghost 类）',
    appSrc.includes('private runInventoryRecovery(') &&
      appSrc.includes("this.inventoryScreen.setGhost(ghost)") &&
      appSrc.includes("this.inventoryScreen.openWith('inventory')"),
  );
  check(
    'ghost 只是压到极低不透明度（0 会被跳过绘制），并且不吃事件',
    /#inventory-screen\.inv-ghost \{[\s\S]{0,200}opacity: \.004;/.test(recoverCss) &&
      /#inventory-screen\.inv-ghost \{[\s\S]{0,200}pointer-events: none;/.test(recoverCss),
  );
  check(
    'ghost 在关面板/拆局时被强制摘掉（下次主动打开必须正常可见）',
    invSrc.includes('this.setGhost(false);'),
  );
  check(
    '透明 div 那套已经删干净（别再有人以为它有用）',
    !touchSrc.includes('recoverDeep') && !recoverCss.includes('#touch-recover'),
  );
  check(
    '连续坐标异常先走隐身背包，压不住才可见兜底',
    appSrc.includes('private handlePointerAnomaly(') &&
      appSrc.includes('this.recoveryAttempts') &&
      appSrc.includes("'autoRecover.ghost'") &&
      appSrc.includes("'autoRecover.uiCycle'"),
  );
}

console.log('\n[状态栏贴快捷栏两端 + 仙人掌接触（批次 222）]');
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const compact = html.replace(/\s+/g, ' ');
  const vitalsSrc = readFileSync(new URL('../src/ui/VitalsHud.ts', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const physicsSrc = readFileSync(new URL('../src/core/physics/PlayerPhysics.ts', import.meta.url), 'utf8');
  const worldSrc = readFileSync(new URL('../src/core/world/World.ts', import.meta.url), 'utf8');

  check(
    '快捷栏与状态栏共用一组几何变量（两端才能真的对齐）',
    compact.includes('--hotbar-w: calc(9 * var(--hotbar-slot) + 8 * var(--hotbar-gap) + 2 * var(--hotbar-pad) + 2px);') &&
      compact.includes('width: var(--hotbar-w);') &&
      compact.includes('gap: var(--hotbar-gap); padding: var(--hotbar-pad);'),
  );
  check(
    '生命/饥饿分两列贴住两端，中间让给进度条',
    compact.includes('justify-content: space-between;') &&
      vitalsSrc.includes("leftSide.append(this.armorRow, healthRow);") &&
      vitalsSrc.includes("rightSide.append(this.airRow, foodRow);"),
  );
  check(
    '状态栏在经验条上方（不挡等级数字）',
    /#vitals \{[\s\S]{0,400}?bottom: calc\(86px \+ env\(safe-area-inset-bottom/.test(html) &&
      /#xp-bar \{[\s\S]{0,200}?bottom: calc\(68px \+ env\(safe-area-inset-bottom/.test(html),
  );

  // 仙人掌（批次 222）：伤害判定以前恒为 false，用户"撞上去"其实既不掉血也不会抖
  check(
    '仙人掌接触已接线（不再恒为 false）',
    appSrc.includes('onCactus: touchesCactus(') && !appSrc.includes('onCactus: false'),
  );
  check(
    '自动跳跃不把危险方块当台阶（否则顶着仙人掌会反复起跳）',
    physicsSrc.includes('world.isHazardous?.(bx, vy, bz)') &&
      physicsSrc.includes('if (top === null || hazard) return false;'),
  );
  check('世界侧提供 isHazardous', worldSrc.includes("blockDef(id).shape === 'cactus'"));
  check('自动跳跃进诊断日志（用于确认"画面抖"是不是它）', appSrc.includes("diag.event('input', 'autoJump', {"));
}

console.log('\n[用户反馈一轮收口（批次 184）]');
{
  const fullscreenSrc = readFileSync(new URL('../src/ui/Fullscreen.ts', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const worldSrc = readFileSync(new URL('../src/ui/WorldScreen.ts', import.meta.url), 'utf8');
  const keyboardSrc = readFileSync(new URL('../src/ui/Keyboard.ts', import.meta.url), 'utf8');

  // ① 竖屏点任何区域都进横屏全屏：不是一次性监听，只在"已经横屏且全屏"时跳过
  check(
    '竖屏点任意处都会再试一次全屏 + 横屏（不是一次性）',
    fullscreenSrc.includes('export function armPresentOnTap') &&
      fullscreenSrc.includes('if (isFullscreen() && isLandscapeOrientation()) return;') &&
      appSrc.includes('armPresentOnTap(document);'),
  );
  // ② 从后台回来：先落暂停页 + 不透明"点击继续"层，点它才请求全屏并回到游戏
  check(
    '从后台回来先落到暂停页（先收起其它界面）',
    appSrc.includes('private handleReturnFromBackground(): void {') &&
      appSrc.includes('if (this.wasHidden) this.handleReturnFromBackground();') &&
      appSrc.includes('if (!this.settingsScreen.isOpen) this.openSettings();'),
  );
  check(
    '"点击继续"层自己吃掉第一下点击：请求全屏再关掉自己与暂停菜单',
    /gate\.addEventListener\('pointerdown'[\s\S]{0,200}enterMobilePresentation\(\);[\s\S]{0,80}this\.dismissResumeGate\(\);/.test(appSrc) &&
      css.includes('#resume-gate {') &&
      css.includes('z-index: 55;'),
  );
  // ③ 新建世界：标签与输入框同一行，说明放最后（两列栅格不再被切断）
  check(
    '新建世界表单：标签与输入框同一行（窄屏也不再拆两行）',
    !css.includes('.world-row .world-input { grid-column: 1 / -1; }') &&
      css.includes('.world-row { display: grid; grid-template-columns: 64px minmax(0, 1fr) 44px;') &&
      css.includes('.world-row > span {'),
  );
  check(
    '新建世界表单：说明排在字段最后、创建键跨满两列',
    /this\.makeRow\('游戏模式', this\.gameModeSelect, null\),\s*this\.typeHintEl,\s*createButton,/.test(worldSrc) &&
      css.includes('.world-new > .world-primary { grid-column: 1 / -1; }'),
  );
  // ④ 配方开关关着 + 空栏 = 空白（不再写"这一栏里你还没有东西…"）
  check(
    '配方开关关着时空栏留白（只在有筛选条件时解释）',
    invSrc.includes('if (this.categoryQuery.length > 0 || this.showUnowned) {') &&
      !invSrc.includes('这一栏里你还没有东西'),
  );
  // ⑤ 红底"我没有的"：不选中，只给点击反馈 + 名称 + 配方
  check(
    '红底 / 分类格都不选中，只给缩放反馈',
    invSrc.includes("slot.classList.contains('category-slot') || slot.classList.contains('locked')") &&
      invSrc.includes('private flashLocked(slot: HTMLElement): void {') &&
      css.includes('.inv-slot.tapped { animation: inv-locked-tap'),
  );
  check(
    '手机上 :hover 不再把红底盖成灰白',
    /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.inv-slot:hover/.test(css) &&
      css.includes('.inv-slot.locked:hover'),
  );
  // ⑥ 键盘：不缩布局 + 点别处先失焦
  check(
    '键盘只缩视觉视口，点输入框以外先 blur',
    appSrc.includes('installKeyboardGuards();') &&
      keyboardSrc.includes('active.blur();') &&
      keyboardSrc.includes("addEventListener('resize', syncKeyboardInset") &&
      css.includes('var(--kb-inset, 0px)'),
  );
}

console.log('\n[用户第二轮反馈（批次 185）]');
{
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const fullscreenSrc = readFileSync(new URL('../src/ui/Fullscreen.ts', import.meta.url), 'utf8');
  const touchSrc = readFileSync(new URL('../src/ui/TouchControls.ts', import.meta.url), 'utf8');
  const settingsSrc = readFileSync(new URL('../src/ui/SettingsScreen.ts', import.meta.url), 'utf8');

  // ① 竖屏：整屏浮层
  check(
    '竖屏浮层是整屏不透明层（不再只是底部横条）',
    /\.rotate-hint \{[\s\S]{0,500}position: fixed;[\s\S]{0,200}inset: 0;/.test(css) &&
      /\.rotate-hint \{[\s\S]{0,600}z-index: 90;/.test(css) &&
      fullscreenSrc.includes('请横屏游玩'),
  );
  check(
    '浮层尽早挂上（不等菜单/加载）',
    /installKeyboardGuards\(\);[\s\S]{0,300}installRotateHint\(\);/.test(appSrc),
  );
  // 批次 212：掉出全屏（安卓返回的常见表现）且没有面板 → 延时补开暂停菜单；
  // 同一手势若还派发 popstate，那边会取消计时器，避免一次返回处理两次。
  check(
    '掉出全屏 + 无面板 → 自动打开暂停菜单（与 popstate 去重）',
    appSrc.includes('pauseAfterFullscreenTimer') &&
      /fullscreenchange'[\s\S]{0,1600}openSettings\(\)/.test(appSrc) &&
      appSrc.includes("'back.exitFullscreen'") &&
      settingsSrc.includes("classList.add('pause-open')"),
  );
  check('继续游戏不强制请求全屏（仍回到批次 209 的行为）', !/closeSettings\(\): void \{[\s\S]{0,400}enterMobilePresentation\(\)/.test(appSrc));
  check(
    '“请横屏游玩”整屏任意位置都能点（document 捕获）',
    fullscreenSrc.includes("if (!hint.classList.contains('visible')) return;") &&
      fullscreenSrc.includes('getComputedStyle(hint).display') &&
      /\.rotate-hint \{[\s\S]{0,900}pointer-events: auto;/.test(css),
  );
  check(
    '横屏提示盖在暂停菜单上层（不再被 pause-open 藏掉）',
    !/body\.pause-open \.rotate-hint\s*\{/.test(css) &&
      /\.rotate-hint \{[\s\S]{0,500}z-index: 90;/.test(css) &&
      /#settings-screen \{[\s\S]{0,300}z-index: 50;/.test(css),
  );
  check(
    '读档 / 重生后复核脚底，不在空中 / 水里 / 岩石里',
    appSrc.includes('private settlePlayerOnGround(): void {') &&
      appSrc.includes("this.requestGroundSettle('load');") &&
      appSrc.includes("this.requestGroundSettle('respawn');") &&
      appSrc.includes('this.groundSettleReason !== null') &&
      readFileSync(new URL('../src/core/world/SpawnPoint.ts', import.meta.url), 'utf8').includes('Block.NETHERRACK'),
  );

  // ② 工作台 3×3：创造模式左栏仍能切分类
  check(
    '创造模式的工作台也能显示创造物品栏（左侧分类有反应）',
    invSrc.includes('const creative = creativePlayer;'),
  );

  // ③ 切分类回到顶部
  check(
    '切分类把网格滚回顶部',
    invSrc.includes('this.creativeGrid.scrollTop = 0;') && invSrc.includes('this.categoryGrid.scrollTop = 0;'),
  );

  // ④ 分类底部统计（批次 206：可合成 N / 缺料 M）
  check(
    '分类底部统计（可合成 N / 缺料 M）',
    invSrc.includes("this.categoryInfo.dataset.role = 'category-info'") &&
      invSrc.includes('可合成 ${craftableInTab}') &&
      css.includes('.inv-category-info'),
  );

  // ⑤ 红底物品 + 工作台/熔炉标记
  check(
    '红底物品只闪一下，不套选中态',
    invSrc.includes("slot.classList.contains('locked')") && invSrc.includes('flashLocked'),
  );
  check(
    '3×3 配方点亮"要工作台"、只能烧的物资点亮"要熔炉"',
    invSrc.includes("this.craftStation = 'workbench';") &&
      invSrc.includes("this.craftStation = 'furnace';") &&
      invSrc.includes("station.className = 'inv-craft-station hidden'") &&
      css.includes('.inv-craft-station'),
  );
  check(
    '箭头方向只改字形，不抹掉小图标',
    invSrc.includes("glyph.className = 'inv-arrow-glyph'") &&
      /const glyph = arrow\?\.querySelector\('\.inv-arrow-glyph'\);/.test(invSrc),
  );

  // ⑥ 丢弃 / 关闭动画期间重开
  check(
    '点界面外空处丢弃（面板空白与窗外都算）',
    invSrc.includes('private dropHeldStack(') && invSrc.includes('this.hooks.onDrop(stack.id, drop);'),
  );
  check(
    '关闭动画没走完就重开：取消关闭，不会"打开了却看不见"',
    invSrc.includes('private closeTimer: number | null = null;') &&
      /if \(this\.closing\) \{[\s\S]{0,300}this\.open = false;/.test(invSrc),
  );

  // ⑦ 箱子等容器：正方形格
  check(
    '容器格子在手机上封顶 44px 且为正方形',
    css.includes('repeat(9, minmax(0, 44px))') && css.includes('.inv-grid .inv-slot { width: auto; height: auto; aspect-ratio: 1; }'),
  );

  // ⑧ 触摸攻击
  check(
    '轻点按屏幕坐标选生物（点哪打哪）',
    appSrc.includes('private mobAtScreen(clientX: number, clientY: number): Mob | null') &&
      appSrc.includes('const tapped = this.mobAtScreen(clientX, clientY);') &&
      touchSrc.includes('onTap(clientX: number, clientY: number): void;'),
  );

  // ⑨ 水流动：玩家手挖也要唤醒邻居
  check(
    '玩家破坏方块后唤醒周围流体',
    /this\.world\.setBlockAndUpdate\(this\.hit\.x, this\.hit\.y, this\.hit\.z, Block\.AIR\);[\s\S]{0,400}this\.wakeFluidsAround\(this\.hit\.x, this\.hit\.y, this\.hit\.z\);/.test(appSrc),
  );

  // ⑩ 设置：恢复默认 + 性能项精简
  check(
    '设置里能一键恢复默认，且控件跟着重画',
    settingsSrc.includes('resetDefaults(): void') &&
      settingsSrc.includes(
        'Object.assign(this.settings, DEFAULT_SETTINGS, { viewDistance: defaultViewDistanceFor(isTouchUi()) })',
      ) &&
      settingsSrc.includes('for (const refresh of this.refreshers) refresh();') &&
      settingsSrc.includes("resetButton.id = 'settings-reset'"),
  );
  // 批次 202：恢复默认必须带 `reset` 标记出去——分辨率倍率与装饰层档位不在 `GameSettings` 里，
  // 主程序不收到这个标记的话，玩家会看到"点了恢复默认，画面还是糊的 / 云还是没有"
  check(
    '恢复默认会通知主程序复位运行时的降级档位',
    settingsSrc.includes('this.commit(true)') && appSrc.includes('meta?.reset'),
  );
  // 批次 202：改设置不再无条件重算区块范围（拖个音量滑块不该惊动流式层）
  check(
    '只有视距真的变了才重算区块范围',
    appSrc.includes('if (viewChanged) this.refreshWorld('),
  );
  // 批次 202：诊断日志补上性能采样——真机日志以前只有"点了什么"，没有"多少帧、画了多少"
  // 批次 205：采样再带"真实帧间距 + cpu 分段耗时"，用来分 CPU 瓶颈与 GPU 瓶颈
  check(
    '主循环每 5 秒记一条性能采样',
    appSrc.includes('this.perfSampleTimer -= dt') &&
      appSrc.includes('this.logPerfSample();') &&
      appSrc.includes("diag.event('perf', 'sample', {"),
  );
  check(
    '采样带真实帧间距与 CPU 分段（判 CPU/GPU 瓶颈的唯一依据）',
    appSrc.includes('frameAvgMs,') &&
      appSrc.includes('cpu: phases.total') &&
      appSrc.includes('phases: phases.avg'),
  );
  // 批次 205：物理用的 dt 必须夹住，测量用的必须是真实间隔（以前两者共用夹紧值，
  // 掉到 9fps 时诊断里只看到 100ms）
  check(
    '物理 dt 与测量帧间距分开',
    appSrc.includes('const dt = Math.min(rawDt, 0.1);') &&
      appSrc.includes('const frameSeconds = Math.min(rawDt, 2);') &&
      appSrc.includes('this.updatePerfPolicy(frameSeconds);'),
  );

  // 批次 215：水的"流动"不花钱，花钱的是半透明层（水/玻璃）的覆盖 + 双面。
  // 双面只在水下抬头时才必需，所以按"摄像机是否在液体里"来回切。
  const renderMapSrc = readFileSync(new URL('../src/render/VoxelMaterial.ts', import.meta.url), 'utf8');
  check(
    '半透明层按"摄像机在水下"切单/双面（岸上省一半水面填充率）',
    appSrc.includes('this.translucentMaterial.setDoubleSided(this.isCameraUnderwater());') &&
      appSrc.includes('private isCameraUnderwater(): boolean') &&
      renderMapSrc.includes('setDoubleSided(doubleSided: boolean): void'),
  );
  check(
    '切面不触发着色器重编译（side 是 GL 状态，不是宏）',
    !/setDoubleSided[\s\S]{0,200}needsUpdate/.test(renderMapSrc),
  );

  // 批次 215：视野也是"同屏画多少"的乘数，但自适应管不到它 → 手机上封 90° 并说明
  check(
    '手机视野封 90°，且滑块上限与运行时夹紧共用同一处策略',
    settingsSrc.includes('fovCapFor(isTouchUi())') &&
      settingsSrc.includes('this.makeNote(controls') &&
      appSrc.includes('clampFovFor(this.settings.fov, isTouchDevice())') &&
      appSrc.includes('clampFovFor(settings.fov, mobile)'),
  );
  check(
    '说明行有样式（跨满整行，不压到半栏）',
    /\.settings-note \{[^}]*grid-column: 1 \/ -1;/.test(css),
  );
  // 顺手修的：相机是按硬编码 72° 建的，以前"视野 90"重启后要进设置动一下才生效
  check(
    '启动时把存档里的视野落到相机（以前重启后会退回 72°）',
    appSrc.includes('this.camera.fov = this.settings.fov;'),
  );
  check(
    '诊断导出带上真实渲染规模与显卡型号',
    appSrc.includes('perf: this.perfSnapshot()') && appSrc.includes('gpu: this.gpuName()'),
  );
  // 批次 203（用户："性能相关的设置可以不用让用户去设置"）：视距 / 自适应分辨率 /
  // 自适应视距 / 天气效果 四行全部删掉（字段保留给老存档），「视频」组随之消失，
  // 「视野」并进「控制」
  check(
    '性能四行全删（视距/自适应分辨率/自适应视距/天气效果）',
    !settingsSrc.includes("'adaptiveResolution',") &&
      !settingsSrc.includes("'adaptiveViewDistance',") &&
      !settingsSrc.includes("'weatherEffects',") &&
      !/makeSlider\(\s*'viewDistance'/.test(settingsSrc),
  );
  check(
    '「视频」组没了，「视野」并进「控制」',
    !settingsSrc.includes("this.section('graphics')") &&
      !settingsSrc.includes('graphics:') &&
      /makeSlider\(\s*'fov',\s*'视野'/.test(settingsSrc),
  );
  // ⚠️ 字段必须还在：删字段会让 `loadSettings` 把老存档里其它值一起丢掉
  check(
    '四个性能字段仍保留在 GameSettings 里（只是没有入口）',
    settingsSrc.includes('viewDistance: number') &&
      settingsSrc.includes('adaptiveResolution: boolean') &&
      settingsSrc.includes('adaptiveViewDistance: boolean') &&
      settingsSrc.includes('weatherEffects: boolean'),
  );
  // 没有滑块之后，进世界时由主程序按设备定死——老存档里关过自适应的也要重新打开
  check(
    '进世界时强制接管三样性能档位',
    appSrc.includes('this.settings.adaptiveResolution = true;') &&
      appSrc.includes('this.settings.adaptiveViewDistance = true;') &&
      appSrc.includes('this.settings.viewDistance = defaultViewDistanceFor(isTouchDevice());'),
  );
  // 渐进视距涨完之后，自适应还回来的视距必须真的生效（否则手机上永远停在开局那 6）
  check(
    '渐进视距涨完后只认 viewDistance（自适应涨回 8 才真的生效）',
    appSrc.includes('if (this.startupRamp.done) return this.viewDistance;'),
  );
  check(
    '帧率上限那个手动档位已删除（交给自适应）',
    !settingsSrc.includes("'帧率上限'"),
  );
}

console.log('\n[收尾四项：返回层级 / 成就入口 / 潜行 / 设置精简（批次 185 续）]');
{
  const appSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const playerSrc = readFileSync(new URL('../src/render/PlayerRenderer.ts', import.meta.url), 'utf8');
  const settingsSrc = readFileSync(new URL('../src/ui/SettingsScreen.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  check(
    '返回键：暂停菜单页再按返回 = 保存退出到主菜单（设置子页仍先退回菜单页）',
    /if \(this\.settingsScreen\.page === 'menu'\) void this\.exitToMenu\(\);/.test(appSrc) &&
      /else this\.settingsScreen\.goBack\(\);/.test(appSrc),
  );
  check(
    '成就入口搬到右轨（合成/盔甲上面）',
    invSrc.includes("this.makeRailAction('成就'") &&
      /this\.pocketSideEl\.append\(\s*this\.railAchievementsEl,/.test(invSrc) &&
      css.includes('.inv-rail-action'),
  );
  check(
    '潜行有姿态（下沉 + 前倾 + 摆幅减半）',
    playerSrc.includes('sneaking?: boolean') &&
      playerSrc.includes("this.object.rotation.order = 'YXZ'") &&
      playerSrc.includes('pose.y - (sneak ? 0.12 : 0)') &&
      appSrc.includes('(this.touch?.input.sneak ?? false)'),
  );
  check(
    '设置删掉「云」「粒子效果」两行（保留字段给老存档）',
    !settingsSrc.includes("'clouds', '云'") && !settingsSrc.includes("'particles', '粒子效果'"),
  );

  // 3D 角色预览（批次 185 外观）
  const previewSrc = readFileSync(new URL('../src/ui/PlayerPreview3D.ts', import.meta.url), 'utf8');
  check(
    '背包角色预览是 3D、可拖动旋转（WebGL 不可用时退回 2D 剪影）',
    previewSrc.includes('class PlayerPreview3D') &&
      previewSrc.includes('rotateBy(deltaX: number)') &&
      invSrc.includes('new PlayerPreview3D(this.playerPreviewEl)') &&
      invSrc.includes('this.preview3dFailed = true') &&
      invSrc.includes('drawPlayerPreview('),
  );
  check(
    '披风外观：设置项 + 预览 + 世界模型三处共用',
    settingsSrc.includes("'cape', '披风'") &&
      settingsSrc.includes('cape: false,') &&
      invSrc.includes('this.hooks.isCapeVisible') &&
      playerSrc.includes('setCape(visible: boolean)') &&
      appSrc.includes('this.playerRenderer.setCape(this.settings.cape);'),
  );
  check(
    '副手有东西时左臂挂一块板（没有盾牌物品，先做有/没有）',
    playerSrc.includes('setOffhand(visible: boolean)') &&
      appSrc.includes('this.playerRenderer.setOffhand(this.inventory.get(OFFHAND_SLOT) !== null);'),
  );
}

console.log('\n[角色创建：外观（批次 187）]');
{
  const appSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const settingsSrc = readFileSync(new URL('../src/ui/SettingsScreen.ts', import.meta.url), 'utf8');
  const playerSrc = readFileSync(new URL('../src/render/PlayerRenderer.ts', import.meta.url), 'utf8');
  const previewSrc = readFileSync(new URL('../src/ui/PlayerPreview3D.ts', import.meta.url), 'utf8');

  check(
    '设置存"档位下标"而不是颜色（旧存档不会失效）',
    settingsSrc.includes('skinTone: number;') &&
      settingsSrc.includes('shirtColor: number;') &&
      settingsSrc.includes('pantsColor: number;') &&
      settingsSrc.includes('appearanceIndex(parsed.skinTone'),
  );
  check(
    '外观页：肤色 / 上衣 / 裤子 / 披风四行',
    /this\.makeSelect\(\s*appearance,\s*'skinTone'/.test(settingsSrc) &&
      /this\.makeSelect\(\s*appearance,\s*'shirtColor'/.test(settingsSrc) &&
      /this\.makeSelect\(\s*appearance,\s*'pantsColor'/.test(settingsSrc) &&
      settingsSrc.includes("this.makeToggle(appearance, 'cape', '披风')"),
  );
  check(
    '模型按部位换材质（肤色/上衣/裤子），不改几何',
    playerSrc.includes("roleMeshes: Record<'skin' | 'shirt' | 'pants', THREE.Mesh[]>") &&
      playerSrc.includes('setAppearance(palette: AppearancePalette): void') &&
      playerSrc.includes("this.roleMeshes.skin") &&
      playerSrc.includes("this.roleMeshes.pants"),
  );
  check(
    '改设置立刻作用到第三人称与 3D 预览',
    appSrc.includes('this.playerRenderer.setAppearance(paletteOf(settings));') &&
      invSrc.includes('this.hooks.appearance?.() ?? paletteOf(null)') &&
      previewSrc.includes('this.model.setAppearance(this.palette)'),
  );
}

console.log('\n[左上聊天 + 右上性能（批次 206）]');
{
  const appSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const chatSrc = readFileSync(new URL('../src/ui/ChatInput.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  check(
    '聊天栏在左上角（不再贴快捷栏上方）',
    /#chat \{[\s\S]{0,400}?top: calc\(8px \+ env\(safe-area-inset-top/.test(html) &&
      !/#chat \{[\s\S]{0,300}?bottom: calc\(82px/.test(html),
  );
  check(
    '性能面板搬到右上角，和状态效果同一列',
    html.includes('<div id="hud-right">') &&
      /#hud-right \{[\s\S]{0,300}?right: 8px/.test(html) &&
      /#debug \{[\s\S]{0,200}?font-size: 12px/.test(html),
  );
  check(
    '打开聊天输入框后能翻历史（消息不因过期被删掉）',
    chatSrc.includes('MAX_OPEN_LINES') &&
      chatSrc.includes('MAX_STORED_LINES') &&
      chatSrc.includes('get historyLines()') &&
      chatSrc.includes("this.logEl.addEventListener(") &&
      chatSrc.includes("'scroll',"),
  );
  check(
    '历史区可以滑动（触屏纵向滚动）',
    /#chat\.open \.chat-log \{[\s\S]{0,300}?overflow-y: auto/.test(html) &&
      html.includes('touch-action: pan-y'),
  );
  check(
    '输入行在最上面（左上角），历史在下面',
    chatSrc.includes('this.root.append(this.entryEl, this.hintEl, this.logEl)') &&
      html.includes('.chat-entry {') &&
      html.includes('.chat-entry.hidden { display: none; }'),
  );
  check(
    '新消息在上、旧消息在下',
    /for \(let i = lines\.length - 1; i >= 0; i--\)/.test(chatSrc) &&
      chatSrc.includes('this.stickToTop') &&
      chatSrc.includes('this.logEl.scrollTop = this.stickToTop ? 0 : previousTop'),
  );
  check(
    '聊天面板不被键盘高度压扁（--kb-inset 不再减在 #chat 上）',
    !/#chat \{[\s\S]{0,500}?max-height: calc\(100dvh - var\(--kb-inset/.test(html),
  );
  check(
    '打开聊天的那一笔手势不会立刻把它关掉',
    chatSrc.includes('this.openedAt = performance.now();') &&
      chatSrc.includes('performance.now() - this.openedAt < 350') &&
      chatSrc.includes("closest?.('#touch-pause')"),
  );
  // 批次 220（用户）：字号小一倍、消息 1 秒消失、显示期间点一下进聊天（不弹键盘）
  check(
    '聊天字号走一个变量（用户要求"小一倍"）',
    html.includes('--chat-font-size: 8px;') && html.includes('font-size: var(--chat-font-size);'),
  );
  check(
    '消息 1 秒后彻底消失（0.7s 清晰 + 0.3s 淡出）',
    chatSrc.includes('const LINE_LIFETIME = 700;') &&
      chatSrc.includes('const FADE_AFTER = 300;') &&
      html.includes('transition: opacity .3s linear;'),
  );
  check(
    '显示期间点一下直接进聊天（只有 .chat-log 接手势）',
    html.includes('#chat.peek .chat-log { pointer-events: auto;') &&
      chatSrc.includes("this.root.classList.toggle('peek', !this.open && lines.length > 0);") &&
      chatSrc.includes("this.openWith('', { focus: false });"),
  );
  check(
    '点消息进来不聚焦输入框（手机不弹键盘）',
    chatSrc.includes('if (options.focus !== false) {') && chatSrc.includes('this.inputEl.focus();'),
  );
  // 批次 221（用户："把天气变化的信息也提示一下"）：自然转换 / 睡觉放晴 / /weather 三条路径
  // 都必须汇到同一个播报入口，否则总有一条变化不会出现在消息栏里
  check(
    '天气变化进消息栏（三条路径共用 announceWeather）',
    appSrc.includes('weatherNotice(') &&
      appSrc.includes('private announceWeather(previous: WeatherKind): void') &&
      appSrc.includes('this.announceWeather(weatherBefore);') &&
      appSrc.includes('const weatherBeforeSleep = this.weather.current;') &&
      appSrc.includes('this.announceWeather(weatherBeforeSleep);') &&
      appSrc.includes('setWeather: (kind) => this.setWeather(kind),'),
  );
  check(
    '天气播报只落在主世界（换维度重置不算"雨停了"）',
    appSrc.includes('if (this.dimension !== Dimension.OVERWORLD) return;') &&
      appSrc.includes("diag.event('world', 'weather', {"),
  );
  const mobSrc = readFileSync(new URL('../src/core/entity/Mob.ts', import.meta.url), 'utf8');
  check(
    '掉血播报同时给出「现象 + 原因」（含具体生物名）',
    appSrc.includes('emitPlayerNotices()') &&
      appSrc.includes('takeDamageLog()') &&
      appSrc.includes('damageReason(') &&
      appSrc.includes('受到 ${fmt(total)} 点伤害：') &&
      mobSrc.includes("ctx.hurtPlayer(damage, this.x, this.z, 'generic', this.type.name)"),
  );
  // 桥接层（`EntityContext.hurtPlayer` → `damagePlayer`）必须把第 5 个参数原样转过去：
  // 少了它，实体层传的生物名白传，所有生物伤害都显示"没有记录到来源"（批次 218）
  check(
    '实体伤害的来源名在桥接层没有被丢掉',
    appSrc.includes('hurtPlayer: (amount, sourceX, sourceZ, cause, source) =>') &&
      appSrc.includes('this.damagePlayer(amount, sourceX, sourceZ, cause, source)'),
  );
  check(
    '凋零按自己的类别上报（不再借用 generic → 不再显示"没有记录到来源"）',
    appSrc.includes("this.applyIncomingDamage(hit.amount, 'wither')") &&
      appSrc.includes('for (const hit of result.damageHits)'),
  );
  // 没有这四类事件，导出的诊断日志就只有手势与性能，死因永远只能靠猜（批次 218）
  check(
    '掉血 / 死亡 / 重生 / 状态效果都进诊断日志（survival）',
    appSrc.includes("diag.event('survival', 'damage'") &&
      appSrc.includes("diag.event('survival', 'death'") &&
      appSrc.includes("diag.event('survival', 'respawn'") &&
      appSrc.includes("diag.event('survival', 'effect'"),
  );
  check(
    '死亡卡片也写清死因',
    html.includes('class="death-cause"') &&
      appSrc.includes('this.deathCauseEl.textContent') &&
      appSrc.includes('damageReason(last.cause, last.source)'),
  );
  check(
    '饥饿 / 氧气 / 着火 / 低血量也写了原因与建议',
    appSrc.includes('（体力消耗：走动 / 跳跃 / 战斗 / 挖掘）') &&
      appSrc.includes('氧气不足（正在水下憋气') &&
      appSrc.includes('你着火了（站在火/岩浆里或被点燃）') &&
      appSrc.includes('生命值偏低') &&
      appSrc.includes('饥饿值耗尽（体力透支）'),
  );
}

console.log('\n[伤害原因文案（批次 207）]');
{
  // 每一档都必须有"具体原因"，不能退回"受伤/环境伤害"这种说了等于没说的词
  const causes = [
    'poison',
    'wither',
    'fall',
    'drown',
    'lava',
    'fire',
    'cactus',
    'suffocate',
    'starve',
    'void',
    'explosion',
    'projectile',
    'lightning',
    'generic',
  ] as const;
  const reasons = causes.map((cause) => damageReason(cause));
  check('每一档伤害原因都不为空且够具体', reasons.every((text) => text.length >= 4), JSON.stringify(reasons));
  check('原因文案互不重复', new Set(reasons).size === reasons.length);
  check(
    '有具体来源时会写进句子（僵尸 / 箭矢 / 世界边界）',
    damageReason('generic', '僵尸').includes('僵尸') &&
      damageReason('projectile', '箭矢').includes('箭矢') &&
      damageReason('generic', '世界边界').includes('世界边界'),
  );
  check(
    '来源为空时不会留下空括号',
    !damageReason('fall', '').includes('（）') && !damageReason('lava', '   ').includes('（）'),
  );
}

console.log(`\n界面测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
