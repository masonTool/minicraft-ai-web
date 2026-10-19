/**
 * 生物选中标记（批次 271，批次 275/276 改版）
 *
 * 为什么不能画方块描边：手指或准星指着一只猪时，方块射线会穿过它打到脚下/身后的方块，
 * 画面上亮的是那块方块——玩家会以为目标在方块上。所以生物目标一旦成立，
 * 方块描边收起，改由这一层告诉玩家"我在打谁"。
 *
 * 观感沿革：
 *  - 批次 271：一个 12 条棱的整白盒子（像"线框模型"，还挡生物身体）；
 *  - 批次 275：改成 8 个角的短括号 + 脚下光环；
 *  - 批次 276（用户："不要白框顶角，头上有个圈更方便定位"）：**只留一个头顶光环**。
 *    理由：脚下环要低头找、还容易被草/水挡住；头顶那圈正好在生物最容易辨认的位置，
 *    也不占身体。用 TorusGeometry（有厚度）而不是平面圆环，侧看也能看到一条亮线，
 *    不需要每帧对着相机做 billboard。
 *
 * 几何体是单位圆环，每帧按 `mob.width` 缩放、按 `mob.x / mob.y / mob.z` 定位，
 * 光环挂在 `mob.y + mob.height + HALO_LIFT`（头顶上方一点）。
 */

import * as THREE from 'three';
import type { Mob } from '../core/entity/Mob.ts';

/** 光环半径相对于生物宽度的比例 */
const HALO_RADIUS_RATIO = 0.32;
/** 小体型生物（鸡/鱼）的光环最小半径：太小会看不见 */
const HALO_MIN_RADIUS = 0.18;
/** 光环离头顶的高度（格）：高一点不会和头发/耳朵穿模 */
const HALO_LIFT = 0.14;
/** 圆环管径（相对半径）：0.055 在远处仍看得见，又不像一个实心甜甜圈 */
const HALO_TUBE = 0.055;
/** 选中色：偏青的白，和纯白的准星/方块描边区分开 */
const MARK_COLOR = 0xd6f6ff;

export class MobOutline {
  readonly object: THREE.Group;
  /** 头顶光环（可见性/位置/缩放由测试检查） */
  readonly halo: THREE.Mesh;

  constructor() {
    this.object = new THREE.Group();
    this.object.visible = false;
    this.object.renderOrder = 2;

    // 加法混合：在草地/雪地/夜空上都亮，但不会把生物涂成一块实心色。
    // depthTest 保持开启——隔墙不该看见"选中"。
    const material = new THREE.MeshBasicMaterial({
      color: MARK_COLOR,
      transparent: true,
      opacity: 0.78,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    // 半径 1、管径 HALO_TUBE；缩放时管径会跟着半径按比例变化（小生物细一点，符合直觉）
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(1, HALO_TUBE, 8, 32), material);
    this.halo.name = 'mob-halo';
    // TorusGeometry 默认躺在 XY 平面；转到 XZ 平面才是"头顶上的水平光环"
    this.halo.rotation.x = -Math.PI / 2;
    this.object.add(this.halo);
  }

  /** 套在某只生物身上（每帧调一次：生物会走） */
  show(mob: Mob): void {
    this.object.position.set(mob.x, mob.y, mob.z);
    const radius = Math.max(HALO_MIN_RADIUS, mob.width * HALO_RADIUS_RATIO);
    this.halo.scale.setScalar(radius);
    this.halo.position.y = mob.height + HALO_LIFT;
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.halo.geometry.dispose();
    (this.halo.material as THREE.Material).dispose();
  }
}
