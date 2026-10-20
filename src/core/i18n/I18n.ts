/**
 * 界面语言（M8）—— 框架层。
 *
 * 为什么先做框架而不是"直接把中文换成英文"：这个仓库里用户可见的文案散在
 * 3 万行 UI 里（`SettingsScreen.ts` 一个文件就 2020 行），如果一边抽一边改行为，
 * 一次改动会同时动"文案"与"逻辑"两件互不相干的事，出问题时不知道是哪边坏的。
 * 所以这里只做三件事：**一张表、一个查表函数、一个当前语言**。
 *
 * 三条约定（都是踩过坑之后定的）：
 *  1. **键名点分、按界面分组**（`settings.group.game`），不写 `设置_游戏` 这种
 *     把中文当键的写法——那样改文案就会把键改掉，两处引用立刻失联。
 *  2. **查不到的键返回键名本身**，不返回空串、也不抛异常：
 *     界面上显示 `settings.group.game` 一眼就能看出漏了文案，
 *     而空串会变成"按钮是空的"，玩家只会以为是渲染坏了。
 *  3. **中英两张表必须键集一致**，`keyParity()` 就是给断言用的入口——
 *     "加了一条中文忘了加英文"是 i18n 最常见的回归，靠人眼查不住。
 */

export const LANGUAGES = ['zh', 'en'] as const;

export type Language = (typeof LANGUAGES)[number];

/** 语言自称（语言选择器里显示的就是这两串，不随当前语言变） */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  zh: '简体中文',
  en: 'English',
};

/** 默认语言：中文（本项目最初的文案全是中文，英文是后来补的） */
export const DEFAULT_LANGUAGE: Language = 'zh';

const ZH: Readonly<Record<string, string>> = {
  // ---- 暂停菜单
  'pause.title': '游戏已暂停',
  'pause.resume': '继续游戏',
  'pause.settings': '设置',
  'pause.achievements': '成就',
  'pause.exit': '保存并退出到主菜单',
  // ---- 设置页
  'settings.title': '设置',
  'settings.back': '返回',
  'settings.group.game': '游戏',
  'settings.group.controls': '控制',
  'settings.group.appearance': '外观',
  'settings.group.sound': '音频',
  'settings.language': '界面语言',
  'settings.language.hint': '切换后重新打开本面板生效',
  // ---- 设置行（"游戏"组那几行：进世界后最常改的）
  'settings.row.daylightCycle': '昼夜循环',
  'settings.row.showDebug': '调试信息',
  'settings.row.autosave': '自动保存',
  'settings.row.flying': '飞行',
  'settings.row.gameMode': '游戏模式',
  // ---- 设置行（"控制"组：视角、手感与触屏按钮）
  'settings.row.cameraMode': '视角',
  'settings.row.handedness': '惯用手',
  'settings.row.aimMode': '瞄准',
  'settings.row.touchStick': '摇杆',
  'settings.row.invertY': '反转视角',
  'settings.row.autoJump': '自动跳跃',
  'settings.row.fastEat': '快速进食',
  'settings.row.fov': '视野',
  'settings.row.touchScale': '按钮大小',
  'settings.row.sensitivity': '灵敏度',
  // ---- 设置行（"音频"组 + 外观里的两个视角按钮）
  'settings.row.volume': '主音量',
  'settings.row.volumeBlocks': '方块音效',
  'settings.row.volumeMobs': '生物音效',
  'settings.row.volumePlayer': '玩家音效',
  'settings.row.volumeUi': '界面音效',
  'settings.row.volumeAmbient': '雨声',
  'settings.row.volumeMusic': '音乐',
  'settings.avatar.full': '全身',
  'settings.avatar.face': '面部',
};

const EN: Readonly<Record<string, string>> = {
  'pause.title': 'Game Paused',
  'pause.resume': 'Resume Game',
  'pause.settings': 'Settings',
  'pause.achievements': 'Advancements',
  'pause.exit': 'Save & Quit to Title',
  'settings.title': 'Settings',
  'settings.back': 'Back',
  'settings.group.game': 'Game',
  'settings.group.controls': 'Controls',
  'settings.group.appearance': 'Appearance',
  'settings.group.sound': 'Audio',
  'settings.language': 'Language',
  'settings.language.hint': 'Takes effect after reopening this panel',
  'settings.row.daylightCycle': 'Daylight Cycle',
  'settings.row.showDebug': 'Debug Info',
  'settings.row.autosave': 'Autosave',
  'settings.row.flying': 'Flying',
  'settings.row.gameMode': 'Game Mode',
  'settings.row.cameraMode': 'Camera',
  'settings.row.handedness': 'Handedness',
  'settings.row.aimMode': 'Aiming',
  'settings.row.touchStick': 'Joystick',
  'settings.row.invertY': 'Invert Y',
  'settings.row.autoJump': 'Auto Jump',
  'settings.row.fastEat': 'Fast Eat',
  'settings.row.fov': 'Field of View',
  'settings.row.touchScale': 'Button Size',
  'settings.row.sensitivity': 'Sensitivity',
  'settings.row.volume': 'Master Volume',
  'settings.row.volumeBlocks': 'Block Sounds',
  'settings.row.volumeMobs': 'Mob Sounds',
  'settings.row.volumePlayer': 'Player Sounds',
  'settings.row.volumeUi': 'UI Sounds',
  'settings.row.volumeAmbient': 'Weather Sounds',
  'settings.row.volumeMusic': 'Music',
  'settings.avatar.full': 'Full Body',
  'settings.avatar.face': 'Face',
};

export const TABLES: Readonly<Record<Language, Readonly<Record<string, string>>>> = {
  zh: ZH,
  en: EN,
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * 从浏览器语言标签推断（`navigator.language`，形如 `zh-CN` / `en-US`）。
 * 分辨不出来的按中文处理——本项目的中文文案最全，英文是子集时也不至于一半中文一半英文。
 */
export function detectLanguage(tag: string | undefined | null): Language {
  if (typeof tag !== 'string') return DEFAULT_LANGUAGE;
  const lower = tag.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('en')) return 'en';
  return DEFAULT_LANGUAGE;
}

/**
 * 当前语言。
 *
 * ⚠️ 做成模块级状态而不是"到处传参数"：文案散在几十个渲染函数里，
 * 每处都多一个 `lang` 参数会把函数签名改一遍（那才是真正的大改）。
 * 代价是**它不参与依赖追踪**——所以切语言之后要显式刷新界面
 * （`SettingsScreen.applyLanguage()` 就是干这个的）。
 */
let current: Language = DEFAULT_LANGUAGE;

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  current = language;
  if (typeof document !== 'undefined') {
    // `<html lang>` 不是装饰：手机上的朗读/断行规则、以及浏览器的"翻译此页"提示都看它
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }
}

/** 测试用：把模块状态恢复成默认，避免用例之间互相污染 */
export function resetLanguageForTest(): void {
  current = DEFAULT_LANGUAGE;
}

/**
 * 查一条文案。`language` 省略时用当前语言。
 * 查不到就**返回键名**（见文件头第 2 条约定）。
 */
export function t(key: string, language: Language = current): string {
  const table = TABLES[language] ?? ZH;
  const value = table[key];
  if (typeof value === 'string' && value.length > 0) return value;
  // 当前语言缺这一条时退到中文：英文表漏一条不该让界面出现空白
  const fallback = ZH[key];
  if (typeof fallback === 'string' && fallback.length > 0) return fallback;
  return key;
}

/**
 * 两张表的键集差异（给断言用）。
 * 正常情况下两个数组都为空——不空就是"漏翻了一条"。
 */
export function keyParity(): { missingInEn: string[]; missingInZh: string[] } {
  const zhKeys = Object.keys(ZH);
  const enKeys = Object.keys(EN);
  return {
    missingInEn: zhKeys.filter((key) => !(key in EN)),
    missingInZh: enKeys.filter((key) => !(key in ZH)),
  };
}

/** 所有已定义的键（断言"界面用到的键都在表里"时拿它当白名单） */
export function allKeys(): string[] {
  return Object.keys(ZH);
}
