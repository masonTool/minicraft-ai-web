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
  equal('六个图标（聊天/视角/飞行/潜行/背包/跳跃）', TOUCH_ICON_NAMES.length, 6);
  for (const name of ['chat', 'view', 'fly', 'sneak', 'inventory', 'jump'] as const) {
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
  equal('六个图标互不相同（不会有两个按钮长一样）', svgs.size, TOUCH_ICON_NAMES.length);
}

// ---------------------------------------------------------------- 3. HTML 外壳

console.log('\n[index.html：手机端与 PC 端的布局规则]');
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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
    ['横屏六个按钮排 3 列', 'repeat(3, 54px)'],
    // 切石机（H11，批次 44）：候选列表与候选按钮的样式被误删时这里会红
    ['切石机候选列表', '.stonecutter-list'],
    ['切石机候选按钮', '.stonecutter-option'],
  ] as const) {
    check(`index.html 里有"${label}"`, html.includes(needle), needle);
  }

  // 开始遮罩：两套提示都要在（按设备切换）
  check('开始遮罩同时有键盘提示与手势提示', html.includes('overlay-help desktop-only') && html.includes('overlay-help touch-only'));
  check('开始遮罩上有一个"进入游戏"按钮样式', html.includes('.overlay-go'));
  // 触屏提示里不能再出现 <kbd>（手机上没有键盘）
  const touchBlock = /<div class="overlay-help touch-only">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  check('触屏提示里没有键盘按键', touchBlock.length > 0 && !touchBlock.includes('<kbd>'), touchBlock.slice(0, 40));
}

console.log(`\n界面测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
