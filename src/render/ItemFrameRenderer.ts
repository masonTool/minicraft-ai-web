/**
 * 物品展示框里的那件东西（B14，批次 86）
 *
 * 展示框本身是一个方块（`blockShapes.itemFrameBox`：墙上的一块空心板），
 * 但"框里挂着什么"是**运行时数据**（`world/ItemFrame.ts` 那张按坐标的表），
 * 烘不进图集，所以要在这里单独画——与告示牌上的字（`SignRenderer`）同一条路。
 *
 * 三处与告示牌不同、值得记下来的取舍：
 *  1. **不用 `CanvasTexture`**：挂着的是一件**物品**，而物品的图标本来就**在图集里**
 *     （`itemIconTile`），所以几何体直接取图集 UV 就行——不必每块框再画一张画布。
 *     ⚠️ 代价：图集是 `NoColorSpace`，而内置材质会替我们做色彩空间转换，
 *     所以这里与手持物品（`HandRenderer`）一样走**自定义着色器**原样采样。
 *  2. **亮度按光照分档缓存材质**：框上的光（天光与方块光取较大者）是一个 0~15 的**整数**，
 *     于是每种光照一个材质、最多 16 个，同光亮的所有框共用——
 *     比"每块框克隆一个材质"省得多，也仍然是逐格正确的明暗。
 *  3. **平面内再转 45°**（`frameItemAngle`）：方块体的朝向靠**外层 Group** 定
 *     （Group 的局部 +Z 是框面的法线），物品自己的旋转挂在**子节点**上，
 *     于是"转物品"不会把框面本身转歪（Euler 顺序的坑绕开了）。
 *
 * 斜挂时按 1/√2 缩小（`frameItemScale`）：框的洞口只有 8/16，不缩的话
 * 45° 的对角会直接穿进框的木条里。
 */

import * as THREE from 'three';
import type { TextureAtlas } from './TextureAtlas.ts';
import { blockForItem, itemIconTile } from '../core/registry/items.ts';
import { ITEM_FRAME_ITEM_SIZE, itemFrameItemAnchor } from '../core/registry/blockShapes.ts';
import { frameItemAngle, frameItemScale } from '../core/world/ItemFrame.ts';
import { applyFaceShade, applyFaceUvs, blockFaceTiles, FACE_SHADE } from './atlasMesh.ts';

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
uniform float uBrightness;
uniform float uAlphaTest;
varying vec2 vUv;
varying float vShade;

void main() {
  // 图集是 NoColorSpace（原样采样），所以这里**不能**走内置材质的颜色管线，
  // 与体素/手持物品同一条：采样值直接乘亮度写进帧缓冲
  vec4 texel = texture2D(uAtlas, vUv);
  if (texel.a < uAlphaTest) discard;
  gl_FragColor = vec4(texel.rgb * vShade * uBrightness, texel.a);
}
`;

/**
 * 最低亮度：与告示牌同一个理由（夜里/洞里也要看得清框里挂的是什么）。
 * 比牌子的 0.5 略低：牌子是"读字"，而框里是"看东西"，留一点"暗处看不清"的感觉更自然。
 */
const MIN_BRIGHTNESS = 0.4;

/** 一块要显示的框 */
export interface FrameRenderItem {
  /** 唯一键（`维度|x,y,z`），用于对账 */
  key: string;
  x: number;
  y: number;
  z: number;
  /** 挂着的那件物品 */
  itemId: number;
  /** 旋转档位 0~7 */
  rotation: number;
  /** 那一格的光照（0~15）：天光与方块光取较大者 */
  light: number;
  /** 方块状态（朝向） */
  state: number;
}

interface Entry {
  /** 外层节点：负责"框面朝哪边" */
  readonly group: THREE.Group;
  mesh: THREE.Mesh | null;
  itemId: number;
  rotation: number;
  light: number;
}

export class ItemFrameRenderer {
  readonly group = new THREE.Group();

  private readonly entries = new Map<string, Entry>();
  /** 每种物品一份几何体（方块体或平面；同一种物品的所有框共用） */
  private readonly geometries = new Map<number, THREE.BufferGeometry>();
  /** 每种光照档一份材质（0~15 共 16 份，同光亮共用） */
  private readonly materials = new Map<number, THREE.ShaderMaterial>();
  private readonly seen = new Set<string>();

  constructor(private readonly atlas: TextureAtlas) {
    this.group.name = 'item-frames';
  }

  /**
   * 与"这一维度、区块已加载、那一格还是展示框"的框对账。
   *
   * 筛选放在调用方（哪些区块加载了、那一格还是不是框，是世界的事），
   * 与 `SignRenderer.sync` 完全同一条口径。
   */
  sync(items: readonly FrameRenderItem[]): void {
    this.seen.clear();
    for (const item of items) {
      this.seen.add(item.key);
      const entry = this.entries.get(item.key) ?? this.create(item);
      if (entry.itemId !== item.itemId) this.setItem(entry, item);
      if (entry.rotation !== item.rotation) this.applyRotation(entry, item.rotation);
      if (entry.light !== item.light) this.applyLight(entry, item.light);
      this.place(entry, item);
    }

    // 掉出视野的（区块卸载 / 换维度 / 框被拆）→ 连子节点一起丢掉
    for (const [key, entry] of [...this.entries]) {
      if (this.seen.has(key)) continue;
      this.group.remove(entry.group);
      this.entries.delete(key);
    }
  }

  /** 当前显示的框有多少个（验收与调试用） */
  get count(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.group.remove(entry.group);
    this.entries.clear();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }

  private create(item: FrameRenderItem): Entry {
    const entry: Entry = {
      group: new THREE.Group(),
      mesh: null,
      itemId: -1,
      rotation: -1,
      light: -1,
    };
    this.entries.set(item.key, entry);
    this.group.add(entry.group);
    this.setItem(entry, item);
    this.applyRotation(entry, item.rotation);
    this.applyLight(entry, item.light);
    this.place(entry, item);
    return entry;
  }

  /** 换掉框里挂着的东西（几何体按物品缓存，所以换的是 mesh 不是几何体） */
  private setItem(entry: Entry, item: FrameRenderItem): void {
    if (entry.mesh) {
      entry.group.remove(entry.mesh);
      entry.mesh = null;
    }
    entry.itemId = item.itemId;
    const material = this.materialFor(item.light);
    const mesh = new THREE.Mesh(this.geometryFor(item.itemId), material);
    entry.mesh = mesh;
    entry.group.add(mesh);
    // ⚠️ 新 mesh 的 rotation / scale 是全新的，必须**按当前档位补上**：
    // 只写"档位变了才更新"是不够的——"换了挂着的东西"这一支走的就是这里，
    // 漏了的表现是"换上去之后它正着挂，直到玩家再点一次才转回原来的角度"
    this.applyRotation(entry, item.rotation);
    this.applyLight(entry, item.light);
  }

  private applyRotation(entry: Entry, rotation: number): void {
    entry.rotation = rotation;
    if (!entry.mesh) return;
    entry.mesh.rotation.z = frameItemAngle(rotation);
    entry.mesh.scale.setScalar(frameItemScale(rotation));
  }

  private applyLight(entry: Entry, light: number): void {
    entry.light = light;
    if (!entry.mesh) return;
    entry.mesh.material = this.materialFor(light);
  }

  /** 摆到框面上：位置与朝向都从注册表那一层的纯函数取 */
  private place(entry: Entry, item: FrameRenderItem): void {
    const anchor = itemFrameItemAnchor(item.state);
    // 立方体物品再往外挪半个身位：平面物品贴着框面正好，而方块体贴着框面时
    // 有一半会埋进板子与墙里（锚点是"板面 + 一点余量"，见 `itemFrameItemAnchor`）
    const depth = blockForItem(item.itemId) !== undefined ? ITEM_FRAME_ITEM_SIZE / 2 : 0;
    entry.group.position.set(
      item.x + anchor.x + anchor.nx * depth,
      item.y + anchor.y,
      item.z + anchor.z + anchor.nz * depth,
    );
    // 平面/方块体默认朝 +Z，按法线转一下（与告示牌文字同一句）
    entry.group.rotation.y = Math.atan2(anchor.nx, anchor.nz);
  }

  /**
   * 某件物品的几何体。
   *
   *  - **方块物品**：一个小立方体（六面取该方块的顶/底/侧贴图）——
   *    与手持方块同一个观感（`HandRenderer.blockGeometry`）；
   *  - **非方块物品**：一片朝向框面的薄板（图标贴图）。
   *
   * ⚠️ 与原版差异：**方块物品在框里是一个小立方体**（原版也是立体小方块，
   * 这一条反而对齐了），但原版会把它压扁一点贴住框面，这里不做压扁。
   */
  private geometryFor(itemId: number): THREE.BufferGeometry {
    const cached = this.geometries.get(itemId);
    if (cached) return cached;

    const size = ITEM_FRAME_ITEM_SIZE;
    const blockId = blockForItem(itemId);
    let geometry: THREE.BufferGeometry;
    if (blockId !== undefined) {
      geometry = new THREE.BoxGeometry(size, size, size);
      applyFaceUvs(geometry, this.atlas, blockFaceTiles(blockId));
      applyFaceShade(geometry, FACE_SHADE);
    } else {
      geometry = new THREE.PlaneGeometry(size, size);
      applyFaceUvs(geometry, this.atlas, [itemIconTile(itemId)]);
      applyFaceShade(geometry, [1]);
    }
    this.geometries.set(itemId, geometry);
    return geometry;
  }

  /** 某个光照档的材质（0~15 共 16 份，懒建） */
  private materialFor(light: number): THREE.ShaderMaterial {
    const level = Math.max(0, Math.min(15, Math.round(light)));
    const cached = this.materials.get(level);
    if (cached) return cached;

    const t = level / 15;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: this.atlas.texture },
        uBrightness: { value: MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * t },
        uAlphaTest: { value: 0.5 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    this.materials.set(level, material);
    return material;
  }
}
