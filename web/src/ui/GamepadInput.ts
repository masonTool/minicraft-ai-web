/**
 * 手柄输入（Gamepad API）
 *
 * 设计原则与触摸端一致：**不复刻按键，而是把手柄翻译成同一套 `PlayerInput`**。
 * 左摇杆产出 forward/strafe，A 产出 jump，B 产出 sneak，摇杆按下产出 sprint，
 * 直接喂给现有的 `PlayerPhysics`，因此手柄与键盘/触摸的手感（速度、重力、上台阶）完全一致。
 *
 * 键位（Xbox 布局，其他手柄的按钮编号基本一致）：
 *   左摇杆     移动（推满自动疾跑，与触摸端同一套逻辑）
 *   右摇杆     转视角（按帧速率乘时间增量，与触摸拖动同样走 applyLook）
 *   A(0)       跳跃        B(1)  潜行切换      X(2)  背包
 *   RT(7)      破坏方块    LT(6) 放置方块
 *   左摇杆按下  疾跑
 *
 * 一次性动作（跳跃、开背包、放置）用**边沿检测**：只在按下的那一帧返回 true，
 * 否则按住不放会每帧触发一次，变成连发。
 */

/** 手柄这一帧的输入（没有连接手柄时 poll 返回 null） */
export interface GamepadOverride {
  forward: number;
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  /** 视角增量（像素，与触摸拖动同一量纲）：由右摇杆换算 */
  lookDx: number;
  lookDy: number;
  /** 按住即持续（破坏方块） */
  attack: boolean;
  /** 按住即持续（放置方块 / 使用） */
  use: boolean;
  /** 按下的那一帧为 true */
  jumpPressed: boolean;
  openInventoryPressed: boolean;
}

/** 摇杆死区：低于这个值视为没推（手柄回中不准，没有死区会一直漂移） */
const DEAD_ZONE = 0.18;
/** 推满这个比例就算疾跑（与触摸摇杆的"推满即冲刺"一致） */
const SPRINT_THRESHOLD = 0.92;
/** 右摇杆满推时每秒转多少像素的视角（调到手感接近鼠标灵敏度） */
const LOOK_SPEED = 900;

function applyDeadZone(value: number, deadZone = DEAD_ZONE): number {
  if (Math.abs(value) < deadZone) return 0;
  // 死区之外重新归一化到 0~1，避免"刚出死区就跳变"
  const sign = value < 0 ? -1 : 1;
  return sign * ((Math.abs(value) - deadZone) / (1 - deadZone));
}

/**
 * 收到过 `gamepadconnected` 才开始轮询（批次 20261030-2316）。
 * 每帧 `getGamepads()` 会让浏览器起一条手柄轮询线程（安卓 WebView 上实测约 2% CPU），
 * 而绝大多数手机根本没接手柄。浏览器在手柄第一次按键时就会派发这个事件，不会漏掉。
 * 放在模块级：回主菜单再进世界会新建 `GamepadInput`，已连着的手柄不会再派发一次连接事件。
 */
let armed = false;
if (typeof window !== 'undefined') {
  window.addEventListener('gamepadconnected', () => {
    armed = true;
  });
}

export class GamepadInput {
  /** 当前连接的手柄名（空串表示没连接） */
  name = '';
  /** 上一帧的按键状态，用于边沿检测 */
  private readonly previous = new Map<number, boolean>();
  /** 潜行是"切换"式的：手柄只有按钮没有按住的说法，切换更顺手 */
  private sneakToggle = false;
  get connected(): boolean {
    return this.name !== '';
  }

  /** 每帧调用；没有手柄时返回 null（调用方就不用管分支了） */
  poll(dt: number): GamepadOverride | null {
    if (!armed) return null;
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = pads.find((candidate): candidate is Gamepad => candidate !== null && candidate.connected);
    if (!pad) {
      // 拔掉之后停止轮询，等下一次 `gamepadconnected`
      armed = false;
      if (this.name !== '') {
        this.name = '';
        this.previous.clear();
        this.sneakToggle = false;
      }
      return null;
    }
    this.name = pad.id;

    const held = (index: number): boolean => pad.buttons[index]?.pressed ?? false;
    const justPressed = (index: number): boolean => held(index) && !this.previous.get(index);

    // 左摇杆：Y 轴向上是负值，所以要取反
    const forward = applyDeadZone(-(pad.axes[1] ?? 0));
    const strafe = applyDeadZone(pad.axes[0] ?? 0);
    // 右摇杆转视角（与触摸端一样"推得越远转得越快"）
    const lookX = applyDeadZone(pad.axes[2] ?? 0);
    const lookY = applyDeadZone(pad.axes[3] ?? 0);

    const jumpHeld = held(0);
    const jumpPressed = justPressed(0);
    const sneakPressed = justPressed(1);
    if (sneakPressed) this.sneakToggle = !this.sneakToggle;
    const openInventoryPressed = justPressed(2);
    const sprintHeld = held(10) || Math.hypot(forward, strafe) >= SPRINT_THRESHOLD;

    // 记录本帧按键，供下一帧做边沿检测
    for (let i = 0; i < pad.buttons.length; i++) {
      this.previous.set(i, pad.buttons[i]?.pressed ?? false);
    }

    return {
      forward,
      strafe,
      jump: jumpHeld,
      sneak: this.sneakToggle,
      sprint: sprintHeld,
      lookDx: lookX * LOOK_SPEED * dt,
      lookDy: -lookY * LOOK_SPEED * dt,
      attack: held(7),
      use: held(6),
      jumpPressed,
      openInventoryPressed,
    };
  }
}
