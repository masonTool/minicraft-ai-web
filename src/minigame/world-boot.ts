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
  interface WorldEntry {
    id: string;
    name: string;
    seed: number;
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
        .slice(0, 3);
    } catch {
      return [];
    }
  };
  let worlds = parseWorlds(platform.storage.get('wx.worlds'));
  if (worlds.length === 0) {
    worlds = [{ id: 'wx-default', name: 'MY WORLD', seed: 0x5eed }];
  }
  let currentWorldId = platform.storage.get('wx.worldId') ?? worlds[0]!.id;
  let currentWorld = worlds.find((world) => world.id === currentWorldId) ?? worlds[0]!;
  currentWorldId = currentWorld.id;
  const storedSeed = Number(platform.storage.get('wx.worldSeed') ?? '');
  const fallbackSeed =
    Number.isFinite(storedSeed) && storedSeed > 0 ? Math.floor(storedSeed) : 0x5eed;
  const worldSeed = currentWorld.seed > 0 ? currentWorld.seed : fallbackSeed;
  currentWorld.seed = worldSeed;
  platform.storage.set('wx.worldId', currentWorldId);
  platform.storage.set('wx.worlds', JSON.stringify(worlds));
  const world = new World(worldSeed, 'default', 1, createWorker);
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
      onAddStack: (stack) => {
        inventory.addStack(stack);
        ui.syncInventory(inventory.serialize(), selectedSlot);
        scheduleSave?.();
      },
      canUseWorkbench: () => {
        const px = Math.floor(physics.x);
        const py = Math.floor(physics.y);
        const pz = Math.floor(physics.z);
        for (let dx = -4; dx <= 4; dx++) {
          for (let dy = -3; dy <= 3; dy++) {
            for (let dz = -4; dz <= 4; dz++) {
              if (world.getBlock(px + dx, py + dy, pz + dz) === Block.CRAFTING_TABLE) return true;
            }
          }
        }
        return false;
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
  const refreshWorldInfo = (edits: number): void => {
    ui.setWorldInfo({
      worlds: worlds.map((entry) => ({ id: entry.id, name: entry.name })),
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
        worlds = [{ id: 'wx-default', name: 'MY WORLD', seed: 0x5eed }];
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

  const newWorld = async (): Promise<void> => {
    if (
      !(await confirmModal(
        'NEW WORLD?',
        'Adds a world with a new seed and switches to it. The game will close; reopen it to play.',
      ))
    ) {
      return;
    }
    if (worlds.length >= 3) {
      ui.showToast('WORLD LIMIT 3');
      return;
    }
    const seed = ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0) & 0x7fffffff;
    const nextSeed = seed > 0 ? seed : 1;
    try {
      const entry: WorldEntry = {
        id: `w${Date.now().toString(36)}`,
        name: `WORLD ${worlds.length + 1}`,
        seed: nextSeed,
      };
      worlds.push(entry);
      currentWorld = entry;
      currentWorldId = entry.id;
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

  const swingAttack = (): void => {
    if (!currentHit) {
      ui.showToast('NO TARGET');
      return;
    }
    const id = world.getBlock(currentHit.x, currentHit.y, currentHit.z);
    spawnHitParticles(
      currentHit.x + 0.5,
      currentHit.y + 0.5,
      currentHit.z + 0.5,
      dropColor(id),
    );
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
      if (action === 'delete') void deleteSave();
      if (action === 'new') void newWorld();
      if (typeof action === 'object' && action?.type === 'world') void switchWorld(action.id);
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
    // 左上角 MENU / BAG
    if (x < width * 0.13 && y < height * 0.12) {
      uiPointerId = event.pointerId;
      ui.togglePause();
      return;
    }
    if (x >= width * 0.13 && x < width * 0.24 && y < height * 0.12) {
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
    // 右侧 ATK 按钮：不进入视角拖动
    if (x > width * 0.66 && x < width * 0.78 && y > height * 0.5 && y < height * 0.66) {
      uiPointerId = event.pointerId;
      swingAttack();
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
      if (!moveMoved) {
        const held = Date.now() - moveStartTime;
        if (held >= 500) {
          const stack = inventory.get(selectedSlot);
          ui.showToast(
            stack ? itemLabel(stack.id) : '空槽位',
          );
        } else if (held < 300) {
          cycleSlot();
        }
      }
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
    `基岩版  ${width}x${height}`,
    `坐标 -  工作线程 ${workerState}`,
    `目标 -  槽位 1/${HOTBAR.length}`,
    `存档 ${saveStatus}  音频 ${audioStatus}`,
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
    updateDrops(dt);
    updateParticles(dt);

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
        `基岩版 ${fps}FPS ${ms.toFixed(1)}ms`,
        `坐标 ${physics.x.toFixed(0)},${physics.y.toFixed(0)},${physics.z.toFixed(0)} ${physics.onGround ? '落地' : '空中'}`,
        `目标 ${targetLabel}  槽位 ${selectedSlot + 1}/${HOTBAR.length}`,
        `存档 ${saveStatus}  音频 ${audioStatus}`,
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
  wx.showModal({
    title: 'WX-020 启动失败',
    content: String(error && (error as Error).stack ? (error as Error).stack : error),
    showCancel: false,
  });
});
