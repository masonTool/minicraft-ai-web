/**
 * 全屏视野效果（E16）：水下 / 岩浆的整屏色罩
 *
 * 做法是一个铺满屏幕的四边形（正交相机 + 4 个顶点），在世界渲染完之后
 * 关掉深度测试直接盖上去——比改渲染目标省事得多，也不需要读回像素。
 *
 * 效果切换做**平滑过渡**而不是硬切：原版从水里冒头时色罩是渐隐的，
 * 硬切会在视线穿过水面的一瞬间闪一下。过渡用指数逼近（与帧率无关）。
 *
 * 「失明 / 黑暗 / 药水颜色叠加」要等状态效果系统（I4）落地，
 * 这里先把 `setEffect` 与过渡做成通用的，到时候加一个枚举就行。
 */

import * as THREE from 'three';
import { srgbColor } from './srgb.ts';

export type ScreenEffect = 'none' | 'water' | 'lava' | 'suffocate' | 'blindness' | 'darkness' | 'portal';

interface EffectPreset {
  /** 色罩颜色 */
  color: number;
  /** 中心处的不透明度 */
  alpha: number;
  /** 边缘加深系数（0 = 不加深） */
  vignette: number;
}

const PRESETS: Record<ScreenEffect, EffectPreset> = {
  none: { color: 0x000000, alpha: 0, vignette: 0 },
  // 水下：偏青蓝，边缘略暗，模拟"被水包围"的压迫感
  water: { color: 0x123a6b, alpha: 0.34, vignette: 0.45 },
  // 岩浆：橙红、几乎不透明（原版在岩浆里基本看不清东西）
  /** 失明：几乎全黑，只留一点点轮廓（原版失明时连脚下都看不清） */
  blindness: {
    color: 0x000000,
    alpha: 0.92,
    vignette: 0.9,
  },
  /** 黑暗：像被"监守者"罩住，能看见但很暗 */
  darkness: {
    color: 0x05070a,
    alpha: 0.62,
    vignette: 0.75,
  },
  lava: { color: 0xb83404, alpha: 0.68, vignette: 0.6 },
  /**
   * 埋在方块里（批次 20261025-0256）：**整屏不透明**。
   *
   * 相机真的进了实心方块时（沙子砸头 / 活塞推 / 传送落点），眼前那面是背面、
   * 被背向剔除，于是会直接看到"墙皮后面的世界"——近裁面调到多小都没用。
   * 原版这时也是整屏盖住，这里用**该方块自己的颜色**（`setTint` 动态给），
   * 于是"埋在石头里"看到的是石头的颜色而不是一片黑。
   *
   * color 只是个兜底（没给覆盖色时的值）；vignette 取 0：整屏都是同一个色，没有边缘。
   */
  suffocate: { color: 0x808080, alpha: 1, vignette: 0 },
  /**
   * 下界传送门（K8）：紫色、很淡、**只压中心**（vignette 取 0，即越到边缘越透）。
   * 原版站在门里时整屏被紫色糊住，但还能看清方向；色罩太重会让人以为是卡住了。
   */
  portal: { color: 0x4a1e86, alpha: 0.4, vignette: 0 },
};

/** 过渡时间常数（秒）：越小切得越快，0.16 约等于 0.5 秒内基本到位 */
const TRANSITION = 0.16;

/**
 * 各效果的色罩颜色。
 * 用 `srgbColor` 而不是 `new THREE.Color(hex)`：后者会做一次 sRGB→线性 转换，
 * 而我们的着色器是原样写入帧缓冲的，用 Color 构造会让色罩比预期更暗更偏红。
 */
const PRESET_COLORS: Record<ScreenEffect, THREE.Color> = {
  none: srgbColor(PRESETS.none.color),
  water: srgbColor(PRESETS.water.color),
  lava: srgbColor(PRESETS.lava.color),
  suffocate: srgbColor(PRESETS.suffocate.color),
  blindness: srgbColor(PRESETS.blindness.color),
  darkness: srgbColor(PRESETS.darkness.color),
  portal: srgbColor(PRESETS.portal.color),
};

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // 顶点本身就是 NDC 坐标（-1~1 的四边形），不需要相机矩阵
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uVignette;
varying vec2 vUv;

void main() {
  vec2 d = vUv - 0.5;
  float radius = dot(d, d) * 2.0;          // 0（中心）→ 约 1（边缘）
  float alpha = min(1.0, uAlpha * (1.0 + uVignette * radius * 2.0));
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

export interface ScreenEffectState {
  effect: ScreenEffect;
  color: number;
  alpha: number;
  vignette: number;
}

export class ScreenEffects {
  /** 正交相机只用来把这个四边形铺满屏幕 */
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly quad: THREE.Mesh;

  /** 目标效果（`set` 设置的）；当前值每帧向它逼近 */
  private target: ScreenEffect = 'none';
  /**
   * 覆盖色（批次 20261025-0256）：非空时**代替**预设色。
   * 只给"埋在方块里"用——颜色是那个方块贴图的平均色，随方块变，没法写成预设。
   */
  private tint: THREE.Color | null = null;
  private tintHex: number | null = null;
  private currentColor = new THREE.Color(0x000000);
  private currentAlpha = 0;
  private currentVignette = 0;

  constructor() {
    this.uniforms = {
      uColor: { value: srgbColor(0x000000) },
      uAlpha: { value: 0 },
      uVignette: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      // 盖在最上层：不写深度、也不做深度测试，免得被世界挡住
      depthWrite: false,
      depthTest: false,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geometry, material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** 目标效果（不含过渡中间态，测试与调试用） */
  get effect(): ScreenEffect {
    return this.target;
  }

  /**
   * 当前混合后的状态（过渡中会位于两个预设之间）。
   * 颜色取 `NoColorSpace` 下的十六进制：内部存的就是原始 sRGB 分量，
   * 默认的 `getHex()` 会当成线性值再转一次 sRGB，读出来会偏亮（0x123a6b → 0x4b83ad）。
   */
  get state(): ScreenEffectState {
    return {
      effect: this.target,
      color: this.currentColor.getHex(THREE.NoColorSpace),
      alpha: this.currentAlpha,
      vignette: this.currentVignette,
    };
  }

  /** 是否完全透明（为真时可以整个跳过一次 draw call） */
  get transparent(): boolean {
    return this.currentAlpha < 0.004;
  }

  set(effect: ScreenEffect): void {
    this.target = effect;
  }

  /**
   * 覆盖色罩颜色（null = 用预设色）。
   *
   * 只在"埋在方块里"这条路上用：色罩取该方块贴图的平均色（见 `App.blockParticleColor`），
   * 于是埋在石头里是石头的灰、埋在沙里是沙的黄，玩家能立刻明白"我被埋住了"。
   * 每帧都调也无所谓——值没变时不会重建 `Color`。
   */
  setTint(hex: number | null): void {
    if (hex === null) {
      this.tint = null;
      this.tintHex = null;
      return;
    }
    if (this.tintHex === hex && this.tint) return;
    this.tintHex = hex;
    this.tint = srgbColor(hex);
  }

  /** 当前生效的覆盖色（测试与调试用；null = 用预设色） */
  get tintColor(): number | null {
    return this.tintHex;
  }

  /** 目标颜色：有覆盖色就用覆盖色，否则用预设色 */
  private targetColor(): THREE.Color {
    return this.tint ?? PRESET_COLORS[this.target];
  }

  /** 指数逼近目标值（与帧率无关：dt 越大走得越多，但永远不会过冲） */
  update(dt: number): void {
    const preset = PRESETS[this.target];
    const k = 1 - Math.exp(-Math.max(0, dt) / TRANSITION);

    this.currentColor.lerp(this.targetColor(), k);
    this.currentAlpha += (preset.alpha - this.currentAlpha) * k;
    this.currentVignette += (preset.vignette - this.currentVignette) * k;

    this.uniforms.uColor!.value.copy(this.currentColor);
    this.uniforms.uAlpha!.value = this.currentAlpha;
    this.uniforms.uVignette!.value = this.currentVignette;
  }

  /** 画到屏幕上（调用方负责先关掉 autoClear；四边形不做深度测试，不必 clearDepth） */
  render(renderer: THREE.WebGLRenderer): void {
    if (this.transparent) return;
    renderer.render(this.scene, this.camera);
  }

  /** 立刻切到目标状态（读档/传送这类会让画面突然变化的地方用） */
  snap(): void {
    const preset = PRESETS[this.target];
    this.currentColor.copy(this.targetColor());
    this.currentAlpha = preset.alpha;
    this.currentVignette = preset.vignette;
    this.uniforms.uColor!.value.copy(this.currentColor);
    this.uniforms.uAlpha!.value = this.currentAlpha;
    this.uniforms.uVignette!.value = this.currentVignette;
  }

  dispose(): void {
    this.quad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
  }
}
