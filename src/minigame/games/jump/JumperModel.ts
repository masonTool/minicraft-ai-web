/**
 * 跳一跳的**棋子小人**（批次 20261024-0415，`[跳4]`）
 *
 * 原版的小人是一枚国际象棋兵：球头 + 细颈 + 外扩裙摆，深蓝紫、无脸无四肢、哑光。
 * 原来用的是主世界的 `PlayerRenderer`（MC 玩家模型：方块头 + 四肢 + 走路动画），
 * 在一屏纯色方块的画面里像贴上去的贴纸，所以整块换掉。
 *
 * 比例全部来自 `.continue/notes/jump-original.md` §4 的像素测量（以**身高**为单位）：
 *
 *  · 总高 1.00（外部再乘 `0.72 × 方块边长`）
 *  · 头：球，直径 0.29，球心在 0.855
 *  · 颈：最细处直径 0.18，位于 0.74
 *  · 裙摆：底部直径 0.35
 *
 * 三条刻意的做法：
 *
 *  1. **原点在脚底**：这样"站到方块顶面"= 把 `object.position.y` 设成顶面高度，
 *     不需要记任何补偿量；蓄力压扁时也从脚底往下压，人不会陷进方块里。
 *  2. **不打光**：与方块同一套（`MeshBasicMaterial` + 顶点色），三面明暗用
 *     `palette.shadeForNormal()` 同一条公式，小人和方块不会一个亮一个暗。
 *  3. **压扁/空翻/朝向分三个 setter**：`scene.ts` 只管按状态机调，不在渲染层判断状态。
 */

import * as THREE from 'three';
import { shadeForNormal } from './palette.ts';

/** 小人默认颜色（02 实测主体 #38325A） */
export const JUMPER_COLOR = '#38325A';
/** 蓄力压扁的极值（规格表 §8） */
export const SQUASH_LIMIT = { y: 0.6, xz: 1.3 } as const;

/**
 * 侧影（半径, 高度）：从裙摆到颈，越往上越细。
 *
 * 用 `LatheGeometry` 而不是叠几个圆柱——叠圆柱在接缝处会有明显的折线，
 * 而原版的裙摆是一条平滑的外扩曲线。
 */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.175, 0],
  [0.168, 0.07],
  [0.152, 0.16],
  [0.133, 0.28],
  [0.113, 0.4],
  [0.096, 0.52],
  [0.09, 0.62],
  [0.094, 0.68],
  [0.082, 0.74],
];

/** 头的球心与半径（直径 0.29 身高） */
const HEAD_RADIUS = 0.145;
const HEAD_CENTER = 1 - HEAD_RADIUS;

export class JumperModel {
  /** 模型根节点：原点在脚底，+y 向上；缩放由 `setSize` 统一管 */
  readonly object: THREE.Group;

  private readonly body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly head: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;

  /** 由 `setSize` 写入的基础缩放（模型自身高 1） */
  private baseScale = 1;
  private squash = 0;
  private flip = 0;
  private yaw = 0;

  constructor(color: string = JUMPER_COLOR) {
    this.object = new THREE.Group();
    // 先偏航再空翻：空翻绕"自己的左右轴"，不是世界的 x 轴
    this.object.rotation.order = 'YXZ';

    const bodyGeometry = new THREE.LatheGeometry(
      PROFILE.map(([radius, y]) => new THREE.Vector2(radius, y)),
      32,
    );
    const headGeometry = new THREE.SphereGeometry(HEAD_RADIUS, 24, 16);
    headGeometry.translate(0, HEAD_CENTER, 0);

    this.body = new THREE.Mesh(bodyGeometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.head = new THREE.Mesh(headGeometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
    paint(this.body.geometry, color);
    paint(this.head.geometry, color);

    this.object.add(this.body, this.head);
    this.applyTransform();
  }

  /** 整体大小：模型高度 = 0.72 × 方块边长（规格表 §4） */
  setSize(edgeLength: number): void {
    const edge = Number.isFinite(edgeLength) && edgeLength > 0 ? edgeLength : 1;
    this.baseScale = edge * 0.72;
    this.applyTransform();
  }

  /**
   * 蓄力压扁：`ratio` 0~1 → 高度 1→0.6、横向 1→1.3。
   *
   * 原版是"压扁"而不是"蹲下"——所以横向要同时鼓出来，只压不改宽会像被踩进地里。
   */
  setSquash(ratio: number): void {
    const raw = Number.isFinite(ratio) ? ratio : 0;
    this.squash = Math.min(1, Math.max(0, raw));
    this.applyTransform();
  }

  /** 空中空翻（弧度）：`scene.ts` 按进度传入 0 → ±2π */
  setFlip(radians: number): void {
    this.flip = Number.isFinite(radians) ? radians : 0;
    this.applyTransform();
  }

  /** 朝向（弧度）：跳跃方向上"面朝前" */
  setYaw(radians: number): void {
    this.yaw = Number.isFinite(radians) ? radians : 0;
    this.applyTransform();
  }

  /** 位置（通常是方块顶面中心） */
  setPosition(x: number, y: number, z: number): void {
    this.object.position.set(x, y, z);
  }

  /** 落回站姿：清掉压扁与空翻（朝向保留） */
  resetPose(): void {
    this.squash = 0;
    this.flip = 0;
    this.applyTransform();
  }

  dispose(): void {
    for (const mesh of [this.body, this.head]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      this.object.remove(mesh);
    }
    this.object.clear();
  }

  private applyTransform(): void {
    const squashY = 1 - (1 - SQUASH_LIMIT.y) * this.squash;
    const squashXZ = 1 + (SQUASH_LIMIT.xz - 1) * this.squash;
    this.object.scale.set(this.baseScale * squashXZ, this.baseScale * squashY, this.baseScale * squashXZ);
    this.object.rotation.set(this.flip, this.yaw, 0);
  }
}

/**
 * 按法线把明暗烘进顶点色（与方块同一条公式，再叠一点"上亮下暗"）。
 *
 * ⚠️ 顶点色在 three 里是**线性**值，而这里算的是 sRGB 亮度，所以要经过
 * `setRGB(r, g, b, SRGBColorSpace)` 转一次——直接用会整体偏亮。
 */
function paint(geometry: THREE.BufferGeometry, color: string): void {
  const normal = geometry.getAttribute('normal');
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(normal.count * 3);
  const base = new THREE.Color(color);
  const srgb = base.clone().convertLinearToSRGB();
  const out = new THREE.Color();

  for (let i = 0; i < normal.count; i++) {
    const shade = shadeForNormal(normal.getX(i), normal.getY(i), normal.getZ(i));
    // 上亮下暗：裙摆底部再暗 15%，头部顶到最亮
    const height = Math.min(1, Math.max(0, position.getY(i)));
    const factor = shade * (0.85 + 0.15 * height);
    out.setRGB(srgb.r * factor, srgb.g * factor, srgb.b * factor, THREE.SRGBColorSpace);
    colors[i * 3] = out.r;
    colors[i * 3 + 1] = out.g;
    colors[i * 3 + 2] = out.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
