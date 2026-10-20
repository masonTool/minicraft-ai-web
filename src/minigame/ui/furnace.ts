import * as THREE from 'three';
import type { ItemStack } from '../../core/container/Inventory.ts';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';
import { drawBlockIcon } from './icons.ts';
import { contains, drawButton, drawPanel, drawText, type Rect } from './widgets.ts';

export type FurnaceAction =
  | { type: 'take'; index: number }
  | { type: 'put'; index: number }
  | null;

export interface FurnaceScreen {
  open(name: string, slots: readonly (ItemStack | null)[], player: readonly (ItemStack | null)[]): void;
  close(): void;
  isOpen(): boolean;
  setSlots(
    slots: readonly (ItemStack | null)[],
    player: readonly (ItemStack | null)[],
    burn: number,
    cook: number,
  ): void;
  handleTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): FurnaceAction;
  render(renderer: THREE.WebGLRenderer): void;
}

/** 熔炉界面：原料/燃料/产物 + 火焰/进度 + 快捷栏 */
export function createFurnaceScreen(
  atlas: TextureAtlas,
  screenWidth: number,
  screenHeight: number,
): FurnaceScreen {
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
    new THREE.PlaneGeometry(
      2,
      2 * (canvas.height / canvas.width) * (screenWidth / Math.max(1, screenHeight)),
    ),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  scene.add(mesh);

  const slot = 56;
  const panelWidth = 600;
  const panelHeight = 370;
  const panelX = (canvas.width - panelWidth) / 2;
  const panelY = (canvas.height - panelHeight) / 2;
  const panel: Rect = { x: panelX, y: panelY, w: panelWidth, h: panelHeight };
  const closeRect: Rect = { x: panelX + panelWidth - 48, y: panelY + 12, w: 34, h: 34 };
  const inputRect: Rect = { x: panelX + 80, y: panelY + 100, w: slot, h: slot };
  const fuelRect: Rect = { x: panelX + 80, y: panelY + 190, w: slot, h: slot };
  const outputRect: Rect = { x: panelX + 390, y: panelY + 136, w: slot, h: slot };
  const playerY = panelY + 288;

  let open = false;
  let name = '熔炉';
  let slots: readonly (ItemStack | null)[] = new Array(3).fill(null);
  let playerSlots: readonly (ItemStack | null)[] = new Array(9).fill(null);
  let burn01 = 0;
  let cook01 = 0;

  const playerRect = (index: number): Rect => ({
    x: panelX + 30 + index * 56,
    y: playerY,
    w: 48,
    h: 48,
  });

  const drawSlot = (rect: Rect, stack: ItemStack | null, border = 'rgba(160, 205, 230, 0.35)'): void => {
    if (!context) return;
    const gradient = context.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
    gradient.addColorStop(0, 'rgba(52, 62, 72, 0.72)');
    gradient.addColorStop(1, 'rgba(10, 14, 18, 0.78)');
    context.fillStyle = gradient;
    context.fillRect(rect.x, rect.y, rect.w, rect.h);
    context.fillStyle = 'rgba(255, 255, 255, 0.07)';
    context.fillRect(rect.x + 2, rect.y + 2, rect.w - 4, 3);
    context.strokeStyle = border;
    context.lineWidth = 2;
    context.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    if (stack) {
      drawBlockIcon(context, atlas, stack.id, rect.x, rect.y, rect.w);
      if (stack.count > 1) {
        drawText(context, `${stack.count}`, rect.x + rect.w - 4, rect.y + rect.h - 18, 14, '#ffffff', 'right', 34);
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
      '点原料/产物取出 · 点快捷栏放入',
      panelX + 24,
      panelY + 54,
      13,
      'rgba(190, 220, 240, 0.65)',
    );
    drawButton(context, closeRect, 'X', 'normal', 20);

    drawText(context, '原料', inputRect.x, inputRect.y - 24, 14, 'rgba(225, 238, 248, 0.8)');
    drawText(context, '燃料', fuelRect.x, fuelRect.y - 24, 14, 'rgba(225, 238, 248, 0.8)');
    drawText(context, '产物', outputRect.x, outputRect.y - 24, 14, 'rgba(225, 238, 248, 0.8)');
    drawSlot(inputRect, slots[0] ?? null);
    drawSlot(fuelRect, slots[1] ?? null);
    drawSlot(outputRect, slots[2] ?? null, 'rgba(255, 220, 140, 0.75)');

    // 火焰
    const flameX = fuelRect.x + slot / 2;
    const flameY = fuelRect.y - 44;
    context.fillStyle = burn01 > 0 ? 'rgba(255, 150, 60, 0.9)' : 'rgba(80, 70, 60, 0.5)';
    context.beginPath();
    context.moveTo(flameX, flameY + 30);
    context.lineTo(flameX - 12, flameY + 18);
    context.lineTo(flameX - 5, flameY);
    context.lineTo(flameX + 5, flameY + 10);
    context.lineTo(flameX + 12, flameY + 18);
    context.closePath();
    context.fill();

    // 进度箭头
    const arrowX = inputRect.x + slot + 34;
    const arrowY = inputRect.y + slot / 2;
    context.fillStyle = 'rgba(200, 225, 240, 0.4)';
    context.fillRect(arrowX, arrowY - 3, 210, 6);
    context.fillStyle = 'rgba(150, 220, 245, 0.9)';
    context.fillRect(arrowX, arrowY - 3, 210 * cook01, 6);
    context.beginPath();
    context.moveTo(arrowX + 218, arrowY - 10);
    context.lineTo(arrowX + 236, arrowY);
    context.lineTo(arrowX + 218, arrowY + 10);
    context.closePath();
    context.fill();

    drawText(context, '快捷栏', panelX + 30, playerY - 26, 15, 'rgba(220, 235, 245, 0.85)');
    for (let i = 0; i < 9; i++) drawSlot(playerRect(i), playerSlots[i] ?? null);
    texture.needsUpdate = true;
  };

  const setOpen = (value: boolean): void => {
    open = value;
    redraw();
  };

  redraw();

  return {
    open(nextName, nextSlots, player): void {
      name = nextName;
      slots = nextSlots.slice(0, 3);
      playerSlots = player.slice(0, 9);
      burn01 = 0;
      cook01 = 0;
      setOpen(true);
    },
    close(): void {
      setOpen(false);
    },
    isOpen(): boolean {
      return open;
    },
    setSlots(next, player, burn, cook): void {
      slots = next.slice(0, 3);
      playerSlots = player.slice(0, 9);
      burn01 = Math.max(0, Math.min(1, burn));
      cook01 = Math.max(0, Math.min(1, cook));
      redraw();
    },
    handleTap(clientX, clientY, sw, sh): FurnaceAction {
      if (!open) return null;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;
      if (contains(closeRect, x, y)) {
        setOpen(false);
        return null;
      }
      for (const [rect, index] of [
        [inputRect, 0],
        [fuelRect, 1],
        [outputRect, 2],
      ] as const) {
        if (contains(rect, x, y)) {
          if (slots[index]) return { type: 'take', index };
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
