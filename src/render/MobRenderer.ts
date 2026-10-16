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
import { BABY_SCALE, type Mob } from '../core/entity/Mob.ts';
import type { MobType } from '../core/entity/Mob.ts';
import { Villager } from '../core/entity/Villager.ts';
import { DYE_COLORS } from '../core/registry/colors.ts';
import { VILLAGER_IDLE_ROBE, VILLAGER_SKIN_COLOR } from '../core/registry/villagerTrades.ts';

/** 剪过毛的羊露出的贴身皮色（原版是把羊毛那层隐藏掉，我们只有一份颜色可用） */
export const SHEARED_BODY_COLOR = 0xd9c3ad;

/**
 * 一只生物身上那层该用什么颜色（导出是为了能离线断言）。
 *
 * 两种生物会变：
 *  - **羊**：没剪过 → 用羊毛的颜色（`DYE_COLORS[woolColor]`，默认白色，与原版 81% 白羊一致）；
 *    剪过 → 换成贴身皮色，玩家一眼能看出"这只已经剪了"
 *  - **村民**（J11）：主色是**皮肤**（头与手），长袍的颜色走 `mobAccentColor`
 *    （认领职业后换成职业色）
 */
export function mobBodyColor(mob: Mob): number {
  if (mob instanceof Villager) return VILLAGER_SKIN_COLOR;
  if (!mob.type.wool) return mob.type.bodyColor;
  if (mob.sheared) return SHEARED_BODY_COLOR;
  const dye = DYE_COLORS[mob.woolColor];
  if (!dye) return mob.type.bodyColor;
  const [r, g, b] = dye.rgb;
  return (r << 16) | (g << 8) | b;
}

/**
 * 点缀色（村民的长袍、羊与牛的角/腿色都在这儿）。
 *
 * 村民是唯一**会随状态变化**的一处：无业是褐色外衣，认领了工作站就换成职业色
 * ——站在村里一眼能认出谁是农民、谁是牧师（原版靠衣服 + 徽章，我们只有颜色）。
 */
export function mobAccentColor(mob: Mob): number {
  if (mob instanceof Villager) return mob.profession?.robeColor ?? VILLAGER_IDLE_ROBE;
  return mob.type.accentColor;
}

/**
 * 外观版本（变了就重建模型）。
 *
 * 羊是"剪没剪"、村民是"哪个职业"——这都是**同一只生物身上的状态**，
 * 而模型的颜色是在 `createVisual` 里定死的。不收成一个字符串的话，
 * 加第二种"会变色的生物"就得再写一处 if（本项目的坑之一）。
 */
export function mobAppearanceKey(mob: Mob): string {
  if (mob.type.wool) return mob.sheared ? 'sheared' : 'woolly';
  if (mob instanceof Villager) return mob.appearanceKey;
  return '';
}

type ModelKind = 'humanoid' | 'quadruped' | 'bird' | 'dragon' | 'crystal' | 'villager' | 'blaze' | 'spider' | 'ghast';

function modelKindOf(typeId: string): ModelKind {
  if (typeId === 'ender_dragon') return 'dragon';
  if (typeId === 'end_crystal') return 'crystal';
  if (typeId === 'blaze') return 'blaze';
  if (typeId === 'villager') return 'villager';
  if (typeId === 'spider' || typeId === 'cave_spider') return 'spider';
  if (typeId === 'ghast') return 'ghast';
  if (typeId === 'chicken') return 'bird';
  if (typeId === 'cow' || typeId === 'pig' || typeId === 'sheep') return 'quadruped';
  return 'humanoid';
}

/**
 * 按模型种类取部件表。
 *
 * 原先这里是**一串嵌套三元**：加第三种模型时就已经要数括号了，加烈焰人（第五种）
 * 时干脆换成一个 switch——**"再往里塞一层三元"是这类代码开始出错的地方**。
 */
function modelBoxes(kind: ModelKind, type: MobType): BoxSpec[] {
  switch (kind) {
    case 'dragon':
      return dragonBoxes(type);
    case 'crystal':
      return crystalBoxes();
    case 'blaze':
      return blazeBoxes(type);
    case 'villager':
      return villagerBoxes(type);
    case 'quadruped':
      return quadrupedBoxes(type);
    case 'bird':
      return birdBoxes(type);
    case 'spider':
      return spiderBoxes(type);
    case 'ghast':
      return ghastBoxes(type);
    default:
      return humanoidBoxes(type);
  }
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

/**
 * 村民（J11，批次 88）：人形 + **大鼻子** + **抱在胸前的双臂**。
 *
 * 这两处是"一眼认出这是村民"的关键（原版那个 8×10×8 的脑袋上最显眼的就是鼻子）。
 * 颜色分工：`body` = 皮肤（头/手/鼻子）、`accent` = 长袍（躯干/腿/袖口）——
 * 长袍色按职业换，见 `mobAccentColor`。
 */
function villagerBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const legHeight = type.height * 0.42;
  const bodyHeight = type.height * 0.36;
  const bodyY = legHeight + bodyHeight / 2;
  const headSize = w * 0.82;
  const headY = legHeight + bodyHeight + headSize / 2;

  return [
    // 两条腿（长袍下摆）
    { width: w * 0.3, height: legHeight, depth: w * 0.3, x: -w * 0.22, y: legHeight / 2, z: 0, color: 'accent' },
    { width: w * 0.3, height: legHeight, depth: w * 0.3, x: w * 0.22, y: legHeight / 2, z: 0, color: 'accent' },
    // 躯干
    { width: w, height: bodyHeight, depth: w * 0.5, x: 0, y: bodyY, z: 0, color: 'accent' },
    // 抱在胸前的一条胳膊（原版村民双手交叠；做成一根横在胸前的方块最省事也最像）
    { width: w * 0.92, height: w * 0.16, depth: w * 0.22, x: 0, y: bodyY + bodyHeight * 0.12, z: w * 0.34, color: 'accent' },
    // 头（皮肤色）
    { width: headSize, height: headSize, depth: headSize * 0.92, x: 0, y: headY, z: 0, color: 'body' },
    // 大鼻子：贴在脸的正中间、往前伸
    { width: w * 0.22, height: w * 0.3, depth: w * 0.26, x: 0, y: headY - headSize * 0.04, z: headSize * 0.5, color: 'body' },
    // 双眼（在鼻子两侧）
    { width: w * 0.14, height: w * 0.09, depth: w * 0.06, x: -headSize * 0.26, y: headY + headSize * 0.14, z: headSize * 0.48, color: 'eye' },
    { width: w * 0.14, height: w * 0.09, depth: w * 0.06, x: headSize * 0.26, y: headY + headSize * 0.14, z: headSize * 0.48, color: 'eye' },
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

/**
 * 烈焰人（批次 92）：**一颗悬空的脑袋 + 底下一圈旋转的火棒**。
 *
 * 那圈棒子是它一眼可辨的特征（原版是 8 根，绕一圈一边转一边烧）。
 * 这里画 8 根静态的：渲染器目前只有"摆腿/扇翅"两种逐部件动画
 * （见 `MobRenderer.update` 的 `legCount` 那一段），给某一种生物加"绕轴自转"
 * 要走一套新的动画通道——留给以后需要时再加（差异记在 TASKS J26）。
 */
function blazeBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const h = type.height;
  const box: BoxSpec[] = [
    // 脑袋（原版那颗方方的"火头"）
    { width: w * 0.85, height: w * 0.85, depth: w * 0.85, x: 0, y: h * 0.62, z: 0, color: 'body' },
    // 两只眼睛
    { width: w * 0.16, height: w * 0.12, depth: w * 0.06, x: -w * 0.2, y: h * 0.66, z: w * 0.45, color: 'eye' },
    { width: w * 0.16, height: w * 0.12, depth: w * 0.06, x: w * 0.2, y: h * 0.66, z: w * 0.45, color: 'eye' },
  ];
  // 底下一圈 8 根火棒（半径 w*0.38，长短交错，看着像在烧）
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const radius = w * 0.38;
    const long = i % 2 === 0;
    box.push({
      width: w * 0.13,
      height: long ? h * 0.3 : h * 0.22,
      depth: w * 0.13,
      x: Math.cos(angle) * radius,
      y: h * 0.26,
      z: Math.sin(angle) * radius,
      color: long ? 'body' : 'accent',
    });
  }
  return box;
}

/** 末地水晶：一块悬浮的发光方块 + 上下两个尖角 */
function crystalBoxes(): BoxSpec[] {
  return [
    { width: 0.9, height: 0.9, depth: 0.9, x: 0, y: 0.5, z: 0, color: 'accent' },
    { width: 0.45, height: 0.45, depth: 0.45, x: 0, y: 1.15, z: 0, color: 'body' },
    { width: 0.45, height: 0.45, depth: 0.45, x: 0, y: -0.15, z: 0, color: 'body' },
  ];
}

/**
 * 蜘蛛（批次 93）：**八条腿** + 两段身体 + 一颗小头 + 四只眼。
 *
 * ⚠️ 腿必须排在**最前面**：渲染器只认\"前 N 个部件参与摆动\"（`legCount`），
 * 而且按 `i % 2` 交替相位——八条腿照这个规则动起来正好是那种"左右交替扒地"
 * 的爬行感（相邻腿反相）。所以这张表是 [8 条腿, 胸口, 肚子, 头, 4 只眼]，
 * 一共 15 个部件（实例容量按 64 只 × 16 个部件算的，够用）。
 *
 * 尺寸全部由 `type.width/height` 推出来，所以洞穴蜘蛛（0.7 × 0.5）
 * 不用另写一份模型就会自动变小。
 */
function spiderBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const h = type.height;
  const legHeight = h * 0.5;
  const bodyY = legHeight * 0.9;
  const boxes: BoxSpec[] = [];

  // 八条腿：每侧四条，前后排开（z 从 +0.34 到 -0.34 倍体长）
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const row = Math.floor(i / 2); // 0..3：从前往后
    boxes.push({
      width: w * 0.1,
      height: legHeight,
      depth: w * 0.09,
      x: side * w * 0.42,
      y: legHeight / 2,
      z: (0.34 - row * 0.22) * h,
      color: 'accent',
    });
  }

  // 胸口（比肚子小一圈）+ 肚子（蜘蛛最显眼的那一块）
  boxes.push({ width: w * 0.5, height: h * 0.5, depth: h * 0.62, x: 0, y: bodyY, z: h * 0.16, color: 'body' });
  boxes.push({ width: w * 0.66, height: h * 0.6, depth: h * 0.8, x: 0, y: bodyY, z: -h * 0.3, color: 'body' });
  // 头 + 四只眼（原版是 8 只，这个尺度下 4 只就够辨认了）
  boxes.push({ width: w * 0.34, height: h * 0.36, depth: h * 0.34, x: 0, y: bodyY + h * 0.04, z: h * 0.62, color: 'body' });
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const up = i < 2 ? 0 : 1;
    boxes.push({
      width: w * 0.07,
      height: h * 0.07,
      depth: h * 0.04,
      x: side * w * 0.08,
      y: bodyY + h * 0.04 + up * h * 0.09,
      z: h * 0.79,
      color: 'eye',
    });
  }
  return boxes;
}

/**
 * 一个模型里有几个部件参与"走路摆动/扇翅"。
 *
 * 收成一个函数（而不是在 `createVisual` 里写一串三元）：批次 92/93 连着加了
 * 烈焰人（0）与蜘蛛（8），那段表达式已经长到一眼看不完；
 * 而且它是**可断言的事实**，离线测试直接读它（见 `describeMobModel`）。
 */
function legCountOf(kind: ModelKind): number {
  if (kind === 'quadruped') return 4;
  if (kind === 'spider') return 8;
  // 水晶/烈焰人/恶魂不摆动：水晶自转、烈焰人的火棒长在它自己身上、
  // 恶魂那九条触手是垂直挂着的（按 `i % 2` 前后摆反而会像在走路）
  if (kind === 'crystal' || kind === 'blaze' || kind === 'ghast') return 0;
  return 2;
}

/**
 * 生物模型的"最小描述"（批次 93）：**骨架种类 / 部件数 / 摆动部件数**。
 *
 * 给离线测试用（与 `mobAppearanceKey` / `mobBodyColor` 同一个性质：
 * 渲染器里能离线验的就是这些）——蜘蛛那"8 条腿"、"腿排在部件表最前面"
 * 这两个约定最容易在改动里被破坏，而破坏了**看不出来**（腿还是会动，只是动错了）。
 */
export function describeMobModel(type: MobType): { kind: ModelKind; parts: number; legs: number } {
  const kind = modelKindOf(type.id);
  return { kind, parts: modelBoxes(kind, type).length, legs: legCountOf(kind) };
}

/**
 * 恶魂（批次 94）：**一个大方盒 + 九条垂下来的触手**，全是白的。
 *
 * 那九条触手（3×3 排）是它一眼可辨的特征；脸上是"两条浓眉 + 两只眼"
 * ——原版那张脸有点凶，别画成一双圆眼睛（那就成了雪人）。
 *
 * ⚠️ 所有部件都落在 `0..height` 之内（触手挂到脚底以上）：
 * 挂到脚底以下的话，它会看起来"悬空在海面下"，而碰撞盒只有 4 格高。
 */
function ghastBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const h = type.height;
  const bodyBottom = h * 0.36;
  const bodyHeight = h - bodyBottom;
  const boxes: BoxSpec[] = [
    { width: w, height: bodyHeight, depth: w, x: 0, y: bodyBottom + bodyHeight / 2, z: 0, color: 'body' },
    // 两条浓眉（原版的表情就靠它）
    { width: w * 0.34, height: h * 0.05, depth: h * 0.04, x: -w * 0.19, y: bodyBottom + bodyHeight * 0.72, z: w * 0.5, color: 'eye' },
    { width: w * 0.34, height: h * 0.05, depth: h * 0.04, x: w * 0.19, y: bodyBottom + bodyHeight * 0.72, z: w * 0.5, color: 'eye' },
    // 眼睛（在眉毛下面一点点）
    { width: w * 0.13, height: h * 0.1, depth: h * 0.04, x: -w * 0.19, y: bodyBottom + bodyHeight * 0.56, z: w * 0.5, color: 'eye' },
    { width: w * 0.13, height: h * 0.1, depth: h * 0.04, x: w * 0.19, y: bodyBottom + bodyHeight * 0.56, z: w * 0.5, color: 'eye' },
  ];
  // 九条触手：3×3 排布挂在身体底面（原版正是 9 条）
  const tentacleHeight = h * 0.4;
  for (let i = 0; i < 9; i++) {
    const col = (i % 3) - 1;
    const row = Math.floor(i / 3) - 1;
    boxes.push({
      width: w * 0.2,
      height: tentacleHeight,
      depth: w * 0.2,
      x: col * w * 0.3,
      y: h * 0.18,
      z: row * w * 0.3,
      color: 'accent',
    });
  }
  return boxes;
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
  /** 生成这份规格时的"外观版本"（羊剪没剪 / 村民是哪个职业，见 `mobAppearanceKey`） */
  appearance?: string;
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
      // 外观变了（羊毛剪了/长回来了、村民认领了职业）就整份重建一次：
      // 颜色是在 `createVisual` 里定死的，不重建就会"剪了毛还是那只白羊"
      const appearance = mobAppearanceKey(mob);
      if (visual && visual.appearance !== appearance) {
        this.visuals.delete(mob.id);
        visual = undefined;
      }
      if (!visual) {
        visual = this.createVisual(mob);
        visual.appearance = appearance;
        this.visuals.set(mob.id, visual);
      }

      // ---- 生物本体的变换
      // 幼体整体缩小（部件坐标是绝对尺寸，缩放根节点等于"以脚为原点等比缩小"）
      const scale = mob.baby ? BABY_SCALE : 1;
      this.rootDummy.position.set(mob.x, mob.y, mob.z);
      this.rootDummy.rotation.set(0, mob.yaw, 0);
      this.rootDummy.scale.setScalar(scale);
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
    const specs = modelBoxes(kind, type);

    const partColors = new Uint32Array(specs.length);
    // ⚠️ 主色与点缀色都走函数（不是 `type.bodyColor`）：羊的毛色与村民的长袍色
    // 都是**跟着状态变**的，直接读种类表就会永远是默认那一份
    const bodyColor = mobBodyColor(mob);
    const accentColor = mobAccentColor(mob);
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      // `eye`：默认那份近黑色，除非这种生物自带 `eyeColor`
      // （批次 112 末影人：全身纯黑，眼睛是它唯一的辨识点）
      partColors[i] =
        spec.color === 'body'
          ? bodyColor
          : spec.color === 'accent'
            ? accentColor
            : (type.eyeColor ?? 0x14161c);
    }

    return {
      kind,
      // 记下"生成这份规格时的外观版本"（见 update 里的重建判定）
      appearance: mobAppearanceKey(mob),
      specs,
      // 参与"走路摆动/扇翅"的部件数（规则收在 `legCountOf` 里）
      legCount: legCountOf(kind),
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
