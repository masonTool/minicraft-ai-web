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
  // 驯养系（批次 242）：项圈的颜色跟着"驯没驯服"变 → 驯服那一刻要重建一次模型
  if (mob.type.tameWith !== undefined) return mob.tamed ? 'tamed' : 'wild';
  return '';
}

type ModelKind =
  | 'humanoid'
  | 'quadruped'
  | 'bird'
  | 'dragon'
  | 'crystal'
  | 'villager'
  | 'blaze'
  | 'spider'
  | 'ghast'
  | 'wither'
  /** 史莱姆（批次 120）：一个果冻方块 + 里面那颗核 */
  | 'slime'
  /** 幻翼（批次 126）：扁身子 + 两片长翼 + 尾巴 */
  | 'phantom'
  /** 鱿鱼（批次 189）：一个圆头 + 八条垂下来的触手 */
  | 'squid'
  /** 驯养系（批次 242）：狼 / 猫 / 豹猫 / 狐狸——短腿、尖耳、翘尾巴、脖子上有项圈 */
  | 'pet'
  /** 骑乘系（批次 253）：马/驴/骡/羊驼——长腿、长身、长脖子 */
  | 'horse'
  /** 水生（批次 259）：鳕鱼 / 鲑鱼 / 海豚——一个纺锤形身体 + 尾鳍 + 背鳍 */
  | 'fish'
  /** 海龟（批次 260）：扁平的壳 + 探出来的头 + 四只鳍足 */
  | 'turtle'
  /** 蝙蝠（批次 261）：一小团身体 + 两片张开的翅膀 + 尖耳 */
  | 'bat';

function modelKindOf(typeId: string): ModelKind {
  if (typeId === 'ender_dragon') return 'dragon';
  // 凋灵（批次 116）：三颗头 + 肋骨笼，与任何现有骨架都不同
  if (typeId === 'wither') return 'wither';
  // 幻翼（批次 126）：扁平的飞行生物，与鸟（鸡）那种"小圆身子"差得远
  if (typeId === 'phantom') return 'phantom';
  // 鱿鱼（批次 189）：圆头 + 触手，与任何现有骨架都不同
  if (typeId === 'squid') return 'squid';
  // 史莱姆（批次 120）：三档尺寸都是"果冻方块 + 内核"，所以三者的 id 共用一个骨架。
  // 岩浆怪（批次 121）也走这一个：原版它们的几何**一模一样**，区别只在贴图与颜色
  // （深红外壳 + 亮橙内核），所以没必要再开一个骨架
  if (
    typeId === 'slime' ||
    typeId === 'slime_big' ||
    typeId === 'slime_small' ||
    typeId === 'magma_cube' ||
    typeId === 'magma_cube_big' ||
    typeId === 'magma_cube_small'
  ) {
    return 'slime';
  }
  if (typeId === 'end_crystal') return 'crystal';
  if (typeId === 'blaze') return 'blaze';
  if (typeId === 'villager') return 'villager';
  if (typeId === 'spider' || typeId === 'cave_spider') return 'spider';
  if (typeId === 'ghast') return 'ghast';
  if (typeId === 'chicken') return 'bird';
  // 驯养系（批次 242）：牛猪羊那套四足太"壮"（大鼻子、没有尾巴），
  // 狼/猫/豹猫/狐狸需要一个更小的骨架 + 尖耳 + 翘尾
  if (typeId === 'wolf' || typeId === 'cat' || typeId === 'ocelot' || typeId === 'fox') return 'pet';
  if (typeId === 'horse' || typeId === 'donkey' || typeId === 'mule' || typeId === 'llama') return 'horse';
  if (typeId === 'cod' || typeId === 'salmon' || typeId === 'dolphin') return 'fish';
  // 兔子（批次 259）：小体型 + 尖耳，直接复用 `pet` 那副骨架（比四足更像兔子）
  if (typeId === 'rabbit') return 'pet';
  // 熊猫/北极熊（批次 260）：四足；美西螈沿用鱼形（它是水生、有尾）
  if (typeId === 'panda' || typeId === 'polar_bear') return 'quadruped';
  if (typeId === 'axolotl') return 'fish';
  if (typeId === 'turtle') return 'turtle';
  if (typeId === 'bat') return 'bat';
  // 山羊（批次 259）：四足，角暂时用 accent 色的头顶部件代替（`quadruped` 自带鼻吻）
  if (typeId === 'goat') return 'quadruped';
  if (typeId === 'cow' || typeId === 'pig' || typeId === 'sheep') return 'quadruped';
  // 疣猪兽（批次 344）：四足、体型宽
  if (typeId === 'hoglin') return 'quadruped';
  // 蠹虫（批次 344）：借蜘蛛那套"多腿小身体"骨架
  if (typeId === 'silverfish') return 'spider';
  // 炽足兽（批次 344）：长腿四足
  if (typeId === 'strider') return 'quadruped';
  // 潜影贝（批次 344）：暂用四足骨架占位（没有方块型生物骨架）
  if (typeId === 'shulker') return 'quadruped';
  if (typeId === 'bee') return 'bird';
  if (typeId === 'parrot') return 'bird';
  if (typeId === 'mooshroom') return 'quadruped';
  if (typeId === 'endermite') return 'spider';
  if (typeId === 'ravager') return 'quadruped';
  if (typeId === 'vex') return 'bird';
  if (typeId === 'wandering_trader') return 'villager';
  if (typeId === 'trader_llama') return 'quadruped';
  // 守卫者（批次 359）：借鱼那套流线骨架
  if (typeId === 'guardian' || typeId === 'elder_guardian') return 'fish';
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
    case 'pet':
      return petBoxes(type);
    case 'horse':
      return horseBoxes(type);
    case 'fish':
      return fishBoxes(type);
    case 'turtle':
      return turtleBoxes(type);
    case 'bat':
      return batBoxes(type);
    case 'bird':
      return birdBoxes(type);
    case 'spider':
      return spiderBoxes(type);
    case 'ghast':
      return ghastBoxes(type);
    case 'slime':
      return slimeBoxes(type);
    case 'wither':
      return witherBoxes(type);
    case 'phantom':
      return phantomBoxes(type);
    case 'squid':
      return squidBoxes(type);
    default:
      return humanoidBoxes(type);
  }
}

/**
 * 凋灵（批次 116）：**三颗头 + 一副肋骨笼**。
 *
 * 三颗头是它一眼可辨的特征（原版中间那颗稍大），肋骨笼用三根横向的骨条表示——
 * 与恶魂那九条触手同一个做法：**用几个盒子把"这是什么"说清楚**，
 * 而不是去追原版的模型零件（本项目所有的生物都是这样）。
 *
 * ⚠️ 所有部件都落在 `0..height` 之内（与恶魂那条一样：挂出去会看起来悬空）。
 */
function witherBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const h = type.height;
  // 三颗头并排在最上面（中间那颗大一点）
  const headY = h - w * 0.42;
  const headSize = w * 0.46;
  const boxes: BoxSpec[] = [
    { width: headSize, height: headSize, depth: headSize, x: 0, y: headY, z: 0, color: 'body' },
    {
      width: headSize * 0.86,
      height: headSize * 0.86,
      depth: headSize * 0.86,
      x: -w * 0.52,
      y: headY - headSize * 0.08,
      z: 0,
      color: 'body',
    },
    {
      width: headSize * 0.86,
      height: headSize * 0.86,
      depth: headSize * 0.86,
      x: w * 0.52,
      y: headY - headSize * 0.08,
      z: 0,
      color: 'body',
    },
  ];
  // 每颗头一对眼睛（暗红，纯黑身上唯一的辨识点）
  for (const [ox, oy, size] of [
    [0, headY, headSize],
    [-w * 0.52, headY - headSize * 0.08, headSize * 0.86],
    [w * 0.52, headY - headSize * 0.08, headSize * 0.86],
  ] as const) {
    for (const sx of [-1, 1] as const) {
      boxes.push({
        width: size * 0.22,
        height: size * 0.16,
        depth: size * 0.1,
        x: ox + sx * size * 0.2,
        y: oy + size * 0.05,
        z: size * 0.46,
        color: 'eye',
      });
    }
  }
  // 肋骨笼：三根横向的骨条 + 中间那根脊骨
  const ribY = h * 0.34;
  const ribSpan = w * 1.25;
  for (let i = 0; i < 3; i++) {
    boxes.push({
      width: ribSpan,
      height: h * 0.07,
      depth: w * 0.42,
      x: 0,
      y: ribY + i * h * 0.13,
      z: 0,
      color: 'accent',
    });
  }
  boxes.push({
    width: w * 0.2,
    height: h * 0.42,
    depth: w * 0.2,
    x: 0,
    y: h * 0.32,
    z: 0,
    color: 'body',
  });
  return boxes;
}

interface BoxSpec {
  width: number;
  height: number;
  depth: number;
  x: number;
  y: number;
  z: number;
  /**
   * 颜色角色（批次 242 加了 `collar`）：
   *  - `collar` 是宠物脖子上的项圈——**没驯服时会被涂成身体色**（等于看不见），
   *    驯服之后才变成红色。这样模型表不必按"驯没驯服"分两份。
   */
  color: 'body' | 'accent' | 'eye' | 'collar';
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

/**
 * 驯养系（批次 242）：狼 / 猫 / 豹猫 / 狐狸共用的一副小骨架。
 *
 * 与 `quadrupedBoxes`（牛猪羊）的区别：腿更短、身子更细长、**有尖耳与翘尾巴**，
 * 头上没有那个"大鼻子"。前四个盒子仍是腿（`legCountOf` 固定 4，
 * 走路摆动只认部件表最前面那几个）。
 *
 * 最后一个是**项圈**：颜色角色 `collar`，没驯服时由 `createVisual` 涂成身体色
 * （等于看不见），驯服后才显红——一张表同时管两种状态。
 */
function petBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const h = type.height;
  const legHeight = h * 0.32;
  const bodyHeight = h * 0.36;
  const bodyY = legHeight + bodyHeight / 2;
  const bodyLength = h * 0.78;
  const headSize = w * 0.56;
  const headY = bodyY + bodyHeight * 0.28;
  const headZ = bodyLength * 0.52;
  const legX = w * 0.28;
  const legZ = bodyLength * 0.3;

  return [
    // 四条腿（下标 0~3）
    { width: w * 0.16, height: legHeight, depth: w * 0.16, x: -legX, y: legHeight / 2, z: legZ, color: 'accent' },
    { width: w * 0.16, height: legHeight, depth: w * 0.16, x: legX, y: legHeight / 2, z: legZ, color: 'accent' },
    { width: w * 0.16, height: legHeight, depth: w * 0.16, x: -legX, y: legHeight / 2, z: -legZ, color: 'accent' },
    { width: w * 0.16, height: legHeight, depth: w * 0.16, x: legX, y: legHeight / 2, z: -legZ, color: 'accent' },
    // 躯干
    { width: w * 0.58, height: bodyHeight, depth: bodyLength, x: 0, y: bodyY, z: 0, color: 'body' },
    // 头 + 吻部（不像牛那样一个大鼻子，只有嘴前一截）
    { width: headSize, height: headSize, depth: headSize * 0.92, x: 0, y: headY, z: headZ, color: 'body' },
    { width: headSize * 0.4, height: headSize * 0.3, depth: headSize * 0.34, x: 0, y: headY - headSize * 0.08, z: headZ + headSize * 0.5, color: 'accent' },
    // 尖耳
    { width: headSize * 0.2, height: headSize * 0.34, depth: headSize * 0.16, x: -headSize * 0.3, y: headY + headSize * 0.52, z: headZ - headSize * 0.05, color: 'accent' },
    { width: headSize * 0.2, height: headSize * 0.34, depth: headSize * 0.16, x: headSize * 0.3, y: headY + headSize * 0.52, z: headZ - headSize * 0.05, color: 'accent' },
    // 眼睛
    { width: headSize * 0.16, height: headSize * 0.14, depth: headSize * 0.1, x: -headSize * 0.22, y: headY + headSize * 0.04, z: headZ + headSize * 0.46, color: 'eye' },
    { width: headSize * 0.16, height: headSize * 0.14, depth: headSize * 0.1, x: headSize * 0.22, y: headY + headSize * 0.04, z: headZ + headSize * 0.46, color: 'eye' },
    // 尾巴（翘在身后）
    { width: w * 0.13, height: w * 0.13, depth: bodyLength * 0.5, x: 0, y: bodyY + bodyHeight * 0.3, z: -bodyLength * 0.68, color: 'accent' },
    // 项圈（驯服后显红；见 `petBoxes` 的注释）
    { width: w * 0.64, height: w * 0.1, depth: w * 0.12, x: 0, y: bodyY + bodyHeight * 0.55, z: bodyLength * 0.42, color: 'collar' },
  ];
}

/**
 * 骑乘系（批次 253）：马 / 驴 / 骡 / 羊驼共用的一副骨架。
 *
 * 与 `petBoxes` 的区别：腿占身高一半（马腿长）、身子更长、脖子竖起来再接一个长头，
 * 尾巴垂在身后。前四个盒子仍是腿（`legCountOf` 固定 4）。
 */
function horseBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const h = type.height;
  const legHeight = h * 0.52;
  const bodyHeight = h * 0.3;
  const bodyY = legHeight + bodyHeight / 2;
  const bodyLength = w * 1.5;
  const legX = w * 0.3;
  const legZ = bodyLength * 0.32;
  const neckHeight = h * 0.34;
  const neckY = bodyY + bodyHeight * 0.5 + neckHeight * 0.4;
  const headSize = w * 0.42;
  const headY = neckY + neckHeight * 0.55;

  return [
    // 四条长腿（下标 0~3）
    { width: w * 0.16, height: legHeight, depth: w * 0.16, x: -legX, y: legHeight / 2, z: legZ, color: 'accent' },
    { width: w * 0.16, height: legHeight, depth: w * 0.16, x: legX, y: legHeight / 2, z: legZ, color: 'accent' },
    { width: w * 0.16, height: legHeight, depth: w * 0.16, x: -legX, y: legHeight / 2, z: -legZ, color: 'accent' },
    { width: w * 0.16, height: legHeight, depth: w * 0.16, x: legX, y: legHeight / 2, z: -legZ, color: 'accent' },
    // 躯干
    { width: w * 0.66, height: bodyHeight, depth: bodyLength, x: 0, y: bodyY, z: 0, color: 'body' },
    // 脖子（竖起来）
    { width: w * 0.3, height: neckHeight, depth: w * 0.34, x: 0, y: neckY, z: bodyLength * 0.36, color: 'body' },
    // 头 + 口鼻
    { width: headSize, height: headSize * 0.8, depth: headSize * 1.2, x: 0, y: headY, z: bodyLength * 0.5, color: 'body' },
    { width: headSize * 0.7, height: headSize * 0.45, depth: headSize * 0.6, x: 0, y: headY - headSize * 0.1, z: bodyLength * 0.5 + headSize * 0.7, color: 'accent' },
    // 双耳
    { width: w * 0.08, height: h * 0.09, depth: w * 0.06, x: -headSize * 0.25, y: headY + headSize * 0.5, z: bodyLength * 0.46, color: 'accent' },
    { width: w * 0.08, height: h * 0.09, depth: w * 0.06, x: headSize * 0.25, y: headY + headSize * 0.5, z: bodyLength * 0.46, color: 'accent' },
    // 双眼
    { width: w * 0.07, height: h * 0.04, depth: w * 0.03, x: -headSize * 0.22, y: headY + headSize * 0.08, z: bodyLength * 0.5 + headSize * 0.56, color: 'eye' },
    { width: w * 0.07, height: h * 0.04, depth: w * 0.03, x: headSize * 0.22, y: headY + headSize * 0.08, z: bodyLength * 0.5 + headSize * 0.56, color: 'eye' },
    // 尾巴 + 鬃毛
    { width: w * 0.1, height: h * 0.22, depth: w * 0.1, x: 0, y: bodyY + bodyHeight * 0.3, z: -bodyLength * 0.55, color: 'accent' },
    { width: w * 0.08, height: neckHeight * 0.8, depth: w * 0.12, x: 0, y: neckY, z: bodyLength * 0.29, color: 'accent' },
  ];
}

/**
 * 水生（批次 259）：鳕鱼 / 鲑鱼 / 海豚共用。
 *
 * 一个前后拉长的身体 + 竖着的尾鳍 + 背鳍 + 两只眼；没有腿（`legCountOf` 返回 0），
 * 游动时只靠整体倾斜表达，不做尾摆动画（原版那套摆尾需要骨骼，这里没有）。
 */
/**
 * 海龟（批次 260）：扁平的壳 + 探出来的头 + 四只鳍足。
 *
 * 壳用 `body`、鳍足与头用 `accent`，眼睛照旧；前四个部件是鳍足
 * （`legCountOf` 返回 4，走路摆动只认最前面四个）。
 */
/**
 * 蝙蝠（批次 261）：一小团身体 + 两片横向张开的翅膀 + 尖耳 + 双眼。
 *
 * 没有腿（`legCountOf` 返回 0）；翅膀不做扇动动画——`MobRenderer` 现在只对
 * "部件表前 N 个"做走路摆动，而蝙蝠的翅膀是第 2、3 个部件（numLegs=0 就不摆）。
 */
function batBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const h = type.height;
  return [
    // 身体
    { width: w * 0.5, height: h * 0.9, depth: w * 0.5, x: 0, y: h * 0.5, z: 0, color: 'body' },
    // 两片翅膀
    { width: w * 0.55, height: h * 0.12, depth: w * 0.55, x: -w * 0.5, y: h * 0.55, z: 0, color: 'accent' },
    { width: w * 0.55, height: h * 0.12, depth: w * 0.55, x: w * 0.5, y: h * 0.55, z: 0, color: 'accent' },
    // 双耳
    { width: w * 0.1, height: h * 0.3, depth: w * 0.08, x: -w * 0.12, y: h * 0.95, z: 0, color: 'accent' },
    { width: w * 0.1, height: h * 0.3, depth: w * 0.08, x: w * 0.12, y: h * 0.95, z: 0, color: 'accent' },
    // 双眼
    { width: w * 0.08, height: h * 0.12, depth: w * 0.06, x: -w * 0.14, y: h * 0.6, z: w * 0.26, color: 'eye' },
    { width: w * 0.08, height: h * 0.12, depth: w * 0.06, x: w * 0.14, y: h * 0.6, z: w * 0.26, color: 'eye' },
  ];
}

function turtleBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const h = type.height;
  const shellWidth = w * 0.8;
  const shellHeight = h * 0.7;
  const shellDepth = w * 1.05;
  const finZ = shellDepth * 0.3;
  return [
    // 四只鳍足（下标 0~3）
    { width: w * 0.22, height: h * 0.35, depth: w * 0.3, x: -shellWidth * 0.55, y: h * 0.18, z: finZ, color: 'accent' },
    { width: w * 0.22, height: h * 0.35, depth: w * 0.3, x: shellWidth * 0.55, y: h * 0.18, z: finZ, color: 'accent' },
    { width: w * 0.22, height: h * 0.35, depth: w * 0.3, x: -shellWidth * 0.55, y: h * 0.18, z: -finZ, color: 'accent' },
    { width: w * 0.22, height: h * 0.35, depth: w * 0.3, x: shellWidth * 0.55, y: h * 0.18, z: -finZ, color: 'accent' },
    // 壳
    { width: shellWidth, height: shellHeight, depth: shellDepth, x: 0, y: h * 0.55, z: 0, color: 'body' },
    // 头
    { width: w * 0.3, height: h * 0.4, depth: w * 0.35, x: 0, y: h * 0.5, z: shellDepth * 0.62, color: 'accent' },
    // 双眼
    { width: w * 0.07, height: h * 0.1, depth: w * 0.06, x: -w * 0.12, y: h * 0.58, z: shellDepth * 0.62 + w * 0.16, color: 'eye' },
    { width: w * 0.07, height: h * 0.1, depth: w * 0.06, x: w * 0.12, y: h * 0.58, z: shellDepth * 0.62 + w * 0.16, color: 'eye' },
  ];
}

function fishBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const h = type.height;
  const bodyLength = w * 1.5;
  return [
    // 身体
    { width: w * 0.55, height: h * 0.75, depth: bodyLength, x: 0, y: h * 0.5, z: 0, color: 'body' },
    // 尾鳍（竖着的一片）
    {
      width: w * 0.08,
      height: h * 0.9,
      depth: bodyLength * 0.35,
      x: 0,
      y: h * 0.5,
      z: -bodyLength * 0.62,
      color: 'accent',
    },
    // 背鳍
    {
      width: w * 0.07,
      height: h * 0.4,
      depth: bodyLength * 0.45,
      x: 0,
      y: h * 0.95,
      z: 0,
      color: 'accent',
    },
    // 双眼
    {
      width: w * 0.08,
      height: h * 0.12,
      depth: w * 0.08,
      x: -w * 0.24,
      y: h * 0.62,
      z: bodyLength * 0.38,
      color: 'eye',
    },
    {
      width: w * 0.08,
      height: h * 0.12,
      depth: w * 0.08,
      x: w * 0.24,
      y: h * 0.62,
      z: bodyLength * 0.38,
      color: 'eye',
    },
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
  // 驯养系（批次 242）与骑乘系（批次 253）：四条腿（部件表最前面四个）
  if (kind === 'pet' || kind === 'horse') return 4;
  // 水生（批次 259）：没有腿，靠尾巴摆
  if (kind === 'fish') return 0;
  // 海龟（批次 260）：四条鳍足（部件表最前面四个）
  if (kind === 'turtle') return 4;
  // 蝙蝠（批次 261）：飞行动物，没有腿可摆
  if (kind === 'bat') return 0;
  if (kind === 'quadruped') return 4;
  if (kind === 'spider') return 8;
  // 水晶/烈焰人/恶魂不摆动：水晶自转、烈焰人的火棒长在它自己身上、
  // 恶魂那九条触手是垂直挂着的（按 `i % 2` 前后摆反而会像在走路）
  // 凋灵（批次 116）：既没有腿也没有翅膀可摆（它整体在飘），所以是 0；
  // 史莱姆（批次 120）同理：整个身体就是一个方块，没有腿
  if (kind === 'crystal' || kind === 'blaze' || kind === 'ghast' || kind === 'wither' || kind === 'slime') return 0;
  // 幻翼（批次 126）：它一直在飞，没有腿可摆
  if (kind === 'phantom') return 0;
  // 鱿鱼（批次 189）：那八条触手是垂着的，摆起来会像在走路（与恶魂同一条）
  if (kind === 'squid') return 0;
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
/**
 * 史莱姆（批次 120）：**一个果冻方块 + 里面那颗核**（原版就是"外壳 + 内核"两层）。
 *
 * 与其它生物不同的地方是它**没有头、没有腿**（整个身体就是一个立方体），
 * 所以这里两份盒子就是全部——外面那层用主色、里面那颗核用点缀色，
 * 从任何角度看都是一坨半透明的绿果冻。
 */
function slimeBoxes(type: MobType): BoxSpec[] {
  const size = Math.min(type.width, type.height);
  return [
    // 外壳：整个身体
    { width: size, height: size, depth: size, x: 0, y: size / 2, z: 0, color: 'body' },
    // 内核：原版那颗更深色的立方体（体积小一半左右）
    { width: size * 0.55, height: size * 0.55, depth: size * 0.55, x: 0, y: size / 2, z: 0, color: 'accent' },
  ];
}

/**
 * 幻翼（批次 126）：**扁身子 + 两片长翼 + 一条尾巴**。
 *
 * 原版它的辨识点就是"一对比身体还长的翅膀"和那张几乎占满整个头的嘴，
 * 所以这里把翼做成两片**细长的平板**（前后各斜一点，静态下也看得出是翼），
 * 头做成最前面那一块小方盒 + 两只发亮的眼睛（`eyeColor`，暗夜里就靠它认）。
 */
function phantomBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const h = type.height;
  const bodyY = h * 0.5;
  const boxes: BoxSpec[] = [
    // 身子：扁而长（沿着"朝前"的方向拉长）
    { width: w * 0.34, height: h * 0.8, depth: w * 0.62, x: 0, y: bodyY, z: 0, color: 'body' },
    // 两片长翼：从身子两侧伸出去，向后掠
    { width: w * 0.62, height: h * 0.16, depth: w * 0.5, x: -w * 0.44, y: bodyY + h * 0.12, z: -w * 0.12, color: 'accent' },
    { width: w * 0.62, height: h * 0.16, depth: w * 0.5, x: w * 0.44, y: bodyY + h * 0.12, z: -w * 0.12, color: 'accent' },
    // 头：最前面那一小块
    { width: w * 0.26, height: h * 0.7, depth: w * 0.3, x: 0, y: bodyY + h * 0.1, z: w * 0.42, color: 'body' },
    // 两只眼睛（发亮的青色，原版也是靠它认）
    { width: w * 0.09, height: h * 0.22, depth: w * 0.05, x: -w * 0.08, y: bodyY + h * 0.2, z: w * 0.56, color: 'eye' },
    { width: w * 0.09, height: h * 0.22, depth: w * 0.05, x: w * 0.08, y: bodyY + h * 0.2, z: w * 0.56, color: 'eye' },
    // 尾巴：往后收成一小节
    { width: w * 0.12, height: h * 0.3, depth: w * 0.36, x: 0, y: bodyY - h * 0.08, z: -w * 0.42, color: 'accent' },
  ];
  return boxes;
}

/**
 * 鱿鱼（批次 189）：**一个圆头 + 八条垂下来的触手**。
 *
 * 原版它的辨识点只有两个：软圆的头（头顶尖一点）与那一把触手；
 * 眼睛是两颗发亮的白点（`eye`），在水下那种暗蓝里就靠它们认出"这是活的"。
 *
 * ⚠️ 所有部件都落在 `0..height` 之内（与恶魂/凋灵同一条：挂出去会看起来悬空）。
 */
function squidBoxes(type: MobType): BoxSpec[] {
  const w = type.width;
  const h = type.height;
  const headHeight = h * 0.52;
  const headY = h - headHeight / 2;
  const boxes: BoxSpec[] = [
    // 头：横宽、竖略扁，做成"软体"的观感
    { width: w * 0.8, height: headHeight, depth: w * 0.8, x: 0, y: headY, z: 0, color: 'body' },
    // 头顶那个尖（原版的鳍）
    { width: w * 0.3, height: h * 0.16, depth: w * 0.3, x: 0, y: h - h * 0.08, z: 0, color: 'accent' },
    // 两只眼睛：贴在头的两侧靠下
    { width: w * 0.13, height: h * 0.12, depth: w * 0.06, x: -w * 0.26, y: headY - h * 0.04, z: w * 0.38, color: 'eye' },
    { width: w * 0.13, height: h * 0.12, depth: w * 0.06, x: w * 0.26, y: headY - h * 0.04, z: w * 0.38, color: 'eye' },
  ];
  // 八条触手：绕头底一圈（4×2 排布），往下垂到脚底
  const legTop = h - headHeight;
  const tentacleHeight = legTop * 0.94;
  for (let i = 0; i < 8; i++) {
    const col = (i % 4) - 1.5;
    const row = Math.floor(i / 4) - 0.5;
    boxes.push({
      width: w * 0.14,
      height: tentacleHeight,
      depth: w * 0.2,
      x: col * w * 0.2,
      y: tentacleHeight / 2,
      z: row * w * 0.28,
      color: 'accent',
    });
  }
  return boxes;
}

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

/** 刷怪笼里的迷你模型的缩放（原版约 0.4~0.5） */
const DECOR_SCALE = 0.45;
/** 旋转速度（弧度/秒）：原版转得很慢，转快了像电风扇 */
const DECOR_SPIN = 0.7;

/** 一个装饰生物：样板（只取外观）+ 位置 + 相位 */
export interface MobDecoration {
  /** 样板：只读 `type` 与外观状态，**不会被 tick** */
  readonly sample: Mob;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 初始相位（让相邻笼子里的模型不同步转） */
  readonly phase: number;
}

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

  /** 装饰生物（批次 487：刷怪笼里旋转的迷你模型），由主程序每帧灌进来 */
  private decorations: readonly MobDecoration[] = [];
  /** 装饰用的外观缓存（按 `mobId + 外观版本`）——它们没有实体 id，不能塞进 `visuals` */
  private readonly decorationVisuals = new Map<string, MobVisual>();

  /**
   * 设置这一帧的装饰生物（刷怪笼里的迷你模型）。
   *
   * 与 `mobs` 走**同一套实例缓冲**：它们也是方块模型，没必要为几只迷你模型
   * 再开一个 InstancedMesh（那会多一次 draw call，而这正是实例化的意义所在）。
   */
  setDecorations(list: readonly MobDecoration[]): void {
    this.decorations = list;
  }
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

    // ---- 装饰生物（批次 487）：刷怪笼里旋转的迷你模型
    //
    // 与实体同一套 `rootDummy + partDummy`：位置在笼子正中、绕 Y 轴匀速转、
    // 整体缩小（`DECOR_SCALE`）。**不做走路摆动**——它们没在走，
    // 摆动反而会让"这是一只被关着的怪"看起来在跑步。
    const seenDecor = new Set<string>();
    for (const deco of this.decorations) {
      const sample = deco.sample;
      const appearanceKey = `${sample.type.id}|${mobAppearanceKey(sample)}`;
      seenDecor.add(appearanceKey);
      let visual = this.decorationVisuals.get(appearanceKey);
      if (!visual) {
        visual = this.createVisual(sample);
        this.decorationVisuals.set(appearanceKey, visual);
      }

      this.rootDummy.position.set(deco.x, deco.y, deco.z);
      this.rootDummy.rotation.set(0, this.elapsed * DECOR_SPIN + deco.phase, 0);
      this.rootDummy.scale.setScalar(DECOR_SCALE);
      this.rootDummy.updateMatrix();

      const light = sampleLight(Math.floor(deco.x), Math.floor(deco.y), Math.floor(deco.z));
      const sky = light ? light.sky : 15;
      const block = light ? light.block : 0;
      const level = Math.max((sky / 15) * skyBrightness, block / 15);
      const brightness = Math.max(level / (4 - 3 * level), 0.08);

      for (let i = 0; i < visual.specs.length; i++) {
        if (instance >= MAX_PARTS) break;
        const spec = visual.specs[i]!;
        this.partDummy.position.set(spec.x, spec.y, spec.z);
        this.partDummy.scale.set(spec.width, spec.height, spec.depth);
        this.partDummy.rotation.set(0, 0, 0);
        this.partDummy.updateMatrix();
        this.partDummy.updateWorldMatrix(true, false);
        this.mesh.setMatrixAt(instance, this.partDummy.matrixWorld);

        const base = visual.partColors[i]!;
        this.scratchColor.setRGB(
          Math.min(1, (((base >> 16) & 0xff) * brightness) / 255),
          Math.min(1, (((base >> 8) & 0xff) * brightness) / 255),
          Math.min(1, ((base & 0xff) * brightness) / 255),
        );
        this.mesh.setColorAt(instance, this.scratchColor);
        instance++;
      }
    }
    // 笼子没了就丢掉它的外观（否则换个笼子类型之后旧的会一直留着）
    for (const key of [...this.decorationVisuals.keys()]) {
      if (!seenDecor.has(key)) this.decorationVisuals.delete(key);
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
    // 项圈（批次 242）：没驯服时涂成身体色（等于看不见），驯服后是红色。
    // 与羊的"剪没剪"同一个套路：颜色跟着**个体状态**走，模型表不用分两份。
    const collarColor = mob.tamed ? 0xb02a2a : bodyColor;
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      // `eye`：默认那份近黑色，除非这种生物自带 `eyeColor`
      // （批次 112 末影人：全身纯黑，眼睛是它唯一的辨识点）
      partColors[i] =
        spec.color === 'body'
          ? bodyColor
          : spec.color === 'accent'
            ? accentColor
            : spec.color === 'collar'
              ? collarColor
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
