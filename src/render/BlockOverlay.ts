/**
 * 方块上的叠加层：破坏裂纹 + 命中面高亮（G2 / G3）
 *
 * 两件事共用一个类，因为它们都是"贴在某个方块表面上的薄片"，只是贴法不同：
 *  - **破坏裂纹**：把方块六个面各贴一遍裂纹贴图，按破坏进度换 0~9 阶段的贴图
 *  - **命中面高亮**：只在准星打到的那一个面上贴一层很淡的白色，让玩家看清"这一下会打在哪一面"
 *    （原版没有这个，属于本项目的可读性增强，所以做得非常淡）
 *
 * 关键实现点：
 *  1. 贴图 UV 用 uniform 传（`uTileOrigin` + `uTileSpan`），顶点里只存 0~1 的局部 UV，
 *     于是**换阶段不用重建几何体**——挖方块时每 0.1 秒就要换一次，重建几何体太浪费
 *  2. 几何体微微外扩 + polygonOffset，避免与被贴的方块表面 z-fighting
 *  3. `depthWrite: false`：叠加层不能写深度，否则会把后面的半透明水面切掉
 */

import * as THREE from 'three';
import { collisionBoxes, meshBoxes, type LocalBox } from '../core/registry/blockShapes.ts';
import type { BlockShape } from '../core/registry/blockState.ts';
import type { TextureAtlas } from './TextureAtlas.ts';

/** 破坏阶段数（原版就是 10 段） */
export const DAMAGE_STAGES = 10;

/** 外扩量：贴在方块表面外侧一点点，避免与方块面 z-fighting */
const INFLATE = 0.002;

/** 命中面高亮再往外一点（它贴在裂纹下面，两者同时出现时不能打架） */
const HIGHLIGHT_OFFSET = 0.004;

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
  private readonly cache = new Map<string, THREE.BufferGeometry>();
  private currentKey = '';
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
      uTileSpan: { value: new THREE.Vector2(1 / atlas.columns, 1 / atlas.rows) },
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
      opacity: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.highlightMesh = new THREE.Mesh(this.highlightGeometry, highlightMaterial);
    this.highlightMesh.frustumCulled = false;
    this.highlightMesh.visible = false;

    this.object.add(this.damageMesh, this.highlightMesh);
  }

  /**
   * 显示破坏裂纹。
   * @param stage 0~9（0 = 刚开始挖）
   */
  showDamage(x: number, y: number, z: number, shape: BlockShape, state: number, stage: number): void {
    const clamped = Math.max(0, Math.min(DAMAGE_STAGES - 1, Math.floor(stage)));
    this.lastStage = clamped;
    const key = `${shape}:${state & 0xff}`;
    if (key !== this.currentKey) {
      this.currentKey = key;
      let geometry = this.cache.get(key);
      if (!geometry) {
        const boxes = collisionBoxes(shape, state);
        geometry = buildBoxGeometry(boxes.length > 0 ? boxes : meshBoxes(shape, state));
        this.cache.set(key, geometry);
      }
      this.damageMesh.geometry = geometry;
    }

    const origin = this.atlas.tileOrigin(`destroy_stage_${clamped}`);
    (this.damageUniforms.uTileOrigin!.value as THREE.Vector2).set(origin[0], origin[1]);
    this.damageMesh.position.set(x, y, z);
    this.damageMesh.visible = true;
    this.object.visible = true;
  }

  hideDamage(): void {
    this.damageMesh.visible = false;
    if (!this.highlightMesh.visible) this.object.visible = false;
  }

  /** 高亮准星命中的那一个面 */
  showHighlight(x: number, y: number, z: number, normal: Vec3): void {
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

    this.highlightMesh.position.set(x, y, z);
    this.highlightMesh.visible = true;
    this.object.visible = true;
  }

  hideHighlight(): void {
    this.highlightMesh.visible = false;
    if (!this.damageMesh.visible) this.object.visible = false;
  }

  hide(): void {
    this.hideDamage();
    this.hideHighlight();
  }

  /** 验收脚本用：当前贴的是哪一张裂纹贴图（-1 = 没显示） */
  get damageStage(): number {
    return this.damageMesh.visible ? this.lastStage : -1;
  }

  get highlightVisible(): boolean {
    return this.highlightMesh.visible;
  }

  dispose(): void {
    for (const geometry of this.cache.values()) geometry.dispose();
    this.cache.clear();
    this.damageMesh.geometry.dispose();
    (this.damageMesh.material as THREE.Material).dispose();
    this.highlightGeometry.dispose();
    (this.highlightMesh.material as THREE.Material).dispose();
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
