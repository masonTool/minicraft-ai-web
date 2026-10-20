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
import type { SoundGroup } from '../../core/audio/AudioEngine.ts';

export interface SettingsValues {
  fov: number;
  renderDistance: number;
  sound: boolean;
  invertLook: boolean;
  cameraMode: CameraMode;
  sensitivity: number;
  autoJump: boolean;
  volume: number;
  leftHanded: boolean;
  touchScale: number;
  groupVolumes: Record<SoundGroup, number>;
  stickMode: 'fixed' | 'dynamic';
  aimMode: 'finger' | 'center';
  brightness: number;
}

export const DEFAULT_SETTINGS: SettingsValues = {
  fov: 72,
  renderDistance: 3,
  sound: true,
  invertLook: false,
  cameraMode: 'first',
  sensitivity: 1,
  autoJump: true,
  volume: 0.7,
  leftHanded: false,
  touchScale: 1,
  groupVolumes: { blocks: 1, mobs: 1, player: 1, ui: 1, ambient: 1, music: 1 },
  stickMode: 'fixed',
  aimMode: 'finger',
  brightness: 1,
};

export type SettingsAction = 'back' | null;

export interface SettingsMenu {
  open(): void;
  close(): void;
  isOpen(): boolean;
  getTab(): Tab;
  handleTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): SettingsAction;
  handleScrollMove(clientX: number, clientY: number, screenWidth: number, screenHeight: number): void;
  handleScrollUp(): void;
  render(renderer: THREE.WebGLRenderer): void;
}

type Tab = 'video' | 'game' | 'controls' | 'sound';

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
  const videoTab: Rect = { x: panelX + 28, y: panelY + 70, w: 120, h: 42 };
  const gameTab: Rect = { x: panelX + 156, y: panelY + 70, w: 120, h: 42 };
  const controlsTab: Rect = { x: panelX + 284, y: panelY + 70, w: 130, h: 42 };
  const soundTab: Rect = { x: panelX + 422, y: panelY + 70, w: 120, h: 42 };
  const backButton: Rect = { x: panelX + panelWidth - 128, y: panelY + 18, w: 100, h: 38 };
  const fovSlider: Rect = { x: panelX + 60, y: panelY + 165, w: panelWidth - 120, h: 30 };
  const distanceSlider: Rect = { x: panelX + 60, y: panelY + 255, w: panelWidth - 120, h: 30 };
  const brightnessSlider: Rect = { x: panelX + 60, y: panelY + 345, w: panelWidth - 120, h: 30 };
  const soundSwitch: Rect = { x: panelX + 60, y: panelY + 165, w: panelWidth - 120, h: 30 };
  const volumeSlider: Rect = { x: panelX + 60, y: panelY + 235, w: panelWidth - 120, h: 30 };
  const groupRect = (index: number): Rect => ({
    x: panelX + 60 + (index % 2) * 300,
    y: panelY + 286 + Math.floor(index / 2) * 50,
    w: 260,
    h: 14,
  });
  const invertSwitch: Rect = { x: panelX + 60, y: panelY + 384, w: panelWidth - 120, h: 28 };
  const sensitivitySlider: Rect = { x: panelX + 60, y: panelY + 198, w: panelWidth - 120, h: 30 };
  const cameraButton: Rect = { x: panelX + 60, y: panelY + 118, w: 170, h: 42 };
  const stickButton: Rect = { x: panelX + 240, y: panelY + 118, w: 170, h: 42 };
  const aimButton: Rect = { x: panelX + 420, y: panelY + 118, w: 190, h: 42 };
  const autoJumpSwitch: Rect = { x: panelX + 60, y: panelY + 310, w: panelWidth - 120, h: 28 };
  const leftHandedSwitch: Rect = { x: panelX + 60, y: panelY + 348, w: panelWidth - 120, h: 28 };
  const touchScaleSlider: Rect = { x: panelX + 60, y: panelY + 258, w: panelWidth - 120, h: 30 };

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
    drawTab(context, soundTab, '声音', tab === 'sound');

    if (tab === 'controls') {
      const cameraLabel =
        values.cameraMode === 'first'
          ? '第一人称'
          : values.cameraMode === 'third-back'
            ? '第三人称（背后）'
            : '第三人称（正面）';
      drawButton(context, cameraButton, `相机：${cameraLabel}`, 'normal', 14);
      drawButton(
        context,
        stickButton,
        `摇杆：${values.stickMode === 'fixed' ? '固定' : '动态'}`,
        'normal',
        14,
      );
      drawButton(
        context,
        aimButton,
        `瞄准：${values.aimMode === 'center' ? '中心' : '手指'}`,
        'normal',
        14,
      );
      const sensitivityValue = (values.sensitivity - 0.5) / 1.5;
      drawSlider(context, sensitivitySlider, sensitivityValue, '灵敏度', `×${values.sensitivity.toFixed(1)}`);
      drawSlider(
        context,
        touchScaleSlider,
        (values.touchScale - 0.75) / 0.75,
        '触摸按钮大小',
        `${Math.round(values.touchScale * 100)}%`,
      );
      drawSwitch(context, autoJumpSwitch, '自动跳跃', values.autoJump);
      drawSwitch(context, leftHandedSwitch, '左手模式', values.leftHanded);
      drawSwitch(context, invertSwitch, '反转视角', values.invertLook);
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
      drawSlider(
        context,
        brightnessSlider,
        (values.brightness - 0.5) / 1.5,
        '亮度',
        `${Math.round(values.brightness * 100)}%`,
      );
    } else if (tab === 'sound') {
      drawSwitch(context, soundSwitch, '声音', values.sound);
      drawSlider(context, volumeSlider, values.volume, '主音量', `${Math.round(values.volume * 100)}%`);
      const groups: Array<[SoundGroup, string]> = [
        ['blocks', '方块'],
        ['mobs', '生物'],
        ['player', '玩家'],
        ['ui', '界面'],
        ['ambient', '环境'],
        ['music', '音乐'],
      ];
      groups.forEach(([key, label], index) => {
        drawSlider(
          context,
          groupRect(index),
          values.groupVolumes[key],
          label,
          `${Math.round(values.groupVolumes[key] * 100)}%`,
        );
      });
    } else {
      drawText(
        context,
        '更多游戏设置待接入',
        panelX + 28,
        panelY + 160,
        16,
        'rgba(255, 255, 255, 0.55)',
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
    getTab(): Tab {
      return tab;
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
      if (contains(soundTab, x, y)) {
        tab = 'sound';
        redraw();
        return null;
      }
      if (contains(backButton, x, y)) {
        setOpen(false);
        return 'back';
      }

      if (tab === 'controls') {
        if (contains(aimButton, x, y)) {
          values.aimMode = values.aimMode === 'finger' ? 'center' : 'finger';
          notify();
          return null;
        }
        if (contains(stickButton, x, y)) {
          values.stickMode = values.stickMode === 'fixed' ? 'dynamic' : 'fixed';
          notify();
          return null;
        }
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
        const touchScale = hitSlider(touchScaleSlider, x, y);
        if (touchScale !== null) {
          values.touchScale = Math.round((0.75 + touchScale * 0.75) * 100) / 100;
          notify();
          return null;
        }
        if (contains(autoJumpSwitch, x, y)) {
          values.autoJump = !values.autoJump;
          notify();
          return null;
        }
        if (contains(leftHandedSwitch, x, y)) {
          values.leftHanded = !values.leftHanded;
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
        const brightness = hitSlider(brightnessSlider, x, y);
        if (brightness !== null) {
          values.brightness = Math.round((0.5 + brightness * 1.5) * 100) / 100;
          notify();
          return null;
        }
      } else if (tab === 'sound') {
        if (contains(soundSwitch, x, y)) {
          values.sound = !values.sound;
          notify();
          return null;
        }
        const volume = hitSlider(volumeSlider, x, y);
        if (volume !== null) {
          values.volume = Math.round(volume * 100) / 100;
          notify();
          return null;
        }
        const groups: SoundGroup[] = ['blocks', 'mobs', 'player', 'ui', 'ambient', 'music'];
        for (let index = 0; index < groups.length; index++) {
          const value = hitSlider(groupRect(index), x, y);
          if (value !== null) {
            values.groupVolumes = {
              ...values.groupVolumes,
              [groups[index]!]: Math.round(value * 100) / 100,
            };
            notify();
            return null;
          }
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
