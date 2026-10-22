/**
 * 界面语言（M8）离线测试
 *
 * 运行：npm run test:i18n
 *
 * 这一套盯的是"两张表能不能长期保持一致"，而不是"某句翻译得好不好"——
 * 翻译质量靠人看，表的一致性只能靠断言。
 */

import { USAGE_FIELD_NAMES, translateUsageFields } from '../src/core/commands/UsageText.ts';
import { COMMAND_MESSAGES_EN } from '../src/core/commands/commandMessages.data.ts';
import { COMMAND_DESCRIPTION_EN, COMMAND_USAGE_EN } from '../src/core/commands/commandHelp.data.ts';
import { COMMANDS, executeCommand } from '../src/core/commands/Commands.ts';
import { ADVANCEMENTS, ADVANCEMENT_TABS } from '../src/core/progress/advancements.ts';
import { ADVANCEMENT_TEXT_EN, ADVANCEMENT_TAB_EN } from '../src/core/progress/advancementText.data.ts';
import { advancementDesc, advancementTabTitle, advancementTitle } from '../src/core/progress/advancementText.ts';
import { readFileSync, readdirSync } from 'node:fs';

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
import {
  FALLBACK_LOCALE,
  LOCALES,
  detectLocale,
  isLocaleCode,
  localeMeta,
  matchLocale,
} from '../src/core/i18n/locale.ts';

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

/**
 * 中文字面量守卫的**唯一判据**（多语言 P0-2 统一口径：原来这套判据在 5 处各抄了一遍）。
 *
 * 口径：**中文文案只允许住在 `src/core/i18n/locales/zh/**`**；界面、逻辑、数据文件
 * 一律走 `t()` / `tp()`。断言按"字符串字面量"判，不按"文件里有没有汉字"判——
 * 这个仓库的注释是中文的，按整份源码判等于强迫以后不准写中文注释，方向就错了。
 *
 * ⚠️ 已知边界：注释里的引号（`// 保持"按下"态`）也算字面量。
 * 那条边界记在 TASKS 的 M8 注记里，写注释用中文引号即可。
 */
const CJK_LITERAL = /(['"`])(?:(?!\1)[^\\\n])*[\u4e00-\u9fa5](?:(?!\1)[^\\\n])*\1/;

/** 整段代码里第一个带中文的字符串字面量；没有就是 null（给断言的 detail 用） */
function firstCjkLiteral(code: string): string | null {
  return CJK_LITERAL.exec(code)?.[0] ?? null;
}

/**
 * 逐行的中文字面量守卫（`'…'` 那一类）。
 * `allow` 返回 true 的行豁免——用于"这一行本来就该有 t()/msg() 包裹"的场景。
 */
function linesWithCjkLiteral(code: string, allow: (line: string) => boolean = () => false): string[] {
  return code
    .split('\n')
    .filter((line) => !allow(line))
    .filter((line) => (line.match(/'[^']*'/g) ?? []).some((one) => /[\u4e00-\u9fa5]/.test(one)));
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

console.log('\n[背包与工作站面板的残留文案（批次 1355 / M8 第 N 片）]');
{
  /**
   * 这一屏原先还有 60 多处**直接写在源码里的中文**（列标题、状态行、提示句、模板句），
   * 切英文后原地不动。断言分两层：
   *  ① 具体键**两张表都有**（漏翻一条就会在英文界面上露出中文）；
   *  ② **源码里不再有中文文案**——按"字符串字面量"判，不按"文件里有没有汉字"判：
   *     这个文件里还有行尾中文注释（`// 不可堆叠（工具 / 盔甲）` 这种），
   *     拿整份源码判会把注释也算进去，那样只能靠"以后别再写中文注释"来过关，方向错了。
   */
  const invSrc = readFileSync(new URL('../src/ui/InventoryScreen.ts', import.meta.url), 'utf8');
  const code = codeOf(invSrc);

  const leftoverKeys = [
    'inventory.rightArmor',
    'inventory.fuelEmptyPick',
    'inventory.fuelLabel',
    'inventory.slotBlocked',
    'inventory.bookAllStations',
    'inventory.bindingCurse',
    'inventory.dropped',
    'slot.productTarget',
    'slot.netheriteIngot',
    'slot.hopper5',
    'station.stoneToCut',
    'station.loomPatterns',
    'station.cartoModes',
    'station.tradeActions',
    'station.campfireOut',
    'station.brewLeft',
    'station.hopperLocked',
    'station.grindstoneXp',
    'station.craftableSummary',
    'station.anvilNeed',
    'station.enchantCostTitle',
  ];
  const parity2 = keyParity();
  const missing2 = leftoverKeys.filter(
    (k) => parity2.missingInEn.includes(k) || parity2.missingInZh.includes(k) || t(k, 'zh') === k || t(k, 'en') === k,
  );
  check(`这一屏的 ${leftoverKeys.length} 个新键中英齐全`, missing2.length === 0, missing2.join(','));
  check(
    '每个新键都真的翻成英文（不是两边抄同一句）',
    leftoverKeys.filter((k) => t(k, 'zh') === t(k, 'en')).length === 0,
  );

  // 字符串字面量里不该再有中文：`'…'` / `"…"` / 单行 `` `…` ``
  const hit = firstCjkLiteral(code);
  check('源码里不再有中文文案（都走 t() / tp()）', hit === null, hit?.slice(0, 60) ?? '');

  // 模板句必须走 tp()：这四条以前是"字符串 + 变量"拼出来的
  check('可做数量走 tp() 的占位符', code.includes("tp('station.craftableSummary'"));
  check('燃料行走 tp() 的占位符', code.includes("tp('inventory.fuelLabel'"));
  check('丢弃回执走 tp() 的占位符', code.includes("tp('inventory.dropped'"));
  check('切石机提示走 tp() 的占位符', code.includes("tp('station.stoneEach'"));
  check('不再用模板串拼"可做"', !code.includes('· 可做 '));
}

console.log('\n[设置界面的残留文案（批次 1355 / T5）]');
{
  const src = readFileSync(new URL('../src/ui/SettingsScreen.ts', import.meta.url), 'utf8');
  const code = codeOf(src);

  const keys = [
    'settings.backArrow',
    'settings.hintApplies',
    'settings.escResume',
    'settings.touchBack',
    'settings.reset',
    'settings.row.brightness',
    'settings.row.cape',
    'settings.appearance.title',
    'settings.appearance.preview',
    'settings.diagnostics',
    'settings.exportStats',
    'settings.helpDesktop',
    'settings.helpTouch',
    'settings.opt.off',
    'settings.opt.finger',
    'settings.opt.sec30',
  ];
  const parity = keyParity();
  const missing = keys.filter(
    (k) => parity.missingInEn.includes(k) || parity.missingInZh.includes(k) || t(k, 'zh') === k || t(k, 'en') === k,
  );
  check(`设置界面的 ${keys.length} 个代表键中英齐全`, missing.length === 0, missing.join(','));
  check('每个都真翻成英文', keys.filter((k) => t(k, 'zh') === t(k, 'en')).length === 0);

  const hit = firstCjkLiteral(code);
  check('源码里不再有中文文案（都走 t() / tp()）', hit === null, hit?.slice(0, 60) ?? '');

  // 五张档位标签表改成查表函数（原来是导出常量表，切语言后不跟着变）
  for (const fn of ['fpsCapLabel', 'particleLevelLabel', 'touchAimModeLabel', 'settingGroupLabel', 'autosaveLabel']) {
    check(`档位标签走 ${fn}()`, src.includes(`export function ${fn}(`));
  }
  check('帮助行两段都是键', code.includes("t('settings.helpDesktop')") && code.includes("t('settings.helpTouch')"));
  check('诊断读数走 tp() 的占位符', code.includes("tp('settings.exportStats'"));
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
  const chatHard = linesWithCjkLiteral(codeOf(chatSrc), (line) => line.includes("t('"));
  check('聊天输入框没有残留硬编码中文', chatHard.length === 0, chatHard.slice(0, 3).join(' / '));
  check('候选提示走占位符（不是拼中文）', chatSrc.includes("tp('chat.candidates'"));
}

console.log('\n[命令运行时反馈（批次 617 · 条目 [发现]）]');
{
  /**
   * 129 条回执 + 36 条 `/help` 元数据全部走 i18n。
   *
   * 这一批最大的风险不是"翻错"，而是**漏掉某一句**：命令分支多、且错误分支平时跑不到，
   * 靠人眼看源码查不住。所以下面最后一条断言是**真的跑命令**：
   * 用 46 条调用（每条命令一条 + 几条走成功分支）扫英文模式下有没有残留中文。
   * 它一次就抓出了 `usageError` 默认参数写死 `'zh'`、
   * 以及 `SCOREBOARD_USAGE` 是模块级常量这两个真 bug。
   */
  const keys = Object.keys(COMMAND_MESSAGES_EN);
  check(`命令回执词表 ${keys.length} 条`, keys.length >= 120);

  setLanguage('zh');
  const zhWrong = keys.filter((k) => t(k) !== k);
  check('中文模式下键返回原文（键写错会立刻暴露）', zhWrong.length === 0, zhWrong.slice(0, 3).join(' / '));

  setLanguage('en');
  const stillCjk = keys.filter((k) => /[\u4e00-\u9fff]/.test(t(k)));
  check('英文模式下没有一条返回中文', stillCjk.length === 0, stillCjk.slice(0, 3).join(' / '));

  // 占位符必须一一对应：中文用 {x}、英文也得是 {x}，否则英文会缺值
  const mismatch: string[] = [];
  for (const [zh, en] of Object.entries(COMMAND_MESSAGES_EN)) {
    const a = (zh.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    const b = (en.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    if (a !== b) mismatch.push(`${zh} ↔ ${en}`);
  }
  check('中英占位符一一对应', mismatch.length === 0, mismatch.slice(0, 3).join(' / '));

  // `/help` 的 usage + description
  const helpMissing = COMMANDS.filter(
    (spec) => !(spec.name in COMMAND_USAGE_EN) || !(spec.name in COMMAND_DESCRIPTION_EN),
  ).map((spec) => spec.name);
  check(`/help 的 ${COMMANDS.length} 条命令都有中英两版`, helpMissing.length === 0, helpMissing.join(','));

  // —— 真跑：英文模式下扫残留中文 ——
  const stub = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') return undefined;
        return () => {
          switch (prop) {
            case 'playerName':
              return 'Steve';
            case 'position':
              return { x: 10, y: 64, z: 10, dimension: 'overworld' };
            case 'isCreative':
              return true;
            case 'seed':
              return 42;
            case 'gameRules':
              return { keepInventory: false };
            default:
              return undefined;
          }
        };
      },
    },
  ) as never;

  const cases = [...COMMANDS.map((spec) => `/${spec.name}`), '/weather clear', '/difficulty easy', '/gamemode survival', '/time set day', '/seed', '/gamerule keepInventory true', '/help'];
  const leaked: string[] = [];
  for (const cmd of cases) {
    const lines: string[] = [];
    try {
      executeCommand(cmd, stub, { info: (m: string) => lines.push(m), error: (m: string) => lines.push(m) } as never);
    } catch {
      /* stub 不完整导致的异常不算失败 */
    }
    for (const line of lines) {
      if (/[\u4e00-\u9fff]/.test(line)) leaked.push(`${cmd} → ${line.split('\n')[0].slice(0, 60)}`);
    }
  }
  check(`英文模式下跑 ${cases.length} 条命令，输出无中文`, leaked.length === 0, [...new Set(leaked)].slice(0, 5).join(' / '));

  // 源码里不该再有中文的 out.* 调用
  const cmdSrc = readFileSync(new URL('../src/core/commands/Commands.ts', import.meta.url), 'utf8');
  const rawOut = linesWithCjkLiteral(
    codeOf(cmdSrc),
    (line) => line.includes('msg(') || line.includes('usageError('),
  ).filter((line) => /out\.(info|error)\(/.test(line));
  check('源码里没有硬编码中文的 out.* 调用', rawOut.length === 0, rawOut.slice(0, 3).join(' / '));
}

console.log('\n[地图 / 成就 / 死亡遮罩（批次 619 / Q15）]');
{
  /**
   * Q15 的四个界面。这里除了查键，还查一条**结构**：
   * 死亡与睡觉遮罩的文案原来写死在 `index.html` 里，静态 HTML 不参与重绘，
   * 切语言后那几行永远不变 —— 所以断言 "index.html 里不许再有这几句中文"。
   * 这条防的不是"忘了翻译"，是"以后有人图省事又把文案塞回 HTML"。
   */
  const keys = [
    'map.title', 'map.locked',
    'advancement.close', 'advancement.closeLabel', 'advancement.filterAll',
    'advancement.lockedHint', 'advancement.earned', 'advancement.challengeDone',
    'advancement.locked', 'advancement.challenge', 'advancement.available',
    'advancement.toastDone', 'advancement.toastChallenge',
    'death.title', 'death.respawning', 'sleep.dawn', 'sleep.hint', 'sleep.lieDown',
  ];
  const parity = keyParity();
  const missing = keys.filter(
    (k) => parity.missingInEn.includes(k) || parity.missingInZh.includes(k) || t(k, 'zh') === k || t(k, 'en') === k,
  );
  check(`Q15 的 ${keys.length} 个键中英齐全`, missing.length === 0, missing.join(','));
  check('每条都真翻成英文', keys.filter((k) => t(k, 'zh') === t(k, 'en')).length === 0);

  const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  for (const [file, label] of [
    ['src/ui/MapScreen.ts', '地图'],
    ['src/ui/AdvancementScreen.ts', '成就'],
    ['src/ui/AdvancementToast.ts', '成就弹窗'],
  ] as const) {
    const hard = linesWithCjkLiteral(codeOf(read(file)), (line) => line.includes("t('"));
    check(`${label}界面没有残留硬编码中文`, hard.length === 0, hard.slice(0, 2).join(' / '));
  }

  // 静态 HTML 里不许再写死这几句
  const html = read('index.html');
  // 只看 `<body>` 里的**标记**：这个仓库的 CSS 直接写在 `<style>` 里（也在 body 内），
  // 而注释里会提到这几句作为解释（"别和「正在重生」挤在一起"），不是写死的文案。
  // 第一版整份 HTML 一起查，被注释误判成红；第二版剥了 `<!-- -->` 还是红，因为那是 `/* */`。
  const bodyHtml = html.slice(html.indexOf('<body'));
  const markup = bodyHtml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const htmlHard = ['你死了！', '正在重生…', '天快亮了', '跳跃键可以提前起床'].filter((s) => markup.includes(s));
  check('body 标记里没有写死死亡/睡觉文案', htmlHard.length === 0, htmlHard.join(' / '));
  check('死亡卡片改成三个可写入的节点', html.includes('death-title') && html.includes('death-cause') && html.includes('death-respawn'));
  check('睡觉遮罩改成两个可写入的节点', html.includes('sleep-dawn') && html.includes('sleep-hint'));

  // 主程序必须真的往里写
  const mainSrc = read('src/main.ts');
  check('死亡时写标题与尾句', mainSrc.includes("t('death.title')") && mainSrc.includes("t('death.respawning')"));
  check('睡觉时写两行提示', mainSrc.includes("t('sleep.dawn')") && mainSrc.includes("t('sleep.hint')"));
}

console.log('\n[成就数据层（批次 620）]');
{
  /**
   * Q15 只接了成就**界面词**，数据本身（100 条 title / desc）还是中文。
   * 这一批补上英文，并且刻意**不加字段到 `AdvancementDef`**（见数据文件头）：
   * 离线断言按中文 title 匹配、验的是判定逻辑，加英文到原对象会让那批断言白改。
   *
   * 关键断言是最后两条：一条查"100 个 id 一条不漏"，一条查"切到英文后
   * 用真实数据算出来的标题/说明里没有中文"。漏一条 → 英文界面上蹦一句中文，
   * 而这种漏最容易发生在"新加一条进度但忘了加英文"上。
   */
  const enCount = Object.keys(ADVANCEMENT_TEXT_EN).length;
  check(`英文词条覆盖全部 ${ADVANCEMENTS.length} 条进度`, enCount === ADVANCEMENTS.length, `实际 ${enCount}`);

  const noEn = ADVANCEMENTS.filter((a) => !(a.id in ADVANCEMENT_TEXT_EN)).map((a) => a.id);
  check('每个 id 都有英文条目（按 id 对齐，不是按顺序）', noEn.length === 0, noEn.slice(0, 3).join(','));

  const emptyEn = Object.entries(ADVANCEMENT_TEXT_EN)
    .filter(([, v]) => !v.title.trim() || !v.desc.trim())
    .map(([k]) => k);
  check('英文标题与说明都非空', emptyEn.length === 0, emptyEn.slice(0, 3).join(','));

  const tabEn = Object.keys(ADVANCEMENT_TAB_EN);
  check(`五个标签页都有英文`, ADVANCEMENT_TABS.every((x) => tabEn.includes(x.id)));

  // 中文模式必须**原样返回**（不能因为加了英文就动了中文）
  setLanguage('zh');
  const zhChanged = ADVANCEMENTS.filter((a) => advancementTitle(a) !== a.title || advancementDesc(a) !== a.desc);
  check('中文模式下标题与说明原样不动', zhChanged.length === 0, zhChanged.slice(0, 2).map((a) => a.id).join(','));

  // 英文模式不许残留中文
  setLanguage('en');
  const leaked = ADVANCEMENTS.filter(
    (a) => /[\u4e00-\u9fff]/.test(advancementTitle(a)) || /[\u4e00-\u9fff]/.test(advancementDesc(a)),
  ).map((a) => a.id);
  check('英文模式下没有任何一条残留中文', leaked.length === 0, leaked.slice(0, 3).join(','));
  check(
    '标签页名也全英文',
    ADVANCEMENT_TABS.every((x) => !/[\u4e00-\u9fff]/.test(advancementTabTitle(x))),
  );

  // 界面必须真的调这几个函数（防"加了数据没接线"）
  const screenSrc = readFileSync(new URL('../src/ui/AdvancementScreen.ts', import.meta.url), 'utf8');
  const toastSrc = readFileSync(new URL('../src/ui/AdvancementToast.ts', import.meta.url), 'utf8');
  check('成就面板用 advancementTitle / advancementDesc', screenSrc.includes('advancementTitle(def)') && screenSrc.includes('advancementDesc(def)'));
  check('标签页用 advancementTabTitle', screenSrc.includes('advancementTabTitle(tab)'));
  check('成就弹窗标题也按语言取', toastSrc.includes('advancementTitle(def)'));
  check('面板顶部统计走占位符', screenSrc.includes("tp('advancement.summary'"));
}

console.log('\n[语言元数据与匹配（多语言 P0-1）]');
{
  /**
   * 这一节盯的是"加语言时不会散架"的三件事：
   *  ① 元数据本身齐全（自称 / htmlLang）—— 语言选择器与 `<html lang>` 都直接吃它；
   *  ② 匹配规则（前缀、大小写、下划线写法）—— 设备标签五花八门，认错会把界面切成看不懂的语言；
   *  ③ **兜底是英文**：这是 Play 发行口径，和"默认中文"是两件事，分开验。
   */
  check('六种语言都登记了', LOCALES.length === 6, LOCALES.map((x) => x.code).join(','));
  check('语言码不重复', new Set(LOCALES.map((x) => x.code)).size === LOCALES.length);
  check('每种语言都有自己的自称', LOCALES.every((x) => x.nativeName.trim().length > 0));
  check(
    '每种语言都有合法的 htmlLang（`zh-CN` / `pt-BR` 这种带地区的写法）',
    LOCALES.every((x) => /^[a-z]{2}(-[A-Z]{2})?$/.test(x.htmlLang)),
    LOCALES.filter((x) => !/^[a-z]{2}(-[A-Z]{2})?$/.test(x.htmlLang)).map((x) => x.code).join(','),
  );
  check('zh / en 必须在（回落链两端的锚点）', isLocaleCode('zh') && isLocaleCode('en'));
  check('未登记的语言码不合法', !isLocaleCode('ja') && !isLocaleCode('') && !isLocaleCode(undefined));

  check('zh-CN → zh', matchLocale('zh-CN') === 'zh');
  check('zh-Hant → zh（本项目不分简繁，都给简体）', matchLocale('zh-Hant') === 'zh');
  check('pt-BR → pt', matchLocale('pt-BR') === 'pt');
  check('pt-PT → pt', matchLocale('pt-PT') === 'pt');
  check('de-AT → de', matchLocale('de-AT') === 'de');
  check('fr-CA → fr', matchLocale('fr-CA') === 'fr');
  check('大小写不敏感', matchLocale('ZH-cn') === 'zh');
  check('下划线写法也认（Android 会给 zh_CN）', matchLocale('zh_CN') === 'zh');
  check('没登记的语言返回 null（不在这里猜）', matchLocale('ja-JP') === null);
  check('空串 / 纯空白 / undefined 返回 null', matchLocale('') === null && matchLocale('  ') === null && matchLocale(undefined) === null);
  check('null 返回 null', matchLocale(null) === null);

  check('detectLocale 认得就返回自己', detectLocale('de-AT') === 'de');
  check('detectLocale 认不得就兜底英文', detectLocale('ja-JP') === FALLBACK_LOCALE && FALLBACK_LOCALE === 'en');
  check('detectLocale 没有标签也兜底英文', detectLocale(undefined) === 'en');

  check('localeMeta 能取回元数据（含带地区的 htmlLang）', localeMeta('pt')?.htmlLang === 'pt-BR');
  check('localeMeta 对未登记的语言返回 null', localeMeta('ja') === null);
}

console.log('\n[文案表的落脚点（多语言 P0-2 / P0-3）]');
{
  /**
   * 口径：**中文文案只允许住在 `src/core/i18n/locales/zh/**`**，界面 / 逻辑 / 数据文件
   * 一律走 `t()` / `tp()`。这一节盯的是"目录结构还在"——防的是有人图省事
   * 又把一张大表塞回 `I18n.ts`（那样下次加语言又要在一千行里对着找）。
   */
  const zhDir = new URL('../src/core/i18n/locales/zh/', import.meta.url);
  const zhFiles = readdirSync(zhDir).filter((name) => name.endsWith('.ts'));
  check('中文表按界面拆成多个文件', zhFiles.length >= 8, zhFiles.join(','));
  check('index.ts 是合并入口', zhFiles.includes('index.ts'));

  const indexSource = readFileSync(new URL('../src/core/i18n/locales/zh/index.ts', import.meta.url), 'utf8');
  const orphans = zhFiles.filter((name) => name !== 'index.ts' && !indexSource.includes(`'./${name}'`));
  check('每个分组文件都被 index.ts 合并（不留孤儿文件）', orphans.length === 0, orphans.join(','));

  // 中文表里的值必须非空：拆文件时漏掉一格会变成"界面上一块空白"
  const emptyValues = Object.entries(TABLES.zh).filter(([, value]) => value.trim().length === 0).map(([key]) => key);
  check('中文表没有空值', emptyValues.length === 0, emptyValues.slice(0, 3).join(','));

  /**
   * 英文那一侧（多语言 P0-3）：分组要一一对应，而且**每个分组都必须带
   * `satisfies Pick<Messages, …>`**。少写那一行不会有任何报错，于是"漏翻一条"就退回
   * 到"跑测试才发现"——这条断言防的就是这个（类型保护被悄悄删掉）。
   */
  const enDir = new URL('../src/core/i18n/locales/en/', import.meta.url);
  const enGroups = readdirSync(enDir).filter((name) => name.endsWith('.ts') && name !== 'index.ts');
  const zhGroups = zhFiles.filter((name) => name !== 'index.ts');
  check(
    '英文表与中文同构（分组文件一一对应）',
    enGroups.length === zhGroups.length && zhGroups.every((name) => enGroups.includes(name)),
    `zh=[${zhGroups.join(',')}] en=[${enGroups.join(',')}]`,
  );
  const unchecked = enGroups.filter(
    (name) => !readFileSync(new URL(name, enDir), 'utf8').includes('satisfies Pick<Messages'),
  );
  check('每个英文分组都用 satisfies 卡齐（漏写就等于没有编译期保护）', unchecked.length === 0, unchecked.join(','));
  check('英文 index.ts 用 satisfies Messages 收口', readFileSync(new URL('index.ts', enDir), 'utf8').includes('} satisfies Messages;'));
}

console.log(`\ni18n 测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
