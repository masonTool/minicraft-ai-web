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

import '../platform/wx/bootstrap.ts';
import * as THREE from 'three';
import { ChunkRenderer } from '../render/ChunkRenderer.ts';
import { MeshWorkerPool } from '../render/MeshWorkerPool.ts';
import { TextureAtlas } from '../render/TextureAtlas.ts';
import { VoxelMaterial } from '../render/VoxelMaterial.ts';
import { World } from '../core/world/World.ts';
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

// WX-020A 主线程降级：先小视距把地形完整跑出来；正式版会恢复 6 并切回 worker
const VIEW_RADIUS = 3;
const LIGHT_BUDGET = 8000;
const MESH_BUDGET = 8;

function createHud(): {
  update(lines: readonly string[]): void;
  render(renderer: THREE.WebGLRenderer): void;
} {
  const canvas = doc.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 0.5),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  mesh.position.set(0, 0.72, 0);
  scene.add(mesh);

  return {
    update(lines: readonly string[]): void {
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = 'rgba(0, 0, 0, 0.64)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = '28px monospace';
      context.textBaseline = 'top';
      context.fillStyle = '#ffffff';
      lines.forEach((line, index) => {
        context.fillText(line.slice(0, 78), 18, 16 + index * 54);
      });
      texture.needsUpdate = true;
    },
    render(renderer: THREE.WebGLRenderer): void {
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}

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
  };

  const centerCx = 0;
  const centerCz = 0;
  world.update(centerCx, centerCz, VIEW_RADIUS);

  const target = new THREE.Vector3(8, 80, 8);
  let yaw = Math.PI * 0.25;
  let pitch = 0.38;
  const distance = 38;
  let cameraReady = false;
  const updateCamera = (): void => {
    const horizontal = Math.cos(pitch) * distance;
    camera.position.set(
      target.x + Math.cos(yaw) * horizontal,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.sin(yaw) * horizontal,
    );
    camera.lookAt(target);
  };
  updateCamera();

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  wx.onTouchStart((event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    dragging = true;
    lastX = touch.clientX;
    lastY = touch.clientY;
  });
  wx.onTouchMove((event) => {
    if (!dragging) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    yaw -= (touch.clientX - lastX) * 0.008;
    pitch = Math.max(0.05, Math.min(1.2, pitch + (touch.clientY - lastY) * 0.008));
    lastX = touch.clientX;
    lastY = touch.clientY;
    updateCamera();
  });
  wx.onTouchEnd(() => {
    dragging = false;
  });

  const hud = createHud();
  hud.update([
    `WX-020 WORLD  ${width}x${height} dpr ${platform.system.dpr}`,
    `ATLAS ${atlasMs}ms ${atlas.canvas.width}x${atlas.canvas.height}  WORKER ${workerState}`,
    'CHUNKS ...  DRAWN ...  LIGHT ...',
    'FPS ...  MS ...  TRI ...  CALLS ...',
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
  };

  const frame = (time: number): void => {
    frames += 1;

    if (!cameraReady && world.chunks.size > 0) {
      const surface = world.getSurfaceBlockY(8, 8) ?? 64;
      target.set(8, surface + 5, 8);
      cameraReady = true;
      updateCamera();
    }

    world.update(centerCx, centerCz, VIEW_RADIUS);
    world.processLighting(LIGHT_BUDGET);
    // WX-020A：先保证能看到完整地形；正式版应恢复“光照收敛后再网格化”的门闩，
    // 否则会把未收敛的光照烘焙进网格（App 里的 pendingSettle 会补刷）。
    chunkRenderer.processQueue(MESH_BUDGET, centerCx, centerCz);
    chunkRenderer.applyViewDistance(centerCx, centerCz, VIEW_RADIUS);
    solid.setTime(time * 0.001);
    translucent.setTime(time * 0.001);

    if (time - lastReport >= 1000) {
      const ms = frames > 0 ? (time - lastReport) / frames : 0;
      fps = frames;
      console.log(
        `[WX-020] fps=${fps} ms=${ms.toFixed(1)} chunks=${world.chunks.size} drawn=${chunkRenderer.drawnCount} light=${world.lightWorkCount} queue=${chunkRenderer.queueLength} tri=${sceneTriangles} calls=${sceneCalls}`,
      );
      hud.update([
        `WX-020 WORLD  ${width}x${height} dpr ${platform.system.dpr}`,
        `ATLAS ${atlasMs}ms ${atlas.canvas.width}x${atlas.canvas.height}  WORKER ${workerState}`,
        `CHUNKS ${world.chunks.size}  DRAWN ${chunkRenderer.drawnCount}  LIGHT ${world.lightWorkCount}  Q ${chunkRenderer.queueLength}`,
        `FPS ${fps}  MS ${ms.toFixed(1)}  TRI ${sceneTriangles}  CALLS ${sceneCalls}`,
      ]);
      frames = 0;
      lastReport = time;
    }

    renderer.clear();
    renderer.render(scene, camera);
    sceneTriangles = renderer.info.render.triangles;
    sceneCalls = renderer.info.render.calls;
    hud.render(renderer);
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
