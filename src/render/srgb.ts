/**
 * 按 sRGB 数值直接构造颜色（绕开 three 的色彩管理）
 *
 * ⚠️ 这个坑很容易踩：three 默认开启色彩管理（`ColorManagement.enabled = true`），
 * `new THREE.Color(0xdc9a6b)` 会把十六进制**当成 sRGB 先转成线性**（0.86 → 0.72）。
 * 而本项目的体素管线是"着色器把值原样写进帧缓冲"（图集标的是 NoColorSpace，
 * 自定义 ShaderMaterial 也不会被 three 追加线性→sRGB 的转换），因此：
 *
 *   期望值 rgb(220,154,107) → 用 Color 构造实际渲染出 rgb(183,82,38)（明显的橙褐色）
 *
 * 内置材质（MeshBasicMaterial 之类）因为会走完整的"线性→sRGB"输出转换，
 * 反而看不出问题；只有自定义 ShaderMaterial 才会暴露。手臂颜色就是靠像素取样发现的。
 *
 * 因此凡是给自定义着色器传"平色"的地方，都用这里的函数，不要用 `new THREE.Color(hex)`。
 */

import * as THREE from 'three';

export function srgbColor(hex: number): THREE.Color {
  const color = new THREE.Color();
  color.r = ((hex >> 16) & 0xff) / 255;
  color.g = ((hex >> 8) & 0xff) / 255;
  color.b = (hex & 0xff) / 255;
  return color;
}
