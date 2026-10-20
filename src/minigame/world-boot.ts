/**
 * WX-020 第一阶段：真实世界启动链（无 UI）
 *
 * 目标：在微信真机上跑通
 *   TextureAtlas → VoxelMaterial → World（共享 chunk.worker.js）→ ChunkRenderer → 渲染
 * 并观察图集耗时、区块加载、光照队列、FPS、draw call、BigInt 能力。
 *
 * 这里刻意不接 App / DOM UI：先把“真实地形能不能出来”跑通，
 * 后续再把 UiPort / 玩家 / 存档 / 音频接上。
 */

import * as THREE from 'three';
import { ChunkRenderer } from '../render/ChunkRenderer.ts';
import { MeshWorkerPool } from '../render/MeshWorkerPool.ts';
import { TextureAtlas } from '../render/TextureAtlas.ts';
import { VoxelMaterial } from '../render/VoxelMaterial.ts';
import { World } from '../core/world/World.ts';
import { PlayerPhysics, type PlayerInput } from '../core/physics/PlayerPhysics.ts';
import { raycastVoxels, type RayHit } from '../core/interaction/Raycast.ts';
import { Block, blockDef } from '../core/registry/blocks.ts';
import { maxStackOf } from '../core/registry/items.ts';
import { itemLabel } from '../core/registry/itemNames.ts';
import { craftFromInventory } from '../core/crafting/RecipeBook.ts';
import { AudioEngine } from '../core/audio/AudioEngine.ts';
import { Inventory, type ItemStack } from '../core/container/Inventory.ts';
import type { Chest } from '../core/container/Chest.ts';
import type { Furnace } from '../core/container/Furnace.ts';
import { isFuel, stationOfBlock } from '../core/crafting/Smelting.ts';
import { restoreContainers, serializeContainers } from '../core/save/ContainerSave.ts';
import { ChunkEdits } from '../core/save/ChunkEdits.ts';
import type { WorldType } from '../core/gen/WorldType.ts';
import type { Difficulty } from '../core/world/Rules.ts';
import type { GameMode } from '../core/world/GameMode.ts';
import { FileSaveGame } from '../platform/file-save.ts';
import type { ChunkSaveRecord, PlayerSave } from '../core/save/SaveGame.ts';
import { createCanvasUi } from './ui/port.ts';
import { showBootError } from './ui/boot-error.ts';
import { DEFAULT_SETTINGS, type SettingsValues } from './ui/settings.ts';
import {
  cameraPlacement,
  clampedCameraDistance,
  CLOSE_CAMERA_HIDE_PLAYER,
  THIRD_PERSON_DISTANCE,
  type CameraMode,
} from '../core/viewMode.ts';
import { wxPlatform } from '../platform/wx/index.ts';
import { workerHostToLike } from '../platform/wx/worker-like.ts';
import { createMainThreadWorker } from './main-thread-worker.ts';
import type { WorkerLike } from '../core/worker/WorkerLike.ts';

declare const wx: {
  showModal(options: { title: string; content: string; showCancel?: boolean }): void;
  onTouchStart(cb: (event: any) => void): void;
  onTouchMove(cb: (event: any) => void): void;
  onTouchEnd(cb: (event: any) => void): void;
};

const doc = (globalThis as any).document;
const view = globalThis as any;
let bootRenderer: THREE.WebGLRenderer | null = null;

// WX-020A 主线程降级：先小视距把地形完整跑出来；设置页可以实时调整
let viewRadius = 3;
let invertLook = false;
let cameraMode: CameraMode = 'first';
let lookSensitivity = 1;
let autoJump = true;
const LIGHT_BUDGET = 8000;
const MESH_BUDGET = 8;

async function chooseWorker(platform: ReturnType<typeof wxPlatform>): Promise<{
  worker: WorkerLike;
  state: string;
}> {
  try {
    const host = platform.workers.create('workers/chunk.worker.js');
    const worker = workerHostToLike(host);
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 1500);
      worker.addEventListener('message', (event) => {
        if (event.data?.type === 'pong') {
          clearTimeout(timer);
          resolve(true);
        }
      });
      worker.postMessage({ type: 'ping', id: -1 });
    });
    if (ok) return { worker, state: 'wx' };
    worker.terminate();
    console.warn('[WX-020] wx worker ping timeout，降级主线程');
  } catch (error) {
    console.warn('[WX-020] wx worker 不可用，降级主线程', error);
  }
  return { worker: createMainThreadWorker(), state: 'main' };
}

async function boot(): Promise<void> {
  if (typeof BigInt !== 'function') {
    wx.showModal({
      title: 'WX-020 启动失败',
      content: '当前设备不支持 BigInt，区块生成（Random.ts）无法运行',
      showCancel: false,
    });
    return;
  }

  const platform = wxPlatform();
  const SETTINGS_KEY = 'wx.settings';
  const readSettings = (): SettingsValues => {
    try {
      const raw = platform.storage.get(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<SettingsValues>;
      const mode = parsed.cameraMode;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        fov: Math.max(50, Math.min(110, Number(parsed.fov) || DEFAULT_SETTINGS.fov)),
        renderDistance: Math.max(2, Math.min(8, Math.round(Number(parsed.renderDistance) || DEFAULT_SETTINGS.renderDistance))),
        sound: parsed.sound !== false,
        invertLook: parsed.invertLook === true,
        cameraMode: mode === 'third-back' || mode === 'third-front' ? mode : 'first',
        sensitivity: Math.max(0.5, Math.min(2, Number(parsed.sensitivity) || DEFAULT_SETTINGS.sensitivity)),
        autoJump: parsed.autoJump !== false,
        volume: Math.max(0, Math.min(1, Number(parsed.volume) || DEFAULT_SETTINGS.volume)),
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  };
  const savedSettings = readSettings();
  viewRadius = savedSettings.renderDistance;
  invertLook = savedSettings.invertLook;
  cameraMode = savedSettings.cameraMode;
  lookSensitivity = savedSettings.sensitivity;
  autoJump = savedSettings.autoJump;
  // 逻辑视口必须用 windowWidth/windowHeight（真正可绘制/可触摸区域），
  // 不能用 screenWidth/screenHeight：后者含状态栏/导航栏，会让 UI 纹理比例
  // 与视口比例不一致（纵向压扁），触摸坐标也会整体偏移。
  const width = platform.system.width || view.innerWidth;
  const height = platform.system.height || view.innerHeight;
  console.log('[WX-020] viewport', {
    width,
    height,
    screenWidth: view.innerWidth,
    screenHeight: view.innerHeight,
    dpr: platform.system.dpr,
    safeArea: platform.system.safeArea,
  });
  console.log('[WX-020] platform', platform.kind, platform.system);
  const uiScale = width / 1024;
  const safe = platform.system.safeArea;
  const safeTopPx = Math.max(0, safe.top);
  const safeBottomPx = Math.max(0, height - safe.bottom);
  const pauseSize = 50 * uiScale;
  const pauseLeft = width / 2 - pauseSize / 2;
  const pauseTop = safeTopPx + 8 * uiScale;
  const bagSize = 50 * uiScale;
  const bagLeft = 840 * uiScale;
  const bagTop = height - safeBottomPx - 84 * uiScale;
  let jumpRadiusPx = 46 * uiScale;
  let jumpCenterX = (safe.right - 24 - 46) * uiScale;
  let jumpCenterY = height - safeBottomPx - (116 + 46) * uiScale;
  let stickCenterX = (safe.left + 26 + 80) * uiScale;
  let stickCenterY = height - safeBottomPx - (116 + 80) * uiScale;
  let stickHitRadius = 110 * uiScale;
  const applyTouchLayout = (leftHanded: boolean, scale: number): void => {
    const s = Math.max(0.75, Math.min(1.5, scale));
    jumpRadiusPx = 46 * s * uiScale;
    jumpCenterX = (leftHanded ? safe.left + 24 + 46 * s : safe.right - 24 - 46 * s) * uiScale;
    jumpCenterY = height - safeBottomPx - (116 + 46 * s) * uiScale;
    stickCenterX = (leftHanded ? safe.right - 26 - 80 * s : safe.left + 26 + 80 * s) * uiScale;
    stickCenterY = height - safeBottomPx - (116 + 80 * s) * uiScale;
    stickHitRadius = 110 * s * uiScale;
  };
  applyTouchLayout(savedSettings.leftHanded, savedSettings.touchScale);

  const atlasStarted = Date.now();
  const atlas = new TextureAtlas();
  const atlasMs = Date.now() - atlasStarted;
  console.log('[WX-020] atlas', atlasMs, 'ms', atlas.canvas.width, atlas.canvas.height);

  const renderer = new THREE.WebGLRenderer({
    canvas: doc.canvas,
    antialias: false,
    alpha: false,
  });
  bootRenderer = renderer;
  renderer.setPixelRatio(Math.min(view.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x8fc7ff, 1);
  renderer.autoClear = false;

  const gl = renderer.getContext();
  console.log('[WX-020] GL_VERSION', gl.getParameter(gl.VERSION));
  console.log('[WX-020] GL_RENDERER', gl.getParameter(gl.RENDERER));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc7ff);
  const camera = new THREE.PerspectiveCamera(savedSettings.fov, width / height, 0.1, 320);
  camera.rotation.order = 'YXZ';

  // 第一人称手臂：Web 手机版画面右下角可见；手持方块随快捷栏变化
  const hand = new THREE.Group();
  hand.position.set(0.58, -0.58, -1.2);
  hand.rotation.set(0.55, -0.15, -0.35);
  hand.scale.setScalar(0.62);
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.62, 0.24),
    new THREE.MeshBasicMaterial({ color: 0xc98a63 }),
  );
  hand.add(arm);
  const heldCube = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0x8a6a45 }),
  );
  heldCube.position.set(0, 0.36, -0.04);
  heldCube.scale.setScalar(0.72);
  heldCube.visible = false;
  hand.add(heldCube);
  camera.add(hand);
  scene.add(camera);
  let handTime = 0;
  let handItem = -1;

  // 第三人称玩家模型（简单方块人，原点在脚底）
  const playerModel = new THREE.Group();
  const skinMaterial = new THREE.MeshBasicMaterial({ color: 0xc98a63 });
  const shirtMaterial = new THREE.MeshBasicMaterial({ color: 0x4b7aa8 });
  const pantsMaterial = new THREE.MeshBasicMaterial({ color: 0x2f4058 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.82, 0.3), shirtMaterial);
  body.position.y = 1.0;
  playerModel.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skinMaterial);
  head.position.y = 1.62;
  playerModel.add(head);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.24), pantsMaterial);
    leg.position.set(side * 0.15, 0.35, 0);
    playerModel.add(leg);
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), shirtMaterial);
    armMesh.position.set(side * 0.4, 1.0, 0);
    playerModel.add(armMesh);
  }
  playerModel.visible = false;
  scene.add(playerModel);

  const atlasShape = { tileSpan: atlas.tileSpan, tileInset: atlas.tileInset };
  const solid = new VoxelMaterial(atlas.texture, atlasShape);
  const translucent = new VoxelMaterial(atlas.texture, { translucent: true, ...atlasShape });
  solid.setFog(0x8fc7ff, 40, 180);
  translucent.setFog(0x8fc7ff, 40, 180);
  solid.skyBrightness = 1;
  translucent.skyBrightness = 1;

  // 真机优先 worker；预览环境 worker 不通时自动降级主线程，保证地形能出来。
  const { worker: sharedWorker, state: workerState } = await chooseWorker(platform);
  console.log('[WX-020] worker mode', workerState);
  const createWorker = () => sharedWorker;
  interface WorldEntry {
    id: string;
    name: string;
    seed: number;
    worldType: WorldType;
    difficulty: Difficulty;
    gameMode: GameMode;
    playTime: number;
    lastPlayed: number;
  }
  const parseWorlds = (raw: string | null): WorldEntry[] => {
    if (!raw) return [];
    try {
      const data = JSON.parse(raw) as unknown;
      if (!Array.isArray(data)) return [];
      return data
        .filter(
          (item): item is WorldEntry =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as WorldEntry).id === 'string' &&
            typeof (item as WorldEntry).name === 'string' &&
            typeof (item as WorldEntry).seed === 'number',
        )
        .map((entry) => ({
          ...entry,
          name: entry.name === 'MY WORLD' ? '我的世界' : entry.name,
          worldType: entry.worldType === 'flat' || entry.worldType === 'amplified'
            ? entry.worldType
            : 'default',
          playTime: Number.isFinite(entry.playTime) && entry.playTime > 0 ? entry.playTime : 0,
          lastPlayed: Number.isFinite(entry.lastPlayed) && entry.lastPlayed > 0
            ? entry.lastPlayed
            : Date.now(),
          difficulty: ['peaceful', 'easy', 'normal', 'hard'].includes(entry.difficulty)
            ? entry.difficulty
            : 'normal',
          gameMode: entry.gameMode === 'creative' ? 'creative' : 'survival',
        }));
    } catch {
      return [];
    }
  };
  let worlds = parseWorlds(platform.storage.get('wx.worlds'));
  if (worlds.length === 0) {
    worlds = [{
      id: 'wx-default',
      name: '我的世界',
      seed: 0x5eed,
      worldType: 'default',
      difficulty: 'normal',
      gameMode: 'survival',
      playTime: 0,
      lastPlayed: Date.now(),
    }];
  }
  let currentWorldId = platform.storage.get('wx.worldId') ?? worlds[0]!.id;
  let currentWorld = worlds.find((world) => world.id === currentWorldId) ?? worlds[0]!;
  currentWorldId = currentWorld.id;
  const gameMode: GameMode = currentWorld.gameMode;
  let playMark = Date.now();
  currentWorld.lastPlayed = playMark;
  const storedSeed = Number(platform.storage.get('wx.worldSeed') ?? '');
  const fallbackSeed =
    Number.isFinite(storedSeed) && storedSeed > 0 ? Math.floor(storedSeed) : 0x5eed;
  const worldSeed = currentWorld.seed > 0 ? currentWorld.seed : fallbackSeed;
  currentWorld.seed = worldSeed;
  platform.storage.set('wx.worldId', currentWorldId);
  platform.storage.set('wx.worlds', JSON.stringify(worlds));
  const world = new World(worldSeed, currentWorld.worldType, 1, createWorker);
  const meshPool = new MeshWorkerPool(1, createWorker);
  const chunkRenderer = new ChunkRenderer(
    scene,
    atlas,
    world,
    solid.material,
    translucent.material,
    meshPool,
  );

  world.events = {
    onChunkLoaded: (chunk) => chunkRenderer.onChunkLoaded(chunk.cx, chunk.cz),
    onChunkUnloaded: (cx, cz) => chunkRenderer.onChunkUnloaded(cx, cz),
    onBlockChanged: (x, _y, z) => chunkRenderer.enqueueAround(x, z),
  };

  // 选中方块的黑框（先不做准星 UI，HUD 会显示目标名称）
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
    new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.9 }),
  );
  outline.visible = false;
  outline.renderOrder = 10;
  scene.add(outline);

  const HOTBAR = [
    Block.OAK_PLANKS,
    Block.STONE,
    Block.DIRT,
    Block.GRASS_BLOCK,
    Block.OAK_LOG,
    Block.GLASS,
    Block.COBBLESTONE,
    Block.SAND,
    Block.GLOWSTONE,
  ];
  let selectedSlot = 0;
  let currentHit: RayHit | null = null;
  let targetLabel = '-';

  // 文件存档：先读玩家与区块增量，再让 World 生成地形时叠加
  let save: FileSaveGame | null = null;
  let saveStatus = 'off';
  let loadedPlayer: PlayerSave | null = null;
  try {
    save = await FileSaveGame.open(currentWorldId, platform.files);
    const records = await save.loadAllChunkEdits();
    for (const record of records) {
      world.edits.restore(record.dimension, record.cx, record.cz, record.edits);
    }
    restoreContainers(world.containers, await save.loadContainers());
    loadedPlayer = await save.loadPlayer();
    saveStatus = 'ready';
    console.log('[WX-020] save ready', records.length, 'chunks', loadedPlayer ? 'player' : 'new');
  } catch (error) {
    saveStatus = 'off';
    console.warn('[WX-020] 存档不可用，本次不保存', error);
  }

  // 音频：真机用 createWebAudioContext；没有音频设备时自动关闭
  let audio: AudioEngine | null = null;
  let audioStatus = 'off';
  try {
    audio = new AudioEngine(() => platform.audio.createContext() as unknown as AudioContext);
    audio.volume = savedSettings.volume;
    audioStatus = 'ready';
  } catch (error) {
    console.warn('[WX-020] 音频不可用', error);
  }

  // 真实 41 格背包：读档恢复；新世界给 6 格起始方块（各 64）
  const inventory = new Inventory();
  if (loadedPlayer) inventory.restore(loadedPlayer.inventory);
  // 空槽补起始方块：既覆盖新世界，也让旧存档（只有 1 格）能补齐快捷栏
  for (let i = 0; i < HOTBAR.length; i++) {
    if (!inventory.get(i)) inventory.add(HOTBAR[i]!, 64);
  }
  const hotbarBlocks = HOTBAR.map((_, index) => inventory.get(index)?.id ?? 0);
  let scheduleSave: (() => void) | null = null;
  let dropOne: ((item: ItemStack) => void) | null = null;
  const ui = createCanvasUi(
    atlas,
    hotbarBlocks,
    inventory.serialize(),
    selectedSlot,
    width,
    height,
    {
      onSelectSlot: (index) => {
        selectedSlot = Math.max(0, Math.min(HOTBAR.length - 1, index));
        ui.setSelectedSlot(selectedSlot);
        scheduleSave?.();
      },
      onSwapSlot: (index) => {
        const from = inventory.get(index);
        const to = inventory.get(selectedSlot);
        inventory.set(selectedSlot, from);
        inventory.set(index, to);
        ui.syncInventory(inventory.serialize(), selectedSlot);
        scheduleSave?.();
      },
      onGiveBlock: (id) => {
        inventory.add(id, 64);
        ui.syncInventory(inventory.serialize(), selectedSlot);
        ui.showToast(`+ ${itemLabel(id)} x64`);
        scheduleSave?.();
      },
      onTakeSelectedItem: (): ItemStack | null => {
        const stack = inventory.get(selectedSlot);
        if (!stack) return null;
        const one: ItemStack = { id: stack.id, count: 1 };
        stack.count -= 1;
        if (stack.count <= 0) inventory.set(selectedSlot, null);
        ui.syncInventory(inventory.serialize(), selectedSlot);
        scheduleSave?.();
        return one;
      },
      onTakeItem: (id, count) => {
        let need = count;
        for (let i = 0; i < 41 && need > 0; i++) {
          const stack = inventory.get(i);
          if (!stack || stack.id !== id) continue;
          const take = Math.min(stack.count, need);
          stack.count -= take;
          need -= take;
          if (stack.count <= 0) inventory.set(i, null);
        }
        if (need !== count) {
          ui.syncInventory(inventory.serialize(), selectedSlot);
          scheduleSave?.();
        }
        return count - need;
      },
      onAddStack: (stack) => {
        inventory.addStack(stack);
        ui.syncInventory(inventory.serialize(), selectedSlot);
        scheduleSave?.();
      },
      onToast: (message) => ui.showToast(message),
      onQuickMove: () => {
        const stack = inventory.get(selectedSlot);
        if (!stack) {
          ui.showToast('NO ITEM');
          return;
        }
        let target = -1;
        for (let i = 9; i < 36; i++) {
          const slot = inventory.get(i);
          if (slot?.id === stack.id && slot.count < maxStackOf(stack.id)) {
            target = i;
            break;
          }
        }
        if (target < 0) {
          for (let i = 9; i < 36; i++) {
            if (!inventory.get(i)) {
              target = i;
              break;
            }
          }
        }
        if (target < 0) {
          ui.showToast('BAG FULL');
          return;
        }
        const dest = inventory.get(target);
        if (dest && dest.id === stack.id) {
          const moved = Math.min(maxStackOf(stack.id) - dest.count, stack.count);
          dest.count += moved;
          stack.count -= moved;
          inventory.set(target, dest);
          inventory.set(selectedSlot, stack.count > 0 ? stack : null);
        } else {
          inventory.set(target, stack);
          inventory.set(selectedSlot, null);
        }
        ui.syncInventory(inventory.serialize(), selectedSlot);
        ui.showToast('MOVED');
        scheduleSave?.();
      },
      onDropItem: () => {
        const stack = inventory.get(selectedSlot);
        if (!stack) {
          ui.showToast('NO ITEM');
          return;
        }
        const one: ItemStack = { id: stack.id, count: 1 };
        stack.count -= 1;
        if (stack.count <= 0) inventory.set(selectedSlot, null);
        ui.syncInventory(inventory.serialize(), selectedSlot);
        dropOne?.(one);
        ui.showToast(`丢弃 ${itemLabel(one.id)}`);
        scheduleSave?.();
      },
      onCraftRecipe: (recipe) => {
        const result = craftFromInventory(inventory, recipe);
        if (!result) {
          ui.showToast('MISSING MATERIALS');
          return;
        }
        ui.syncInventory(inventory.serialize(), selectedSlot);
        ui.showToast(`+ ${itemLabel(result.id)} x${result.count}`);
        scheduleSave?.();
      },
      onMoveItem: (from, to) => {
        if (from === to) return;
        const source = inventory.get(from);
        if (!source) return;
        const target = inventory.get(to);
        if (!target) {
          inventory.set(to, source);
          inventory.set(from, null);
        } else if (target.id === source.id) {
          const moved = Math.min(maxStackOf(source.id) - target.count, source.count);
          if (moved > 0) {
            target.count += moved;
            source.count -= moved;
            inventory.set(to, target);
            inventory.set(from, source.count > 0 ? source : null);
          }
        } else {
          inventory.set(to, source);
          inventory.set(from, target);
        }
        ui.syncInventory(inventory.serialize(), selectedSlot);
        scheduleSave?.();
      },
      onRequestText: (current) =>
        platform.keyboard.show({ defaultValue: current, maxLength: 24 }),
      onSettingsChange: (settings) => {
        camera.fov = settings.fov;
        camera.updateProjectionMatrix();
        viewRadius = settings.renderDistance;
        invertLook = settings.invertLook;
        cameraMode = settings.cameraMode;
        lookSensitivity = settings.sensitivity;
        autoJump = settings.autoJump;
        applyTouchLayout(settings.leftHanded, settings.touchScale);
        ui.setTouchLayout(settings.leftHanded, settings.touchScale);
        if (audio) audio.volume = settings.volume;
        platform.storage.set(SETTINGS_KEY, JSON.stringify(settings));
        if (settings.sound) {
          audio?.resume();
          if (audio) audioStatus = 'on';
        } else {
          audio?.suspend();
          audioStatus = 'off';
        }
      },
    },
    platform.system.safeArea,
    savedSettings,
  );

  ui.setCreativeMode(gameMode === 'creative');
  let playerHealth = Math.max(1, loadedPlayer?.health ?? 20);
  let playerFood = loadedPlayer?.food ?? 20;
  let playerAir = loadedPlayer?.air ?? 300;
  const playerXp = loadedPlayer?.xp?.progress ?? 0;
  const refreshVitals = (): void => {
    ui.setStats({
      health: playerHealth,
      food: playerFood,
      air: playerAir,
      armor: 0,
      xp: playerXp,
    });
  };
  refreshVitals();
  let damageFlash = 0;
  let fallStartY: number | null = null;
  const applyDamage = (amount: number, cause: string): void => {
    if (amount <= 0 || ui.isDead() || gameMode === 'creative') return;
    playerHealth = Math.max(0, playerHealth - amount);
    refreshVitals();
    damageFlash = Math.min(1, 0.32 + amount / 8);
    ui.setDamageFlash(damageFlash);
    ui.showToast(`-${amount} 生命`);
    if (playerHealth <= 0) ui.showDeath(cause);
  };
  const refreshWorldInfo = (edits: number): void => {
    ui.setWorldInfo({
      worlds: worlds.map((entry) => ({
        id: entry.id,
        name: entry.name,
        worldType: entry.worldType,
        difficulty: entry.difficulty,
        gameMode: entry.gameMode,
        playTime: entry.playTime,
        lastPlayed: entry.lastPlayed,
      })),
      currentId: currentWorldId,
      seed: currentWorld.seed,
      edits,
    });
  };
  refreshWorldInfo(world.edits.totalEdits || save?.meta?.edits || 0);

  // 第一人称玩家（WX-020B 第一块）：先用平台 pointer 输入，UI 后续再抽 UiPort。
  const physics = new PlayerPhysics();
  const playerInput: PlayerInput = {
    forward: 0,
    strafe: 0,
    jump: false,
    sneak: false,
    sprint: false,
  };
  let yaw = Math.PI * 0.25;
  let pitch = -0.9;
  let playerReady = false;
  let movePointerId: number | null = null;
  let lookPointerId: number | null = null;
  let uiPointerId: number | null = null;
  let moveOriginX = 0;
  let moveOriginY = 0;
  let moveStartTime = 0;
  let moveMoved = false;
  let lastLookX = 0;
  let lastLookY = 0;
  let lookStartX = 0;
  let lookStartY = 0;
  let lookStartTime = 0;
  let lookMoved = false;
  let jumpQueued = false;
  let jumpHeld = false;
  let jumpPointerId: number | null = null;
  let lastMoveTap = 0;
  let lastJumpTap = 0;
  let flying = gameMode === 'creative' && (loadedPlayer?.flying ?? false);
  let sneaking = false;
  let mining: { x: number; y: number; z: number; elapsed: number; pointerId: number } | null = null;
  let openedChest: Chest | null = null;
  let openedFurnace: Furnace | null = null;
  const liveFurnaces = new Set<Furnace>();
  const MINE_TIME = 0.6;
  let lastFrameTime = 0;
  ui.setFlying(flying);
  const toggleFlight = (): void => {
    if (gameMode !== 'creative') {
      ui.showToast('生存模式不能飞行');
      return;
    }
    flying = !flying;
    ui.setFlying(flying);
    ui.showToast(flying ? '飞行开' : '飞行关');
  };

  if (loadedPlayer) {
    physics.teleport(loadedPlayer.x, loadedPlayer.y, loadedPlayer.z);
    yaw = loadedPlayer.yaw;
    pitch = loadedPlayer.pitch;
    selectedSlot = Math.max(0, Math.min(HOTBAR.length - 1, loadedPlayer.selectedSlot));
    ui.setSelectedSlot(selectedSlot);
    playerReady = true;
  }

  const updateCamera = (): void => {
    const eye = { x: physics.x, y: physics.eyeY, z: physics.z };
    const cosPitch = Math.cos(pitch);
    const dir = {
      x: -Math.sin(yaw) * cosPitch,
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * cosPitch,
    };
    if (cameraMode === 'first') {
      camera.position.set(eye.x, eye.y, eye.z);
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      hand.visible = true;
      playerModel.visible = false;
      return;
    }

    const sign = cameraMode === 'third-back' ? -1 : 1;
    const hit = raycastVoxels(
      (x, y, z) => world.isSelectable(x, y, z),
      eye.x,
      eye.y,
      eye.z,
      dir.x * sign,
      dir.y * sign,
      dir.z * sign,
      THIRD_PERSON_DISTANCE,
    );
    const distance = clampedCameraDistance(hit ? hit.distance : null);
    const placement = cameraPlacement(eye, dir, yaw, pitch, cameraMode, distance);
    camera.position.set(placement.x, placement.y, placement.z);
    camera.rotation.y = placement.yaw;
    camera.rotation.x = placement.pitch;
    hand.visible = false;
    playerModel.visible = distance >= CLOSE_CAMERA_HIDE_PLAYER;
    playerModel.position.set(physics.x, physics.y, physics.z);
    playerModel.rotation.y = yaw;
  };

  interface DroppedItem {
    mesh: THREE.Mesh;
    item: ItemStack;
    vx: number;
    vy: number;
    vz: number;
    age: number;
  }
  const drops: DroppedItem[] = [];
  const dropColor = (id: number): number => {
    const colors: Record<number, number> = {
      [Block.GRASS_BLOCK]: 0x6a9c3a,
      [Block.DIRT]: 0x8a5a32,
      [Block.STONE]: 0x8a8a8a,
      [Block.COBBLESTONE]: 0x777777,
      [Block.OAK_PLANKS]: 0xb48a50,
      [Block.OAK_LOG]: 0x6b4a2a,
      [Block.GLASS]: 0x9fd8e8,
      [Block.SAND]: 0xd8c88a,
      [Block.GLOWSTONE]: 0xf0d36a,
    };
    return colors[id] ?? 0xcccccc;
  };

  const dropItem = (item: ItemStack): void => {
    const cosPitch = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cosPitch;
    const dz = -Math.cos(yaw) * cosPitch;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.28, 0.28),
      new THREE.MeshBasicMaterial({ color: dropColor(item.id) }),
    );
    mesh.position.set(physics.x + dx * 1.1, physics.eyeY - 0.3, physics.z + dz * 1.1);
    scene.add(mesh);
    drops.push({ mesh, item, vx: dx * 1.6, vy: 1.2, vz: dz * 1.6, age: 0 });
  };
  dropOne = dropItem;

  interface HitParticle {
    mesh: THREE.Mesh;
    vx: number;
    vy: number;
    vz: number;
    age: number;
    life: number;
  }
  const particles: HitParticle[] = [];
  const spawnHitParticles = (x: number, y: number, z: number, color: number): void => {
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.08),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
      );
      mesh.position.set(x, y, z);
      scene.add(mesh);
      particles.push({
        mesh,
        vx: (Math.random() - 0.5) * 2.4,
        vy: 1 + Math.random() * 1.5,
        vz: (Math.random() - 0.5) * 2.4,
        age: 0,
        life: 0.45,
      });
    }
  };

  const updateParticles = (dt: number): void => {
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i]!;
      particle.age += dt;
      particle.vy -= 12 * dt;
      particle.mesh.position.x += particle.vx * dt;
      particle.mesh.position.y += particle.vy * dt;
      particle.mesh.position.z += particle.vz * dt;
      const material = particle.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(0, 1 - particle.age / particle.life);
      if (particle.age >= particle.life) {
        scene.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        material.dispose();
        particles.splice(i, 1);
      }
    }
  };

  const updateDrops = (dt: number): void => {
    for (let i = drops.length - 1; i >= 0; i--) {
      const drop = drops[i]!;
      drop.age += dt;
      drop.vy -= 18 * dt;
      drop.mesh.position.x += drop.vx * dt;
      drop.mesh.position.y += drop.vy * dt;
      drop.mesh.position.z += drop.vz * dt;
      drop.mesh.rotation.y += dt * 2;
      const ground = world.getSurfaceBlockY(
        Math.floor(drop.mesh.position.x),
        Math.floor(drop.mesh.position.z),
      );
      if (ground !== null && drop.mesh.position.y < ground + 0.2) {
        drop.mesh.position.y = ground + 0.2;
        drop.vy = 0;
        drop.vx = 0;
        drop.vz = 0;
      }
      const distance = Math.hypot(
        drop.mesh.position.x - physics.x,
        drop.mesh.position.y - physics.y,
        drop.mesh.position.z - physics.z,
      );
      if (drop.age > 0.7 && distance < 1.6) {
        inventory.addStack(drop.item);
        ui.syncInventory(inventory.serialize(), selectedSlot);
        ui.showToast(`+ ${itemLabel(drop.item.id)}`);
        scene.remove(drop.mesh);
        drop.mesh.geometry.dispose();
        (drop.mesh.material as THREE.Material).dispose();
        drops.splice(i, 1);
        scheduleSave?.();
      } else if (drop.age > 30) {
        scene.remove(drop.mesh);
        drop.mesh.geometry.dispose();
        (drop.mesh.material as THREE.Material).dispose();
        drops.splice(i, 1);
      }
    }
  };

  const spawnPlayer = (): void => {
    const surface = world.getSurfaceBlockY(8, 8) ?? 64;
    physics.teleport(8.5, surface + 1.01, 8.5);
    fallStartY = null;
    playerReady = true;
    updateCamera();
  };

  const respawnPlayer = (): void => {
    playerHealth = 20;
    refreshVitals();
    damageFlash = 0;
    ui.setDamageFlash(0);
    ui.hideDeath();
    fallStartY = null;
    spawnPlayer();
    scheduleSave?.();
    ui.showToast('已重生');
  };

  let saving = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const snapshotPlayer = (): PlayerSave => {
    return {
      x: physics.x,
      y: physics.y,
      z: physics.z,
      yaw,
      pitch,
      dimension: world.dimension,
      flying,
      gameMode: currentWorld.gameMode,
      timeOfDay: 0.3,
      health: playerHealth,
      food: playerFood,
      saturation: 5,
      air: playerAir,
      exhaustion: 0,
      inventory: inventory.serialize(),
      selectedSlot,
      dragonDefeated: false,
    };
  };

  const persist = async (manual = false): Promise<void> => {
    if (!save || saving) return;
    const now = Date.now();
    currentWorld.playTime += Math.max(0, (now - playMark) / 1000);
    currentWorld.lastPlayed = now;
    playMark = now;
    platform.storage.set('wx.worlds', JSON.stringify(worlds));
    saving = true;
    saveStatus = 'saving';
    try {
      await save.savePlayer(snapshotPlayer());
      const records: ChunkSaveRecord[] = [];
      for (const key of world.edits.dirtyKeys()) {
        const { dimension, cx, cz } = ChunkEdits.parseKey(key);
        const edits = world.edits.serialize(dimension, cx, cz);
        if (edits) records.push({ dimension, cx, cz, edits });
      }
      await save.saveChunks(records);
      const containers = serializeContainers(world.containers);
      await save.saveContainers(containers);
      await save.saveMeta(save.buildMeta(world.seed, world.edits.totalEdits));
      world.edits.markSaved();
      saveStatus = 'ok';
      if (manual) ui.showToast('SAVED');
      console.log(
        '[WX-020] saved',
        records.length,
        'chunks',
        world.edits.totalEdits,
        'edits',
        containers.length,
        'containers',
      );
    } catch (error) {
      saveStatus = 'error';
      ui.showToast('SAVE FAILED');
      console.warn('[WX-020] 保存失败', error);
    } finally {
      saving = false;
    }
  };

  const requestSave = (): void => {
    if (!save) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persist();
    }, 1200);
  };

  scheduleSave = requestSave;

  platform.lifecycle.onHide(() => {
    void persist();
  });
  // 15 秒兜底自动保存；挖放会额外触发 1.2s 去抖保存
  setInterval(() => {
    void persist();
  }, 15000);

  const restartApp = (): void => {
    setTimeout(() => {
      const exit = (wx as any).exitMiniProgram;
      if (typeof exit === 'function') exit({});
    }, 900);
  };

  const confirmModal = (title: string, content: string): Promise<boolean> =>
    new Promise((resolve) => {
      (wx as any).showModal({
        title,
        content,
        showCancel: true,
        success: (res: { confirm?: boolean }) => resolve(res.confirm === true),
        fail: () => resolve(false),
      });
    });

  const clearSave = async (): Promise<void> => {
    if (save) {
      await save.clear();
      save = null;
    } else {
      await FileSaveGame.deleteWorld(currentWorldId, platform.files);
    }
    saveStatus = 'deleted';
  };

  const deleteSave = async (): Promise<void> => {
    if (
      !(await confirmModal(
        'DELETE WORLD?',
        'Deletes this world and its blocks. The game will switch to another world and restart.',
      ))
    ) {
      return;
    }
    try {
      await clearSave();
      worlds = worlds.filter((world) => world.id !== currentWorldId);
      if (worlds.length === 0) {
        worlds = [{
      id: 'wx-default',
      name: '我的世界',
      seed: 0x5eed,
      worldType: 'default',
      difficulty: 'normal',
      gameMode: 'survival',
      playTime: 0,
      lastPlayed: Date.now(),
    }];
      }
      currentWorld = worlds[0]!;
      currentWorldId = currentWorld.id;
      platform.storage.set('wx.worlds', JSON.stringify(worlds));
      platform.storage.set('wx.worldId', currentWorldId);
      save = null;
      refreshWorldInfo(0);
      ui.showToast('WORLD DELETED');
      console.log('[WX-020] world deleted', currentWorldId);
      restartApp();
    } catch (error) {
      saveStatus = 'error';
      ui.showToast('DELETE FAILED');
      console.warn('[WX-020] 删除世界失败', error);
    }
  };

  const removeWorld = async (id: string): Promise<void> => {
    if (id === currentWorldId) {
      await deleteSave();
      return;
    }
    if (
      !(await confirmModal(
        '删除世界？',
        '该世界的存档会一起删掉，无法恢复。当前世界不受影响。',
      ))
    ) {
      return;
    }
    try {
      await FileSaveGame.deleteWorld(id, platform.files);
      worlds = worlds.filter((world) => world.id !== id);
      platform.storage.set('wx.worlds', JSON.stringify(worlds));
      refreshWorldInfo(0);
      ui.openMainMenu('worlds');
      ui.showToast('世界已删除');
    } catch (error) {
      ui.showToast('删除失败');
      console.warn('[WX-020] 删除世界失败', error);
    }
  };

  const createWorld = async (draft: {
    name: string;
    seed: number | null;
    worldType: WorldType;
    difficulty: Difficulty;
    gameMode: GameMode;
  }): Promise<void> => {
    const nextSeed =
      draft.seed && draft.seed > 0
        ? Math.floor(draft.seed)
        : (((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0) & 0x7fffffff) || 1;
    try {
      const entry: WorldEntry = {
        id: `w${Date.now().toString(36)}`,
        name: draft.name.trim() || `世界 ${worlds.length + 1}`,
        seed: nextSeed,
        worldType: draft.worldType,
        difficulty: draft.difficulty,
        gameMode: draft.gameMode,
        playTime: 0,
        lastPlayed: Date.now(),
      };
      worlds.push(entry);
      currentWorld = entry;
      currentWorldId = entry.id;
      playMark = Date.now();
      currentWorld.lastPlayed = playMark;
      platform.storage.set('wx.worlds', JSON.stringify(worlds));
      platform.storage.set('wx.worldId', entry.id);
      platform.storage.set('wx.worldSeed', String(nextSeed));
      // 旧世界已经落过盘；停止本次会话的旧 save，避免退出前写回旧世界。
      save = null;
      saveStatus = 'deleted';
      refreshWorldInfo(0);
      ui.showToast('NEW WORLD · REOPEN');
      console.log('[WX-020] new world', entry.id, nextSeed);
      restartApp();
    } catch (error) {
      saveStatus = 'error';
      ui.showToast('NEW WORLD FAILED');
      console.warn('[WX-020] 新建世界失败', error);
    }
  };

  const switchWorld = async (id: string): Promise<void> => {
    if (id === currentWorldId) return;
    const target = worlds.find((world) => world.id === id);
    if (!target) return;
    await persist();
    platform.storage.set('wx.worldId', id);
    save = null;
    saveStatus = 'deleted';
    currentWorld = target;
    currentWorldId = id;
    playMark = Date.now();
    currentWorld.lastPlayed = playMark;
    refreshWorldInfo(0);
    ui.showToast('SWITCHING WORLD');
    restartApp();
  };

  const resetMove = (): void => {
    movePointerId = null;
    playerInput.forward = 0;
    playerInput.strafe = 0;
  };

  const updateTarget = (): void => {
    const cosPitch = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cosPitch;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cosPitch;
    currentHit = raycastVoxels(
      (x, y, z) => world.isSelectable(x, y, z),
      physics.x,
      physics.eyeY,
      physics.z,
      dx,
      dy,
      dz,
      8,
    );
    if (!currentHit) {
      outline.visible = false;
      targetLabel = '-';
      ui.setTarget(null);
      return;
    }
    outline.visible = true;
    outline.position.set(currentHit.x + 0.5, currentHit.y + 0.5, currentHit.z + 0.5);
    targetLabel = itemLabel(world.getBlock(currentHit.x, currentHit.y, currentHit.z));
    ui.setTarget(targetLabel);
  };

  const cancelMining = (): void => {
    if (!mining) return;
    mining = null;
    ui.setMining(null);
  };

  const breakAt = (x: number, y: number, z: number): void => {
    const id = world.getBlock(x, y, z);
    if (id === Block.AIR || id === Block.BEDROCK) return;
    audio?.playBreakForBlock(blockDef(id).name, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    world.setBlockAndUpdate(x, y, z, Block.AIR);
    spawnHitParticles(x + 0.5, y + 0.5, z + 0.5, dropColor(id));
    inventory.add(id, 1);
    ui.syncInventory(inventory.serialize(), selectedSlot);
    ui.showToast(`+ ${itemLabel(id)}`);
    requestSave();
  };

  const chestSnapshot = (): Array<ItemStack | null> =>
    Array.from({ length: 27 }, (_, index) => openedChest?.get(index) ?? null);
  const playerInventorySnapshot = (): Array<ItemStack | null> =>
    Array.from({ length: 36 }, (_, index) => inventory.get(index));
  const refreshChest = (): void => {
    if (openedChest) ui.setChest(chestSnapshot(), playerInventorySnapshot());
  };

  const furnaceSnapshot = (): Array<ItemStack | null> =>
    Array.from({ length: 3 }, (_, index) => openedFurnace?.get(index) ?? null);
  const refreshFurnace = (): void => {
    if (!openedFurnace) return;
    const burn = openedFurnace.burnTimeTotal > 0
      ? openedFurnace.burnTimeLeft / openedFurnace.burnTimeTotal
      : 0;
    const cook = openedFurnace.cookTimeTotal > 0
      ? openedFurnace.cookProgress / openedFurnace.cookTimeTotal
      : 0;
    ui.setFurnace(furnaceSnapshot(), playerInventorySnapshot(), burn, cook);
  };

  const openFurnaceAt = (x: number, y: number, z: number, station: ReturnType<typeof stationOfBlock>): void => {
    if (!station) return;
    const furnace = world.containers.getOrCreateFurnace(world.dimension, x, y, z, station);
    openedFurnace = furnace;
    liveFurnaces.add(furnace);
    furnace.paused = false;
    ui.openFurnace(furnace.stationName, furnaceSnapshot(), playerInventorySnapshot());
  };

  const useTarget = (): void => {
    updateTarget();
    if (!currentHit) return;
    const id = world.getBlock(currentHit.x, currentHit.y, currentHit.z);
    if (id === Block.CHEST) {
      openedChest = world.containers.getOrCreateChest(
        world.dimension,
        currentHit.x,
        currentHit.y,
        currentHit.z,
      );
      ui.openChest('箱子', chestSnapshot(), playerInventorySnapshot());
      return;
    }
    if (id === Block.CRAFTING_TABLE) {
      ui.openCraftingTable();
      return;
    }
    const station = stationOfBlock(id);
    if (station) openFurnaceAt(currentHit.x, currentHit.y, currentHit.z, station);
  };

  const placeTarget = (): void => {
    updateTarget();
    if (!currentHit) return;
    const px = currentHit.x + currentHit.nx;
    const py = currentHit.y + currentHit.ny;
    const pz = currentHit.z + currentHit.nz;
    if (!world.isLoaded(px, pz) || world.getBlock(px, py, pz) !== Block.AIR) return;
    // 别把方块放进玩家自己的碰撞盒
    const half = physics.width / 2;
    if (
      px + 1 > physics.x - half &&
      px < physics.x + half &&
      py + 1 > physics.y &&
      py < physics.y + physics.height &&
      pz + 1 > physics.z - half &&
      pz < physics.z + half
    ) {
      return;
    }
    const stack = inventory.get(selectedSlot);
    if (!stack) {
      ui.showToast('NO BLOCK');
      return;
    }
    const blockId = stack.id;
    if (blockDef(blockId).id === 0) {
      ui.showToast('CANNOT PLACE');
      return;
    }
    world.setBlockAndUpdate(px, py, pz, blockId);
    stack.count -= 1;
    if (stack.count <= 0) inventory.set(selectedSlot, null);
    ui.syncInventory(inventory.serialize(), selectedSlot);
    audio?.playPlaceForBlock(blockDef(blockId).name, { x: px + 0.5, y: py + 0.5, z: pz + 0.5 });
    requestSave();
  };

  const cycleSlot = (): void => {
    selectedSlot = (selectedSlot + 1) % HOTBAR.length;
    ui.setSelectedSlot(selectedSlot);
  };

  const handleRightTap = (_x: number, y: number): void => {
    if (y > height * 0.78) {
      const now = Date.now();
      if (now - lastJumpTap < 320) {
        lastJumpTap = 0;
        toggleFlight();
      } else {
        lastJumpTap = now;
        jumpQueued = true;
      }
    } else if (y <= height * 0.45) {
      placeTarget();
    } else if (y <= height * 0.78) {
      useTarget();
    }
    // 中间按住仍是破坏；短按用于打开箱子
  };

  platform.input.onPointer('down', (event) => {
    audio?.resume();
    if (audio) audioStatus = 'on';
    const x = event.clientX;
    const y = event.clientY;

    // 主菜单优先：PLAY/SETTINGS，其他点击不穿透
    if (ui.isMainMenuOpen()) {
      uiPointerId = event.pointerId;
      const action = ui.handleMainMenuTap(x, y, width, height);
      if (action === 'settings') ui.openSettings();
      if (action === 'delete') void deleteSave();
      if (typeof action === 'object' && action?.type === 'create') void createWorld(action);
      if (typeof action === 'object' && action?.type === 'deleteWorld') void removeWorld(action.id);
      if (typeof action === 'object' && action?.type === 'world') void switchWorld(action.id);
      return;
    }
    // 死亡遮罩：任意点击重生
    if (ui.isDead()) {
      uiPointerId = event.pointerId;
      return;
    }
    // 暂停面板优先：暂停时所有点击只走 UI
    if (ui.isSettingsOpen()) {
      uiPointerId = event.pointerId;
      ui.handleSettingsTap(x, y, width, height);
      return;
    }
    if (ui.isPauseOpen()) {
      uiPointerId = event.pointerId;
      const action = ui.handlePauseTap(x, y, width, height);
      if (action === 'settings') ui.openSettings();
      if (action === 'menu') {
        void (async () => {
          await persist(true);
          ui.openMainMenu('worlds');
        })();
      }
      if (action === 'delete') void deleteSave();
      return;
    }
    // 顶部居中暂停
    if (
      x >= pauseLeft &&
      x <= pauseLeft + pauseSize &&
      y >= pauseTop &&
      y <= pauseTop + pauseSize
    ) {
      uiPointerId = event.pointerId;
      ui.togglePause();
      return;
    }
    // 快捷栏右侧背包
    if (x >= bagLeft && x <= bagLeft + bagSize && y >= bagTop && y <= bagTop + bagSize) {
      uiPointerId = event.pointerId;
      ui.toggleInventory();
      return;
    }
    // 背包打开时，所有点击先交给 UI；点外/点槽都会关闭
    if (ui.isInventoryOpen()) {
      uiPointerId = event.pointerId;
      ui.handleInventoryDown(x, y, width, height);
      return;
    }
    // 箱子打开时，点击只走箱子界面
    if (ui.isChestOpen()) {
      uiPointerId = event.pointerId;
      const action = ui.handleChestTap(x, y, width, height);
      if (action?.type === 'move' && openedChest) {
        const getAt = (side: 'chest' | 'player', index: number): ItemStack | null => {
          if (side === 'chest') return openedChest?.get(index) ?? null;
          return inventory.get(index);
        };
        const setAt = (side: 'chest' | 'player', index: number, stack: ItemStack | null): void => {
          if (side === 'chest') openedChest?.set(index, stack);
          else inventory.set(index, stack);
        };
        const source = getAt(action.fromSide, action.fromIndex);
        if (source) {
          const target = getAt(action.toSide, action.toIndex);
          if (target && target.id === source.id) {
            const moved = Math.min(maxStackOf(source.id) - target.count, source.count);
            if (moved > 0) {
              target.count += moved;
              source.count -= moved;
              setAt(action.toSide, action.toIndex, target);
              setAt(
                action.fromSide,
                action.fromIndex,
                source.count > 0 ? source : null,
              );
            }
          } else {
            setAt(action.toSide, action.toIndex, source);
            setAt(action.fromSide, action.fromIndex, target);
          }
          ui.syncInventory(inventory.serialize(), selectedSlot);
          refreshChest();
          scheduleSave?.();
        }
      }
      if (!ui.isChestOpen()) openedChest = null;
      return;
    }
    // 熔炉打开时，点击只走熔炉界面
    if (ui.isFurnaceOpen()) {
      uiPointerId = event.pointerId;
      const action = ui.handleFurnaceTap(x, y, width, height);
      if (action?.type === 'move' && openedFurnace) {
        const getAt = (side: 'station' | 'player', index: number): ItemStack | null => {
          if (side === 'station') return openedFurnace?.get(index) ?? null;
          return inventory.get(index);
        };
        const setAt = (side: 'station' | 'player', index: number, stack: ItemStack | null): void => {
          if (side === 'station') openedFurnace?.set(index, stack);
          else inventory.set(index, stack);
        };
        const source = getAt(action.fromSide, action.fromIndex);
        const target = getAt(action.toSide, action.toIndex);
        if (source) {
          if (action.toSide === 'station' && action.toIndex === 2) {
            ui.showToast('产物格只能取出');
          } else if (
            action.toSide === 'station' &&
            action.toIndex === 1 &&
            !isFuel(source.id)
          ) {
            ui.showToast('燃料格只放燃料');
          } else if (
            action.fromSide === 'station' &&
            action.fromIndex === 2 &&
            target &&
            target.id !== source.id
          ) {
            ui.showToast('产物格只能取出');
          } else if (
            action.fromSide === 'station' &&
            action.fromIndex === 2 &&
            target &&
            target.id === source.id
          ) {
            const moved = Math.min(maxStackOf(source.id) - target.count, source.count);
            if (moved > 0) {
              target.count += moved;
              source.count -= moved;
              setAt(action.toSide, action.toIndex, target);
              setAt('station', 2, source.count > 0 ? source : null);
            }
          } else if (target && target.id === source.id) {
            const moved = Math.min(maxStackOf(source.id) - target.count, source.count);
            if (moved > 0) {
              target.count += moved;
              source.count -= moved;
              setAt(action.toSide, action.toIndex, target);
              setAt(action.fromSide, action.fromIndex, source.count > 0 ? source : null);
            }
          } else {
            setAt(action.toSide, action.toIndex, source);
            setAt(action.fromSide, action.fromIndex, target);
          }
          ui.syncInventory(inventory.serialize(), selectedSlot);
          refreshFurnace();
          scheduleSave?.();
        }
      }
      if (!ui.isFurnaceOpen()) openedFurnace = null;
      return;
    }

    if (
      Math.hypot(x - stickCenterX, y - stickCenterY) <= stickHitRadius &&
      movePointerId === null
    ) {
      movePointerId = event.pointerId;
      moveOriginX = x;
      moveOriginY = y;
      moveStartTime = Date.now();
      moveMoved = false;
      return;
    }
    // 右下跳跃键：命中范围跟随视觉圆钮，不再落到中间挖掘区
    if (Math.hypot(x - jumpCenterX, y - jumpCenterY) <= jumpRadiusPx + 6) {
      jumpPointerId = event.pointerId;
      jumpHeld = true;
      const now = Date.now();
      if (now - lastJumpTap < 320) {
        lastJumpTap = 0;
        toggleFlight();
      } else {
        lastJumpTap = now;
        jumpQueued = true;
      }
      return;
    }
    if (lookPointerId === null) {
      lookPointerId = event.pointerId;
      lastLookX = x;
      lastLookY = y;
      lookStartX = x;
      lookStartY = y;
      lookStartTime = Date.now();
      lookMoved = false;
      if (x > width * 0.45 && y > height * 0.78) {
        jumpHeld = true;
        jumpQueued = true;
      }
      if (x > width * 0.45 && y > height * 0.45 && y < height * 0.78 && currentHit) {
        mining = {
          x: currentHit.x,
          y: currentHit.y,
          z: currentHit.z,
          elapsed: 0,
          pointerId: event.pointerId,
        };
        ui.setMining(0);
      }
    }
  });

  platform.input.onPointer('move', (event) => {
    if (event.pointerId === uiPointerId) {
      if (ui.isSettingsOpen()) {
        ui.handleSettingsScrollMove(event.clientX, event.clientY, width, height);
      } else if (ui.isInventoryOpen()) {
        ui.handleInventoryMove(event.clientX, event.clientY, width, height);
      }
      return;
    }
    if (event.pointerId === movePointerId) {
      if (Math.hypot(event.clientX - moveOriginX, event.clientY - moveOriginY) > 8) {
        moveMoved = true;
      }
      const dx = (event.clientX - moveOriginX) / 64;
      const dy = (event.clientY - moveOriginY) / 64;
      const deadzone = 0.12;
      playerInput.strafe = Math.abs(dx) < deadzone ? 0 : Math.max(-1, Math.min(1, dx));
      playerInput.forward = Math.abs(dy) < deadzone ? 0 : Math.max(-1, Math.min(1, -dy));
      return;
    }
    if (event.pointerId === lookPointerId) {
      if (Math.hypot(event.clientX - lookStartX, event.clientY - lookStartY) > 10) {
        lookMoved = true;
        if (mining?.pointerId === event.pointerId) cancelMining();
      }
      yaw -= (event.clientX - lastLookX) * 0.006 * lookSensitivity;
      const pitchSign = invertLook ? -1 : 1;
      pitch = Math.max(
        -1.2,
        Math.min(
          1.2,
          pitch - (event.clientY - lastLookY) * 0.006 * lookSensitivity * pitchSign,
        ),
      );
      lastLookX = event.clientX;
      lastLookY = event.clientY;
      updateCamera();
    }
  });

  const releasePointer = (event: { pointerId: number; clientX: number; clientY: number }): void => {
    if (event.pointerId === jumpPointerId) {
      jumpPointerId = null;
      jumpHeld = false;
      return;
    }
    if (event.pointerId === uiPointerId) {
      if (ui.isDead()) {
        respawnPlayer();
      } else if (ui.isSettingsOpen()) {
        ui.handleSettingsScrollUp();
      } else if (ui.isInventoryOpen()) {
        ui.handleInventoryUp(event.clientX, event.clientY, width, height);
      }
      uiPointerId = null;
      return;
    }
    if (event.pointerId === movePointerId) {
      if (!moveMoved) {
        const held = Date.now() - moveStartTime;
        if (held >= 500) {
          const stack = inventory.get(selectedSlot);
          ui.showToast(
            stack ? itemLabel(stack.id) : '空槽位',
          );
        } else if (held < 300) {
          const now = Date.now();
          if (now - lastMoveTap < 320) {
            lastMoveTap = 0;
            sneaking = !sneaking;
            playerInput.sneak = sneaking;
            ui.setSneaking(sneaking);
            ui.showToast(sneaking ? '潜行开' : '潜行关');
          } else {
            lastMoveTap = now;
            cycleSlot();
          }
        }
      }
      resetMove();
    }
    if (event.pointerId === lookPointerId) {
      if (mining?.pointerId === event.pointerId) cancelMining();
      jumpHeld = false;
      if (
        !lookMoved &&
        event.clientX > width * 0.45 &&
        Date.now() - lookStartTime < 350
      ) {
        handleRightTap(event.clientX, event.clientY);
      }
      lookPointerId = null;
    }
  };
  platform.input.onPointer('up', releasePointer);
  platform.input.onPointer('cancel', releasePointer);

  updateCamera();

  const heldStack = inventory.get(selectedSlot);
  ui.updateStatus([
    `基岩版  ${width}x${height}`,
    '生存  加载中',
    `持有 ${heldStack ? itemLabel(heldStack.id) : '空'}`,
    `潜行 关 · 飞行 关  槽位 1/${HOTBAR.length}`,
  ]);

  let frames = 0;
  let fps = 0;
  let lastReport = 0;
  let sceneTriangles = 0;
  let sceneCalls = 0;

  // 自动化/调试入口：开发者工具 automator 或控制台可直接读这些值
  (globalThis as any).__wxWorld = {
    get chunks() {
      return world.chunks.size;
    },
    get drawn() {
      return chunkRenderer.drawnCount;
    },
    get light() {
      return world.lightWorkCount;
    },
    get queue() {
      return chunkRenderer.queueLength;
    },
    get worker() {
      return workerState;
    },
    get fps() {
      return fps;
    },
    get triangles() {
      return sceneTriangles;
    },
    get calls() {
      return sceneCalls;
    },
    get x() {
      return physics.x;
    },
    get y() {
      return physics.y;
    },
    get z() {
      return physics.z;
    },
    get onGround() {
      return physics.onGround;
    },
    get target() {
      return targetLabel;
    },
    get slot() {
      return selectedSlot;
    },
    get save() {
      return saveStatus;
    },
    get audio() {
      return audioStatus;
    },
  };

  const frameBody = (time: number): void => {
    frames += 1;
    const dt = lastFrameTime > 0 ? Math.min(0.05, (time - lastFrameTime) / 1000) : 0.016;
    lastFrameTime = time;

    // 等脚下区块加载完再落玩家，避免出生就掉进虚空
    if (!playerReady && world.isLoaded(8, 8)) spawnPlayer();
    if (
      ui.isMainMenuOpen() ||
      ui.isPauseOpen() ||
      ui.isSettingsOpen() ||
      ui.isInventoryOpen() ||
      ui.isChestOpen() ||
      ui.isFurnaceOpen() ||
      ui.isDead()
    ) {
      playerInput.forward = 0;
      playerInput.strafe = 0;
      playerInput.jump = false;
      jumpQueued = false;
      jumpHeld = false;
    } else if (playerReady && world.isLoaded(physics.x, physics.z)) {
      playerInput.jump = jumpQueued || (flying && jumpHeld);
      jumpQueued = false;
      physics.update(world, playerInput, yaw, dt, flying, 1, 1, autoJump);
      if (physics.y < -40) spawnPlayer();
    }
    updateCamera();
    if (flying) {
      fallStartY = null;
    } else if (!physics.onGround && physics.vy < -0.2) {
      fallStartY = fallStartY === null ? physics.y : Math.max(fallStartY, physics.y);
    } else if (physics.onGround && fallStartY !== null) {
      const distance = fallStartY - physics.y;
      fallStartY = null;
      if (distance > 3) applyDamage(Math.floor(distance - 3), '摔落伤害');
    }
    if (damageFlash > 0) {
      damageFlash = Math.max(0, damageFlash - dt * 1.4);
      ui.setDamageFlash(damageFlash);
    }
    handTime += dt;
    const heldNow = inventory.get(selectedSlot);
    if (heldNow) {
      heldCube.visible = true;
      if (handItem !== heldNow.id) {
        handItem = heldNow.id;
        (heldCube.material as THREE.MeshBasicMaterial).color.setHex(dropColor(heldNow.id));
      }
    } else {
      heldCube.visible = false;
      handItem = -1;
    }
    const moving = Math.abs(playerInput.forward) + Math.abs(playerInput.strafe) > 0.1;
    hand.position.x = 0.58 + Math.cos(handTime * 3.5) * (moving ? 0.014 : 0.006);
    hand.position.y = -0.58 + Math.sin(handTime * 7) * (moving ? 0.024 : 0.01);
    updateTarget();
    updateDrops(dt);
    updateParticles(dt);
    for (const furnace of liveFurnaces) {
      const result = furnace.tick(dt);
      if (furnace === openedFurnace && result.changed) refreshFurnace();
    }

    if (mining) {
      if (
        ui.isMainMenuOpen() ||
        ui.isPauseOpen() ||
        ui.isSettingsOpen() ||
        ui.isInventoryOpen() ||
        ui.isChestOpen() ||
        ui.isFurnaceOpen() ||
        ui.isDead()
      ) {
        cancelMining();
      } else {
        const id = world.getBlock(mining.x, mining.y, mining.z);
        if (id === Block.AIR || id === Block.BEDROCK) {
          cancelMining();
        } else {
          mining.elapsed += dt;
          const mineTime = gameMode === 'creative' ? 0.05 : MINE_TIME;
          const progress = Math.min(1, mining.elapsed / mineTime);
          ui.setMining(progress);
          if (progress >= 1) {
            breakAt(mining.x, mining.y, mining.z);
            cancelMining();
          }
        }
      }
    }

    const centerCx = Math.floor(physics.x / 16);
    const centerCz = Math.floor(physics.z / 16);

    world.update(centerCx, centerCz, viewRadius);
    world.processLighting(LIGHT_BUDGET);

    const busy = !playerReady || world.lightWorkCount > 0 || chunkRenderer.queueLength > 0;
    if (busy) {
      const progress = world.chunks.size > 0 ? chunkRenderer.drawnCount / world.chunks.size : 0;
      ui.setLoading(Math.min(1, progress), 'GENERATING WORLD');
    } else {
      ui.setLoading(null);
    }
    // WX-020A：先保证能看到完整地形；正式版应恢复“光照收敛后再网格化”的门闩，
    // 否则会把未收敛的光照烘焙进网格（App 里的 pendingSettle 会补刷）。
    chunkRenderer.processQueue(MESH_BUDGET, centerCx, centerCz);
    chunkRenderer.applyViewDistance(centerCx, centerCz, viewRadius);
    solid.setTime(time * 0.001);
    translucent.setTime(time * 0.001);

    if (time - lastReport >= 1000) {
      const ms = frames > 0 ? (time - lastReport) / frames : 0;
      fps = frames;
      console.log(
        `[WX-020] fps=${fps} ms=${ms.toFixed(1)} chunks=${world.chunks.size} drawn=${chunkRenderer.drawnCount} light=${world.lightWorkCount} queue=${chunkRenderer.queueLength} tri=${sceneTriangles} calls=${sceneCalls}`,
      );
      const held = inventory.get(selectedSlot);
      ui.updateStatus([
        `${fps} fps   ${physics.x.toFixed(1)} / ${physics.y.toFixed(1)} / ${physics.z.toFixed(1)}`,
        `生存   ${physics.onGround ? '地面' : '空中'}   ${flying ? '飞行' : sneaking ? '潜行' : '行走'}`,
        `持有 ${held ? itemLabel(held.id) : '空'}`,
        `目标 ${targetLabel}  槽位 ${selectedSlot + 1}/${HOTBAR.length}`,
      ]);
      frames = 0;
      lastReport = time;
    }

    renderer.clear();
    renderer.render(scene, camera);
    sceneTriangles = renderer.info.render.triangles;
    sceneCalls = renderer.info.render.calls;
    ui.render(renderer);
  };

  const frame = (time: number): void => {
    try {
      frameBody(time);
      requestAnimationFrame(frame);
    } catch (error) {
      console.error('[WX-020] frame error', error);
      ui.showError(String(error));
      try {
        renderer.clear();
        renderer.render(scene, camera);
        ui.render(renderer);
      } catch {
        /* 渲染器本身失败时只能保留日志 */
      }
    }
  };
  requestAnimationFrame(frame);
}

void boot().catch((error) => {
  console.error('[WX-020] boot failed', error);
  const message = error instanceof Error ? error.message : String(error);
  if (bootRenderer) {
    try {
      showBootError(bootRenderer, message);
      return;
    } catch (renderError) {
      console.warn('[WX-020] 启动失败页绘制失败', renderError);
    }
  }
  wx.showModal({
    title: '启动失败',
    content: message,
    showCancel: false,
  });
});
