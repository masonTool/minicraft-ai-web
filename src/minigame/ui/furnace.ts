import * as THREE from 'three';
import type { ItemStack } from '../../core/container/Inventory.ts';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';
import { drawBlockIcon } from './icons.ts';
import { contains, drawButton, drawPanel, drawText, type Rect } from './widgets.ts';

export type FurnaceAction =
  | {
      type: 'move';
      fromSide: 'station' | 'player';
      fromIndex: number;
      toSide: 'station' | 'player';
      toIndex: number;
    }
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

/** 熔炉界面：原料/燃料/产物 + 火焰/进度 + 4×9 完整背包；点起一格再点目标格。 */
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

  const slot = 44;
  const gap = 4;
  const panelWidth = 9 * slot + 8 * gap + 60;
  const panelHeight = 430;
  const panelX = (canvas.width - panelWidth) / 2;
  const panelY = (canvas.height - panelHeight) / 2;
  const panel: Rect = { x: panelX, y: panelY, w: panelWidth, h: panelHeight };
  const closeRect: Rect = { x: panelX + panelWidth - 46, y: panelY + 12, w: 32, h: 32 };
  const inputRect: Rect = { x: panelX + 64, y: panelY + 88, w: slot, h: slot };
  const fuelRect: Rect = { x: panelX + 64, y: panelY + 156, w: slot, h: slot };
  const outputRect: Rect = { x: panelX + 318, y: panelY + 122, w: slot, h: slot };
  const playerY = panelY + 252;

  let open = false;
  let name = '熔炉';
  let slots: readonly (ItemStack | null)[] = new Array(3).fill(null);
  let playerSlots: readonly (ItemStack | null)[] = new Array(36).fill(null);
  let burn01 = 0;
  let cook01 = 0;
  let held: { side: 'station' | 'player'; index: number } | null = null;

  const playerRect = (index: number): Rect => ({
    x: panelX + 30 + (index % 9) * (slot + gap),
    y: playerY + Math.floor(index / 9) * (slot + gap),
    w: slot,
    h: slot,
  });

  const isHeld = (side: 'station' | 'player', index: number): boolean =>
    held?.side === side && held.index === index;

  const drawSlot = (rect: Rect, stack: ItemStack | null, highlight = false): void => {
    if (!context) return;
    const gradient = context.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
    gradient.addColorStop(0, highlight ? 'rgba(92, 112, 128, 0.88)' : 'rgba(52, 62, 72, 0.72)');
    gradient.addColorStop(1, highlight ? 'rgba(30, 42, 52, 0.9)' : 'rgba(10, 14, 18, 0.78)');
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
          rect.x + rect.w - 3,
          rect.y + rect.h - 16,
          13,
          '#ffffff',
          'right',
          30,
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
    drawText(context, name, panelX + 24, panelY + 16, 24, '#ffffff');
    drawText(
      context,
      '点起一格 · 点目标格交换/合并',
      panelX + 24,
      panelY + 52,
      13,
      'rgba(190, 220, 240, 0.7)',
    );
    drawButton(context, closeRect, 'X', 'normal', 20);

    drawText(context, '原料', inputRect.x, inputRect.y - 22, 14, 'rgba(225, 238, 248, 0.8)');
    drawText(context, '燃料', fuelRect.x, fuelRect.y - 22, 14, 'rgba(225, 238, 248, 0.8)');
    drawText(context, '产物', outputRect.x, outputRect.y - 22, 14, 'rgba(225, 238, 248, 0.8)');
    drawSlot(inputRect, slots[0] ?? null, isHeld('station', 0));
    drawSlot(fuelRect, slots[1] ?? null, isHeld('station', 1));
    drawSlot(outputRect, slots[2] ?? null, isHeld('station', 2));

    // 火焰：燃料槽与原料槽之间
    const flameX = inputRect.x - 26;
    const flameY = fuelRect.y - 6;
    context.fillStyle = burn01 > 0 ? 'rgba(255, 150, 60, 0.9)' : 'rgba(80, 70, 60, 0.5)';
    context.beginPath();
    context.moveTo(flameX, flameY + 26);
    context.lineTo(flameX - 10, flameY + 15);
    context.lineTo(flameX - 4, flameY);
    context.lineTo(flameX + 4, flameY + 9);
    context.lineTo(flameX + 10, flameY + 15);
    context.closePath();
    context.fill();

    // 进度箭头：原料 → 产物
    const arrowX = inputRect.x + slot + 26;
    const arrowY = inputRect.y + slot / 2;
    context.fillStyle = 'rgba(200, 225, 240, 0.4)';
    context.fillRect(arrowX, arrowY - 3, 190, 6);
    context.fillStyle = 'rgba(150, 220, 245, 0.9)';
    context.fillRect(arrowX, arrowY - 3, 190 * cook01, 6);
    context.beginPath();
    context.moveTo(arrowX + 196, arrowY - 9);
    context.lineTo(arrowX + 212, arrowY);
    context.lineTo(arrowX + 196, arrowY + 9);
    context.closePath();
    context.fill();

    drawText(context, '背包', panelX + 30, playerY - 24, 15, 'rgba(220, 235, 245, 0.85)');
    for (let i = 0; i < 36; i++) {
      drawSlot(playerRect(i), playerSlots[i] ?? null, isHeld('player', i));
    }
    texture.needsUpdate = true;
  };

  const setOpen = (value: boolean): void => {
    open = value;
    if (!open) held = null;
    redraw();
  };

  const slotAt = (
    x: number,
    y: number,
  ): { side: 'station' | 'player'; index: number } | null => {
    if (contains(inputRect, x, y)) return { side: 'station', index: 0 };
    if (contains(fuelRect, x, y)) return { side: 'station', index: 1 };
    if (contains(outputRect, x, y)) return { side: 'station', index: 2 };
    for (let i = 0; i < 36; i++) {
      if (contains(playerRect(i), x, y)) return { side: 'player', index: i };
    }
    return null;
  };

  redraw();

  return {
    open(nextName, nextSlots, player): void {
      name = nextName;
      slots = nextSlots.slice(0, 3);
      playerSlots = player.slice(0, 36);
      burn01 = 0;
      cook01 = 0;
      held = null;
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
      playerSlots = player.slice(0, 36);
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
      const hit = slotAt(x, y);
      if (!hit) {
        setOpen(false);
        return null;
      }
      const stack = hit.side === 'station' ? slots[hit.index] : playerSlots[hit.index];
      if (!held) {
        if (stack) {
          held = hit;
          redraw();
        }
        return null;
      }
      if (held.side === hit.side && held.index === hit.index) {
        held = null;
        redraw();
        return null;
      }
      const action: FurnaceAction = {
        type: 'move',
        fromSide: held.side,
        fromIndex: held.index,
        toSide: hit.side,
        toIndex: hit.index,
      };
      held = null;
      redraw();
      return action;
    },
    render(renderer: THREE.WebGLRenderer): void {
      if (!open) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
