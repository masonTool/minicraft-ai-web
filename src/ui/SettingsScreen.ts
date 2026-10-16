/**
 * 设置与暂停菜单（K3）
 *
 * 一个面板承担两件事：**暂停菜单**（继续 / 设置 / 存档信息 / 新世界）
 * 与**设置项**（视距 / 视野 / 音量 / 灵敏度 / 调试信息）。
 * 合成一个面板而不是两个：手机屏幕小，弹出两层界面既挡视野又难返回。
 *
 * 设置存在 localStorage 里（与 K1 的世界存档分开）：
 * 设置是"这台设备的偏好"，换世界也不该丢；而世界存档属于某个种子。
 */

import { CAMERA_MODES, CAMERA_MODE_LABELS, type CameraMode } from '../core/viewMode.ts';
import { STICK_MODES, STICK_MODE_LABELS, isTouchUi, type StickMode } from './TouchControls.ts';

/**
 * 粒子效果强度。
 * 手机上粒子是最容易把帧率吃掉的项（一次破坏就要生成十几个四边形），
 * 所以做成三档而不是简单的开关：`reduced` 仍然看得见碎屑，只是少一半。
 */
export type ParticleLevel = 'off' | 'reduced' | 'all';

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
 * 设置项的分组（批次 104）。
 *
 * 分组不只是排版：**手机上它就是页签**——一次只显示一组，每组不超过 4 行，
 * 于是整个"设置"一屏放得下、**不用滚**。原来 11 个设置项排成一长条，
 * 手机上要滚三屏才看得到"音量"（用户反馈的正是这件事；基岩版手机也是分页的）。
 * 桌面端不显示页签，四组按原来的样子连着列出来（宽屏一屏放得下，不需要多一层点击）。
 */
export const SETTING_GROUPS = ['graphics', 'controls', 'sound', 'game'] as const;

export type SettingGroup = (typeof SETTING_GROUPS)[number];

export const SETTING_GROUP_LABELS: Record<SettingGroup, string> = {
  graphics: '图形',
  controls: '操作',
  sound: '声音',
  game: '游戏',
};

/** 布尔型设置项（开关那种），单独取个名字给 makeToggle 用 */
type BoolSettingKey = 'clouds' | 'invertY' | 'daylightCycle' | 'showDebug' | 'adaptiveViewDistance';

export interface GameSettings {
  /** 视距（区块）：4~16。影响流式加载范围与雾的远近 */
  viewDistance: number;
  /** 视野角度（度）：60~110 */
  fov: number;
  /** 音量 0~1（K5 的音效会用） */
  volume: number;
  /** 鼠标/触摸灵敏度倍率：0.5~2 */
  sensitivity: number;
  /** 视角模式：第一人称 / 第三人称背后 / 第三人称正面（`V` 键循环切换） */
  cameraMode: CameraMode;
  /** 粒子效果强度：`off` 完全关闭、`reduced` 减半、`all` 全开（低配设备/手机省电用） */
  particles: ParticleLevel;
  /** 是否显示云（关掉能省一点填充率，也能看清远处地形） */
  clouds: boolean;
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
  viewDistance: 12,
  fov: 72,
  volume: 0.7,
  sensitivity: 1,
  cameraMode: 'first',
  particles: 'all',
  clouds: true,
  invertY: false,
  daylightCycle: true,
  showDebug: true,
  adaptiveViewDistance: true,
  touchStick: 'fixed',
  touchScale: 1,
};

const STORAGE_KEY = 'bedrock-settings';

/** 从 localStorage 读取设置（缺字段或损坏时回退默认值） */
export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      viewDistance: clampNumber(parsed.viewDistance, 4, 16, DEFAULT_SETTINGS.viewDistance),
      fov: clampNumber(parsed.fov, 60, 110, DEFAULT_SETTINGS.fov),
      volume: clampNumber(parsed.volume, 0, 1, DEFAULT_SETTINGS.volume),
      sensitivity: clampNumber(parsed.sensitivity, 0.5, 2, DEFAULT_SETTINGS.sensitivity),
      cameraMode: CAMERA_MODES.includes(parsed.cameraMode as CameraMode)
        ? (parsed.cameraMode as CameraMode)
        : DEFAULT_SETTINGS.cameraMode,
      particles: PARTICLE_LEVELS.includes(parsed.particles as ParticleLevel)
        ? (parsed.particles as ParticleLevel)
        : DEFAULT_SETTINGS.particles,
      clouds: parsed.clouds !== false,
      invertY: parsed.invertY === true,
      daylightCycle: parsed.daylightCycle !== false,
      showDebug: parsed.showDebug !== false,
      adaptiveViewDistance: parsed.adaptiveViewDistance !== false,
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

export interface SettingsActions {
  /** 继续游戏（关闭面板） */
  onResume: () => void;
  /** 保存并回到主菜单（世界列表）；只应该在游戏里提供——主菜单里没有"当前世界" */
  onExitToMenu?: () => void;
  /** 删除当前世界（含存档）并回到主菜单；同上 */
  onDeleteWorld?: () => void;
  /** 设置变化：立即生效（视距/视野/调试信息都要马上看到效果） */
  onChange: (settings: GameSettings) => void;
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
}

export class SettingsScreen {
  readonly root: HTMLDivElement;
  private open = false;
  private readonly sliders = new Map<keyof GameSettings, HTMLInputElement>();
  private readonly metaEl: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  /** 一个分组 = 一个 section；手机端一次只显示一个（见 `setActiveGroup`） */
  private readonly sections = new Map<SettingGroup, HTMLElement>();
  private readonly tabs = new Map<SettingGroup, HTMLButtonElement>();
  /** 当前页签（手机端生效；桌面端四组全显示，这个值只是"下次打开停在哪一页"） */
  private activeGroup: SettingGroup = SETTING_GROUPS[0];
  /** 副标题原文：触摸端不显示"按 Esc 继续游戏"这类键盘提示，所以原文留着、渲染时再决定 */
  private subtitleText = '按 Esc 继续游戏';
  /** "创造模式（飞行）"那个开关（非持久设置，见 `makeCreativeRow`） */
  private flyingToggle: HTMLInputElement | null = null;

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

    // ---- 标题栏：标题 + 副标题 + 关闭 ✕
    const header = document.createElement('div');
    header.className = 'settings-header';

    this.titleEl = document.createElement('b');
    this.titleEl.textContent = '设置与暂停';

    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'settings-hint';

    // 右上角的 ✕（批次 104）：手机上既没有 Esc、也没地方点"空白"（面板是整屏的），
    // 玩家需要一个"看得见就知道能关"的出口。形状与配方书、成就面板统一。
    this.closeButton = document.createElement('button');
    this.closeButton.type = 'button';
    this.closeButton.className = 'settings-close';
    this.closeButton.textContent = '✕';
    this.closeButton.setAttribute('aria-label', '关闭设置');
    this.closeButton.addEventListener('click', () => this.actions.onResume());

    header.append(this.titleEl, this.subtitleEl, this.closeButton);

    // ---- 分组页签（手机端显示，桌面端由 CSS 隐藏）
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

    // ---- 操作按钮
    const buttons = document.createElement('div');
    buttons.className = 'settings-buttons';

    this.resumeButton = document.createElement('button');
    this.resumeButton.type = 'button';
    this.resumeButton.textContent = '继续游戏';
    this.resumeButton.addEventListener('click', () => this.actions.onResume());

    const exitToMenu = document.createElement('button');
    exitToMenu.type = 'button';
    exitToMenu.textContent = '保存并回到主菜单';

    const deleteWorld = document.createElement('button');
    deleteWorld.type = 'button';
    deleteWorld.className = 'danger';
    deleteWorld.textContent = '删除本世界';
    deleteWorld.addEventListener('click', () => {
      if (confirm('确定要删除这个世界吗？存档会一起删掉，无法恢复。')) this.actions.onDeleteWorld?.();
    });

    // 成就 / 进度（M7）：原版基岩版的暂停菜单里就有这一项，放在"继续游戏"后面
    const achievements = document.createElement('button');
    achievements.type = 'button';
    achievements.textContent = '成就';
    achievements.addEventListener('click', () => this.actions.onOpenAdvancements?.());
    achievements.style.display = this.actions.onOpenAdvancements ? '' : 'none';

    buttons.append(this.resumeButton, achievements, exitToMenu, deleteWorld);
    exitToMenu.addEventListener('click', () => this.actions.onExitToMenu?.());
    // "回到主菜单/删除世界"只在游戏里有意义；主菜单打开这个面板时（没有当前世界）就藏起来。
    // ⚠️ 用 style.display 而不是 .hidden 类：`.hidden` 只对面板根节点写了样式，加在按钮上没有任何效果。
    if (!this.actions.onExitToMenu) exitToMenu.style.display = 'none';
    if (!this.actions.onDeleteWorld) deleteWorld.style.display = 'none';

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

    const graphics = this.section('graphics');
    graphics.append(
      this.makeSlider('viewDistance', '视距', ' 区块', 4, 16, 1),
      this.makeSlider('fov', '视野', '°', 60, 110, 1),
    );
    this.makeToggle(graphics, 'clouds', '云');
    this.makeToggle(graphics, 'adaptiveViewDistance', '自适应视距');
    this.makeSelect(graphics, 'particles', '粒子效果', PARTICLE_LEVELS, PARTICLE_LEVEL_LABELS);

    const controls = this.section('controls');
    this.makeSelect(controls, 'cameraMode', '视角', CAMERA_MODES, CAMERA_MODE_LABELS);
    // 触摸摇杆（批次 96）：手机上"手往哪搁"这件事因人而异，所以给两档自己挑
    this.makeSelect(controls, 'touchStick', '触摸摇杆', STICK_MODES, STICK_MODE_LABELS);
    // 触摸按钮大小（批次 97）：手机上线 44px 只是下限，多大才顺手因人而异
    controls.append(this.makeSlider('touchScale', '触摸按钮大小', '%', TOUCH_SCALE_MIN * 100, TOUCH_SCALE_MAX * 100, 5, 100));
    controls.append(this.makeSlider('sensitivity', '灵敏度', '×', 0.5, 2, 0.05));
    this.makeToggle(controls, 'invertY', '反转上下视角');

    const sound = this.section('sound');
    sound.append(this.makeSlider('volume', '音量', '%', 0, 100, 1, 100));

    const game = this.section('game');
    this.makeToggle(game, 'daylightCycle', '昼夜循环');
    this.makeToggle(game, 'showDebug', '调试信息');
    // 创造模式（飞行）：手机端右下那一簇精简之后，这是唯一的**显式**开关
    //（双击跳跃仍然能用，那是手势）
    if (this.actions.onToggleFly && this.actions.isFlying) this.makeCreativeRow();
    game.appendChild(this.makeResourcePackRow());

    this.metaEl = document.createElement('div');
    this.metaEl.className = 'settings-hint settings-meta';

    this.root.append(panel);
    panel.append(header, tabs, body, buttons, this.metaEl);
    host.appendChild(this.root);

    this.setActiveGroup(SETTING_GROUPS[0]);
    this.renderSubtitle();

    // 点面板外的区域 = 继续游戏（与原版"点空白关闭"一致）。
    // ⚠️ 这条只对桌面生效：触摸端面板是整屏的（`body.touch-mode`），没有"外面"可点。
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.actions.onResume();
    });
  }

  /** 取某个分组的容器（设置项都往它里面塞） */
  private section(group: SettingGroup): HTMLElement {
    const element = this.sections.get(group);
    if (!element) throw new Error(`未定义的分组：${group}`);
    return element;
  }

  /**
   * 切到某个分组。
   *
   * 桌面端四组全都可见，所以这个调用在桌面上只影响"下次打开停在哪一页"；
   * 手机上由 CSS 只放行 `.settings-section.active` 那一组——一次一屏，不用滚。
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

  /** 造一个滑块设置项 */
  private makeSlider(
    key: keyof GameSettings,
    label: string,
    unit: string,
    min: number,
    max: number,
    step: number,
    scale = 1,
  ): HTMLLabelElement {
    const row = document.createElement('label');
    row.className = 'settings-row';

    const name = document.createElement('span');
    name.textContent = label;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String((this.settings[key] as number) * scale);

    const value = document.createElement('i');
    value.textContent = `${input.value}${unit}`;

    input.addEventListener('input', () => {
      const raw = Number(input.value) / scale;
      (this.settings[key] as number) = raw;
      value.textContent = `${input.value}${unit}`;
      this.commit();
    });

    row.append(name, input, value);
    this.sliders.set(key, input);
    return row;
  }

  /**
   * 造一个下拉选择设置项。
   * 视角模式这种"就那么几个选项"的设置用下拉最省地方，也比滑块直观。
   */
  private makeSelect<T extends string>(
    options: HTMLElement,
    key: 'cameraMode' | 'particles' | 'touchStick',
    label: string,
    values: readonly T[],
    labels: Record<T, string>,
  ): HTMLSelectElement {
    const row = document.createElement('label');
    row.className = 'settings-row';

    const name = document.createElement('span');
    name.textContent = label;

    const select = document.createElement('select');
    select.className = 'settings-select';
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = labels[value];
      select.appendChild(option);
    }
    select.value = this.settings[key];

    select.addEventListener('change', () => {
      // 逐个分支赋值：`GameSettings[key]` 在联合键下会退化成 never，直接下标赋值过不了类型检查
      if (key === 'cameraMode') this.settings.cameraMode = select.value as CameraMode;
      else if (key === 'particles') this.settings.particles = select.value as ParticleLevel;
      else this.settings.touchStick = select.value as StickMode;
      this.commit();
    });

    row.append(name, select);
    options.appendChild(row);
    return select;
  }

  /** 资源包导入行（.mcpack / .zip） */
  private makeResourcePackRow(): HTMLElement {
    const row = document.createElement('label');
    row.className = 'settings-row';
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
    const row = document.createElement('label');
    row.className = 'settings-row';

    const name = document.createElement('span');
    name.textContent = '创造模式';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.actions.isFlying?.() ?? false;
    input.addEventListener('change', () => {
      this.actions.onToggleFly?.();
      // 以真实状态为准回填（切换可能被拒绝/立刻被别的逻辑改回去）
      input.checked = this.actions.isFlying?.() ?? input.checked;
    });

    const hint = document.createElement('i');
    hint.textContent = '飞行';

    row.append(name, input, hint);
    this.flyingToggle = input;
    this.section('game').appendChild(row);
  }

  /** 造一个开关设置项 */
  private makeToggle(options: HTMLElement, key: BoolSettingKey, label: string): HTMLInputElement {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.settings[key];
    input.addEventListener('change', () => {
      this.settings[key] = input.checked;
      this.commit();
    });
    row.append(name, input);
    options.appendChild(row);
    return input;
  }

  private commit(): void {
    saveSettings(this.settings);
    this.actions.onChange(this.settings);
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
    this.titleEl.textContent = title;
    this.subtitleText = subtitle;
    this.renderSubtitle();
    this.resumeButton.textContent = resumeLabel;
  }

  /**
   * 副标题：桌面端保留"按 Esc 继续游戏"这类键盘提示；触摸端换成不含键盘的说法
   *（批次 104：手机上没有 Esc，"按 Esc"只会让人去找一个不存在的键）。
   *
   * 渲染时机放在 `show()` 而不是构造那一刻：`<body class="touch-mode">` 是
   * 触摸操作层建立时挂上的，比这个面板**晚**（主菜单里那个设置面板更晚）。
   */
  private renderSubtitle(): void {
    this.subtitleEl.textContent = isTouchUi() ? '改动立即生效 · 点右上角 ✕ 返回' : this.subtitleText;
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.renderSubtitle();
    // 飞行状态是"实时"的（可能刚刚用双击跳跃切过），打开面板时对一次账
    if (this.flyingToggle) this.flyingToggle.checked = this.actions.isFlying?.() ?? false;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
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
