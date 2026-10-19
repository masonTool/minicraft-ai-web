/**
 * 生物选中描边（批次 271）
 *
 * 与 `BlockOutline` 同一个观感：白/淡色线框，但套在生物的**碰撞盒**上。
 *
 * 为什么需要它：手指或准星指着一只猪时，方块射线会穿过它打到脚下/身后的方块，
 * 画面上亮的是那块方块——玩家会以为目标在方块上。生物目标一旦成立，
 * 方块描边收起、这个线框亮起，"我在打谁"才一眼可见。
 *
 * 几何体是一个 1×1×1 的单位盒（12 条棱），每帧按 `mob.width / mob.height`
 * 缩放、按 `mob.x / mob.y / mob.z` 定位。生物是移动的，所以**不能**缓存某个位置的盒子。
 */

import * as THREE from 'three';
import type { Mob } from '../core/entity/Mob.ts';

/** 线框比碰撞盒大一点点：贴着皮肤画会 z-fighting，也看不出是"套在外面的一层" */
const INFLATE = 0.02;

export class MobOutline {
  readonly object: THREE.LineSegments;

  constructor() {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
      depthWrite: false,
    });
    this.object = new THREE.LineSegments(geometry, material);
    this.object.visible = false;
    this.object.renderOrder = 2;
  }

  /** 套在某只生物身上（每帧调一次：生物会走） */
  show(mob: Mob): void {
    this.object.position.set(mob.x, mob.y - INFLATE, mob.z);
    this.object.scale.set(mob.width + INFLATE * 2, mob.height + INFLATE * 2, mob.width + INFLATE * 2);
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}
