import * as THREE from 'three';
import { contains, drawButton, drawPanel, drawTab, drawText, type Rect } from './widgets.ts';

export type MainMenuAction =
  | 'play'
  | 'settings'
  | 'new'
  | 'delete'
  | { type: 'world'; id: string }
  | null;

export interface MainMenuInfo {
  worlds: Array<{ id: string; name: string }>;
  currentId: string;
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

  const panelWidth = 560;
  const panelHeight = 440;
  const panelX = (canvas.width - panelWidth) / 2;
  const panelY = (canvas.height - panelHeight) / 2;
  const panel: Rect = { x: panelX, y: panelY, w: panelWidth, h: panelHeight };
  const play: Rect = { x: panelX + 70, y: panelY + 210, w: panelWidth - 140, h: 52 };
  const settings: Rect = { x: panelX + 70, y: panelY + 276, w: panelWidth - 140, h: 44 };
  const newWorld: Rect = { x: panelX + 70, y: panelY + 334, w: panelWidth - 140, h: 38 };
  const deleteSave: Rect = { x: panelX + 70, y: panelY + 380, w: panelWidth - 140, h: 36 };

  let open = true;
  let info: MainMenuInfo = {
    worlds: [{ id: 'wx-default', name: 'MY WORLD' }],
    currentId: 'wx-default',
    seed: 0x5eed,
    edits: 0,
  };

  const worldRect = (index: number): Rect => ({
    x: panelX + 32 + index * 160,
    y: panelY + 142,
    w: 150,
    h: 34,
  });

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!open) {
      texture.needsUpdate = true;
      return;
    }

    const backdrop = context.createLinearGradient(0, 0, 0, canvas.height);
    backdrop.addColorStop(0, 'rgba(8, 16, 26, 0.5)');
    backdrop.addColorStop(1, 'rgba(0, 0, 0, 0.74)');
    context.fillStyle = backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawPanel(context, panel);
    drawText(context, 'BEDROCK', panelX + 40, panelY + 24, 46, '#ffffff');
    context.fillStyle = 'rgba(125, 215, 245, 0.95)';
    context.fillRect(panelX + 42, panelY + 78, 240, 4);
    drawText(
      context,
      'WECHAT MINI GAME',
      panelX + 42,
      panelY + 88,
      18,
      'rgba(190, 225, 250, 0.8)',
    );
    drawText(
      context,
      'SURVIVAL / CREATIVE',
      panelX + 42,
      panelY + 116,
      15,
      'rgba(255, 255, 255, 0.45)',
    );
    const visibleWorlds = info.worlds.slice(0, 3);
    visibleWorlds.forEach((world, index) => {
      drawTab(
        context,
        worldRect(index),
        world.name,
        world.id === info.currentId,
      );
    });
    drawText(
      context,
      `SEED 0x${info.seed.toString(16).toUpperCase()}  ·  EDITS ${info.edits}`,
      panelX + 42,
      panelY + 188,
      13,
      'rgba(180, 220, 255, 0.85)',
      'left',
      panelWidth - 84,
    );
    drawButton(context, play, 'PLAY', 'normal', 26);
    drawButton(context, settings, 'SETTINGS', 'normal', 22);
    drawButton(context, newWorld, 'NEW WORLD', 'normal', 18);
    drawButton(context, deleteSave, 'DELETE WORLD', 'normal', 16);
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
      for (let i = 0; i < Math.min(3, info.worlds.length); i++) {
        if (contains(worldRect(i), x, y)) {
          const world = info.worlds[i]!;
          if (world.id !== info.currentId) return { type: 'world', id: world.id };
          return null;
        }
      }
      if (contains(play, x, y)) {
        setOpen(false);
        return 'play';
      }
      if (contains(settings, x, y)) {
        setOpen(false);
        return 'settings';
      }
      if (contains(newWorld, x, y)) {
        return 'new';
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
