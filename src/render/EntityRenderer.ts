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
import { XpOrb } from '../core/entity/XpOrb.ts';
import { itemDef } from '../core/registry/items.ts';
import { Throwable } from '../core/entity/Throwable.ts';
import { Firework } from '../core/entity/Firework.ts';
import { Boat } from '../core/entity/Boat.ts';
import { Minecart } from '../core/entity/Minecart.ts';
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
  private readonly throwableMeshes = new Map<number, THREE.Mesh>();
  /** 经验球（批次 170，I16）：用 `Sprite`（永远朝向镜头），与掉落物那套平面分开存 */
  private readonly orbSprites = new Map<number, THREE.Sprite>();
  /** 船（批次 244）：一个 `Group`（船底 + 两舷 + 首尾 + 坐板），按实体 id 记账 */
  private readonly boatGroups = new Map<number, THREE.Group>();
  /** 船的部件几何体（所有船共用一份，只建一次） */
  private boatParts: readonly { geometry: THREE.BufferGeometry; x: number; y: number; z: number }[] | null = null;
  /** 矿车（批次 245）：与船同一套 Group 记账 */
  private readonly minecartGroups = new Map<number, THREE.Group>();
  private minecartParts: readonly { geometry: THREE.BufferGeometry; x: number; y: number; z: number }[] | null = null;
  private orbMaterial: THREE.SpriteMaterial | null = null;
  /** 箭的几何体按**物品 id** 缓存：药水箭各有自己的贴图（箭头上染了药水颜色） */
  private readonly arrowGeometries = new Map<number, THREE.BufferGeometry>();
  private readonly blockGeometries = new Map<number, THREE.BufferGeometry>();
  private readonly spriteGeometries = new Map<number, THREE.BufferGeometry>();
  /** 按**贴图名**索引的 billboard 平面（批次 92：小火球这种没有物品的东西用） */
  private readonly tileSpriteGeometries = new Map<string, THREE.BufferGeometry>();
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
      if (entity instanceof XpOrb) {
        this.syncOrb(entity, alive);
        continue;
      }
      if (entity instanceof Throwable) {
        this.syncThrowable(entity, alive, camera, lightAt);
        continue;
      }
      // 烟花（批次 192）：一枚小火箭往上飞，自发光（它自己是光源）
      if (entity instanceof Firework) {
        this.syncFirework(entity, alive, camera);
        continue;
      }
      // 船（批次 244）：一个多部件的 Group，按 yaw 转向、按光照换材质
      if (entity instanceof Boat) {
        this.syncBoat(entity, alive, lightAt);
        continue;
      }
      // 矿车（批次 245）：同一套 Group，铁皮斗 + 四个轮子
      if (entity instanceof Minecart) {
        this.syncMinecart(entity, alive, lightAt);
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
    for (const [id, mesh] of [...this.throwableMeshes]) {
      if (alive.has(id)) continue;
      this.object.remove(mesh);
      this.throwableMeshes.delete(id);
    }
    for (const [id, sprite] of [...this.orbSprites]) {
      if (alive.has(id)) continue;
      this.object.remove(sprite);
      this.orbSprites.delete(id);
    }
    for (const [id, group] of [...this.boatGroups]) {
      if (alive.has(id)) continue;
      this.object.remove(group);
      this.boatGroups.delete(id);
    }
    for (const [id, group] of [...this.minecartGroups]) {
      if (alive.has(id)) continue;
      this.object.remove(group);
      this.minecartGroups.delete(id);
    }
  }

  /**
   * 同步一辆矿车（批次 245）：铁皮斗 + 四个轮子，按 `yaw` 转向、按光照换材质。
   * 与船同一套写法（`syncBoat`）——两者都是"几个盒子拼出来的载具"。
   */
  private syncMinecart(
    cart: Minecart,
    alive: Set<number>,
    lightAt?: (x: number, y: number, z: number) => EntityLight | null,
  ): void {
    alive.add(cart.id);

    let group = this.minecartGroups.get(cart.id);
    if (!group) {
      group = new THREE.Group();
      for (const part of this.minecartParts ?? (this.minecartParts = this.buildMinecartParts())) {
        const mesh = new THREE.Mesh(part.geometry, this.baseMaterial);
        mesh.position.set(part.x, part.y, part.z);
        group.add(mesh);
      }
      this.minecartGroups.set(cart.id, group);
      this.object.add(group);
    }

    let material = this.baseMaterial;
    if (lightAt) {
      const light = lightAt(Math.floor(cart.x), Math.floor(cart.y + 0.2), Math.floor(cart.z));
      if (light) material = this.materialForLevel(Math.round(Math.max(light.sky * this.skyLightFactor, light.block)));
    }
    for (const child of group.children) (child as THREE.Mesh).material = material;

    group.position.set(cart.x, cart.y, cart.z);
    group.rotation.y = cart.yaw;
  }

  /** 矿车的部件：斗底 + 四壁（铁）+ 四个轮子（石头） */
  private buildMinecartParts(): readonly { geometry: THREE.BufferGeometry; x: number; y: number; z: number }[] {
    const make = (
      width: number,
      height: number,
      depth: number,
      x: number,
      y: number,
      z: number,
      tile: string,
    ) => {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      // 六个面都必须写 UV（只给一个的话另外五面会用整张图集）
      applyFaceUvs(geometry, this.atlas, Array<string>(6).fill(tile));
      return { geometry, x, y, z };
    };
    return [
      // 斗底
      make(0.86, 0.12, 0.86, 0, 0.14, 0, 'iron_block'),
      // 四壁（比船矮，原版矿车是敞口的）
      make(0.1, 0.34, 0.86, -0.38, 0.37, 0, 'iron_block'),
      make(0.1, 0.34, 0.86, 0.38, 0.37, 0, 'iron_block'),
      make(0.86, 0.34, 0.1, 0, 0.37, 0.38, 'iron_block'),
      make(0.86, 0.34, 0.1, 0, 0.37, -0.38, 'iron_block'),
      // 四个轮子（贴 stone，铁皮斗下面一圈深色，一眼能看出"有轮子"）
      make(0.16, 0.16, 0.12, -0.28, 0.08, 0.3, 'stone'),
      make(0.16, 0.16, 0.12, 0.28, 0.08, 0.3, 'stone'),
      make(0.16, 0.16, 0.12, -0.28, 0.08, -0.3, 'stone'),
      make(0.16, 0.16, 0.12, 0.28, 0.08, -0.3, 'stone'),
    ];
  }

  /**
   * 同步一条船（批次 244）。
   *
   * 六个盒子拼成"船底 + 两舷 + 首尾 + 坐板"，贴图直接用**橡木木板**那一张
   * （原版船身也确实是木板纹理），所以不需要新画一张 3D 贴图。
   * 朝向由 `boat.yaw` 给；亮度与其它实体同一套"按光照档位换材质"。
   */
  private syncBoat(
    boat: Boat,
    alive: Set<number>,
    lightAt?: (x: number, y: number, z: number) => EntityLight | null,
  ): void {
    alive.add(boat.id);

    let group = this.boatGroups.get(boat.id);
    if (!group) {
      group = new THREE.Group();
      for (const part of this.boatParts ?? (this.boatParts = this.buildBoatParts())) {
        const mesh = new THREE.Mesh(part.geometry, this.baseMaterial);
        mesh.position.set(part.x, part.y, part.z);
        group.add(mesh);
      }
      this.boatGroups.set(boat.id, group);
      this.object.add(group);
    }

    let material = this.baseMaterial;
    if (lightAt) {
      const light = lightAt(Math.floor(boat.x), Math.floor(boat.y + 0.2), Math.floor(boat.z));
      if (light) {
        const level = Math.max(light.sky * this.skyLightFactor, light.block);
        material = this.materialForLevel(Math.round(level));
      }
    }
    for (const child of group.children) (child as THREE.Mesh).material = material;

    group.position.set(boat.x, boat.y, boat.z);
    group.rotation.y = boat.yaw;
  }

  /** 船的部件（局部坐标，原点在船底中心） */
  private buildBoatParts(): readonly { geometry: THREE.BufferGeometry; x: number; y: number; z: number }[] {
    const tile = 'oak_planks';
    // ⚠️ 必须给满 6 个面：`applyFaceUvs` 是按 `faceTiles.length` 逐面写的，
    // 只给一个的话另外五面会保留 0..1 的整张图集 UV（渲染出来是花的）。
    const tiles = Array<string>(6).fill(tile);
    const make = (
      width: number,
      height: number,
      depth: number,
      x: number,
      y: number,
      z: number,
    ) => {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      applyFaceUvs(geometry, this.atlas, tiles);
      return { geometry, x, y, z };
    };

    return [
      // 船底
      make(1.3, 0.16, 0.92, 0, 0.1, 0),
      // 两舷
      make(0.12, 0.44, 0.92, -0.59, 0.34, 0),
      make(0.12, 0.44, 0.92, 0.59, 0.34, 0),
      // 首尾（比两舷矮一点，像原版那种两头翘起的槽）
      make(1.3, 0.38, 0.12, 0, 0.31, 0.4),
      make(1.3, 0.38, 0.12, 0, 0.31, -0.4),
      // 坐板
      make(0.6, 0.08, 0.7, 0, 0.3, 0),
    ];
  }

  /**
   * 经验球（批次 170，I16）。
   *
   * ⚠️ 刻意**不进图集**：为一颗 16×16 的发光圆点加一张贴图、再处理 UV 与图集排布，
   * 比直接画一张 canvas 贵得多——与信标光柱同一个取舍（见 `BeaconBeamRenderer`）。
   * 球越大越亮也越大（原版按档位分颜色/尺寸）：大球一眼看得出"这一坨值钱"。
   */
  private syncOrb(orb: XpOrb, alive: Set<number>): void {
    alive.add(orb.id);

    let sprite = this.orbSprites.get(orb.id);
    if (!sprite) {
      sprite = new THREE.Sprite(this.sharedOrbMaterial());
      this.orbSprites.set(orb.id, sprite);
      this.object.add(sprite);
    }

    const scale = 0.24 + Math.min(0.2, Math.log2(orb.amount + 1) * 0.035);
    sprite.scale.set(scale, scale, 1);

    // 吸附阶段不需要浮动（正在飞），自由状态才上下晃
    const bob = Math.sin(this.elapsed * 3 + orb.bobPhase) * 0.04;
    sprite.position.set(orb.x, orb.y + 0.12 + bob, orb.z);
  }

  /** 全部经验球共用一份材质（一张 16×16 的径向渐变点） */
  private sharedOrbMaterial(): THREE.SpriteMaterial {
    if (this.orbMaterial) return this.orbMaterial;

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(8, 8, 0, 8, 8, 8);
      // 中心近白偏黄、外圈转绿再透明：原版那颗球就是这个配色
      gradient.addColorStop(0, 'rgba(255, 255, 210, 1)');
      gradient.addColorStop(0.45, 'rgba(198, 255, 90, 0.95)');
      gradient.addColorStop(1, 'rgba(120, 220, 40, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 16, 16);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    this.orbMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      // 球是自发光的：不参与雾与色调映射，远处也一眼看得见
      fog: false,
      toneMapped: false,
    });
    return this.orbMaterial;
  }

  /**
   * 同步一个投掷物（K4 尾巴：雪球/鸡蛋/喷溅药水）。
   *
   * 用**掉落物那套 billboard 平面**，而不是箭那种细长小盒子：
   * 投掷物是圆的/瓶状的，且在空中的时间很短，一张始终朝向镜头的贴图最好认
   * （原版也是精灵状的小东西在飞）。
   */
  private syncThrowable(
    throwable: Throwable,
    alive: Set<number>,
    camera: THREE.Camera,
    lightAt?: (x: number, y: number, z: number) => EntityLight | null,
  ): void {
    alive.add(throwable.id);

    // 两种火球（批次 94 加大火球）：都自发光、都用自己的贴图
    const fireball = throwable.kind === 'small_fireball' || throwable.kind === 'large_fireball';
    const largeFireball = throwable.kind === 'large_fireball';
    // 凋灵骷髅头（批次 116）：与火球同一条路——**用自己的贴图**，而不是物品图标。
    // 黑色那颗用的是凋灵骷髅头**方块的那张脸**（同一个东西长得一样，没必要再画一张）；
    // 蓝色那颗是单独一张（原版靠颜色区分两档）
    const witherSkull = throwable.kind === 'wither_skull' || throwable.kind === 'wither_skull_blue';

    let mesh = this.throwableMeshes.get(throwable.id);
    if (!mesh) {
      // 小火球（批次 92）用自己那张"火团"贴图，而不是物品图标——
      // 它没有对应的物品，是烈焰人吐出来的（见 `entity/Blaze.ts`）
      const geometry = largeFireball
        ? this.tileSpriteGeometry('large_fireball')
        : fireball
          ? this.tileSpriteGeometry('small_fireball')
          : witherSkull
            ? this.tileSpriteGeometry(throwable.kind === 'wither_skull_blue' ? 'wither_skull_blue' : 'wither_skull')
            : this.spriteGeometry(throwable.itemId);
      mesh = new THREE.Mesh(geometry, this.baseMaterial);
      mesh.userData.billboard = true;
      this.throwableMeshes.set(throwable.id, mesh);
      this.object.add(mesh);
    }

    if (fireball) {
      // **自发光**：火球是光源本身，不该跟着周围的光照变暗（原版它一路都亮着）
      mesh.material = this.materialForLevel(15);
    } else if (lightAt) {
      const light = lightAt(Math.floor(throwable.x), Math.floor(throwable.y + 0.1), Math.floor(throwable.z));
      if (light) {
        const level = Math.max(light.sky * this.skyLightFactor, light.block);
        mesh.material = this.materialForLevel(Math.round(level));
      }
    }

    mesh.position.set(throwable.x, throwable.y + 0.12, throwable.z);
    mesh.quaternion.copy(camera.quaternion);
  }

  /**
   * 同步一枚烟花火箭（批次 192）。
   *
   * 与火球同一条路：**自发光**（`materialForLevel(15)`），朝镜头做 billboard。
   * 用 `item_firework_rocket` 的图标当贴图——原版在空中也是一枚小火箭的样子。
   */
  private syncFirework(firework: Firework, alive: Set<number>, camera: THREE.Camera): void {
    alive.add(firework.id);
    let mesh = this.throwableMeshes.get(firework.id);
    if (!mesh) {
      mesh = new THREE.Mesh(this.tileSpriteGeometry('item_firework_rocket'), this.baseMaterial);
      mesh.userData.billboard = true;
      mesh.material = this.materialForLevel(15);
      this.throwableMeshes.set(firework.id, mesh);
      this.object.add(mesh);
    }
    mesh.position.set(firework.x, firework.y + 0.1, firework.z);
    mesh.quaternion.copy(camera.quaternion);
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
      mesh = new THREE.Mesh(this.arrowGeometryFor(arrow.itemId), this.baseMaterial);
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
  private arrowGeometryFor(itemId: number): THREE.BufferGeometry {
    const cached = this.arrowGeometries.get(itemId);
    if (cached) return cached;

    const geometry = new THREE.BoxGeometry(ARROW_THICKNESS, ARROW_THICKNESS, ARROW_LENGTH);
    // 六面都用这支箭的图标贴图（斜着的贴图铺在小盒子上，看起来就是一支箭）。
    // 药水箭的贴图是"箭头染了药水颜色"的那张，所以这里必须按物品 id 取。
    const uv = this.atlas.uv(itemDef(itemId)?.tile ?? 'item_arrow');
    const attribute = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < attribute.count; i++) {
      attribute.setXY(i, uv[0] + (attribute.getX(i) > 0.5 ? uv[2] - uv[0] : 0), uv[1] + (attribute.getY(i) > 0.5 ? uv[3] - uv[1] : 0));
    }
    attribute.needsUpdate = true;
    this.arrowGeometries.set(itemId, geometry);
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

  /**
   * 按**贴图名**取一张 billboard 平面（批次 92，小火球用）。
   *
   * `spriteGeometry` 是"按物品 id 找图标"，而小火球没有对应物品——
   * 它是烈焰人吐出来的一团火。两张缓存分开存：物品 id 与贴图名可能撞号，
   * 混用一份 Map 迟早会把某个物品的图标换成火团。
   */
  private tileSpriteGeometry(tile: string): THREE.BufferGeometry {
    const cached = this.tileSpriteGeometries.get(tile);
    if (cached) return cached;

    const geometry = new THREE.PlaneGeometry(SPRITE_SIZE, SPRITE_SIZE);
    applyFaceUvs(geometry, this.atlas, [tile]);

    this.tileSpriteGeometries.set(tile, geometry);
    return geometry;
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) this.object.remove(mesh);
    this.meshes.clear();
    for (const sprite of this.orbSprites.values()) this.object.remove(sprite);
    this.orbSprites.clear();
    if (this.orbMaterial) {
      this.orbMaterial.map?.dispose();
      this.orbMaterial.dispose();
      this.orbMaterial = null;
    }
    for (const geometry of this.blockGeometries.values()) geometry.dispose();
    for (const geometry of this.arrowGeometries.values()) geometry.dispose();
    for (const geometry of this.spriteGeometries.values()) geometry.dispose();
    for (const geometry of this.tileSpriteGeometries.values()) geometry.dispose();
    this.blockGeometries.clear();
    this.arrowGeometries.clear();
    this.spriteGeometries.clear();
    this.tileSpriteGeometries.clear();
    for (const group of this.boatGroups.values()) this.object.remove(group);
    this.boatGroups.clear();
    if (this.boatParts) {
      for (const part of this.boatParts) part.geometry.dispose();
      this.boatParts = null;
    }
    for (const group of this.minecartGroups.values()) this.object.remove(group);
    this.minecartGroups.clear();
    if (this.minecartParts) {
      for (const part of this.minecartParts) part.geometry.dispose();
      this.minecartParts = null;
    }
    for (const material of this.materialByLevel) material?.dispose();
    this.materialByLevel.length = 0;
    this.baseMaterial.dispose();
    this.object.removeFromParent();
  }
}
