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

import { CAMERA_MODES, CAMERA_MODE_LABELS, type CameraMode } from '../core/viewMode.ts';
import { GAME_MODE_LABELS, type GameMode } from '../core/world/GameMode.ts';
import { FOV_MIN, MOBILE_VIEW_DISTANCE_MAX, fovCapFor } from '../core/world/PerfPolicy.ts';
import {
  HANDEDNESS_LABELS,
  HANDEDNESS_MODES,
  STICK_MODES,
  STICK_MODE_LABELS,
  isTouchUi,
  type Handedness,
  type StickMode,
} from './TouchControls.ts';
import {
  DEFAULT_APPEARANCE,
  PANTS_COLORS,
  PANTS_COLOR_LABELS,
  SHIRT_COLORS,
  SHIRT_COLOR_LABELS,
  SKIN_TONES,
  SKIN_TONE_LABELS,
  appearanceIndex,
} from '../game/appearance.ts';

/**
 * 粒子效果强度。
 * 手机上粒子是最容易把帧率吃掉的项（一次破坏就要生成十几个四边形），
 * 所以做成三档而不是简单的开关：`reduced` 仍然看得见碎屑，只是少一半。
 */
export type ParticleLevel = 'off' | 'reduced' | 'all';

/** 帧率上限的可选值（批次 130）：0 = 不限 */
export const FPS_CAPS: readonly number[] = [0, 30, 60];
export const FPS_CAP_LABELS: Record<string, string> = { '0': '不限', '30': '30 帧', '60': '60 帧' };

export const PARTICLE_LEVELS: readonly ParticleLevel[] = ['off', 'reduced', 'all'];

export const PARTICLE_LEVEL_LABELS: Record<ParticleLevel, string> = {
  off: '关闭',
  reduced: '减少',
  all: '全部',
};

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
 * 灵敏度档位（批次 271，用户要求）：0~8，**4 是正中间**（= 1×）。
 *
 * 以前存的是 0.5~4 的倍率（默认 1），滑块两头手感不对称：往左只能减半，
 * 往右能翻四倍。改成档位后两边对称：每两档翻一倍，0=0.25×、4=1×、8=4×。
 * `sensitivityGain()` 是唯一的换算出处，鼠标/触摸/手柄三条路径都读它。
 */
export const SENSITIVITY_MIN = 0;
export const SENSITIVITY_MAX = 8;
export const SENSITIVITY_DEFAULT = 4;

/** 档位 → 视角倍率（4 → 1×；每 2 档翻一倍） */
export function sensitivityGain(level: number): number {
  const clamped = Math.min(
    SENSITIVITY_MAX,
    Math.max(SENSITIVITY_MIN, Number.isFinite(level) ? level : SENSITIVITY_DEFAULT),
  );
  return 2 ** ((clamped - SENSITIVITY_DEFAULT) / 2);
}

/** 旧存档里的倍率 → 新档位（0.5→2、1→4、2→6、4→8），用于设置迁移 */
export function sensitivityLevelFromGain(gain: number): number {
  const clamped = Math.min(4, Math.max(0.5, Number.isFinite(gain) ? gain : 1));
  const level = Math.round(SENSITIVITY_DEFAULT + 2 * Math.log2(clamped));
  return Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, level));
}

/**
 * 触摸端的瞄准方式（批次 271，用户要求）。
 *  - `finger`：手指落点决定目标（批次 239 起的默认）；
 *  - `center`：屏幕中央的准星决定目标（批次 239 之前的老方式）。
 */
export type TouchAimMode = 'finger' | 'center';
export const TOUCH_AIM_MODES: readonly TouchAimMode[] = ['finger', 'center'];
export const TOUCH_AIM_MODE_LABELS: Record<TouchAimMode, string> = {
  finger: '手指瞄准（默认）',
  center: '屏幕中心',
};

/**
 * 设置格式版本（批次 271）。
 *
 * 版本 1 = 灵敏度存的是 0.5~4 的倍率；版本 2 = 灵敏度存 0~8 的档位。
 * **必须显式存版本**：老默认值 1 在新口径里是"档位 1"，直接 clamp 会把
 * 所有老玩家的灵敏度从 1× 悄悄降到 0.7×。
 */
export const SETTINGS_VERSION = 2;

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
export const SETTING_GROUPS = ['appearance', 'controls', 'sound', 'game'] as const;

export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * 分组中文名。
 *
 * ⚠️ 批次 203 起**没有「视频」组了**：视距 / 自适应分辨率 / 自适应视距 / 天气效果
 * 四行删掉之后，那一组只剩一个「视野」，于是并进「控制」。
 * 判断标准：**一组的行数掉到 1~2 行时就该问"它还算一个分类吗"**——
 * 一个只为一行设置的页签，在手机上等于多一次点击。
 */
export const SETTING_GROUP_LABELS: Record<SettingGroup, string> = {
  appearance: '外观',
  controls: '控制',
  sound: '音频',
  game: '游戏',
};

/** 自动保存间隔的可选值（秒，批次 172 / TASKS M20）：不提供"关闭"，避免丢档 */
export const AUTOSAVE_OPTIONS: readonly number[] = [30, 60, 120];
export const AUTOSAVE_LABELS: Record<string, string> = { '30': '30 秒', '60': '60 秒', '120': '120 秒' };

/** 布尔型设置项（开关那种），单独取个名字给 makeToggle 用 */
type BoolSettingKey =
  | 'clouds'
  | 'invertY'
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
  /** 视距（区块）：4~16。影响流式加载范围与雾的远近 */
  viewDistance: number;
  /** 视野角度（度）：60~110 */
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
  /** 视角灵敏度档位：0~8，4 = 1×（见 `sensitivityGain`） */
  sensitivity: number;
  /** 触摸端瞄准方式（批次 271）：手指落点 / 屏幕中心 */
  aimMode: TouchAimMode;
  /** 左右手模式（批次 271）：摇杆在左 / 摇杆在右 */
  handedness: Handedness;
  /** 角色外观（批次 187）：都是**档位下标**，见 `game/appearance.ts` */
  skinTone: number;
  shirtColor: number;
  pantsColor: number;
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
  /** 反转视角的上下方向（触摸拖动与鼠标都受影响） */
  invertY: boolean;
  /** 昼夜循环：关掉之后时间停在当前时刻（截图对比、搭建筑时很好用） */
  daylightCycle: boolean;
  /** 是否显示左上角调试信息（HUD） */
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
  viewDistance: 12,
  fov: 72,
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
  brightness: 1,
  cameraMode: 'first',
  particles: 'all',
  clouds: true,
  cape: false,
  weatherEffects: true,
  autosaveSeconds: 30,
  autoJump: true,
  fastEat: true,
  invertY: false,
  daylightCycle: true,
  showDebug: true,
  adaptiveViewDistance: true,
  adaptiveResolution: true,
  maxFps: 0,
  touchStick: 'fixed',
  touchScale: 1,
};

const STORAGE_KEY = 'bedrock-settings';

/**
 * 这台设备的**视距上限**（批次 202 引入，批次 203 改语义）。
 *
 * ⚠️ 这里必须按设备分开，不能直接用 `DEFAULT_SETTINGS.viewDistance`：
 *  - 那个 12 是**桌面**默认值；手机上限是 `MOBILE_VIEW_DISTANCE_MAX`（8）；
 *  - 批次 202 之前"恢复默认"把 12 原样写回去，手机上等于一次性请求 489 个区块
 *    （`World.update` 在半径 12 下的候选圈；半径 8 是 225 个）——体感就是"恢复默认反而更卡"。
 *
 * 批次 203 起玩家**已经没有视距滑块**，所以这个函数返回的是"自适应策略允许涨到哪"：
 * 桌面上就是 12（`DEFAULT_SETTINGS`），手机上是 8。开局仍然只有
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
    // 版本 1 的灵敏度是 0.5~4 的倍率（默认 1）；版本 2 是 0~8 的档位（默认 4）
    const storedVersion = typeof parsed.settingsVersion === 'number' ? parsed.settingsVersion : 1;
    const sensitivity =
      storedVersion >= SETTINGS_VERSION
        ? Math.round(clampNumber(parsed.sensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX, SENSITIVITY_DEFAULT))
        : sensitivityLevelFromGain(clampNumber(parsed.sensitivity, 0.5, 4, 1));
    return {
      settingsVersion: SETTINGS_VERSION,
      viewDistance: clampNumber(parsed.viewDistance, 4, 16, DEFAULT_SETTINGS.viewDistance),
      fov: clampNumber(parsed.fov, 60, 110, DEFAULT_SETTINGS.fov),
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
      invertY: parsed.invertY === true,
      daylightCycle: parsed.daylightCycle !== false,
      showDebug: parsed.showDebug !== false,
      adaptiveViewDistance: parsed.adaptiveViewDistance !== false,
      adaptiveResolution: parsed.adaptiveResolution !== false,
      maxFps: FPS_CAPS.includes(parsed.maxFps as number) ? (parsed.maxFps as number) : DEFAULT_SETTINGS.maxFps,
      touchStick: STICK_MODES.includes(parsed.touchStick as StickMode)
        ? (parsed.touchStick as StickMode)
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
   * 全屏 / 横屏（批次 181）。
   *
   * 浏览器的全屏必须由用户手势触发，所以"自动全屏"只能做到"第一次交互时补上"。
   * 这一行是**手动兜底**：被系统踢出全屏、或第一次手势错过了，还能在这里补。
   */
  onToggleFullscreen?: () => void;
  isFullscreen?: () => boolean;
  /**
   * 游戏模式（批次 181）：生存 ↔ 创造。
   *
   * 这是**唯一的模式入口**（新建世界时也能选）；双击跳跃只负责在创造模式里起降，
   * 不再顺带切模式。
   */
  onToggleGameMode?: () => void;
  gameMode?: () => GameMode;
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
  private readonly metaEl: HTMLDivElement;
  /** 设置页的标题（`setTitle` 改的是它：主菜单里打开时是"设置"） */
  private readonly settingsTitleEl: HTMLElement;
  /** 暂停菜单那句提示（触摸端换成不含键盘的说法） */
  private readonly menuHintEl: HTMLElement;
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
  /** 副标题原文：触摸端不显示"按 Esc 继续游戏"这类键盘提示，所以原文留着、渲染时再决定 */
  private subtitleText = '按 Esc 继续游戏';
  /** "飞行"那个开关（非持久设置，见 `makeCreativeRow`；只在创造模式里显示） */
  private flyingToggle: HTMLButtonElement | null = null;
  /** "游戏模式"那个开关（生存 ↔ 创造） */
  private gameModeToggle: HTMLButtonElement | null = null;
  /** 诊断日志那一行的状态文字（条数 / 占用 / 是否打过点） */
  private diagnosticsStatusEl: HTMLDivElement | null = null;
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
    const menuPage = this.makePage('menu');

    // 左槽留空（这一页没有"上一层"可回），标题仍然在正中间——
    // 与设置页共用同一个三列骨架，切页时标题不会移位。
    const menuTitle = document.createElement('b');
    menuTitle.className = 'settings-title';
    menuTitle.textContent = '游戏已暂停';
    const menuHeader = this.makeHeader(menuTitle, null);

    this.menuHintEl = document.createElement('div');
    this.menuHintEl.className = 'settings-hint';

    const actionsRow = document.createElement('div');
    actionsRow.className = 'pause-actions';

    this.resumeButton = document.createElement('button');
    this.resumeButton.type = 'button';
    this.resumeButton.id = 'pause-resume';
    this.resumeButton.className = 'pause-action primary';
    this.resumeButton.textContent = '继续游戏';
    this.resumeButton.addEventListener('click', () => this.actions.onResume());

    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.id = 'pause-settings';
    settingsButton.className = 'pause-action';
    settingsButton.textContent = '设置';
    settingsButton.addEventListener('click', () => this.setPage('settings'));

    // 成就 / 进度（M7）：原版基岩版的暂停菜单里就有这一项
    const achievements = document.createElement('button');
    achievements.type = 'button';
    achievements.id = 'pause-achievements';
    achievements.className = 'pause-action';
    achievements.textContent = '成就';
    achievements.addEventListener('click', () => this.actions.onOpenAdvancements?.());
    achievements.style.display = this.actions.onOpenAdvancements ? '' : 'none';

    // 用户点名的"保存档退出"：退出前主程序会落一次盘（`exitToMenu` 里已经这么做了）
    const exitToMenu = document.createElement('button');
    exitToMenu.type = 'button';
    exitToMenu.id = 'pause-exit';
    exitToMenu.className = 'pause-action';
    exitToMenu.textContent = '保存并退出到主菜单';
    exitToMenu.addEventListener('click', () => this.actions.onExitToMenu?.());

    // "退出"只在游戏里有意义；主菜单打开这个面板时（没有当前世界）就藏起来。
    // 删除世界只放在世界列表：原生基岩版暂停菜单也不会把不可逆删除混进日常按钮。
    // ⚠️ 用 style.display 而不是 .hidden 类：`.hidden` 只对面板根节点写了样式，
    // 加在按钮上没有任何效果。
    if (!this.actions.onExitToMenu) exitToMenu.style.display = 'none';

    actionsRow.append(this.resumeButton, settingsButton, achievements, exitToMenu);

    this.metaEl = document.createElement('div');
    this.metaEl.className = 'settings-hint settings-meta';

    // 按键 / 手势说明（批次 111）：原来它挂在"点击进入游戏"那层遮罩上，
    // 遮罩按用户要求删掉之后搬到这里——按 Esc（或点顶部的暂停键）就能查，
    // 而且不再挡着"进去就是世界"这一步。两段按设备切换（`body.touch-mode`）。
    const help = document.createElement('div');
    help.className = 'pause-help';
    const keys = document.createElement('div');
    keys.className = 'desktop-only';
    keys.innerHTML =
      '<kbd>WASD</kbd> 移动 · <kbd>Space</kbd> 跳跃 · <kbd>Shift</kbd> 潜行/下降 · <kbd>Ctrl</kbd> 疾跑<br />' +
      '<kbd>左键</kbd> 破坏 · <kbd>右键</kbd> 放置 · <kbd>1-9</kbd> 换方块 · <kbd>F</kbd> 飞行 · ' +
      '<kbd>V</kbd> 视角 · <kbd>Esc/E</kbd> 菜单与背包';
    const gestures = document.createElement('div');
    gestures.className = 'touch-only';
    gestures.innerHTML =
      '左摇杆移动 · 拖动转视角 · 轻点放置 · 长按破坏<br />' +
      '右下角是跳跃与潜行 · 背包在快捷栏右边、聊天在顶部<br />' +
      '双击跳跃起飞（创造模式）· 视角与飞行在「设置」里';
    help.append(keys, gestures);

    menuPage.append(menuHeader, this.menuHintEl, actionsRow, this.metaEl, help);

    // ================================================================ ② 设置页
    const settingsPage = this.makePage('settings');

    // 左上角"‹ 返回"：从暂停菜单进来时回菜单页；从**主菜单**进来时没有菜单页可回，
    // 那就等于关闭面板（位置与外观仍然统一——用户要的就是"统一"）。
    this.settingsTitleEl = document.createElement('b');
    this.settingsTitleEl.className = 'settings-title';
    this.settingsTitleEl.textContent = '设置';
    const header = this.makeHeader(this.settingsTitleEl, '‹ 返回', () => this.backFromSettings());

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
      tab.textContent = SETTING_GROUP_LABELS[group];
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
      section.appendChild(this.makeGroup(SETTING_GROUP_LABELS[group]));
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

    // ---- 外观（批次 187）：肤色 / 上衣 / 裤子 / 披风
    //
    // 用户："想创建角色、把他搞得漂亮一点"。这里先给**档位**而不是自由取色
    //（模型是方块拼的，自由取色很容易调成一坨），改完第三人称与背包 3D 预览同时生效。
    const appearance = this.section('appearance');
    // 场景亮度（批次 220，用户要求）：户外看不清屏幕时就靠它把画面提亮。
    // 50%~200%，100% 等于不动——**不改光照本身**，只改屏幕这一层（见 `applySceneBrightness`）。
    appearance.append(
      this.makeSlider('brightness', '场景亮度', '%', BRIGHTNESS_MIN * 100, BRIGHTNESS_MAX * 100, 5, 100),
    );
    this.makeSelect(
      appearance,
      'skinTone',
      '肤色',
      SKIN_TONES.map((_, i) => String(i)),
      Object.fromEntries(SKIN_TONE_LABELS.map((label, i) => [String(i), label])),
    );
    this.makeSelect(
      appearance,
      'shirtColor',
      '上衣',
      SHIRT_COLORS.map((_, i) => String(i)),
      Object.fromEntries(SHIRT_COLOR_LABELS.map((label, i) => [String(i), label])),
    );
    this.makeSelect(
      appearance,
      'pantsColor',
      '裤子',
      PANTS_COLORS.map((_, i) => String(i)),
      Object.fromEntries(PANTS_COLOR_LABELS.map((label, i) => [String(i), label])),
    );
    this.makeToggle(appearance, 'cape', '披风');

    const controls = this.section('controls');
    // 全屏 / 横屏（批次 181）：手动兜底。放在最上面——"屏幕不对"时玩家第一个找的就是它
    if (this.actions.onToggleFullscreen && this.actions.isFullscreen) {
      controls.appendChild(this.makeFullscreenRow());
    }
    this.makeSelect(controls, 'cameraMode', '视角', CAMERA_MODES, CAMERA_MODE_LABELS);
    // 视野（批次 203 从「视频」组搬来）：晕动症的人会往小调，习惯广角的人会往大调，
    // 只有玩家自己知道——所以它留着（原版也只有这一个视野滑块）。
    // ⚠️ 但它**有代价**（批次 215）：72°→110° 时水平可视范围约翻倍（≈1.97×），
    // 视锥里的区块网格与三角形跟着翻，而自适应管不到 FOV → 手机上封 90° 并说明一次。
    controls.append(
      this.makeSlider('fov', '视野', '°', FOV_MIN, fovCapFor(isTouchUi()), 1),
    );
    if (isTouchUi()) {
      this.makeNote(controls, `视野越大，同屏要画的方块越多；手机上最多 ${fovCapFor(true)}°`);
    }
    // 左右手模式（批次 271，用户要求）：左手模式把摇杆整个挪到右侧
    this.makeSelect(controls, 'handedness', '左右手模式', HANDEDNESS_MODES, HANDEDNESS_LABELS);
    // 瞄准方式（批次 271，用户要求）：默认手指落点；可选回老的屏幕中心准星
    this.makeSelect(controls, 'aimMode', '瞄准方式', TOUCH_AIM_MODES, TOUCH_AIM_MODE_LABELS);
    // 触摸摇杆（批次 96）：手机上"手往哪搁"这件事因人而异，所以给两档自己挑
    this.makeSelect(controls, 'touchStick', '触摸摇杆', STICK_MODES, STICK_MODE_LABELS);
    // 触摸按钮大小（批次 97）：手机上线 44px 只是下限，多大才顺手因人而异
    controls.append(this.makeSlider('touchScale', '触摸按钮大小', '%', TOUCH_SCALE_MIN * 100, TOUCH_SCALE_MAX * 100, 5, 100));
    // 灵敏度（批次 271）：0~8 档，4 是正中间（= 1×），两边对称
    controls.append(
      this.makeSlider(
        'sensitivity',
        '灵敏度',
        '',
        SENSITIVITY_MIN,
        SENSITIVITY_MAX,
        1,
        1,
        (level) => `${level}（×${sensitivityGain(level).toFixed(2)}）`,
      ),
    );
    this.makeNote(controls, '4 是正中间（×1.00）；0 最慢、8 最快');
    this.makeToggle(controls, 'invertY', '反转上下视角');
    // 自动跳跃（批次 206）：手机上一边推摇杆一边点跳跃很别扭，默认开；
    // 但它会让"贴着一格高的墙走"变成自己往上跳，有人不喜欢，所以给开关。
    this.makeToggle(controls, 'autoJump', '自动跳跃');
    // 快速进食（批次 219）：1.0 秒 vs 原版的 1.6 秒。触摸端没有使用键，
    // 进食只能借用"按住不动"（100ms），比破坏用的长按判定（400ms）快，
    // 但原版 1.6 秒在手机上仍然偏磨，所以默认开；想完全对齐原版节奏就关掉。
    this.makeToggle(controls, 'fastEat', '快速进食（1 秒）');

    const sound = this.section('sound');
    sound.append(this.makeSlider('volume', '音量', '%', 0, 100, 1, 100));
    // 分组音量（批次 178，M20 最后一项）：主音量下面四条，各自 0~100%
    sound.append(this.makeSlider('volumeBlocks', '方块音效', '%', 0, 100, 1, 100));
    sound.append(this.makeSlider('volumeMobs', '生物音效', '%', 0, 100, 1, 100));
    sound.append(this.makeSlider('volumePlayer', '玩家音效', '%', 0, 100, 1, 100));
    sound.append(this.makeSlider('volumeUi', '界面与环境', '%', 0, 100, 1, 100));
    // 批次 233：雨声与背景音乐各自一组（原版也是分开的：天气 / 音乐）
    sound.append(this.makeSlider('volumeAmbient', '环境音（雨声）', '%', 0, 100, 1, 100));
    sound.append(this.makeSlider('volumeMusic', '背景音乐', '%', 0, 100, 1, 100));

    const game = this.section('game');
    this.makeToggle(game, 'daylightCycle', '昼夜循环');
    this.makeToggle(game, 'showDebug', '调试信息');
    // 自动保存间隔（批次 172，M20）：大世界保存那一下会有卡顿，间隔是可调的
    this.makeSelect(game, 'autosaveSeconds', '自动保存', AUTOSAVE_OPTIONS.map(String), AUTOSAVE_LABELS);
    // 游戏模式（批次 181）：生存 ↔ 创造。这是唯一的模式入口。
    if (this.actions.onToggleGameMode && this.actions.gameMode) this.makeGameModeRow();
    // 飞行：只在创造模式里显示（由 `refreshGameModeRows()` 控制显隐）
    if (this.actions.onToggleFly && this.actions.isFlying) this.makeCreativeRow();
    game.appendChild(this.makeResourcePackRow());
    // 诊断日志（批次 181）：平时常开、500KB 封顶；批次 220 起这里只留「导出」
    if (this.actions.onDiagnosticsExport) game.appendChild(this.makeDiagnosticsRow());
    // 恢复默认（批次 185，用户要求）：一行一颗键，放在"游戏"组最下面——
    // 它影响的是**所有**分组，所以不塞进任何一组，而是整页的最后一个动作。
    const resetRow = document.createElement('div');
    resetRow.className = 'settings-row wide settings-reset-row';
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.id = 'settings-reset';
    resetButton.className = 'settings-reset';
    resetButton.textContent = '恢复默认设置';
    resetButton.addEventListener('click', () => this.resetDefaults());
    resetRow.appendChild(resetButton);
    game.appendChild(resetRow);

    // 页签与内容裹一层：三端统一"左边一列页签 + 右边内容"（原版就是这样）。
    // 这一层留着是为了让"选项卡列"与"内容区"能各自独立收缩/滚动。
    const columns = document.createElement('div');
    columns.className = 'settings-columns';
    columns.append(tabs, body);

    settingsPage.append(header, this.settingsHintEl, columns);

    this.root.append(panel);
    panel.append(menuPage, settingsPage);
    host.appendChild(this.root);

    this.setActiveGroup(SETTING_GROUPS[0]);
    this.setPage('menu');
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
      back.setAttribute('aria-label', '返回上一层');
      back.addEventListener('click', () => onBack?.());
      left.appendChild(back);
    }

    // 右槽永远是空占位：它的唯一作用是让标题保持在正中间
    const right = document.createElement('div');
    right.className = 'settings-header-slot';

    header.append(left, titleEl, right);
    return header;
  }

  /** 切页：`menu`（暂停菜单）/ `settings`（设置项） */
  setPage(page: PausePage): void {
    this.currentPage = page;
    this.panel.dataset.page = page;
    for (const [key, element] of this.pages) element.classList.toggle('active', key === page);
    // 飞行状态是"实时"的（可能刚刚用双击跳跃切过），进设置页时对一次账
    if (page === 'settings' && this.flyingToggle) {
      this.flyingToggle.textContent = SettingsScreen.onOff(this.actions.isFlying?.() ?? false);
    }
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
    if (!element) throw new Error(`未定义的分组：${group}`);
    return element;
  }

  /**
   * 切到某个分组（页签）。
   *
   * 默认四组全都可见，所以这个调用平时只影响"矮屏上停在哪一页"；
   * 只有矮屏（横屏手机）由 CSS 只放行 `.settings-section.active` 那一组。
   */
  setActiveGroup(group: SettingGroup): void {
    this.activeGroup = group;
    for (const [key, section] of this.sections) section.classList.toggle('active', key === group);
    for (const [key, tab] of this.tabs) {
      const on = key === group;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-pressed', String(on));
    }
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

  /**
   * 一行浅色说明（批次 215）。
   *
   * 与开关/滑块不同，它不可点、不占控件位置，只回答"为什么这么定"——
   * 用户的原话是"给一点提示，可能会影响性能，会好一点"。所以只在**真的有代价**
   * 的那一项下面出现，不做成通用帮助文本（那会变成噪音）。
   */
  private makeNote(host: HTMLElement, text: string): HTMLDivElement {
    const note = document.createElement('div');
    note.className = 'settings-note';
    note.textContent = text;
    host.appendChild(note);
    return note;
  }

  /** 造一个滑块设置项 */
  private makeSlider(
    key: keyof GameSettings,
    label: string,
    unit: string,
    min: number,
    max: number,
    step: number,
    scale = 1,
    format?: (value: number) => string,
  ): HTMLLabelElement {
    const row = document.createElement('label');
    // `.wide` = 跨满两列（批次 167）：分组现在是两列栅格，滑杆压到半栏就只剩百来像素，
    // 拖起来很别扭；而开关/选择那类"很短"的项正好两两并排。
    row.className = 'settings-row wide';

    const name = document.createElement('span');
    name.textContent = label;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String((this.settings[key] as number) * scale);

    const readout = (): string => {
      const raw = Number(input.value) / scale;
      return format ? format(raw) : `${input.value}${unit}`;
    };

    const value = document.createElement('i');
    value.textContent = readout();

    input.addEventListener('input', () => {
      const raw = Number(input.value) / scale;
      (this.settings[key] as number) = raw;
      value.textContent = readout();
      this.commit();
    });

    // 恢复默认时按 settings 重画（见 `refreshers`）
    this.refreshers.push(() => {
      input.value = String((this.settings[key] as number) * scale);
      value.textContent = readout();
    });

    row.append(name, input, value);
    this.sliders.set(key, input);
    return row;
  }

  /**
   * 造一个原版的"循环切换"行（批次 109）。
   *
   * ⚠️ 基岩版的设置界面里**没有下拉框、也没有复选框**：所有"几个选项里挑一个"的
   * 设置项都是同一颗灰按钮，点一下换下一个值（显示成 `‹ 中 ›`），布尔项就是 `开 / 关`。
   * 这不是我们的发明——用户点名要"跟他做的一模一样"，而且它顺带省掉了手机上
   * "点开下拉框、再点一个选项"那一步（原生 `<select>` 在手机上还是系统弹层，
   * 完全无法做像素风）。
   *
   * @param read   当前值 → 按钮上显示的文字
   * @param cycle  点一下 → 换到下一个值，返回新的显示文字
   */
  private makeCycleRow(host: HTMLElement, label: string, read: () => string, cycle: () => string): HTMLButtonElement {
    const row = document.createElement('label');
    row.className = 'settings-row';

    const name = document.createElement('span');
    name.textContent = label;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-cycle';
    button.textContent = read();
    button.addEventListener('click', () => {
      button.textContent = cycle();
    });
    // 恢复默认时按 settings 重画（见 `refreshers`）
    this.refreshers.push(() => {
      button.textContent = read();
    });

    row.append(name, button);
    host.appendChild(row);
    return button;
  }

  /**
   * 一键恢复默认（批次 185，用户要求；批次 202 修了三处"恢复了但没生效"）。
   *
   * `Object.assign` 而不是 `this.settings = {...DEFAULT}`：主程序握着同一个对象引用
   * （`loadSettings()` 的结果直接传进构造函数），换引用会让"改设置立即生效"断掉。
   *
   * 批次 202 的三处修正（真机反馈："恢复默认都没用"）：
   *  1. **视距按设备给默认值**（见 `defaultViewDistanceFor`）：手机上回落到 12 只会更卡；
   *  2. **带 `reset` 标记通知主程序**：分辨率倍率 / 装饰层档位不在这份 settings 里，
   *     不带标记的话它们会永远停在"上一台机器扛不住"的那一档；
   *  3. **同时清掉运行时那份"降级记忆"**（由 `main.applySettings` 完成）。
   */
  resetDefaults(): void {
    // 先按设备决定视距，再整体覆盖：`Object.assign` 后者覆盖前者，顺序不能反
    Object.assign(this.settings, DEFAULT_SETTINGS, { viewDistance: defaultViewDistanceFor(isTouchUi()) });
    for (const refresh of this.refreshers) refresh();
    this.commit(true);
    // 给一句确认：面板上没有独立的 toast，借用设置页那行提示，2 秒后恢复原文
    this.settingsHintEl.textContent = '已恢复默认设置';
    window.setTimeout(() => this.renderSubtitle(), 2000);
  }

  /** 布尔项的按钮文字：原版就是写"开 / 关"两个字 */
  private static onOff(value: boolean): string {
    return value ? '‹ 开 ›' : '‹ 关 ›';
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
      | 'pantsColor',
    label: string,
    values: readonly T[],
    labels: Record<T, string>,
  ): HTMLButtonElement {
    const current = (): T => cycleValue(values, this.settings[key]) as T;
    return this.makeCycleRow(
      options,
      label,
      () => `‹ ${labels[current()]} ›`,
      () => {
        const next = nextCycleValue(values, this.settings[key]) as T;
        // 逐个分支赋值：`GameSettings[key]` 在联合键下会退化成 never，直接下标赋值过不了类型检查
        if (key === 'cameraMode') this.settings.cameraMode = next as CameraMode;
        else if (key === 'particles') this.settings.particles = next as ParticleLevel;
        // 瞄准方式 / 左右手（批次 271）：循环行按字符串走，字段本身就是字符串联合
        else if (key === 'aimMode') this.settings.aimMode = next as TouchAimMode;
        else if (key === 'handedness') this.settings.handedness = next as Handedness;
        // 帧率上限是**数字**（0/30/60），但选择行按字符串循环（见上面 `FPS_CAP_LABELS`）
        else if (key === 'maxFps') this.settings.maxFps = Number(next);
        // 自动保存间隔同理（`AUTOSAVE_OPTIONS` 是秒数）
        else if (key === 'autosaveSeconds') this.settings.autosaveSeconds = Number(next);
        // 外观档位（批次 187）：循环行按字符串走，存回数字下标
        else if (key === 'skinTone') this.settings.skinTone = Number(next);
        else if (key === 'shirtColor') this.settings.shirtColor = Number(next);
        else if (key === 'pantsColor') this.settings.pantsColor = Number(next);
        else this.settings.touchStick = next as StickMode;
        this.commit();
        return `‹ ${labels[next]} ›`;
      },
    );
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
    const block = document.createElement('div');
    block.className = 'diag-block';

    const title = document.createElement('span');
    title.className = 'diag-title';
    title.textContent = '诊断日志';

    const status = document.createElement('div');
    status.className = 'diag-status';
    this.diagnosticsStatusEl = status;

    const actions = document.createElement('div');
    actions.className = 'diag-actions';

    const make = (label: string, hint: string, run: () => void): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-cycle diag-button';
      button.textContent = label;
      button.title = hint;
      button.addEventListener('click', () => {
        button.blur(); // 手机上点完别一直保持"按下"态
        run();
      });
      actions.appendChild(button);
    };

    if (this.actions.onDiagnosticsExport) {
      make('导出', '下载 JSON（含最近两次会话，最多 500KB）', () => {
        const ok = this.actions.onDiagnosticsExport?.() ?? false;
        this.refreshDiagnostics(ok ? '已导出' : '导出失败');
      });
    }

    block.append(title, status, actions);
    this.refreshDiagnostics();
    return block;
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
    const marked = stats.marked ? ' · 已打点' : '';
    element.textContent = note ?? `${stats.events} 条 · ${stats.kb}KB / 500KB${marked}`;
  }

  /**
   * 全屏 / 横屏行（批次 181）。
   *
   * 与其它循环按钮的区别：`requestFullscreen()` 是异步的，点完立刻读状态还是旧值，
   * 所以这里点完延后一点再回填文案；不然玩家会看到"点了没反应"。
   */
  private makeFullscreenRow(): HTMLElement {
    const row = document.createElement('label');
    row.className = 'settings-row';

    const name = document.createElement('span');
    name.textContent = '全屏 / 横屏';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-cycle';
    const read = (): string => (this.actions.isFullscreen?.() ? '‹ 已全屏 ›' : '‹ 进入全屏 ›');
    button.textContent = read();
    button.addEventListener('click', () => {
      this.actions.onToggleFullscreen?.();
      // 全屏 Promise 完成后再回填；400ms 足够浏览器走完过渡，也不会让玩家等太久
      window.setTimeout(() => {
        button.textContent = read();
      }, 400);
    });

    row.append(name, button);
    return row;
  }

  /** 资源包导入行（.mcpack / .zip） */
  private makeResourcePackRow(): HTMLElement {
    const row = document.createElement('label');
    // 文件选择框本身就宽，与滑杆一样跨满两列
    row.className = 'settings-row wide';
    const name = document.createElement('span');
    name.textContent = '资源包';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mcpack,.zip,application/zip';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) this.actions.onResourcePack?.(file);
      // 清空 value：同一个文件再选一次也要能触发 change
      input.value = '';
    });

    const hint = document.createElement('i');
    hint.textContent = 'mcpack';
    row.append(name, input, hint);
    return row;
  }

  /**
   * "创造模式（飞行）"开关（批次 107）。
   *
   * ⚠️ 它**不是** `GameSettings` 里的一项：飞行是"当前世界里的状态"，而设置面板里
   * 其余各项都是"这台设备的偏好"（存 localStorage、换个世界也跟着走）。把它塞进
   * `saveSettings` 会让"上次开过飞行"这种临时状态跨世界粘住。所以它只在打开面板时
   * 按当前状态刷新、切一下立刻生效，不落盘。
   */
  private makeCreativeRow(): void {
    this.flyingToggle = this.makeCycleRow(
      this.section('game'),
      '飞行',
      () => SettingsScreen.onOff(this.actions.isFlying?.() ?? false),
      () => {
        this.actions.onToggleFly?.();
        // 以真实状态为准回填（切换可能被拒绝/立刻被别的逻辑改回去）
        return SettingsScreen.onOff(this.actions.isFlying?.() ?? false);
      },
    );
  }

  /**
   * "游戏模式"开关（批次 181）。
   *
   * 与"飞行"分成两行：模式决定能力（免伤/瞬间破坏/无限物品），飞行只是创造里的一种移动方式。
   * 生存模式下"飞行"那一行会整行隐藏，否则玩家会以为生存也能飞。
   */
  private makeGameModeRow(): void {
    this.gameModeToggle = this.makeCycleRow(
      this.section('game'),
      '游戏模式',
      () => `‹ ${GAME_MODE_LABELS[this.actions.gameMode?.() ?? 'survival']} ›`,
      () => {
        this.actions.onToggleGameMode?.();
        const mode = this.actions.gameMode?.() ?? 'survival';
        this.refreshGameModeRows();
        return `‹ ${GAME_MODE_LABELS[mode]} ›`;
      },
    );
  }

  /** 打开面板 / 切模式之后，把两个开关的文案与显隐对齐真实状态 */
  refreshGameModeRows(): void {
    const mode = this.actions.gameMode?.() ?? 'survival';
    if (this.gameModeToggle) this.gameModeToggle.textContent = `‹ ${GAME_MODE_LABELS[mode]} ›`;
    if (this.flyingToggle) {
      this.flyingToggle.textContent = SettingsScreen.onOff(this.actions.isFlying?.() ?? false);
      const row = this.flyingToggle.closest<HTMLElement>('.settings-row');
      if (row) row.style.display = mode === 'creative' ? '' : 'none';
    }
  }

  /** 造一个开关设置项（原版形态：一颗"‹ 开 ›/‹ 关 ›"的灰按钮，点一下切换） */
  private makeToggle(options: HTMLElement, key: BoolSettingKey, label: string): HTMLButtonElement {
    return this.makeCycleRow(
      options,
      label,
      () => SettingsScreen.onOff(this.settings[key]),
      () => {
        this.settings[key] = !this.settings[key];
        this.commit();
        return SettingsScreen.onOff(this.settings[key]);
      },
    );
  }

  private commit(reset = false): void {
    saveSettings(this.settings);
    this.actions.onChange(this.settings, reset ? { reset: true } : undefined);
  }

  /** 存档信息（打开时刷新） */
  setMeta(text: string): void {
    this.metaEl.textContent = text;
  }

  /**
   * 改标题与副标题：同一个面板在"游戏中"与"主菜单"两处用，文案要跟着场景变。
   * @param resumeLabel "继续游戏"那行按钮的文字（主菜单里改成"返回"更贴切）
   */
  setTitle(title: string, subtitle: string, resumeLabel = '继续游戏'): void {
    this.settingsTitleEl.textContent = title;
    this.subtitleText = subtitle;
    this.resumeButton.textContent = resumeLabel;
    this.renderSubtitle();
  }

  /**
   * 两句提示各管一页：暂停菜单那页说"怎么继续游戏"，设置页那页说"改动立即生效、怎么回去"。
   * 触摸端一律换成不含键盘的说法（批次 104：手机上没有 Esc，"按 Esc"只会让人
   * 去找一个不存在的键）。
   *
   * 渲染时机放在 `show()` 而不是构造那一刻：`<body class="touch-mode">` 是
   * 触摸操作层建立时挂上的，比这个面板**晚**（主菜单里那个设置面板更晚）。
   */
  private renderSubtitle(): void {
    const touch = isTouchUi();
    this.menuHintEl.textContent = touch
      ? `点「${this.resumeButton.textContent ?? '继续游戏'}」或系统返回键返回`
      : this.subtitleText;
    this.settingsHintEl.textContent = touch ? '改动立即生效 · 点 ‹ 返回 回菜单' : '改动立即生效 · 按 Esc 返回菜单';
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
    this.renderSubtitle();
    this.setPage(page ?? (this.actions.onExitToMenu ? 'menu' : 'settings'));
    this.root.classList.remove('hidden');
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
    this.open = false;
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
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
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
