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
import { ITEM_CATEGORIES, itemDef } from '../src/core/registry/items.ts';
import { itemDescription, translateName } from '../src/core/registry/itemNames.ts';
import { GAME_MODES, gameModeLabel } from '../src/core/world/GameMode.ts';
import { POTIONS, TIPPED_ARROWS } from '../src/core/registry/potions.ts';
import { damageReason } from '../src/core/survival/DamageNotice.ts';
import { glFailText } from '../src/core/render/webglSupport.ts';
import { BRAND, BRAND_EDITION } from '../src/core/brand.ts';
import { CAMERA_MODES, cameraModeLabel } from '../src/core/viewMode.ts';
import { DEFAULT_GAME_RULES, gameRuleLabel } from '../src/core/world/Rules.ts';
import { LOOT_TABLES } from '../src/core/registry/loot.ts';
import { DIFFICULTIES, difficultyLabel } from '../src/core/world/Rules.ts';
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
  languageFromParam,
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
  // 批次 20261024-0223：`minecraft:story/root` 的标题按用户要求统一成品牌名 `Minicraft`
  // （中文原来是「我的世界」），所以它**故意**与原文不同；其余成就中文必须原样返回。
  const zhChanged = ADVANCEMENTS.filter(
    (a) => a.id !== 'minecraft:story/root' && (advancementTitle(a) !== a.title || advancementDesc(a) !== a.desc),
  );
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
  // 多语言 P4-4：六种语言（zh / en / ru / pt / fr / de）现在**全部有表**，
  // 所以"只有一部分能选"这个旧判据不再成立 —— 改验"支持 6 种且 6 种都能选"。
  check(
    '支持 6 种语言，且六种都能选（都有表或加载器）',
    LOCALES.length === 6 && availableLanguages().length === LOCALES.length,
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
  // 多语言 P4-4：六种真实语言（zh / en / ru / pt / fr / de）**全部有表**，
  // 再想验"没表的语言"就只能造一个码 —— 回落链本身与码真不真无关。
  const NO_TABLE = 'xx' as LocaleCode;
  check('没装表的语言查出来是空表（不抛异常）', Object.keys(tableOf(NO_TABLE)).length === 0);
  check('缺表时回落英文', t('pause.title', NO_TABLE) === t('pause.title', 'en'), t('pause.title', NO_TABLE));
  check('其它语言同理（回落链不看具体是哪种语言）', t('pause.resume', NO_TABLE) === 'Resume Game', t('pause.resume', NO_TABLE));
  check('一路回落到头就返回键名', t('no.such.key', NO_TABLE) === 'no.such.key', t('no.such.key', NO_TABLE));
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

  /**
   * per-app language 与深链（多语言 P5-2）。
   *
   * **Android 13 的应用语言**在 Web 侧没有专门的 API：TWA / WebView 会把应用语言反映到
   * `navigator.language` 上，所以"透传"这条链是「应用语言 → navigator.language → `auto` 解析」。
   * 前三条把这条链钉住（`resolveLanguage('auto', tag)` 就是 boot 里对 auto 做的事）。
   *
   * **深链** `?lang=` 由 `languageFromParam()` 解析：真实语言码（含带地区的写法）前缀匹配到表里的语言，
   * 伪语言 `xa` 不参与（它走 `setPseudoLocale`），没做表的语言返回 `undefined` 交回设置里的值 ——
   * 不能让一个拼错的参数把界面变成英文。
   */
  check('应用语言透传：auto + pt-BR 标签 → 葡语', resolveLanguage('auto', 'pt-BR') === 'pt');
  check('应用语言透传：auto + ru 标签 → 俄语', resolveLanguage('auto', 'ru') === 'ru');
  check('应用语言透传：auto + fr-CA 标签 → 法语', resolveLanguage('auto', 'fr-CA') === 'fr');

  check('深链 ?lang=de → 德语', languageFromParam('de') === 'de');
  check('深链 ?lang=pt-BR → 葡语（带地区前缀匹配）', languageFromParam('pt-BR') === 'pt');
  check('深链 ?lang=de-AT → 德语（同上）', languageFromParam('de-AT') === 'de');
  check('深链 ?lang=xa 仍是伪语言、不覆盖语言', languageFromParam('xa') === undefined && languageFromParam('en-XA') === undefined);
  check('深链 ?lang=ja（没做表）→ 不覆盖设置', languageFromParam('ja') === undefined);
  check('深链没给参数 / 空串 → 不覆盖设置', languageFromParam(null) === undefined && languageFromParam('') === undefined);

  /**
   * manifest 六语言（多语言 P5-3）。
   *
   * 六个文件由 `tools/gen-manifests.mjs` 生成：**只有 `description` 与 `lang` 不同**，
   * 其余字段必须与中文基准逐字相同。这一节盯三件事：
   *  ① 六份都在（少一份，那个语言装出来的 App 就还是中文描述）；
   *  ② `lang` 与 `<html lang>` 用同一套值（`localeMeta().htmlLang`，带地区的写成 `pt-BR`）；
   *  ③ 描述**两两不同** —— 六份都抄英文的话，字段检查全过、界面却是"六个一样的描述"。
   */
  const manifestDir = 'public';
  const baseManifest = JSON.parse(readFileSync(`${manifestDir}/manifest.webmanifest`, 'utf8'));
  const manifestLocales: Array<[string, string]> = [
    ['zh', 'manifest.webmanifest'],
    ['en', 'manifest.en.webmanifest'],
    ['de', 'manifest.de.webmanifest'],
    ['ru', 'manifest.ru.webmanifest'],
    ['fr', 'manifest.fr.webmanifest'],
    ['pt', 'manifest.pt.webmanifest'],
  ];
  const manifestDescriptions = new Set<string>();
  for (const [code, file] of manifestLocales) {
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(`${manifestDir}/${file}`, 'utf8')) as Record<string, unknown>;
    } catch {
      check(`manifest ${file} 存在且是合法 JSON`, false, '读不到');
      continue;
    }
    check(`manifest ${file} 的 lang 与 htmlLang 一致`, manifest.lang === localeMeta(code)?.htmlLang, String(manifest.lang));
    const frozen = ['name', 'short_name', 'start_url', 'scope', 'display', 'display_override', 'orientation'];
    const drifted = frozen.filter((key) => JSON.stringify(manifest[key]) !== JSON.stringify(baseManifest[key]));
    check(`manifest ${file} 的启动/显示字段与基准一致`, drifted.length === 0, drifted.join(','));
    const desc = String(manifest.description ?? '');
    check(`manifest ${file} 有该语言的描述`, desc.length > 0);
    manifestDescriptions.add(desc);
  }
  check('六份 manifest 的描述两两不同（不是都抄英文）', manifestDescriptions.size === 6, `${manifestDescriptions.size} 种`);

  /**
   * 品牌名一致性（批次 20261024-0121，用户拍板：这个游戏叫 **Minicraft**）。
   *
   * 品牌名散在五处**互不相干的文件**里（6 份 manifest / `index.html` / 6 份商店文案 / README / 调试 HUD），
   * 手改必然漏一处 —— 而漏掉的那处平时看不见（比如只在安装成 PWA 后的桌面上显示）。
   * 所以这里做一条**跨文件一致性**断言，改名前后的唯一真值就是 `BRAND`。
   *
   * 注意：历史档案（`DONE.md` / `notes/`）里的旧名**故意不改** —— 那是"当时叫什么"的记录。
   */
  // 品牌名的唯一真值（`src/core/brand.ts`）—— 与首页那行大字共用同一个常量
  const brandDrift: string[] = [];
  for (const [, file] of manifestLocales) {
    const manifest = JSON.parse(readFileSync(`${manifestDir}/${file}`, 'utf8')) as Record<string, unknown>;
    if (manifest.name !== BRAND) brandDrift.push(`${file}.name=${String(manifest.name)}`);
    if (manifest.short_name !== BRAND) brandDrift.push(`${file}.short_name=${String(manifest.short_name)}`);
  }
  check('六份 manifest 的 name / short_name 都是同一个品牌名', brandDrift.length === 0, brandDrift.slice(0, 3).join(','));
  check('页面标题是品牌名', readFileSync('index.html', 'utf8').includes(`<title>${BRAND}</title>`));
  // 判据看**赋值点**而不是全文 grep：注释里提到「基岩版」是历史说明（"原来写的是…"），
  // 真正要保证的是「界面上取值的两个源头不再是旧字面量」。
  const worldScreenSrc = readFileSync('src/ui/WorldScreen.ts', 'utf8');
  check(
    '首页只显示品牌名（副标题已删，旧字面量已清掉）',
    worldScreenSrc.includes('logo.textContent = BRAND') &&
      !worldScreenSrc.includes('world-edition') &&
      !worldScreenSrc.includes("textContent = 'MINECRAFT'") &&
      !worldScreenSrc.includes("textContent = '基岩版"),
  );
  // 批次 20261024-0223：用户要求去掉「1.18 · WEB EDITION」副标 → `BRAND_EDITION` 置空，
  // 首页只剩品牌名一行。这条断言从"副标题是什么"改成"副标题已经没有了"。
  check('副标题已删除（BRAND_EDITION 为空）', BRAND_EDITION === '');

  /**
   * 设置里的「视角」选项（B2，批次 20261024-0136）。
   *
   * `CAMERA_MODE_LABELS` 原来是中文常量（第一人称 / 第三人称（背后） / 第三人称（正面）），
   * 与 P6-1 修的难度/模式同一个毛病。切视角的 toast（`视角：{mode}`）也一并键化。
   */
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const labels = CAMERA_MODES.map((mode) => cameraModeLabel(mode));
    const toast = tp('misc.cameraModeToast', { mode: labels[0]! });
    check(`${code} 视角选项与切换提示不含中文`, !/[\u4e00-\u9fff]/.test(labels.join('') + toast), `${labels.join(' / ')} | ${toast}`);
  }
  setLanguage('zh');
  check('中文下视角选项仍是原来的说法', cameraModeLabel('first') === '第一人称' && cameraModeLabel('third-back') === '第三人称（背后）');

  /**
   * 游戏规则的显示名（C3，批次 20261024-0223）。
   *
   * `GAME_RULE_LABELS` 原来是中文常量表，命令帮助的 gamerule 下拉直接显示它 ——
   * 与 P6-1 的难度/模式同一个毛病。31 条 × 6 语言。
   */
  const ruleKeys = Object.keys(DEFAULT_GAME_RULES) as Array<keyof typeof DEFAULT_GAME_RULES>;
  check('规则标签覆盖全部 31 条规则', ruleKeys.length === 31, String(ruleKeys.length));
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const labels = ruleKeys.map((rule) => gameRuleLabel(rule));
    const leaked = ruleKeys.filter((rule, i) => /[\u4e00-\u9fff]/.test(labels[i]!) || labels[i] === rule);
    check(`${code} 游戏规则名不含中文、也不露英文 id`, leaked.length === 0, leaked.slice(0, 3).join(','));
  }
  setLanguage('zh');
  check('中文下规则名仍是原来的说法', gameRuleLabel('keepInventory') === '死亡后保留物品' && gameRuleLabel('doDaylightCycle') === '昼夜循环');

  /**
   * 命令域的错误信息与回执（C4，批次 20261024-0223）。
   *
   * `Selectors.ts` 的 14 条选择器错误与 `Commands.ts` 的 `/clone` 回执、队伍摘要等
   * 原来是硬编码中文 —— 玩家打错命令就在聊天栏看到。现在走 `cmd.error.selector.*` /
   * `cmd.reply.*`，共 30 条键。
   */
  const cmdSamples: Array<[string, Record<string, string | number>]> = [
    ['cmd.error.selector.unknown', { raw: '@x' }],
    ['cmd.error.selector.limitBad', { value: '0' }],
    ['cmd.error.selector.filterNeedsEquals', { piece: 'a' }],
    ['cmd.reply.clone.done', { copied: 1, volume: 2, x: 0, y: 64, z: 0, masked: '' }],
    ['cmd.reply.team.summary', { name: 'red', color: 'red', state: 'on', count: 2, shown: '', affix: '' }],
    ['cmd.reply.execute.unknown-sub', { token: 'nope' }],
  ];
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const rendered = cmdSamples.map(([key, params]) => tp(key, params as never));
    const leaked = rendered.filter((text) => /[\u4e00-\u9fff]/.test(text));
    check(`${code} 命令错误与回执不含中文`, leaked.length === 0, leaked.slice(0, 2).join(' | '));
  }
  setLanguage('zh');
  check('中文下选择器错误仍是原来的说法', t('cmd.error.selector.typeMissing') === 'type 后面没有种类');

  /**
   * 战利品表名（C5，批次 20261024-0223）。
   *
   * `/loot` 的帮助下拉显示 `${table.name}（key）`，而 `LOOT_TABLES[].name` 是中文常量 ——
   * 与 gamerule 下拉同一类。22 条 × 6 语言走 `cmd.label.lootTable.*`。
   */
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const labels = LOOT_TABLES.map((table) => t(`cmd.label.lootTable.${table.key}`));
    const leaked = labels.filter((label) => /[\u4e00-\u9fff]/.test(label) || label.startsWith('cmd.'));
    check(`${code} 战利品表名不含中文、也不露键名`, leaked.length === 0, leaked.slice(0, 3).join(','));
  }
  setLanguage('zh');
  check('中文下战利品表名仍是原来的说法', t('cmd.label.lootTable.village_house') === '村庄小屋');

  /**
   * 最后一批界面文案（E1，批次 20261024-0245）：
   * 外观预设 4 条、世界类型提示 5 条、HUD 提示 28 条、世界种子/生存提示 2 条、告示牌标题 1 条。
   */
  const uiSamples: Array<[string, Record<string, string | number>]> = [
    ['label.appearance.preset.man', {}],
    ['label.appearance.preset.girl', {}],
    ['world.typeHint.default', {}],
    ['world.typeHint.flat', {}],
    ['world.seedHint', {}],
    ['misc.toast.leashTamedOnly', {}],
    ['misc.toast.totemSaved', {}],
    ['misc.toast.named', { kind: 'Hund', name: 'Bello' }],
    ['misc.toast.gameMode', { mode: 'Kreativ' }],
    ['misc.signEditorHint', { name: 'Eichenholz' }],
  ];
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const leaked = uiSamples
      .map(([key, params]) => tp(key, params as never))
      .filter((text) => /[\u4e00-\u9fff]/.test(text) || text.startsWith('misc.') || text.startsWith('world.') || text.startsWith('label.'));
    check(`${code} 界面文案（预设/世界类型/HUD 提示）不含中文、也不露键名`, leaked.length === 0, leaked.slice(0, 3).join(' | '));
  }
  setLanguage('zh');
  check('中文下这些文案仍是原来的说法', t('misc.toast.raidStart') === '袭击开始' && t('world.typeHint.flat').startsWith('只有三层平地'));

  /**
   * 兜底语言必须是**英文**（D2，批次 20261024-0245，用户要求）。
   *
   * `t()` 的回落链是「本语言表 → 英文表 → 键名」。前面已有「整个表缺失时回落英文」那条，
   * 这里补的是更常见的一半：**表在、但某条键没翻**（新增文案只加进了 zh/en 就上线）。
   *
   * 用假语言 `yy` 装一张只有 1 条键的表，验证"表里没有的那条"拿到的是英文而不是中文。
   */
  const FAKE = 'yy' as LocaleCode;
  registerLocaleLoader(FAKE, async () => ({ [FAKE]: { 'pause.title': 'Custom Pause' } }));
  await loadLocale(FAKE);
  check(
    '表里缺某条键时回落到英文（不是中文）',
    t('pause.resume', FAKE) === t('pause.resume', 'en') && t('pause.resume', FAKE) !== t('pause.resume', 'zh'),
    `${t('pause.resume', FAKE)} / zh=${t('pause.resume', 'zh')}`,
  );
  check('表里有的键照常取本语言', t('pause.title', FAKE) === 'Custom Pause', t('pause.title', FAKE));

  // 数据驱动的两条（成就标题 / 物品说明）同理：`t()` 已经先回落英文，
  // 说明里的"中文原文"只在**连英文都没有**时才出现 —— 那时是"键漏了"的 bug，不是缺翻。
  check(
    '成就标题在德语下取德语（不缺翻时不落到中文原文）',
    advancementTitle({ id: 'minecraft:story/mine_stone', title: '采集石头' }).length > 0 &&
      advancementTitle({ id: 'minecraft:story/mine_stone', title: '采集石头' }) !== '采集石头',
    advancementTitle({ id: 'minecraft:story/mine_stone', title: '采集石头' }),
  );
  resetLanguageForTest();

  /**
   * 局内 HUD（B3，批次 20261024-0136）。
   *
   * 进世界后第一眼看到的是**调试面板**（实测：`60 fps … 三角形 XYZ: … 朝向: 北 时间: 08:59 月相: 满月 …`），
   * 原来整段是中文拼接。现在 `debugEl` 的 40+ 片段与它们的**值**（方位四向、月相八相、是/否）都进表。
   * 判据：`hud.*` 整族在四种语言下都不含中文 —— 面板是默认显示的，漏一条用户一眼就看见。
   */
  const hudKeys = allKeys().filter((key) => key.startsWith('hud.'));
  check('hud 分组的键数（面板片段 + 方位 + 月相）足够', hudKeys.length >= 50, String(hudKeys.length));
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const cjk = hudKeys.filter((key) => /[\u4e00-\u9fff]/.test(t(key)));
    check(`${code}：hud 整族不含中文`, cjk.length === 0, cjk.slice(0, 3).join(','));
  }
  setLanguage('zh');
  check('中文下 HUD 的方位与月相仍是原来的说法', t('hud.facingNorth').includes('北') && t('hud.moonPhase.0') === '满月');
  resetLanguageForTest();
  resetLanguageForTest();
  check('商店文案六份的标题都是品牌名', ['zh', 'en', 'de', 'ru', 'fr', 'pt'].every((code) => readFileSync(`docs/store/${code}.md`, 'utf8').includes(`\n${BRAND}\n`)));
  check(
    '深链优先于设置里的值',
    (languageFromParam('fr') ?? 'zh') === 'fr' && (languageFromParam('zz') ?? 'zh') === 'zh',
  );
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
  // 与前面那段同一个理由：六种语言都有表了，这里造一个码来验"加载失败"这条分支
  const NO_TABLE = 'xx' as LocaleCode;
  check('没有加载器的语言加载失败（返回 false，不抛异常）', (await loadLocale(NO_TABLE)) === false);
  check('加载失败不影响查表（回落链照旧）', t('pause.title', NO_TABLE) === 'Game Paused', t('pause.title', NO_TABLE));

  // 假语言：只给一条文案，足够验证"加载 → 可查"这条链
  registerLocaleLoader(NO_TABLE, async () => ({ [NO_TABLE]: { 'pause.title': 'Pausado' } }));
  // 造出来的码**不该**漏进语言选择器：可选清单只认 `LOCALES` 里的语言，
  // 加载器只是"怎么拿表"，不是"能不能选"。这条把那个边界钉住。
  check('造出来的语言码不会出现在可选清单里', !availableLanguages().includes(NO_TABLE), availableLanguages().join(','));
  check('加载成功', (await loadLocale(NO_TABLE)) === true);
  check('加载后表进了池子', tableOf(NO_TABLE)['pause.title'] === 'Pausado');
  check('加载后真能查出来', t('pause.title', NO_TABLE) === 'Pausado', t('pause.title', NO_TABLE));
  check('重复加载是幂等的（第二次直接命中表）', (await loadLocale(NO_TABLE)) === true);
  check('假语言缺的键仍回落英文', t('pause.resume', NO_TABLE) === 'Resume Game', t('pause.resume', NO_TABLE));
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
    // P4-1c 起：构件与模板、以及生物名是德语（显式物品名仍是英文占位）
    ['item.toolMaterial.diamond', 'Diamant'],
    ['item.tpl.tool', '{material}{kind}'],
    ['entity.creeper', 'Creeper'],
    ['entity.ender_dragon', 'Enderdrache'],
    // P4-1c2 起：显式物品名也是德语（不再是英文占位）
    ['item.grass_block', 'Grasblock'],
    ['item.cobblestone', 'Bruchstein'],
    ['item.cooked_beef', 'Steak'],
    // P4-1d 起：命令用法与回执也是德语
    ['cmd.give.desc', 'Gibt dir Gegenstände (Name auf Deutsch/Englisch oder als Zahl)'],
    ['cmd.reply.team.prefix', 'Präfix'],
    // P4-1e 起：物品说明（先翻模板与方块/工具那半）
    ['item.desc.tpl.toolTier.4', 'Netherit'],
    ['item.desc.tpl.listSep', ', '],
    // P4-1e2 起：说明全翻完（抽查两条长文，看的是"真的成句"而不是占位）
    ['item.desc.written_book', '**Rechtsklick öffnet** es zum Blättern. Der Inhalt steht mit dem Signieren fest und lässt sich nicht ändern – dafür braucht es ein neues Buch.'],
    ['item.desc.honey_block', 'Klebt Blöcke fest, lässt einen aber nicht springen.'],
  ];
  for (const [key, expected] of deSamples) {
    check(`德语：${key} 已翻`, t(key, 'de') === expected, t(key, 'de'));
  }
  check('德语回执用了德语序数/缩写（不含中文）', !/[\u4e00-\u9fff]/.test(deKeys.map((key) => t(key, 'de')).join('')));

  /**
   * 德语的用法串必须保留 `<>` `[]` `|`（多语言 P4-1d）。
   *
   * 帮助面板靠这些符号拆变体；翻译里少一个括号**不会报错、只是表单变空**。
   * 中文与英文之间已经有同样的断言，这条把它扩到德语 —— 每新增一种语言都该加一条。
   */
  const deSyntaxDrift: string[] = [];
  const countChar = (text: string, ch: string): number => text.split(ch).length - 1;
  for (const spec of COMMANDS) {
    const zh = t(spec.usageKey, 'zh');
    const de = t(spec.usageKey, 'de');
    if (countChar(zh, '<') !== countChar(de, '<') || countChar(zh, '[') !== countChar(de, '[') || countChar(zh, '|') !== countChar(de, '|')) {
      deSyntaxDrift.push(spec.name);
    }
  }
  check('德语用法串的 <> / [] / | 与中文一致', deSyntaxDrift.length === 0, deSyntaxDrift.join(','));

  /**
   * 俄语的用法串同样必须保留 `<>` `[]` `|`（多语言 P4-2d，照抄德语那条）。
   * 帮助面板靠这些符号拆变体：少一个括号**不报错、只是表单变空**。
   */
  const ruSyntaxDrift: string[] = [];
  for (const spec of COMMANDS) {
    const zh = t(spec.usageKey, 'zh');
    const ru = t(spec.usageKey, 'ru');
    if (countChar(zh, '<') !== countChar(ru, '<') || countChar(zh, '[') !== countChar(ru, '[') || countChar(zh, '|') !== countChar(ru, '|')) {
      ruSyntaxDrift.push(spec.name);
    }
  }
  check('俄语用法串的 <> / [] / | 与中文一致', ruSyntaxDrift.length === 0, ruSyntaxDrift.join(','));

  /**
   * 法语的用法串同样必须保留 `<>` `[]` `|`（多语言 P4-3e，照抄德语/俄语那条）。
   * 帮助面板靠这些符号拆变体：少一个括号**不报错、只是表单变空**。
   */
  const frSyntaxDrift: string[] = [];
  for (const spec of COMMANDS) {
    const zh = t(spec.usageKey, 'zh');
    const fr = t(spec.usageKey, 'fr');
    if (countChar(zh, '<') !== countChar(fr, '<') || countChar(zh, '[') !== countChar(fr, '[') || countChar(zh, '|') !== countChar(fr, '|')) {
      frSyntaxDrift.push(spec.name);
    }
  }
  check('法语用法串的 <> / [] / | 与中文一致', frSyntaxDrift.length === 0, frSyntaxDrift.join(','));

  /**
   * 葡语用法串同样必须保留 `<>` `[]` `|`（多语言 P4-4d，照抄德/俄/法那条）。
   * 帮助面板靠这些符号拆变体：少一个括号**不报错、只是表单变空**。
   */
  const ptSyntaxDrift: string[] = [];
  for (const spec of COMMANDS) {
    const zh = t(spec.usageKey, 'zh');
    const pt = t(spec.usageKey, 'pt');
    if (countChar(zh, '<') !== countChar(pt, '<') || countChar(zh, '[') !== countChar(pt, '[') || countChar(zh, '|') !== countChar(pt, '|')) {
      ptSyntaxDrift.push(spec.name);
    }
  }
  check('葡语用法串的 <> / [] / | 与中文一致', ptSyntaxDrift.length === 0, ptSyntaxDrift.join(','));

  /**
   * 四语言巡查（多语言 P4-5）：对 de / ru / fr / pt 各跑一遍同一套判据。
   *
   * 这是"逐语言巡查"的可复现版本 —— 不靠人切语言点一圈，而是把四种语言全表
   * 逐键比一遍。四条判据各自防一类"测试全绿但界面上能看出来"的问题：
   *
   *  ① **不得含中文**：漏翻时抄了中文，`satisfies` 查不出来；
   *  ② **不得有空值**：空串在界面上就是一片空白；
   *  ③ **不得引入中文表里没有的占位符**：多出来的 `{foo}` 没人替换，会**字面显示**在界面上。
   *     （反向的"少用占位符"是允许的：`item.desc.tpl.armor` 的中文提了两次 `{material}`，
   *     罗曼语系写成「全套共 N 点护甲」不再提材料 —— 语义无损，不算错。）
   *  ④ **不得整组与英文相同**：法语收尾时 `label` 整组 226 条都是英文占位，
   *     而当时所有测试都是绿的 —— 这条判据就是那次挖出来的。
   */
  const sweepLocales = ['de', 'ru', 'fr', 'pt'] as const;
  for (const code of sweepLocales) await loadLocale(code);
  const zhTable = tableOf('zh');
  const enTable = tableOf('en');
  const holdersOf = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).map((h) => h.slice(1, -1));

  for (const code of sweepLocales) {
    const table = tableOf(code);
    const keysOfLocale = allKeys();

    const cjkLeft = keysOfLocale.filter((key) => /[\u4e00-\u9fff]/.test(table[key] ?? ''));
    check(`巡查 ${code}：全表没有中文残留`, cjkLeft.length === 0, cjkLeft.slice(0, 3).join(','));

    const emptyValues = keysOfLocale.filter((key) => (table[key] ?? '').trim().length === 0);
    check(`巡查 ${code}：全表没有空值`, emptyValues.length === 0, emptyValues.slice(0, 3).join(','));

    // 多出来的占位符 = 没人替换 → 界面上直接显示 `{foo}`
    const extraHolders: string[] = [];
    for (const key of keysOfLocale) {
      const zhHolders = new Set(holdersOf(zhTable[key] ?? ''));
      const localHolders = holdersOf(table[key] ?? '');
      for (const h of localHolders) {
        if (!zhHolders.has(h)) {
          extraHolders.push(`${key}:{${h}}`);
          break;
        }
      }
    }
    check(`巡查 ${code}：没有中文表之外的占位符`, extraHolders.length === 0, extraHolders.slice(0, 3).join(','));

    // 整组漏翻：一个组里 90% 以上与英文逐字相同，且组内键数 ≥ 20
    const byGroup = new Map<string, { total: number; sameAsEn: number }>();
    for (const key of keysOfLocale) {
      const group = key.split('.')[0] ?? key;
      const bucket = byGroup.get(group) ?? { total: 0, sameAsEn: 0 };
      bucket.total += 1;
      if (table[key] === enTable[key] && (zhTable[key] ?? '') !== (enTable[key] ?? '')) bucket.sameAsEn += 1;
      byGroup.set(group, bucket);
    }
    const untranslatedGroups = [...byGroup.entries()]
      .filter(([, b]) => b.total >= 20 && b.sameAsEn / b.total > 0.9)
      .map(([group, b]) => `${group}:${b.sameAsEn}/${b.total}`);
    check(`巡查 ${code}：没有整组仍是英文的组`, untranslatedGroups.length === 0, untranslatedGroups.join(','));

    // 抽查 20 条：不露键名（回落链坏掉时 t() 会返回键本身）
    const step = Math.max(1, Math.floor(keysOfLocale.length / 20));
    const sample = keysOfLocale.filter((_, index) => index % step === 0).slice(0, 20);
    const leakedKeys = sample.filter((key) => table[key] === key);
    check(`巡查 ${code}：抽样 20 条都不露键名`, leakedKeys.length === 0, leakedKeys.join(','));
  }

  /**
   * 食物说明跟着语言走（`[发现] 食物说明键化`）。
   *
   * 两条一起看，缺一不可：
   *  ① 动态拼出来的说明**不能露中文** —— 这族原来把「饥饿 +N｜饱和度 +N｜N% 概率<效果> N 级 N 秒」
   *     直接拼在 `itemNames.ts` 里：23 条有静态表条目的食物走表所以看不出来，
   *     另外 13 条（苹果、牛肉、腐肉、金苹果…）在德语/俄语界面上会露出中文；
   *  ② **切语言之后要变** —— 这是本条真正的坑：`DESCRIPTIONS[key]` 原来存的是**模块加载时求值的字符串**，
   *     只把文案搬进表、不改成 `() => …`，界面换了语言它仍然是中文（第一版就是这么翻的，实测才发现）。
   */
  const findItemId = (name: string): number => {
    for (let id = 0; id < 2000; id += 1) {
      if (itemDef(id)?.name?.replace('minecraft:', '') === name) return id;
    }
    return -1;
  };
  const appleId = findItemId('apple');
  check('食物动态说明的样本（apple）找得到', appleId >= 0);
  if (appleId >= 0) {
    setLanguage('zh');
    const appleZh = itemDescription(appleId);
    setLanguage('de');
    const appleDe = itemDescription(appleId);
    check('中文下食物说明是中文', appleZh.includes('饥饿 +4') && !appleZh.includes('Hunger'), appleZh);
    check('德语下食物说明不露中文', !/[\u4e00-\u9fff]/.test(appleDe) && appleDe.includes('Hunger +4'), appleDe);
    check('切语言后食物说明跟着变（不是加载时固化的字符串）', appleZh !== appleDe, `${appleZh} / ${appleDe}`);
    resetLanguageForTest();
  }

  /**
   * 难度与游戏模式的标签（P6-1，批次 20261024-0020）。
   *
   * 这两处在 `WorldScreen` / `SettingsScreen` 里原来是**中文常量表**
   * （`DIFFICULTY_LABELS` / `GAME_MODE_LABELS`），新建世界界面在德语下会显示「和平 / 简单 / 普通 / 困难」——
   * 用户报「难度、游戏模式都没改」指的就是这处。现在统一走 `cmd.label.*`，这条断言盯输出侧。
   */
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const labels = [...GAME_MODES.map((mode) => gameModeLabel(mode)), ...DIFFICULTIES.map((d) => difficultyLabel(d))];
    check(`模式/难度标签在 ${code} 下不含中文`, !/[\u4e00-\u9fff]/.test(labels.join('')), labels.join(','));
  }
  setLanguage('zh');
  check('中文下模式/难度标签仍是中文', gameModeLabel('creative') === '创造' && difficultyLabel('hard') === '困难', `${gameModeLabel('creative')} / ${difficultyLabel('hard')}`);

  /**
   * 成就文案（P6-4，批次 20261024-0020）。
   *
   * 200 条（100 × 标题+描述）从「中文在 `advancements.ts`、英文在 `advancementText.data.ts`」的
   * 两层结构搬进 `locales/<code>/advancement.ts`，键由 id 派生（`minecraft:story/root` →
   * `advancement.story_root.title`）。本轮只翻德语，ru / fr / pt 仍是英文占位（巡查里有白名单）。
   */
  // `story/root` 例外：它的标题是品牌名（见上），其余中文必须逐条等于原文
  check(
    '中文成就标题与原文逐条一致（story_root 除外，它是品牌名）',
    ADVANCEMENTS.filter((a) => a.id !== 'minecraft:story/root').every((a) => advancementTitle(a) === a.title),
  );
  setLanguage('en');
  const advEn = ADVANCEMENTS.map((a) => advancementTitle(a));
  // 允许少量专名与梗原样保留（`Minecraft` / `Nether` / `Sssssss…` / `Ice Bucket Challenge`），
  // 所以阈值是 10 而不是 0 —— 实测德语 6 条、俄语 4 条、法语 5 条、葡语 6 条，说明其余都真翻了。
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const titles = ADVANCEMENTS.map((a) => advancementTitle(a));
    check(`${code} 成就标题不含中文`, !/[\u4e00-\u9fff]/.test(titles.join('')));
    const sameAsEn = titles.filter((title, i) => title === advEn[i]).length;
    check(`${code} 成就标题基本都已本地化`, sameAsEn <= 10, `${sameAsEn}/${titles.length} 条与英文相同`);
  }
  setLanguage('zh');
  check('中文成就说明与原文逐条一致', ADVANCEMENTS.every((a) => advancementDesc(a) === a.desc));

  /**
   * 伤害提示（P6-5，批次 20261024-0020）。
   *
   * `DamageNotice` 原来有 16 条中文原因 + 7 条中文句式（“来自僵尸”/“被骷髅射中”/“摔落（从高处落地）（来源：世界边界）”），
   * 德语/俄语界面上会直接露中文。现在走 `notice.damage.*`，取值在**调用这一刻**做。
   */
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const texts = [
      damageReason('fall'),
      damageReason('lava'),
      damageReason('generic', 'Zombie'),
      damageReason('projectile', 'Skelett'),
      damageReason('poison', 'Spinne'),
    ];
    check(`${code} 伤害提示不含中文`, !/[\u4e00-\u9fff]/.test(texts.join('')), texts.join(' | ').slice(0, 60));
  }
  setLanguage('zh');
  check('中文伤害提示与改造前一致', damageReason('generic', '僵尸') === '来自僵尸' && damageReason('fall') === '摔落（从高处落地）');

  /**
   * 配方书文案（P6-5a，批次 20261024-0020）。
   *
   * `RecipeBook` 原来有 14 处中文字面量（搜索框提示、关闭键、翻页、汇总、空状态、
   * 仅可合成、按材料不足分行、熔炼提示）。现在走 `notice.recipe.*`。
   */
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const texts = [
      t('notice.recipe.searchPlaceholder'),
      t('notice.recipe.closeAria'),
      tp('notice.recipe.summary', { total: 181, craftable: 12 }),
      t('notice.recipe.emptyCraftable'),
      tp('notice.recipe.lineMissing', { head: 'A', layout: 'B', missing: 'C' }),
      tp('notice.recipe.smeltingHint', { seconds: 10 }),
    ];
    check(`${code} 配方书文案不含中文`, !/[\u4e00-\u9fff]/.test(texts.join('')), texts.join(' | ').slice(0, 60));

  /**
   * WebGL 不支持提示（P6-5b，批次 20261024-0020）。
   *
   * `GL_FAIL_TEXT` 原来是中文常量表（4 组 reason + 9 条 advice）。玩家在**设备不支持**时
   * 看到的那一屏就是它 —— 那时界面其余部分还没建起来，只有它，所以必须跟着语言走。
   * 现在走 `notice.webgl.*`，且 `glFailText()` 是函数（取用这一刻才查表）。
   */
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const texts = (['no-webgl2', 'no-webgl1', 'context-lost', 'unknown'] as const).flatMap((kind) => {
      const text = glFailText(kind);
      return [text.reason, ...text.advice];
    });
    check(`${code} WebGL 提示不含中文`, !/[\u4e00-\u9fff]/.test(texts.join('')), texts.join(' | ').slice(0, 60));
  }
  resetLanguageForTest();

  /**
   * 输出侧守卫（P6-6，批次 20261024-0020）：**全量**扫 `translateName()` 与 `itemDescription()`。
   *
   * 为什么必须单独立这一条：前面所有“巡查”查的都是**语言表的值**，而 2026-10-24 用户报的
   * “很多方块的标题说明还没改”恰恰是**表外的中文**（`potions.ts` 的名字常量、`item_frame` 的
   * `put(...)`、`fishing_rod` 的旧说明）。表里 100% 齐、`satisfies` 过、`audit:i18n` 也过 ——
   * 只有把**渲染结果**扫一遍才会露出来。这条是那次的直接产物，也是以后加物品时的兜底。
   *
   * 口径：1130 个物品 × 4 语言 × {名字, 说明}，任何一处含中日韩字符就报（附前 5 条定位）。
   */
  {
    const allItemIds: number[] = [];
    for (let id = 0; id < 2000; id += 1) {
      if (itemDef(id)) allItemIds.push(id);
    }
    check('输出侧守卫的样本量（物品数）足够', allItemIds.length > 1000, String(allItemIds.length));
    for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
      setLanguage(code);
      const leakedOutput: string[] = [];
      for (const id of allItemIds) {
        const def = itemDef(id);
        if (!def) continue;
        const key = def.name.replace('minecraft:', '');
        if (/[\u4e00-\u9fff]/.test(translateName(key))) leakedOutput.push(`name:${key}`);
        if (/[\u4e00-\u9fff]/.test(itemDescription(id))) leakedOutput.push(`desc:${key}`);
      }
      check(
        `${code}：${allItemIds.length} 个物品的名字与说明全量没有中文`,
        leakedOutput.length === 0,
        leakedOutput.slice(0, 5).join(','),
      );
    }
    resetLanguageForTest();
  }
  }
  resetLanguageForTest();
  resetLanguageForTest();
  resetLanguageForTest();

  /**
   * 药水与药水箭的名字（P6-2，批次 20261024-0020）。
   *
   * 这 140 条原来是 `potions.ts` 里构建时拼好的中文串（`name: '迅捷药水'`、`喷溅…`、`（延长）`、`II`），
   * 四语言界面上全部露中文。现在由 `variant` / `tier` / `splash` / `lingering` 走模板拼。
   * 两条判据：**换语言后不含中文**，以及**中文名与改造前逐字一致**（中文文案零变化是这批的硬约束）。
   */
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const names = [
      ...POTIONS.map((potion) => translateName(`potion_${potion.key}`)),
      ...TIPPED_ARROWS.map((arrow) => translateName(arrow.key)),
    ];
    const cjk = names.filter((name) => /[\u4e00-\u9fff]/.test(name));
    check(`药水/箭名在 ${code} 下不含中文`, cjk.length === 0, cjk.slice(0, 3).join(','));
  }
  setLanguage('zh');
  const potionNameDrift = [
    ...POTIONS.map((potion) => ({ key: `potion_${potion.key}`, expected: potion.name })),
    ...TIPPED_ARROWS.map((arrow) => ({ key: arrow.key, expected: arrow.name })),
  ].filter(({ key, expected }) => translateName(key) !== expected);
  check('中文药水/箭名与改造前逐字一致', potionNameDrift.length === 0, potionNameDrift.slice(0, 2).map((row) => row.key).join(','));

  /**
   * 零散物品名与说明（P6-3，批次 20261024-0020）。
   *
   * 三处原来在 `itemNames.ts` 里是中文常量：`put('item_frame', '物品展示框')`、`put('painting', '画')`、
   * `DESCRIPTIONS.fishing_rod` 那句 205 字的长文。前两条删掉 `put` 让 `translateName()` 回落到
   * `item.<key>` 表，长文搬进 `item.desc.fishing_rod`。
   */
  const rodId = findItemId('fishing_rod');
  check('item_frame / painting 走语言表', translateName('item_frame') === '物品展示框' && translateName('painting') === '画');
  check('钓鱼说明走语言表（中文与原 205 字一致）', rodId >= 0 && /5~30 秒/.test(itemDescription(rodId)));
  for (const code of ['de', 'ru', 'fr', 'pt'] as const) {
    setLanguage(code);
    const texts = [translateName('item_frame'), translateName('painting'), itemDescription(rodId)];
    check(`零散名/钓鱼说明在 ${code} 下不含中文`, !/[\u4e00-\u9fff]/.test(texts.join('')), texts.join(' | ').slice(0, 50));
  }
  resetLanguageForTest();
  resetLanguageForTest();
  resetLanguageForTest();

  /**
   * 葡语（巴西，多语言 P4-4）。
   *
   * 条目点名的三件事都在这一节里：
   *  ① **htmlLang**：`pt-BR`（不是 `pt`）—— `<html lang>` 与 `Intl.*` 都靠它，前面已有断言；
   *  ② **连接词**：`Intl.ListFormat('pt-BR')` 给的是 `A, B e C`，不用手写（前面也有断言）；
   *  ③ **0 算单数**：`Intl.PluralRules('pt-BR').select(0)` 是 `one` → `0 bloco`，与法语同构、与英语相反。
   */
  check('葡语可加载', (await loadLocale('pt')) === true);
  check('葡语进了可选清单', availableLanguages().includes('pt'), availableLanguages().join(','));
  const ptKeys = Object.keys(tableOf('pt'));
  check('葡语表条数与中文相同', ptKeys.length === allKeys().length, `${ptKeys.length} vs ${allKeys().length}`);

  const ptSamples: Array<[string, string]> = [
    ['menu.play', 'Jogar'],
    ['pause.title', 'Jogo pausado'],
    ['settings.row.fov', 'Campo de visão'],
    ['station.name.furnace', 'Fornalha'],
    // P4-4b 起 inventory 与 label 也是葡语
    ['inventory.tab.craftable', 'Fabricável'],
    ['panel.anvil', 'Bigorna'],
    ['label.effect.speed', 'Velocidade'],
    ['label.biome.desert', 'Deserto'],
    // P4-4c 起构件与模板、以及生物名是葡语（显式物品名仍是英文占位）
    ['item.toolKind.pickaxe', 'Picareta'],
    ['item.tpl.tool', '{kind} de {material}'],
    ['item.wood.oak', 'carvalho'],
    ['entity.mooshroom', 'Vaca-cogumelo'],
    // P4-4c2 起显式物品名也是葡语（不再是英文占位）
    ['item.stone', 'Pedra'],
    ['item.cobblestone', 'Pedregulho'],
    ['item.white_banner', 'Estandarte branco'],
    ['item.writable_book', 'Livro e pena'],
    // P4-4d 起命令域也是葡语
    ['cmd.give.desc', 'Dá itens a você (nome em português/inglês ou id numérico)'],
    ['cmd.reply.team.prefix', 'Prefixo'],
  ];
  for (const [key, expected] of ptSamples) {
    check(`葡语：${key}`, t(key, 'pt') === expected, t(key, 'pt'));
  }
  check('葡语表里没有中文残留', !/[\u4e00-\u9fff]/.test(ptKeys.map((key) => t(key, 'pt')).join('')));

  setLanguage('pt');
  const ptForms = [0, 1, 2, 5].map((n) => tn('statistics.blocks', n));
  check(
    '葡语复数：0 算单数（0 bloco / 1 bloco / 2 blocos / 5 blocos）',
    ptForms.join('|') === '0 bloco|1 bloco|2 blocos|5 blocos',
    ptForms.join('|'),
  );
  check(
    '葡语的过去分词也跟着配合（preenchido / preenchidos）',
    tn('buildtools.fill.done', 1) === '1 bloco preenchido' && tn('buildtools.fill.done', 3) === '3 blocos preenchidos',
    `${tn('buildtools.fill.done', 1)} / ${tn('buildtools.fill.done', 3)}`,
  );
  resetLanguageForTest();

  /**
   * 法语（多语言 P4-3）。
   *
   * 法语有两个特有的坑，这一节把两条都钉住：
   *  ① **0 算单数**：`Intl.PluralRules('fr').select(0)` 是 `one`（`0 bloc`，不是 `0 blocs`），
   *     与英语相反 —— 直接照英语写复数表会错；
   *  ② **撇号**：法语里 `l’` / `d’` 极多，值里统一用排版撇号 `’`，
   *     既省掉转义，也符合排版惯例（这条在生成脚本 `esc()` 里统一做，这里断言它没被漏掉）。
   */
  check('法语可加载', (await loadLocale('fr')) === true);
  check('法语进了可选清单', availableLanguages().includes('fr'), availableLanguages().join(','));
  const frKeys = Object.keys(tableOf('fr'));
  check('法语表条数与中文相同', frKeys.length === allKeys().length, `${frKeys.length} vs ${allKeys().length}`);

  const frSamples: Array<[string, string]> = [
    ['menu.play', 'Jouer'],
    ['pause.title', 'Jeu en pause'],
    ['chat.send', 'Envoyer'],
    ['statistics.title', 'Statistiques du monde'],
    // P4-3b 起这五组也是法语
    ['settings.row.fov', 'Champ de vision'],
    ['inventory.tab.craftable', 'Fabricable'],
    ['panel.dispenser', 'Lanceur'],
    ['editor.cancel', 'Annuler'],
    ['minigame.jump.retry', 'Rejouer'],
    // P4-3c 起构件与模板、以及生物名是法语（显式物品名仍是英文占位）
    ['item.toolKind.pickaxe', 'Pioche'],
    ['item.tpl.tool', '{kind} en {material}'],
    ['item.wood.oak', 'chêne'],
    ['entity.mooshroom', 'Vache-champignon'],
    // P4-3d 起显式物品名也是法语（不再是英文占位）
    ['item.stone', 'Roche'],
    ['item.cobblestone', 'Pierre'],
    ['item.writable_book', 'Livre et plume'],
    ['item.cooked_beef', 'Steak'],
    // P4-3e 起命令域也是法语
    ['cmd.give.desc', 'Vous donne des objets (nom en français/anglais ou id numérique)'],
    ['cmd.reply.team.prefix', 'Préfixe'],
  ];
  for (const [key, expected] of frSamples) {
    check(`法语：${key}`, t(key, 'fr') === expected, t(key, 'fr'));
  }
  check('法语表里没有中文残留', !/[\u4e00-\u9fff]/.test(frKeys.map((key) => t(key, 'fr')).join('')));
  // 只看**已翻的**键：没翻的组仍逐字等于英文，英文里的 `doesn't` 不该算进来
  const frTranslated = frKeys.filter((key) => t(key, 'fr') !== t(key, 'en'));
  const frAsciiApostrophe = frTranslated.filter((key) => t(key, 'fr').includes("'"));
  check(
    `法语值里没有 ASCII 撇号（统一用 ’，已翻 ${frTranslated.length} 条）`,
    frAsciiApostrophe.length === 0,
    frAsciiApostrophe.slice(0, 3).join(','),
  );

  setLanguage('fr');
  const frForms = [0, 1, 2, 5].map((n) => tn('statistics.blocks', n));
  check(
    '法语复数：0 算单数（0 bloc / 1 bloc / 2 blocs / 5 blocs）',
    frForms.join('|') === '0 bloc|1 bloc|2 blocs|5 blocs',
    frForms.join('|'),
  );
  check(
    '法语的过去分词也跟着配合（rempli / remplis）',
    tn('buildtools.fill.done', 1) === '1 bloc rempli' && tn('buildtools.fill.done', 3) === '3 blocs remplis',
    `${tn('buildtools.fill.done', 1)} / ${tn('buildtools.fill.done', 3)}`,
  );
  resetLanguageForTest();

  /**
   * 俄语（多语言 P4-2）。
   *
   * 俄语是**第一个真正需要复数变格**的语言：`1 блок / 2 блока / 5 блоков / 21 блок`。
   * `tn()` 的那套机制（P0-6）在德语下只用到了 one/other，到这里才被完整用上，
   * 所以这一节盯两件事：界面分组是真俄语（不是英文占位），以及四个数字各自取对形式。
   */
  check('俄语可加载', (await loadLocale('ru')) === true);
  check('俄语进了可选清单', availableLanguages().includes('ru'), availableLanguages().join(','));
  const ruKeys = Object.keys(tableOf('ru'));
  check('俄语表条数与中文相同', ruKeys.length === allKeys().length, `${ruKeys.length} vs ${allKeys().length}`);

  const ruSamples: Array<[string, string]> = [
    ['menu.play', 'Играть'],
    ['pause.title', 'Игра приостановлена'],
    ['settings.row.fov', 'Угол обзора'],
    ['statistics.title', 'Статистика мира'],
    ['editor.cancel', 'Отмена'],
    ['station.reason.needLevels', 'Нужно {cost} уровней опыта'],
    // P4-2c 起物品名的构件与显式名都是俄语（itemDesc 仍是英文占位，P4-2e 再翻）
    ['item.toolMaterial.diamond', 'алмаз'],
    ['item.dirt', 'Земля'],
    // P4-2b 起这两组也是真俄语
    ['inventory.title', 'Инвентарь'],
    ['panel.anvil', 'Наковальня'],
    ['label.effect.speed', 'Скорость'],
    ['label.enchantment.silk_touch', 'Шёлковое касание'],
  ];
  for (const [key, expected] of ruSamples) {
    check(`俄语：${key}`, t(key, 'ru') === expected, t(key, 'ru'));
  }
  check('俄语表里没有中文残留', !/[\u4e00-\u9fff]/.test(ruKeys.map((key) => t(key, 'ru')).join('')));
  // P4-2e2 起 itemDesc 也翻完了：抽查两条长文，必须与英文不同且不含中文
  check(
    '俄语的物品说明已翻（不再与英文相同）',
    t('item.desc.honey_block', 'ru') !== t('item.desc.honey_block', 'en') &&
      t('item.desc.cauldron', 'ru') !== t('item.desc.cauldron', 'en'),
  );
  check('俄语的物品说明里没有中文残留', !/[\u4e00-\u9fff]/.test(t('item.desc.cauldron', 'ru')));

  // 四个数字各自取对形式：俄语的 one 覆盖 1/21/31，few 覆盖 2~4/22~24，many 覆盖 0 与 5~20
  setLanguage('ru');
  const forms = [1, 2, 5, 21].map((n) => tn('statistics.blocks', n));
  check(
    '俄语复数：1 блок / 2 блока / 5 блоков / 21 блок',
    forms.join('|') === '1 блок|2 блока|5 блоков|21 блок',
    forms.join('|'),
  );
  check('俄语复数：数量词也跟着变（2 раза / 5 раз）', tn('station.brewLeft', 2).endsWith('2 раза') && tn('station.brewLeft', 5).endsWith('5 раз'), `${tn('station.brewLeft', 2)} / ${tn('station.brewLeft', 5)}`);
  resetLanguageForTest();

  // 德语的复数表是 P4-2 补的（P4-1 收口时漏了，tn 会印出「1 Blöcke」）
  setLanguage('de');
  check('德语复数：1 Block / 2 Blöcke', tn('statistics.blocks', 1) === '1 Block' && tn('statistics.blocks', 2) === '2 Blöcke', `${tn('statistics.blocks', 1)} / ${tn('statistics.blocks', 2)}`);
  resetLanguageForTest();

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
  // 多语言 P5-3：六种语言各一份 manifest，文件名按语言码拼（`manifest.${uiLang}.webmanifest`），
  // 中文那份仍是默认的 `manifest.webmanifest`（已装 PWA 的地址不能改）。
  check(
    'boot() 会按语言换 manifest 链接（六语言）',
    mainSrc2.includes("'./manifest.webmanifest'") && mainSrc2.includes('manifest.${uiLang}.webmanifest'),
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
