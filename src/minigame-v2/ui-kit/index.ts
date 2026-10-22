import * as THREE from 'three';
import {
  canSplitStack,
  initialSplitCount,
  splitCountForDrag,
} from '../../core/container/TouchSplit.ts';

/**
 * v2 UI Kit MVP
 *
 * 不是 DOM 模拟器，只提供 Web 版实际用到的 UI 原语：
 * - 绝对坐标 Box
 * - Text
 * - Button（点击/命中）
 * - Row/Column 辅助布局
 *
 * 后续 Settings / Inventory 需要再补 Toggle/Slider/Scroll/Grid/Tabs。
 */

export interface UiStyle {
  background?: string;
  border?: string;
  borderWidth?: number;
  radius?: number;
  color?: string;
  fontSize?: number;
  align?: 'left' | 'center' | 'right';
  /**
   * 像素斜角（对齐 Web 版 `.inv-panel` / `.inv-slot` 的 `--pixel-bevel`）：
   * 左上亮、右下暗的一圈硬边。给了它就**不画均匀 border**——原版 GUI 里没有均匀描边。
   * 四边顺序同 CSS `border-color`：上 右 下 左。也可以传单色（四边同色）。
   */
  bevel?: string | readonly [string, string, string, string];
}

/**
 * 原版 GUI 的配色（取自 Web 版 CSS 变量，见 `.tmp/web-inventory-analysis.md`）。
 *
 * v2 之前用的是"深蓝黑面板 + 白字"，那是**自创风格**；原版（以及 Web 版）是
 * **浅灰面板 + 深灰字 + 直角斜边**。这两套差得不是一点点，用户说"看着一脸蒙"
 * 主要就是因为它不像 Minecraft 的物品栏。
 */
export const MC = {
  /** 面板底色 #c6c6c6 */
  panel: '#c6c6c6',
  /** 槽位底色 #8b8b8b */
  slot: '#8b8b8b',
  /** 槽位按下/选中：白底 + 深框（"相框"） */
  slotSelected: '#ffffff',
  /** 正文深灰 */
  text: '#3a3a3a',
  /** 次要文字 */
  textMuted: '#5a5a5a',
  /** 像素斜角：亮（左上）/ 暗（右下） */
  bevelLight: '#ffffff',
  bevelDark: '#5a5a5a',
  /** 面板最外那圈黑描边 */
  outline: '#000000',
  /** 按钮灰 */
  button: '#a8a8a8',
  /** 页签选中（基岩版是淡黄绿） */
  tabActive: '#dcdec4',
  /** 产物槽的暖色提示边 */
  outputAccent: '#e0c06a',
  /** 悬停高亮的绿（拖拽目标） */
  dropTarget: '#7bd88f',
} as const;

/** 斜角套成 CSS 顺序（上 右 下 左） */
export function bevelColors(bevel: UiStyle['bevel']): readonly [string, string, string, string] {
  if (!bevel) return [MC.bevelLight, MC.bevelDark, MC.bevelDark, MC.bevelLight];
  if (typeof bevel === 'string') return [bevel, bevel, bevel, bevel];
  return bevel;
}

export interface UiNode {
  x: number;
  y: number;
  w: number;
  h: number;
  style?: UiStyle;
  children?: UiNode[];
}

export interface UiTextNode extends UiNode {
  kind: 'text';
  text: string;
}

export interface UiButtonNode extends UiNode {
  kind: 'button';
  label: string;
  onClick?: () => void;
  onRelease?: () => void;
}

export interface UiToggleNode extends UiNode {
  kind: 'toggle';
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export interface UiSliderNode extends UiNode {
  kind: 'slider';
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

/**
 * 触摸的两个语义（SPEC §4.1 的 `TOUCH-001/002`）：
 *  - **短按** = 鼠标左键；
 *  - **长按**（≥ `LONG_PRESS_MS`）= 鼠标右键（拿一半 / 放一个）。
 *
 * 长按在**按住到位的那一刻**就触发（而不是等抬手），这样手指还按着的时候
 * 就能看见"拿了几个"，与原版基岩版的选数量手感一致。
 */
export type SlotButton = 'left' | 'right';

/**
 * 长按判定阈值。
 *
 * ⚠️ 数值**照 Web 版抄**（`InventoryScreen.TOUCH_LONG_PRESS_MS = 260`）：
 * 之前 v2 自己定的是 420ms，比 Web 版慢 160ms —— 玩惯了 Web 版的手指会觉得
 * "长按没反应"，然后不自觉按更久，反而更容易变成拖动。
 */
export const LONG_PRESS_MS = 260;

/**
 * 长按之后的**连发间隔**（对齐 Web 版 `TOUCH_REPEAT_MS = 170`）。
 *
 * 用处在"连续放材料 / 连续取一个"：按住不放，每 170ms 再结算一次右键，
 * 摆 3×3 的合成表就不用点 9 下。
 */
export const LONG_PRESS_REPEAT_MS = 170;

export interface UiSlotNode extends UiNode {
  kind: 'slot';
  index: number;
  itemId: number;
  count: number;
  selected: boolean;
  onTap: (button: SlotButton) => void;
  onDrop?: (from: UiSlotNode, to: UiSlotNode) => void;
  /** 只取不放的槽：画成"产物"色（INV-015）；同时界面在点击结算时也会拒绝放置 */
  takeOnly?: boolean;
  /**
   * **长按选数量**的结算（基岩版那条绿色指示条）。
   *
   * 给了它、且这一格有 ≥2 个、手上又空着，长按就进入"选数量"而不是右键：
   * 左右划改数量、抬手才真正拿走那么多（`core/container/TouchSplit.ts` 是规则层）。
   * 没给 = 这一格不参与选数量（走普通右键 + 连发）。
   */
  onSplit?: (count: number) => void;
  /**
   * 这一格"现在用不了"（配方卡缺料 / 缺燃料）。
   *
   * ⚠️ 不要用 `takeOnly` 表达这件事：那个字段的语义是"只取不放"（产物槽），
   * 借它来画"不可用"会让产物槽和缺料卡长得一模一样（第一版就是这样，
   * 45 张配方卡里有 44 张都亮着金边，看起来像全都能做）。
   */
  locked?: boolean;
}

export type UiIconKind = 'chat' | 'pause' | 'view';

/**
 * 物品图标按钮（轨道上那几颗"分类"用的）。
 *
 * 与 `button` 的区别只有一处：中间画的**不是文字，是物品贴图**（由 `UiLayer` 构造时
 * 传入的 `drawIcon` 画）。Web 版左轨就是这一种：放大镜/砖块/镐/方块/叶子/箱子。
 */
export interface UiItemButtonNode extends UiNode {
  kind: 'itembtn';
  /** 要画哪个物品（0 = 不画图标，只有底色） */
  itemId: number;
  active: boolean;
  onTap: () => void;
}

export interface UiIconNode extends UiNode {
  kind: 'icon';
  icon: UiIconKind;
  onTap: () => void;
}

export interface UiVitalNode extends UiNode {
  kind: 'vital';
  vital: 'heart' | 'food' | 'air';
  count: number;
}

export interface UiRingNode extends UiNode {
  kind: 'ring';
  visible: boolean;
}

/**
 * 长按选数量的**指示条**（基岩版那条绿色进度条，`TouchSplit.ts` 的规则层算占比）。
 *
 * 画在来源格的正上方：白色底 + 绿色填充 + 中间一个数字。
 * 规则（初值取半、左右划动的映射）全在 `core/container/TouchSplit.ts`，这里只画。
 */
export interface UiSplitBarNode extends UiNode {
  kind: 'splitbar';
  /** 选中的数量 */
  count: number;
  /** 这一格原本的总数 */
  total: number;
}

export type UiElement =
  | UiNode
  | UiTextNode
  | UiButtonNode
  | UiToggleNode
  | UiSliderNode
  | UiSlotNode
  | UiIconNode
  | UiRingNode
  | UiVitalNode
  | UiSplitBarNode
  | UiItemButtonNode;

export function box(x: number, y: number, w: number, h: number, children: UiElement[] = [], style: UiStyle = {}): UiNode {
  return { x, y, w, h, style, children };
}

export function text(x: number, y: number, w: number, h: number, value: string, style: UiStyle = {}): UiTextNode {
  return { kind: 'text', x, y, w, h, text: value, style };
}

export function button(
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  style: UiStyle = {},
  onRelease?: () => void,
): UiButtonNode {
  return { kind: 'button', x, y, w, h, label, onClick, style, onRelease };
}

export function toggle(
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: boolean,
  onChange: (value: boolean) => void,
): UiToggleNode {
  return { kind: 'toggle', x, y, w, h, label, value, onChange };
}

export function slider(
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (value: number) => void,
): UiSliderNode {
  return { kind: 'slider', x, y, w, h, label, min, max, step, value, onChange };
}

export function slot(
  x: number,
  y: number,
  size: number,
  index: number,
  itemId: number,
  count: number,
  selected: boolean,
  onTap: (button: SlotButton) => void,
  onDrop?: (from: UiSlotNode, to: UiSlotNode) => void,
  takeOnly = false,
  onSplit?: (count: number) => void,
  locked = false,
): UiSlotNode {
  return { kind: 'slot', x, y, w: size, h: size, index, itemId, count, selected, onTap, onDrop, takeOnly, onSplit, locked };
}

export function icon(
  x: number,
  y: number,
  size: number,
  kind: UiIconKind,
  onTap: () => void,
  style: UiStyle = {},
): UiIconNode {
  return { kind: 'icon', x, y, w: size, h: size, icon: kind, onTap, style };
}

export function itemButton(
  x: number,
  y: number,
  size: number,
  itemId: number,
  active: boolean,
  onTap: () => void,
): UiItemButtonNode {
  return { kind: 'itembtn', x, y, w: size, h: size, itemId, active, onTap };
}

export function splitBar(x: number, y: number, w: number, h: number, count: number, total: number): UiSplitBarNode {
  return { kind: 'splitbar', x, y, w, h, count, total };
}

export function ring(x: number, y: number, size: number, visible = false): UiRingNode {
  return { kind: 'ring', x, y, w: size, h: size, visible };
}

export function vital(
  x: number,
  y: number,
  size: number,
  vitalType: 'heart' | 'food' | 'air',
  count: number,
): UiVitalNode {
  return { kind: 'vital', x, y, w: size * 10 + 9, h: size, vital: vitalType, count };
}

export function row(
  x: number,
  y: number,
  h: number,
  gap: number,
  children: UiElement[],
): UiElement[] {
  let cursor = x;
  return children.map((child) => {
    const placed = { ...child, x: cursor, y, h };
    cursor += child.w + gap;
    return placed;
  });
}

const DESIGN_WIDTH = 1024;

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * 像素斜角框：四条边各画一条实色线段，**不做均匀描边**。
 *
 * 这是原版 GUI 的灵魂：左上亮、右下暗，眼睛把它读成"一块凸起的板"。
 * 用四条 1px 线段画（而不是 `strokeRect` + 四色）是因为 canvas 的 stroke 只能一色。
 */
function bevelRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colors: readonly [string, string, string, string],
  width = 2,
): void {
  const [top, right, bottom, left] = colors;
  // 上
  ctx.fillStyle = top;
  ctx.fillRect(x, y, w, width);
  // 左
  ctx.fillRect(x, y, width, h);
  // 下
  ctx.fillStyle = bottom;
  ctx.fillRect(x, y + h - width, w, width);
  // 右
  ctx.fillStyle = right;
  ctx.fillRect(x + w - width, y, width, h);
  void left;
}

export class UiLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly mesh: THREE.Mesh;
  private readonly designHeight: number;
  private root: UiElement | null = null;
  private buttons: UiButtonNode[] = [];
  private activeSlider: UiSliderNode | null = null;
  private activeButton: UiButtonNode | null = null;
  private lastRefresh = 0;
  private dragSlot: {
    node: UiSlotNode;
    startX: number;
    startY: number;
    moved: boolean;
    /** 拖过的格子（按顺序，去重）——拖拽分配要知道"经过哪几格" */
    path: UiSlotNode[];
  } | null = null;
  /**
   * 拖拽分配：松手时把光标上那叠分发到"拖过的格子"。
   *
   * 与 Web 版一致：**左拖平均分配、右拖每格一个**（`CursorActions` 两个纯函数）。
   * 回调只在"拖过 ≥1 格"时才被调用；单格拖动仍是普通换位（`onDrop`）。
   */
  onDragDistribute: ((nodes: UiSlotNode[], rightDrag: boolean) => void) | null = null;
  /** 这一次拖动是不是"右键拖"（在 down 那一刻决定，整趟不变） */
  private dragRight = false;
  private dragPos: { x: number; y: number } | null = null;
  /**
   * 长按 → 右键（TOUCH-002/003）。
   *
   * 计时器在**按下**时挂起、抬手时清掉。触发条件是"既没移动超过阈值、也还没抬手"——
   * 所以判据里同时看 `moved`（一旦拖动就再也不会触发长按）与 `fired`（只发一次）。
   */
  private longPress: {
    node: UiSlotNode;
    startX: number;
    startY: number;
    moved: boolean;
    fired: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    repeat: ReturnType<typeof setInterval> | null;
  } | null = null;
  /** 手上拿着的物品（画成跟随手指的幽灵图标，UI-004） */
  private ghost: { itemId: number; count: number; x: number; y: number } | null = null;
  /**
   * "长按选数量"的进行态（基岩版那条指示条）。
   *
   * 规则全在 `core/container/TouchSplit.ts`：这里只存"哪一格、总数、当前选中几个、
   * 按下时的起点"，划动时用 `splitCountForDrag` 换算，抬手用 `onSplit(count)` 结算。
   */
  private split: {
    node: UiSlotNode;
    total: number;
    count: number;
    startX: number;
    cellWidth: number;
  } | null = null;
  private slots: UiSlotNode[] = [];
  private icons: UiIconNode[] = [];
  private itemButtons: UiItemButtonNode[] = [];
  private readonly drawIcon?: (ctx: CanvasRenderingContext2D, id: number, x: number, y: number, size: number) => void;

  constructor(
    screenWidth: number,
    screenHeight: number,
    drawIcon?: (ctx: CanvasRenderingContext2D, id: number, x: number, y: number, size: number) => void,
  ) {
    this.drawIcon = drawIcon;
    const scale = Math.min(2, (globalThis as unknown as { devicePixelRatio?: number }).devicePixelRatio ?? 1);
    this.designHeight = (DESIGN_WIDTH * screenHeight) / Math.max(1, screenWidth);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(DESIGN_WIDTH * scale);
    this.canvas.height = Math.round(this.designHeight * scale);
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('UI Kit: 2D context 不可用');
    this.context = context;
    this.context.scale(scale, scale);

    this.camera.position.z = 1;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const planeWidth = 2;
    const planeHeight = 2 * (this.designHeight / DESIGN_WIDTH) * (screenWidth / Math.max(1, screenHeight));
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(planeWidth, planeHeight),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.scene.add(this.mesh);
  }

  get height(): number {
    return this.designHeight;
  }

  setRoot(root: UiElement): void {
    this.root = root;
    this.draw();
  }

  /** 手指按下：按钮/开关/滑杆。返回 true 表示 UI 已消费。 */
  handlePointer(
    phase: 'down' | 'move' | 'up',
    clientX: number,
    clientY: number,
    sw: number,
    sh: number,
  ): boolean {
    const x = (clientX / Math.max(1, sw)) * DESIGN_WIDTH;
    const y = (clientY / Math.max(1, sh)) * this.designHeight;

    if (phase === 'move') {
      // 选数量：手指横向划动改数量（纵向/竖直不参与，避免"想滚动却在改数字"）
      if (this.split) {
        this.updateSplit(x);
        return true;
      }
      if (this.longPress) this.trackLongPressMove(x, y);
      if (this.dragSlot) {
        if (Math.hypot(x - this.dragSlot.startX, y - this.dragSlot.startY) > 8) this.dragSlot.moved = true;
        this.dragPos = { x, y };
        // 记下拖过的格子（去重、保序）：松手时按这条路径分配
        if (this.dragSlot.moved) {
          const over = this.findSlot(x, y);
          if (over && !this.dragSlot.path.includes(over)) this.dragSlot.path.push(over);
        }
        return true;
      }
      if (this.activeSlider) {
        this.updateSlider(this.activeSlider, x);
        return true;
      }
      return false;
    }
    if (phase === 'up') {
      // 选数量：抬手 = 按当前数量结算（**必须先于**普通点击的那几条分支）
      if (this.split) {
        this.dragSlot = null;
        this.dragPos = null;
        this.clearLongPress();
        this.commitSplit();
        return true;
      }
      if (this.activeButton) {
        this.activeButton.onRelease?.();
        this.activeButton = null;
        return true;
      }
      if (this.activeSlider) {
        this.activeSlider = null;
        return true;
      }
      if (this.dragSlot) {
        const drag = this.dragSlot;
        const longPress = this.longPress;
        this.dragSlot = null;
        this.dragPos = null;
        this.clearLongPress();
        // 长按已经按"右键"结算过了：抬手不再补一次左键（否则拿一半变成"又放回去"）
        if (longPress?.fired) return true;
        const target = this.findSlot(x, y);
        const path = drag.path.filter((n) => n !== drag.node);
        // 拖过 **多个** 格子 = 分配（左拖平均、右拖每格一个）
        if (drag.moved && path.length >= 1 && this.onDragDistribute) {
          this.onDragDistribute(drag.path, this.dragRight);
          return true;
        }
        if (drag.moved && target && target !== drag.node) drag.node.onDrop?.(drag.node, target);
        else if (!drag.moved) drag.node.onTap('left');
        return true;
      }
      this.clearLongPress();
      return false;
    }
    if (phase !== 'down') return false;

    const downSlot = this.findSlot(x, y);
    if (downSlot) {
      this.dragSlot = { node: downSlot, startX: x, startY: y, moved: false, path: [downSlot] };
      this.dragPos = null;
      this.dragRight = false;
      this.startLongPress(downSlot, x, y);
      return true;
    }
    this.clearLongPress();

    for (let i = this.icons.length - 1; i >= 0; i--) {
      const item = this.icons[i]!;
      if (x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h) {
        item.onTap();
        return true;
      }
    }

    for (let i = this.itemButtons.length - 1; i >= 0; i--) {
      const item = this.itemButtons[i]!;
      if (x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h) {
        item.onTap();
        return true;
      }
    }

    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const item = this.buttons[i]!;
      if (x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h) {
        this.activeButton = item;
        item.onClick?.();
        return true;
      }
    }

    const hit = this.findControl(x, y);
    if (!hit) return false;
    if (hit.kind === 'toggle') {
      hit.onChange(!hit.value);
      return true;
    }
    this.activeSlider = hit;
    this.updateSlider(hit, x);
    return true;
  }

  /** 兼容旧调用：等价于 down。 */
  handleTap(clientX: number, clientY: number, sw: number, sh: number): boolean {
    return this.handlePointer('down', clientX, clientY, sw, sh);
  }

  /**
   * 挂起长按计时器。
   *
   * ⚠️ 只对**有物品**的格子挂：空格子长按没有语义（原版也是"长按有物品的格子"），
   * 而且空格子上的长按会让"按住拖动换位"多等 420ms 才有反应，手感很差。
   */
  private startLongPress(node: UiSlotNode, x: number, y: number): void {
    this.clearLongPress();
    if (node.itemId <= 0 || node.takeOnly) return;
    const entry: NonNullable<UiLayer['longPress']> = {
      node,
      startX: x,
      startY: y,
      moved: false,
      fired: false,
      timer: null,
      repeat: null,
    };
    entry.timer = setTimeout(() => {
      // 触发前再核一遍：手指没动、也还没抬手
      if (this.longPress !== entry || entry.moved) return;
      entry.fired = true;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      // **先问"要不要选数量"**：有 ≥2 个、手上空着、且这一格支持拆分时，
      // 长按进的是选数量（不触发右键、也不连发）——两条手势互斥，叠在一起会互相打架。
      if (this.beginSplit(entry.node, entry.startX)) return;
      entry.node.onTap('right');
      // **连发**（对齐 Web 版 `TOUCH_REPEAT_MS`）：按住不放就每 170ms 再来一次右键。
      // 摆合成表 / 从箱子里连续取一个都靠它；抬手或移动超过阈值就停。
      entry.repeat = setInterval(() => {
        if (this.longPress !== entry || entry.moved) {
          this.clearLongPress();
          return;
        }
        entry.node.onTap('right');
      }, LONG_PRESS_REPEAT_MS);
    }, LONG_PRESS_MS);
    this.longPress = entry;
  }

  /**
   * 进入"长按选数量"。返回 false = 这一格不走这条路（退回右键 + 连发）。
   *
   * 三个前置条件（对齐 Web 版）：这一格支持拆分（`onSplit` 存在）、
   * 有 ≥2 个、**手上空着**（`canSplitStack`）。
   */
  private beginSplit(node: UiSlotNode, startX: number): boolean {
    if (!node.onSplit || node.takeOnly) return false;
    if (!canSplitStack({ id: node.itemId, count: node.count }, this.ghost !== null)) return false;
    this.split = {
      node,
      total: node.count,
      count: initialSplitCount(node.count),
      startX,
      cellWidth: Math.max(8, node.w),
    };
    this.refresh(true);
    return true;
  }

  /** 划动改数量（`splitCountForDrag` 负责那几条容易写错的映射） */
  private updateSplit(x: number): void {
    const split = this.split;
    if (!split) return;
    split.count = splitCountForDrag(split.total, initialSplitCount(split.total), x - split.startX, split.cellWidth);
    this.refresh(true);
  }

  /** 抬手结算：拿走 `count` 个（界面那一层再去改数据） */
  private commitSplit(): boolean {
    const split = this.split;
    this.split = null;
    if (!split) return false;
    this.refresh(true);
    split.node.onSplit?.(split.count);
    return true;
  }

  private trackLongPressMove(x: number, y: number): void {
    const entry = this.longPress;
    if (!entry) return;
    if (Math.hypot(x - entry.startX, y - entry.startY) > 8) entry.moved = true;
  }

  private clearLongPress(): void {
    if (this.longPress?.timer) clearTimeout(this.longPress.timer);
    if (this.longPress?.repeat) clearInterval(this.longPress.repeat);
    this.longPress = null;
  }

  /** 手上物品的幽灵图标（UI-004）；`null` = 手上没东西 */
  setGhost(itemId: number, count: number): void {
    if (itemId <= 0) {
      if (this.ghost) {
        this.ghost = null;
        this.refresh(true);
      }
      return;
    }
    this.ghost = { itemId, count, x: this.ghost?.x ?? 512, y: this.ghost?.y ?? this.designHeight / 2 };
    this.refresh(true);
  }

  /** 手指/鼠标移动时更新幽灵图标位置（只重绘，不改状态） */
  moveGhost(clientX: number, clientY: number, sw: number, sh: number): void {
    if (!this.ghost) return;
    this.ghost.x = (clientX / Math.max(1, sw)) * DESIGN_WIDTH;
    this.ghost.y = (clientY / Math.max(1, sh)) * this.designHeight;
    this.refresh();
  }

  private updateSlider(node: UiSliderNode, x: number): void {
    const raw = ((x - node.x) / Math.max(1, node.w)) * (node.max - node.min) + node.min;
    const stepped = Math.round(raw / node.step) * node.step;
    const value = Math.max(node.min, Math.min(node.max, stepped));
    if (value !== node.value) {
      node.value = value;
      node.onChange(value);
    }
  }

  private findSlot(x: number, y: number): UiSlotNode | null {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const item = this.slots[i]!;
      if (x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h) return item;
    }
    return null;
  }

  private findControl(x: number, y: number): UiToggleNode | UiSliderNode | null {
    const search = (node: UiElement): UiToggleNode | UiSliderNode | null => {
      if ('kind' in node && (node.kind === 'toggle' || node.kind === 'slider')) {
        if (x >= node.x && x <= node.x + node.w && y >= node.y && y <= node.y + node.h) return node;
      }
      for (const child of node.children ?? []) {
        const hit = search(child);
        if (hit) return hit;
      }
      return null;
    };
    return this.root ? search(this.root) : null;
  }

  /** 节点位置变化后重绘 HUD（不重建根节点）。 */
  refresh(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastRefresh < 33) return;
    this.lastRefresh = now;
    this.draw();
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }

  private draw(): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, DESIGN_WIDTH, this.designHeight);
    this.buttons = [];
    this.slots = [];
    this.icons = [];
    this.itemButtons = [];
    if (this.root) this.drawNode(this.root, ctx);
    // 手上物品（UI-004）：先画拖拽幽灵（拖拽分配那一路），再画光标幽灵（点击拿起那一路）
    if (this.dragSlot?.moved && this.dragPos && this.dragSlot.node.itemId > 0) {
      this.drawGhostIcon(ctx, this.dragSlot.node.itemId, this.dragSlot.node.count, this.dragPos.x, this.dragPos.y);
    }
    if (this.ghost) {
      this.drawGhostIcon(ctx, this.ghost.itemId, this.ghost.count, this.ghost.x, this.ghost.y);
    }
    // 选数量指示条：画在**来源格内部靠下**（基岩版那格上就有条绿条）。
    // ⚠️ 不能画在格子上方：那里可能正是顶栏/标题行，压上去会挡住"物品栏"几个字
    // （第一版就画在外面上，截图一看就顶到标题了）。
    if (this.split) {
      const n = this.split.node;
      const barH = Math.max(8, Math.round(n.h * 0.22));
      const barW = n.w - 6;
      this.drawNode(
        splitBar(n.x + 3, n.y + n.h - barH - 3, barW, barH, this.split.count, this.split.total),
        ctx,
      );
    }
    this.texture.needsUpdate = true;
  }

  /** 跟随手指的半透明图标 + 数量（拖拽与光标共用一套画法） */
  private drawGhostIcon(
    ctx: CanvasRenderingContext2D,
    itemId: number,
    count: number,
    cx: number,
    cy: number,
  ): void {
    const size = 42;
    ctx.globalAlpha = 0.85;
    this.drawIcon?.(ctx, itemId, cx - size / 2, cy - size / 2, size);
    ctx.globalAlpha = 1;
    if (count > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(String(count), cx, cy + size / 2);
    }
  }

  private drawNode(node: UiElement, ctx: CanvasRenderingContext2D): void {
    if ('kind' in node && node.kind === 'text') {
      const style = node.style ?? {};
      ctx.fillStyle = style.color ?? '#ffffff';
      ctx.font = `${style.fontSize ?? 24}px sans-serif`;
      ctx.textAlign = style.align ?? 'left';
      ctx.textBaseline = 'top';
      const x = style.align === 'center' ? node.x + node.w / 2 : style.align === 'right' ? node.x + node.w : node.x;
      ctx.fillText(node.text, x, node.y, node.w);
      return;
    }

    if ('kind' in node && node.kind === 'icon') {
      const style = node.style ?? {};
      ctx.fillStyle = style.background ?? 'rgba(12,16,20,0.82)';
      ctx.beginPath();
      ctx.arc(node.x + node.w / 2, node.y + node.h / 2, node.w / 2, 0, Math.PI * 2);
      ctx.fill();
      if (style.border) {
        ctx.strokeStyle = style.border;
        ctx.lineWidth = style.borderWidth ?? 2;
        ctx.stroke();
      }
      const cx = node.x + node.w / 2;
      const cy = node.y + node.h / 2;
      const r = node.w * 0.18;
      ctx.strokeStyle = '#f5f7fa';
      ctx.fillStyle = '#f5f7fa';
      ctx.lineWidth = 2.5;
      if (node.icon === 'pause') {
        ctx.fillRect(cx - r * 1.2, cy - r * 1.4, r * 0.9, r * 2.8);
        ctx.fillRect(cx + r * 0.3, cy - r * 1.4, r * 0.9, r * 2.8);
      } else if (node.icon === 'chat') {
        roundedRect(ctx, cx - r * 1.8, cy - r * 1.3, r * 3.6, r * 2.4, r * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.6, cy + r * 1.1);
        ctx.lineTo(cx - r * 1.2, cy + r * 1.9);
        ctx.lineTo(cx + r * 0.1, cy + r * 1.1);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - r * 2.2, cy);
        ctx.lineTo(cx + r * 2.2, cy);
        ctx.moveTo(cx, cy - r * 2.2);
        ctx.lineTo(cx, cy + r * 2.2);
        ctx.stroke();
      }
      this.icons.push(node);
      return;
    }

    if ('kind' in node && node.kind === 'vital') {
      const size = node.h;
      const gap = 1;
      for (let i = 0; i < 10; i++) {
        const cx = node.x + i * (size + gap) + size / 2;
        const cy = node.y + size / 2;
        const step = node.vital === 'air' ? 30 : 2;
        const filled = node.count >= (i + 1) * step;
        ctx.fillStyle = filled
          ? node.vital === 'heart'
            ? '#e5484d'
            : node.vital === 'food'
              ? '#e0a03a'
              : '#6fc3ff'
          : 'rgba(0,0,0,0.55)';
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 1;
        if (node.vital === 'heart') {
          ctx.beginPath();
          ctx.moveTo(cx, cy + size * 0.35);
          ctx.bezierCurveTo(cx - size * 0.55, cy - size * 0.1, cx - size * 0.32, cy - size * 0.5, cx, cy - size * 0.2);
          ctx.bezierCurveTo(cx + size * 0.32, cy - size * 0.5, cx + size * 0.55, cy - size * 0.1, cx, cy + size * 0.35);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (node.vital === 'air') {
          ctx.beginPath();
          ctx.arc(cx, cy, size * 0.32, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.arc(cx - size * 0.1, cy - size * 0.1, size * 0.1, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.ellipse(cx, cy - size * 0.1, size * 0.32, size * 0.24, 0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillRect(cx - size * 0.05, cy + size * 0.05, size * 0.12, size * 0.32);
        }
      }
      return;
    }

    if ('kind' in node && node.kind === 'itembtn') {
      // 灰底 + 斜角（选中时翻成凹进去的淡黄绿，与普通按钮同一套观感）
      ctx.fillStyle = node.active ? MC.tabActive : MC.button;
      ctx.fillRect(node.x, node.y, node.w, node.h);
      bevelRect(
        ctx,
        node.x,
        node.y,
        node.w,
        node.h,
        node.active
          ? [MC.bevelDark, MC.bevelLight, MC.bevelLight, MC.bevelDark]
          : [MC.bevelLight, MC.bevelDark, MC.bevelDark, MC.bevelLight],
        2,
      );
      if (node.itemId > 0) {
        const pad = 4;
        this.drawIcon?.(ctx, node.itemId, node.x + pad, node.y + pad, node.w - pad * 2);
      }
      this.itemButtons.push(node);
      return;
    }

    if ('kind' in node && node.kind === 'splitbar') {
      // 白底 + 绿色填充 + 数字：基岩版那条指示条的观感
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(node.x - 1, node.y - 1, node.w + 2, node.h + 2);
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(node.x, node.y, node.w, node.h);
      const frac = node.total > 0 ? Math.min(1, Math.max(0, node.count / node.total)) : 0;
      ctx.fillStyle = '#4fae4f';
      ctx.fillRect(node.x, node.y, node.w * frac, node.h);
      ctx.fillStyle = '#1b1b1b';
      ctx.font = `${Math.max(9, Math.round(node.h * 0.8))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(node.count), node.x + node.w / 2, node.y + node.h / 2);
      return;
    }

    if ('kind' in node && node.kind === 'ring') {
      if (!node.visible) return;
      ctx.beginPath();
      ctx.arc(node.x + node.w / 2, node.y + node.h / 2, node.w / 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }

    if ('kind' in node && node.kind === 'slot') {
      const dragOver =
        this.dragSlot?.moved &&
        this.dragPos &&
        this.dragPos.x >= node.x &&
        this.dragPos.x <= node.x + node.w &&
        this.dragPos.y >= node.y &&
        this.dragPos.y <= node.y + node.h;

      // 原版槽位：**直角** + 凹进去的斜角（左上暗、右下亮——与面板凸起的方向相反）。
      // 选中时换成"白底 + 深框"（`.inv-slot.selected` 那个相框效果）。
      const selected = node.selected;
      ctx.fillStyle = selected ? MC.slotSelected : MC.slot;
      ctx.fillRect(node.x, node.y, node.w, node.h);

      if (selected) {
        // 相框：2px 深色内边 + 2px 白边（不参与布局，所以直接画在框内）
        ctx.fillStyle = '#2b2b2b';
        ctx.fillRect(node.x, node.y, node.w, 2);
        ctx.fillRect(node.x, node.y + node.h - 2, node.w, 2);
        ctx.fillRect(node.x, node.y, 2, node.h);
        ctx.fillRect(node.x + node.w - 2, node.y, 2, node.h);
      } else {
        // 凹槽：左上暗、右下亮
        bevelRect(ctx, node.x, node.y, node.w, node.h, [MC.bevelDark, MC.bevelLight, MC.bevelLight, MC.bevelDark], 2);
      }

      // 拖拽落点 / 产物槽 / 不可用：加一圈高亮（原版没有，但这是必要的操作反馈）
      if (dragOver) {
        ctx.strokeStyle = MC.dropTarget;
        ctx.lineWidth = 3;
        ctx.strokeRect(node.x + 2, node.y + 2, node.w - 4, node.h - 4);
      } else if (node.takeOnly) {
        // 产物槽：金边 = "这格只能取"
        ctx.strokeStyle = MC.outputAccent;
        ctx.lineWidth = 2;
        ctx.strokeRect(node.x + 3, node.y + 3, node.w - 6, node.h - 6);
      } else if (node.locked) {
        // 不可用（配方卡缺料）：**压暗**整格，不画金边
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(node.x + 2, node.y + 2, node.w - 4, node.h - 4);
      }

      if (node.itemId > 0) this.drawIcon?.(ctx, node.itemId, node.x + 2, node.y + 2, node.w - 4);
      if (node.count > 0) {
        // 数量：原版是**白字带黑描边**，右下角
        const tx = node.x + node.w - 4;
        const ty = node.y + node.h - 3;
        ctx.font = `${Math.max(11, Math.round(node.w * 0.3))}px sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(String(node.count), tx, ty);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(String(node.count), tx, ty);
      }
      this.slots.push(node);
      return;
    }

    if ('kind' in node && node.kind === 'toggle') {
      const style = node.style ?? {};
      ctx.fillStyle = style.background ?? 'rgba(28, 36, 42, 0.9)';
      roundedRect(ctx, node.x, node.y, node.w, node.h, style.radius ?? 8);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.label, node.x + 16, node.y + node.h / 2, node.w - 130);
      const sw = 72;
      const sx = node.x + node.w - sw - 14;
      const sy = node.y + (node.h - 36) / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundedRect(ctx, sx, sy, sw, 36, 18);
      ctx.fill();
      ctx.fillStyle = node.value ? '#7bd88f' : 'rgba(180,190,200,0.55)';
      ctx.beginPath();
      ctx.arc(node.value ? sx + sw - 18 : sx + 18, sy + 18, 13, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if ('kind' in node && node.kind === 'slider') {
      const style = node.style ?? {};
      ctx.fillStyle = style.background ?? 'rgba(28, 36, 42, 0.9)';
      roundedRect(ctx, node.x, node.y, node.w, node.h, style.radius ?? 8);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '19px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.label, node.x + 16, node.y + node.h / 2, node.w - 170);
      const trackX = node.x + node.w - 150;
      const trackW = 120;
      const ratio = (node.value - node.min) / Math.max(1e-6, node.max - node.min);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundedRect(ctx, trackX, node.y + node.h / 2 - 4, trackW, 8, 4);
      ctx.fill();
      ctx.fillStyle = '#7bd88f';
      roundedRect(ctx, trackX, node.y + node.h / 2 - 4, trackW * ratio, 8, 4);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(trackX + trackW * ratio, node.y + node.h / 2, 10, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if ('kind' in node && node.kind === 'button') {
      const style = node.style ?? {};
      ctx.fillStyle = style.background ?? MC.button;
      const radius = style.radius ?? 0;
      if (radius > 0) {
        roundedRect(ctx, node.x, node.y, node.w, node.h, radius);
        ctx.fill();
      } else {
        ctx.fillRect(node.x, node.y, node.w, node.h);
      }
      // 斜角优先：原版按钮就是"左上亮右下暗"的一块板，没有均匀描边
      if (style.bevel) {
        bevelRect(ctx, node.x, node.y, node.w, node.h, bevelColors(style.bevel), style.borderWidth ?? 2);
      } else if (style.border) {
        ctx.strokeStyle = style.border;
        ctx.lineWidth = style.borderWidth ?? 2;
        if (radius > 0) {
          roundedRect(ctx, node.x, node.y, node.w, node.h, radius);
          ctx.stroke();
        } else {
          ctx.strokeRect(node.x, node.y, node.w, node.h);
        }
      }
      ctx.fillStyle = style.color ?? MC.text;
      ctx.font = `${style.fontSize ?? 20}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // ⚠️ 第 4 个参数是 **maxWidth**：中文按字宽算，"配方书"三个字在 12px 下
      // 约 36px、54px 宽的按钮装得下；但一旦字体回退到更宽的字形就会溢出，
      // 视觉上就像"两个按钮的字压在一起"。压到 w-8 更保险。
      ctx.fillText(node.label, node.x + node.w / 2, node.y + node.h / 2, node.w - 8);
      this.buttons.push(node);
      return;
    }

    const style = node.style ?? {};
    if (style.background || style.border || style.bevel) {
      const radius = style.radius ?? 0;
      if (style.background) {
        ctx.fillStyle = style.background;
        if (radius > 0) {
          roundedRect(ctx, node.x, node.y, node.w, node.h, radius);
          ctx.fill();
        } else {
          ctx.fillRect(node.x, node.y, node.w, node.h);
        }
      }
      if (style.bevel) {
        bevelRect(ctx, node.x, node.y, node.w, node.h, bevelColors(style.bevel), style.borderWidth ?? 2);
      } else if (style.border) {
        ctx.strokeStyle = style.border;
        ctx.lineWidth = style.borderWidth ?? 2;
        if (radius > 0) {
          roundedRect(ctx, node.x, node.y, node.w, node.h, radius);
          ctx.stroke();
        } else {
          ctx.strokeRect(node.x, node.y, node.w, node.h);
        }
      }
    }
    for (const child of node.children ?? []) this.drawNode(child, ctx);
  }
}
