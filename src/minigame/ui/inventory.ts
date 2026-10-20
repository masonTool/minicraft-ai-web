import * as THREE from 'three';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';
import { drawBlockIcon } from './icons.ts';
import { contains, drawButton, drawPanel, drawText, type Rect } from './widgets.ts';

export interface Inventory {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
  setSelected(index: number): void;
  /** 返回 true 表示这次点击被 UI 消费 */
  handleTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): boolean;
  render(renderer: THREE.WebGLRenderer): void;
}

/**
 * 背包/方块面板（WX-020B 第一版）
 *
 * 目前没有真正的 41 格物品模型，先做一个 9×3 的方块选择面板：
 * 前 6 格是快捷栏方块，点一下选中并关闭；其余格子先留空。
 * 等 WX-028 接入 Inventory 数据后，只替换 slots 数据源。
 */
export function createInventory(
  atlas: TextureAtlas,
  blocks: readonly number[],
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
  const rows = 3;
  const slot = 56;
  const gap = 8;
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
    drawText(context, 'INVENTORY', panelX + 20, panelY + 18, 28, '#ffffff');
    drawText(
      context,
      'TAP OUTSIDE TO CLOSE',
      panelX + panelWidth - 64,
      panelY + 22,
      16,
      'rgba(255, 255, 255, 0.55)',
      'right',
      180,
    );
    drawButton(context, closeRect, 'X', 'normal', 24);

    for (let i = 0; i < cols * rows; i++) {
      const { x, y } = slotRect(i);
      context.fillStyle = 'rgba(0, 0, 0, 0.42)';
      context.fillRect(x, y, slot, slot);
      context.strokeStyle =
        i === selected ? '#ffffff' : 'rgba(255, 255, 255, 0.28)';
      context.lineWidth = i === selected ? 4 : 2;
      context.strokeRect(x + 1, y + 1, slot - 2, slot - 2);
      if (i < blocks.length) drawBlockIcon(context, atlas, blocks[i]!, x, y, slot);
    }

    texture.needsUpdate = true;
  };

  const setOpen = (value: boolean): void => {
    open = value;
    redraw();
  };

  return {
    toggle(): void {
      setOpen(!open);
    },
    close(): void {
      setOpen(false);
    },
    isOpen(): boolean {
      return open;
    },
    setSelected(index: number): void {
      selected = Math.max(0, Math.min(blocks.length - 1, index));
      redraw();
    },
    handleTap(clientX: number, clientY: number, sw: number, sh: number): boolean {
      if (!open) return false;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;

      if (contains(closeRect, x, y)) {
        setOpen(false);
        return true;
      }

      for (let i = 0; i < blocks.length; i++) {
        const rect = slotRect(i);
        if (x >= rect.x && x <= rect.x + slot && y >= rect.y && y <= rect.y + slot) {
          selected = i;
          setOpen(false);
          return true;
        }
      }

      // 点面板外或空槽都关闭，避免玩家被困在背包里
      setOpen(false);
      return true;
    },
    render(renderer: THREE.WebGLRenderer): void {
      if (!open) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
