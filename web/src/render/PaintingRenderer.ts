/**
 * 多格拼贴的画面（批次 495，B51 收口）
 *
 * 多格画的每一格都是 `painting` 方块、状态里只有**哨兵档位**（`MULTI_PAINTING_VARIANT`），
 * 方块自己的贴图是**全透明**的——真正的画面由这里画：每格一个平面、贴自己的子图
 * （`painting_<name>_<col>_<row>`）。拼起来就是整幅画。
 *
 * 与展示框（`ItemFrameRenderer`）同一套做法：
 *  - 主程序每帧把"哪些格子、哪张子图、多少光照"灌进来，渲染器只负责对账；
 *  - 图集是 `NoColorSpace`，所以走自定义着色器原样采样（内置材质会做色彩空间转换）；
 *  - 材质按 `子图|亮度` 缓存：同子图同光照的所有格子共用一份。
 *
 * 为什么不用"跨瓦片大图"：那要改图集的基础设施（`TILE_ORDER` 允许占位、UV 按矩形算），
 * 牵动网格化这条热路径；按格切子图只要"每格一张 16×16"，基础设施一行都不用改。
 */

import * as THREE from 'three';
import type { TextureAtlas } from './TextureAtlas.ts';


const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uBrightness;
uniform vec4 uUvRect;
varying vec2 vUv;
void main() {
  // 局部 uv（0~1）→ 图集里这一格的矩形
  vec2 atlasUv = mix(uUvRect.xy, uUvRect.zw, vUv);
  vec4 texel = texture2D(uAtlas, atlasUv);
  if (texel.a < 0.1) discard;
  // 图集是 NoColorSpace：原样采样再乘亮度（与体素/展示框同一条）
  gl_FragColor = vec4(texel.rgb * uBrightness, texel.a);
}
`;

/** 最低亮度：与展示框同一个理由（洞里也要看得清画的是什么） */
const MIN_BRIGHTNESS = 0.4;

/** 一个要画的格子 */
export interface PaintingRenderItem {
  /** 唯一键（`维度|x,y,z`），用于对账 */
  key: string;
  x: number;
  y: number;
  z: number;
  /** 子图名（`painting_donkey_kong_2_1`） */
  tile: string;
  /** 这一格的光照（0~15） */
  light: number;
  /** 方块状态（取 `facing` 决定画面朝哪边） */
  state: number;
}

interface Entry {
  mesh: THREE.Mesh;
  tile: string;
  light: number;
  facing: number;
}

/** `facing` → 平面绕 Y 的角（0 = 法线 +z；墙在 -z 那一侧） */
const FACING_YAW = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

export class PaintingRenderer {
  readonly group = new THREE.Group();

  private readonly entries = new Map<string, Entry>();
  private readonly geometries = new Map<string, THREE.PlaneGeometry>();
  private readonly materials = new Map<string, THREE.ShaderMaterial>();

  constructor(private readonly atlas: TextureAtlas) {}

  update(items: readonly PaintingRenderItem[]): void {
    const alive = new Set<string>();
    for (const item of items) {
      alive.add(item.key);
      const facing = item.state & 0b110;
      const facingIndex = (facing >> 1) & 0b11;
      let entry = this.entries.get(item.key);
      if (!entry) {
        entry = this.createEntry(item, facingIndex);
        this.entries.set(item.key, entry);
        this.group.add(entry.mesh);
      }
      // 位置：格心 + 朝法线方向挪一点点（避免与"透明方块面"打架）
      const yaw = FACING_YAW[facingIndex] ?? 0;
      entry.mesh.position.set(
        item.x + 0.5 + Math.sin(yaw) * 0.031,
        item.y + 0.5,
        item.z + 0.5 + Math.cos(yaw) * 0.031,
      );
      if (entry.facing !== facingIndex) {
        entry.mesh.rotation.set(0, yaw, 0);
        entry.facing = facingIndex;
      }
      if (entry.tile !== item.tile || entry.light !== item.light) {
        entry.mesh.material = this.materialFor(item.tile, item.light);
        entry.tile = item.tile;
        entry.light = item.light;
      }
    }

    for (const [key, entry] of [...this.entries]) {
      if (alive.has(key)) continue;
      this.group.remove(entry.mesh);
      this.entries.delete(key);
    }
  }

  private createEntry(item: PaintingRenderItem, facingIndex: number): Entry {
    const geometry = this.planeGeometry();
    const mesh = new THREE.Mesh(geometry, this.materialFor(item.tile, item.light));
    mesh.rotation.set(0, FACING_YAW[facingIndex] ?? 0, 0);
    return { mesh, tile: item.tile, light: item.light, facing: facingIndex };
  }

  /** 所有格子共用一份 1×1 平面（朝向靠 rotation、位置靠 mesh.position） */
  private planeGeometry(): THREE.PlaneGeometry {
    let geometry = this.geometries.get('plane');
    if (!geometry) {
      geometry = new THREE.PlaneGeometry(1, 1);
      this.geometries.set('plane', geometry);
    }
    return geometry;
  }

  /**
   * 材质按 `子图|亮度` 缓存。
   *
   * UV 矩形在创建时就算好（`tileRectAt` 的内缩不能省：不内缩会采到隔壁瓦片的边）。
   */
  private materialFor(tile: string, light: number): THREE.ShaderMaterial {
    const level = Math.max(0, Math.min(15, Math.round(light)));
    const key = `${tile}|${level}`;
    let material = this.materials.get(key);
    if (!material) {
      // 图集坐标的唯一出处（半像素内缩也在里面，自己算会漏掉渗色）
      const [u0, v0, u1, v1] = this.atlas.uv(tile);
      material = new THREE.ShaderMaterial({
        uniforms: {
          uAtlas: { value: this.atlas.texture },
          uBrightness: { value: Math.max(MIN_BRIGHTNESS, level / 15) },
          uUvRect: { value: new THREE.Vector4(u0, v0, u1, v1) },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
      });
      this.materials.set(key, material);
    }
    return material;
  }

  /** 当前画着几个格子（测试与调试用） */
  get cellCount(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.group.remove(entry.mesh);
    this.entries.clear();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }
}
