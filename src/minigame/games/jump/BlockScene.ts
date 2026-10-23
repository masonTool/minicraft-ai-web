/**
 * 跳一跳的**等距纯色方块场景**（批次 20261024-0415，`[跳3]`）
 *
 * 取代旧的 `PillarScene`（MC 透视相机 + 图集贴图的草/雪/沙漠柱子）。区别不是"换了套
 * 更漂亮的贴图"，而是整条渲染路子都换了：
 *
 *  · **正交相机 + 30° 俯角**：取景由 `iso.ts` 的 `frameBlocks()` 反解，横竖屏同一套公式；
 *  · **不打光**：三面亮度（顶 1.00 / 左 0.775 / 右 0.93）直接烘进顶点色，材质是
 *    `MeshBasicMaterial`。原版方块本来就是纯哑光纯色，用灯去凑那三个比值只会
 *    "差 5° 就变味"，而且省掉一整套阴影贴图；
 *  · **不要图集、不要雾**：`MiniGameContext.atlas` 继续由宿主传入，但跳一跳不再读它；
 *  · **阴影是贴片不是阴影贴图**：方块下面垫一张柔边圆角方片，往世界 −x/+z 偏移
 *    （屏幕上就是左下），浓度 35% 紫灰。原版没有可见地面，阴影其实也是贴片。
 *
 * 释放契约与旧版一致：`dispose()` 之后 `renderer.info.memory` 回到进场前的值——
 * 三份几何（方盒 / 圆柱 / 阴影片）、颜色材质缓存、两张 canvas 贴图、场景本体全部还清。
 */

import * as THREE from 'three';
import {
  BLOCK_HEIGHT_RATIO,
  JUMPER_HEIGHT_RATIO,
  boxesFromBlocks,
  frameBlocks,
  type IsoFrame,
} from './iso.ts';
import {
  SHADOW_COLOR,
  SHADOW_OPACITY,
  blockColorAt,
  shadeForNormal,
  type JumpPalette,
} from './palette.ts';
import type { JumpBlockKind } from './logic.ts';

/** 屏幕上的一块方块（渲染层只要这些，不认识 run / 计分） */
export interface BlockSpec {
  readonly x: number;
  readonly z: number;
  /** 边长（世界单位） */
  readonly size: number;
  readonly kind: JumpBlockKind;
  /** 是不是"当前站着的"那块（蓄力时它会轻微下压） */
  readonly current: boolean;
}

/** 蓄力时当前方块最多压掉多少高度（规格表 §8：y → 0.8） */
const MAX_SQUASH = 0.2;
/** 阴影贴片相对方块尺寸的放大倍数（柔边要占出去一圈） */
const SHADOW_SPREAD = 1.9;
/** 阴影在**世界**里的偏移：屏幕上看是"左下"（光照来自 +x/−z） */
const SHADOW_OFFSET = { x: -0.43, z: 0.71 };
/** 相机跟随的指数插值系数（越大跟得越紧） */
const FOLLOW_RATE = 8;

interface BlockEntry {
  readonly spec: BlockSpec;
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  /** 方块未压缩时的高度 */
  readonly height: number;
}

export class BlockScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;

  private palette: JumpPalette;
  private readonly blockGeometry: THREE.BufferGeometry;
  private readonly cylinderGeometry: THREE.BufferGeometry;
  private readonly shadowGeometry: THREE.PlaneGeometry;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly shadowTexture: THREE.Texture;
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>();

  private backgroundTexture: THREE.Texture;
  private entries: BlockEntry[] = [];
  private viewport = { width: 1, height: 1 };
  private aspect = 1;
  private squash = 0;
  /** 已经应用到相机上的取景（插值用）；`null` = 下一帧直接对准 */
  private applied: {
    halfHeight: number;
    centerX: number;
    centerY: number;
    centerZ: number;
  } | null = null;

  constructor(palette: JumpPalette) {
    this.palette = palette;
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.backgroundTexture = createBackgroundTexture(palette);
    this.scene.background = this.backgroundTexture;

    this.blockGeometry = bakeFaceShading(new THREE.BoxGeometry(1, 1, 1));
    // 圆柱也给一份：音乐盒是唱片机（圆盘），圆得比方盒自然
    this.cylinderGeometry = bakeFaceShading(new THREE.CylinderGeometry(0.5, 0.5, 1, 40, 1));

    this.shadowTexture = createShadowTexture();
    this.shadowGeometry = new THREE.PlaneGeometry(1, 1);
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: this.shadowTexture,
      color: new THREE.Color(SHADOW_COLOR),
      transparent: true,
      opacity: SHADOW_OPACITY,
      depthWrite: false,
    });

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.set(4, 4, 4);
    this.camera.lookAt(0, 0, 0);
  }

  // ---------------------------------------------------------------- 外部

  setViewport(width: number, height: number): void {
    const w = Number.isFinite(width) && width > 0 ? width : 1;
    const h = Number.isFinite(height) && height > 0 ? height : 1;
    this.viewport = { width: w, height: h };
    this.aspect = Math.min(5, Math.max(0.2, w / h));
    // 换视口时不要从上一屏的取景插值过来
    this.applied = null;
  }

  /** 换一局的色板（背景渐变 + 方块配色） */
  setPalette(palette: JumpPalette): void {
    if (palette.id === this.palette.id) return;
    this.palette = palette;
    this.backgroundTexture.dispose();
    this.backgroundTexture = createBackgroundTexture(palette);
    this.scene.background = this.backgroundTexture;
    this.setBlocks(this.entries.map((entry) => entry.spec));
  }

  /** 重建整屏方块（一帧最多 6 块，重建比增量维护简单） */
  setBlocks(specs: readonly BlockSpec[]): void {
    this.clearEntries();
    specs.forEach((spec, index) => {
      const height = Math.max(0.05, spec.size * BLOCK_HEIGHT_RATIO);
      const geometry = spec.kind === 'music' ? this.cylinderGeometry : this.blockGeometry;
      const mesh = new THREE.Mesh(geometry, this.materialFor(blockColorAt(this.palette, index)));
      mesh.position.set(spec.x, height / 2, spec.z);
      mesh.scale.set(spec.size, height, spec.size);
      mesh.renderOrder = 1;
      this.scene.add(mesh);

      const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(
        spec.x + SHADOW_OFFSET.x * spec.size,
        0.001,
        spec.z + SHADOW_OFFSET.z * spec.size,
      );
      shadow.scale.set(spec.size * SHADOW_SPREAD, spec.size * SHADOW_SPREAD, 1);
      // 阴影永远画在方块之前，避免透明片盖住方块本体
      shadow.renderOrder = 0;
      this.scene.add(shadow);

      this.entries.push({ spec, mesh, shadow, height });
    });
    this.applySquash();
  }

  /** 蓄力压缩：只压"当前那块"（顶面下沉、底面不动），0 = 不压 */
  setSquash(amount: number): void {
    const next = Math.min(MAX_SQUASH, Math.max(0, Number.isFinite(amount) ? amount : 0));
    if (Math.abs(next - this.squash) < 1e-4) return;
    this.squash = next;
    this.applySquash();
  }

  /**
   * 相机跟随：把这一帧要画的方块交给 `iso.frameBlocks()`，再插值过去。
   *
   * `dt <= 0` 表示"直接对准"（开局 / 重开时用，避免从上一局的位置飞过来）。
   */
  follow(dt: number): void {
    const frame = this.nextFrame();
    const k = dt > 0 ? 1 - Math.exp(-dt * FOLLOW_RATE) : 1;
    if (!this.applied) {
      this.applied = {
        halfHeight: frame.top,
        centerX: frame.target.x,
        centerY: frame.target.y,
        centerZ: frame.target.z,
      };
    } else {
      this.applied.halfHeight += (frame.top - this.applied.halfHeight) * k;
      this.applied.centerX += (frame.target.x - this.applied.centerX) * k;
      this.applied.centerY += (frame.target.y - this.applied.centerY) * k;
      this.applied.centerZ += (frame.target.z - this.applied.centerZ) * k;
    }
    this.applyCamera(frame);
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clearEntries();
    this.blockGeometry.dispose();
    this.cylinderGeometry.dispose();
    this.shadowGeometry.dispose();
    this.shadowMaterial.dispose();
    this.shadowTexture.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.backgroundTexture.dispose();
    this.scene.clear();
    this.scene.background = null;
  }

  // ---------------------------------------------------------------- 内部

  /**
   * 本帧的目标取景。
   *
   * 只把"当前块前后各一块"交给取景器：原版一屏就是 3~4 块，交太多会被压得看不清；
   * 交太少则下一块可能贴边。头位按小人高度留（否则蓄力时头顶会顶出画面）。
   */
  private nextFrame(): IsoFrame {
    const currentIndex = Math.max(0, this.entries.findIndex((entry) => entry.spec.current));
    const from = Math.max(0, currentIndex - 1);
    const to = Math.min(this.entries.length - 1, currentIndex + 2);
    const specs = this.entries.slice(from, to + 1).map((entry) => entry.spec);
    const focus = this.entries[currentIndex]?.spec;
    const headroom = focus ? focus.size * JUMPER_HEIGHT_RATIO : 0;
    return frameBlocks({
      boxes: boxesFromBlocks(specs),
      focusIndex: currentIndex - from,
      width: this.viewport.width,
      height: this.viewport.height,
      headroom,
    });
  }

  private applyCamera(frame: IsoFrame): void {
    const applied = this.applied;
    if (!applied) return;

    const halfHeight = applied.halfHeight;
    const halfWidth = halfHeight * this.aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.near = frame.near;
    this.camera.far = frame.far;

    // 目标与相机的位置差固定（正交下只影响裁剪）：用刚算出来的 frame 定方向
    const dirX = frame.position.x - frame.target.x;
    const dirY = frame.position.y - frame.target.y;
    const dirZ = frame.position.z - frame.target.z;
    this.camera.position.set(applied.centerX + dirX, applied.centerY + dirY, applied.centerZ + dirZ);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(applied.centerX, applied.centerY, applied.centerZ);
    this.camera.updateProjectionMatrix();
  }

  private applySquash(): void {
    for (const entry of this.entries) {
      const factor = entry.spec.current ? 1 - this.squash : 1;
      const height = entry.height * factor;
      entry.mesh.scale.y = height;
      entry.mesh.position.y = height / 2;
    }
  }

  private materialFor(color: string): THREE.MeshBasicMaterial {
    const cached = this.materials.get(color);
    if (cached) return cached;
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), vertexColors: true });
    this.materials.set(color, material);
    return material;
  }

  private clearEntries(): void {
    for (const entry of this.entries) {
      this.scene.remove(entry.mesh);
      this.scene.remove(entry.shadow);
    }
    this.entries = [];
  }
}

// ------------------------------------------------------------------ 贴图

/**
 * 把三面明暗按顶点法线烘进顶点色。
 *
 * 顶点色在 three 里是**线性**空间的值，而我们要的是"显示出来的 sRGB 亮度正好是
 * 0.775 / 0.93"，所以先按 sRGB 构造再转线性——不转的话侧面会比原版亮一截
 * （0.775 在 sRGB 里等于线性 0.57）。
 */
function bakeFaceShading(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const normal = geometry.getAttribute('normal');
  const colors = new Float32Array(normal.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < normal.count; i++) {
    const shade = shadeForNormal(normal.getX(i), normal.getY(i), normal.getZ(i));
    color.setRGB(shade, shade, shade, THREE.SRGBColorSpace);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** 背景：2×N 的竖直渐变（three 会把它拉满整屏），无雾、无地面 */
function createBackgroundTexture(palette: JumpPalette): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, palette.background.top);
    gradient.addColorStop(1, palette.background.bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 阴影贴片：柔边圆角方片。
 *
 * 用"径向渐变 + 圆角矩形裁剪"而不是 CSS `filter: blur`——后者在部分浏览器里
 * 要额外的 GPU 通道，而这里就是一张 128×128 的小图，一次生成反复用。
 */
function createShadowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const radius = size * 0.22;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(0, 0, size, size, radius);
    } else {
      ctx.rect(0, 0, size, size);
    }
    ctx.clip();
    const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.52);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.62, 'rgba(255,255,255,0.75)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
