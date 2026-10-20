import * as THREE from 'three';
import {
  contains,
  drawButton,
  drawPanel,
  drawSlider,
  drawSwitch,
  drawTab,
  drawText,
  type Rect,
} from './widgets.ts';

export interface SettingsValues {
  fov: number;
  renderDistance: number;
  sound: boolean;
  invertLook: boolean;
}

export type SettingsAction = 'back' | null;

export interface SettingsMenu {
  open(): void;
  close(): void;
  isOpen(): boolean;
  handleTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): SettingsAction;
  render(renderer: THREE.WebGLRenderer): void;
}

type Tab = 'video' | 'game';

/** 设置页（WX-022）：VIDEO/GAME 页签、滑块、开关 */
export function createSettingsMenu(
  screenWidth: number,
  screenHeight: number,
  initial: SettingsValues,
  onChange: (values: SettingsValues) => void,
): SettingsMenu {
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

  const panelWidth = 680;
  const panelHeight = 430;
  const panelX = (canvas.width - panelWidth) / 2;
  const panelY = (canvas.height - panelHeight) / 2;
  const panel: Rect = { x: panelX, y: panelY, w: panelWidth, h: panelHeight };
  const videoTab: Rect = { x: panelX + 28, y: panelY + 70, w: 140, h: 42 };
  const gameTab: Rect = { x: panelX + 176, y: panelY + 70, w: 140, h: 42 };
  const backButton: Rect = { x: panelX + panelWidth - 128, y: panelY + panelHeight - 62, w: 100, h: 40 };
  const fovSlider: Rect = { x: panelX + 60, y: panelY + 165, w: panelWidth - 120, h: 30 };
  const distanceSlider: Rect = { x: panelX + 60, y: panelY + 255, w: panelWidth - 120, h: 30 };
  const soundSwitch: Rect = { x: panelX + 60, y: panelY + 165, w: panelWidth - 120, h: 30 };
  const invertSwitch: Rect = { x: panelX + 60, y: panelY + 235, w: panelWidth - 120, h: 30 };

  const values: SettingsValues = { ...initial };
  let tab: Tab = 'video';
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
    drawText(context, 'SETTINGS', panelX + 28, panelY + 20, 30, '#ffffff');
    drawTab(context, videoTab, 'VIDEO', tab === 'video');
    drawTab(context, gameTab, 'GAME', tab === 'game');

    if (tab === 'video') {
      const fovValue = (values.fov - 60) / 40;
      drawSlider(context, fovSlider, fovValue, 'FOV', `${values.fov}`);
      const distanceValue = (values.renderDistance - 2) / 4;
      drawSlider(
        context,
        distanceSlider,
        distanceValue,
        'RENDER DISTANCE',
        `${values.renderDistance}`,
      );
      drawText(
        context,
        'CHANGES APPLY IMMEDIATELY',
        panelX + 28,
        panelY + 330,
        15,
        'rgba(255, 255, 255, 0.5)',
      );
    } else {
      drawSwitch(context, soundSwitch, 'SOUND', values.sound);
      drawSwitch(context, invertSwitch, 'INVERT LOOK', values.invertLook);
      drawText(
        context,
        'TOUCH TO TOGGLE',
        panelX + 28,
        panelY + 330,
        15,
        'rgba(255, 255, 255, 0.5)',
      );
    }

    drawButton(context, backButton, 'BACK', 'normal', 20);
    texture.needsUpdate = true;
  };

  const setOpen = (value: boolean): void => {
    open = value;
    redraw();
  };

  const notify = (): void => {
    redraw();
    onChange({ ...values });
  };

  const hitSlider = (rect: Rect, x: number, y: number): number | null => {
    if (x < rect.x || x > rect.x + rect.w) return null;
    if (y < rect.y - 24 || y > rect.y + rect.h + 16) return null;
    return Math.max(0, Math.min(1, (x - rect.x) / rect.w));
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
    handleTap(clientX: number, clientY: number, sw: number, sh: number): SettingsAction {
      if (!open) return null;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;

      if (contains(videoTab, x, y)) {
        tab = 'video';
        redraw();
        return null;
      }
      if (contains(gameTab, x, y)) {
        tab = 'game';
        redraw();
        return null;
      }
      if (contains(backButton, x, y)) {
        setOpen(false);
        return 'back';
      }

      if (tab === 'video') {
        const fov = hitSlider(fovSlider, x, y);
        if (fov !== null) {
          values.fov = Math.round(60 + fov * 40);
          notify();
          return null;
        }
        const distance = hitSlider(distanceSlider, x, y);
        if (distance !== null) {
          values.renderDistance = Math.round(2 + distance * 4);
          notify();
          return null;
        }
      } else {
        if (contains(soundSwitch, x, y)) {
          values.sound = !values.sound;
          notify();
          return null;
        }
        if (contains(invertSwitch, x, y)) {
          values.invertLook = !values.invertLook;
          notify();
          return null;
        }
      }

      setOpen(false);
      return 'back';
    },
    render(renderer: THREE.WebGLRenderer): void {
      if (!open) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
