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
import { VoxelMaterial } from './render/VoxelMaterial.ts';
import { World, toChunkCoord } from './core/world/World.ts';
import { BLOCKS } from './core/registry/blocks.ts';

/** 渲染距离（区块） */
const VIEW_DISTANCE = 10;
/** 每帧最多网格化的区块数，用于把加载耗时摊到多帧 */
const MESH_BUDGET_PER_FRAME = 3;
/** 每帧最多处理的光照 BFS 步数 */
const LIGHT_BUDGET_PER_FRAME = 120000;
const WORLD_SEED = 20261014;

class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world = new World(WORLD_SEED);
  private readonly chunkRenderer: ChunkRenderer;
  private readonly solidMaterial: VoxelMaterial;
  private readonly translucentMaterial: VoxelMaterial;
  private readonly skyColor: THREE.Color;

  /** 一天中的时刻 [0,1)：0 = 日出，0.25 = 正午，0.5 = 日落，0.75 = 午夜 */
  private timeOfDay = 0.12;
  /** 一个游戏日为 20 分钟（与原版一致），首帧先给个初值避免除零 */
  private readonly dayLengthSeconds = 1200;

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

    this.skyColor = new THREE.Color(0x8fc7ff);
    this.scene.background = this.skyColor;

    const fogFar = VIEW_DISTANCE * 16;
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, fogFar + 32);
    this.camera.rotation.order = 'YXZ';

    this.solidMaterial = new VoxelMaterial(atlas.texture);
    this.translucentMaterial = new VoxelMaterial(atlas.texture, { translucent: true });
    this.applyEnvironment();

    this.chunkRenderer = new ChunkRenderer(
      this.scene,
      atlas,
      this.world,
      this.solidMaterial.material,
      this.translucentMaterial.material,
    );
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

  /**
   * 把时间换算成天空亮度与天空颜色，推给材质与场景。
   * 因为光照等级是烘焙在顶点属性里的，这里每帧只改 uniform，开销可以忽略。
   */
  private applyEnvironment(): void {
    // 约定：t=0 日出(06:00)、t=0.25 正午、t=0.5 日落(18:00)、t=0.75 午夜
    const sunHeight = Math.sin(this.timeOfDay * Math.PI * 2);
    const daylight = smoothstep(-0.25, 0.35, sunHeight);
    // 夜晚天光倍率下限 0.2，对应原版夜间天光被大幅压暗
    const skyBrightness = 0.2 + 0.8 * daylight;

    this.skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, daylight);
    this.solidMaterial.skyBrightness = skyBrightness;
    this.translucentMaterial.skyBrightness = skyBrightness;

    const fogFar = VIEW_DISTANCE * 16 - 8;
    const fogNear = (VIEW_DISTANCE - 3) * 16;
    this.solidMaterial.setFog(this.skyColor, fogNear, fogFar);
    this.translucentMaterial.setFog(this.skyColor, fogNear, fogFar);
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
    // yaw=0 时朝向 (-sin, 0, -cos) = -Z，即原版定义的"北"
    const facing = ['北 (-Z)', '东 (+X)', '南 (+Z)', '西 (-X)'][Math.round(-this.yaw / (Math.PI / 2)) & 3]!;
    const loading = this.world.pendingCount > 0 || this.chunkRenderer.queueLength > 0;

    const clockHours = (this.timeOfDay * 24 + 6) % 24;
    const clock = `${String(Math.floor(clockHours)).padStart(2, '0')}:${String(Math.floor((clockHours % 1) * 60)).padStart(2, '0')}`;

    this.debugEl.textContent =
      `Bedrock 1.18 Web  ·  P1 光照 + 环境光遮蔽 + 平滑光照\n` +
      `${this.fps} fps   ${this.chunkRenderer.triangles.toLocaleString()} 三角形\n` +
      `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}\n` +
      `区块: ${cx}, ${cz}   朝向: ${facing}   时间: ${clock}\n` +
      `视距: ${VIEW_DISTANCE} 区块   已渲染: ${this.chunkRenderer.chunkMeshCount}   已加载: ${this.world.chunks.size}\n` +
      `待生成: ${this.world.pendingCount}   待网格化: ${this.chunkRenderer.queueLength}\n` +
      `已点亮: ${this.world.litChunkCount}   光照队列: ${this.world.light.pendingCells}   方块种类: ${BLOCKS.length}` +
      (loading ? '\n世界加载中…' : '');
  }

  start(): void {
    const loop = () => {
      const now = performance.now();
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;

      this.updateMovement(dt);
      this.timeOfDay = (this.timeOfDay + dt / this.dayLengthSeconds) % 1;
      this.applyEnvironment();

      const centerCx = toChunkCoord(this.position.x);
      const centerCz = toChunkCoord(this.position.z);
      this.refreshWorld(centerCx, centerCz);

      // 先让光照收敛，再网格化：避免用未稳定的光照值生成顶点数据后又要重刷
      const lightBusy = this.world.processLighting(LIGHT_BUDGET_PER_FRAME);
      if (!lightBusy) this.chunkRenderer.processQueue(MESH_BUDGET_PER_FRAME, centerCx, centerCz);

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

  // ---------------------------------------------------------------- 开发调试接口
  // 供开发/自动化验收使用：精确定位相机、设置时间，便于复现与截图对比。

  teleport(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
  }

  /** 单位：度。yaw 0 = 看向 -Z（北），pitch 为正表示向上看 */
  look(yawDeg: number, pitchDeg: number): void {
    this.yaw = (yawDeg * Math.PI) / 180;
    this.pitch = (pitchDeg * Math.PI) / 180;
  }

  setTimeOfDay(t: number): void {
    this.timeOfDay = ((t % 1) + 1) % 1;
    this.applyEnvironment();
  }

  get info(): { fps: number; chunks: number; lit: number; triangles: number } {
    return {
      fps: this.fps,
      chunks: this.world.chunks.size,
      lit: this.world.litChunkCount,
      triangles: this.chunkRenderer.triangles,
    };
  }
}

// ---------------------------------------------------------------- 启动与环境色

const DAY_SKY = new THREE.Color(0x8fc7ff);
const NIGHT_SKY = new THREE.Color(0x040814);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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

  // 开发调试入口：控制台或自动化脚本可通过 window.__mc 精确定位与取样
  (window as unknown as { __mc: App }).__mc = app;
}

boot();
