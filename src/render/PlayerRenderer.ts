/**
 * 玩家模型（第三人称，F7）
 *
 * 第一人称时"你看到的自己"只有手臂（`HandRenderer`）；切到第三人称就需要一整个小人，
 * 否则屏幕上什么都没有。这里用与生物同款的"方块拼小人"做法：头（含头发与五官）、
 * 躯干、双臂、双腿，比例按原版玩家模型（腿 0.75 + 身 0.75 + 头 0.5 ≈ 2.0 格，
 * 眼高 1.62 与物理的 `eyeY` 对得上）。
 *
 * 与 `MobRenderer` 的两点不同：
 *  - **层级式挂点**：腿绕髋部转、手臂绕肩转、头绕脖子转，所以用 `Group` 当枢轴、
 *    网格挂在枢轴下方；生物是实例化渲染（没有层级），摆腿只能绕方块中心转。
 *    玩家只有一个，多几个 `Mesh` 完全无所谓（约 15 次 draw call）。
 *  - **朝向**：本项目 `yaw=0` 时视线是 -Z（见 `PlayerPhysics.lookDirection`），
 *    所以模型的正脸朝 **-Z**，`root.rotation.y = yaw` 后正好与视线一致。
 *
 * 亮度沿用生物/方块那一套：按模型所在位置采样天光与方块光，乘到材质颜色上，
 * 因此进洞会变暗、站在火把旁会变亮。
 */

import * as THREE from 'three';

/** 肤色（与第一人称手臂同一个色，切换人称时不会"换个人"） */
const SKIN = 0xdc9a6b;
const HAIR = 0x2f2016;
const SHIRT = 0x00a8a8;
const PANTS = 0x3b4bb5;
const SHOES = 0x4a4a52;
const EYE = 0x1b2a44;

export interface PlayerPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** 走路相位（弧度），主循环按移动速度累加 */
  walkPhase: number;
  /** 摆动幅度 0~1 */
  walkAmount: number;
  /** 挥手进度 0~1（0 = 已经收回，与手持手臂共用节拍） */
  swing: number;
  /** 飞行中：双腿并拢不再走路摆动 */
  flying: boolean;
}

/** 亮度采样：返回该点的天光/方块光（区块未加载时返回 null） */
export type LightSampler = (x: number, y: number, z: number) => { sky: number; block: number } | null;

export class PlayerRenderer {
  readonly object = new THREE.Group();

  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  /** 每种颜色一份材质：亮度是本模型共用的，逐帧改材质颜色即可 */
  private readonly materials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly head: THREE.Group;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly skyBrightnessOf: () => number,
  ) {
    this.object.visible = false;
    this.scene.add(this.object);

    // ---- 双腿：枢轴在髋（y = 0.78），网格挂在枢轴下方
    this.legL = this.makePivot(0.125, 0.78, 0);
    this.legR = this.makePivot(-0.125, 0.78, 0);
    this.addBox(this.legL, 0.25, 0.72, 0.25, 0, -0.36, 0, PANTS);
    this.addBox(this.legR, 0.25, 0.72, 0.25, 0, -0.36, 0, PANTS);
    this.addBox(this.legL, 0.26, 0.12, 0.28, 0, -0.72, -0.01, SHOES);
    this.addBox(this.legR, 0.26, 0.12, 0.28, 0, -0.72, -0.01, SHOES);

    // ---- 躯干（0.78 ~ 1.46）
    this.addBox(this.object, 0.5, 0.68, 0.26, 0, 1.12, 0, SHIRT);

    // ---- 双臂：枢轴在肩（y = 1.44），袖子 + 手
    this.armL = this.makePivot(0.375, 1.44, 0);
    this.armR = this.makePivot(-0.375, 1.44, 0);
    for (const arm of [this.armL, this.armR]) {
      this.addBox(arm, 0.24, 0.46, 0.24, 0, -0.23, 0, SHIRT);
      this.addBox(arm, 0.22, 0.24, 0.22, 0, -0.58, 0, SKIN);
    }

    // ---- 头：枢轴在脖子（y = 1.46）
    this.head = this.makePivot(0, 1.46, 0);
    this.addBox(this.head, 0.5, 0.5, 0.5, 0, 0.25, 0, SKIN);
    // 头发：顶盖 + 后脑（正面留出脸）
    this.addBox(this.head, 0.52, 0.13, 0.52, 0, 0.44, 0, HAIR);
    this.addBox(this.head, 0.52, 0.37, 0.11, 0, 0.28, 0.2, HAIR);
    // 五官贴在 -Z 面（正脸朝 -Z）
    this.addBox(this.head, 0.1, 0.09, 0.02, 0.13, 0.3, -0.255, EYE);
    this.addBox(this.head, 0.1, 0.09, 0.02, -0.13, 0.3, -0.255, EYE);
    this.addBox(this.head, 0.13, 0.03, 0.02, 0, 0.15, -0.255, EYE);
  }

  /** 造一个挂点（枢轴），加到根节点上 */
  private makePivot(x: number, y: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    this.object.add(group);
    return group;
  }

  /** 往挂点上挂一个方块（尺寸用缩放实现，几何体全场共用一份） */
  private addBox(
    parent: THREE.Object3D,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    color: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, this.materialFor(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    parent.add(mesh);
    return mesh;
  }

  private materialFor(color: number): THREE.MeshBasicMaterial {
    let material = this.materials.get(color);
    if (!material) {
      material = new THREE.MeshBasicMaterial();
      // 原始分量要先存起来：逐帧的亮度会覆盖 material.color，
      // 下一次必须从"原始色"重新乘，否则亮度会一帧帧累积下去直到变黑。
      // 数值口径与 `MobRenderer` 一致（同样是"分量当线性值 + MeshBasicMaterial"），
      // 这样玩家和生物在同一个场景里的明暗表现完全相同。
      material.userData.base = {
        r: ((color >> 16) & 0xff) / 255,
        g: ((color >> 8) & 0xff) / 255,
        b: (color & 0xff) / 255,
      };
      material.color.setRGB(
        (material.userData.base as { r: number }).r,
        (material.userData.base as { g: number }).g,
        (material.userData.base as { b: number }).b,
      );
      this.materials.set(color, material);
    }
    return material;
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible;
  }

  get visible(): boolean {
    return this.object.visible;
  }

  /**
   * 逐帧摆姿势。
   *
   * 动画都改挂点的 rotation，网格本身不动：
   *  - 腿/手臂绕 X 轴前后摆（本项目正脸朝 -Z，所以 **正的 rotX = 向前甩**）
   *  - 头绕 X 轴俯仰（跟视线），摆幅夹在 ±1.1 弧度，避免脖子翻过去
   */
  update(pose: PlayerPose, sampleLight: LightSampler): void {
    if (!this.object.visible) return;

    this.object.position.set(pose.x, pose.y, pose.z);
    this.object.rotation.y = pose.yaw;

    // 走路：两条腿反相，手臂与腿反相（原版就是这个节奏）
    const walk = pose.flying ? 0 : Math.sin(pose.walkPhase) * pose.walkAmount * 0.85;
    this.legL.rotation.x = walk;
    this.legR.rotation.x = -walk;
    // 挥手：0→1→0 的一次前甩，叠加在走路摆臂上
    const swing = Math.sin(Math.min(1, pose.swing) * Math.PI) * 1.5;
    this.armL.rotation.x = -walk * 0.8;
    this.armR.rotation.x = walk * 0.8 - swing;
    // 飞行时手臂张开一点，看起来像在飘
    if (pose.flying) {
      this.armL.rotation.z = -0.25;
      this.armR.rotation.z = 0.25;
    } else {
      this.armL.rotation.z = 0;
      this.armR.rotation.z = 0;
    }

    const pitch = Math.max(-1.1, Math.min(1.1, pose.pitch));
    this.head.rotation.x = pitch;

    // ---- 光照：与生物同一条曲线（天光 × 昼夜亮度，或方块光取大者）
    const light = sampleLight(
      Math.floor(pose.x),
      Math.floor(pose.y + 1.5),
      Math.floor(pose.z),
    );
    const sky = light ? light.sky : 15;
    const block = light ? light.block : 0;
    const level = Math.max((sky / 15) * this.skyBrightnessOf(), block / 15);
    const brightness = Math.max(level / (4 - 3 * level), 0.08);

    for (const material of this.materials.values()) {
      const base = material.userData.base as { r: number; g: number; b: number };
      material.color.setRGB(base.r * brightness, base.g * brightness, base.b * brightness);
    }
  }

  dispose(): void {
    this.scene.remove(this.object);
    this.object.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.geometry.dispose();
  }
}
