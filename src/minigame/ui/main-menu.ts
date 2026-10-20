import * as THREE from 'three';
import { contains, drawButton, drawPanel, drawText, type Rect } from './widgets.ts';

export type MainMenuAction = 'play' | 'settings' | 'delete' | null;

export interface MainMenuInfo {
  name: string;
  seed: number;
  edits: number;
}

export interface MainMenu {
  open(): void;
  close(): void;
  isOpen(): boolean;
  setInfo(info: MainMenuInfo): void;
  handleTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): MainMenuAction;
  render(renderer: THREE.WebGLRenderer): void;
}

/** 启动主菜单（WX-024 第一版）：PLAY / SETTINGS / NEW WORLD(占位) */
export function createMainMenu(screenWidth: number, screenHeight: number): MainMenu {
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

  const panelWidth = 500;
  const panelHeight = 430;
  const panelX = (canvas.width - panelWidth) / 2;
  const panelY = (canvas.height - panelHeight) / 2;
  const panel: Rect = { x: panelX, y: panelY, w: panelWidth, h: panelHeight };
  const play: Rect = { x: panelX + 70, y: panelY + 190, w: panelWidth - 140, h: 56 };
  const settings: Rect = { x: panelX + 70, y: panelY + 260, w: panelWidth - 140, h: 56 };
  const newWorld: Rect = { x: panelX + 70, y: panelY + 320, w: panelWidth - 140, h: 38 };
  const deleteSave: Rect = { x: panelX + 70, y: panelY + 366, w: panelWidth - 140, h: 38 };

  let open = true;
  let info: MainMenuInfo = { name: 'MY WORLD', seed: 0x5eed, edits: 0 };

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!open) {
      texture.needsUpdate = true;
      return;
    }

    context.fillStyle = 'rgba(0, 0, 0, 0.45)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawPanel(context, panel);
    drawText(context, 'BEDROCK', panelX + 40, panelY + 28, 46, '#ffffff');
    drawText(
      context,
      'WECHAT MINI GAME',
      panelX + 42,
      panelY + 88,
      18,
      'rgba(200, 225, 255, 0.75)',
    );
    drawText(
      context,
      'SURVIVAL / CREATIVE',
      panelX + 42,
      panelY + 116,
      15,
      'rgba(255, 255, 255, 0.45)',
    );
    drawText(
      context,
      `${info.name}  ·  SEED 0x${info.seed.toString(16).toUpperCase()}  ·  EDITS ${info.edits}`,
      panelX + 42,
      panelY + 148,
      15,
      'rgba(180, 220, 255, 0.85)',
      'left',
      panelWidth - 84,
    );
    drawButton(context, play, 'PLAY', 'normal', 26);
    drawButton(context, settings, 'SETTINGS', 'normal', 22);
    drawButton(context, newWorld, 'NEW WORLD (SOON)', 'disabled', 18);
    drawButton(context, deleteSave, 'DELETE SAVE', 'normal', 16);
    texture.needsUpdate = true;
  };

  const setOpen = (value: boolean): void => {
    open = value;
    redraw();
  };

  redraw();

  return {
    open(): void {
      setOpen(true);
    },
    close(): void {
      setOpen(false);
    },
    isOpen(): boolean {
      return open;
    },
    setInfo(next: MainMenuInfo): void {
      info = { ...next };
      redraw();
    },
    handleTap(clientX: number, clientY: number, sw: number, sh: number): MainMenuAction {
      if (!open) return null;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;
      if (contains(play, x, y)) {
        setOpen(false);
        return 'play';
      }
      if (contains(settings, x, y)) {
        setOpen(false);
        return 'settings';
      }
      if (contains(deleteSave, x, y)) {
        return 'delete';
      }
      // 点面板外不关闭；主菜单必须显式 PLAY/SETTINGS/DELETE
      return null;
    },
    render(renderer: THREE.WebGLRenderer): void {
      if (!open) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
