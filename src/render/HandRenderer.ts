/**
 * 第一人称手持物品与手臂（E15）
 *
 * 单独一个场景 + 单独一台相机，在世界渲染完之后 `clearDepth()` 再画一遍：
 * 这是原版的做法，好处是手臂永远不会被地形穿模、也不受雾影响，
 * 而且两个场景互不干扰（手里的方块不会真的出现在世界坐标里）。
 *
 * ## 尺寸口径：「屏幕高比例」单位（批次 20261024-1726 重做）
 *
 * 这套几何**一律按屏幕比例**定义（1 单位 = 屏幕高度的 1/1，在握点深度处），
 * 每帧再由 `syncRig()` 按 `fov`/`aspect` 换算成世界尺度。原来的写法是把
 * 0.15 / 0.44 这类"世界格"写死，于是：换分辨率、换 FOV、上下分屏都会走形，
 * 更要命的是**手臂根部离镜头只有 0.1 格**，透视把它放大成一块贴着屏幕的褐色墙。
 *
 * 换算公式（`k = tan(fov/2)`）：
 *   · 深度 `d = GRIP_DEPTH * k / kRef`（`kRef = tan(REFERENCE_FOV/2)`）
 *   · 1 个几何单位 → 世界 `2 * k * d` 格
 *   · 握点世界坐标 → 屏幕比例 (fx, fy) 反推
 * 这样"手里的东西占几成屏幕高"是个可以直接读的数，不用再靠猜。
 *
 * ⚠️ 手用**自己的一套视野**（`VIEWMODEL_FOV`，见 `update()`），不跟世界视野走。
 * 第一版让手跟着世界 fov 换算尺寸，结果 90° 视野下"尺寸/距离"比也跟着放大、
 * 透视把方块近角推得更远 —— 实测同一块石头在 fov60 是 0.57×0.66 屏高，
 * fov90 变成 0.97×0.81 屏高、右缘跑到 118%（右半边整块出画）。
 * 「屏幕占比固定」和「透视形状固定」在同一个相机里没法同时成立
 * （尺寸 ∝ 屏幕占比 × 深度，而透视强度 ∝ 尺寸/深度），所以手直接钉死在
 * `VIEWMODEL_FOV` 上：世界视野怎么调，手里的东西都是同一张脸。
 *
 * ## 为什么要重做（批次 20261024-1726 的用户反馈）
 *
 * 用户：「手持物品的显示还是有很大的问题」。实测（1280×720，创造模式天空）：
 *   · 空手手臂：包围盒 x 72%~346%、y 75%~514%，最近处 0.10 格 —— 一块褐色墙
 *   · 手持方块：x 59%~103%、y 47%~118% —— 比原版大一圈还顶到画面中间
 *   · 手持钻石剑：x 61%~109%、y 31%~90%，且**斜跨整个屏幕**、翻出两条"彩带"
 *
 * 根因三条，各自对应本文件的一处结构性改动：
 *   1. 手臂从"手"往镜头方向延伸，根部几乎贴在近裁面上 → 改成伸向屏幕右下角，
 *      根部落在画面外（见 `ARM_DIRECTION` / `ARM_LENGTH`）；
 *   2. 扁平物品的**厚度边也贴了整张图标**，16px 的图标压到 2px 宽的边上，
 *      斜向的剑就被拉成细长的彩带 → 厚度边只取图标**最外那一列/行**
 *      （见 `applySpriteUvs`，图标那里是透明的地方 alphaTest 直接裁掉）；
 *   3. 物品尺寸/位置是写死的世界格数，放大 2 倍之后与握点深度不匹配
 *      → 全部改成屏幕比例（`BLOCK_SIZE` / `SPRITE_SIZE`）。
 */

import * as THREE from 'three';
import { TILE_SIZE as TILE_PIXELS, type TextureAtlas } from './TextureAtlas.ts';
import { SHIRT_COLORS, type AppearancePalette } from '../game/appearance.ts';
import { blockForItem, itemIconTile } from '../core/registry/items.ts';
import { blockDef } from '../core/registry/blocks.ts';
import { isFullBlockShape } from '../core/registry/blockShapes.ts';
import { applyFaceShade, applyFaceUvs, applySpriteFaceUvs, blockFaceTiles, FACE_SHADE } from './atlasMesh.ts';
import { buildHeldSprite, type HeldSprite } from './heldSprite.ts';
import { srgbColor } from './srgb.ts';

/**
 * 握点：手（也就是手里的东西）在屏幕上的位置，以及它离镜头的距离（格）。
 *
 * `x/y` 是屏幕比例（0~1，左上为原点），换成世界坐标的公式见文件头。
 * 0.72 / 0.80 大致是原版"物品落在右下象限、下缘被屏幕切掉一点"的位置。
 *
 * ⚠️ 深度写死 0.95 格（不随 FOV 变）：物品离镜头太近会被透视拉歪，
 * 太远又会挤到准星上。0.95 格 + 下面的屏幕比例缩放，在 60°~90° 视野下都稳。
 */
const GRIP_SCREEN_X = 0.72;
const GRIP_SCREEN_Y = 0.8;
/** 握点到镜头的距离（格）——只在 `VIEWMODEL_FOV` 这个固定视角下有意义 */
const GRIP_DEPTH = 0.95;
/**
 * 手部自己的视野（度）：**不跟世界视野走**。
 *
 * 手画在单独的场景 + 单独的相机里，本来就该按"视图模型"处理：世界视野从 45° 调到
 * 90°，手里的东西大小和透视都不应该变（否则 90° 时方块会被拉得又大又歪、右缘出画）。
 * 70° 是原版桌面的默认视野，这里的构图就是在这个视角下量出来的。
 */
const VIEWMODEL_FOV = 70;

/**
 * 方块：边长与相对握点的偏移（都是屏幕高比例）。
 *
 * 边长 0.37 → 投影后（含透视与斜放）约占屏幕高 60%；偏移把它往右下挪，
 * 让**上缘落在屏幕 62% 附近、下缘被屏幕切掉** —— 原版举着方块就是这个构图。
 * （实测包围盒：x 64%~96%、y 62%~128%。）
 */
const BLOCK_SIZE = 0.37;
const BLOCK_OFFSET: readonly [number, number, number] = [0.05, -0.09, 0];
/**
 * 方块握持姿态：绕 Y 转 45°（露出两个侧面）、绕 X 抬 24°（露出顶面）。
 *
 * 原版的方块是"一个角朝着你"的：顶面 + 两个侧面一共三面可见，且顶面最亮。
 * 不给 Z 轴滚转——滚过之后立方体的竖边是斜的，看着像没放稳。
 */
const BLOCK_ROTATION: readonly [number, number, number] = [0.42, Math.PI / 4, 0];

/**
 * 扁平物品（工具/武器/食物…）。
 *
 * · 边长 0.52（屏幕高比例）：投影后约屏幕高 58%，对齐原版"手里东西占右侧一大块"的观感；
 * · 挤出深度 0.035（≈ 1 个像素格）：**按图标轮廓**挤出的实体，剑就是一把有厚度的剑
 *   （批次 2136 用户："能有 3D 的效果、分辨率再高一点、同时增加一点厚度"）；
 * · 对齐口径：**图标里不透明那块的底边中点**落在握点上（见 `spriteGeometry`）。
 */
const SPRITE_SIZE = 0.52;
/**
 * 2.5D 贴图的烘制参数（见 `heldSprite.ts`）。
 *
 * · `SPRITE_SCALE_PASSES = 2`：Scale2x 跑两遍 = 4×，斜边台阶补小、**颜色不变**（不糊）；
 *   上一版用双线性放大，用户："太糊了，起码要像一把剑吧，而且要清晰"。
 * · `SPRITE_DEPTH_PIXELS = 8`：厚度 = 8 个画布像素（4× 下 ≈ 2 个像素格 ≈ 0.065 屏高），沿右下挤出。
 *   再厚就会把整件的轮廓吃掉一半（15px 那版像给图标描了一圈投影）。
 */
const SPRITE_SCALE_PASSES = 2;
const SPRITE_DEPTH_PIXELS = 8;
const SPRITE_OFFSET: readonly [number, number, number] = [0.06, 0, 0];
/**
 * 扁平物品的握持姿态：图标正面朝镜头，稍微转开一点露出厚度，刃朝上偏右。
 *
 * ⚠️ 别给 Y 轴大角度（旧值 -0.55）：平面转过去之后图标会被压扁，
 * 加上透视就成了"一条斜跨屏幕的带子"。
 */
const SPRITE_ROTATION: readonly [number, number, number] = [-0.1, -0.24, 0.14];

/**
 * 手臂（空手时可见）：粗细与长度（都是**屏幕高比例**）、朝向。
 *
 * 朝向 `(0.62, -0.55, 0.56)`：向右、向下、**并且朝镜头**。
 *  · 朝镜头这一项是"小臂从画面外伸进来"的关键，没有它手臂会像贴纸一样平；
 *    但也别给太多（旧值 0.6 配 0.9 格长度），否则根部会贴到近裁面上，
 *    透视把整条手臂放大成一堵褐色墙（批次 20261024-1726 实测最近处 0.10 格）。
 *  · 长度 0.5 个屏高：从握点沿着方向走出去刚好越过屏幕右下角，根部落在画面外。
 *  · ⚠️ 别改回"写死世界格"（旧 `ARM_LENGTH_WORLD = 0.55`）：那样视野一变，它在屏幕上
 *    的长度就跟着变，根部会忽远忽近。根部离镜头多远由 `syncRig` 的深度换算保证——
 *    深度跟着 k 走，根部永远在镜头前 0.35~0.75 格，不会贴到近裁面。
 *
 * 粗细 0.12：屏幕上约 12% 屏高，配上"末端加粗的拳头"，读起来是一段小臂。
 */
const ARM_WIDTH = 0.12;
const ARM_UNITS = 0.5;
const ARM_DIRECTION = new THREE.Vector3(0.62, -0.55, 0.56).normalize();
/**
 * 手臂的逐面亮度（`+x, -x, +y, -y, +z, -z`）。
 *
 * 顶面最亮、底面最暗，和方块一样是"假光照"：真光照会让贴身的手臂随环境闪。
 */
const ARM_SHADE: readonly number[] = [0.88, 0.85, 1, 0.62, 0.9, 0.9];
/** 皮肤色（原版默认皮肤的手臂色） */
const SKIN_COLOR = 0xdc9a6b;
/**
 * 拳头：手臂末端那一小段，比手臂粗一圈。
 *
 * 平色手臂如果只是一根等粗的方柱，末端就是一个"被切平的断面"，读起来像一根木头；
 * 末端加一块略粗的方块之后，形状本身就能说明"这里是手"（原版靠皮肤贴图区分，
 * 我们没有贴图，只能靠体积）。
 */
const HAND_RATIO = 0.3;
const HAND_THICKNESS = 1.3;
/**
 * 布袖 / 胸甲袖套：按"手臂长度的比例 × 手臂粗细的倍数"定义，盖在根部那一段。
 *
 * ⚠️ 第一人称只看得见小臂——根部（也就是这两段）基本在画面外，这是原版的行为
 * （原版第一人称也看不见袖子）。别为了"看得见"把它们挪到手边，那会变成手套。
 */
const CUFF_RATIO = 0.34;
const CUFF_THICKNESS = 1.22;
const SLEEVE_RATIO = 0.46;
const SLEEVE_THICKNESS = 1.34;
/** 挥动一次的时间（秒） */
const SWING_DURATION = 0.26;
/** 走路时的摆动频率（次/秒）与幅度（屏幕高比例） */
const BOB_FREQUENCY = 6.5;
const BOB_AMPLITUDE = 0.03;
/**
 * 挥动/拉弓的旋转支点（屏幕高比例，相对握点）。
 *
 * 放在握点的右下方（≈ 肩的位置）再绕它转：绕握点转的话，物品是"原地转圈"，
 * 而绕肩转才是原版那种"从画面外抡进来"的弧线。
 */
const SWING_PIVOT = new THREE.Vector3(0.2, -1.15, 0.3);

const VERTEX_SHADER = /* glsl */ `
attribute float aShade;
varying vec2 vUv;
varying float vShade;

void main() {
  vUv = uv;
  vShade = aShade;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uFlatColor;
uniform float uUseAtlas;
uniform float uBrightness;
uniform float uAlphaTest;
varying vec2 vUv;
varying float vShade;

void main() {
  vec4 texel = texture2D(uAtlas, vUv);
  // 材质级开关：手臂/袖套不要图集，只用平色，且不带透明
  vec3 base = mix(uFlatColor, texel.rgb, uUseAtlas);
  float alpha = mix(1.0, texel.a, uUseAtlas);
  if (alpha < uAlphaTest) discard;
  gl_FragColor = vec4(base * vShade * uBrightness, alpha);
}
`;

const SPRITE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SPRITE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMap;
uniform float uBrightness;
uniform float uAlphaTest;
varying vec2 vUv;

void main() {
  vec4 texel = texture2D(uMap, vUv);
  if (texel.a < uAlphaTest) discard;
  gl_FragColor = vec4(texel.rgb * uBrightness, texel.a);
}
`;

export class HandRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  /** 整只手的根节点：位置/缩放/挥动都在它身上做（子节点只负责姿态） */
  private readonly root = new THREE.Group();
  /** 手臂那一组（空手时才显示） */
  private readonly armRig = new THREE.Group();
  /** 手臂（空手时也要画） */
  private readonly arm: THREE.Mesh;
  /** 布袖（上衣色的一段，批次 241）：空手时也能看出"穿着衣服" */
  private readonly cuff: THREE.Mesh;
  /** 拳头（空手时与手臂一起显示） */
  private readonly fist: THREE.Mesh;
  /** 胸甲袖套（穿着胸甲时才显示） */
  private readonly armorSleeve: THREE.Mesh;
  /** 手持物品的挂点（在握点上，自己只负责握持姿态） */
  private readonly itemRig = new THREE.Group();

  /**
   * 手持物品的材质（方块与扁平物品**共用一份**）。
   *
   * 批次 20261024-1531：1455 曾为"双面薄片"单开一份 `DoubleSide` 材质，扁平物品
   * 换成薄盒子之后正反面都是真实几何，双面不再需要——两份材质只会让"改亮度时漏一份"。
   */
  private readonly itemMaterial: THREE.ShaderMaterial;
  /**
   * 扁平物品专用材质：贴的是**烘好的 2.5D 贴图**（不是图集）。
   * 因为边缘是画布的抗锯齿过渡，所以它必须 `transparent`（`alphaTest` 只兜底）。
   */
  private readonly spriteMaterial: THREE.ShaderMaterial;
  private readonly armMaterial: THREE.ShaderMaterial;
  private readonly cuffMaterial: THREE.ShaderMaterial;
  private readonly sleeveMaterial: THREE.ShaderMaterial;

  private readonly blockGeometries = new Map<number, THREE.BufferGeometry>();
  private readonly spriteGeometries = new Map<number, THREE.BufferGeometry>();
  /** 每个扁平物品一张烘好的 2.5D 贴图（首次拿起时生成，之后复用） */
  private readonly heldSprites = new Map<number, HeldSprite>();
  private itemMesh: THREE.Mesh | null = null;

  private heldItem: number | undefined;
  /** 胸甲袖套的颜色（`null` = 没穿）——与"手里有没有东西"一起决定袖套显隐 */
  private armorColor: number | null = null;
  private swingTime = SWING_DURATION;
  /** 是否绘制（第三人称时关掉，改由玩家模型出场） */
  private visible = true;
  /** 拉弓进度 0~1（1 = 拉满）；非 0 时手会往回拉一点 */
  private drawPull = 0;
  private bobPhase = 0;

  /** 握点（世界坐标，每帧按 fov/aspect 重算） */
  private readonly grip = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchVec = new THREE.Vector3();

  constructor(private readonly atlas: TextureAtlas) {
    this.camera = new THREE.PerspectiveCamera(VIEWMODEL_FOV, 1, 0.02, 8);

    this.itemMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas.texture },
        uFlatColor: { value: srgbColor(0xffffff) },
        uUseAtlas: { value: 1 },
        uBrightness: { value: 1 },
        uAlphaTest: { value: 0.5 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: false,
    });

    // 扁平物品的 2.5D 贴图：一次只显示一件，所以共用一个材质、切物品时换 `uMap`
    this.spriteMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uBrightness: { value: 1 },
        uAlphaTest: { value: 0.04 },
      },
      vertexShader: SPRITE_VERTEX_SHADER,
      fragmentShader: SPRITE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: true,
      // 烘好的贴图挂在**一个平面**上：必须双面，否则转身/挥手时背面被剔除会整件消失
      // （薄盒子的时代不能用双面 —— 那是"两面同贴图标"才会出重影，平面没有这个问题）
      side: THREE.DoubleSide,
    });

    this.armMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas.texture },
        uFlatColor: { value: srgbColor(SKIN_COLOR) },
        uUseAtlas: { value: 0 },
        uBrightness: { value: 1 },
        uAlphaTest: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });

    // 袖套与手臂共用同一套着色器，只是把"平面色"换成盔甲色
    this.sleeveMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas.texture },
        uFlatColor: { value: srgbColor(0xffffff) },
        uUseAtlas: { value: 0 },
        uBrightness: { value: 1 },
        uAlphaTest: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });

    // 布袖与手臂共用同一套着色器，颜色跟着外观的"上衣色"走
    this.cuffMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas.texture },
        uFlatColor: { value: srgbColor(SHIRT_COLORS[0]) },
        uUseAtlas: { value: 0 },
        uBrightness: { value: 1 },
        uAlphaTest: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });

    // 手臂几何体是**单位盒子**，沿 +Z 从拳头（z=0）伸到根部（z=1）：
    // 粗细/长度由 `armRig` 的缩放给（见 `syncRig`），姿态由它的四元数给。
    // 于是袖套的"长度占手臂几成、比手臂粗几成"可以直接写在几何体上。
    const armGeometry = new THREE.BoxGeometry(1, 1, 1);
    applyFaceShade(armGeometry, ARM_SHADE);
    armGeometry.translate(0, 0, 0.5);
    this.arm = new THREE.Mesh(armGeometry, this.armMaterial);
    this.arm.name = 'arm';

    const fistGeometry = new THREE.BoxGeometry(HAND_THICKNESS, HAND_THICKNESS, HAND_RATIO);
    applyFaceShade(fistGeometry, ARM_SHADE);
    this.fist = new THREE.Mesh(fistGeometry, this.armMaterial);
    this.fist.name = 'fist';
    this.fist.position.set(0, 0, HAND_RATIO / 2);

    const cuffGeometry = new THREE.BoxGeometry(CUFF_THICKNESS, CUFF_THICKNESS, CUFF_RATIO);
    applyFaceShade(cuffGeometry, ARM_SHADE);
    this.cuff = new THREE.Mesh(cuffGeometry, this.cuffMaterial);
    this.cuff.name = 'cuff';
    // 盖在根部那一段（几何体自身居中，所以位置是"根部往里半个袖长"）
    this.cuff.position.set(0, 0, 1 - CUFF_RATIO / 2);

    const sleeveGeometry = new THREE.BoxGeometry(SLEEVE_THICKNESS, SLEEVE_THICKNESS, SLEEVE_RATIO);
    applyFaceShade(sleeveGeometry, ARM_SHADE);
    this.armorSleeve = new THREE.Mesh(sleeveGeometry, this.sleeveMaterial);
    this.armorSleeve.name = 'armor-sleeve';
    this.armorSleeve.position.set(0, 0, 1 - SLEEVE_RATIO / 2);
    this.armorSleeve.visible = false;

    this.armRig.name = 'arm-rig';
    this.armRig.quaternion.copy(orientationFromDirection(ARM_DIRECTION));
    this.armRig.add(this.arm, this.fist, this.cuff, this.armorSleeve);

    this.itemRig.name = 'item-rig';
    this.root.name = 'hand';
    this.root.add(this.armRig, this.itemRig);
    this.scene.add(this.root);

    // 先按默认视野摆一次，构造函数之后立刻被 update() 覆盖
    this.syncRig(70, 1);
  }

  /** 当前手持物品 id（空手为 undefined） */
  get item(): number | undefined {
    return this.heldItem;
  }

  /** 是否正在挥动（测试/调试用） */
  get swinging(): boolean {
    return this.swingTime < SWING_DURATION;
  }

  /** 挥手进度 0~1（0 = 刚抬手，1 = 已经收回）；不在挥手时恒为 0 */
  get swingProgress(): number {
    return this.swinging ? this.swingTime / SWING_DURATION : 0;
  }

  /**
   * 第一人称的手臂是否显示。
   * 第三人称看的是玩家模型（手里没有画方块），此时必须把手臂藏起来，
   * 否则会有一只手飘在镜头前面。
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  /**
   * 切换手持物品。
   * 传 undefined 表示空手——此时只画手臂（原版空手也是能攻击的）。
   *
   * 批次 20261024-1152（用户）：手里有东西时**不画手臂**，只画那件东西（原版如此）。
   * 手臂/布袖/盔甲袖套的显隐统一由 `refreshHandVisibility` 决定，别在别处单独改 `visible`。
   */
  setItem(itemId: number | undefined): void {
    if (itemId === this.heldItem) return;
    this.heldItem = itemId;

    if (this.itemMesh) {
      this.itemRig.remove(this.itemMesh);
      this.itemMesh = null;
    }
    this.refreshHandVisibility();
    if (itemId === undefined) return;

    const blockId = blockForItem(itemId);
    // ⚠️ 只有**完整立方体**才画成方块。火把/花/草/台阶/栅栏这些方块物品，
    // 图标本来就是一张扁平贴图，画成立方体的话六面各贴一次、alphaTest 再把
    // 透明处裁掉，手上会剩几片"斜着拉长的薄片"（批次 20261024-1726 实测：
    // 手持火把被渲染成一根细长条 + 一截火头）。原版这些物品拿在手上也是图标。
    const isBlock = blockId !== undefined && isFullBlockShape(blockDef(blockId)?.shape ?? 'cube', 0);
    const geometry = isBlock && blockId !== undefined ? this.blockGeometry(blockId) : this.spriteGeometry(itemId);
    let material: THREE.ShaderMaterial = this.itemMaterial;
    if (!isBlock) {
      const sprite = this.heldSprites.get(itemId);
      if (sprite) {
        // 换贴图而不是换材质：扁平物品一次只显示一件
        this.spriteMaterial.uniforms.uMap!.value = sprite.texture;
        material = this.spriteMaterial;
      }
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'item';
    if (isBlock) {
      mesh.position.set(...BLOCK_OFFSET);
      mesh.rotation.set(...BLOCK_ROTATION);
    } else {
      mesh.position.set(...SPRITE_OFFSET);
      mesh.rotation.set(...SPRITE_ROTATION);
    }
    this.itemMesh = mesh;
    this.itemRig.add(mesh);
  }

  /**
   * 手臂只在**空手**时出现（批次 20261024-1152）。
   *
   * 手里拿着东西时原版不画那条手臂——只看得见手里那件物品，而且它比空手时大得多。
   * 三块（手臂 / 布袖 / 盔甲袖套）必须一起判：只藏手臂会留下"悬空的袖子"。
   */
  private refreshHandVisibility(): void {
    const empty = this.heldItem === undefined;
    this.arm.visible = empty;
    this.fist.visible = empty;
    this.cuff.visible = empty;
    this.armorSleeve.visible = empty && this.armorColor !== null;
  }

  /** 挥手（攻击/放置/挖掘时调用）；已经挥到一半就不重开，避免"抖手" */
  swing(): void {
    if (this.swinging) return;
    this.swingTime = 0;
  }

  /**
   * 外观（批次 241）：肤色 / 上衣色。
   *
   * 之前第一人称手臂用的是写死的 `SKIN_COLOR`——改完肤色再切回第一人称，手臂还是默认色，
   * 观感像"换了一个人"。布袖同理，必须跟着上衣色走。
   */
  setAppearance(palette: AppearancePalette): void {
    this.armMaterial.uniforms.uFlatColor!.value = srgbColor(palette.skin);
    this.cuffMaterial.uniforms.uFlatColor!.value = srgbColor(palette.shirt);
  }

  /**
   * 胸甲袖套的颜色（`null` = 没穿胸甲，整块不画）。
   * 与第三人称的甲片同源：都由调用方从装备图标取色，渲染层不认识"材质"。
   */
  setArmorColor(color: number | null): void {
    this.armorColor = color;
    if (color !== null) this.sleeveMaterial.uniforms.uFlatColor!.value = srgbColor(color);
    // 手里拿着东西时手臂整条都不画，袖套自然也不该露出来
    this.refreshHandVisibility();
  }

  /**
   * 拉弓进度（J9）。手没有真的"拉开弓"，但把整只手往回、往外拉一点，
   * 玩家就能看出"正在拉"以及"拉了几成"——不然蓄力这件事完全看不见。
   */
  setDrawPull(progress: number): void {
    this.drawPull = Math.max(0, Math.min(1, progress));
  }

  setBrightness(value: number): void {
    this.itemMaterial.uniforms.uBrightness!.value = value;
    this.spriteMaterial.uniforms.uBrightness!.value = value;
    this.armMaterial.uniforms.uBrightness!.value = value;
    this.cuffMaterial.uniforms.uBrightness!.value = value;
    this.sleeveMaterial.uniforms.uBrightness!.value = value;
  }

  /**
   * 每帧：把手摆到"屏幕比例握点"上（见文件头），再加挥动/拉弓/走路的偏移。
   *
   * `worldFov` 是世界视野，**故意不参与手部投影**（原因见文件头）——保留这个参数
   * 只为调用口径统一，`void` 一下免得被"声明未使用"报警。宽高比必须跟世界一致，
   * 否则"右下角"会落错位置。
   */
  update(dt: number, moving: boolean, worldFov: number, aspect: number): void {
    if (this.swingTime < SWING_DURATION) this.swingTime = Math.min(SWING_DURATION, this.swingTime + dt);

    this.bobPhase = moving ? this.bobPhase + dt * BOB_FREQUENCY : 0;
    const bob = Math.sin(this.bobPhase) * BOB_AMPLITUDE;

    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    // 世界视野只做记录：手固定自己的视角（见文件头），这里留一个引用免得参数被判"没用到"
    void worldFov;
    this.syncRig(aspect, bob);
  }

  /**
   * 按宽高比把整只手摆好（见文件头"尺寸口径"）。
   *
   * 顺序讲究：先算握点（世界坐标）与单位长度，再让**挥动绕支点转**——
   * 支点固定在屏幕上，所以转起来是"从画面外抡进来"，不是"整只手在原地平移"。
   */
  private syncRig(aspect: number, bob = 0): void {
    const k = Math.tan((VIEWMODEL_FOV * Math.PI) / 360);
    const halfHeight = k * GRIP_DEPTH;
    const unit = 2 * halfHeight;

    const pull = this.drawPull;
    const t = this.swingTime / SWING_DURATION;
    const swing = t < 1 ? Math.sin(t * Math.PI) : 0;

    this.root.scale.setScalar(unit);
    // 手臂：粗细与长度都是屏幕比例（见 ARM_WIDTH / ARM_UNITS）
    this.armRig.scale.set(ARM_WIDTH, ARM_WIDTH, ARM_UNITS);
    // 走路摆动也按屏幕比例（`bob` 是屏高的几成）
    this.grip.set(
      (GRIP_SCREEN_X * 2 - 1) * halfHeight * aspect,
      (1 - (GRIP_SCREEN_Y + bob) * 2) * halfHeight,
      -GRIP_DEPTH,
    );

    // 挥动 = 绕肩部往下砸；拉弓 = 整只手往右下、朝镜头收一点。
    // ⚠️ 角度别给大：支点离握点有 1.1 个单位，0.9 弧度会把整件东西甩出画面
    // （批次 20261024-1726 实测挥到一半手上空空如也）。
    const rotation = new THREE.Euler(
      -swing * 0.28 - pull * 0.2,
      -swing * 0.05,
      swing * 0.12 + pull * 0.22,
    );
    this.scratchQuat.setFromEuler(rotation);
    // 手腕再压一下：物品自己绕握点往前倾，挥起来才像"砍"而不是"平移"
    this.itemRig.rotation.set(-swing * 0.55, 0, swing * 0.12);

    this.root.quaternion.copy(this.scratchQuat);
    // 支点在世界里固定：root.position = 支点世界坐标 - R·(支点相对握点的世界向量)
    this.scratchVec.copy(SWING_PIVOT).multiplyScalar(unit).applyQuaternion(this.scratchQuat);
    this.root.position.copy(this.grip).addScaledVector(SWING_PIVOT, unit).sub(this.scratchVec);
    // 拉弓时额外往回拉一点（支点旋转已经带了一段，这里只补位移）
    this.root.position.x += pull * 0.06 * unit;
    this.root.position.y -= pull * 0.03 * unit;
  }

  /** 画到屏幕上（调用方负责先关掉 autoClear 并 clearDepth） */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.visible) return;
    renderer.render(this.scene, this.camera);
  }

  /** 迷你方块：六面取方块自身的顶/底/侧贴图 */
  private blockGeometry(blockId: number): THREE.BufferGeometry {
    const cached = this.blockGeometries.get(blockId);
    if (cached) return cached;

    const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    applyFaceUvs(geometry, this.atlas, blockFaceTiles(blockId));
    applyFaceShade(geometry, FACE_SHADE);
    this.blockGeometries.set(blockId, geometry);
    return geometry;
  }

  /**
   * 非方块物品：一块**薄盒子**，图标里不透明那块的**底边中点**落在握点上。
   *
   * 批次沿革值得记住：
   *   · 1455 之前：零厚度 `PlaneGeometry`，整块居中 → 手像是"捏在图标正中间"；
   *   · 1455：改成薄盒子但整块居中，六面同图标 + 默认侧面亮度 → 剑被拉成彩带；
   *   · 1531：薄盒子（有厚度）+ **平移让底边贴握点** + 正反面满亮度、厚度边压暗；
   *   · 2210（当前）：不再是几何——图标烘成一张**2.5D 贴图**（`heldSprite.ts`：
   *     双线性放大 + 剪影一层层错位叠出厚度），边缘平滑、厚度可以给得很足；
   *   · 1726：厚度边只取图标**最外那一列/行**（+ 边缘压暗）—— 六面贴整张图标时，
   *     16px 的图标压到 2px 宽的边上，斜向的剑会被拉成一条细长的"彩带"；
   *     而"厚度边填一道纯色"也不对，斜向物品会在空气里多画一条孤零零的线。
   */
  private spriteGeometry(itemId: number): THREE.BufferGeometry {
    const cached = this.spriteGeometries.get(itemId);
    if (cached) return cached;

    const sprite = buildHeldSprite(this.atlas, itemId, {
      passes: SPRITE_SCALE_PASSES,
      depthPixels: SPRITE_DEPTH_PIXELS,
      direction: [0.55, 0.83],
    });
    if (!sprite) {
      // 没有 DOM（离线测试）或图标读不出来：退回薄盒子，宁可"扁"也不要手里空着
      const geometry = this.fallbackSpriteGeometry(itemIconTile(itemId));
      this.spriteGeometries.set(itemId, geometry);
      return geometry;
    }
    this.heldSprites.set(itemId, sprite);

    // 四边形 = 整张画布（正面 + 厚度裙边）；把**正面**的中心摆到原点，
    // 这样握点、尺寸与旧的薄盒子口径完全一致，只是右下多出一圈厚度。
    const scale = SPRITE_SIZE / sprite.facePixels;
    const size = sprite.canvasPixels * scale;
    const geometry = new THREE.PlaneGeometry(size, size);
    geometry.translate((sprite.padPixels / 2) * scale, -(sprite.padPixels / 2) * scale, 0);

    // 图标里不透明那块的底边中点落在握点上（与原口径一致）
    const bounds = this.atlas.contentBounds(itemIconTile(itemId));
    const texel = SPRITE_SIZE / TILE_PIXELS;
    const contentBottom = (TILE_PIXELS - bounds.bottom) * texel;
    const contentCenterX = ((bounds.left + bounds.right) / 2 - TILE_PIXELS / 2) * texel;
    geometry.translate(-contentCenterX, SPRITE_SIZE / 2 - contentBottom - size / 2, 0);

    this.spriteGeometries.set(itemId, geometry);
    return geometry;
  }

  /** 读不到图标像素时的退路：还是那块薄盒子。 */
  private fallbackSpriteGeometry(tile: string): THREE.BufferGeometry {
    const geometry = new THREE.BoxGeometry(SPRITE_SIZE, SPRITE_SIZE, 0.03);
    const bounds = this.atlas.contentBounds(tile);
    applySpriteFaceUvs(geometry, this.atlas, tile, bounds, TILE_PIXELS);
    applyFaceShade(geometry, [0.55, 0.55, 0.55, 0.55, 1, 1]);
    const texel = SPRITE_SIZE / TILE_PIXELS;
    const contentBottom = (TILE_PIXELS - bounds.bottom) * texel;
    const contentCenterX = ((bounds.left + bounds.right) / 2 - TILE_PIXELS / 2) * texel;
    geometry.translate(-contentCenterX, SPRITE_SIZE / 2 - contentBottom, 0);
    return geometry;
  }

  dispose(): void {
    for (const geometry of this.blockGeometries.values()) geometry.dispose();
    for (const geometry of this.spriteGeometries.values()) geometry.dispose();
    this.blockGeometries.clear();
    this.spriteGeometries.clear();
    this.arm.geometry.dispose();
    this.fist.geometry.dispose();
    this.cuff.geometry.dispose();
    this.armorSleeve.geometry.dispose();
    for (const sprite of this.heldSprites.values()) sprite.dispose();
    this.heldSprites.clear();
    this.spriteMaterial.dispose();
    this.itemMaterial.dispose();
    this.armMaterial.dispose();
    this.cuffMaterial.dispose();
    this.sleeveMaterial.dispose();
    this.scene.clear();
  }
}

/**
 * 让盒子沿 `direction` 伸出，并且"顶面"朝上。
 *
 * ⚠️ 不能用 `Quaternion.setFromUnitVectors`：它给的是**最小旋转**，滚转角随方向漂移，
 * 换个方向手臂就侧躺/立起来了（顶面不再是最亮的那一面，看着像一根木梁）。
 * 这里直接按 `x = up × z`、`y = z × x` 建正交基，顶面永远是世界的 +Y 方向。
 */
function orientationFromDirection(direction: THREE.Vector3): THREE.Quaternion {
  const z = direction.clone().normalize();
  const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

