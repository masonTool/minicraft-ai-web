/**
 * 方块选中描边
 *
 * 按方块的实际形状画线框（完整方块画立方体、台阶画半高盒子、火把画细柱），
 * 而不是一律画满格——否则选中台阶/火把时会套一个大方块，观感很不对。
 *
 * ## 为什么不再用 `THREE.LineSegments`（批次 521）
 *
 * WebGL 里 `linewidth` **不生效**：`LineBasicMaterial` 画出来永远是一个设备像素的
 * 硬边线。而背板像素比常驻 2（`DPR × res`），等于这条线只有半个 CSS 像素宽，
 * 又细又硬；透视下立方体没有一条棱是正交的，于是斜棱变成一串阶梯——也就是
 * "斜着的线条有毛刺"。
 *
 * 现在每条棱画成一个**朝向相机的屏幕空间矩形带**（ribbon）：
 *  - 宽度按**像素**算（不随距离变粗变细，与基岩版的描边一致）；
 *  - 片元在带子两侧各留一段 `smoothstep` 渐隐 → 边缘自带抗锯齿；
 *  - 深度沿带子线性插值（与光栅化一致），所以"描边被地形挡住"的行为不变。
 *
 * 代价：12 条棱 × 2 三角形 = 24 个三角形、一次 draw call，可以忽略。
 */

import * as THREE from 'three';
import { collisionBoxes, meshBoxes, type LocalBox } from '../core/registry/blockShapes.ts';
import type { BlockShape } from '../core/registry/blockState.ts';

/** 盒子放大一点点，避免与方块表面 z-fighting */
const INFLATE = 0.001;

/**
 * 描边宽度（**CSS 像素**）。乘上背板像素比之后才是设备像素。
 *
 * 1.5 是"看得见但不抢戏"的折中：基岩版约 2px，但它是硬边；这里带渐隐，
 * 同样的视觉重量下取稍细一点。
 */
const OUTLINE_WIDTH_CSS = 1.5;

/** 描边颜色与不透明度（与改之前一致） */
const OUTLINE_COLOR = 0x000000;
const OUTLINE_OPACITY = 0.4;

const VERTEX_SHADER = /* glsl */ `
attribute vec3 aOther;
attribute float aSide;
attribute float aEnd;
uniform vec2 uViewport;
uniform float uWidth;
varying float vSide;

void main() {
  vec4 clipA = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 clipB = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);
  // 本顶点在哪一端：起点/终点各两个（带子左右各一），位置直接取那一端
  vec4 clip = mix(clipA, clipB, aEnd);

  // 屏幕像素空间里的方向 → 法线；再按像素宽度偏移。
  // ⚠️ 分母用 max(w, 1e-4)：描边框永远在相机前方，这里只是防"背后顶点"算出 NaN
  vec2 ndcA = clipA.xy / max(clipA.w, 1e-4);
  vec2 ndcB = clipB.xy / max(clipB.w, 1e-4);
  vec2 dir = (ndcB - ndcA) * uViewport;
  float len = length(dir);
  vec2 unit = len > 0.001 ? dir / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-unit.y, unit.x);

  // 像素偏移换算成裁剪空间：NDC 偏移要乘回 clip.w（透视除法之后才是 NDC）
  clip.xy += normal * (aSide * uWidth * 0.5) * (2.0 / uViewport) * clip.w;
  gl_Position = clip;
  vSide = aSide;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vSide;

void main() {
  // |vSide| 从带子中线 0 走到两侧 1；外圈 45% 渐隐 —— 抗锯齿就是这一行。
  // 中线保持实心，所以看起来仍是一条细黑线，而不是一条灰雾
  float alpha = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
  gl_FragColor = vec4(uColor, alpha * uOpacity);
}
`;

export class BlockOutline {
  readonly object: THREE.Mesh;

  private readonly cache = new Map<number, THREE.BufferGeometry>();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private currentKey = -1;

  constructor() {
    this.uniforms = {
      uViewport: { value: new THREE.Vector2(1, 1) },
      uWidth: { value: OUTLINE_WIDTH_CSS },
      uColor: { value: new THREE.Color(OUTLINE_COLOR) },
      uOpacity: { value: OUTLINE_OPACITY },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      // 带子的"正反"取决于棱的方向，统一双面（一个盒子也就 24 个三角形）
      side: THREE.DoubleSide,
    });
    this.object = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.object.visible = false;
    this.object.renderOrder = 1;
  }

  /**
   * 背板尺寸（设备像素）与像素比。
   *
   * 宽度是"CSS 像素"口径，必须乘像素比才是设备像素——不跟着动态分辨率走的话，
   * 玩家把分辨率降一档，描边就会跟着细一半。
   */
  setViewport(bufferWidth: number, bufferHeight: number, pixelRatio: number): void {
    (this.uniforms.uViewport!.value as THREE.Vector2).set(
      Math.max(1, bufferWidth),
      Math.max(1, bufferHeight),
    );
    this.uniforms.uWidth!.value = OUTLINE_WIDTH_CSS * Math.max(0.5, pixelRatio);
  }

  show(blockId: number, state: number, shape: BlockShape, x: number, y: number, z: number): void {
    const key = (blockId << 8) | (state & 0xff);
    if (key !== this.currentKey) {
      this.currentKey = key;
      let geometry = this.cache.get(key);
      if (!geometry) {
        geometry = buildOutlineGeometry(shape, state);
        this.cache.set(key, geometry);
      }
      this.object.geometry = geometry;
    }
    this.object.position.set(x, y, z);
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    for (const geometry of this.cache.values()) geometry.dispose();
    this.cache.clear();
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}

/**
 * 形状 → 描边几何（12 条棱的 ribbon）。
 *
 * 导出是为了能离线断言：每个盒子正好 12 条棱、每条棱 4 个顶点、两端点互为
 * `aOther`（写反了那条棱会缩成一个点，画面上就是"框缺一条边"）。
 */
export function buildOutlineGeometry(shape: BlockShape, state: number): THREE.BufferGeometry {
  // 有碰撞体就用碰撞体画线框；火把/梯子没有碰撞，退回渲染形状
  const boxes = collisionBoxes(shape, state);
  const useBoxes = boxes.length > 0 ? boxes : meshBoxes(shape, state);
  return geometryFromBoxes(useBoxes);
}

/** 一个盒子的 12 条棱（8 个顶点两两相连的顺序） */
const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function geometryFromBoxes(boxes: readonly LocalBox[]): THREE.BufferGeometry {
  const edgeCount = boxes.length * BOX_EDGES.length;
  const vertexCount = edgeCount * 4;
  const positions = new Float32Array(vertexCount * 3);
  const others = new Float32Array(vertexCount * 3);
  const sides = new Float32Array(vertexCount);
  const ends = new Float32Array(vertexCount);
  const indices = new Uint32Array(edgeCount * 6);

  let vertex = 0;
  let edge = 0;

  for (const box of boxes) {
    const [x0, y0, z0, x1, y1, z1] = box;
    const ax = x0 - INFLATE;
    const ay = y0 - INFLATE;
    const az = z0 - INFLATE;
    const bx = x1 + INFLATE;
    const by = y1 + INFLATE;
    const bz = z1 + INFLATE;

    const corners: readonly (readonly [number, number, number])[] = [
      [ax, ay, az],
      [bx, ay, az],
      [bx, ay, bz],
      [ax, ay, bz],
      [ax, by, az],
      [bx, by, az],
      [bx, by, bz],
      [ax, by, bz],
    ];

    for (const [from, to] of BOX_EDGES) {
      const a = corners[from]!;
      const b = corners[to]!;
      // 每端两个顶点：side = -1 / +1（带子的左侧与右侧）
      for (const end of [0, 1] as const) {
        const p = end === 0 ? a : b;
        const o = end === 0 ? b : a;
        for (const side of [-1, 1] as const) {
          positions[vertex * 3] = p[0];
          positions[vertex * 3 + 1] = p[1];
          positions[vertex * 3 + 2] = p[2];
          others[vertex * 3] = o[0];
          others[vertex * 3 + 1] = o[1];
          others[vertex * 3 + 2] = o[2];
          sides[vertex] = side;
          ends[vertex] = end;
          vertex++;
        }
      }
      const base = edge * 4;
      indices[edge * 6] = base;
      indices[edge * 6 + 1] = base + 1;
      indices[edge * 6 + 2] = base + 3;
      indices[edge * 6 + 3] = base;
      indices[edge * 6 + 4] = base + 3;
      indices[edge * 6 + 5] = base + 2;
      edge++;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aOther', new THREE.BufferAttribute(others, 3));
  geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
