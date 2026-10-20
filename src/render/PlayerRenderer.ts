/**
 * 玩家模型（第三人称，F7）
 *
 * 第一人称时"你看到的自己"只有手臂（`HandRenderer`）；切到第三人称就需要一整个小人，
 * 否则屏幕上什么都没有。这里用与生物同款的"方块拼小人"做法：头（含头发与五官）、
 * 躯干、双臂、双腿，比例按原版玩家模型（腿 0.75 + 身 0.75 + 头 0.5 ≈ 2.0 格，
 * 眼高 1.62 与物理的 `eyeY` 对得上）。
 *
 * 批次 241（用户："组成人物的方块可以更加精细"）：每个部位再拆细——腿是
 * 大腿/小腿/膝缝/鞋/鞋沿，躯干是胸/收腰/腰带/领口，手臂是肩头/上臂/前臂/手，
 * 头加了鬓角/刘海/耳朵/眉/鼻；同一部位的零件再用 `meshShade` 压/提一档明暗，
 * 靠"多一块、差一点色"做出体积（没有皮肤贴图，这是这套模型唯一能做细的办法）。
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
import { Item } from '../core/registry/items.ts';
import {
  bodyProportions,
  eyeProfileOf,
  type AppearancePalette,
  type BodyBuild,
  type BodyFrame,
  type EyeProfile,
  type EyeStyle,
} from '../game/appearance.ts';

/** 肤色（与第一人称手臂同一个色，切换人称时不会"换个人"） */
const SKIN = 0xdc9a6b;
const HAIR = 0x2f2016;
const SHIRT = 0x00a8a8;
const PANTS = 0x3b4bb5;
const SHOES = 0x4a4a52;
/** 嘴巴：暖一点的深玫瑰棕，比深蓝更像嘴唇（面部特写下差别明显） */
const MOUTH = 0x6b3f3a;
/** 眼白（批次 333）：虹膜外面那一圈浅色，让眼睛不再是一块深色贴片 */
const EYE_WHITE = 0xf2ece2;
/** 鞋底那一圈（比鞋面深）：让脚不是一块方砖 */
const SHOE_SOLE = 0x33333a;
/** 披风（批次 185 外观）：暗红，与皮肤的暖色区分开 */
const CAPE = 0x9b1b2f;
/** 副手盾牌（批次 275）：木板 + 深色竖条 + 铁箍，靠三色拼出"盾"的轮廓 */
const SHIELD_WOOD = 0x7a5a33;
const SHIELD_DARK = 0x54391f;
const SHIELD_IRON = 0x9aa0a6;
/** 手臂枢轴的出厂 x（批次 333：肩宽按体型比例缩放时以它为基准） */
const ARM_PIVOT_X = 0.375;

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
  /** 潜行（批次 185）：蹲下 + 前倾，腿的摆幅减半（原版"蹲着走"的观感） */
  sneaking?: boolean;
  /**
   * 游泳（F9，批次 432）：**身体横过来**贴在水面附近，手臂前伸划水。
   *
   * ⚠️ 这是**纯视觉**状态，物理上不改变任何判定（高度/碰撞/速度都在 `PlayerPhysics`）。
   * 独立一个字段而不是复用 `sneaking`：水里蹲下和游泳是两回事，
   * 复用会让"在水里按潜行下潜"时模型也缩成一团。
   */
  swimming?: boolean;
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
  /** 披风（批次 185）：挂在背后跟着躯干走，默认不显示 */
  private readonly capeMesh: THREE.Mesh;
  /** 副手盾牌（批次 275）：挂在左臂外侧，只有副手放盾牌时才显示 */
  private readonly offhandGroup: THREE.Group;
  /**
   * 按"角色部位"分组的网格（批次 187 外观）。
   * 换肤色/衣色就是把这几组网格的材质换掉——材质按颜色共享（`materialFor`），
   * 所以同一件颜色不会重复创建。
   */
  private readonly roleMeshes: Record<'skin' | 'shirt' | 'pants' | 'hair' | 'eye', THREE.Mesh[]> = {
    skin: [],
    shirt: [],
    pants: [],
    hair: [],
    eye: [],
  };
  /**
   * 发型 / 胡须的可显隐零件（批次 279 / 296）。
   *
   * 为什么按"零件组"分而不是重建几何：切预设只改 visible，不新建 Mesh；
   * 眉毛虽同用发色，但**不放进 `hairMeshes`**——光头不该连眉毛一起消失。
   */
  private readonly hairMeshes: THREE.Mesh[] = [];
  private readonly longHairMeshes: THREE.Mesh[] = [];
  private readonly ponytailMeshes: THREE.Mesh[] = [];
  /** 齐耳短发（批次 333）：两侧垂发 + 齐刘海 */
  private readonly bobMeshes: THREE.Mesh[] = [];
  /** 翘发（批次 333）：短发上的几撮外翘 */
  private readonly messyMeshes: THREE.Mesh[] = [];
  private readonly stubbleMeshes: THREE.Mesh[] = [];
  private readonly fullBeardMeshes: THREE.Mesh[] = [];
  /** 山羊胡（批次 333）：下巴一撮 + 上唇两条 */
  private readonly goateeMeshes: THREE.Mesh[] = [];
  /**
   * 眼睛零件（批次 333）：眼白 / 虹膜 / 上睫毛 / 眉毛。
   *
   * 眼型只改尺寸与显隐，不重建几何；眉毛带 `sign`（左 -1 / 右 +1）用来做镜像倾斜。
   */
  private readonly scleraMeshes: THREE.Mesh[] = [];
  private readonly irisMeshes: THREE.Mesh[] = [];
  private readonly lashMeshes: THREE.Mesh[] = [];
  private readonly brows: Array<{ mesh: THREE.Mesh; sign: 1 | -1 }> = [];
  /**
   * 体型比例（批次 333）：只缩放 x/z，不动高度。
   *
   * `region` 决定用哪一组倍率：躯干同时吃宽/深，四肢只吃粗细；
   * 盔甲片与身体在同一子树里，会跟着一起收放。
   */
  private readonly bodyParts: Array<{ mesh: THREE.Mesh; region: 'torso' | 'arm' | 'leg' }> = [];
  /** 每块网格的出厂缩放（比例计算必须从它重新乘，否则会一帧帧累积） */
  private readonly baseScales = new Map<THREE.Mesh, THREE.Vector3>();
  /** 当前生效的眼型 / 体型（验收脚本读取） */
  private currentEye: EyeProfile = eyeProfileOf('calm');
  private currentEyeStyle: EyeStyle = 'calm';
  private currentBuild: BodyBuild = 'adult';
  private currentFrame: BodyFrame = 'normal';
  /**
   * 每块网格的明暗系数（批次 241）。
   *
   * 同一部位拆成多块之后，如果全是同一个颜色，看起来仍是一整块；用 0.85 / 1.0 / 1.06
   * 这种轻微色差把"这是两个零件"做出来，比再建一套材质表便宜得多。
   */
  private readonly meshShade = new Map<THREE.Mesh, number>();

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
    // 先偏航再俯仰：潜行前倾要绕着**身体朝向**的 X 轴转，默认的 XYZ 会绕世界轴转
    this.object.rotation.order = 'YXZ';
    this.scene.add(this.object);

    // ---- 双腿：枢轴在髋（y = 0.78），网格挂在枢轴下方
    // 批次 241（用户："组成人物的方块可以更加精细"）：一条腿从"一整根 0.25×0.72 的柱子"
    // 拆成 大腿 → 小腿（略收 0.23）→ 膝缝 → 鞋 → 鞋沿。总高仍是 0.78，脚底仍落在 y=0，
    // 所以物理与第三人称镜头不用改。
    this.legL = this.makePivot(0.125, 0.78, 0);
    this.legR = this.makePivot(-0.125, 0.78, 0);
    for (const leg of [this.legL, this.legR]) {
      this.addRoleBox(leg, 0.25, 0.4, 0.25, 0, -0.2, 0, PANTS, 'pants');
      this.addRoleBox(leg, 0.23, 0.3, 0.23, 0, -0.55, 0, PANTS, 'pants', 0.9);
      // 膝缝：比小腿宽一点点，正好卡在两段中间，远看是一条横向折线
      this.addRoleBox(leg, 0.252, 0.035, 0.252, 0, -0.405, 0, PANTS, 'pants', 0.76);
      this.addBox(leg, 0.26, 0.12, 0.3, 0, -0.72, -0.02, SHOES);
      // 鞋沿：比鞋面宽/深 0.003，压在鞋帮上（不与底面共面，避免 z-fighting）
      this.addBox(leg, 0.265, 0.025, 0.305, 0, -0.735, -0.02, SHOE_SOLE);
    }

    // ---- 躯干（0.78 ~ 1.46）：胸 + 收腰 + 腰带 + 领口
    // 原来是一整块 0.5×0.68 的方柱；腰部收 0.04 之后，正面能看出"肩比腰宽"。
    this.addRoleBox(this.object, 0.5, 0.36, 0.26, 0, 1.28, 0, SHIRT, 'shirt');
    this.addRoleBox(this.object, 0.46, 0.34, 0.24, 0, 0.95, 0, SHIRT, 'shirt', 0.93);
    this.addRoleBox(this.object, 0.47, 0.05, 0.25, 0, 0.8, 0, PANTS, 'pants', 0.72);
    this.addRoleBox(this.object, 0.52, 0.05, 0.28, 0, 1.435, 0, SHIRT, 'shirt', 1.12);

    // ---- 双臂：枢轴在肩（y = 1.44）
    // 肩头 → 上臂（袖）→ 前臂（皮肤，略细）→ 手（略宽、提亮一档）。
    // ⚠️ 循环里**第一个**皮肤块必须用正色（`skin[0]`）：外观验收脚本拿它当"肤色样本"。
    this.armL = this.makePivot(0.375, 1.44, 0);
    this.armR = this.makePivot(-0.375, 1.44, 0);
    for (const arm of [this.armL, this.armR]) {
      this.addRoleBox(arm, 0.255, 0.1, 0.255, 0, -0.04, 0, SHIRT, 'shirt', 0.86);
      this.addRoleBox(arm, 0.24, 0.3, 0.24, 0, -0.2, 0, SHIRT, 'shirt');
      this.addRoleBox(arm, 0.22, 0.26, 0.22, 0, -0.47, 0, SKIN, 'skin');
      this.addRoleBox(arm, 0.23, 0.14, 0.23, 0, -0.63, 0, SKIN, 'skin', 1.06);
    }

    // ---- 头：枢轴在脖子（y = 1.46）
    // ⚠️ 第一块必须是**正色皮肤**（头本体）：离线测试把它当亮度/换色样本。
    this.head = this.makePivot(0, 1.46, 0);
    this.addRoleBox(this.head, 0.5, 0.5, 0.5, 0, 0.25, 0, SKIN, 'skin');
    // 头发：顶盖 + 后脑 + 两侧鬓角 + 刘海（正面留出脸）
    this.addHairBox(this.hairMeshes, this.head, 0.52, 0.13, 0.52, 0, 0.44, 0);
    this.addHairBox(this.hairMeshes, this.head, 0.52, 0.37, 0.11, 0, 0.28, 0.2);
    // 鬓角：外沿 0.272（头盔内径是 0.28，不能被顶穿）
    this.addHairBox(this.hairMeshes, this.head, 0.044, 0.2, 0.44, 0.25, 0.38, 0.02);
    this.addHairBox(this.hairMeshes, this.head, 0.044, 0.2, 0.44, -0.25, 0.38, 0.02);
    // 刘海：比发色亮一档（原来的 HAIR_HI ≈ 1.34 倍），远看能分出"发际线"
    this.addHairBox(this.hairMeshes, this.head, 0.52, 0.07, 0.08, 0, 0.465, -0.235, 1.34);
    // 长发：后脑一片 + 两侧垂发；马尾再多一束尾巴（默认隐藏，批次 279）
    this.addHairBox(this.longHairMeshes, this.head, 0.5, 0.5, 0.09, 0, 0.05, 0.22);
    this.addHairBox(this.longHairMeshes, this.head, 0.09, 0.42, 0.3, 0.24, 0.08, 0.05);
    this.addHairBox(this.longHairMeshes, this.head, 0.09, 0.42, 0.3, -0.24, 0.08, 0.05);
    this.addHairBox(this.ponytailMeshes, this.head, 0.14, 0.14, 0.14, 0, 0.3, 0.27);
    this.addHairBox(this.ponytailMeshes, this.head, 0.14, 0.42, 0.14, 0, 0.02, 0.31, 0.92);
    // 马尾的发绳（批次 333）：压暗一档的小方块，远看能分出"扎起来的那一束"
    this.addHairBox(this.ponytailMeshes, this.head, 0.16, 0.06, 0.16, 0, 0.35, 0.27, 0.5);
    // 齐耳短发（批次 333）：后脑 + 两侧垂到下颌 + 齐刘海
    this.addHairBox(this.bobMeshes, this.head, 0.5, 0.46, 0.1, 0, 0.03, 0.22);
    this.addHairBox(this.bobMeshes, this.head, 0.09, 0.4, 0.36, 0.24, 0.06, 0.0);
    this.addHairBox(this.bobMeshes, this.head, 0.09, 0.4, 0.36, -0.24, 0.06, 0.0);
    this.addHairBox(this.bobMeshes, this.head, 0.5, 0.1, 0.06, 0, 0.43, -0.245, 1.18);
    // 翘发（批次 333）：短发上的几撮外翘，少年感的主要来源之一
    const tuftA = this.addHairBox(this.messyMeshes, this.head, 0.15, 0.17, 0.15, 0.14, 0.5, 0.02, 1.1);
    tuftA.rotation.z = -0.38;
    const tuftB = this.addHairBox(this.messyMeshes, this.head, 0.13, 0.15, 0.13, -0.13, 0.51, 0.04, 1.08);
    tuftB.rotation.z = 0.34;
    const tuftC = this.addHairBox(this.messyMeshes, this.head, 0.12, 0.13, 0.12, 0.0, 0.53, 0.1, 1.15);
    tuftC.rotation.z = 0.18;
    // 胡须：胡茬（下颚一圈）与络腮胡（下颚 + 两颊 + 八字胡），默认隐藏
    this.addHairBox(this.stubbleMeshes, this.head, 0.44, 0.1, 0.06, 0, 0.07, -0.245, 0.8);
    this.addHairBox(this.stubbleMeshes, this.head, 0.1, 0.09, 0.06, 0.205, 0.12, -0.22, 0.8);
    this.addHairBox(this.stubbleMeshes, this.head, 0.1, 0.09, 0.06, -0.205, 0.12, -0.22, 0.8);
    this.addHairBox(this.fullBeardMeshes, this.head, 0.46, 0.18, 0.08, 0, 0.03, -0.245, 0.75);
    this.addHairBox(this.fullBeardMeshes, this.head, 0.12, 0.16, 0.08, 0.22, 0.12, -0.22, 0.75);
    this.addHairBox(this.fullBeardMeshes, this.head, 0.12, 0.16, 0.08, -0.22, 0.12, -0.22, 0.75);
    this.addHairBox(this.fullBeardMeshes, this.head, 0.24, 0.04, 0.03, 0, 0.195, -0.26, 0.9);
    // 山羊胡（批次 333）：下巴一撮 + 上唇两条
    this.addHairBox(this.goateeMeshes, this.head, 0.16, 0.14, 0.06, 0, 0.015, -0.245, 0.8);
    this.addHairBox(this.goateeMeshes, this.head, 0.08, 0.03, 0.03, 0.055, 0.19, -0.262, 0.9);
    this.addHairBox(this.goateeMeshes, this.head, 0.08, 0.03, 0.03, -0.055, 0.19, -0.262, 0.9);
    for (const group of [
      this.longHairMeshes,
      this.ponytailMeshes,
      this.bobMeshes,
      this.messyMeshes,
      this.stubbleMeshes,
      this.fullBeardMeshes,
      this.goateeMeshes,
      this.lashMeshes,
    ]) {
      for (const mesh of group) mesh.visible = false;
    }
    // 耳朵：外沿 0.278（与鬓角错开 0.006，避免两个平面重合打架），戴上头盔正好被罩住
    this.addRoleBox(this.head, 0.033, 0.11, 0.08, 0.2615, 0.24, 0.0, SKIN, 'skin', 0.9);
    this.addRoleBox(this.head, 0.033, 0.11, 0.08, -0.2615, 0.24, 0.0, SKIN, 'skin', 0.9);
    // 五官贴在 -Z 面（正脸朝 -Z）：眉 + 眼 + 鼻 + 嘴
    // 眉毛跟发色走，但不进 `hairMeshes`：光头时眉毛要留着。
    // 批次 333：眉毛的宽/高/倾斜由眼型决定（`applyEyes`），这里只记正负号做镜像。
    this.brows.push({ mesh: this.addRoleBox(this.head, 0.13, 0.028, 0.02, 0.13, 0.36, -0.255, HAIR, 'hair'), sign: 1 });
    this.brows.push({ mesh: this.addRoleBox(this.head, 0.13, 0.028, 0.02, -0.13, 0.36, -0.255, HAIR, 'hair'), sign: -1 });
    // 眼睛（批次 333）：眼白 + 虹膜 + 上睫毛。原来是一整块深色方块，看不出"在看哪"。
    for (const x of [0.13, -0.13]) {
      this.scleraMeshes.push(this.addBox(this.head, 0.105, 0.075, 0.02, x, 0.3, -0.254, EYE_WHITE));
      this.irisMeshes.push(this.addRoleBox(this.head, 0.055, 0.065, 0.02, x, 0.3, -0.264, 0x3a2a1e, 'eye'));
      this.lashMeshes.push(this.addRoleBox(this.head, 0.118, 0.016, 0.02, x, 0.335, -0.256, HAIR, 'hair', 0.8));
    }
    this.addRoleBox(this.head, 0.08, 0.05, 0.06, 0, 0.255, -0.27, SKIN, 'skin', 0.85);
    this.addBox(this.head, 0.13, 0.03, 0.02, 0, 0.15, -0.255, MOUTH);

    this.buildArmor();

    // ---- 披风（外观开关）与副手盾牌（批次 275）
    this.capeMesh = this.addBox(this.object, 0.46, 0.7, 0.04, 0, 1.1, 0.16, CAPE);
    this.capeMesh.visible = false;
    this.offhandGroup = new THREE.Group();
    this.offhandGroup.position.set(0.02, -0.28, -0.14);
    this.armL.add(this.offhandGroup);
    // 盾面 + 上下铁箍 + 中间深色竖条：远看是"盾"，不再是一块方板
    this.addBox(this.offhandGroup, 0.34, 0.4, 0.06, 0, 0, 0, SHIELD_WOOD);
    this.addBox(this.offhandGroup, 0.36, 0.05, 0.065, 0, 0.2, 0, SHIELD_IRON);
    this.addBox(this.offhandGroup, 0.36, 0.05, 0.065, 0, -0.2, 0, SHIELD_IRON);
    this.addBox(this.offhandGroup, 0.05, 0.4, 0.065, 0, 0, 0, SHIELD_DARK);
    this.offhandGroup.visible = false;

    // 批次 333：体型比例的快照必须在**全部零件（含盔甲/披风/盾牌）建好之后**再做，
    // 否则晚建的甲片拿不到自己的出厂尺寸。
    this.captureBodyParts();
  }

  /**
   * 换外观（批次 187 / 279 / 296）：颜色、发型、胡须、眼睛、体型全部在这里落地。
   *
   * 只换材质引用、只改 visible / scale，不动几何；材质按颜色共享，
   * 重复调用同一套配色不会新建对象。
   */
  setAppearance(palette: AppearancePalette): void {
    // 每块都乘上自己的明暗系数（批次 241）：同一部位拆细之后仍然"换一套衣服全跟着变"
    const roleColors: Array<['skin' | 'shirt' | 'pants' | 'hair' | 'eye', number]> = [
      ['skin', palette.skin],
      ['shirt', palette.shirt],
      ['pants', palette.pants],
      ['hair', palette.hair],
      ['eye', palette.eye],
    ];
    for (const [role, color] of roleColors) {
      for (const mesh of this.roleMeshes[role]) {
        mesh.material = this.materialFor(shadeHex(color, this.meshShade.get(mesh) ?? 1));
      }
    }

    // 发型：光头藏掉短发零件（眉毛不在 `hairMeshes` 里，仍然保留）
    const style = palette.hairStyle;
    const long = style === 'long' || style === 'ponytail';
    for (const mesh of this.hairMeshes) mesh.visible = style !== 'bald';
    for (const mesh of this.longHairMeshes) mesh.visible = long;
    for (const mesh of this.ponytailMeshes) mesh.visible = style === 'ponytail';
    for (const mesh of this.bobMeshes) mesh.visible = style === 'bob';
    for (const mesh of this.messyMeshes) mesh.visible = style === 'messy';

    // 胡须：胡茬在 stubble/full 出现；络腮胡只在 full；山羊胡只在 goatee
    for (const mesh of this.stubbleMeshes) {
      mesh.visible = palette.beard === 'stubble' || palette.beard === 'full';
    }
    for (const mesh of this.fullBeardMeshes) mesh.visible = palette.beard === 'full';
    for (const mesh of this.goateeMeshes) mesh.visible = palette.beard === 'goatee';

    // 眼型（尺寸 + 睫毛 + 眉形）与体型比例
    this.applyEyes(palette.eyes);
    this.applyProportions(palette.build, palette.frame);
  }

  /**
   * 眼型：只改眼白/虹膜的缩放、睫毛显隐、眉毛宽度与倾角。
   *
   * 三种眼型的目标尺寸在 `appearance.ts#eyeProfileOf` 里（纯函数，可离线断言）。
   */
  private applyEyes(style: EyeStyle): void {
    const profile = eyeProfileOf(style);
    this.currentEye = profile;
    this.currentEyeStyle = style;
    for (const mesh of this.scleraMeshes) {
      mesh.scale.x = profile.scleraWidth;
      mesh.scale.y = profile.scleraHeight;
    }
    for (const mesh of this.irisMeshes) {
      mesh.scale.x = profile.irisWidth;
      mesh.scale.y = profile.irisHeight;
    }
    for (const mesh of this.lashMeshes) mesh.visible = profile.lash;
    for (const { mesh, sign } of this.brows) {
      mesh.scale.x = profile.browWidth;
      mesh.scale.y = profile.browHeight;
      // 左右镜像：同一个倾角在两边看起来才是对称的拱眉
      mesh.rotation.z = sign * profile.browTilt;
    }
  }

  /**
   * 体型比例（批次 333）：只缩放横向，不动任何高度。
   *
   * 缩放必须从**出厂尺寸**重新乘（`baseScales`），否则连续调用会把倍率累积下去。
   */
  private applyProportions(build: BodyBuild, frame: BodyFrame): void {
    const p = bodyProportions(build, frame);
    this.currentBuild = build;
    this.currentFrame = frame;
    for (const part of this.bodyParts) {
      const base = this.baseScales.get(part.mesh);
      if (!base) continue;
      if (part.region === 'torso') {
        part.mesh.scale.x = base.x * p.torsoWidth;
        part.mesh.scale.z = base.z * p.torsoDepth;
      } else {
        part.mesh.scale.x = base.x * p.limb;
        part.mesh.scale.z = base.z * p.limb;
      }
    }
    this.armL.position.x = ARM_PIVOT_X * p.armSpread;
    this.armR.position.x = -ARM_PIVOT_X * p.armSpread;
  }

  /**
   * 记录"哪些网格跟着体型变"以及它们的出厂尺寸（批次 333）。
   *
   * - 手臂 / 腿：整个子树（含护肩、护腿、靴子）；
   * - 躯干：根节点直接挂着的网格（胸甲、腰带、髋部护甲），头是一个 Group，不会被收进来；
   * - 披风与副手盾牌排除（盾牌挂在手臂下，跟着枢轴走就够，不需要再变形）。
   */
  private captureBodyParts(): void {
    const collect = (root: THREE.Object3D, region: 'arm' | 'leg'): void => {
      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (this.isUnder(mesh, this.offhandGroup)) return;
        this.bodyParts.push({ mesh, region });
      });
    };
    collect(this.armL, 'arm');
    collect(this.armR, 'arm');
    collect(this.legL, 'leg');
    collect(this.legR, 'leg');
    for (const child of this.object.children) {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || mesh === this.capeMesh) continue;
      this.bodyParts.push({ mesh, region: 'torso' });
    }
  }

  private isUnder(node: THREE.Object3D, ancestor: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = node;
    while (current) {
      if (current === ancestor) return true;
      current = current.parent;
    }
    return false;
  }

  /** 验收脚本用：当前眼型的实际尺寸 */
  get eyeMetrics(): {
    style: EyeStyle;
    lash: boolean;
    scleraWidth: number;
    scleraHeight: number;
    irisWidth: number;
    browWidth: number;
    browTilt: number;
  } {
    return { style: this.currentEyeStyle, ...this.currentEye };
  }

  /** 验收脚本用：当前体型比例（只读） */
  get bodyMetrics(): {
    build: BodyBuild;
    frame: BodyFrame;
    armSpread: number;
    limb: number;
    torsoWidth: number;
    torsoDepth: number;
  } {
    const p = bodyProportions(this.currentBuild, this.currentFrame);
    return { build: this.currentBuild, frame: this.currentFrame, ...p };
  }

  /** 验收脚本用：这块网格在所属部位里的明暗系数（1 = 正色） */
  shadeOf(mesh: THREE.Mesh): number {
    return this.meshShade.get(mesh) ?? 1;
  }

  /** 外观：披风开/关（批次 185）。预览与第三人称共用同一个开关 */
  setCape(visible: boolean): void {
    this.capeMesh.visible = visible;
  }

  /**
   * 副手物品（批次 275）：只有盾牌会画在左臂外侧。
   *
   * 以前传的是布尔值——副手放火把/图腾也会画成一块盾牌板，
   * 看起来像"任何东西都能当盾牌"。现在按真实物品 id 判。
   */
  setOffhand(itemId: number | null): void {
    this.offhandGroup.visible = itemId === Item.SHIELD;
  }

  get capeVisible(): boolean {
    return this.capeMesh.visible;
  }

  /** 验收脚本用：副手盾牌现在可不可见 */
  get offhandVisible(): boolean {
    return this.offhandGroup.visible;
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
    this.baseScales.set(mesh, mesh.scale.clone());
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
  private addRoleBox(
    parent: THREE.Object3D,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    color: number,
    role: 'skin' | 'shirt' | 'pants' | 'hair' | 'eye',
    /** 明暗系数（1 = 正色；出厂色只在没走 `setAppearance` 时起作用） */
    shade = 1,
  ): THREE.Mesh {
    const mesh = this.addBox(parent, width, height, depth, x, y, z, color);
    this.roleMeshes[role].push(mesh);
    this.meshShade.set(mesh, shade);
    return mesh;
  }

  /** 发色零件：进 `roleMeshes.hair`，同时记进某个可显隐的零件组 */
  private addHairBox(
    group: THREE.Mesh[],
    parent: THREE.Object3D,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    shade = 1,
  ): THREE.Mesh {
    const mesh = this.addRoleBox(parent, width, height, depth, x, y, z, HAIR, 'hair', shade);
    group.push(mesh);
    return mesh;
  }

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
    // 批次 333：记下出厂尺寸，体型比例每次从它重新乘（避免倍率累积）
    this.baseScales.set(mesh, mesh.scale.clone());
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

    const sneak = !!pose.sneaking && !pose.flying;
    // 游泳优先于潜行：水里按潜行是"下潜"，不是"蹲着"，所以姿态用横着的那一套
    const swim = !!pose.swimming && !pose.flying;
    // 潜行：整体下沉 0.12 格并前倾 0.22 rad。模型是一整块（没有脊柱关节），
    // 前倾绕脚底转，看起来就是"缩着身子走"。
    // 游泳：**前倾到 1.25 rad（约 72°）**并抬 0.35 格——绕脚底转的时候人会整个沉到
    // 水面以下，抬这一下是让"趴在水面上"看起来对（数值靠目测，见 TASKS 的注记）。
    this.object.position.set(pose.x, pose.y + (swim ? 0.35 : sneak ? -0.12 : 0), pose.z);
    this.object.rotation.y = pose.yaw;
    this.object.rotation.x = swim ? 1.25 : sneak ? 0.22 : 0;

    // 走路：两条腿反相，手臂与腿反相（原版就是这个节奏）；蹲着走幅度减半
    const walk = pose.flying ? 0 : Math.sin(pose.walkPhase) * pose.walkAmount * (sneak ? 0.42 : 0.85);
    this.legL.rotation.x = walk;
    this.legR.rotation.x = -walk;
    // 挥手：0→1→0 的一次前甩，叠加在走路摆臂上
    const swing = Math.sin(Math.min(1, pose.swing) * Math.PI) * 1.5;
    // 潜行时两条手臂略向前收（原版蹲着时手臂是夹着的）；游泳时前伸划水
    const tuck = sneak ? 0.22 : swim ? 1.35 : 0;
    this.armL.rotation.x = -walk * 0.8 - tuck;
    this.armR.rotation.x = walk * 0.8 - swing - tuck;
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

/**
 * 把一个颜色按比例压暗/提亮（分量夹在 0~255）。
 *
 * 只用于"同一个部位的不同零件"：不引入调色板档位，也不额外建材质表——
 * 材质按颜色缓存，明暗档自然就落在 `materialFor` 里。
 * 纯函数，离线测试可以直接钉住边界（压到 0 / 提到 255 不溢出）。
 */
export function shadeHex(color: number, factor: number): number {
  const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
  const r = clamp(((color >> 16) & 0xff) * factor);
  const g = clamp(((color >> 8) & 0xff) * factor);
  const b = clamp((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}
