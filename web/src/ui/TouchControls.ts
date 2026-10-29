/**
 * 触摸操作层（手机/平板）
 *
 * 设计原则：**不复刻键盘，而是把触摸手势翻译成同一套输入**。
 * 摇杆产出 forward/strafe、按钮产出 jump/sneak/sprint，直接喂给现有的 PlayerPhysics，
 * 因此移动手感（速度、重力、自动上台阶）在手机与桌面完全一致，不需要两套物理。
 *
 * 手势约定对齐基岩版**手机**（Education / Wiki「控制」）：
 *  - 左下角摇杆：拖动移动；推满自动疾跑；**双击摇杆 = 切换潜行**
 *  - 屏幕拖动：转视角
 *  - 轻点抬起：交互 / 攻击 / 放置一次（优先级由主程序决定）
 *  - 按住不放（未拖动，≥400ms）：破坏方块 / 持续攻击
 *  - **按下即出白圈（批次 239）**：白圈跟手，主程序用它做"手指落点射线"，
 *    不再用屏幕中央的准星决定目标（见 `aimPoint`）
 *  - **生存：右侧只有一颗跳跃键**
 *  - **创造：双击跳跃起飞 → 右侧出现上升 / 下降键**；再双击跳跃落地，升降键消失
 *  - 顶部三键：暂停 / 视角 / 聊天；快捷栏右侧：背包
 */

import type { PlayerInput } from '../core/physics/PlayerPhysics.ts';
// 多语言 P3-1：触摸控件的文案走 `touch.*` / `label.*`
import { t } from '../core/i18n/I18n.ts';
import { HOTBAR_SIZE } from '../core/container/Inventory.ts';
import { diag } from '../game/diagnosticsRuntime.ts';
import { touchIconLabel, touchIconSvg, type TouchIconName } from './TouchIcons.ts';
import {
  pointFromEvent,
  pointFromEventWithSource,
  type PointerSource,
} from '../core/input/PointerPoint.ts';

/** 诊断日志里用的输入快照（D2 那种"切完就卡"全靠它对比） */
export interface TouchDebugState {
  enabled: boolean;
  visible: boolean;
  lookPointer: number | null;
  stickPointer: number | null;
  forward: number;
  strafe: number;
  breaking: boolean;
  jumpHeld: boolean;
  sneakHeld: boolean;
  flying: boolean;
  lookDragged: boolean;
}

/**
 * 超过这个时长（毫秒）就算长按，升级为破坏 / 持续攻击（批次 181 / 272）。
 *
 * ⚠️ 批次 181 删掉了原来的 140ms"按住连续放置"：手机上一次普通点按通常有
 * 100~200ms，手指还没抬起来连放就触发了——玩家看到的是"一碰就放方块"，
 * 而长按破坏反而被放置抢先。现在只有一个阈值：
 *  - 抬手早于 400ms → **轻点**：交互 / 攻击 / 放置一次；
 *  - 按住超过 400ms → **破坏 / 持续攻击**。
 *
 * 批次 272 按用户反馈从 280ms 调到 **400ms**：慢一点的"点按"（尤其换目标时）
 * 常常在 300ms 左右才抬手，280ms 会让它先掉一格方块。400ms 仍短于"半秒"，
 * 按住破坏不会觉得迟钝，但把"点一下"和"按住"分得更开。
 */
export const TOUCH_BREAK_LONG_PRESS_MS = 400;
/** 内部沿用的短名字（读起来与批次 181 的注释一致） */
const LONG_PRESS_MS = TOUCH_BREAK_LONG_PRESS_MS;
/** 按下后位移超过这个像素数就算拖动视角，不再是点击 */
const TAP_MOVE_SLOP = 12;
/**
 * "按住使用"（吃 / 喝 / 举盾 / 拉弓）的判据：手指**几乎不动地**停留够这么久（毫秒）。
 *
 * 为什么不能是 0（批次 219 首版就是 0，用户当场发现"拿肉滑动视角会触发吃东西"）：
 * 视角面只有一个，转视角是"按下 + 移动"，而移动要累计到 TAP_MOVE_SLOP（12px）才算拖动；
 * 在那之前（通常 1~3 帧）游戏并不知道你要转视角，于是先咬一口：晃手 + 咀嚼声 + 进度条闪一下。
 * 100ms 低于"即时响应"的感知阈值，而真拖动在 20~40ms 内就会越过 USE_MOVE_SLOP，故不会误触。
 *
 * ⚠️ 单靠一个手势无法同时表达两种意图；要真正 0 延迟只能加独立的使用键。
 */
export const TOUCH_USE_STILL_MS = 100;
/** 按住使用时允许的手指漂移（像素）：超过它就算"想转视角"，不再算按住不动 */
const USE_MOVE_SLOP = 6;
/** 摇杆推到该比例以上自动疾跑 */
const SPRINT_THRESHOLD = 0.92;
/**
 * 轻点抬手后白圈在原地停留多久（毫秒）。
 *
 * 长按/拖动时白圈是"跟手的锚点"，抬手就该消失；只有轻点（点一下就收）需要
 * 留一小段让玩家确认"点到的是这里"。120ms 比一帧长、又不至于挡住下一次操作。
 */
const TAP_FLASH_MS = 120;
/**
 * 双击跳跃起飞 / 双击摇杆潜行。
 * 只看两次**按下**的时间差。
 */
const DOUBLE_TAP_MS = 320;
/**
 * 动态摇杆的"左手拇指区"（批次 96）：屏幕左下这块区域按下时，摇杆**出现在手指下面**。
 */
const DYNAMIC_STICK_ZONE = { maxX: 0.45, minY: 0.4 } as const;

/** 摇杆的两种模式（与基岩版一致） */
export type StickMode = 'fixed' | 'dynamic';
/** 设置界面要遍历它（与 `CAMERA_MODES` / `PARTICLE_LEVELS` 同一个套路） */
export const STICK_MODES: readonly StickMode[] = ['fixed', 'dynamic'];
/** 摇杆模式的显示名（多语言 P3-1）：返回**新对象**，切语言后重新调用即可 */
export function stickModeLabels(): Record<StickMode, string> {
  return { fixed: t('label.stickMode.fixed'), dynamic: t('label.stickMode.dynamic') };
}

/**
 * 左右手模式（批次 271）：右手模式摇杆在左、按钮在右；左手模式整个镜像。
 *
 * ⚠️ 它不只影响 CSS：动态摇杆的"拇指区"判据与摇杆死区都要跟着换边，
 * 否则左手模式下左下角仍是摇杆区、右下角反而没有摇杆。
 */
export type Handedness = 'right' | 'left';
export const HANDEDNESS_MODES: readonly Handedness[] = ['right', 'left'];
/** 惯用手的显示名（多语言 P3-1） */
export function handednessLabels(): Record<Handedness, string> {
  return { right: t('label.handedness.right'), left: t('label.handedness.left') };
}

/**
 * 摇杆四周的**死区**（批次 271，批次 275 加大）：这一圈里点按不产生任何目标，
 * 也不攻击/放置——那是控制移动的大拇指，右手才是操作手。
 *
 * 批次 271 取半径的 20%（132px 摇杆外扩约 13px）实测仍然太窄：拇指压边/换向时
 * 很容易蹭进"瞄准区"，于是白圈一闪、目标跳到旁边的方块上。批次 275 放大到 60%
 * （约 40px），批次 276 再按用户要求放大到 **100%**：保护圈直径 = 摇杆直径 × 2
 * （132px 摇杆 → 半径 132px 的整片区域），整只大拇指连同换向的回旋余地都归移动。
 * 死区跟着 `--touch-scale` 一起缩放，换到左手模式也自动跟到右侧摇杆。
 */
export const STICK_DEAD_ZONE_RATIO = 1.0;

/**
 * 手指瞄准时，取点从"手指正中"挪到白圈边缘的比例（批次 521，用户要求）。
 *
 * 白圈半径 r，取 45° 方向上的圆周点 → 偏移量 r/√2 ≈ 0.707r。右手模式往**左上**、
 * 左手模式往**右上**：指肚是从下方盖住目标格的，往手背那一侧偏一格才能看见它。
 *
 * 导出是为了能离线断言"往上是恒定的、左右跟着手换边"。
 */
export const AIM_EDGE_FACTOR = Math.SQRT1_2;

/**
 * 手指落点 → 实际瞄准点（纯函数，离线测试直接钉住）。
 *
 * 右手往左上、左手往右上，两个方向都**往上**偏——手指永远是从屏幕下方伸上来的。
 */
export function fingerAimPoint(
  x: number,
  y: number,
  radius: number,
  handedness: Handedness,
): { x: number; y: number } {
  const edge = Math.max(0, radius) * AIM_EDGE_FACTOR;
  const toward = handedness === 'right' ? -1 : 1;
  return { x: x + toward * edge, y: y - edge };
}

/** 点 (x, y) 是否落在"摇杆 + 死区"这个圆里（纯函数，离线测试用） */
export function withinStickDeadZone(
  centerX: number,
  centerY: number,
  radius: number,
  x: number,
  y: number,
): boolean {
  return Math.hypot(x - centerX, y - centerY) <= radius * (1 + STICK_DEAD_ZONE_RATIO);
}

export interface TouchActions {
  /**
   * 打开暂停 / 设置菜单（批次 104，屏幕上方正中那颗键）。
   */
  onOpenPause: () => void;
  /** 切换第一/第三人称（批次 181，顶部第二颗键） */
  onCycleCamera(): void;
  /**
   * 轻点抬起：交互 / 攻击 / 放置一次。
   *
   * 带上**松手时的手指坐标**（批次 185）：主程序要用它在屏幕上"点哪打哪"——
   * 原来只按准星判定，玩家必须先把视角对到生物身上才能打到。
   */
  onTap(clientX: number, clientY: number): void;
  /** 长按开始 / 结束：破坏方块 / 持续攻击 */
  onBreakStart(): void;
  onBreakEnd(): void;
  onToggleInventory(): void;
  onToggleFly(): void;
  onToggleSneak(): void;
  /** 打开聊天 / 命令输入（手机上原来只有键盘的 T 与 /，等于打不开） */
  onOpenChat(): void;
}

/**
 * 安全地捕获指针。
 */
function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    /* 指针已失效或为合成事件，忽略 */
  }
}

/**
 * 原生壳通过 UA 打的标记（Android: `MainActivity`，iOS/桌面对应壳同样加）。
 *
 * 为什么要它：`pointer: coarse` 在带鼠标的模拟器上不成立，会被判成 PC 版；
 * 而"有没有原生壳"这件事壳自己最清楚，UA 又是在任何脚本之前就可用的。
 */
const SHELL_TOUCH = typeof navigator !== 'undefined' && /MinicraftTouch\/1/.test(navigator.userAgent);

/** 是否应当启用触摸操作 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (SHELL_TOUCH) return true;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  return coarse && hasTouch;
}

/**
 * 当前这套界面是不是"触摸那套"（批次 104）。
 *
 * 判据是 `<body class="touch-mode">`——与"触摸操作层到底建没建"共用同一个标记。
 */
export function isTouchUi(): boolean {
  if (typeof document !== 'undefined' && document.body?.classList.contains('touch-mode')) return true;
  return isTouchDevice();
}

export class TouchControls {
  /** 挂到 HUD 上的根元素 */
  readonly object: HTMLDivElement;

  private readonly lookSurface: HTMLDivElement;
  /** 手指落点白圈（批次 239）：按下即出现、跟手；`pointer-events: none` */
  private readonly aimRing: HTMLDivElement;
  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly jumpButton: HTMLButtonElement;
  /** 飞行时才出现的上升 / 下降（基岩手机：双击跳跃之后才露出来） */
  private readonly flyUpButton: HTMLButtonElement;
  private readonly flyDownButton: HTMLButtonElement;
  /**
   * 挂在快捷栏两侧的背包/聊天（批次 107）。
   * ⚠️ 它们**不在 `this.object`（#touch-ui）里面**——而是挂进了 `#hotbar`。
   */
  private readonly sideButtons: HTMLButtonElement[] = [];
  /** 顶部中央的暂停键（批次 104） */
  private readonly pauseButton: HTMLButtonElement;

  /** 累积的视角增量（像素），由主循环取走 */
  private lookX = 0;
  private lookY = 0;

  private stickPointer: number | null = null;
  private stickCenterX = 0;
  private stickCenterY = 0;
  private stickRadius = 56;
  private forward = 0;
  private strafe = 0;

  private lookPointer: number | null = null;
  /** 这一次视角拖动锁定用哪一组坐标（批次 183，见 `core/input/PointerPoint.ts`） */
  private lookPointSource: PointerSource = 'client';
  /** 正在做"隐藏一帧再显示"的坐标恢复 */
  private nudging = false;
  /** 一次手势里连续收到几个 (0,0) 的 move（批次 201） */
  private zeroMoveCount = 0;
  private lookStartX = 0;
  private lookStartY = 0;
  private lookDragged = false;
  /** 这一次按下的时刻（毫秒）：`holding` 靠它算"静止够不够久"（批次 224） */
  private lookDownAt = 0;
  /** 这一次按下以来离落点的最大位移（像素）：防"慢慢滑"被当成按住不动（批次 224） */
  private lookDrift = 0;
  /**
   * 当前手指落点（client 坐标）——**按住中才非空**。
   *
   * 主程序每帧读它做"屏幕射线拾取"（批次 239）：目标不再由准星决定，
   * 而是玩家手指底下那一点。抬手即清空（轻点那一下由主程序另记落点）。
   */
  private aim: { x: number; y: number } | null = null;
  /** 轻点抬手后白圈的停留计时（`TAP_FLASH_MS`） */
  private tapFlashTimer: number | null = null;
  private longPressTimer: number | null = null;
  private breaking = false;

  private enabled = false;
  private sneaking = false;
  private flying = false;
  private sneakHeld = false;
  private stickMode: StickMode = 'fixed';
  /** 左右手模式（批次 271）：只影响摇杆/按钮的边与动态摇杆的拇指区 */
  private handedness: Handedness = 'right';
  /** 白圈半径（CSS 像素）：手指瞄准的取点要挪到圈的边缘。按下时量一次 */
  private aimRadius = 46;
  /** 上一次"按下跳跃键"的时刻（双击起飞用） */
  private lastJumpDown = 0;
  /** 上一次"按下摇杆"的时刻（双击潜行用） */
  private lastStickDown = 0;

  constructor(
    host: HTMLElement,
    private readonly actions: TouchActions,
  ) {
    this.object = document.createElement('div');
    this.object.id = 'touch-ui';

    // ---- 手指落点白圈（批次 239）：位置由 JS 的 transform 写（见 index.html 的注释）
    // 先建它再绑手势：`trackAim` 会在 pointerdown 里立刻用到
    this.aimRing = document.createElement('div');
    this.aimRing.id = 'touch-ring';

    // ---- 视角面：铺满全屏，承接拖动与轻点/长按
    this.lookSurface = document.createElement('div');
    this.lookSurface.id = 'touch-look';
    this.bindLookSurface();

    // ---- 摇杆
    this.stickBase = document.createElement('div');
    this.stickBase.id = 'touch-stick';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'knob';
    this.stickBase.appendChild(this.stickKnob);
    // 潜行提示（批次 275）：双击摇杆切换潜行后，只在摇杆上套一圈绿色太容易被拇指挡住。
    // 在摇杆正上方加一枚"潜行"小牌；CSS 只在 `#touch-stick.sneaking` 时显示。
    const sneakBadge = document.createElement('div');
    sneakBadge.className = 'sneak-badge';
    sneakBadge.textContent = t('touch.sneak');
    sneakBadge.setAttribute('aria-hidden', 'true');
    this.stickBase.appendChild(sneakBadge);
    this.bindStick();

    // ---- 右下按钮簇（基岩手机）：
    //  生存 → **只有跳跃**；创造双击起飞 → 上下多出上升/下降两颗。
    const buttons = document.createElement('div');
    buttons.id = 'touch-buttons';

    this.flyUpButton = this.makeIconButton('jump', () => undefined);
    this.flyUpButton.classList.add('fly-only', 'fly-up');
    this.flyUpButton.setAttribute('aria-label', t('touch.flyUp'));
    this.flyUpButton.title = t('touch.flyUp');
    this.bindHoldButton(this.flyUpButton, (down) => {
      this.jumpHeld = down;
    });

    this.jumpButton = this.makeIconButton('jump', () => undefined);
    this.jumpButton.classList.add('jump');
    this.bindHoldButton(this.jumpButton, (down) => {
      this.jumpHeld = down;
    });
    // 双击跳跃：起飞 / 落地（创造）；按住仍然是跳或上升
    this.jumpButton.addEventListener('pointerdown', () => {
      const now = performance.now();
      if (now - this.lastJumpDown <= DOUBLE_TAP_MS) {
        this.lastJumpDown = 0;
        this.actions.onToggleFly();
        return;
      }
      this.lastJumpDown = now;
    });

    this.flyDownButton = this.makeIconButton('sneak', () => undefined);
    this.flyDownButton.classList.add('fly-only', 'fly-down');
    this.flyDownButton.setAttribute('aria-label', t('touch.flyDown'));
    this.flyDownButton.title = t('touch.flyDown');
    this.bindHoldButton(this.flyDownButton, (down) => {
      this.sneakHeld = down;
    });
    // 双击下降键也可落地（Wiki / Education：Stop / Fly down 双击停飞）
    this.flyDownButton.addEventListener('pointerdown', () => {
      if (!this.flying) return;
      const now = performance.now();
      if (now - this.lastJumpDown <= DOUBLE_TAP_MS) {
        this.lastJumpDown = 0;
        this.actions.onToggleFly();
        return;
      }
      this.lastJumpDown = now;
    });

    // DOM：上 → 跳 → 下；未飞行时 CSS 把 `.fly-only` 藏掉，只剩跳跃
    buttons.append(this.flyUpButton, this.jumpButton, this.flyDownButton);

    // ---- 顶部中央三颗键（批次 181）：暂停 / 视角 / 聊天。
    // 原来只有暂停，视角要靠键盘 V、聊天挂在快捷栏左侧；手机上都不合适。
    this.pauseButton = this.makeIconButton('pause', () => this.actions.onOpenPause());
    this.pauseButton.classList.add('pause');
    const viewButton = this.makeIconButton('view', () => this.actions.onCycleCamera());
    viewButton.classList.add('view');
    const chatButton = this.makeIconButton('chat', () => this.actions.onOpenChat());
    chatButton.classList.add('chat');
    const pauseBar = document.createElement('div');
    pauseBar.id = 'touch-pause';
    // 批次 528（用户）：左聊天 / 中暂停 / 右视角（视角改用望远镜图标）
    pauseBar.append(chatButton, this.pauseButton, viewButton);

    // ---- 操作提示
    this.hint = document.createElement('div');
    this.hint.id = 'touch-hint';
    this.hint.textContent =
      t('touch.hint');

    this.object.append(this.lookSurface, this.aimRing, this.stickBase, buttons, pauseBar, this.hint);
    host.appendChild(this.object);

    this.mountHotbarSideButtons();
    this.applyFlyChrome();
  }

  /**
   * 背包 / 聊天挂到**快捷栏两侧**（批次 107，对齐基岩版）。
   */
  private mountHotbarSideButtons(): void {
    const host = document.getElementById('hotbar') ?? this.object;
    // 批次 181：聊天搬到顶部，快捷栏右侧只留背包（基岩版的位置）
    for (const [icon, id, action] of [
      ['inventory', 'touch-hotbar-inventory', () => this.actions.onToggleInventory()],
    ] as const) {
      const button = this.makeIconButton(icon, action);
      button.id = id;
      button.classList.add('touch-side-btn');
      this.sideButtons.push(button);
      host.appendChild(button);
    }
  }

  // ---------------------------------------------------------------- 对外接口

  get visible(): boolean {
    return !this.object.classList.contains('ui-off');
  }

  /**
   * 打开界面时收起操作层并清空输入，避免"界面开着人还在走"。
   *
   * ⚠️ 批次 231：**不再 `display:none`**（`.hidden`），只挂 `ui-off` 收掉
   * "看得见的壳"（摇杆/按钮/暂停条/提示）。原因见 `index.html` 的 `#touch-ui.ui-off`：
   * 整层拆掉再建回来会让浏览器重算触摸坐标映射，而"关掉暂停页后的第一次滑动"
   * 正好撞在那一次重算上（`clientX/Y` 被报成 0,0）。不参与点击由 CSS 的
   * `#touch-look { pointer-events: none }` 负责，转视角本身已被 `setEnabled(!uiOpen)` 挡住。
   */
  set visible(value: boolean) {
    this.object.classList.toggle('ui-off', !value);
    // 侧键挂在 `#hotbar` 上（不在 `this.object` 里）：同样用类而不是 `style.display`，
    // 免得多一次重排（它们的位置在快捷栏两端，重排会牵动整条快捷栏）
    for (const button of this.sideButtons) button.classList.toggle('ui-off', !value);
    if (value) return;
    this.resetStick('ui.hide');
    this.cancelLook();
    this.jump = false;
    this.sneakHeld = false;
  }

  set jump(value: boolean) {
    this.jumpHeld = value;
  }

  private jumpHeld = false;

  /** 供主循环读取的移动输入 */
  get input(): PlayerInput {
    const magnitude = Math.hypot(this.forward, this.strafe);
    return {
      forward: this.forward,
      strafe: this.strafe,
      jump: this.jumpHeld,
      sneak: this.sneaking || this.sneakHeld,
      sprint: magnitude >= SPRINT_THRESHOLD,
    };
  }

  /**
   * 当前输入快照（诊断日志用）。
   *
   * ⚠️ 只读、无副作用：日志里每一条手势事件都带上它，
   * 事后就能看出"指针还挂着的时候状态切换了"这类时序问题。
   */
  get debugState(): TouchDebugState {
    return {
      enabled: this.enabled,
      visible: this.visible,
      lookPointer: this.lookPointer,
      stickPointer: this.stickPointer,
      forward: Math.round(this.forward * 100) / 100,
      strafe: Math.round(this.strafe * 100) / 100,
      breaking: this.breaking,
      jumpHeld: this.jumpHeld,
      sneakHeld: this.sneakHeld,
      flying: this.flying,
      lookDragged: this.lookDragged,
    };
  }

  /**
   * 手指正**按住不动** = "可能正在使用"（吃 / 喝 / 举盾 / 拉弓）。
   *
   * 给主程序算 `usingItem` 用：有了它，进食不用再等"长按 280ms"那一步。
   *
   * 判据是两条（批次 224，缺一不可）：
   *  ① 漂移 ≤ `USE_MOVE_SLOP`（6px）：手指在滑就说明想转视角，不是想用；
   *  ② 静止够 `TOUCH_USE_STILL_MS`（100ms）：挡掉"拖视角的前 1~3 帧"——
   *     那时还没越过 12px 的拖动阈值，不加这一条会先咬一口再转视角。
   *
   * ⚠️ 直接读 `lookPointer` / 位移，**不要**改成"按下时回调置位的布尔量"：
   * 那个布尔量在"按下时指针被界面 / 摇杆 / 切飞行抢走"这类情况下会永远停在 true
   * （松手事件被吞了），表现就是下一帧凭空开始吃。`lookPointer` 在
   * `finish` / `cancelLook` / `resetInput` 三处都会被清空，读它不会留脏状态。
   */
  get holding(): boolean {
    if (this.lookPointer === null || this.lookDragged) return false;
    if (this.lookDrift > USE_MOVE_SLOP) return false;
    return performance.now() - this.lookDownAt >= TOUCH_USE_STILL_MS;
  }

  /**
   * 手指当前的落点（client 坐标）；**只有按住中才非空**。
   *
   * 主程序拿它做"屏幕射线拾取"（批次 239）：挖方块、放方块、开箱子……
   * 全部以手指底下那一点为准。触摸端**没有准星**（批次 239 复查），
   * 所以它为空时主程序也不该有任何目标。
   */
  get aimPoint(): { x: number; y: number } | null {
    return this.aim ? this.aimPointAt(this.aim.x, this.aim.y) : null;
  }

  /**
   * 某个落点对应的**实际瞄准点**（批次 521，用户要求）。
   *
   * 手指瞄准时，指肚会盖住它指着的那一格——所以取点从"手指正中"挪到
   * **白圈的边缘**上，往手背那一侧偏：
   *  - 右手模式：**左上**边缘（-r/√2, -r/√2）；
   *  - 左手模式：**右上**边缘（+r/√2, -r/√2）。
   *
   * ⚠️ 只挪**射线取点**，白圈本身仍然跟手（它是"我按在哪"的锚点）。
   * 如果连圈一起挪，玩家会觉得圈和手指脱节了。
   */
  aimPointAt(x: number, y: number): { x: number; y: number } {
    return fingerAimPoint(x, y, this.aimRadius, this.handedness);
  }

  /** 取走本帧累积的视角增量（像素），取完即清零 */
  consumeLook(): { x: number; y: number } {
    const delta = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return delta;
  }

  setFlying(flying: boolean): void {
    if (this.flying === flying) {
      this.applyFlyChrome();
      return;
    }
    this.flying = flying;
    if (flying) {
      // 起飞时清掉地面潜行亮态（状态与摇杆上的绿边/「潜行」小牌必须一起撤）
      this.sneaking = false;
      this.stickBase.classList.remove('sneaking');
    }
    this.sneakHeld = false;
    this.jumpHeld = false;
    this.applyFlyChrome();
  }

  /** 飞行态：露上升/下降；落地：只留跳跃 */
  private applyFlyChrome(): void {
    this.object.classList.toggle('flying', this.flying);
    for (const button of [this.flyUpButton, this.flyDownButton]) {
      button.classList.toggle('hidden', !this.flying);
      button.classList.remove('on');
    }
    this.jumpButton.classList.remove('on');
  }

  /**
   * 摇杆模式：`fixed` 固定在左下角；`dynamic` 在左下拇指区**按下即出现在手指下**。
   */
  setStickMode(mode: StickMode): void {
    this.stickMode = mode;
    this.stickBase.classList.toggle('dynamic', mode === 'dynamic');
    // 两种模式共用同一个元素：切换时先清掉上一次跟手写下的内联坐标，
    // 否则切回固定模式后摇杆会停在最后按过的位置，而不是左下角。
    this.clearDynamicOffset();
    if (mode === 'fixed') this.resetStick('stickMode');
  }

  /**
   * 左右手模式（批次 271）：整个操作层左右镜像。
   *
   * 用 `#touch-ui` 上的类而不是 `<body>`：操作层不在了（桌面/主菜单）时
   * 这个类自然也没有意义；动态摇杆的拇指区由 `handedness` 字段判。
   */
  setHandedness(mode: Handedness): void {
    if (this.handedness === mode) return;
    this.handedness = mode;
    this.object.classList.toggle('left-handed', mode === 'left');
    this.resetStick('handedness');
  }

  /** 同步潜行状态（键盘切换时按钮也要跟着变——潜行已不在右簇，只保内部状态） */
  setSneaking(sneaking: boolean): void {
    this.sneaking = sneaking;
    this.stickBase.classList.toggle('sneaking', sneaking);
  }

  get isSneaking(): boolean {
    return this.sneaking;
  }

  dismissHint(): void {
    this.hint.classList.add('fade');
  }

  // ---------------------------------------------------------------- 内部实现

  private makeIconButton(icon: TouchIconName, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'touch-button';
    button.dataset.icon = icon;
    button.innerHTML = touchIconSvg(icon);
    button.setAttribute('aria-label', touchIconLabel(icon));
    button.title = touchIconLabel(icon);
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    button.addEventListener('click', (event) => event.preventDefault());
    return button;
  }

  private bindHoldButton(button: HTMLButtonElement, onChange: (down: boolean) => void): void {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      onChange(true);
      capturePointer(button, event.pointerId);
      button.classList.add('on');
    });
    const release = (event: PointerEvent) => {
      event.preventDefault();
      onChange(false);
      button.classList.remove('on');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
  }

  private isInStickZone(event: PointerEvent): boolean {
    const x = event.clientX / Math.max(1, window.innerWidth);
    const y = event.clientY / Math.max(1, window.innerHeight);
    if (y < DYNAMIC_STICK_ZONE.minY) return false;
    // 左手模式的拇指区在**右下**（与 CSS 的镜像保持同一套边）
    return this.handedness === 'left'
      ? x >= 1 - DYNAMIC_STICK_ZONE.maxX
      : x <= DYNAMIC_STICK_ZONE.maxX;
  }

  /**
   * 手指落点是否在摇杆死区里（批次 271 / 275）。
   *
   * 命中时**整次手势都不开始**：不出白圈、不选目标、不攻击、不放置，也不转视角。
   * 摇杆元素自己会吃掉圈内的 pointerdown，这一条管的是"摇杆外面那一圈保护区"。
   */
  private isInStickDeadZone(clientX: number, clientY: number): boolean {
    const rect = this.stickBase.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return withinStickDeadZone(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      rect.width / 2,
      clientX,
      clientY,
    );
  }

  private beginDynamicStick(event: PointerEvent): void {
    if (event.clientX === 0 && event.clientY === 0) {
      this.reportPointerAnomaly('stick.dynamic', event);
      this.nudgeLayout('stick.dynamic');
      return;
    }
    const rect = this.stickBase.getBoundingClientRect();
    const radius = rect.width > 0 ? rect.width / 2 : this.stickRadius;
    this.stickRadius = radius;
    // 左手模式的摇杆默认贴在右边（CSS `right`）；跟手时必须把 right 让开，
    // 否则 left/top 与 right 同时生效，盒子会被拉伸
    this.stickBase.style.left = `${event.clientX - radius}px`;
    this.stickBase.style.top = `${event.clientY - radius}px`;
    this.stickBase.style.right = 'auto';
    this.stickBase.style.bottom = 'auto';
    this.stickBase.classList.add('active');
    this.stickCenterX = event.clientX;
    this.stickCenterY = event.clientY;
    this.stickPointer = event.pointerId;
    capturePointer(this.lookSurface, event.pointerId);
    this.dismissHint();

    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== this.stickPointer) return;
      moveEvent.preventDefault();
      this.applyStick(moveEvent);
    };
    const release = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== this.stickPointer) return;
      upEvent.preventDefault();
      this.lookSurface.removeEventListener('pointermove', move);
      this.lookSurface.removeEventListener('pointerup', release);
      this.lookSurface.removeEventListener('pointercancel', release);
      this.resetStick('dynamic.release');
      this.stickBase.style.left = '';
      this.stickBase.style.top = '';
      this.stickBase.style.right = '';
      this.stickBase.style.bottom = '';
    };
    this.lookSurface.addEventListener('pointermove', move);
    this.lookSurface.addEventListener('pointerup', release);
    this.lookSurface.addEventListener('pointercancel', release);
  }

  private bindStick(): void {
    this.stickBase.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      // 批次 183：摇杆的圆心是 client 坐标，混用 screen 会算错方向；
      // 坐标不可用时直接判这次手势无效，并强制一次布局重排等下一次。
      const point = pointFromEvent(event);
      if (point.source !== 'client') {
        this.reportPointerAnomaly('stick.down', event);
        this.nudgeLayout('stick.down');
        return;
      }
      // 双击摇杆 = 切换潜行（Education：D-pad 中心双击；我们用摇杆，右手只留跳跃）
      const now = performance.now();
      if (now - this.lastStickDown <= DOUBLE_TAP_MS && !this.flying) {
        this.lastStickDown = 0;
        this.sneaking = !this.sneaking;
        this.stickBase.classList.toggle('sneaking', this.sneaking);
        this.actions.onToggleSneak();
      } else {
        this.lastStickDown = now;
      }

      const rect = this.stickBase.getBoundingClientRect();
      this.stickCenterX = rect.left + rect.width / 2;
      this.stickCenterY = rect.top + rect.height / 2;
      this.stickRadius = rect.width / 2;
      this.stickPointer = event.pointerId;
      capturePointer(this.stickBase, event.pointerId);
      this.stickBase.classList.add('active');
      this.applyStick(event);
      diag.event('gesture', 'stick.down', {
        pointer: event.pointerId,
        x: Math.round(event.clientX),
        y: Math.round(event.clientY),
        mode: this.stickMode,
        state: this.debugState,
      });
    });

    this.stickBase.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      this.applyStick(event);
    });

    const release = (event: PointerEvent) => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      diag.event('gesture', 'stick.up', {
        pointer: event.pointerId,
        kind: event.type,
        forward: Math.round(this.forward * 100) / 100,
        strafe: Math.round(this.strafe * 100) / 100,
      });
      this.resetStick(event.type);
    };
    this.stickBase.addEventListener('pointerup', release);
    this.stickBase.addEventListener('pointercancel', release);
  }

  private applyStick(event: PointerEvent): void {
    // 防御：坐标异常时不要用"手指在原点"去算方向（会产生一个巨大的反向输入）
    if (event.clientX === 0 && event.clientY === 0) return;
    const dx = event.clientX - this.stickCenterX;
    const dy = event.clientY - this.stickCenterY;
    const distance = Math.hypot(dx, dy);
    const clamped = Math.min(distance, this.stickRadius);
    const ratio = distance === 0 ? 0 : clamped / distance;
    const nx = distance === 0 ? 0 : (dx / distance) * ratio * (distance / this.stickRadius);
    const ny = distance === 0 ? 0 : (dy / distance) * ratio * (distance / this.stickRadius);

    this.stickKnob.style.transform = `translate(${nx * this.stickRadius}px, ${ny * this.stickRadius}px)`;
    this.forward = -ny;
    this.strafe = nx;
    if (distance > TAP_MOVE_SLOP) this.dismissHint();
  }

  private resetStick(reason = 'unknown'): void {
    if (this.stickPointer !== null) diag.event('gesture', 'stick.reset', { reason, pointer: this.stickPointer });
    this.stickPointer = null;
    this.forward = 0;
    this.strafe = 0;
    this.stickKnob.style.transform = 'translate(0px, 0px)';
    this.stickBase.classList.remove('active');
    // 跟手模式松手后回默认点（批次 20261024-1152）：底圈现在**一直看得见**，
    // 不归位的话它会停在最后按过的位置，看起来像"摇杆卡在那儿了"。
    if (this.stickMode === 'dynamic') this.clearDynamicOffset();
  }

  /** 清掉 `beginDynamicStick` 写的内联坐标，让 CSS 的左下默认位置重新生效 */
  private clearDynamicOffset(): void {
    this.stickBase.style.left = '';
    this.stickBase.style.top = '';
    this.stickBase.style.right = '';
    this.stickBase.style.bottom = '';
  }

  private bindLookSurface(): void {
    this.lookSurface.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      if (this.stickMode === 'dynamic' && this.stickPointer === null && this.isInStickZone(event)) {
        this.beginDynamicStick(event);
        return;
      }
      // 摇杆四周的死区（批次 271）：这一圈只归移动，不产生目标/攻击/放置
      if (this.isInStickDeadZone(event.clientX, event.clientY)) {
        diag.event('gesture', 'look.deadzone', {
          x: Math.round(event.clientX),
          y: Math.round(event.clientY),
          hand: this.handedness,
        });
        return;
      }
      if (this.lookPointer !== null) return;

      // 批次 183：真机上偶发 clientX/Y 双双为 0（关面板 / 后台回来 / 全屏切换之后）。
      // 仅凭 0,0 无法算拖动增量，拖多久视角都不动——先按 screen/page 兜底，
      // 三个来源都不可用时强制一次布局重排（等价于"开关一次背包"的恢复路径）。
      const point = pointFromEvent(event);
      this.lookPointSource = point.source;
      if (point.source === 'none') {
        this.reportPointerAnomaly('look.down', event);
        this.nudgeLayout('look.down');
        return;
      }

      this.lookPointer = event.pointerId;
      this.lookStartX = point.x;
      this.lookStartY = point.y;
      this.lastMoveX = point.x;
      this.lastMoveY = point.y;
      this.lookDragged = false;
      this.lookDownAt = performance.now();
      this.lookDrift = 0;
      this.breaking = false;
      this.zeroMoveCount = 0;
      capturePointer(this.lookSurface, event.pointerId);
      // 批次 239：按下即出白圈，并把落点交给主程序做"手指射线"（目标不再看准星）
      this.trackAim(point.x, point.y);
      diag.event('gesture', 'look.down', {
        pointer: event.pointerId,
        x: Math.round(point.x),
        y: Math.round(point.y),
        source: point.source,
        state: this.debugState,
      });

      // 只有一个阈值（批次 181）：按住超过它才是破坏/持续攻击，松手早于它就是轻点
      this.longPressTimer = window.setTimeout(() => {
        if (this.lookDragged) return;
        this.breaking = true;
        diag.event('gesture', 'break.start', { pointer: this.lookPointer, state: this.debugState });
        this.actions.onBreakStart();
      }, LONG_PRESS_MS);
    });

    this.lookSurface.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.lookPointer) return;
      event.preventDefault();

      let point = pointFromEventWithSource(event, this.lookPointSource);
      // 锁定 client 之后又收到 (0,0)：批次 201 的正确做法是**中途换源**，
      // 而不是丢弃——否则手指一直在动、视角却永远不动（用户反馈的"卡住"）。
      if (this.lookPointSource === 'client' && point.x === 0 && point.y === 0) {
        const alt = pointFromEvent(event);
        if (alt.source !== 'none') {
          // 保留已经累计的拖动量，重设基准，避免换源瞬间跳一下
          const dxSoFar = this.lastMoveX - this.lookStartX;
          const dySoFar = this.lastMoveY - this.lookStartY;
          this.lookPointSource = alt.source;
          this.lookStartX = alt.x - dxSoFar;
          this.lookStartY = alt.y - dySoFar;
          this.lastMoveX = alt.x;
          this.lastMoveY = alt.y;
          point = alt;
          diag.event('gesture', 'pointer.rebase', { pointer: event.pointerId, source: alt.source });
        } else {
          // screen/page 也全是 0：连续几次就结束这次手势（批次 231：不再升级到
          // "开关一次背包"——那条路自己就会让触摸层停摆 0.5 秒，见 `nudgeLayout`）
          this.zeroMoveCount++;
          if (this.zeroMoveCount >= 3) {
            this.zeroMoveCount = 0;
            this.nudgeLayout('look.zero');
            this.cancelLook();
          }
          return;
        }
      }
      const dx = point.x - this.lookStartX;
      const dy = point.y - this.lookStartY;
      const drift = Math.hypot(dx, dy);
      // 记住"这一次按下最多漂了多远"：`holding` 用它判断"是不是想转视角"（批次 224）
      if (drift > this.lookDrift) this.lookDrift = drift;

      if (!this.lookDragged && drift > TAP_MOVE_SLOP) {
        this.lookDragged = true;
        diag.event('gesture', 'look.drag.start', {
          pointer: event.pointerId,
          dx: Math.round(dx),
          dy: Math.round(dy),
        });
        this.clearGestureTimers();
      }

      if (this.lookDragged && !this.breaking) {
        this.lookX += point.x - this.lastMoveX;
        this.lookY += point.y - this.lastMoveY;
      }
      this.lastMoveX = point.x;
      this.lastMoveY = point.y;
      // 拖动转视角时白圈继续跟手（用户口径：目标随手实时切换）
      this.trackAim(point.x, point.y);
    });

    const finish = (event: PointerEvent) => {
      if (event.pointerId !== this.lookPointer) return;
      event.preventDefault();
      diag.event('gesture', 'look.up', {
        pointer: event.pointerId,
        kind: event.type,
        state: this.debugState,
      });
      this.clearGestureTimers();
      this.zeroMoveCount = 0;

      // 抬手落点：事件里偶发 (0,0) 时退回本次手势最后一次已知坐标（批次 239）——
      // 轻点要靠这个坐标"点哪打哪"，点到 (0,0) 会落到屏幕左上角
      const raw = pointFromEventWithSource(event, this.lookPointSource);
      const tapX = raw.x !== 0 || raw.y !== 0 ? raw.x : this.lastMoveX;
      const tapY = raw.x !== 0 || raw.y !== 0 ? raw.y : this.lastMoveY;

      if (this.breaking) {
        this.breaking = false;
        // 按住（破坏/使用）抬手：白圈立即收起
        this.releaseAim(false);
        this.actions.onBreakEnd();
      } else if (!this.lookDragged) {
        // 松手早于长按阈值 → 轻点：白圈原地闪一下，主程序按落点决定攻击/交互/放置
        this.releaseAim(true);
        this.actions.onTap(tapX, tapY);
      } else {
        this.releaseAim(false);
      }
      this.lookPointer = null;
    };

    this.lookSurface.addEventListener('pointerup', finish);
    this.lookSurface.addEventListener('pointercancel', finish);
    this.lookSurface.addEventListener('lostpointercapture', finish);
  }

  private lastMoveX = 0;
  private lastMoveY = 0;

  private clearGestureTimers(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  /**
   * 更新手指落点并让白圈跟着走（批次 239）。
   *
   * 落点同时是主程序的取目标依据（`aimPoint`），所以按下与每一次 move 都要走这里。
   * 用 `transform` 而不是 `left/top`：后者每帧触发布局，手机上是白给的帧开销。
   */
  private trackAim(x: number, y: number): void {
    this.clearTapFlash();
    this.aim = { x, y };
    // 白圈半径（CSS 像素）：瞄准取点要用它算"圈的左上/右上边缘"。
    // 一次手势只量一次（在 pointerdown 上），避免每帧强制布局。
    const rect = this.aimRing.getBoundingClientRect();
    if (rect.width > 0) this.aimRadius = rect.width / 2;
    this.aimRing.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this.aimRing.classList.add('visible');
  }

  /**
   * 收起落点与白圈。
   *
   * @param linger 轻点抬手时先停 `TAP_FLASH_MS` 再淡出（"点到的是这里"的反馈）；
   *               按住结束 / 拖动结束 / 界面打开都传 false，立即消失。
   *               ⚠️ 停留期间 `aimPoint` 已经是 null——那 120ms 只是画面，
   *                  不能让主程序继续拿旧落点去挖方块。
   */
  private releaseAim(linger: boolean): void {
    this.aim = null;
    this.clearTapFlash();
    if (linger) {
      this.tapFlashTimer = window.setTimeout(() => {
        this.tapFlashTimer = null;
        this.aimRing.classList.remove('visible');
      }, TAP_FLASH_MS);
      return;
    }
    this.aimRing.classList.remove('visible');
  }

  private clearTapFlash(): void {
    if (this.tapFlashTimer === null) return;
    clearTimeout(this.tapFlashTimer);
    this.tapFlashTimer = null;
  }

  private cancelLook(): void {
    this.clearGestureTimers();
    this.lookPointer = null;
    this.lookDragged = false;
    // 界面打开 / 手势作废：落点与白圈一起收起（批次 239）
    this.releaseAim(false);
    if (!this.breaking) return;
    this.breaking = false;
    this.actions.onBreakEnd();
  }

  /**
   * 把输入状态整体清零（批次 181）。
   *
   * 为什么必须有它：切飞行/切界面/切维度时，另一根手指很可能正按在视角面或摇杆上。
   * 只改标志位的话，`lookPointer` / `stickPointer` / `stickCenter` 还是切换前的基准，
   * 之后每一帧都按旧基准算增量——表现就是"摇杆反了、视角卡住"。
   * 旧版本靠"开关一次背包"（`visible=false` 会 reset）碰巧能恢复，正是这个原因。
   *
   * @param reason 记进日志：`flying` / `ui.open` / `ui.close` / `dimension` / `respawn` / `blur`
   */
  resetInput(reason: string): void {
    const before = this.debugState;
    this.clearGestureTimers();
    this.cancelLook();
    this.resetStick('resetInput');
    this.lookPointSource = 'client';
    this.jumpHeld = false;
    this.sneakHeld = false;
    // 双击计时也清掉：切换之后紧接着的一次按下不该被当成"第二次点击"
    this.lastJumpDown = 0;
    this.lastStickDown = 0;
    diag.event('input', 'resetInput', { reason, before, after: this.debugState });
  }

  /**
   * 从"坐标异常"里恢复（批次 183）。
   *
   * 与用户摸索出来的"开关一次背包"完全同一条路径：重置输入 + 让触摸层隐藏一帧
   * 再显示，强制浏览器重新算布局与触摸映射。差异只是不弹面板。
   */
  recover(reason: string): void {
    this.resetInput(reason);
    this.nudgeLayout(reason);
  }

  /** 把"坐标全是 0"的现场记下来：pointerType / screen / page / visualViewport 都要 */
  private reportPointerAnomaly(phase: string, event: PointerEvent): void {
    const vv = typeof window === 'undefined' ? null : window.visualViewport;
    diag.event('gesture', 'pointer.anomaly', {
      phase,
      pointer: event.pointerId,
      pointerType: event.pointerType,
      client: [Math.round(event.clientX), Math.round(event.clientY)],
      screen: [Math.round(event.screenX), Math.round(event.screenY)],
      page: [Math.round(event.pageX), Math.round(event.pageY)],
      viewport: [window.innerWidth, window.innerHeight],
      scroll: [window.scrollX, window.scrollY],
      visual: vv ? [Math.round(vv.offsetLeft), Math.round(vv.offsetTop), Number(vv.scale.toFixed(2))] : null,
    });
  }

  /**
   * 强制一次整页重排（批次 201；批次 231 起是**唯一**的坐标恢复手段）。
   *
   * 关了暂停面板之后仍可能收到一组 0,0（浏览器没重算坐标映射）。这里隐藏两帧
   * 再恢复、顺手失焦并让 HUD 让位——副作用与"开关一次背包"前半程一致，
   * 但**不打开任何面板**，玩家手上正在滑的那一指不会被打断半秒。
   *
   * ⚠️ 别把它升级成"开一次背包"：批次 231 之前就这么干过（`runInventoryRecovery`），
   * 那 0.4~0.6 秒里触摸层是收起的，手感上正是一次"卡一下"。
   */
  private nudgeLayout(reason: string): void {
    if (this.nudging) return;
    this.nudging = true;
    const body = document.body;
    const hadPocketOpen = body.classList.contains('inv-pocket-open');
    if (!hadPocketOpen) body.classList.add('inv-pocket-open');
    // 隐藏输入框/按钮的焦点：Android 上软键盘/焦点残留会拖住 visual viewport
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.object.style.display = 'none';
    // 读一次布局，强制浏览器在"隐藏"状态下重算
    void this.object.offsetHeight;
    void body.offsetHeight;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!hadPocketOpen) body.classList.remove('inv-pocket-open');
        this.object.style.display = '';
        this.nudging = false;
        diag.event('gesture', 'pointer.recover', { reason });
      });
    });
  }

  /** 主循环在每帧开始处调用；界面打开时禁用 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 离开世界时整层拆掉（批次 181）。
   *
   * 顺序有讲究：先清计时器与手势状态（否则那两秒里还会给已经销毁的 App 回调），
   * 再摘 HUD 外的两颗侧键（它们挂在 `#hotbar` 上，不在 `this.object` 里）。
   */
  dispose(): void {
    this.clearGestureTimers();
    this.cancelLook();
    this.resetStick('dispose');
    for (const button of this.sideButtons) button.remove();
    this.object.remove();
  }
}

/** 快捷栏在触摸端也需要能点：把点击事件绑到槽位元素上 */
export function bindHotbarTouch(
  container: HTMLElement,
  onSelect: (index: number) => void,
): void {
  container.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null;
    const slot = target?.closest('.slot') as HTMLElement | null;
    if (!slot) return;
    event.preventDefault();
    const index = Number(slot.dataset.index);
    if (Number.isInteger(index) && index >= 0 && index < HOTBAR_SIZE) onSelect(index);
  });
}
