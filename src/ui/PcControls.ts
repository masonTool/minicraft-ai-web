/**
 * PC（键鼠）端 HUD 按钮层（用户要求 2026-10-25）
 *
 * 用户口径：
 *  1. **PC 版的界面要跟手机版保持一致** —— 手机上有的那几颗按钮，PC 上也全都看得见；
 *  2. **每颗按钮上方要写清对应哪个键** —— 键鼠玩家真正按的是键盘，按钮是"看得见的入口"。
 *
 * 与 `TouchControls` 的分工：
 *  - 这个类**只管"看得见的壳"**：顶部聊天/暂停/视角、右下跳跃（飞行时上下再出升降）、
 *    快捷栏右侧背包，左下角一块 WASD 键位图例（手机那儿是摇杆）；
 *  - 手势那套（摇杆、视角拖动、白圈、长按破坏、指针坐标异常恢复）**全部不搬**——
 *    鼠标走指针锁 + 左右键，键盘走 `main.ts` 的 keydown，两条路径本来就已经齐了。
 *
 * 为什么单独一个模块而不是塞进 `TouchControls`：那边每一个字段都围着多指手势转
 * （`lookPointer` / `stickPointer` / 死区 / 白圈），桌面端一条都用不上；混在一起之后
 * 任何一处手势修复都要先判断"这是不是鼠标"，迟早会把两条输入路径搅在一起。
 * 视觉复用倒是零成本的：按钮样式是 `.touch-button` 这类**类级**选择器，直接套上即可。
 *
 * 按钮可点：没锁指针时（菜单刚关、鼠标还能动）点一下就是对应的那个键；
 * 进了游戏指针被锁住，按钮退化成"看得见的键位提示"——这正是键鼠玩家的用法。
 */

import { t } from '../core/i18n/I18n.ts';
import { touchIconLabel, touchIconSvg, type TouchIconName } from './TouchIcons.ts';

/**
 * 每颗按钮上方那枚键帽写什么。
 *
 * ⚠️ **不进 i18n**：键名与 `settings.helpDesktop` 里那份键盘说明是同一套写法
 * （`Esc` / `Space` / `Shift` / `WASD` 六种语言都原样显示）。把 "Space" 翻成
 * "空格" 之后，玩家反而得先猜"这是哪个键"。
 */
export const PC_KEY_HINTS = {
  chat: 'T',
  pause: 'Esc',
  view: 'V',
  inventory: 'E',
  jump: 'Space',
  flyUp: 'Space',
  flyDown: 'Shift',
} as const;

export interface PcActions {
  /** 打开暂停 / 设置菜单（手机上点顶部中间那颗，PC 上等于 Esc） */
  onOpenPause(): void;
  /** 切换第一/第三人称（等于键盘 V） */
  onCycleCamera(): void;
  onToggleInventory(): void;
  onOpenChat(): void;
}

export interface PcDebugState {
  visible: boolean;
  jumpHeld: boolean;
  sneakHeld: boolean;
  flying: boolean;
}

export class PcControls {
  /** 挂在 `#hud` 上的根元素 */
  readonly object: HTMLDivElement;

  private readonly jumpButton: HTMLButtonElement;
  private readonly flyUpButton: HTMLButtonElement;
  private readonly flyDownButton: HTMLButtonElement;
  /** 挂在快捷栏上的背包键（不在 `this.object` 里，与手机端同一个位置） */
  private readonly sideButtons: HTMLButtonElement[] = [];

  private jumpHeld = false;
  private sneakHeld = false;
  private flying = false;

  constructor(
    host: HTMLElement,
    private readonly actions: PcActions,
  ) {
    // PC 标记：CSS 靠它给 boss 血条之类让出顶部那一条（手机是 `body.touch-mode`）
    document.body.classList.add('pc-mode');

    this.object = document.createElement('div');
    this.object.id = 'pc-ui';

    // ---- 顶部三键：与手机**同一组、同一顺序**（聊天 / 暂停 / 视角）
    const pauseBar = document.createElement('div');
    pauseBar.id = 'pc-pause';
    pauseBar.append(
      this.makeButton('chat', PC_KEY_HINTS.chat, () => this.actions.onOpenChat()),
      this.makeButton('pause', PC_KEY_HINTS.pause, () => this.actions.onOpenPause()),
      this.makeButton('view', PC_KEY_HINTS.view, () => this.actions.onCycleCamera()),
    );

    // ---- 右下：跳跃（生存只有它；创造飞行时上下多出升降，与手机一致）
    const buttons = document.createElement('div');
    buttons.id = 'pc-buttons';

    this.flyUpButton = this.makeButton('jump', PC_KEY_HINTS.flyUp, () => undefined, ['fly-only', 'fly-up']);
    this.flyUpButton.setAttribute('aria-label', t('touch.flyUp'));
    this.flyUpButton.title = `${t('touch.flyUp')} (${PC_KEY_HINTS.flyUp})`;
    this.bindHold(this.flyUpButton, (down) => {
      this.jumpHeld = down;
    });

    this.jumpButton = this.makeButton('jump', PC_KEY_HINTS.jump, () => undefined);
    this.jumpButton.classList.add('jump');
    this.bindHold(this.jumpButton, (down) => {
      this.jumpHeld = down;
    });

    this.flyDownButton = this.makeButton('sneak', PC_KEY_HINTS.flyDown, () => undefined, ['fly-only', 'fly-down']);
    this.flyDownButton.setAttribute('aria-label', t('touch.flyDown'));
    this.flyDownButton.title = `${t('touch.flyDown')} (${PC_KEY_HINTS.flyDown})`;
    this.bindHold(this.flyDownButton, (down) => {
      this.sneakHeld = down;
    });

    buttons.append(this.flyUpButton, this.jumpButton, this.flyDownButton);

    // ---- 左下：手机那儿是摇杆，PC 上换成键位图例（WASD + Shift/Ctrl）
    this.object.append(pauseBar, this.makeMovePad(), buttons);
    host.appendChild(this.object);

    this.mountHotbarSideButton();
    this.applyFlyChrome();
  }

  // ---------------------------------------------------------------- 对外接口

  get visible(): boolean {
    return !this.object.classList.contains('ui-off');
  }

  /**
   * 界面打开时收起按钮层（与手机同一条约定：只改 `visibility`，不拆 DOM）。
   *
   * 桌面上其实没有"拆了重建导致坐标映射失效"那类毛病，但两边行为保持一致：
   * 关面板回来时看到的仍是同一批按钮，不会闪一下。
   */
  set visible(value: boolean) {
    this.object.classList.toggle('ui-off', !value);
    for (const button of this.sideButtons) button.classList.toggle('ui-off', !value);
    if (value) return;
    this.jumpHeld = false;
    this.sneakHeld = false;
    this.jumpButton.classList.remove('on');
    this.flyUpButton.classList.remove('on');
    this.flyDownButton.classList.remove('on');
  }

  /** 按钮按出来的输入（与键盘那一路在 `main.ts` 里取或） */
  get input(): { jump: boolean; sneak: boolean } {
    return { jump: this.jumpHeld, sneak: this.sneakHeld };
  }

  get debugState(): PcDebugState {
    return {
      visible: this.visible,
      jumpHeld: this.jumpHeld,
      sneakHeld: this.sneakHeld,
      flying: this.flying,
    };
  }

  /** 飞行态：露上升/下降，落地只剩跳跃（与手机端 `applyFlyChrome` 同一套语义） */
  setFlying(flying: boolean): void {
    this.flying = flying;
    this.sneakHeld = false;
    this.jumpHeld = false;
    this.applyFlyChrome();
  }

  dispose(): void {
    for (const button of this.sideButtons) button.remove();
    this.object.remove();
    document.body.classList.remove('pc-mode');
  }

  // ---------------------------------------------------------------- 内部实现

  private applyFlyChrome(): void {
    this.object.classList.toggle('flying', this.flying);
    for (const button of [this.flyUpButton, this.flyDownButton]) {
      button.classList.toggle('hidden', !this.flying);
      button.classList.remove('on');
    }
    this.jumpButton.classList.remove('on');
  }

  /**
   * 背包挂在快捷栏右侧（与手机端 `#touch-hotbar-inventory` 同一个位置）。
   *
   * 挂进 `#hotbar` 而不是 `this.object`：快捷栏自己就是定位父元素，
   * 贴着它右端不用算任何像素；也不参与那一行 9 个格子的宽度计算。
   */
  private mountHotbarSideButton(): void {
    const host = document.getElementById('hotbar') ?? this.object;
    const button = this.makeButton('inventory', PC_KEY_HINTS.inventory, () => this.actions.onToggleInventory());
    button.id = 'pc-hotbar-inventory';
    button.classList.add('touch-side-btn');
    this.sideButtons.push(button);
    host.appendChild(button);
  }

  /** 左下角的键位图例：WASD + Shift 潜行 / Ctrl 疾跑 */
  private makeMovePad(): HTMLDivElement {
    const pad = document.createElement('div');
    pad.id = 'pc-move';

    const keys = document.createElement('div');
    keys.className = 'pc-pad';
    for (const [letter, position] of [
      ['W', 'w'],
      ['A', 'a'],
      ['S', 's'],
      ['D', 'd'],
    ] as const) {
      const chip = document.createElement('span');
      chip.className = `pc-key pc-key-${position}`;
      chip.textContent = letter;
      keys.appendChild(chip);
    }

    const notes = document.createElement('div');
    notes.className = 'pc-move-notes';
    notes.append(
      note('Shift', t('touch.sneak')),
      note('Ctrl', t('pc.sprint')),
      note('Shift+F', t('pc.fly')),
    );

    pad.append(keys, notes);
    return pad;
  }

  /** 玻璃质感的圆形按钮 + 正上方一枚键帽（样式复用手机那套 `.touch-button`） */
  private makeButton(
    icon: TouchIconName,
    key: string,
    onClick: () => void,
    extraClasses: readonly string[] = [],
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'touch-button';
    if (extraClasses.length > 0) button.classList.add(...extraClasses);
    button.dataset.icon = icon;
    button.innerHTML = touchIconSvg(icon);
    const label = touchIconLabel(icon);
    button.setAttribute('aria-label', `${label} (${key})`);
    button.title = `${label} (${key})`;
    const chip = document.createElement('span');
    chip.className = 'pc-key pc-key-inside';
    chip.textContent = key;
    chip.setAttribute('aria-hidden', 'true');
    button.appendChild(chip);
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    button.addEventListener('click', (event) => event.preventDefault());
    return button;
  }

  /** 按住生效的按钮（跳跃 / 升降） */
  private bindHold(button: HTMLButtonElement, onChange: (down: boolean) => void): void {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onChange(true);
      button.classList.add('on');
    });
    const release = (event: PointerEvent) => {
      event.preventDefault();
      onChange(false);
      button.classList.remove('on');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', (event) => {
      if (!button.classList.contains('on')) return;
      release(event);
    });
  }
}

/** 一枚"键 + 动作名"的说明（PC 的键位图例用） */
function note(key: string, label: string): HTMLSpanElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'pc-move-note';
  const chip = document.createElement('span');
  chip.className = 'pc-key';
  chip.textContent = key;
  const text = document.createElement('span');
  text.textContent = label;
  wrapper.append(chip, text);
  return wrapper;
}
