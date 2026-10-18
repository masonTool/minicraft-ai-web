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
// 凋灵骷髅头（批次 115）：它既是方块也是掉落物，所以这里要引方块表
import { Block } from '../registry/blocks.ts';
// 石剑（批次 115）：原版凋灵骷髅拿着它，剑本身也能掉
import { toolItemId } from '../registry/tools.ts';
// 村民（J11）：爱吃什么、皮肤与长袍的底色都放在职业表那一层（纯数据）
import { VILLAGER_FOODS, VILLAGER_IDLE_ROBE, VILLAGER_SKIN_COLOR } from '../registry/villagerTrades.ts';
import type { MobType } from './Mob.ts';
// 两个 boss（末影龙、凋灵）各自住在自己的模块里，但它们的掉落要算进
// `DROPPING_MOB_TYPES`（见那里的注释）。两处都不引 `mobs.ts`，所以不成环
import { DRAGON_TYPE } from './EndBoss.ts';
// 幻翼（批次 126）自己一个模块：它有俯冲那一套动作（见 `Phantom.ts` 的文件头）
import { PHANTOM_TYPE } from './Phantom.ts';
import { WITHER_TYPE } from './Wither.ts';

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
/**
 * 恶魂（批次 94，J26 的最后一块）。
 *
 * 它是**唯一掉恶魂之泪**的生物，而恶魂之泪是"再生"药水唯一的原料——
 * 接上它，J26 那三条断环就全通了（批次 91 量出的"整族药水拿不到"正式收口）。
 *
 * 三处招牌行为：
 *  - **又大又慢**（4×4 的碰撞盒、移动速度只有 2.2）：它是本项目里最大的生物；
 *  - **保持距离**（`Ghast.ts` 里自己的飞行 AI）：与烈焰人不同，它**不贴身**，
 *    太近就往后退——原版它就是远远地吊着打，贴上去反而打不着；
 *  - **发射大火球**：命中会**炸开一小片**（原版 ghast 火球能拆方块、也会点火），
 *    与烈焰人那种"只打人不伤地形"的小火球是两回事。
 *
 * 数值按原版：10 点生命（很脆，两箭就死）、没有近战（`attackDamage: 0`——
 * 它的伤害全在火球上）、掉落 **0~1 恶魂之泪**与 **0~2 火药**、击杀经验 5。
 * ⚠️ 与原版的差异：不做"火球被玩家打回去"（原版能用箭/雪球把它打回，
 * 那是它最出名的一招），也不做发射前的红闪与音效。
 */
export const GHAST_TYPE: MobType = {
  id: 'ghast',
  name: '恶魂',
  health: 10,
  width: 4,
  height: 4,
  speed: 2.2,
  hostile: true,
  // 原版恶魂**不近战**：撞到人也不掉血，伤害全在火球上
  attackDamage: 0,
  followRange: 48,
  drops: [
    { itemId: Item.GHAST_TEAR, min: 0, max: 1 },
    { itemId: Item.GUNPOWDER, min: 0, max: 2 },
  ],
  xp: 5,
  flying: true,
  fireImmune: true,
  // 只在下界自然刷（原版如此）；空腔要 4×4，否则半截会卡在岩层里
  dimension: 'nether',
  spawnSpace: { width: 4, height: 4 },
  bodyColor: 0xf2eee4,
  accentColor: 0xb9b3a6,
  eyeHeight: 2.6,
};

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
 * 与蜘蛛的差别**全都在数据里**，而且其中两条是"少了点什么"（原版的洞穴蜘蛛正是如此）：
 *  - **更小**（0.7 × 0.5，能钻进 1 格高的缝）；
 *  - **每次命中让对方中毒 7 秒**（`venom`，它比普通蜘蛛可怕的地方）；
 *  - **不会爬墙**（⚠️ 原版就是这样：洞穴蜘蛛不能像蜘蛛那样翻墙，
 *    所以"往上垫两格"是玩家对付它的标准办法。这一条第一版抄蜘蛛时抄错了，
 *    体检时才抓出来）；
 *  - **亮处也不中立**（它没有 `neutralInLight`：矿井里见到就打，与亮度无关）；
 *  - **不进自然生成表**（原版只从废弃矿井的刷怪笼里来，而矿井还没做——
 *    所以它现在只能靠 `/summon` 或刷怪蛋见到，记在 TASKS J15）。
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
  // ⚠️ 没有 `climbing`、也没有 `neutralInLight`：原版洞穴蜘蛛既不会爬墙，也不看亮度
  naturalSpawn: false,
  venom: { effect: 'poison', seconds: 7 },
  bodyColor: 0x2f6f7a,
  accentColor: 0x17343c,
  eyeHeight: 0.4,
};

/**
 * 末影人（批次 112，J13 的前一半）。
 *
 * 它是**唯一掉末影珍珠**的生物，而珍珠是末影之眼（12 只才点亮一圈末地传送门，
 * 见 K9 / 批次 111）的原料。在它之前，珍珠只有"要塞传送门房的箱子"一个来源，
 * 而那张表是**临时放大过的**（要塞只有一个箱子，却要凑够 12 颗）——
 * 这一批把它压回原版量，珍珠的正经来源回到"打末影人"。
 *
 * 四处招牌行为各占一个数据字段（与 `flying`/`climbing` 同一套路，不是 id 特判）：
 *  - **不主动攻击**（`neutral`）：只有被注视（`stareRange`）或被打过才会动手；
 *  - **被注视激怒**（`stareRange: 64`）：准星落在它头上就激怒、并瞬移到玩家附近开打；
 *  - **会瞬移**（`teleports`）：受击 / 泡水淋雨 / 空闲时挪窝（都走 `Mob.teleportRandomly`）；
 *  - **怕水**（`waterSensitive`）：泡在水里或淋雨时**每秒掉 1 点**并瞬移逃开。
 *
 * 数值按原版：40 点生命（本项目最耐打的普通怪）、接触伤害 7（原版普通难度）、
 * 追击 24 格、身高 2.9（三格高）、掉落 **0~1 末影珍珠**、击杀经验 5。
 *
 * ⚠️ 与原版的差异（都记在 TASKS J13）：
 *  - **记仇只有 10 秒**（`Mob.ANGER_SECONDS`）：原版一旦被激怒会一直追到你离开；
 *  - 瞬移是**随机方向**（原版会挑"看得见你 / 背对你"的位置，本项目不做视线挑选）；
 *    而且"受伤必瞬移"被折成**一半概率**——本项目的 `hurt()` 不认识伤害来源，
 *    无法区分"被箭射"（原版必躲）与"被近战砍"（原版会还手），见 TASKS J13；
 *  - 它会被水逼得瞬移逃开，但**不会主动绕开水**（原版也不绕，但会隔着水站着）；
 *  - 身高 2.9 走的仍是"≥ 1.2 格就算 2 格"这一档寻路判据，所以**两格高的缝也钻得进去**
 *    （原版要 3 格）。自然生成时用 `spawnSpace` 要 3 格高，这条只影响寻路。
 */
export const ENDERMAN_TYPE: MobType = {
  id: 'enderman',
  name: '末影人',
  health: 40,
  width: 0.6,
  height: 2.9,
  speed: 2.5,
  hostile: true,
  attackDamage: 7,
  followRange: 24,
  drops: [{ itemId: Item.ENDER_PEARL, min: 0, max: 1 }],
  xp: 5,
  neutral: true,
  stareRange: 64,
  teleports: true,
  waterSensitive: true,
  // 主世界（夜里/洞里）与末地都刷。原版下界的诡异森林也有，本项目没有那个群系
  dimension: ['overworld', 'end'],
  spawnSpace: { width: 1, height: 3 },
  // 全身纯黑，只有眼睛是紫的（原版那两颗）——`eyeColor` 这个字段就是为了它
  bodyColor: 0x14141c,
  accentColor: 0x0a0a10,
  eyeColor: 0xcc00fa,
  eyeHeight: 2.55,
};

/**
 * 凋灵骷髅（批次 115，J14 的前置）。
 *
 * 它是**唯一掉凋灵骷髅头**的生物，而 3 颗头是召唤凋灵的必需材料
 * （4 块灵魂沙摆成 T + 顶上 3 个头）——所以在它出现之前，凋灵这件事根本没有入口。
 *
 * 与骷髅的差别**全在数据里**（两条加法 + 一条改口粮）：
 *  - **命中让对方凋零 10 秒**（`venom: { effect: 'wither' }`）：这是它比普通骷髅可怕的地方，
 *    也是"凋零"这个状态效果的第一个来源（⚠️ 与中毒的区别不在这一层：
 *    中毒停在 1 点血，**凋零能致死**，那是 `StatusEffects` 里 `damageCause` 决定的）；
 *  - **近战**（没有 `ranged`）：原版它拿着石剑贴身砍，不像骷髅那样射箭；
 *  - **只在下界要塞里刷**（`spawnStructure: 'nether_fortress'`，见 `MobSpawner`）：
 *    原版就是"要塞限定"，撒满整个下界会让下界变成绞肉机。
 *
 * 数值按原版：20 点生命、接触伤害 8（普通难度，石剑的加成已含在内）、
 * 追击 16 格、击杀经验 5。掉落：煤炭 0~1（原版）、骨头 0~2、
 * **凋灵骷髅头 1 个 / 2.5%**、石剑 1 把 / 8.5%。
 * ⚠️ 与原版的差异：模型**看不到手里的石剑**（本项目不画生物手上的东西），
 * 所以"它有剑"只体现在伤害数字与那条掉落上。
 */
export const WITHER_SKELETON_TYPE: MobType = {
  id: 'wither_skeleton',
  name: '凋灵骷髅',
  health: 20,
  width: 0.6,
  height: 1.95,
  speed: 2.4,
  hostile: true,
  attackDamage: 8,
  followRange: 16,
  drops: [
    { itemId: Item.COAL, min: 0, max: 1 },
    { itemId: Item.BONE, min: 0, max: 2 },
    // ⚠️ `min: 1, max: 1` + `chance` 才是原版那颗头的 2.5%：写成 `min: 0, max: 1`
    // 会被"数量也掷一次"再砍一半（这是蜘蛛眼那条踩过的同一个坑，见 `test:spider`）
    { itemId: Block.WITHER_SKELETON_SKULL, min: 1, max: 1, chance: 0.025 },
    // 原版它拿着石剑：剑本身也能掉（8.5%）
    { itemId: toolItemId('sword', 'stone'), min: 1, max: 1, chance: 0.085 },
  ],
  xp: 5,
  family: 'undead',
  venom: { effect: 'wither', seconds: 10 },
  // 下界 + **只要塞里面**（`spawnStructure`）：原版就是"要塞限定"，
  // 所以要进"会自然刷"那张表（`naturalSpawn` 保持默认的 true）
  dimension: 'nether',
  spawnZone: 'nether_fortress',
  bodyColor: 0x3c3c3c,
  accentColor: 0x1c1c1c,
  eyeHeight: 1.74,
};

/**
 * 史莱姆三档（批次 120，J16 的一小块）——**大 / 中 / 小各是一种生物**。
 *
 * 它是**唯一掉黏液球**的生物，而黏液球是**粘性活塞**与**黏液块**的原料：
 * 在那之前粘性活塞一直挂在可达性审计的白名单上（"要黏液球，而史莱姆还没做"）。
 *
 * 三档的差别**全在表里**（与"蜘蛛 / 洞穴蜘蛛"同一套做法：差的是数据，不是逻辑）：
 *  - **大**（2.0 格宽、16 血、伤害 4）被打死 → 分裂出 2~4 只**中**；
 *  - **中**（1.0 格宽、4 血、伤害 2）被打死 → 分裂出 2~4 只**小**；
 *  - **小**（0.5 格宽、1 血、**不主动攻击**）被打死 → 掉 **0~2 黏液球**。
 *    ⚠️ 这正是原版的设计：**打一只大史莱姆要打三遍**才拿得到黏液球。
 *
 * 移动是**跳跃式**的（`hops`）：蓄力 → 朝目标跳一下 → 空中不转向，所以它一跳一跳地
 * 逼近，玩家往旁边一闪就躲开了（见 `Mob.hopMove`）。
 *
 * 自然生成**只刷大那一档**，而且要同时满足原版那两条：
 *  - **史莱姆区块**（`spawnZone: 'slime_chunk'`，约 1/10 的区块，见 `world/Slime.ts`）；
 *  - **y < 40**（`spawnMaxY`）且**不看光照**（`ignoreLight`：原版在史莱姆区块里白天也刷）。
 *  再叠上月亮相位——越满刷得越多（`MoonPhase.slimeSpawnFactor`，主程序接成刷怪权重）。
 *
 * ⚠️ 与原版的差异（记在 TASKS J16）：中/小两档**不会自然刷**（原版三档都会刷，
 * 本项目只让"大"当自然刷的那一档，靠分裂产生另两档——这样地表附近不会突然出现一堆小家伙）；
 * 它**不绕路**（跳不过去就反复跳，原版也差不多）；跳起来**不会砸到玩家更高**。
 */
export const SLIME_BIG_TYPE: MobType = {
  id: 'slime_big',
  name: '史莱姆（大）',
  health: 16,
  width: 2,
  height: 2,
  speed: 2.2,
  hostile: true,
  attackDamage: 4,
  followRange: 16,
  drops: [],
  xp: 4,
  hops: true,
  splitsInto: 'slime',
  dimension: 'overworld',
  spawnZone: 'slime_chunk',
  spawnMaxY: 40,
  ignoreLight: true,
  spawnSpace: { width: 2, height: 2 },
  bodyColor: 0x63b04a,
  accentColor: 0x3f7a30,
  eyeHeight: 1.4,
};

/** 史莱姆（中）：自然刷的那一档是"大"，这一档只从分裂里出现（见上面那段注记） */
export const SLIME_TYPE: MobType = {
  id: 'slime',
  name: '史莱姆',
  health: 4,
  width: 1,
  height: 1,
  speed: 1.8,
  hostile: true,
  attackDamage: 2,
  followRange: 16,
  drops: [],
  xp: 2,
  hops: true,
  splitsInto: 'slime_small',
  naturalSpawn: false,
  dimension: 'overworld',
  bodyColor: 0x63b04a,
  accentColor: 0x3f7a30,
  eyeHeight: 0.7,
};

/**
 * 史莱姆（小）：**不主动攻击**（原版最小的那一档只是蹦来蹦去），
 * 杀了它才掉黏液球——所以它是"黏液球农场"的最后一环。
 */
export const SLIME_SMALL_TYPE: MobType = {
  id: 'slime_small',
  name: '史莱姆（小）',
  health: 1,
  width: 0.5,
  height: 0.5,
  speed: 1.4,
  hostile: false,
  attackDamage: 0,
  followRange: 16,
  drops: [{ itemId: Item.SLIME_BALL, min: 0, max: 2 }],
  xp: 1,
  hops: true,
  naturalSpawn: false,
  dimension: 'overworld',
  bodyColor: 0x63b04a,
  accentColor: 0x3f7a30,
  eyeHeight: 0.35,
};

/**
 * 岩浆怪三档（批次 121，J15 的下一只）。
 *
 * 它基本上是**史莱姆的孪生兄弟**：同一个骨架（一个方块 + 内核）、同一套跳跃式移动、
 * 同一条分裂链——所以这一批没有新机制，只是**填数据**（这正是批次 120 那几个字段的用处：
 * `hops` / `splitsInto` / `spawnSpace`）。与本体的三处差别：
 *  - **免疫火焰**（`fireImmune`：它自己就是岩浆做的，掉进岩浆里也不会烧起来）；
 *  - **三档都掉岩浆膏**（0~1；史莱姆只有最小那一档掉黏液球）——原版就如此，
 *    所以"打死哪一档"都有收获；
 *  - 只在下界刷（`dimension: 'nether'`，与烈焰人/恶魂同一条）。
 *
 * ⚠️ 与原版的差异（记在 TASKS J15）：**不做天然护甲**（原版岩浆怪有 3 点护甲，
 * 本项目生物没有护甲这一档——所以它在数值上比原版脆）；
 * **跳到玩家身上不会额外点着火**（原版岩浆怪的接触伤害本身就是火焰伤害，
 * 这里用普通的接触伤害 + "免疫火"表达，避免"被打一下还着火"这种雪上加霜的体验）；
 * 中/小两档同样**不自然刷**（只让"大"那一档当自然刷的那一档，与史莱姆同一个取舍）。
 */
export const MAGMA_CUBE_BIG_TYPE: MobType = {
  id: 'magma_cube_big',
  name: '岩浆怪（大）',
  health: 16,
  width: 2,
  height: 2,
  speed: 2.2,
  hostile: true,
  attackDamage: 6,
  followRange: 16,
  drops: [{ itemId: Item.MAGMA_CREAM, min: 0, max: 1 }],
  xp: 4,
  hops: true,
  fireImmune: true,
  splitsInto: 'magma_cube',
  dimension: 'nether',
  spawnSpace: { width: 2, height: 2 },
  bodyColor: 0x8f3a14,
  accentColor: 0xff7a24,
  eyeHeight: 1.4,
};

/** 岩浆怪（中）：与史莱姆一样，自然刷的是"大"那一档，它从分裂里出现 */
export const MAGMA_CUBE_TYPE: MobType = {
  id: 'magma_cube',
  name: '岩浆怪',
  health: 4,
  width: 1,
  height: 1,
  speed: 1.8,
  hostile: true,
  attackDamage: 4,
  followRange: 16,
  drops: [{ itemId: Item.MAGMA_CREAM, min: 0, max: 1 }],
  xp: 2,
  hops: true,
  fireImmune: true,
  splitsInto: 'magma_cube_small',
  naturalSpawn: false,
  dimension: 'nether',
  bodyColor: 0x8f3a14,
  accentColor: 0xff7a24,
  eyeHeight: 0.7,
};

/** 岩浆怪（小）：最小的那一档也一样凶（原版 2 点伤害），只是更脆 */
export const MAGMA_CUBE_SMALL_TYPE: MobType = {
  id: 'magma_cube_small',
  name: '岩浆怪（小）',
  health: 1,
  width: 0.5,
  height: 0.5,
  speed: 1.4,
  hostile: true,
  attackDamage: 2,
  followRange: 16,
  drops: [{ itemId: Item.MAGMA_CREAM, min: 0, max: 1 }],
  xp: 1,
  hops: true,
  fireImmune: true,
  naturalSpawn: false,
  dimension: 'nether',
  bodyColor: 0x8f3a14,
  accentColor: 0xff7a24,
  eyeHeight: 0.35,
};

/**
 * 僵尸猪灵（批次 122，J15 的下一只）。
 *
 * 它是**本项目的第三只下界生物**，也是第一只**平时不打人**的敌对生物：
 *  - **中立**（`neutral`）：你不惹它，它从你身边走过去；
 *  - **群体激怒**（`angerRadius: 32`）：你打了其中一只，**周围 32 格里的同类一起翻脸**
 *    ——这是它最出名的地方（在本项目里，"记仇"那套状态从批次 93 就有了，
 *    这一批只是让**它能在同类之间传播**，见 `EntityContext.provokeNearby`）；
 *  - **掉落里有一条金子的路**：腐肉 0~1、**金粒 0~1**、金锭 2.5%、金剑 8.5%
 *    （金粒 9 个换 1 锭那条配方早就在，所以这一批把"在下界攒金子"这条读法接上了）。
 *
 * 数值按原版（普通难度）：20 血、接触伤害 **8**（比僵尸的 3 高得多——它拿着金剑）、
 * 追击 24、亡灵家族（**亡灵杀手**对它有效）、击杀经验 5。
 *
 * ⚠️ 与原版的差异：**它不掉自己手里的那把金剑的附魔版本**（原版那把剑可能带附魔）；
 * **不做"僵尸猪灵怕水/在下界之外变僵尸"**那类转换；模型是通用人形（看不到手里的金剑，
 * 与凋灵骷髅那条同一个取舍）；**被火烧/摔伤也会惊动同类**（`hurt()` 不认识伤害来源，
 * 与蜘蛛那条已知简化同源）。
 */
export const ZOMBIE_PIGLIN_TYPE: MobType = {
  id: 'zombie_piglin',
  name: '僵尸猪灵',
  health: 20,
  width: 0.6,
  height: 1.95,
  speed: 2.1,
  hostile: true,
  attackDamage: 8,
  followRange: 24,
  drops: [
    // 原版三档掉落：腐肉与金粒各 0~1，金锭 2.5%，手里那把金剑 8.5%
    { itemId: Item.ROTTEN_FLESH, min: 0, max: 1 },
    { itemId: Item.GOLD_NUGGET, min: 0, max: 1 },
    // ⚠️ 概率项写成 `min:1,max:1,chance`（写成 0~1 会被"数量也掷一次"再砍一半）
    { itemId: Item.GOLD_INGOT, min: 1, max: 1, chance: 0.025 },
    { itemId: toolItemId('sword', 'golden'), min: 1, max: 1, chance: 0.085 },
  ],
  xp: 5,
  family: 'undead',
  // 平时中立（不主动攻击），挨打才翻脸——见 `MobType.neutral` 与 `provoke`
  neutral: true,
  angerRadius: 32,
  dimension: 'nether',
  bodyColor: 0x6a9a72,
  accentColor: 0x3f6b4a,
  eyeHeight: 1.74,
};

/**
 * 溺尸（批次 123，J15 的下一只）——僵尸的**水生变体**，也是**三叉戟的唯一来源**。
 *
 * 三处招牌：
 *  - **在水里生成**（`spawnInWater`）：刷怪器那两条通用判据（脚下实心 + 两格空气）
 *    对它不适用，它要的是"脚与头都是水"；
 *  - **扔三叉戟**（`ranged` + `throwsTrident`）：弹道与骷髅射箭共用同一段瞄准，
 *    区别只在"扔出去的是什么"——玩家被它砸中掉 8 点（走 `'projectile'` 那条伤害）；
 *  - **掉三叉戟**：原版是"15% 的溺尸带着三叉戟，带的那种被玩家打死时 8.5% 掉落"，
 *    等价于**每只溺尸 1.275%**——本项目没有"个体带什么装备"这一层，
 *    所以直接把那个乘积写成掉落概率（见下面那条注记）。
 *
 * ⚠️ 与原版的差异：
 *  - 掉落那条仍是"平均 1.275%"（原版 15% 带 × 8.5% 掉）：本项目没有"个体装备"那一层，
 *    所以把乘积直接写成掉落概率（见下面那条注记）；
 *  - **不做"僵尸溺水变溺尸"**（那要一条"泡水满一定时长就转换"的通道，见 TASKS J15）；
 *  - **不掉钓竿**（原版带钓竿的那种会掉，本项目没有那件装备）；
 *  - 它**白天也会被晒着烧**（批次 124 之前本项目没有这条机制，僵尸也一样；
 *    现在亡灵家族都有，见 `world/Daylight.ts`）。
 */
export const DROWNED_TYPE: MobType = {
  id: 'drowned',
  name: '溺尸',
  health: 20,
  width: 0.6,
  height: 1.95,
  speed: 2.1,
  hostile: true,
  attackDamage: 3,
  followRange: 24,
  drops: [
    { itemId: Item.ROTTEN_FLESH, min: 0, max: 2, chance: 0.8 },
    // ⚠️ 1.275% = 原版的 15%（带三叉戟）× 8.5%（带的那种掉三叉戟），
    // 写成 `min:1,max:1,chance`（不然数量也掷一次，概率会被砍半）
    { itemId: Item.TRIDENT, min: 1, max: 1, chance: 0.01275 },
  ],
  xp: 5,
  family: 'undead',
  // 露天晒太阳会烧（批次 124；它平时泡在水里，所以"上岸"才是它的死因）
  burnsInDaylight: true,
  // 隔着几格扔三叉戟（原版它也会贴上来打，所以 keepDistance 很小）
  ranged: { range: 12, cooldown: 2.5, speed: 28, keepDistance: 3, spread: 0.1 },
  throwsTrident: true,
  // 只有约 15% 的溺尸带着三叉戟（批次 235），而且**扔出去就没了**。
  // 这一条不写的话，2.5 秒冷却的远程 AI 就是个无限三叉戟生成器。
  tridentChance: 0.15,
  spawnInWater: true,
  dimension: 'overworld',
  bodyColor: 0x3f6f5f,
  accentColor: 0x2a4f44,
  eyeHeight: 1.74,
};

/**
 * 尸壳（批次 124，J15 的下一只）——僵尸的**沙漠变体**。
 *
 * 它单独立一条的原因是**两条"别处没有"的行为**，而且它们互相解释：
 *  - **打中你会让你饥饿**（`venom: hunger`，7 秒）：沙漠里没水没吃的，
 *    被打一下就开始掉饱食度——这是它比僵尸难受的地方；
 *  - **白天在太阳底下不会烧**（不写 `burnsInDaylight`，而僵尸/骷髅/溺尸都写了）。
 *
 * ⚠️ **这一条是批次 124 顺手补的前置**：本项目在此之前**没有"亡灵白天着火"这条机制**，
 * 于是尸壳做出来只是"一只普通的僵尸"——补上之后它才有招牌
 * （这也让它能在沙漠白天活动，与"沙漠白天没有阴影"对得上）。
 *
 * 数值与僵尸同：20 血 / 接触 3 / 追击 24 / 腐肉 0~2 / 经验 5 / 亡灵家族。
 */
export const HUSK_TYPE: MobType = {
  id: 'husk',
  name: '尸壳',
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
  // 命中让玩家饥饿（原版 7 秒）
  venom: { effect: 'hunger', seconds: 7 },
  // ⚠️ **故意不写** `burnsInDaylight`：尸壳在白天照样活动，这正是它的招牌
  // 只在沙漠里刷（原版它的生成表只挂在沙漠与沙漠丘陵上）
  spawnBiomes: ['desert'],
  dimension: 'overworld',
  bodyColor: 0x8a7a5c,
  accentColor: 0x5d5140,
  eyeHeight: 1.74,
};

/**
 * 流浪者（批次 125，J15 的下一只）——骷髅的**雪原变体**，也是"变体三部曲"的第三只
 * （僵尸 → 尸壳、僵尸 → 溺尸、骷髅 → 流浪者）。
 *
 * 它的招牌只有一条，但很显眼：**它射出的箭命中玩家会让玩家"缓慢"**（原版 30 秒）——
 * 也就是说它的威胁不在伤害（与骷髅同为 2 点），而在**追不上它、也跑不掉**。
 *
 * 所以这一批多了两根数据线：
 *  - `arrowEffect`（**箭**命中玩家挂什么效果）：与 `venom`（近战命中挂效果）分开，
 *    因为流浪者根本不会贴上来打——它的全部威胁都在箭上；
 *  - `spawnBiomes`（**一组**群系）：骷髅满地都是，而流浪者只在这几处雪原
 *    （批次 124 那根数据线原本只能填一个群系名，这里一撞上多群系就改成了一组）。
 *
 * ⚠️ 与原版的差异：**白天照样会烧**（与骷髅同一条，见 `world/Daylight.ts`）；
 * **不掉箭与弓**（与骷髅同一个已有差异：本项目的骷髅只掉骨头）
 */
export const STRAY_TYPE: MobType = {
  id: 'stray',
  name: '流浪者',
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
  // 白天照样被晒着烧（与骷髅同一条规则）
  burnsInDaylight: true,
  // 与骷髅同一套射击参数（原版两者的射程与节奏一样）
  ranged: { range: 16, cooldown: 2, speed: 34, keepDistance: 5, spread: 0.12 },
  // **招牌**：箭命中玩家 → 缓慢 I / 30 秒（原版）
  arrowEffect: { effect: 'slowness', seconds: 30 },
  // 三处雪原 + 冻洋的冰面（原版流浪者的生成表就是这几处）
  spawnBiomes: ['snowy_plains', 'snowy_taiga', 'snowy_slopes', 'frozen_ocean'],
  dimension: 'overworld',
  bodyColor: 0xa8c0bb,
  accentColor: 0x6f8a86,
  eyeHeight: 1.74,
};

/**
 * 鱿鱼（批次 189，J14 的生物表 + J26 的染料链）。
 *
 * 它补的是**黑色染料**那条最长的断链：原版黑色的两个来源是墨囊与凋灵玫瑰，
 * 两样都没有，于是黑色一断、灰色（黑 + 白）跟着断，黑/灰两色的羊毛、地毯、床、
 * 染色玻璃、陶瓦、混凝土**整族**都拿不到。鱿鱼一出现，那条链自己就通了。
 *
 * 数值按原版：10 血、**1~3 个墨囊**、2 点经验（原版 1~3）、被打不还手。
 * 三处与"岸上动物"不同的地方：
 *  - `spawnInWater`：刷在水里（判据见 `MobSpawner.canSpawnInWater`，与溺尸同一条）；
 *  - `aquatic`：水里**不受重力**（否则会沉到海底贴地走），上岸 10 秒后开始窒息；
 *  - `ignoreLight`：水下天光是逐格衰减的，按"天光 ≥ 9"筛会一只都刷不出来。
 *
 * ⚠️ 与原版的差异：原版还会喷墨逃开、会随水位上下游动；这里只有"慢慢上下漂"。
 */
export const SQUID_TYPE: MobType = {
  id: 'squid',
  name: '鱿鱼',
  health: 10,
  width: 0.8,
  height: 0.8,
  speed: 1.1,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [{ itemId: Item.INK_SAC, min: 1, max: 3 }],
  xp: 2,
  aquatic: true,
  spawnInWater: true,
  // 原版只在海洋/河流里刷；本项目没有独立的"河流"群系（水靠流体填），所以是四种海洋
  spawnBiomes: ['ocean', 'deep_ocean', 'warm_ocean', 'frozen_ocean'],
  ignoreLight: true,
  dimension: 'overworld',
  bodyColor: 0x2f4f6f,
  accentColor: 0x1a3050,
  eyeHeight: 0.55,
};

/**
 * 狼（批次 242，J16 被动生物第一批）。
 *
 * 与牛猪羊的区别是**能驯服**：喂骨头（`tameWith`）有三分之一概率变成宠物，
 * 之后跟着玩家走、离远了会被传送过来、右键可以让它坐下/起来（见 `Mob.tryTame`）。
 *
 * 数值按原版：8 点生命、0.6×0.85。**掉落为空**（原版杀狼什么也不掉），
 * 所以它进不了"被动动物都有掉落"那条断言——那条要显式排除宠物类。
 * ⚠️ 差异：不主动攻击、也不帮玩家打怪（原版驯服后会帮忙咬骷髅）。
 */
export const WOLF_TYPE: MobType = {
  id: 'wolf',
  name: '狼',
  health: 8,
  width: 0.6,
  height: 0.85,
  speed: 1.8,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 2,
  // 生肉：既能把野狼引过来，也能让已驯服的狼进入求爱
  feed: [Item.BEEF, Item.PORKCHOP, Item.CHICKEN, Item.MUTTON, Item.ROTTEN_FLESH],
  tameWith: Item.BONE,
  tameChance: 1 / 3,
  // 原版：针叶林/雪林/森林/雪林山地（`grove`）
  spawnBiomes: ['taiga', 'snowy_taiga', 'forest', 'grove'],
  bodyColor: 0xd9d9d9,
  accentColor: 0xaeaeae,
  eyeHeight: 0.7,
};

/**
 * 猫（批次 242）。驯服物是**生鱼**（鳕鱼/鲑鱼），与豹猫共用一条链。
 *
 * ⚠️ 生成差异：原版猫只随村庄/女巫小屋出现，本项目还没有"结构里刷生物"这条通道，
 * 所以让它像普通动物一样在村镇群系（平原/向日葵平原/草甸）自然刷——
 * 不这么写它就只能在创造模式里见到（与村民 `naturalSpawn: false` 那一课反着来）。
 */
export const CAT_TYPE: MobType = {
  id: 'cat',
  name: '猫',
  health: 10,
  width: 0.6,
  height: 0.7,
  speed: 1.6,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 2,
  feed: [Item.COD, Item.SALMON],
  tameWith: [Item.COD, Item.SALMON],
  tameChance: 1 / 3,
  spawnBiomes: ['plains', 'sunflower_plains', 'meadow'],
  bodyColor: 0xd9a05b,
  accentColor: 0x8a5a26,
  eyeHeight: 0.55,
};

/**
 * 豹猫（批次 242）。丛林里那一只，驯服物与猫相同（生鱼）。
 *
 * ⚠️ 与原版的差异：原版驯服后会**变成猫**，本项目没有"换种类"的通道
 * （模型/碰撞盒/掉落都按 `type` 定死了），所以驯服后仍显示为豹猫。
 * 写在这里，免得被当成 bug。
 */
export const OCELOT_TYPE: MobType = {
  id: 'ocelot',
  name: '豹猫',
  health: 10,
  width: 0.6,
  height: 0.7,
  speed: 1.6,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 2,
  feed: [Item.COD, Item.SALMON],
  tameWith: [Item.COD, Item.SALMON],
  tameChance: 1 / 3,
  spawnBiomes: ['jungle'],
  bodyColor: 0xe0b04a,
  accentColor: 0x8a6a2a,
  eyeHeight: 0.55,
};

/**
 * 狐狸（批次 242）。
 *
 * **不可驯服**（原版也不能）：它只是会跟着甜浆果丛/玩家手里的甜浆果走，
 * 所以只有 `feed`、没有 `tameWith`——`useOnEntity` 会落到"喂食/繁殖"那条路。
 * 掉落为空（原版狐狸不掉东西）。
 */
export const FOX_TYPE: MobType = {
  id: 'fox',
  name: '狐狸',
  health: 10,
  width: 0.6,
  height: 0.7,
  speed: 1.8,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 2,
  feed: Item.SWEET_BERRIES,
  spawnBiomes: ['taiga', 'snowy_taiga', 'grove'],
  bodyColor: 0xd9772f,
  accentColor: 0xf2ece2,
  eyeHeight: 0.55,
};

/**
 * 马（批次 253）：第一只**可骑乘**的生物（见 `core/entity/Horse.ts`）。
 *
 * 驯服用苹果（原版是反复骑乘），骑乘不要求鞍（鞍还没做）。
 */
export const HORSE_TYPE: MobType = {
  id: 'horse',
  name: '马',
  health: 20,
  width: 1.0,
  height: 1.5,
  speed: 2.6,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 2,
  feed: Item.WHEAT,
  tameWith: Item.APPLE,
  tameChance: 1 / 3,
  spawnBiomes: ['plains', 'sunflower_plains', 'meadow', 'savanna'],
  bodyColor: 0x8a5a34,
  accentColor: 0x53331a,
  eyeHeight: 1.2,
};

/** 驴（批次 253）：比马小一圈、慢一点，同样能骑 */
export const DONKEY_TYPE: MobType = {
  id: 'donkey',
  name: '驴',
  health: 18,
  width: 0.9,
  height: 1.35,
  speed: 2.2,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 2,
  feed: Item.WHEAT,
  tameWith: Item.APPLE,
  tameChance: 1 / 3,
  spawnBiomes: ['plains', 'sunflower_plains', 'meadow', 'savanna'],
  bodyColor: 0x8f8a80,
  accentColor: 0x5d5850,
  eyeHeight: 1.1,
};

/** 骡（批次 253）：原版不能自然生成，这里给平原/草甸让它能被看到 */
export const MULE_TYPE: MobType = {
  id: 'mule',
  name: '骡',
  health: 20,
  width: 0.9,
  height: 1.4,
  speed: 2.3,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 2,
  feed: Item.WHEAT,
  tameWith: Item.APPLE,
  tameChance: 1 / 3,
  spawnBiomes: ['plains', 'meadow'],
  bodyColor: 0x6e5a44,
  accentColor: 0x453426,
  eyeHeight: 1.15,
};

/** 羊驼（批次 253）：队伍里那一只；目前与马同一套骑乘 */
export const LLAMA_TYPE: MobType = {
  id: 'llama',
  name: '羊驼',
  health: 20,
  width: 0.9,
  height: 1.4,
  speed: 2.4,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 2,
  feed: Item.WHEAT,
  tameWith: Item.APPLE,
  tameChance: 1 / 3,
  spawnBiomes: ['savanna', 'meadow'],
  bodyColor: 0xd8c9a8,
  accentColor: 0x9c8a68,
  eyeHeight: 1.15,
};

/**
 * 兔子（批次 259）：被动生物第二批。
 *
 * 体型小、跑得快；吃胡萝卜。**无掉落**（原版的兔皮/兔肉本项目还没有那两件物品，
 * 不给"假掉落"）。
 */
export const RABBIT_TYPE: MobType = {
  id: 'rabbit',
  name: '兔子',
  health: 3,
  width: 0.4,
  height: 0.4,
  speed: 2.2,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 1,
  feed: [Item.CARROT, Item.GOLDEN_CARROT],
  spawnBiomes: ['plains', 'sunflower_plains', 'desert', 'taiga', 'snowy_plains', 'meadow', 'forest'],
  bodyColor: 0xcbb49a,
  accentColor: 0xf2efe8,
  eyeHeight: 0.3,
};

/** 山羊（批次 259）：山地那只，吃小麦；无掉落（原版只掉角，本项目没有） */
export const GOAT_TYPE: MobType = {
  id: 'goat',
  name: '山羊',
  health: 10,
  width: 0.9,
  height: 1.1,
  speed: 2.0,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 2,
  feed: Item.WHEAT,
  spawnBiomes: ['windswept_hills', 'stony_peaks', 'snowy_slopes', 'meadow'],
  bodyColor: 0xcdc5b4,
  accentColor: 0x8a8272,
  eyeHeight: 0.9,
};

/** 鳕鱼（批次 259）：水里的小鱼，钓上来就是它自己 */
export const COD_TYPE: MobType = {
  id: 'cod',
  name: '鳕鱼',
  health: 3,
  width: 0.5,
  height: 0.3,
  speed: 1.4,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [{ itemId: Item.COD, min: 1, max: 1 }],
  xp: 1,
  aquatic: true,
  spawnInWater: true,
  ignoreLight: true,
  spawnBiomes: ['ocean', 'deep_ocean', 'warm_ocean', 'frozen_ocean'],
  bodyColor: 0xb9a06a,
  accentColor: 0xe8dec4,
  eyeHeight: 0.2,
};

/** 鲑鱼（批次 259）：与鳕鱼同一条水生路径，只是颜色与体型不同 */
export const SALMON_TYPE: MobType = {
  id: 'salmon',
  name: '鲑鱼',
  health: 3,
  width: 0.6,
  height: 0.4,
  speed: 1.5,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [{ itemId: Item.SALMON, min: 1, max: 1 }],
  xp: 1,
  aquatic: true,
  spawnInWater: true,
  ignoreLight: true,
  spawnBiomes: ['ocean', 'deep_ocean', 'warm_ocean', 'frozen_ocean'],
  bodyColor: 0xa8473f,
  accentColor: 0xd9c6b8,
  eyeHeight: 0.25,
};

/** 海豚（批次 259）：海洋里的大只水生生物，掉 0~1 条鳕鱼（原版如此） */
export const DOLPHIN_TYPE: MobType = {
  id: 'dolphin',
  name: '海豚',
  health: 10,
  width: 0.9,
  height: 0.6,
  speed: 2.6,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [{ itemId: Item.COD, min: 0, max: 1 }],
  xp: 2,
  aquatic: true,
  spawnInWater: true,
  ignoreLight: true,
  // 原版海豚只在非冻洋出现（冻洋里会冻死），这里跟着收窄
  spawnBiomes: ['ocean', 'deep_ocean', 'warm_ocean'],
  bodyColor: 0x7f97a8,
  accentColor: 0xd8e2ea,
  eyeHeight: 0.4,
};

/** 熊猫（批次 260）：丛林里吃竹子；无掉落（原版只掉竹子，本项目给的是方块，不重复给） */
export const PANDA_TYPE: MobType = {
  id: 'panda',
  name: '熊猫',
  health: 20,
  width: 1.0,
  height: 1.1,
  speed: 1.6,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 2,
  feed: Block.BAMBOO,
  spawnBiomes: ['jungle'],
  bodyColor: 0xf0efe9,
  accentColor: 0x2a2a2e,
  eyeHeight: 0.9,
};

/** 北极熊（批次 260）：雪原系，掉 0~2 条鳕鱼（原版就是鱼） */
export const POLAR_BEAR_TYPE: MobType = {
  id: 'polar_bear',
  name: '北极熊',
  health: 30,
  width: 1.2,
  height: 1.2,
  speed: 2.2,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [{ itemId: Item.COD, min: 0, max: 2 }],
  xp: 3,
  feed: [Item.COD, Item.SALMON],
  spawnBiomes: ['snowy_plains', 'snowy_taiga', 'snowy_slopes'],
  bodyColor: 0xf2f0e6,
  accentColor: 0xc9c4b4,
  eyeHeight: 1.0,
};

/**
 * 海龟（批次 260）。
 *
 * ⚠️ 生成差异：原版在**沙滩**产卵，而本项目的陆地刷怪判据只认草地/雪层（沙子不在其中），
 * 所以这里改成"水里刷"（`spawnInWater`）——不然它只能靠刷怪蛋见到。
 */
export const TURTLE_TYPE: MobType = {
  id: 'turtle',
  name: '海龟',
  health: 30,
  width: 0.9,
  height: 0.4,
  speed: 0.9,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 2,
  aquatic: true,
  spawnInWater: true,
  ignoreLight: true,
  spawnBiomes: ['ocean', 'deep_ocean', 'warm_ocean'],
  bodyColor: 0x4f7f52,
  accentColor: 0x9fc27a,
  eyeHeight: 0.3,
};

/**
 * 美西螈（批次 260）。
 *
 * ⚠️ 生成差异：原版在繁茂洞穴的水里，本项目没有独立洞穴群系，改为暖海/海洋。
 */
export const AXOLOTL_TYPE: MobType = {
  id: 'axolotl',
  name: '美西螈',
  health: 14,
  width: 0.5,
  height: 0.4,
  speed: 1.4,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 2,
  aquatic: true,
  spawnInWater: true,
  ignoreLight: true,
  spawnBiomes: ['warm_ocean', 'ocean'],
  bodyColor: 0xe9a6b6,
  accentColor: 0xc76f87,
  eyeHeight: 0.3,
};

/**
 * 蝙蝠（批次 261）：唯一会飞的被动生物（见 `core/entity/Bat.ts`）。
 *
 * ⚠️ `naturalSpawn: false`：原版刷在洞穴，本项目没有"洞穴地面"这条刷怪通道
 * （高度图给的是世界表面），所以只能靠刷怪蛋/命令出现——理由写在 `Bat.ts` 顶部。
 */
export const BAT_TYPE: MobType = {
  id: 'bat',
  name: '蝙蝠',
  health: 6,
  width: 0.5,
  height: 0.4,
  speed: 2.4,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 0,
  flying: true,
  naturalSpawn: false,
  spawnBiomes: ['plains', 'forest', 'taiga', 'jungle'],
  bodyColor: 0x4a4038,
  accentColor: 0x2a231d,
  eyeHeight: 0.3,
};

export const MOB_TYPES: readonly MobType[] = [
  BLAZE_TYPE,
  GHAST_TYPE,
  SPIDER_TYPE,
  CAVE_SPIDER_TYPE,
  ENDERMAN_TYPE,
  WITHER_SKELETON_TYPE,
  // 史莱姆三档（批次 120）：只有"大"会自然刷，中/小从分裂里出现
  SLIME_BIG_TYPE,
  SLIME_TYPE,
  SLIME_SMALL_TYPE,
  // 岩浆怪三档（批次 121）：同一个取舍——只有"大"自然刷，另两档从分裂里来
  MAGMA_CUBE_BIG_TYPE,
  MAGMA_CUBE_TYPE,
  MAGMA_CUBE_SMALL_TYPE,
  // 僵尸猪灵（批次 122）：第一只"平时不打人、打了会招来一群"的敌对生物
  ZOMBIE_PIGLIN_TYPE,
  // 溺尸（批次 123）：主世界水里那一只，也是三叉戟的唯一来源
  DROWNED_TYPE,
  // 尸壳（批次 124）：沙漠里的僵尸变体，白天不烧、打人让人饥饿
  HUSK_TYPE,
  // 流浪者（批次 125）：雪原里的骷髅变体，箭上带"缓慢"
  STRAY_TYPE,
  // 幻翼（批次 126）：天上那只"失眠怪"——**不进自然生成表**，只由失眠触发
  PHANTOM_TYPE,
  // 鱿鱼（批次 189）：海里那只，墨囊/黑色染料唯一的来源
  SQUID_TYPE,
  // 驯养系（批次 242）：狼 / 猫 / 豹猫 / 狐狸——前三种能驯服，狐狸只能喂甜浆果
  WOLF_TYPE,
  CAT_TYPE,
  OCELOT_TYPE,
  FOX_TYPE,
  // 骑乘系（批次 253）：与宠物同一套驯服通道，差别是能骑
  HORSE_TYPE,
  DONKEY_TYPE,
  MULE_TYPE,
  LLAMA_TYPE,
  // 被动生物第二批（批次 259）：兔子 / 山羊 / 鳕鱼 / 鲑鱼 / 海豚
  RABBIT_TYPE,
  GOAT_TYPE,
  COD_TYPE,
  SALMON_TYPE,
  DOLPHIN_TYPE,
  // 被动生物第三批（批次 260）：熊猫 / 北极熊 / 海龟 / 美西螈
  PANDA_TYPE,
  POLAR_BEAR_TYPE,
  TURTLE_TYPE,
  AXOLOTL_TYPE,
  // 会飞的那一只（批次 261）
  BAT_TYPE,
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
    // 露天晒太阳会烧（批次 124：这条规则一直到尸壳那一批才补上）
    burnsInDaylight: true,
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
    // 白天的太阳同样烧骷髅（原版如此，见批次 124 的 `world/Daylight.ts`）
    burnsInDaylight: true,
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

/**
 * **所有会掉东西的生物**：普通生物表 + 两个 boss（末影龙、凋灵）。
 *
 * 为什么要单独列一份：两个 boss 都**故意不在 `MOB_TYPES` 里**（它们不该被自然刷），
 * 但它们的掉落当然算"来源"——审计（`test:reach`）与"这件东西有来源吗"那些断言
 * 都得走这一份。少列一只 boss 的症状很具体：**凋灵掉的下界之星被判成"拿不到"**
 * （批次 116 就是这么发现的，当时那份清单是 `[...MOB_TYPES, DRAGON_TYPE]`）。
 */
export const DROPPING_MOB_TYPES: readonly MobType[] = [...MOB_TYPES, DRAGON_TYPE, WITHER_TYPE];

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
 * 这种生物会不会在某个维度自然刷（批次 94，默认主世界）。
 *
 * 抽成函数而不是在两处（刷怪器与测试）各写一遍 `?? 'overworld'`：
 * "默认主世界"这条口径只该有一处（本项目为"同一条判据写两遍"交过学费）。
 *
 * 批次 112 起 `dimension` 允许写**一串**（末影人主世界与末地都刷）——
 * 与 `MobType.feed` 允许写一样或几样是同一个套路：**字段只有一处，怎么判只有这里**。
 */
export function mobSpawnsIn(
  type: MobType,
  dimension: 'overworld' | 'nether' | 'end' | undefined,
): boolean {
  const list = type.dimension ?? 'overworld';
  const here = dimension ?? 'overworld';
  return typeof list === 'string' ? list === here : list.includes(here);
}

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
