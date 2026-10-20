import * as THREE from 'three';
import { contains, drawButton, drawPanel, drawText, type Rect } from './widgets.ts';

export type MainMenuAction =
  | 'play'
  | 'settings'
  | 'new'
  | 'delete'
  | { type: 'world'; id: string }
  | { type: 'deleteWorld'; id: string }
  | {
      type: 'create';
      name: string;
      seed: number | null;
      worldType: 'default' | 'flat' | 'amplified';
      difficulty: 'peaceful' | 'easy' | 'normal' | 'hard';
      gameMode: 'survival' | 'creative';
    }
  | null;

export interface MainMenuInfo {
  worlds: Array<{
    id: string;
    name: string;
    worldType?: 'default' | 'flat' | 'amplified';
    difficulty?: 'peaceful' | 'easy' | 'normal' | 'hard';
    gameMode?: 'survival' | 'creative';
    playTime?: number;
    lastPlayed?: number;
  }>;
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

type Screen = 'title' | 'worlds' | 'create';

/** 启动主菜单：标题页 → 游戏 → 世界卡片（对齐网页版流程） */
export function createMainMenu(
  screenWidth: number,
  screenHeight: number,
  requestText?: (current: string) => Promise<string | null>,
): MainMenu {
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

  const play: Rect = {
    x: canvas.width / 2 - 260,
    y: canvas.height * 0.5,
    w: 520,
    h: 52,
  };
  const settings: Rect = { x: play.x, y: play.y + 68, w: play.w, h: 52 };
  const back: Rect = { x: panelX + 28, y: panelY + 18, w: 104, h: 36 };
  const newWorld: Rect = { x: panelX + 70, y: panelY + 74, w: panelWidth - 140, h: 40 };
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
  const cardDeleteButton = (index: number): Rect => {
    const enter = enterButton(index);
    return { x: enter.x - 76, y: enter.y, w: 68, h: 36 };
  };

  let open = true;
  let screen: Screen = 'title';
  let page = 0;
  const PAGE_SIZE = 3;
  const pageCount = (): number => Math.max(1, Math.ceil(info.worlds.length / PAGE_SIZE));
  const draft = {
    name: '',
    seed: '',
    typeIndex: 0,
    difficultyIndex: 2,
    modeIndex: 0,
  };
  const WORLD_TYPES = ['default', 'flat', 'amplified'] as const;
  const WORLD_TYPE_LABELS = ['默认', '超平坦', '放大化'] as const;
  const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'] as const;
  const DIFFICULTY_LABELS = ['和平', '简单', '普通', '困难'] as const;
  const GAME_MODES = ['survival', 'creative'] as const;
  const GAME_MODE_LABELS = ['生存', '创造'] as const;
  const createField = (row: number): Rect => ({
    x: panelX + 150,
    y: panelY + 100 + row * 50,
    w: panelWidth - 220,
    h: 36,
  });
  const reroll: Rect = {
    x: panelX + panelWidth - 64,
    y: panelY + 150,
    w: 42,
    h: 36,
  };
  const createButton: Rect = {
    x: panelX + 70,
    y: panelY + 376,
    w: panelWidth - 140,
    h: 44,
  };
  let info: MainMenuInfo = {
    worlds: [{ id: 'wx-default', name: '我的世界' }],
    currentId: 'wx-default',
    seed: 0x5eed,
    edits: 0,
  };

  const drawBackdrop = (): void => {
    if (!context) return;
    const w = canvas.width;
    const h = canvas.height;
    const sky = context.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#769ab0');
    sky.addColorStop(0.5, '#637f92');
    sky.addColorStop(1, '#243326');
    context.fillStyle = sky;
    context.fillRect(0, 0, w, h);

    // 远山
    context.fillStyle = '#3d5635';
    context.beginPath();
    context.moveTo(0, h * 0.56);
    context.lineTo(w * 0.16, h * 0.42);
    context.lineTo(w * 0.3, h * 0.55);
    context.lineTo(w * 0.46, h * 0.36);
    context.lineTo(w * 0.62, h * 0.55);
    context.lineTo(w * 0.8, h * 0.43);
    context.lineTo(w, h * 0.55);
    context.lineTo(w, h);
    context.lineTo(0, h);
    context.closePath();
    context.fill();

    // 近山/草地
    context.fillStyle = '#2e4831';
    context.beginPath();
    context.moveTo(0, h * 0.7);
    context.lineTo(w * 0.24, h * 0.58);
    context.lineTo(w * 0.44, h * 0.72);
    context.lineTo(w * 0.68, h * 0.57);
    context.lineTo(w, h * 0.7);
    context.lineTo(w, h);
    context.lineTo(0, h);
    context.closePath();
    context.fill();

    context.fillStyle = '#526c50';
    context.fillRect(0, h * 0.72, w, h * 0.28);

    // Web 同款像素网格 + 暗角
    context.fillStyle = 'rgba(0, 0, 0, 0.045)';
    for (let x = 0; x < w; x += 32) context.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 32) context.fillRect(0, y, w, 1);
    const vignette = context.createLinearGradient(0, 0, 0, h);
    vignette.addColorStop(0, 'rgba(6, 12, 8, 0.05)');
    vignette.addColorStop(1, 'rgba(6, 12, 8, 0.45)');
    context.fillStyle = vignette;
    context.fillRect(0, 0, w, h);
  };

  const drawTitle = (): void => {
    if (!context) return;
    const cx = canvas.width / 2;
    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.9)';
    context.shadowBlur = 10;
    context.shadowOffsetY = 5;
    drawText(context, 'MINECRAFT', cx, canvas.height * 0.1, 70, '#ffffff', 'center', canvas.width - 80);
    context.restore();

    context.fillStyle = 'rgba(126, 176, 92, 0.96)';
    context.fillRect(cx - 180, canvas.height * 0.1 + 70, 360, 28);
    drawText(
      context,
      '基岩版 1.18 · 微信小游戏',
      cx,
      canvas.height * 0.1 + 74,
      15,
      '#0e1a0c',
      'center',
      340,
    );
    drawText(
      context,
      '原生生存、创造与多世界存档',
      cx,
      canvas.height * 0.1 + 118,
      18,
      'rgba(225, 238, 248, 0.78)',
      'center',
      canvas.width - 120,
    );

    drawButton(context, play, '游戏', 'normal', 22);
    drawButton(context, settings, '设置', 'normal', 21);

    drawText(
      context,
      '非官方 · 存档保存在本机',
      cx,
      canvas.height - 28,
      12,
      'rgba(200, 220, 235, 0.55)',
      'center',
      canvas.width - 80,
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
      const thumbX = row.x + 10;
      const thumbY = row.y + 8;
      const thumbW = 48;
      const thumbH = 48;
      context.fillStyle = 'rgba(120, 190, 240, 0.85)';
      context.fillRect(thumbX, thumbY, thumbW, thumbH);
      if (world.worldType === 'flat') {
        context.fillStyle = 'rgba(104, 156, 58, 0.95)';
        context.fillRect(thumbX, thumbY + thumbH - 16, thumbW, 16);
      } else if (world.worldType === 'amplified') {
        context.fillStyle = 'rgba(78, 96, 112, 0.95)';
        context.beginPath();
        context.moveTo(thumbX, thumbY + thumbH);
        context.lineTo(thumbX + 16, thumbY + 12);
        context.lineTo(thumbX + 28, thumbY + 28);
        context.lineTo(thumbX + 38, thumbY + 6);
        context.lineTo(thumbX + thumbW, thumbY + thumbH);
        context.closePath();
        context.fill();
        context.fillStyle = 'rgba(235, 245, 255, 0.85)';
        context.fillRect(thumbX + 36, thumbY + 2, 7, 7);
      } else {
        context.fillStyle = 'rgba(104, 156, 58, 0.95)';
        context.beginPath();
        context.moveTo(thumbX, thumbY + thumbH);
        context.lineTo(thumbX, thumbY + 26);
        context.lineTo(thumbX + 14, thumbY + 18);
        context.lineTo(thumbX + 30, thumbY + 24);
        context.lineTo(thumbX + thumbW, thumbY + 18);
        context.lineTo(thumbX + thumbW, thumbY + thumbH);
        context.closePath();
        context.fill();
        context.fillStyle = 'rgba(112, 80, 52, 0.95)';
        context.fillRect(thumbX, thumbY + 34, thumbW, 14);
      }
      context.strokeStyle = 'rgba(200, 225, 240, 0.5)';
      context.lineWidth = 2;
      context.strokeRect(thumbX + 1, thumbY + 1, thumbW - 2, thumbH - 2);

      drawText(
        context,
        world.name,
        row.x + 68,
        row.y + 10,
        18,
        '#ffffff',
        'left',
        row.w - 140,
      );
      const typeLabel = { default: '默认', flat: '超平坦', amplified: '放大化' }[
        world.worldType ?? 'default'
      ];
      const difficultyLabel = {
        peaceful: '和平',
        easy: '简单',
        normal: '普通',
        hard: '困难',
      }[world.difficulty ?? 'normal'];
      const modeLabel = world.gameMode === 'creative' ? '创造' : '生存';
      drawText(
        context,
        `${typeLabel} · ${difficultyLabel} · ${modeLabel} · 种子 ${info.seed}`,
        row.x + 68,
        row.y + 30,
        11,
        'rgba(190, 215, 235, 0.65)',
        'left',
        row.w - 230,
      );
      const played = world.playTime ?? 0;
      const playedLabel = played >= 60 ? `${Math.round(played / 60)} 分钟` : `${Math.round(played)} 秒`;
      const last = world.lastPlayed ?? 0;
      const elapsed = Date.now() - last;
      const lastLabel =
        elapsed < 60_000
          ? '刚刚'
          : elapsed < 3_600_000
            ? `${Math.floor(elapsed / 60_000)} 分钟前`
            : `${Math.floor(elapsed / 3_600_000)} 小时前`;
      drawText(
        context,
        `上次游玩 ${lastLabel} · 已游玩 ${playedLabel} · 改动 ${info.edits} 格`,
        row.x + 68,
        row.y + 47,
        11,
        'rgba(170, 200, 220, 0.55)',
        'left',
        row.w - 140,
      );
      drawButton(context, cardDeleteButton(index), '删除', 'normal', 14);
      drawButton(context, enterButton(index), '进入', 'normal', 15);
    });
  };

  const drawField = (row: number, label: string, value: string, placeholder: boolean): void => {
    if (!context) return;
    const rect = createField(row);
    drawText(context, label, panelX + 34, rect.y + 9, 15, 'rgba(225, 238, 248, 0.8)');
    context.fillStyle = 'rgba(0, 0, 0, 0.55)';
    context.fillRect(rect.x, rect.y, rect.w, rect.h);
    context.strokeStyle = 'rgba(180, 210, 230, 0.55)';
    context.lineWidth = 2;
    context.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    drawText(
      context,
      value,
      rect.x + 10,
      rect.y + 9,
      15,
      placeholder ? 'rgba(255, 255, 255, 0.4)' : '#ffffff',
      'left',
      rect.w - 20,
    );
  };

  const drawCreate = (): void => {
    if (!context) return;
    drawButton(context, back, '‹ 返回', 'normal', 16);
    drawText(context, '新建世界', panelX + 150, panelY + 22, 26, '#ffffff');
    drawField(0, '名称', draft.name || '未命名', draft.name.length === 0);
    drawField(1, '种子', draft.seed || '留空随机', draft.seed.length === 0);
    drawButton(context, reroll, '随机', 'normal', 13);
    drawField(2, '类型', WORLD_TYPE_LABELS[draft.typeIndex]!, false);
    drawField(3, '难度', DIFFICULTY_LABELS[draft.difficultyIndex]!, false);
    drawField(4, '模式', GAME_MODE_LABELS[draft.modeIndex]!, false);
    drawText(
      context,
      '类型 / 难度 / 模式：点一下切换',
      panelX + 34,
      panelY + 346,
      13,
      'rgba(200, 225, 240, 0.6)',
    );
    drawButton(context, createButton, '创建并进入', 'normal', 19);
  };

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!open) {
      texture.needsUpdate = true;
      return;
    }
    drawBackdrop();
    if (screen === 'title') drawTitle();
    else {
      drawPanel(context, panel);
      if (screen === 'worlds') drawWorlds();
      else drawCreate();
    }
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

      if (screen === 'create') {
        if (contains(back, x, y)) {
          screen = 'worlds';
          redraw();
          return null;
        }
        if (contains(createField(0), x, y)) {
          void requestText?.(draft.name)
            .then((value) => {
              if (value !== null) {
                draft.name = value.slice(0, 24);
                redraw();
              }
            })
            .catch(() => undefined);
          return null;
        }
        if (contains(createField(1), x, y)) {
          void requestText?.(draft.seed)
            .then((value) => {
              if (value !== null) {
                draft.seed = value.replace(/[^0-9-]/g, '').slice(0, 12);
                redraw();
              }
            })
            .catch(() => undefined);
          return null;
        }
        if (contains(reroll, x, y)) {
          draft.seed = String(Math.floor(Math.random() * 0x7fffffff) || 1);
          redraw();
          return null;
        }
        if (contains(createField(2), x, y)) {
          draft.typeIndex = (draft.typeIndex + 1) % WORLD_TYPES.length;
          redraw();
          return null;
        }
        if (contains(createField(3), x, y)) {
          draft.difficultyIndex = (draft.difficultyIndex + 1) % DIFFICULTIES.length;
          redraw();
          return null;
        }
        if (contains(createField(4), x, y)) {
          draft.modeIndex = (draft.modeIndex + 1) % GAME_MODES.length;
          redraw();
          return null;
        }
        if (contains(createButton, x, y)) {
          const parsed = draft.seed.trim().length > 0 ? Number(draft.seed) : null;
          const seed = parsed !== null && Number.isFinite(parsed) ? Math.floor(parsed) : null;
          return {
            type: 'create',
            name: draft.name.trim() || `世界 ${info.worlds.length + 1}`,
            seed,
            worldType: WORLD_TYPES[draft.typeIndex]!,
            difficulty: DIFFICULTIES[draft.difficultyIndex]!,
            gameMode: GAME_MODES[draft.modeIndex]!,
          };
        }
        return null;
      }

      if (contains(back, x, y)) {
        screen = 'title';
        redraw();
        return null;
      }
      if (contains(newWorld, x, y)) {
        screen = 'create';
        draft.name = '';
        draft.seed = '';
        redraw();
        return null;
      }
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
        if (contains(cardDeleteButton(i), x, y)) {
          return { type: 'deleteWorld', id: world.id };
        }
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
