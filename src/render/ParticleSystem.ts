/**
 * 粒子系统（E13）
 *
 * 用一个固定容量的池子 + 单个 `THREE.Points` 承载全部粒子：
 *  - 位置/速度/寿命/大小/颜色都存在 `Float32Array` 里（结构体拆成平行数组），
 *    粒子死亡时用「与末尾交换」的方式压缩，活跃粒子永远排在数组前面，
 *    于是每帧只需要上传前 `count` 个顶点，与池子总容量无关。
 *  - 一个 draw call 画完所有粒子，和天气（`Weather`）的做法一致。
 *  - 贴图靠 `gl_PointCoord` 在着色器里现算（带软边的小方块），因此不占图集、不需要额外的纹理资源。
 *
 * 只有破坏/挖掘/水花/爆炸/烟雾/火焰这几类，够用且都能被主循环里的真实事件触发。
 */

import * as THREE from 'three';

/** 池子容量：同时存在的粒子数上限（超出后新粒子被丢弃，不会挤掉旧粒子） */
export const PARTICLE_POOL = 1024;

const VERTEX_SHADER = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  // 透视缩放：离得越远越小（uScale 由视口高度与 fov 算出）
  gl_PointSize = aSize * uScale / max(0.05, -viewPosition.z);
  gl_Position = projectionMatrix * viewPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform float uBrightness;
varying vec3 vColor;
varying float vAlpha;

void main() {
  // 带软边的小方块：中心不透明、边缘渐隐（原版的破坏粒子就是小方块贴图）
  vec2 d = gl_PointCoord - 0.5;
  float square = max(abs(d.x), abs(d.y));
  float alpha = smoothstep(0.5, 0.33, square) * vAlpha;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(vColor * uBrightness, alpha);
}
`;

/** 各类粒子的物理参数（重力为负表示向上飘） */
interface KindParams {
  gravity: number;
  /** 空气阻力系数（速度每秒衰减的比例） */
  drag: number;
  /** 寿命区间（秒） */
  life: [number, number];
  /** 尺寸区间（格） */
  size: [number, number];
  alpha: number;
}

const KINDS = {
  /** 方块被挖碎：有重量、落地快 */
  block: { gravity: 20, drag: 0.6, life: [0.6, 1.15], size: [0.09, 0.17], alpha: 1 },
  /** 挖掘途中的碎屑：更小更少 */
  digging: { gravity: 20, drag: 0.6, life: [0.35, 0.7], size: [0.05, 0.1], alpha: 0.9 },
  /** 入水水花 */
  splash: { gravity: 24, drag: 0.5, life: [0.45, 0.85], size: [0.06, 0.13], alpha: 0.85 },
  /** 暴击火花 */
  crit: { gravity: 9, drag: 1.3, life: [0.3, 0.55], size: [0.07, 0.12], alpha: 1 },
  /** 烟雾：向上飘、越飘越淡 */
  smoke: { gravity: -1.4, drag: 1.5, life: [0.8, 1.7], size: [0.16, 0.34], alpha: 0.55 },
  /** 火焰：向上窜、短命 */
  flame: { gravity: -2.2, drag: 2.1, life: [0.35, 0.75], size: [0.1, 0.2], alpha: 0.95 },
} as const satisfies Record<string, KindParams>;

export type ParticleKind = keyof typeof KINDS;

/** 粒子类型顺序（`kind` 数组存的是这个表里的下标） */
const KINDS_ORDER = Object.keys(KINDS) as ParticleKind[];

export interface DebugSnapshot {
  /** 当前存活粒子数 */
  count: number;
  /** 前 count 个粒子的世界坐标（长度 count×3） */
  positions: Float32Array;
  /** 粒子类型计数 */
  byKind: Record<ParticleKind, number>;
}

function splitColor(color: number): [number, number, number] {
  return [((color >> 16) & 0xff) / 255, ((color >> 8) & 0xff) / 255, (color & 0xff) / 255];
}

function randomBetween(range: readonly [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0]);
}

export class ParticleSystem {
  /** 挂到场景上的根节点（粒子坐标就是世界坐标，所以根节点不动） */
  readonly object = new THREE.Group();

  private readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly uniforms: Record<string, THREE.IUniform>;

  private readonly px = new Float32Array(PARTICLE_POOL);
  private readonly py = new Float32Array(PARTICLE_POOL);
  private readonly pz = new Float32Array(PARTICLE_POOL);
  private readonly vx = new Float32Array(PARTICLE_POOL);
  private readonly vy = new Float32Array(PARTICLE_POOL);
  private readonly vz = new Float32Array(PARTICLE_POOL);
  private readonly life = new Float32Array(PARTICLE_POOL);
  private readonly ttl = new Float32Array(PARTICLE_POOL);
  private readonly size = new Float32Array(PARTICLE_POOL);
  private readonly r = new Float32Array(PARTICLE_POOL);
  private readonly g = new Float32Array(PARTICLE_POOL);
  private readonly b = new Float32Array(PARTICLE_POOL);
  private readonly alpha = new Float32Array(PARTICLE_POOL);
  private readonly gravity = new Float32Array(PARTICLE_POOL);
  private readonly drag = new Float32Array(PARTICLE_POOL);
  private readonly kind = new Int8Array(PARTICLE_POOL);

  /** 当前存活粒子数（活跃粒子始终排在 [0, count)） */
  private count = 0;

  constructor() {
    const positions = new Float32Array(PARTICLE_POOL * 3);
    const colors = new Float32Array(PARTICLE_POOL * 3);
    const sizes = new Float32Array(PARTICLE_POOL);
    const alphas = new Float32Array(PARTICLE_POOL);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    this.geometry.setDrawRange(0, 0);

    this.uniforms = {
      uScale: { value: 400 },
      uBrightness: { value: 1 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, material);
    // 粒子每帧都在动，包围盒没有意义（不算会整批被剔掉）
    this.points.frustumCulled = false;
    this.object.add(this.points);
  }

  /** 当前存活粒子数 */
  /**
   * 粒子生成密度倍率（0 = 完全不生成）。
   * 手机上粒子是最吃帧率的一项，设置里可以调到"减少"或"关闭"。
   */
  private density = 1;

  setDensity(value: number): void {
    this.density = Math.max(0, Math.min(1, value));
  }

  /** 按密度折算实际生成数量；为 0 时调用方直接返回 */
  private scaledCount(base: number): number {
    if (this.density <= 0) return 0;
    return Math.max(1, Math.round(base * this.density));
  }

  get active(): number {
    return this.count;
  }

  /**
   * 按视口设置透视缩放系数。
   * `gl_PointSize` 单位是物理像素，因此这里要传渲染缓冲的高度（已含 devicePixelRatio）。
   */
  setViewport(fovDeg: number, bufferHeightPx: number): void {
    this.uniforms.uScale!.value = bufferHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /** 粒子亮度（跟天光同步；主循环会给一个下限，免得夜里看不见） */
  setBrightness(value: number): void {
    this.uniforms.uBrightness!.value = value;
  }

  // ---------------------------------------------------------------- 生成

  /** 方块被破坏：一簇带方块颜色的碎块 */
  spawnBlockBreak(x: number, y: number, z: number, color: number, count = 14): void {
    this.burst('block', x, y, z, color, count, 0.22, 3.2);
  }

  /** 挖掘途中的零星碎屑 */
  spawnDigging(x: number, y: number, z: number, color: number): void {
    this.burst('digging', x, y, z, color, 2, 0.12, 1.4);
  }

  /** 入水水花 */
  spawnSplash(x: number, y: number, z: number, color = 0x4d84c8, count = 12): void {
    this.burst('splash', x, y, z, color, count, 0.3, 3.6);
  }

  /** 暴击火花 */
  spawnCrit(x: number, y: number, z: number, count = 6): void {
    this.burst('crit', x, y, z, 0xf4f4f4, count, 0.24, 2.6);
  }

  /** 烟雾（生物死亡、爆炸） */
  spawnSmoke(x: number, y: number, z: number, count = 8, spread = 0.26): void {
    this.burst('smoke', x, y, z, 0x3a3a3a, count, spread, 0.9);
  }

  /** 火焰（泡在岩浆里） */
  spawnFlame(x: number, y: number, z: number, color = 0xff9a1f, count = 1): void {
    this.burst('flame', x, y, z, color, count, 0.16, 0.8);
  }

  /** 通用爆发：`spread` 是生成点的抖动半径，`speed` 是初速度上限 */
  private burst(
    kind: ParticleKind,
    x: number,
    y: number,
    z: number,
    color: number,
    count: number,
    spread: number,
    speed: number,
  ): void {
    // 密度只在这里生效：所有粒子都从 burst 走，调一处就够
    count = this.scaledCount(count);
    if (count <= 0) return;

    const params = KINDS[kind];
    const [cr, cg, cb] = splitColor(color);

    for (let i = 0; i < count; i++) {
      const dx = (Math.random() * 2 - 1) * spread;
      const dy = (Math.random() * 2 - 1) * spread;
      const dz = (Math.random() * 2 - 1) * spread;
      // 初速度：半球形散开，向上偏一点（落下来才自然）
      this.add(
        x + dx,
        y + dy,
        z + dz,
        (Math.random() * 2 - 1) * speed,
        Math.random() * speed * 0.9 + speed * 0.25,
        (Math.random() * 2 - 1) * speed,
        randomBetween(params.life),
        randomBetween(params.size),
        cr,
        cg,
        cb,
        params.alpha,
        params.gravity,
        params.drag,
        KINDS_ORDER.indexOf(kind),
      );
    }
  }

  private add(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    ttl: number,
    size: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
    gravity: number,
    drag: number,
    kind: number,
  ): void {
    if (this.count >= PARTICLE_POOL) return;
    const i = this.count++;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = 0;
    this.ttl[i] = ttl;
    this.size[i] = size;
    this.r[i] = r;
    this.g[i] = g;
    this.b[i] = b;
    this.alpha[i] = alpha;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.kind[i] = kind;
  }

  // ---------------------------------------------------------------- 更新

  /** 推进一帧：积分速度、淘汰死亡粒子、上传顶点 */
  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] += dt;
      if (this.life[i] >= this.ttl[i]) {
        this.swapRemove(i);
        continue;
      }

      const damping = Math.max(0, 1 - this.drag[i]! * dt);
      this.vx[i] = this.vx[i]! * damping;
      this.vy[i] = this.vy[i]! * damping - this.gravity[i]! * dt;
      this.vz[i] = this.vz[i]! * damping;

      this.px[i] = this.px[i]! + this.vx[i]! * dt;
      this.py[i] = this.py[i]! + this.vy[i]! * dt;
      this.pz[i] = this.pz[i]! + this.vz[i]! * dt;
      i++;
    }

    this.writeBuffers();
  }

  /** 把末位粒子搬到 `index`，然后收缩活跃区间（顺序无关，所以不需要稳定排序） */
  private swapRemove(index: number): void {
    const last = --this.count;
    if (index === last) return;
    this.px[index] = this.px[last]!;
    this.py[index] = this.py[last]!;
    this.pz[index] = this.pz[last]!;
    this.vx[index] = this.vx[last]!;
    this.vy[index] = this.vy[last]!;
    this.vz[index] = this.vz[last]!;
    this.life[index] = this.life[last]!;
    this.ttl[index] = this.ttl[last]!;
    this.size[index] = this.size[last]!;
    this.r[index] = this.r[last]!;
    this.g[index] = this.g[last]!;
    this.b[index] = this.b[last]!;
    this.alpha[index] = this.alpha[last]!;
    this.gravity[index] = this.gravity[last]!;
    this.drag[index] = this.drag[last]!;
    this.kind[index] = this.kind[last]!;
  }

  private writeBuffers(): void {
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = this.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const size = this.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const alpha = this.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;

    const positions = position.array as Float32Array;
    const colors = color.array as Float32Array;
    const sizes = size.array as Float32Array;
    const alphas = alpha.array as Float32Array;

    for (let i = 0; i < this.count; i++) {
      const p = i * 3;
      positions[p] = this.px[i]!;
      positions[p + 1] = this.py[i]!;
      positions[p + 2] = this.pz[i]!;
      colors[p] = this.r[i]!;
      colors[p + 1] = this.g[i]!;
      colors[p + 2] = this.b[i]!;
      sizes[i] = this.size[i]!;
      // 越接近寿命末尾越透明（1.6 次幂让淡出更"晚"一点）
      const t = this.life[i]! / this.ttl[i]!;
      alphas[i] = this.alpha[i]! * (1 - Math.pow(t, 1.6));
    }

    position.needsUpdate = true;
    color.needsUpdate = true;
    size.needsUpdate = true;
    alpha.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count);
  }

  /** 立即清空（切维度时用，免得旧维度的粒子飘在新世界里） */
  clear(): void {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }

  /** 测试/调试：导出当前粒子状态 */
  debugSnapshot(): DebugSnapshot {
    const byKind = {} as Record<ParticleKind, number>;
    for (const name of KINDS_ORDER) byKind[name] = 0;
    for (let i = 0; i < this.count; i++) {
      const name = KINDS_ORDER[this.kind[i]!];
      if (name) byKind[name]++;
    }

    const positions = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      positions[i * 3] = this.px[i]!;
      positions[i * 3 + 1] = this.py[i]!;
      positions[i * 3 + 2] = this.pz[i]!;
    }
    return { count: this.count, positions, byKind };
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.object.removeFromParent();
  }
}
