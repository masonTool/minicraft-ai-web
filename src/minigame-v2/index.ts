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
import { Block, blockDef, blockTiles } from '../core/registry/blocks.ts';
import { raycastVoxels, type RayHit } from '../core/interaction/Raycast.ts';
import { ATLAS_COLUMNS, TILE_ORDER, TILE_SIZE } from '../render/TextureAtlas.ts';
import { wxPlatform } from '../platform/wx/index.ts';

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
let paused = false;
let settingsOpen = false;
let inventoryOpen = false;
let inventoryTab: 'items' | 'creative' = 'items';
let selectedSlot = 0;
const inventory = new Inventory();
const creativeBlocks = Object.values(Block).filter((value): value is number => typeof value === 'number' && value > 0).slice(0, 45);
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
  const railW = 180;
  const slotSize = 54;
  const gap = 6;
  const gridX = panelX + railW + 30;
  const gridY = panelY + 92;
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
      }, (from, to) => swapSlots(from.index, to.index)));
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
  ui.setRoot(box(0, 0, 1024, uiHeight, [
    box(0, 0, 1024, uiHeight, [], { background: 'rgba(0, 0, 0, 0.55)' }),
    box(panelX, panelY, panelW, panelH, elements, { background: 'rgba(16, 22, 28, 0.97)', border: 'rgba(170, 205, 230, 0.45)', borderWidth: 2, radius: 12 }),
  ]));
};

const showTitle = (): void => {
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
        started = true;
        paused = false;
        showHud();
      }, { background: 'rgba(60, 110, 90, 0.96)', border: 'rgba(190, 235, 215, 0.55)', radius: 8 }),
      button(312, horizon + 108, 400, 54, '设置', () => {
        settingsOpen = true;
        showSettings();
      }, { background: 'rgba(32, 42, 50, 0.95)', border: 'rgba(190, 220, 240, 0.4)', radius: 8 }),
    ]),
  );
};

const showHud = (): void => {
  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      text(24, 18, 460, 40, 'MINECRAFT v2 · main core', { fontSize: 22, color: '#ffffff' }),
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
  ui.setRoot(
    box(0, 0, 1024, uiHeight, [
      box(0, 0, 1024, uiHeight, [], { background: 'rgba(0, 0, 0, 0.55)' }),
      box(272, Math.max(40, uiHeight / 2 - 150), 480, 300, [
        text(0, 28, 480, 44, '暂停', { fontSize: 34, color: '#ffffff', align: 'center' }),
        text(0, 88, 480, 32, 'v2 最小 UI Kit 切片', { fontSize: 16, color: 'rgba(220,235,245,0.75)', align: 'center' }),
        button(90, 200, 300, 52, '继续游戏', () => {
          paused = false;
          showHud();
        }, { background: 'rgba(52, 64, 74, 0.96)', border: 'rgba(190, 220, 240, 0.45)', radius: 8 }),
      ], { background: 'rgba(16, 22, 28, 0.96)', border: 'rgba(170, 205, 230, 0.45)', borderWidth: 2, radius: 12 }),
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

const world = new World(0x5eed, 'default', 1);
const chunks = new ChunkRenderer(
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

const spawn = { x: 0, z: 0 };
let lastTime = performance.now();

const frame = (): void => {
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;

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
