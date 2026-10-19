/**
 * 生物选中标记（批次 271，批次 275 改版）
 *
 * 为什么不能画方块描边：手指或准星指着一只猪时，方块射线会穿过它打到脚下/身后的方块，
 * 画面上亮的是那块方块——玩家会以为目标在方块上。所以生物目标一旦成立，
 * 方块描边收起，改由这一层告诉玩家"我在打谁"。
 *
 * 观感（批次 275 用户："白框能不能优化得更好一点"）：
 *  1. **不再画完整线框**——一个 12 条棱的白盒子套在猪身上像"线框模型"，
 *     还会挡住生物本身。改成 8 个角上的短括号（像现代游戏的选中框）；
 *  2. **脚下一圈青色光环**：移动目标最可靠的锚点是地面，环跟着走比盒子更稳，
 *     也不会遮住生物的身体；
 *  3. 颜色用偏青的白（`0xd6f6ff`），与准星/方块描边的纯白区分开，一眼能看出
 *     "这次选中的是生物"。
 *
 * 几何体是 1×1×1 的单位盒（括号在 8 个角上），每帧按 `mob.width / mob.height`
 * 缩放、按 `mob.x / mob.y / mob.z` 定位。生物是移动的，所以**不能**缓存某个位置的盒子。
 */

import * as THREE from 'three';
import type { Mob } from '../core/entity/Mob.ts';

/** 括号比碰撞盒大一点点：贴着皮肤画会 z-fighting，也看不出是"套在外面的一层" */
const INFLATE = 0.02;
/** 每个角上三条短边占整条棱的比例：0.22 已经能看出"括号"，又不会连成整框 */
const BRACKET = 0.22;
/** 脚下光环的外半径相对于生物宽度的比例 */
const RING_SCALE = 0.62;
/** 光环离脚底的高度（避免与地面 z-fighting） */
const RING_LIFT = 0.02;
/** 选中色：偏青的白，和纯白的准星/方块描边区分开 */
const MARK_COLOR = 0xd6f6ff;

export class MobOutline {
  readonly object: THREE.Group;
  /** 8 个角上的括号（可见性/缩放由测试检查） */
  readonly brackets: THREE.LineSegments;
  /** 脚下光环 */
  readonly ring: THREE.Mesh;

  constructor() {
    this.object = new THREE.Group();
    this.object.visible = false;
    this.object.renderOrder = 2;

    const bracketMaterial = new THREE.LineBasicMaterial({
      color: MARK_COLOR,
      transparent: true,
      opacity: 0.92,
      depthTest: true,
      depthWrite: false,
    });
    this.brackets = new THREE.LineSegments(bracketGeometry(BRACKET), bracketMaterial);
    this.brackets.name = 'mob-brackets';
    this.object.add(this.brackets);

    // 光环用加法混合：在草地/雪地上都亮，但不会把脚下的方块涂成一块实心色。
    // depthTest 保持开启——隔墙不该看见"选中"。
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: MARK_COLOR,
      transparent: true,
      opacity: 0.42,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), ringMaterial);
    this.ring.name = 'mob-ring';
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = RING_LIFT;
    this.object.add(this.ring);
  }

  /** 套在某只生物身上（每帧调一次：生物会走） */
  show(mob: Mob): void {
    this.object.position.set(mob.x, mob.y, mob.z);
    this.brackets.scale.set(mob.width + INFLATE * 2, mob.height + INFLATE * 2, mob.width + INFLATE * 2);
    // 光环略宽于碰撞盒的一半：贴着脚边，不压到身体
    const ringRadius = Math.max(0.32, mob.width * RING_SCALE);
    this.ring.scale.set(ringRadius, ringRadius, ringRadius);
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.brackets.geometry.dispose();
    (this.brackets.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
  }
}

/**
 * 8 个角上的括号：每个角沿 -x / -y / -z 各画一小段。
 *
 * 单位盒是 [-0.5, 0.5]；缩放之后括号长度会按各轴拉伸（高个子生物竖边变长），
 * 这正是想要的——它仍然是"这个盒子的一角"，而不是一条固定像素的刻度。
 */
function bracketGeometry(segment: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const half = 0.5;
  for (const x of [-half, half]) {
    for (const y of [-half, half]) {
      for (const z of [-half, half]) {
        // 三条短边都从角点朝盒子内部收，天然形成"⌜"形括号
        positions.push(x, y, z, x - Math.sign(x) * segment, y, z);
        positions.push(x, y, z, x, y - Math.sign(y) * segment, z);
        positions.push(x, y, z, x, y, z - Math.sign(z) * segment);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
