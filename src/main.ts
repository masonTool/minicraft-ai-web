/**
 * P1 入口：世界流式加载
 *
 * 现在的数据流：
 *   玩家位置 → World.update() 派发区块生成任务（Worker 池并行）
 *            → Worker 返回方块数据（零拷贝 Transferable）
 *            → ChunkRenderer 排队网格化（每帧限量）
 *            → 场景渲染
 *
 * 地形生成仍是占位实现（见 core/gen/TerrainGenerator.ts），P2 替换为 1.18 生成器。
 */

import * as THREE from 'three';
import { TextureAtlas } from './render/TextureAtlas.ts';
import { ChunkRenderer } from './render/ChunkRenderer.ts';
import { World, toChunkCoord } from './core/world/World.ts';
import { BLOCKS } from './core/registry/blocks.ts';

/** 渲染距离（区块） */
const VIEW_DISTANCE = 10;
/** 每帧最多网格化的区块数，用于把加载耗时摊到多帧 */
const MESH_BUDGET_PER_FRAME = 3;
const WORLD_SEED = 20261014;

class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world = new World(WORLD_SEED);
  private readonly chunkRenderer: ChunkRenderer;

  private yaw = 0;
  private pitch = -0.22;
  private readonly position = new THREE.Vector3(8.5, 64, 8.5);
  private readonly keys = new Set<string>();
  private locked = false;

  private frames = 0;
  private fpsTimer = 0;
  private fps = 0;
  private lastTime = performance.now();
  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;
  private ready = false;

  constructor(
    container: HTMLElement,
    private readonly debugEl: HTMLElement,
    private readonly overlayEl: HTMLElement,
    atlas: TextureAtlas,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    const sky = new THREE.Color(0x8fc7ff);
    this.scene.background = sky;

    const fogFar = VIEW_DISTANCE * 16;
    this.scene.fog = new THREE.Fog(sky, (VIEW_DISTANCE - 3) * 16, fogFar - 8);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, fogFar + 32);
    this.camera.rotation.order = 'YXZ';

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(0.55, 1, 0.35).normalize();
    this.scene.add(sun);

    const solidMaterial = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      alphaTest: 0.5,
      side: THREE.FrontSide,
    });
    const translucentMaterial = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.chunkRenderer = new ChunkRenderer(this.scene, atlas, this.world, solidMaterial, translucentMaterial);
    this.world.events = {
      onChunkLoaded: (chunk) => {
        this.chunkRenderer.onChunkLoaded(chunk.cx, chunk.cz);
        this.refreshLoadingState();
      },
      onChunkUnloaded: (cx, cz) => {
        this.chunkRenderer.onChunkUnloaded(cx, cz);
        this.refreshLoadingState();
      },
    };

    this.bindEvents();
    this.refreshWorld(0, 0, true);
  }

  private refreshWorld(centerCx: number, centerCz: number, force = false): void {
    if (!force && centerCx === this.lastCenterCx && centerCz === this.lastCenterCz) return;
    this.lastCenterCx = centerCx;
    this.lastCenterCz = centerCz;
    this.world.update(centerCx, centerCz, VIEW_DISTANCE);
  }

  private refreshLoadingState(): void {
    if (this.ready) return;
    if (!this.world.isIdle && this.chunkRenderer.chunkMeshCount > 0) {
      // 先让玩家看到地形再撤掉遮罩
      this.ready = true;
    }
  }

  private bindEvents(): void {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.renderer.domElement;
      this.overlayEl.classList.toggle('hidden', this.locked);
      if (!this.locked) this.keys.clear();
    });

    const requestLock = () => void this.renderer.domElement.requestPointerLock();
    this.overlayEl.addEventListener('click', requestLock);
    this.renderer.domElement.addEventListener('click', requestLock);

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      const limit = Math.PI / 2 - 0.001;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private updateMovement(dt: number): void {
    const boosted = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    const speed = (boosted ? 42 : 14) * dt;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = new THREE.Vector3();

    if (this.keys.has('KeyW')) move.add(forward);
    if (this.keys.has('KeyS')) move.sub(forward);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);
    if (this.keys.has('Space')) move.y += 1;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) move.y -= 1;

    if (move.lengthSq() > 0) this.position.addScaledVector(move.normalize(), speed);

    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private updateDebug(dt: number): void {
    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }

    const p = this.position;
    const cx = toChunkCoord(p.x);
    const cz = toChunkCoord(p.z);
    const facing = ['南 (+Z)', '西 (-X)', '北 (-Z)', '东 (+X)'][Math.round(-this.yaw / (Math.PI / 2)) & 3]!;
    const loading = this.world.pendingCount > 0 || this.chunkRenderer.queueLength > 0;

    this.debugEl.textContent =
      `Bedrock 1.18 Web  ·  P1 世界流式加载\n` +
      `${this.fps} fps   ${this.chunkRenderer.triangles.toLocaleString()} 三角形\n` +
      `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}\n` +
      `区块: ${cx}, ${cz}   朝向: ${facing}\n` +
      `视距: ${VIEW_DISTANCE} 区块   已渲染: ${this.chunkRenderer.chunkMeshCount}   已加载: ${this.world.chunks.size}\n` +
      `待生成: ${this.world.pendingCount}   待网格化: ${this.chunkRenderer.queueLength}   方块种类: ${BLOCKS.length}` +
      (loading ? '\n世界加载中…' : '');
  }

  start(): void {
    const loop = () => {
      const now = performance.now();
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;

      this.updateMovement(dt);

      const centerCx = toChunkCoord(this.position.x);
      const centerCz = toChunkCoord(this.position.z);
      this.refreshWorld(centerCx, centerCz);
      this.chunkRenderer.processQueue(MESH_BUDGET_PER_FRAME, centerCx, centerCz);

      this.renderer.render(this.scene, this.camera);
      this.updateDebug(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  dispose(): void {
    this.chunkRenderer.disposeAll();
    this.world.dispose();
  }
}

function boot(): void {
  const container = document.getElementById('app');
  const debugEl = document.getElementById('debug');
  const overlayEl = document.getElementById('overlay');
  const loadingEl = document.getElementById('loading');
  if (!container || !debugEl || !overlayEl) throw new Error('缺少必要的 DOM 节点');

  const atlas = new TextureAtlas();
  const app = new App(container, debugEl, overlayEl, atlas);
  loadingEl?.remove();
  app.start();
}

boot();
