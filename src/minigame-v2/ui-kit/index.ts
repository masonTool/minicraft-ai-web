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

export interface UiSlotNode extends UiNode {
  kind: 'slot';
  itemId: number;
  count: number;
  selected: boolean;
  onTap: () => void;
}

export type UiElement = UiNode | UiTextNode | UiButtonNode | UiToggleNode | UiSliderNode | UiSlotNode;

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
): UiButtonNode {
  return { kind: 'button', x, y, w, h, label, onClick, style };
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
  itemId: number,
  count: number,
  selected: boolean,
  onTap: () => void,
): UiSlotNode {
  return { kind: 'slot', x, y, w: size, h: size, itemId, count, selected, onTap };
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
  private slots: UiSlotNode[] = [];
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

    if (phase === 'move' && this.activeSlider) {
      this.updateSlider(this.activeSlider, x);
      return true;
    }
    if (phase === 'up') {
      if (this.activeSlider) {
        this.activeSlider = null;
        return true;
      }
      return false;
    }
    if (phase !== 'down') return false;

    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const item = this.buttons[i]!;
      if (x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h) {
        item.onClick?.();
        return true;
      }
    }

    for (let i = this.slots.length - 1; i >= 0; i--) {
      const item = this.slots[i]!;
      if (x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h) {
        item.onTap();
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

  private updateSlider(node: UiSliderNode, x: number): void {
    const raw = ((x - node.x) / Math.max(1, node.w)) * (node.max - node.min) + node.min;
    const stepped = Math.round(raw / node.step) * node.step;
    const value = Math.max(node.min, Math.min(node.max, stepped));
    if (value !== node.value) {
      node.value = value;
      node.onChange(value);
    }
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

  render(renderer: THREE.WebGLRenderer): void {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }

  private draw(): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, DESIGN_WIDTH, this.designHeight);
    this.buttons = [];
    this.slots = [];
    if (this.root) this.drawNode(this.root, ctx);
    this.texture.needsUpdate = true;
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

    if ('kind' in node && node.kind === 'slot') {
      ctx.fillStyle = node.selected ? 'rgba(100, 140, 160, 0.92)' : 'rgba(30, 38, 46, 0.92)';
      roundedRect(ctx, node.x, node.y, node.w, node.h, 6);
      ctx.fill();
      ctx.strokeStyle = node.selected ? '#9fe0ff' : 'rgba(160, 205, 230, 0.32)';
      ctx.lineWidth = node.selected ? 3 : 1.5;
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
