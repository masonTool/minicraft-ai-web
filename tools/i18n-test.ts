/**
 * 界面语言（M8）离线测试
 *
 * 运行：npm run test:i18n
 *
 * 这一套盯的是"两张表能不能长期保持一致"，而不是"某句翻译得好不好"——
 * 翻译质量靠人看，表的一致性只能靠断言。
 */

import { USAGE_FIELD_NAMES, translateUsageFields } from '../src/core/commands/UsageText.ts';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LANGUAGE_NAMES,
  TABLES,
  allKeys,
  detectLanguage,
  getLanguage,
  isLanguage,
  keyParity,
  resetLanguageForTest,
  setLanguage,
  t,
  tp,
  joinList,
} from '../src/core/i18n/I18n.ts';

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

/** 只看代码行：注释里出现同样的字样是解释，不是使用 */
function codeOf(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

console.log('[中英表一致性]');
{
  const parity = keyParity();
  check('英文表没有漏翻的键', parity.missingInEn.length === 0, parity.missingInEn.join(', '));
  check('中文表没有多出来的孤立键', parity.missingInZh.length === 0, parity.missingInZh.join(', '));

  const empty: string[] = [];
  for (const language of LANGUAGES) {
    for (const [key, value] of Object.entries(TABLES[language])) {
      if (typeof value !== 'string' || value.trim().length === 0) empty.push(`${language}:${key}`);
    }
  }
  check('没有空文案（空串在界面上会变成"按钮是空的"）', empty.length === 0, empty.join(', '));

  check('语言清单与表一一对应', LANGUAGES.every((language) => TABLES[language] !== undefined));
  check('每种语言都有自己的自称', LANGUAGES.every((language) => (LANGUAGE_NAMES[language] ?? '').length > 0));
}

console.log('\n[界面真的会去查的那些键都在表里]');
{
  const keys = new Set(allKeys());
  const required = [
    'pause.title',
    'pause.resume',
    'pause.settings',
    'pause.achievements',
    'pause.exit',
    'settings.language',
    'settings.row.daylightCycle',
    'settings.row.showDebug',
    'settings.row.autosave',
    'settings.row.flying',
    'settings.row.gameMode',
    'settings.row.cameraMode',
    'settings.row.handedness',
    'settings.row.aimMode',
    'settings.row.touchStick',
    'settings.row.invertY',
    'settings.row.autoJump',
    'settings.row.fastEat',
    'settings.row.fov',
    'settings.row.touchScale',
    'settings.row.volume',
    'settings.row.volumeMusic',
    'settings.avatar.full',
    'settings.avatar.face',
    'menu.tagline',
    'menu.play',
    'menu.footer',
    'menu.newWorld',
    'menu.empty',
    'world.list',
    'world.gameMode',
    'world.createTitle',
    'world.enter',
    'inventory.title',
    'inventory.armor',
    'inventory.returnToStorage',
    'inventory.noMatch',
    'inventory.searchItems',
    'inventory.tab.craftable',
    'inventory.tab.items',
    'station.tradeHint',
    'station.villagerIdle',
    ...['game', 'controls', 'appearance', 'sound'].map((group) => `settings.group.${group}`),
  ];
  const missing = required.filter((key) => !keys.has(key));
  check('暂停菜单 + 四个设置分组 + 语言项都有文案', missing.length === 0, missing.join(', '));
  check(
    '分组键的命名与 SETTING_GROUPS 对得上（改分组名会在这里露出来）',
    keys.has('settings.group.game') && keys.has('settings.group.sound'),
  );
}

console.log('\n[查表]');
{
  check('中文取中文', t('pause.resume', 'zh') === '继续游戏');
  check('英文取英文', t('pause.resume', 'en') === 'Resume Game');
  check('两种语言确实不同（写成同一份的兜底偷懒会在这里露出来）', t('pause.resume', 'zh') !== t('pause.resume', 'en'));
  check(
    '查不到的键返回键名本身（界面上能一眼看出漏了文案）',
    t('no.such.key', 'zh') === 'no.such.key',
    t('no.such.key', 'zh'),
  );
  resetLanguageForTest();
  check('省略语言参数时用当前语言', t('pause.title') === '游戏已暂停', t('pause.title'));
  setLanguage('en');
  check('切到英文后省略参数就用英文', t('pause.title') === 'Game Paused', t('pause.title'));
  resetLanguageForTest();
}

console.log('\n[语言状态]');
{
  resetLanguageForTest();
  check('默认是中文', getLanguage() === DEFAULT_LANGUAGE && getLanguage() === 'zh');
  setLanguage('en');
  check('setLanguage 生效', getLanguage() === 'en');
  resetLanguageForTest();
  check('resetLanguageForTest 能复位（用例之间不互相污染）', getLanguage() === 'zh');
  check('setLanguage 在没有 document 的 Node 里也不抛异常', (() => {
    try {
      setLanguage('en');
      resetLanguageForTest();
      return true;
    } catch {
      return false;
    }
  })());
}

console.log('\n[语言码判定]');
{
  check('zh 合法', isLanguage('zh'));
  check('en 合法', isLanguage('en'));
  check('zh-CN 不是设置里能存的值（要归一）', !isLanguage('zh-CN'));
  check('空串不合法', !isLanguage(''));
  check('undefined 不合法', !isLanguage(undefined));

  check('navigator 给 zh-CN → 中文', detectLanguage('zh-CN') === 'zh');
  check('navigator 给 zh-TW → 中文（繁体也走中文表）', detectLanguage('zh-TW') === 'zh');
  check('navigator 给 en-US → 英文', detectLanguage('en-US') === 'en');
  check('navigator 给 fr-FR → 回退默认（不出现半中半英）', detectLanguage('fr-FR') === DEFAULT_LANGUAGE);
  check('没有 navigator 标签时回退默认', detectLanguage(undefined) === DEFAULT_LANGUAGE);
}

console.log('\n[占位符（批次 425）]');
{
  resetLanguageForTest();
  check(
    '占位符被替换',
    tp('station.startMakingWithCount', { count: 3, unit: '个' }) === '点一下开始制作（预计 3 个）',
    tp('station.startMakingWithCount', { count: 3, unit: '个' }),
  );
  setLanguage('en');
  check(
    '英文模板用的是同一套占位符',
    tp('station.startMakingWithCount', { count: 2, unit: 'items' }) === 'Tap to start crafting (about 2 items)',
    tp('station.startMakingWithCount', { count: 2, unit: 'items' }),
  );
  resetLanguageForTest();
  check(
    '缺参数时**保留占位符原文**（不变成空串，一眼能看出漏传）',
    tp('station.startMakingWithCount', { count: 1 }).includes('{unit}'),
    tp('station.startMakingWithCount', { count: 1 }),
  );
  check('数字参数会被转成字符串', tp('station.startMakingWithCount', { count: 42, unit: '件' }).includes('42'));
  check('未知键返回键名（与 t 同一口径）', tp('no.such.key', { a: 1 }) === 'no.such.key');
  // 两条完整句子而不是拼接：这条防止有人回头把 "a + b" 的写法加回来
  check(
    '不带数量的那条是完整句子（不是半句）',
    t('station.startMaking', 'zh') === '点一下开始制作' && !t('station.startMaking', 'zh').includes('（'),
  );
}

console.log('\n[枚举清单的连接词（批次 427）]');
{
  check('中文用顿号', joinList(['木板', '圆石', '木棍'], 'zh') === '木板、圆石、木棍', joinList(['木板', '圆石', '木棍'], 'zh'));
  check('英文两项用 and', joinList(['Planks', 'Cobblestone'], 'en') === 'Planks and Cobblestone');
  check(
    '英文三项是 "a, b, and c"',
    joinList(['Planks', 'Cobblestone', 'Stick'], 'en') === 'Planks, Cobblestone, and Stick',
    joinList(['Planks', 'Cobblestone', 'Stick'], 'en'),
  );
  check('一项不加分隔符', joinList(['木板'], 'zh') === '木板' && joinList(['Planks'], 'en') === 'Planks');
  check('空清单返回空串', joinList([], 'en') === '');
  check('空字符串项被跳过', joinList(['木板', '', '圆石'], 'zh') === '木板、圆石');
}

console.log('\n[背包界面文案接线（批次 617 / Q12）]');
{
  /**
   * 这一批接的是**背包界面的标题、分类、搜索、提示、分页**。
   * 断言分两类：
   *   ① 键都在，且中英文都不为空、不能是同一串（同一串等于漏翻）；
   *   ② `InventoryScreen.ts` 里那几处**不再有硬编码中文**——
   *      只验键存在是不够的：键加了但界面没引用，等于白加。
   */
  const keys = [
    'inventory.playerPreview',
    'inventory.creativeTitle',
    'inventory.crafting',
    'inventory.itemsTab',
    'inventory.searchTab',
    'inventory.armor.helmet',
    'inventory.armor.chestplate',
    'inventory.armor.leggings',
    'inventory.armor.boots',
    'inventory.armor.offhand',
    'inventory.offhandHint',
    'inventory.recipeBook',
    'inventory.recipeBookKey',
    'inventory.achievements',
    'inventory.achievementsKey',
    'inventory.close',
    'inventory.closeKey',
    'inventory.craft',
    'inventory.hintTouch',
    'inventory.hintKeyboard',
    'inventory.prevPage',
    'inventory.nextPage',
    'inventory.noCompleteRecipes',
  ];

  const parity = keyParity();
  const missing = keys.filter(
    (key) =>
      parity.missingInEn.includes(key) ||
      parity.missingInZh.includes(key) ||
      t(key, 'zh') === key ||
      t(key, 'en') === key,
  );
  check(`Q12 的 ${keys.length} 个键在中英文表里都有`, missing.length === 0, missing.join(','));

  const untranslated = keys.filter((key) => t(key, 'zh') === t(key, 'en'));
  check('每条都有真正翻成英文（不是照抄中文）', untranslated.length === 0, untranslated.join(','));

  // 界面里那几处必须引用键，不能还是硬编码
  const screenSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  for (const [label, literal, key] of [
    ['触摸提示', '轻点拿起 / 再轻点放下', 'inventory.hintTouch'],
    ['键盘提示', '按 <kbd>E</kbd> 或 <kbd>Esc</kbd> 关闭', 'inventory.hintKeyboard'],
    ['创造物品栏标题', "append('创造物品栏')", 'inventory.creativeTitle'],
    ['玩家预览 aria-label', "'玩家预览'", 'inventory.playerPreview'],
    ['上一页', "'‹ 上一页'", 'inventory.prevPage'],
    ['下一页', "'下一页 ›'", 'inventory.nextPage'],
    ['分类搜索', "category === 'all' ? '搜索'", 'inventory.searchTab'],
  ] as const) {
    check(
      `${label} 已接线（${key}）且无硬编码`,
      screenSrc.includes(key) && !screenSrc.includes(literal),
    );
  }
}

console.log('\n[工作站与面板标题（批次 617 / Q13）]');
{
  /**
   * 这一批把**模块级常量表**改成"查键的函数"：`MODE_TITLES` / `STATION_LABELS` /
   * `CREATIVE_TAB_LABELS` 原来在模块加载时求值一次，英文模式下永远是中文。
   * 断言分两层：键齐全 + 表本身真的改成键驱动（防"加了键但界面还用旧常量"）。
   */
  const panelKeys = [
    'panel.inventory', 'panel.crafting', 'panel.furnace', 'panel.smoker', 'panel.blastFurnace',
    'panel.campfire', 'panel.chest', 'panel.barrel', 'panel.enderChest', 'panel.shulkerBox',
    'panel.mobInventory', 'panel.enchanting', 'panel.anvil', 'panel.grindstone', 'panel.smithing',
    'panel.stonecutter', 'panel.loom', 'panel.cartography', 'panel.brewing', 'panel.hopper',
    'panel.trade', 'panel.dropper', 'panel.dispenser',
  ];
  const stationKeys = [
    'station.name.furnace', 'station.name.smokerOrFurnace', 'station.name.blastFurnaceOrFurnace',
    'station.name.campfire', 'station.name.smithing', 'station.name.brewing',
    'station.reason.missingInput', 'station.reason.missingFuel', 'station.reason.missingEquipment',
    'station.reason.missingMaterial', 'station.reason.slotOccupied', 'station.reason.notAvailable',
  ];
  const slotKeys = [
    'slot.target', 'slot.potion', 'slot.potionHint', 'slot.material', 'slot.fuel', 'slot.input',
    'slot.rename', 'slot.enchantMaterial', 'slot.crafting', 'slot.campfireHint',
    'slot.anvilRename', 'slot.anvilWash', 'slot.anvilSameGear', 'slot.product',
  ];
  const creativeKeys = ['creative.tab.all', 'creative.tab.building', 'creative.tab.equipment', 'creative.tab.items', 'creative.tab.nature', 'pager.summary'];
  const all = [...panelKeys, ...stationKeys, ...slotKeys, ...creativeKeys];

  const parity = keyParity();
  const missing = all.filter((k) => parity.missingInEn.includes(k) || parity.missingInZh.includes(k) || t(k, 'zh') === k || t(k, 'en') === k);
  check(`Q13 的 ${all.length} 个键中英齐全`, missing.length === 0, missing.join(','));
  check('每条都真翻成英文', all.filter((k) => t(k, 'zh') === t(k, 'en')).length === 0);

  // 表必须改成键驱动（不是还留着中文常量）
  const stationSrc = readFileSync(new URL('../src/core/crafting/StationRecipes.ts', import.meta.url), 'utf8');
  check('站台名改成 stationLabel() 查键', stationSrc.includes('export function stationLabel(') && stationSrc.includes("'station.name.furnace'"));
  check('红底原因改成 stationReasonLabel()', stationSrc.includes('export function stationReasonLabel('));

  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  check('面板标题改成 modeTitle() 查键', invSrc.includes('function modeTitle(') && invSrc.includes("'panel.inventory'"));
  check('面板标题不再用中文常量表', !codeOf(invSrc).includes("inventory: '物品栏',"));
  check('站台标签调用会翻译的版本', invSrc.includes('stationLabel(this.stationRecipeKey())'));

  const tabsSrc = readFileSync(new URL('../src/ui/CreativeTabs.ts', import.meta.url), 'utf8');
  check('创造分类改成 creativeTabLabel()', tabsSrc.includes('export function creativeTabLabel('));

  const pagerSrc = readFileSync(new URL('../src/ui/ItemPager.ts', import.meta.url), 'utf8');
  check('分页文案走 tp()，不再拼中文', pagerSrc.includes("tp('pager.summary'") && !codeOf(pagerSrc).includes('页 · 共'));
}

console.log('\n[聊天与命令用法（批次 617 / Q14）]');
{
  /**
   * Q14 的两块：聊天输入框的 9 处提示，以及命令的 `用法：` 报错。
   *
   * 命令那部分刻意**没有**逐句翻译——39 处用法串各不相同，逐句写等于 39 条译文要维护。
   * 改成只翻 `用法：` 前缀 + `<>`/`[]` 里的参数名，语法符号原样。
   * 下面第 3 条断言是这一批的关键：**词表必须覆盖 `Commands.ts` 里出现的每个中文字段**，
   * 漏一个就会在英文界面上留一个中文词。这条断言是从源码里抽真实用法串跑的，
   * 不是手抄几个样例——手抄的话新加命令时漏掉也不会红。
   */
  const chatKeys = [
    'chat.sendLabel', 'chat.collapse', 'chat.expand', 'chat.hintIdle', 'chat.hintIdleKeyboard',
    'chat.hintCommand', 'chat.hintCommandKeyboard', 'chat.candidates', 'chat.tabComplete',
    'command.usagePrefix',
  ];
  const parity = keyParity();
  const missing = chatKeys.filter((k) => parity.missingInEn.includes(k) || parity.missingInZh.includes(k) || t(k, 'zh') === k || t(k, 'en') === k);
  check(`Q14 的 ${chatKeys.length} 个键中英齐全`, missing.length === 0, missing.join(','));
  check('每条都真翻成英文', chatKeys.filter((k) => t(k, 'zh') === t(k, 'en')).length === 0);

  // —— 命令用法：从源码抽真实用法串，逐个查字段覆盖 ——
  const cmdSrc = readFileSync(new URL('../src/core/commands/Commands.ts', import.meta.url), 'utf8');
  const usageRe = /usageError\(\s*[`']([\s\S]*?)[`']\s*,?\s*\)/g;
  const usages: string[] = [];
  for (let m = usageRe.exec(cmdSrc); m; m = usageRe.exec(cmdSrc)) usages.push(m[1]);
  check('用法报错全部走 usageError()', usages.length >= 39 && !codeOf(cmdSrc).includes('用法：'), `找到 ${usages.length} 条`);

  const cjkFields = new Set<string>();
  for (const body of usages) {
    for (const f of [...(body.match(/<([^>]*)>/g) ?? []), ...(body.match(/\[([^\]]*)\]/g) ?? [])]) {
      const inner = f.slice(1, -1);
      if (/[\u4e00-\u9fff]/.test(inner)) cjkFields.add(inner);
    }
  }
  const uncovered = [...cjkFields].filter((k) => !(k in USAGE_FIELD_NAMES));
  check(`词表覆盖全部 ${cjkFields.size} 个中文字段`, uncovered.length === 0, uncovered.join(' | '));

  // 翻译后任何括号里都不该再有中文（这才是用户会看到的东西）
  const leaks: string[] = [];
  for (const body of usages) {
    const out = translateUsageFields(body, 'en');
    for (const f of [...(out.match(/<([^>]*)>/g) ?? []), ...(out.match(/\[([^\]]*)\]/g) ?? [])]) {
      if (/[\u4e00-\u9fff]/.test(f)) leaks.push(f);
    }
  }
  check('英文模式下用法串的括号里没有中文', leaks.length === 0, [...new Set(leaks)].join(' | '));

  // 语法符号不能被翻译吃掉
  check(
    '命令名、方括号、竖线原样保留',
    translateUsageFields('/team add <队伍> [显示名] | color <颜色>', 'en') ===
      '/team add <team> [display name] | color <color>',
  );
  check('未登记的参数名原样保留（漏译能一眼看见）', translateUsageFields('/x <新参数>', 'en') === '/x <新参数>');
  check('中文模式不改动用法串', translateUsageFields('/give <物品> [数量]', 'zh') === '/give <物品> [数量]');

  // 聊天输入框：不能留硬编码
  const chatSrc = readFileSync(new URL('../src/ui/ChatInput.ts', import.meta.url), 'utf8');
  const chatCode = codeOf(chatSrc).split('\n');
  const chatHard = chatCode.filter((line) => {
    const literals = line.match(/'[^']*'/g) ?? [];
    return literals.some((x) => /[\u4e00-\u9fff]/.test(x)) && !line.includes("t('");
  });
  check('聊天输入框没有残留硬编码中文', chatHard.length === 0, chatHard.slice(0, 3).join(' / '));
  check('候选提示走占位符（不是拼中文）', chatSrc.includes("tp('chat.candidates'"));
}

console.log(`\ni18n 测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
