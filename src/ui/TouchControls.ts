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
 *  - 按住不放（未拖动，≥280ms）：破坏方块 / 持续攻击
 *  - **生存：右侧只有一颗跳跃键**
 *  - **创造：双击跳跃起飞 → 右侧出现上升 / 下降键**；再双击跳跃落地，升降键消失
 *  - 顶部三键：暂停 / 视角 / 聊天；快捷栏右侧：背包
 */

import type { PlayerInput } from '../core/physics/PlayerPhysics.ts';
import { HOTBAR_SIZE } from '../core/container/Inventory.ts';
import { diag } from '../game/diagnosticsRuntime.ts';
import { TOUCH_ICON_LABELS, touchIconSvg, type TouchIconName } from './TouchIcons.ts';

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
 * 超过这个时长（毫秒）就算长按，升级为破坏 / 持续攻击（批次 181）。
 *
 * ⚠️ 批次 181 删掉了原来的 140ms"按住连续放置"：手机上一次普通点按通常有
 * 100~200ms，手指还没抬起来连放就触发了——玩家看到的是"一碰就放方块"，
 * 而长按破坏反而被放置抢先。现在只有一个阈值：
 *  - 抬手早于 280ms → **轻点**：交互 / 攻击 / 放置一次；
 *  - 按住超过 280ms → **破坏 / 持续攻击**。
 */
const LONG_PRESS_MS = 280;
/** 按下后位移超过这个像素数就算拖动视角，不再是点击 */
const TAP_MOVE_SLOP = 12;
/** 摇杆推到该比例以上自动疾跑 */
const SPRINT_THRESHOLD = 0.92;
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
export const STICK_MODE_LABELS: Record<StickMode, string> = {
  fixed: '固定（左下角）',
  dynamic: '跟随手指',
};

export interface TouchActions {
  /**
   * 打开暂停 / 设置菜单（批次 104，屏幕上方正中那颗键）。
   */
  onOpenPause: () => void;
  /** 切换第一/第三人称（批次 181，顶部第二颗键） */
  onCycleCamera(): void;
  /** 轻点抬起：交互 / 攻击 / 放置一次 */
  onTap(): void;
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
  private lookStartX = 0;
  private lookStartY = 0;
  private lookDragged = false;
  private longPressTimer: number | null = null;
  private breaking = false;

  private enabled = false;
  private sneaking = false;
  private flying = false;
  private sneakHeld = false;
  private stickMode: StickMode = 'fixed';
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

    // ---- 右下按钮簇（基岩手机）：
    //  生存 → **只有跳跃**；创造双击起飞 → 上下多出上升/下降两颗。
    const buttons = document.createElement('div');
    buttons.id = 'touch-buttons';

    this.flyUpButton = this.makeIconButton('jump', () => undefined);
    this.flyUpButton.classList.add('fly-only', 'fly-up');
    this.flyUpButton.setAttribute('aria-label', '向上飞');
    this.flyUpButton.title = '向上飞';
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
    this.flyDownButton.setAttribute('aria-label', '向下飞');
    this.flyDownButton.title = '向下飞';
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
    pauseBar.append(this.pauseButton, viewButton, chatButton);

    // ---- 操作提示
    this.hint = document.createElement('div');
    this.hint.id = 'touch-hint';
    this.hint.textContent =
      '摇杆走 · 双击摇杆潜行 · 拖动看 · 轻点放 · 按住连放/挖 · 双击跳起飞（飞时出升降键）';

    this.object.append(this.lookSurface, this.stickBase, buttons, pauseBar, this.hint);
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
    return !this.object.classList.contains('hidden');
  }

  /** 打开界面时隐藏操作层并清空输入，避免"界面开着人还在走" */
  set visible(value: boolean) {
    this.object.classList.toggle('hidden', !value);
    for (const button of this.sideButtons) button.style.display = value ? '' : 'none';
    if (value) return;
    this.resetStick();
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
      // 起飞时清掉地面潜行亮态
      this.sneaking = false;
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
    if (mode === 'fixed') this.resetStick();
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
    button.setAttribute('aria-label', TOUCH_ICON_LABELS[icon]);
    button.title = TOUCH_ICON_LABELS[icon];
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
    return x <= DYNAMIC_STICK_ZONE.maxX && y >= DYNAMIC_STICK_ZONE.minY;
  }

  private beginDynamicStick(event: PointerEvent): void {
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
        forward: Math.round(this.forward * 100) / 100,
        strafe: Math.round(this.strafe * 100) / 100,
      });
      this.resetStick();
    };
    this.stickBase.addEventListener('pointerup', release);
    this.stickBase.addEventListener('pointercancel', release);
  }

  private applyStick(event: PointerEvent): void {
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
      if (this.stickMode === 'dynamic' && this.stickPointer === null && this.isInStickZone(event)) {
        this.beginDynamicStick(event);
        return;
      }
      if (this.lookPointer !== null) return;

      this.lookPointer = event.pointerId;
      this.lookStartX = event.clientX;
      this.lookStartY = event.clientY;
      this.lastMoveX = event.clientX;
      this.lastMoveY = event.clientY;
      this.lookDragged = false;
      this.breaking = false;
      capturePointer(this.lookSurface, event.pointerId);
      diag.event('gesture', 'look.down', {
        pointer: event.pointerId,
        x: Math.round(event.clientX),
        y: Math.round(event.clientY),
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

      const dx = event.clientX - this.lookStartX;
      const dy = event.clientY - this.lookStartY;

      if (!this.lookDragged && Math.hypot(dx, dy) > TAP_MOVE_SLOP) {
        this.lookDragged = true;
        diag.event('gesture', 'look.drag.start', {
          pointer: event.pointerId,
          dx: Math.round(dx),
          dy: Math.round(dy),
        });
        this.clearGestureTimers();
      }

      if (this.lookDragged && !this.breaking) {
        this.lookX += event.clientX - this.lastMoveX;
        this.lookY += event.clientY - this.lastMoveY;
      }
      this.lastMoveX = event.clientX;
      this.lastMoveY = event.clientY;
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

      if (this.breaking) {
        this.breaking = false;
        this.actions.onBreakEnd();
      } else if (!this.lookDragged) {
        // 松手早于长按阈值 → 轻点：主程序按"生物/方块/可放置点"决定攻击、交互还是放置
        this.actions.onTap();
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

  private cancelLook(): void {
    this.clearGestureTimers();
    this.lookPointer = null;
    this.lookDragged = false;
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
    this.resetStick();
    this.jumpHeld = false;
    this.sneakHeld = false;
    // 双击计时也清掉：切换之后紧接着的一次按下不该被当成"第二次点击"
    this.lastJumpDown = 0;
    this.lastStickDown = 0;
    diag.event('input', 'resetInput', { reason, before, after: this.debugState });
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
    this.resetStick();
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
