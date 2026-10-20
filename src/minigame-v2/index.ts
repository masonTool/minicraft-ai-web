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

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b9e8);
const camera = new THREE.PerspectiveCamera(
  72,
  platform.system.width / Math.max(1, platform.system.height),
  0.1,
  320,
);

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

platform.input.onPointer('down', (event) => {
  if (event.clientX < platform.system.width / 2) {
    movePointer = event.pointerId;
    moveX = event.clientX;
    moveY = event.clientY;
  } else if (lookPointer === null) {
    lookPointer = event.pointerId;
    lookX = event.clientX;
    lookY = event.clientY;
  }
});

platform.input.onPointer('move', (event) => {
  if (event.pointerId === movePointer) {
    input.strafe = Math.max(-1, Math.min(1, (event.clientX - moveX) / 56));
    input.forward = Math.max(-1, Math.min(1, -(event.clientY - moveY) / 56));
    if (Math.hypot(event.clientX - moveX, event.clientY - moveY) < 8) {
      input.strafe = 0;
      input.forward = 0;
    }
  } else if (event.pointerId === lookPointer) {
    yaw -= (event.clientX - lookX) * 0.005;
    pitch = Math.max(-1.2, Math.min(1.2, pitch - (event.clientY - lookY) * 0.005));
    lookX = event.clientX;
    lookY = event.clientY;
  }
});

const release = (event: { pointerId: number }): void => {
  if (event.pointerId === movePointer) {
    movePointer = null;
    input.forward = 0;
    input.strafe = 0;
  }
  if (event.pointerId === lookPointer) lookPointer = null;
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

  const centerCx = Math.floor(physics.x / 16);
  const centerCz = Math.floor(physics.z / 16);
  world.update(centerCx, centerCz, 2);

  if (!playerReady && world.isLoaded(spawn.x, spawn.z)) {
    const surface = world.getSurfaceBlockY(spawn.x, spawn.z);
    if (surface !== null) {
      physics.teleport(spawn.x + 0.5, surface + 1.01, spawn.z + 0.5);
      playerReady = true;
    }
  }

  if (playerReady) {
    physics.update(world as unknown as PhysicsWorld, input, yaw, dt, false, 1, 1, false);
    camera.position.set(physics.x, physics.eyeY, physics.z);
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  chunks.processQueue(4, centerCx, centerCz);
  chunks.applyViewDistance(centerCx, centerCz, 2);
  solid.setTime(now * 0.001);
  translucent.setTime(now * 0.001);
  renderer.clear();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
};

requestAnimationFrame(frame);
