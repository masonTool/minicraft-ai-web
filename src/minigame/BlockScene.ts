/**
 * 小游戏的**共享方块渲染**（小游戏2，批次 20261022-1954）
 *
 * 一块小关卡（推箱子的墙 + 地板、打砖块的砖）用 `InstancedMesh` 画：
 * 按图集贴图分组，每组一个 draw call（关卡通常只有 3~5 种方块）。
 *
 * 四个刻意的做法：
 *
 *  1. **UV 映射而不是另画一套贴图**：几何体是单位立方体，6 个面的 UV 被线性映射到
 *     `atlas.uv(tile)` 返回的那一小块——于是小游戏里的方块和主世界长得一样，
 *     不需要第二套素材。
 *  2. **一个材质、多份几何体**：不同 tile 的差别在几何体的 UV 上，材质（Lambert + 图集）
 *     可以共享；退出时只 dispose 一次材质，不会有"漏了几个材质"的问题。
 *  3. **`frustumCulled = false`**：`InstancedMesh` 的包围球是按单位立方体算的，
 *     整组方块会被误判到视锥外（表现是"方块一阵一阵消失"）。小场景不做裁剪最稳。
 *  4. **斜 45° 视角**（从 `(1,1,1)` 方向看中心）：这是方块类小游戏最易读的角度——
 *     同时看到顶面和两个侧面，格子的前后关系一眼能分出来。
 */

import * as THREE from 'three';
import type { TextureAtlas } from '../render/TextureAtlas.ts';
import { buildBlockGroups, type BlockInstance } from './blockGroups.ts';

export interface BlockSceneOptions {
  readonly atlas: TextureAtlas;
  /** 关卡中心（格子坐标，函数内部 +0.5 对到方块中心） */
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  /** 关卡最大边长：决定相机距离与远裁面 */
  readonly size: number;
}

export class BlockScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly atlas: TextureAtlas;
  /** 所有组共用一份材质（差别在各自几何体的 UV 上） */
  private readonly material: THREE.MeshLambertMaterial;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private instanceTotal = 0;

  constructor(options: BlockSceneOptions) {
    this.atlas = options.atlas;
    const extent = Math.max(1, options.size);
    const center = new THREE.Vector3(options.center.x + 0.5, options.center.y + 0.5, options.center.z + 0.5);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d141c);

    // 环境光保证背光面不是纯黑；方向光给顶面一点层次
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(1, 2, 1.2);
    this.scene.add(sun);

    this.material = new THREE.MeshLambertMaterial({ map: this.atlas.texture });

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, extent * 8);
    const distance = extent * 1.7;
    this.camera.position.set(center.x + distance, center.y + distance, center.z + distance);
    this.camera.lookAt(center);
  }

  /** 重建整批方块（先释放上一批） */
  setBlocks(blocks: readonly BlockInstance[]): void {
    this.clearMeshes();
    const { groups } = buildBlockGroups(blocks);
    const matrix = new THREE.Matrix4();

    for (const group of groups) {
      const [u0, v0, u1, v1] = this.atlas.uv(group.tile);
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        // 先读出来再写：`setXY` 会同时改 u/v，边读边写容易把其中一个覆盖掉
        const u = uv.getX(i);
        const v = uv.getY(i);
        uv.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0));
      }
      uv.needsUpdate = true;

      const mesh = new THREE.InstancedMesh(geometry, this.material, group.positions.length);
      for (let i = 0; i < group.positions.length; i++) {
        const position = group.positions[i]!;
        matrix.makeTranslation(position.x + 0.5, position.y + 0.5, position.z + 0.5);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      // 见文件头第 3 条：不做视锥裁剪，否则整组会随视角"消失"
      mesh.frustumCulled = false;

      this.geometries.push(geometry);
      this.meshes.push(mesh);
      this.scene.add(mesh);
      this.instanceTotal += group.positions.length;
    }
  }

  /** draw call 组数（等于方块种类数） */
  get groupCount(): number {
    return this.meshes.length;
  }

  /** 当前实例总数（方块数） */
  get instances(): number {
    return this.instanceTotal;
  }

  /** 视口变化时更新相机宽高比（横竖屏切换要调） */
  setViewport(width: number, height: number): void {
    this.camera.aspect = Math.max(0.01, width / Math.max(1, height));
    this.camera.updateProjectionMatrix();
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clearMeshes();
    this.material.dispose();
    this.scene.clear();
  }

  private clearMeshes(): void {
    for (const mesh of this.meshes) this.scene.remove(mesh);
    this.meshes.length = 0;
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.length = 0;
    this.instanceTotal = 0;
  }
}
