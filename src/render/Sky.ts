/**
 * 天空：渐变穹顶 + 太阳 / 月亮 + 星空 + 云层
 *
 * 全部挂在跟随相机的一个 Group 上，因此不需要"无限大"的天球：
 *   - 穹顶半径小于相机远裁面，用 depthTest:false + renderOrder:-1000 先铺底，
 *     地形随后正常盖在上面；
 *   - 太阳 / 月亮 / 星星开深度测试，于是"躲进洞里就看不见太阳"，与原版一致；
 *   - 云层是 y=192 的一层平面（原版云高度），只跟随相机的水平坐标，所以
 *     玩家上升下降时云会从身边掠过，而不是黏在镜头上。
 */

import * as THREE from 'three';
import { MOON_PHASE_COUNT, moonShape } from '../core/world/MoonPhase.ts';
import { GLSL_DITHER } from './dither.ts';

const DOME_RADIUS = 180;
const CELESTIAL_DISTANCE = 150;

/**
 * 天空层里**最远**的那个半径（穹顶 180、星星 170、日月 150）。
 *
 * ⚠️ 相机的远裁面必须罩得住它。穹顶的球心就在相机上（`Sky.update` 里
 * `object.position.copy(cameraPosition)`），所以一旦 `camera.far` 小于它，
 * 被裁掉的必定是**屏幕正中间**那一块——表现是"视角正中有一个很明显的圆形边缘、
 * 颜色与周围不一样"（中心露出的是 `scene.background` 那个纯色，周围才是穹顶的渐变色）。
 */
export const SKY_MAX_RADIUS = DOME_RADIUS;

/**
 * 某个视距对应的相机远裁面。
 *
 * 取两式的较大者：`视距×16 + 32`（地形最远画到视距那一圈）与 `SKY_MAX_RADIUS + 32`。
 *
 * ⚠️ 后一式不能省：视距 4~8 时前一式只有 96~160，**比穹顶半径还小**，天空会在
 * 屏幕正中缺一块（视距 6 时连日月都在 150 处，一样被裁掉）。桌面视距 12 得 224，
 * 本来就罩得住 —— 所以这个洞**只在小视距下出现**，手机上必有。
 */
export function cameraFarFor(viewDistance: number): number {
  const terrain = Math.max(0, Number.isFinite(viewDistance) ? viewDistance : 0) * 16 + 32;
  return Math.max(terrain, SKY_MAX_RADIUS + 32);
}

/**
 * 世界相机的**近裁面**（格）。
 *
 * 原来取 0.1（桌面 FPS 的习惯），但这个世界里没有任何东西会离镜头小于 0.25 格：
 * 手持物品走的是独立相机（`HandRenderer`，near 0.02），玩家眼睛在方块中心，
 * 最近的可见面也在 0.5 格外。深度缓冲的精度与 near 成正比，抬到 0.25 等于
 * 白拿 2.5 倍精度 —— 远景里"方块贴方块"的共面闪烁正是精度不够的典型症状。
 */
export const CAMERA_NEAR = 0.25;
/** 原版主世界云层高度 */
export const CLOUD_HEIGHT = 192;
const CLOUD_PLANE_SIZE = 900;
const STAR_COUNT = 600;

const DOME_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DOME_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform float uSunGlow;
varying vec3 vDir;

${GLSL_DITHER}

void main() {
  float h = clamp(vDir.y, -1.0, 1.0);
  vec3 color = mix(uHorizon, uTop, smoothstep(-0.08, 0.5, h));
  // 日出日落时太阳附近泛橙红（霞光）
  float glow = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 8.0) * uSunGlow;
  color += vec3(1.0, 0.52, 0.22) * glow;
  // 抖色（批次 425）：天空是横跨整个屏幕的平滑渐变，8 bit 输出在夜里会出台阶状
  // 色带（白天也有一条条很淡的横纹）。±0.5/255 的有序抖动把台阶打散。见 dither.ts
  gl_FragColor = vec4(ditherColor(color, gl_FragCoord.xy), 1.0);
}
`;

/** 圆形贴图（太阳 / 月亮），带一点边缘柔化 */
function discTexture(inner: string, outer: string): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(0.72, inner);
    gradient.addColorStop(1, outer);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** 程序化云纹理：块状噪声 + 柔化，得到原版那种方方正正的云 */
function cloudTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();

  const image = ctx.createImageData(size, size);
  const data = image.data;

  /** 生成 cell×cell 像素的随机格点，取值会被双线性插值 */
  const makeGrid = (cell: number, salt: number): { grid: Float32Array; count: number } => {
    const count = size / cell;
    const grid = new Float32Array(count * count);
    let seed = (0x9e3779b9 ^ Math.imul(cell, 0x27d4eb2d) ^ salt) >>> 0;
    const rand = (): number => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed / 0xffffffff;
    };
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    return { grid, count };
  };

  const layers = [makeGrid(4, 1), makeGrid(8, 2), makeGrid(16, 3)];

  const sample = (layer: { grid: Float32Array; count: number }, gx: number, gz: number): number => {
    const { grid, count } = layer;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const tx = gx - x0;
    const tz = gz - z0;
    const at = (x: number, z: number): number => grid[(((z % count) + count) % count) * count + (((x % count) + count) % count)]!;
    const a = at(x0, z0);
    const b = at(x0 + 1, z0);
    const c = at(x0, z0 + 1);
    const d = at(x0 + 1, z0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const coarse = sample(layers[0]!, x / 4, z / 4);
      const mid = sample(layers[1]!, x / 8, z / 8);
      const big = sample(layers[2]!, x / 16, z / 16);
      const value = coarse * 0.4 + mid * 0.35 + big * 0.25;
      // 阈值化 + 边缘柔化，做成"有形状的云块"而不是均匀雾
      const alpha = Math.max(0, Math.min(1, (value - 0.52) * 4));
      const px = (z * size + x) * 4;
      data[px] = 255;
      data[px + 1] = 255;
      data[px + 2] = 255;
      data[px + 3] = Math.round(alpha * 205);
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.colorSpace = THREE.NoColorSpace;
  // 批次 425：云层是一整片 900×900 的平面，玩家几乎总是**斜着**看它（地平线附近）。
  // 没有各向异性时 LOD 由长轴决定，云的边缘会被糊成一片并在走动时闪。
  // 这张是独立贴图（不在图集里），开各向异性没有渗色问题——three 会按设备上限夹住。
  texture.anisotropy = 4;
  return texture;
}

/**
 * 月亮贴图（批次 84，月相）：按 `moonShape()` 给的几何画 8 张（`Sky` 只负责画）。
 *
 * 画法三步（与 `MoonPhase.ts` 的注释一一对应）：
 *  1. 整盘铺**暗色**（新月那种"地球照"的淡轮廓，不是纯黑——纯黑在夜空里会像挖了个洞）；
 *  2. 画**亮的那半边**；
 *  3. 用一个横半径 `ellipseRx` 的椭圆**加（凸月）或减（残月）**一块。
 *
 * 边界都落在"画法本身"上：满月 rx=1 加 → 整盘亮；新月 rx=1 减 → 整盘暗；弦月 rx=0 → 正好一半。
 */
function moonTexture(phase: number): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const shape = moonShape(phase);
  const r = size / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;

  if (ctx) {
    const disc = (fill: string): void => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    };
    const DARK = 'rgba(64,70,92,0.85)';
    const LIT = 'rgba(238,242,252,1)';

    // 外圈柔光（原版的月亮边缘有一点毛边）
    const glow = ctx.createRadialGradient(cx, cy, r * 0.86, cx, cy, r * 1.12);
    glow.addColorStop(0, shape.lit > 0.05 ? 'rgba(226,234,248,0.55)' : 'rgba(180,188,210,0.28)');
    glow.addColorStop(1, 'rgba(200,214,238,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    // 1) 整盘暗色
    disc(DARK);

    // 2) 亮的那半边
    const rightSide = shape.litHalf === 'right';
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, rightSide ? -Math.PI / 2 : Math.PI / 2, rightSide ? Math.PI / 2 : (Math.PI * 3) / 2);
    ctx.closePath();
    ctx.fillStyle = LIT;
    ctx.fill();
    ctx.restore();

    // 3) 椭圆补/挖（rx = 0 时这一笔画不出东西，正好是"上下弦"）
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * shape.ellipseRx, r, 0, 0, Math.PI * 2);
    ctx.clip();
    disc(shape.ellipseMode === 'add' ? LIT : DARK);
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

export class Sky {
  readonly object = new THREE.Group();

  private readonly domeMaterial: THREE.ShaderMaterial;
  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly cloudMaterial: THREE.MeshBasicMaterial;
  private readonly cloudMesh: THREE.Mesh;
  /** 云是否可见（设置里可以关掉：省一点填充率，也能看清远处地形） */
  private cloudsVisible = true;
  /** 8 张月相贴图（批次 84）：懒建，第一次用到哪一张就画哪一张 */
  private readonly moonTextures: (THREE.Texture | null)[] = new Array(MOON_PHASE_COUNT).fill(null);
  /** 现在挂的是哪一个相（避免每帧重复设 map） */
  private moonPhase = -1;

  constructor() {
    // ---- 渐变穹顶
    this.domeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(0x4a86ff) },
        uHorizon: { value: new THREE.Color(0xbcd8ff) },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uSunGlow: { value: 0 },
      },
      vertexShader: DOME_VERTEX,
      fragmentShader: DOME_FRAGMENT,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 24, 16), this.domeMaterial);
    dome.renderOrder = -1000;
    dome.frustumCulled = false;
    this.object.add(dome);

    // ---- 太阳 / 月亮
    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 28),
      new THREE.MeshBasicMaterial({ map: discTexture('rgba(255,246,200,1)', 'rgba(255,214,130,0)'), transparent: true, depthWrite: false }),
    );
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshBasicMaterial({ map: discTexture('rgba(232,238,248,1)', 'rgba(200,214,238,0)'), transparent: true, depthWrite: false }),
    );
    this.object.add(this.sun, this.moon);

    // ---- 星空
    const positions = new Float32Array(STAR_COUNT * 3);
    let seed = 0x1234567;
    const rand = (): number => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed / 0xffffffff;
    };
    for (let i = 0; i < STAR_COUNT; i++) {
      // 只在地平线以上撒星星，避免"地下的星空"
      const theta = rand() * Math.PI * 2;
      const y = rand() * 0.95 + 0.05;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      positions[i * 3] = Math.cos(theta) * r * (DOME_RADIUS - 10);
      positions[i * 3 + 1] = y * (DOME_RADIUS - 10);
      positions[i * 3 + 2] = Math.sin(theta) * r * (DOME_RADIUS - 10);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0 }),
    );
    this.stars.renderOrder = -900;
    this.object.add(this.stars);

    // ---- 云层
    this.cloudMaterial = new THREE.MeshBasicMaterial({
      map: cloudTexture(),
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: 0xffffff,
    });
    this.cloudMesh = new THREE.Mesh(new THREE.PlaneGeometry(CLOUD_PLANE_SIZE, CLOUD_PLANE_SIZE), this.cloudMaterial);
    this.cloudMesh.rotation.x = -Math.PI / 2;
    this.cloudMesh.renderOrder = -800;
    this.cloudMesh.frustumCulled = false;
    this.object.add(this.cloudMesh);
  }

  /** 天空顶部 / 地平线颜色（由天气与昼夜共同决定） */
  setDomeColors(top: THREE.Color, horizon: THREE.Color): void {
    (this.domeMaterial.uniforms.uTop!.value as THREE.Color).copy(top);
    (this.domeMaterial.uniforms.uHorizon!.value as THREE.Color).copy(horizon);
  }

  /** 太阳方向的霞光强度 0-1 */
  setSunGlow(value: number): void {
    this.domeMaterial.uniforms.uSunGlow!.value = value;
  }

  /**
   * 云层外观：夜里压暗（否则半夜会挂着一片惨白的云），雨天再压一层。
   * @param daylight 0-1
   * @param overcast 0-1
   */
  setCloudAppearance(daylight: number, overcast: number): void {
    const base = (0.32 + 0.68 * daylight) * (1 - overcast * 0.42);
    this.cloudMaterial.color.setRGB(base, base, Math.min(1, base * 1.02));
    this.cloudMaterial.opacity = 0.82 - overcast * 0.3;
  }

  /**
   * @param timeOfDay 0=日出、0.25=正午、0.5=日落、0.75=午夜
   */
  /** 云的开关（设置项） */
  setCloudsVisible(visible: boolean): void {
    this.cloudsVisible = visible;
    this.cloudMesh.visible = visible;
  }

  /**
   * 换月相（批次 84）：8 张贴图**懒建**（第一次用到哪一个相就画哪一个），
   * 所以"进游戏时是第 3 天"也只会画那一张，另外 7 张等见到再说。
   *
   * ⚠️ 只换 `map` 不重建材质：一张贴图 64×64，一天才换一次——重建材质会让
   * 着色器编译在切相那一帧卡一下（这就是"按需懒建 + 只换 map"的理由）。
   */
  setMoonPhase(phase: number): void {
    const index = ((Math.floor(phase) % MOON_PHASE_COUNT) + MOON_PHASE_COUNT) % MOON_PHASE_COUNT;
    if (index === this.moonPhase) return;
    this.moonPhase = index;
    let texture = this.moonTextures[index];
    if (!texture) {
      texture = moonTexture(index);
      this.moonTextures[index] = texture;
    }
    const material = this.moon.material as THREE.MeshBasicMaterial;
    material.map = texture;
    material.needsUpdate = true;
  }

  /** 当前画的是哪个相（调试面板与验收脚本用；-1 = 还没设过） */
  get currentMoonPhase(): number {
    return this.moonPhase;
  }

  update(timeOfDay: number, cameraPosition: THREE.Vector3, dt: number): void {
    this.object.position.copy(cameraPosition);

    const angle = timeOfDay * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    (this.domeMaterial.uniforms.uSunDir!.value as THREE.Vector3).set(dirX, dirY, 0);

    this.sun.position.set(dirX * CELESTIAL_DISTANCE, dirY * CELESTIAL_DISTANCE, 0);
    this.moon.position.set(-dirX * CELESTIAL_DISTANCE, -dirY * CELESTIAL_DISTANCE, 0);
    // 太阳落到地平线以下就换成月亮，避免"晚上还挂个太阳"
    this.sun.visible = dirY > -0.12;
    this.moon.visible = -dirY > -0.12;
    this.sun.lookAt(cameraPosition);
    this.moon.lookAt(cameraPosition);

    // 星空只在夜里出现，且随天色渐变
    const night = Math.max(0, Math.min(1, -dirY * 1.6 + 0.25));
    (this.stars.material as THREE.PointsMaterial).opacity = night;

    // 云层只跟随水平位置（y 固定为原版云高度），并缓慢飘移
    this.cloudMesh.position.set(0, CLOUD_HEIGHT - cameraPosition.y, 0);
    // 关掉云之后仍然更新位置与飘移（省得再开时"跳一下"），只是不画
    this.cloudMesh.visible = this.cloudsVisible;
    const map = this.cloudMaterial.map;
    if (map) {
      map.offset.x = (map.offset.x + dt * 0.0016) % 1;
      map.offset.y = (map.offset.y + dt * 0.0004) % 1;
    }
  }

  dispose(): void {
    // 8 张月相贴图（懒建，可能一张都还没画过）
    for (const texture of this.moonTextures) texture?.dispose();
    this.object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
  }
}
