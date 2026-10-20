import * as THREE from 'three';
import type { ItemStack } from '../../core/container/Inventory.ts';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';
import { drawBlockIcon } from './icons.ts';
import { contains, drawButton, drawPanel, drawText, type Rect } from './widgets.ts';

export type ChestAction =
  | { type: 'take'; index: number }
  | { type: 'put'; index: number }
  | null;

export interface ChestScreen {
  open(name: string, chest: readonly (ItemStack | null)[], player: readonly (ItemStack | null)[]): void;
  close(): void;
  isOpen(): boolean;
  setSlots(chest: readonly (ItemStack | null)[], player: readonly (ItemStack | null)[]): void;
  handleTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): ChestAction;
  render(renderer: THREE.WebGLRenderer): void;
}

/** 箱子界面：上 3×9 容器，下 1×9 快捷栏；点格子整叠转移 */
export function createChestScreen(
  atlas: TextureAtlas,
  screenWidth: number,
  screenHeight: number,
): ChestScreen {
  const doc = (globalThis as unknown as { document: Document }).document;
  const canvas = doc.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(320, Math.round((1024 * screenHeight) / Math.max(1, screenWidth)));
  const context = canvas.getContext('2d');

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

  const slot = 48;
  const gap = 5;
  const panelWidth = 9 * slot + 8 * gap + 60;
  const panelHeight = 360;
  const panelX = (canvas.width - panelWidth) / 2;
  const panelY = (canvas.height - panelHeight) / 2;
  const panel: Rect = { x: panelX, y: panelY, w: panelWidth, h: panelHeight };
  const closeRect: Rect = { x: panelX + panelWidth - 48, y: panelY + 12, w: 34, h: 34 };
  const chestX = panelX + 30;
  const chestY = panelY + 84;
  const playerY = panelY + 268;

  let open = false;
  let name = '箱子';
  let chestSlots: readonly (ItemStack | null)[] = new Array(27).fill(null);
  let playerSlots: readonly (ItemStack | null)[] = new Array(9).fill(null);

  const chestRect = (index: number): Rect => ({
    x: chestX + (index % 9) * (slot + gap),
    y: chestY + Math.floor(index / 9) * (slot + gap),
    w: slot,
    h: slot,
  });
  const playerRect = (index: number): Rect => ({
    x: chestX + index * (slot + gap),
    y: playerY,
    w: slot,
    h: slot,
  });

  const drawSlot = (rect: Rect, stack: ItemStack | null, highlight = false): void => {
    if (!context) return;
    const gradient = context.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
    gradient.addColorStop(0, 'rgba(52, 62, 72, 0.72)');
    gradient.addColorStop(1, 'rgba(10, 14, 18, 0.78)');
    context.fillStyle = gradient;
    context.fillRect(rect.x, rect.y, rect.w, rect.h);
    context.fillStyle = 'rgba(255, 255, 255, 0.07)';
    context.fillRect(rect.x + 2, rect.y + 2, rect.w - 4, 3);
    context.strokeStyle = highlight ? '#9fe0ff' : 'rgba(160, 205, 230, 0.35)';
    context.lineWidth = 2;
    context.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    if (stack) {
      drawBlockIcon(context, atlas, stack.id, rect.x, rect.y, rect.w);
      if (stack.count > 1) {
        drawText(
          context,
          `${stack.count}`,
          rect.x + rect.w - 4,
          rect.y + rect.h - 18,
          14,
          '#ffffff',
          'right',
          34,
        );
      }
    }
  };

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!open) {
      texture.needsUpdate = true;
      return;
    }
    context.fillStyle = 'rgba(0, 0, 0, 0.6)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawPanel(context, panel);
    drawText(context, name, panelX + 24, panelY + 18, 24, '#ffffff');
    drawText(
      context,
      '点箱子格取出 · 点快捷栏格放入',
      panelX + 24,
      panelY + 54,
      13,
      'rgba(190, 220, 240, 0.65)',
    );
    drawButton(context, closeRect, 'X', 'normal', 20);
    for (let i = 0; i < 27; i++) drawSlot(chestRect(i), chestSlots[i] ?? null);
    drawText(context, '快捷栏', panelX + 30, playerY - 26, 15, 'rgba(220, 235, 245, 0.85)');
    for (let i = 0; i < 9; i++) {
      drawSlot(playerRect(i), playerSlots[i] ?? null, i === 0);
    }
    texture.needsUpdate = true;
  };

  const setOpen = (value: boolean): void => {
    open = value;
    redraw();
  };

  redraw();

  return {
    open(nextName, chest, player): void {
      name = nextName;
      chestSlots = chest.slice(0, 27);
      playerSlots = player.slice(0, 9);
      setOpen(true);
    },
    close(): void {
      setOpen(false);
    },
    isOpen(): boolean {
      return open;
    },
    setSlots(chest, player): void {
      chestSlots = chest.slice(0, 27);
      playerSlots = player.slice(0, 9);
      redraw();
    },
    handleTap(clientX, clientY, sw, sh): ChestAction {
      if (!open) return null;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;
      if (contains(closeRect, x, y)) {
        setOpen(false);
        return null;
      }
      for (let i = 0; i < 27; i++) {
        if (contains(chestRect(i), x, y)) {
          if (chestSlots[i]) return { type: 'take', index: i };
          return null;
        }
      }
      for (let i = 0; i < 9; i++) {
        if (contains(playerRect(i), x, y)) {
          if (playerSlots[i]) return { type: 'put', index: i };
          return null;
        }
      }
      setOpen(false);
      return null;
    },
    render(renderer: THREE.WebGLRenderer): void {
      if (!open) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
