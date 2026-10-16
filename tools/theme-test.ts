/**
 * 界面美化（批次 28）的离线断言
 *
 * 界面好不好看只能靠眼睛，但这一批里有三块**能离线钉死**的东西：
 *  1. **稀有度**（`itemVisuals.rarityOf`）：附魔/特殊物品该是哪一档——错档位会让
 *     提示框少一种颜色，而"颜色不对"在测试里没人会发现
 *  2. **耐久条**（`durabilityBar`/`durabilityLevel`）：满耐久与无耐久**都该不显示**，
 *     三档阈值是原版的手感；这类"什么时候不显示"的边界最容易写错
 *  3. **设计令牌**（`index.html` 的 `:root`）：令牌被删/被改回去时这里会红，
 *     而不是等发现"这个面板又变回那个顏色了"
 *
 * 运行：npm run test:theme
 */

import { readFileSync } from 'node:fs';
import { Block } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import { durabilityBar, durabilityLevel, rarityClassName, rarityOf } from '../src/core/registry/itemVisuals.ts';
import { itemTooltip } from '../src/core/registry/itemNames.ts';
import { toolItemId } from '../src/core/registry/tools.ts';
import { armorItemId } from '../src/core/registry/armor.ts';

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

// ---------------------------------------------------------------- 1. 稀有度

console.log('\n[稀有度：附魔与特殊物品]');
{
  const pick = toolItemId('pickaxe', 'diamond');
  equal('普通物品是"普通"档', rarityOf(pick), 'common');
  equal('方块也是普通档', rarityOf(Block.STONE), 'common');
  equal('钻石本身不是稀有（原版里材料就是普通）', rarityOf(Item.DIAMOND), 'common');

  equal('附魔过的物品是"稀有"', rarityOf(pick, { efficiency: 1 }), 'rare');
  equal('附魔表是空对象时仍是普通', rarityOf(pick, {}), 'common');
  equal('附魔表是 null 也不炸', rarityOf(pick, null), 'common');
  equal('空附魔表（{}）与 undefined 一个意思', rarityOf(pick, undefined), 'common');

  equal('金苹果是"稀有"', rarityOf(Item.GOLDEN_APPLE), 'rare');
  equal('龙蛋是"史诗"', rarityOf(Block.DRAGON_EGG), 'epic');
  equal('附魔台是"稀有"', rarityOf(Block.ENCHANTING_TABLE), 'rare');

  equal('类名拼得对', rarityClassName('epic'), 'rarity-epic');
}

// ---------------------------------------------------------------- 2. 耐久条

console.log('\n[耐久条：三档与"什么时候不显示"]');
{
  equal('满耐久是高档（>60%）', durabilityLevel(1), 'high');
  equal('61% 还是高档', durabilityLevel(0.61), 'high');
  equal('60% 掉到中档', durabilityLevel(0.6), 'mid');
  equal('31% 还是中档', durabilityLevel(0.31), 'mid');
  equal('30% 掉到低档', durabilityLevel(0.3), 'low');
  equal('见底是低档', durabilityLevel(0), 'low');

  const bar = durabilityBar(25, 100);
  equal('75% 剩余算出来是高档', bar?.level, 'high');
  check('比例算得对（1 - damage/上限）', Math.abs((bar?.ratio ?? 0) - 0.75) < 1e-9, String(bar?.ratio));

  const mid = durabilityBar(60, 100);
  equal('40% 剩余是中档', mid?.level, 'mid');
  const low = durabilityBar(90, 100);
  equal('10% 剩余是低档', low?.level, 'low');

  // ---- 不显示的三种情况
  equal('满耐久（damage=0）不显示', durabilityBar(0, 100), null);
  equal('damage 是 undefined 不显示', durabilityBar(undefined, 100), null);
  equal('没有耐久的物品（上限 0）不显示', durabilityBar(50, 0), null);
  equal('耐久上限是 NaN 不显示', durabilityBar(50, Number.NaN), null);
  equal('damage 是 NaN 不显示（脏存档）', durabilityBar(Number.NaN, 100), null);
  equal('damage 是负数不显示', durabilityBar(-5, 100), null);

  // ---- 边界：超上限的伤害要夹到 0，不能算出负宽度
  equal('伤害超过上限时比例夹到 0', durabilityBar(200, 100)?.ratio, 0);
  equal('伤害超过上限时是低档', durabilityBar(200, 100)?.level, 'low');
}

// ---------------------------------------------------------------- 3. 提示框的结构

console.log('\n[提示框：耐久与附魔各自成行]');
{
  const pick = toolItemId('pickaxe', 'diamond');
  const tooltip = itemTooltip(pick, 1, 400, { efficiency: 4 });
  check('耐久是单独一行（不再挤在说明里）', tooltip.durability.includes('/'), tooltip.durability);
  check('说明里不再出现耐久数字', !tooltip.description.includes('/1561'), tooltip.description);
  check('附魔逐条列在 enchants 里', tooltip.enchants.length === 1 && tooltip.enchants[0] === '效率 IV', tooltip.enchants.join('、'));
  equal('附魔物品的提示框按"稀有"上色', tooltip.rarity, 'rare');
  check('受损的工具带上耐久条数据', tooltip.durabilityBar !== null, JSON.stringify(tooltip.durabilityBar));

  const fresh = itemTooltip(pick);
  equal('满耐久时不带耐久条', fresh.durabilityBar, null);
  equal('满耐久时耐久文案是空的', fresh.durability.trim(), '');
  equal('没附魔时 enchants 是空数组', fresh.enchants.length, 0);

  const helmet = itemTooltip(armorItemId('helmet', 'iron'), 1, 100);
  check('盔甲也走同一套（耐久与条）', helmet.durability.includes('/') && helmet.durabilityBar !== null, helmet.durability);
}

// ---------------------------------------------------------------- 4. 设计令牌

console.log('\n[index.html：设计令牌与美化规则]');
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  // 令牌：上面的判断都依赖它们，缺一个就是"界面某处变成默认色"
  const tokens = [
    '--panel-bg', '--panel-bg-dark', '--panel-edge-light', '--panel-edge-dark',
    '--slot-bg', '--btn-bg', '--btn-primary', '--btn-danger',
    '--hud-bg', '--hud-border',
    '--dur-high', '--dur-mid', '--dur-low',
    '--rarity-common', '--rarity-uncommon', '--rarity-rare', '--rarity-epic',
    '--accent', '--radius-md', '--dur-fast', '--dur-med', '--ease',
  ];
  const missing = tokens.filter((token) => !html.includes(`${token}:`));
  check(`设计令牌齐全（${tokens.length} 个）`, missing.length === 0, missing.join(', '));

  // ---- 原版调色板（批次 109）----
  // 用户反馈"像素风这个配色和颜色好像也不太对"。这条门禁把原版反推出来的那几个
  // 关键色值钉住：改成"好看一点的灰"很容易，但那就不再是原版了。
  const palette: [string, string][] = [
    ['面板面（经典 GUI 灰）', '--mc-panel: #c6c6c6;'],
    ['槽位/按钮面', '--mc-face: #8b8b8b;'],
    ['斜面高光', '--mc-edge-light: #ffffff;'],
    ['斜面阴影', '--mc-edge-dark: #555555;'],
    ['外描边（纯黑）', '--mc-outline: #000000;'],
    ['浅底文字', '--mc-text: #3f3f3f;'],
    ['深底文字', '--mc-text-light: #e0e0e0;'],
    ['悬停文字（原版是文字变黄）', '--mc-text-hover: #ffffa0;'],
    ['禁用文字', '--mc-text-disabled: #a0a0a0;'],
    ['文字阴影', '--mc-text-shadow: #3f3f3f;'],
  ];
  for (const [label, needle] of palette) {
    check(`原版调色板：${label}`, html.includes(needle), needle);
  }
  // 原版**没有主色按钮**：主按钮与普通按钮同一个灰面（绿色只留给聊天发送键）
  check(
    '原版没有"主色按钮"（"游戏"与"设置"是同一个灰）',
    html.includes('--btn-primary: var(--mc-face);') && html.includes('--btn-danger: var(--mc-face);'),
  );
  // 原版文本框是黑底白字
  check('输入框是原版的黑底白字', html.includes('--field-bg: #000000;') && html.includes('--field-text: var(--mc-text-light);'));

  // 组件真的用上了令牌（而不是又写回硬编码色值）
  const usages = (html.match(/var\(--/g) ?? []).length;
  check(`组件大量引用令牌（实测 ${usages} 处）`, usages >= 60, '令牌层被绕过了？');

  for (const [label, needle] of [
    ['耐久条本体', '.dur-bar {'],
    ['耐久条中档配色', '.dur-bar.dur-mid b'],
    ['耐久条低档配色', '.dur-bar.dur-low b'],
    ['稀有度类名（史诗）', '.rarity-epic'],
    ['提示框按稀有度换左侧色条', "#item-tooltip[data-rarity='epic']"],
    ['附魔行样式', '.tooltip-enchant'],
    ['耐久行 + 迷你条', '.tooltip-durability'],
    ['按钮按下反馈', 'translateY(1px)'],
    ['键盘焦点环', ':focus-visible'],
    ['面板入场动画', '@keyframes panel-in'],
    ['低血量脉冲', 'low-health-pulse'],
    ['滑杆自绘', "input[type=\"range\"]::-webkit-slider-thumb"],
    // 批次 109：开关不再是"自绘 checkbox"——基岩版设置项是"‹ 开 ›/‹ 关 ›"的循环按钮
    ['开关/循环切换控件', '.settings-cycle'],
    ['加载页进度条', 'loading-sweep'],
    ['滚动条配色', 'scrollbar-color'],
  ] as const) {
    check(`index.html 里有"${label}"`, html.includes(needle), needle);
  }

  // 无障碍：减少动效时动画必须关掉
  check('有 prefers-reduced-motion 分支', html.includes('@media (prefers-reduced-motion: reduce)'));
  const reduceBlock = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n      \}/.exec(html)?.[1] ?? '';
  check('减少动效时把时长令牌压成 0', reduceBlock.includes('--dur-fast: 0s') && reduceBlock.includes('--dur-med: 0s'), reduceBlock.slice(0, 60));
  check('减少动效时动画时长也被压掉', reduceBlock.includes('animation-duration'), '有动画没关掉');

  // 移动端那三条"实测踩过的坑"要有防回退的注释与规则
  check('窄屏标签横向滚动时靠左（居中会滚不到最左边）', html.includes('justify-content: flex-start'), '分类标签的居中坑');
  check('面板最小宽度不超过视口', html.includes('min-width: min(420px, 92vw)'), '窄屏会把标题挤成竖排');
  check('聊天栏压在背包面板下面', /#chat \{[\s\S]*?z-index: 8;/.test(html), '聊天会盖在背包上');
}

console.log(`\n界面美化测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
