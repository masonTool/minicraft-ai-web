/**
 * 信标的光柱（K5，批次 117）
 *
 * 信标最显眼的地方就是那道**冲天光柱**，而它是运行时状态（几级金字塔、在不在加载范围内），
 * 烘不进区块网格，所以单独画——与展示框里的物品（`ItemFrameRenderer`）、
 * 告示牌上的字（`SignRenderer`）同一条路。
 *
 * 三处取舍：
 *  1. **两片交叉的竖直四边形**（"十字"）：原版光柱就是一个十字片，好处是从任何角度看
 *     都有一条完整的柱子；单面材质会被背面剔除，所以材质用 `DoubleSide`；
 *  2. **不贴图、不引图集**：光柱是一条半透明白光，纯色 + 加法混合（`AdditiveBlending`）
 *     就够了——省掉一张贴图与 UV 换算，也不牵扯图集那套 `NoColorSpace` 的讲究；
 *  3. **`depthWrite = false` + `renderOrder`**：光柱要是写深度，会把它后面的水面/叶子
 *     切出一道硬边；不写深度、最后画，它就只是"叠在上面的一层光"。
 *
 * ⚠️ 与原版的差异：光柱的**颜色不可染色**（原版在信标顶上盖一块染色玻璃就能给光柱上色，
 * 见 TASKS K5）。
 */

import * as THREE from 'three';
import { WORLD_MAX_Y } from '../core/world/Chunk.ts';

/** 一根光柱：脚下那格信标 + 它的高度（世界坐标） */
export interface BeaconBeamSpec {
  /** 信标那一格的整数坐标 */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 光柱的半宽（格）：原版约 0.3，这里稍宽一点，远处才看得见 */
const BEAM_HALF_WIDTH = 0.22;
/** 光柱的不透明度（加法混合，所以这个值很小就够亮） */
const BEAM_OPACITY = 0.34;

export class BeaconBeamRenderer {
  readonly group = new THREE.Group();

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly meshes: THREE.Mesh[] = [];
  /** 这一帧画了几根（调试面板读它） */
  private visible = 0;

  constructor() {
    // 一个 1 格高的单位四边形（y 从 0 到 1），两片交叉：一片在 XZ 平面上沿 X 展开、
    // 一片沿 Z 展开。缩放交给 `mesh.scale.y`，所以这里只画单位高度
    const w = BEAM_HALF_WIDTH;
    const positions = new Float32Array([
      -w, 0, 0, w, 0, 0, w, 1, 0, -w, 1, 0,
      0, 0, -w, 0, 0, w, 0, 1, w, 0, 1, -w,
    ]);
    const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setIndex(indices);

    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: BEAM_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }

  /** 这一帧要画的光柱（每帧调一次；不多于上一帧的那些会被隐藏） */
  sync(beams: readonly BeaconBeamSpec[]): void {
    this.visible = beams.length;
    for (let i = 0; i < beams.length; i++) {
      const beam = beams[i]!;
      let mesh = this.meshes[i];
      if (!mesh) {
        mesh = new THREE.Mesh(this.geometry, this.material);
        // 与其它叠加层一样：不写深度、最后画
        mesh.renderOrder = 2;
        mesh.frustumCulled = false;
        this.meshes.push(mesh);
        this.group.add(mesh);
      }
      // 从信标顶面一直顶到世界高度上限（原版的光柱也是打满天空）
      const bottom = beam.y + 1;
      mesh.position.set(beam.x + 0.5, bottom, beam.z + 0.5);
      mesh.scale.set(1, Math.max(1, WORLD_MAX_Y - bottom), 1);
      mesh.visible = true;
    }
    for (let i = beams.length; i < this.meshes.length; i++) {
      this.meshes[i]!.visible = false;
    }
  }

  /** 隐藏全部（换维度/切存档时用） */
  clear(): void {
    this.sync([]);
  }

  get count(): number {
    return this.visible;
  }

  dispose(): void {
    for (const mesh of this.meshes) this.group.remove(mesh);
    this.meshes.length = 0;
    this.geometry.dispose();
    this.material.dispose();
  }
}
