import * as THREE from 'three';
import { contains, drawButton, drawPanel, drawText, type Rect } from './widgets.ts';

export type PauseAction = 'resume' | 'save' | 'settings' | null;

export interface PauseMenu {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
  handleTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): PauseAction;
  render(renderer: THREE.WebGLRenderer): void;
}

/** 暂停面板（WX-025 第一版）：继续 / 保存 / 设置（占位禁用） */
export function createPauseMenu(screenWidth: number, screenHeight: number): PauseMenu {
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

  const panelWidth = 460;
  const panelHeight = 340;
  const panelX = (canvas.width - panelWidth) / 2;
  const panelY = (canvas.height - panelHeight) / 2;
  const panel: Rect = { x: panelX, y: panelY, w: panelWidth, h: panelHeight };
  const resume: Rect = { x: panelX + 60, y: panelY + 92, w: panelWidth - 120, h: 52 };
  const save: Rect = { x: panelX + 60, y: panelY + 158, w: panelWidth - 120, h: 52 };
  const settings: Rect = { x: panelX + 60, y: panelY + 224, w: panelWidth - 120, h: 52 };

  let open = false;

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!open) {
      texture.needsUpdate = true;
      return;
    }
    context.fillStyle = 'rgba(0, 0, 0, 0.62)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawPanel(context, panel);
    drawText(context, 'PAUSED', panelX + 28, panelY + 22, 32, '#ffffff');
    drawText(
      context,
      'WORLD SAVED AUTOMATICALLY',
      panelX + 28,
      panelY + 64,
      15,
      'rgba(255, 255, 255, 0.55)',
    );
    drawButton(context, resume, 'RESUME', 'normal', 24);
    drawButton(context, save, 'SAVE NOW', 'normal', 22);
    drawButton(context, settings, 'SETTINGS', 'normal', 20);
    texture.needsUpdate = true;
  };

  const setOpen = (value: boolean): void => {
    open = value;
    redraw();
  };

  redraw();

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
    handleTap(clientX: number, clientY: number, sw: number, sh: number): PauseAction {
      if (!open) return null;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;
      if (contains(resume, x, y)) {
        setOpen(false);
        return 'resume';
      }
      if (contains(save, x, y)) {
        setOpen(false);
        return 'save';
      }
      if (contains(settings, x, y)) {
        setOpen(false);
        return 'settings';
      }
      setOpen(false);
      return 'resume';
    },
    render(renderer: THREE.WebGLRenderer): void {
      if (!open) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
