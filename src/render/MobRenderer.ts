/**
 * 生物渲染
 *
 * 用几个方块拼出生物（身体 / 头 / 四肢），风格与方块世界一致，也不需要外部模型文件：
 *  - 人形（僵尸 / 骷髅 / 苦力怕）：躯干 + 头 + 双臂 + 双腿
 *  - 四足（牛 / 猪 / 羊）：长条躯干 + 头 + 四条腿
 *  - 鸟类（鸡）：小躯干 + 头 + 喙 + 两条细腿
 *
 * 光照沿用方块那一套曲线：按生物所在位置采样天光/方块光，换算成亮度去乘基础色，
 * 因此生物进洞会变暗、站在火把旁会变亮，和地形完全一致。
 *
 * 每个生物只有一份材质（MeshBasicMaterial + 顶点色由 material.color 控制），
 * 因此调整亮度不会影响其他生物。
 */

import * as THREE from 'three';
import type { Mob } from '../core/entity/Mob.ts';
import type { MobType } from '../core/entity/Mob.ts';

type ModelKind = 'humanoid' | 'quadruped' | 'bird';

function modelKindOf(typeId: string): ModelKind {
  if (typeId === 'chicken') return 'bird';
  if (typeId === 'cow' || typeId === 'pig' || typeId === 'sheep') return 'quadruped';
  return 'humanoid';
}

interface BoxSpec {
  width: number;
  height: number;
  depth: number;
  x: number;
  y: number;
  z: number;
  color: 'body' | 'accent' | 'eye';
}

function humanoidBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const legHeight = type.height * 0.38;
  const bodyHeight = type.height * 0.34;
  const bodyY = legHeight + bodyHeight / 2;
  const headSize = w * 0.78;
  const headY = legHeight + bodyHeight + headSize / 2;
  const armLength = bodyHeight * 0.92;

  return [
    { width: w * 0.28, height: legHeight, depth: w * 0.28, x: -w * 0.24, y: legHeight / 2, z: 0, color: 'accent' },
    { width: w * 0.28, height: legHeight, depth: w * 0.28, x: w * 0.24, y: legHeight / 2, z: 0, color: 'accent' },
    { width: w, height: bodyHeight, depth: w * 0.5, x: 0, y: bodyY, z: 0, color: 'body' },
    { width: w * 0.26, height: armLength, depth: w * 0.26, x: -w * 0.62, y: bodyY, z: 0, color: 'body' },
    { width: w * 0.26, height: armLength, depth: w * 0.26, x: w * 0.62, y: bodyY, z: 0, color: 'body' },
    { width: headSize, height: headSize, depth: headSize, x: 0, y: headY, z: 0, color: 'body' },
    { width: w * 0.16, height: w * 0.1, depth: w * 0.06, x: -headSize * 0.22, y: headY + headSize * 0.1, z: headSize * 0.5, color: 'eye' },
    { width: w * 0.16, height: w * 0.1, depth: w * 0.06, x: headSize * 0.22, y: headY + headSize * 0.1, z: headSize * 0.5, color: 'eye' },
  ];
}

function quadrupedBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const legHeight = type.height * 0.36;
  const bodyHeight = type.height * 0.4;
  const bodyY = legHeight + bodyHeight / 2;
  const headSize = w * 0.48;
  const bodyLength = type.height * 0.72;

  return [
    { width: w * 0.2, height: legHeight, depth: w * 0.2, x: -w * 0.3, y: legHeight / 2, z: bodyLength * 0.32, color: 'accent' },
    { width: w * 0.2, height: legHeight, depth: w * 0.2, x: w * 0.3, y: legHeight / 2, z: bodyLength * 0.32, color: 'accent' },
    { width: w * 0.2, height: legHeight, depth: w * 0.2, x: -w * 0.3, y: legHeight / 2, z: -bodyLength * 0.32, color: 'accent' },
    { width: w * 0.2, height: legHeight, depth: w * 0.2, x: w * 0.3, y: legHeight / 2, z: -bodyLength * 0.32, color: 'accent' },
    { width: w * 0.72, height: bodyHeight, depth: bodyLength, x: 0, y: bodyY, z: 0, color: 'body' },
    { width: headSize, height: headSize, depth: headSize, x: 0, y: bodyY + bodyHeight * 0.28, z: bodyLength * 0.58, color: 'body' },
    { width: headSize * 0.3, height: headSize * 0.22, depth: headSize * 0.16, x: -headSize * 0.24, y: bodyY + bodyHeight * 0.3, z: bodyLength * 0.58 + headSize * 0.5, color: 'eye' },
    { width: headSize * 0.3, height: headSize * 0.22, depth: headSize * 0.16, x: headSize * 0.24, y: bodyY + bodyHeight * 0.3, z: bodyLength * 0.58 + headSize * 0.5, color: 'eye' },
  ];
}

function birdBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const legHeight = type.height * 0.34;
  const bodyHeight = type.height * 0.36;
  const bodyY = legHeight + bodyHeight / 2;

  return [
    { width: w * 0.18, height: legHeight, depth: w * 0.18, x: -w * 0.24, y: legHeight / 2, z: 0, color: 'accent' },
    { width: w * 0.18, height: legHeight, depth: w * 0.18, x: w * 0.24, y: legHeight / 2, z: 0, color: 'accent' },
    { width: w * 0.85, height: bodyHeight, depth: type.height * 0.5, x: 0, y: bodyY, z: 0, color: 'body' },
    { width: w * 0.5, height: w * 0.5, depth: w * 0.5, x: 0, y: bodyY + bodyHeight * 0.62, z: type.height * 0.14, color: 'body' },
    { width: w * 0.2, height: w * 0.14, depth: w * 0.3, x: 0, y: bodyY + bodyHeight * 0.58, z: type.height * 0.34, color: 'accent' },
    { width: w * 0.12, height: w * 0.12, depth: w * 0.08, x: -w * 0.14, y: bodyY + bodyHeight * 0.72, z: type.height * 0.2, color: 'eye' },
    { width: w * 0.12, height: w * 0.12, depth: w * 0.08, x: w * 0.14, y: bodyY + bodyHeight * 0.72, z: type.height * 0.2, color: 'eye' },
  ];
}

interface MobVisual {
  group: THREE.Group;
  /** 逐块材质（亮度按光照单独缩放） */
  materials: THREE.MeshBasicMaterial[];
  baseColors: readonly number[];
  /** 腿部（走路摆动用） */
  legs: THREE.Object3D[];
  colors: { body: number; accent: number };
}

export class MobRenderer {
  readonly object = new THREE.Group();

  private readonly visuals = new Map<number, MobVisual>();
  private elapsed = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly skyBrightnessOf: () => number,
  ) {
    this.scene.add(this.object);
  }

  /**
   * @param sampleLight 采样某点的天光/方块光；区块未加载时返回 null
   */
  update(
    mobs: readonly Mob[],
    camera: THREE.Camera,
    dt: number,
    sampleLight: (x: number, y: number, z: number) => { sky: number; block: number } | null,
  ): void {
    void camera;
    this.elapsed += dt;
    const skyBrightness = this.skyBrightnessOf();
    const seen = new Set<number>();

    for (const mob of mobs) {
      seen.add(mob.id);
      let visual = this.visuals.get(mob.id);
      if (!visual) {
        visual = this.createVisual(mob);
        this.visuals.set(mob.id, visual);
      }

      visual.group.position.set(mob.x, mob.y, mob.z);
      // 模型是朝 +Z 建的，而 yaw = atan2(vx, vz) 也是以 +Z 为 0，直接对应
      visual.group.rotation.y = mob.yaw;
      visual.group.visible = !mob.dead;

      // ---- 光照
      const light = sampleLight(Math.floor(mob.x), Math.floor(mob.y + mob.height * 0.5), Math.floor(mob.z));
      const sky = light ? light.sky : 15;
      const block = light ? light.block : 0;
      const level = Math.max((sky / 15) * skyBrightness, block / 15);
      const brightness = Math.max(level / (4 - 3 * level), 0.08);

      // 受击红闪
      const flash = mob.hitFlash > 0 ? Math.min(1, mob.hitFlash * 3.3) : 0;

      for (let i = 0; i < visual.materials.length; i++) {
        const material = visual.materials[i]!;
        const base = visual.baseColors[i]!;
        const r = ((base >> 16) & 0xff) * brightness;
        const g = ((base >> 8) & 0xff) * brightness;
        const b = (base & 0xff) * brightness;
        material.color.setRGB(
          Math.min(1, (r * (1 - flash) + 255 * flash) / 255),
          Math.min(1, (g * (1 - flash) + 60 * flash) / 255),
          Math.min(1, (b * (1 - flash) + 60 * flash) / 255),
        );
      }

      // ---- 走路摆腿
      const speed = Math.hypot(mob.vx, mob.vz);
      const swing = Math.sin(this.elapsed * 9) * Math.min(0.6, speed * 0.28);
      for (let i = 0; i < visual.legs.length; i++) {
        visual.legs[i]!.rotation.x = i % 2 === 0 ? swing : -swing;
      }
    }

    // 回收已经消失的生物
    for (const [id, visual] of this.visuals) {
      if (seen.has(id)) continue;
      this.object.remove(visual.group);
      for (const material of visual.materials) material.dispose();
      visual.group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
      });
      this.visuals.delete(id);
    }
  }

  private createVisual(mob: Mob): MobVisual {
    const type = mob.type;
    const kind = modelKindOf(type.id);
    const specs = kind === 'humanoid' ? humanoidBoxes(type) : kind === 'quadruped' ? quadrupedBoxes(type) : birdBoxes(type);

    const group = new THREE.Group();
    const materials: THREE.MeshBasicMaterial[] = [];
    const baseColors: number[] = [];
    const legs: THREE.Object3D[] = [];

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      const color = spec.color === 'body' ? type.bodyColor : spec.color === 'accent' ? type.accentColor : 0x14161c;
      const material = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(spec.width, spec.height, spec.depth), material);
      mesh.position.set(spec.x, spec.y, spec.z);

      // 前 2（人形）/ 前 4（四足）/ 前 2（鸟）个盒子是腿，参与摆动
      const legCount = kind === 'quadruped' ? 4 : 2;
      if (i < legCount) legs.push(mesh);

      group.add(mesh);
      materials.push(material);
      baseColors.push(color);
    }

    this.object.add(group);
    return { group, materials, baseColors, legs, colors: { body: type.bodyColor, accent: type.accentColor } };
  }

  dispose(): void {
    for (const visual of this.visuals.values()) {
      this.object.remove(visual.group);
      for (const material of visual.materials) material.dispose();
      visual.group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
      });
    }
    this.visuals.clear();
    this.scene.remove(this.object);
  }
}
