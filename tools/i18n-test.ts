/**
 * 界面语言（M8）离线测试
 *
 * 运行：npm run test:i18n
 *
 * 这一套盯的是"两张表能不能长期保持一致"，而不是"某句翻译得好不好"——
 * 翻译质量靠人看，表的一致性只能靠断言。
 */

import { COMMANDS, executeCommand, findCommand, usageError } from '../src/core/commands/Commands.ts';
import { commandHelpEntries } from '../src/core/commands/CommandHelp.ts';
// 多语言 P2-3c3：效果名键化的守卫要逐个核对
import { EFFECTS } from '../src/core/survival/StatusEffects.ts';
// 多语言 P2-4：生物名
import { mobLabel } from '../src/core/entity/Mob.ts';
import { MOB_TYPES } from '../src/core/entity/mobs.ts';
import { DIMENSION_CYCLE } from '../src/core/gen/Dimension.ts';
import { WORLD_TYPES } from '../src/core/gen/WorldType.ts';
import { BIOMES } from '../src/core/gen/Biome.ts';
import { ENCHANTMENTS } from '../src/core/registry/enchantments.ts';
import { PROFESSIONS } from '../src/core/registry/villagerTrades.ts';
import { SOUND_GROUPS } from '../src/core/audio/AudioEngine.ts';
import {
  BEARD_STYLES,
  BODY_BUILDS,
  BODY_FRAMES,
  EYE_COLORS,
  EYE_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
} from '../src/game/appearance.ts';
import { RECIPE_BOOK_TABS } from '../src/core/crafting/RecipeBook.ts';
import { ITEM_CATEGORIES } from '../src/core/registry/items.ts';
import { DRAGON_TYPE, END_CRYSTAL_TYPE } from '../src/core/entity/EndBoss.ts';
import { PHANTOM_TYPE } from '../src/core/entity/Phantom.ts';
import { WITHER_TYPE } from '../src/core/entity/Wither.ts';
import { ADVANCEMENTS, ADVANCEMENT_TABS } from '../src/core/progress/advancements.ts';
import { ADVANCEMENT_TEXT_EN, ADVANCEMENT_TAB_EN } from '../src/core/progress/advancementText.data.ts';
import { advancementDesc, advancementTabTitle, advancementTitle } from '../src/core/progress/advancementText.ts';
import { readFileSync, readdirSync } from 'node:fs';

import {
  AUTO_LANGUAGE,
  DEFAULT_LANGUAGE,
  LANGUAGE_NAMES,
  TABLES,
  allKeys,
  applyLanguageSetting,
  availableLanguages,
  detectLanguage,
  getLanguage,
  isLanguage,
  isLanguageSetting,
  isPseudoLocale,
  isPseudoLocaleTag,
  keyParity,
  loadLocale,
  setPseudoLocale,
  pluralCategory,
  registerLocaleLoader,
  resetLanguageForTest,
  resolveLanguage,
  setLanguage,
  t,
  tableOf,
  tn,
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
  type LocaleCode,
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
  for (const language of availableLanguages()) {
    for (const [key, value] of Object.entries(tableOf(language))) {
      if (typeof value !== 'string' || value.trim().length === 0) empty.push(`${language}:${key}`);
    }
  }
  check('没有空文案（空串在界面上会变成"按钮是空的"）', empty.length === 0, empty.join(', '));

  check(
    '有表的语言都在可选清单里（可选清单是函数，P0-7 起会在加载后变长）',
    (Object.keys(TABLES) as LocaleCode[]).every((code) => availableLanguages().includes(code)),
  );
  check('每种语言都有自己的自称', availableLanguages().every((language) => (LANGUAGE_NAMES[language] ?? '').length > 0));
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
  // ⚠️ 多语言 P0-4 起口径变了：原来"认不出来回中文"，现在"认全六种、认不出来回英文"
  check('navigator 给 fr-FR → 法语（不再一律回中文）', detectLanguage('fr-FR') === 'fr');
  check('navigator 给 de-AT → 德语', detectLanguage('de-AT') === 'de');
  check('navigator 给 pt-BR → 葡语', detectLanguage('pt-BR') === 'pt');
  check('认不出来的语言回英文（Play 发行口径）', detectLanguage('ja-JP') === 'en');
  check('没有 navigator 标签时回英文', detectLanguage(undefined) === 'en');
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

console.log('\n[枚举清单的连接词（批次 427 / 多语言 P0-6）]');
{
  /**
   * 多语言 P0-6 起一律走 `Intl.ListFormat(conjunction)`，**连接词由语言决定**。
   * ⚠️ 中文因此从"木板、圆石、木棍"变成"木板、圆石和木棍"——这是用户拍板的
   * 有意的行为变化（换来不再为每种语言手写连接规则），所以断言也照新口径写。
   */
  check('中文三项用"和"收尾', joinList(['木板', '圆石', '木棍'], 'zh') === '木板、圆石和木棍', joinList(['木板', '圆石', '木棍'], 'zh'));
  check('中文两项用"和"', joinList(['木板', '圆石'], 'zh') === '木板和圆石', joinList(['木板', '圆石'], 'zh'));
  check('英文两项用 and', joinList(['Planks', 'Cobblestone'], 'en') === 'Planks and Cobblestone');
  check(
    '英文三项是 "a, b, and c"（牛津逗号）',
    joinList(['Planks', 'Cobblestone', 'Stick'], 'en') === 'Planks, Cobblestone, and Stick',
    joinList(['Planks', 'Cobblestone', 'Stick'], 'en'),
  );
  // 每种语言的连接词都不一样，这正是不能手写 if 的理由
  check('德语用 und', joinList(['A', 'B', 'C'], 'de') === 'A, B und C', joinList(['A', 'B', 'C'], 'de'));
  check('法语用 et', joinList(['A', 'B', 'C'], 'fr') === 'A, B et C', joinList(['A', 'B', 'C'], 'fr'));
  check('葡语用 e', joinList(['A', 'B', 'C'], 'pt') === 'A, B e C', joinList(['A', 'B', 'C'], 'pt'));
  check('俄语用 и', joinList(['A', 'B', 'C'], 'ru') === 'A, B и C', joinList(['A', 'B', 'C'], 'ru'));
  check('一项不加分隔符', joinList(['木板'], 'zh') === '木板' && joinList(['Planks'], 'en') === 'Planks');
  check('空清单返回空串', joinList([], 'en') === '');
  check('空字符串项被跳过', joinList(['木板', '', '圆石'], 'zh') === '木板和圆石', joinList(['木板', '', '圆石'], 'zh'));
}

console.log('\n[复数（多语言 P0-6）]');
{
  /**
   * 复数**不是二分的**：俄语 4 种、法语 0 算单数。所以判定必须交给
   * `Intl.PluralRules`，而 `tn()` 只在"该语言登记过这条键"时才换模板。
   */
  check('英文 1 → one / 2 → other', pluralCategory(1, 'en') === 'one' && pluralCategory(2, 'en') === 'other');
  check(
    '俄语 1 → one / 2 → few / 5 → many / 1.5 → other / 21 → one',
    ['one', 'few', 'many', 'other', 'one'].every((want, i) => pluralCategory([1, 2, 5, 1.5, 21][i]!, 'ru') === want),
    [1, 2, 5, 1.5, 21].map((n) => `${n}:${pluralCategory(n, 'ru')}`).join(' '),
  );
  check('法语 0 和 1 都算单数（0 jour 不是 0 jours）', pluralCategory(0, 'fr') === 'one' && pluralCategory(1, 'fr') === 'one' && pluralCategory(2, 'fr') === 'other');

  setLanguage('en');
  check('英文单数走 one 形式', tn('station.brewLeft', 1) === '1 more brew', tn('station.brewLeft', 1));
  check('英文复数走 other 形式', tn('station.brewLeft', 3) === '3 more brews', tn('station.brewLeft', 3));
  check('额外参数照样能传', tn('station.brewLeft', 2, { extra: 'x' }) === '2 more brews', tn('station.brewLeft', 2, { extra: 'x' }));

  setLanguage('zh');
  check('中文没有复数表 → 回落 t()，{count} 照样替换', tn('station.brewLeft', 1) === '还能酿 1 次', tn('station.brewLeft', 1));
  check('中文复数与单数同一条', tn('station.brewLeft', 5) === '还能酿 5 次', tn('station.brewLeft', 5));
  check('没登记复数的键也能用 tn（等于 tp）', tn('inventory.fuelLabel', 2, { item: '煤炭' }) === '燃料：煤炭 ×2', tn('inventory.fuelLabel', 2, { item: '煤炭' }));

  setLanguage('de');
  check('还没表/没复数表的语言：tn 也回落英文', tn('station.brewLeft', 1) === '1 more brew', tn('station.brewLeft', 1));
  resetLanguageForTest();
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
    'slot.enchantMaterial', 'slot.crafting', 'slot.campfireHint',
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

  // —— 用法报错（多语言 P1-2 起传**命令名**，不再各自抄一份用法串）——
  const cmdSrc = readFileSync(new URL('../src/core/commands/Commands.ts', import.meta.url), 'utf8');
  const nameArgs: string[] = [];
  for (const m of codeOf(cmdSrc).matchAll(/usageError\(\s*'([^']*)'\s*\)/g)) nameArgs.push(m[1]!);
  check('用法报错全部走 usageError() 且传命令名', nameArgs.length >= 39 && !codeOf(cmdSrc).includes('用法：'), `找到 ${nameArgs.length} 处`);

  const unknownNames = [...new Set(nameArgs)].filter((name) => findCommand(name) === undefined);
  check('每处 usageError 传的都是真实命令名（写错就查不到表）', unknownNames.length === 0, unknownNames.join(','));

  // 核心口径：**报错里的用法与 `/help` 那句是同一句**（同一个 `cmd.<name>.usage`），不会各写一份
  setLanguage('zh');
  const inconsistent = COMMANDS.filter(
    (spec) => usageError(spec.name) !== `${t('command.usagePrefix')}${t(spec.usageKey)}`,
  ).map((spec) => spec.name);
  check('报错里的用法与 /help 里那句完全一致', inconsistent.length === 0, inconsistent.join(','));

  setLanguage('en');
  check(
    '报错里的用法在英文模式下是英文（不再靠词表逐字段替换）',
    !/[\u4e00-\u9fff]/.test(usageError('give')),
    usageError('give'),
  );
  resetLanguageForTest();

  // 聊天输入框：不能留硬编码
  const chatSrc = readFileSync(new URL('../src/ui/ChatInput.ts', import.meta.url), 'utf8');
  const chatHard = linesWithCjkLiteral(codeOf(chatSrc), (line) => line.includes("t('"));
  check('聊天输入框没有残留硬编码中文', chatHard.length === 0, chatHard.slice(0, 3).join(' / '));
  check('候选提示走占位符（不是拼中文）', chatSrc.includes("tp('chat.candidates'"));

  /**
   * 命令帮助面板的显示文案（多语言 P1-3b）。
   *
   * 这个文件长期是"最大的一块未接 i18n 的中文"：值标签 45 条、字段短标签 28 条、
   * 面板短语 40 余条，全部硬编码在里面。搬完之后立一条守卫，
   * 防的是"以后顺手又写一句中文"——那种回退没有任何其它检查能发现。
   */
  const helpSrc = readFileSync(new URL('../src/core/commands/CommandHelp.ts', import.meta.url), 'utf8');
  const helpHard = linesWithCjkLiteral(codeOf(helpSrc));
  check('命令帮助面板没有残留中文字面量（全部走 cmd.help.*）', helpHard.length === 0, helpHard.slice(0, 3).join(' / '));

  // 整屏 DOM（多语言 P1-4）：标题 / 搜索 / 空态 / 操作列 / 填入 / 可选 / 自定义 / 预览 / 必填提示
  const helpScreenSrc = readFileSync(new URL('../src/ui/CommandHelpScreen.ts', import.meta.url), 'utf8');
  const helpScreenHard = linesWithCjkLiteral(codeOf(helpScreenSrc));
  check(
    '命令帮助整屏没有残留中文字面量（全部走 cmd.help.screen.*）',
    helpScreenHard.length === 0,
    helpScreenHard.slice(0, 3).join(' / '),
  );
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
  /**
   * 命令回执（多语言 P1-6 起）：已并进 `cmd.reply.*`，与界面文案同一套表。
   * 旧表 `commandMessages.data.ts` 已删除 —— P1-5 那三条"与旧表逐条一致"的护栏完成了使命
   * （搬迁时它挡住过 `\n` 转义那次错误），现在退化成"条数够 + 中英都不是键名"。
   */
  const replyKeys = allKeys().filter((key) => key.startsWith('cmd.reply.'));
  check(`命令回执 ${replyKeys.length} 条`, replyKeys.length >= 170, String(replyKeys.length));
  check('每条回执都能查到中文（没露出键名）', replyKeys.every((key) => t(key, 'zh') !== key));
  // ⚠️ 判据是「中文里有汉字时英文才必须不同」：`{name} Health = {value}` 这类**语言中性**的
  // 回执两边本来就一模一样（P0-6 判英文表完整性时同样踩过这条）
  const notTranslated = replyKeys.filter(
    (key) => /[\u4e00-\u9fff]/.test(t(key, 'zh')) && t(key, 'en') === t(key, 'zh'),
  );
  check('每条回执都真翻成英文（语言中性的除外）', notTranslated.length === 0, notTranslated.slice(0, 3).join(' / '));

  // 英文回执里不许有中文（这才是用户会看到的东西）
  const stillCjk = replyKeys.filter((key) => /[\u4e00-\u9fff]/.test(t(key, 'en')));
  check('英文模式下没有一条回执返回中文', stillCjk.length === 0, stillCjk.slice(0, 3).join(' / '));

  // 占位符必须一一对应：中文用 {x}、英文也得是 {x}，否则英文会缺值
  const mismatch: string[] = [];
  for (const key of replyKeys) {
    const a = (t(key, 'zh').match(/\{(\w+)\}/g) ?? []).sort().join(',');
    const b = (t(key, 'en').match(/\{(\w+)\}/g) ?? []).sort().join(',');
    if (a !== b) mismatch.push(`${key}：${a} ↔ ${b}`);
  }
  check('中英占位符一一对应', mismatch.length === 0, mismatch.slice(0, 3).join(' / '));

  /**
   * `/help` 的 usage + description（多语言 P1-1b 起 spec 里存的是**键**）。
   *
   * 这几条替代了原来那批"和 `commandHelp.data.ts` 逐条比对"的断言：那张表已经删了，
   * 现在**表就是唯一真相**，所以改判"键在不在表里 + 中英是否真的不同 + 语法符号有没有被吃掉"。
   */
  const helpMissing = COMMANDS.filter(
    (spec) =>
      !allKeys().includes(spec.usageKey) ||
      !allKeys().includes(spec.descriptionKey) ||
      t(spec.usageKey) === spec.usageKey ||
      t(spec.descriptionKey) === spec.descriptionKey,
  ).map((spec) => spec.name);
  check(`/help 的 ${COMMANDS.length} 条命令的 usage/desc 键都在表里`, helpMissing.length === 0, helpMissing.join(','));

  /**
   * ⚠️ 判据是"**英文用法里不许有中文**"，不是"中英必须不同"：
   * `/clear`、`/seed`、`/weather <clear|rain|thunder>` 这类用法**本来就没有可翻的字**，
   * 中英一字不差是对的（第一版写成"必须不同"，当场误报了 10 条）。
   */
  const untranslatedHelp = COMMANDS.filter((spec) => /[\u4e00-\u9fff]/.test(t(spec.usageKey, 'en'))).map((spec) => spec.name);
  check('英文用法里没有残留中文', untranslatedHelp.length === 0, untranslatedHelp.join(','));

  /**
   * 用法串里的**语法符号**不能被翻译吃掉：`<>` `[]` `|` 的个数中英必须一致。
   * 帮助面板靠这些符号拆变体（`CommandHelp.ts` 的 `splitVariants`），少一个括号就拆不出来。
   */
  const syntaxDrift: string[] = [];
  for (const spec of COMMANDS) {
    const zh = t(spec.usageKey, 'zh');
    const en = t(spec.usageKey, 'en');
    const count = (text: string, ch: string): number => text.split(ch).length - 1;
    if (count(zh, '<') !== count(en, '<') || count(zh, '[') !== count(en, '[')) syntaxDrift.push(spec.name);
  }
  check('用法串的 <> / [] 个数中英一致（翻译不能吃掉语法符号）', syntaxDrift.length === 0, syntaxDrift.join(','));

  // —— 真跑：英文模式下扫残留中文 ——
  setLanguage('en');
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
  resetLanguageForTest();

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

console.log('\n[稀疏表与回落链（多语言 P0-4）]');
{
  /**
   * 这一节盯的是"6 种语言里只装了 2 张表"这个中间状态能不能安全运行：
   *  ① 没表的不该出现在下拉里（"能选但没内容"比不列更糟）；
   *  ② 存档里存了没表的语言不该被判成脏数据（否则玩家换设备后设置被重置）；
   *  ③ 查不到就按 当前 → 英文 → 中文 → 键名 走，**不抛异常、不返回空串**。
   */
  check(
    '支持 6 种语言，但只有有表（或登记了加载器）的才能选',
    LOCALES.length === 6 && availableLanguages().length < LOCALES.length,
    `available=${availableLanguages().join(',')}`,
  );
  /**
   * 多语言 P4-1 起口径变了：可选语言 = **有表 或 登记了加载器** 的那些。
   * 德语是"有加载器、表按需加载"，所以不能再拿 `Object.keys(TABLES).length` 去比。
   * 改成验真正关心的事：**每个可选语言都能确实拿到表**（静态表，或加载器真能加载出来）。
   */
  const unreachable: string[] = [];
  for (const code of availableLanguages()) {
    if (TABLES[code] !== undefined) continue;
    if (!(await loadLocale(code))) unreachable.push(code);
  }
  check(
    '每个可选语言都能真的拿到表（静态表或可加载）',
    unreachable.length === 0,
    unreachable.join(','),
  );
  check(
    '有静态表的语言一定在可选清单里',
    (Object.keys(TABLES) as LocaleCode[]).every((code) => availableLanguages().includes(code)),
    Object.keys(TABLES).join(','),
  );
  check('存档里存了还没表的语言也不算脏数据', isLanguage('de') && isLanguage('pt'));
  check('没登记的语言仍然不合法', !isLanguage('ja') && !isLanguage('xx'));
  // 多语言 P4-1：de 已经有表（按需加载），"没装表"的例子改用 ru / pt
  check('没装表的语言查出来是空表（不抛异常）', Object.keys(tableOf('ru')).length === 0);
  check('缺表时回落英文', t('pause.title', 'ru') === t('pause.title', 'en'), t('pause.title', 'ru'));
  check('俄语同理（回落链不看具体是哪种语言）', t('pause.resume', 'ru') === 'Resume Game', t('pause.resume', 'ru'));
  check('一路回落到头就返回键名', t('no.such.key', 'ru') === 'no.such.key', t('no.such.key', 'ru'));
  // 回落链只留英文一档（多语言 P0-6 去掉了"最后退中文"）——前提是英文表真的完整。
  // ⚠️ 判据必须是"**键在不在**英文表里"，不能写成 `t(key) === key`：
  // 命令回执里有 `{name} Health = {value}` 这种语言中性的条目，英文值**就是键本身**，
  // 那样判会把正常条目误报成漏翻。
  const missingInEn = allKeys().filter((key) => !(key in tableOf(FALLBACK_LOCALE)));
  check('英文表覆盖全部中文键（回落链只剩英文一档，缺一条就会露出键名）', missingInEn.length === 0, missingInEn.slice(0, 3).join(','));
  check('有表时不会串味', t('pause.title', 'zh') === '游戏已暂停' && t('pause.title', 'en') === 'Game Paused');
}

console.log('\n[设置项：跟随系统（多语言 P0-5）]');
{
  /**
   * `auto` 不是一种语言：它没有文案表，也不该进 `TABLES`，只存在于**设置项**里。
   * 所以这里验三件事：合法值判定、按设备标签解析、以及"具体语言不会被设备标签覆盖"。
   * `tag` 一律显式传入——否则结果会跟着跑测试那台机器的系统语言变。
   */
  check('auto 是合法的设置值', isLanguageSetting(AUTO_LANGUAGE) && AUTO_LANGUAGE === 'auto');
  check('具体语言码也是合法设置值', isLanguageSetting('zh') && isLanguageSetting('de') && isLanguageSetting('pt'));
  check('写坏了不算（会回落到 auto）', !isLanguageSetting('xx') && !isLanguageSetting(undefined) && !isLanguageSetting(42));

  check('auto 按设备标签解析', resolveLanguage('auto', 'de-AT') === 'de');
  check('auto + 认不出的标签 → 英文', resolveLanguage('auto', 'ja-JP') === 'en');
  check('auto + 没有标签 → 英文', resolveLanguage('auto', undefined) === 'en');
  check('具体语言不会被设备标签覆盖', resolveLanguage('zh', 'de-DE') === 'zh');

  resetLanguageForTest();
  check(
    'applyLanguageSetting 会真的切过去（auto）',
    (await applyLanguageSetting('auto', 'pt-BR')) === 'pt' && getLanguage() === 'pt',
    getLanguage(),
  );
  check(
    'applyLanguageSetting 传具体语言也生效',
    (await applyLanguageSetting('zh', 'de-DE')) === 'zh' && getLanguage() === 'zh',
    getLanguage(),
  );
  resetLanguageForTest();
}

console.log('\n[按需加载（多语言 P0-7）]');
{
  /**
   * 这一节放在**最后**：它会注册一个假语言（`de`）并往 `TABLES` 里填表，
   * 前面那些"没表就回落到英文"的断言必须先跑完。
   *
   * 验的是启动流程依赖的那条链：**登记加载器 → loadLocale → 表进池子 → t() 查得到**。
   * P4 加真实语言时做的正是同一件事（在 `LOADERS` 里加一行）。
   */
  check('静态语言（zh / en）本来就是就位的', (await loadLocale('zh')) && (await loadLocale('en')));
  check('没有加载器的语言加载失败（返回 false，不抛异常）', (await loadLocale('ru')) === false);
  check('加载失败不影响查表（回落链照旧）', t('pause.title', 'ru') === 'Game Paused', t('pause.title', 'ru'));

  // 假语言：只给一条文案，足够验证"加载 → 可查"这条链
  registerLocaleLoader('ru', async () => ({ ru: { 'pause.title': 'Пауза' } }));
  check('登记加载器后出现在可选清单里', availableLanguages().includes('ru'), availableLanguages().join(','));
  check('加载成功', (await loadLocale('ru')) === true);
  check('加载后表进了池子', tableOf('ru')['pause.title'] === 'Пауза');
  check('加载后真能查出来', t('pause.title', 'ru') === 'Пауза', t('pause.title', 'ru'));
  check('重复加载是幂等的（第二次直接命中表）', (await loadLocale('ru')) === true);
  check('假语言缺的键仍回落英文', t('pause.resume', 'ru') === 'Resume Game', t('pause.resume', 'ru'));
  check('加语言后"可选语言"的数量跟着变', availableLanguages().includes('ru'));
  resetLanguageForTest();
}

console.log('\n[物品名构件表（多语言 P2-1）]');
{
  /**
   * 物品名走"构件 + 模板"（P2-1a/b/c）而不是 800 条平铺。这一节盯三件事：
   *  ① 构件表非空、模板里真的有 `{占位符}`（模板写成常量就说明拼装没接上）；
   *  ② 英文侧不许有中文残留 —— 构件是**拼装原料**，一个中文词漏进英文会污染几十条名字；
   *  ③ `item.tpl.*` 与 `item.<id>` 两个命名空间不许混（模板挪进 `tpl.` 就是为了防撞名）。
   */
  const itemKeys = allKeys().filter((key) => key.startsWith('item.'));
  // 数量用"关系 + 下界"判：16 色是硬事实（染料族按它展开），总数给个下界防空表
  check('颜色构件正好 16 个（染料族按它展开）', itemKeys.filter((key) => key.startsWith('item.color.')).length === 16);
  check('物品名构件表非空', itemKeys.length > 150, String(itemKeys.length));

  // 显式名（多语言 P2-2）：`item.<id>` 是 481 条显式名的落脚点，掉一大截说明被误删了
  const explicitNames = itemKeys.filter((key) => !key.startsWith('item.') === false && key.split('.').length === 2);
  check('显式物品名 ≥ 480 条（481 条显式名 + 38 条红石元件）', explicitNames.length >= 480, String(explicitNames.length));

  const tplKeys = itemKeys.filter((key) => key.startsWith('item.tpl.'));
  const badTpl = tplKeys.filter((key) => !/\{\w+\}/.test(t(key, 'zh')));
  check(`模板都带占位符（${tplKeys.length} 个）`, badTpl.length === 0, badTpl.slice(0, 3).join(','));

  const cjkInEn = itemKeys.filter((key) => /[\u4e00-\u9fff]/.test(t(key, 'en')));
  check('英文侧没有中文残留（构件漏翻会污染几十条名字）', cjkInEn.length === 0, cjkInEn.slice(0, 3).join(','));

  /**
   * 效果名（多语言 P2-3c3）：30 种状态效果的名字进了 `label.effect.*`。
   * 它同时被 HUD、药水说明、药箭说明、`/effect` 下拉读——漏一条会在四处同时露中文。
   */
  const effectKeys = Object.keys(EFFECTS).map((id) => `label.effect.${EFFECTS[id as never] as string}`);
  const badEffect = effectKeys.filter((key) => t(key) === key || /[\u4e00-\u9fff]/.test(t(key, 'en')));
  check(`效果名 ${EFFECTS.length} 条都在表里且英文无中文`, badEffect.length === 0, badEffect.slice(0, 3).join(','));

  /**
   * 生物名（多语言 P2-4）：75 条 `entity.<id>`。
   *
   * 判据直接对着 `MobType.nameKey` 扫 —— 名字表与生物表**两边都要对**：
   * 只查表会漏掉"新加了一种生物但忘了加名字"，只查类型表又漏掉"键写错了"。
   */
  // ⚠️ 末影龙 / 末地水晶 / 幻翼 / 凋灵**不在** `MOB_TYPES` 里（各自一个模块），
  // 所以要显式拼进来 —— 只扫 `MOB_TYPES` 会漏掉这四个，而它们恰恰最容易漏翻
  const mobTypes = [...MOB_TYPES, DRAGON_TYPE, END_CRYSTAL_TYPE, PHANTOM_TYPE, WITHER_TYPE].map((type) => ({
    id: type.id,
    key: type.nameKey,
  }));
  check(`生物表 ${mobTypes.length} 条都带 entity.* 键`, mobTypes.every((one) => one.key === `entity.${one.id}`), mobTypes.find((one) => one.key !== `entity.${one.id}`)?.id ?? '');
  const badMob = mobTypes.filter((one) => mobLabel({ nameKey: one.key, id: one.id } as never) === one.id);
  check('每条生物名都能在表里查到（查不到会回落成 id）', badMob.length === 0, badMob.slice(0, 3).map((one) => one.id).join(','));

  // 名字牌是世界里的 canvas 文字：字体栈必须留 `sans-serif` 兜底，
  // 否则西里尔（ru）与变音（de/fr/pt）会在没装 PingFang / Segoe 的机器上变豆腐块。
  const nameTagSrc = readFileSync(new URL('../src/render/MobNameTag.ts', import.meta.url), 'utf8');
  check('名字牌字体栈留了 sans-serif 兜底（西里尔 / 变音符靠它接住）', /sans-serif/.test(nameTagSrc));
  check('名字牌字体栈保留中文字体（PingFang / YaHei）', nameTagSrc.includes('PingFang SC') && nameTagSrc.includes('Microsoft YaHei'));

  /**
   * 逻辑层不返回文案（多语言 P2-7）：容器类只能返回 `reason('station.reason.*')`。
   *
   * 判据直接从源码里把 `reason('…')` 的键抓出来，再逐条查表 ——
   * 这样"新写一句中文塞进 reason"与"键写错了"都会当场红，不必等界面截图。
   */
  const containerFiles = ['Anvil', 'CartographyTable', 'EnchantTable', 'Grindstone', 'Loom', 'SmithingTable', 'Stonecutter'];
  const reasonKeys = new Set<string>();
  const cjkReasons: string[] = [];
  for (const name of containerFiles) {
    const code = codeOf(readFileSync(new URL(`../src/core/container/${name}.ts`, import.meta.url), 'utf8'));
    for (const match of code.matchAll(/reason\('([^']+)'/g)) reasonKeys.add(match[1]!);
    for (const match of code.matchAll(/return '([^']*[\u4e00-\u9fff][^']*)'/g)) cjkReasons.push(`${name}: ${match[1]!.slice(0, 12)}`);
  }
  check(`容器类用 ${reasonKeys.size} 条 reason 键（不是中文句子）`, reasonKeys.size >= 15, String(reasonKeys.size));
  check('容器类不再 return 中文句子（一律走 reason(...)）', cjkReasons.length === 0, cjkReasons.slice(0, 3).join(' / '));
  const badReasonKeys = [...reasonKeys].filter((key) => t(key) === key || /[\u4e00-\u9fff]/.test(t(key, 'en')));
  check('每条 reason 键都能渲染出中英文（不露键名）', badReasonKeys.length === 0, badReasonKeys.slice(0, 3).join(','));

  /**
   * 德语（多语言 P4-1）。
   *
   * 德语是**第一个按需加载**的真实语言：表在 `locales/de/`，`LOADERS` 里一行。
   * 这里只钉"能加载、可选、抽到的界面分组是真德语"——**不**断言"全表已翻"：
   * 那 7 个占位分组（item / itemDesc / cmd / cmdMessages / label / entity / inventory）
   * 还是英文，进度记在 `notes/i18n-de.md`，由 `audit:i18n` 的「已翻 / 疑似未翻」报数。
   */
  check('德语可加载', (await loadLocale('de')) === true);
  check('德语进了可选清单', availableLanguages().includes('de'), availableLanguages().join(','));
  const deKeys = Object.keys(tableOf('de'));
  check('德语表条数与中文相同', deKeys.length === allKeys().length, `${deKeys.length} vs ${allKeys().length}`);

  // 抽查 6 个界面分组的代表键：必须真的是德语（不是英文占位、也不是中文漏出）
  const deSamples: Array<[string, string]> = [
    ['menu.play', 'Spielen'],
    ['pause.title', 'Spiel pausiert'],
    ['settings.row.fov', 'Sichtfeld'],
    ['statistics.title', 'Weltstatistiken'],
    ['editor.cancel', 'Abbrechen'],
    ['station.reason.needLevels', 'Braucht {cost} Stufen Erfahrung'],
    // P4-1b 起这两组也是真德语（原来是英文占位）
    ['label.effect.speed', 'Schnelligkeit'],
    ['panel.anvil', 'Amboss'],
    ['inventory.tab.craftable', 'Machbar'],
  ];
  for (const [key, expected] of deSamples) {
    check(`德语：${key} 已翻`, t(key, 'de') === expected, t(key, 'de'));
  }
  check('德语回执用了德语序数/缩写（不含中文）', !/[\u4e00-\u9fff]/.test(deKeys.map((key) => t(key, 'de')).join('')));

  /**
   * 首屏与 manifest（多语言 P3-4）。
   *
   * `index.html` 与 `manifest.webmanifest` 是**服务端/浏览器直接读的静态文件**，
   * 它们拿不到玩家的语言设置 —— 所以只能：① 静态里留中文占位、`boot()` 解析完语言后
   * 用 `localizeBootLoading()` 覆盖；② manifest 出中英两份，`boot()` 按语言换 `<link>`。
   * 这两点必须被断言钉住，否则以后有人"顺手"把文案写回 HTML 就没人发现。
   */
  const overlaySrc2 = readFileSync(new URL('../src/ui/LoadingOverlay.ts', import.meta.url), 'utf8');
  check('首屏两句有本地化入口', overlaySrc2.includes("t('loading.boot')") && overlaySrc2.includes("t('loading.bootSub')"));
  const mainSrc2 = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check('boot() 会调用 localizeBootLoading()', mainSrc2.includes('localizeBootLoading();'));
  check(
    'boot() 会按语言换 manifest 链接',
    mainSrc2.includes("'./manifest.webmanifest'") && mainSrc2.includes("'./manifest.en.webmanifest'"),
  );

  const zhManifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const enManifest = JSON.parse(readFileSync(new URL('../public/manifest.en.webmanifest', import.meta.url), 'utf8'));
  check('中英两份 manifest 的键完全一致', JSON.stringify(Object.keys(zhManifest).sort()) === JSON.stringify(Object.keys(enManifest).sort()));
  check('英文 manifest 里没有中文（name / description）', !/[\u4e00-\u9fff]/.test(enManifest.name + enManifest.description));
  check('两份 manifest 的图标一致（别一边加了 png 另一边没加）', JSON.stringify(zhManifest.icons) === JSON.stringify(enManifest.icons));
  check('manifest 声明了 lang（商店与安装提示会用）', zhManifest.lang.startsWith('zh') && enManifest.lang === 'en');

  /**
   * 界面残留（一）（多语言 P3-1）：触摸控件 / 提示框 / 加载遮罩 / 全屏 / 安装提示。
   *
   * 这五个文件有一个共同点：它们的文案**全是 "chrome"**（按钮 aria-label、提示行、
   * 遮罩上的一句话），用户不会拿它们去对照原版，但英文用户天天看见。
   * 判据沿用命令域那套：文件里不许再有中文字面量（注释不算）。
   */
  const chromeFiles = [
    'ui/TouchControls.ts',
    'ui/TouchIcons.ts',
    'ui/Tooltip.ts',
    'ui/LoadingOverlay.ts',
    'ui/Fullscreen.ts',
    'ui/InstallHint.ts',
    // 四个编辑器面板（多语言 P3-2）：书与笔 / 告示牌 / 名字牌 / 命令方块
    'ui/BookScreen.ts',
    'ui/SignEditor.ts',
    'ui/NameTagEditor.ts',
    'ui/CommandBlockEditor.ts',
    // 其余屏幕（多语言 P3-3）：信标 / 设备不支持 / 世界统计
    'ui/BeaconScreen.ts',
    'ui/UnsupportedScreen.ts',
    'ui/StatisticsScreen.ts',
  ];
  for (const rel of chromeFiles) {
    const code = codeOf(readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8'));
    const hard = linesWithCjkLiteral(code);
    check(`${rel} 没有残留中文字面量`, hard.length === 0, hard.slice(0, 2).join(' / '));
  }

  // 触摸控件的两条文案要真翻成英文（"潜行 / 向上飞" 曾在英文界面里露出中文）
  check('触摸控件文案有英文版', t('touch.sneak', 'en') === 'Sneak' && t('touch.flyUp', 'en') === 'Fly up');
  setLanguage('en');
  check('提示框的"最多 N 个/格"走占位符且真替换', tp('tooltip.maxStack', { n: 64 }).includes('64'), tp('tooltip.maxStack', { n: 64 }));
  resetLanguageForTest();

  /**
   * P3-5 巡查收口：P3 触过的界面键族在伪语言下**必须全部被 `⟦⟧` 包住**。
   *
   * 这是"屏幕上没被包住的文字 = 没接 i18n"那条判据的**可复现版本**：
   * 不靠开浏览器点一遍，而是把键族逐个渲染一遍。**P3 自己的键共 63 条**（P2 的
   * `item.*` / `entity.*` 另有断言），全部被包住；走 Intl 的文本（`relativeTime` /
   * `joinList`）包不住 —— 它们不经过 `t()`，属于"语言相关但由 CLDR 给"，单独列出。
   */
  const p3Families = [
    'touch.',
    'tooltip.',
    'loading.',
    'editor.',
    'book.',
    'sign.',
    'nameTag.',
    'commandBlock.',
    'beacon.',
    'unsupported.',
    'statistics.',
    'time.',
    'label.stickMode.',
    'label.handedness.',
  ];
  setPseudoLocale(true);
  const p3Keys = allKeys().filter((key) => p3Families.some((prefix) => key.startsWith(prefix)));
  const notWrapped = p3Keys.filter((key) => !(t(key).startsWith('⟦') && t(key).endsWith('⟧')));
  check(
    `P3 键族 ${p3Keys.length} 条在伪语言下都被包住`,
    p3Keys.length >= 50 && notWrapped.length === 0,
    notWrapped.slice(0, 3).join(','),
  );

  // `tn()` 曾经**绕过**伪语言（它直接读表、不走 `t()`）：巡查时被误判成"没接 i18n"
  const tnText = tn('statistics.blocks', 3);
  check('tn() 也吃伪语言（P3-5 修的那个漏包）', tnText.startsWith('⟦') && tnText.endsWith('⟧'), tnText);
  setPseudoLocale(false);
  resetLanguageForTest();

  /**
   * 标签表族（二）（多语言 P2-6）：音效组 / 外观 10 张 / 朝向 / 旗帜图案 / 配方书页签 / 物品类别。
   *
   * 外观那十张表里有五张是**按下标**存名字的（肤色/上衣/裤色/发色/瞳色），
   * 所以判据用下标序列，而不是枚举值 —— 两种都要覆盖，漏了哪一半都会在加档位时静默失效。
   */
  const indexed = (count: number): string[] => Array.from({ length: count }, (_, i) => String(i));
  const labelTables2: ReadonlyArray<readonly [string, readonly string[], (value: string) => string]> = [
    // ⚠️ `SOUND_GROUPS` 是「音效 → 组」的映射（53 条音效），组名要**去重**取
    ['音效组', [...new Set(Object.values(SOUND_GROUPS))], (value) => `label.sound.${value}`],
    ['外观-肤色', indexed(SKIN_TONES.length), (value) => `label.appearance.skinTone.${value}`],
    ['外观-上衣', indexed(SHIRT_COLORS.length), (value) => `label.appearance.shirtColor.${value}`],
    ['外观-裤色', indexed(PANTS_COLORS.length), (value) => `label.appearance.pantsColor.${value}`],
    ['外观-发色', indexed(HAIR_COLORS.length), (value) => `label.appearance.hairColor.${value}`],
    ['外观-瞳色', indexed(EYE_COLORS.length), (value) => `label.appearance.eyeColor.${value}`],
    ['外观-发型', [...HAIR_STYLES], (value) => `label.appearance.hairStyle.${value}`],
    ['外观-胡须', [...BEARD_STYLES], (value) => `label.appearance.beard.${value}`],
    ['外观-眼型', [...EYE_STYLES], (value) => `label.appearance.eyeStyle.${value}`],
    ['外观-体型', [...BODY_BUILDS], (value) => `label.appearance.bodyBuild.${value}`],
    ['外观-身架', [...BODY_FRAMES], (value) => `label.appearance.bodyFrame.${value}`],
    ['朝向', ['up', 'down', '0', '1', '2', '3'], (value) => `label.facing.${value}`],
    ['旗帜图案', indexed(5), (value) => `label.bannerPattern.${value}`],
    ['配方书页签', [...RECIPE_BOOK_TABS], (value) => `label.recipeTab.${value}`],
    ['物品类别', [...ITEM_CATEGORIES], (value) => `label.category.${value}`],
  ];
  for (const [name, values, keyOf] of labelTables2) {
    const missing = values.filter((value) => t(keyOf(value)) === keyOf(value));
    check(`${name}的 ${values.length} 个值都有键`, missing.length === 0, missing.slice(0, 3).join(','));
    const cjk = values.filter((value) => /[\u4e00-\u9fff]/.test(t(keyOf(value), 'en')));
    check(`${name}的英文名没有残留中文`, cjk.length === 0, cjk.slice(0, 3).join(','));
  }

  /**
   * 标签表族（一）（多语言 P2-5）：维度 / 世界类型 / 群系 / 附魔 / 村民等级 / 职业。
   *
   * 判据一律**对着枚举清单扫**，不抄条数：多数一条或少一条都会在这里红，
   * 而"键写错 / 漏翻"则表现为查回键名本身。
   */
  const labelTables: ReadonlyArray<readonly [string, readonly string[], (value: string) => string]> = [
    ['维度', DIMENSION_CYCLE, (value) => `label.dimension.${value}`],
    ['世界类型', WORLD_TYPES, (value) => `label.worldType.${value}`],
    ['群系', BIOMES.map((biome) => biome.name), (value) => `label.biome.${value}`],
    ['附魔', ENCHANTMENTS.map((one) => one.id), (value) => `label.enchantment.${value}`],
    ['村民等级', ['1', '2', '3', '4', '5'], (value) => `label.villagerLevel.${value}`],
    ['职业', PROFESSIONS.map((one) => one.id), (value) => `label.profession.${value}`],
  ];
  for (const [name, values, keyOf] of labelTables) {
    const missing = values.filter((value) => t(keyOf(value)) === keyOf(value));
    check(`${name}的 ${values.length} 个值都有键`, missing.length === 0, missing.slice(0, 3).join(','));
    const cjk = values.filter((value) => /[\u4e00-\u9fff]/.test(t(keyOf(value), 'en')));
    check(`${name}的英文名没有残留中文`, cjk.length === 0, cjk.slice(0, 3).join(','));
  }

  // 组件类（color / wood / coral / base / ore / toolMaterial …）必须是"词"，不是句子
  const components = itemKeys.filter((key) => !key.startsWith('item.tpl.') && key.split('.').length === 3);
  check('构件表里没有空值', components.every((key) => t(key, 'zh').trim().length > 0));
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
  const emptyValues = Object.entries(tableOf('zh')).filter(([, value]) => value.trim().length === 0).map(([key]) => key);
  check('中文表没有空值', emptyValues.length === 0, emptyValues.slice(0, 3).join(','));

  /**
   * 英文那一侧（多语言 P0-3）：分组要一一对应，而且**每个分组都必须带
   * `satisfies Pick<Messages, …>`**。少写那一行不会有任何报错，于是"漏翻一条"就退回
   * 到"跑测试才发现"——这条断言防的就是这个（类型保护被悄悄删掉）。
   */
  const enDir = new URL('../src/core/i18n/locales/en/', import.meta.url);
  // `plural.ts` 不是分组文件，是"需要区分单复数的那些键"的可选精修（多语言 P0-6）
  const enFilesAll = readdirSync(enDir).filter((name) => name.endsWith('.ts'));
  const enGroups = enFilesAll.filter((name) => name !== 'index.ts' && name !== 'plural.ts');
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
  check(
    '复数表用 satisfies PluralTable 卡齐（写错类别名会红）',
    enFilesAll.includes('plural.ts') &&
      readFileSync(new URL('plural.ts', enDir), 'utf8').includes('satisfies PluralTable'),
  );
}

console.log('\n[伪语言（多语言 P0-8）]');
{
  /**
   * 伪语言的用途是**照妖**：`?lang=xa` 下所有走过 `t()` 的文字会被 `⟦⟧` 包住，
   * 屏幕上没被包住的就是还没接 i18n 的硬编码文案。这里只验机制，真正的排查靠肉眼。
   */
  check('认 xa / en-XA 两种写法', isPseudoLocaleTag('xa') && isPseudoLocaleTag('en-XA') && isPseudoLocaleTag('EN-xa'));
  check('真语言不是伪语言', !isPseudoLocaleTag('de') && !isPseudoLocaleTag(undefined) && !isPseudoLocaleTag(''));
  check('默认是关的', !isPseudoLocale());

  setLanguage('en');
  setPseudoLocale(true);
  check('打开后文案被包起来', t('pause.title') === '⟦Game Paused⟧', t('pause.title'));
  check(
    '占位符照样替换（包在替换之后，不影响 {name}）',
    tp('station.craftableSummary', { station: 'X', available: 1, total: 2 }).startsWith('⟦X · craftable 1 / 2'),
    tp('station.craftableSummary', { station: 'X', available: 1, total: 2 }),
  );
  check('查不到的键也包起来（一眼看出是漏的）', t('no.such.key') === '⟦no.such.key⟧', t('no.such.key'));

  /**
   * P1-8 巡查：伪语言下，命令帮助面板里**属于命令域自己的文案**必须都被 `⟦⟧` 包住。
   *
   * 这条是"不用开浏览器"的版本：面板的每一条文案都来自 `commandHelpEntries()`，
   * 所以直接把返回值的 usage / 描述 / 字段标签 / 占位符扫一遍即可。
   * 白名单只有**语言中性**的三类：坐标标签（`X` / `Y1` / `DX`）、纯符号占位（`~ ~ ~`）、
   * 值名（`radius` 这种要玩家自己填的词）。
   * ⚠️ 下拉选项有 197/370 处没被包住 —— 它们来自**数据层**（物品/方块/生物/进度/附魔名，
   * 属于 P2），这一条等 P2 做完后再收紧到"一处不漏"。
   */
  const wrappedByPseudo = (text: string | undefined): boolean =>
    text === undefined || text === '' || (text.startsWith('⟦') && text.endsWith('⟧'));
  const languageNeutral = (text: string): boolean => /^[XYZ]\d?$|^D[XYZ]$/.test(text) || /^[~\s]+$/.test(text) || text === 'radius';
  const unwrappedHelp: string[] = [];
  for (const entry of commandHelpEntries()) {
    if (!wrappedByPseudo(entry.usage)) unwrappedHelp.push(`${entry.name}.usage`);
    if (!wrappedByPseudo(entry.description)) unwrappedHelp.push(`${entry.name}.desc`);
    for (const variant of entry.variants) {
      for (const part of variant.parts) {
        if (part.kind !== 'field') continue;
        const field = part.field;
        if (!wrappedByPseudo(field.label) && !languageNeutral(field.label)) unwrappedHelp.push(`${entry.name}.${field.key}.label`);
        if (!wrappedByPseudo(field.placeholder) && !languageNeutral(String(field.placeholder))) unwrappedHelp.push(`${entry.name}.${field.key}.ph`);
        if (!wrappedByPseudo(field.customPlaceholder) && !languageNeutral(String(field.customPlaceholder))) unwrappedHelp.push(`${entry.name}.${field.key}.custom`);
      }
    }
  }
  check(
    '伪语言巡查：命令帮助面板的命令域文案全部被 ⟦⟧ 包住',
    unwrappedHelp.length === 0,
    unwrappedHelp.slice(0, 5).join(' / '),
  );
  setPseudoLocale(false);
  check('关掉就恢复原样', t('pause.title') === 'Game Paused', t('pause.title'));
  check('isPseudoLocale 跟着开关走', !isPseudoLocale());
  resetLanguageForTest();
}

console.log(`\ni18n 测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
