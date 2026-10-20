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
import { AudioEngine } from '../core/audio/AudioEngine.ts';
import { Inventory } from '../core/container/Inventory.ts';
import { ChunkEdits } from '../core/save/ChunkEdits.ts';
import { FileSaveGame } from '../platform/file-save.ts';
import type { ChunkSaveRecord, PlayerSave } from '../core/save/SaveGame.ts';
import { createCanvasUi } from './ui/port.ts';
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

// WX-020A 主线程降级：先小视距把地形完整跑出来；设置页可以实时调整
let viewRadius = 3;
let invertLook = false;
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

  const width = view.innerWidth;
  const height = view.innerHeight;

  const platform = wxPlatform();
  console.log('[WX-020] platform', platform.kind, platform.system);

  const atlasStarted = Date.now();
  const atlas = new TextureAtlas();
  const atlasMs = Date.now() - atlasStarted;
  console.log('[WX-020] atlas', atlasMs, 'ms', atlas.canvas.width, atlas.canvas.height);

  const renderer = new THREE.WebGLRenderer({
    canvas: doc.canvas,
    antialias: false,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(view.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x8fc7ff, 1);
  renderer.autoClear = false;

  const gl = renderer.getContext();
  console.log('[WX-020] GL_VERSION', gl.getParameter(gl.VERSION));
  console.log('[WX-020] GL_RENDERER', gl.getParameter(gl.RENDERER));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc7ff);
  const camera = new THREE.PerspectiveCamera(72, width / height, 0.1, 320);
  camera.rotation.order = 'YXZ';

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
  const world = new World(0x5eed, 'default', 1, createWorker);
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
    save = await FileSaveGame.open('wx-default', platform.files);
    const records = await save.loadAllChunkEdits();
    for (const record of records) {
      world.edits.restore(record.dimension, record.cx, record.cz, record.edits);
    }
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
        ui.showToast(`+ ${blockDef(id).name.replace('minecraft:', '')} x64`);
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
        if (settings.sound) {
          audio?.resume();
          if (audio) audioStatus = 'on';
        } else {
          audio?.suspend();
          audioStatus = 'off';
        }
      },
    },
  );

  ui.setStats({
    health: loadedPlayer?.health ?? 20,
    food: loadedPlayer?.food ?? 20,
    air: loadedPlayer?.air ?? 300,
    armor: 0,
    xp: loadedPlayer?.xp?.progress ?? 0,
  });
  ui.setWorldInfo({
    name: 'MY WORLD',
    seed: save?.meta?.seed ?? world.seed,
    edits: world.edits.totalEdits || save?.meta?.edits || 0,
  });

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
  let flying = loadedPlayer?.flying ?? false;
  let sneaking = false;
  let mining: { x: number; y: number; z: number; elapsed: number; pointerId: number } | null = null;
  const MINE_TIME = 0.6;
  let lastFrameTime = 0;
  ui.setFlying(flying);

  if (loadedPlayer) {
    physics.teleport(loadedPlayer.x, loadedPlayer.y, loadedPlayer.z);
    yaw = loadedPlayer.yaw;
    pitch = loadedPlayer.pitch;
    selectedSlot = Math.max(0, Math.min(HOTBAR.length - 1, loadedPlayer.selectedSlot));
    ui.setSelectedSlot(selectedSlot);
    playerReady = true;
  }

  const updateCamera = (): void => {
    camera.position.set(physics.x, physics.eyeY, physics.z);
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  };

  const spawnPlayer = (): void => {
    const surface = world.getSurfaceBlockY(8, 8) ?? 64;
    physics.teleport(8.5, surface + 1.01, 8.5);
    playerReady = true;
    updateCamera();
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
      gameMode: 'survival',
      timeOfDay: 0.3,
      health: 20,
      food: 20,
      saturation: 5,
      air: 300,
      exhaustion: 0,
      inventory: inventory.serialize(),
      selectedSlot,
      dragonDefeated: false,
    };
  };

  const persist = async (manual = false): Promise<void> => {
    if (!save || saving) return;
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
      await save.saveMeta(save.buildMeta(world.seed, world.edits.totalEdits));
      world.edits.markSaved();
      saveStatus = 'ok';
      if (manual) ui.showToast('SAVED');
      console.log('[WX-020] saved', records.length, 'chunks', world.edits.totalEdits, 'edits');
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
      return;
    }
    outline.visible = true;
    outline.position.set(currentHit.x + 0.5, currentHit.y + 0.5, currentHit.z + 0.5);
    targetLabel = blockDef(world.getBlock(currentHit.x, currentHit.y, currentHit.z))
      .name.replace('minecraft:', '');
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
    inventory.add(id, 1);
    ui.syncInventory(inventory.serialize(), selectedSlot);
    ui.showToast(`+ ${blockDef(id).name.replace('minecraft:', '')}`);
    requestSave();
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
      jumpQueued = true;
    } else if (y <= height * 0.45) {
      placeTarget();
    }
    // 中间区域改为按住破坏，由 mining 状态在帧里推进
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
      if (action === 'save') void persist(true);
      if (action === 'settings') ui.openSettings();
      return;
    }
    // 右上角 MENU / BAG
    if (x > width * 0.7 && x < width * 0.86 && y < height * 0.22) {
      uiPointerId = event.pointerId;
      ui.togglePause();
      return;
    }
    if (x > width * 0.86 && y < height * 0.22) {
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

    // 左侧 FLY / SNEAK 按钮（避开摇杆与 HUD）
    if (y > height * 0.3 && y < height * 0.46) {
      if (x > width * 0.12 && x < width * 0.2) {
        uiPointerId = event.pointerId;
        flying = !flying;
        ui.setFlying(flying);
        ui.showToast(flying ? 'FLY ON' : 'FLY OFF');
        return;
      }
      if (x > width * 0.21 && x < width * 0.29) {
        uiPointerId = event.pointerId;
        sneaking = !sneaking;
        playerInput.sneak = sneaking;
        ui.setSneaking(sneaking);
        ui.showToast(sneaking ? 'SNEAK ON' : 'SNEAK OFF');
        return;
      }
    }

    if (x < width * 0.45 && movePointerId === null) {
      movePointerId = event.pointerId;
      moveOriginX = x;
      moveOriginY = y;
      moveStartTime = Date.now();
      moveMoved = false;
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
      if (y > height * 0.78) {
        jumpHeld = true;
        jumpQueued = true;
      }
      if (y > height * 0.45 && y < height * 0.78 && currentHit) {
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
      yaw -= (event.clientX - lastLookX) * 0.006;
      const pitchSign = invertLook ? -1 : 1;
      pitch = Math.max(
        -1.2,
        Math.min(1.2, pitch - (event.clientY - lastLookY) * 0.006 * pitchSign),
      );
      lastLookX = event.clientX;
      lastLookY = event.clientY;
      updateCamera();
    }
  });

  const releasePointer = (event: { pointerId: number; clientX: number; clientY: number }): void => {
    if (event.pointerId === uiPointerId) {
      if (ui.isSettingsOpen()) {
        ui.handleSettingsScrollUp();
      } else if (ui.isInventoryOpen()) {
        ui.handleInventoryUp(event.clientX, event.clientY, width, height);
      }
      uiPointerId = null;
      return;
    }
    if (event.pointerId === movePointerId) {
      if (!moveMoved && Date.now() - moveStartTime < 300) cycleSlot();
      resetMove();
    }
    if (event.pointerId === lookPointerId) {
      if (mining?.pointerId === event.pointerId) cancelMining();
      jumpHeld = false;
      if (!lookMoved && Date.now() - lookStartTime < 350) {
        handleRightTap(event.clientX, event.clientY);
      }
      lookPointerId = null;
    }
  };
  platform.input.onPointer('up', releasePointer);
  platform.input.onPointer('cancel', releasePointer);

  updateCamera();

  ui.updateStatus([
    `WX-020 WORLD  ${width}x${height} dpr ${platform.system.dpr}  PLAYER`,
    `ATLAS ${atlasMs}ms ${atlas.canvas.width}x${atlas.canvas.height}  W ${workerState}  T -  SLOT 1/${HOTBAR.length}`,
    `CHUNKS ...  DRAWN ...  LIGHT ...  SAVE ${saveStatus}  AUD ${audioStatus}`,
    'FPS ...  MS ...  TRI ...  CALLS ...',
    'L tap cycle/drag move · R drag look · tap top place / bottom jump / hold mid break',
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

  const frame = (time: number): void => {
    frames += 1;
    const dt = lastFrameTime > 0 ? Math.min(0.05, (time - lastFrameTime) / 1000) : 0.016;
    lastFrameTime = time;

    // 等脚下区块加载完再落玩家，避免出生就掉进虚空
    if (!playerReady && world.isLoaded(8, 8)) spawnPlayer();
    if (ui.isMainMenuOpen() || ui.isPauseOpen() || ui.isSettingsOpen()) {
      playerInput.forward = 0;
      playerInput.strafe = 0;
      playerInput.jump = false;
      jumpQueued = false;
      jumpHeld = false;
    } else if (playerReady && world.isLoaded(physics.x, physics.z)) {
      playerInput.jump = jumpQueued || (flying && jumpHeld);
      jumpQueued = false;
      physics.update(world, playerInput, yaw, dt, flying, 1, 1, false);
      if (physics.y < -40) spawnPlayer();
    }
    updateCamera();
    updateTarget();

    if (mining) {
      if (ui.isMainMenuOpen() || ui.isPauseOpen() || ui.isSettingsOpen() || ui.isInventoryOpen()) {
        cancelMining();
      } else {
        const id = world.getBlock(mining.x, mining.y, mining.z);
        if (id === Block.AIR || id === Block.BEDROCK) {
          cancelMining();
        } else {
          mining.elapsed += dt;
          const progress = Math.min(1, mining.elapsed / MINE_TIME);
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
      ui.updateStatus([
        `WX-020 WORLD  ${width}x${height} dpr ${platform.system.dpr}  P ${physics.x.toFixed(0)},${physics.y.toFixed(0)},${physics.z.toFixed(0)} G${physics.onGround ? 1 : 0}`,
        `ATLAS ${atlasMs}ms ${atlas.canvas.width}x${atlas.canvas.height}  W ${workerState}  T ${targetLabel}  SLOT ${selectedSlot + 1}/${HOTBAR.length}`,
        `CHUNKS ${world.chunks.size}  DRAWN ${chunkRenderer.drawnCount}  LIGHT ${world.lightWorkCount}  Q ${chunkRenderer.queueLength}  SAVE ${saveStatus}  AUD ${audioStatus}`,
        `FPS ${fps}  MS ${ms.toFixed(1)}  TRI ${sceneTriangles}  CALLS ${sceneCalls}`,
        'L tap cycle/drag move · R drag look/tap place/break/jump · MENU/BAG top-right',
      ]);
      frames = 0;
      lastReport = time;
    }

    renderer.clear();
    renderer.render(scene, camera);
    sceneTriangles = renderer.info.render.triangles;
    sceneCalls = renderer.info.render.calls;
    ui.render(renderer);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void boot().catch((error) => {
  console.error('[WX-020] boot failed', error);
  wx.showModal({
    title: 'WX-020 启动失败',
    content: String(error && (error as Error).stack ? (error as Error).stack : error),
    showCancel: false,
  });
});
