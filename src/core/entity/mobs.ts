/**
 * 生物种类表
 *
 * 数值按原版（基岩版/Java 版 1.18）取值：
 *  - 僵尸 / 骷髅 / 苦力怕：20 点生命，移动速度约 2.3 格/秒，追击范围 24~35 格
 *  - 牛 / 猪 / 羊 / 鸡：8~10 点生命，游荡速度约 1.1~1.3 格/秒
 *  - 掉落物按原版的种类与数量区间，概率项用于"0~2 个"这类随机掉落
 *
 * 颜色字段给渲染器用（程序化模型按主色 + 点缀色拼出身体与四肢）。
 */

import { Item } from '../registry/items.ts';
// 村民（J11）：爱吃什么、皮肤与长袍的底色都放在职业表那一层（纯数据）
import { VILLAGER_FOODS, VILLAGER_IDLE_ROBE, VILLAGER_SKIN_COLOR } from '../registry/villagerTrades.ts';
import type { MobType } from './Mob.ts';

/**
 * 村民（J11，批次 88）。**单独一个常量**（而不是只写在数组里）：
 * `Villager` 这个子类与"造生物的工厂"都要拿它当"这一只是村民"的判据，
 * 而按 id 字符串比对的写法迟早会在某处拼错一个字母（那是静的、不会报错的错）。
 *
 * ⚠️ 三处与原版的差异，都写在数据里：
 *  - `naturalSpawn: false`：原版村民只随**村庄**出现，本项目还没有村庄结构，
 *    所以不进自然生成表（靠命令/刷怪蛋/繁殖）——不写这一条，`PASSIVE_MOBS`
 *    会把它当普通动物撒在草地上；
 *  - `feed` 是四样（面包/胡萝卜/马铃薯/甜菜根），比牛羊那种"一样"多一点，
 *    所以 `MobType.feed` 允许写数组；
 *  - 长袍颜色放在 `accentColor`（无业时的褐色），**认领职业之后由渲染层换成职业色**
 *    （`MobRenderer` 的 `mobAccentColor`）——一个物种一份 `MobType` 才不会被
 *    "给每个职业各注册一种村民"把生物表的分子注水。
 */
export const VILLAGER_TYPE: MobType = {
  id: 'villager',
  name: '村民',
  health: 20,
  width: 0.6,
  height: 1.95,
  speed: 1.35,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 0,
  feed: VILLAGER_FOODS,
  naturalSpawn: false,
  bodyColor: VILLAGER_SKIN_COLOR,
  accentColor: VILLAGER_IDLE_ROBE,
  eyeHeight: 1.74,
};

/**
 * 烈焰人（批次 92，J26 的断环之一）。
 *
 * 它是**第一种会飞的生物**（`flying: true`），也是**唯一掉烈焰棒**的生物
 * ——而烈焰棒 → 烈焰粉是酿造台的燃料、也是酿造台自己的配方原料，
 * 所以在它出现之前"整族药水"在生存里都够不着（见 O14 的可达性审计）。
 *
 * 数值按原版：20 点生命、接触伤害 6（原版它就是"撞上去就掉血"）、
 * 掉落 **0~1 根烈焰棒**（原版如此，抢夺能多掉）。⚠️ 以下是刻意的差异：
 *  - **不进自然生成表**（`naturalSpawn: false`）：原版烈焰人只从**要塞的刷怪笼**
 *    与要塞范围内的少量自然生成来，本项目的刷怪笼已经做了
 *    （`registry/spawners.ts`），所以它由刷怪笼生成，而不是被撒在下界里
 *    （与村民那条"不写这一条就会被撒在草地上"同一个坑）；
 *  - **免疫火焰**（`fireImmune`）：拿火去打它不掉血；
 *  - 它的火球是`Throwable` 里的一档（`small_fireball`），打中**掉 5 点血 + 点着 5 秒**。
 */
export const BLAZE_TYPE: MobType = {
  id: 'blaze',
  name: '烈焰人',
  health: 20,
  width: 0.6,
  height: 1.8,
  speed: 2.4,
  hostile: true,
  attackDamage: 6,
  followRange: 32,
  drops: [{ itemId: Item.BLAZE_ROD, min: 0, max: 1, chance: 0.5 }],
  xp: 10,
  naturalSpawn: false,
  flying: true,
  fireImmune: true,
  bodyColor: 0xf2b53c,
  accentColor: 0xc9801f,
  eyeHeight: 1.5,
};

/**
 * 蜘蛛（批次 93，J26 最后一条断环）。
 *
 * 它是**唯一掉蜘蛛眼**的生物，而蜘蛛眼是"剧毒"药水唯一的原料、也是
 * "发酵蜘蛛眼 → 缓慢/伤害/隐身"那三条的起点；在这之前**整族药水**有 45 瓶
 * 在生存里够不着（见 O14 的可达性审计与 TASKS 的 J26）。
 *
 * 三处招牌行为都有对应的数据字段（不是特判）：
 *  - **会爬墙**（`climbing`）：贴着墙走的时候给一点向上速度，能翻过 2~3 格的墙
 *    ——这是蜘蛛与僵尸之间最直观的区别；
 *  - **亮处中立**（`neutralInLight: 11`）：原版亮度 ≥ 11 时不主动攻击
 *    （白天、火把旁边它只会干瞪眼），但**被打过就会记仇**（见 `Mob.ANGER_SECONDS`）；
 *  - **节肢家族**（`family: 'arthropod'`）：`节肢杀手` 附魔的第一个生效目标
 *    （在那之前这个附魔没有任何生物能试）。
 *
 * 数值按原版：16 点生命、接触伤害 2、追击范围 16 格；
 * 掉落**蛛丝 0~2**（100%）与**蜘蛛眼 1 个 / 1/3 概率**（原版）。
 * ⚠️ 未做：爬墙时不减速（原版贴墙会慢一点）、宽体（1.4 格，能钻进 1 格宽的缝）。
 */
export const SPIDER_TYPE: MobType = {
  id: 'spider',
  name: '蜘蛛',
  health: 16,
  width: 1.4,
  height: 0.9,
  speed: 2.9,
  hostile: true,
  attackDamage: 2,
  followRange: 16,
  drops: [
    { itemId: Item.STRING, min: 0, max: 2 },
    // ⚠️ `min: 1, max: 1` + `chance: 1/3` 才是原版那 1/3：写成 `min: 0, max: 1`
    // 会被"数量也掷一次"再除一半（实测 17%，见 `test:spider` 的统计断言）
    { itemId: Item.SPIDER_EYE, min: 1, max: 1, chance: 1 / 3 },
  ],
  xp: 5,
  family: 'arthropod',
  climbing: true,
  neutralInLight: 11,
  bodyColor: 0x8a3b2a,
  accentColor: 0x3f1a12,
  eyeHeight: 0.7,
};

/**
 * 洞穴蜘蛛（批次 93）：废弃矿井里的那种小蜘蛛。
 *
 * 与蜘蛛的差别只有三条，全都写在数据里：**更小**（0.7 × 0.5，能钻进 1 格高的缝）、
 * **每次命中让对方中毒 7 秒**（`venom`，这是它比普通蜘蛛可怕的地方）、
 * **不进自然生成表**（原版只从废弃矿井的刷怪笼里来，而矿井还没做——
 * 所以它现在只能靠 `/summon` 或调试菜单见到，记在 TASKS J15）。
 *
 * 数值按原版：12 点生命、接触伤害 2、掉落同样是蛛丝 0~2 + 蜘蛛眼（1/3）。
 */
export const CAVE_SPIDER_TYPE: MobType = {
  id: 'cave_spider',
  name: '洞穴蜘蛛',
  health: 12,
  width: 0.7,
  height: 0.5,
  speed: 2.4,
  hostile: true,
  attackDamage: 2,
  followRange: 16,
  drops: [
    { itemId: Item.STRING, min: 0, max: 2 },
    // ⚠️ `min: 1, max: 1` + `chance: 1/3` 才是原版那 1/3：写成 `min: 0, max: 1`
    // 会被"数量也掷一次"再除一半（实测 17%，见 `test:spider` 的统计断言）
    { itemId: Item.SPIDER_EYE, min: 1, max: 1, chance: 1 / 3 },
  ],
  xp: 5,
  family: 'arthropod',
  climbing: true,
  neutralInLight: 11,
  naturalSpawn: false,
  venom: { effect: 'poison', seconds: 7 },
  bodyColor: 0x2f6f7a,
  accentColor: 0x17343c,
  eyeHeight: 0.4,
};

export const MOB_TYPES: readonly MobType[] = [
  BLAZE_TYPE,
  SPIDER_TYPE,
  CAVE_SPIDER_TYPE,
  {
    id: 'zombie',
    name: '僵尸',
    health: 20,
    width: 0.6,
    height: 1.95,
    speed: 2.35,
    hostile: true,
    attackDamage: 3,
    followRange: 24,
    drops: [{ itemId: Item.ROTTEN_FLESH, min: 0, max: 2, chance: 0.8 }],
    xp: 5,
    family: 'undead',
    bodyColor: 0x2f6b45,
    accentColor: 0x1f4a30,
    eyeHeight: 1.74,
  },
  {
    id: 'skeleton',
    name: '骷髅',
    health: 20,
    width: 0.6,
    height: 1.95,
    speed: 2.4,
    hostile: true,
    attackDamage: 2,
    followRange: 24,
    drops: [{ itemId: Item.BONE, min: 0, max: 2, chance: 0.85 }],
    xp: 5,
    family: 'undead',
    // 原版骷髅：约 16 格射程、每 2 秒一箭、贴到 5 格内会后退
    ranged: { range: 16, cooldown: 2, speed: 34, keepDistance: 5, spread: 0.12 },
    bodyColor: 0xd9d9d1,
    accentColor: 0xb4b4ac,
    eyeHeight: 1.74,
  },
  {
    id: 'creeper',
    name: '苦力怕',
    health: 20,
    width: 0.6,
    height: 1.7,
    speed: 2.2,
    hostile: true,
    // 原版的爆炸伤害最高约 49（贴脸），这里按"近身自爆"取 24
    attackDamage: 24,
    followRange: 20,
    drops: [{ itemId: Item.GUNPOWDER, min: 0, max: 2, chance: 0.75 }],
    xp: 5,
    bodyColor: 0x57a84b,
    accentColor: 0x3c7a34,
    eyeHeight: 1.4,
  },
  {
    id: 'cow',
    name: '牛',
    health: 10,
    width: 0.9,
    height: 1.4,
    speed: 1.25,
    hostile: false,
    attackDamage: 0,
    followRange: 0,
    drops: [
      { itemId: Item.BEEF, min: 1, max: 3 },
      { itemId: Item.LEATHER, min: 0, max: 2 },
    ],
    // 小麦（H13 耕作落地后换回原版口粮）
    feed: Item.WHEAT,
    milk: true,
    xp: 3,
    bodyColor: 0x4a3325,
    accentColor: 0xe8e4d8,
    eyeHeight: 1.15,
  },
  {
    id: 'pig',
    name: '猪',
    health: 10,
    width: 0.9,
    height: 0.9,
    speed: 1.25,
    hostile: false,
    attackDamage: 0,
    followRange: 0,
    drops: [{ itemId: Item.PORKCHOP, min: 1, max: 3 }],
    // 胡萝卜（H13 续落地后换回原版口粮；原版还认马铃薯/甜菜根）
    feed: Item.CARROT,
    xp: 3,
    bodyColor: 0xe39a9a,
    accentColor: 0xc47878,
    eyeHeight: 0.75,
  },
  {
    id: 'sheep',
    name: '羊',
    health: 8,
    width: 0.9,
    height: 1.3,
    speed: 1.2,
    hostile: false,
    attackDamage: 0,
    followRange: 0,
    // 羊毛不写进 drops：颜色是每只羊各自的（见 MobType.wool，在 Mob.dropLoot 里结算）
    drops: [{ itemId: Item.MUTTON, min: 1, max: 2 }],
    feed: Item.WHEAT,
    wool: true,
    xp: 3,
    bodyColor: 0xe8e8e8,
    accentColor: 0xd0c8bc,
    eyeHeight: 1.05,
  },
  {
    id: 'chicken',
    name: '鸡',
    health: 4,
    width: 0.4,
    height: 0.7,
    speed: 1.1,
    hostile: false,
    attackDamage: 0,
    followRange: 0,
    drops: [
      { itemId: Item.CHICKEN, min: 1, max: 1 },
      { itemId: Item.FEATHER, min: 0, max: 2 },
    ],
    // 小麦种子（H13 耕作落地后换回原版口粮）
    feed: Item.WHEAT_SEEDS,
    // 下蛋（K4 尾巴）：鸡蛋在生存里的唯一来源
    laysEggs: true,
    xp: 3,
    bodyColor: 0xf2f2ee,
    accentColor: 0xd94f2b,
    eyeHeight: 0.6,
  },
  VILLAGER_TYPE,
];

const BY_ID = new Map<string, MobType>(MOB_TYPES.map((type) => [type.id, type]));

export function mobTypeById(id: string): MobType | undefined {
  return BY_ID.get(id);
}

/**
 * 联机时其它玩家的外观（K2）。
 *
 * 故意**不放进 `MOB_TYPES`**：那样会被 `PASSIVE_MOBS` 收录、进而被自然刷出来。
 * 远程玩家只是"借渲染器的模型用一下"，位置完全由网络消息驱动，不参与 AI 与物理。
 */
export const REMOTE_PLAYER_TYPE: MobType = {
  id: 'remote_player',
  name: '玩家',
  health: 20,
  width: 0.6,
  height: 1.8,
  speed: 0,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  // 远程玩家不是"击杀目标"：联机同步里也没有击杀归属，给 0 最诚实
  xp: 0,
  bodyColor: 0x3f7ad6,
  accentColor: 0xe2b48c,
  eyeHeight: 1.62,
};

/**
 * **会自然刷出来**的敌对生物（刷怪用）。
 *
 * ⚠️ 与"所有敌对生物"不是一回事（批次 93 起）：洞穴蜘蛛是敌对的，但原版它只从
 * **废弃矿井的刷怪笼**里来，而矿井还没做——所以它 `naturalSpawn: false`、
 * 不该被撒在野地里（与村民那条同一个坑：不筛这一道，`MobSpawner` 就会把它当普通怪刷）。
 */
export const HOSTILE_MOBS: readonly MobType[] = MOB_TYPES.filter(
  (type) => type.hostile && type.naturalSpawn !== false,
);
/**
 * **所有**敌对生物（含"不自然刷"的烈焰人、洞穴蜘蛛）。
 *
 * 给"击败一只敌对生物"这类进度用——原版那条不挑物种，而从刷怪笼里打出来的
 * 烈焰人当然也算"怪物"。
 */
export const ALL_HOSTILE_MOBS: readonly MobType[] = MOB_TYPES.filter((type) => type.hostile);
/**
 * 被动生物（**自然生成用**）。
 *
 * ⚠️ 与"所有非敌对生物"不是一回事：村民也是被动的，但它不该被撒在草地上
 * （见 `MobType.naturalSpawn` 的注释）。所以这里多筛一道。
 */
export const PASSIVE_MOBS: readonly MobType[] = MOB_TYPES.filter(
  (type) => !type.hostile && type.naturalSpawn !== false,
);
