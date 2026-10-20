/**
 * v2 最小启动切片：只验证 main core/render 能在微信 adapter 上跑起来。
 *
 * 不接 main.ts、不接 UI：
 *   platform bootstrap → World → TextureAtlas → ChunkRenderer → 一个区块
 */

import '../platform/wx/bootstrap.ts';

import * as THREE from 'three';
import { World } from '../core/world/World.ts';
import { TextureAtlas } from '../render/TextureAtlas.ts';
import { ChunkRenderer } from '../render/ChunkRenderer.ts';
import { PlayerPhysics, type PlayerInput, type PhysicsWorld } from '../core/physics/PlayerPhysics.ts';
import { VoxelMaterial } from '../render/VoxelMaterial.ts';
import { createMainThreadWorker } from '../platform/wx/main-thread-worker.ts';
import { UiLayer, box, button, icon, ring, slider, slot, text, toggle, vital, type UiElement, type UiRingNode } from './ui-kit/index.ts';
import { Inventory } from '../core/container/Inventory.ts';
import { Chest } from '../core/container/Chest.ts';
import { Furnace } from '../core/container/Furnace.ts';
import { restoreContainers, serializeContainers } from '../core/save/ContainerSave.ts';
import { CraftingGrid } from '../core/crafting/CraftingGrid.ts';
import { RECIPES, type ShapedRecipe, type ShapelessRecipe } from '../core/crafting/Recipes.ts';
import { CREATIVE_ITEMS, Item, blockForItem, categoryOf, foodInfoById, itemIconTile, saturationFrom } from '../core/registry/items.ts';
import { canEat } from '../core/registry/food.ts';
import { itemLabel } from '../core/registry/itemNames.ts';
import { Block, blockDef, blockTiles } from '../core/registry/blocks.ts';
import { raycastVoxels, type RayHit } from '../core/interaction/Raycast.ts';
import { ATLAS_COLUMNS, TILE_ORDER, TILE_SIZE } from '../render/TextureAtlas.ts';
import { wxPlatform } from '../platform/wx/index.ts';
import { AudioEngine } from '../core/audio/AudioEngine.ts';
import { WorldRegistry, type WorldSummary } from '../core/save/WorldRegistry.ts';
import { FileSaveGame } from '../platform/file-save.ts';
import { ChunkEdits } from '../core/save/ChunkEdits.ts';
import type { ChunkSaveRecord, PlayerSave } from '../core/save/SaveGame.ts';
import { OverworldGenerator } from '../core/gen/OverworldGenerator.ts';
import { planSpawnRegion } from '../core/world/SpawnPoint.ts';
import { WORLD_SURFACE_Y } from '../core/gen/WorldType.ts';
import type { WorldType } from '../core/gen/WorldType.ts';
import type { Difficulty } from '../core/world/Rules.ts';
import type { GameMode } from '../core/world/GameMode.ts';

/**
 * main 的 World 直接 `new Worker(new URL(...))`。
 * v2 第一版把全局 Worker 指向主线程实现，避免 wx worker 的 ArrayBuffer 序列化问题。
 */
class MainThreadWorkerShim {
  private readonly inner = createMainThreadWorker();

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.inner.postMessage(message, transfer);
  }

  addEventListener(type: 'message', listener: (event: { data: any }) => void): void {
    this.inner.addEventListener(type, listener);
  }

  removeEventListener(type: 'message', listener: (event: { data: any }) => void): void {
    this.inner.removeEventListener?.(type, listener);
  }

  terminate(): void {
    this.inner.terminate();
  }
}

(globalThis as unknown as { Worker: typeof MainThreadWorkerShim }).Worker = MainThreadWorkerShim;

const platform = wxPlatform();
const doc = (globalThis as unknown as { document: any }).document;
const canvas = doc.canvas as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(Math.min(platform.system.dpr, 2));
renderer.setSize(platform.system.width, platform.system.height, false);
renderer.autoClear = false;
renderer.setClearColor(0x0b141c, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b9e8);
const camera = new THREE.PerspectiveCamera(
  72,
  platform.system.width / Math.max(1, platform.system.height),
  0.1,
  320,
);

const drawBlockIcon = (
  ctx: CanvasRenderingContext2D,
  blockId: number,
  x: number,
  y: number,
  size: number,
): void => {
  const block = blockForItem(blockId);
  const inset = Math.max(2, Math.floor(size * 0.1));
  if (block !== undefined) {
    const tile = blockTiles(block, 0)[0];
    const tileIndex = (TILE_ORDER as readonly string[]).indexOf(tile);
    if (tileIndex < 0) return;
    const sx = (tileIndex % ATLAS_COLUMNS) * TILE_SIZE;
    const sy = Math.floor(tileIndex / ATLAS_COLUMNS) * TILE_SIZE;
    ctx.drawImage(atlas.canvas, sx, sy, TILE_SIZE, TILE_SIZE, x + inset, y + inset, size - inset * 2, size - inset * 2);
    return;
  }
  const source = atlas.tileSource(itemIconTile(blockId));
  ctx.drawImage(atlas.canvas, source.x, source.y, TILE_SIZE, TILE_SIZE, x + inset, y + inset, size - inset * 2, size - inset * 2);
};

const playerModel = new THREE.Group();
const skinMaterial = new THREE.MeshBasicMaterial({ color: 0xe0ac69 });
const shirtMaterial = new THREE.MeshBasicMaterial({ color: 0x3b6ea5 });
const pantsMaterial = new THREE.MeshBasicMaterial({ color: 0x2f3f5a });
const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skinMaterial);
headMesh.position.y = 1.55;
const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.3), shirtMaterial);
bodyMesh.position.y = 1.0;
const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), skinMaterial);
leftArm.position.set(-0.4, 1.05, 0);
const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), skinMaterial);
rightArm.position.set(0.4, 1.05, 0);
const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 0.24), pantsMaterial);
leftLeg.position.set(-0.16, 0.4, 0);
const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 0.24), pantsMaterial);
rightLeg.position.set(0.16, 0.4, 0);
const hairMaterial = new THREE.MeshBasicMaterial({ color: 0x3b2a1a });
const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.16, 0.54), hairMaterial);
hairMesh.position.y = 1.83;
const beardMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.1), hairMaterial);
beardMesh.position.set(0, 1.4, -0.27);
beardMesh.visible = false;
const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x3b2a1a });
const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.04), eyeMaterial);
leftEye.position.set(-0.12, 1.62, -0.26);
const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.04), eyeMaterial);
rightEye.position.set(0.12, 1.62, -0.26);
const capeMaterial = new THREE.MeshBasicMaterial({ color: 0x8a2b2b });
const capeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.9, 0.06), capeMaterial);
capeMesh.position.set(0, 1.05, 0.18);
capeMesh.visible = false;
playerModel.add(headMesh, bodyMesh, leftArm, rightArm, leftLeg, rightLeg, hairMesh, beardMesh, leftEye, rightEye, capeMesh);
playerModel.visible = false;
scene.add(playerModel);

const applyPlayerAppearance = (): void => {
  skinMaterial.color.set(settings.skinColor);
  shirtMaterial.color.set(settings.shirtColor);
  pantsMaterial.color.set(settings.pantsColor);
  hairMaterial.color.set(settings.hairColor);
  hairMesh.visible = settings.hairStyle !== 'none';
  hairMesh.scale.set(1, settings.hairStyle === 'long' ? 2.2 : 1, 1);
  beardMesh.visible = settings.beard;
  eyeMaterial.color.set(settings.eyeColor);
  capeMesh.visible = settings.cape;
  const eyeScale = settings.eyeStyle === 'wide' ? 1.6 : 1;
  leftEye.scale.x = eyeScale;
  rightEye.scale.x = eyeScale;
  const widthScale = settings.build === 'slim' ? 0.9 : settings.build === 'broad' ? 1.14 : 1;
  const heightScale = settings.age === 'young' ? 0.9 : settings.age === 'old' ? 0.96 : 1;
  playerModel.scale.set(widthScale, heightScale, widthScale);
};

const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)),
  new THREE.LineBasicMaterial({ color: 0x1b1b1b, transparent: true, opacity: 0.85, depthTest: false }),
);
outline.visible = false;
scene.add(outline);

const ui = new UiLayer(platform.system.width, platform.system.height, drawBlockIcon);
const uiHeight = ui.height;
let started = false;
let menuScreen: 'title' | 'worlds' | 'create' | 'edit' = 'title';
let paused = false;
let settingsOpen = false;
let chatOpen = false;
let containerOpen = false;
let openedContainer: Chest | Furnace | null = null;
let containerTitle = '';
let lastAction = '';
const chatMessages: string[] = ['v2 本地聊天', '输入 /help 查看命令'];
let chatInput = '';
let inventoryOpen = false;
let inventoryTab: 'items' | 'creative' | 'recipes' = 'items';
let recipePage = 0;
let recipeSize: 2 | 3 = 2;
let recipeQuery = '';
let creativeQuery = '';
let inventoryHint = '';
let selectedSlot = 0;
let hudInputBlockUntil = 0;
const inventory = new Inventory();
let crafting = new CraftingGrid(2);
const creativeItems = CREATIVE_ITEMS;
type V2CreativeCategory = 'all' | 'building' | 'equipment' | 'items' | 'nature';
const CREATIVE_CATEGORIES: Array<{ key: V2CreativeCategory; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'building', label: '建筑' },
  { key: 'equipment', label: '装备' },
  { key: 'items', label: '物品' },
  { key: 'nature', label: '自然' },
];
const creativeTabFor = (id: number): Exclude<V2CreativeCategory, 'all'> => {
  switch (categoryOf(id)) {
    case 'building':
      return 'building';
    case 'tools':
    case 'armor':
      return 'equipment';
    case 'natural':
    case 'wool':
    case 'food':
      return 'nature';
    default:
      return 'items';
  }
};
let creativeCategory: V2CreativeCategory = 'all';
let creativePage = 0;
const registryStorage = {
  getItem: (key: string): string | null => platform.storage.get(key),
  setItem: (key: string, value: string): void => platform.storage.set(key, value),
  removeItem: (key: string): void => platform.storage.remove(key),
};
const registry = new WorldRegistry(registryStorage as Storage);
let currentWorld: WorldSummary | null = null;
let worldPage = 0;
let save: FileSaveGame | null = null;
let saving = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let playMark = Date.now();
let spawn = { x: 0, z: 0, y: 80 };
const planSpawn = (seed: number, type: WorldType): { x: number; z: number; y: number } => {
  const generator = new OverworldGenerator(seed, type);
  return planSpawnRegion(
    (x, z) => generator.surfaceY(x, z),
    (x, z) => generator.biomeAt(x, z).name,
    128,
    WORLD_SURFACE_Y[type],
  );
};
const WORLD_TYPES: WorldType[] = ['default', 'flat', 'amplified'];
const WORLD_TYPE_LABELS = ['默认', '超平坦', '放大化'];
const DIFFICULTIES: Difficulty[] = ['peaceful', 'easy', 'normal', 'hard'];
const DIFFICULTY_LABELS = ['和平（peaceful）', '简单（easy）', '普通（normal）', '困难（hard）'];
const GAME_MODES: GameMode[] = ['survival', 'creative'];
const GAME_MODE_LABELS = ['生存', '创造'];
const draft = { name: '', seed: '', typeIndex: 0, difficultyIndex: 2, modeIndex: 0 };
let activeSettingsTab: 'game' | 'controls' | 'appearance' | 'sound' = 'game';

interface V2Settings {
  brightness: number;
  viewDistance: number;
  sensitivity: number;
  fov: number;
  invertY: boolean;
  autoJump: boolean;
  showDebug: boolean;
  fingerAim: boolean;
  sound: boolean;
  volume: number;
  volumeBlocks: number;
  volumeUi: number;
  volumeMobs: number;
  volumePlayer: number;
  volumeAmbient: number;
  volumeMusic: number;
  leftHanded: boolean;
  view: 'first' | 'third';
  skinColor: string;
  shirtColor: string;
  pantsColor: string;
  hairStyle: 'none' | 'short' | 'long';
  hairColor: string;
  beard: boolean;
  eyeColor: string;
  cape: boolean;
  eyeStyle: 'normal' | 'wide';
  age: 'young' | 'adult' | 'old';
  build: 'slim' | 'normal' | 'broad';
}

const SETTINGS_KEY = 'wx.v2.settings';
const defaultSettings: V2Settings = {
  brightness: 1,
  viewDistance: 2,
  sensitivity: 1,
  fov: 72,
  invertY: false,
  autoJump: false,
  showDebug: false,
  fingerAim: true,
  sound: true,
  volume: 0.7,
  volumeBlocks: 1,
  volumeUi: 1,
  volumeMobs: 1,
  volumePlayer: 1,
  volumeAmbient: 1,
  volumeMusic: 1,
  leftHanded: false,
  view: 'first',
  skinColor: '#e0ac69',
  shirtColor: '#3b6ea5',
  pantsColor: '#2f3f5a',
  hairStyle: 'short',
  hairColor: '#3b2a1a',
  beard: false,
  eyeColor: '#3b2a1a',
  cape: false,
  eyeStyle: 'normal',
  age: 'adult',
  build: 'normal',
};
const readSettings = (): V2Settings => {
  try {
    const raw = platform.storage.get(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw) as Partial<V2Settings>;
    return {
      brightness: Math.max(0.5, Math.min(2, Number(parsed.brightness ?? 1))),
      viewDistance: Math.max(1, Math.min(4, Math.round(Number(parsed.viewDistance ?? 2)))),
      sensitivity: Math.max(0.5, Math.min(2, Number(parsed.sensitivity ?? 1))),
      fov: Math.max(60, Math.min(110, Number(parsed.fov ?? 72))),
      invertY: parsed.invertY === true,
      autoJump: parsed.autoJump === true,
      showDebug: parsed.showDebug === true,
      fingerAim: parsed.fingerAim !== false,
      sound: parsed.sound !== false,
      volume: Math.max(0, Math.min(1, Number(parsed.volume ?? 0.7))),
      volumeBlocks: Math.max(0, Math.min(1, Number(parsed.volumeBlocks ?? 1))),
      volumeUi: Math.max(0, Math.min(1, Number(parsed.volumeUi ?? 1))),
      volumeMobs: Math.max(0, Math.min(1, Number(parsed.volumeMobs ?? 1))),
      volumePlayer: Math.max(0, Math.min(1, Number(parsed.volumePlayer ?? 1))),
      volumeAmbient: Math.max(0, Math.min(1, Number(parsed.volumeAmbient ?? 1))),
      volumeMusic: Math.max(0, Math.min(1, Number(parsed.volumeMusic ?? 1))),
      leftHanded: parsed.leftHanded === true,
      view: parsed.view === 'third' ? 'third' : 'first',
      skinColor: typeof parsed.skinColor === 'string' ? parsed.skinColor : '#e0ac69',
      shirtColor: typeof parsed.shirtColor === 'string' ? parsed.shirtColor : '#3b6ea5',
      pantsColor: typeof parsed.pantsColor === 'string' ? parsed.pantsColor : '#2f3f5a',
      hairStyle: parsed.hairStyle === 'none' || parsed.hairStyle === 'long' ? parsed.hairStyle : 'short',
      hairColor: typeof parsed.hairColor === 'string' ? parsed.hairColor : '#3b2a1a',
      beard: parsed.beard === true,
      eyeColor: typeof parsed.eyeColor === 'string' ? parsed.eyeColor : '#3b2a1a',
      cape: parsed.cape === true,
      eyeStyle: parsed.eyeStyle === 'wide' ? 'wide' : 'normal',
      age: parsed.age === 'young' || parsed.age === 'old' ? parsed.age : 'adult',
      build: parsed.build === 'slim' || parsed.build === 'broad' ? parsed.build : 'normal',
    };
  } catch {
    return { ...defaultSettings };
  }
};
let cameraMode: 'first' | 'third' = 'first';
const settings = readSettings();
cameraMode = settings.view;
playerModel.visible = cameraMode === 'third';
applyPlayerAppearance();
const audio = new AudioEngine();
audio.volume = settings.sound ? settings.volume : 0;
audio.enabled = settings.sound;
let audioResumed = false;
const persistSettings = (): void => {
  platform.storage.set(SETTINGS_KEY, JSON.stringify(settings));
};

const showSettings = (): void => {
  settingsOpen = true;
  const panelW = 800;
  const panelH = Math.min(650, uiHeight - 32);
  const panelX = (1024 - panelW) / 2;
  const panelY = (uiHeight - panelH) / 2;
  const tabs: Array<['game' | 'controls' | 'appearance' | 'sound', string]> = [
    ['game', '游戏'],
    ['controls', '控制'],
    ['appearance', '外观'],
    ['sound', '声音'],
  ];
  const tabButtons = tabs.map(([key, label], index) =>
    button(panelX + 24 + index * 180, panelY + 20, 168, 48, label, () => {
      activeSettingsTab = key;
      showSettings();
    }, {
      background: activeSettingsTab === key ? 'rgba(90, 130, 110, 0.95)' : 'rgba(30, 38, 46, 0.92)',
      border: 'rgba(190, 220, 240, 0.35)',
      radius: 8,
    }),
  );

  const rows: ReturnType<typeof box>[] = [];
  let rowY = panelY + 96;
  const row = (node: ReturnType<typeof box>): void => {
    rows.push(node);
    rowY += 58;
  };
  const apply = (): void => {
    persistSettings();
    solid.skyBrightness = settings.brightness;
    translucent.skyBrightness = settings.brightness;
    camera.fov = settings.fov;
    camera.updateProjectionMatrix();
    audio.enabled = settings.sound;
    audio.volume = settings.sound ? settings.volume : 0;
    audio.setGroupVolume('blocks', settings.volumeBlocks);
    audio.setGroupVolume('ui', settings.volumeUi);
    audio.setGroupVolume('mobs', settings.volumeMobs);
    audio.setGroupVolume('player', settings.volumePlayer);
    audio.setGroupVolume('ambient', settings.volumeAmbient);
    audio.setGroupVolume('music', settings.volumeMusic);
    applyPlayerAppearance();
    showSettings();
  };

  if (activeSettingsTab === 'game') {
    row(slider(panelX + 24, rowY, panelW - 48, 50, '亮度', 0.5, 2, 0.05, settings.brightness, (value) => {
      settings.brightness = value;
      apply();
    }));
    row(slider(panelX + 24, rowY, panelW - 48, 50, '视距', 1, 4, 1, settings.viewDistance, (value) => {
      settings.viewDistance = value;
      apply();
    }));
    row(toggle(panelX + 24, rowY, panelW - 48, 50, '调试信息', settings.showDebug, (value) => {
      settings.showDebug = value;
      apply();
    }));
  } else if (activeSettingsTab === 'controls') {
    row(slider(panelX + 24, rowY, panelW - 48, 50, '视角灵敏度', 0.5, 2, 0.1, settings.sensitivity, (value) => {
      settings.sensitivity = value;
      apply();
    }));
    row(slider(panelX + 24, rowY, panelW - 48, 50, '视野 FOV', 60, 110, 1, settings.fov, (value) => {
      settings.fov = value;
      apply();
    }));
    row(toggle(panelX + 24, rowY, panelW - 48, 50, '反转 Y 轴', settings.invertY, (value) => {
      settings.invertY = value;
      apply();
    }));
    row(toggle(panelX + 24, rowY, panelW - 48, 50, '自动跳跃', settings.autoJump, (value) => {
      settings.autoJump = value;
      apply();
    }));
    row(toggle(panelX + 24, rowY, panelW - 48, 50, '手指落点瞄准', settings.fingerAim, (value) => {
      settings.fingerAim = value;
      apply();
    }));
    row(toggle(panelX + 24, rowY, panelW - 48, 50, '左手模式', settings.leftHanded, (value) => {
      settings.leftHanded = value;
      apply();
    }));
  } else if (activeSettingsTab === 'sound') {
    const soundTop = panelY + 108;
    const colW = 350;
    const left = panelX + 30;
    const right = panelX + 420;
    const gapY = 54;
    rows.push(toggle(left, soundTop, colW, 44, '声音', settings.sound, (value) => {
      settings.sound = value;
      apply();
    }));
    rows.push(slider(left, soundTop + gapY, colW, 44, '主音量', 0, 1, 0.05, settings.volume, (value) => {
      settings.volume = value;
      apply();
    }));
    rows.push(slider(left, soundTop + gapY * 2, colW, 44, '方块音效', 0, 1, 0.05, settings.volumeBlocks, (value) => {
      settings.volumeBlocks = value;
      apply();
    }));
    rows.push(slider(left, soundTop + gapY * 3, colW, 44, 'UI 音效', 0, 1, 0.05, settings.volumeUi, (value) => {
      settings.volumeUi = value;
      apply();
    }));
    rows.push(slider(right, soundTop, colW, 44, '生物', 0, 1, 0.05, settings.volumeMobs, (value) => {
      settings.volumeMobs = value;
      apply();
    }));
    rows.push(slider(right, soundTop + gapY, colW, 44, '玩家', 0, 1, 0.05, settings.volumePlayer, (value) => {
      settings.volumePlayer = value;
      apply();
    }));
    rows.push(slider(right, soundTop + gapY * 2, colW, 44, '环境', 0, 1, 0.05, settings.volumeAmbient, (value) => {
      settings.volumeAmbient = value;
      apply();
    }));
    rows.push(slider(right, soundTop + gapY * 3, colW, 44, '音乐', 0, 1, 0.05, settings.volumeMusic, (value) => {
      settings.volumeMusic = value;
      apply();
    }));
  } else {
    const skinColors = ['#e0ac69', '#c68642', '#8d5524', '#f1c27d', '#d9a066'];
    const shirtColors = ['#3b6ea5', '#4f8a5b', '#a5523b', '#6b5b95', '#2f3f5a'];
    const pantsColors = ['#2f3f5a', '#3d3d3d', '#5b4636', '#6d7b8d', '#1f2a36'];
    const hairColors = ['#3b2a1a', '#151515', '#7a4a22', '#c9a45b', '#9e9e9e'];
    const cycle = (list: string[], value: string): string => {
      const index = list.indexOf(value);
      return list[(index + 1) % list.length]!;
    };
    const leftX = panelX + 24;
    const rightX = panelX + 250;
    const topY = panelY + 108;
    const w = 205;
    const gapY = 38;
    const h = 34;
    const styleLabels: Record<'none' | 'short' | 'long', string> = { none: '无', short: '短', long: '长' };
    rows.push(button(leftX, topY, w, h, '肤色', () => {
      settings.skinColor = cycle(skinColors, settings.skinColor);
      apply();
    }, { background: settings.skinColor, border: 'rgba(255,255,255,0.35)', radius: 8 }));
    rows.push(button(leftX, topY + gapY, w, h, '上衣', () => {
      settings.shirtColor = cycle(shirtColors, settings.shirtColor);
      apply();
    }, { background: settings.shirtColor, border: 'rgba(255,255,255,0.35)', radius: 8 }));
    rows.push(button(leftX, topY + gapY * 2, w, h, '裤子', () => {
      settings.pantsColor = cycle(pantsColors, settings.pantsColor);
      apply();
    }, { background: settings.pantsColor, border: 'rgba(255,255,255,0.35)', radius: 8 }));
    rows.push(button(rightX, topY, w, h, `发型：${styleLabels[settings.hairStyle]}`, () => {
      const order: Array<'none' | 'short' | 'long'> = ['none', 'short', 'long'];
      settings.hairStyle = order[(order.indexOf(settings.hairStyle) + 1) % order.length]!;
      apply();
    }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 8 }));
    rows.push(button(rightX, topY + gapY, w, h, '发色', () => {
      settings.hairColor = cycle(hairColors, settings.hairColor);
      apply();
    }, { background: settings.hairColor, border: 'rgba(255,255,255,0.35)', radius: 8 }));
    rows.push(button(rightX, topY + gapY * 2, w, h, settings.beard ? '胡须：开' : '胡须：关', () => {
      settings.beard = !settings.beard;
      apply();
    }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 8 }));
    const eyeStyles: Array<'normal' | 'wide'> = ['normal', 'wide'];
    const ages: Array<'young' | 'adult' | 'old'> = ['young', 'adult', 'old'];
    const builds: Array<'slim' | 'normal' | 'broad'> = ['slim', 'normal', 'broad'];
    const styleLabel: Record<'normal' | 'wide', string> = { normal: '普通', wide: '宽' };
    const ageLabel: Record<'young' | 'adult' | 'old', string> = { young: '年轻', adult: '成年', old: '老年' };
    const buildLabel: Record<'slim' | 'normal' | 'broad', string> = { slim: '瘦', normal: '标准', broad: '壮' };
    rows.push(button(leftX, topY + gapY * 4, w, h, `眼型：${styleLabel[settings.eyeStyle]}`, () => {
      settings.eyeStyle = eyeStyles[(eyeStyles.indexOf(settings.eyeStyle) + 1) % eyeStyles.length]!;
      apply();
    }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 8 }));
    rows.push(button(leftX, topY + gapY * 5, w, h, `年龄：${ageLabel[settings.age]}`, () => {
      settings.age = ages[(ages.indexOf(settings.age) + 1) % ages.length]!;
      apply();
    }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 8 }));
    rows.push(button(rightX, topY + gapY * 4, w, h, `身架：${buildLabel[settings.build]}`, () => {
      settings.build = builds[(builds.indexOf(settings.build) + 1) % builds.length]!;
      apply();
    }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 8 }));
    rows.push(button(leftX, topY + gapY * 3, w, h, '眼睛颜色', () => {
      settings.eyeColor = cycle(hairColors, settings.eyeColor);
      apply();
    }, { background: settings.eyeColor, border: 'rgba(255,255,255,0.35)', radius: 8 }));
    rows.push(button(rightX, topY + gapY * 3, w, h, settings.cape ? '披风：开' : '披风：关', () => {
      settings.cape = !settings.cape;
      apply();
    }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 8 }));

    const previewX = panelX + panelW - 210;
    const previewY = panelY + 110;
    rows.push(box(previewX, previewY, 120, 120, [], { background: settings.skinColor, radius: 8 }));
    if (settings.hairStyle !== 'none') {
      rows.push(box(previewX - 4, previewY - 10, 128, 24, [], { background: settings.hairColor, radius: 6 }));
    }
    rows.push(box(previewX + 30, previewY + 48, 12, 8, [], { background: settings.eyeColor, radius: 2 }));
    rows.push(box(previewX + 66, previewY + 48, 12, 8, [], { background: settings.eyeColor, radius: 2 }));
    if (settings.cape) {
      rows.push(box(previewX + 10, previewY + 120, 100, 120, [], { background: '#8a2b2b', radius: 4 }));
    }
    if (settings.beard) {
      rows.push(box(previewX + 28, previewY + 82, 64, 14, [], { background: settings.hairColor, radius: 4 }));
    }
    rows.push(box(previewX + 12, previewY + 112, 96, 100, [], { background: settings.shirtColor, radius: 6 }));
    rows.push(box(previewX + 22, previewY + 205, 34, 76, [], { background: settings.pantsColor, radius: 5 }));
    rows.push(box(previewX + 62, previewY + 205, 34, 76, [], { background: settings.pantsColor, radius: 5 }));
    rows.push(text(previewX - 50, previewY + 292, 220, 24, '3D 模型同步 · 2D 预览', {
      fontSize: 12,
      color: 'rgba(200, 220, 235, 0.6)',
      align: 'center',
    }));
  }

  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      box(0, 0, 1024, uiHeight, [], { background: 'rgba(0, 0, 0, 0.55)' }),
      box(panelX, panelY, panelW, panelH, [
        ...tabButtons,
        ...rows,
        button(panelX + panelW - 196, panelY + panelH - 64, 172, 44, started ? '返回游戏' : '返回标题', () => {
          settingsOpen = false;
          paused = false;
          if (started) showHud();
          else showTitle();
        }, { background: 'rgba(30, 38, 46, 0.95)', border: 'rgba(190, 220, 240, 0.35)', radius: 8 }),
      ], { background: 'rgba(16, 22, 28, 0.97)', border: 'rgba(170, 205, 230, 0.45)', borderWidth: 2, radius: 12 }),
    ]),
  );
};

const handleDrop = (fromIndex: number, toIndex: number): void => {
  if (fromIndex < 100 && toIndex < 100) {
    swapSlots(fromIndex, toIndex);
    return;
  }
  const craftEnd = 100 + crafting.size * crafting.size;
  if (fromIndex < 100 && toIndex >= 100 && toIndex < craftEnd) {
    const stack = inventory.get(fromIndex);
    if (!stack) return;
    const target = crafting.get(toIndex - 100);
    if (target) {
      if (target.id === stack.id) {
        target.count += stack.count;
        crafting.set(toIndex - 100, target);
        inventory.set(fromIndex, null);
      } else {
        inventory.set(fromIndex, target);
        crafting.set(toIndex - 100, stack);
      }
    } else {
      crafting.set(toIndex - 100, stack);
      inventory.set(fromIndex, null);
    }
    showInventory();
    return;
  }
  if (fromIndex >= 100 && fromIndex < craftEnd && toIndex >= 100 && toIndex < craftEnd) {
    const a = crafting.get(fromIndex - 100);
    const b = crafting.get(toIndex - 100);
    crafting.set(fromIndex - 100, b);
    crafting.set(toIndex - 100, a);
    showInventory();
    return;
  }
  if (fromIndex >= 100 && fromIndex < craftEnd && toIndex < 100) {
    const stack = crafting.get(fromIndex - 100);
    if (!stack) return;
    const remaining = inventory.add(stack.id, stack.count);
    crafting.set(fromIndex - 100, remaining > 0 ? { id: stack.id, count: remaining } : null);
    showInventory();
  }
};

const swapSlots = (fromIndex: number, toIndex: number): void => {
  const from = inventory.get(fromIndex);
  const to = inventory.get(toIndex);
  inventory.set(fromIndex, to);
  inventory.set(toIndex, from);
  selectedSlot = toIndex;
  showInventory();
};

const recipeFits = (recipe: ShapedRecipe | ShapelessRecipe, size: 2 | 3): boolean => {
  if (recipe.kind === 'shapeless') return recipe.ingredients.length <= size * size;
  return recipe.pattern.length <= size && recipe.pattern.every((row) => row.length <= size);
};

const takeOne = (id: number): boolean => {
  for (let i = 0; i < 36; i++) {
    const stack = inventory.get(i);
    if (!stack || stack.id !== id) continue;
    stack.count -= 1;
    inventory.set(i, stack.count > 0 ? stack : null);
    return true;
  }
  return false;
};

const fillRecipe = (recipe: ShapedRecipe | ShapelessRecipe): void => {
  if (crafting.size !== recipeSize) {
    crafting.drainTo(inventory);
    crafting = new CraftingGrid(recipeSize);
  } else {
    crafting.drainTo(inventory);
  }
  inventoryHint = '';
  if (recipe.kind === 'shapeless') {
    for (let i = 0; i < recipe.ingredients.length; i++) {
      const id = recipe.ingredients[i]!;
      if (!takeOne(id)) {
        inventoryHint = '材料不足';
        break;
      }
      crafting.set(i, { id, count: 1 });
    }
  } else {
    for (let row = 0; row < recipe.pattern.length; row++) {
      const line = recipe.pattern[row]!;
      for (let col = 0; col < line.length; col++) {
        const char = line[col]!;
        if (char === ' ') continue;
        const id = recipe.key[char];
        if (id === undefined) continue;
        if (!takeOne(id)) {
          inventoryHint = '材料不足';
          continue;
        }
        crafting.set(row * recipeSize + col, { id, count: 1 });
      }
    }
  }
  inventoryTab = 'items';
  showInventory();
};

const showInventory = (): void => {
  inventoryOpen = true;
  const panelW = 880;
  const panelH = Math.min(620, uiHeight - 28);
  const panelX = (1024 - panelW) / 2;
  const panelY = (uiHeight - panelH) / 2;
  const railW = 160;
  const slotSize = 50;
  const gap = 5;
  const gridX = panelX + railW + 20;
  const gridY = panelY + 92;
  const craftSlot = 44;
  const craftGap = 4;
  const craftX = gridX + 9 * (slotSize + gap) + 10;
  const craftY = gridY;
  const outputX = craftX + 3 * (craftSlot + craftGap) + 12;
  const elements: UiElement[] = [
    text(panelX + 24, panelY + 20, 200, 42, '背包', { fontSize: 30, color: '#ffffff' }),
    button(panelX + 24, panelY + 86, railW - 24, 52, '物品', () => {
      inventoryTab = 'items';
      showInventory();
    }, { background: inventoryTab === 'items' ? 'rgba(80, 120, 105, 0.95)' : 'rgba(30, 38, 46, 0.92)', border: 'rgba(180, 215, 235, 0.35)', radius: 8 }),
    button(panelX + 24, panelY + 150, railW - 24, 52, '创造', () => {
      inventoryTab = 'creative';
      showInventory();
    }, {
      background: inventoryTab === 'creative' ? 'rgba(80, 120, 105, 0.95)' : 'rgba(30, 38, 46, 0.92)',
      border: 'rgba(180, 215, 235, 0.35)',
      radius: 8,
    }),
    button(panelX + 24, panelY + 214, railW - 24, 52, '配方', () => {
      inventoryTab = 'recipes';
      recipePage = 0;
      showInventory();
    }, { background: inventoryTab === 'recipes' ? 'rgba(80, 120, 105, 0.95)' : 'rgba(30, 38, 46, 0.92)', border: 'rgba(180, 215, 235, 0.35)', radius: 8 }),
    button(panelX + panelW - 72, panelY + 20, 44, 44, 'X', () => {
      crafting.drainTo(inventory);
      inventoryOpen = false;
      paused = false;
      showHud();
    }, { background: 'rgba(30, 38, 46, 0.95)', border: 'rgba(180, 215, 235, 0.35)', radius: 8 }),
  ];
  if (inventoryTab === 'items') {
    for (let i = 0; i < 36; i++) {
      const stack = inventory.get(i);
      elements.push(slot(gridX + (i % 9) * (slotSize + gap), gridY + Math.floor(i / 9) * (slotSize + gap), slotSize, i, stack?.id ?? 0, stack?.count ?? 0, i === selectedSlot, () => {
        selectedSlot = i;
        showInventory();
      }, (from, to) => handleDrop(from.index, to.index)));
    }
  } else if (inventoryTab === 'creative') {
    const query = creativeQuery.trim().toLowerCase();
    const filtered = creativeItems.filter((id) => {
      if (creativeCategory !== 'all' && creativeTabFor(id) !== creativeCategory) return false;
      return !query || itemLabel(id).toLowerCase().includes(query);
    });
    const pageSize = 45;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    creativePage = Math.max(0, Math.min(creativePage, pages - 1));
    const startIndex = creativePage * pageSize;
    const list = filtered.slice(startIndex, startIndex + pageSize);
    CREATIVE_CATEGORIES.forEach((category, index) => {
      elements.push(button(gridX + index * 74, panelY + 50, 70, 28, category.label, () => {
        creativeCategory = category.key;
        creativePage = 0;
        showInventory();
      }, {
        background: creativeCategory === category.key ? 'rgba(80,120,105,0.95)' : 'rgba(32,44,52,0.95)',
        border: 'rgba(180,215,235,0.35)',
        radius: 6,
        fontSize: 12,
      }));
    });
    elements.push(button(gridX + 5 * 74, panelY + 50, 95, 28, creativeQuery ? '搜索中' : '搜索', () => {
      void askText(creativeQuery, 20).then((value) => {
        if (value !== null) {
          creativeQuery = value;
          creativePage = 0;
          showInventory();
        }
      });
    }, { background: 'rgba(32,44,52,0.95)', border: 'rgba(180,215,235,0.35)', radius: 6, fontSize: 12 }));
    elements.push(button(gridX + 5 * 74 + 101, panelY + 50, 85, 28, '整理', () => {
      const stacks = [];
      for (let i = 0; i < 36; i++) {
        const stack = inventory.get(i);
        if (stack) stacks.push({ id: stack.id, count: stack.count });
      }
      stacks.sort((a, b) => a.id - b.id);
      for (let i = 0; i < 36; i++) inventory.set(i, stacks[i] ?? null);
      selectedSlot = 0;
      showInventory();
    }, { background: 'rgba(32,44,52,0.95)', border: 'rgba(180,215,235,0.35)', radius: 6, fontSize: 12 }));
    for (let i = 0; i < list.length; i++) {
      const id = list[i]!;
      elements.push(slot(gridX + (i % 9) * (slotSize + gap), gridY + Math.floor(i / 9) * (slotSize + gap), slotSize, i, id, 0, false, () => {
        inventory.add(id, 64);
        showInventory();
      }));
    }
    elements.push(text(gridX, gridY + 5 * (slotSize + gap) + 10, 420, 24, `${filtered.length} 项 · ${creativePage + 1}/${pages}`, {
      fontSize: 13,
      color: 'rgba(200,220,235,0.65)',
    }));
    elements.push(button(gridX + 420, gridY + 5 * (slotSize + gap) + 6, 75, 28, '上一页', () => {
      creativePage = Math.max(0, creativePage - 1);
      showInventory();
    }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 6, fontSize: 12 }));
    elements.push(button(gridX + 505, gridY + 5 * (slotSize + gap) + 6, 75, 28, '下一页', () => {
      creativePage = Math.min(pages - 1, creativePage + 1);
      showInventory();
    }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 6, fontSize: 12 }));
  } else {
    const query = recipeQuery.trim().toLowerCase();
    const recipes = RECIPES.filter((recipe) => recipeFits(recipe, recipeSize)).filter((recipe) => {
      if (!query) return true;
      return itemLabel(recipe.result.id).toLowerCase().includes(query);
    });
    const perPage = 6;
    const pages = Math.max(1, Math.ceil(recipes.length / perPage));
    recipePage = Math.max(0, Math.min(recipePage, pages - 1));
    elements.push(button(gridX, panelY + 52, 150, 30, recipeQuery ? `搜索：${recipeQuery}` : '搜索配方', () => {
      void askText(recipeQuery, 20).then((value) => {
        if (value !== null) {
          recipeQuery = value;
          recipePage = 0;
          showInventory();
        }
      });
    }, { background: 'rgba(32,44,52,0.95)', border: 'rgba(180,215,235,0.35)', radius: 6 }));
    elements.push(button(gridX + 160, panelY + 52, 110, 30, `${recipeSize}x${recipeSize}`, () => {
      recipeSize = recipeSize === 2 ? 3 : 2;
      recipePage = 0;
      showInventory();
    }, { background: 'rgba(32,44,52,0.95)', border: 'rgba(180,215,235,0.35)', radius: 6 }));
    const start = recipePage * perPage;
    for (let i = 0; i < Math.min(perPage, recipes.length - start); i++) {
      const recipe = recipes[start + i]!;
      const result = recipe.result;
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = gridX + col * 160;
      const y = gridY + row * 86;
      elements.push(slot(x, y, 50, 300 + i, result.id, result.count, false, () => fillRecipe(recipe)));
      elements.push(text(x + 58, y + 4, 96, 26, itemLabel(result.id), { fontSize: 14, color: '#dcecf5' }));
      elements.push(text(x + 58, y + 30, 96, 20, `x${result.count}`, { fontSize: 12, color: 'rgba(190,215,230,0.65)' }));
    }
    elements.push(text(gridX, gridY + 188, 400, 26, `配方 ${recipePage + 1}/${pages} · ${recipes.length} 条`, { fontSize: 13, color: 'rgba(200,220,235,0.65)' }));
    elements.push(button(gridX, gridY + 216, 90, 34, '上一页', () => {
      recipePage = Math.max(0, recipePage - 1);
      showInventory();
    }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 6 }));
    elements.push(button(gridX + 100, gridY + 216, 90, 34, '下一页', () => {
      recipePage = Math.min(pages - 1, recipePage + 1);
      showInventory();
    }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 6 }));
  }
  elements.push(button(craftX, panelY + 22, 110, 28, `${crafting.size}x${crafting.size}`, () => {
    crafting.drainTo(inventory);
    crafting = new CraftingGrid(crafting.size === 2 ? 3 : 2);
    showInventory();
  }, {
    background: 'rgba(32, 44, 52, 0.95)',
    border: 'rgba(180, 215, 235, 0.35)',
    radius: 6,
  }));
  for (let i = 0; i < crafting.size * crafting.size; i++) {
    const stack = crafting.get(i);
    elements.push(slot(craftX + (i % crafting.size) * (craftSlot + craftGap), craftY + Math.floor(i / crafting.size) * (craftSlot + craftGap), craftSlot, 100 + i, stack?.id ?? 0, stack?.count ?? 0, false, () => {
      const current = crafting.get(i);
      if (current) {
        const remaining = inventory.add(current.id, current.count);
        crafting.set(i, remaining > 0 ? { id: current.id, count: remaining } : null);
        showInventory();
      }
    }, (from, to) => handleDrop(from.index, to.index)));
  }
  const result = crafting.result;
  elements.push(text(outputX, craftY + 2, 100, 24, '产物', { fontSize: 13, color: 'rgba(210,230,240,0.7)' }));
  elements.push(slot(outputX, craftY + 26, craftSlot, 200, result?.id ?? 0, result?.count ?? 0, false, () => {
    if (!crafting.result) return;
    inventory.add(crafting.result.id, crafting.result.count);
    crafting.takeResult();
    showInventory();
  }));

  if (inventoryHint) {
    elements.push(text(gridX, panelY + panelH - 32, 560, 26, inventoryHint, { fontSize: 14, color: 'rgba(255,190,120,0.9)' }));
  }
  ui.setRoot(box(0, 0, 1024, uiHeight, [
    box(0, 0, 1024, uiHeight, [], { background: 'rgba(0, 0, 0, 0.55)' }),
    box(panelX, panelY, panelW, panelH, elements, { background: 'rgba(16, 22, 28, 0.97)', border: 'rgba(170, 205, 230, 0.45)', borderWidth: 2, radius: 12 }),
  ]));
};

const snapshotPlayer = (): PlayerSave => ({
  x: physics.x,
  y: physics.y,
  z: physics.z,
  yaw,
  pitch,
  dimension: 'overworld',
  flying: false,
  timeOfDay: 0,
  health,
  food,
  saturation,
  air: 300,
  exhaustion: 0,
  inventory: inventory.serialize(),
  xp: { level: xpLevel, progress: xpIntoLevel / (7 * (xpLevel + 1)), total: 0, partial: xpIntoLevel },
  selectedSlot,
  dragonDefeated: false,
});

const persistWorld = async (): Promise<void> => {
  if (!save || !currentWorld || saving) return;
  saving = true;
  try {
    currentWorld.lastPlayed = Date.now();
    currentWorld.playTime = (currentWorld.playTime ?? 0) + Math.max(0, (Date.now() - playMark) / 1000);
    playMark = Date.now();
    registry.update(currentWorld.id, {
      lastPlayed: currentWorld.lastPlayed,
      playTime: currentWorld.playTime,
    });
    await save.savePlayer(snapshotPlayer());
    const records: ChunkSaveRecord[] = [];
    for (const key of world.edits.dirtyKeys()) {
      const { dimension, cx, cz } = ChunkEdits.parseKey(key);
      const edits = world.edits.serialize(dimension, cx, cz);
      if (edits) records.push({ dimension, cx, cz, edits });
    }
    await save.saveChunks(records);
    await save.saveContainers(serializeContainers(world.containers));
    await save.saveMeta(save.buildMeta(world.seed, world.edits.totalEdits));
    world.edits.markSaved();
  } catch (error) {
    console.warn('[v2] save failed', error);
  } finally {
    saving = false;
  }
};

const requestSave = (): void => {
  if (!save) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistWorld();
  }, 1200);
};

const mountWorld = async (entry: WorldSummary): Promise<void> => {
  await persistWorld();
  if (save) {
    save.close();
    save = null;
  }

  world.events = {};
  chunks.disposeAll();
  world = new World(entry.seed, entry.worldType, 1);
  chunks = new ChunkRenderer(scene, atlas, world, solid.material, translucent.material, null);
  world.events = {
    onChunkLoaded: (chunk) => chunks.onChunkLoaded(chunk.cx, chunk.cz),
    onChunkUnloaded: (cx, cz) => chunks.onChunkUnloaded(cx, cz),
    onBlockChanged: (x, _y, z) => chunks.enqueueAround(x, z),
  };
  currentWorld = entry;
  playMark = Date.now();
  registry.update(entry.id, { lastPlayed: Date.now() });
  spawn = planSpawn(entry.seed, entry.worldType);
  physics.teleport(spawn.x + 0.5, spawn.y + 1.01, spawn.z + 0.5);
  playerReady = false;
  inventory.clear();
  selectedSlot = 0;
  health = 20;
  food = 20;
  saturation = 5;
  foodExhaustion = 0;
  fallPeakY = spawn.y + 1;
  wasOnGround = false;
  landedOnce = false;
  dead = false;
  xpLevel = 0;
  xpIntoLevel = 0;
  hudInputBlockUntil = Date.now() + 400;
  lastAutoSave = Date.now();
  try {
    save = await FileSaveGame.open(entry.id, platform.files);
    for (const record of await save.loadAllChunkEdits()) {
      world.edits.restore(record.dimension, record.cx, record.cz, record.edits);
    }
    restoreContainers(world.containers, await save.loadContainers());
    const loaded = await save.loadPlayer();
    if (loaded) {
      physics.teleport(loaded.x, loaded.y, loaded.z);
      yaw = loaded.yaw;
      pitch = loaded.pitch;
      if (loaded.inventory) inventory.restore(loaded.inventory);
      health = Math.max(0, Math.min(20, loaded.health));
      food = Math.max(0, Math.min(20, loaded.food));
      saturation = Math.max(0, Math.min(20, loaded.saturation));
      xpLevel = Math.max(0, loaded.xp?.level ?? 0);
      xpIntoLevel = Math.max(0, loaded.xp?.partial ?? 0);
      selectedSlot = Math.max(0, Math.min(8, loaded.selectedSlot ?? 0));
      playerReady = true;
    }
  } catch (error) {
    console.warn('[v2] load save failed', error);
  }
  started = true;
  paused = false;
  settingsOpen = false;
  inventoryOpen = false;
  showHud();
};

const askText = async (
  current: string,
  maxLength: number,
): Promise<string | null> => {
  try {
    const value = await platform.keyboard.show({ defaultValue: current, maxLength });
    return value === null ? null : value.slice(0, maxLength);
  } catch {
    return null;
  }
};

const showCreate = (): void => {
  menuScreen = 'create';
  const panelW = 800;
  const panelH = Math.min(640, uiHeight - 32);
  const panelX = (1024 - panelW) / 2;
  const panelY = (uiHeight - panelH) / 2;
  const fieldX = panelX + 230;
  const fieldW = panelW - 270;
  let y = panelY + 78;
  const row = (): number => {
    const current = y;
    y += 56;
    return current;
  };
  const nameY = row();
  const seedY = row();
  const typeY = row();
  const difficultyY = row();
  const modeY = row();

  const textField = (value: string, ry: number, onTap: () => void): UiElement => {
    return button(fieldX, ry, fieldW, 46, value, onTap, {
      background: 'rgba(22, 30, 36, 0.95)',
      border: 'rgba(180, 215, 235, 0.35)',
      radius: 8,
    });
  };

  const hint = (() => {
    const type = WORLD_TYPES[draft.typeIndex]!;
    if (type === 'flat') return '只有三层平地：没有树木、村庄与矿石';
    if (type === 'amplified') return '与默认内容相同，陆地起伏更大、山更高';
    return '完整世界：群系、树木、矿石、村庄… 生存推荐';
  })();

  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      box(0, 0, 1024, uiHeight, [], { background: 'rgba(0, 0, 0, 0.55)' }),
      box(panelX, panelY, panelW, panelH, [
        text(panelX + 30, panelY + 20, 400, 44, '新建世界', { fontSize: 30, color: '#ffffff' }),
        text(panelX + 30, nameY + 12, 190, 32, '名称', { fontSize: 19, color: '#dcecf5' }),
        textField(draft.name || '世界名称', nameY, () => {
          void askText(draft.name, 24).then((value) => {
            if (value !== null) {
              draft.name = value;
              showCreate();
            }
          });
        }),
        text(panelX + 30, seedY + 12, 190, 32, '种子', { fontSize: 19, color: '#dcecf5' }),
        textField(draft.seed || '留空随机', seedY, () => {
          void askText(draft.seed, 12).then((value) => {
            if (value !== null) {
              draft.seed = value.replace(/[^0-9]/g, '');
              showCreate();
            }
          });
        }),
        text(panelX + 30, typeY + 12, 190, 32, '类型', { fontSize: 19, color: '#dcecf5' }),
        textField(WORLD_TYPE_LABELS[draft.typeIndex]!, typeY, () => {
          draft.typeIndex = (draft.typeIndex + 1) % WORLD_TYPES.length;
          showCreate();
        }),
        text(panelX + 30, difficultyY + 12, 190, 32, '难度', { fontSize: 19, color: '#dcecf5' }),
        textField(DIFFICULTY_LABELS[draft.difficultyIndex]!, difficultyY, () => {
          draft.difficultyIndex = (draft.difficultyIndex + 1) % DIFFICULTIES.length;
          showCreate();
        }),
        text(panelX + 30, modeY + 12, 190, 32, '模式', { fontSize: 19, color: '#dcecf5' }),
        textField(GAME_MODE_LABELS[draft.modeIndex]!, modeY, () => {
          draft.modeIndex = (draft.modeIndex + 1) % GAME_MODES.length;
          showCreate();
        }),
        text(panelX + 30, modeY + 56, panelW - 60, 30, hint, {
          fontSize: 14,
          color: 'rgba(200, 225, 240, 0.72)',
        }),
        button(panelX + 30, panelY + panelH - 58, 220, 44, '返回世界列表', () => showWorlds(), {
          background: 'rgba(32, 42, 50, 0.95)',
          border: 'rgba(190, 220, 240, 0.4)',
          radius: 8,
        }),
        button(panelX + panelW - 340, panelY + panelH - 58, 310, 44, '创建并进入', () => {
          const seed = draft.seed.trim() ? Number(draft.seed) : undefined;
          const created = registry.create({
            name: draft.name,
            seed: seed !== undefined && Number.isFinite(seed) ? seed : undefined,
            worldType: WORLD_TYPES[draft.typeIndex]!,
            difficulty: DIFFICULTIES[draft.difficultyIndex]!,
            gameMode: GAME_MODES[draft.modeIndex]!,
          });
          void mountWorld(created);
        }, {
          background: 'rgba(60, 110, 90, 0.96)',
          border: 'rgba(190, 235, 215, 0.55)',
          radius: 8,
        }),
      ], {
        background: 'rgba(16, 22, 28, 0.97)',
        border: 'rgba(170, 205, 230, 0.45)',
        borderWidth: 2,
        radius: 12,
      }),
    ]),
  );
};

const confirmDelete = async (name: string): Promise<boolean> => {
  const wxApi = (globalThis as unknown as { wx?: { showModal?: (options: any) => void } }).wx;
  if (!wxApi?.showModal) return true;
  return new Promise((resolve) => {
    wxApi.showModal?.({
      title: '删除世界',
      content: `删除「${name}」？存档会一起删掉，无法恢复。`,
      success: (result: { confirm?: boolean }) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false),
    });
  });
};

const removeWorld = async (entry: WorldSummary): Promise<void> => {
  if (!(await confirmDelete(entry.name))) return;
  try {
    await FileSaveGame.deleteWorld(entry.id, platform.files);
  } catch (error) {
    console.warn('[v2] delete save failed', error);
  }
  registry.remove(entry.id);
  if (currentWorld?.id === entry.id) currentWorld = null;
  showWorlds();
};

const showEdit = (entry: WorldSummary): void => {
  menuScreen = 'edit';
  const panelW = 800;
  const panelH = 390;
  const panelX = (1024 - panelW) / 2;
  const panelY = (uiHeight - panelH) / 2;
  const fieldX = panelX + 230;
  const fieldW = panelW - 270;
  const nameY = panelY + 92;
  const modeY = panelY + 158;
  const difficultyY = panelY + 224;
  const modeIndex = Math.max(0, GAME_MODES.indexOf(entry.gameMode as GameMode));
  const difficultyIndex = Math.max(0, DIFFICULTIES.indexOf(entry.difficulty as Difficulty));
  const field = (value: string, ry: number, onTap: () => void): UiElement =>
    button(fieldX, ry, fieldW, 50, value, onTap, {
      background: 'rgba(22, 30, 36, 0.95)',
      border: 'rgba(180, 215, 235, 0.35)',
      radius: 8,
    });
  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      box(0, 0, 1024, uiHeight, [], { background: 'rgba(0,0,0,0.55)' }),
      box(panelX, panelY, panelW, panelH, [
        text(panelX + 30, panelY + 20, 400, 40, '编辑世界', { fontSize: 30, color: '#ffffff' }),
        text(panelX + 30, nameY + 12, 190, 30, '名称', { fontSize: 19, color: '#dcecf5' }),
        field(entry.name, nameY, () => {
          void askText(entry.name, 24).then((value) => {
            if (value !== null) {
              const name = value.trim() || entry.name;
              registry.rename(entry.id, name);
              entry.name = name;
              showEdit(entry);
            }
          });
        }),
        text(panelX + 30, modeY + 12, 190, 30, '模式', { fontSize: 19, color: '#dcecf5' }),
        field(GAME_MODE_LABELS[modeIndex]!, modeY, () => {
          const next = GAME_MODES[(modeIndex + 1) % GAME_MODES.length]!;
          registry.update(entry.id, { gameMode: next });
          entry.gameMode = next;
          showEdit(entry);
        }),
        text(panelX + 30, difficultyY + 12, 190, 30, '难度', { fontSize: 19, color: '#dcecf5' }),
        field(DIFFICULTY_LABELS[difficultyIndex]!, difficultyY, () => {
          const next = DIFFICULTIES[(difficultyIndex + 1) % DIFFICULTIES.length]!;
          registry.update(entry.id, { difficulty: next });
          entry.difficulty = next;
          showEdit(entry);
        }),
        button(panelX + 30, panelY + panelH - 62, 220, 44, '取消', () => showWorlds(), {
          background: 'rgba(32,42,50,0.95)',
          border: 'rgba(190,220,240,0.4)',
          radius: 8,
        }),
        button(panelX + panelW - 340, panelY + panelH - 62, 310, 44, '保存并返回', () => showWorlds(), {
          background: 'rgba(60,110,90,0.96)',
          border: 'rgba(190,235,215,0.55)',
          radius: 8,
        }),
      ], {
        background: 'rgba(16,22,28,0.97)',
        border: 'rgba(170,205,230,0.45)',
        borderWidth: 2,
        radius: 12,
      }),
    ]),
  );
};

const showWorlds = (): void => {
  menuScreen = 'worlds';
  const worlds = registry.list();
  const pageSize = 4;
  const pages = Math.max(1, Math.ceil(worlds.length / pageSize));
  worldPage = Math.max(0, Math.min(worldPage, pages - 1));
  const visible = worlds.slice(worldPage * pageSize, worldPage * pageSize + pageSize);
  const difficultyLabel = (value: string): string =>
    value === 'hard' ? '困难' : value === 'peaceful' ? '和平' : value === 'easy' ? '简单' : '普通';
  const modeLabel = (value: string): string => (value === 'creative' ? '创造' : '生存');
  const buttons: UiElement[] = visible.flatMap((world, index) => {
    const y = 140 + index * 52;
    return [
      button(252, y, 380, 46, `${world.name} · ${difficultyLabel(world.difficulty)}/${modeLabel(world.gameMode)} · ${Math.round((world.playTime ?? 0) / 60)}m`, () => void mountWorld(world), {
        background: 'rgba(34, 48, 44, 0.95)',
        border: 'rgba(180, 225, 205, 0.38)',
        radius: 8,
      }),
      button(642, y, 80, 46, '编辑', () => showEdit(world), {
        background: 'rgba(32, 42, 50, 0.95)',
        border: 'rgba(190, 220, 240, 0.38)',
        radius: 8,
      }),
      button(732, y, 100, 46, '删除', () => void removeWorld(world), {
        background: 'rgba(74, 38, 40, 0.95)',
        border: 'rgba(240, 170, 170, 0.4)',
        radius: 8,
      }),
    ];
  });
  const bottom = 140 + Math.max(1, visible.length) * 52;
  const pager: UiElement[] = pages > 1
    ? [
        button(292, bottom + 2, 120, 30, '上一页', () => {
          worldPage = Math.max(0, worldPage - 1);
          showWorlds();
        }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 6 }),
        text(0, bottom + 8, 1024, 22, `${worldPage + 1} / ${pages}`, { fontSize: 14, color: 'rgba(220,238,245,0.8)', align: 'center' }),
        button(612, bottom + 2, 120, 30, '下一页', () => {
          worldPage = Math.min(pages - 1, worldPage + 1);
          showWorlds();
        }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 6 }),
      ]
    : [];
  const actionY = bottom + (pages > 1 ? 40 : 4);
  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      box(0, 0, 1024, uiHeight, [], { background: '#0d1a24' }),
      text(0, 26, 1024, 48, '选择世界', { fontSize: 38, color: '#f2f7fa', align: 'center' }),
      text(0, 78, 1024, 24, `存档 ${worlds.length}`, {
        fontSize: 14,
        color: 'rgba(200, 225, 240, 0.65)',
        align: 'center',
      }),
      ...buttons,
      ...pager,
      button(252, actionY, 580, 40, '新建世界', () => showCreate(), {
        background: 'rgba(60, 110, 90, 0.96)',
        border: 'rgba(190, 235, 215, 0.55)',
        radius: 8,
      }),
      button(252, actionY + 46, 580, 34, '返回标题', () => showTitle(), {
        background: 'rgba(32, 42, 50, 0.95)',
        border: 'rgba(190, 220, 240, 0.4)',
        radius: 8,
      }),
    ]),
  );
};

const showTitle = (): void => {
  menuScreen = 'title';
  const horizon = uiHeight * 0.56;
  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      box(0, 0, 1024, uiHeight, [], { background: '#0d1a24' }),
      box(0, horizon, 1024, uiHeight - horizon, [], { background: '#1b2a28' }),
      box(72, horizon - 150, 300, 150, [], { background: '#182b33' }),
      box(300, horizon - 210, 260, 210, [], { background: '#1b3038' }),
      box(560, horizon - 110, 360, 110, [], { background: '#17262d' }),
      text(0, 38, 1024, 80, 'MINECRAFT', { fontSize: 68, color: '#f2f7fa', align: 'center' }),
      text(0, 118, 1024, 36, 'v2 · main core', { fontSize: 18, color: 'rgba(220,238,245,0.75)', align: 'center' }),
      button(312, horizon + 34, 400, 58, '开始游戏', () => {
        showWorlds();
      }, { background: 'rgba(60, 110, 90, 0.96)', border: 'rgba(190, 235, 215, 0.55)', radius: 8 }),
      button(312, horizon + 108, 400, 54, '设置', () => {
        settingsOpen = true;
        showSettings();
      }, { background: 'rgba(32, 42, 50, 0.95)', border: 'rgba(190, 220, 240, 0.4)', radius: 8 }),
    ]),
  );
};

const showContainer = (): void => {
  if (!openedContainer) return;
  containerOpen = true;
  const isFurnace = openedContainer instanceof Furnace;
  const slots = isFurnace ? 3 : 27;
  const cols = isFurnace ? 3 : 9;
  const slotSize = 50;
  const gap = 5;
  const panelW = 620;
  const panelH = 390;
  const panelX = (1024 - panelW) / 2;
  const panelY = (uiHeight - panelH) / 2;
  const gridW = cols * slotSize + (cols - 1) * gap;
  const gridX = panelX + (panelW - gridW) / 2;
  const gridY = panelY + 92;
  const elements: UiElement[] = [
    text(panelX + 26, panelY + 20, 420, 40, containerTitle, { fontSize: 28, color: '#ffffff' }),
    button(panelX + panelW - 68, panelY + 20, 42, 42, 'X', () => {
      containerOpen = false;
      openedContainer = null;
      showHud();
    }, { background: 'rgba(30,38,46,0.95)', border: 'rgba(180,215,235,0.35)', radius: 8 }),
    text(gridX, gridY - 28, gridW, 24, isFurnace ? '材料 / 燃料 / 产物' : '点击取出；空槽可放入当前快捷栏物品', {
      fontSize: 13,
      color: 'rgba(200,220,235,0.7)',
    }),
    ...(isFurnace
      ? [
          text(panelX + 26, panelY + 62, panelW - 52, 24, `熔炼进度 ${Math.round((openedContainer as Furnace).cookRatio * 100)}%`, {
            fontSize: 14,
            color: '#9fe0ff',
          }),
        ]
      : []),
  ];
  for (let i = 0; i < slots; i++) {
    const stack = openedContainer.get(i);
    elements.push(slot(gridX + (i % cols) * (slotSize + gap), gridY + Math.floor(i / cols) * (slotSize + gap), slotSize, 400 + i, stack?.id ?? 0, stack?.count ?? 0, false, () => {
      const current = openedContainer?.get(i);
      if (current) {
        const remaining = inventory.add(current.id, current.count);
        openedContainer?.set(i, remaining > 0 ? { id: current.id, count: remaining } : null);
      } else {
        const held = inventory.get(selectedSlot);
        if (held) {
          openedContainer?.set(i, held);
          inventory.set(selectedSlot, null);
        }
      }
      showContainer();
    }));
  }
  const hotbarSize = 42;
  const hotbarGap = 5;
  const hotbarW = 9 * hotbarSize + 8 * hotbarGap;
  const hotbarX = panelX + (panelW - hotbarW) / 2;
  const hotbarY = gridY + (isFurnace ? 1 : 3) * (slotSize + gap) + 18;
  elements.push(text(hotbarX, hotbarY - 24, hotbarW, 20, '背包快捷栏 · 点击存入', {
    fontSize: 12,
    color: 'rgba(200,220,235,0.7)',
  }));
  for (let i = 0; i < 9; i++) {
    const stack = inventory.get(i);
    elements.push(slot(hotbarX + i * (hotbarSize + hotbarGap), hotbarY, hotbarSize, 500 + i, stack?.id ?? 0, stack?.count ?? 0, false, () => {
      const held = inventory.get(i);
      if (!held) return;
      for (let j = 0; j < slots; j++) {
        if (openedContainer?.get(j)) continue;
        openedContainer?.set(j, held);
        inventory.set(i, null);
        break;
      }
      showContainer();
    }));
  }

  ui.setRoot(box(0, 0, 1024, uiHeight, [
    box(0, 0, 1024, uiHeight, [], { background: 'rgba(0,0,0,0.55)' }),
    box(panelX, panelY, panelW, panelH, elements, {
      background: 'rgba(16,22,28,0.97)',
      border: 'rgba(170,205,230,0.45)',
      borderWidth: 2,
      radius: 12,
    }),
  ]));
};

const openContainerAt = (hit: RayHit): boolean => {
  lastAction = 'probe-open';
  const id = world.getBlock(hit.x, hit.y, hit.z);
  if (id === Block.CHEST) {
    openedContainer = world.containers.getOrCreateChest('overworld', hit.x, hit.y, hit.z);
    containerTitle = '箱子';
  } else if (id === Block.FURNACE) {
    openedContainer = world.containers.getOrCreateFurnace('overworld', hit.x, hit.y, hit.z);
    containerTitle = '熔炉';
  } else {
    return false;
  }
  lastAction = 'open-container';
  showContainer();
  return true;
};

const pushChat = (line: string): void => {
  chatMessages.push(line);
  if (chatMessages.length > 9) chatMessages.splice(0, chatMessages.length - 9);
};

const sendChat = (value: string): void => {
  const text = value.trim();
  if (!text) return;
  const [command, ...args] = text.split(/\s+/);
  if (command === '/help') {
    pushChat('/help · /seed · /pos · /heal');
    pushChat('/gamemode survival|creative · /tp x y z');
    pushChat('聊天为 v2 本地日志，尚未接联机');
  } else if (command === '/seed') {
    pushChat(`种子 ${currentWorld?.seed ?? '-'}`);
  } else if (command === '/pos' || command === '/time') {
    pushChat(`坐标 ${physics.x.toFixed(1)}, ${physics.y.toFixed(1)}, ${physics.z.toFixed(1)}`);
  } else if (command === '/heal') {
    health = 20;
    food = 20;
    saturation = 5;
    pushChat('生命/饥饿已恢复');
  } else if (command === '/gamemode') {
    const mode = args[0] === 'creative' ? 'creative' : args[0] === 'survival' ? 'survival' : null;
    if (!mode) {
      pushChat('用法：/gamemode survival|creative');
    } else if (currentWorld) {
      currentWorld.gameMode = mode;
      registry.update(currentWorld.id, { gameMode: mode });
      pushChat(`游戏模式：${mode === 'creative' ? '创造' : '生存'}`);
    }
  } else if (command === '/tp') {
    const [x, y, z] = args.map(Number);
    if (![x, y, z].every((n) => Number.isFinite(n))) {
      pushChat('用法：/tp x y z');
    } else {
      physics.teleport(x!, y!, z!);
      fallPeakY = y!;
      pushChat(`已传送到 ${x}, ${y}, ${z}`);
    }
  } else {
    pushChat(`我：${text}`);
  }
  chatInput = '';
  showChat();
};

const showChat = (): void => {
  chatOpen = true;
  const panelW = 760;
  const panelH = Math.min(460, uiHeight - 32);
  const panelX = (1024 - panelW) / 2;
  const panelY = (uiHeight - panelH) / 2;
  const visible = chatMessages.slice(-8);
  const lines = visible.map((line, index) =>
    text(panelX + 28, panelY + 80 + index * 28, panelW - 56, 26, line, {
      fontSize: 17,
      color: index === visible.length - 1 ? '#ffffff' : 'rgba(220,235,245,0.78)',
    }),
  );
  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      box(0, 0, 1024, uiHeight, [], { background: 'rgba(0,0,0,0.55)' }),
      box(panelX, panelY, panelW, panelH, [
        text(panelX + 28, panelY + 20, 500, 40, '聊天', { fontSize: 30, color: '#ffffff' }),
        button(panelX + panelW - 70, panelY + 20, 42, 42, 'X', () => {
          chatOpen = false;
          showHud();
        }, { background: 'rgba(30,38,46,0.95)', border: 'rgba(180,215,235,0.35)', radius: 8 }),
        ...lines,
        button(panelX + 28, panelY + panelH - 68, panelW - 220, 44, chatInput || '点击输入聊天/命令', () => {
          const wxApi = (globalThis as unknown as { wx?: { showKeyboard?: (options: any) => void } }).wx;
          if (!wxApi?.showKeyboard) return;
          void askText(chatInput, 80).then((value) => {
            if (value !== null) {
              chatInput = value;
              showChat();
            }
          });
        }, { background: 'rgba(22,30,36,0.95)', border: 'rgba(180,215,235,0.35)', radius: 8 }),
        button(panelX + panelW - 176, panelY + panelH - 68, 148, 44, '发送', () => sendChat(chatInput), {
          background: 'rgba(60,110,90,0.96)',
          border: 'rgba(190,235,215,0.55)',
          radius: 8,
        }),
      ], {
        background: 'rgba(16,22,28,0.97)',
        border: 'rgba(170,205,230,0.45)',
        borderWidth: 2,
        radius: 12,
      }),
    ]),
  );
};

const showHud = (): void => {
  menuScreen = 'title';
  const stickLeft = settings.leftHanded ? 1024 - 24 - 120 : 24;
  const jumpLeft = settings.leftHanded ? 24 : 1024 - 16 - 92;
  const stickTop = uiHeight - 216;
  const jumpTop = uiHeight - 200;
  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      ...(Date.now() < damageFlashUntil
        ? [box(0, 0, 1024, uiHeight, [], { background: 'rgba(200, 20, 20, 0.22)' })]
        : []),
      text(24, 18, 240, 36, `${currentWorld?.name ?? '世界'}`, { fontSize: 19, color: '#ffffff' }),
      ...(settings.showDebug
        ? [
            text(24, 58, 380, 24, `FPS ${fps.toFixed(0)} · 区块 ${chunks.drawnCount}/${world.chunks.size} · ${physics.x.toFixed(0)},${physics.y.toFixed(0)},${physics.z.toFixed(0)}`, {
              fontSize: 12,
              color: 'rgba(220,240,250,0.8)',
            }),
          ]
        : []),
      icon(464, 18, 36, 'chat', () => showChat(), { background: 'rgba(12,16,20,0.82)', border: 'rgba(255,255,255,0.72)', borderWidth: 2 }),
      icon(512, 18, 36, 'pause', () => {
        paused = true;
        showPause();
      }, { background: 'rgba(12,16,20,0.82)', border: 'rgba(255,255,255,0.72)', borderWidth: 2 }),
      icon(560, 18, 36, 'view', () => {
        cameraMode = cameraMode === 'first' ? 'third' : 'first';
        settings.view = cameraMode;
        persistSettings();
        playerModel.visible = cameraMode === 'third';
        showHud();
      }, { background: 'rgba(12,16,20,0.82)', border: 'rgba(255,255,255,0.72)', borderWidth: 2 }),
      box(242, uiHeight - 98, 420, 5, [], { background: 'rgba(0,0,0,0.55)', radius: 2 }),
      box(242, uiHeight - 98, Math.max(0, Math.min(420, 420 * (xpIntoLevel / (7 * (xpLevel + 1))))), 5, [], { background: '#7bd88f', radius: 2 }),
      text(668, uiHeight - 110, 90, 20, `Lv ${xpLevel}`, { fontSize: 11, color: 'rgba(210,255,210,0.9)' }),
      vital(242, uiHeight - 152, 16, 'heart', health),
      vital(612, uiHeight - 152, 16, 'food', food),
      text(0, uiHeight - 128, 1024, 20, inventory.get(selectedSlot) ? itemLabel(inventory.get(selectedSlot)!.id) : '空手', {
        fontSize: 14,
        color: 'rgba(255,255,255,0.92)',
        align: 'center',
      }),
      ...Array.from({ length: 9 }, (_, i) => {
        const stack = inventory.get(i);
        return slot(242 + i * 60, uiHeight - 76, 54, i, stack?.id ?? 0, stack?.count ?? 0, i === selectedSlot, () => {
          if (Date.now() < hudInputBlockUntil) return;
          selectedSlot = i;
          showHud();
        });
      }),
      button(792, uiHeight - 76, 46, 54, '包', () => {
        inventoryOpen = true;
        showInventory();
      }, { background: 'rgba(12,16,20,0.82)', border: 'rgba(255,255,255,0.72)', borderWidth: 2, radius: 8, fontSize: 16 }),
      box(stickLeft, stickTop, 120, 120, [], {
        background: 'rgba(12,16,20,0.52)',
        border: 'rgba(255,255,255,0.62)',
        borderWidth: 2,
        radius: 60,
      }),
      (() => {
        const knob = box(stickLeft + 36 + stickOffsetX, stickTop + 36 + stickOffsetY, 48, 48, [], {
          background: sneaking ? 'rgba(120,190,120,0.55)' : 'rgba(245,247,250,0.35)',
          border: 'rgba(255,255,255,0.75)',
          borderWidth: 1,
          radius: 24,
        });
        hudStickKnob = knob;
        return knob;
      })(),
      button(jumpLeft, jumpTop, 92, 92, '跳', () => {
        jumpQueued = true;
      }, {
        background: 'rgba(40,72,34,0.86)',
        border: 'rgba(198,240,185,0.8)',
        borderWidth: 2,
        radius: 46,
        fontSize: 26,
      }),
      (() => {
        const node = ring(0, 0, 96, false);
        hudAimRing = node;
        return node;
      })(),
      ...(!settings.fingerAim
        ? [
            box(510, uiHeight / 2 - 10, 4, 20, [], { background: 'rgba(255,255,255,0.85)' }),
            box(502, uiHeight / 2 - 2, 20, 4, [], { background: 'rgba(255,255,255,0.85)' }),
          ]
        : []),
    ]),
  );
};

const applyDamage = (amount: number, cause: string): void => {
  if (amount <= 0 || dead) return;
  health = Math.max(0, health - amount);
  lastDamageCause = cause;
  damageFlashUntil = Date.now() + 260;
  showHud();
  setTimeout(() => {
    if (Date.now() >= damageFlashUntil && started && !dead) showHud();
  }, 280);
};

const respawn = (): void => {
  health = 20;
  food = 20;
  saturation = 5;
  foodExhaustion = 0;
  starvationTimer = 0;
  fallPeakY = spawn.y + 1;
  wasOnGround = false;
  landedOnce = false;
  dead = false;
  lastDamageCause = '';
  damageFlashUntil = 0;
  paused = false;
  physics.teleport(spawn.x + 0.5, spawn.y + 1.01, spawn.z + 0.5);
  showHud();
};

const showDeath = (): void => {
  const panelW = 480;
  const panelH = 300;
  const panelX = (1024 - panelW) / 2;
  const panelY = (uiHeight - panelH) / 2;
  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      box(0, 0, 1024, uiHeight, [], { background: 'rgba(0, 0, 0, 0.72)' }),
      box(panelX, panelY, panelW, panelH, [], {
        background: 'rgba(24, 14, 14, 0.96)',
        border: 'rgba(220, 120, 120, 0.55)',
        borderWidth: 2,
        radius: 12,
      }),
      text(panelX, panelY + 34, panelW, 54, '你死了！', { fontSize: 38, color: '#ffffff', align: 'center' }),
      text(panelX + 30, panelY + 108, panelW - 60, 60, lastDamageCause ? `死因：${lastDamageCause}` : '生命归零，回到出生点会恢复生命与饥饿。', {
        fontSize: 15,
        color: 'rgba(240, 210, 210, 0.8)',
        align: 'center',
      }),
      button(panelX + 110, panelY + 210, 260, 50, '重生', () => respawn(), {
        background: 'rgba(90, 60, 60, 0.96)',
        border: 'rgba(240, 180, 180, 0.55)',
        radius: 8,
      }),
    ]),
  );
};

const showPause = (): void => {
  const panelX = (1024 - 480) / 2;
  const panelY = Math.max(40, uiHeight / 2 - 150);
  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      box(0, 0, 1024, uiHeight, [], { background: 'rgba(0, 0, 0, 0.55)' }),
      box(panelX, panelY, 480, 340, [], {
        background: 'rgba(16, 22, 28, 0.96)',
        border: 'rgba(170, 205, 230, 0.45)',
        borderWidth: 2,
        radius: 12,
      }),
      text(panelX, panelY + 28, 480, 44, '暂停', { fontSize: 34, color: '#ffffff', align: 'center' }),
      text(panelX, panelY + 88, 480, 32, 'v2 最小 UI Kit 切片', {
        fontSize: 16,
        color: 'rgba(220,235,245,0.75)',
        align: 'center',
      }),
      button(panelX + 40, panelY + 190, 180, 52, '继续游戏', () => {
        paused = false;
        showHud();
      }, {
        background: 'rgba(52, 64, 74, 0.96)',
        border: 'rgba(190, 220, 240, 0.45)',
        radius: 8,
      }),
      button(panelX + 240, panelY + 190, 190, 52, '设置', () => {
        showSettings();
      }, {
        background: 'rgba(32, 42, 50, 0.95)',
        border: 'rgba(190, 220, 240, 0.4)',
        radius: 8,
      }),
      button(panelX + 90, panelY + 258, 300, 42, '保存并返回菜单', () => {
        void (async () => {
          await persistWorld();
          started = false;
          paused = false;
          showWorlds();
        })();
      }, {
        background: 'rgba(32, 42, 50, 0.95)',
        border: 'rgba(190, 220, 240, 0.4)',
        radius: 8,
      }),
    ]),
  );
};

showTitle();

const atlas = new TextureAtlas();
const solid = new VoxelMaterial(atlas.texture, {
  tileSpan: atlas.tileSpan,
  tileInset: atlas.tileInset,
});
const translucent = new VoxelMaterial(atlas.texture, {
  translucent: true,
  tileSpan: atlas.tileSpan,
  tileInset: atlas.tileInset,
});

solid.skyBrightness = settings.brightness;
translucent.skyBrightness = settings.brightness;

let world = new World(0x5eed, 'default', 1);
let chunks = new ChunkRenderer(
  scene,
  atlas,
  world,
  solid.material,
  translucent.material,
  null,
);

world.events = {
  onChunkLoaded: (chunk) => chunks.onChunkLoaded(chunk.cx, chunk.cz),
  onChunkUnloaded: (cx, cz) => chunks.onChunkUnloaded(cx, cz),
  onBlockChanged: (x, _y, z) => chunks.enqueueAround(x, z),
};

const physics = new PlayerPhysics();
const input: PlayerInput = {
  forward: 0,
  strafe: 0,
  jump: false,
  sneak: false,
  sprint: false,
};
let yaw = 0;
let pitch = 0;
let playerReady = false;
let jumpQueued = false;
let sneaking = false;
let health = 20;
let food = 20;
let saturation = 5;
let foodExhaustion = 0;
let fallPeakY = 80;
let wasOnGround = false;
let landedOnce = false;
let starvationTimer = 0;
let dead = false;
let lastDamageCause = '';
let damageFlashUntil = 0;
let xpLevel = 0;
let xpIntoLevel = 0;
let lastStickTap = 0;
let stickOffsetX = 0;
let stickOffsetY = 0;
let hudStickKnob: { x: number; y: number; w: number; h: number } | null = null;
let hudAimRing: UiRingNode | null = null;
let stickLeftCached = 24;
let stickTopCached = uiHeight - 216;
let movePointer: number | null = null;
let lookPointer: number | null = null;
let moveX = 0;
let moveY = 0;
let lookX = 0;
let lookY = 0;
let lookMoved = false;
let lookStartTime = 0;
let currentHit: RayHit | null = null;
const aimRaycaster = new THREE.Raycaster();
let lastDownAt = 0;
let lastDownX = 0;
let lastDownY = 0;

const updateHitAt = (clientX: number, clientY: number): void => {
  const screenX = settings.fingerAim ? clientX : platform.system.width / 2;
  const screenY = settings.fingerAim ? clientY : platform.system.height / 2;
  camera.updateMatrixWorld();
  aimRaycaster.setFromCamera(
    new THREE.Vector2(
      (screenX / Math.max(1, platform.system.width)) * 2 - 1,
      -(screenY / Math.max(1, platform.system.height)) * 2 + 1,
    ),
    camera,
  );
  const direction = aimRaycaster.ray.direction;
  currentHit = raycastVoxels(
    (x, y, z) => world.isSelectable(x, y, z),
    physics.x,
    physics.eyeY,
    physics.z,
    direction.x,
    direction.y,
    direction.z,
    8,
  );
  if (currentHit) {
    outline.visible = true;
    outline.position.set(currentHit.x + 0.5, currentHit.y + 0.5, currentHit.z + 0.5);
  } else {
    outline.visible = false;
  }
};

const gainXp = (amount: number): void => {
  xpIntoLevel += amount;
  for (;;) {
    const need = 7 * (xpLevel + 1);
    if (xpIntoLevel < need) break;
    xpIntoLevel -= need;
    xpLevel += 1;
  }
  showHud();
};

const breakAt = (hit: RayHit): void => {
  lastAction = 'break';
  world.setBlockAndUpdate(hit.x, hit.y, hit.z, Block.AIR);
  audio.play('break_stone', { x: hit.x, y: hit.y, z: hit.z });
  gainXp(1);
  requestSave();
};

const placeAt = (hit: RayHit): void => {
  lastAction = 'place';
  if (openContainerAt(hit)) return;
  const stack = inventory.get(selectedSlot);
  if (!stack) return;
  const foodInfo = foodInfoById(stack.id);
  if (foodInfo) {
    if (!canEat(foodInfo, food, 20)) return;
    food = Math.min(20, food + foodInfo.hunger);
    saturation = Math.min(food, saturation + saturationFrom(foodInfo));
    stack.count -= 1;
    inventory.set(selectedSlot, stack.count > 0 ? stack : null);
    audio.play('eat');
    showHud();
    return;
  }
  const x = hit.x + hit.nx;
  const y = hit.y + hit.ny;
  const z = hit.z + hit.nz;
  if (world.getBlock(x, y, z) !== Block.AIR || blockDef(stack.id).id === 0) {
    lastAction = 'place-blocked';
    return;
  }
  if (!world.setBlockAndUpdate(x, y, z, stack.id)) return;
  stack.count -= 1;
  lastAction = 'placed';
  inventory.set(selectedSlot, stack.count > 0 ? stack : null);
  audio.play('place', { x, y, z });
  requestSave();
  showHud();
};

const updateAimRing = (clientX: number, clientY: number, visible: boolean): void => {
  if (!hudAimRing) return;
  hudAimRing.visible = visible;
  if (visible) {
    const designX = (clientX / Math.max(1, platform.system.width)) * 1024;
    const designY = (clientY / Math.max(1, platform.system.height)) * uiHeight;
    hudAimRing.x = designX - 48;
    hudAimRing.y = designY - 48;
  }
  ui.refresh();
};

platform.input.onPointer('down', (event) => {
  if (!audioResumed) {
    audioResumed = true;
    audio.resume();
  }
  const now = Date.now();
  if (now - lastDownAt < 40 && Math.abs(event.clientX - lastDownX) < 8 && Math.abs(event.clientY - lastDownY) < 8) {
    return;
  }
  lastDownAt = now;
  lastDownX = event.clientX;
  lastDownY = event.clientY;
  if (ui.handlePointer('down', event.clientX, event.clientY, platform.system.width, platform.system.height)) return;
  if (!started || paused || settingsOpen || inventoryOpen || chatOpen || containerOpen) return;
  const designX = (event.clientX / Math.max(1, platform.system.width)) * 1024;
  const designY = (event.clientY / Math.max(1, platform.system.height)) * uiHeight;
  const stickLeft = settings.leftHanded ? 1024 - 24 - 120 : 24;
  const stickTop = uiHeight - 216;
  const inStick = designX >= stickLeft && designX <= stickLeft + 120 && designY >= stickTop && designY <= stickTop + 120;
  if (inStick) {
    stickLeftCached = stickLeft;
    stickTopCached = stickTop;
    movePointer = event.pointerId;
    moveX = ((stickLeft + 60) / 1024) * platform.system.width;
    moveY = ((stickTop + 60) / uiHeight) * platform.system.height;
    const nowTap = Date.now();
    if (nowTap - lastStickTap < 320) {
      sneaking = !sneaking;
      input.sneak = sneaking;
      lastStickTap = 0;
      showHud();
    } else {
      lastStickTap = nowTap;
    }
  } else if (lookPointer === null) {
    lookPointer = event.pointerId;
    lookX = event.clientX;
    lookY = event.clientY;
    lookMoved = false;
    lookStartTime = Date.now();
    updateAimRing(event.clientX, event.clientY, true);
    updateAimRing(event.clientX, event.clientY, true);
    updateHitAt(event.clientX, event.clientY);
  }
});

platform.input.onPointer('move', (event) => {
  if (ui.handlePointer('move', event.clientX, event.clientY, platform.system.width, platform.system.height)) return;
  if (event.pointerId === movePointer) {
    input.strafe = Math.max(-1, Math.min(1, (event.clientX - moveX) / 56));
    input.forward = Math.max(-1, Math.min(1, -(event.clientY - moveY) / 56));
    if (Math.hypot(event.clientX - moveX, event.clientY - moveY) < 8) {
      input.strafe = 0;
      input.forward = 0;
    }
    const rawX = ((event.clientX - moveX) / Math.max(1, platform.system.width)) * 1024;
    const rawY = ((event.clientY - moveY) / Math.max(1, platform.system.height)) * uiHeight;
    const length = Math.hypot(rawX, rawY);
    const scale = length > 34 ? 34 / length : 1;
    stickOffsetX = rawX * scale;
    stickOffsetY = rawY * scale;
    if (hudStickKnob) {
      hudStickKnob.x = ((stickLeftCached + 36 + stickOffsetX));
      hudStickKnob.y = ((stickTopCached + 36 + stickOffsetY));
      ui.refresh();
    }
  } else if (event.pointerId === lookPointer) {
    if (Math.hypot(event.clientX - lookX, event.clientY - lookY) > 8) lookMoved = true;
    yaw -= (event.clientX - lookX) * 0.005 * settings.sensitivity;
    const pitchDelta = (event.clientY - lookY) * 0.005 * settings.sensitivity * (settings.invertY ? -1 : 1);
    pitch = Math.max(-1.2, Math.min(1.2, pitch - pitchDelta));
    lookX = event.clientX;
    lookY = event.clientY;
    updateAimRing(event.clientX, event.clientY, true);
    updateHitAt(event.clientX, event.clientY);
  }
});

const release = (event: { pointerId: number; clientX: number; clientY: number }): void => {
  ui.handlePointer('up', event.clientX, event.clientY, platform.system.width, platform.system.height);
  if (event.pointerId === movePointer) {
    movePointer = null;
    input.forward = 0;
    input.strafe = 0;
    stickOffsetX = 0;
    stickOffsetY = 0;
    if (hudStickKnob) {
      hudStickKnob.x = stickLeftCached + 36;
      hudStickKnob.y = stickTopCached + 36;
      ui.refresh();
    }
  }
  if (event.pointerId === lookPointer) {
    if (!lookMoved && currentHit) {
      if (Date.now() - lookStartTime >= 350) breakAt(currentHit);
      else placeAt(currentHit);
    }
    lookPointer = null;
  }
};
platform.input.onPointer('up', release);
platform.input.onPointer('cancel', release);

camera.fov = settings.fov;
camera.updateProjectionMatrix();
camera.rotation.order = 'YXZ';

let lastTime = performance.now();
let fps = 0;
let fpsFrames = 0;
let fpsStartedAt = performance.now();
let lastDebugHud = 0;
let lastFurnaceUi = 0;
let lastAutoSave = 0;

const frame = (): void => {
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  fpsFrames += 1;
  if (now - fpsStartedAt >= 1000) {
    fps = (fpsFrames * 1000) / (now - fpsStartedAt);
    fpsFrames = 0;
    fpsStartedAt = now;
  }

  const screen = !started
    ? settingsOpen
      ? 'settings'
      : menuScreen
    : settingsOpen
      ? 'settings'
      : inventoryOpen
        ? 'inventory'
        : paused
          ? 'pause'
          : 'game';
  console.log(
    '[V2]',
    JSON.stringify({
      screen,
      started,
      worldCount: registry.count,
      currentWorldId: currentWorld?.id ?? '',
      currentWorldName: currentWorld?.name ?? '',
      gameMode: currentWorld?.gameMode ?? 'survival',
      chunks: world.chunks.size,
      drawn: chunks.drawnCount,
      x: physics.x,
      y: physics.y,
      z: physics.z,
      selectedSlot,
      inventory: Array.from({ length: 9 }, (_, i) => inventory.get(i)?.id ?? 0),
      paused,
      settings: settingsOpen,
      inventoryOpen,
      chatOpen,
      containerOpen,
      containerSlots: openedContainer
        ? Array.from(
            { length: openedContainer instanceof Chest ? 27 : 3 },
            (_, index) => openedContainer?.get(index)?.id ?? 0,
          )
        : [],
      lastAction,
      target: currentHit ? `${world.getBlock(currentHit.x, currentHit.y, currentHit.z)}@${currentHit.x},${currentHit.y},${currentHit.z}` : '',
      held: inventory.get(selectedSlot)?.id ?? 0,
      cameraMode,
      dead,
      xpLevel,
      health,
      food,
      saturation,
      sneaking,
    }),
  );

  if (started && openedContainer instanceof Furnace) {
    openedContainer.tick(dt);
    if (containerOpen && now - lastFurnaceUi > 500) {
      lastFurnaceUi = now;
      showContainer();
    }
  }

  if (!started) {
    renderer.clear();
    ui.render(renderer);
    requestAnimationFrame(frame);
    return;
  }

  const centerCx = Math.floor(physics.x / 16);
  const centerCz = Math.floor(physics.z / 16);
  world.update(centerCx, centerCz, settings.viewDistance);

  if (!playerReady && world.isLoaded(spawn.x, spawn.z)) {
    const surface = world.getSurfaceBlockY(spawn.x, spawn.z);
    if (surface !== null) {
      physics.teleport(spawn.x + 0.5, surface + 1.01, spawn.z + 0.5);
      playerReady = true;
    }
  }

  if (jumpQueued) {
    input.jump = true;
    jumpQueued = false;
  }
  if (playerReady && !paused && !settingsOpen && !inventoryOpen && !chatOpen && !containerOpen) {
    physics.update(world as unknown as PhysicsWorld, input, yaw, dt, false, 1, 1, settings.autoJump);
    playerModel.position.set(physics.x, physics.y, physics.z);
    playerModel.rotation.y = yaw;
    if (cameraMode === 'third') {
      const cosPitch = Math.cos(pitch);
      const fx = -Math.sin(yaw) * cosPitch;
      const fy = Math.sin(pitch);
      const fz = -Math.cos(yaw) * cosPitch;
      camera.position.set(physics.x - fx * 3.2, physics.eyeY - fy * 3.2 + 0.35, physics.z - fz * 3.2);
    } else {
      camera.position.set(physics.x, physics.eyeY, physics.z);
    }
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }
  input.jump = false;

  if (playerReady && !paused && !settingsOpen && !inventoryOpen && !chatOpen && !containerOpen) {
    if (!physics.onGround) {
      fallPeakY = Math.max(fallPeakY, physics.y);
    } else {
      if (!wasOnGround && landedOnce) {
        const drop = fallPeakY - physics.y;
        if (drop > 3) {
          applyDamage(Math.floor(drop - 3), '摔落');
        }
      }
      if (!landedOnce) landedOnce = true;
      fallPeakY = physics.y;
    }
    wasOnGround = physics.onGround;

    const moving = Math.abs(input.forward) + Math.abs(input.strafe) > 0.1;
    foodExhaustion += dt * (moving ? 0.03 : 0.005);
    if (foodExhaustion >= 4) {
      foodExhaustion -= 4;
      if (food > 0) {
        food -= 1;
        showHud();
      }
    }
    if (food <= 0) {
      starvationTimer += dt;
      if (starvationTimer >= 1) {
        starvationTimer = 0;
        applyDamage(1, '饥饿');
      }
    } else {
      starvationTimer = 0;
    }
    if (health <= 0 && !dead) {
      dead = true;
      paused = true;
      showDeath();
    }
  }

  chunks.processQueue(4, centerCx, centerCz);
  chunks.applyViewDistance(centerCx, centerCz, settings.viewDistance);
  solid.setTime(now * 0.001);
  translucent.setTime(now * 0.001);
  renderer.clear();
  renderer.render(scene, camera);
  if (started && save && !paused && now - lastAutoSave > 15000) {
    lastAutoSave = now;
    void persistWorld();
  }
  ui.render(renderer);
  if (settings.showDebug && started && !paused && !settingsOpen && !inventoryOpen && !chatOpen && !containerOpen && now - lastDebugHud > 1000) {
    lastDebugHud = now;
    showHud();
  }
  requestAnimationFrame(frame);
};



const wxTestApi = (globalThis as unknown as { wx?: { __v2Test?: unknown } }).wx;
if (wxTestApi) {
  wxTestApi.__v2Test = {
    clearInventory: () => {
      for (let i = 0; i < 36; i++) inventory.set(i, null);
      selectedSlot = 0;
      showHud();
    },
    setHealth: (value = 0) => {
      health = value;
      return { health };
    },
    giveItem: (id = 1, count = 2) => {
      inventory.add(id, count);
      showHud();
      return { id, count };
    },
    fillChestFirst: (id = 1, count = 2) => {
      openedContainer?.set(0, { id, count });
      showContainer();
      return { id, count };
    },
    smeltFurnace: () => {
      if (!(openedContainer instanceof Furnace)) return { error: 'not-furnace' };
      openedContainer.set(0, { id: Item.RAW_IRON, count: 1 });
      openedContainer.set(1, { id: Item.COAL, count: 1 });
      openedContainer.tick(20);
      showContainer();
      return { output: openedContainer.get(2)?.id ?? 0 };
    },
    openFurnaceAtFeet: () => {
      const x = Math.floor(physics.x);
      const y = Math.max(0, Math.floor(physics.y) - 1);
      const z = Math.floor(physics.z);
      world.setBlockAndUpdate(x, y, z, Block.FURNACE);
      openedContainer = world.containers.getOrCreateFurnace('overworld', x, y, z);
      containerTitle = '熔炉';
      showContainer();
      return { x, y, z };
    },
    openChestAtFeet: () => {
      const x = Math.floor(physics.x);
      const y = Math.max(0, Math.floor(physics.y) - 1);
      const z = Math.floor(physics.z);
      world.setBlockAndUpdate(x, y, z, Block.CHEST);
      openedContainer = world.containers.getOrCreateChest('overworld', x, y, z);
      containerTitle = '箱子';
      showContainer();
      return { x, y, z };
    },
  };
}
requestAnimationFrame(frame);
