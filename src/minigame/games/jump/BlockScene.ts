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
 *    （屏幕上就是左下），浓度 35% 紫灰。原版没有可见地面，阴影其实也是贴片；
 *  · **顶面中心有白点**：原版唯一的落点提示（直径 ≈ 0.13 边长）。特殊方块顶面
 *    自己就有图案（井盖盘 / 唱片纹 / 魔方格 / 门脸），不再叠点。
 *
 * 动画（`[跳7]`）也在这层：新块入场弹入 400ms、被踩的块凹一下再回弹 500ms、
 * 落后于镜头的块掉落缩小消失、完美命中在同一点扩散三层同心圆。时序与缓动全在
 * `motion.ts`（纯函数、可离线断言），这里只负责把它们套到 mesh 上。
 *
 * 释放契约与旧版一致：`dispose()` 之后 `renderer.info.memory` 回到进场前的值——
 * 方盒 / 圆柱 / 阴影片 / 波纹环四份几何、颜色材质缓存、特殊方块贴图、两张 canvas 贴图、
 * 场景本体全部还清。
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
import { ATLAS_U, createBlockAtlas, type CanvasFactory, type SpecialKind } from './blockTextures.ts';
import {
  JUMP_TIMING,
  blockBounceScale,
  enterScale,
  fadeScale,
  rippleProgress,
} from './motion.ts';
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
  /**
   * 配色下标（传方块 id）。
   *
   * ⚠️ 不能用"在这一屏列表里的下标"：每跳一次列表整体前移一格，同一块方块会换色，
   * 看起来就是"跳一下整个世界重新上色"。
   */
  readonly colorIndex: number;
}

/** 蓄力时当前方块最多压掉多少高度（规格表 §8：y → 0.8） */
const MAX_SQUASH = 0.2;
/**
 * 顶面中心的白点（参考图 02/03：每个方块顶面正中都有一个直径 ≈ 0.13 边长的白点，
 * 它是原版唯一的"落点提示"）。半径取一半，即直径 0.13 边长。
 */
const DOT_RADIUS_RATIO = 0.065;
/**
 * 白点圆的分段数。48 段（原来是 24）：像素比抬到 3 之后，24 段在手机上能看出多边形。
 * 导出成常量是为了"改了要不要跟着调"这件事有断言兜着。
 */
export const DOT_SEGMENTS = 48;
/** 阴影贴片的边长（像素）。256：3x 屏下阴影边缘不再是方块糊 */
export const SHADOW_TEXTURE_SIZE = 256;
/** 背景渐变贴图的高度（像素）。512：256 在高分屏上会有可见色带 */
export const BACKGROUND_TEXTURE_HEIGHT = 512;
/** 背景噪点幅度（±1/255）：只为打散渐变色带，肉眼几乎看不见 */
export const BACKGROUND_NOISE = 1 / 255;
/** 阴影贴片相对方块尺寸的放大倍数（柔边要占出去一圈） */
const SHADOW_SPREAD = 1.35;
/** 阴影在**世界**里的偏移：屏幕上看是"左下"（光照来自 +x/−z） */
const SHADOW_OFFSET = { x: -0.3, z: 0.5 };
/** 相机跟随的指数插值系数（越大跟得越紧） */
const FOLLOW_RATE = 8;
/** 完美命中的三层同心圆：外白 / 中绿 / 内红（规格表 §7） */
const RIPPLE_RINGS = [
  { color: '#FFFFFF', radius: 1 },
  { color: '#7ED957', radius: 0.72 },
  { color: '#E93A41', radius: 0.45 },
] as const;

interface BlockEntry {
  spec: BlockSpec;
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  /** 顶面中心的白点；特殊方块顶面有自己的图案，`null` */
  readonly dot: THREE.Mesh | null;
  /** 方块未压缩时的高度 */
  readonly height: number;
  /** 位置键（同 x/z = 同一块，用于跨重建保留入场进度） */
  readonly key: string;
  /** 入场动画已过去的毫秒 */
  age: number;
  /** 掉落淡出已过去的毫秒；`null` = 不在淡出 */
  fadeMs: number | null;
}

export class BlockScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;

  private palette: JumpPalette;
  private readonly blockGeometry: THREE.BufferGeometry;
  /** 特殊方块：每类一份（UV 指向图集的两格），按需创建 */
  private readonly specialGeometries = new Map<SpecialKind, THREE.BufferGeometry>();
  private readonly specialMaterials = new Map<SpecialKind, THREE.MeshBasicMaterial>();
  private readonly specialTextures: THREE.Texture[] = [];
  private readonly canvasFactory: CanvasFactory | undefined;
  private readonly dotGeometry: THREE.CircleGeometry;
  private readonly dotMaterial: THREE.MeshBasicMaterial;
  private readonly shadowGeometry: THREE.PlaneGeometry;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly shadowTexture: THREE.Texture;
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>();

  private backgroundTexture: THREE.Texture;
  private entries: BlockEntry[] = [];
  /** 已经不在屏上、正在掉落缩小的旧方块 */
  private fading: BlockEntry[] = [];
  /** 被踩的那块：从落地开始计时（毫秒） */
  private bounce: { key: string; ms: number } | null = null;
  /** 完美命中的同心圆 */
  private ripple: { x: number; z: number; size: number; ms: number } | null = null;
  private rippleRig: { meshes: THREE.Mesh[]; materials: THREE.MeshBasicMaterial[]; geometry: THREE.RingGeometry } | null = null;
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

  constructor(palette: JumpPalette, canvasFactory?: CanvasFactory) {
    this.palette = palette;
    this.canvasFactory = canvasFactory;
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.backgroundTexture = createBackgroundTexture(palette);
    this.scene.background = this.backgroundTexture;

    this.blockGeometry = bakeFaceShading(new THREE.BoxGeometry(1, 1, 1));

    this.dotGeometry = new THREE.CircleGeometry(1, DOT_SEGMENTS);
    // ⚠️ 必须是 transparent + 高 renderOrder：不透明物体会按"由近到远"排，
    // 白点若不写深度又排在方块之前，就会被顶面整片盖掉（实测点看不见，原因就在这）。
    this.dotMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#FFFFFF'),
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });

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

  /**
   * 重建整屏方块（一帧最多 4 块，重建比增量维护简单）。
   *
   * 两个细节都是"看得见"的：
   *  · **入场进度按位置保留**：每跳一次都会重建整屏，如果不按 x/z 把 `age` 带过来，
   *    所有方块会每跳一次弹一次；
   *  · **掉队的方块不直接删**：落后于镜头的块进淡出队列，掉落缩小时长 400ms。
   */
  setBlocks(specs: readonly BlockSpec[]): void {
    const ages = new Map<string, number>();
    for (const entry of this.entries) ages.set(entry.key, entry.age);

    const nextKeys = new Set(specs.map((spec) => blockKey(spec)));
    for (const entry of this.entries) {
      if (nextKeys.has(entry.key)) {
        this.removeEntry(entry);
      } else {
        // 不再是"这一屏的方块" → 掉落消失
        entry.fadeMs = 0;
        entry.spec = { ...entry.spec, current: false };
        this.fading.push(entry);
      }
    }
    this.entries = [];

    for (const spec of specs) {
      this.entries.push(this.createEntry(spec, ages.get(blockKey(spec)) ?? 0));
    }
    this.refreshAll();
  }

  /** 蓄力压缩：只压"当前那块"（顶面下沉、底面不动），0 = 不压 */
  setSquash(amount: number): void {
    const next = Math.min(MAX_SQUASH, Math.max(0, Number.isFinite(amount) ? amount : 0));
    if (Math.abs(next - this.squash) < 1e-4) return;
    this.squash = next;
    this.refreshAll();
  }

  /** 落地：被踩的那块凹一下再回弹（500ms Bounce.Out） */
  punch(x: number, z: number): void {
    this.bounce = { key: blockKey({ x, z }), ms: 0 };
  }

  /** 完美命中：在落点扩散三层同心圆（外白 / 中绿 / 内红） */
  playRipple(x: number, z: number, size: number): void {
    this.ripple = { x, z, size, ms: 0 };
    const rig = this.ensureRippleRig();
    for (const mesh of rig.meshes) mesh.visible = true;
    this.refreshRipple();
  }

  /** 每帧推进方块动画（入场 / 回弹 / 淡出 / 波纹）；不推进相机 */
  tick(dt: number): void {
    // dt 夹到 1 秒：切标签页回来别让动画一帧跳完
    const ms = Math.min(1, Math.max(0, Number.isFinite(dt) ? dt : 0)) * 1000;
    if (ms <= 0) return;
    let dirty = false;

    for (const entry of this.entries) {
      if (entry.age < JUMP_TIMING.enterMs) {
        entry.age = Math.min(JUMP_TIMING.enterMs, entry.age + ms);
        dirty = true;
      }
    }

    if (this.bounce) {
      this.bounce.ms += ms;
      if (this.bounce.ms >= JUMP_TIMING.blockBounceMs) this.bounce = null;
      dirty = true;
    }

    if (this.fading.length > 0) {
      dirty = true;
      const done: BlockEntry[] = [];
      for (const entry of this.fading) {
        entry.fadeMs = (entry.fadeMs ?? 0) + ms;
        if ((entry.fadeMs ?? 0) >= JUMP_TIMING.fadeMs) done.push(entry);
      }
      if (done.length > 0) {
        for (const entry of done) this.removeEntry(entry);
        this.fading = this.fading.filter((entry) => !done.includes(entry));
      }
    }

    if (this.ripple) {
      this.ripple.ms += ms;
      if (this.ripple.ms >= JUMP_TIMING.rippleMs) {
        const rig = this.rippleRig;
        if (rig) for (const mesh of rig.meshes) mesh.visible = false;
        this.ripple = null;
      } else {
        this.refreshRipple();
      }
      dirty = true;
    }

    if (dirty) this.refreshAll();
  }

  /** 世界坐标 → 层内归一化坐标（0~1，y 向下）：飘字要贴在方块/小人头顶 */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number } {
    // 相机的世界矩阵是渲染时才刷新的；飘字在 render 之前算，必须自己先刷一次
    this.camera.updateMatrixWorld();
    const point = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (point.x + 1) / 2, y: (1 - point.y) / 2 };
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
    for (const geometry of this.specialGeometries.values()) geometry.dispose();
    this.specialGeometries.clear();
    for (const material of this.specialMaterials.values()) material.dispose();
    this.specialMaterials.clear();
    for (const texture of this.specialTextures) texture.dispose();
    this.specialTextures.length = 0;
    this.dotGeometry.dispose();
    this.dotMaterial.dispose();
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
   * 只把"上一块 + 当前 + 下一块"（3 块）交给取景器：横屏下间距拉到 4.6~6.0 格之后，
   * 交 4 块会被压得看不清；交太少则下一块可能贴边。
   * 头位按小人高度留（否则蓄力时头顶会顶出画面）。
   */
  private nextFrame(): IsoFrame {
    const currentIndex = Math.max(0, this.entries.findIndex((entry) => entry.spec.current));
    const from = Math.max(0, currentIndex - 1);
    const to = Math.min(this.entries.length - 1, currentIndex + 1);
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

  /** 建一块方块（网格 + 阴影贴片），并带上入场进度 */
  private createEntry(spec: BlockSpec, age: number): BlockEntry {
    const height = Math.max(0.05, spec.size * BLOCK_HEIGHT_RATIO);
    // 特殊方块用自己的贴图（颜色写在贴图里，不再乘色板）；普通方块走纯色材质
    const special = spec.kind === 'normal' ? null : this.specialFor(spec.kind);
    const geometry = special?.geometry ?? this.blockGeometry;
    const material = special?.material ?? this.materialFor(blockColorAt(this.palette, spec.colorIndex));

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1;
    this.scene.add(mesh);

    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    // 阴影永远画在方块之前，避免透明片盖住方块本体
    shadow.renderOrder = 0;
    this.scene.add(shadow);

    // 顶面白点：特殊方块顶面是井盖/唱片/魔方/门脸，不再叠点
    let dot: THREE.Mesh | null = null;
    if (spec.kind === 'normal') {
      dot = new THREE.Mesh(this.dotGeometry, this.dotMaterial);
      dot.rotation.x = -Math.PI / 2;
      dot.renderOrder = 3;
      this.scene.add(dot);
    }

    return { spec, mesh, shadow, dot, height, key: blockKey(spec), age, fadeMs: null };
  }

  private removeEntry(entry: BlockEntry): void {
    this.scene.remove(entry.mesh);
    this.scene.remove(entry.shadow);
    if (entry.dot) this.scene.remove(entry.dot);
  }

  /** 把入场 / 回弹 / 压扁 / 淡出四个因子乘到所有方块上（只有这一处写变换） */
  private refreshAll(): void {
    for (const entry of this.entries) this.refreshEntry(entry);
    for (const entry of this.fading) this.refreshEntry(entry);
  }

  private refreshEntry(entry: BlockEntry): void {
    const enter = enterScale(entry.age);
    const bounce = this.bounce && this.bounce.key === entry.key ? blockBounceScale(this.bounce.ms) : 1;
    const squash = entry.spec.current ? 1 - this.squash : 1;
    const fade = entry.fadeMs === null ? 1 : fadeScale(entry.fadeMs);
    const shrink = enter * fade;

    // 高度方向叠三个因子；横向只受入场/淡出影响（蓄力压扁要"横向鼓出来"由小人负责）
    const height = Math.max(0, entry.height * squash * bounce * shrink);
    entry.mesh.scale.set(entry.spec.size * shrink, height, entry.spec.size * shrink);
    // 淡出时一边缩一边往下掉
    entry.mesh.position.set(entry.spec.x, height / 2 - (1 - fade) * entry.height * 1.2, entry.spec.z);

    const spread = entry.spec.size * SHADOW_SPREAD * shrink;
    entry.shadow.scale.set(spread, spread, 1);
    entry.shadow.position.set(
      entry.spec.x + SHADOW_OFFSET.x * entry.spec.size * shrink,
      0.001,
      entry.spec.z + SHADOW_OFFSET.z * entry.spec.size * shrink,
    );
    entry.shadow.visible = fade > 0.02;

    // 白点跟着顶面走：高度/缩放都跟方块同步，方块被压扁时它也跟着沉下去
    if (entry.dot) {
      const radius = entry.spec.size * DOT_RADIUS_RATIO * shrink;
      entry.dot.scale.set(radius, radius, 1);
      entry.dot.position.set(entry.spec.x, height + 0.002, entry.spec.z);
      entry.dot.visible = fade > 0.02 && radius > 1e-4;
    }
  }

  private ensureRippleRig(): { meshes: THREE.Mesh[]; materials: THREE.MeshBasicMaterial[]; geometry: THREE.RingGeometry } {
    if (this.rippleRig) return this.rippleRig;
    const geometry = new THREE.RingGeometry(0.86, 1, 48);
    const meshes: THREE.Mesh[] = [];
    const materials: THREE.MeshBasicMaterial[] = [];
    for (const ring of RIPPLE_RINGS) {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(ring.color),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 2;
      mesh.visible = false;
      this.scene.add(mesh);
      meshes.push(mesh);
      materials.push(material);
    }
    this.rippleRig = { meshes, materials, geometry };
    return this.rippleRig;
  }

  /** 波纹：三层同心圆一起由内向外扩（600ms），越扩越淡 */
  private refreshRipple(): void {
    const ripple = this.ripple;
    const rig = this.rippleRig;
    if (!ripple || !rig) return;
    const progress = rippleProgress(ripple.ms);
    const topY = Math.max(0.05, ripple.size * BLOCK_HEIGHT_RATIO) + 0.02;
    RIPPLE_RINGS.forEach((ring, index) => {
      const mesh = rig.meshes[index];
      const material = rig.materials[index];
      if (!mesh || !material) return;
      const radius = ripple.size * (0.3 + 0.75 * progress) * ring.radius;
      mesh.scale.set(radius, radius, 1);
      mesh.position.set(ripple.x, topY + index * 0.004, ripple.z);
      material.opacity = Math.max(0, 0.85 * (1 - progress));
      mesh.visible = progress < 1;
    });
  }

  /**
   * 特殊方块的几何 + 材质（每类只建一次）。
   *
   * 几何要改 UV：图集左半是顶面、右半是侧面，所以按顶点法线把「朝上的面」指到左格、
   * 其余指到右格。三面明暗仍然由顶点色乘上来——特殊方块与普通方块的明暗完全一致，
   * 不会出现"贴了图的那块看起来是另一个世界"。
   */
  private specialFor(kind: SpecialKind): { geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial } {
    let geometry = this.specialGeometries.get(kind);
    if (!geometry) {
      // 音乐盒是唱片机：圆柱比方盒自然（其余三类都是方的）
      const base =
        kind === 'music'
          ? new THREE.CylinderGeometry(0.5, 0.5, 1, 40, 1)
          : new THREE.BoxGeometry(1, 1, 1);
      bakeFaceShading(base);
      remapAtlasUV(base);
      geometry = base;
      this.specialGeometries.set(kind, geometry);
    }

    let material = this.specialMaterials.get(kind);
    if (!material) {
      const canvas = createBlockAtlas(kind, this.canvasFactory);
      const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.specialTextures.push(texture);
      material = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true });
      this.specialMaterials.set(kind, material);
    }

    return { geometry, material };
  }

  private materialFor(color: string): THREE.MeshBasicMaterial {
    const cached = this.materials.get(color);
    if (cached) return cached;
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), vertexColors: true });
    this.materials.set(color, material);
    return material;
  }

  private clearEntries(): void {
    for (const entry of this.entries) this.removeEntry(entry);
    for (const entry of this.fading) this.removeEntry(entry);
    this.entries = [];
    this.fading = [];
    this.bounce = null;
    if (this.rippleRig) {
      for (const mesh of this.rippleRig.meshes) this.scene.remove(mesh);
      for (const material of this.rippleRig.materials) material.dispose();
      this.rippleRig.geometry.dispose();
      this.rippleRig = null;
    }
    this.ripple = null;
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

/** 方块的位置键：同一位置 = 同一块（跨重建保留入场进度） */
function blockKey(spec: { x: number; z: number }): string {
  return `${spec.x.toFixed(3)}|${spec.z.toFixed(3)}`;
}

/**
 * 把 UV 指到图集的两格：朝上的面 → 左格（顶面贴图），其余 → 右格（侧面贴图）。
 *
 * 按**法线**判断而不是按顶点下标：方盒与圆柱的顶点顺序不同，按下标写两套规则迟早错位。
 */
function remapAtlasUV(geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    const upward = Math.abs(normal.getY(i)) > 0.9;
    const [u0, u1] = upward ? ATLAS_U.top : ATLAS_U.side;
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), uv.getY(i));
  }
  uv.needsUpdate = true;
}

/**
 * 背景：2×N 的竖直渐变（three 会把它拉满整屏），无雾、无地面。
 *
 * 为什么是 512 而不是 256：手机 3x 屏上"上亮下暗"的过渡只有几十个色阶，
 * 256px 拉伸到 1200 物理像素时会出现明显的横向色带（banding）。
 * 再叠 ±1/255 的确定性噪点（dithering），把残余的色带彻底打散。
 */
function createBackgroundTexture(palette: JumpPalette): THREE.Texture {
  const height = BACKGROUND_TEXTURE_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, palette.background.top);
    gradient.addColorStop(1, palette.background.bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, height);

    const image = ctx.getImageData(0, 0, 2, height);
    for (let i = 0; i < image.data.length; i += 4) {
      const delta = backgroundNoise(i) * BACKGROUND_NOISE * 255;
      image.data[i] = clampByte(image.data[i]! + delta);
      image.data[i + 1] = clampByte(image.data[i + 1]! + delta);
      image.data[i + 2] = clampByte(image.data[i + 2]! + delta);
    }
    ctx.putImageData(image, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 确定性的 −1~1 白噪（按像素下标）。
 *
 * 不用随机数：截图对比与"同 seed 同画面"都要求可复现，
 * 而这张图一局只生成一次，确定性不会带来任何"每帧重算"的成本。
 */
function backgroundNoise(index: number): number {
  const t = Math.sin(index * 12.9898) * 43758.5453;
  return (t - Math.floor(t)) * 2 - 1;
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * 阴影贴片：柔边圆角方片。
 *
 * 用"径向渐变 + 圆角矩形裁剪"而不是 CSS `filter: blur`——后者在部分浏览器里
 * 要额外的 GPU 通道，而这里就是一张 128×128 的小图，一次生成反复用。
 */
function createShadowTexture(): THREE.Texture {
  const size = SHADOW_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // 原版的阴影**核心是实的、边缘才柔**：一直用大半径径向渐变会得到一团"雾"，
    // 再叠上半透明的方块就像"起了层灰"。这里让 0~0.62 保持满浓度，只留最后 38% 收边。
    const radius = size * 0.16;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(0, 0, size, size, radius);
    } else {
      ctx.rect(0, 0, size, size);
    }
    ctx.clip();
    const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.55);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.62, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
