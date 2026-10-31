/**
 * 拉弓时的弹道预览（批次 20261031-1108）
 *
 * 一串白点 + 落点一个圆环。数据全由 `core/entity/ArrowPath.ts` 算好（纯函数），
 * 这里只负责"把点画出来"，不碰物理——渲染层不该知道弓的数值。
 *
 * 为什么用 `Points` 而不是一排小方块：一条抛物线上最多 80 个点，`Points` 是
 * 一个 draw call、一次 `BufferAttribute` 更新；方块要 80 个 mesh 与 80 次矩阵写入。
 *
 * 绘制约定（与 `BlockOverlay` 一致）：`depthWrite: false` + `transparent`，
 * 不写深度就不会把后面的东西挡掉；`depthTest` 保留，所以**被地形挡住的部分会自己消失**
 * （这也是它的用法提示：别对着墙瞄）。
 */

import * as THREE from 'three';
import type { ArrowPathPoint } from '../core/entity/ArrowPath.ts';

/** 点缓冲上限：与 `TRAJECTORY_STEPS` 取同一个量级，多留一点余量 */
const MAX_POINTS = 96;
/** 点的直径（世界单位）。0.1 在 10 格外仍然看得见，又不至于糊成一条线 */
const POINT_SIZE = 0.1;
/** 落点圆环的内外半径（世界单位） */
const RING_INNER = 0.16;
const RING_OUTER = 0.28;

export class TrajectoryPreview {
  readonly object = new THREE.Group();

  private readonly positions = new Float32Array(MAX_POINTS * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly points: THREE.Points;
  private readonly ring: THREE.Mesh;

  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(
      this.geometry,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: POINT_SIZE,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(RING_INNER, RING_OUTER, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    // 默认朝 +Z；转成"平铺在地面上"的圆环
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;

    this.object.add(this.points, this.ring);
  }

  /** 每帧刷新：`points` 是抛物线上的采样点，`landing` 是预计命中点（null = 打不到地面） */
  update(points: readonly ArrowPathPoint[], landing: ArrowPathPoint | null): void {
    const count = Math.min(points.length, MAX_POINTS);
    for (let i = 0; i < count; i++) {
      const point = points[i]!;
      this.positions[i * 3] = point.x;
      this.positions[i * 3 + 1] = point.y;
      this.positions[i * 3 + 2] = point.z;
    }
    this.geometry.setDrawRange(0, count);
    this.points.visible = count > 0;
    if (count > 0) this.geometry.getAttribute('position').needsUpdate = true;

    if (landing) {
      // 抬高 2cm：贴在地面上会和草方块顶面 z-fighting
      this.ring.position.set(landing.x, landing.y + 0.02, landing.z);
      this.ring.visible = true;
    } else {
      this.ring.visible = false;
    }
  }

  /** 不拉弓时收起（每帧都会调，所以必须是幂等的） */
  clear(): void {
    if (this.points.visible) {
      this.points.visible = false;
      this.geometry.setDrawRange(0, 0);
    }
    this.ring.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
  }
}
