/**
 * 方块选中描边
 *
 * 用单位立方体的 12 条棱画线框，整体放大千分之一避免与方块表面 z-fighting。
 * 开启 depthTest，所以被别的方块挡住时会自然消失（与原版一致）。
 */

import * as THREE from 'three';

export class BlockOutline {
  readonly object: THREE.LineSegments;
  private readonly geometry: THREE.EdgesGeometry;

  constructor() {
    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.geometry = new THREE.EdgesGeometry(box);
    box.dispose();

    const material = new THREE.LineBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
      depthTest: true,
      depthWrite: false,
    });

    this.object = new THREE.LineSegments(this.geometry, material);
    this.object.visible = false;
    this.object.renderOrder = 1;
  }

  show(x: number, y: number, z: number): void {
    this.object.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}
