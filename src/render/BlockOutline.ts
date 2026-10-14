/**
 * 方块选中描边
 *
 * 按方块的实际形状画线框（完整方块画立方体、台阶画半高盒子、火把画细柱），
 * 而不是一律画满格——否则选中台阶/火把时会套一个大方块，观感很不对。
 *
 * 几何体按 (方块 id, 状态) 缓存：同一形状只构建一次，切换目标时直接换 geometry。
 */

import * as THREE from 'three';
import { collisionBoxes, meshBoxes, type LocalBox } from '../core/registry/blockShapes.ts';
import type { BlockShape } from '../core/registry/blockState.ts';

/** 盒子放大一点点，避免与方块表面 z-fighting */
const INFLATE = 0.001;

export class BlockOutline {
  readonly object: THREE.LineSegments;

  private readonly cache = new Map<number, THREE.BufferGeometry>();
  private currentKey = -1;

  constructor() {
    const material = new THREE.LineBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
      depthTest: true,
      depthWrite: false,
    });
    this.object = new THREE.LineSegments(new THREE.BufferGeometry(), material);
    this.object.visible = false;
    this.object.renderOrder = 1;
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

function buildOutlineGeometry(shape: BlockShape, state: number): THREE.BufferGeometry {
  // 有碰撞体就用碰撞体画线框；火把/梯子没有碰撞，退回渲染形状
  const boxes = collisionBoxes(shape, state);
  const useBoxes = boxes.length > 0 ? boxes : meshBoxes(shape, state);
  return geometryFromBoxes(useBoxes);
}

function geometryFromBoxes(boxes: readonly LocalBox[]): THREE.BufferGeometry {
  const positions: number[] = [];

  for (const box of boxes) {
    const [x0, y0, z0, x1, y1, z1] = box;
    const ax = x0 - INFLATE;
    const ay = y0 - INFLATE;
    const az = z0 - INFLATE;
    const bx = x1 + INFLATE;
    const by = y1 + INFLATE;
    const bz = z1 + INFLATE;

    // 8 个顶点
    const v: [number, number, number][] = [
      [ax, ay, az],
      [bx, ay, az],
      [bx, ay, bz],
      [ax, ay, bz],
      [ax, by, az],
      [bx, by, az],
      [bx, by, bz],
      [ax, by, bz],
    ];
    // 12 条棱
    const edges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];

    for (const [a, b] of edges) {
      positions.push(...v[a]!, ...v[b]!);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
