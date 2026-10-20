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
import { UiLayer, box, button, slider, slot, text, toggle, type UiElement } from './ui-kit/index.ts';
import { Inventory } from '../core/container/Inventory.ts';
import { CraftingGrid } from '../core/crafting/CraftingGrid.ts';
import { Block, blockDef, blockTiles } from '../core/registry/blocks.ts';
import { raycastVoxels, type RayHit } from '../core/interaction/Raycast.ts';
import { ATLAS_COLUMNS, TILE_ORDER, TILE_SIZE } from '../render/TextureAtlas.ts';
import { wxPlatform } from '../platform/wx/index.ts';
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
  const tile = blockTiles(blockId, 0)[0];
  const tileIndex = (TILE_ORDER as readonly string[]).indexOf(tile);
  if (tileIndex < 0) return;
  const sx = (tileIndex % ATLAS_COLUMNS) * TILE_SIZE;
  const sy = Math.floor(tileIndex / ATLAS_COLUMNS) * TILE_SIZE;
  const inset = Math.max(2, Math.floor(size * 0.1));
  ctx.drawImage(atlas.canvas, sx, sy, TILE_SIZE, TILE_SIZE, x + inset, y + inset, size - inset * 2, size - inset * 2);
};

const ui = new UiLayer(platform.system.width, platform.system.height, drawBlockIcon);
const uiHeight = ui.height;
let started = false;
let menuScreen: 'title' | 'worlds' | 'create' | 'edit' = 'title';
let paused = false;
let settingsOpen = false;
let inventoryOpen = false;
let inventoryTab: 'items' | 'creative' = 'items';
let selectedSlot = 0;
const inventory = new Inventory();
let crafting = new CraftingGrid(2);
const creativeBlocks = Object.values(Block).filter((value): value is number => typeof value === 'number' && value > 0).slice(0, 45);
const registryStorage = {
  getItem: (key: string): string | null => platform.storage.get(key),
  setItem: (key: string, value: string): void => platform.storage.set(key, value),
  removeItem: (key: string): void => platform.storage.remove(key),
};
const registry = new WorldRegistry(registryStorage as Storage);
let currentWorld: WorldSummary | null = null;
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
  fingerAim: boolean;
  sound: boolean;
}

const SETTINGS_KEY = 'wx.v2.settings';
const defaultSettings: V2Settings = {
  brightness: 1,
  viewDistance: 2,
  sensitivity: 1,
  fingerAim: true,
  sound: true,
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
      fingerAim: parsed.fingerAim !== false,
      sound: parsed.sound !== false,
    };
  } catch {
    return { ...defaultSettings };
  }
};
const settings = readSettings();
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
    rowY += 68;
  };
  const apply = (): void => {
    persistSettings();
    solid.skyBrightness = settings.brightness;
    translucent.skyBrightness = settings.brightness;
    showSettings();
  };

  if (activeSettingsTab === 'game') {
    row(slider(panelX + 24, rowY, panelW - 48, 56, '亮度', 0.5, 2, 0.05, settings.brightness, (value) => {
      settings.brightness = value;
      apply();
    }));
    row(slider(panelX + 24, rowY, panelW - 48, 56, '视距', 1, 4, 1, settings.viewDistance, (value) => {
      settings.viewDistance = value;
      apply();
    }));
  } else if (activeSettingsTab === 'controls') {
    row(slider(panelX + 24, rowY, panelW - 48, 56, '视角灵敏度', 0.5, 2, 0.1, settings.sensitivity, (value) => {
      settings.sensitivity = value;
      apply();
    }));
    row(toggle(panelX + 24, rowY, panelW - 48, 56, '手指落点瞄准', settings.fingerAim, (value) => {
      settings.fingerAim = value;
      apply();
    }));
  } else if (activeSettingsTab === 'sound') {
    row(toggle(panelX + 24, rowY, panelW - 48, 56, '声音', settings.sound, (value) => {
      settings.sound = value;
      apply();
    }));
    row(text(panelX + 24, rowY + 10, panelW - 48, 40, 'v2 音频引擎尚未接入，开关先保存偏好', {
      fontSize: 16,
      color: 'rgba(200, 220, 235, 0.65)',
    }));
  } else {
    row(text(panelX + 24, rowY + 10, panelW - 48, 40, '角色外观/皮肤编辑器：待 UI Kit 二期迁移', {
      fontSize: 16,
      color: 'rgba(200, 220, 235, 0.65)',
    }));
    row(text(panelX + 24, rowY + 10, panelW - 48, 40, '当前已对齐：亮度、视距、灵敏度、瞄准、声音偏好', {
      fontSize: 16,
      color: 'rgba(200, 220, 235, 0.65)',
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
    crafting.set(toIndex - 100, stack);
    inventory.set(fromIndex, null);
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
    }, { background: inventoryTab === 'creative' ? 'rgba(80, 120, 105, 0.95)' : 'rgba(30, 38, 46, 0.92)', border: 'rgba(180, 215, 235, 0.35)', radius: 8 }),
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
  } else {
    for (let i = 0; i < creativeBlocks.length; i++) {
      const id = creativeBlocks[i]!;
      elements.push(slot(gridX + (i % 9) * (slotSize + gap), gridY + Math.floor(i / 9) * (slotSize + gap), slotSize, i, id, 0, false, () => {
        inventory.add(id, 64);
        showInventory();
      }));
    }
    elements.push(text(gridX, gridY + 5 * (slotSize + gap) + 12, 640, 30, '点方块放入背包；物品页查看/选中', { fontSize: 15, color: 'rgba(200, 220, 235, 0.65)' }));
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
  health: 20,
  food: 20,
  saturation: 5,
  air: 300,
  exhaustion: 0,
  inventory: inventory.serialize(),
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
  try {
    save = await FileSaveGame.open(entry.id, platform.files);
    for (const record of await save.loadAllChunkEdits()) {
      world.edits.restore(record.dimension, record.cx, record.cz, record.edits);
    }
    const loaded = await save.loadPlayer();
    if (loaded) {
      physics.teleport(loaded.x, loaded.y, loaded.z);
      yaw = loaded.yaw;
      pitch = loaded.pitch;
      if (loaded.inventory) inventory.restore(loaded.inventory);
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
  const visible = worlds.slice(0, 4);
  const buttons: UiElement[] = visible.flatMap((world, index) => {
    const y = 150 + index * 56;
    return [
      button(272, y, 300, 50, world.name, () => void mountWorld(world), {
        background: 'rgba(34, 48, 44, 0.95)',
        border: 'rgba(180, 225, 205, 0.38)',
        radius: 8,
      }),
      button(580, y, 80, 50, '编辑', () => showEdit(world), {
        background: 'rgba(32, 42, 50, 0.95)',
        border: 'rgba(190, 220, 240, 0.38)',
        radius: 8,
      }),
      button(668, y, 100, 50, '删除', () => void removeWorld(world), {
        background: 'rgba(74, 38, 40, 0.95)',
        border: 'rgba(240, 170, 170, 0.4)',
        radius: 8,
      }),
    ];
  });
  const bottom = 150 + Math.max(1, visible.length) * 56;
  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      box(0, 0, 1024, uiHeight, [], { background: '#0d1a24' }),
      text(0, 34, 1024, 52, '选择世界', { fontSize: 40, color: '#f2f7fa', align: 'center' }),
      text(0, 92, 1024, 26, `存档 ${worlds.length}`, {
        fontSize: 14,
        color: 'rgba(200, 225, 240, 0.65)',
        align: 'center',
      }),
      ...buttons,
      button(272, bottom + 6, 496, 46, '新建世界', () => showCreate(), {
        background: 'rgba(60, 110, 90, 0.96)',
        border: 'rgba(190, 235, 215, 0.55)',
        radius: 8,
      }),
      button(272, bottom + 60, 496, 38, '返回标题', () => showTitle(), {
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

const showHud = (): void => {
  menuScreen = 'title';
  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      text(24, 18, 460, 40, `${currentWorld?.name ?? '世界'} · v2`, { fontSize: 22, color: '#ffffff' }),
      button(480, 18, 140, 48, '背包', () => {
        inventoryOpen = true;
        showInventory();
      }, { background: 'rgba(32, 40, 48, 0.9)', border: 'rgba(190, 220, 240, 0.45)', radius: 8 }),
      button(640, 18, 160, 48, '设置', () => {
        paused = true;
        showSettings();
      }, { background: 'rgba(32, 40, 48, 0.9)', border: 'rgba(190, 220, 240, 0.45)', radius: 8 }),
      button(824, 18, 176, 48, '暂停', () => {
        paused = true;
        showPause();
      }, { background: 'rgba(32, 40, 48, 0.9)', border: 'rgba(190, 220, 240, 0.45)', radius: 8 }),
      ...Array.from({ length: 9 }, (_, i) => {
        const stack = inventory.get(i);
        return slot(242 + i * 60, uiHeight - 76, 54, i, stack?.id ?? 0, stack?.count ?? 0, i === selectedSlot, () => {
          selectedSlot = i;
          showHud();
        });
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
      button(panelX + 90, panelY + 190, 300, 52, '继续游戏', () => {
        paused = false;
        showHud();
      }, {
        background: 'rgba(52, 64, 74, 0.96)',
        border: 'rgba(190, 220, 240, 0.45)',
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
  camera.updateMatrixWorld();
  aimRaycaster.setFromCamera(
    new THREE.Vector2(
      (clientX / Math.max(1, platform.system.width)) * 2 - 1,
      -(clientY / Math.max(1, platform.system.height)) * 2 + 1,
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
};

const breakAt = (hit: RayHit): void => {
  world.setBlockAndUpdate(hit.x, hit.y, hit.z, Block.AIR);
  requestSave();
};

const placeAt = (hit: RayHit): void => {
  const stack = inventory.get(selectedSlot);
  if (!stack) return;
  const x = hit.x + hit.nx;
  const y = hit.y + hit.ny;
  const z = hit.z + hit.nz;
  if (world.getBlock(x, y, z) !== Block.AIR || blockDef(stack.id).id === 0) return;
  if (!world.setBlockAndUpdate(x, y, z, stack.id)) return;
  stack.count -= 1;
  inventory.set(selectedSlot, stack.count > 0 ? stack : null);
  requestSave();
  showHud();
};

platform.input.onPointer('down', (event) => {
  const now = Date.now();
  if (now - lastDownAt < 40 && Math.abs(event.clientX - lastDownX) < 8 && Math.abs(event.clientY - lastDownY) < 8) {
    return;
  }
  lastDownAt = now;
  lastDownX = event.clientX;
  lastDownY = event.clientY;
  if (ui.handlePointer('down', event.clientX, event.clientY, platform.system.width, platform.system.height)) return;
  if (!started || paused || settingsOpen || inventoryOpen) return;
  if (event.clientX < platform.system.width / 2) {
    movePointer = event.pointerId;
    moveX = event.clientX;
    moveY = event.clientY;
  } else if (lookPointer === null) {
    lookPointer = event.pointerId;
    lookX = event.clientX;
    lookY = event.clientY;
    lookMoved = false;
    lookStartTime = Date.now();
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
  } else if (event.pointerId === lookPointer) {
    if (Math.hypot(event.clientX - lookX, event.clientY - lookY) > 8) lookMoved = true;
    yaw -= (event.clientX - lookX) * 0.005 * settings.sensitivity;
    pitch = Math.max(-1.2, Math.min(1.2, pitch - (event.clientY - lookY) * 0.005 * settings.sensitivity));
    lookX = event.clientX;
    lookY = event.clientY;
    updateHitAt(event.clientX, event.clientY);
  }
});

const release = (event: { pointerId: number; clientX: number; clientY: number }): void => {
  ui.handlePointer('up', event.clientX, event.clientY, platform.system.width, platform.system.height);
  if (event.pointerId === movePointer) {
    movePointer = null;
    input.forward = 0;
    input.strafe = 0;
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

camera.rotation.order = 'YXZ';

let lastTime = performance.now();

const frame = (): void => {
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;

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
    }),
  );

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

  if (playerReady && !paused && !settingsOpen && !inventoryOpen) {
    physics.update(world as unknown as PhysicsWorld, input, yaw, dt, false, 1, 1, false);
    camera.position.set(physics.x, physics.eyeY, physics.z);
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  chunks.processQueue(4, centerCx, centerCz);
  chunks.applyViewDistance(centerCx, centerCz, settings.viewDistance);
  solid.setTime(now * 0.001);
  translucent.setTime(now * 0.001);
  renderer.clear();
  renderer.render(scene, camera);
  ui.render(renderer);
  requestAnimationFrame(frame);
};

requestAnimationFrame(frame);
