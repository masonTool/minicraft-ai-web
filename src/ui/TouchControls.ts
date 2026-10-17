/**
 * 触摸操作层（手机/平板）
 *
 * 设计原则：**不复刻键盘，而是把触摸手势翻译成同一套输入**。
 * 摇杆产出 forward/strafe、按钮产出 jump/sneak/sprint，直接喂给现有的 PlayerPhysics，
 * 因此移动手感（速度、重力、自动上台阶）在手机与桌面完全一致，不需要两套物理。
 *
 * 手势约定对齐基岩版**手机**：
 *  - 左下角摇杆：拖动移动；推满自动疾跑
 *  - 屏幕拖动：转视角
 *  - 轻点抬起：放置 / 交互一次
 *  - 按住不放（未拖动）：先连续放置，超过破坏阈值后改为挖掘
 *  - 右下：跳跃（按住）+ 潜行（地面切换；**飞行时按住下降**）
 *  - 双击跳跃：起飞 / 落地
 *  - 快捷栏两侧：右背包、左聊天
 */

import type { PlayerInput } from '../core/physics/PlayerPhysics.ts';
import { HOTBAR_SIZE } from '../core/container/Inventory.ts';
import { TOUCH_ICON_LABELS, touchIconSvg, type TouchIconName } from './TouchIcons.ts';

/** 超过这个时长（毫秒）就算长按，升级为破坏 */
const LONG_PRESS_MS = 220;
/**
 * 按住达到此时长、且尚未进入破坏 → 开始**连续放置**（基岩手机建造手感）。
 * 必须短于 `LONG_PRESS_MS`，否则永远轮不到放置。
 */
const PLACE_HOLD_MS = 140;
/** 按下后位移超过这个像素数就算拖动视角，不再是点击 */
const TAP_MOVE_SLOP = 12;
/** 摇杆推到该比例以上自动疾跑 */
const SPRINT_THRESHOLD = 0.92;
/**
 * 双击跳跃起飞（批次 96，基岩版的创造模式手势）。
 *
 * 两次"按下跳跃键"的间隔小于它就算双击 → 切换飞行。原版手机上就是这么起飞的；
 * 有了它"飞行"按钮就不必常驻（见 M18 的待办）。按住跳跃仍然是"往上跳/往上飞"，
 * 所以判定只看两次**按下**的时间差。
 */
const DOUBLE_TAP_MS = 320;
/**
 * 动态摇杆的"左手拇指区"（批次 96）：屏幕左下这块区域按下时，摇杆**出现在手指下面**，
 * 而不是固定在角落里（基岩版的"摇杆跟随"模式对大拇指落点更宽容：不用先去找那个圈）。
 * 取值按"竖屏手机左手拇指的自然落点"：横向 45% 以内、纵向 40% 以下那块。
 */
const DYNAMIC_STICK_ZONE = { maxX: 0.45, minY: 0.4 } as const;

/** 摇杆的两种模式（与基岩版一致） */
export type StickMode = 'fixed' | 'dynamic';
/** 设置界面要遍历它（与 `CAMERA_MODES` / `PARTICLE_LEVELS` 同一个套路） */
export const STICK_MODES: readonly StickMode[] = ['fixed', 'dynamic'];
export const STICK_MODE_LABELS: Record<StickMode, string> = {
  fixed: '固定（左下角）',
  dynamic: '跟随手指',
};

export interface TouchActions {
  /**
   * 打开暂停 / 设置菜单（批次 104，屏幕上方正中那颗键）。
   *
   * 这一颗之前**根本没有**：PC 上按 Esc 唤出暂停菜单，而手机上既没有 Esc，
   * 操作层里也没有对应的入口——玩家在手机上打不开设置（音量、视距、灵敏度都改不了），
   * 想退出当前世界也只能靠"返回键退出页面"。基岩版手机就在这个位置放一颗暂停键。
   */
  onOpenPause: () => void;
  /** 轻点抬起：放置 / 交互一次（未进入按住连放时） */
  onTap(): void;
  /** 按住连放开始 / 结束（未拖动、尚未升级为破坏） */
  onPlaceHoldStart(): void;
  onPlaceHoldEnd(): void;
  /** 长按开始 / 结束：破坏方块 */
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
 *
 * setPointerCapture 在指针已失效、或事件是合成出来的时候会抛 NotFoundError，
 * 直接调用会让整个手势处理中断（表现为"按了没反应"）。捕获只是锦上添花
 * （保证手指滑出元素也能收到事件），失败时忽略即可。
 */
function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    /* 指针已失效或为合成事件，忽略 */
  }
}

/** 是否应当启用触摸操作 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  return coarse && hasTouch;
}

/**
 * 当前这套界面是不是"触摸那套"（批次 104）。
 *
 * 判据是 `<body class="touch-mode">`——**与"触摸操作层到底建没建"共用同一个标记**
 * （批次 95 定的规矩：不要再各写一遍 `matchMedia`，那正是"设置项写了但只在
 * 一部分设备上接线"的成因）。但那条标记是 `createTouchControls()` 挂的，
 * 而不少面板（背包标题栏、设置面板）**比它先构造**，所以这里把
 * `isTouchDevice()` 也算进来——两者取或，先构造的面板也能拿到正确答案。
 *
 * 用途：同一块面板上"手机看什么、PC 看什么"的分叉（键盘字母提示只该出现在 PC 上）。
 */
export function isTouchUi(): boolean {
  if (typeof document !== 'undefined' && document.body?.classList.contains('touch-mode')) return true;
  return isTouchDevice();
}

export class TouchControls {
  /** 挂到 HUD 上的根元素 */
  readonly object: HTMLDivElement;

  private readonly lookSurface: HTMLDivElement;
  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly sneakButton: HTMLButtonElement;
  /**
   * 挂在快捷栏两侧的背包/聊天（批次 107）。
   *
   * ⚠️ 它们**不在 `this.object`（#touch-ui）里面**——而是挂进了 `#hotbar`，
   * 所以"隐藏操作层"时要单独把它们收起来（否则打开背包面板时那颗"背包"键
   * 还浮在快捷栏边上）。
   */
  private readonly sideButtons: HTMLButtonElement[] = [];
  /** 顶部中央的暂停键（批次 104）：手机上打开暂停/设置菜单的唯一入口 */
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
  private lookStartX = 0;
  private lookStartY = 0;
  private lookDragged = false;
  private longPressTimer: number | null = null;
  private placeHoldTimer: number | null = null;
  private breaking = false;
  private placeHolding = false;

  private enabled = false;
  private sneaking = false;
  /** 飞行时潜行键是"按住下降"，落地才是切换 */
  private flying = false;
  private sneakHeld = false;
  private stickMode: StickMode = 'fixed';
  /** 上一次"按下跳跃键"的时刻（双击起飞用） */
  private lastJumpDown = 0;
  /** 解绑潜行键当前那一套监听（切换飞行语义时要换） */
  private sneakDetach: (() => void) | null = null;

  constructor(
    host: HTMLElement,
    private readonly actions: TouchActions,
  ) {
    this.object = document.createElement('div');
    this.object.id = 'touch-ui';

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
    this.bindStick();

    // ---- 右下按钮簇（**图标而不是文字**：手机端单字不好认，图标才有一眼可读性）
    //
    // 批次 107 精简成**两颗**：基岩版手机上右手这一簇本来就是"跳 + 潜行"，
    // 其余入口各有各的位置——**背包在快捷栏右边、聊天在快捷栏左边**
    //（见 `mountHotbarSideButtons`），**视角与"创造飞行"在设置里**
    //（原来那六颗把拇指区塞得很满，还容易误触）。
    const buttons = document.createElement('div');
    buttons.id = 'touch-buttons';

    const jump = this.makeIconButton('jump', () => undefined);
    jump.classList.add('jump');
    this.bindHoldButton(jump, (down) => {
      this.jumpHeld = down;
    });
    // 双击跳跃起飞（基岩版手势）：只判"两次按下的间隔"，不影响按住上升
    jump.addEventListener('pointerdown', () => {
      const now = performance.now();
      if (now - this.lastJumpDown <= DOUBLE_TAP_MS) {
        this.lastJumpDown = 0;
        this.actions.onToggleFly();
        return;
      }
      this.lastJumpDown = now;
    });

    // 潜行：地面 = 切换；飞行 = 按住下降（基岩手机）。构造时先按地面语义绑。
    this.sneakButton = this.makeIconButton('sneak', () => undefined);
    this.bindSneakMode(false);

    // DOM 顺序：潜行在左、跳跃在右（CSS 横排右对齐；跳跃更大）
    buttons.append(this.sneakButton, jump);

    // ---- 顶部中央的暂停键（批次 104）
    //
    // ⚠️ **不放进 `#touch-buttons`**：右下那一簇是"右手拇指够得着的操作键"
    //（走、跳、潜行），暂停是"管理"类动作，混在一起既容易误触、
    // 也让拇指区变拥挤；而且验收脚本正是按"右下角那几颗"来量热区与重叠的。
    this.pauseButton = this.makeIconButton('pause', () => this.actions.onOpenPause());
    this.pauseButton.classList.add('pause');
    const pauseBar = document.createElement('div');
    pauseBar.id = 'touch-pause';
    pauseBar.appendChild(this.pauseButton);

    // ---- 操作提示（首次进入时显示，动一下摇杆就淡出）
    this.hint = document.createElement('div');
    this.hint.id = 'touch-hint';
    this.hint.textContent =
      '摇杆走 · 拖动看 · 轻点放 · 按住连放/挖掘 · 双击跳起飞 · 飞时按住潜行下降';

    this.object.append(this.lookSurface, this.stickBase, buttons, pauseBar, this.hint);
    host.appendChild(this.object);

    // 背包/聊天要挂进快捷栏，而快捷栏不在这一层里（见方法注释）——放在最后挂
    this.mountHotbarSideButtons();
  }

  /**
   * 背包 / 聊天挂到**快捷栏两侧**（批次 107，对齐基岩版）。
   *
   * ⚠️ 挂进 `#hotbar` **内部**并绝对定位，而不是放进 `#touch-buttons`：
   *  ① 快捷栏自己就是定位父元素，"贴着它的左右两端"不用算任何像素；
   *  ② 它们不参与那一行 9 个格子的宽度计算——窄屏竖屏手机上 9 × 44px
   *     已经把屏宽占满（约 408px / 430px），再往行里塞按钮就会溢出。
   *
   * 位置由 CSS 决定：屏幕够宽时摆在快捷栏左右两侧，竖屏手机退回"两端上方"
   *（`@media (min-width: 760px)` 那一段，见 index.html）。
   */
  private mountHotbarSideButtons(): void {
    const host = document.getElementById('hotbar') ?? this.object;
    for (const [icon, id, action] of [
      ['chat', 'touch-hotbar-chat', () => this.actions.onOpenChat()],
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
    return !this.object.classList.contains('hidden');
  }

  /** 打开界面时隐藏操作层并清空输入，避免"界面开着人还在走" */
  set visible(value: boolean) {
    this.object.classList.toggle('hidden', !value);
    // 快捷栏两侧那两颗不在操作层里（见 `sideButtons` 的注释），单独收放
    for (const button of this.sideButtons) button.style.display = value ? '' : 'none';
    if (value) return;
    this.resetStick();
    this.cancelLook();
    this.jump = false;
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
      // 地面切换潜行 / 飞行按住下降——两路都喂给物理
      sneak: this.sneaking || this.sneakHeld,
      // 基岩版：摇杆推满即疾跑
      sprint: magnitude >= SPRINT_THRESHOLD,
    };
  }

  /** 取走本帧累积的视角增量（像素），取完即清零 */
  consumeLook(): { x: number; y: number } {
    const delta = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return delta;
  }

  setFlying(flying: boolean): void {
    // 飞行时给整层挂个标记：跳跃/潜行键上会浮出"上升/下降"的小箭头
    this.object.classList.toggle('flying', flying);
    if (this.flying === flying) return;
    this.flying = flying;
    // 起飞时清掉"切换潜行"的亮态——飞着潜行语义是按住，不该还亮着切换灯
    if (flying) {
      this.sneaking = false;
      this.sneakButton.classList.remove('on');
    }
    this.sneakHeld = false;
    this.bindSneakMode(flying);
  }

  /**
   * 地面：点一下切换潜行；飞行：按住下降（松手停）。
   * 换绑前先卸掉上一套，避免两套监听叠在一起。
   */
  private bindSneakMode(flying: boolean): void {
    this.sneakDetach?.();
    this.sneakDetach = null;
    if (flying) {
      const onDown = (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        this.sneakHeld = true;
        this.sneakButton.classList.add('on');
        try {
          this.sneakButton.setPointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
      };
      const onUp = (event: PointerEvent) => {
        event.preventDefault();
        this.sneakHeld = false;
        this.sneakButton.classList.remove('on');
      };
      this.sneakButton.addEventListener('pointerdown', onDown);
      this.sneakButton.addEventListener('pointerup', onUp);
      this.sneakButton.addEventListener('pointercancel', onUp);
      this.sneakDetach = () => {
        this.sneakButton.removeEventListener('pointerdown', onDown);
        this.sneakButton.removeEventListener('pointerup', onUp);
        this.sneakButton.removeEventListener('pointercancel', onUp);
      };
      return;
    }
    const onToggle = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.sneaking = !this.sneaking;
      this.sneakButton.classList.toggle('on', this.sneaking);
      this.actions.onToggleSneak();
    };
    this.sneakButton.addEventListener('pointerdown', onToggle);
    this.sneakDetach = () => this.sneakButton.removeEventListener('pointerdown', onToggle);
  }

  /**
   * 摇杆模式：`fixed` 固定在左下角；`dynamic` 在左下拇指区**按下即出现在手指下**。
   *
   * 与基岩版的两档一致：固定模式靠位置形成肌肉记忆，动态模式对"躺着玩 / 单手玩"更宽容。
   */
  setStickMode(mode: StickMode): void {
    this.stickMode = mode;
    this.stickBase.classList.toggle('dynamic', mode === 'dynamic');
    if (mode === 'fixed') this.resetStick();
  }

  /** 同步潜行状态（键盘切换时按钮也要跟着变） */
  setSneaking(sneaking: boolean): void {
    this.sneaking = sneaking;
    this.sneakButton.classList.toggle('on', sneaking);
  }

  get isSneaking(): boolean {
    return this.sneaking;
  }

  dismissHint(): void {
    this.hint.classList.add('fade');
  }

  // ---------------------------------------------------------------- 内部实现

  /**
   * 一个圆形图标按钮。
   *
   * 图标是内联 SVG（`currentColor`），文字只留在 `aria-label`/`title` 里——
   * 屏幕上不写中文单字，但读屏与桌面端悬停仍能看到"这是什么"。
   */
  private makeIconButton(icon: TouchIconName, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'touch-button';
    button.dataset.icon = icon;
    button.innerHTML = touchIconSvg(icon);
    button.setAttribute('aria-label', TOUCH_ICON_LABELS[icon]);
    button.title = TOUCH_ICON_LABELS[icon];
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    // 触摸端可能同时派发 click，这里吞掉以免重复触发
    button.addEventListener('click', (event) => event.preventDefault());
    return button;
  }

  private bindHoldButton(button: HTMLButtonElement, onChange: (down: boolean) => void): void {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      onChange(true);
      button.setPointerCapture(event.pointerId);
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

  /** 这一点在不在"左手拇指区"里（动态摇杆用） */
  private isInStickZone(event: PointerEvent): boolean {
    const x = event.clientX / Math.max(1, window.innerWidth);
    const y = event.clientY / Math.max(1, window.innerHeight);
    return x <= DYNAMIC_STICK_ZONE.maxX && y >= DYNAMIC_STICK_ZONE.minY;
  }

  /**
   * 动态摇杆：把摇杆搬到手指下面并接管这根手指。
   *
   * ⚠️ 半径沿用固定模式那个圈（`stickRadius`）而不是按落点重算：手指落点各不相同，
   * 半径若跟着变，同样的拖动距离会得到不同的速度（"忽快忽慢"比"位置固定"更难受）。
   * 移动/抬起的事件挂在**视角面**上——手指根本不在那个圈里，挂在圈上收不到。
   */
  private beginDynamicStick(event: PointerEvent): void {
    // 半径按元素实测（动态模式下它是 `opacity: 0` 但**仍然可测量**——这也是
    // 这里不能用 `display: none` 的原因：那个矩形会变成 0，摇杆"按下去就死"）
    const rect = this.stickBase.getBoundingClientRect();
    const radius = rect.width > 0 ? rect.width / 2 : this.stickRadius;
    this.stickRadius = radius;
    this.stickBase.style.left = `${event.clientX - radius}px`;
    this.stickBase.style.top = `${event.clientY - radius}px`;
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
      this.resetStick();
      // 抬手之后摇杆回到"隐形待命"，下次按下再出现在新位置
      this.stickBase.style.left = '';
      this.stickBase.style.top = '';
      this.stickBase.style.bottom = '';
    };
    this.lookSurface.addEventListener('pointermove', move);
    this.lookSurface.addEventListener('pointerup', release);
    this.lookSurface.addEventListener('pointercancel', release);
  }

  private bindStick(): void {
    this.stickBase.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const rect = this.stickBase.getBoundingClientRect();
      this.stickCenterX = rect.left + rect.width / 2;
      this.stickCenterY = rect.top + rect.height / 2;
      this.stickRadius = rect.width / 2;
      this.stickPointer = event.pointerId;
      capturePointer(this.stickBase, event.pointerId);
      this.stickBase.classList.add('active');
      this.applyStick(event);
    });

    this.stickBase.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      this.applyStick(event);
    });

    const release = (event: PointerEvent) => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      this.resetStick();
    };
    this.stickBase.addEventListener('pointerup', release);
    this.stickBase.addEventListener('pointercancel', release);
  }

  /**
   * 摇杆位移 → 输入分量（固定与动态两种模式共用）。
   *
   * 归一化到 -1~1 且**超出半径截断**：手指拖远不会加速（基岩版也是这个手感）。
   */
  private applyStick(event: PointerEvent): void {
    const dx = event.clientX - this.stickCenterX;
    const dy = event.clientY - this.stickCenterY;
    const distance = Math.hypot(dx, dy);
    const clamped = Math.min(distance, this.stickRadius);
    const ratio = distance === 0 ? 0 : clamped / distance;
    const nx = distance === 0 ? 0 : (dx / distance) * ratio * (distance / this.stickRadius);
    const ny = distance === 0 ? 0 : (dy / distance) * ratio * (distance / this.stickRadius);

    this.stickKnob.style.transform = `translate(${nx * this.stickRadius}px, ${ny * this.stickRadius}px)`;
    // 屏幕上方为前进，所以取负
    this.forward = -ny;
    this.strafe = nx;
    if (distance > TAP_MOVE_SLOP) this.dismissHint();
  }

  private resetStick(): void {
    this.stickPointer = null;
    this.forward = 0;
    this.strafe = 0;
    this.stickKnob.style.transform = 'translate(0px, 0px)';
    this.stickBase.classList.remove('active');
  }

  private bindLookSurface(): void {
    this.lookSurface.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      // 动态摇杆（批次 96）：左下拇指区按下 = 走（基岩版的组织方式：左手管走、右手管看）。
      // 接管之后这根手指不再参与视角，也不再触发轻点/长按
      if (this.stickMode === 'dynamic' && this.stickPointer === null && this.isInStickZone(event)) {
        this.beginDynamicStick(event);
        return;
      }
      // 同时只跟一根手指，第二根手指不参与视角，避免多点触控时视角乱飘
      if (this.lookPointer !== null) return;

      this.lookPointer = event.pointerId;
      this.lookStartX = event.clientX;
      this.lookStartY = event.clientY;
      this.lastMoveX = event.clientX;
      this.lastMoveY = event.clientY;
      this.lookDragged = false;
      this.breaking = false;
      this.placeHolding = false;
      capturePointer(this.lookSurface, event.pointerId);

      // 按住一小段 → 连续放置（基岩手机建造）；再久一点 → 改成挖掘
      this.placeHoldTimer = window.setTimeout(() => {
        if (this.lookDragged || this.breaking) return;
        this.placeHolding = true;
        this.actions.onPlaceHoldStart();
      }, PLACE_HOLD_MS);

      this.longPressTimer = window.setTimeout(() => {
        if (this.lookDragged) return;
        // 挖掘优先：先停掉连放，再开破坏
        this.endPlaceHold();
        this.breaking = true;
        this.actions.onBreakStart();
      }, LONG_PRESS_MS);
    });

    this.lookSurface.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.lookPointer) return;
      event.preventDefault();

      const dx = event.clientX - this.lookStartX;
      const dy = event.clientY - this.lookStartY;

      if (!this.lookDragged && Math.hypot(dx, dy) > TAP_MOVE_SLOP) {
        this.lookDragged = true;
        this.clearGestureTimers();
        this.endPlaceHold();
      }

      if (this.lookDragged && !this.breaking) {
        // 累积到主循环统一应用，保证视角更新与物理同帧
        this.lookX += event.clientX - this.lastMoveX;
        this.lookY += event.clientY - this.lastMoveY;
      }
      this.lastMoveX = event.clientX;
      this.lastMoveY = event.clientY;
    });

    const finish = (event: PointerEvent) => {
      if (event.pointerId !== this.lookPointer) return;
      event.preventDefault();
      this.clearGestureTimers();

      if (this.breaking) {
        this.breaking = false;
        this.actions.onBreakEnd();
      } else if (this.placeHolding) {
        this.endPlaceHold();
      } else if (!this.lookDragged) {
        // 短于连放阈值抬起 = 轻点一次（放置 / 交互）
        this.actions.onTap();
      }
      this.lookPointer = null;
    };

    this.lookSurface.addEventListener('pointerup', finish);
    this.lookSurface.addEventListener('pointercancel', finish);
    // 拖出屏幕边缘也要结束手势，否则会卡在"一直按住"
    this.lookSurface.addEventListener('lostpointercapture', finish);
  }

  private lastMoveX = 0;
  private lastMoveY = 0;

  private clearGestureTimers(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    if (this.placeHoldTimer !== null) {
      clearTimeout(this.placeHoldTimer);
      this.placeHoldTimer = null;
    }
  }

  private endPlaceHold(): void {
    if (this.placeHoldTimer !== null) {
      clearTimeout(this.placeHoldTimer);
      this.placeHoldTimer = null;
    }
    if (!this.placeHolding) return;
    this.placeHolding = false;
    this.actions.onPlaceHoldEnd();
  }

  private cancelLook(): void {
    this.clearGestureTimers();
    this.endPlaceHold();
    this.lookPointer = null;
    this.lookDragged = false;
    if (!this.breaking) return;
    this.breaking = false;
    this.actions.onBreakEnd();
  }

  /** 主循环在每帧开始处调用；界面打开时禁用 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
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
