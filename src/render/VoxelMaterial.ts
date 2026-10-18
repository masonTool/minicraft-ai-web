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
    displaced.y += wave * 0.014;
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
/** 单张贴图占图集的 UV 尺寸，以及半像素内缩比例 */
uniform vec2 uTileSpan;
uniform float uTileInset;

uniform float uTime;

varying vec2 vUv;
varying vec2 vTile;
varying vec2 vLight;
varying float vShade;
varying float vFogDepth;
varying float vFluid;
varying float vPortal;

void main() {
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
  vec4 texel = texture2D(uAtlas, tileUv);
  if (texel.a < uAlphaTest) discard;

  float level = max(vLight.x * uSkyBrightness, vLight.y);
  float curve = level / (4.0 - 3.0 * level);
  float brightness = max(curve * vShade, uMinBrightness);

  vec3 color = texel.rgb * brightness;
  float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
  color = mix(color, uFogColor, fogFactor);

  gl_FragColor = vec4(color, texel.a);
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
      uTileSpan: { value: new THREE.Vector2(span[0], span[1]) },
      uTileInset: { value: options.tileInset ?? 0 },
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

  /** 0 = 深夜，1 = 正午。用于昼夜循环 */
  set skyBrightness(value: number) {
    this.uniforms.uSkyBrightness!.value = value;
  }

  get skyBrightnessValue(): number {
    return this.uniforms.uSkyBrightness!.value as number;
  }

  setFog(color: THREE.ColorRepresentation, near: number, far: number): void {
    this.uniforms.uFogColor!.value = new THREE.Color(color);
    this.uniforms.uFogNear!.value = near;
    this.uniforms.uFogFar!.value = far;
  }
}
