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
import { Sky } from '../render/Sky.ts';
import { Weather } from '../render/Weather.ts';
import type { MeshWorkerPool } from '../render/MeshWorkerPool.ts';
import { WxMeshWorkerPool } from './wx-mesh-pool.ts';
import { SaveController } from './save-controller.ts';
import { MobSystem } from './mobs.ts';
import { ChatSystem } from './chat.ts';
import { ContainerSystem } from './containers.ts';
import { drawBlockIcon } from './block-icon.ts';
import { QualityManager } from './quality.ts';
import { readSettings, saveSettings } from './settings.ts';
import type { V2CreativeCategory } from './inventory-catalog.ts';
import { fillRecipe as fillRecipeFromInventory } from './recipe-book.ts';
import {
  buildArmorColumn,
  buildCraftingPanel,
  buildCreativeTab,
  buildHotbarDock,
  buildPanelHeader,
  buildRail,
  buildRecipeTab,
  RAIL_CATEGORIES,
} from './inventory-tabs.ts';
import { InventoryCursor } from './inventory-state.ts';
import {
  canPlaceItem,
  reclaimHeld,
  slotResolver,
  type SlotBinding,
  type SlotKind,
} from './inventory-click.ts';
import { PlayerPhysics, type PlayerInput, type PhysicsWorld } from '../core/physics/PlayerPhysics.ts';
import { VoxelMaterial } from '../render/VoxelMaterial.ts';
import { createMainThreadWorker } from '../platform/wx/main-thread-worker.ts';
import { MC, UiLayer, box, button, icon, ring, slider, slot, text, toggle, vital, type SlotButton, type UiElement, type UiRingNode } from './ui-kit/index.ts';
import { Inventory, ARMOR_START, TOTAL_SLOTS, sameStack, stackExtras, type SlotSource } from '../core/container/Inventory.ts';
import { restoreContainers } from '../core/save/ContainerSave.ts';
import { CraftingGrid } from '../core/crafting/CraftingGrid.ts';
import type { ShapedRecipe, ShapelessRecipe } from '../core/crafting/Recipes.ts';
import { CREATIVE_ITEMS, categoryOf, foodInfoById, maxStackOf, saturationFrom } from '../core/registry/items.ts';
import { canEat } from '../core/registry/food.ts';
import { itemLabel } from '../core/registry/itemNames.ts';
import { BED_IDS, Block, blockDef } from '../core/registry/blocks.ts';
import { sleepRefusal } from '../core/survival/Sleep.ts';
import { isDoorOpen, isDoorUpper, withDoorOpen } from '../core/registry/blockState.ts';
import { raycastVoxels, type RayHit } from '../core/interaction/Raycast.ts';
import { wxPlatform } from '../platform/wx/index.ts';
import { AudioEngine } from '../core/audio/AudioEngine.ts';
import { WorldRegistry, type WorldSummary } from '../core/save/WorldRegistry.ts';
import type { PlayerSave } from '../core/save/SaveGame.ts';
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
renderer.setPixelRatio(Math.min(platform.system.dpr, 1.5));
renderer.setSize(platform.system.width, platform.system.height, false);
renderer.autoClear = false;
renderer.setClearColor(0x0b141c, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b9e8);
const sky = new Sky();
scene.add(sky.object);
const weather = new Weather();
scene.add(weather.object);
let worldTime = 0.25;
const camera = new THREE.PerspectiveCamera(
  72,
  platform.system.width / Math.max(1, platform.system.height),
  0.1,
  320,
);

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

const ui = new UiLayer(platform.system.width, platform.system.height, (ctx, id, x, y, size) => drawBlockIcon(atlas, ctx, id, x, y, size));
const uiHeight = ui.height;
let started = false;
let meshBackend: 'worker' | 'main' = 'main';
let workerFallbackAt = 0;
let menuScreen: 'title' | 'worlds' | 'create' | 'edit' = 'title';
let paused = false;
let settingsOpen = false;
let lastAction = '';
let inventoryOpen = false;
let inventoryTab: 'items' | 'creative' | 'recipes' = 'items';
/**
 * 物品栏模式下"右半边显示什么"（对齐 Web 版 `data-pocket-tab`）：
 *  - `crafting` = 2×2 合成（默认）
 *  - `armor`    = 盔甲 4 格竖排 + 副手
 * 左轨选分类会切到 `creative`，右轨两颗键在这两者间切。
 */
let panelMode: 'crafting' | 'armor' = 'crafting';
/** 背包面板的几何（验收脚本读它来点轨道上的小图标，避免猜像素） */
let inventoryGeo: {
  panelX: number;
  panelY: number;
  panelW: number;
  panelH: number;
  leftRailX: number;
  rightRailX: number;
  railTopY: number;
  contentX: number;
  contentY: number;
  slotSize: number;
} | null = null;
let recipePage = 0;
let recipeSize: 2 | 3 = 2;
let recipeQuery = '';
let creativeQuery = '';
let inventoryHint = '';
let selectedSlot = 0;
let hudInputBlockUntil = 0;
const inventory = new Inventory();
const cursor = new InventoryCursor();
let crafting = new CraftingGrid(2);
let craftingTableOpen = false;
const creativeItems = CREATIVE_ITEMS;
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
let spawn = { x: 0, z: 0, y: 80 };
const respawnKey = (): string => `wx.v2.respawn.${currentWorld?.id ?? 'none'}`;

const loadSleepSpawn = (): void => {
  try {
    const raw = platform.storage.get(respawnKey());
    if (!raw) return;
    const value = JSON.parse(raw) as { x?: number; y?: number; z?: number };
    if ([value.x, value.y, value.z].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      spawn = { x: value.x!, y: value.y!, z: value.z! };
    }
  } catch {
    // 损坏的重生点忽略
  }
};

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

let cameraMode: 'first' | 'third' = 'first';
let quality: QualityManager;
let currentFov = 72;
const settings = readSettings(platform.storage);
cameraMode = settings.view;
playerModel.visible = cameraMode === 'third';
applyPlayerAppearance();
const audio = new AudioEngine();
audio.volume = settings.sound ? settings.volume : 0;
audio.enabled = settings.sound;
let audioResumed = false;
const persistSettings = (): void => saveSettings(platform.storage, settings);

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
    row(button(panelX + 24, rowY, panelW - 48, 50, `画质：${settings.quality === 'auto' ? '自动' : settings.quality === 'high' ? '高' : '性能'}`, () => {
      settings.quality = settings.quality === 'auto' ? 'high' : settings.quality === 'high' ? 'low' : 'auto';
      quality.syncMode();
      apply();
    }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 8 }));
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

/** 一格里能查到身份的东西（背包 / 合成格 / 创造栏） */
const bindingFor = (kind: SlotKind, index: number): SlotBinding | null => {
  if (kind === 'inventory') {
    if (index < 0 || index >= TOTAL_SLOTS) return null;
    return {
      kind: 'inventory',
      index,
      source: inventory,
      // 护甲 36~39 与副手 40 是**单件槽**：护甲槽只吃对应部位（`canPlaceItem` 再判一次）
      singleItem: index >= ARMOR_START,
    };
  }
  if (kind === 'crafting') {
    if (index < 0 || index >= crafting.size * crafting.size) return null;
    return { kind: 'crafting', index, source: crafting };
  }
  if (kind === 'creative') {
    const id = creativeList()[index];
    if (id === undefined) return null;
    return { kind: 'creative', index, source: creativeSource, takeOnly: false };
  }
  return null;
};

/**
 * 创造栏的"格子数据源"：每格永远有货（`MAX_STACK` 个），**读得到、放不进去**。
 * 这样它既能被 `applyClick` 当成普通来源（点它 = 拿一组到手上），又不会被写脏。
 */
const creativeSource: SlotSource = {
  get: (index) => {
    const id = creativeList()[index];
    return id === undefined ? null : { id, count: 64 };
  },
  set: () => {
    /* 创造栏是"无限货架"：放下不落库，物品因此凭空消失——那正是创造模式要的 */
  },
};

/** 当前筛选/分页之后的创造栏列表（点击索引与渲染顺序必须一致，否则会拿走别的方块） */
let creativePageCache: readonly number[] = [];
const creativeList = (): readonly number[] => creativePageCache;

/** 由 `buildCreativeTab` 在渲染时回写，保证"看到的第 i 格"就是"拿到的第 i 格" */
const setCreativePage = (list: readonly number[]): void => {
  creativePageCache = list;
};

/**
 * 点产物槽：**产物先进光标**，再点背包放下（对齐 Web 版语义，远端 ca33f5d5 定的口径）。
 *
 * 三条拒绝要提前判：手上有别的东西 / 手上那叠已满 —— 否则产物会没地方去，
 * 而 `takeResult()` 一消耗材料就再也回不来了。
 */
const craftOutput = (): void => {
  const product = crafting.result;
  if (!product) return;
  const held = cursor.held;
  if (held && (held.id !== product.id || held.count + product.count > maxStackOf(product.id))) {
    inventoryHint = '手上有别的物品或已满，先放下';
    showInventory();
    return;
  }
  crafting.takeResult();
  cursor.restore({
    held: { id: product.id, count: (held?.count ?? 0) + product.count },
    fromCreative: false,
    origin: null,
  });
  inventoryHint = `合成完成：${itemLabel(product.id)} ×${product.count}`;
  syncGhost();
  showInventory();
};

/**
 * 点击一格的**唯一入口**：短按 = 左键、长按 = 右键，规则全在 `applyClick`。
 *
 * 这一层只做三件事：解析出绑定 → 结算 → 重画（含提示语与光标幽灵）。
 */
const clickSlot = (kind: SlotKind, index: number, button: SlotButton): void => {
  // 创造栏是"取货"不是"摆放"：点一下就照当前选中的快捷栏拿一组，不参与光标状态机
  if (kind === 'creative') {
    const id = creativeList()[index];
    if (id === undefined) return;
    const target = button === 'right' ? 1 : Math.min(maxStackOf(id), 64);
    cursor.restore({
      held: { id, count: target },
      fromCreative: true,
      origin: null,
    });
    inventoryHint = `拿起 ${itemLabel(id)} x${target}（创造）`;
    showInventory();
    return;
  }

  const binding = bindingFor(kind, index);
  if (!binding) return;
  const result = cursor.click(binding, button);
  if (result.hint) inventoryHint = result.hint;
  else if (result.changed) inventoryHint = '';
  syncGhost();
  showInventory();
};

/** 手上物品的幽灵图标跟着光标状态走（UI-004） */
const syncGhost = (): void => {
  const held = cursor.held;
  ui.setGhost(held?.id ?? 0, held?.count ?? 0);
};

/** 拖拽换格：只在**同类数据源**之间做，跨源（背包 ⇄ 合成格）各走各自的搬运规则 */
const dropSlot = (from: { kind: SlotKind; index: number }, to: { kind: SlotKind; index: number }): void => {
  if (from.kind === 'creative' || to.kind === 'creative') return;
  const source = bindingFor(from.kind, from.index);
  const target = bindingFor(to.kind, to.index);
  if (!source || !target) return;
  const stack = source.source.get(source.index);
  if (!stack) return;
  if (!canPlaceItem(target, stack.id)) {
    inventoryHint = target.takeOnly ? '产物槽只能取，不能放' : '这件物品不能放进这一格';
    showInventory();
    return;
  }
  const existing = target.source.get(target.index);
  if (!existing) {
    // 空目标：整叠搬过去（单件槽只吃 1 个，剩下的留在原处）
    const place = target.singleItem ? 1 : stack.count;
    target.source.set(target.index, { id: stack.id, count: place, ...stackExtras(stack) });
    source.source.set(source.index, stack.count > place ? { id: stack.id, count: stack.count - place, ...stackExtras(stack) } : null);
  } else if (sameStack(existing, stack)) {
    // 同类：补满目标，余数留在原处
    const limit = target.singleItem ? 1 : maxStackOf(stack.id);
    const room = limit - existing.count;
    const moved = Math.min(room, stack.count);
    if (moved > 0) {
      target.source.set(target.index, { ...existing, count: existing.count + moved });
      source.source.set(source.index, stack.count > moved ? { id: stack.id, count: stack.count - moved, ...stackExtras(stack) } : null);
    }
  } else {
    // 异类：交换（单件槽接受一件，对方那叠原样回到源格）
    const take = target.singleItem ? 1 : Math.min(maxStackOf(stack.id), stack.count);
    target.source.set(target.index, { id: stack.id, count: take, ...stackExtras(stack) });
    source.source.set(
      source.index,
      stack.count > take ? { id: stack.id, count: stack.count - take, ...stackExtras(stack) } : null,
    );
    if (existing) {
      // 交换出来的旧物品塞回源格；源格还占着就塞进背包（绝不丢失）
      if (source.source.get(source.index) === null) source.source.set(source.index, existing);
      else inventory.addStack(existing);
    }
  }
  inventoryHint = '';
  showInventory();
};

/**
 * 关闭背包：光标上的东西回背包（CLOSE-002）、合成格材料回背包（CLOSE-001）。
 *
 * 顺序不能反：先把光标处理掉再给合成格腾位置，否则"背包满了但合成格还占着料"
 * 会让材料无处可去。
 */
const closeInventory = (): void => {
  const reclaimed = reclaimHeld(cursor.snapshot(), inventory, slotResolver(bindingsOfInventory()));
  cursor.restore(reclaimed.state);
  crafting.drainTo(inventory);
  crafting = new CraftingGrid(2);
  craftingTableOpen = false;
  inventoryOpen = false;
  paused = false;
  ui.setGhost(0, 0);
  showHud();
};

/** 把当前面板里所有可点的格子列出来（关闭回收时用来"按 ref 找回来") */
const bindingsOfInventory = (): SlotBinding[] => {
  const list: SlotBinding[] = [];
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const binding = bindingFor('inventory', i);
    if (binding) list.push(binding);
  }
  for (let i = 0; i < crafting.size * crafting.size; i++) {
    const binding = bindingFor('crafting', i);
    if (binding) list.push(binding);
  }
  return list;
};

const fillRecipe = (recipe: ShapedRecipe | ShapelessRecipe): void => {
  const targetSize = craftingTableOpen ? 3 : recipeSize;
  if (crafting.size !== targetSize) {
    crafting.drainTo(inventory);
    crafting = new CraftingGrid(targetSize);
  }
  const result = fillRecipeFromInventory(recipe, targetSize, inventory, crafting);
  crafting = result.crafting;
  inventoryHint = result.hint;
  inventoryTab = 'items';
  showInventory();
};

/**
 * 背包面板 —— **按 Web 版（外部端）的结构重排**。
 *
 * 参照物：`.tmp/web-inventory-analysis.md` 里量出来的那套（真机截图 + DOM 量测）。
 * 关键差别（v2 之前 → 现在）：
 *
 *  1. 面板从"深蓝黑 + 圆角 + 白字"改成 **原版灰 `#c6c6c6` + 直角斜边 + 深灰字**；
 *  2. 左轨从"三个大文字按钮"改成 **5 颗配方分类图标 + 底部物品栏**（Web 版
 *     `RECIPE_BOOK_TABS_POCKET`）——分类一级直达，不再"先点创造再点分类"；
 *  3. 快捷栏从"塞在面板里"改成 **屏幕底部独立 dock**（Web 版 `inv-hotbar-dock`）；
 *  4. 护甲从"横排 4 格 + 副手另起一行"改成 **竖排一列**（`inv-grid.inv-armor`）；
 *  5. 标题从 30px "背包"大字改成 **一行小字 + 右侧两颗小键**（`inv-header`）。
 *
 * 布局同时支持"面板区"和"dock 区"两块 —— dock 不在面板里，所以两者分开生成。
 */
const showInventory = (): void => {
  inventoryOpen = true;

  // ---- 尺寸（对齐 Web 版口袋模式：格子 44、轨宽 40） ----
  //
  // ⚠️ 这里的 `uiHeight` 是**设计坐标的高**，横屏手机上是 1024×(屏高/屏宽) ≈ 2216，
  // 所以不能拿它跟 390 比。格子按 Web 的 44 起、按可用高度收：
  // 面板要给"3 行主背包 + 顶栏 + 提示"留够，同时右边还得放得下 2×2 合成。
  const gap = 2;
  const railW = 40;
  const pad = 12;
  const headerH = 24;
  const bodyPad = 8;
  const dockH = 48; // 底部快捷栏占掉的高度（面板不能盖住它）

  const slotSize = 44;
  const gridW = 9 * slotSize + 8 * gap; // 412
  // 物品栏页的右半边：2×2 合成（格子略小）+ 箭头 + 产物
  const craftSlot = Math.round(slotSize * 0.86); // 38
  const craftBlockW = 2 * craftSlot + 2 + 22 + craftSlot; // 2×2 + 箭头 + 产物 ≈ 136
  const wantsCraftColumn = inventoryTab === 'items' && panelMode === 'crafting';
  const contentW = wantsCraftColumn ? gridW + 16 + craftBlockW : gridW;

  const panelW = Math.min(1024 - 16, contentW + railW * 2 + pad * 2);
  const bodyH = 3 * slotSize + 2 * gap; // 3 行主背包
  // 面板高度：主背包 3 行 + 顶栏 + 底部提示；**左轨要放得下 5 颗分类 + 1 颗物品栏**
  // （5×36+4×2=188，再加上物品栏 36+2 → 226），所以下限取 226
  const railNeed = 6 * 36 + 5 * 2 + 16;
  /**
   * 面板高度 = 三件事里最高的那个：
   *  1. 左轨要放得下 5 颗分类 + 1 颗物品栏（`railNeed`）；
   *  2. 主背包 3 行 + 顶栏 + 底部提示；
   *  3. **创造/配方页**：顶部还有一条"搜索/整理"（+28），底部一条分页（+30），
   *     所以它比物品栏页高 —— 少了这 22 像素就会掉成 2 行（实测过）。
   */
  const gridNeed = inventoryTab === 'items'
    ? headerH + bodyPad * 2 + bodyH + 28
    : headerH + bodyPad * 2 + bodyH + 28 + 28 + 30;
  // 取"装着内容要多少"和"左轨要多少"的较大值，再夹到屏幕里
  const panelH = Math.min(uiHeight - dockH - 20, Math.max(railNeed, gridNeed));
  const panelX = (1024 - panelW) / 2;
  // 面板整体上移一点，给底部 dock 让位
  const panelY = Math.max(6, (uiHeight - dockH - panelH) / 2);

  const leftRailX = panelX;
  const rightRailX = panelX + panelW - railW;
  const contentX = leftRailX + railW + pad;
  const contentY = panelY + headerH + bodyPad;

  const tabHandlers = {
    onSlot: (kind: 'inventory' | 'crafting' | 'creative', index: number, button: SlotButton) =>
      clickSlot(kind, index, button),
    onSlotDrop: (
      from: { kind: 'inventory' | 'crafting' | 'creative'; index: number },
      to: { kind: 'inventory' | 'crafting' | 'creative'; index: number },
    ) => dropSlot(from, to),
  };

  inventoryGeo = {
    panelX,
    panelY,
    panelW,
    panelH,
    leftRailX,
    rightRailX,
    railTopY: panelY + headerH + bodyPad,
    contentX,
    contentY,
    slotSize,
  };

  // ---- 外壳：面板本体（灰底 + 像素斜角 + 直角） ----
  const elements: UiElement[] = [];

  // ---- 顶栏 ----
  const titleText =
    inventoryTab === 'creative'
      ? `创造 · ${RAIL_CATEGORIES.find((c) => c.key === creativeCategory)?.label ?? '全部'}`
      : inventoryTab === 'recipes'
        ? '配方书'
        : craftingTableOpen
          ? '工作台'
          : '物品栏';
  elements.push(
    ...buildPanelHeader({
      x: panelX + railW + pad,
      y: panelY + 6,
      w: panelW - railW * 2 - pad * 2,
      title: titleText,
      onClose: () => closeInventory(),
      ...(inventoryTab === 'items' ? { onRecipes: () => {
        inventoryTab = 'recipes';
        recipePage = 0;
        showInventory();
      } } : {}),
    }),
  );

  // ---- 内容区 ----
  if (inventoryTab === 'items') {
    // 物品栏：27 格 3×9（快捷栏在 dock，不在这里）
    for (let j = 0; j < 27; j++) {
      const i = j + 9;
      const stack = inventory.get(i);
      const x = contentX + (j % 9) * (slotSize + gap);
      const y = contentY + Math.floor(j / 9) * (slotSize + gap);
      elements.push(
        slot(
          x,
          y,
          slotSize,
          i,
          stack?.id ?? 0,
          stack?.count ?? 0,
          false,
          (button) => clickSlot('inventory', i, button),
          (from) => dropSlot({ kind: 'inventory', index: from.index }, { kind: 'inventory', index: i }),
        ),
      );
    }
    // 右半边：合成（2×2）或盔甲列 —— 由 panelMode 决定（对齐 data-pocket-tab）
    if (panelMode === 'armor') {
      // 盔甲竖排一列 + 副手，贴在内容区右侧
      elements.push(
        ...buildArmorColumn({
          x: contentX + contentW - slotSize,
          y: contentY,
          slotSize,
          inventory,
          onTap: (index, button) => clickSlot('inventory', index, button),
          onDrop: (from, to) => dropSlot({ kind: 'inventory', index: from }, { kind: 'inventory', index: to }),
        }),
      );
    } else {
      // 2×2 合成（对齐 Web 版右列：网格 → 箭头 → 产物，没有标题字、没有尺寸按钮）
      const craftX = contentX + gridW + 16;
      const craftY = contentY + 4;
      for (let i = 0; i < crafting.size * crafting.size; i++) {
        const stack = crafting.get(i);
        elements.push(
          slot(
            craftX + (i % crafting.size) * (craftSlot + 2),
            craftY + Math.floor(i / crafting.size) * (craftSlot + 2),
            craftSlot,
            100 + i,
            stack?.id ?? 0,
            stack?.count ?? 0,
            false,
            (button) => clickSlot('crafting', i, button),
            (from) => dropSlot({ kind: 'crafting', index: from.index - 100 }, { kind: 'crafting', index: i }),
          ),
        );
      }
      // 箭头
      const arrowX = craftX + crafting.size * (craftSlot + 2) + 2;
      const arrowY = craftY + (crafting.size * (craftSlot + 2) - slotSize) / 2;
      elements.push(
        text(arrowX, arrowY + 6, 20, 24, '→', { fontSize: 16, color: MC.text, align: 'center' }),
      );
      // 产物槽（只取不放）
      const result = crafting.result;
      elements.push(
        slot(
          arrowX + 22,
          arrowY,
          craftSlot,
          200,
          result?.id ?? 0,
          result?.count ?? 0,
          false,
          () => craftOutput(),
          undefined,
          true,
        ),
      );
    }
  } else if (inventoryTab === 'creative') {
    elements.push(
      ...buildCreativeTab({
        gridX: contentX,
        // 顶栏已经占了 headerH，这里再让出 26 给"搜索/整理"那一行，
        // 否则它会跟顶栏的「关闭」叠在一起
        gridY: contentY + 28,
        panelY,
        panelH,
        slotSize,
        gap,
        inventory,
        items: creativeItems,
        category: creativeCategory,
        query: creativeQuery,
        page: creativePage,
        setCategory: (value) => {
          creativeCategory = value;
        },
        setQuery: (value) => {
          creativeQuery = value;
        },
        setPage: (value) => {
          creativePage = value;
        },
        setPageList: (list) => setCreativePage(list),
        refresh: () => showInventory(),
        onSearch: () => {
          void askText(creativeQuery, 20).then((value) => {
            if (value !== null) {
              creativeQuery = value;
              creativePage = 0;
              showInventory();
            }
          });
        },
        ...tabHandlers,
      }),
    );
  } else {
    elements.push(
      ...buildRecipeTab({
        gridX: contentX,
        gridY: contentY,
        panelY,
        panelH,
        query: recipeQuery,
        size: recipeSize,
        page: recipePage,
        setQuery: (value) => {
          recipeQuery = value;
        },
        setSize: (value) => {
          recipeSize = value;
        },
        setPage: (value) => {
          recipePage = value;
        },
        fillRecipe: (recipe) => fillRecipe(recipe),
        refresh: () => showInventory(),
        onSearch: () => {
          void askText(recipeQuery, 20).then((value) => {
            if (value !== null) {
              recipeQuery = value;
              recipePage = 0;
              showInventory();
            }
          });
        },
      }),
    );
  }

  // ---- 护甲 / 工作台：3×3 合成在上（对齐 workbench-ui） ----
  if (craftingTableOpen && inventoryTab === 'items') {
    // 工作台：3×3 覆盖在内容区上方，玩家 27 格下移
    const craftSlot = Math.round(slotSize * 0.78);
    const craftTotalW = 3 * craftSlot + 2 * 2 + 30 + craftSlot;
    const craftX = contentX + (contentW - craftTotalW) / 2;
    elements.push(
      ...buildCraftingPanel({
        craftX,
        craftY: contentY,
        craftSlot,
        craftGap: 2,
        outputX: craftX + 3 * (craftSlot + 2) + 14,
        panelY,
        crafting,
        inventory,
        fixedSize: true,
        onToggleSize: () => {
          /* 工作台固定 3×3，不切换（INV-013） */
        },
        onOutput: () => craftOutput(),
        refresh: () => showInventory(),
        ...tabHandlers,
      }),
    );
  }

  // ---- 左右两条竖轨 ----
  elements.push(
    ...buildRail({
      x: leftRailX + 2,
      y: panelY + headerH + bodyPad,
      w: railW,
      h: panelH - headerH - bodyPad * 2,
      tab: inventoryTab === 'creative' ? 'creative' : inventoryTab === 'recipes' ? 'recipes' : 'inventory',
      onTab: (tab) => {
        inventoryTab = tab === 'creative' ? 'creative' : tab === 'recipes' ? 'recipes' : 'items';
        if (tab === 'recipes') recipePage = 0;
        showInventory();
      },
      side: 'left',
      category: creativeCategory,
      onCategory: (category) => {
        // 点分类 = **直接进创造网格**（一级直达，不是"先点创造"）
        creativeCategory = category;
        creativePage = 0;
        inventoryTab = 'creative';
        showInventory();
      },
    }),
    ...buildRail({
      x: rightRailX + 2,
      y: panelY + headerH,
      w: railW,
      h: panelH - headerH - bodyPad * 2,
      tab: inventoryTab === 'creative' ? 'creative' : inventoryTab === 'recipes' ? 'recipes' : 'inventory',
      onTab: (tab) => {
        inventoryTab = tab === 'creative' ? 'creative' : tab === 'recipes' ? 'recipes' : 'items';
        showInventory();
      },
      side: 'right',
      mode: panelMode,
      onMode: (mode) => {
        if (mode === 'creative') {
          inventoryTab = 'creative';
        } else {
          // 合成 / 盔甲：都在"物品栏"这一页里，只切右半边
          inventoryTab = 'items';
          panelMode = mode === 'armor' ? 'armor' : 'crafting';
        }
        showInventory();
      },
    }),
  );

  // ---- 提示语 ----
  const hint =
    inventoryHint ||
    (inventoryTab === 'items'
      ? cursor.held
        ? `手上：${itemLabel(cursor.held.id)} ×${cursor.held.count}`
        : '短按拿整叠 · 长按拿一半'
      : '');
  if (hint) {
    elements.push(
      text(contentX, panelY + panelH - 24, contentW, 20, hint, {
        fontSize: 12,
        color: inventoryHint ? '#8a3a3a' : MC.textMuted,
      }),
    );
  }

  // ---- 组装：面板（灰底斜边） + 底部快捷栏 dock（面板外） ----
  const panelBox = box(panelX, panelY, panelW, panelH, elements, {
    background: MC.panel,
    bevel: [MC.bevelLight, MC.bevelDark, MC.bevelDark, MC.bevelLight],
    borderWidth: 3,
  });
  // 面板最外那圈黑描边（`.inv-panel` 的 box-shadow: 0 0 0 2px outline）
  const outline = box(panelX - 2, panelY - 2, panelW + 4, panelH + 4, [], {
    bevel: [MC.outline, MC.outline, MC.outline, MC.outline],
    borderWidth: 2,
  });

  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      box(0, 0, 1024, uiHeight, [], { background: 'rgba(0, 0, 0, 0.45)' }),
      outline,
      panelBox,
      ...buildHotbarDock({
        screenW: 1024,
        screenH: uiHeight,
        slotSize: Math.round(slotSize * 0.96),
        gap,
        inventory,
        selectedSlot,
        onSlot: (index, button) => {
          selectedSlot = index;
          clickSlot('inventory', index, button);
        },
        onDrop: (from, to) =>
          dropSlot({ kind: 'inventory', index: from }, { kind: 'inventory', index: to }),
      }),
    ]),
  );
};

const snapshotPlayer = (): PlayerSave => ({
  x: physics.x,
  y: physics.y,
  z: physics.z,
  yaw,
  pitch,
  dimension: 'overworld',
  flying,
  timeOfDay: worldTime,
  weather: weather.snapshot(),
  health,
  food,
  saturation,
  air,
  exhaustion: 0,
  inventory: inventory.serialize(),
  xp: { level: xpLevel, progress: xpIntoLevel / (7 * (xpLevel + 1)), total: 0, partial: xpIntoLevel },
  selectedSlot,
  dragonDefeated: false,
});

const saveController = new SaveController({
  platform,
  registry,
  getCurrentWorld: () => currentWorld,
  getWorld: () => world,
  snapshotPlayer: () => snapshotPlayer(),
});

const clearDrops = (): void => {
  for (const drop of droppedItems) {
    scene.remove(drop.mesh);
    drop.mesh.geometry.dispose();
    (drop.mesh.material as THREE.Material).dispose();
  }
  droppedItems.length = 0;
};

const mountWorld = async (entry: WorldSummary): Promise<void> => {
  await saveController.persist();
  clearDrops();
  mobs.clearAll();
  pigsSpawned = false;
  sheepSpawned = false;
  zombieSpawned = false;
  world.events = {};
  chunks.disposeAll();
  world = new World(entry.seed, entry.worldType, 1);
  chunks = createChunkRenderer(meshPool);
  workerFallbackAt = meshPool ? performance.now() : 0;
  currentWorld = entry;
  registry.update(entry.id, { lastPlayed: Date.now() });
  spawn = planSpawn(entry.seed, entry.worldType);
  loadSleepSpawn();
  physics.teleport(spawn.x + 0.5, spawn.y + 1.01, spawn.z + 0.5);
  playerReady = false;
  inventory.clear();
  selectedSlot = 0;
  health = 20;
  food = 20;
  saturation = 5;
  air = 300;
  foodExhaustion = 0;
  drownTimer = 0;
  hazardTimer = 0;
  regenTimer = 0;
  fallPeakY = spawn.y + 1;
  wasOnGround = false;
  landedOnce = false;
  dead = false;
  flying = false;
  flyVertical = 0;
  xpLevel = 0;
  xpIntoLevel = 0;
  hudInputBlockUntil = Date.now() + 400;
  playerReadyAt = 0;
  lastAutoSave = Date.now();
  // 先进入世界，区块与存档读取在后台完成，避免卡在创建页。
  started = true;
  paused = false;
  settingsOpen = false;
  inventoryOpen = false;
  showHud();
  try {
    const save = await saveController.open(entry.id);
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
      air = Math.max(0, Math.min(300, loaded.air ?? 300));
      xpLevel = Math.max(0, loaded.xp?.level ?? 0);
      xpIntoLevel = Math.max(0, loaded.xp?.partial ?? 0);
      flying = loaded.flying === true;
      worldTime = Number.isFinite(loaded.timeOfDay) ? loaded.timeOfDay : 0.25;
      weather.restore(loaded.weather);
      selectedSlot = Math.max(0, Math.min(8, loaded.selectedSlot ?? 0));
      playerReady = true;
    }
  } catch (error) {
    console.warn('[v2] load save failed', error);
  }
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
    await SaveController.deleteWorld(entry.id, platform);
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

const openBlockAt = (hit: RayHit): boolean => {
  lastAction = 'probe-open';
  const id = world.getBlock(hit.x, hit.y, hit.z);
  const shape = blockDef(id).shape;
  if (shape === 'door' || shape === 'trapdoor' || shape === 'fence_gate') {
    const state = world.getBlockState(hit.x, hit.y, hit.z);
    const open = !isDoorOpen(state);
    world.setStateAndUpdate(hit.x, hit.y, hit.z, withDoorOpen(state, open));
    if (shape === 'door') {
      const upper = isDoorUpper(state);
      const otherY = upper ? hit.y - 1 : hit.y + 1;
      const otherId = world.getBlock(hit.x, otherY, hit.z);
      if (otherId === id) {
        const otherState = world.getBlockState(hit.x, otherY, hit.z);
        world.setStateAndUpdate(hit.x, otherY, hit.z, withDoorOpen(otherState, open));
      }
    }
    lastAction = open ? 'door-open' : 'door-close';
    audio.play('break_wood');
    saveController.request();
    return true;
  }
  if (BED_IDS.includes(id)) return trySleep(hit);
  if (id === Block.CRAFTING_TABLE) {
    crafting.drainTo(inventory);
    crafting = new CraftingGrid(3);
    craftingTableOpen = true;
    inventoryTab = 'items';
    inventoryHint = '工作台：3×3 合成，点物品放入';
    inventoryOpen = true;
    showInventory();
    return true;
  }
  const opened = containers.openAt(hit);
  if (opened) lastAction = 'open-container';
  return opened;
};

const showToast = (message: string): void => {
  toastMessage = message;
  toastUntil = Date.now() + 2200;
  showHud();
  setTimeout(() => {
    if (Date.now() >= toastUntil && started) showHud();
  }, 2300);
};

const trySleep = (hit: RayHit): boolean => {
  const id = world.getBlock(hit.x, hit.y, hit.z);
  if (!BED_IDS.includes(id)) return false;
  const monstersNear = mobs.hasHostileNear(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  const refusal = sleepRefusal({
    timeOfDay: worldTime,
    thundering: weather.snapshot().kind === 'thunder',
    dead,
    monstersNear,
  });
  if (refusal) {
    showToast(refusal);
    return true;
  }
  worldTime = 0;
  health = 20;
  food = Math.max(food, 6);
  spawn = { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 };
  platform.storage.set(respawnKey(), JSON.stringify(spawn));
  showToast('已设置重生点，睡到天亮');
  return true;
};

const showHud = (): void => {
  if (started && (settingsOpen || inventoryOpen || chat.isOpen || containers.isOpen || paused || dead)) return;
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
            text(24, 58, 380, 24, `FPS ${fps.toFixed(0)} · 画质${quality.tier} · ${meshBackend} · 区块 ${chunks.drawnCount}/${world.chunks.size} · ${physics.x.toFixed(0)},${physics.y.toFixed(0)},${physics.z.toFixed(0)}`, {
              fontSize: 12,
              color: 'rgba(220,240,250,0.8)',
            }),
          ]
        : []),
      ...(Date.now() < toastUntil
        ? [text(0, 70, 1024, 26, toastMessage, { fontSize: 16, color: '#ffe0a0', align: 'center' })]
        : []),
      icon(464, 18, 36, 'chat', () => chat.show(), { background: 'rgba(12,16,20,0.82)', border: 'rgba(255,255,255,0.72)', borderWidth: 2 }),
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
      ...(air < 300
        ? [
            vital(428, uiHeight - 178, 16, 'air', air),
            text(0, uiHeight - 196, 1024, 18, `氧气 ${Math.ceil(air / 20)}s`, { fontSize: 11, color: '#9fe0ff', align: 'center' }),
          ]
        : []),
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
      ...(flying
        ? [
            button(jumpLeft + 16, jumpTop - 72, 60, 60, '升', () => {
              flyVertical = 1;
            }, {
              background: 'rgba(40,72,34,0.86)',
              border: 'rgba(198,240,185,0.8)',
              borderWidth: 2,
              radius: 30,
              fontSize: 18,
            }, () => {
              flyVertical = 0;
            }),
            button(jumpLeft - 68, jumpTop + 20, 60, 60, '降', () => {
              flyVertical = -1;
            }, {
              background: 'rgba(40,72,34,0.86)',
              border: 'rgba(198,240,185,0.8)',
              borderWidth: 2,
              radius: 30,
              fontSize: 18,
            }, () => {
              flyVertical = 0;
            }),
          ]
        : []),
      button(jumpLeft, jumpTop, 92, 92, '跳', () => {
        const nowTap = Date.now();
        if (currentWorld?.gameMode === 'creative' && nowTap - lastJumpTap < 320) {
          lastJumpTap = 0;
          flying = !flying;
          flyVertical = 0;
          showHud();
          return;
        }
        lastJumpTap = nowTap;
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

const addDrop = (id: number, count: number, x: number, y: number, z: number): void => {
  const colors: Record<string, number> = {
    building: 0x9b7b4f,
    tools: 0x8a9aa8,
    armor: 0x6f7f8f,
    natural: 0x5c9b4f,
    wool: 0xd8d8d8,
    food: 0xc77a3a,
    ores: 0x8f8f9f,
    functional: 0x7a6a52,
    brewing: 0x8a5a8a,
    none: 0x999999,
  };
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: colors[categoryOf(id)] ?? 0x999999 }),
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);
  droppedItems.push({ mesh, id, count, x, y, z, bob: Math.random() * Math.PI * 2, pickupAt: Date.now() + 1500 });
};

const dropInventory = (): void => {
  const baseX = physics.x;
  const baseY = physics.y + 0.6;
  const baseZ = physics.z;
  for (let i = 0; i < 36; i++) {
    const stack = inventory.get(i);
    if (!stack) continue;
    const x = baseX + (Math.random() - 0.5) * 1.2;
    const z = baseZ + (Math.random() - 0.5) * 1.2;
    addDrop(stack.id, stack.count, x, baseY, z);
    inventory.set(i, null);
  }
};

const applyDamage = (amount: number, cause: string): void => {
  if (amount <= 0 || dead || currentWorld?.gameMode === 'creative') return;
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
  air = 300;
  foodExhaustion = 0;
  drownTimer = 0;
  starvationTimer = 0;
  regenTimer = 0;
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
          await saveController.persist();
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

let meshPool = (() => {
  try {
    return new WxMeshWorkerPool(platform) as unknown as MeshWorkerPool;
  } catch (error) {
    console.warn('[v2] worker mesh unavailable, fallback main thread', error);
    return null;
  }
})();
meshBackend = meshPool ? 'worker' : 'main';

let world = new World(0x5eed, 'default', 1);

const createChunkRenderer = (pool: MeshWorkerPool | null): ChunkRenderer => {
  const renderer = new ChunkRenderer(
    scene,
    atlas,
    world,
    solid.material,
    translucent.material,
    pool,
  );
  world.events = {
    onChunkLoaded: (chunk) => renderer.onChunkLoaded(chunk.cx, chunk.cz),
    onChunkUnloaded: (cx, cz) => renderer.onChunkUnloaded(cx, cz),
    onBlockChanged: (x, _y, z) => renderer.enqueueAround(x, z),
  };
  return renderer;
};

let chunks = createChunkRenderer(meshPool);

const physics = new PlayerPhysics();

const chat = new ChatSystem({
  ui,
  uiHeight,
  askText,
  showHud: () => showHud(),
  seed: () => currentWorld?.seed ?? null,
  position: () => ({ x: physics.x, y: physics.y, z: physics.z }),
  heal: () => {
    health = 20;
    food = 20;
    saturation = 5;
  },
  setTime: (kind) => {
    worldTime = kind === 'day' ? 0.25 : 0.75;
  },
  setWeather: (kind) => weather.restore({ kind, seconds: 600 }),
  setGameMode: (mode) => {
    if (!currentWorld) return;
    currentWorld.gameMode = mode;
    if (mode !== 'creative') flying = false;
    registry.update(currentWorld.id, { gameMode: mode });
  },
  teleport: (x, y, z) => {
    physics.teleport(x, y, z);
    fallPeakY = y;
  },
  give: (id, count) => inventory.add(id, count),
  clear: () => {
    inventory.clear();
    showHud();
  },
  kill: () => applyDamage(20, '/kill'),
  toggleFly: () => {
    flying = !flying;
    showHud();
    return flying;
  },
});
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
let air = 300;
let foodExhaustion = 0;
let drownTimer = 0;
let fallPeakY = 80;
let wasOnGround = false;
let landedOnce = false;
let starvationTimer = 0;
let regenTimer = 0;
let hazardTimer = 0;
let dead = false;
let lastDamageCause = '';
let toastMessage = '';
let toastUntil = 0;
interface DroppedItem {
  mesh: THREE.Mesh;
  id: number;
  count: number;
  x: number;
  y: number;
  z: number;
  bob: number;
  pickupAt: number;
}
const droppedItems: DroppedItem[] = [];

let pigsSpawned = false;
let zombieSpawned = false;
let sheepSpawned = false;
let damageFlashUntil = 0;
let xpLevel = 0;
let xpIntoLevel = 0;
let lastStickTap = 0;
let flying = false;
let flyVertical = 0;
let lastJumpTap = 0;
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
  saveController.request();
};

const placeAt = (hit: RayHit): void => {
  lastAction = 'place';
  if (openBlockAt(hit)) return;
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
  if (currentWorld?.gameMode !== 'creative') {
    inventory.set(selectedSlot, stack.count > 0 ? stack : null);
  }
  audio.play('place', { x, y, z });
  saveController.request();
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
  ui.refresh(true);
};

const containers = new ContainerSystem({
  ui,
  uiHeight,
  getWorld: () => world,
  inventory,
  getSelectedSlot: () => selectedSlot,
  showHud: () => showHud(),
});

const mobs = new MobSystem({
  scene,
  getPlayer: () => ({ x: physics.x, y: physics.y, z: physics.z }),
  surfaceY: (x, z) => world.getSurfaceBlockY(x, z),
  solidAt: (x, y, z) => world.isSolid(x, y, z),
  onDamage: (amount, cause) => applyDamage(amount, cause),
  onDrop: (id, count, x, y, z) => addDrop(id, count, x, y, z),
  onXp: (amount) => gainXp(amount),
  onHit: () => audio.play('break_wood'),
  onUi: () => showHud(),
  mobDamage: () => {
    const difficulty = currentWorld?.difficulty;
    return difficulty === 'easy' ? 1 : difficulty === 'hard' ? 3 : 2;
  },
});

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
  if (!started || paused || settingsOpen || inventoryOpen || chat.isOpen || containers.isOpen) return;
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
    updateHitAt(event.clientX, event.clientY);
  }
});

platform.input.onPointer('move', (event) => {
  // 光标幽灵跟手（UI-004）：只要手上拿着东西就跟着走，与"有没有拖拽"无关
  ui.moveGhost(event.clientX, event.clientY, platform.system.width, platform.system.height);
  if (ui.handlePointer('move', event.clientX, event.clientY, platform.system.width, platform.system.height)) return;
  if (event.pointerId === movePointer) {
    input.strafe = Math.max(-1, Math.min(1, (event.clientX - moveX) / 56));
    input.forward = Math.max(-1, Math.min(1, -(event.clientY - moveY) / 56));
    const moveDistance = Math.hypot(event.clientX - moveX, event.clientY - moveY);
    if (moveDistance < 8) {
      input.strafe = 0;
      input.forward = 0;
    }
    input.sprint = moveDistance > 62;
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
    input.sprint = false;
    stickOffsetX = 0;
    stickOffsetY = 0;
    if (hudStickKnob) {
      hudStickKnob.x = stickLeftCached + 36;
      hudStickKnob.y = stickTopCached + 36;
      ui.refresh(true);
    }
  }
  if (event.pointerId === lookPointer) {
    if (!lookMoved && mobs.tryAttack(event.clientX, event.clientY, camera, platform.system.width, platform.system.height, uiHeight)) {
      lookMoved = true;
    } else if (!lookMoved && currentHit) {
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
let lastWorldCx = Number.NaN;
let lastWorldCz = Number.NaN;
let lastViewDistance = -1;
let lastAutoSave = 0;
let lastFrameAt = 0;
let lastViewApply = 0;
let mobAccum = 0;
let weatherAccum = 0;
let playerReadyAt = 0;
quality = new QualityManager({
  renderer,
  weatherObject: weather.object,
  platform,
  getSettings: () => settings,
  canToast: () => started && !settingsOpen,
  toast: (message) => showToast(message),
  onViewDistanceChanged: () => {
    lastViewDistance = -1;
    lastViewApply = 0;
  },
});

const frame = (): void => {
  const now = performance.now();
  if (now - lastFrameAt < 13.5) {
    requestAnimationFrame(frame);
    return;
  }
  lastFrameAt = now;
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  fpsFrames += 1;
  if (now - fpsStartedAt >= 1000) {
    fps = (fpsFrames * 1000) / (now - fpsStartedAt);
    fpsFrames = 0;
    fpsStartedAt = now;
  }
  quality.update(fps, dt, now, playerReady, playerReadyAt);

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
      fps,
      qualityTier: quality.tier,
      meshBackend,
      chunks: world.chunks.size,
      drawn: chunks.drawnCount,
      x: physics.x,
      y: physics.y,
      z: physics.z,
      selectedSlot,
      inventory: Array.from({ length: 9 }, (_, i) => inventory.get(i)?.id ?? 0),
      crafting: Array.from({ length: crafting.size * crafting.size }, (_, i) => crafting.get(i)?.id ?? 0),
      craftingSize: crafting.size,
      cursorHeld: cursor.held?.id ?? 0,
      cursorCount: cursor.held?.count ?? 0,
      cursorFromCreative: cursor.fromCreative,
      inventorySlots: Array.from({ length: 41 }, (_, i) => inventory.get(i)?.id ?? 0),
      craftingTable: craftingTableOpen,
      craftResult: crafting.result?.id ?? 0,
      paused,
      settings: settingsOpen,
      inventoryOpen,
      chatOpen: chat.isOpen,
      containerOpen: containers.isOpen,
      containerSlots: containers.slotIds,
      lastAction,
      target: currentHit ? `${world.getBlock(currentHit.x, currentHit.y, currentHit.z)}@${currentHit.x},${currentHit.y},${currentHit.z}` : '',
      held: inventory.get(selectedSlot)?.id ?? 0,
      cameraMode,
      dead,
      pigs: mobs.counts.pigs,
      zombies: mobs.counts.zombies,
      sheep: mobs.counts.sheep,
      drops: droppedItems.length,
      xpLevel,
      flying,
      health,
      food,
      saturation,
      sneaking,
    }),
  );

  if (started && containers.isOpen) containers.tick(dt, now);

  if (!started) {
    renderer.clear();
    ui.render(renderer);
    requestAnimationFrame(frame);
    return;
  }

  const centerCx = Math.floor(physics.x / 16);
  const centerCz = Math.floor(physics.z / 16);
  if (playerReady && playerReadyAt === 0) playerReadyAt = now;
  const viewDistance = quality.viewDistance;
  const centerChanged = centerCx !== lastWorldCx || centerCz !== lastWorldCz || viewDistance !== lastViewDistance;
  if (centerChanged) {
    world.update(centerCx, centerCz, viewDistance);
    lastWorldCx = centerCx;
    lastWorldCz = centerCz;
    lastViewDistance = viewDistance;
  }

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
  if (playerReady && !paused && !settingsOpen && !inventoryOpen && !chat.isOpen && !containers.isOpen) {
    const jumpHeld = input.jump;
    const sneakHeld = input.sneak;
    if (flying) {
      input.jump = jumpHeld || flyVertical > 0;
      input.sneak = sneakHeld || flyVertical < 0;
    }
    physics.update(world as unknown as PhysicsWorld, input, yaw, dt, flying, 1, 1, settings.autoJump);
    if (flying) {
      input.jump = jumpHeld;
      input.sneak = sneakHeld;
    }
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
  const sprinting = !flying && input.sprint && Math.abs(input.forward) + Math.abs(input.strafe) > 0.1;
  const targetFov = settings.fov + (sprinting ? 6 : 0);
  if (Math.abs(currentFov - targetFov) > 0.05) {
    currentFov += (targetFov - currentFov) * Math.min(1, dt * 10);
    camera.fov = currentFov;
    camera.updateProjectionMatrix();
  }
  input.jump = false;

  if (playerReady && !paused && !settingsOpen && !inventoryOpen && !chat.isOpen && !containers.isOpen && currentWorld?.gameMode !== 'creative') {
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
    foodExhaustion += dt * (moving ? (input.sprint ? 0.06 : 0.03) : 0.005);
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
    if (food >= 18 && health < 20) {
      regenTimer += dt;
      if (regenTimer >= 4) {
        regenTimer = 0;
        health = Math.min(20, health + 1);
        saturation = Math.max(0, saturation - 0.5);
        showHud();
      }
    } else {
      regenTimer = 0;
    }
    const eyeBlock = world.getBlock(Math.floor(physics.x), Math.floor(physics.eyeY), Math.floor(physics.z));
    if (eyeBlock === Block.WATER) {
      air = Math.max(0, air - dt * 20);
      if (air <= 0) {
        drownTimer += dt;
        if (drownTimer >= 1) {
          drownTimer = 0;
          applyDamage(2, '溺水');
        }
      }
    } else {
      air = Math.min(300, air + dt * 40);
      drownTimer = 0;
    }
    if (health <= 0 && !dead) {
      dropInventory();
      dead = true;
      paused = true;
      showDeath();
    }
  }

  for (let i = droppedItems.length - 1; i >= 0; i--) {
    const drop = droppedItems[i]!;
    drop.bob += dt * 2;
    drop.mesh.rotation.y += dt * 1.4;
    drop.mesh.position.y = drop.y + Math.sin(drop.bob) * 0.08;
    if (!dead && !paused && Date.now() >= drop.pickupAt && Math.hypot(drop.x - physics.x, drop.z - physics.z) < 1.6 && Math.abs(drop.y - physics.y) < 2) {
      drop.count = inventory.add(drop.id, drop.count);
      if (drop.count <= 0) {
        scene.remove(drop.mesh);
        drop.mesh.geometry.dispose();
        (drop.mesh.material as THREE.Material).dispose();
        droppedItems.splice(i, 1);
        showHud();
      }
    }
  }

  worldTime = (worldTime + dt / 1200) % 1;
  const sunAngle = worldTime * Math.PI * 2;
  const daylight = 0.35 + 0.65 * Math.max(0, Math.sin(sunAngle));
  solid.skyBrightness = settings.brightness * daylight;
  translucent.skyBrightness = settings.brightness * daylight;
  sky.update(worldTime, camera.position, dt);
  weatherAccum += dt;
  if (weatherAccum >= 1 / 30) {
    weather.update(weatherAccum, camera.position, false);
    weatherAccum = 0;
  }

  if (playerReady && !dead && !paused && currentWorld?.gameMode !== 'creative') {
    hazardTimer += dt;
    if (hazardTimer >= 1) {
      hazardTimer = 0;
      const feet = world.getBlock(Math.floor(physics.x), Math.floor(physics.y + 0.1), Math.floor(physics.z));
      if (feet === Block.LAVA) applyDamage(4, '岩浆');
      else if (feet === Block.FIRE || feet === Block.CAMPFIRE) applyDamage(2, '火焰');
      else if (feet === Block.CACTUS) applyDamage(1, '仙人掌');
      if (physics.y < -5) applyDamage(20, '虚空');
    }
  }

  if (meshPool && workerFallbackAt > 0 && now - workerFallbackAt > 2500 && chunks.drawnCount === 0) {
    chunks.disposeAll();
    meshPool = null;
    meshBackend = 'main';
    workerFallbackAt = 0;
    chunks = createChunkRenderer(null);
    showToast('Worker 不可用，已回退主线程');
  }

  const queueStart = performance.now();
  for (let i = 0; i < 4; i++) {
    chunks.processQueue(1, centerCx, centerCz);
    if (performance.now() - queueStart > 3) break;
  }
  if (centerChanged || now - lastViewApply > 150) {
    lastViewApply = now;
    chunks.applyViewDistance(centerCx, centerCz, viewDistance);
  }
  solid.setTime(now * 0.001);
  translucent.setTime(now * 0.001);
  renderer.clear();
  renderer.render(scene, camera);
  if (playerReady && !pigsSpawned) {
    const surface = world.getSurfaceBlockY(spawn.x + 3, spawn.z + 2);
    if (surface !== null) {
      mobs.spawnPig(spawn.x + 3, surface + 1, spawn.z + 2);
      pigsSpawned = true;
    }
  }
  if (playerReady && !sheepSpawned) {
    const surface = world.getSurfaceBlockY(spawn.x - 2, spawn.z + 3);
    if (surface !== null) {
      mobs.spawnSheep(spawn.x - 2, surface + 1, spawn.z + 3);
      sheepSpawned = true;
    }
  }
  if (playerReady && !zombieSpawned && worldTime > 0.55 && currentWorld?.difficulty !== 'peaceful') {
    const surface = world.getSurfaceBlockY(spawn.x - 5, spawn.z - 4);
    if (surface !== null) {
      mobs.spawnZombie(spawn.x - 5, surface + 1, spawn.z - 4);
      zombieSpawned = true;
    }
  }
  if (playerReady && !paused) {
    mobAccum += dt;
    if (mobAccum >= 0.05) {
      mobs.tick(mobAccum);
      mobAccum = 0;
    }
  }

  if (started && saveController.isOpen && !paused && now - lastAutoSave > 15000) {
    lastAutoSave = now;
    void saveController.persist();
  }
  ui.render(renderer);
  if (settings.showDebug && started && !paused && !settingsOpen && !inventoryOpen && !chat.isOpen && !containers.isOpen && now - lastDebugHud > 1000) {
    lastDebugHud = now;
    showHud();
  }
  requestAnimationFrame(frame);
};



// 仅桌面/开发者工具安装测试入口；真机不暴露 __v2Test。
const wxTestApi = (globalThis as unknown as { wx?: { __v2Test?: unknown } }).wx;
const isDesktopRuntime = typeof navigator !== 'undefined';
if (wxTestApi && isDesktopRuntime) {
  wxTestApi.__v2Test = {
    clearInventory: () => {
      for (let i = 0; i < 36; i++) inventory.set(i, null);
      selectedSlot = 0;
      showHud();
    },
    spawnZombie: () => {
      const surface = world.getSurfaceBlockY(Math.floor(physics.x + 3), Math.floor(physics.z + 3));
      if (surface === null) return { spawned: false };
      mobs.spawnZombie(Math.floor(physics.x + 3), surface + 1, Math.floor(physics.z + 3));
      zombieSpawned = true;
      return { spawned: true };
    },
    killSheep: () => {
      const killed = mobs.killSheep();
      if (killed) showHud();
      return { killed };
    },
    killZombie: () => {
      const killed = mobs.killZombie();
      if (killed) showHud();
      return { killed };
    },
    killPig: () => {
      const killed = mobs.killPig();
      if (killed) showHud();
      return { killed };
    },
    setGameMode: (mode: 'survival' | 'creative' = 'creative') => {
      if (currentWorld) {
        currentWorld.gameMode = mode;
        registry.update(currentWorld.id, { gameMode: mode });
      }
      return { mode };
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
    giveToSlot: (slotIndex = 9, id = 5, count = 1) => {
      inventory.set(slotIndex, { id, count });
      showHud();
      return { slotIndex, id, count, stack: inventory.get(slotIndex) };
    },
    /**
     * Phase 2 验收钩子：直接走"点一格"那条唯一入口（短按/长按都由 `button` 指定）。
     * 不绕过 `applyClick`，所以验收的是玩家真实走的代码路径。
     */
    tapSlot: (kind: 'inventory' | 'crafting' | 'creative' = 'inventory', index = 9, button: SlotButton = 'left') => {
      clickSlot(kind, index, button);
      return { kind, index, button, held: cursor.held ? { id: cursor.held.id, count: cursor.held.count } : null };
    },
    /** Phase 2 验收钩子：关闭背包（含光标回收） */
    closeInventoryForTest: () => {
      closeInventory();
      return { open: inventoryOpen, held: cursor.held?.id ?? 0 };
    },
    /** Phase 2 验收钩子：把某几格清空（验收一个用例一条，互不影响） */
    clearSlot: (index = 9) => {
      inventory.set(index, null);
      showHud();
      return { index };
    },
    /**
     * Phase 2 验收钩子：**连光标一起**清空。
     *
     * ⚠️ 只清格子不清光标是个陷阱：上一个用例手上还拿着 16 个，
     * 下一个用例"右键拿一半"就会变成"放 1 个"（因为手不空了），
     * 断言于是量到的是另一套语义——这套验收里真踩过。
     */
    resetInventoryForTest: () => {
      for (let i = 0; i < TOTAL_SLOTS; i++) inventory.set(i, null);
      cursor.clear();
      selectedSlot = 0;
      ui.setGhost(0, 0);
      showHud();
      return { held: cursor.held?.id ?? 0 };
    },
    /**
     * 验收钩子：把背包面板的几何量出来（左轨/右轨/内容区）。
     * 验收脚本不该靠"猜像素"去点轨道上的小图标——猜错就变成点了别处。
     */
    inventoryGeo: () => inventoryGeo,
    /** 光标上那一叠（`null` = 空手） */
    snapshot: () => (cursor.held ? { id: cursor.held.id, count: cursor.held.count } : null),
    /** 某格的数量（0 = 空） */
    slotAt: (index = 9) => inventory.get(index)?.count ?? 0,
    /** 某物品在整个背包里的总数（验"关闭回收不丢东西"用） */
    totalOf: (id = 1) => inventory.countOf(id),
    fillChestFirst: (id = 1, count = 2) => {
      containers.fillFirst(id, count);
      return { id, count };
    },
    smeltFurnace: () => {
      return containers.smeltTest();
    },
    openFurnaceAtFeet: () => {
      const x = Math.floor(physics.x);
      const y = Math.max(0, Math.floor(physics.y) - 1);
      const z = Math.floor(physics.z);
      world.setBlockAndUpdate(x, y, z, Block.FURNACE);
      containers.openFurnaceAt(x, y, z);
      return { x, y, z };
    },
    openCraftingAtFeet: () => {
      const x = Math.floor(physics.x);
      const y = Math.max(0, Math.floor(physics.y) - 1);
      const z = Math.floor(physics.z);
      world.setBlockAndUpdate(x, y, z, Block.CRAFTING_TABLE);
      openBlockAt({ x, y, z } as RayHit);
      return { x, y, z };
    },
    openChestAtFeet: () => {
      const x = Math.floor(physics.x);
      const y = Math.max(0, Math.floor(physics.y) - 1);
      const z = Math.floor(physics.z);
      world.setBlockAndUpdate(x, y, z, Block.CHEST);
      containers.openChestAt(x, y, z);
      return { x, y, z };
    },
  };
}
requestAnimationFrame(frame);
