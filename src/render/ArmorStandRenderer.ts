/**
 * 盔甲架上穿着的装备（批次 493，B51 的尾巴）
 *
 * 架子**本体**不用这里画：它是一个方块，几何在 `blockShapes` 的 `armor_stand` 里
 * （底座 / 立柱 / 两根横杆 / 头），走普通的区块网格。
 * 这里只画"穿上去的那四件"——它们不在方块里，而在 `world/ArmorStands.ts`
 * 那张按坐标的表里，所以和展示框（`ItemFrameRenderer`）、告示牌（`SignRenderer`）
 * 是同一条路：**主程序每帧把表灌进来，渲染器按坐标对账**。
 *
 * 三个取舍：
 *  1. **不用贴图，用纯色盒子**：物品图标是 16×16 的平面，套在立体架子上会糊成一片；
 *     材质色 + 部位盒子的形状反而更像"穿上了"（颜色表在 `armorDisplayColor`）。
 *  2. **一种材质一份材质对象**：颜色只有六种、亮度按 0~15 分档缓存，
 *     于是"几百个架子"最多几十个材质，而不是每件装备一个。
 *  3. **对账而不是重建**：每个架子一个 `Group`，槽位变化时只增删那一个子节点——
 *     每帧重建整棵树会把 GC 压力摊到主线程上（展示框那边也是这么做的）。
 */

import * as THREE from 'three';
import { ARMOR_STAND_SLOTS, armorDisplayColor } from '../core/world/ArmorStands.ts';

/**
 * 每个槽位的盒子（相对方块原点，单位是格）。
 *
 * 数值直接照着架子本身的几何放大一圈：头 5.5~10.5、躯干 4~12、两条腿与两只脚分开。
 * 这样"穿上之后"装备刚好把架子包住，不会露出半截木头。
 */
const SLOT_BOXES: readonly (readonly [number, number, number, number, number, number][])[] = [
  // 0 头盔：一个比头略大的方块
  [[5.5 / 16, 11 / 16, 5.5 / 16, 10.5 / 16, 14.5 / 16, 10.5 / 16]],
  // 1 胸甲：躯干（宽 8/16、厚 6/16、高 5.5/16）
  [[4 / 16, 5.5 / 16, 5 / 16, 12 / 16, 11 / 16, 11 / 16]],
  // 2 护腿：两条腿
  [
    [5 / 16, 2 / 16, 5.5 / 16, 7.5 / 16, 5.5 / 16, 10.5 / 16],
    [8.5 / 16, 2 / 16, 5.5 / 16, 11 / 16, 5.5 / 16, 10.5 / 16],
  ],
  // 3 靴子：两只脚（比腿略宽、只占最下面两格）
  [
    [4.5 / 16, 0.2 / 16, 4.5 / 16, 7.5 / 16, 2 / 16, 11.5 / 16],
    [8.5 / 16, 0.2 / 16, 4.5 / 16, 11.5 / 16, 2 / 16, 11.5 / 16],
  ],
];

/** 一个要画的架子 */
export interface ArmorStandRenderItem {
  /** 唯一键（`维度|x,y,z`），用于对账 */
  key: string;
  x: number;
  y: number;
  z: number;
  /** 四个槽各是什么物品 id（空槽是 null） */
  slots: readonly (number | null)[];
  /** 那一格的光照（0~15）：天光与方块光取较大者 */
  light: number;
}

interface StandEntry {
  readonly group: THREE.Group;
  /** 每个槽当前挂着的盒子（没穿就是空数组） */
  readonly meshes: THREE.Mesh[][];
  /** 每个槽当前的物品 id（用来判断"要不要重建"） */
  readonly slotIds: (number | null)[];
  light: number;
}

/** 最低亮度：与展示框同一个理由（夜里/洞里也要看得清穿了什么） */
const MIN_BRIGHTNESS = 0.4;

/** 阴影系数：不同朝向的面压暗一点，否则纯色盒子看着是一块平面 */
const FACE_SHADE = { px: 0.86, nx: 0.74, py: 1, ny: 0.62, pz: 0.92, nz: 0.8 } as const;

export class ArmorStandRenderer {
  readonly group = new THREE.Group();

  private readonly entries = new Map<string, StandEntry>();
  /** 几何体按槽位缓存（同槽位的所有架子共用一份） */
  private readonly geometries = new Map<string, THREE.BoxGeometry>();
  /** 材质按 `颜色|亮度` 缓存 */
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>();

  /**
   * 每帧更新：按 `items` 对账。
   *
   * 传进来的架子**不是**"这一帧要画的全集"也没关系——没出现在列表里的会被移除
   * （它们可能已经出了加载范围，或者被拆了）。
   */
  update(items: readonly ArmorStandRenderItem[]): void {
    const alive = new Set<string>();
    for (const item of items) {
      alive.add(item.key);
      let entry = this.entries.get(item.key);
      if (!entry) {
        entry = this.createEntry(item);
        this.entries.set(item.key, entry);
        this.group.add(entry.group);
      }
      entry.group.position.set(item.x, item.y, item.z);
      entry.light = item.light;
      this.syncSlots(entry, item);
    }

    for (const [key, entry] of [...this.entries]) {
      if (alive.has(key)) continue;
      this.group.remove(entry.group);
      this.entries.delete(key);
    }
  }

  private createEntry(item: ArmorStandRenderItem): StandEntry {
    const group = new THREE.Group();
    group.position.set(item.x, item.y, item.z);
    return {
      group,
      meshes: Array.from({ length: ARMOR_STAND_SLOTS }, () => []),
      slotIds: Array.from({ length: ARMOR_STAND_SLOTS }, () => null),
      light: item.light,
    };
  }

  /** 只动"变了的槽"：多数帧一件都不变，这条路径应当什么都不做 */
  private syncSlots(entry: StandEntry, item: ArmorStandRenderItem): void {
    for (let slot = 0; slot < ARMOR_STAND_SLOTS; slot++) {
      const nextId = item.slots[slot] ?? null;
      const prevId = entry.slotIds[slot] ?? null;
      if (nextId === prevId && entry.light === item.light) continue;

      // 先清掉旧的
      for (const mesh of entry.meshes[slot]!) entry.group.remove(mesh);
      entry.meshes[slot] = [];
      entry.slotIds[slot] = nextId;
      if (nextId === null) continue;

      const color = armorDisplayColor(nextId);
      for (let boxIndex = 0; boxIndex < SLOT_BOXES[slot]!.length; boxIndex++) {
        const box = SLOT_BOXES[slot]![boxIndex]!;
        const geometry = this.boxGeometry(slot, boxIndex, box);
        const material = this.materialFor(color, entry.light);
        const mesh = new THREE.Mesh(geometry, material);
        // 盒子几何是以原点为中心的：平移到格子里的实际位置
        mesh.position.set(
          (box[0] + box[3]) / 2,
          (box[1] + box[4]) / 2,
          (box[2] + box[5]) / 2,
        );
        mesh.scale.set(box[3] - box[0], box[4] - box[1], box[5] - box[2]);
        entry.group.add(mesh);
        entry.meshes[slot]!.push(mesh);
      }
    }
  }

  private boxGeometry(slot: number, index: number, box: readonly number[]): THREE.BoxGeometry {
    const key = `${slot}:${index}:${box.join(',')}`;
    let geometry = this.geometries.get(key);
    if (!geometry) {
      const geometry2 = new THREE.BoxGeometry(1, 1, 1);
      // 逐面压暗：把六个面的法线方向烘进顶点色（纯白 → 乘阴影系数）
      const colors: number[] = [];
      const shades = [FACE_SHADE.px, FACE_SHADE.nx, FACE_SHADE.py, FACE_SHADE.ny, FACE_SHADE.pz, FACE_SHADE.nz];
      for (const shade of shades) {
        for (let vertex = 0; vertex < 4; vertex++) colors.push(shade, shade, shade);
      }
      geometry2.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      this.geometries.set(key, geometry2);
      geometry = geometry2;
    }
    return geometry;
  }

  /**
   * 材质：`颜色|亮度` 一份。
   *
   * 亮度按 0~15 的**整数**分档（与展示框同一个理由）：同一档光照的所有装备共用一份，
   * 于是"几百个架子"最多 6×16 个材质，而不是每件装备一个。
   */
  private materialFor(color: number, light: number): THREE.MeshBasicMaterial {
    const level = Math.max(0, Math.min(15, Math.round(light)));
    const key = `${color}|${level}`;
    let material = this.materials.get(key);
    if (!material) {
      const brightness = Math.max(MIN_BRIGHTNESS, level / 15);
      material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(brightness),
        vertexColors: true,
      });
      this.materials.set(key, material);
    }
    return material;
  }

  /** 当前画着几个架子（测试与调试用） */
  get standCount(): number {
    return this.entries.size;
  }

  /** 某个架子上画着几个盒子（测试用） */
  meshCountOf(key: string): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    return entry.meshes.reduce((sum, list) => sum + list.length, 0);
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.group.remove(entry.group);
    this.entries.clear();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }
}
