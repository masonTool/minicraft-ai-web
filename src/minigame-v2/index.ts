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

const spawn = { x: 0, z: 0, y: 70 };
camera.position.set(spawn.x + 8, spawn.y + 8, spawn.z + 8);
camera.lookAt(spawn.x, spawn.y, spawn.z);

let ready = false;
const frame = (): void => {
  const centerCx = Math.floor(camera.position.x / 16);
  const centerCz = Math.floor(camera.position.z / 16);
  world.update(centerCx, centerCz, 2);
  if (!ready && world.isLoaded(spawn.x, spawn.z)) {
    const surface = world.getSurfaceBlockY(spawn.x, spawn.z);
    if (surface !== null) {
      camera.position.set(spawn.x + 8, surface + 9, spawn.z + 8);
      camera.lookAt(spawn.x, surface, spawn.z);
      ready = true;
    }
  }
  chunks.processQueue(4, centerCx, centerCz);
  chunks.applyViewDistance(centerCx, centerCz, 2);
  solid.setTime(performance.now() * 0.001);
  translucent.setTime(performance.now() * 0.001);
  renderer.clear();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
};

requestAnimationFrame(frame);
