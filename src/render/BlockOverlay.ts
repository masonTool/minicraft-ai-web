/**
 * 方块上的叠加层：破坏裂纹 + 命中面高亮（G2 / G3）
 *
 * 两件事共用一个类，因为它们都是"贴在某个方块表面上的薄片"，只是贴法不同：
 *  - **破坏裂纹**：把方块六个面各贴一遍裂纹贴图，按破坏进度换 0~9 阶段的贴图
 *  - **命中面高亮**：只在准星打到的那一个面上贴一层很淡的白色，让玩家看清"这一下会打在哪一面"
 *    （原版没有这个，属于本项目的可读性增强，所以做得非常淡）
 *  - **整块微光**（批次 239）：触摸端改为"手指落点取目标"后，光靠一条命中面玩家不容易
 *    在手指底下认出是哪一格，于是再给整个方块贴一层极淡的**加法**白光（背面被深度挡掉）
 *  - **贴地高亮**（批次 241 复查）：非满格目标（植物 / 雪层 / 台阶 / 火把…）不再把
 *    整格大小的方片挂在命中面上（那会悬在半空），改为贴在地面或它自己的顶面
 *    （`showGroundHighlight`，高度由 `shapeTop` 决定）
 *  - 后两者的强度由调用方给：触摸瞄准更明显，准星那套维持原来的很淡
 *
 * 关键实现点：
 *  1. 贴图 UV 用 uniform 传（`uTileOrigin` + `uTileSpan`），顶点里只存 0~1 的局部 UV，
 *     于是**换阶段不用重建几何体**——挖方块时每 0.1 秒就要换一次，重建几何体太浪费
 *  2. 几何体微微外扩 + polygonOffset，避免与被贴的方块表面 z-fighting
 *  3. `depthWrite: false`：叠加层不能写深度，否则会把后面的半透明水面切掉
 */

import * as THREE from 'three';
import { collisionBoxes, meshBoxes, shapeTop, type LocalBox } from '../core/registry/blockShapes.ts';
import type { BlockShape } from '../core/registry/blockState.ts';
import type { TextureAtlas } from './TextureAtlas.ts';

/** 破坏阶段数（原版就是 10 段） */
export const DAMAGE_STAGES = 10;

/** 外扩量：贴在方块表面外侧一点点，避免与方块面 z-fighting */
const INFLATE = 0.002;

/** 命中面高亮再往外一点（它贴在裂纹下面，两者同时出现时不能打架） */
const HIGHLIGHT_OFFSET = 0.004;

/** 命中面高亮的基准不透明度（准星那套"很淡"的口径） */
const HIGHLIGHT_BASE_OPACITY = 0.08;

/** 地面高亮：贴在方块表面外侧一点点（避免与地面/自身顶面 z-fighting） */
const GROUND_OFFSET = 0.003;

/** 地面高亮四边收缩 1.5%：看得出是"贴在表面上的一层"，而不是和面子重合 */
const GROUND_INSET = 0.015;

/** 整块微光的不透明度（触摸瞄准用；加法混合，10% 已经是"看得出亮、不糊贴图"） */
const GLOW_OPACITY = 0.1;

type Vec3 = readonly [number, number, number];

interface FaceDef {
  dir: Vec3;
  /** 四角（从方块外侧看是逆时针），取值 0/1 表示盒子的 min/max */
  corners: readonly [Vec3, Vec3, Vec3, Vec3];
}

/**
 * 六个面的四角，**必须是从方块外侧看过去的逆时针**。
 *
 * ⚠️ 这里踩过一次坑：顶点顺序写反的面在 `side: FrontSide` 下会被背面剔除掉，
 * 表现为"裂纹在顶面看不见、在别的面又看得见"（顶面恰好是最该看清裂纹的地方）。
 * 判断方法：cross(c1-c0, c2-c0) 要指向上表里的 `dir`。
 */
const FACES: readonly FaceDef[] = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

const UVS: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** 把 0/1 的角点映射到盒子的某个面 */
function faceVertex(box: LocalBox, corner: Vec3): [number, number, number] {
  const [x0, y0, z0, x1, y1, z1] = box;
  return [
    corner[0] === 0 ? x0 : x1,
    corner[1] === 0 ? y0 : y1,
    corner[2] === 0 ? z0 : z1,
  ];
}

/**
 * 供测试用：找出**顶点绕序朝内**的面（这些面在 FrontSide 下会被剔除，表现为"裂纹看不见"）。
 * 返回空数组表示全部正确。判定方法是 cross(c1-c0, c2-c0) 与面的外法线同向。
 */
export function facesWithInwardWinding(): number[] {
  const bad: number[] = [];
  FACES.forEach((face, index) => {
    const [a, b, c] = face.corners;
    const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal: [number, number, number] = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const dot = normal[0] * face.dir[0] + normal[1] * face.dir[1] + normal[2] * face.dir[2];
    if (dot <= 0) bad.push(index);
  });
  return bad;
}

export class BlockOverlay {
  readonly object: THREE.Group;

  private readonly damageMesh: THREE.Mesh;
  private readonly damageUniforms: Record<string, THREE.IUniform>;
  private readonly highlightMesh: THREE.Mesh;
  private readonly highlightGeometry: THREE.BufferGeometry;
  /** 整块微光（批次 239）：触摸瞄准时给整个方块贴一层淡淡的加法白光 */
  private readonly glowMesh: THREE.Mesh;
  private readonly cache = new Map<string, THREE.BufferGeometry>();
  /** 当前贴出来的裂纹阶段（验收脚本用） */
  private lastStage = -1;

  constructor(private readonly atlas: TextureAtlas) {
    this.object = new THREE.Group();
    this.object.visible = false;
    this.object.renderOrder = 2;

    // ---- 破坏裂纹：按阶段换 uniform 里的贴图位置
    this.damageUniforms = {
      uAtlas: { value: atlas.texture },
      uTileOrigin: { value: new THREE.Vector2(0, 0) },
      // ⚠️ 用 `atlas.tileSpan` 而不是 `1 / columns`（批次 425）：上传图集每格四周
      // 有 8 纹素的外扩边距，一张贴图只占格子的 16/32。手算会大出一倍。
      uTileSpan: { value: new THREE.Vector2(atlas.tileSpan[0], atlas.tileSpan[1]) },
    };
    const damageMaterial = new THREE.ShaderMaterial({
      uniforms: this.damageUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // 比"命中面高亮"更靠近相机：裂纹是主要信息，不能被高亮冲淡
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        uniform vec2 uTileOrigin;
        uniform vec2 uTileSpan;
        varying vec2 vUv;
        void main() {
          vec4 texel = texture2D(uAtlas, uTileOrigin + vUv * uTileSpan);
          // 裂纹贴图的背景是全透明的，透明像素直接丢掉（否则会盖住方块）
          if (texel.a < 0.02) discard;
          gl_FragColor = vec4(texel.rgb, texel.a);
        }
      `,
    });
    this.damageMesh = new THREE.Mesh(new THREE.BufferGeometry(), damageMaterial);
    this.damageMesh.frustumCulled = false;

    // ---- 命中面高亮：一个很淡的白色四边形（原版没有，属于可读性增强）
    this.highlightGeometry = new THREE.BufferGeometry();
    const highlightMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      // 很淡：它只是"告诉玩家打的是哪一面"，不能盖住方块本身的贴图与裂纹
      // （触摸瞄准时由 `showHighlight` 的 strength 调高到 ~0.16）
      opacity: HIGHLIGHT_BASE_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.highlightMesh = new THREE.Mesh(this.highlightGeometry, highlightMaterial);
    this.highlightMesh.frustumCulled = false;
    this.highlightMesh.visible = false;

    // ---- 整块微光（批次 239）：加法混合，背面被方块自身深度挡掉，只亮"看得见的那几面"
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: GLOW_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.glowMesh = new THREE.Mesh(new THREE.BufferGeometry(), glowMaterial);
    this.glowMesh.frustumCulled = false;
    this.glowMesh.visible = false;

    this.object.add(this.damageMesh, this.highlightMesh, this.glowMesh);
  }

  /**
   * 显示破坏裂纹。
   * @param stage 0~9（0 = 刚开始挖）
   */
  showDamage(x: number, y: number, z: number, shape: BlockShape, state: number, stage: number): void {
    const clamped = Math.max(0, Math.min(DAMAGE_STAGES - 1, Math.floor(stage)));
    this.lastStage = clamped;
    this.damageMesh.geometry = this.geometryFor(shape, state);

    const origin = this.atlas.tileOrigin(`destroy_stage_${clamped}`);
    (this.damageUniforms.uTileOrigin!.value as THREE.Vector2).set(origin[0], origin[1]);
    this.damageMesh.position.set(x, y, z);
    this.damageMesh.visible = true;
    this.syncVisible();
  }

  hideDamage(): void {
    this.damageMesh.visible = false;
    this.syncVisible();
  }

  /**
   * 高亮命中的那一个面。
   *
   * @param strength 不透明度倍数：准星那一路用 1（很淡）；触摸端"手指取目标"用 2，
   *                 因为手指底下没有准星做参考，得让玩家一眼看清打的是哪一面。
   */
  showHighlight(x: number, y: number, z: number, normal: Vec3, strength = 1): void {
    const face = FACES.find(
      (candidate) =>
        candidate.dir[0] === Math.sign(normal[0]) &&
        candidate.dir[1] === Math.sign(normal[1]) &&
        candidate.dir[2] === Math.sign(normal[2]),
    );
    if (!face) {
      this.hideHighlight();
      return;
    }

    // 面片往外挪一点点，并收缩 1.5%（看得出是"贴在面上"的一层，而不是和方块面重合）
    const shrink = 0.015;
    const positions: number[] = [];
    const uvs: number[] = [];
    for (const corner of face.corners) {
      positions.push(
        corner[0] * (1 - shrink) + shrink * 0.5 + face.dir[0] * HIGHLIGHT_OFFSET,
        corner[1] * (1 - shrink) + shrink * 0.5 + face.dir[1] * HIGHLIGHT_OFFSET,
        corner[2] * (1 - shrink) + shrink * 0.5 + face.dir[2] * HIGHLIGHT_OFFSET,
      );
    }
    for (const uv of UVS) uvs.push(uv[0], uv[1]);

    this.highlightGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.highlightGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.highlightGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.highlightGeometry.computeBoundingSphere();

    const material = this.highlightMesh.material as THREE.MeshBasicMaterial;
    material.opacity = Math.min(1, HIGHLIGHT_BASE_OPACITY * strength);

    this.highlightMesh.position.set(x, y, z);
    this.highlightMesh.visible = true;
    this.syncVisible();
  }

  /**
   * 地面高亮（批次 241 复查）：给**非满格**的方块画一块贴地的白色方片。
   *
   * 用户："手指指定的目标，如果目标没有完全占满、而是有半透的（某些植物、半透的雪），
   * 那就把高亮只显示到地上。" 以前无论什么形状都把整格大小的高亮贴在命中面上，
   * 瞄准植物/雪层时会挂出一块**悬空的方片**。
   *
   * 贴多高由 `shapeTop` 决定：
   *  - 铺满整格（雪层 / 台阶 / 地毯 / 睡莲）→ 贴它自己的顶面；
   *  - 细杆 / 薄片 / 十字植物（没有整格足迹）→ 贴脚下地面（格子底面）。
   *
   * @param hasGround 脚下有没有方块（调用方用 `world.isSelectable(y-1)` 判）。
   *                  `false` 且形状自己不铺满（墙上的藤蔓 / 挂牌）时返回 false，
   *                  由调用方退回"命中面高亮"。
   * @returns 是否真的画出来了
   */
  showGroundHighlight(
    x: number,
    y: number,
    z: number,
    shape: BlockShape,
    state: number,
    strength = 1,
    hasGround = true,
  ): boolean {
    const { top, covers } = shapeTop(shape, state);
    if (!covers && !hasGround) return false;

    const localY = (covers ? top : 0) + GROUND_OFFSET;
    const a = GROUND_INSET;
    const b = 1 - GROUND_INSET;
    const positions = [a, localY, a, b, localY, a, b, localY, b, a, localY, b];
    const uvs = [0, 0, 1, 0, 1, 1, 0, 1];

    this.highlightGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.highlightGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.highlightGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.highlightGeometry.computeBoundingSphere();

    const material = this.highlightMesh.material as THREE.MeshBasicMaterial;
    material.opacity = Math.min(1, HIGHLIGHT_BASE_OPACITY * strength);

    this.highlightMesh.position.set(x, y, z);
    this.highlightMesh.visible = true;
    this.syncVisible();
    return true;
  }

  hideHighlight(): void {
    this.highlightMesh.visible = false;
    this.syncVisible();
  }

  /**
   * 整块微光（批次 239）：触摸端用手指取目标时显示。
   *
   * 几何体与破坏裂纹共用同一份缓存（同一个 `(shape, state)` 只建一次），
   * 所以这里只换引用、不新建。
   */
  showGlow(x: number, y: number, z: number, shape: BlockShape, state: number): void {
    this.glowMesh.geometry = this.geometryFor(shape, state);
    this.glowMesh.position.set(x, y, z);
    this.glowMesh.visible = true;
    this.syncVisible();
  }

  hideGlow(): void {
    this.glowMesh.visible = false;
    this.syncVisible();
  }

  hide(): void {
    this.hideDamage();
    this.hideHighlight();
    this.hideGlow();
  }

  /** 三个子网格任一可见，整组才可见（省一次无意义的绘制调用） */
  private syncVisible(): void {
    this.object.visible =
      this.damageMesh.visible || this.highlightMesh.visible || this.glowMesh.visible;
  }

  /** 按 `(shape, state)` 取（或建）一份"每个面一个四边形"的几何体 */
  private geometryFor(shape: BlockShape, state: number): THREE.BufferGeometry {
    const key = `${shape}:${state & 0xff}`;
    let geometry = this.cache.get(key);
    if (!geometry) {
      const boxes = collisionBoxes(shape, state);
      geometry = buildBoxGeometry(boxes.length > 0 ? boxes : meshBoxes(shape, state));
      this.cache.set(key, geometry);
    }
    return geometry;
  }

  /** 验收脚本用：当前贴的是哪一张裂纹贴图（-1 = 没显示） */
  get damageStage(): number {
    return this.damageMesh.visible ? this.lastStage : -1;
  }

  get highlightVisible(): boolean {
    return this.highlightMesh.visible;
  }

  /** 验收脚本用：当前命中面高亮的不透明度（触摸瞄准应该比准星那套更亮） */
  get highlightOpacity(): number {
    return (this.highlightMesh.material as THREE.MeshBasicMaterial).opacity;
  }

  get glowVisible(): boolean {
    return this.glowMesh.visible;
  }

  dispose(): void {
    for (const geometry of this.cache.values()) geometry.dispose();
    this.cache.clear();
    this.damageMesh.geometry.dispose();
    (this.damageMesh.material as THREE.Material).dispose();
    this.highlightGeometry.dispose();
    (this.highlightMesh.material as THREE.Material).dispose();
    // 微光与裂纹共用缓存几何体（上面已经 dispose 过），这里只释放材质
    (this.glowMesh.material as THREE.Material).dispose();
  }
}

/** 把一个方块的若干盒子展开成"每个面一个四边形"（局部 UV 0~1），并整体外扩一点点 */
function buildBoxGeometry(boxes: readonly LocalBox[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const rawBox of boxes) {
    // 外扩：避免与方块表面 z-fighting
    const box: LocalBox = [
      Math.max(0, rawBox[0] - INFLATE),
      Math.max(0, rawBox[1] - INFLATE),
      Math.max(0, rawBox[2] - INFLATE),
      Math.min(1, rawBox[3] + INFLATE),
      Math.min(1, rawBox[4] + INFLATE),
      Math.min(1, rawBox[5] + INFLATE),
    ];

    for (const face of FACES) {
      const base = positions.length / 3;
      for (const corner of face.corners) {
        positions.push(...faceVertex(box, corner));
      }
      for (const uv of UVS) uvs.push(uv[0], uv[1]);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
