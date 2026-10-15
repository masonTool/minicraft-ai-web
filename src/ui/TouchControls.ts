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

/** 超过这个时长（毫秒）就算长按，升级为破坏 */
const LONG_PRESS_MS = 220;
/** 按下后位移超过这个像素数就算拖动视角，不再是点击 */
const TAP_MOVE_SLOP = 12;
/** 摇杆推到该比例以上自动疾跑 */
const SPRINT_THRESHOLD = 0.92;

export interface TouchActions {
  /** 切换人称视角（F7）：第一人称 → 背后 → 正面 → … */
  onCycleView: () => void;
  /** 轻点：放置方块或与目标方块交互 */
  onTap(): void;
  /** 长按开始 / 结束：破坏方块 */
  onBreakStart(): void;
  onBreakEnd(): void;
  onToggleInventory(): void;
  onToggleFly(): void;
  onToggleSneak(): void;
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

export class TouchControls {
  /** 挂到 HUD 上的根元素 */
  readonly object: HTMLDivElement;

  private readonly lookSurface: HTMLDivElement;
  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly flyButton: HTMLButtonElement;
  private readonly sneakButton: HTMLButtonElement;

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

    // ---- 右下按钮簇
    const buttons = document.createElement('div');
    buttons.id = 'touch-buttons';

    const jump = this.makeButton('跳', () => undefined);
    jump.classList.add('jump');
    this.bindHoldButton(jump, (down) => {
      this.jumpHeld = down;
    });

    this.sneakButton = this.makeButton('潜', () => {
      this.sneaking = !this.sneaking;
      this.sneakButton.classList.toggle('on', this.sneaking);
      this.actions.onToggleSneak();
    });

    this.flyButton = this.makeButton('飞', () => this.actions.onToggleFly());

    const inventory = this.makeButton('包', () => this.actions.onToggleInventory());
    // 视：手机上按不了 V 键，给一个按钮循环切换人称视角
    const view = this.makeButton('视', () => this.actions.onCycleView());

    buttons.append(this.flyButton, this.sneakButton, view, inventory, jump);

    // ---- 操作提示（首次进入时显示，动一下摇杆就淡出）
    this.hint = document.createElement('div');
    this.hint.id = 'touch-hint';
    this.hint.textContent = '左摇杆移动 · 拖动屏幕转视角 · 轻点放置 · 长按破坏';

    this.object.append(this.lookSurface, this.stickBase, buttons, this.hint);
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

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'touch-button';
    button.textContent = label;
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

  private bindStick(): void {
    const update = (event: PointerEvent) => {
      const dx = event.clientX - this.stickCenterX;
      const dy = event.clientY - this.stickCenterY;
      const distance = Math.hypot(dx, dy);
      // 归一化到 -1~1：超出摇杆半径就截断，手指拖远也不会加速
      const clamped = Math.min(distance, this.stickRadius);
      const ratio = distance === 0 ? 0 : clamped / distance;
      const nx = distance === 0 ? 0 : (dx / distance) * ratio * (distance / this.stickRadius);
      const ny = distance === 0 ? 0 : (dy / distance) * ratio * (distance / this.stickRadius);

      this.stickKnob.style.transform = `translate(${nx * this.stickRadius}px, ${ny * this.stickRadius}px)`;
      // 屏幕上方为前进，所以取负
      this.forward = -ny;
      this.strafe = nx;
      if (distance > TAP_MOVE_SLOP) this.dismissHint();
    };

    this.stickBase.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const rect = this.stickBase.getBoundingClientRect();
      this.stickCenterX = rect.left + rect.width / 2;
      this.stickCenterY = rect.top + rect.height / 2;
      this.stickRadius = rect.width / 2;
      this.stickPointer = event.pointerId;
      capturePointer(this.stickBase, event.pointerId);
      this.stickBase.classList.add('active');
      update(event);
    });

    this.stickBase.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      update(event);
    });

    const release = (event: PointerEvent) => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      this.resetStick();
    };
    this.stickBase.addEventListener('pointerup', release);
    this.stickBase.addEventListener('pointercancel', release);
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
