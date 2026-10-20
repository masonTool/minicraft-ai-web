import * as THREE from 'three';
import { contains, drawButton, drawPanel, drawText, type Rect } from './widgets.ts';

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
  open(screen?: 'title' | 'worlds'): void;
  close(): void;
  isOpen(): boolean;
  setInfo(info: MainMenuInfo): void;
  handleTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): MainMenuAction;
  render(renderer: THREE.WebGLRenderer): void;
}

type Screen = 'title' | 'worlds';

/** 启动主菜单：标题页 → 游戏 → 世界卡片（对齐网页版流程） */
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

  const panelWidth = 560;
  const panelHeight = 440;
  const panelX = (canvas.width - panelWidth) / 2;
  const panelY = (canvas.height - panelHeight) / 2;
  const panel: Rect = { x: panelX, y: panelY, w: panelWidth, h: panelHeight };

  const play: Rect = { x: panelX + 70, y: panelY + 198, w: panelWidth - 140, h: 56 };
  const settings: Rect = { x: panelX + 70, y: panelY + 272, w: panelWidth - 140, h: 48 };
  const back: Rect = { x: panelX + 28, y: panelY + 18, w: 104, h: 36 };
  const newWorld: Rect = { x: panelX + 70, y: panelY + 74, w: panelWidth - 140, h: 40 };
  const deleteSave: Rect = { x: panelX + 70, y: panelY + 382, w: panelWidth - 140, h: 36 };
  const prevPage: Rect = { x: panelX + panelWidth - 100, y: panelY + 20, w: 30, h: 30 };
  const nextPage: Rect = { x: panelX + panelWidth - 62, y: panelY + 20, w: 30, h: 30 };

  const worldRow = (index: number): Rect => ({
    x: panelX + 30,
    y: panelY + 126 + index * 76,
    w: panelWidth - 60,
    h: 64,
  });
  const enterButton = (index: number): Rect => {
    const row = worldRow(index);
    return { x: row.x + row.w - 104, y: row.y + 14, w: 88, h: 36 };
  };

  let open = true;
  let screen: Screen = 'title';
  let page = 0;
  const PAGE_SIZE = 3;
  const pageCount = (): number => Math.max(1, Math.ceil(info.worlds.length / PAGE_SIZE));
  let info: MainMenuInfo = {
    worlds: [{ id: 'wx-default', name: '我的世界' }],
    currentId: 'wx-default',
    seed: 0x5eed,
    edits: 0,
  };

  const drawBackdrop = (): void => {
    if (!context) return;
    const backdrop = context.createLinearGradient(0, 0, 0, canvas.height);
    backdrop.addColorStop(0, 'rgba(8, 16, 26, 0.5)');
    backdrop.addColorStop(1, 'rgba(0, 0, 0, 0.74)');
    context.fillStyle = backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
  };

  const drawTitle = (): void => {
    if (!context) return;
    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.85)';
    context.shadowBlur = 8;
    context.shadowOffsetY = 4;
    drawText(context, 'MINECRAFT', panelX + 40, panelY + 22, 50, '#ffffff');
    context.restore();
    context.fillStyle = 'rgba(126, 176, 92, 0.96)';
    context.fillRect(panelX + 42, panelY + 82, 282, 26);
    drawText(
      context,
      '基岩版 1.18 · 微信小游戏',
      panelX + 54,
      panelY + 86,
      15,
      '#0e1a0c',
    );
    drawText(
      context,
      '原生生存、创造与多世界存档',
      panelX + 42,
      panelY + 116,
      15,
      'rgba(225, 238, 248, 0.78)',
    );
    drawButton(context, play, '游戏', 'normal', 24);
    drawButton(context, settings, '设置', 'normal', 20);
    drawText(
      context,
      '非官方 · 存档保存在本机',
      panelX + 42,
      panelY + panelHeight - 26,
      12,
      'rgba(165, 195, 215, 0.5)',
    );
  };

  const drawWorlds = (): void => {
    if (!context) return;
    drawButton(context, back, '‹ 返回', 'normal', 16);
    drawText(context, '游戏', panelX + 150, panelY + 22, 26, '#ffffff');
    drawButton(context, newWorld, '＋ 新建世界', 'normal', 17);
    if (pageCount() > 1) {
      drawButton(context, prevPage, '‹', page > 0 ? 'normal' : 'disabled', 18);
      drawButton(
        context,
        nextPage,
        '›',
        page < pageCount() - 1 ? 'normal' : 'disabled',
        18,
      );
      drawText(
        context,
        `${page + 1}/${pageCount()}`,
        panelX + panelWidth - 108,
        panelY + 26,
        13,
        'rgba(200, 225, 240, 0.75)',
        'right',
        54,
      );
    }

    page = Math.min(page, pageCount() - 1);
    const start = page * PAGE_SIZE;
    const visible = info.worlds.slice(start, start + PAGE_SIZE);
    if (visible.length === 0) {
      drawPanel(context, { x: panelX + 30, y: panelY + 126, w: panelWidth - 60, h: 80 });
      drawText(
        context,
        '还没有世界——点上面「＋ 新建世界」开一个。',
        panelX + panelWidth / 2,
        panelY + 154,
        14,
        'rgba(225, 235, 245, 0.7)',
        'center',
        panelWidth - 90,
      );
    }
    visible.forEach((world, index) => {
      const row = worldRow(index);
      const gradient = context.createLinearGradient(0, row.y, 0, row.y + row.h);
      gradient.addColorStop(0, 'rgba(48, 56, 64, 0.82)');
      gradient.addColorStop(1, 'rgba(20, 24, 28, 0.86)');
      context.fillStyle = gradient;
      context.fillRect(row.x, row.y, row.w, row.h);
      context.strokeStyle =
        world.id === info.currentId ? 'rgba(150, 220, 245, 0.9)' : 'rgba(160, 190, 210, 0.3)';
      context.lineWidth = 2;
      context.strokeRect(row.x + 1, row.y + 1, row.w - 2, row.h - 2);
      drawText(
        context,
        world.name,
        row.x + 16,
        row.y + 10,
        18,
        '#ffffff',
        'left',
        row.w - 140,
      );
      drawText(
        context,
        world.id === info.currentId
          ? `当前世界 · 种子 ${info.seed} · 改动 ${info.edits}`
          : '点「进入」切换到这个世界',
        row.x + 16,
        row.y + 36,
        12,
        'rgba(190, 215, 235, 0.65)',
        'left',
        row.w - 140,
      );
      drawButton(context, enterButton(index), '进入', 'normal', 15);
    });
    drawButton(context, deleteSave, '删除当前世界', 'normal', 15);
  };

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!open) {
      texture.needsUpdate = true;
      return;
    }
    drawBackdrop();
    drawPanel(context, panel);
    if (screen === 'title') drawTitle();
    else drawWorlds();
    texture.needsUpdate = true;
  };

  const setOpen = (value: boolean): void => {
    open = value;
    redraw();
  };

  redraw();

  return {
    open(nextScreen: Screen = 'title'): void {
      screen = nextScreen;
      page = 0;
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
      page = Math.min(page, pageCount() - 1);
      redraw();
    },
    handleTap(clientX: number, clientY: number, sw: number, sh: number): MainMenuAction {
      if (!open) return null;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;

      if (screen === 'title') {
        if (contains(play, x, y)) {
          screen = 'worlds';
          redraw();
          return null;
        }
        if (contains(settings, x, y)) {
          setOpen(false);
          return 'settings';
        }
        return null;
      }

      if (contains(back, x, y)) {
        screen = 'title';
        redraw();
        return null;
      }
      if (contains(newWorld, x, y)) return 'new';
      if (contains(deleteSave, x, y)) return 'delete';
      if (pageCount() > 1) {
        if (contains(prevPage, x, y) && page > 0) {
          page -= 1;
          redraw();
          return null;
        }
        if (contains(nextPage, x, y) && page < pageCount() - 1) {
          page += 1;
          redraw();
          return null;
        }
      }
      const start = page * PAGE_SIZE;
      const visible = info.worlds.slice(start, start + PAGE_SIZE);
      for (let i = 0; i < visible.length; i++) {
        const world = visible[i]!;
        if (contains(worldRow(i), x, y) || contains(enterButton(i), x, y)) {
          if (world.id !== info.currentId) return { type: 'world', id: world.id };
          setOpen(false);
          return 'play';
        }
      }
      return null;
    },
    render(renderer: THREE.WebGLRenderer): void {
      if (!open) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
