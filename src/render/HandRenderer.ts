/**
 * 第一人称手持物品与手臂（E15）
 *
 * 单独一个场景 + 单独一台相机，在世界渲染完之后 `clearDepth()` 再画一遍：
 * 这是原版的做法，好处是手臂永远不会被地形穿模、也不受雾影响，
 * 而且两个场景互不干扰（手里的方块不会真的出现在世界坐标里）。
 *
 * 几何体按物品缓存（和掉落物渲染器一样），切换手持物品只换 mesh 不重建几何体。
 * 亮度跟着世界天光走（`setBrightness`），这样夜里举着火把是亮的、洞里是暗的。
 */

import * as THREE from 'three';
import type { TextureAtlas } from './TextureAtlas.ts';
import { SHIRT_COLORS, type AppearancePalette } from '../game/appearance.ts';
import { blockForItem, itemIconTile } from '../core/registry/items.ts';
import { applyFaceShade, applyFaceUvs, blockFaceTiles, FACE_SHADE } from './atlasMesh.ts';
import { srgbColor } from './srgb.ts';

/**
 * 手持方块/物品的显示尺寸（格）。
 *
 * 批次 20261024-1152（用户）：0.22 → **0.44**（"放大 2 倍"）。原版第一人称下
 * 手里的方块本来就占屏幕很大一块；同时**手臂不再画**（见 `refreshHandVisibility`），
 * 观感与基岩版一致：只看见一件东西，而不是"一只手捏着一粒米"。
 */
const ITEM_SIZE = 0.44;
/**
 * 扁平物品（工具/武器/食物…）的厚度（格）。
 *
 * 批次 20261024-1531（用户："刀剑也应该有厚度"）：0.05 ≈ 0.8 像素，
 * 侧着看是一条细边，不会像纯平面那样直接消失。厚度只给**扁平物品**，方块本来就是立方体。
 */
const SPRITE_THICKNESS = 0.05;
/**
 * 扁平物品的逐面亮度（`+x, -x, +y, -y, +z, -z`）。
 *
 * 正反两面（±z，也就是图标本身）给满亮度 1；四周的"厚度边"压到 0.62——
 * 上一批用同一张图标贴六面 + 默认 `FACE_SHADE`（侧面 0.54），斜向的剑会被侧面
 * 拉成几条彩带；压暗之后侧面读作"这道边的暗面"，不再抢图标的形状。
 */
const SPRITE_SHADE: readonly number[] = [0.62, 0.62, 0.86, 0.62, 1, 1];
/**
 * 方块与扁平物品的握持姿态（相对手的挂点）。
 *
 * 批次 20261024-1531（用户："刀剑的显示方位，手应该拿到柄的位置"）：
 * 扁平物品的几何体**底边贴在挂点上**（见 `spriteGeometry`），所以这里的旋转
 * 决定"柄在手里、刃朝上偏前"这个姿势；方块则是握在中间，旋转沿用旧值。
 */
const SPRITE_HOLD_ROTATION: readonly [number, number, number] = [0.1, -0.55, -0.32];
const BLOCK_HOLD_ROTATION: readonly [number, number, number] = [0.2, -0.5, 0.15];
/** 手臂横截面与长度（格）：16px 皮肤里手臂是 4×4×12 像素 */
const ARM_WIDTH = 0.15;
const ARM_LENGTH = 0.75;
/** 皮肤色（原版默认皮肤的手臂色） */
const SKIN_COLOR = 0xdc9a6b;
/**
 * 胸甲袖套：第一人称下"能看到自己穿着甲"的唯一途径（其余三件在镜头的盲区里）。
 * 只覆盖手臂靠近肩膀的一段，跟原版一样露出手。
 */
const SLEEVE_LENGTH = ARM_LENGTH * 0.45;
const SLEEVE_RADIUS = ARM_WIDTH * 1.3;
/**
 * 布袖（批次 241）：第一人称手臂靠近肩膀的一段用上衣色，手臂不再是"一整根肉色"。
 * 比手臂粗 0.004，靠"套在外面"分层；穿胸甲时会被更长的盔甲袖套盖住。
 */
const CUFF_LENGTH = 0.22;
const CUFF_RADIUS = ARM_WIDTH + 0.008;
/** 挥动一次的时间（秒） */
const SWING_DURATION = 0.26;
/** 走路时的摆动频率（次/秒）与幅度 */
const BOB_FREQUENCY = 6.5;
const BOB_AMPLITUDE = 0.035;

/**
 * 肩部（手臂根部）在视图空间里的位置与角度。
 *
 * 原版第一人称是这个观感：手臂根部在**屏幕外的右下角**，朝屏幕里、朝上、朝左伸出，
 * 手（也就是物品）落在右下象限、完整可见。所以这里把根部放到屏幕外，再靠 rotation
 * 把手臂"伸进画面"：绕 X 抬 22°、绕 Y 左偏 20° 之后，手落在屏幕右侧偏下（约 x 68%、y 70%），
 * 整块都在画面里，尺寸约为屏高的四分之一。
 *
 * ⚠️ 这几个数是**在浏览器里量出来的**，不是纯靠投影公式推的：先用洋红把整只手染色，
 * 再用 `tools/pixel-probe.mjs` 那套解码扫出它在截图里的包围盒，按"差多少像素 ≈ 差多少格"
 * 反推修正。纯算容易漏掉挂点的复合旋转，实测定值最省事。
 */
const SHOULDER_POSITION: readonly [number, number, number] = [0.68, -0.58, -0.15];
const SHOULDER_ROTATION: readonly [number, number, number] = [0.385, 0.35, 0.12];

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
  vec3 base = mix(uFlatColor, texel.rgb, uUseAtlas);
  float alpha = mix(1.0, texel.a, uUseAtlas);
  if (alpha < uAlphaTest) discard;
  gl_FragColor = vec4(base * vShade * uBrightness, alpha);
}
`;

export class HandRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  /** 整只手的根节点：位置/旋转都在它身上做动画 */
  private readonly group = new THREE.Group();
  /** 手臂（空手时也要画） */
  private readonly arm: THREE.Mesh;
  /** 布袖（上衣色的一段，批次 241）：空手时也能看出"穿着衣服" */
  private readonly cuff: THREE.Mesh;
  /** 胸甲袖套（穿着胸甲时才显示） */
  private readonly armorSleeve: THREE.Mesh;
  /** 手持物品的挂点（在手臂末端） */
  private readonly itemAnchor = new THREE.Group();

  /**
   * 手持物品的材质（方块与扁平物品**共用一份**）。
   *
   * 批次 20261024-1531：1455 曾为"双面薄片"单开一份 `DoubleSide` 材质，扁平物品
   * 换成薄盒子之后正反面都是真实几何，双面不再需要——两份材质只会让"改亮度时漏一份"。
   */
  private readonly itemMaterial: THREE.ShaderMaterial;
  private readonly armMaterial: THREE.ShaderMaterial;
  private readonly cuffMaterial: THREE.ShaderMaterial;
  private readonly sleeveMaterial: THREE.ShaderMaterial;

  private readonly blockGeometries = new Map<number, THREE.BufferGeometry>();
  private readonly spriteGeometries = new Map<number, THREE.BufferGeometry>();
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

  constructor(private readonly atlas: TextureAtlas) {
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.02, 8);

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

    const armGeometry = new THREE.BoxGeometry(ARM_WIDTH, ARM_WIDTH, ARM_LENGTH);
    applyFaceShade(armGeometry, FACE_SHADE);
    this.arm = new THREE.Mesh(armGeometry, this.armMaterial);
    // 几何体中心在原点，往 -Z 推半截，让手臂从"手的根部"向外伸
    this.arm.position.set(0, 0, -ARM_LENGTH / 2);

    const cuffGeometry = new THREE.BoxGeometry(CUFF_RADIUS, CUFF_RADIUS, CUFF_LENGTH);
    applyFaceShade(cuffGeometry, FACE_SHADE);
    this.cuff = new THREE.Mesh(cuffGeometry, this.cuffMaterial);
    // 套在靠近肩膀的那一段（手臂从 z=0 往 -Z 伸）
    this.cuff.position.set(0, 0, -CUFF_LENGTH / 2 + 0.01);

    const sleeveGeometry = new THREE.BoxGeometry(SLEEVE_RADIUS, SLEEVE_RADIUS, SLEEVE_LENGTH);
    applyFaceShade(sleeveGeometry, FACE_SHADE);
    this.armorSleeve = new THREE.Mesh(sleeveGeometry, this.sleeveMaterial);
    // 套在手臂靠近肩膀的一段（手臂从 z=0 往 -Z 伸），默认不显示
    this.armorSleeve.position.set(0, 0, -SLEEVE_LENGTH / 2 + 0.01);
    this.armorSleeve.visible = false;

    // 挂点仍然在"手"的位置上：物品放大 2 倍之后不能再往远处推 0.36 个身位，
    // 否则透视会把它拉回原来的视觉大小（甚至更小）
    this.itemAnchor.position.set(0, 0, -ARM_LENGTH - ITEM_SIZE * 0.12);

    // 顺序固定为「手臂 → 布袖 → 手持物挂点 → 袖套」：挂点必须排在袖套前面，
    // 否则袖套会挡住手上的东西（袖套比手臂粗一圈）
    this.group.add(this.arm, this.cuff, this.itemAnchor, this.armorSleeve);
    this.group.position.set(...SHOULDER_POSITION);
    this.group.rotation.set(...SHOULDER_ROTATION);
    this.scene.add(this.group);
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
      this.itemAnchor.remove(this.itemMesh);
      this.itemMesh = null;
    }
    this.refreshHandVisibility();
    if (itemId === undefined) return;

    const blockId = blockForItem(itemId);
    // 方块 = 立方体（六面各取自己的贴图）；其余物品 = **双面薄片**（同一张图标）。
    // ⚠️ 别给非方块物品也做"有厚度的盒子"（批次 20261024-1152 试过）：图标在六个面上
    // 各贴一次，剑/镐这种斜向图形会被侧面拉成几条彩带 —— 用户自测报的就是这个。
    const isBlock = blockId !== undefined;
    const geometry = isBlock ? this.blockGeometry(blockId) : this.spriteGeometry(itemId);
    const mesh = new THREE.Mesh(geometry, this.itemMaterial);
    // 方块露出"顶面 + 两个侧面"；扁平物品的柄在挂点上、刃朝上偏前
    if (isBlock) mesh.rotation.set(...BLOCK_HOLD_ROTATION);
    else mesh.rotation.set(...SPRITE_HOLD_ROTATION);
    this.itemMesh = mesh;
    this.itemAnchor.add(mesh);
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
    this.armMaterial.uniforms.uBrightness!.value = value;
    this.cuffMaterial.uniforms.uBrightness!.value = value;
    this.sleeveMaterial.uniforms.uBrightness!.value = value;
  }

  /** 每帧动画：挥动弧线 + 走路时的轻微上下摆动 */
  update(dt: number, moving: boolean, fovDeg: number, aspect: number): void {
    if (this.swingTime < SWING_DURATION) this.swingTime = Math.min(SWING_DURATION, this.swingTime + dt);

    this.bobPhase = moving ? this.bobPhase + dt * BOB_FREQUENCY : 0;
    const bob = Math.sin(this.bobPhase) * BOB_AMPLITUDE;

    // 挥动进度 0→1，用 sin 曲线：抬手快、落下慢，比线性自然
    const t = this.swingTime / SWING_DURATION;
    const swing = t < 1 ? Math.sin(t * Math.PI) : 0;

    // 挥动 = 绕肩部往下砸：X 角**减小**（手臂落下去），同时整体往上、往镜头方向挪一点，
    // 这样看起来是"手臂从屏幕外抡进来"，而不是整只手在平面上滑。
    // 拉弓：整只手往右下、朝镜头方向收一点，拉得越满收得越多
    const pull = this.drawPull;
    this.group.position.set(
      SHOULDER_POSITION[0] - swing * 0.1 + pull * 0.06,
      SHOULDER_POSITION[1] + bob + swing * 0.08 - pull * 0.04,
      SHOULDER_POSITION[2] + swing * 0.1 + pull * 0.12,
    );
    this.group.rotation.set(
      SHOULDER_ROTATION[0] - swing * 0.85 - pull * 0.18,
      SHOULDER_ROTATION[1] - swing * 0.12,
      SHOULDER_ROTATION[2] + swing * 0.25 + pull * 0.2,
    );

    if (this.camera.fov !== fovDeg || this.camera.aspect !== aspect) {
      this.camera.fov = fovDeg;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
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

    const geometry = new THREE.BoxGeometry(ITEM_SIZE, ITEM_SIZE, ITEM_SIZE);
    applyFaceUvs(geometry, this.atlas, blockFaceTiles(blockId));
    applyFaceShade(geometry, FACE_SHADE);
    this.blockGeometries.set(blockId, geometry);
    return geometry;
  }

  /**
   * 非方块物品：一块**薄盒子**，且**底边就在手的挂点上**（也就是握住图标底部的柄）。
   *
   * 批次沿革值得记住：
   *   · 1455 之前：零厚度 `PlaneGeometry`，整块居中 → 手像是"捏在图标正中间"；
   *   · 1455：改成薄盒子但整块居中，六面同图标 + 默认侧面亮度 → 剑被拉成彩带；
   *   · 1531（当前）：薄盒子（有厚度）+ **平移让底边贴挂点** + 正反面满亮度、厚度边压暗。
   * 图标四周是透明的，`alphaTest` 会把边缘裁掉。
   */
  private spriteGeometry(itemId: number): THREE.BufferGeometry {
    const cached = this.spriteGeometries.get(itemId);
    if (cached) return cached;

    const geometry = new THREE.BoxGeometry(ITEM_SIZE, ITEM_SIZE, SPRITE_THICKNESS);
    const tile = itemIconTile(itemId);
    applyFaceUvs(geometry, this.atlas, [tile, tile, tile, tile, tile, tile]);
    applyFaceShade(geometry, SPRITE_SHADE);
    // 把整块往上抬半个高度：几何体的底边落在 y=0，正好是挂点（= 手握的位置）
    geometry.translate(0, ITEM_SIZE / 2, 0);
    this.spriteGeometries.set(itemId, geometry);
    return geometry;
  }

  dispose(): void {
    for (const geometry of this.blockGeometries.values()) geometry.dispose();
    for (const geometry of this.spriteGeometries.values()) geometry.dispose();
    this.blockGeometries.clear();
    this.spriteGeometries.clear();
    this.arm.geometry.dispose();
    this.cuff.geometry.dispose();
    this.armorSleeve.geometry.dispose();
    this.itemMaterial.dispose();
    this.armMaterial.dispose();
    this.cuffMaterial.dispose();
    this.sleeveMaterial.dispose();
    this.scene.clear();
  }
}
