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

import type { CameraMode } from '../../core/viewMode.ts';

export interface SettingsValues {
  fov: number;
  renderDistance: number;
  sound: boolean;
  invertLook: boolean;
  cameraMode: CameraMode;
  sensitivity: number;
  autoJump: boolean;
}

export type SettingsAction = 'back' | null;

export interface SettingsMenu {
  open(): void;
  close(): void;
  isOpen(): boolean;
  handleTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): SettingsAction;
  handleScrollMove(clientX: number, clientY: number, screenWidth: number, screenHeight: number): void;
  handleScrollUp(): void;
  render(renderer: THREE.WebGLRenderer): void;
}

type Tab = 'video' | 'game' | 'controls';

/** 设置页（WX-022）：VIDEO/GAME/CONTROLS 页签、滑块、开关、搜索输入、滚动列表 */
export function createSettingsMenu(
  screenWidth: number,
  screenHeight: number,
  initial: SettingsValues,
  onChange: (values: SettingsValues) => void,
  _requestText?: (current: string) => Promise<string | null>,
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

  const panelWidth = 680;
  const panelHeight = 430;
  const panelX = (canvas.width - panelWidth) / 2;
  const panelY = (canvas.height - panelHeight) / 2;
  const panel: Rect = { x: panelX, y: panelY, w: panelWidth, h: panelHeight };
  const videoTab: Rect = { x: panelX + 28, y: panelY + 70, w: 140, h: 42 };
  const gameTab: Rect = { x: panelX + 176, y: panelY + 70, w: 140, h: 42 };
  const controlsTab: Rect = { x: panelX + 324, y: panelY + 70, w: 160, h: 42 };
  const backButton: Rect = { x: panelX + panelWidth - 128, y: panelY + 18, w: 100, h: 38 };
  const fovSlider: Rect = { x: panelX + 60, y: panelY + 165, w: panelWidth - 120, h: 30 };
  const distanceSlider: Rect = { x: panelX + 60, y: panelY + 255, w: panelWidth - 120, h: 30 };
  const soundSwitch: Rect = { x: panelX + 60, y: panelY + 165, w: panelWidth - 120, h: 30 };
  const invertSwitch: Rect = { x: panelX + 60, y: panelY + 350, w: panelWidth - 120, h: 30 };
  const cameraButton: Rect = { x: panelX + 60, y: panelY + 128, w: panelWidth - 120, h: 46 };
  const sensitivitySlider: Rect = { x: panelX + 60, y: panelY + 230, w: panelWidth - 120, h: 30 };
  const autoJumpSwitch: Rect = { x: panelX + 60, y: panelY + 300, w: panelWidth - 120, h: 30 };

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
    drawText(context, '设置', panelX + 28, panelY + 20, 30, '#ffffff');
    drawTab(context, videoTab, '视频', tab === 'video');
    drawTab(context, gameTab, '游戏', tab === 'game');
    drawTab(context, controlsTab, '控制', tab === 'controls');

    if (tab === 'controls') {
      const cameraLabel =
        values.cameraMode === 'first'
          ? '第一人称'
          : values.cameraMode === 'third-back'
            ? '第三人称（背后）'
            : '第三人称（正面）';
      drawButton(context, cameraButton, `相机：${cameraLabel}`, 'normal', 18);
      const sensitivityValue = (values.sensitivity - 0.5) / 1.5;
      drawSlider(context, sensitivitySlider, sensitivityValue, '灵敏度', `×${values.sensitivity.toFixed(1)}`);
      drawSwitch(context, autoJumpSwitch, '自动跳跃', values.autoJump);
      drawSwitch(context, invertSwitch, '反转视角', values.invertLook);
      drawText(
        context,
        '摇杆固定左下 · 其他区域拖动视角',
        panelX + 28,
        panelY + 398,
        14,
        'rgba(255, 255, 255, 0.5)',
      );
    } else if (tab === 'video') {
      const fovValue = (values.fov - 60) / 40;
      drawSlider(context, fovSlider, fovValue, '视野', `${values.fov}°`);
      const distanceValue = (values.renderDistance - 2) / 4;
      drawSlider(
        context,
        distanceSlider,
        distanceValue,
        '视距',
        `${values.renderDistance}`,
      );
      drawText(
        context,
        '修改立即生效',
        panelX + 28,
        panelY + 330,
        15,
        'rgba(255, 255, 255, 0.5)',
      );
    } else {
      drawSwitch(context, soundSwitch, '声音', values.sound);
      drawText(
        context,
        '点按切换',
        panelX + 28,
        panelY + 330,
        15,
        'rgba(255, 255, 255, 0.5)',
      );
    }

    drawButton(context, backButton, '返回', 'normal', 18);
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
      if (contains(controlsTab, x, y)) {
        tab = 'controls';
        redraw();
        return null;
      }
      if (contains(backButton, x, y)) {
        setOpen(false);
        return 'back';
      }

      if (tab === 'controls') {
        if (contains(cameraButton, x, y)) {
          values.cameraMode =
            values.cameraMode === 'first'
              ? 'third-back'
              : values.cameraMode === 'third-back'
                ? 'third-front'
                : 'first';
          notify();
          return null;
        }
        const sensitivity = hitSlider(sensitivitySlider, x, y);
        if (sensitivity !== null) {
          values.sensitivity = Math.round((0.5 + sensitivity * 1.5) * 10) / 10;
          notify();
          return null;
        }
        if (contains(autoJumpSwitch, x, y)) {
          values.autoJump = !values.autoJump;
          notify();
          return null;
        }
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
      }

      setOpen(false);
      return 'back';
    },
    handleScrollMove(_clientX: number, _clientY: number, _sw: number, _sh: number): void {
      // 控制页已改为固定设置行，不再滚动
    },
    handleScrollUp(): void {
      // 无滚动
    },
    render(renderer: THREE.WebGLRenderer): void {
      if (!open) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
