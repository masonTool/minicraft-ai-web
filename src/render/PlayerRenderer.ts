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
 * 盔甲（E14）：四个部位各挂一组"比身体略大一圈"的甲片，**跟着所属身体部位一起动**
 * （头盔挂在头的枢轴上、护肩挂在手臂枢轴上），这样摆腿摆臂时甲片不会穿帮。
 *
 * 甲片用的是**纯色**而不是把 `item_<材质>_<部位>` 那张 16×16 图标直接贴上去：
 *  - 这套模型本来就是"方块拼小人 + 逐面明暗"，把带透明边距的图标贴上去反而像贴纸；
 *  - 取该图标的**平均色**当甲片颜色（`TextureAtlas.averageColor`），
 *    于是"背包里看到的图标"和"身上甲片的颜色"同源，换套甲不会出现颜色对不上的情况。
 *
 * 亮度沿用生物/方块那一套：按模型所在位置采样天光与方块光，乘到材质颜色上，
 * 因此进洞会变暗、站在火把旁会变亮。
 */

import * as THREE from 'three';
import { ARMOR_SLOT_COUNT } from '../core/registry/armor.ts';

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

  /**
   * 盔甲：每个部位一份材质（同部位的几块甲片共用），材质颜色按装备的材质换。
   * 用一个数组而不是 Map 是因为部位是固定的 4 个，下标就是背包 36-39 号槽的偏移。
   */
  private readonly armorMaterials: THREE.MeshBasicMaterial[] = [];
  /** 部位 → 该部位的所有甲片（换装备时统一显隐） */
  private readonly armorMeshes: Map<number, THREE.Mesh[]> = new Map();

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

    this.buildArmor();
  }

  /**
   * 盔甲甲片（E14）。
   *
   * 部位编号与背包槽位一一对应：0 头盔 / 1 胸甲 / 2 护腿 / 3 靴子。
   * 尺寸都比对应的身体部位大 0.02~0.06 格，靠"套在外面"而不是 z-fighting 来分层。
   * 挂点按"这块甲跟着谁动"来选：护肩挂手臂、大腿甲与靴子挂腿、头盔挂头。
   */
  private buildArmor(): void {
    const HELMET = 0;
    const CHEST = 1;
    const LEGS = 2;
    const BOOTS = 3;

    // 头盔：罩住整个脑袋（含头发），下面再压一圈帽檐，但不挡到眼睛（五官在 y=0.3）
    this.addArmorBox(HELMET, this.head, 0.56, 0.48, 0.56, 0, 0.28, 0);
    this.addArmorBox(HELMET, this.head, 0.5, 0.1, 0.62, 0, 0.06, -0.02);

    // 胸甲：躯干上段 + 两只护肩（护肩必须挂在手臂枢轴上，抬手时跟着走）
    this.addArmorBox(CHEST, this.object, 0.56, 0.52, 0.34, 0, 1.2, 0);
    this.addArmorBox(CHEST, this.armL, 0.28, 0.2, 0.28, 0, -0.04, 0);
    this.addArmorBox(CHEST, this.armR, 0.28, 0.2, 0.28, 0, -0.04, 0);

    // 护腿：髋部一圈 + 两条大腿
    this.addArmorBox(LEGS, this.object, 0.56, 0.24, 0.32, 0, 0.72, 0);
    this.addArmorBox(LEGS, this.legL, 0.28, 0.36, 0.28, 0, -0.2, 0);
    this.addArmorBox(LEGS, this.legR, 0.28, 0.36, 0.28, 0, -0.2, 0);

    // 靴子：连鞋一起裹住
    this.addArmorBox(BOOTS, this.legL, 0.3, 0.22, 0.32, 0, -0.64, -0.01);
    this.addArmorBox(BOOTS, this.legR, 0.3, 0.22, 0.32, 0, -0.64, -0.01);
  }

  private addArmorBox(
    slot: number,
    parent: THREE.Object3D,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
  ): void {
    let material = this.armorMaterials[slot];
    if (!material) {
      material = new THREE.MeshBasicMaterial();
      this.setBaseColor(material, 0xffffff);
      this.armorMaterials[slot] = material;
    }
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    // 默认不显示：没穿盔甲时身上不该多出一层白壳
    mesh.visible = false;
    parent.add(mesh);
    const list = this.armorMeshes.get(slot);
    if (list) list.push(mesh);
    else this.armorMeshes.set(slot, [mesh]);
  }

  /** 全部甲片网格（是否可见由 `setArmor` 决定）；离线测试与调试用 */
  get armorPlates(): readonly THREE.Mesh[] {
    const plates: THREE.Mesh[] = [];
    for (const meshes of this.armorMeshes.values()) plates.push(...meshes);
    return plates;
  }

  /**
   * 换装备。数组下标 = 背包 36-39 号槽的偏移，值为甲片颜色（`null` = 该部位空着）。
   *
   * 颜色由调用方给（`main` 取装备图标贴图的平均色）：渲染层不认识"材质"，
   * 也就不会在加一种盔甲材质时漏改这里。
   */
  setArmor(colors: readonly (number | null)[]): void {
    for (let slot = 0; slot < ARMOR_SLOT_COUNT; slot++) {
      const material = this.armorMaterials[slot];
      const meshes = this.armorMeshes.get(slot);
      if (!material || !meshes) continue;
      const color = colors[slot] ?? null;
      for (const mesh of meshes) mesh.visible = color !== null;
      // 颜色没变就别重算：`setBaseColor` 会新建一个对象，逐帧调用会平白产生垃圾
      if (color !== null && material.userData.rawColor !== color) {
        material.userData.rawColor = color;
        this.setBaseColor(material, color);
      }
    }
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
      this.setBaseColor(material, color);
      this.materials.set(color, material);
    }
    return material;
  }

  /**
   * 记下"原始色"并把当前颜色设成它。
   *
   * 原始分量必须先存起来：逐帧的亮度会覆盖 `material.color`，下一次必须从原始色重新乘，
   * 否则亮度会一帧帧累积下去直到变黑。数值口径与 `MobRenderer` 一致
   * （同样是"分量当线性值 + MeshBasicMaterial"），这样玩家和生物在同一场景里的明暗表现完全相同。
   */
  private setBaseColor(material: THREE.MeshBasicMaterial, color: number): void {
    const base = {
      r: ((color >> 16) & 0xff) / 255,
      g: ((color >> 8) & 0xff) / 255,
      b: (color & 0xff) / 255,
    };
    material.userData.base = base;
    material.color.setRGB(base.r, base.g, base.b);
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

    for (const material of this.materials.values()) this.applyBrightness(material, brightness);
    // 甲片跟着一起明暗变化，否则站在洞里只有身体变暗、甲还是亮的
    for (const material of this.armorMaterials) this.applyBrightness(material, brightness);
  }

  private applyBrightness(material: THREE.MeshBasicMaterial, brightness: number): void {
    const base = material.userData.base as { r: number; g: number; b: number };
    material.color.setRGB(base.r * brightness, base.g * brightness, base.b * brightness);
  }

  dispose(): void {
    this.scene.remove(this.object);
    this.object.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    for (const material of this.armorMaterials) material.dispose();
    this.geometry.dispose();
  }
}
