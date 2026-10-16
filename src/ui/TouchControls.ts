/**
 * 触摸操作层（手机/平板）
 *
 * 设计原则：**不复刻键盘，而是把触摸手势翻译成同一套输入**。
 * 摇杆产出 forward/strafe、按钮产出 jump/sneak/sprint，直接喂给现有的 PlayerPhysics，
 * 因此移动手感（速度、重力、自动上台阶）在手机与桌面完全一致，不需要两套物理。
 *
 * 手势约定对齐基岩版：
 *  - 左下角摇杆：拖动移动；推到几乎到底会自动疾跑（基岩版的"推满即冲刺"）
 *  - 屏幕任意处拖动：转动视角
 *  - 轻点：放置方块 / 与方块交互（开箱子、开门、开工作台）
 *  - 长按：持续破坏方块（松手停止）
 *  - 右下角按钮：跳跃 / 潜行（切换）/ 飞行（切换）/ 背包
 *
 * 轻点与长按的区分靠"按下时长 + 位移"两个条件：位移超过阈值就算转视角，
 * 时长超过阈值就升级成长按破坏。这样手指略微抖动不会误判。
 */

import type { PlayerInput } from '../core/physics/PlayerPhysics.ts';
import { HOTBAR_SIZE } from '../core/container/Inventory.ts';
import { TOUCH_ICON_LABELS, touchIconSvg, type TouchIconName } from './TouchIcons.ts';

/** 超过这个时长（毫秒）就算长按，升级为破坏 */
const LONG_PRESS_MS = 220;
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
  /** 切换人称视角（F7）：第一人称 → 背后 → 正面 → … */
  onCycleView: () => void;
  /**
   * 打开暂停 / 设置菜单（批次 104，屏幕上方正中那颗键）。
   *
   * 这一颗之前**根本没有**：PC 上按 Esc 唤出暂停菜单，而手机上既没有 Esc，
   * 操作层里也没有对应的入口——玩家在手机上打不开设置（音量、视距、灵敏度都改不了），
   * 想退出当前世界也只能靠"返回键退出页面"。基岩版手机就在这个位置放一颗暂停键。
   */
  onOpenPause: () => void;
  /** 轻点：放置方块或与目标方块交互 */
  onTap(): void;
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
  private readonly flyButton: HTMLButtonElement;
  private readonly sneakButton: HTMLButtonElement;
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
  private lookStartTime = 0;
  private lookDragged = false;
  private longPressTimer: number | null = null;
  private breaking = false;

  private enabled = false;
  private sneaking = false;
  private stickMode: StickMode = 'fixed';
  /** 上一次"按下跳跃键"的时刻（双击起飞用） */
  private lastJumpDown = 0;

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

    // ---- 右下按钮簇（**图标而不是文字**：手机端五个单字不好认，图标才有一眼可读性）
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

    this.sneakButton = this.makeIconButton('sneak', () => {
      this.sneaking = !this.sneaking;
      this.sneakButton.classList.toggle('on', this.sneaking);
      this.actions.onToggleSneak();
    });

    this.flyButton = this.makeIconButton('fly', () => this.actions.onToggleFly());

    const inventory = this.makeIconButton('inventory', () => this.actions.onToggleInventory());
    // 手机上没有 V 键，给一个按钮循环切换人称视角
    const view = this.makeIconButton('view', () => this.actions.onCycleView());
    // 手机上也没有 T 与 /，聊天与命令必须有个入口
    const chat = this.makeIconButton('chat', () => this.actions.onOpenChat());

    buttons.append(chat, view, this.flyButton, this.sneakButton, inventory, jump);

    // ---- 顶部中央的暂停键（批次 104）
    //
    // ⚠️ **不放进 `#touch-buttons`**：右下那一簇是"右手拇指够得着的操作键"
    //（走、跳、潜行、飞、背包、聊天），暂停是"管理"类动作，混在一起既容易误触、
    // 也让拇指区变拥挤；而且验收脚本正是按"右下角 6 颗"来量热区与重叠的。
    this.pauseButton = this.makeIconButton('pause', () => this.actions.onOpenPause());
    this.pauseButton.classList.add('pause');
    const pauseBar = document.createElement('div');
    pauseBar.id = 'touch-pause';
    pauseBar.appendChild(this.pauseButton);

    // ---- 操作提示（首次进入时显示，动一下摇杆就淡出）
    this.hint = document.createElement('div');
    this.hint.id = 'touch-hint';
    this.hint.textContent =
      '左摇杆移动 · 拖动转视角 · 轻点放置 · 长按破坏 · 双击跳跃起飞 · 长按物品看详情';

    this.object.append(this.lookSurface, this.stickBase, buttons, pauseBar, this.hint);
    host.appendChild(this.object);
  }

  // ---------------------------------------------------------------- 对外接口

  get visible(): boolean {
    return !this.object.classList.contains('hidden');
  }

  /** 打开界面时隐藏操作层并清空输入，避免"界面开着人还在走" */
  set visible(value: boolean) {
    this.object.classList.toggle('hidden', !value);
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
      sneak: this.sneaking,
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
    this.flyButton.classList.toggle('on', flying);
    // 飞行时给整层挂个标记：跳跃/潜行键上会浮出"上升/下降"的小箭头
    //（基岩版也这么提示——飞起来之后那两颗键的含义变了，不提示就只能靠试）
    this.object.classList.toggle('flying', flying);
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
      this.lookStartTime = performance.now();
      this.lookDragged = false;
      capturePointer(this.lookSurface, event.pointerId);

      // 按住不动到阈值 → 升级为长按破坏
      this.longPressTimer = window.setTimeout(() => {
        if (this.lookDragged) return;
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
        this.clearLongPress();
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
      this.clearLongPress();

      const elapsed = performance.now() - this.lookStartTime;
      if (this.breaking) {
        this.breaking = false;
        this.actions.onBreakEnd();
      } else if (!this.lookDragged && elapsed < LONG_PRESS_MS) {
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

  private clearLongPress(): void {
    if (this.longPressTimer === null) return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private cancelLook(): void {
    this.clearLongPress();
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
