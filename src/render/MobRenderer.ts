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
import { DYE_COLORS } from '../core/registry/colors.ts';

/** 剪过毛的羊露出的贴身皮色（原版是把羊毛那层隐藏掉，我们只有一份颜色可用） */
export const SHEARED_BODY_COLOR = 0xd9c3ad;

/**
 * 一只生物身上那层该用什么颜色（导出是为了能离线断言）。
 *
 * 目前只有羊会变：
 *  - 没剪过 → 用羊毛的颜色（`DYE_COLORS[woolColor]`，默认白色，与原版 81% 白羊一致）
 *  - 剪过   → 换成贴身皮色，玩家一眼能看出"这只已经剪了"
 */
export function mobBodyColor(mob: Mob): number {
  if (!mob.type.wool) return mob.type.bodyColor;
  if (mob.sheared) return SHEARED_BODY_COLOR;
  const dye = DYE_COLORS[mob.woolColor];
  if (!dye) return mob.type.bodyColor;
  const [r, g, b] = dye.rgb;
  return (r << 16) | (g << 8) | b;
}

type ModelKind = 'humanoid' | 'quadruped' | 'bird' | 'dragon' | 'crystal';

function modelKindOf(typeId: string): ModelKind {
  if (typeId === 'ender_dragon') return 'dragon';
  if (typeId === 'end_crystal') return 'crystal';
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

/**
 * 末影龙：长条躯干 + 头 + 尾巴 + 两片大翼。
 * 前两个盒子（翼）会被当作"腿"参与摆动，但转的是 z 轴（扇翅）。
 */
function dragonBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const h = type.height;
  return [
    // 两片翼（索引 0、1 → 扇翅用）
    { width: w * 1.5, height: h * 0.08, depth: h * 0.7, x: -w * 0.85, y: h * 0.55, z: -h * 0.1, color: 'accent' },
    { width: w * 1.5, height: h * 0.08, depth: h * 0.7, x: w * 0.85, y: h * 0.55, z: -h * 0.1, color: 'accent' },
    // 躯干
    { width: w * 0.75, height: h * 0.55, depth: h * 1.5, x: 0, y: h * 0.5, z: 0, color: 'body' },
    // 颈与头
    { width: w * 0.34, height: h * 0.3, depth: h * 0.5, x: 0, y: h * 0.66, z: h * 0.85, color: 'body' },
    { width: w * 0.42, height: h * 0.36, depth: h * 0.5, x: 0, y: h * 0.7, z: h * 1.2, color: 'body' },
    // 双眼
    { width: w * 0.11, height: h * 0.09, depth: h * 0.06, x: -w * 0.13, y: h * 0.78, z: h * 1.42, color: 'eye' },
    { width: w * 0.11, height: h * 0.09, depth: h * 0.06, x: w * 0.13, y: h * 0.78, z: h * 1.42, color: 'eye' },
    // 尾巴（两段，越往后越细）
    { width: w * 0.3, height: h * 0.26, depth: h * 0.7, x: 0, y: h * 0.5, z: -h * 0.9, color: 'body' },
    { width: w * 0.16, height: h * 0.16, depth: h * 0.6, x: 0, y: h * 0.5, z: -h * 1.5, color: 'accent' },
  ];
}

/** 末地水晶：一块悬浮的发光方块 + 上下两个尖角 */
function crystalBoxes(): BoxSpec[] {
  return [
    { width: 0.9, height: 0.9, depth: 0.9, x: 0, y: 0.5, z: 0, color: 'accent' },
    { width: 0.45, height: 0.45, depth: 0.45, x: 0, y: 1.15, z: 0, color: 'body' },
    { width: 0.45, height: 0.45, depth: 0.45, x: 0, y: -0.15, z: 0, color: 'body' },
  ];
}

interface MobVisual {
  kind: ModelKind;
  specs: readonly BoxSpec[];
  /** 参与摆动的部件数量（人形/鸟/龙的翅膀是前 2 个，四足是前 4 个） */
  legCount: number;
  /** 水晶这类自转物体的旋转角：实例化后没有自己的 Object3D，需要在这里累加 */
  spin: number;
  /** 逐部件颜色（0xRRGGBB，预解析好避免每帧重算） */
  partColors: Uint32Array;
  /** 生成这份规格时羊剪没剪（变了就整份重建，见 `update`） */
  sheared?: boolean;
}

/** 实例容量：约 64 只生物 × 最多 16 个部件。超出会被截断并打印一次警告 */
const MAX_PARTS = 1024;

export class MobRenderer {
  readonly object = new THREE.Group();

  private readonly visuals = new Map<number, MobVisual>();
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly geometry: THREE.BoxGeometry;
  /** 逐实例变换用：root 承载"生物的位置与朝向"，part 承载"部件的偏移与旋转" */
  private readonly rootDummy = new THREE.Object3D();
  private readonly partDummy = new THREE.Object3D();
  private readonly scratchColor = new THREE.Color();
  private elapsed = 0;
  /** 上一帧实际用到的实例数（调试与验收用） */
  usedInstances = 0;
  private warnedOverflow = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly skyBrightnessOf: () => number,
  ) {
    this.scene.add(this.object);

    // **实例化渲染（K6）**：所有生物的**所有部件**合并成一个 InstancedMesh。
    // 改造前每只生物是一个 Group、每个部件一个 Mesh（各自一个材质），
    // 一只僵尸 6~8 次 draw call，20 只生物就是 120+ 次提交；现在整场只占 1 次。
    //   · 几何统一 1×1×1 方块，尺寸靠实例矩阵的缩放
    //   · 颜色（含光照衰减与受击红闪）写进 instanceColor，逐实例生效
    //   · 走路摆腿/龙扇翅通过逐实例的旋转实现
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshBasicMaterial();
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_PARTS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTS * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // 实例矩阵每帧都在动，交给 three 做整体视锥剔除意义不大，关掉省一次遍历
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.object.add(this.mesh);

    // part 是 root 的子节点：updateWorldMatrix 会自动把"生物的位置与朝向"
    // 叠到"部件的偏移与旋转"上，不必手写矩阵乘法
    this.rootDummy.add(this.partDummy);
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
    let instance = 0;

    for (const mob of mobs) {
      seen.add(mob.id);
      if (mob.dead) continue;

      let visual = this.visuals.get(mob.id);
      // 羊毛剪了/长回来了：颜色是在 `createVisual` 里定死的，所以整份规格重建一次。
      // 只对"身体颜色会变"的生物（羊）做这件事，别的生物不受影响。
      if (visual && mob.type.wool && visual.sheared !== mob.sheared) {
        this.visuals.delete(mob.id);
        visual = undefined;
      }
      if (!visual) {
        visual = this.createVisual(mob);
        visual.sheared = mob.sheared;
        this.visuals.set(mob.id, visual);
      }

      // ---- 生物本体的变换
      this.rootDummy.position.set(mob.x, mob.y, mob.z);
      this.rootDummy.rotation.set(0, mob.yaw, 0);
      this.rootDummy.updateMatrix();

      // ---- 光照与受击红闪
      const light = sampleLight(Math.floor(mob.x), Math.floor(mob.y + mob.height * 0.5), Math.floor(mob.z));
      const sky = light ? light.sky : 15;
      const block = light ? light.block : 0;
      const level = Math.max((sky / 15) * skyBrightness, block / 15);
      const brightness = Math.max(level / (4 - 3 * level), 0.08);
      const flash = mob.hitFlash > 0 ? Math.min(1, mob.hitFlash * 3.3) : 0;

      // ---- 摆动量
      let legSwing = 0;
      let flap = 0;
      if (visual.kind === 'dragon') {
        const speed = Math.hypot(mob.vx, mob.vz);
        flap = Math.sin(this.elapsed * (5 + speed * 0.15)) * 0.55;
      } else if (visual.kind === 'crystal') {
        visual.spin += dt * 0.8;
      } else {
        const speed = Math.hypot(mob.vx, mob.vz);
        legSwing = Math.sin(this.elapsed * 9) * Math.min(0.6, speed * 0.28);
      }

      for (let i = 0; i < visual.specs.length; i++) {
        if (instance >= MAX_PARTS) {
          if (!this.warnedOverflow) {
            console.warn(`[mob] 部件实例数超过上限 ${MAX_PARTS}，多余的生物不会被渲染`);
            this.warnedOverflow = true;
          }
          break;
        }
        const spec = visual.specs[i]!;

        this.partDummy.position.set(spec.x, spec.y, spec.z);
        this.partDummy.scale.set(spec.width, spec.height, spec.depth);
        let rotX = 0;
        let rotY = 0;
        let rotZ = 0;
        if (visual.kind === 'crystal') rotY = visual.spin;
        else if (i < visual.legCount) {
          if (visual.kind === 'dragon') rotZ = i % 2 === 0 ? flap : -flap;
          else rotX = i % 2 === 0 ? legSwing : -legSwing;
        }
        this.partDummy.rotation.set(rotX, rotY, rotZ);
        this.partDummy.updateMatrix();
        this.partDummy.updateWorldMatrix(true, false);
        this.mesh.setMatrixAt(instance, this.partDummy.matrixWorld);

        // 逐实例颜色：基色 × 亮度，再按受击比例推向红
        const base = visual.partColors[i]!;
        const r = ((base >> 16) & 0xff) * brightness;
        const g = ((base >> 8) & 0xff) * brightness;
        const b = (base & 0xff) * brightness;
        this.scratchColor.setRGB(
          Math.min(1, (r * (1 - flash) + 255 * flash) / 255),
          Math.min(1, (g * (1 - flash) + 60 * flash) / 255),
          Math.min(1, (b * (1 - flash) + 60 * flash) / 255),
        );
        this.mesh.setColorAt(instance, this.scratchColor);
        instance++;
      }
    }

    this.usedInstances = instance;
    this.mesh.count = instance;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    // 回收消失的生物：实例化后没有 GPU 资源要销毁，丢掉规格表即可
    for (const id of [...this.visuals.keys()]) {
      if (!seen.has(id)) this.visuals.delete(id);
    }
  }

  private createVisual(mob: Mob): MobVisual {
    const type = mob.type;
    const kind = modelKindOf(type.id);
    const specs =
      kind === 'dragon'
        ? dragonBoxes(type)
        : kind === 'crystal'
          ? crystalBoxes()
          : kind === 'humanoid'
            ? humanoidBoxes(type)
            : kind === 'quadruped'
              ? quadrupedBoxes(type)
              : birdBoxes(type);

    const partColors = new Uint32Array(specs.length);
    const bodyColor = mobBodyColor(mob);
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      partColors[i] = spec.color === 'body' ? bodyColor : spec.color === 'accent' ? type.accentColor : 0x14161c;
    }

    return {
      kind,
      // 记下"生成这份规格时羊剪没剪"（见 update 里的重建判定）
      sheared: mob.sheared,
      specs,
      legCount: kind === 'quadruped' ? 4 : kind === 'crystal' ? 0 : 2,
      spin: 0,
      partColors,
    };
  }

  dispose(): void {
    this.visuals.clear();
    this.scene.remove(this.object);
    this.object.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
