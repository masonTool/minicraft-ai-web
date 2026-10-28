/**
 * 暂停菜单与设置（K3）
 *
 * **一个面板、两页**（批次 108）：
 *  - `menu`：暂停菜单——继续游戏 / 设置 / 成就 / 保存并退出到主菜单 / 删除本世界，
 *    外加一行存档信息。一页只放"几个主要按钮"，这是用户明确要的；
 *  - `settings`：设置项——视距 / 视野 / 音量 / 灵敏度 / 触摸 / 视角 / 调试信息…
 *    左上角一颗 `‹ 返回` 回暂停菜单。
 *
 * 为什么是同一份 DOM 的两页、而不是两个面板：这个面板在**两处**被用
 *（游戏里的暂停菜单、主菜单里的"设置"），两套 DOM 迟早出现"这处改了那处没改"；
 * 而两页共用标题栏/关闭键/页签/滚动区的样式，也省了一批重复的 CSS。
 * 页面切换只切 `.active`，没有动画、没有重建，所以 Esc / Android 返回键
 * 都是同步的（见 `goBack`）。
 *
 * 设置存在 localStorage 里（与 K1 的世界存档分开）：
 * 设置是"这台设备的偏好"，换世界也不该丢；而世界存档属于某个种子。
 */

import { CAMERA_MODES, cameraModeLabel, type CameraMode } from '../core/viewMode.ts';
// 界面语言（M8，批次 403；多语言 P0-5 起多一个 `auto` = 跟随系统）：表与当前语言都在这个纯模块里
import {
  AUTO_LANGUAGE,
  LANGUAGE_NAMES,
  availableLanguages,
  isLanguageSetting,
  resolveLanguage,
  t,
  tp,
  type LanguageSetting,
} from '../core/i18n/I18n.ts';
import { GAME_MODES, gameModeLabel, type GameMode } from '../core/world/GameMode.ts';
import { FOV_MAX, FOV_MIN, MOBILE_VIEW_DISTANCE_MAX, fovCapFor } from '../core/world/PerfPolicy.ts';
import {
  handednessLabels,
  HANDEDNESS_MODES,
  STICK_MODES,
  stickModeLabels,
  isTouchUi,
  type Handedness,
  type StickMode,
} from './TouchControls.ts';
import {
  BEARD_STYLES,
  BODY_BUILDS,
  BODY_FRAMES,
  CHARACTER_PRESETS,
  DEFAULT_APPEARANCE,
  EYE_COLORS,
  EYE_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  appearanceIndex,
  applyCharacterPreset,
  beardLabel,
  bodyBuildLabel,
  bodyFrameLabel,
  eyeColorLabel,
  eyeStyleLabel,
  hairColorLabel,
  hairStyleLabel,
  paletteOf,
  pantsColorLabel,
  presetIndexOf,
  shirtColorLabel,
  skinToneLabel,
} from '../game/appearance.ts';
import { PlayerPreview3D, type PreviewFocus } from './PlayerPreview3D.ts';
import { drawPlayerPreview } from './PlayerPreview.ts';
import { Dropdown } from './Dropdown.ts';

/**
 * 粒子效果强度。
 * 手机上粒子是最容易把帧率吃掉的项（一次破坏就要生成十几个四边形），
 * 所以做成三档而不是简单的开关：`reduced` 仍然看得见碎屑，只是少一半。
 */
export type ParticleLevel = 'off' | 'reduced' | 'all';

/** 帧率上限的可选值（批次 130）：0 = 不限 */
export const FPS_CAPS: readonly number[] = [0, 30, 60];
/** 帧率上限的显示名：0 = 不限。原来是一张常量表，切语言后不跟着变 */
export function fpsCapLabel(value: number | string): string {
  return Number(value) === 0 ? t('settings.opt.unlimited') : t(`settings.opt.fps${Number(value)}`);
}

export const PARTICLE_LEVELS: readonly ParticleLevel[] = ['off', 'reduced', 'all'];

export function particleLevelLabel(level: ParticleLevel): string {
  const key =
    level === 'off' ? 'settings.opt.off' : level === 'reduced' ? 'settings.opt.reduced' : 'settings.opt.all';
  return t(key);
}

/** 各档位对应的生成数量倍率（`off` 直接不生成） */
export const PARTICLE_DENSITY: Record<ParticleLevel, number> = {
  off: 0,
  reduced: 0.4,
  all: 1,
};

/** 触摸按钮 / 摇杆的大小倍率范围（批次 97）：0.8× 到 1.4× */
export const TOUCH_SCALE_MIN = 0.8;
export const TOUCH_SCALE_MAX = 1.4;

/**
 * 灵敏度档位（批次 271 引入；**批次 522 重新定标**）：**1~8，4 档 = 上一版的最快档（4×）**。
 *
 * 用户的原话："显示成 4，但实际应该是当前的最高档；范围 1~8，变化后体感要平滑。"
 *
 *  - **4 档 = 4×**：上一版 0~8 里 8 档的倍率就是 4×，也就是他一直用的"最快档"。
 *    重新编号后它落在滑杆正中间，1~3 可以更慢（做精细建筑），5~8 是真的加速余量。
 *  - **每档 ×1.25（等比）**：灵敏度是"手移多少 → 视角转多少"的比例，人对它的感知是
 *    **对数**的。等比步进 = 每拨一档的体感差不多；等差会变成"低档几乎没区别、
 *    高档一格跳飞"。1.25 也比上一版的 ×1.41 更细腻。
 *  - 结果：整条滑杆 2.05× ~ 9.77×，8 档约等于"最快档再快 2.4 倍"。
 *
 * ⚠️ 这个刻度的代价：滑杆**最慢也是 2.05×**（上一版还能到 0.25×）。因为锚点被钉在
 * "最快档"，这是算术上的必然；要放宽只能调小 `SENSITIVITY_STEP_RATIO`（见它的注释）。
 *
 * `sensitivityGain()` 是唯一的换算出处，鼠标/触摸/手柄三条路径都读它。
 */
export const SENSITIVITY_MIN = 1;
export const SENSITIVITY_MAX = 8;
export const SENSITIVITY_DEFAULT = 4;

/** 4 档（滑杆默认位置）对应的实际倍率 = 上一版的最快档 */
export const SENSITIVITY_GAIN_AT_DEFAULT = 4;

/**
 * 相邻两档的倍率比（等比步进）。
 *
 * 调小 → 每档更细腻、但整条滑杆的范围更窄（8 档不够快）；
 * 调大 → 范围更宽、但每档的跳动更明显。1.25 是"8 档能到 9.8×、每档 +25%"的折中。
 */
export const SENSITIVITY_STEP_RATIO = 1.25;

/** 档位 → 视角倍率（4 → 4×；每档 ×1.25） */
export function sensitivityGain(level: number): number {
  const clamped = Math.min(
    SENSITIVITY_MAX,
    Math.max(SENSITIVITY_MIN, Number.isFinite(level) ? level : SENSITIVITY_DEFAULT),
  );
  return SENSITIVITY_GAIN_AT_DEFAULT * SENSITIVITY_STEP_RATIO ** (clamped - SENSITIVITY_DEFAULT);
}

/**
 * 任意倍率 → **最接近**的一档（用于设置迁移）。
 * 低于滑杆下限的倍率（例如老存档的 0.5×）一律落到 1 档 —— 新刻度表达不了更慢的。
 */
export function sensitivityLevelFromGain(gain: number): number {
  const value = Number.isFinite(gain) && gain > 0 ? gain : SENSITIVITY_GAIN_AT_DEFAULT;
  const level = Math.round(
    SENSITIVITY_DEFAULT + Math.log(value / SENSITIVITY_GAIN_AT_DEFAULT) / Math.log(SENSITIVITY_STEP_RATIO),
  );
  return Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, level));
}

/**
 * **版本 2 的档位** → 当时的实际倍率（旧刻度：0~8 档、4 = 1×、每 2 档翻一倍）。
 *
 * 版本 3 换了锚点，迁移必须先把旧档位换成"实际倍率"再按新刻度找回最近的一档：
 * 直接把数字搬过来会让老存档的"档位 4"（1×）变成 4×，手感一夜之间翻四倍。
 */
export function legacySensitivityGain(level: number): number {
  const clamped = Math.min(8, Math.max(0, Number.isFinite(level) ? level : 4));
  return 2 ** ((clamped - 4) / 2);
}

/**
 * 触摸端的瞄准方式（批次 271，用户要求）。
 *  - `finger`：手指落点决定目标（批次 239 起的默认）；
 *  - `center`：屏幕中央的准星决定目标（批次 239 之前的老方式）。
 */
export type TouchAimMode = 'finger' | 'center';
export const TOUCH_AIM_MODES: readonly TouchAimMode[] = ['finger', 'center'];
export function touchAimModeLabel(mode: TouchAimMode): string {
  return t(mode === 'finger' ? 'settings.opt.finger' : 'settings.opt.center');
}

/**
 * 设置格式版本（批次 271；批次 521 升到 3）。
 *
 *  - 版本 1 = 灵敏度存的是 0.5~4 的倍率；
 *  - 版本 2 = 灵敏度存 0~8 的档位（批次 521 起下限是 1）；
 *  - 版本 3 = 视野默认 72° → **60°**、摇杆默认 固定 → **跟随手指**、
 *    **灵敏度重新定标**（1~8，4 档 = 上一版最快档 4×），字段含义随之改变。
 *  - 版本 4 = 摇杆默认 **跟随手指 → 固定**（批次 528，用户要求）。
 *  - 版本 5 = 调试信息默认 **开 → 关**（2026-10-28，用户要求）。
 *
 * **必须显式存版本**：老默认值 1 在新口径里是"档位 1"，直接 clamp 会把
 * 所有老玩家的灵敏度从 1× 悄悄降到 0.7×。
 *
 * 迁移只改"还停在旧默认值上"的那几项（见 `loadSettings`）：
 * 玩家自己调过的 72° / 摇杆模式要保留——迁移默认值不等于覆盖玩家的选择。
 */
export const SETTINGS_VERSION = 5;

/**
 * 场景亮度的范围（批次 220）：0.5 ~ 2，1 = 原始亮度。
 *
 * 用户要的是"能调节游戏内场景的亮度"——它不是游戏里的光照等级（那个由天光/火把决定），
 * 而是**屏幕这一层**的增益：户外强光下、或者手机贴了防窥膜时，把画面整体提亮。
 * 落地方式见 `main.applySceneBrightness`（渲染画布的 CSS brightness 滤镜），
 * 所以它不改变任何方块/生物的实际亮度，也不进存档。
 */
export const BRIGHTNESS_MIN = 0.5;
export const BRIGHTNESS_MAX = 2;

/**
 * 循环按钮上的"当前值"（批次 172 修的一个真 bug）。
 *
 * ⚠️ 设置里有的项存的是**数字**（帧率上限 0/30/60、自动保存 30/60/120），
 * 而循环按钮按**字符串**列表转（`FPS_CAPS.map(String)`）。原来的写法是
 * `values.includes(this.settings[key] as T)`——数字 `30` 永远不等于字符串 `'30'`，
 * 于是它**永远显示第一档**，而且每点一次都只回到第二档：`maxFps` 从 0 点一次 → 30，
 * 再点还是 30（因为 `current()` 又回到 `'0'`）。这个 bug 从批次 130 潜伏到 172，
 * 期间没有任何断言覆盖"点了之后**再点一次**"。
 *
 * 修法：一律先转成字符串再比。两个小函数单独导出，就是为了能被离线断言钉住。
 */
export function cycleValue(values: readonly string[], raw: unknown): string {
  const text = String(raw);
  return values.includes(text) ? text : values[0]!;
}

/** 循环按钮点一下之后的下一个值（同样先转字符串） */
export function nextCycleValue(values: readonly string[], raw: unknown): string {
  const current = cycleValue(values, raw);
  return values[(values.indexOf(current) + 1) % values.length]!;
}

/**
 * 设置项的分组（批次 104，批次 107 调整过呈现方式）。
 *
 * 分组本身仍是排版的关键：每组一个小标题，相邻两组之间有一条分隔线，
 * 一长条 16 行设置因此可读。批次 104 曾让手机端"一组一页"（页签），
 * 批次 107 改成"四组一次全展开 + 行高压紧"（更符合"展示得更多"的反馈）；
 * 只有矮屏（横屏手机）放不下时才退回页签分页——判据见 index.html。
 */
/**
 * 分组顺序 = 使用频率（用户要求："把游戏挪到第一个，按使用频率排序"）。
 *  - 游戏：进世界后最常改（模式 / 飞行 / 自动保存 / 昼夜）
 *  - 控制：视角、灵敏度、摇杆、跳跃与进食开关
 *  - 外观：角色形象，属于"捏一次就很少动"
 *  - 音频：调好之后基本不再进来
 */
export const SETTING_GROUPS = ['game', 'controls', 'appearance', 'sound'] as const;

export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * 分组中文名。
 *
 * ⚠️ 批次 203 起**没有「视频」组了**：视距 / 自适应分辨率 / 自适应视距 / 天气效果
 * 四行删掉之后，那一组只剩一个「视野」，于是并进「控制」。
 * 判断标准：**一组的行数掉到 1~2 行时就该问"它还算一个分类吗"**——
 * 一个只为一行设置的页签，在手机上等于多一次点击。
 */
export function settingGroupLabel(group: SettingGroup): string {
  return t(`settings.group.${group}`);
}

/**
 * 每个分组里有哪些设置字段（2026-10-28，用户："每个设置页面下方都有两个按钮，
 * 一个是保存、一个是恢复默认"）。
 *
 * 有了这张表，"保存"与"恢复默认"只作用于**当前这一页**，而不是整份设置：
 *  - 脏值判断按组比：另一页没保存的改动不会点亮这一页的保存按钮；
 *  - 恢复默认只把这一组的字段写回 `DEFAULT_SETTINGS`（比如在「音频」页点恢复默认
 *    不会把角色形象也一起改掉）。
 *
 * ⚠️ 新增设置项必须同时挂进某个分组：漏挂的后果是那个控件改了永远保存不了
 * （保存按钮一直灰着），而且恢复默认也碰不到它。`tools/settings-test.ts` 有一条
 * "每个字段都被某个分组覆盖"的断言在盯着这件事。
 *
 * `viewDistance` / `adaptiveResolution` / `maxFps` 这些**没有界面入口**的字段
 * 故意不在表里：它们由设备的性能策略决定（见批次 203 的注释）。
 */
export const SETTING_GROUP_KEYS: Record<SettingGroup, readonly (keyof GameSettings)[]> = {
  // 游戏：进世界后最常改的（模式与飞行是"世界状态"，不在这份偏好里）
  game: ['daylightCycle', 'showDebug', 'language'],
  controls: [
    'fov',
    'touchScale',
    'sensitivity',
    'cameraMode',
    'handedness',
    'aimMode',
    'touchStick',
    'autoJump',
    'fastEat',
  ],
  appearance: [
    'brightness',
    'cape',
    'hairStyle',
    'hairColor',
    'beard',
    'eyes',
    'eyeColor',
    'build',
    'frame',
    'skinTone',
    'shirtColor',
    'pantsColor',
  ],
  sound: [
    'volume',
    'volumeBlocks',
    'volumeMobs',
    'volumePlayer',
    'volumeUi',
    'volumeAmbient',
    'volumeMusic',
  ],
};

/** 自动保存间隔的可选值（秒，批次 172 / TASKS M20）：不提供"关闭"，避免丢档 */
export const AUTOSAVE_OPTIONS: readonly number[] = [30, 60, 120];
export function autosaveLabel(seconds: number | string): string {
  return t(`settings.opt.sec${Number(seconds)}`);
}

/** 布尔型设置项（开关那种），单独取个名字给 makeToggle 用 */
type BoolSettingKey =
  | 'clouds'
  | 'daylightCycle'
  | 'showDebug'
  | 'adaptiveViewDistance'
  | 'adaptiveResolution'
  | 'weatherEffects'
  | 'cape'
  | 'autoJump'
  | 'fastEat';

export interface GameSettings {
  /** 设置格式版本（批次 271；见 `SETTINGS_VERSION` 的注释） */
  settingsVersion: number;
  /**
   * 界面语言（M8，批次 403；多语言 P0-5 起是"语言或跟随系统"）：
   * 具体语言码（`zh` / `en` / …），或 `auto`——首次启动按设备语言定，之后跟着设备走。
   * ⚠️ 切换后要**重开面板**才全部生效：文案是在构建 DOM 时写进去的，
   * 已经建好的节点不会自己重读语言（`applyLanguage()` 只覆盖挂了 ref 的那几处）。
   * 存的是**选择**（可能是 `auto`），真正生效的语言由 `resolveLanguage()` 解析。
   */
  language: LanguageSetting;
  /** 视距（区块）：4~16。影响流式加载范围与雾的远近 */
  viewDistance: number;
  /** 视野角度（度）：45~90，默认 60（见 `FOV_MIN` / `FOV_MAX`） */
  fov: number;
  /** 主音量 0~1（K5 的音效会用） */
  volume: number;
  /**
   * 四组音量（批次 178，M20 的最后一项）：与主音量**相乘**。
   *
   * 分组的默认值给 1（= 不额外衰减）：默认状态下"看不出有这个功能"才是对的，
   * 调过之后才有差别——否则所有声音一上来就比以前轻一截。
   */
  volumeBlocks: number;
  volumeMobs: number;
  volumePlayer: number;
  volumeUi: number;
  /** 环境音（雨声，批次 233）：默认 1（不额外衰减） */
  volumeAmbient: number;
  /** 背景音乐（批次 233）：默认 0.6——音乐是背景，不该和"我挨打了"一样响 */
  volumeMusic: number;
  /** 视角灵敏度档位：1~8，4 = 4×（上一版的最快档，见 `sensitivityGain`） */
  sensitivity: number;
  /** 触摸端瞄准方式（批次 271）：手指落点 / 屏幕中心 */
  aimMode: TouchAimMode;
  /** 左右手模式（批次 271）：摇杆在左 / 摇杆在右 */
  handedness: Handedness;
  /** 角色外观（批次 187 / 279）：都是**档位下标**，见 `game/appearance.ts` */
  skinTone: number;
  shirtColor: number;
  pantsColor: number;
  /** 发色 / 发型 / 胡须（批次 279，角色预设与装扮） */
  hairColor: number;
  hairStyle: number;
  beard: number;
  /**
   * 批次 333（用户："区分角色主要看头发、胡须、眼睛"）：
   * 眼型 / 瞳色，以及只改横向比例的年龄体型与身架。
   */
  eyes: number;
  eyeColor: number;
  build: number;
  frame: number;
  /**
   * 场景亮度（批次 220）：1 = 原始亮度，0.5~2（设置里显示成 50%~200%）。
   *
   * 只影响**渲染画布**（天空、地形、生物、粒子全在一起），不影响 HUD 与各个面板，
   * 所以夜里把它调亮不会把按钮也一起洗白。
   */
  brightness: number;
  /** 视角模式：第一人称 / 第三人称背后 / 第三人称正面（`V` 键循环切换） */
  cameraMode: CameraMode;
  /** 粒子效果强度：`off` 完全关闭、`reduced` 减半、`all` 全开（低配设备/手机省电用） */
  particles: ParticleLevel;
  /** 是否显示云（关掉能省一点填充率，也能看清远处地形） */
  clouds: boolean;
  /**
   * 披风（批次 185 外观）：第三人称与背包 3D 预览同时生效。
   *
   * 没有"披风物品"——原版的披风是皮肤的一部分，这里先给一个外观开关；
   * 以后做角色创建时，这块就是"皮肤/披风"那一栏的落点。
   */
  cape: boolean;
  /**
   * 天气效果（批次 172，TASKS M20）：关掉之后**不画雨雪点、也不溅雨花**，
   * 但天气本身照旧（火焰还是会被雨浇灭、炼药锅照样接水）。
   *
   * 手机上雨点是 `transparent` 的 `Points`，是最典型的填充率开销；
   * "雨太大看不清远处"时玩家需要的是一个能关掉它的开关。
   */
  weatherEffects: boolean;
  /**
   * 自动保存间隔（秒，批次 172，TASKS M20）：30 / 60 / 120。
   *
   * 不提供"关闭"——本项目没有手动存档按钮，关掉自动保存等于"崩了就白玩"。
   * 大世界保存那一下会有一次卡顿，间隔拉开是给"在手机上建大工程"的人留的旋钮。
   */
  autosaveSeconds: number;
  /**
   * 自动跳跃（批次 206，与基岩版同名设置）：走路顶到一格高的台阶时自动起跳。
   *
   * 0.6 格以内的雪层/台阶本来就由"上台阶"处理，这个开关只管整格高的那一档。
   * 默认开——手机上一边推摇杆一边点跳跃很别扭，原版也是默认开。
   */
  autoJump: boolean;
  /**
   * 快速进食（1.0 秒，批次 219）。
   *
   * 默认**开**：触摸端没有独立的使用键，进食借用"按住不动"，
   * 原版 1.6 秒叠上破坏用的长按判定（批次 272 起 400ms）在手机上实在太磨。
   * 关掉即回到原版的 1.6 秒节奏（数值见 `core/registry/food.ts` 的两个常量）。
   */
  fastEat: boolean;
  /**
   * 昼夜循环：关掉之后时间停在当前时刻（截图对比、搭建筑时很好用）
   */
  daylightCycle: boolean;
  /**
   * 是否显示左上角调试信息（HUD）。
   *
   * 2026-10-28（用户）：**默认关闭**——坐标/区块/帧率那一块是排查用的，
   * 普通玩家一进来看到满屏数字会以为是没做完。需要的人自己去「设置 → 游戏」打开。
   */
  showDebug: boolean;
  /**
   * 自适应视距：帧率掉下去时自动缩小视距（玩家设定的视距是**上限**，只会往下调）。
   * 移动端长时间游玩容易发热降频，这个开关能避免越玩越卡。
   */
  adaptiveViewDistance: boolean;
  /**
   * **自适应分辨率**（批次 130，N7）：掉帧时把渲染分辨率降下来（0.5~1 倍）。
   *
   * 它排在其他降级手段**前面**——"画面糊一点"比"视距短一截"更难被察觉，
   * 而省下的开销一样多（都是填充率）。策略在 `core/world/PerfPolicy.ts`。
   */
  adaptiveResolution: boolean;
  /**
   * **帧率上限**（批次 130，N7）：0 = 不限、30、60。
   *
   * 限帧不改变画面，它省的是 GPU 与电池——手机上"能跑 60 但只给 30"通常比
   * "忽快忽慢"更省电，玩家也更容易接受（原版基岩版也有同一项）。
   */
  maxFps: number;
  /**
   * 触摸摇杆模式（批次 96，与基岩版的两档一致）：固定左下角 / 跟随手指出现。
   *
   * 两条都要有：固定靠位置形成肌肉记忆，动态对"躺着玩、单手玩"更宽容
   * （不用先去找那个圈，左下随便一按就是摇杆）。
   */
  touchStick: StickMode;
  /**
   * 触摸按钮与摇杆的大小倍率（批次 97，基岩版设置里有同一项）。
   *
   * 手机上"按钮多大才顺手"因人而异（大拇指粗细、屏幕大小、拿姿），
   * 而且 44px 只是下限——基岩版把这个选择权交给玩家，我们也给。
   */
  touchScale: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  settingsVersion: SETTINGS_VERSION,
  // 多语言 P0-5：出厂默认**跟随系统**（发 Google Play 的口径）——
  // 俄语手机上第一次打开就是俄语（没有俄语表时按回落链退到英文），不再一律中文。
  language: AUTO_LANGUAGE,
  // 批次 539：PC 与手机同一策略——发热优先，默认视距直接定在 8。
  // 同一场景受控采样：12 → 1200 calls / 1.04M tris / WebGL 2757ms/6s；
  // 8 → 346 calls / 0.26M tris / WebGL 894ms/6s；帧率都保持 60。
  // 再往上加视距的收益是"远处更清楚"，代价是 GPU 负载接近三倍，笔记本明显发热。
  viewDistance: 8,
  // 视野默认 60°（批次 521，用户要求；基岩版默认也是 60），范围 45~90 见 `FOV_MIN/FOV_MAX`
  fov: 60,
  volume: 0.7,
  volumeBlocks: 1,
  volumeMobs: 1,
  volumePlayer: 1,
  volumeUi: 1,
  volumeAmbient: 1,
  volumeMusic: 0.6,
  sensitivity: SENSITIVITY_DEFAULT,
  aimMode: 'finger',
  handedness: 'right',
  skinTone: DEFAULT_APPEARANCE.skinTone,
  shirtColor: DEFAULT_APPEARANCE.shirtColor,
  pantsColor: DEFAULT_APPEARANCE.pantsColor,
  hairColor: DEFAULT_APPEARANCE.hairColor,
  hairStyle: DEFAULT_APPEARANCE.hairStyle,
  beard: DEFAULT_APPEARANCE.beard,
  eyes: DEFAULT_APPEARANCE.eyes,
  eyeColor: DEFAULT_APPEARANCE.eyeColor,
  build: DEFAULT_APPEARANCE.build,
  frame: DEFAULT_APPEARANCE.frame,
  brightness: 1,
  cameraMode: 'first',
  particles: 'all',
  clouds: true,
  cape: false,
  weatherEffects: true,
  autosaveSeconds: 30,
  autoJump: true,
  fastEat: true,
  daylightCycle: true,
  // 2026-10-28（用户）：调试信息默认关闭
  showDebug: false,
  adaptiveViewDistance: true,
  adaptiveResolution: true,
  maxFps: 0,
  // 批次 528（用户）：默认改回"固定"——固定靠位置形成肌肉记忆
  touchStick: 'fixed',
  touchScale: 1,
};

const STORAGE_KEY = 'bedrock-settings';

/**
 * 这台设备的**视距上限**（批次 202 引入，批次 203 改语义）。
 *
 * ⚠️ 这里必须按设备分开，不能直接用 `DEFAULT_SETTINGS.viewDistance`：
 *  - 桌面默认值是 8；手机上限是 `MOBILE_VIEW_DISTANCE_MAX`（8）；
 *  - 批次 202 之前"恢复默认"把 12 原样写回去，手机上等于一次性请求 489 个区块
 *    （`World.update` 在半径 12 下的候选圈；半径 8 是 225 个）——体感就是"恢复默认反而更卡"。
 *
 * 批次 203 起玩家**已经没有视距滑块**，所以这个函数返回的是"自适应策略允许涨到哪"：
 * 桌面上就是 8（`DEFAULT_SETTINGS`），手机上是 8。开局仍然只有
 * `MOBILE_VIEW_DISTANCE`（6）——那由渐进视距 `StartupRamp` 慢慢涨到上限。
 */
export function defaultViewDistanceFor(touch: boolean): number {
  return touch ? MOBILE_VIEW_DISTANCE_MAX : DEFAULT_SETTINGS.viewDistance;
}

/** 从 localStorage 读取设置（缺字段或损坏时回退默认值） */
export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    // 三个世代的灵敏度存储口径，**必须按版本分别换算**：
    //  · v1 = 0.5~4 的倍率；
    //  · v2 = 0~8 档（4 = 1×、每 2 档翻倍）—— 与 v3 的**档位含义不同**，
    //    要先还原成实际倍率再按新刻度找回最近的一档；
    //  · v3 = 1~8 档（4 = 4×、每档 ×1.25），可以直接用。
    // ⚠️ 直接把 v2 的数字搬过来，会让老存档的"档位 4"（当时是 1×）变成 4×。
    const storedVersion = typeof parsed.settingsVersion === 'number' ? parsed.settingsVersion : 1;
    const sensitivity =
      storedVersion >= 3
        ? Math.round(clampNumber(parsed.sensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX, SENSITIVITY_DEFAULT))
        : storedVersion === 2
          ? sensitivityLevelFromGain(legacySensitivityGain(clampNumber(parsed.sensitivity, 0, 8, 4)))
          : sensitivityLevelFromGain(clampNumber(parsed.sensitivity, 0.5, 4, 1));
    // 版本 3 的默认值迁移（批次 521）：**只改还停在旧默认值上的项**。
    // 72° 是 v2 的出厂值；玩家真调过就按他调的那个留着。
    const legacy = storedVersion < 3;
    const migratedFov = legacy && parsed.fov === 72 ? DEFAULT_SETTINGS.fov : parsed.fov;
    // 版本 4（批次 528）：摇杆默认 dynamic → fixed。
    // v3 的出厂值是 dynamic，只迁"还停在旧默认值"的那一项；更早的存档按原值处理。
    const migratedStick =
      storedVersion === 3 && parsed.touchStick === 'dynamic'
        ? DEFAULT_SETTINGS.touchStick
        : parsed.touchStick;
    return {
      settingsVersion: SETTINGS_VERSION,
      // 语言（多语言 P0-5）：认具体语言码或 `auto`；**老存档里的 `zh`/`en` 原样保留**——
      // 那是玩家当时的选择（或旧版默认），不该因为换了默认值就把他的界面语言改掉。
      // 只有"没有这个字段 / 写坏了"才回落到 `auto`（新装用户走跟随系统）。
      language: isLanguageSetting(parsed.language) ? parsed.language : DEFAULT_SETTINGS.language,
      viewDistance: clampNumber(parsed.viewDistance, 4, 16, DEFAULT_SETTINGS.viewDistance),
      fov: clampNumber(migratedFov, FOV_MIN, FOV_MAX, DEFAULT_SETTINGS.fov),
      volume: clampNumber(parsed.volume, 0, 1, DEFAULT_SETTINGS.volume),
      // 四组音量（批次 178）：脏数据一律回退到 1（= 不额外衰减）
      volumeBlocks: clampNumber(parsed.volumeBlocks, 0, 1, DEFAULT_SETTINGS.volumeBlocks),
      volumeMobs: clampNumber(parsed.volumeMobs, 0, 1, DEFAULT_SETTINGS.volumeMobs),
      volumePlayer: clampNumber(parsed.volumePlayer, 0, 1, DEFAULT_SETTINGS.volumePlayer),
      volumeUi: clampNumber(parsed.volumeUi, 0, 1, DEFAULT_SETTINGS.volumeUi),
      // 环境音 / 音乐（批次 233）：老存档没有这两项 → 回退默认（音乐 0.6）
      volumeAmbient: clampNumber(parsed.volumeAmbient, 0, 1, DEFAULT_SETTINGS.volumeAmbient),
      volumeMusic: clampNumber(parsed.volumeMusic, 0, 1, DEFAULT_SETTINGS.volumeMusic),
      sensitivity,
      // 瞄准方式 / 左右手（批次 271）：只认白名单；老存档没有这两项 → 默认
      aimMode: TOUCH_AIM_MODES.includes(parsed.aimMode as TouchAimMode)
        ? (parsed.aimMode as TouchAimMode)
        : DEFAULT_SETTINGS.aimMode,
      handedness: HANDEDNESS_MODES.includes(parsed.handedness as Handedness)
        ? (parsed.handedness as Handedness)
        : DEFAULT_SETTINGS.handedness,
      // 外观（批次 187）：坏值/越界一律回退默认档，渲染层不用再判空
      skinTone: appearanceIndex(parsed.skinTone, SKIN_TONES.length, DEFAULT_SETTINGS.skinTone),
      shirtColor: appearanceIndex(parsed.shirtColor, SHIRT_COLORS.length, DEFAULT_SETTINGS.shirtColor),
      pantsColor: appearanceIndex(parsed.pantsColor, PANTS_COLORS.length, DEFAULT_SETTINGS.pantsColor),
      hairColor: appearanceIndex(parsed.hairColor, HAIR_COLORS.length, DEFAULT_SETTINGS.hairColor),
      hairStyle: appearanceIndex(parsed.hairStyle, HAIR_STYLES.length, DEFAULT_SETTINGS.hairStyle),
      beard: appearanceIndex(parsed.beard, BEARD_STYLES.length, DEFAULT_SETTINGS.beard),
      // 批次 333：眼型 / 瞳色 / 年龄体型 / 身架，坏值逐项回退（老存档没有这几个字段）
      eyes: appearanceIndex(parsed.eyes, EYE_STYLES.length, DEFAULT_SETTINGS.eyes),
      eyeColor: appearanceIndex(parsed.eyeColor, EYE_COLORS.length, DEFAULT_SETTINGS.eyeColor),
      build: appearanceIndex(parsed.build, BODY_BUILDS.length, DEFAULT_SETTINGS.build),
      frame: appearanceIndex(parsed.frame, BODY_FRAMES.length, DEFAULT_SETTINGS.frame),
      // 场景亮度（批次 220）：超范围夹住，坏值回到 1（= 不滤镜）
      brightness: clampNumber(parsed.brightness, BRIGHTNESS_MIN, BRIGHTNESS_MAX, DEFAULT_SETTINGS.brightness),
      cameraMode: CAMERA_MODES.includes(parsed.cameraMode as CameraMode)
        ? (parsed.cameraMode as CameraMode)
        : DEFAULT_SETTINGS.cameraMode,
      particles: PARTICLE_LEVELS.includes(parsed.particles as ParticleLevel)
        ? (parsed.particles as ParticleLevel)
        : DEFAULT_SETTINGS.particles,
      clouds: parsed.clouds !== false,
      cape: parsed.cape === true,
      weatherEffects: parsed.weatherEffects !== false,
      // 间隔只认那几个档位：脏数据（或老存档里没有这一项）一律回到 30 秒
      autosaveSeconds: AUTOSAVE_OPTIONS.includes(parsed.autosaveSeconds as number)
        ? (parsed.autosaveSeconds as number)
        : DEFAULT_SETTINGS.autosaveSeconds,
      autoJump: parsed.autoJump !== false,
      // 快速进食默认开（与 autoJump 同一口径：只有显式 false 才关）
      fastEat: parsed.fastEat !== false,
      daylightCycle: parsed.daylightCycle !== false,
      // 2026-10-28（用户）：默认关闭。
      // ⚠️ 老存档（v4 及以前）里这一项是**旧默认 true** 被整份写进去的，
      // 分不清"玩家主动开的"和"默认值"——一律按新口径回到关（要开就再点一次）。
      showDebug: storedVersion >= 5 && parsed.showDebug === true,
      adaptiveViewDistance: parsed.adaptiveViewDistance !== false,
      adaptiveResolution: parsed.adaptiveResolution !== false,
      maxFps: FPS_CAPS.includes(parsed.maxFps as number) ? (parsed.maxFps as number) : DEFAULT_SETTINGS.maxFps,
      touchStick: STICK_MODES.includes(migratedStick as StickMode)
        ? (migratedStick as StickMode)
        : DEFAULT_SETTINGS.touchStick,
      touchScale: clampNumber(parsed.touchScale, TOUCH_SCALE_MIN, TOUCH_SCALE_MAX, DEFAULT_SETTINGS.touchScale),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 无痕模式下写不进去，忽略：设置只在本次会话生效
  }
}

/**
 * `onChange` 的附加说明（批次 202）。
 *
 * `reset` 只在一处为真：玩家点了"恢复默认设置"。主程序那边有一份**不写在设置里**
 * 的运行时状态（自适应已经降下去的分辨率倍率 / 装饰层档位、被压低过的视距），
 * 只有它知道"这一下是重置"，才能把那一份也一起复位。
 */
export interface SettingsChangeMeta {
  reset?: boolean;
}

export interface SettingsActions {
  /** 继续游戏（关闭面板） */
  onResume: () => void;
  /** 保存并回到主菜单（世界列表）；只应该在游戏里提供——主菜单里没有"当前世界" */
  onExitToMenu?: () => void;
  /** 删除当前世界（含存档）并回到主菜单；同上 */
  onDeleteWorld?: () => void;
  /** 设置变化：立即生效（视距/视野/调试信息都要马上看到效果） */
  onChange: (settings: GameSettings, meta?: SettingsChangeMeta) => void;
  /** 导入资源包（.mcpack / .zip） */
  onResourcePack?: (file: File) => void;
  /**
   * 打开成就 / 进度面板（M7，批次 87）。
   *
   * 原版把"成就"就放在暂停菜单里（基岩版的暂停菜单第一项），这里照做；
   * 手机上没有 Esc，所以那个按钮同时也在背包标题栏上挂着（`InventoryScreenHooks`）。
   */
  onOpenAdvancements?: () => void;
  /** 打开世界统计面板（批次 552） */
  onOpenStatistics?: () => void;
  /**
   * 切换创造模式（飞行）（批次 107）。
   *
   * 手机端右下那一簇原来有一颗"飞行"键，批次 107 精简掉之后它搬到这里
   *（基岩版手机也把这类开关放在暂停菜单/设置里）。两个回调都传了才显示这一行。
   */
  onToggleFly?: () => void;
  /** 当前是不是在飞（决定那一行的开关亮不亮） */
  isFlying?: () => boolean;
  /**
   * 诊断日志（批次 181）：给了这个回调才显示这一块。
   *
   * 为什么放在设置而不是暂停菜单：暂停菜单只放"几个主要按钮"（批次 108 的定论），
   * 而日志是排查用的低频入口；设置里已经有资源包这种同类项。
   *
   * ⚠️ 批次 220（用户）：只保留**导出**。原来还有「记录问题」（往日志里插一条 mark）
   * 与「复制」（把可读时间线放进剪贴板）两颗：它们对玩家来说是三个差不多的按钮，
   * 但导出时 JSON 里本来就带着整条时间线，打点/复制并不产出额外信息。
   */
  onDiagnosticsExport?: () => boolean;
  /** 当前条数 / 占用，用来在入口上显示"离 500KB 还有多远" */
  diagnosticsStats?: () => { events: number; kb: number; marked: boolean };
  /**
   * 游戏模式（批次 181 → 20261024-1455 改成"切到选中的那一个"）。
   *
   * 这是**唯一的模式入口**（新建世界时也能选）；双击跳跃只负责在创造模式里起降，
   * 不再顺带切模式。
   *
   * ⚠️ 原来这里是 `onToggleGameMode()`（无参切换），而下拉只列了生存/创造两项——
   * 于是"选中创造"实际执行的是 `nextGameMode(current)`：已经是创造时点了会退回生存，
   * 且冒险/旁观两个模式根本没出现在列表里。现在按**选中的值**直接设。
   */
  onSetGameMode?: (mode: GameMode) => void;
  gameMode?: () => GameMode;
  /**
   * 模式是不是锁死的（极限世界，2026-10-28）。
   *
   * 极限的模式是世界级硬约束，玩家不能自己改；这里给了回调就把下拉画成禁用态
   * 并补一句原因——而不是"能点、点了没反应"。
   */
  gameModeLocked?: () => boolean;
}

/**
 * 暂停菜单的两个页面（批次 108）。
 *
 * `menu` = 暂停菜单（继续游戏 / 设置 / 保存并退出…），`settings` = 设置项那一页。
 *
 * ⚠️ 批次 107 及以前这两件事挤在**同一页**上：一打开就是一堆滑块，最上面还并排着
 * "继续游戏/成就/保存并回到主菜单/删除本世界"四颗按钮。用户的原话是
 * "你现在做的是把几个按钮和设置整合到了一起……应该是几个主要按钮，
 * 然后设置是应该有一个设置按钮，点击设置按钮进入之后"——所以拆成两层。
 */
export const PAUSE_PAGES = ['menu', 'settings'] as const;
export type PausePage = (typeof PAUSE_PAGES)[number];

/**
 * 关面板的淡出时长（毫秒，批次 231）。
 *
 * 它的**主要作用不是好看**，而是把"摘面板"与"叫回触摸操作层"错开：
 * 只要面板在触摸层恢复之后还画了几帧，浏览器就不必在同一帧里拆/建两层，
 * 那一次会重算触摸坐标映射（下一次 `pointerdown` 的 clientX/Y 变成 0,0）。
 * 取 130ms：约 8 帧@60Hz，肉眼是"淡出"，不至于让玩家觉得慢。
 */
export const SETTINGS_FADE_MS = 130;

export class SettingsScreen {
  readonly root: HTMLDivElement;
  private open = false;
  /** `hide()` 排下的"淡出结束后隐藏"计时器 */
  private hideTimer: number | null = null;
  private readonly sliders = new Map<keyof GameSettings, HTMLInputElement>();
  /**
   * **草稿**（2026-10-28，用户："所有的设置项都不是改动立即生效"）。
   *
   * 控件只改这一份；按「保存」才把它按组拷回 `settings`（主程序握着的那份引用）
   * 并触发 `onChange`。这样拖滑块、点开关都不会立刻改游戏状态。
   */
  private draft: GameSettings;
  /** 已保存的基准（= 最后一次落盘的值），用来判断"这一页脏了没有" */
  private saved: GameSettings;
  /** 哪些分组按过「恢复默认」但还没保存：该组保存时要带 `reset` 标记（批次 202 的约定） */
  private readonly pendingResetGroups = new Set<SettingGroup>();
  /** 页脚的「保存」（脏了才亮） */
  private saveButton: HTMLButtonElement | null = null;
  /** 页脚容器（脏值时加 `.dirty` 给 CSS 做提示） */
  private footerEl: HTMLElement | null = null;
  /** 「未保存，要保存吗」弹窗（同一时间只留一个） */
  private leaveDialog: HTMLDivElement | null = null;
  /** 弹窗还没答完时，Esc 直接按「取消（不保存）」处理 */
  private leaveAnswer: ((save: boolean) => void) | null = null;
  /** 设置页的标题（`setTitle` 改的是它：主菜单里打开时是"设置"） */
  private readonly settingsTitleEl: HTMLElement;
  /** 设置页那句提示 */
  private readonly settingsHintEl: HTMLElement;
  private readonly resumeButton: HTMLButtonElement;
  /** 两页 = 两个 section，同一份 DOM 用 `.active` 切换 */
  private readonly pages = new Map<PausePage, HTMLElement>();
  /** 一个分组 = 一个 section；默认四组一起显示，矮屏上由 CSS 只放行 `.active` 那一组 */
  private readonly sections = new Map<SettingGroup, HTMLElement>();
  private readonly tabs = new Map<SettingGroup, HTMLButtonElement>();
  /** 当前页签（手机端生效；桌面端四组全显示，这个值只是"下次打开停在哪一页"） */
  private activeGroup: SettingGroup = SETTING_GROUPS[0];
  /** 当前停在哪一页 */
  private currentPage: PausePage = 'menu';
  /** 面板根节点（`setPage` 会把当前页写到它的 `data-page` 上，供 CSS 按页调宽度） */
  private readonly panel: HTMLDivElement;

  /**
   * 写一次文案。
   *
   * ⚠️ 多语言 P0-7：这里**不再登记**"切语言后要重写"的节点。
   * 之前那套（`labelBindings` + `applyLanguage()`）只能覆盖挂了 ref 的那几处，
   * 而且已经踩过"`applyInventoryChrome()` 把硬编码写回去、刷完一秒又被覆盖"的连环坑。
   * 现在切语言**整页重载**，DOM 全部重建，不需要任何重刷机制。
   */
  private bindLabel(element: HTMLElement, key: string): void {
    element.textContent = t(key);
  }

  /** "飞行"那个开关（非持久设置，见 `makeCreativeRow`；只在创造模式里显示） */
  private flyingToggle: HTMLButtonElement | null = null;
  /** 飞行开关所在的右半格（批次 528：与游戏模式同一行，不是整行） */
  private flyingCell: HTMLElement | null = null;
  /** "游戏模式"那个开关（生存 ↔ 创造） */
  private gameModeToggle: HTMLButtonElement | null = null;
  /** 四颗角色预设按钮（批次 333）：手动改任一外观项后全部取消高亮 */
  private readonly presetButtons: HTMLButtonElement[] = [];
  /**
   * 所有下拉控件（批次 528 起统一交给 `ui/Dropdown.ts`）。
   *
   * 这里只保留 close/dispose 两个能力：切页、关面板、销毁时要把它们收起来。
   */
  private readonly dropdowns: Array<{ close(): void; dispose(): void }> = [];
  /** 每个控件的"按真实状态重画"回调（switch / 下拉共用；飞行与游戏模式受外部状态影响） */
  private readonly controlSync = new Map<HTMLButtonElement, () => void>();
  /** Esc：角色形象弹窗（下拉菜单自己在 `Dropdown` 里处理 Esc） */
  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (this.packHelpOpen) {
      // 浮层在最上面：Esc 只收浮层，不退出设置页
      event.preventDefault();
      event.stopPropagation();
      this.closePackHelp();
      return;
    }
    if (!this.appearanceOpen) return;
    event.preventDefault();
    event.stopPropagation();
    this.closeAppearance();
  };
  /**
   * 设置页的角色形象（批次 333）：复用背包那台 `PlayerPreview3D`。
   *
   * 懒创建（第一次真正显示外观页才建 WebGL 上下文）；失败就退回 2D 剪影。
   * 只按需渲染：切外观项 / 拖动 / 尺寸变化时才画一帧，不跟主循环。
   */
  private avatarCanvas: HTMLCanvasElement | null = null;
  private avatar: PlayerPreview3D | null = null;
  private avatarFailed = false;
  private avatarFocus: PreviewFocus = 'full';
  /** 角色形象的二级弹窗（批次 528，用户要求把外观控件收进二级页） */
  private appearanceModal: HTMLDivElement | null = null;
  private appearanceOpen = false;
  /** 资源包说明的浮层（2026-10-28，用户：说明收进「导入」右边的 ? 里） */
  private packHelpModal: HTMLDivElement | null = null;
  private packHelpOpen = false;
  private avatarDrag: { pointerId: number; x: number } | null = null;
  private readonly avatarFocusButtons: HTMLButtonElement[] = [];
  /** 诊断日志那一行的状态文字（条数 / 占用 / 是否打过点） */
  private diagnosticsStatusEl: HTMLElement | null = null;
  /**
   * 控件"按当前 settings 重画"的回调表（批次 185，"恢复默认"要用）。
   *
   * 每个滑块 / 循环按钮在造出来的时候把自己的 `sync` 塞进来：恢复默认只需要
   * `Object.assign` 再把这张表跑一遍，不用重建整页 DOM（那会丢掉当前分组与滚动位置）。
   */
  private readonly refreshers: Array<() => void> = [];

  constructor(
    host: HTMLElement,
    private readonly settings: GameSettings,
    private readonly actions: SettingsActions,
  ) {
    // 草稿与基准都从当前设置拷一份（见 `draft` 字段的注释）
    this.draft = { ...settings };
    this.saved = { ...settings };

    this.root = document.createElement('div');
    this.root.id = 'settings-screen';
    this.root.classList.add('hidden');

    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    // 当前页写到面板的 `data-page` 上：横屏下"菜单页"与"设置页"需要的宽度不一样
    //（设置页要左选项卡 + 右内容，得有 800px；菜单页只有一列按钮，拉那么长很怪）
    this.panel = panel;

    // ================================================================ ① 暂停菜单
    //
    // 一页只放"几个主要按钮"（用户原话）。删除本世界是危险动作，单独排在最后。
    //
    // 批次 20261024-1152（用户）：这一页**不要标题、不要副标题、不要存档信息**——
    // 原来那三块（"游戏已暂停" / "点「继续游戏」或系统返回键返回" / "存档：已保存 · 改动 N 格…"）
    // 一起删掉，只留按钮与下面的键位说明。`pause.title` 与 `settings.touchBack`
    // 这两条文案留在 i18n 表里（别处/将来还能用），只是这一页不再渲染它们。
    const menuPage = this.makePage('menu');

    const actionsRow = document.createElement('div');
    actionsRow.className = 'pause-actions';

    this.resumeButton = document.createElement('button');
    this.resumeButton.type = 'button';
    this.resumeButton.id = 'pause-resume';
    this.resumeButton.className = 'pause-action primary';
    this.bindLabel(this.resumeButton, 'pause.resume');
    this.resumeButton.addEventListener('click', () => this.actions.onResume());

    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.id = 'pause-settings';
    settingsButton.className = 'pause-action';
    this.bindLabel(settingsButton, 'pause.settings');
    settingsButton.addEventListener('click', () => this.setPage('settings'));

    // 成就按钮（批次 20261024-1152，用户）：暂停页去掉这一颗。
    // 成就入口仍在背包左栏（手机上唯一的那条路），这里删掉不会让成就变成不可达。

    // 统计（批次 552）：与成就并排，低频但玩家会想看一眼"这世界玩了多久"
    const statistics = document.createElement('button');
    statistics.type = 'button';
    statistics.id = 'pause-statistics';
    statistics.className = 'pause-action';
    this.bindLabel(statistics, 'pause.statistics');
    statistics.addEventListener('click', () => this.actions.onOpenStatistics?.());
    statistics.style.display = this.actions.onOpenStatistics ? '' : 'none';

    // 用户点名的"保存档退出"：退出前主程序会落一次盘（`exitToMenu` 里已经这么做了）
    const exitToMenu = document.createElement('button');
    exitToMenu.type = 'button';
    exitToMenu.id = 'pause-exit';
    exitToMenu.className = 'pause-action';
    this.bindLabel(exitToMenu, 'pause.exit');
    exitToMenu.addEventListener('click', () => this.actions.onExitToMenu?.());

    // "退出"只在游戏里有意义；主菜单打开这个面板时（没有当前世界）就藏起来。
    // 删除世界只放在世界列表：原生基岩版暂停菜单也不会把不可逆删除混进日常按钮。
    // ⚠️ 用 style.display 而不是 .hidden 类：`.hidden` 只对面板根节点写了样式，
    // 加在按钮上没有任何效果。
    if (!this.actions.onExitToMenu) exitToMenu.style.display = 'none';

    actionsRow.append(this.resumeButton, settingsButton, statistics, exitToMenu);

    // 按键 / 手势说明（批次 111）：原来它挂在"点击进入游戏"那层遮罩上，
    // 遮罩按用户要求删掉之后搬到这里——按 Esc（或点顶部的暂停键）就能查，
    // 而且不再挡着"进去就是世界"这一步。两段按设备切换（`body.touch-mode`）。
    const help = document.createElement('div');
    help.className = 'pause-help';
    const keys = document.createElement('div');
    keys.className = 'desktop-only';
    keys.innerHTML = t('settings.helpDesktop');
    const gestures = document.createElement('div');
    gestures.className = 'touch-only';
    gestures.innerHTML = t('settings.helpTouch');
    help.append(keys, gestures);

    menuPage.append(actionsRow, help);

    // ================================================================ ② 设置页
    const settingsPage = this.makePage('settings');

    // 左上角"‹ 返回"：从暂停菜单进来时回菜单页；从**主菜单**进来时没有菜单页可回，
    // 那就等于关闭面板（位置与外观仍然统一——用户要的就是"统一"）。
    this.settingsTitleEl = document.createElement('b');
    this.settingsTitleEl.className = 'settings-title';
    this.settingsTitleEl.textContent = t('settings.title');
    const header = this.makeHeader(this.settingsTitleEl, t('settings.backArrow'), () => this.backFromSettings());

    this.settingsHintEl = document.createElement('div');
    this.settingsHintEl.className = 'settings-hint';

    // ---- 分组页签（三端都是"左选项卡 + 右内容"）
    //
    // ⚠️ 刻意**不用** `role="tab"`：那套 ARIA 要求"一个 tab 配一个 tabpanel"，
    // 而桌面端四个 section 是同时显示的（页签只是隐藏的装饰）——两种模式下语义相反，
    // 挂上 tab 角色反而会让读屏念出错误的层级。用 `aria-pressed` 就够表达"当前选中哪个"。
    const tabs = document.createElement('div');
    tabs.className = 'settings-tabs';
    for (const group of SETTING_GROUPS) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'settings-tab';
      tab.dataset.group = group;
      this.bindLabel(tab, `settings.group.${group}`);
      tab.addEventListener('click', () => this.setActiveGroup(group));
      this.tabs.set(group, tab);
      tabs.appendChild(tab);
    }

    // ---- 设置项（按分组切成 section：每组的行数不多，一屏放得下）
    const body = document.createElement('div');
    body.className = 'settings-body';
    for (const group of SETTING_GROUPS) {
      const section = document.createElement('section');
      section.className = 'settings-section';
      section.dataset.group = group;
      // 分类小标题只在桌面端显示（手机端页签上已经写着组名了，再来一行纯属占地方）
      {
        const heading = this.makeGroup(t(`settings.group.${group}`));
        this.bindLabel(heading, `settings.group.${group}`);
        section.appendChild(heading);
      }
      this.sections.set(group, section);
      body.appendChild(section);
    }

    // ⚠️ 批次 203（用户："性能相关的设置可以不用让用户去设置……我们给到用户最好的决策就够了"）：
    // 原来「视频」组里的四行全删了，组也一起没了：
    //  - 视距滑块、自适应分辨率、自适应视距 —— 纯性能调参，已由 `PerfPolicy` 全权接管
    //    （掉帧时先收视距、再关装饰层、最后降分辨率）。玩家的手动值还会与策略打架
    //    （手动钉死 16，策略仍要一轮轮往下压，界面数字与生效值从此对不上）。
    //  - 天气效果 —— 雨雪量已由装饰层档位自动控制（`decorRainFraction`）。
    //  - 更早（批次 185）删掉的：云、粒子效果、帧率上限。
    // 「视野」并进「控制」：它不是性能项（FOV 关系到晕动症与个人习惯），
    // 但不足以撑起一个独立页签——一组的行数掉到 1~2 行时就该合并。
    // ⚠️ `viewDistance` / `weatherEffects` / `adaptiveResolution` / `adaptiveViewDistance`
    // 这些**字段保留**：老存档照旧能读（不会因为字段消失而整份回退），
    // 值由主程序按设备定死（见 `main` 构造里那几行）。`maxFps` 同理。

    // ---- 外观（批次 187 / 296）：左边 3D 形象、右边全部可调项
    //
    // 用户："在设置中要能看到角色的形象，就像游戏内那种 3D 形象；各个元素都支持改动，
    // 改完立刻在形象上生效。"所以形象区不显示盔甲与副手盾牌（只展示原始角色），
    // 拖动可旋转，另有「面部」特写看眼睛/眉毛/胡须。
    const appearance = this.section('appearance');

    // 批次 528（用户："场景亮度向上移动到最上面的位置"）：
    // 它留在外观页，但排到第一行——进外观先看到亮度，再进"角色形象"二级弹窗。
    const appearanceTop = this.makeBlock(appearance);
    appearanceTop.append(
      this.makeSlider('brightness', t('settings.row.brightness'), '%', BRIGHTNESS_MIN * 100, BRIGHTNESS_MAX * 100, 5, 100),
    );

    const hero = document.createElement('div');
    hero.className = 'appearance-hero';
    const stage = document.createElement('div');
    stage.className = 'appearance-stage';
    const canvas = document.createElement('canvas');
    canvas.className = 'appearance-avatar';
    canvas.setAttribute('aria-label', t('settings.appearance.preview'));
    this.avatarCanvas = canvas;
    stage.appendChild(canvas);

    const focusRow = document.createElement('div');
    focusRow.className = 'appearance-focus';
    for (const [focus, label] of [
      ['full', t('settings.avatar.full')],
      ['face', t('settings.avatar.face')],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'appearance-focus-button';
      button.textContent = label;
      button.dataset.focus = focus;
      button.addEventListener('click', () => {
        this.avatarFocus = focus;
        this.applyFocusButtons();
        this.avatar?.setFocus(focus);
        this.refreshAvatar();
      });
      this.avatarFocusButtons.push(button);
      focusRow.appendChild(button);
    }
    stage.appendChild(focusRow);

    const tip = document.createElement('span');
    tip.className = 'appearance-tip';
    tip.textContent = t('settings.appearance.dragTip');
    stage.appendChild(tip);

    const fields = document.createElement('div');
    fields.className = 'appearance-fields';

    hero.append(stage, fields);

    // 外观页只留一个入口；真正的捏人控件全部搬进二级弹窗（批次 528，用户要求）
    const appearanceEntry = document.createElement('div');
    appearanceEntry.className = 'settings-row pair appearance-entry';
    const appearanceEntryName = document.createElement('span');
    appearanceEntryName.textContent = t('settings.appearance.title');
    const appearanceEdit = document.createElement('button');
    appearanceEdit.type = 'button';
    appearanceEdit.className = 'settings-cycle';
    appearanceEdit.textContent = t('settings.appearance.edit');
    appearanceEdit.addEventListener('click', () => this.openAppearance());
    appearanceEntry.append(appearanceEntryName, appearanceEdit);
    appearance.appendChild(appearanceEntry);

    const modal = document.createElement('div');
    modal.className = 'appearance-modal hidden';
    const modalPanel = document.createElement('div');
    modalPanel.className = 'appearance-modal-panel';
    const modalHeader = document.createElement('div');
    modalHeader.className = 'appearance-modal-header';
    const modalTitle = document.createElement('b');
    modalTitle.textContent = t('settings.appearance.title');
    const modalClose = document.createElement('button');
    modalClose.type = 'button';
    modalClose.className = 'inv-close appearance-close';
    modalClose.textContent = '✕';
    modalClose.setAttribute('aria-label', t('settings.appearance.close'));
    modalClose.addEventListener('click', () => this.closeAppearance());
    modalHeader.append(modalTitle, modalClose);
    const modalBody = document.createElement('div');
    modalBody.className = 'appearance-modal-body';
    modalBody.append(hero);
    modalPanel.append(modalHeader, modalBody);
    modal.append(modalPanel);
    this.appearanceModal = modal;

    // 批次 333（用户："预设 4 个"）：四颗按钮直接点选，比"点一下换一个"少点三次
    this.makePresetRow(fields);
    this.makeSelect(
      fields,
      'hairStyle',
      t('settings.row.hairStyle'),
      HAIR_STYLES.map((_, i) => String(i)),
      Object.fromEntries(HAIR_STYLES.map((style, i) => [String(i), hairStyleLabel(style)])),
    );
    this.makeSelect(
      fields,
      'hairColor',
      t('settings.row.hairColor'),
      HAIR_COLORS.map((_, i) => String(i)),
      Object.fromEntries(HAIR_COLORS.map((_, i) => [String(i), hairColorLabel(i)])),
    );
    this.makeSelect(
      fields,
      'beard',
      t('settings.row.beard'),
      BEARD_STYLES.map((_, i) => String(i)),
      Object.fromEntries(BEARD_STYLES.map((style, i) => [String(i), beardLabel(style)])),
    );
    this.makeSelect(
      fields,
      'eyes',
      t('settings.row.eyes'),
      EYE_STYLES.map((_, i) => String(i)),
      Object.fromEntries(EYE_STYLES.map((style, i) => [String(i), eyeStyleLabel(style)])),
    );
    this.makeSelect(
      fields,
      'eyeColor',
      t('settings.row.eyeColor'),
      EYE_COLORS.map((_, i) => String(i)),
      Object.fromEntries(EYE_COLORS.map((_, i) => [String(i), eyeColorLabel(i)])),
    );
    this.makeSelect(
      fields,
      'build',
      t('settings.row.build'),
      BODY_BUILDS.map((_, i) => String(i)),
      Object.fromEntries(BODY_BUILDS.map((build, i) => [String(i), bodyBuildLabel(build)])),
    );
    this.makeSelect(
      fields,
      'frame',
      t('settings.row.frame'),
      BODY_FRAMES.map((_, i) => String(i)),
      Object.fromEntries(BODY_FRAMES.map((frame, i) => [String(i), bodyFrameLabel(frame)])),
    );
    this.makeSelect(
      fields,
      'skinTone',
      t('settings.row.skinTone'),
      SKIN_TONES.map((_, i) => String(i)),
      Object.fromEntries(SKIN_TONES.map((_, i) => [String(i), skinToneLabel(i)])),
    );
    this.makeSelect(
      fields,
      'shirtColor',
      t('settings.row.shirtColor'),
      SHIRT_COLORS.map((_, i) => String(i)),
      Object.fromEntries(SHIRT_COLORS.map((_, i) => [String(i), shirtColorLabel(i)])),
    );
    this.makeSelect(
      fields,
      'pantsColor',
      t('settings.row.pantsColor'),
      PANTS_COLORS.map((_, i) => String(i)),
      Object.fromEntries(PANTS_COLORS.map((_, i) => [String(i), pantsColorLabel(i)])),
    );
    this.makeToggle(fields, 'cape', t('settings.row.cape'));

    this.bindAvatar(canvas);
    this.applyFocusButtons();

    const controls = this.section('controls');
    // 批次 528（用户："视野 / 按钮大小 / 灵敏度三个向上移"）：
    // 三个滑杆放在控制页第一块，常用项不再被一堆开关压到下面。
    const controlSliders = this.makeBlock(controls);
    // 视野（批次 203 / 215）：晕动症的人会往小调，习惯广角的人会往大调。
    // 但它有代价（72°→110° 可视范围约翻倍），而自适应管不到 FOV → 手机上封 90°。
    controlSliders.append(this.makeSlider('fov', t('settings.row.fov'), '°', FOV_MIN, fovCapFor(isTouchUi()), 1));
    controlSliders.append(
      this.makeSlider('touchScale', t('settings.row.touchScale'), '%', TOUCH_SCALE_MIN * 100, TOUCH_SCALE_MAX * 100, 5, 100),
    );
    // 灵敏度（批次 522）：1~8 档，4 = 4×（上一版最快档）。
    // 读数**只显示档位数字**（用户明确要求不要后面那个倍率括号）：
    // 倍率是内部口径，摆出来反而让人以为要自己换算。
    controlSliders.append(
      this.makeSlider('sensitivity', t('settings.row.sensitivity'), '', SENSITIVITY_MIN, SENSITIVITY_MAX, 1),
    );
    // 批次 521 起桌面的上限也收到 90°，这句"手机视野上限 90°"的说明反而成了噪音
    // （滑杆右端就写着 90），所以撤掉。

    // 第二块：按钮 / 下拉 / 开关（同类聚在一起）
    const controlOptions = this.makeBlock(controls);
    this.makeSelect(
      controlOptions,
      'cameraMode',
      t('settings.row.cameraMode'),
      CAMERA_MODES,
      // 与 `handednessLabels()` 同一个做法：标签表在构造时生成一次
      Object.fromEntries(CAMERA_MODES.map((mode) => [mode, cameraModeLabel(mode)])) as Record<CameraMode, string>,
    );
    /*
     * 触摸专属的三项（用户 2026-10-26）：惯用手 / 瞄准方式 / 摇杆。
     *
     * 它们在键鼠上**不可能生效**，摆出来只会让人以为哪里设错了：
     *   · 惯用手、摇杆：PC 没有摇杆（WASD + 鼠标），`handedness` / `touchStick` 只影响
     *     `TouchControls` 的布局与死区；
     *   · 瞄准方式：PC 的取物永远是"准星 → 视线射线"（`main.ts` 那三处 `aimMode` 消费点
     *     都带 `this.touch !== null`），没有"手指落点"这回事。
     * 所以整组在 `isTouchUi()` 为假时**不创建**——不是 disabled，是不出现。
     */
    if (isTouchUi()) {
      // 左右手模式（批次 271）：左手模式把摇杆整个挪到右侧
      this.makeSelect(controlOptions, 'handedness', t('settings.row.handedness'), HANDEDNESS_MODES, handednessLabels());
      // 瞄准方式（批次 271）：默认手指落点；可选回老的屏幕中心准星
      this.makeSelect(
        controlOptions,
        'aimMode',
        t('settings.row.aimMode'),
        TOUCH_AIM_MODES,
        Object.fromEntries(TOUCH_AIM_MODES.map((mode) => [mode, touchAimModeLabel(mode)])) as Record<TouchAimMode, string>,
      );
      // 触摸摇杆（批次 96）：手机上"手往哪搁"这件事因人而异
      this.makeSelect(controlOptions, 'touchStick', t('settings.row.touchStick'), STICK_MODES, stickModeLabels());
    }
    // ⚠️ 2026-10-28（用户）：**「反转视角」整项删掉**。
    // 这一项原本只是"上下方向反一下"，没有实际使用场景（触摸端是拖动手感、
    // 键鼠端是整块鼠标反向），留着反而容易被误触后不知道怎么调回来。
    // 设置字段也一起删了——老存档里残留的那个键会在 `loadSettings` 里被忽略。
    // 自动跳跃（批次 206）：手机上一边推摇杆一边点跳跃很别扭，默认开
    this.makeToggle(controlOptions, 'autoJump', t('settings.row.autoJump'));
    // 快速进食（批次 219）：1.0 秒 vs 原版的 1.6 秒，想对齐原版节奏就关掉
    this.makeToggle(controlOptions, 'fastEat', t('settings.row.fastEat'));

    const sound = this.section('sound');
    // 音频页全是滑杆：两列排，主音量与分组音量分开读
    const soundSliders = this.makeBlock(sound);
    soundSliders.append(
      this.makeSlider('volume', t('settings.row.volume'), '%', 0, 100, 1, 100),
      this.makeSlider('volumeBlocks', t('settings.row.volumeBlocks'), '%', 0, 100, 1, 100),
      this.makeSlider('volumeMobs', t('settings.row.volumeMobs'), '%', 0, 100, 1, 100),
      this.makeSlider('volumePlayer', t('settings.row.volumePlayer'), '%', 0, 100, 1, 100),
      this.makeSlider('volumeUi', t('settings.row.volumeUi'), '%', 0, 100, 1, 100),
      this.makeSlider('volumeAmbient', t('settings.row.volumeAmbient'), '%', 0, 100, 1, 100),
      this.makeSlider('volumeMusic', t('settings.row.volumeMusic'), '%', 0, 100, 1, 100),
    );

    const game = this.section('game');
    // 第一块：开关与下拉
    const gameOptions = this.makeBlock(game);
    // 批次 528（用户）：游戏模式单独成行、排第一；选中创造后"飞行"才在右边出现。
    if (this.actions.onSetGameMode && this.actions.gameMode) this.makeGameModeRow(gameOptions);
    this.makeToggle(gameOptions, 'daylightCycle', t('settings.row.daylightCycle'));
    this.makeToggle(gameOptions, 'showDebug', t('settings.row.showDebug'));
    // 界面语言（M8，批次 403）。放在"游戏"组最后一行：它跟难度/模式那种
    // "进去之前调一次"的东西同一性质，不值得单开一组（一组的行数掉到 1 行就该问
    // "它还算一个分类吗"——这条判据在 SETTING_GROUPS 的注释里）。
    // 选项 = "跟随系统" + **可选**的语言（有表或登记了加载器，多语言 P0-5/P0-7）。
    // `auto` 的标签要写出**这台设备上解析成什么**，否则玩家不知道"跟随系统"等于哪种语言。
    const languageOptions: readonly LanguageSetting[] = [AUTO_LANGUAGE, ...availableLanguages()];
    const languageLabels: Record<LanguageSetting, string> = {
      [AUTO_LANGUAGE]: tp('settings.language.autoWith', {
        language: LANGUAGE_NAMES[resolveLanguage(AUTO_LANGUAGE)],
      }),
      ...LANGUAGE_NAMES,
    };
    this.makeDropdown(
      gameOptions,
      t('settings.language'),
      languageOptions,
      languageLabels,
      () => this.draft.language,
      (next) => {
        // 语言同样走草稿：点了「保存」才落盘并重载（2026-10-28 的统一口径）。
        // 保存时如果语言真的变了，`saveActiveGroup()` 会整页重载——理由见
        // `bindLabel()` 的注释：局部重刷只能覆盖挂了 ref 的节点，物品名/生物名/
        // 成就/命令反馈都刷不到。
        this.draft.language = next;
      },
    );

    // 第二块：导入 / 导出这类动作，各占半行
    const gameActions = this.makeBlock(game);
    gameActions.appendChild(this.makeResourcePackRow());
    // 2026-10-28（用户）：详细说明收进「导入」右边那颗 ?（浮层，见 `openPackHelp()`）；
    // 行下只剩一句"只能导自己的包"的免责——这句不点也要看得见。
    gameActions.appendChild(this.makePackHint());
    // 诊断日志（批次 181）：平时常开、500KB 封顶；批次 220 起只留「导出」
    if (this.actions.onDiagnosticsExport) gameActions.appendChild(this.makeDiagnosticsRow());
    // 页签与内容裹一层：三端统一"左边一列页签 + 右边内容"（原版就是这样）。
    // 这一层留着是为了让"选项卡列"与"内容区"能各自独立收缩/滚动。
    const columns = document.createElement('div');
    columns.className = 'settings-columns';
    columns.append(tabs, body);

    /*
     * 页脚：**保存 + 恢复默认**（2026-10-28，用户）。
     *
     * 两条都只作用于**当前分组**（见 `SETTING_GROUP_KEYS`）：
     *  - 「保存」进页面时是灰的，改过任何一项才亮（提示"该落盘了"）；
     *  - 「恢复默认」把这一组的字段写回默认值，同样要点保存才生效。
     *
     * 位置仍在内容滚动区**之外**——滑到哪一页它都在屏幕下方，不用滚到底去找。
     */
    const footer = document.createElement('div');
    footer.className = 'settings-footer';
    this.footerEl = footer;

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.id = 'settings-save';
    saveButton.className = 'settings-save';
    saveButton.textContent = t('settings.save');
    saveButton.disabled = true;
    saveButton.addEventListener('click', () => this.saveActiveGroup());
    this.saveButton = saveButton;

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.id = 'settings-reset';
    resetButton.className = 'settings-reset';
    resetButton.textContent = t('settings.reset');
    resetButton.addEventListener('click', () => this.resetActiveGroup());
    footer.append(saveButton, resetButton);

    settingsPage.append(header, this.settingsHintEl, columns, footer);

    this.root.append(panel, modal);
    panel.append(menuPage, settingsPage);
    host.appendChild(this.root);

    // 下拉菜单的"点外面 / 滚动 / 转屏 / Esc"由 `Dropdown` 自己在展开期间挂监听；
    // 设置页只需要处理角色形象弹窗的 Esc。
    document.addEventListener('keydown', this.onDocumentKeyDown, true);

    this.applyActiveGroup(SETTING_GROUPS[0]);
    this.applyPage('menu');
    this.renderSubtitle();

    // ⚠️ 批次 111 删掉了"点空白处关闭"：用户要求"不要点击空白关闭，就用关闭按钮"。
    // 出口仍然齐全：暂停菜单页有「继续游戏」，设置页有「‹ 返回」，
    // 面板内每次只有一个出口，也就不会出现"手滑点到面板外把菜单关了"。
  }

  /** 建一页（`menu` / `settings`），登记到 `pages` 里 */
  private makePage(page: PausePage): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'pause-page';
    element.dataset.page = page;
    this.pages.set(page, element);
    return element;
  }

  /**
   * 统一的标题栏（批次 110）：**三列栅格**（左槽 | 标题 | 右槽），标题永远居中。
   *
   * 两页共用同一个骨架：暂停菜单页左槽是空的（那一页有"继续游戏"当出口，
   * 用户也说了"可能不需要关闭按钮"），设置页左槽是"‹ 返回"。
   * 于是切页时唯一会动的只有左槽那颗键，标题一个字都不会移位。
   *
   * @param titleEl   标题节点（外面建好传进来：`setTitle` 要能改它）
   * @param backLabel 左槽那颗"‹ 返回"的文案；传 `null` 就留一个空槽
   */
  private makeHeader(titleEl: HTMLElement, backLabel: string | null, onBack?: () => void): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'settings-header';

    const left = document.createElement('div');
    left.className = 'settings-header-slot';
    if (backLabel !== null) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'settings-back';
      back.textContent = backLabel;
      back.setAttribute('aria-label', t('settings.backLayer'));
      back.addEventListener('click', () => onBack?.());
      left.appendChild(back);
    }

    // 右槽永远是空占位：它的唯一作用是让标题保持在正中间
    const right = document.createElement('div');
    right.className = 'settings-header-slot';

    header.append(left, titleEl, right);
    return header;
  }

  /**
   * 切页：`menu`（暂停菜单）/ `settings`（设置项）。
   *
   * ⚠️ 从设置页往菜单页退时，如果有没保存的改动，先弹窗问一句
   * （2026-10-28，用户："在返回按钮或者切换设置项时，弹窗提醒是否保存"）。
   */
  setPage(page: PausePage): void {
    if (page !== this.currentPage && this.currentPage === 'settings' && this.hasUnsaved()) {
      this.askSave(() => this.applyPage(page));
      return;
    }
    this.applyPage(page);
  }

  /** 真正的切页（无询问版本；询问与初始化都走它） */
  private applyPage(page: PausePage): void {
    this.currentPage = page;
    this.panel.dataset.page = page;
    for (const [key, element] of this.pages) element.classList.toggle('active', key === page);
    // 弹窗只属于设置页；回菜单页时一起收起
    if (page !== 'settings') {
      this.closeAppearance();
      this.closePackHelp();
    }
    // 飞行状态是"实时"的（可能刚刚用双击跳跃切过），进设置页时对一次账
    if (page === 'settings' && this.flyingToggle) {
      this.controlSync.get(this.flyingToggle)?.();
    }
    // 切页时下拉菜单必须收起：它锚在上一页的按钮上
    this.closeDropdown();
    // 批次 333：设置页刚显示出来时补一帧形象
    if (page === 'settings') this.refreshAvatar();
  }

  /** 当前停在哪一页（验收脚本/调试用） */
  get page(): PausePage {
    return this.currentPage;
  }

  /**
   * 设置页左上角"‹ 返回"点了之后去哪儿。
   *
   * 游戏里 → 回暂停菜单页（面板还开着）；**从主菜单打开**时没有"暂停"可言，
   * 直接关掉面板（否则会看到一个标题写着"游戏已暂停"的菜单页——那是错的）。
   * 位置与外观不变，只是这一步的落点随上下文走。
   */
  private backFromSettings(): void {
    if (this.actions.onExitToMenu) this.setPage('menu');
    else this.actions.onResume();
  }

  /**
   * 退一层：在"设置"页 → 回暂停菜单（面板还开着）；在暂停菜单 → 调 `onResume`（真的关掉）。
   *
   * 返回"还开着吗"。Esc、Android 返回键、以及面板的关闭路径都只需要问这一句，
   * 不必各自去判断"现在停在哪一页"——**判据只有一处，就不会漂**。
   */
  goBack(): boolean {
    // 未保存提醒在最上面：Esc 等同「取消（不保存）」，然后继续它原本要做的事
    if (this.leaveAnswer) {
      this.leaveAnswer(false);
      return true;
    }
    // 浮层在最上面：先收它，再谈"设置页 / 菜单页"
    if (this.packHelpOpen) {
      this.closePackHelp();
      return true;
    }
    // 二级弹窗在最上面：先关它，再谈"设置页 / 菜单页"
    if (this.appearanceOpen) {
      this.closeAppearance();
      return true;
    }
    if (this.currentPage === 'settings') {
      // 游戏内：退到暂停菜单；主菜单进入：直接关设置，不能露出「游戏已暂停」。
      if (this.actions.onExitToMenu) {
        this.setPage('menu');
        return true;
      }
      this.actions.onResume();
      return false;
    }
    this.actions.onResume();
    return false;
  }

  /** 取某个分组的容器（设置项都往它里面塞） */
  private section(group: SettingGroup): HTMLElement {
    const element = this.sections.get(group);
    if (!element) throw new Error(tp('settings.groupUndefined', { group }));
    return element;
  }

  /**
   * 切到某个分组（页签）。
   *
   * 默认四组全都可见，所以这个调用平时只影响"矮屏上停在哪一页"；
   * 只有矮屏（横屏手机）由 CSS 只放行 `.settings-section.active` 那一组。
   */
  setActiveGroup(group: SettingGroup): void {
    // 换设置项（页签）时同样要问一句：否则另一页改了一半的配色会被静默丢掉
    if (group !== this.activeGroup && this.hasUnsaved()) {
      this.askSave(() => this.applyActiveGroup(group));
      return;
    }
    this.applyActiveGroup(group);
  }

  /** 真正的换页签（无询问版本） */
  private applyActiveGroup(group: SettingGroup): void {
    this.activeGroup = group;
    for (const [key, section] of this.sections) section.classList.toggle('active', key === group);
    // 切到别的页签时，二级弹窗 / 浮层都不该还浮在上面
    if (group !== 'appearance') this.closeAppearance();
    if (group !== 'game') this.closePackHelp();
    for (const [key, tab] of this.tabs) {
      const on = key === group;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-pressed', String(on));
    }
    // 切分组时收起下拉菜单（菜单锚在上一个分组的按钮上）
    this.closeDropdown();
    // 批次 333：形象画布只在真正显示外观页时才有尺寸，切回来要补一帧
    if (this.open && group === 'appearance') this.refreshAvatar();
    // 每一页的"保存"按钮各自判断脏不脏（换页之后要重算）
    this.updateSaveState();
  }

  /** 当前分组（验收脚本/调试用） */
  get activeSection(): SettingGroup {
    return this.activeGroup;
  }

  /** 分类标题（只在桌面端显示；手机端页签上已经写着组名） */
  private makeGroup(label: string): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'settings-group';
    group.textContent = label;
    return group;
  }

  // 批次 521：`makeNote`（"浅色说明"那行）随最后一条说明一起删掉了——
  // 视野上限收到 90° 之后，"手机视野上限 90°"与滑杆右端的读数重复。
  // 以后若又出现"真的有代价、需要解释"的设置项，可以从 git 历史里取回这个函数。

  /**
   * 设置分组里的一块（批次 335）：**同类控件聚在一起**，块内两列、块间一条细分隔线。
   *
   * 这样"开关/下拉"与"滑杆"不会交错排；每块自己用 auto-fit 栅格，
   * 宽屏两列、窄屏自动退回一列。
   */
  private makeBlock(host: HTMLElement): HTMLDivElement {
    const block = document.createElement('div');
    block.className = 'settings-block';
    host.appendChild(block);
    return block;
  }

  /**
   * 造一个滑块设置项。
   *
   * 读数一律是"控件值 + 单位"（`%` / `°` / 空）。批次 522 去掉了 `format` 回调：
   * 它只为"灵敏度 4（×1.00）"那一条存在，而用户要求那半句括号不要——
   * 留着一条永远没人传的可选参数，下次改的人还得先猜它有没有用。
   */
  private makeSlider(
    key: keyof GameSettings,
    label: string,
    unit: string,
    min: number,
    max: number,
    step: number,
    scale = 1,
  ): HTMLDivElement {
    // ⚠️ 行容器一律用 `<div>`：`<label>` 会把**点击整行**转发给里面的控件
    //（用户反馈："点按钮以外的区域，它依然会响按钮"）。滑块自己就是输入控件，
    // 不需要标签转发。
    const row = document.createElement('div');
    // 批次 335：滑杆也占半行（一个栅格），不再整行横跨；两列并排更整齐。
    row.className = 'settings-row slider';

    const name = document.createElement('span');
    name.textContent = label;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String((this.draft[key] as number) * scale);

    const readout = (): string => `${input.value}${unit}`;

    const value = document.createElement('i');
    value.textContent = readout();

    input.addEventListener('input', () => {
      const raw = Number(input.value) / scale;
      // 只写草稿：没点「保存」之前游戏里的一切都不变（2026-10-28，用户要求）
      (this.draft[key] as number) = raw;
      value.textContent = readout();
      this.updateSaveState();
    });

    // 恢复默认 / 重新打开面板时按**草稿**重画（见 `refreshers`）
    this.refreshers.push(() => {
      input.value = String((this.draft[key] as number) * scale);
      value.textContent = readout();
    });

    row.append(name, input, value);
    this.sliders.set(key, input);
    return row;
  }

  /**
   * 造一个**开关**行（批次 334，用户要求："只有两个选项的开关类，用 switch 组件"）。
   *
   * ⚠️ 行容器是 `<div>` 而不是 `<label>`：`<label>` 会把点击整行转发给里面的控件，
   * 表现就是"点按钮右边/标签文字也会触发按钮"。这里只有开关自己有 click 监听。
   *
   * @param read  读真实状态（飞行/游戏模式这类可能被外部改掉）
   * @param write 写状态（只负责改值，不 commit）
   */
  private makeSwitch(
    host: HTMLElement,
    label: string,
    read: () => boolean,
    write: () => void,
    /** 飞行这类"不写进设置"的开关传 false */
    commit = true,
  ): HTMLButtonElement {
    const row = document.createElement('div');
    // 两列：标签与开关紧挨着（用户："文字和它的开关挨得近一点"）
    row.className = 'settings-row pair';

    const name = document.createElement('span');
    name.textContent = label;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-switch';
    button.setAttribute('role', 'switch');
    const knob = document.createElement('span');
    knob.className = 'settings-switch-knob';
    knob.setAttribute('aria-hidden', 'true');
    button.appendChild(knob);

    const sync = (): void => {
      const on = read();
      button.setAttribute('aria-checked', String(on));
      button.classList.toggle('on', on);
    };
    button.addEventListener('click', () => {
      write();
      sync();
      // 飞行这类"世界状态"仍然立即生效（它不在这份偏好里）；真正的设置项只标脏
      if (commit) this.updateSaveState();
    });
    this.controlSync.set(button, sync);
    this.refreshers.push(sync);
    sync();

    row.append(name, button);
    host.appendChild(row);
    return button;
  }

  /**
   * 造一个**下拉按钮**行（批次 334；批次 528 换成共享的 `ui/Dropdown.ts`）。
   *
   * 样式与展开/收起/定位都在 `Dropdown` 里，设置页只负责"标签 + 控件"的排版，
   * 以及把 `read()` / `write()` 与 `GameSettings` 接起来。
   */
  private makeDropdown<T extends string>(
    host: HTMLElement,
    label: string,
    values: readonly T[],
    labels: Record<T, string>,
    read: () => T,
    write: (value: T) => void,
    /** 造好之后想拿到实例（极限模式要把"游戏模式"那颗锁死） */
    onCreate?: (control: Dropdown<T>) => void,
  ): HTMLButtonElement {
    const row = document.createElement('div');
    // 两列：标签与下拉紧挨着
    row.className = 'settings-row pair';

    const name = document.createElement('span');
    name.textContent = label;

    const control = new Dropdown<T>(values, labels, read(), (next) => {
      write(next);
      // 只标脏：保存按钮亮起，真正生效等玩家点「保存」
      this.updateSaveState();
    });
    this.dropdowns.push(control);
    onCreate?.(control);
    const sync = (): void => control.setValue(read());
    this.controlSync.set(control.button, sync);
    this.refreshers.push(sync);
    sync();

    // 两列就够（标签 | 下拉）；原来还多塞了一个空的 `<i>`，会在栅格里多占一行
    row.append(name, control.element);
    host.appendChild(row);
    return control.button;
  }

  /** 收起所有下拉菜单（点外面 / 滚动 / 转屏 / 切页都会调） */
  private closeDropdown(): void {
    for (const control of this.dropdowns) control.close();
  }

  /**
   * 「恢复默认」：把**当前分组**的字段写回默认值（2026-10-28，用户）。
   *
   * 只改草稿——控件立刻显示默认值，但真正生效要玩家再点「保存」。
   * 这样"恢复默认"和"手改"走同一条保存路径，不会出现"一部分已经生效、一部分还没"
   * 的半吊子状态。
   *
   * `viewDistance` 单独按设备给（见 `defaultViewDistanceFor`）：虽然界面上已经没有
   * 它的入口，但默认值仍要跟设备匹配（手机上 12 会一口气请求 489 个区块，见批次 202）。
   */
  resetActiveGroup(): void {
    const group = this.activeGroup;
    for (const key of SETTING_GROUP_KEYS[group]) {
      // 逐键赋值：`GameSettings[key]` 在联合键下会退化成 never，不能整体下标赋值
      (this.draft as unknown as Record<string, unknown>)[key] = (
        DEFAULT_SETTINGS as unknown as Record<string, unknown>
      )[key];
    }
    // 视距不在任何分组里，但恢复默认时仍要按设备口径落一次
    this.draft.viewDistance = defaultViewDistanceFor(isTouchUi());
    for (const refresh of this.refreshers) refresh();
    // 保存时要带 `reset` 标记：分辨率倍率 / 装饰层档位不在这份 settings 里，
    // 不带标记它们会永远停在"上一台机器扛不住"的那一档（批次 202 的坑）
    this.pendingResetGroups.add(group);
    this.updateSaveState();
    // 给一句确认：面板上没有独立 toast，借用设置页那行提示，2 秒后恢复原文
    this.settingsHintEl.textContent = t('settings.resetDone');
    window.setTimeout(() => this.renderSubtitle(), 2000);
  }

  /**
   * 角色形象预设（批次 279 → 296）：四颗按钮，点一下套用一整套外观。
   *
   * 高亮的是**反查结果**而不是"上次点了哪个"：手动改过任一项之后四颗全灭，
   * 就是"自定义"，不会出现"写着成年男性、实际是别的配色"这种谎。
   */
  private makePresetRow(host: HTMLElement): void {
    const row = document.createElement('div');
    row.className = 'appearance-presets';
    for (const [index, preset] of CHARACTER_PRESETS.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'appearance-preset';
      button.dataset.preset = preset.id;
      // 批次 20261024-0245：预设名走 `label.appearance.preset.*`
      button.textContent = t(`label.appearance.preset.${preset.id}`);
      button.addEventListener('click', () => {
        applyCharacterPreset(this.draft, index);
        // 其余外观行的按钮文字也要跟着变（发型/发色/胡须/眼型/体型/服装）
        for (const refresh of this.refreshers) refresh();
        this.updateSaveState();
      });
      this.presetButtons.push(button);
      row.appendChild(button);
    }
    host.appendChild(row);
    this.refreshPresetRow();
  }

  /** 手动改了任一外观项：四颗预设按钮按反查结果重新高亮（都不匹配 = 自定义） */
  private refreshPresetRow(): void {
    if (this.presetButtons.length === 0) return;
    const index = presetIndexOf(this.draft);
    this.presetButtons.forEach((button, i) => {
      const on = i === index;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    });
  }

  /** 打开角色形象二级弹窗（批次 528） */
  private openAppearance(): void {
    if (!this.appearanceModal || this.appearanceOpen) return;
    this.closeDropdown();
    this.appearanceOpen = true;
    this.appearanceModal.classList.remove('hidden');
    // 弹窗显示后画布才有尺寸；下一帧再画，否则 PlayerPreview3D 会按 0×0 建渲染器
    window.requestAnimationFrame(() => this.refreshAvatar());
  }

  /** 关闭角色形象二级弹窗 */
  private closeAppearance(): void {
    if (!this.appearanceOpen) return;
    this.appearanceOpen = false;
    this.avatarDrag = null;
    this.appearanceModal?.classList.add('hidden');
  }

  /**
   * 设置页的角色形象（批次 333）。
   *
   * 只展示**原始角色**：盔甲四件套与副手盾牌一律传空（用户明确要求），
   * 披风跟随外观开关。拖动旋转；「面部」视角把相机推到头部，方便调眼睛/胡须。
   *
   * WebGL 不可用时退回 2D 剪影（配色还能看），面板功能不受影响。
   */
  private refreshAvatar(): void {
    const canvas = this.avatarCanvas;
    if (!canvas) return;
    // 只在角色形象弹窗真正显示时创建/绘制：否则一打开暂停菜单就会白占一个
    // WebGL 上下文（手机上的上下文数量是有限资源），而且隐藏时画布尺寸为 0、画了也没用。
    if (!this.open || this.currentPage !== 'settings' || !this.appearanceOpen) return;
    const palette = paletteOf(this.draft);
    if (!this.avatar && !this.avatarFailed) {
      try {
        // 比背包更正一点的初始角度：设置页主要看脸
        this.avatar = new PlayerPreview3D(canvas, Math.PI - 0.18);
        this.avatar.setFocus(this.avatarFocus);
      } catch {
        this.avatarFailed = true;
      }
    }
    if (this.avatar) {
      this.avatar.setFocus(this.avatarFocus);
      this.avatar.update([null, null, null, null], this.draft.cape, null, palette);
      return;
    }
    drawPlayerPreview(
      canvas,
      { helmet: null, chest: null, legs: null, boots: null },
      null,
      96,
      palette,
    );
  }

  /** 画布上的拖动 = 转一圈（与背包预览同一套手感） */
  private bindAvatar(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (event) => {
      this.avatarDrag = { pointerId: event.pointerId, x: event.clientX };
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => {
      const drag = this.avatarDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.x;
      drag.x = event.clientX;
      this.avatar?.rotateBy(deltaX);
      event.preventDefault();
    });
    const end = (event: PointerEvent): void => {
      if (this.avatarDrag?.pointerId === event.pointerId) this.avatarDrag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
  }

  /** 「全身 / 面部」两颗按钮的高亮 */
  private applyFocusButtons(): void {
    for (const button of this.avatarFocusButtons) {
      const on = button.dataset.focus === this.avatarFocus;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  /**
   * 造一个循环切换的设置项（视角 / 粒子效果 / 触摸摇杆）。
   * 选项只有两三个，用循环按钮比下拉框直观，也才是原版的样子。
   */
  private makeSelect<T extends string>(
    options: HTMLElement,
    key:
      | 'cameraMode'
      | 'particles'
      | 'touchStick'
      | 'aimMode'
      | 'handedness'
      | 'maxFps'
      | 'autosaveSeconds'
      | 'skinTone'
      | 'shirtColor'
      | 'pantsColor'
      | 'hairColor'
      | 'hairStyle'
      | 'beard'
      | 'eyes'
      | 'eyeColor'
      | 'build'
      | 'frame',
    label: string,
    values: readonly T[],
    labels: Record<T, string>,
  ): HTMLButtonElement {
    return this.makeDropdown(
      options,
      label,
      values,
      labels,
      () => cycleValue(values, this.draft[key]) as T,
      (next) => this.assignSelectValue(key, next),
    );
  }

  /**
   * 把下拉选中的值写回 `GameSettings`。
   *
   * `GameSettings[key]` 在联合键下会退化成 never，直接下标赋值过不了类型检查，
   * 所以仍然逐个分支赋值；`cycleValue` 已保证字符串一定是合法档位。
   */
  private assignSelectValue(
    key:
      | 'cameraMode'
      | 'particles'
      | 'touchStick'
      | 'aimMode'
      | 'handedness'
      | 'maxFps'
      | 'autosaveSeconds'
      | 'skinTone'
      | 'shirtColor'
      | 'pantsColor'
      | 'hairColor'
      | 'hairStyle'
      | 'beard'
      | 'eyes'
      | 'eyeColor'
      | 'build'
      | 'frame',
    next: string,
  ): void {
    // ⚠️ 全部写**草稿**（`this.draft`）：这些值要等「保存」才拷回 `settings`
    if (key === 'cameraMode') this.draft.cameraMode = next as CameraMode;
    else if (key === 'particles') this.draft.particles = next as ParticleLevel;
    else if (key === 'aimMode') this.draft.aimMode = next as TouchAimMode;
    else if (key === 'handedness') this.draft.handedness = next as Handedness;
    else if (key === 'maxFps') this.draft.maxFps = Number(next);
    else if (key === 'autosaveSeconds') this.draft.autosaveSeconds = Number(next);
    else if (key === 'skinTone') this.draft.skinTone = Number(next);
    else if (key === 'shirtColor') this.draft.shirtColor = Number(next);
    else if (key === 'pantsColor') this.draft.pantsColor = Number(next);
    else if (key === 'hairColor') this.draft.hairColor = Number(next);
    else if (key === 'hairStyle') this.draft.hairStyle = Number(next);
    else if (key === 'beard') this.draft.beard = Number(next);
    else if (key === 'eyes') this.draft.eyes = Number(next);
    else if (key === 'eyeColor') this.draft.eyeColor = Number(next);
    else if (key === 'build') this.draft.build = Number(next);
    else if (key === 'frame') this.draft.frame = Number(next);
    else this.draft.touchStick = next as StickMode;
  }

  /**
   * 诊断日志（批次 181；批次 220 只留「导出」）。
   *
   * 读数与按钮挤在同一行：出事时玩家只记得"进设置点那个日志"，
   * 再分子菜单就又多一层找不到的入口。
   *
   * 为什么删掉另外两颗（用户："只保留那个导出按钮就可以了"）：
   *  - 「记录问题」只是往时间线里插一条要自己命名的 mark，而导出本来就从最早一条开始；
   *  - 「复制」产出的是可读时间线，但导出的 JSON 里每个会话都带同一份事件，
   *    AI 侧本来就要转成时间线再读。
   *   两颗按钮不提供额外能力，却让"出了问题该点哪个"变成一个选择。
   */
  private makeDiagnosticsRow(): HTMLElement {
    // 批次 335：从横跨整行的 diag-block 改成普通半行——标签 / 导出 / 读数
    const row = document.createElement('div');
    row.className = 'settings-row action';

    const title = document.createElement('span');
    title.textContent = t('settings.diagnostics');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-cycle';
    button.textContent = t('settings.export');
    button.title = t('settings.exportTitle');
    button.addEventListener('click', () => {
      button.blur(); // 手机上点完别一直保持「按下」态（行尾注释里不用英文引号，见 i18n 的字面量守卫）
      const ok = this.actions.onDiagnosticsExport?.() ?? false;
      this.refreshDiagnostics(t(ok ? 'settings.exported' : 'settings.exportFailed'));
    });

    const status = document.createElement('i');
    status.className = 'settings-status';
    this.diagnosticsStatusEl = status;

    row.append(title, button, status);
    this.refreshDiagnostics();
    return row;
  }

  /**
   * 刷新诊断入口上的读数。
   *
   * @param note 传了就临时显示这句话（"已导出"），否则显示条数/占用。
   */
  refreshDiagnostics(note?: string): void {
    const element = this.diagnosticsStatusEl;
    if (!element) return;
    const stats = this.actions.diagnosticsStats?.();
    if (!stats) {
      element.textContent = note ?? '';
      return;
    }
    const marked = stats.marked ? t('settings.exportMarked') : '';
    element.textContent = note ?? tp('settings.exportStats', { events: stats.events, kb: stats.kb, marked });
  }

  /** 资源包导入行（.mcpack / .zip） */
  private makeResourcePackRow(): HTMLElement {
    // 批次 335：原生文件框太宽，改成"半行 + 导入按钮 + 文件名"，与其它动作行一致
    const row = document.createElement('div');
    row.className = 'settings-row action';
    const name = document.createElement('span');
    name.textContent = t('settings.resourcePack');

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mcpack,.zip,application/zip';
    input.hidden = true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-cycle';
    button.textContent = t('settings.import');
    button.title = t('settings.importTitle');
    button.addEventListener('click', () => input.click());

    // 2026-10-28（用户）：使用说明收进「导入」右边这颗 ?，点了弹浮层；
    // 行里只留一句"只能用你自己的包"的免责，那一句必须不点也看得见。
    const help = document.createElement('button');
    help.type = 'button';
    help.className = 'settings-help';
    help.textContent = '?';
    help.title = t('settings.resourcePack.help');
    help.setAttribute('aria-label', t('settings.resourcePack.help'));
    help.addEventListener('click', () => this.openPackHelp());

    const status = document.createElement('i');
    status.className = 'settings-status';
    status.textContent = t('settings.notChosen');

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) {
        status.textContent = file.name;
        status.title = file.name;
        this.actions.onResourcePack?.(file);
      }
      // 清空 value：同一个文件再选一次也要能触发 change
      input.value = '';
    });

    row.append(name, button, help, status, input);
    return row;
  }

  /**
   * 资源包行的免责说明（批次 20261025-0117）。
   *
   * 单独一条而不是塞进行的 `title`：`title` 只有鼠标悬停才看得见，而这句话是**给审核与
   * 权利人看的**（"我们只让玩家导入自己的包"），必须在不交互时就可见。
   */
  private makePackHint(): HTMLElement {
    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent = t('settings.resourcePack.hint');
    return note;
  }

  /**
   * 资源包说明浮层（2026-10-28 第二次迭代，用户："说明应该是导入按钮右边一个小问号，
   * 点开浮层"）。
   *
   * 五+一条按"这是什么 → 怎么导入 → 贴图放哪 → 尺寸 → 音效 → 生效范围"排，
   * **每条都得与实现一致**（`core/resourcepack/ResourcePack.ts`）：
   *  - 只认 zip（stored / deflate），方块 PNG 按 `textures/blocks/<名>.png` 的**文件名**
   *    匹配图集里的 tile，名字对不上的跳过；
   *  - 图会被缩放到 16×16 的图集格子，所以大图不会更清晰；
   *  - 音效只认 `SoundPack.ts` 映射表里登记的那几族，其余忽略；
   *  - 包**不落盘**：只作用于这一次运行，重开页面要重新导入（没有任何持久化）。
   *
   * ⚠️ 文案里不许出现别的产品的名字、扩展名或"兼容某格式"的说法（用户明确要求
   * 界面文字不与任何其它产品挂钩）：这里只描述"压缩包里怎么摆文件，我们就怎么认"。
   */
  private openPackHelp(): void {
    if (!this.packHelpModal) this.buildPackHelpModal();
    if (this.packHelpOpen || !this.packHelpModal) return;
    this.closeDropdown();
    this.packHelpOpen = true;
    this.packHelpModal.classList.remove('hidden');
  }

  private closePackHelp(): void {
    if (!this.packHelpOpen) return;
    this.packHelpOpen = false;
    this.packHelpModal?.classList.add('hidden');
  }

  /** 浮层内容：标题 + 六条说明 + 一颗「知道了」 */
  private buildPackHelpModal(): void {
    const modal = document.createElement('div');
    modal.className = 'settings-modal hidden';

    const panel = document.createElement('div');
    panel.className = 'settings-modal-panel';

    const header = document.createElement('div');
    header.className = 'settings-modal-header';
    const title = document.createElement('b');
    title.textContent = t('settings.resourcePack.about');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'inv-close appearance-close';
    close.textContent = '✕';
    close.setAttribute('aria-label', t('settings.resourcePack.close'));
    close.addEventListener('click', () => this.closePackHelp());
    header.append(title, close);

    const body = document.createElement('div');
    body.className = 'settings-modal-body';
    const list = document.createElement('ul');
    list.className = 'settings-help-list';
    for (const key of [
      'settings.resourcePack.help1',
      'settings.resourcePack.help2',
      'settings.resourcePack.help3',
      'settings.resourcePack.help4',
      'settings.resourcePack.help5',
      'settings.resourcePack.help6',
    ]) {
      const item = document.createElement('li');
      item.textContent = t(key);
      list.appendChild(item);
    }
    body.appendChild(list);
    // 「知道了」放在**滚动区之外**：矮屏上正文要滚，但退出键必须一直看得见
    const foot = document.createElement('div');
    foot.className = 'settings-modal-foot';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'settings-help-ok';
    ok.textContent = t('settings.resourcePack.close');
    ok.addEventListener('click', () => this.closePackHelp());
    foot.appendChild(ok);
    panel.append(header, body, foot);
    modal.appendChild(panel);
    // 点浮层外的压暗区也关（与其它浮层一致）
    modal.addEventListener('click', (event) => {
      if (event.target === modal) this.closePackHelp();
    });

    this.packHelpModal = modal;
    this.root.appendChild(modal);
  }

  /**
   * "创造模式（飞行）"开关（批次 107）。
   *
   * ⚠️ 它**不是** `GameSettings` 里的一项：飞行是"当前世界里的状态"，而设置面板里
   * 其余各项都是"这台设备的偏好"（存 localStorage、换个世界也跟着走）。把它塞进
   * `saveSettings` 会让"上次开过飞行"这种临时状态跨世界粘住。所以它只在打开面板时
   * 按当前状态刷新、切一下立刻生效，不落盘。
   */
  private makeCreativeRow(host: HTMLElement): void {
    this.flyingToggle = this.makeSwitch(
      host,
      t('settings.row.flying'),
      () => this.actions.isFlying?.() ?? false,
      () => this.actions.onToggleFly?.(),
      // 飞行不写进 localStorage（见上面注释），所以切换后不必保存设置
      false,
    );
  }

  /**
   * "游戏模式 + 飞行"同一行（批次 528，用户要求）。
   *
   * 模式决定能力（免伤/瞬间破坏/无限物品），飞行只是创造里的一种移动方式。
   * 布局：第一行左半 = 游戏模式，右半 = 飞行；**只有创造模式才显示右半格**，
   * 生存模式下不会出现"生存也能飞"的误解。
   */
  private makeGameModeRow(host: HTMLElement): void {
    const row = document.createElement('div');
    row.className = 'settings-row mode';
    const modeCell = document.createElement('div');
    modeCell.className = 'mode-cell';
    const flyCell = document.createElement('div');
    flyCell.className = 'mode-cell';
    this.flyingCell = flyCell;

    // 四个模式全列出来（批次 20261024-1455；用户："他也没有把所有的模式都展示出来"）。
    // 回调按**选中的值**设，不再用无参 toggle——否则选"创造"时如果本来就在创造，
    // 会切去生存，看起来就是"真正切换的不是我选中的"。
    this.gameModeToggle = this.makeDropdown<GameMode>(
      modeCell,
      t('settings.row.gameMode'),
      GAME_MODES,
      Object.fromEntries(GAME_MODES.map((mode) => [mode, gameModeLabel(mode)])) as Record<GameMode, string>,
      () => this.actions.gameMode?.() ?? 'survival',
      (mode) => this.actions.onSetGameMode?.(mode),
      /*
       * 极限世界（2026-10-28）：模式是世界级硬约束，这里直接把下拉锁死。
       *
       * 只做 `setGameMode` 的守卫是不够的——玩家点开下拉、选中创造、结果什么都没发生，
       * 那种"点了没反应"比置灰更让人困惑（而且他会以为自己点错了）。
       */
      (control) => {
        if (!this.actions.gameModeLocked?.()) return;
        control.setDisabled(true);
        const note = document.createElement('p');
        note.className = 'settings-note';
        note.textContent = t('world.modeLocked');
        modeCell.appendChild(note);
      },
    );
    this.makeCreativeRow(flyCell);
    row.append(modeCell, flyCell);
    host.appendChild(row);
    this.refreshGameModeRows();
  }

  /** 打开面板 / 切模式之后，把两个开关的文案与显隐对齐真实状态 */
  refreshGameModeRows(): void {
    const mode = this.actions.gameMode?.() ?? 'survival';
    const locked = this.actions.gameModeLocked?.() === true;
    if (this.gameModeToggle) this.controlSync.get(this.gameModeToggle)?.();
    if (this.flyingToggle) this.controlSync.get(this.flyingToggle)?.();
    // 隐藏的是**右半格**，不是整行：左半的游戏模式永远都在
    // 极限世界连飞行也没有（模式锁生存，生存本来就不能飞）
    if (this.flyingCell) this.flyingCell.style.display = !locked && mode === 'creative' ? '' : 'none';
  }

  /** 造一个布尔开关（switch 组件；只有开关本身能点，整行不转发） */
  private makeToggle(options: HTMLElement, key: BoolSettingKey, label: string): HTMLButtonElement {
    return this.makeSwitch(
      options,
      label,
      () => this.draft[key],
      () => {
        this.draft[key] = !this.draft[key];
      },
    );
  }

  /**
   * 「保存」：把**当前分组**的草稿拷回主程序那份 `settings`，落盘并通知它生效。
   *
   * 只拷当前分组：另一页没保存的改动**不会**被顺手带上去——否则"我在音频页点了保存，
   * 结果外观页试了一半的配色也被写进去了"这种事一定会发生。
   */
  saveActiveGroup(): void {
    this.saveGroups([this.activeGroup]);
  }

  /**
   * 把指定的几组草稿拷回 `settings` 并落盘。
   *
   * 「保存」按钮传当前分组；未保存提醒弹窗里点「保存」传**所有脏分组**
   * （玩家可能在外观页改完又翻到音频页改了一点，退出时不该只存一半）。
   */
  private saveGroups(groups: readonly SettingGroup[]): void {
    const languageBefore = this.saved.language;
    let reset = false;
    for (const group of groups) {
      for (const key of SETTING_GROUP_KEYS[group]) {
        (this.settings as unknown as Record<string, unknown>)[key] = (
          this.draft as unknown as Record<string, unknown>
        )[key];
      }
      // 恢复默认要把"设备口径"的视距一起落（这一项没有界面入口，见 `defaultViewDistanceFor`）
      if (this.pendingResetGroups.delete(group)) {
        reset = true;
        this.settings.viewDistance = defaultViewDistanceFor(isTouchUi());
      }
    }
    this.saved = { ...this.settings };

    saveSettings(this.settings);
    this.actions.onChange(this.settings, reset ? { reset: true } : undefined);
    // 批次 333：形象与预设高亮按当前草稿重画
    this.refreshPresetRow();
    this.refreshAvatar();
    this.updateSaveState();
    this.settingsHintEl.textContent = t('settings.saved');
    window.setTimeout(() => this.renderSubtitle(), 1200);

    // 语言变了必须整页重载（多语言 P0-7：局部重刷覆盖不到物品名/成就/命令反馈）
    if (this.settings.language !== languageBefore) location.reload();
  }

  /** 某个分组有没有未保存的改动 */
  private isGroupDirty(group: SettingGroup): boolean {
    for (const key of SETTING_GROUP_KEYS[group]) {
      if ((this.draft as unknown as Record<string, unknown>)[key] !== (this.saved as unknown as Record<string, unknown>)[key]) {
        return true;
      }
    }
    return false;
  }

  /** 有没有任何一页脏了（返回 / 关闭面板时用来决定要不要提醒） */
  hasUnsaved(): boolean {
    return SETTING_GROUPS.some((group) => this.isGroupDirty(group));
  }

  /** 保存按钮的亮/灰（只有当前页改过才亮），页脚顺便挂一个 `.dirty` 提示 */
  private updateSaveState(): void {
    const dirty = this.isGroupDirty(this.activeGroup);
    if (this.saveButton) this.saveButton.disabled = !dirty;
    this.footerEl?.classList.toggle('dirty', dirty);
  }

  /** 按草稿重画所有控件（打开面板 / 恢复默认 / 放弃改动之后） */
  private refreshControls(): void {
    for (const refresh of this.refreshers) refresh();
    this.refreshPresetRow();
    this.refreshAvatar();
    this.updateSaveState();
  }

  /**
   * 丢掉草稿：回到"已保存的那一份"。
   *
   * 用在「取消（不保存）」与每次重新打开面板时——草稿是这一次编辑的临时纸，
   * 不改主程序那份设置，所以"不保存"只是把纸揉了。
   */
  discardDraft(): void {
    this.draft = { ...this.settings };
    this.saved = { ...this.settings };
    this.pendingResetGroups.clear();
    this.refreshControls();
  }

  /**
   * 有未保存改动时先问一句，答完再执行原来的动作（2026-10-28，用户）。
   *
   * 两个出口，与用户描述的一一对应：
   *  - 「保存」= 把**所有脏分组**落盘，然后照常退出 / 切换；
   *  - 「取消」= 不保存，直接退出 / 切换（草稿丢掉，已保存的设置一字不动）。
   *
   * 没有脏改动时**不弹**：直接执行，别把正常操作也变成一次点击。
   */
  private askSave(action: () => void): void {
    if (!this.hasUnsaved()) {
      action();
      return;
    }
    this.closeLeaveDialog();
    this.closeDropdown();

    const overlay = document.createElement('div');
    overlay.className = 'settings-confirm';
    const panel = document.createElement('div');
    panel.className = 'settings-confirm-panel';

    const title = document.createElement('b');
    title.className = 'settings-confirm-title';
    title.textContent = t('settings.unsavedTitle');
    const text = document.createElement('p');
    text.className = 'settings-confirm-text';
    text.textContent = t('settings.unsavedText');

    const actions = document.createElement('div');
    actions.className = 'settings-confirm-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.id = 'settings-unsaved-cancel';
    cancel.textContent = t('settings.discard');
    const save = document.createElement('button');
    save.type = 'button';
    save.id = 'settings-unsaved-save';
    save.className = 'settings-confirm-save';
    save.textContent = t('settings.save');
    actions.append(cancel, save);
    panel.append(title, text, actions);
    overlay.appendChild(panel);
    this.root.appendChild(overlay);
    this.leaveDialog = overlay;

    let settled = false;
    const finish = (doSave: boolean): void => {
      if (settled) return;
      settled = true;
      this.closeLeaveDialog();
      if (doSave) this.saveGroups(SETTING_GROUPS.filter((group) => this.isGroupDirty(group)));
      else this.discardDraft();
      action();
    };
    this.leaveAnswer = finish;
    cancel.addEventListener('click', () => finish(false));
    save.addEventListener('click', () => finish(true));
  }

  /** 收起未保存提醒（答完之后 / 重新弹之前） */
  private closeLeaveDialog(): void {
    this.leaveAnswer = null;
    this.leaveDialog?.remove();
    this.leaveDialog = null;
  }

  /**
   * 改标题与"继续游戏"那颗按钮的文字：同一个面板在"游戏中"与"主菜单"两处用，文案要跟着场景变。
   *
   * 批次 20261024-1152：**副标题参数去掉了**——暂停页那行"点「继续游戏」或系统返回键返回"
   * 按用户要求整块删除，只剩设置页标题与按钮文案需要按场景改。
   * @param resumeLabel "继续游戏"那行按钮的文字（主菜单里改成"返回"更贴切）
   */
  setTitle(title: string, resumeLabel = t('pause.resume')): void {
    this.settingsTitleEl.textContent = title;
    this.resumeButton.textContent = resumeLabel;
  }

  /**
   * 设置页那句提示（"改动立即生效"）。
   *
   * 渲染时机放在 `show()` 而不是构造那一刻：`<body class="touch-mode">` 是
   * 触摸操作层建立时挂上的，比这个面板**晚**（主菜单里那个设置面板更晚）。
   * 批次 20261024-1152：暂停页那句触摸/键盘提示随副标题一起删了，这里只剩设置页这一句。
   */
  private renderSubtitle(): void {
    // 批次 335：设置页只留一句"改动立即生效"——返回按钮与 Esc 本来就看得见/试得到
    this.settingsHintEl.textContent = t('settings.hintApplies');
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * 打开面板。
   *
   * 默认进"暂停菜单"那页；**从主菜单打开时**（没给 `onExitToMenu`，也就是没有当前世界）
   * 直接进"设置"页——那个场景下没有"暂停"可言。
   */
  show(page?: PausePage): void {
    this.open = true;
    // 上一次关面板的"淡出后隐藏"可能还在等（130ms 内又打开了）：取消掉，
    // 否则它会把刚打开的面板重新 `.hidden` 掉。
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.root.classList.remove('closing');
    // 每次打开都从"已保存的那一份"重新开一张草稿：上一次没保存的改动不该带进这一次
    //（玩家点「取消」离开时也是这条路径，见 `T8` 的未保存提醒）
    this.draft = { ...this.settings };
    this.saved = { ...this.settings };
    this.pendingResetGroups.clear();
    this.renderSubtitle();
    this.refreshControls();
    this.applyPage(page ?? (this.actions.onExitToMenu ? 'menu' : 'settings'));
    this.root.classList.remove('hidden');
    // 批次 333：面板可见之后形象画布才有尺寸，补一帧（隐藏期间 render 会直接返回）
    this.refreshAvatar();
    // 批次 213：标记"暂停界面开着"。
    // 掉出全屏时"请横屏游玩"（z-index 90）会**盖在**暂停菜单（50）上面：
    // 先让游戏暂停，再让玩家看到横屏提示；点一下转横屏后提示消失，正好看到暂停页。
    document.body.classList.add('pause-open');
    // 日志条数每次打开都会变，进来时对一次账
    this.refreshDiagnostics();
    // 模式可能被 /gamemode 或主菜单改过：两个开关按真实状态回填
    this.refreshGameModeRows();
  }

  /**
   * 关面板（批次 231：**淡出 130ms 后才 `display:none`**）。
   *
   * 为什么不能同步隐藏：`closeSettings()` 会在同一个 tick 里把触摸操作层叫回来。
   * "同一帧拆掉一整层 + 建回一整层"会让浏览器重算触摸坐标映射，于是下一次
   * `pointerdown` 的 `clientX/Y` 被报成 0,0——玩家看到的就是"从暂停回来第一次
   * 滑动卡住"。背包一直是"滑出动画结束才 hidden"，所以开关背包反而没事。
   *
   * 时序对齐背包：面板先继续画几帧，触摸层先回来并被画出来，再摘面板。
   */
  hide(): void {
    // 有没保存的改动：先问（用户要求"返回/退出时弹窗提醒是否保存"）
    if (this.open && this.hasUnsaved()) {
      this.askSave(() => this.forceHide());
      return;
    }
    this.forceHide();
  }

  /** 真正收起面板（不问保存） */
  private forceHide(): void {
    this.open = false;
    this.closeAppearance();
    this.closePackHelp();
    // 下拉菜单挂在 body 上，面板关掉时必须一起收起（否则会孤零零留在页面上）
    this.closeDropdown();
    document.body.classList.remove('pause-open');
    // 已经在等 / 没显示：不重复排计时器
    if (this.hideTimer !== null) return;
    if (!this.root.isConnected || this.root.classList.contains('hidden')) return;
    this.root.classList.add('closing');
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      // 这 130ms 里又打开了 → 不能再藏起来
      if (this.open) return;
      this.root.classList.add('hidden');
      this.root.classList.remove('closing');
    }, SETTINGS_FADE_MS);
  }

  /** 主菜单设置是懒建的临时实例；进世界前销毁，避免与局内面板重复 `#settings-screen`。 */
  destroy(): void {
    this.open = false;
    this.closeLeaveDialog();
    this.closeAppearance();
    this.closePackHelp();
    this.packHelpModal = null;
    this.appearanceModal = null;
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    // 批次 333：形象自带一台 WebGL 渲染器，销毁面板时要一起释放
    this.avatar?.dispose();
    this.avatar = null;
    this.avatarFailed = false;
    // 下拉控件：关闭并摘掉挂在 body 上的菜单
    for (const control of this.dropdowns) control.dispose();
    this.dropdowns.length = 0;
    document.removeEventListener('keydown', this.onDocumentKeyDown, true);
    this.root.remove();
    document.body.classList.remove('pause-open');
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  /** 当前设置（只读快照，调试接口用） */
  snapshot(): GameSettings {
    return { ...this.settings };
  }
}
