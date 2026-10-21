import * as THREE from 'three';

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

/** 长按判定阈值；与 `TOUCH_SPLIT` 那套"划动开始前必须稳定按住"的时长同量级 */
export const LONG_PRESS_MS = 420;

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
}

export type UiIconKind = 'chat' | 'pause' | 'view';

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

export type UiElement =
  | UiNode
  | UiTextNode
  | UiButtonNode
  | UiToggleNode
  | UiSliderNode
  | UiSlotNode
  | UiIconNode
  | UiRingNode
  | UiVitalNode;

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
): UiSlotNode {
  return { kind: 'slot', x, y, w: size, h: size, index, itemId, count, selected, onTap, onDrop, takeOnly };
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
  private dragSlot: { node: UiSlotNode; startX: number; startY: number; moved: boolean } | null = null;
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
  } | null = null;
  /** 手上拿着的物品（画成跟随手指的幽灵图标，UI-004） */
  private ghost: { itemId: number; count: number; x: number; y: number } | null = null;
  private slots: UiSlotNode[] = [];
  private icons: UiIconNode[] = [];
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
      if (this.longPress) this.trackLongPressMove(x, y);
      if (this.dragSlot) {
        if (Math.hypot(x - this.dragSlot.startX, y - this.dragSlot.startY) > 8) this.dragSlot.moved = true;
        this.dragPos = { x, y };
        return true;
      }
      if (this.activeSlider) {
        this.updateSlider(this.activeSlider, x);
        return true;
      }
      return false;
    }
    if (phase === 'up') {
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
      this.dragSlot = { node: downSlot, startX: x, startY: y, moved: false };
      this.dragPos = null;
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
    };
    entry.timer = setTimeout(() => {
      // 触发前再核一遍：手指没动、也还没抬手
      if (this.longPress !== entry || entry.moved) return;
      entry.fired = true;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      entry.node.onTap('right');
    }, LONG_PRESS_MS);
    this.longPress = entry;
  }

  private trackLongPressMove(x: number, y: number): void {
    const entry = this.longPress;
    if (!entry) return;
    if (Math.hypot(x - entry.startX, y - entry.startY) > 8) entry.moved = true;
  }

  private clearLongPress(): void {
    if (this.longPress?.timer) clearTimeout(this.longPress.timer);
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
    if (this.root) this.drawNode(this.root, ctx);
    // 手上物品（UI-004）：先画拖拽幽灵（拖拽分配那一路），再画光标幽灵（点击拿起那一路）
    if (this.dragSlot?.moved && this.dragPos && this.dragSlot.node.itemId > 0) {
      this.drawGhostIcon(ctx, this.dragSlot.node.itemId, this.dragSlot.node.count, this.dragPos.x, this.dragPos.y);
    }
    if (this.ghost) {
      this.drawGhostIcon(ctx, this.ghost.itemId, this.ghost.count, this.ghost.x, this.ghost.y);
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
      ctx.fillStyle = node.selected ? 'rgba(100, 140, 160, 0.92)' : 'rgba(30, 38, 46, 0.92)';
      roundedRect(ctx, node.x, node.y, node.w, node.h, 6);
      ctx.fill();
      const dragOver = this.dragSlot?.moved && this.dragPos && this.dragPos.x >= node.x && this.dragPos.x <= node.x + node.w && this.dragPos.y >= node.y && this.dragPos.y <= node.y + node.h;
      ctx.strokeStyle = dragOver ? '#7bd88f' : node.takeOnly ? '#e0c06a' : node.selected ? '#9fe0ff' : 'rgba(160, 205, 230, 0.32)';
      ctx.lineWidth = dragOver || node.selected || node.takeOnly ? 3 : 1.5;
      roundedRect(ctx, node.x + 1, node.y + 1, node.w - 2, node.h - 2, 5);
      ctx.stroke();
      if (node.itemId > 0) this.drawIcon?.(ctx, node.itemId, node.x, node.y, node.w);
      if (node.count > 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(node.count), node.x + node.w - 5, node.y + node.h - 4);
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
      ctx.fillStyle = style.background ?? 'rgba(40, 48, 56, 0.92)';
      ctx.beginPath();
      const radius = style.radius ?? 8;
      roundedRect(ctx, node.x, node.y, node.w, node.h, radius);
      ctx.fill();
      if (style.border) {
        ctx.strokeStyle = style.border;
        ctx.lineWidth = style.borderWidth ?? 2;
        ctx.stroke();
      }
      ctx.fillStyle = style.color ?? '#ffffff';
      ctx.font = `${style.fontSize ?? 20}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.label, node.x + node.w / 2, node.y + node.h / 2, node.w - 16);
      this.buttons.push(node);
      return;
    }

    const style = node.style ?? {};
    if (style.background || style.border) {
      ctx.fillStyle = style.background ?? 'transparent';
      ctx.beginPath();
      roundedRect(ctx, node.x, node.y, node.w, node.h, style.radius ?? 0);
      ctx.fill();
      if (style.border) {
        ctx.strokeStyle = style.border;
        ctx.lineWidth = style.borderWidth ?? 2;
        ctx.stroke();
      }
    }
    for (const child of node.children ?? []) this.drawNode(child, ctx);
  }
}
