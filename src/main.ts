/**
 * P0 入口：验证渲染管线
 *
 * 当前包含一块临时的正弦地形（P2 会用 1.18 的多噪声地形生成器替换），
 * 目的是先打通：方块注册表 → 区块存储 → 网格化 → 图集 → 渲染 → 自由相机。
 */

import * as THREE from 'three';
import { TextureAtlas } from './render/TextureAtlas.ts';
import { Chunk, SECTION_COUNT, WORLD_MIN_Y } from './core/world/Chunk.ts';
import { meshSection } from './core/mesh/ChunkMesher.ts';
import { Block, BLOCKS } from './core/registry/blocks.ts';

const CHUNK_GRID = 5; // 5×5 个区块
const WATER_LEVEL = 20;

// ---------------------------------------------------------------- 临时地形（P2 替换）

function heightAt(wx: number, wz: number): number {
  return Math.floor(
    20 +
      5.5 * Math.sin(wx / 34) +
      4.5 * Math.cos(wz / 29) +
      2.5 * Math.sin((wx + wz) / 15) +
      1.6 * Math.cos((wx - wz) / 9),
  );
}

function hash2(x: number, z: number, salt = 0): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 0xffffffff;
}

function generateChunk(chunk: Chunk): void {
  const originX = chunk.cx * 16;
  const originZ = chunk.cz * 16;

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const h = heightAt(originX + x, originZ + z);
      for (let y = 0; y <= h; y++) {
        let id: number;
        if (y === 0) id = Block.BEDROCK;
        else if (y < h - 3) id = Block.STONE;
        else if (y < h) id = Block.DIRT;
        else id = h <= WATER_LEVEL ? Block.SAND : Block.GRASS_BLOCK;
        chunk.set(x, y, z, id);
      }
      for (let y = h + 1; y <= WATER_LEVEL; y++) chunk.set(x, y, z, Block.WATER);
    }
  }

  // 稀疏树木，用于验证镂空（alphaTest）渲染路径
  const treeCount = hash2(chunk.cx, chunk.cz, 7) > 0.72 ? 2 : 1;
  for (let t = 0; t < treeCount; t++) {
    const lx = 3 + Math.floor(hash2(chunk.cx, chunk.cz, 11 + t) * 10);
    const lz = 3 + Math.floor(hash2(chunk.cx, chunk.cz, 23 + t) * 10);
    const ground = heightAt(originX + lx, originZ + lz);
    if (ground <= WATER_LEVEL) continue;
    const trunkHeight = 4 + Math.floor(hash2(chunk.cx, chunk.cz, 31 + t) * 3);
    for (let i = 1; i <= trunkHeight; i++) chunk.set(lx, ground + i, lz, Block.OAK_LOG);
    const top = ground + trunkHeight;
    for (let dy = -2; dy <= 1; dy++) {
      const radius = dy <= -1 ? 2 : 1;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0 && dy <= 0) continue;
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && hash2(lx + dx, lz + dz, dy) > 0.5) continue;
          const px = lx + dx;
          const pz = lz + dz;
          if (px < 0 || px > 15 || pz < 0 || pz > 15) continue;
          if (chunk.get(px, top + dy, pz) === Block.AIR) chunk.set(px, top + dy, pz, Block.OAK_LEAVES);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 应用

class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly chunks = new Map<string, Chunk>();
  private readonly solidMaterial: THREE.MeshLambertMaterial;
  private readonly translucentMaterial: THREE.MeshLambertMaterial;

  private yaw = 0;
  private pitch = -0.25;
  private readonly position = new THREE.Vector3(0, 46, 30);
  private readonly keys = new Set<string>();
  private locked = false;

  private frames = 0;
  private fpsTimer = 0;
  private fps = 0;
  private lastTime = performance.now();
  private triangles = 0;

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
    this.scene.fog = new THREE.Fog(sky, 90, 220);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera.rotation.order = 'YXZ';

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(0.55, 1, 0.35).normalize();
    this.scene.add(sun);

    this.solidMaterial = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      alphaTest: 0.5,
      side: THREE.FrontSide,
    });
    this.translucentMaterial = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.buildWorld(atlas);
    this.bindEvents();
  }

  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  private buildWorld(atlas: TextureAtlas): void {
    const half = Math.floor(CHUNK_GRID / 2);
    for (let cz = -half; cz <= half; cz++) {
      for (let cx = -half; cx <= half; cx++) {
        const chunk = new Chunk(cx, cz);
        generateChunk(chunk);
        this.chunks.set(this.key(cx, cz), chunk);
      }
    }

    const neighbor = (worldX: number, worldY: number, worldZ: number): number => {
      const chunk = this.chunks.get(this.key(worldX >> 4, worldZ >> 4));
      if (!chunk) return 0;
      return chunk.get(worldX & 15, worldY, worldZ & 15);
    };

    for (const chunk of this.chunks.values()) {
      for (let section = 0; section < SECTION_COUNT; section++) {
        if (chunk.sectionIsEmpty(section)) continue;
        const { solid, translucent } = meshSection(chunk, section, atlas, neighbor);
        const baseY = WORLD_MIN_Y + section * 16;
        if (solid) {
          const mesh = new THREE.Mesh(solid, this.solidMaterial);
          mesh.position.set(chunk.cx * 16, baseY, chunk.cz * 16);
          this.scene.add(mesh);
          this.triangles += solid.index!.count / 3;
        }
        if (translucent) {
          const mesh = new THREE.Mesh(translucent, this.translucentMaterial);
          mesh.position.set(chunk.cx * 16, baseY, chunk.cz * 16);
          this.scene.add(mesh);
          this.triangles += translucent.index!.count / 3;
        }
      }
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
    const speed = (this.keys.has('ControlLeft') || this.keys.has('ControlRight') ? 42 : 14) * dt;
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
    const facing = ['南 (+Z)', '西 (-X)', '北 (-Z)', '东 (+X)'][Math.round(-this.yaw / (Math.PI / 2)) & 3]!;
    this.debugEl.textContent =
      `Bedrock 1.18 Web  ·  P0 渲染管线验证\n` +
      `${this.fps} fps   ${this.triangles.toLocaleString()} 三角形\n` +
      `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}\n` +
      `区块: ${p.x >> 4}, ${p.z >> 4}   朝向: ${facing}\n` +
      `已加载区块: ${this.chunks.size}   注册方块数: ${registeredBlockCount()}`;
  }

  start(): void {
    const loop = () => {
      const now = performance.now();
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;
      this.updateMovement(dt);
      this.renderer.render(this.scene, this.camera);
      this.updateDebug(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

// ---------------------------------------------------------------- 启动

function registeredBlockCount(): number {
  return BLOCKS.length;
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
