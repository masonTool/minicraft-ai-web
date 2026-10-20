/**
 * 体素着色器材质
 *
 * 之所以不用内置材质：需要把「光照等级 → 亮度曲线」「AO / 方向阴影」「昼夜变化」「雾」
 * 全部放在 GPU 上按顶点插值完成。光照数据烘焙在顶点属性里，所以
 * 昼夜明暗切换只需改一个 uniform，不必重建区块网格。
 *
 * 亮度公式复刻原版：
 *   level   = max(天光 × 天空亮度, 方块光) / 15
 *   curve   = level / (4 - 3 × level)      ← 原版光照曲线
 *   color   = 贴图 × max(curve × 方向阴影 × AO, 最低亮度)
 */

import * as THREE from 'three';
import { ALPHA_DITHER_BAND, ALPHA_LIFT_MAX_LOD, ALPHA_LIFT_PER_LOD } from './alphaCoverage.ts';
import { GLSL_DITHER } from './dither.ts';

/**
 * 流体贴图槽位数（水、岩浆；再多就扩这个数组与着色器里的循环）。
 * 必须是**编译期常量**：GLSL ES 1.0 的数组长度与循环上界都要求字面量。
 */
export const FLUID_TILE_SLOTS = 4;

const VERTEX_SHADER = /* glsl */ `
attribute vec2 aLight;
attribute float aShade;
/** 贴图在图集中的完整起点（未内缩） */
attribute vec2 aTile;

uniform float uTime;
/** 需要做水面动画的贴图起点（水 / 岩浆），长度固定为 FLUID_TILE_SLOTS，空位填 (-1,-1) */
uniform vec2 uFluidTiles[${FLUID_TILE_SLOTS}];
/**
 * 下界传送门贴图的起点（K8）。
 *
 * 门面只做"贴图滚动"、**不做**波浪位移——门是立在空中的一块平板，
 * 跟着水面一起上下起伏会从门框里穿出去。因此单独开一个 uniform 而不是塞进 uFluidTiles。
 */
uniform vec2 uPortalTile;

varying vec2 vUv;
varying vec2 vTile;
varying vec2 vLight;
varying float vShade;
varying float vFogDepth;
/** 1 = 这一格是流体（要做波浪与滚动），0 = 普通方块 */
varying float vFluid;
/** 1 = 这一格是下界传送门（只做贴图滚动） */
varying float vPortal;

void main() {
  vUv = uv;
  vTile = aTile;
  vLight = aLight;
  vShade = aShade;

  // 按顶点带的贴图起点判断"是不是流体"。不用逐顶点新加属性，
  // 也就不需要动网格化与 Worker —— 水面动画只影响渲染，不影响存档与物理。
  float fluid = 0.0;
  for (int i = 0; i < ${FLUID_TILE_SLOTS}; i++) {
    if (distance(aTile, uFluidTiles[i]) < 0.0004) fluid = 1.0;
  }
  vFluid = fluid;
  vPortal = distance(aTile, uPortalTile) < 0.0004 ? 1.0 : 0.0;

  vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 displaced = position;
  if (fluid > 0.5) {
    // 两个不同频率的正弦叠加，按**世界坐标**取样：跨区块的接缝处不会断裂
    float wave = sin(worldPos.x * 0.85 + uTime * 1.7) + sin(worldPos.z * 0.7 + uTime * 1.25);
    // 批次 520：**起伏幅度随距离衰减**。
    //
    // 远处的水面是"斜着看"的，几厘米的起伏在屏幕上会变成一个像素跨好几个波长的高频
    // 信号 —— 每帧都在跳，这就是"远处水面在闪"。近处的水才需要看得见起伏，
    // 24 格以外渐隐到 0 对观感没有影响（那一带本来就被雾压住）。
    float waveFade = 1.0 - smoothstep(24.0, 64.0, distance(cameraPosition, worldPos));
    displaced.y += wave * 0.014 * waveFade;
  }

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  vFogDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uSkyBrightness;
uniform float uMinBrightness;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlphaTest;
/**
 * 镂空贴图的**覆盖率补偿**强度（批次 520，见 alphaCoverage.ts）。
 * 实心层 0.4、半透明层 0（那一层本来就不做 alphaTest）。
 */
uniform float uAlphaLift;
/**
 * 阈值抖动幅度（批次 524，见 alphaCoverage.ts 的 ALPHA_DITHER_BAND）。
 * 实心层 0.06（±0.03）、半透明层 0 —— 那层没有 alphaTest，抖动只会白算。
 */
uniform float uAlphaDither;
/** 单张贴图占图集的 UV 尺寸，以及半像素内缩比例 */
uniform vec2 uTileSpan;
uniform float uTileInset;
/** 图集的像素尺寸（只用来算 mip 层级） */
uniform vec2 uAtlasSize;
/**
 * 光照色温（批次 237）：亮度仍然烘焙在顶点的 vLight 里，这里只决定"白光是什么颜色"。
 * 以前只有标量亮度，于是火把照的房间是灰的、夜里只是"变暗"而不是"变冷"。
 */
uniform vec3 uSkyLightColor;
uniform vec3 uBlockLightColor;

uniform float uTime;

varying vec2 vUv;
varying vec2 vTile;
varying vec2 vLight;
varying float vShade;
varying float vFogDepth;
varying float vFluid;
varying float vPortal;

${GLSL_DITHER}

void main() {
  // 导数必须在**任何分支之前**取：GLSL 规定 dFdx/dFdy 在非一致控制流里是未定义的。
  // 这里要的是 vUv（fract 之前的平铺坐标）的屏幕空间变化率，换算成图集 UV 空间。
  vec2 tileScale = uTileSpan * (1.0 - 2.0 * uTileInset);
  vec2 gradX = dFdx(vUv) * tileScale;
  vec2 gradY = dFdy(vUv) * tileScale;

  // uv 是「平铺坐标」：单面时落在 [0,1]，贪心合并出的大四边形则是 [0,w]×[0,h]。
  // 取小数部分即可把任意大小的面都映射回同一张贴图，再叠加半像素内缩避免渗色。
  //
  // 流体与传送门额外叠加一个随时间平移的偏移：**加在 fract 里面**，
  // 于是滚动始终发生在这一张贴图内部（不会跑到邻居贴图上去）。
  // 传送门滚得比水面慢（原版门面也是缓缓流动的紫色），两轴速度不成比例才不会
  // 看起来像"斜着平移的条纹"。
  vec2 scroll = vec2(0.0);
  if (vFluid > 0.5) scroll = vec2(uTime * 0.06, uTime * 0.045);
  else if (vPortal > 0.5) scroll = vec2(uTime * 0.026, uTime * 0.017);
  vec2 local = fract(vUv + scroll + vec2(vFluid * 0.5, 0.0));
  vec2 tileUv = vTile + (uTileInset + local * (1.0 - 2.0 * uTileInset)) * uTileSpan;

  // ---- mip 层级要自己算（批次 237）
  //
  // 不能直接 texture2D(uAtlas, tileUv) 让硬件隐式求导：上面那个 fract 在每个方块
  // 边界都会把 uv 从 1 拽回 0，硬件会把"一像素跨了整张 tile"当真，于是每条方块缝都
  // 被采到最糊的 mip —— 整屏出现一圈圈发灰的缝。
  //
  // 做法：用 **fract 之前** 的 vUv（连续）求导（在 main 开头就算好了），显式喂给 textureGrad。
  // 顺带好处：各向异性过滤只认显式梯度，以后要开 aniso 不用再动这里。
  //
  // 层级封顶到"每格 1 纹素"（16 纹素 = level 4）：再远就会跨到图集里邻居贴图上，
  // 而那一档的方块已经不足一个像素、早就被雾吃掉。等比缩放不破坏各向异性的长宽比。
  float rho = max(
    max(abs(gradX.x * uAtlasSize.x), abs(gradX.y * uAtlasSize.y)),
    max(abs(gradY.x * uAtlasSize.x), abs(gradY.y * uAtlasSize.y))
  );
  float tileTexels = uTileSpan.x * uAtlasSize.x;
  float lodCap = min(1.0, tileTexels / max(rho, 0.0001));
  vec4 texel = textureGrad(uAtlas, tileUv, gradX * lodCap, gradY * lodCap);

  // ---- 镂空贴图的覆盖率补偿（批次 520）
  //
  // mipmap 的 alpha 是**覆盖率平均**：43% 覆盖率的草到 mip2 就掉到 0.2~0.4，
  // 被 0.5 的阈值整块 discard —— 剪影随距离被一点点啃掉，走动时洞的位置还跟着跳，
  // 这就是"草的颗粒感"。按 LOD 把 alpha 乘法抬回去：alpha=0 恒等（空白永远空白），
  // 实心方块 alpha=1 也恒等（所以不需要为它单开一层材质）。
  //
  // 常量与 alphaCoverage.ts 同源（那边是离线断言的唯一口径）。
  float alphaLod = clamp(log2(max(rho, 0.0001)), 0.0, ${ALPHA_LIFT_MAX_LOD.toFixed(1)});
  float covered = min(1.0, texel.a * (1.0 + uAlphaLift * alphaLod));

  // ---- 阈值抖动（批次 524）
  //
  // alphaTest 是**硬阈值**：covered 刚好骑在 0.5 上的像素（草尖、叶缘）在镜头
  // 平移一个像素时就会整体翻过去，肉眼就是"草尖在抖"。把阈值按**屏幕空间**的
  // 4×4 Bayer 打散 ±0.03：这些像素被摊成一片细密的点，而且每个点的取舍固定挂在
  // 它自己的屏幕位置上 —— 平移时不再整片一起翻。配合已经打开的 MSAA，
  // 这些点还会被覆盖率再抹一次。
  //
  // 半透明层 uAlphaTest = 0、uAlphaDither = 0，这个分支对它完全透明（永远不 discard）。
  float threshold = uAlphaTest + (bayer4(gl_FragCoord.xy) - 0.5) * uAlphaDither;
  if (covered < threshold) discard;

  // 两条光各走一次原版曲线（level / (4 - 3·level)），亮度取较大者：
  // 洞里只有块光、白天只有天光。
  float skyLevel = vLight.x * uSkyBrightness;
  float blkLevel = vLight.y;
  float skyCurve = skyLevel / (4.0 - 3.0 * skyLevel);
  float blkCurve = blkLevel / (4.0 - 3.0 * blkLevel);
  // 色温按 **t²** 混：t 是块光在两条光里的占比。
  // 用比例（而不是线性加权）是因为"正午 + 旁边一支火把"这种情形下块光只该贡献一点点暖，
  // 线性加权会让大白天也蒙上一层橙；平方之后 0.4 的占比只剩 0.16，而洞里 t=1 仍是纯暖。
  // 两条光都为 0（全黑处）时 t=0 → 取天光色，不会出现 0/0。
  float t = blkCurve / max(skyCurve + blkCurve, 0.0001);
  vec3 lightColor = mix(uSkyLightColor, uBlockLightColor, t * t);
  float brightness = max(max(skyCurve, blkCurve) * vShade, uMinBrightness);

  vec3 color = texel.rgb * brightness * lightColor;
  float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
  color = mix(color, uFogColor, fogFactor);

  // 抖色（批次 520）：雾与暗部是大面积平滑渐变，8 bit 输出会出台阶状色带，
  // ±0.5/255 的有序抖动把它们打散，肉眼不可见。见 dither.ts
  gl_FragColor = vec4(ditherColor(color, gl_FragCoord.xy), texel.a);
}
`;

export interface VoxelMaterialOptions {
  /** 半透明层：关闭 alphaTest、开启混合、不写深度 */
  translucent?: boolean;
  /** 单张贴图占图集的 UV 尺寸（默认整张图集 = 一张贴图） */
  tileSpan?: readonly [number, number];
  /** 半像素内缩比例 */
  tileInset?: number;
}

export class VoxelMaterial {
  readonly material: THREE.ShaderMaterial;
  private readonly uniforms: Record<string, THREE.IUniform>;
  /** 构造时的默认最低亮度（切回主世界要还原） */
  readonly defaultMinBrightness: number;

  constructor(atlas: THREE.Texture, options: VoxelMaterialOptions = {}) {
    const translucent = options.translucent ?? false;
    const span = options.tileSpan ?? [1, 1];

    // 流体贴图槽位（水 + 岩浆；上限 4 个，空位用 (-1,-1) 占位）
    const fluidTiles: THREE.Vector2[] = [];
    for (let i = 0; i < FLUID_TILE_SLOTS; i++) fluidTiles.push(new THREE.Vector2(-1, -1));

    // 图集像素尺寸：只用来把"一像素跨几个纹素"换算成 mip 层级。
    // `new THREE.Texture()`（离线测试里就这么传）没有 image，退回 1×1 —— 那只影响
    // LOD 的封顶值，而测试不编译/不执行 GLSL，所以无所谓。
    const image = atlas.image as { width?: number; height?: number } | null | undefined;
    const atlasSize = new THREE.Vector2(image?.width ?? 1, image?.height ?? 1);

    this.uniforms = {
      uAtlas: { value: atlas },
      uTime: { value: 0 },
      uFluidTiles: { value: fluidTiles },
      // 传送门贴图起点（未登记时为 (-1,-1)，永远匹配不上任何顶点）
      uPortalTile: { value: new THREE.Vector2(-1, -1) },
      uSkyBrightness: { value: 1 },
      uMinBrightness: { value: translucent ? 0.32 : 0.06 },
      uFogColor: { value: new THREE.Color(0x8fc7ff) },
      uFogNear: { value: 120 },
      uFogFar: { value: 160 },
      uAlphaTest: { value: translucent ? 0 : 0.5 },
      // 半透明层没有 alphaTest（阈值 0），补偿也就没有意义——保持 0，省一次乘法的影响
      uAlphaLift: { value: translucent ? 0 : ALPHA_LIFT_PER_LOD },
      uAlphaDither: { value: translucent ? 0 : ALPHA_DITHER_BAND },
      uTileSpan: { value: new THREE.Vector2(span[0], span[1]) },
      uTileInset: { value: options.tileInset ?? 0 },
      uAtlasSize: { value: atlasSize },
      // 默认纯白：与"只有亮度"的旧行为完全一致，由主程序按昼夜去推色温
      uSkyLightColor: { value: new THREE.Color(1, 1, 1) },
      uBlockLightColor: { value: new THREE.Color(1, 1, 1) },
    };

    this.defaultMinBrightness = translucent ? 0.32 : 0.06;

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: translucent,
      depthWrite: !translucent,
      side: translucent ? THREE.DoubleSide : THREE.FrontSide,
      fog: false,
      lights: false,
    });
  }

  /**
   * 最低亮度下限。
   * 主世界靠天光，默认值（实心 0.06 / 半透明 0.32）只用于把纯黑的缝提一点；
   * 下界没有天光，必须把它整体抬高，否则远离岩浆与荧光石的地方就是一片纯黑。
   */
  setMinBrightness(value: number): void {
    this.uniforms.uMinBrightness!.value = value;
  }

  /**
   * 半透明层要不要**双面**画（批次 215）。
   *
   * 半透明层（水 / 玻璃）是 `transparent + depthWrite: false`，本来就没有 early-z，
   * **覆盖多少像素就混合多少次**；双面等于把同一片水面**再画一遍**（背面与正面投影
   * 几乎重合），手机上"一靠近水就卡一点"很大一部分来自这里。
   *
   * 双面只有**从水里往上看**时才是必需的：水面顶面的正面朝上，摄像机在水下看到的是它的
   * 背面，单面会被剔除 → 抬头直接看穿水面见到天空。所以主循环按"摄像机是否在液体里"
   * 来回切：岸上单面（省一半水面填充率），下水双面（观感与原来一致）。
   *
   * ⚠️ 不设 `needsUpdate`：`side` 是 `gl.cullFace` 的渲染状态、不是着色器宏，
   * 设了反而每次切换都重编译一次着色器。
   */
  setDoubleSided(doubleSided: boolean): void {
    const side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    if (this.material.side === side) return;
    this.material.side = side;
  }

  /**
   * 登记"哪些贴图要做水面动画"。
   * 传贴图在图集里的完整起点（`atlas.tileOrigin(name)`）；多余的槽位填 (-1,-1)。
   */
  setFluidTiles(tiles: ReadonlyArray<readonly [number, number]>): void {
    const slots = this.uniforms.uFluidTiles!.value as THREE.Vector2[];
    for (let i = 0; i < slots.length; i++) {
      const tile = tiles[i];
      slots[i]!.set(tile ? tile[0] : -1, tile ? tile[1] : -1);
    }
  }

  /**
   * 登记"哪个贴图是下界传送门"（传图集里的贴图起点；不传就取消）。
   *
   * 只滚动、不做波浪位移，因此不走 `setFluidTiles`——那个槽位是给
   * "要跟着水面起伏的整格流体"用的，门跟着晃会从门框里穿出去。
   */
  setPortalTile(tile?: readonly [number, number]): void {
    const value = this.uniforms.uPortalTile!.value as THREE.Vector2;
    value.set(tile ? tile[0] : -1, tile ? tile[1] : -1);
  }

  /** 推进水面 / 门面动画时间（秒） */
  setTime(seconds: number): void {
    this.uniforms.uTime!.value = seconds;
  }

  /**
   * 天光 / 块光的颜色（批次 237）。
   *
   * 只改 uniform，**不重建任何网格**——这正是当初把光照烘焙进顶点时要的收益：
   * 昼夜、黄昏、火把的"色温"每帧都能推，而几何一个字节都不用动。
   */
  setLightColors(sky: THREE.Color, block: THREE.Color): void {
    (this.uniforms.uSkyLightColor!.value as THREE.Color).copy(sky);
    (this.uniforms.uBlockLightColor!.value as THREE.Color).copy(block);
  }

  /** 0 = 深夜，1 = 正午。用于昼夜循环 */
  set skyBrightness(value: number) {
    this.uniforms.uSkyBrightness!.value = value;
  }

  get skyBrightnessValue(): number {
    return this.uniforms.uSkyBrightness!.value as number;
  }

  setFog(color: THREE.ColorRepresentation, near: number, far: number): void {
    // ⚠️ 不要每帧 `new THREE.Color(...)`：这个方法每帧都会被两套材质各调一次，
    // 而 `Color.set` 写进的是同一个 uniform 对象（批次 237 顺手省掉的两次分配）。
    (this.uniforms.uFogColor!.value as THREE.Color).set(color);
    this.uniforms.uFogNear!.value = near;
    this.uniforms.uFogFar!.value = far;
  }
}
