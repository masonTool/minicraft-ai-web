/**
 * 跳一跳的**柱子渲染与相机**（J1，批次 20261022-2220）
 *
 * 与旧渲染层（已删）的区别只有一处、但很关键：**六个面可以贴不同的 tile**
 * （草方块 = 草顶 + 土侧 + 土底）。旧版只取 `tiles[0]` 铺满六面，所以草块侧面也是草。
 *
 * 四个刻意的做法：
 *
 *  1. **按 tile 组合分组**：一组 = 一个 `InstancedMesh`。一局里通常是 1~2 组
 *     （主题柱 + 特殊方块），draw call 也就 1~2 个。
 *  2. **UV 按面写**：`BoxGeometry` 的 24 个顶点按 `+X / -X / +Y / -Y / +Z / -Z`
 *     每 4 个一面；顶面用顶贴图、底面用底贴图、其余用侧贴图。
 *  3. **柱子每次重建**：一屏最多 5~6 根、每根一个矩阵，重建比"增量 diff"简单，
 *     也不会出现"跳走了但旧柱子还在"。
 *  4. **相机按跨度自适应**：当前与下一个方块的总跨度决定距离，横屏/竖屏各一个系数；
 *     跟随用指数插值（`1 - e^{-k·dt}`），与帧率无关。
 */

import * as THREE from 'three';
import type { TextureAtlas } from '../../../render/TextureAtlas.ts';
import { groupPillars, type PillarSpec } from './pillars.ts';
import type { JumpTheme } from './themes.ts';

export type { PillarSpec } from './pillars.ts';

export interface PillarSceneOptions {
  readonly atlas: TextureAtlas;
  readonly theme: JumpTheme;
}

/** 相机俯角与距离系数（`notes/jump-game.md` §4 的初值） */
const CAMERA_HEIGHT_RATIO = 0.72;
const CAMERA_BACK_RATIO = 0.58;
const CAMERA_SIDE_RATIO = 0.62;
const MIN_DISTANCE = 5.4;
/** 竖屏时把相机拉远多少（横屏为主场景） */
const PORTRAIT_PULLBACK = 1.25;

export class PillarScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly atlas: TextureAtlas;
  private readonly theme: JumpTheme;
  /** 所有组共用一份材质（差别只在各自几何体的 UV 上） */
  private readonly material: THREE.MeshLambertMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly groups: Array<{ mesh: THREE.InstancedMesh; specs: readonly PillarSpec[] }> = [];
  private readonly sky: THREE.Texture;

  private squash = 0;
  private readonly lookTarget = new THREE.Vector3(0, 0.6, 0);
  private readonly desired = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();

  constructor(options: PillarSceneOptions) {
    this.atlas = options.atlas;
    this.theme = options.theme;

    this.scene = new THREE.Scene();
    this.sky = createSkyTexture(options.theme);
    this.scene.background = this.sky;
    this.scene.fog = new THREE.Fog(options.theme.fog, 10, 34);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    const sun = new THREE.DirectionalLight(0xffffff, 0.72);
    sun.position.set(-1, 2.4, 1.6);
    this.scene.add(sun);

    this.material = new THREE.MeshLambertMaterial({ map: options.atlas.texture });

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
    this.camera.position.set(4, 5, 6);
    this.camera.lookAt(this.lookTarget);
  }

  /** 重建整屏柱子（先释放上一批几何） */
  setPillars(pillars: readonly PillarSpec[]): void {
    this.clearMeshes();

    for (const group of groupPillars(pillars, this.theme)) {
      const geometry = this.boxGeometry(group.top, group.side, group.bottom);
      const mesh = new THREE.InstancedMesh(geometry, this.material, group.specs.length);
      // 与旧版同一个坑：InstancedMesh 的包围球按单位立方体算，不关裁剪会整组消失
      mesh.frustumCulled = false;
      this.geometries.push(geometry);
      this.groups.push({ mesh, specs: group.specs });
      this.scene.add(mesh);
    }

    this.applyMatrices();
  }

  /** 蓄力压缩：只压"当前那根"（顶面下沉、底不动） */
  setSquash(amount: number): void {
    const next = Math.min(0.25, Math.max(0, Number.isFinite(amount) ? amount : 0));
    if (Math.abs(next - this.squash) < 1e-4) return;
    this.squash = next;
    this.applyMatrices();
  }

  /** 相机跟随：`current` 与 `next` 的中点作为注视点，跨度决定距离 */
  follow(current: { x: number; z: number; size: number }, next: { x: number; z: number; size: number }, dt: number): void {
    const cx = (current.x + next.x) / 2;
    const cz = (current.z + next.z) / 2;
    const span = Math.hypot(next.x - current.x, next.z - current.z) + (current.size + next.size) / 2;

    const aspect = this.camera.aspect;
    const portrait = aspect < 1.2 ? PORTRAIT_PULLBACK / Math.max(0.6, aspect) : 1;
    const distance = Math.max(MIN_DISTANCE, span * 1.35) * portrait;

    this.lookTarget.set(cx, 0.6, cz);
    this.desired.set(
      cx + distance * CAMERA_SIDE_RATIO,
      0.6 + distance * CAMERA_HEIGHT_RATIO,
      cz + distance * CAMERA_BACK_RATIO,
    );

    // 指数插值：帧率无关（dt 越大走越多，但不会越过目标）
    const k = 1 - Math.exp(-Math.max(0, dt) * 7);
    this.camera.position.lerp(this.desired, k);
    this.camera.lookAt(this.lookTarget);
  }

  /** 首帧直接对准（避免从初始位置飞过来） */
  snap(current: { x: number; z: number; size: number }, next: { x: number; z: number; size: number }): void {
    this.follow(current, next, 0);
    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.lookTarget);
  }

  setViewport(width: number, height: number): void {
    this.camera.aspect = Math.max(0.01, width / Math.max(1, height));
    this.camera.updateProjectionMatrix();
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clearMeshes();
    this.material.dispose();
    this.sky.dispose();
    this.scene.clear();
  }

  // ---------------------------------------------------------------- 内部

  private boxGeometry(topTile: string, sideTile: string, bottomTile: string): THREE.BoxGeometry {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;

    // BoxGeometry 的顶点顺序：+X, -X, +Y, -Y, +Z, -Z，每面 4 个顶点
    const tiles = [sideTile, sideTile, topTile, bottomTile, sideTile, sideTile];
    for (let face = 0; face < 6; face++) {
      const [u0, v0, u1, v1] = this.atlas.uv(tiles[face]!);
      for (let i = face * 4; i < face * 4 + 4; i++) {
        // 先读再写：`setXY` 会同时改 u/v
        const u = uv.getX(i);
        const v = uv.getY(i);
        uv.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0));
      }
    }
    uv.needsUpdate = true;
    return geometry;
  }

  private applyMatrices(): void {
    for (const group of this.groups) {
      group.specs.forEach((spec, index) => {
        const squash = spec.current ? this.squash : 0;
        // 顶面下沉、底面不动：中心 y = (1 - squash) / 2
        this.position.set(spec.x, (1 - squash) / 2, spec.z);
        this.scale.set(spec.size, 1 - squash, spec.size);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        group.mesh.setMatrixAt(index, this.matrix);
      });
      group.mesh.instanceMatrix.needsUpdate = true;
      group.mesh.computeBoundingSphere();
    }
  }

  private clearMeshes(): void {
    for (const group of this.groups) this.scene.remove(group.mesh);
    this.groups.length = 0;
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.length = 0;
  }
}

/** 天空渐变：2×256 的 canvas，three 会把它拉伸铺满背景 */
function createSkyTexture(theme: JumpTheme): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, theme.skyTop);
    gradient.addColorStop(1, theme.skyBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
