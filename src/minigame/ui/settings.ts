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
  handleScrollMove(clientX: number, clientY: number, screenWidth: number, screenHeight: number): void;
  handleScrollUp(): void;
  render(renderer: THREE.WebGLRenderer): void;
}

type Tab = 'video' | 'game' | 'controls';

const CONTROLS: readonly string[] = [
  'MOVE: LEFT DRAG',
  'LOOK: RIGHT DRAG',
  'JUMP: TAP BOTTOM RIGHT',
  'PLACE: TAP TOP RIGHT',
  'BREAK: TAP MIDDLE RIGHT',
  'CYCLE SLOT: TAP LEFT',
  'INVENTORY: BAG',
  'PAUSE / SAVE: MENU',
  'FOV / DISTANCE: SETTINGS > VIDEO',
];

/** 设置页（WX-022）：VIDEO/GAME/CONTROLS 页签、滑块、开关、搜索输入、滚动列表 */
export function createSettingsMenu(
  screenWidth: number,
  screenHeight: number,
  initial: SettingsValues,
  onChange: (values: SettingsValues) => void,
  requestText?: (current: string) => Promise<string | null>,
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
  const backButton: Rect = { x: panelX + panelWidth - 128, y: panelY + panelHeight - 62, w: 100, h: 40 };
  const fovSlider: Rect = { x: panelX + 60, y: panelY + 165, w: panelWidth - 120, h: 30 };
  const distanceSlider: Rect = { x: panelX + 60, y: panelY + 255, w: panelWidth - 120, h: 30 };
  const soundSwitch: Rect = { x: panelX + 60, y: panelY + 165, w: panelWidth - 120, h: 30 };
  const invertSwitch: Rect = { x: panelX + 60, y: panelY + 235, w: panelWidth - 120, h: 30 };
  const searchField: Rect = { x: panelX + 60, y: panelY + 140, w: panelWidth - 120, h: 36 };
  const listRect: Rect = { x: panelX + 60, y: panelY + 190, w: panelWidth - 120, h: 150 };
  const rowHeight = 32;

  const values: SettingsValues = { ...initial };
  let tab: Tab = 'video';
  let open = false;
  let query = '';
  let scrollOffset = 0;
  let draggingList = false;
  let dragLastY = 0;
  let dragDistance = 0;

  const visibleRows = Math.floor(listRect.h / rowHeight);
  const filtered = (): string[] => {
    const needle = query.trim().toLowerCase();
    return needle ? CONTROLS.filter((item) => item.toLowerCase().includes(needle)) : [...CONTROLS];
  };
  const maxOffset = (): number => Math.max(0, filtered().length - visibleRows);

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
    drawTab(context, controlsTab, 'CONTROLS', tab === 'controls');

    if (tab === 'controls') {
      scrollOffset = Math.max(0, Math.min(maxOffset(), scrollOffset));
      context.fillStyle = 'rgba(0, 0, 0, 0.55)';
      context.fillRect(searchField.x, searchField.y, searchField.w, searchField.h);
      context.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      context.lineWidth = 2;
      context.strokeRect(searchField.x + 1, searchField.y + 1, searchField.w - 2, searchField.h - 2);
      drawText(
        context,
        query ? `SEARCH: ${query}` : 'SEARCH: TAP TO TYPE',
        searchField.x + 12,
        searchField.y + 9,
        16,
        query ? '#ffffff' : 'rgba(255, 255, 255, 0.45)',
        'left',
        searchField.w - 24,
      );

      const items = filtered();
      context.save();
      context.beginPath();
      context.rect(listRect.x, listRect.y, listRect.w, listRect.h);
      context.clip();
      const start = Math.floor(scrollOffset);
      for (let row = 0; row < visibleRows; row++) {
        const index = start + row;
        if (index >= items.length) break;
        const y = listRect.y + row * rowHeight;
        context.fillStyle = row % 2 === 0 ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.18)';
        context.fillRect(listRect.x, y, listRect.w, rowHeight);
        drawText(context, items[index]!, listRect.x + 10, y + 9, 15, '#ffffff', 'left', listRect.w - 20);
      }
      context.restore();

      if (maxOffset() > 0) {
        const trackX = listRect.x + listRect.w + 8;
        context.fillStyle = 'rgba(0, 0, 0, 0.55)';
        context.fillRect(trackX, listRect.y, 6, listRect.h);
        const thumbHeight = Math.max(24, (visibleRows / items.length) * listRect.h);
        const thumbY =
          listRect.y + (scrollOffset / maxOffset()) * Math.max(0, listRect.h - thumbHeight);
        context.fillStyle = 'rgba(180, 220, 255, 0.85)';
        context.fillRect(trackX, thumbY, 6, thumbHeight);
      }

      drawText(
        context,
        items.length === 0 ? 'NO MATCH' : 'DRAG LIST TO SCROLL',
        panelX + 28,
        panelY + 350,
        14,
        'rgba(255, 255, 255, 0.5)',
      );
    } else if (tab === 'video') {
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
        if (contains(searchField, x, y)) {
          void requestText?.(query)
            .then((value) => {
              if (value !== null) {
                query = value;
                scrollOffset = 0;
                redraw();
              }
            })
            .catch(() => {
              /* 平台键盘不可用：保持原查询 */
            });
          return null;
        }
        if (contains(listRect, x, y)) {
          draggingList = true;
          dragLastY = y;
          dragDistance = 0;
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
        if (contains(invertSwitch, x, y)) {
          values.invertLook = !values.invertLook;
          notify();
          return null;
        }
      }

      setOpen(false);
      return 'back';
    },
    handleScrollMove(_clientX: number, clientY: number, _sw: number, sh: number): void {
      if (!open || tab !== 'controls' || !draggingList) return;
      const y = (clientY / Math.max(1, sh)) * canvas.height;
      const delta = (y - dragLastY) / rowHeight;
      dragLastY = y;
      dragDistance += Math.abs(delta);
      scrollOffset = Math.max(0, Math.min(maxOffset(), scrollOffset - delta));
      redraw();
    },
    handleScrollUp(): void {
      draggingList = false;
    },
    render(renderer: THREE.WebGLRenderer): void {
      if (!open) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
