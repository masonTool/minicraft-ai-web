import * as THREE from 'three';
import type { ItemStack } from '../../core/container/Inventory.ts';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';
import { drawBlockIcon } from './icons.ts';
import { contains, drawButton, drawPanel, drawText, type Rect } from './widgets.ts';

export type InventoryAction =
  | { type: 'select'; index: number }
  | { type: 'swap'; index: number }
  | { type: 'move'; from: number; to: number }
  | null;

export interface Inventory {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
  setSelected(index: number): void;
  setSlots(slots: readonly (ItemStack | null)[]): void;
  handleDown(clientX: number, clientY: number, screenWidth: number, screenHeight: number): boolean;
  handleMove(clientX: number, clientY: number, screenWidth: number, screenHeight: number): void;
  handleUp(clientX: number, clientY: number, screenWidth: number, screenHeight: number): InventoryAction;
  render(renderer: THREE.WebGLRenderer): void;
}

/**
 * 真实 41 格背包面板（WX-023/028 第一版）
 *
 * 9×5 网格：0-8 快捷栏、9-35 主背包、36-40 盔甲/副手（先当普通槽显示）。
 * 点快捷栏槽位 = 选中；点其他有物品的槽位 = 与当前快捷栏槽位交换。
 */
export function createInventory(
  atlas: TextureAtlas,
  slots: readonly (ItemStack | null)[],
  screenWidth: number,
  screenHeight: number,
): Inventory {
  const doc = (globalThis as unknown as { document: Document }).document;
  const canvas = doc.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(320, Math.round((1024 * screenHeight) / Math.max(1, screenWidth)));
  const context = canvas.getContext('2d');
  if (context) context.imageSmoothingEnabled = false;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, (2 * canvas.height) / canvas.width),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  scene.add(mesh);

  const cols = 9;
  const rows = 5;
  const slot = 48;
  const gap = 6;
  const gridWidth = cols * slot + (cols - 1) * gap;
  const gridHeight = rows * slot + (rows - 1) * gap;
  const panelWidth = gridWidth + 40;
  const panelHeight = gridHeight + 76;
  const panelX = (canvas.width - panelWidth) / 2;
  const panelY = (canvas.height - panelHeight) / 2;
  const panelRect: Rect = { x: panelX, y: panelY, w: panelWidth, h: panelHeight };
  const closeRect: Rect = { x: panelX + panelWidth - 50, y: panelY + 12, w: 36, h: 36 };
  const gridX = panelX + 20;
  const gridY = panelY + 56;

  let open = false;
  let selected = 0;
  let currentSlots: readonly (ItemStack | null)[] = slots;
  let drag: { from: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null =
    null;

  const slotRect = (index: number): { x: number; y: number } => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return { x: gridX + col * (slot + gap), y: gridY + row * (slot + gap) };
  };

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!open) {
      texture.needsUpdate = true;
      return;
    }

    context.fillStyle = 'rgba(0, 0, 0, 0.58)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawPanel(context, panelRect);
    drawText(context, 'INVENTORY', panelX + 20, panelY + 18, 26, '#ffffff');
    drawText(
      context,
      'TAP HOTBAR = SELECT · TAP ITEM = SWAP',
      panelX + 20,
      panelY + 48,
      13,
      'rgba(255, 255, 255, 0.55)',
      'left',
      panelWidth - 100,
    );
    drawButton(context, closeRect, 'X', 'normal', 24);

    for (let i = 0; i < cols * rows; i++) {
      const { x, y } = slotRect(i);
      context.fillStyle = 'rgba(0, 0, 0, 0.42)';
      context.fillRect(x, y, slot, slot);
      context.strokeStyle =
        i === selected ? '#ffffff' : i < 9 ? 'rgba(190, 220, 255, 0.55)' : 'rgba(255, 255, 255, 0.25)';
      context.lineWidth = i === selected ? 4 : 2;
      context.strokeRect(x + 1, y + 1, slot - 2, slot - 2);

      const stack = i < 41 ? currentSlots[i] : null;
      if (stack && stack.count > 0) {
        drawBlockIcon(context, atlas, stack.id, x, y, slot);
        if (stack.count > 1) {
          drawText(context, `${stack.count}`, x + slot - 4, y + slot - 18, 14, '#ffffff', 'right', 34);
        }
      }
    }

    // 拖拽中的物品跟随手指
    if (drag?.moved) {
      const stack = currentSlots[drag.from];
      if (stack) {
        context.globalAlpha = 0.82;
        drawBlockIcon(context, atlas, stack.id, drag.x - slot / 2, drag.y - slot / 2, slot);
        context.globalAlpha = 1;
        if (stack.count > 1) {
          drawText(
            context,
            `${stack.count}`,
            drag.x + slot / 2 - 4,
            drag.y + slot / 2 - 18,
            14,
            '#ffffff',
            'right',
            34,
          );
        }
      }
    }

    texture.needsUpdate = true;
  };

  const setOpen = (value: boolean): void => {
    open = value;
    redraw();
  };

  const slotAt = (x: number, y: number): number | null => {
    for (let i = 0; i < Math.min(41, cols * rows); i++) {
      const rect = slotRect(i);
      if (x >= rect.x && x <= rect.x + slot && y >= rect.y && y <= rect.y + slot) return i;
    }
    return null;
  };

  redraw();

  return {
    toggle(): void {
      drag = null;
      setOpen(!open);
    },
    close(): void {
      drag = null;
      setOpen(false);
    },
    isOpen(): boolean {
      return open;
    },
    setSelected(index: number): void {
      selected = Math.max(0, Math.min(8, index));
      redraw();
    },
    setSlots(next: readonly (ItemStack | null)[]): void {
      currentSlots = next;
      redraw();
    },
    handleDown(clientX: number, clientY: number, sw: number, sh: number): boolean {
      if (!open) return false;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;

      if (contains(closeRect, x, y)) {
        drag = null;
        setOpen(false);
        return true;
      }

      const index = slotAt(x, y);
      if (index === null) {
        drag = null;
        setOpen(false);
        return true;
      }
      const stack = currentSlots[index];
      if (!stack) {
        drag = null;
        setOpen(false);
        return true;
      }
      drag = { from: index, startX: x, startY: y, x, y, moved: false };
      redraw();
      return true;
    },
    handleMove(clientX: number, clientY: number, sw: number, sh: number): void {
      if (!open || !drag) return;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;
      drag.x = x;
      drag.y = y;
      if (Math.hypot(x - drag.startX, y - drag.startY) > 8) drag.moved = true;
      redraw();
    },
    handleUp(clientX: number, clientY: number, sw: number, sh: number): InventoryAction {
      if (!open || !drag) return null;
      const current = drag;
      drag = null;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;

      if (!current.moved) {
        setOpen(false);
        if (current.from < 9) {
          selected = current.from;
          return { type: 'select', index: current.from };
        }
        return { type: 'swap', index: current.from };
      }

      const target = slotAt(x, y);
      setOpen(false);
      if (target !== null && target !== current.from) {
        return { type: 'move', from: current.from, to: target };
      }
      return null;
    },
    render(renderer: THREE.WebGLRenderer): void {
      if (!open) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
