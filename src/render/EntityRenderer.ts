/**
 * 实体渲染
 *
 * 掉落物按原版分两种形态：
 *  - 方块类物品 → 一个 1/4 大小的迷你方块（六面取方块自身的贴图）
 *  - 非方块物品 → 一张始终朝向镜头的平面贴图
 *
 * 箭矢（J9）：一个细长的小盒子，六面都用 `item_arrow` 的贴图，按飞行方向摆正。
 * 所有箭共用一份几何体（形状完全一样），只是位置与朝向不同。
 *
 * 几何体按物品 id 缓存复用，所以同种掉落物再多也只有一个 BufferGeometry。
 *
 * 光照：逐实体采样所在格子的天光/方块光，把亮度量化成 16 档，每一档共用一个材质。
 * 这样既能有"洞里暗、火把旁亮"的效果，又不会给每个实体各建一个材质。
 */

import * as THREE from 'three';
import type { TextureAtlas } from './TextureAtlas.ts';
import { applyFaceUvs, blockFaceTiles } from './atlasMesh.ts';
import { Arrow } from '../core/entity/Arrow.ts';
import { ItemEntity } from '../core/entity/ItemEntity.ts';
import type { Entity } from '../core/entity/Entity.ts';
import { blockForItem, itemIconTile } from '../core/registry/items.ts';

const BLOCK_SIZE = 0.26;
const SPRITE_SIZE = 0.3;
/** 箭的盒子尺寸：细长（横截面 0.07、长 0.7），与原版的箭差不多粗 */
const ARROW_THICKNESS = 0.07;
const ARROW_LENGTH = 0.7;
/** 光照档数（0-15） */
const LIGHT_LEVELS = 16;
/** 最暗也要能看见轮廓，与原版的"最低亮度"一致 */
const MIN_BRIGHTNESS = 0.08;
/** 复用的临时对象（每帧给几十支箭算朝向，不该每次 new） */
const _forward = new THREE.Vector3(0, 0, -1);
const _dir = new THREE.Vector3();

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
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(uAtlas, vUv);
  if (texel.a < 0.5) discard;
  gl_FragColor = vec4(texel.rgb * uBrightness, texel.a);
}
`;

/** 光照等级 → 亮度：沿用与原版一致的曲线 level/(4-3×level) */
function brightnessForLevel(level: number): number {
  const normalized = Math.max(0, Math.min(1, level / (LIGHT_LEVELS - 1)));
  const curve = normalized / (4 - 3 * normalized);
  return Math.max(curve, MIN_BRIGHTNESS);
}

export interface EntityLight {
  sky: number;
  block: number;
}

export class EntityRenderer {
  readonly object = new THREE.Group();

  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly arrowMeshes = new Map<number, THREE.Mesh>();
  private arrowGeometry: THREE.BufferGeometry | null = null;
  private readonly blockGeometries = new Map<number, THREE.BufferGeometry>();
  private readonly spriteGeometries = new Map<number, THREE.BufferGeometry>();
  private readonly baseMaterial: THREE.ShaderMaterial;
  /** 按光照档位缓存的材质（0-15），同档位的实体共用 */
  private readonly materialByLevel: THREE.ShaderMaterial[] = [];
  /** 天光倍率（昼夜），与 setter 同名会与访问器冲突，这里换个内部名 */
  private skyLightFactor = 1;
  private elapsed = 0;

  constructor(scene: THREE.Scene, private readonly atlas: TextureAtlas) {
    this.baseMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas.texture },
        uBrightness: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.FrontSide,
      transparent: false,
      fog: false,
      lights: false,
    });
    scene.add(this.object);
  }

  /** 昼夜变化时调节天光对实体的贡献 */
  set skyBrightness(value: number) {
    this.skyLightFactor = value;
  }

  /** 当前渲染的掉落物 mesh 数量（验收用：每个掉落物一个 mesh，实例化的候选） */
  get drawableCount(): number {
    return this.meshes.size;
  }

  /**
   * @param lightAt 采样世界坐标处的光照；返回 null 表示该位置未加载（按全亮处理）
   */
  update(
    entities: readonly Entity[],
    camera: THREE.Camera,
    dt: number,
    lightAt?: (x: number, y: number, z: number) => EntityLight | null,
  ): void {
    this.elapsed += dt;
    const alive = new Set<number>();

    for (const entity of entities) {
      if (entity instanceof Arrow) {
        this.syncArrow(entity, alive, lightAt);
        continue;
      }
      if (!(entity instanceof ItemEntity)) continue;
      alive.add(entity.id);

      let mesh = this.meshes.get(entity.id);
      if (!mesh) {
        mesh = this.createMesh(entity.itemId);
        this.meshes.set(entity.id, mesh);
        this.object.add(mesh);
      }

      // 逐实体光照：取所在格的光照等级（天光按当前昼夜亮度衰减）
      if (lightAt) {
        const light = lightAt(Math.floor(entity.x), Math.floor(entity.y + 0.1), Math.floor(entity.z));
        if (light) {
          const level = Math.max(light.sky * this.skyLightFactor, light.block);
          mesh.material = this.materialForLevel(Math.round(level));
        }
      }

      const bob = Math.sin(this.elapsed * 1.8 + entity.bobPhase) * 0.055;
      mesh.position.set(entity.x, entity.y + 0.14 + bob, entity.z);

      if (mesh.userData.billboard === true) {
        mesh.quaternion.copy(camera.quaternion);
      } else {
        mesh.rotation.y = this.elapsed * 1.6 + entity.bobPhase;
      }
    }

    for (const [id, mesh] of [...this.meshes]) {
      if (alive.has(id)) continue;
      this.object.remove(mesh);
      this.meshes.delete(id);
    }
    // 箭用同一套"按 id 增删"的账，但要和掉落物分开两份 map——
    // 两类实体的 mesh 形状与朝向逻辑都不一样，混在一张表里迟早会拿错
    for (const [id, mesh] of [...this.arrowMeshes]) {
      if (alive.has(id)) continue;
      this.object.remove(mesh);
      this.arrowMeshes.delete(id);
    }
  }

  /** 同步一支箭的位置与朝向 */
  private syncArrow(
    arrow: Arrow,
    alive: Set<number>,
    lightAt?: (x: number, y: number, z: number) => EntityLight | null,
  ): void {
    alive.add(arrow.id);

    let mesh = this.arrowMeshes.get(arrow.id);
    if (!mesh) {
      mesh = new THREE.Mesh(this.arrow(), this.baseMaterial);
      this.arrowMeshes.set(arrow.id, mesh);
      this.object.add(mesh);
    }

    if (lightAt) {
      const light = lightAt(Math.floor(arrow.x), Math.floor(arrow.y), Math.floor(arrow.z));
      if (light) {
        const level = Math.max(light.sky * this.skyLightFactor, light.block);
        mesh.material = this.materialForLevel(Math.round(level));
      }
    }

    mesh.position.set(arrow.x, arrow.y + 0.1, arrow.z);
    // 盒子默认沿 -Z 朝前，把 -Z 转到箭的飞行方向
    _dir.set(arrow.dirX, arrow.dirY, arrow.dirZ);
    if (_dir.lengthSq() > 1e-8) {
      _dir.normalize();
      mesh.quaternion.setFromUnitVectors(_forward, _dir);
    }
  }

  /** 箭的几何体（所有箭共用一份） */
  private arrow(): THREE.BufferGeometry {
    if (this.arrowGeometry) return this.arrowGeometry;
    const geometry = new THREE.BoxGeometry(ARROW_THICKNESS, ARROW_THICKNESS, ARROW_LENGTH);
    // 六面都用箭的图标贴图（斜着的贴图铺在小盒子上，看起来就是一支箭）
    const uv = this.atlas.uv('item_arrow');
    const attribute = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < attribute.count; i++) {
      attribute.setXY(i, uv[0] + (attribute.getX(i) > 0.5 ? uv[2] - uv[0] : 0), uv[1] + (attribute.getY(i) > 0.5 ? uv[3] - uv[1] : 0));
    }
    attribute.needsUpdate = true;
    this.arrowGeometry = geometry;
    return geometry;
  }

  /** 调试用：当前已按需创建的光照档位（能直观确认"逐实体光照"确实在切换材质） */
  get createdLightLevels(): number[] {
    const levels: number[] = [];
    this.materialByLevel.forEach((material, level) => {
      if (material) levels.push(level);
    });
    return levels;
  }

  private materialForLevel(level: number): THREE.ShaderMaterial {
    const clamped = Math.max(0, Math.min(LIGHT_LEVELS - 1, level));
    let material = this.materialByLevel[clamped];
    if (!material) {
      material = this.baseMaterial.clone();
      material.uniforms = THREE.UniformsUtils.clone(this.baseMaterial.uniforms);
      material.uniforms.uBrightness!.value = brightnessForLevel(clamped);
      this.materialByLevel[clamped] = material;
    }
    return material;
  }

  private createMesh(itemId: number): THREE.Mesh {
    const blockId = blockForItem(itemId);
    if (blockId !== undefined) {
      const mesh = new THREE.Mesh(this.blockGeometry(itemId, blockId), this.baseMaterial);
      mesh.userData.billboard = false;
      return mesh;
    }

    const mesh = new THREE.Mesh(this.spriteGeometry(itemId), this.baseMaterial);
    mesh.userData.billboard = true;
    return mesh;
  }

  /** 迷你方块：六面分别取方块的顶/底/侧贴图 */
  private blockGeometry(itemId: number, blockId: number): THREE.BufferGeometry {
    const cached = this.blockGeometries.get(itemId);
    if (cached) return cached;

    const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    // BoxGeometry 的面顺序为 +X, -X, +Y, -Y, +Z, -Z（取贴图名的规则见 atlasMesh）
    applyFaceUvs(geometry, this.atlas, blockFaceTiles(blockId));

    this.blockGeometries.set(itemId, geometry);
    return geometry;
  }

  /** 物品贴图平面 */
  private spriteGeometry(itemId: number): THREE.BufferGeometry {
    const cached = this.spriteGeometries.get(itemId);
    if (cached) return cached;

    const geometry = new THREE.PlaneGeometry(SPRITE_SIZE, SPRITE_SIZE);
    applyFaceUvs(geometry, this.atlas, [itemIconTile(itemId)]);

    this.spriteGeometries.set(itemId, geometry);
    return geometry;
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) this.object.remove(mesh);
    this.meshes.clear();
    for (const geometry of this.blockGeometries.values()) geometry.dispose();
    for (const geometry of this.spriteGeometries.values()) geometry.dispose();
    this.blockGeometries.clear();
    this.spriteGeometries.clear();
    for (const material of this.materialByLevel) material?.dispose();
    this.materialByLevel.length = 0;
    this.baseMaterial.dispose();
    this.object.removeFromParent();
  }
}
