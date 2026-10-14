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

const VERTEX_SHADER = /* glsl */ `
attribute vec2 aLight;
attribute float aShade;

varying vec2 vUv;
varying vec2 vLight;
varying float vShade;
varying float vFogDepth;

void main() {
  vUv = uv;
  vLight = aLight;
  vShade = aShade;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
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

varying vec2 vUv;
varying vec2 vLight;
varying float vShade;
varying float vFogDepth;

void main() {
  vec4 texel = texture2D(uAtlas, vUv);
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
}

export class VoxelMaterial {
  readonly material: THREE.ShaderMaterial;
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(atlas: THREE.Texture, options: VoxelMaterialOptions = {}) {
    const translucent = options.translucent ?? false;

    this.uniforms = {
      uAtlas: { value: atlas },
      uSkyBrightness: { value: 1 },
      uMinBrightness: { value: translucent ? 0.32 : 0.06 },
      uFogColor: { value: new THREE.Color(0x8fc7ff) },
      uFogNear: { value: 120 },
      uFogFar: { value: 160 },
      uAlphaTest: { value: translucent ? 0 : 0.5 },
    };

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

  /** 0 = 深夜，1 = 正午。用于昼夜循环 */
  set skyBrightness(value: number) {
    this.uniforms.uSkyBrightness!.value = value;
  }

  setFog(color: THREE.ColorRepresentation, near: number, far: number): void {
    this.uniforms.uFogColor!.value = new THREE.Color(color);
    this.uniforms.uFogNear!.value = near;
    this.uniforms.uFogFar!.value = far;
  }
}
