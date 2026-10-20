/**
 * 生物基类
 *
 * 一个生物 = 属性表（MobType）+ 一套通用行为：
 *  - 重力与逐轴碰撞（复用掉落物那套 moveBody）
 *  - **敌对生物**：发现玩家 → 每 0.5 秒重新寻路 → 沿路径靠近 → 进入攻击距离就出手
 *  - **被动生物**：每几秒随机换个方向游荡，并主动避开 ≥3 格的落差（不会成片跳崖自杀）
 *  - 受伤：0.5 秒无敌帧 + 击退 + 短暂红闪；生命归零后掉落物品
 *
 * 生物的高低不同（鸡 0.7 格、牛 1.4 格），寻路的"身体高度"因此按体型算格数，
 * 矮生物能钻过 1 格高的洞，高生物必须要 2 格。
 */

import { Entity, type EntityContext } from './Entity.ts';
import { moveBody } from '../physics/EntityMotion.ts';
import { Block, blockDef, woolId } from '../registry/blocks.ts';
import { Item } from '../registry/items.ts';
import { StatusEffects, type EffectId } from '../survival/StatusEffects.ts';
import {
  ambientIntervalFor,
  mobVoiceFor,
  mobVoicePitchFor,
  type MobVoiceEvent,
  type MobVoiceId,
} from '../audio/MobVoices.ts';
import { shouldChasePlayer } from './ChaseRules.ts';
import { opensDoors } from './DoorRules.ts';
import { Pathfinder, type PathPoint } from './Pathfinder.ts';

/** 与玩家一致的常量（原版数值） */
/** 苦力怕引信时长（秒） */
/**
 * 剪过之后羊毛长回来的时间（秒）。
 * 原版是"吃草长回来"，我们没有啃草皮这件事，用计时器代替。
 */
export const WOOL_REGROW_SECONDS = 30;

export const CREEPER_FUSE_TIME = 1.5;

/** 手上的食物能把动物引过来的距离（格，原版约 8 格） */
export const TEMPT_RANGE = 8;
/** 引到这么近就停下来（否则动物会一直顶着玩家推） */
export const TEMPT_FOLLOW_STOP = 1.6;

/** 幼体的体型比例（原版大约是一半） */
export const BABY_SCALE = 0.55;
/**
 * 幼体长成成年需要的时间（秒）。
 * ⚠️ 原版是 20 分钟，这里缩到 5 分钟——单机验收场景下 20 分钟太久，
 * 而"能不能长大"这件事本身没有别的观测手段。
 */
export const BABY_GROW_SECONDS = 300;
/** 求爱持续时长（秒，原版 30 秒） */
export const LOVE_SECONDS = 30;
/** 繁殖后的冷却（秒，原版 5 分钟，这里同样缩短） */
export const BREED_COOLDOWN_SECONDS = 60;
/** 求爱时靠多近才能配对（格） */
export const MATE_RANGE = 2.5;
/** 求爱时能"看见"配偶的距离（格） */
export const MATE_SEARCH_RANGE = 8;

/** 已驯服的宠物跟到这么近就停下（格）——与"被食物吸引"同一条手感，不顶着玩家推 */
export const PET_FOLLOW_STOP = 2.2;

/**
 * 被拴绳牵着时，动物跟到这么近就停下（格，批次 256）。
 *
 * 比宠物跟随（2.2）远一些：绳子本来就有 4 格余量，贴太近会像"被吸在身上"。
 * 超过这个距离就朝主人走——**不传送**（牵着的东西突然瞬移会很怪）。
 */
export const LEASH_STOP = 3.5;
/**
 * 已驯服的宠物离主人超过这个距离就**传送**过去（格）。
 *
 * 原版狼/猫也是这个套路：玩家跑远了它会直接出现在身边（不然永远追不上，
 * 而"宠物"这一层玩法的核心就是"它一直在"）。坐着的不传送。
 */
export const PET_TELEPORT_RANGE = 16;
/** 宠物一次踢到主人身边就传送成功（与末影人的瞬移共用 `teleportNear`） */
export const PET_TELEPORT_MIN = 1.5;
export const PET_TELEPORT_MAX = 3;

/**
 * 鸡下蛋的间隔（秒）：原版是 5~10 分钟一个蛋（`6000~12000` tick）。
 * 鸡蛋在生存里的**唯一来源**就是这里，所以这个节奏不能"为了好测"改短——
 * 改了就等于凭空提高产蛋率。
 */
export const EGG_LAY_INTERVAL_MIN = 300;
export const EGG_LAY_INTERVAL_MAX = 600;
/** 状态效果的结算频率（秒）：与玩家的状态效果同频（20Hz） */
const EFFECT_STEP = 0.05;

/**
 * 环境叫能被听到的距离（格，批次 232）。
 *
 * 引擎那边还有 32 格的硬上限；这里提前一档是为了**不做无用功**：
 * 一只在 30 格外哼唧的牛，就算合成出来也听不见，还会占并发名额。
 */
const AMBIENT_HEARING = 24;

const GRAVITY = 32;
const JUMP_SPEED = 8.95;
/**
 * 水生生物泡在水里时的上浮速度（格/秒，批次 189）。
 *
 * 只是"朝这个速度收敛"，不是硬给：所以鱿鱼看起来是在水里慢慢上下漂，
 * 而不是像电梯一样匀速上升。0.35 大约是原版鱿鱼上下摆动的一半。
 */
const AQUATIC_DRIFT_SPEED = 0.35;
/** 水生生物上岸后多久开始窒息（秒）与窒息间隔（秒） */
const AQUATIC_SUFFOCATE_DELAY = 10;
const AQUATIC_SUFFOCATE_INTERVAL = 1;
/** 受击后的无敌时间（秒） */
const HURT_COOLDOWN = 0.5;
/**
 * 爬墙速度（格/秒，批次 93 蜘蛛）。
 *
 * 原版蜘蛛的爬升是"贴着墙就有上行的速度"，约 0.5 格/秒慢爬与 3 格/秒快爬之间；
 * 这里取 3——**必须比跳跃（8.95）小**，否则它会比玩家跳得还快，
 * 在墙边看着像弹射；也不能太小，不然 3 格高的墙要爬十秒。
 */
const CLIMB_SPEED = 3;
/**
 * 被攻击后的"记仇"时长（秒，批次 93 蜘蛛在亮处也照样打）。
 *
 * ⚠️ 简化：本项目的 `hurt()` 不认识"谁打的"，所以**任何**伤害（含摔伤/着火）
 * 都会让它记仇。原版只有"玩家打的"才会——写在这里，别当成原版行为（见 TASKS J15）。
 */
const ANGER_SECONDS = 10;

/**
 * 伤害来源（批次 471）。
 *
 * 之前 `hurt()` 不认识"谁打的"，于是三处行为都只能用"任意伤害"近似：
 *  * 记仇（蜘蛛/末影人）：被火烧、被摔也会翻脸；
 *  * 群体激怒（僵尸猪灵）：同伴被岩浆烫到，整群一起冲过来；
 *  * 末影人挨打瞬移：摔一跤也会闪走（原版只有被打才闪）。
 *
 * 现在调用方把来源传进来，上面三条只认 `'player'` / `'mob'`；
 * `'environment'`（摔伤/着火/爆炸/闪电/龙息）不惊动任何人。
 *
 * ⚠️ 队友免伤还需要"玩家与玩家之间"的判定——那是联机会话的事，
 * 这里只把"谁打的"这条链路铺好（`sameTeam` 已经在 `world/Teams.ts` 里等着）。
 */
export interface HurtSource {
  readonly kind: 'player' | 'mob' | 'environment';
  /** 玩家名（`kind = 'player'` 时可选） */
  readonly name?: string;
  /** 造成伤害的那只生物（`kind = 'mob'` 时可选；循环引用所以用 unknown 存） */
  readonly mobId?: string;
}

/**
 * 玩家碰撞盒高度（格，批次 225）。与 `PlayerPhysics.height` 同源；
 * 实体层只要判断"竖直方向有没有重叠"，不必为此依赖玩家物理模块。
 */
const PLAYER_BODY_HEIGHT = 1.8;
/**
 * 近战允许的**竖直间隙**（格，批次 225）。
 *
 * 1 表示"站在相邻台阶（一格高差）上还够得着，隔着一整层地板/天花板够不着"。
 * 只查水平距离的下场见 `canMeleeReach`。
 */
const MELEE_VERTICAL_GAP = 1;
/** 近战视线的采样步长（格）：2~2.5 格的触及距离下最多 7 次 `getBlock` */
const MELEE_SIGHT_STEP = 0.4;

/**
 * 追人时"贴到这么近就直线走过去、不跑 A*"（格²，批次 500）。
 *
 * 2 格：这个距离上任何绕路都没有意义，而每帧重算 A* 的代价却是实打实的
 * （见 `updateAi` 里那段注释）。
 */
const NEAR_DIRECT_RANGE_SQ = 4;
/** 同上：只有**同一高度**才走直线；高度差超过 1.5 格仍交给寻路（玩家在柱子/崖上） */
const NEAR_DIRECT_MAX_DY = 1.5;

/**
 * 跳跃式移动（批次 120，史莱姆）的三个数：
 *  - `HOP_SPEED` 是**起跳那一瞬间**给的向上速度（原版约 0.42 格/tick ≈ 8 格/秒的初速，
 *    这里取小一点：本项目的地形更密，跳太高会一直撞天花板）；
 *  - 两次跳跃之间隔 `HOP_INTERVAL_MIN~MAX` 秒的**落地时间**（它只在落地时倒数，
 *    所以"跳一次 → 落地歇一下 → 再跳"这个节奏是天然的）。
 */
const HOP_SPEED = 4.2;
const HOP_INTERVAL_MIN = 0.55;
const HOP_INTERVAL_MAX = 1.4;
/** 分裂出几只（原版 2~4） */
const SPLIT_COUNT_MIN = 2;
const SPLIT_COUNT_MAX = 4;
/** 站在岩浆块上多久掉一次血（秒；原版每秒 1 点） */
const MAGMA_DAMAGE_INTERVAL = 1;

/**
 * 末影人的瞬移距离（格，原版 32）：受击逃脱、泡水淋雨逃开、空闲挪窝都按它来。
 */
export const TELEPORT_RANGE = 32;
/**
 * 一次瞬移最多试几个落点。试不到就**不瞬移**——宁可留在原地，
 * 也不要为了"瞬移成功"而卡进石头里（那是比不瞬移严重得多的问题）。
 */
export const TELEPORT_ATTEMPTS = 16;
/** 被注视激怒之后，瞬移到玩家附近多远（格）：原版是"贴到你身边再开打" */
export const STARE_TELEPORT_MIN = 3;
export const STARE_TELEPORT_MAX = 12;
/**
 * 受伤时瞬移的概率。
 *
 * ⚠️ 原版按**伤害来源**分：被弹射物打中必躲、被近战砍则还手（还有一半概率躲）。
 * 本项目的 `hurt()` 不认识伤害来源（与蜘蛛那条"记仇"是同一处简化），
 * 所以统一折成一半概率——既保留了"打一下它就闪掉"的手感，又不至于近战完全打不着。
 */
export const TELEPORT_ON_HURT_CHANCE = 0.5;
/** 空闲时多久挪一次窝（秒）：原版末影人也是隔一阵子就出现在别处 */
export const IDLE_TELEPORT_MIN = 12;
export const IDLE_TELEPORT_MAX = 24;
/** 泡水/淋雨的掉血间隔（秒，原版 20 tick = 1 秒掉 1 点） */
export const WATER_DAMAGE_INTERVAL = 1;

export interface MobDrop {
  itemId: number;
  min: number;
  max: number;
  /** 掉落概率 0-1（不填视为 1） */
  chance?: number;
}

/**
 * 生物家族：只用于附魔的分流（亡灵杀手 / 节肢杀手）。
 * 原版是给每种生物打 `#undead` / `#arthropod` 标签，这里在种类表上写一个字段就够了。
 */
export type MobFamily = 'undead' | 'arthropod';

/** 生物种类定义（数据表在 mobs.ts） */
export interface MobType {
  id: string;
  name: string;
  health: number;
  /** 碰撞盒（宽 = 深） */
  width: number;
  height: number;
  /** 常规移动速度（格/秒） */
  speed: number;
  /** 敌对生物会主动追玩家并攻击 */
  hostile: boolean;
  attackDamage: number;
  /** 发现玩家的距离（格） */
  followRange: number;
  drops: readonly MobDrop[];
  /** 击杀经验（原版数值：敌对 5 点、被动 1~3 点） */
  xp: number;
  /**
   * 喂什么能繁殖（J8）。留空表示这种生物不参与繁殖（敌对生物都是空的）。
   *
   * 可以写**一样**（牛羊是小麦）也可以写**几样**（村民吃面包/胡萝卜/马铃薯/甜菜根，
   * J11 批次 88 起）——判定统一走 `mobEats()`，所以"哪些算爱吃"只有一处。
   */
  feed?: number | readonly number[];
  /**
   * **能用什么驯服**（批次 242：狼用骨头、猫与豹猫用生鱼）；不填 = 不可驯服。
   *
   * 与 `feed` 分开写而不是复用：骨头不是狼的食物（它吃生肉），
   * 生鱼同时是猫的食物与驯服物——合成一条会让"喂它繁殖"与"驯服它"分不开。
   * 判定统一走 `mobAcceptsTame()`（与 `mobEats()` 同一个套路）。
   */
  tameWith?: number | readonly number[];
  /** 一次驯服尝试的成功率（不填 = 1/3，原版狼/猫都是三分之一） */
  tameChance?: number;
  /**
   * 会不会**自然刷出来**（默认会）。村民是第一个"不刷"的：
   * 原版它们只随村庄生成，而本项目还没有村庄（见 TASKS J22），
   * 所以村民只能靠命令/刷怪蛋/繁殖出现——不写这一条，`PASSIVE_MOBS` 会把它
   * 当成普通动物撒在草地上（那看起来就像 bug）。
   */
  naturalSpawn?: boolean;
  /**
   * **只在哪个（些）维度自然刷**（默认主世界，批次 94）。
   *
   * 恶魂是第一个用它的：原版它只在下界刷，而在此之前"自然刷怪"根本没有维度概念
   * ——`MobSpawner` 拿的就是"当前维度那份世界"，不写这一条恶魂会跑到主世界的夜里来。
   *
   * 批次 112 起允许写**一串**（末影人主世界与末地都刷）——与 `feed` 一样是
   * "一个字段两种写法"，判定统一走 `mobs.ts` 的 `mobSpawnsIn`。
   */
  dimension?: 'overworld' | 'nether' | 'end' | readonly ('overworld' | 'nether' | 'end')[];
  /**
   * **boss**（批次 116）：不会因为"离玩家太远"而消失（凋灵与末影龙）。
   *
   * 加这一条的原因很实在：`updateMobSpawning` 会把 96 格以外的敌对生物标记为死亡
   * ——对僵尸来说是好事（不然远处会堆一堆），但对 boss 来说是事故：
   * **玩家一跑远，凋灵就没了，那颗下界之星永远拿不到**
   * （末影龙其实也一直有这个问题：跑出末地的战斗区就"打赢了也白打"）。
   */
  boss?: boolean;
  /**
   * **只在某个"区域"里自然刷**（批次 115 起：凋灵骷髅只要塞；批次 120 起：史莱姆只要
   * 史莱姆区块）。
   *
   * 名字从 `spawnStructure` 改成 `spawnZone`（批次 120）：这一条判据后来多了一个用户
   * ——**史莱姆区块**不是"结构"，却同样满足"位置是算出来的、只有主程序答得上来"。
   * 与其再加一个字段（`spawnStructure` + `spawnChunkKind` 两套判据各写一遍），
   * 不如认下这一层抽象：**区域 = 一个由主程序判定的名字**（`'nether_fortress'` /
   * `'slime_chunk'` …），实体层只认识名字，判定交给 `SpawnContext.inZone`。
   */
  spawnZone?: string;
  /**
   * **只在某个高度以下自然刷**（批次 120，史莱姆 y<40）。不填 = 不限。
   *
   * 原版史莱姆只在 y<40 刷（这样它们不会出现在地表），而敌对刷怪那条循环是从
   * `WORLD_MIN_Y+6` 扫到 `HOSTILE_MAX_Y` 的——不写这一条，史莱姆会在山顶冒出来。
   */
  spawnMaxY?: number;
  /**
   * **刷出来时不看光照**（批次 120，史莱姆）。
   *
   * 敌对刷怪的通用判据是"方块光 0 且天光 ≤7"（洞里或夜里），而原版的史莱姆在
   * **史莱姆区块**里白天也照刷——所以这一条是"这一种生物不走那条通用判据"的开关。
   */
  ignoreLight?: boolean;
  /**
   * 自然刷出来时需要的**空腔尺寸**（宽 × 高，格；默认 1×2，也就是"两格高的空气"）。
   *
   * 恶魂 4×4 的体型如果按默认判据刷，会有很大概率**半截卡在岩层里**
   * （原版对它有专门的空间检查）。判据只查"这一格的空气柱"，宽体生物要查周围的列。
   */
  spawnSpace?: { width: number; height: number };
  /**
   * **会飞**（批次 92，烈焰人是第一种）：没有重力，AI 走 `flyAi` 那一套
   * （悬停 + 逼近），地面那套寻路/游荡/繁殖全都不适用。
   *
   * 为什么要一个字段而不是在 `Mob` 里按 id 特判：与 `ranged`/`wool`/`feed`
   * 同一个理由——"这种生物怎么动"是**数据**，行为只认数据
   * （本项目为"按 id 字符串特判"交过学费，见批次 38 的门/活板门）。
   */
  flying?: boolean;
  /**
   * **免疫火焰伤害**（批次 92，烈焰人）：着火时不掉血（但照样会被点燃/显示火）。
   * 与 `flying` 同理，这是数据而不是特判。
   */
  fireImmune?: boolean;
  /**
   * **会爬墙**（批次 93，蜘蛛）：贴着挡路的方块、又有往前的速度时，给一点**向上**的速度
   * （原版蜘蛛就是这么翻墙的）。与 `flying` 的区别是它仍然是"地面生物"：
   * 有重力、走寻路那一套，只是额外能顺着墙往上爬。
   */
  climbing?: boolean;
  /**
   * **跳跃式移动**（批次 120，史莱姆）：不走路，而是"蓄力 → 朝目标跳一下 →
   * 空中不转向"。见 `Mob.hopMove`。
   */
  hops?: boolean;
  /**
   * **被杀死时分裂成什么**（批次 120，史莱姆）：填**下一档更小那一种**的 `id`。
   *
   * 为什么是 id 字符串而不是 `MobType` 引用：`mobs.ts` 引 `Mob.ts`（类型定义），
   * 反过来引就成环了。填 id、由主程序查表（`mobTypeById`）是这一层既有的做法
   * （`MobType.feed` 填的也是 id）。
   */
  splitsInto?: string;
  /** 分裂出几只（原版 2~4）；不填按 `[2, 4]` */
  splitsCount?: readonly [number, number];
  /**
   * **光照够亮就中立**（批次 93，蜘蛛）：亮度 ≥ 这个值时不主动攻击玩家
   * （原版蜘蛛的招牌行为——白天或火把旁边它只会干瞪眼）。
   *
   * 需要一个"这一格多亮"的查询（`EntityContext.lightAt`），而不是把亮度塞进上下文：
   * 亮度是**按坐标查**的，一个值装不下整片世界。
   */
  neutralInLight?: number;
  /**
   * **完全不主动攻击**（批次 112，末影人）：只有被激怒（`angerTimer`，来自"被注视"
   * 或"被打过"）之后才会动手。
   *
   * 与 `neutralInLight` 的区别是**它不看亮度**：末影人白天夜里都一样中立
   * （它在末地那种没有昼夜的地方也照样中立）。
   */
  neutral?: boolean;
  /**
   * **挨打时会惊动多大范围里的同类**（批次 122，僵尸猪灵 32 格）——"群体激怒"。
   *
   * 原版僵尸猪灵平时不主动打人，但你打了其中一只，**周围 32 格里的同类会一起翻脸**。
   * 这条只写半径、不写"怎么找同类"：实体层没有"周围有谁"的视野，
   * 扫描交给 `EntityContext.provokeNearby`（主程序拿着实体表）。
   * 不写 = 不传播（本项目里目前只有僵尸猪灵有这一条）。
   */
  angerRadius?: number;
  /**
   * **被玩家注视多远会激怒**（批次 112，末影人 64 格）。
   *
   * 判据交给上层（`EntityContext.playerGazeAt`）：实体层不持有相机，
   * 而"玩家在看着哪一点"只有主程序算得出来（视线锥 + 视线是否被挡住）。
   */
  stareRange?: number;
  /**
   * **会瞬移**（批次 112，末影人）：受击（一半概率）/ 泡水淋雨 / 空闲时挪窝。
   *
   * 落点由 `Mob.teleportRandomly` 挑（要求能站人、不在水里岩浆里）。
   */
  teleports?: boolean;
  /**
   * **远程攻击扔的是三叉戟**（批次 123，溺尸）。
   *
   * 与 `ranged` 配合用：`ranged` 决定"多远、多久一次、多快"，这一位只决定**扔的是什么**
   * （`true` → `ctx.spawnTrident`，否则 `ctx.spawnArrow`）。弹道那段是共用的——
   * 原版溺尸扔三叉戟与骷髅射箭的瞄准也确实是同一套。
   *
   * ⚠️ 只有同时写了 `ranged` 才有意义（它是远程攻击那条分支里的一个分流）。
   */
  throwsTrident?: boolean;
  /**
   * **生成时手里带三叉戟的概率**（批次 235；只有 `throwsTrident` 的生物用它）。
   *
   * 原版：约 15% 的溺尸带着三叉戟，带的那种**扔出去就没了**。
   * 不复刻这一条的话，远程 AI 的 2.5 秒冷却就变成一个**无限生成器**——
   * 每扔一次落地都 `spawnDrop` 一把新的，海面很快就漂满三叉戟。
   */
  tridentChance?: number;
  /**
   * **它射出的箭命中玩家时挂什么效果**（批次 125，流浪者的"缓慢 30 秒"）。
   *
   * ⚠️ 与 `venom` 分开：那一条是**近战命中**时挂的（蜘蛛/凋灵骷髅/尸壳），
   * 而流浪者根本不会贴上来打——它的招牌全在**箭**上。箭的效果由 `Arrow` 在
   * 命中玩家那一支里结算（见 `ArrowOptions.effect`），所以必须是单独一根数据线。
   */
  arrowEffect?: { effect: EffectId; seconds: number };
  /**
   * **不会走动**（批次 344：潜影贝）。
   *
   * 只影响远程 AI 的"前进/后退"：它站在原地面朝玩家射击。
   * 潜影贝在原版会贴墙/贴天花板，本项目没有"附着面"这一层，先让它落地站住。
   */
  stationary?: boolean;
  /**
   * **只在水中自然刷**（批次 123，溺尸）。
   *
   * 刷怪器默认要求"脚下实心 + 两格空气"，而溺尸要**站在水里**（原版它在水中生成、
   * 或者由溺水的僵尸变来）。这一位把那条判据换成"脚与头都是**水**"——
   * 所以它不需要"脚下一格实心"（海面附近、水柱中间都能刷）。
   */
  spawnInWater?: boolean;
  /**
   * **水生**（批次 189，鱿鱼）：泡在水里时**不受重力**，靠一点浮力上下漂；上岸会掉血。
   *
   * 与 `flying` 的区别：飞行是"完全不管重力、悬在空中"，而它是"**水里**才漂"——
   * 上了岸照样往下掉（原版鱿鱼在岸上是一坨会抽动的软体，几秒后窒息）。
   * 只写 `spawnInWater` 不够：那只管"在哪刷"，刷出来的鱿鱼会直接沉到海底趴着。
   */
  aquatic?: boolean;
  /**
   * 能在**岩浆表面**行走（批次 344：炽足兽）。
   *
   * 只影响竖直方向：脚下是岩浆、上面是空气时贴到液面（0.9），否则缓慢上浮。
   * 水平移动、碰撞、寻路全部沿用普通陆生那一套——它不需要一套新的物理。
   */
  lavaWalker?: boolean;
  /**
   * **只在某几个群系里自然刷**（批次 124 尸壳只要沙漠；批次 125 流浪者要三种雪原）。
   *
   * 填**群系名**（`gen/Biome.ts` 里那些 `desert` / `snowy_plains`），
   * 由 `SpawnContext.biomeAt` 判定——与 `spawnZone`／`spawnInWater` 同一个分工：
   * 实体层不认识世界，只写"要哪几种"。不填 = 不限群系（绝大多数生物如此）。
   *
   * ⚠️ 是**一组**而不是一个：流浪者要在雪原/积雪针叶林/雪坡三处刷，
   * 而"某个生物能在哪些群系刷"本来就是一对多（批次 124 时只有一个用户，
   * 写成单个字符串；批次 125 一撞上多群系就顺手改成一组，免得再开第二个字段）。
   *
   * ⚠️ 原版的做法是"生物群系带生成表"（每个群系列出会刷什么），本项目反过来：
   * **生物自己写它在哪些群系刷**。差别只在"谁列一遍"，而反着写更好读
   * ——"流浪者到底在哪刷"一行就看得到。
   */
  spawnBiomes?: readonly string[];
  /**
   * **露天晒太阳会烧起来**（批次 124，亡灵家族）。
   *
   * 原版这条规则只对**亡灵**成立，而且**尸壳是例外**（它在沙漠里白天照样活动）——
   * 所以它是一根**逐种写**的数据线，而不是"家族是亡灵就烧"的推论。
   * 判据在 `world/Daylight.ts` 的 `sunBurns`（露天 + 白天 + 没下雨）。
   */
  burnsInDaylight?: boolean;
  /**
   * **怕水**（批次 112，末影人）：泡在水里或淋雨时**每秒掉 1 点**，并瞬移逃开。
   *
   * "淋雨"的判据与"火焰被雨浇灭"完全同源（`raining` + 天光 15 = 头顶见天）。
   */
  waterSensitive?: boolean;
  /**
   * **打中玩家时附带的状态效果**（批次 93 洞穴蜘蛛的中毒；批次 115 凋灵骷髅；
   * 批次 124 尸壳的饥饿）。
   *
   * 值域跟着 `StatusEffects` 走：现在用到 `poison`（7 秒）、`wither`（10 秒）
   * 与 `hunger`（尸壳，7 秒）三种。
   * ⚠️ 凋零与中毒的区别**不在这一层**：中毒停在 1 点血、凋零能致死，
   * 那是 `StatusEffects` 里 `damageCause` 决定的（见那边的注释）；
   * 饥饿更是另一条通道（它扣的是**饱食度**，见 `StatusEffects` 的 `hunger` 分支）。
   */
  venom?: { effect: 'poison' | 'wither' | 'hunger'; seconds: number };
  /**
   * 死亡时按**自己身上的颜色**掉羊毛（J8，羊用）。
   * 羊毛不在 `drops` 表里，因为颜色是每只动物各自的——写死在表里就只能掉白色的。
   * 被剪过的羊不掉羊毛（原版行为）。
   */
  wool?: boolean;
  /** 能不能挤奶（J8，牛用）。原版只有牛与山羊可以 */
  milk?: boolean;
  /** 会不会下蛋（K4 尾巴，鸡用）。鸡蛋在生存里的唯一来源 */
  laysEggs?: boolean;
  /** 生物家族（亡灵 / 节肢）：亡灵＝僵尸/骷髅，节肢＝蜘蛛/洞穴蜘蛛（批次 93 起两者都有成员） */
  family?: MobFamily;
  /**
   * 远程攻击配置（J9，骷髅用）。不填就是近战。
   *
   * 有它的生物**不再贴身近战**：进入 `range` 就放箭，同时保持 `keepDistance` 以上的距离
   * （原版骷髅就是这样——贴脸它反而会后退）。
   */
  ranged?: {
    /** 有效射程（格） */
    range: number;
    /** 两箭之间的间隔（秒，实际会再加一点随机抖动） */
    cooldown: number;
    /** 箭的初速（格/秒） */
    speed: number;
    /** 保持的最小距离（格），太近就后退 */
    keepDistance: number;
    /** 射击散布（弧度，0 = 百发百中） */
    spread: number;
  };
  /** 渲染用的主色 / 点缀色 */
  bodyColor: number;
  accentColor: number;
  /**
   * **眼睛的颜色**（批次 112，末影人）。
   *
   * 不填就是人形模型里那份固定的近黑色（僵尸/骷髅/村民都这样，够用）——
   * 但末影人全身纯黑，眼睛正是它唯一的辨识点（原版那两颗紫眼），
   * 近黑的眼珠画在黑身上等于没有眼睛。
   */
  eyeColor?: number;
  /** 眼睛高度（渲染用） */
  eyeHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * 这种生物吃不吃这一件（`feed` 允许写一样或几样）。
 *
 * 抽出来是因为有两个消费方（`updateAi` 里"被手上的食物引过来"与 `feed()` 里"喂它"），
 * 两处各写一遍判定，迟早出现"拿着胡萝卜它跟过来、喂它却说不吃"这种自相矛盾。
 */
export function mobEats(type: MobType, itemId: number): boolean {
  if (type.feed === undefined) return false;
  return typeof type.feed === 'number' ? type.feed === itemId : type.feed.includes(itemId);
}

/** 这件东西能不能用来驯服这一种（批次 242；`tameWith` 允许写一样或几样） */
export function mobAcceptsTame(type: MobType, itemId: number): boolean {
  if (type.tameWith === undefined) return false;
  return typeof type.tameWith === 'number' ? type.tameWith === itemId : type.tameWith.includes(itemId);
}

export class Mob extends Entity {
  readonly type: MobType;

  health: number;
  /** 朝向（渲染用） */
  yaw = 0;
  /** 受击红闪剩余时间 */
  hitFlash = 0;
  /**
   * 幼体（J8）：体型按 `BABY_SCALE` 缩小、**不产出任何掉落与经验**、`BABY_GROW_SECONDS` 后长大。
   */
  baby = false;

  /**
   * 已驯服（批次 242，狼 / 猫 / 豹猫）。
   *
   * 驯服之后：跟随主人、离得太远会被传送过去、右键可以让它坐下/起来。
   * 与"繁殖"无关——生下来的幼体仍然是野生的（原版如此）。
   */
  tamed = false;
  /** 坐下（已驯服的宠物）：不跟随、不游荡，但照样能被喂食 */
  sitting = false;
  /**
   * 被拴绳牵着（批次 256）。
   *
   * 与 `tamed` 分开：拴绳只要求"已驯服"，牵着的动物会**跟着走但不传送**；
   * 真正系在谁身上由主程序记（一次只牵一只），这里只负责"有人牵我"时别乱逛。
   */
  leashed = false;

  /**
   * 手里还有没有三叉戟（批次 235；只有 `throwsTrident` 的生物用）。
   *
   * 这是**个体**状态而不是种类状态：原版约 15% 的溺尸带着三叉戟，扔出去就没了。
   * 没带的那种走近战，扔完的那种也改走近战（`canUseRanged` 判断的就是它）。
   */
  hasTrident = false;

  /** 求爱剩余秒数（>0 表示正在找配偶）与两次繁殖之间的冷却 */
  private loveTimer = 0;
  private breedCooldown = 0;
  /** 幼体的成长计时 */
  private growTimer = BABY_GROW_SECONDS;
  /** 被喂食加速成长的次数（原版喂食能缩短 10% 的成长时间） */
  private fedCount = 0;

  /**
   * 羊毛颜色（`DYE_COLORS` 的下标）与"是否已被剪"（J8，目前只有羊用）。
   *
   * 与原版的差异：原版羊要**吃草**才长回羊毛，我们没有"啃草皮"这件事，
   * 用 30 秒计时器代替——不然剪完一次这只羊就废了。
   */
  woolColor = 0;
  sheared = false;
  private woolTimer = 0;

  /**
   * 着火剩余秒数（J9 的火矢用它）。
   *
   * 着火伤害**不走 `hurt()`**：那样会被 0.5 秒的无敌帧卡成"每 0.5 秒掉 1 点"，
   * 而原版是每 20 tick（1 秒）掉 1 点、且不吃击退。所以单独攒一个计时器。
   */
  burnTime = 0;

  private burnTick = 0;
  /** 远程生物的移动方向（保持距离用）与"正在拉开"标记 */
  protected moveDirX = 0;
  protected moveDirZ = 0;
  private retreating = false;
  /** 距离下一次放箭还有多久 */
  private rangedTimer = 0;
  private hurtTime = 0;
  /** 记仇倒计时（批次 93）：>0 时"亮处中立"的蜘蛛照样追人；末影人也靠它 */
  private angerTimer = 0;
  /**
   * 最后一次伤害的来源（批次 471）。
   *
   * 目前只有测试与调试读它，但它把"这条链是通的"钉住了：
   * 哪天要给死亡消息加上"被 X 杀死"，读这里就够了。
   */
  private lastHurtSource: HurtSource = { kind: 'environment' };
  /** 下一次起跳还要等多久（批次 120，跳跃式移动的生物用；只在**落地**时倒数） */
  private hopTimer = 0;
  /** 泡水/淋雨的掉血计时（批次 112，末影人） */
  private waterTimer = 0;
  /** 空闲瞬移的计时（批次 112）；初值随机，免得一群末影人齐刷刷一起瞬移 */
  private teleportTimer = IDLE_TELEPORT_MIN + Math.random() * (IDLE_TELEPORT_MAX - IDLE_TELEPORT_MIN);
  private attackCooldown = 0;
  /** 悬停相位（飞行生物上下浮动用，见 `flyAi`） */
  protected hoverPhase = 0;
  /** 苦力怕的引信（秒）：贴到玩家身上开始点燃，1.5 秒后炸 */
  private fuse = 0;
  private jumpCooldown = 0;

  /**
   * 身上的状态效果（K4 尾巴：喷溅药水的对象）。
   *
   * 直接复用玩家那套 `StatusEffects`（它不依赖任何其它模块），于是
   * "缓慢 -15%/级""中毒每 25 tick 掉 1 点""力量 +3 点""瞬间伤害 6 点"这些数值**只有一份**——
   * 否则同一瓶药水砸玩家和砸僵尸会是两种效果。
   */
  readonly effects = new StatusEffects();
  /** 效果按 20Hz 推进，这里攒时间片（与玩家那边的结算频率一致） */
  private effectAccumulator = 0;
  /** 下蛋倒计时（秒，仅 `type.laysEggs` 用）；初值随机是为了让一群鸡不要齐刷刷下蛋 */
  private eggTimer = EGG_LAY_INTERVAL_MIN + Math.random() * (EGG_LAY_INTERVAL_MAX - EGG_LAY_INTERVAL_MIN);

  /**
   * 下一次"环境叫"还要等多久（秒，批次 232）。
   *
   * 初值随机而不是固定：一群同类同时刷出来时，"齐声叫"听起来像 bug。
   */
  private ambientTimer = 5 + Math.random() * 12;
  /**
   * 死亡声是否已经播过。
   *
   * 死亡声统一在 `tick` 末尾播（那里能覆盖"被烧死/淹死/岩浆块烫死"这些**不走 `hurt()`**
   * 的死法）；`hurt()` 只负责受伤那一声，致死的那一下不重复播。
   */
  private deathVoiced = false;
  /** 这一只用哪套声音档案（种类不会变，构造时查一次就够） */
  private readonly voiceId: MobVoiceId | null;

  private path: PathPoint[] = [];
  private pathIndex = 0;
  private repathTimer = 0;
  private wanderTimer = 0;
  private wanderYaw = 0;
  /** 朝向被追击目标的单位方向（批次 93）：给"没有路时会爬墙的生物直推"用 */
  private chaseDirX = 0;
  private chaseDirZ = 0;
  /** 游荡时是否停下（一部分时间站着不动，比一直乱走自然） */
  protected idle = false;

  private readonly pathfinder: Pathfinder;
  private sampleBlock: ((x: number, y: number, z: number) => number) | null = null;

  constructor(type: MobType, x: number, y: number, z: number) {
    super(x, y, z, type.width, type.height);
    this.type = type;
    this.health = type.health;
    // 带不带三叉戟是**个体**属性（原版约 15%）：在这里掷一次，而不是按种类写死
    this.hasTrident = type.throwsTrident === true && Math.random() < (type.tridentChance ?? 0);
    // 声音档案按种类查一次（`remote_player` 是 null：玩家角色不该发出动物声音）
    this.voiceId = mobVoiceFor(type.id, type.family);
    // 寻路器只需要"读方块"这一点能力，直接转发给每帧传入的上下文
    this.pathfinder = new Pathfinder({ getBlock: (bx, by, bz) => this.sampleBlock?.(bx, by, bz) ?? 0 });
  }

  /** 寻路用的身体高度（格） */
  private get bodyBlocks(): number {
    return this.type.height > 1.2 ? 2 : 1;
  }

  tick(ctx: EntityContext, dt: number): void {
    this.age += dt;
    this.sampleBlock = ctx.getBlock;

    if (this.angerTimer > 0) this.angerTimer -= dt;
    if (this.hurtTime > 0) this.hurtTime -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.sheared) {
      this.woolTimer -= dt;
      if (this.woolTimer <= 0) this.sheared = false;
    }
    if (this.baby) {
      this.growTimer -= dt;
      if (this.growTimer <= 0) {
        this.baby = false;
        // 长大后体型回到成年：碰撞盒也得跟着换，否则会卡在方块里
        this.width = this.type.width;
        this.height = this.type.height;
      }
    }
    if (this.loveTimer > 0) this.loveTimer -= dt;
    if (this.breedCooldown > 0) this.breedCooldown -= dt;
    this.tickBurning(dt);
    this.tickWaterFear(ctx, dt);
    this.tickAquatic(ctx, dt);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;
    // 效果要在 AI 之前结算：缓慢/速度影响的正是这一帧的移动速度
    this.tickEffects(ctx, dt);
    this.tickEggLaying(ctx, dt);

    this.updateAi(ctx, dt);

    if (this.type.flying) {
      // 飞行生物（批次 92）：**没有重力**——`vy` 由 `flyAi` 直接给（悬停/升降）。
      // 这里只做一点阻尼，免得"上一帧的上升速度"永远留着（那样它会一直往上飘）。
      // ⚠️ 位置仍然走 `moveBody`：飞**不等于穿墙**（撞到方块照样被拦下）
      this.vy *= Math.max(0, 1 - 2.5 * dt);
    } else if (this.type.lavaWalker === true && this.inLava(ctx)) {
      // 炽足兽（批次 344）：脚下是岩浆、上面是空气 → 贴液面；否则缓慢上浮
      const bx = Math.floor(this.x);
      const bz = Math.floor(this.z);
      const feet = ctx.getBlock(bx, Math.floor(this.y), bz);
      const above = ctx.getBlock(bx, Math.floor(this.y) + 1, bz);
      if (feet === Block.LAVA && above === Block.AIR) {
        this.y = Math.floor(this.y) + 0.9;
        this.vy = 0;
      } else {
        this.vy += (1 - this.vy) * Math.min(1, 6 * dt);
      }
    } else if (this.type.aquatic === true && this.inWater(ctx)) {
      // 水生生物（批次 189，鱿鱼）：**水里没有重力**，朝"每秒 0.35 格的上浮"收敛再阻尼。
      // 不这么做的话，刷在水里的鱿鱼会直接沉到海底、贴着沙面走（看着像坏了）。
      // 上岸它就掉回普通重力那一条（原版鱿鱼在岸上也是一坨软体）
      this.vy += (AQUATIC_DRIFT_SPEED - this.vy) * Math.min(1, 4 * dt);
      this.vy = Math.max(-1.2, Math.min(1.2, this.vy));
    } else {
      this.vy -= GRAVITY * dt;
      if (this.vy < -60) this.vy = -60;
      this.applyClimbing(ctx);
    }

    moveBody(ctx.world, this, this.vx * dt, this.vy * dt, this.vz * dt);

    // 掉出世界
    if (this.y < -80) this.dead = true;

    // 朝向跟着实际速度走
    if (Math.abs(this.vx) > 0.05 || Math.abs(this.vz) > 0.05) {
      this.yaw = Math.atan2(this.vx, this.vz);
    }

    // 被烧死的情况在 tickBurning 里只标了 dead，掉落要在这里补上——
    // 否则"用火矢烧死"会变成怪物凭空消失（比被砍死少一条掉落路径）
    if (this.dead && !this.lootDropped) {
      this.lootDropped = true;
      this.dropLoot(ctx);
    }

    // 史莱姆的分裂（批次 120）：**不挂在掉落的守卫上**——`hurt()` 那条路会自己
    // 当场结算掉落（把 `lootDropped` 置真），挂在同一个条件里就永远不会分裂
    if (this.dead && !this.splitDone) {
      this.splitDone = true;
      this.splitIntoChildren(ctx);
    }

    // 声音（批次 232）：环境叫 + 死亡声。放在最后是因为它不该影响任何行为
    this.tickVoice(ctx, dt);
  }

  /**
   * 声音的每帧结算（批次 232）：环境叫的计时器 + 死亡那一声。
   *
   * 为什么死亡声放在 `tick` 而不是 `hurt()`：`tickBurning` / `tickWaterFear` /
   * `tickAquatic` 这三条死法**都不走 `hurt()`**（否则会被无敌帧卡成半速），
   * 写在 `hurt()` 里就只剩"被砍死"有声音——而"被烧死的猪"同样是玩家会看见的一刻。
   */
  private tickVoice(ctx: EntityContext, dt: number): void {
    if (this.dead) {
      if (!this.deathVoiced) {
        this.deathVoiced = true;
        this.playVoice(ctx, 'death');
      }
      return;
    }
    const voice = this.voiceId;
    if (!voice) return;

    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    const [min, max] = ambientIntervalFor(voice);
    this.ambientTimer = min + Math.random() * (max - min);

    // 远处不出声：省一次合成，也免得"看不见的牛一直在叫"
    const player = ctx.player;
    if (!player) return;
    if (Math.hypot(player.x - this.x, player.y - this.y, player.z - this.z) > AMBIENT_HEARING) return;
    this.playVoice(ctx, 'ambient');
  }

  /**
   * 播一条自己的声音（环境叫 / 受伤 / 死亡）。
   *
   * 音高倍率同时承担两件事：幼体更高（原版如此）、洞穴蜘蛛/小史莱姆更高。
   * 位置取身体中段而不是脚下——脚下贴着地面，听起来像"从地里传出来"。
   */
  private playVoice(ctx: EntityContext | undefined, event: MobVoiceEvent): void {
    if (!ctx?.playMobVoice) return;
    const voice = this.voiceId;
    if (!voice) return;
    ctx.playMobVoice(
      voice,
      event,
      this.x,
      this.y + this.type.height * 0.6,
      this.z,
      mobVoicePitchFor(this.type.id, this.baby),
    );
  }

  /** 分裂是否已结算（与 `lootDropped` 分开：两条路的触发时机不同，见 `tick` 末尾） */
  private splitDone = false;
  /** 岩浆块上掉血的计时（批次 121）：攒够 1 秒掉 1 点（见 `tickMagmaBlock`） */
  private magmaBlockTimer = 0;

  /**
   * 站在**岩浆块**上（批次 121）：每秒掉 1 点血——原版就是 1 点/秒，而且是**火焰伤害**，
   * 所以抗火的生物一滴都不掉（这也是"拿岩浆块做刷怪塔"的原理）。
   *
   * 为什么 `onMagma` 由主程序算好传进来，而不是在这里自己读世界：同一个判据**玩家那边
   * 也要用**（`survivalEnvironment` 的 `onMagma`），写在主程序里才能保证两处同源——
   * 否则哪天"站在哪一格算踩着岩浆块"改了，会变成"玩家掉血、怪不掉"这种半对的状态。
   * 而"每秒一次"需要一个定时器，定时器是实体的状态（与着火、淋雨同一条）。
   */
  tickMagmaBlock(ctx: EntityContext, onMagma: boolean, dt: number): void {
    if (this.dead || this.type.fireImmune === true || !onMagma) {
      this.magmaBlockTimer = 0;
      return;
    }
    this.magmaBlockTimer += dt;
    while (this.magmaBlockTimer >= MAGMA_DAMAGE_INTERVAL) {
      this.magmaBlockTimer -= MAGMA_DAMAGE_INTERVAL;
      // 击退源传**自己脚下**：算出来是零向量，于是只掉血不被推
      this.hurt(1, this.x, this.z, ctx);
    }
  }
  /**
   * 它是**被打死**的吗（批次 120）。
   *
   * 只有"被打死"才会分裂：自然消失（离玩家 96 格被清场）也会把 `dead` 置真，
   * 那时候分裂等于在没人看的地方凭空生一堆史莱姆。
   * 被火烧死、被水泡死都算"打死"（原版那两种也会分裂），所以三处都要置它。
   */
  private diedFromDamage = false;

  /** 掉落是否已结算（防止死亡与着火两条路径重复掉一份） */
  private lootDropped = false;

  /**
   * 爬墙（批次 93，蜘蛛）。
   *
   * 判据只有两条，都是原版那两条：**前面挡着方块**（按朝向取前方那一格、看头部高度）
   * 与**确实在往前走**。满足就给一个向上的速度——位置仍然由 `moveBody` 推，
   * 所以它是一格一格爬上去的，而不是"贴着墙穿上去"。
   *
   * ⚠️ 为什么不直接改 `vy` 让它在空中悬着：那是 `flying` 那一套。
   * 蜘蛛是**地面生物**（有重力、会掉下来），它只是能顺着墙走。
   */
  private applyClimbing(ctx: EntityContext): void {
    if (!this.type.climbing) return;
    const forward = Math.hypot(this.vx, this.vz);
    if (forward < 0.3) return;
    const ahead = 0.3 + this.width * 0.5;
    const fx = Math.floor(this.x + (this.vx / forward) * ahead);
    const fz = Math.floor(this.z + (this.vz / forward) * ahead);
    const fy = Math.floor(this.y + this.height * 0.6);
    const block = ctx.getBlock(fx, fy, fz);
    if (block === Block.AIR || !blockDef(block).solid) return;
    this.vy = Math.max(this.vy, CLIMB_SPEED);
  }

  /**
   * 状态效果结算（K4 尾巴）。
   *
   * 顺序与原版一致：**瞬间效果先结算**（瞬间治疗/伤害不进持续列表），
   * 之后每 0.05 秒推一次持续效果（中毒/凋零掉血、生命恢复回血、时长递减）。
   * ⚠️ **中毒不会致死**（原版停在 1 点血），凋零会——两者在 `StatusEffects` 里是
   * `damageHits` 里的两条记录（各带 `cause`），这里必须逐条分流、不能一刀切。
   */
  private tickEffects(ctx: EntityContext, dt: number): void {
    for (const instant of this.effects.takeInstant()) {
      // 瞬间治疗 I 回 4 点、II 回 8 点；瞬间伤害 I 打 6 点、II 打 12 点（原版数值）
      if (instant.id === 'instant_health') this.heal(4 * (instant.amplifier + 1));
      else this.hurt(6 * (instant.amplifier + 1), 0, 0, ctx);
    }

    if (this.effects.count === 0) {
      this.effectAccumulator = 0;
      return;
    }

    this.effectAccumulator += dt;
    while (this.effectAccumulator >= EFFECT_STEP) {
      this.effectAccumulator -= EFFECT_STEP;
      const result = this.effects.tick();
      for (const hit of result.damageHits) {
        // 中毒停在 1 点血（原版），凋零能致死
        if (hit.cause === 'poison') this.health = Math.max(1, this.health - hit.amount);
        else this.hurt(hit.amount, 0, 0, ctx);
        if (this.dead) return;
      }
      if (result.heal > 0) this.heal(result.heal);
      if (this.dead) return;
    }
  }

  /** 回血（上限是本种生物的生命值；幼体的体型变小但生命上限不变，与原版不同，已在 K4 记档） */
  heal(amount: number): void {
    if (this.dead || amount <= 0) return;
    this.health = Math.min(this.type.health, this.health + amount);
  }

  /**
   * 只推一下、不造成伤害（雪球用）。
   *
   * 为什么不走 `hurt(0)`：`hurt` 对 `amount <= 0` 直接早退（那是"没造成伤害"的语义），
   * 连挨打动画都不会有。原版雪球是 0 伤害 + 有击退，所以需要这条独立路径。
   */
  push(knockbackX: number, knockbackZ: number): void {
    if (this.dead) return;
    const length = Math.hypot(knockbackX, knockbackZ);
    if (length <= 1e-4) return;
    this.vx += (knockbackX / length) * 3;
    this.vz += (knockbackZ / length) * 3;
    this.vy = Math.max(this.vy, 2.2);
    this.onGround = false;
  }

  /** 鸡下蛋（K4 尾巴）：鸡蛋的生存来源，原版节奏 5~10 分钟一个 */
  private tickEggLaying(ctx: EntityContext, dt: number): void {
    if (this.type.laysEggs !== true || this.baby || this.dead) return;
    this.eggTimer -= dt;
    if (this.eggTimer > 0) return;
    this.eggTimer = EGG_LAY_INTERVAL_MIN + Math.random() * (EGG_LAY_INTERVAL_MAX - EGG_LAY_INTERVAL_MIN);
    ctx.spawnDrop(Item.EGG, 1, this.x, this.y + this.height * 0.5, this.z);
  }

  /**
   * 飞行生物的 AI（批次 92，烈焰人是第一种）。子类覆盖它来加自己的招数。
   *
   * 默认行为：**悬停在玩家上方、靠到 2.5 格内就撞上去**；没在追人时原地上下浮动、
   * 偶尔往一个随机方向飘几格。
   *
   * 目标点取"玩家头顶偏后一点"而不是玩家坐标本身：直接追坐标会把它挤进玩家身体里
   * （两个碰撞盒互相推，看起来像在抖），偏出去 1.5 格之后就是原版那种"贴脸盘旋"。
   *
   * ⚠️ 这里只**改速度**，位置仍然由 `tick` 里的 `moveBody` 推进——
   * 于是飞行不穿墙，撞到方块照样被拦下（撞墙时它会贴着墙滑，与原版差不多）。
   */
  protected flyAi(
    ctx: EntityContext,
    dt: number,
    player: { x: number; y: number; z: number } | null,
  ): void {
    this.hoverPhase += dt * 2.4;
    const bob = Math.sin(this.hoverPhase) * 0.35;

    if (!player) {
      // 没目标：上下浮动 + 偶尔往随机方向飘（不赶路，也不落地）
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 3 + Math.random() * 4;
        this.wanderYaw = Math.random() * Math.PI * 2;
      }
      const drift = 4;
      this.flyToward(
        this.x + Math.sin(this.wanderYaw) * drift,
        this.y + bob,
        this.z + Math.cos(this.wanderYaw) * drift,
        dt,
      );
      return;
    }

    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const distance = Math.hypot(dx, dz) || 1;
    const behind = 1.5;
    this.flyToward(
      player.x - (dx / distance) * behind,
      player.y + this.type.height * 0.85 + bob,
      player.z - (dz / distance) * behind,
      dt,
    );

    if (this.attackCooldown <= 0 && this.deliverMelee(ctx, 2.5)) this.attackCooldown = 1;
  }

  /**
   * 近战命中玩家：伤害 + **附带效果**（批次 93 把这件事收成一处）。
   *
   * 收成一处的理由：接触伤害在**两处**发生（飞行生物的 `flyAi` 与地面生物的
   * `updateAi`），各自写一遍"算伤害 + 顺带中毒"的话，迟早只改一处
   * （洞穴蜘蛛的中毒就是这条路径上的第二件事）。
   *
   * **够不够得着也在这里判**（批次 225）：判据只有一处，调用方就不会漏
   * （以前两个调用点各写一遍"水平距离 < 2/2.5"，于是都少了竖直与视线两条）。
   *
   * @returns 真的打中了（没够着返回 false，调用方不要因此进冷却）
   */
  private deliverMelee(ctx: EntityContext, reach: number): boolean {
    const player = ctx.player;
    if (!player || !this.canMeleeReach(ctx, player, reach)) return false;
    // 力量/虚弱影响出手伤害（数值与玩家同源）；虚弱不能把伤害打成负数
    const damage = Math.max(0, this.type.attackDamage + this.effects.attackBonus());
    // 带上生物名：左上角要写"被僵尸攻击"而不是笼统的"受到攻击"（批次 207）
    // 把 `this` 一起传下去（批次 264）：荆棘要靠它反伤"是谁打的"
    ctx.hurtPlayer(damage, this.x, this.z, 'generic', this.type.name, this);
    if (this.type.venom) ctx.afflictPlayer?.(this.type.venom.effect, this.type.venom.seconds);
    return true;
  }

  /**
   * 近战够不够得着玩家（批次 225）：**水平距离 + 竖直间隙 + 视线**三条同时成立。
   *
   * ⚠️ 只查水平距离（`dx² + dz² < 4`）是这一批修掉的 bug：站在地板下的洞里、
   * 墙背后的蜘蛛，水平距离照样 < 2 格，于是**隔着方块每一下都打中玩家**——
   * 玩家看到的是"提示被蜘蛛打了，却完全看不到蜘蛛"（用户 2026-10-18 的导出日志里
   * 13 次 `source: "蜘蛛"` 全是这么来的）。
   * 原版的两条判据正是补上的这两条：触及距离是 **3D** 的（`distanceToSqr`），
   * 出手前还要 `canSee`（眼睛到眼睛的连线不穿方块）。
   *
   * @param reach 水平触及距离（格）：地面生物 2、飞行生物 2.5
   */
  private canMeleeReach(
    ctx: EntityContext,
    player: { x: number; y: number; z: number },
    reach: number,
  ): boolean {
    const dx = player.x - this.x;
    const dz = player.z - this.z;
    if (dx * dx + dz * dz > reach * reach) return false;
    // 竖直：两具身体之间最多隔 MELEE_VERTICAL_GAP 格空气。
    // 少了这一条，"玩家正下方竖井里 5 格的蜘蛛"也够得着
    const gap = Math.max(0, this.y - (player.y + PLAYER_BODY_HEIGHT), player.y - (this.y + this.height));
    if (gap > MELEE_VERTICAL_GAP) return false;
    return this.hasLineOfSight(ctx, player);
  }

  /**
   * 生物胸口到玩家胸口之间有没有**挡光的方块**（批次 225）。
   *
   * 判据用 `opaque` 而不是 `solid`：玻璃、水、树叶挡光与否是另一套语义，
   * 而"看得见"应当允许隔着玻璃/水（原版的 `canSee` 也是忽略这些薄物的）。
   * 两端点不采样：生物/玩家自己陷在方块里时，那不该算作"视线被挡"。
   */
  private hasLineOfSight(
    ctx: EntityContext,
    player: { x: number; y: number; z: number },
  ): boolean {
    const x0 = this.x;
    const y0 = this.y + this.height * 0.5;
    const z0 = this.z;
    const dx = player.x - x0;
    const dy = player.y + PLAYER_BODY_HEIGHT * 0.5 - y0;
    const dz = player.z - z0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / MELEE_SIGHT_STEP));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const block = ctx.getBlock(
        Math.floor(x0 + dx * t),
        Math.floor(y0 + dy * t),
        Math.floor(z0 + dz * t),
      );
      if (blockDef(block).opaque) return false;
    }
    return true;
  }

  /** 朝目标点平滑加速（飞行用；与末影龙那个 `steer` 同一个套路，收在基类里） */
  protected flyToward(x: number, y: number, z: number, dt: number, speed = this.type.speed): void {
    const dx = x - this.x;
    const dy = y - this.y;
    const dz = z - this.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    const factor = Math.min(1, 3.5 * dt);
    this.vx += ((dx / length) * speed - this.vx) * factor;
    this.vy += ((dy / length) * speed - this.vy) * factor;
    this.vz += ((dz / length) * speed - this.vz) * factor;
    this.yaw = Math.atan2(this.vx, this.vz);
  }

  // `protected`（批次 253）：马这类"可骑乘生物"要覆写 AI——骑着时由玩家控制方向，
  // 没骑时仍然走这套游荡/追逐/繁殖
  protected updateAi(ctx: EntityContext, dt: number): void {
    const player = ctx.player;
    const dx = player ? player.x - this.x : 0;
    const dz = player ? player.z - this.z : 0;
    const distanceSq = dx * dx + dz * dz;

    // 亮处中立（批次 93，蜘蛛）与"要不要追玩家"的判据（批次 515）：
    // 六个维度（敌对/中立/亮处/记仇/隐身/距离）收在纯函数里，
    // 这样"为什么这只怪不追我"能逐条断言，而不是读五行 `&&`。
    // 记仇计时由 `hurt()` 按 `HurtSource` 置位（环境伤害不记仇，见批次 471）。
    const chaseInput = {
      hostile: this.type.hostile,
      neutral: this.type.neutral === true,
      neutralInLight: this.type.neutralInLight,
      angerRemaining: this.angerTimer,
      lightLevel: ctx.lightAt?.(this.x, this.y + this.height * 0.5, this.z) ?? 0,
      playerPresent: player !== null,
      playerInvisible: ctx.playerInvisible === true,
      distanceSq,
      followRange: this.type.followRange,
    };

    // **被注视激怒**（批次 112，末影人）：玩家的准星落在它头上就翻脸。
    // 放在 `chasing` 之前：激怒是**这一帧就要生效**的状态改变（原版也是瞪到就翻脸），
    // 下一帧它就会走"追人"那条路。
    if (
      this.type.stareRange !== undefined &&
      this.angerTimer <= 0 &&
      player !== null &&
      distanceSq <= this.type.stareRange * this.type.stareRange
    ) {
      const headY = this.y + this.type.eyeHeight;
      if (ctx.playerGazeAt?.(this.x, headY, this.z) === true) {
        this.angerTimer = ANGER_SECONDS;
        // 原版：瞪回来之后**瞬移到你附近**再动手（"它怎么在我背后"的那一下）
        this.teleportNear(ctx, player);
      }
    }

    // 隐身的玩家不会被盯上（K4 尾巴）：已经追到一半的会停下来（下一帧就不满足条件了）
    const chasing = shouldChasePlayer(chaseInput);

    // 会开门的生物走到门前就把门推开（批次 516）。
    // 放在寻路之后、移动之前：A* 已经把门当可走格，这里只负责让它真的开
    if (chasing && opensDoors(this.type.id)) this.openDoorsAhead(ctx);

    // 朝向目标的单位方向（批次 93）：**没有路时**给会爬墙的生物直推用（见 `move`）
    if (chasing && player) {
      const length = Math.max(1e-4, Math.sqrt(distanceSq));
      this.chaseDirX = dx / length;
      this.chaseDirZ = dz / length;
    }

    // 飞行生物（批次 92）：悬停 + 逼近，走 `flyAi` 那一套。
    // 放在最前面是因为**下面每一条都假设它站在地上**（寻路要"能站人的格子"、
    // 游荡要"避开落差"、繁殖要"走到配偶身边"）——飞行生物一条都不适用
    if (this.type.flying) {
      this.flyAi(ctx, dt, chasing ? player : null);
      return;
    }

    // 被手里的食物吸引：玩家拿着它爱吃的东西走近，它会跟着走（原版行为）。
    // 放在"求爱"之前：正在被引的时候不会乱跑，但求爱仍然优先（毕竟那是在办事）
    // 幼体也认食物（原版小牛一样会跟，而且喂了能快点长大）
    // ⚠️ 坐下的宠物不跟着食物跑（批次 242）：不然"让它坐在这里看家"会被一块肉拐走
    if (!chasing && !this.sitting && player && this.type.feed !== undefined) {
      const bait = ctx.heldItemId?.();
      const distance = Math.sqrt(distanceSq);
      if (bait !== undefined && mobEats(this.type, bait) && distance < TEMPT_RANGE) {
        const length = Math.max(1e-4, distance);
        // 挨到 1.6 格以内就停下（否则会一直顶着玩家推）
        if (distance > TEMPT_FOLLOW_STOP) {
          this.moveDirX = dx / length;
          this.moveDirZ = dz / length;
        }
        this.yaw = Math.atan2(dx, dz);
        this.move(true, dt);
        return;
      }
    }

    // 求爱优先：在找配偶的这段时间里它只想找对象，别的行为都让位
    if (this.loveTimer > 0 && !this.baby && ctx.findMate && ctx.spawnBaby) {
      // 求爱优先于"跟着主人走"：喂了食物的宠物应该去找对象，而不是继续贴着玩家

      const mate = ctx.findMate(this);
      if (mate) {
        const dxm = mate.x - this.x;
        const dzm = mate.z - this.z;
        const distance = Math.hypot(dxm, dzm);
        if (distance <= MATE_RANGE) {
          // 两只都在求爱、而且挨够了近 → 生一只幼体
          this.breedWith();
          mate.breedWith();
          const bx = (this.x + mate.x) / 2;
          const bz = (this.z + mate.z) / 2;
          ctx.spawnBaby(this.type, bx, Math.min(this.y, mate.y), bz);
          ctx.spawnHearts?.(bx, Math.max(this.y, mate.y) + this.type.height, bz);
          return;
        }
        // 朝配偶走过去（直线，不走寻路：就几格距离，够用且不会抖）
        this.moveDirX = dxm / Math.max(1e-4, distance);
        this.moveDirZ = dzm / Math.max(1e-4, distance);
        this.yaw = Math.atan2(dxm, dzm);
        this.move(true, dt);
        return;
      }
      // 没找到对象：原地冒一会儿爱心再回去游荡（原版也会边冒边等）
      ctx.spawnHearts?.(this.x, this.y + this.type.height, this.z, 0.4);
    }

    // ---- 拴绳（批次 256）：被牵着的动物朝主人走，走到绳子够长就停（**不传送**）
    if (this.leashed && player) {
      this.yaw = Math.atan2(dx, dz);
      const leashDistance = Math.sqrt(distanceSq);
      if (leashDistance > LEASH_STOP) {
        const length = Math.max(1e-4, leashDistance);
        this.moveDirX = dx / length;
        this.moveDirZ = dz / length;
        this.move(true, dt);
        return;
      }
      // 绳子还松着：停下等主人，别自己游荡（否则会被拽得一抖一抖）
      this.vx *= Math.max(0, 1 - 8 * dt);
      this.vz *= Math.max(0, 1 - 8 * dt);
      this.idle = true;
      return;
    }

    // ---- 已驯服的宠物（批次 242）：坐下时原地不动；否则跟着主人走，太远就传送过去
    if (this.tamed && player) {
      this.yaw = Math.atan2(dx, dz);
      if (this.sitting) {
        this.vx = 0;
        this.vz = 0;
        this.idle = true;
        return;
      }
      const distance = Math.sqrt(distanceSq);
      if (distance > PET_TELEPORT_RANGE) {
        // 主人跑远了：直接出现在身边（原版狼/猫的招牌行为）。
        // 坐着的宠物不上这条——它们本来就该留在原地看家。
        if (this.teleportNear(ctx, player, PET_TELEPORT_MIN, PET_TELEPORT_MAX)) return;
      } else if (distance > PET_FOLLOW_STOP) {
        const length = Math.max(1e-4, distance);
        this.moveDirX = dx / length;
        this.moveDirZ = dz / length;
        this.move(true, dt);
        return;
      } else {
        // 已经在主人身边：收住脚步后**直接返回**。
        // 不返回会落到下面的"游荡"分支——宠物会绕着主人乱走、顶着人推。
        this.vx *= Math.max(0, 1 - 8 * dt);
        this.vz *= Math.max(0, 1 - 8 * dt);
        this.idle = true;
        return;
      }
    }

    // 远程生物走自己那套（保持距离 + 放箭），不参与近战的寻路追击。
    // 批次 235：**没弹药就不算远程**——没带三叉戟的溺尸走下面的近战寻路。
    if (chasing && player && this.canUseRanged()) {
      this.updateRangedAi(ctx, distanceSq, player, dt);
      this.move(true, dt);
      return;
    }

    if (chasing && player) {
      // ⚠️ **跳跃式移动的生物完全不寻路**（批次 120，史莱姆）：它一跳一跳地靠近，
      // 跳不过去就再跳，不会绕路——所以这里连 A* 都不必跑（那是最贵的一段）。
      // 与"不撞墙"那条取舍一起记在 TASKS J16：原版史莱姆也是撞墙时反复跳。
      if (this.type.hops !== true) {
        // 贴身（水平 2 格内、且同一高度）**不需要 A***：直线走过去就够。
        // ⚠️ 这一段以前是性能黑洞（批次 500）：走到玩家脚下 → `move()` 把路径清空 →
        // 下一帧发现 `path.length === 0` 又重算一次，24 只怪一起贴身时每帧要跑几十次搜索。
        // 高度差 > 1.5 时仍交给寻路（玩家在柱子上/崖上，怪得绕路）。
        const nearDirect =
          distanceSq <= NEAR_DIRECT_RANGE_SQ && Math.abs(player.y - this.y) <= NEAR_DIRECT_MAX_DY;
        if (nearDirect) {
          // 只在真有条路径要扔时才新建数组（空数组也每帧 new 一个就是纯 GC 噪音）
          if (this.path.length > 0) {
            this.path = [];
            this.pathIndex = 0;
          }
          const length = Math.max(1e-4, Math.sqrt(distanceSq));
          this.moveDirX = dx / length;
          this.moveDirZ = dz / length;
        } else {
          this.repathTimer -= dt;
          // 每帧预算（批次 500）：主程序一帧只放行 2 次 A*，避免"所有怪同时重算"。
          // 没拿到预算的怪保持 `repathTimer <= 0`，下一帧再排队（不会丢目标）。
          if (this.repathTimer <= 0 && (ctx.canPathSearch?.() ?? true)) {
            const found = this.pathfinder.find(this.x, this.y, this.z, player.x, player.y, player.z, {
              heightBlocks: this.bodyBlocks,
              // 会开门的生物：把关着的门当可走格（真正开门在 `openDoorsAhead`）
              isDoor: opensDoors(this.type.id) ? ctx.isClosedDoor : undefined,
            });
            this.path = found ?? [];
            this.pathIndex = 0;
            // 找到路：0.5~0.9 秒后再算（原样）。
            // **找不到路：退避 1.2~2.0 秒**——以前 `path.length === 0` 会让它每帧重算，
            // 而一次失败的搜索要把 maxNodes 撑满（洞里/墙后的怪就是这么把帧率吃掉的）。
            this.repathTimer =
              this.path.length > 0 ? 0.5 + Math.random() * 0.4 : 1.2 + Math.random() * 0.8;
          }
        }
      }

      if (this.type.id === 'creeper') {
        // 苦力怕不近战：贴到 3 格内点燃引信，1.5 秒后自爆（原版行为）
        // 已经炸过的就不再点火（实体通常立刻被移除，但测试里会继续 tick）
        if (this.dead) return;
        if (distanceSq < 9) {
          const wasIdle = this.fuse === 0;
          this.fuse += dt;
          if (wasIdle) {
            // 点燃的瞬间给个声响提示，否则玩家来不及跑
            ctx.playSound?.('fuse', this.x, this.y, this.z);
          }
          if (this.fuse >= CREEPER_FUSE_TIME) {
            ctx.explode?.(this.x, this.y + 0.5, this.z, 3);
            this.fuse = 0;
            this.dead = true;
          }
        } else if (this.fuse > 0) {
          // 玩家跑远了 → 引信熄灭（原版会回缩）
          this.fuse = Math.max(0, this.fuse - dt * 2);
        }
      } else if (this.attackCooldown <= 0 && this.deliverMelee(ctx, 2)) {
        // 贴脸就打（原版僵尸的触及距离约 2 格）
        this.attackCooldown = 1;
      }
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 2 + Math.random() * 4;
        this.wanderYaw = Math.random() * Math.PI * 2;
        // 四分之一的概率原地站一会儿
        this.idle = Math.random() < 0.25;
      }

      // 空闲时挪个窝（批次 112，末影人）：原版它就是"一会儿在这儿、一会儿在那儿"。
      // ⚠️ 只在**没在追人**的时候挪——追人时那一下是"逃"或"扑"，见各调用点
      if (this.type.teleports) {
        this.teleportTimer -= dt;
        if (this.teleportTimer <= 0) {
          this.teleportTimer =
            IDLE_TELEPORT_MIN + Math.random() * (IDLE_TELEPORT_MAX - IDLE_TELEPORT_MIN);
          this.teleportRandomly(ctx);
        }
      }
    }

    this.move(chasing, dt);
  }

  /**
   * 这一刻还算不算"远程生物"（批次 235）。
   *
   * 拿三叉戟的生物只有一支：扔出去之后就不再走"保持距离 + 投掷"那一套，
   * 改走近战（原版没带三叉戟的溺尸也是贴上来打）。箭不限量，所以其余远程生物恒为 true。
   *
   * ⚠️ `move()` 里也要读它：那边原来按 `type.ranged` 分流，不改的话，
   * 没三叉戟的溺尸会站在原地看着玩家（AI 在追、移动却走的是"远程站桩"分支）。
   */
  private canUseRanged(): boolean {
    if (this.type.ranged === undefined) return false;
    return this.type.throwsTrident !== true || this.hasTrident;
  }

  /**
   * 远程生物的 AI（J9）。
   *
   * 三件事：**保持距离**（太近后退、太远靠近、射程内站住）、**定期放箭**、**朝向玩家**。
   * 不走 `pathfinder`：远程生物的目标不是"贴上去"，用直线方向就够了；
   * 而寻路每 0.5 秒重算一次，对"保持距离"这种小范围来回反而会抖。
   */
  private updateRangedAi(
    ctx: EntityContext,
    distanceSq: number,
    player: { x: number; y: number; z: number },
    dt: number,
  ): void {
    const ranged = this.type.ranged!;
    const distance = Math.sqrt(distanceSq);
    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const length = Math.max(1e-4, Math.hypot(dx, dz));

    // 前进 / 后退 / 站住
    const approaching = !this.type.stationary && distance > ranged.range * 0.9;
    this.retreating = !this.type.stationary && distance < ranged.keepDistance;
    if (this.retreating) {
      this.moveDirX = -dx / length;
      this.moveDirZ = -dz / length;
    } else if (approaching) {
      this.moveDirX = dx / length;
      this.moveDirZ = dz / length;
    } else {
      this.moveDirX = 0;
      this.moveDirZ = 0;
    }

    // 朝向始终对着玩家（渲染与射击方向都靠它）
    this.yaw = Math.atan2(dx, dz);

    this.rangedTimer -= dt;
    if (this.rangedTimer > 0 || distance > ranged.range) return;
    this.rangedTimer = ranged.cooldown + Math.random() * 0.5;

    // 从眼睛朝玩家胸口射，带一点散布
    const eyeY = this.y + this.type.eyeHeight;
    const targetY = player.y + 1.2;
    const aimX = dx / length;
    const aimZ = dz / length;
    const aimY = (targetY - eyeY) / length;
    const spread = (Math.random() - 0.5) * ranged.spread;
    const cos = Math.cos(spread);
    const sin = Math.sin(spread);

    // ⚠️ 这一段的方向算完之后才分流（批次 123）：**拿三叉戟的生物扔三叉戟**，
    // 其余远程生物扔箭。两者的弹道、散布、出手点共用上面那几行——差别只在"扔的是什么"。
    // ⚠️ 分流要**只有一个出口**：第一版是把新的 if/else 加在原来那句 `spawnArrow` **下面**
    // （两句都留着），于是骷髅每次冷却都会射两箭（3 秒 4 发）——`test:mob` 那条
    // "3 秒最多两箭"当场就红了
    if (this.type.throwsTrident === true) {
      // 没带三叉戟就不该走到这里（`canUseRanged` 已经把它切到近战了）——留一道防线
      if (!this.hasTrident) return;
      // 原版：溺尸只有那一支，扔出去就没了。不扣掉它，每 2.5 秒就会凭空造一把
      // （落地又会 `spawnDrop` 一把），海面很快漂满三叉戟（批次 235 修的就是这个）
      this.hasTrident = false;
      ctx.spawnTrident?.(this.x, eyeY, this.z, {
        x: (aimX * cos - aimZ * sin) * ranged.speed,
        y: aimY * ranged.speed,
        z: (aimX * sin + aimZ * cos) * ranged.speed,
      });
    } else {
      ctx.spawnArrow?.(
        this.x,
        eyeY,
        this.z,
        {
          x: (aimX * cos - aimZ * sin) * ranged.speed,
          y: aimY * ranged.speed,
          z: (aimX * sin + aimZ * cos) * ranged.speed,
        },
        // 力量/虚弱同样作用于远程伤害（原版也如此）。
        // `effect` 是流浪者那一条（批次 125）：箭上带什么效果是**这一箭的属性**，
        // 所以在发射那一刻就交给 `Arrow`，而不是命中时再回来问是谁射的
        {
          fromPlayer: false,
          damage: Math.max(0, this.type.attackDamage + this.effects.attackBonus()),
          ...(this.type.arrowEffect === undefined
            ? {}
            : { effect: { effect: this.type.arrowEffect.effect, seconds: this.type.arrowEffect.seconds } }),
        },
      );
    }
    ctx.playSound?.('bow_shoot', this.x, this.y, this.z);
  }

  /**
   * 守卫指令（批次 474，铁傀儡）：朝 (x, z) 走，直到下一帧再下新指令。
   *
   * 为什么不塞进 `tick` 的目标选择：那里的 `chasing` 一整套都按"追玩家"写死
   * （视线、隐身、宠物跟随、求偶、拴绳…），把守卫硬插进去会牵动每一条分支。
   * 而守卫只需要"朝某点走"——`tick` 的游荡分支本来每帧都读 `moveDir`，
   * 主程序在 `entities.update` **之前**下指令就够了。
   *
   * ⚠️ 顺带把 `wanderTimer` 推后：它到期时会**重新随机一个方向**，
   * 不推的话守卫每 2~6 秒就会突然拐弯一下（看起来像卡住了）。
   */
  guardToward(x: number, z: number): void {
    const dx = x - this.x;
    const dz = z - this.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-4) return;
    this.moveDirX = dx / length;
    this.moveDirZ = dz / length;
    this.yaw = Math.atan2(dx, dz);
    this.idle = false;
    this.wanderTimer = Math.max(this.wanderTimer, 0.6);
  }

  /**
   * 把路径上**前面两格内**的门打开（批次 516）。
   *
   * 只认前两格：远处的门提前开等于给玩家报信，而且门自己会关回去
   * （本项目门不会自动关，但提前开也没有意义）。上下半由主程序的 `openDoor` 一起处理。
   */
  private openDoorsAhead(ctx: EntityContext): void {
    const open = ctx.openDoor;
    if (!open) return;
    const end = Math.min(this.path.length, this.pathIndex + 2);
    for (let i = this.pathIndex; i < end; i++) {
      const node = this.path[i]!;
      const distance = Math.hypot(node.x + 0.5 - this.x, node.z + 0.5 - this.z);
      if (distance > 2.6) break;
      if (ctx.isClosedDoor?.(node.x, node.y, node.z) !== true) continue;
      open(node.x, node.y, node.z);
    }
  }

  /** 守卫的攻击冷却（批次 474）：实体自己记，主程序每帧递减 */
  guardCooldown = 0;

  /**
   * 移动速度倍率（批次 511）：默认 1；子类可覆盖。
   *
   * 第一个用户是村民恐慌（×1.35）。做成钩子而不是给 `Mob` 加 `panicking` 字段，
   * 是因为"恐慌"只属于村民，基类不该认识它。
   */
  protected speedMultiplier(): number {
    return 1;
  }

  protected move(chasing: boolean, dt: number): void {
    // 状态效果直接乘在速度上：缓慢 -15%/级、速度 +20%/级（数值来自 `StatusEffects`，与玩家同源）
    const speed =
      (chasing ? this.type.speed * 1.12 : this.type.speed * 0.5) *
      this.effects.moveSpeedMultiplier() *
      this.speedMultiplier();
    let targetVx = 0;
    let targetVz = 0;

    // 跳跃式移动（批次 120，史莱姆）：这种生物**不走寻路**（它一跳一跳地靠近，
    // 跳不过去就算了），所以直接把这一帧交给 `hopMove` 并跳过下面那三条分支
    if (this.type.hops === true) {
      this.hopMove(chasing, dt);
      return;
    }

    if (this.canUseRanged() || this.moveDirX !== 0 || this.moveDirZ !== 0) {
      // 远程生物（保持距离）与求爱中的生物（走向配偶）：方向由 AI 直接给，不走寻路。
      // ⚠️ 这里必须用 `canUseRanged()` 而不是 `type.ranged`：没三叉戟的溺尸要能寻路贴上去
      targetVx = this.moveDirX * speed;
      targetVz = this.moveDirZ * speed;
      this.moveDirX = 0;
      this.moveDirZ = 0;
    } else if (chasing) {
      while (this.pathIndex < this.path.length) {
        const node = this.path[this.pathIndex]!;
        const dx = node.x + 0.5 - this.x;
        const dz = node.z + 0.5 - this.z;
        const distance = Math.hypot(dx, dz);

        if (distance < 0.45) {
          this.pathIndex++;
          continue;
        }

        targetVx = (dx / distance) * speed;
        targetVz = (dz / distance) * speed;

        // 需要跳上台阶时起跳
        if (node.y > this.y + 0.2 && this.onGround && this.jumpCooldown <= 0) {
          this.vy = JUMP_SPEED;
          this.jumpCooldown = 0.45;
          this.onGround = false;
        }
        break;
      }
      // 走完一段路径：清掉并**尽快**续算（批次 500）。
      // ⚠️ 条件要加 `path.length > 0`：空路径时 `0 >= 0` 也为真，原写法会每帧
      // 新建一个空数组（纯 GC 噪音）；另外续算走的是定时器 + 每帧预算，
      // 不是"同一帧立刻再搜一次"。
      if (this.path.length > 0 && this.pathIndex >= this.path.length) {
        this.path = [];
        this.repathTimer = 0.05 + Math.random() * 0.1;
      }

      // **会爬墙的生物在没有路时朝目标直推**（批次 93）。
      //
      // 为什么必须有这一条：寻路只认"站得住人的格子"，所以"目标在墙顶上"
      // （或者隔着墙）在它眼里**根本没有路**——蜘蛛会站在原地不动，
      // 于是"会爬墙"这件事永远不会发生（这是真正的坑：功能写了但从不触发）。
      // 原版蜘蛛也是这么干的：先贴着墙挤，然后顺着墙爬上去。
      //
      // ⚠️ 只给 `climbing` 的生物开这个口子：不会爬的僵尸直推只会白贴着墙抖，
      // 反而丢掉了"绕路"的手感。
      if (this.type.climbing && this.path.length === 0 && (this.chaseDirX !== 0 || this.chaseDirZ !== 0)) {
        targetVx = this.chaseDirX * speed;
        targetVz = this.chaseDirZ * speed;
      }
    } else if (!this.idle) {
      targetVx = Math.cos(this.wanderYaw) * speed;
      targetVz = Math.sin(this.wanderYaw) * speed;

      // 前方是悬崖就掉头，避免被动生物成群跳崖
      if (this.onGround && this.wouldFall(targetVx, targetVz)) {
        this.wanderYaw += Math.PI * (0.6 + Math.random() * 0.8);
        targetVx = 0;
        targetVz = 0;
      }
    }

    // 平滑加减速（空中转向更迟钝）
    const accel = this.onGround ? 10 : 2.5;
    const factor = Math.min(1, accel * dt);
    this.vx += (targetVx - this.vx) * factor;
    this.vz += (targetVz - this.vz) * factor;
  }

  /**
   * 跳跃式移动（批次 120，史莱姆）。
   *
   * 原版史莱姆的移动就是"原地蓄力 → 朝目标跳一下"，本项目照做，四条规矩：
   *  - **落地**时把水平速度收掉（它不会滑行，落地是"啪"一下停住）并开始计时；
   *  - 计时到点就起跳：`vy = HOP_SPEED`、水平速度朝目标（追人时朝玩家，否则朝游荡方向）；
   *  - **空中不转向**——这是"跳跃式"与"走路"最大的手感差别：跳出去就直着飞，
   *    玩家往旁边一闪就躲开了（原版也是这个手感）；
   *  - 没在追人时朝 `wanderYaw` 跳（与走路的游荡共用同一个方向，不必另开一套）。
   *
   * ⚠️ 它**完全不走寻路**：跳不过去就再跳一次，不会绕路。原版史莱姆也不会绕
   * （它们撞墙时只是反复跳）。差异记在 TASKS J16。
   */
  private hopMove(chasing: boolean, dt: number): void {
    if (this.onGround) {
      const stop = Math.min(1, 12 * dt);
      this.vx -= this.vx * stop;
      this.vz -= this.vz * stop;
      this.hopTimer -= dt;
      if (this.hopTimer > 0) return;
      this.hopTimer = HOP_INTERVAL_MIN + Math.random() * (HOP_INTERVAL_MAX - HOP_INTERVAL_MIN);

      // 方向：追人时用 AI 给的朝向（`chaseDir*`，与"会爬墙的生物直推"读的是同一份），
      // 否则朝游荡方向
      const chasingDir = this.chaseDirX !== 0 || this.chaseDirZ !== 0;
      const yaw =
        chasing && chasingDir ? Math.atan2(this.chaseDirZ, this.chaseDirX) : this.wanderYaw;
      const speed = (chasing ? this.type.speed : this.type.speed * 0.6) * this.effects.moveSpeedMultiplier();
      this.vx = Math.cos(yaw) * speed;
      this.vz = Math.sin(yaw) * speed;
      this.vy = HOP_SPEED;
      this.onGround = false;
      this.jumpCooldown = 0.3;
      return;
    }
    // 空中：**什么都不做**（不转向、不加力）——这一条正是"跳出去就直着飞"的来源
  }

  /**
   * 被杀死时分裂（批次 120，史莱姆）：大/中史莱姆倒下会原地分裂出 2~4 只**更小的**，

   * 只有最小的那一档才掉粘液球（原版就是这么设计的，所以"打一只大史莱姆"要打三遍）。
   *
   * ⚠️ 只在 `diedFromDamage` 时分裂：**自然消失**（离玩家 96 格被清场）也会把
   * `dead` 置真，那时候分裂等于"在没人看的地方凭空生一堆史莱姆"。
   */
  private splitIntoChildren(ctx: EntityContext): void {
    const next = this.type.splitsInto;
    if (next === undefined || !this.diedFromDamage) return;
    if (!ctx.spawnMob) return;
    const [min, max] = this.type.splitsCount ?? [SPLIT_COUNT_MIN, SPLIT_COUNT_MAX];
    const count = min + Math.floor(Math.random() * (max - min + 1));
    for (let i = 0; i < count; i++) {
      // 散开一点，免得几只叠在同一格里互相卡住
      const angle = (i / count) * Math.PI * 2;
      ctx.spawnMob(next, this.x + Math.cos(angle) * 0.7, this.y, this.z + Math.sin(angle) * 0.7);
    }
  }

  /** 沿 (vx, vz) 方向走出 0.7 格后是否会踏空 */
  private wouldFall(vx: number, vz: number): boolean {
    const length = Math.hypot(vx, vz);
    if (length < 1e-4) return false;
    const fx = Math.floor(this.x + (vx / length) * 0.7);
    const fz = Math.floor(this.z + (vz / length) * 0.7);
    const feetY = Math.floor(this.y) - 1;
    for (let drop = 0; drop <= 3; drop++) {
      if (this.pathfinder.canStandAt(fx, feetY + 1 - drop, fz, this.bodyBlocks)) return false;
    }
    return true;
  }

  /**
   * 剪羊毛（J8）。
   * @returns 剪下来的羊毛数量（1~3，原版）；剪不动（已经剪过/幼体以外的原因）返回 0
   */
  shear(): number {
    if (this.dead || this.sheared) return 0;
    this.sheared = true;
    this.woolTimer = WOOL_REGROW_SECONDS;
    return 1 + Math.floor(Math.random() * 3);
  }

  /** 羊毛长回来了没有（渲染层与测试用） */
  get woolGrowing(): boolean {
    return this.sheared;
  }

  /** 是否在求爱（渲染层可以据此冒爱心；测试也用它读状态） */
  get inLove(): boolean {
    return this.loveTimer > 0;
  }

  /**
   * 尝试驯服（批次 242，狼 / 猫 / 豹猫）。
   *
   * @param chance 这一次成功的概率（来自种类表的 `tameChance`，默认 1/3）
   * @returns `'tamed'` 成功、`'failed'` 失败（调用方照样要消耗那一件）、
   *          `null` 不适用（已经驯服 / 幼体 / 已死）
   */
  tryTame(chance: number): 'tamed' | 'failed' | null {
    if (this.tamed || this.baby || this.dead) return null;
    const odds = Math.max(0, Math.min(1, chance));
    if (Math.random() < odds) {
      this.tamed = true;
      this.sitting = false;
      return 'tamed';
    }
    return 'failed';
  }

  /**
   * 坐下 / 起来（已驯服的宠物；原版右键点一下切换）。
   * @returns 切换之后是不是坐着；不可驯服或没驯服时返回 false（调用方据此判"没发生"）
   */
  toggleSitting(): boolean {
    if (!this.tamed) return false;
    this.sitting = !this.sitting;
    if (this.sitting) {
      this.vx = 0;
      this.vz = 0;
    }
    return this.sitting;
  }

  /**
   * 喂食（J8）。
   *
   * @returns `'grow'` = 喂的是幼体、加速成长；`'love'` = 喂的是成年体、进入求爱；
   *          `null` = 这东西它不吃 / 已经吃饱了 / 刚繁殖完还在冷却
   */
  feed(itemId: number): 'grow' | 'love' | null {
    if (this.dead || !mobEats(this.type, itemId)) return null;

    if (this.baby) {
      // 原版每喂一次缩短 10% 的成长时间；这里改成固定减少 1/10 的总额
      this.fedCount++;
      this.growTimer = Math.max(0, this.growTimer - BABY_GROW_SECONDS / 10);
      return 'grow';
    }
    if (this.loveTimer > 0 || this.breedCooldown > 0) return null;
    this.loveTimer = LOVE_SECONDS;
    return 'love';
  }

  /**
   * 变成幼体（生成时调）。
   *
   * 碰撞盒一起缩小——不然小小的身体配着成年的碰撞盒，会出现"隔着半格就撞上"的怪手感。
   *
   * @param growSeconds 剩余成长秒数（批次 445：读档恢复时传存档里的值，
   *        否则一只快要长大的幼体读档后会重新开始 20 分钟）
   */
  makeBaby(growSeconds: number = BABY_GROW_SECONDS): void {
    this.baby = true;
    this.width = this.type.width * BABY_SCALE;
    this.height = this.type.height * BABY_SCALE;
    this.growTimer = Number.isFinite(growSeconds) ? Math.max(1, growSeconds) : BABY_GROW_SECONDS;
    this.fedCount = 0;
  }

  /** 幼体剩余成长秒数（存档用；成年体返回 0） */
  get growRemaining(): number {
    return this.baby ? Math.max(0, this.growTimer) : 0;
  }

  /** 直接让这只生物进入求爱（测试与命令用，省得先喂一遍） */
  startLove(): void {
    if (!this.baby) this.loveTimer = LOVE_SECONDS;
  }

  /**
   * 生下一只幼体：两只亲本各自进入冷却，幼体由上层生成（`ctx.spawnBaby`）。
   * @returns 幼体的初始状态（位置与朝向由上层决定）
   */
  breedWith(): void {
    this.loveTimer = 0;
    this.breedCooldown = BREED_COOLDOWN_SECONDS;
  }

  /** 是否正在燃烧（渲染层用它上色） */
  get burning(): boolean {
    return this.burnTime > 0;
  }

  /**
   * 点燃（火矢用）。取"更长的那个持续时间"，重复命中不会把火越点越短。
   * 原版火矢是 5 秒。
   */
  ignite(seconds: number): void {
    if (seconds <= 0) return;
    this.burnTime = Math.max(this.burnTime, seconds);
  }

  /** 着火伤害：每满 1 秒扣 1 点（原版 20 tick 一次），不参与无敌帧与击退 */
  private tickBurning(dt: number): void {
    if (this.burnTime <= 0) return;
    // 免疫火焰的生物（烈焰人）：照样"被点燃"（渲染层会画火），但不掉血
    if (this.type.fireImmune) {
      this.burnTime -= dt;
      return;
    }
    this.burnTime -= dt;
    this.burnTick += dt;
    while (this.burnTick >= 1) {
      this.burnTick -= 1;
      this.health -= 1;
      this.hitFlash = 0.2;
      if (this.health <= 0) {
        this.health = 0;
        this.dead = true;
        // 烧死也算"被打死"（原版史莱姆被火烧死照样分裂）
        this.diedFromDamage = true;
        return;
      }
    }
    if (this.burnTime <= 0) this.burnTick = 0;
  }

  /**
   * 怕水（批次 112，末影人）：泡在水里、或者**露天淋雨**时，每秒掉 1 点血，
   * 并且每一次掉血都**瞬移逃开**（原版就是"被水一泡就闪走"）。
   *
   * 两条判据：
   *  - 泡水：**脚部那一格是水**（原版的 `isInWater`）；
   *  - 淋雨：`raining` 且**头顶直接见天**——这一条与"火焰被雨浇灭"用的是同一个判据
   *    （`skyLightAt >= 15`，见 `Fire.ts`），所以"站在屋檐下就不会被淋"这两处是一致的。
   *
   * ⚠️ 与环境伤害（着火）同一条口径：**不走 `hurt()`**——那会被 0.5 秒的无敌帧
   * 卡成"每 0.5 秒 1 点"，还会带上击退。这里直接扣血，并自己决定要不要瞬移。
   */
  /**
   * 它现在是不是泡在水里（批次 189，水生生物用）。
   *
   * 取**身体中部**那一格而不是脚：鱿鱼的身子有一半在水面之上时仍然算"在水里"，
   * 否则贴到水面就会一半时间算干、一半时间算湿，上浮速度一顿一顿的。
   */
  inWater(ctx: EntityContext): boolean {
    return ctx.getBlock(Math.floor(this.x), Math.floor(this.y + this.height * 0.5), Math.floor(this.z)) === Block.WATER;
  }

  /** 身体中部是不是岩浆（批次 344：炽足兽） */
  inLava(ctx: EntityContext): boolean {
    return ctx.getBlock(Math.floor(this.x), Math.floor(this.y + this.height * 0.5), Math.floor(this.z)) === Block.LAVA;
  }

  /**
   * 水生生物上岸窒息（批次 189，鱿鱼）。
   *
   * 原版鱿鱼离开水会先抽搐、十几秒后才开始掉血；这里只保留后半段：
   * **离水满 10 秒**之后每秒掉 1 点。与"岩浆块/淋雨"同一口径——直接扣血，
   * 不走 `hurt()`（那会被 0.5 秒无敌帧卡成半速，还会带上莫名其妙的击退）。
   *
   * 掉落仍由 `tick` 末尾统一结算（只要 `diedFromDamage` 标上就行）。
   */
  private tickAquatic(ctx: EntityContext, dt: number): void {
    if (this.type.aquatic !== true || this.dead) return;
    if (this.inWater(ctx)) {
      this.aquaticDryTimer = 0;
      return;
    }
    this.aquaticDryTimer += dt;
    if (this.aquaticDryTimer < AQUATIC_SUFFOCATE_DELAY) return;
    this.aquaticDryTimer = AQUATIC_SUFFOCATE_DELAY - AQUATIC_SUFFOCATE_INTERVAL;
    this.health -= 1;
    this.hitFlash = 0.2;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.diedFromDamage = true;
    }
  }

  /** 水生生物离水的计时（秒；回到水里就清零） */
  private aquaticDryTimer = 0;

  private tickWaterFear(ctx: EntityContext, dt: number): void {
    if (this.type.waterSensitive !== true || this.dead) return;
    const x = Math.floor(this.x);
    const y = Math.floor(this.y + 0.1);
    const z = Math.floor(this.z);
    const inWater = ctx.getBlock(x, y, z) === Block.WATER;
    const inRain =
      ctx.raining === true &&
      (ctx.skyLightAt?.(x, Math.floor(this.y + this.height * 0.5), z) ?? 0) >= 15;

    if (!inWater && !inRain) {
      this.waterTimer = 0;
      return;
    }

    this.waterTimer += dt;
    if (this.waterTimer < WATER_DAMAGE_INTERVAL) return;
    this.waterTimer -= WATER_DAMAGE_INTERVAL;

    this.health -= 1;
    this.hitFlash = 0.2;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      // 淋雨/泡水致死同样算"被打死"（与着火那条口径一致，见 `diedFromDamage`）
      this.diedFromDamage = true;
      // 掉落由 `tick` 末尾统一结算（与着火致死同一条路，见那里的注释）
      return;
    }
    if (this.type.teleports) this.teleportRandomly(ctx);
  }

  /**
   * 随机瞬移（批次 112，末影人）：在自己周围 `TELEPORT_RANGE` 格内找一个**能站人**的落点。
   *
   * 三条硬要求（缺一条就不瞬移，宁可留在原地）：
   *  - 落点能站人（脚下实心 + 身体那几格通行，走 `Pathfinder.snapToGround`）——
   *    这条顺带解决了两件事：**不会卡进石头里**，以及**不会瞬移到没加载的区块**
   *    （未加载的区块读出来是空气，`canStandAt` 会判它脚下没有支撑）；
   *  - 脚下不是水/岩浆（不然"怕水"会变成"反复把自己泡进水里"）；
   *  - 落点在世界高度范围内（`snapToGround` 只管 ±6 格，跳不出去）。
   *
   * ⚠️ 方向是随机的（原版会挑"看得见玩家/背对玩家"的位置）——记在 TASKS J13。
   *
   * @returns 是否真的瞬移走了
   */
  teleportRandomly(ctx: EntityContext, minDistance = 8, maxDistance = TELEPORT_RANGE): boolean {
    for (let attempt = 0; attempt < TELEPORT_ATTEMPTS; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = minDistance + Math.random() * (maxDistance - minDistance);
      const x = Math.floor(this.x + Math.cos(angle) * distance);
      const z = Math.floor(this.z + Math.sin(angle) * distance);
      const y = Math.floor(this.y + (Math.random() * 12 - 6));
      if (this.teleportTo(ctx, x, y, z)) return true;
    }
    return false;
  }

  /**
   * 瞬移到**玩家附近**（批次 112）：被注视激怒时用——原版是"瞪回来之后贴到你身边"。
   *
   * 与 `teleportRandomly` 的唯一区别是**落点围着目标转**，要求也一样（能站人、不在水里）。
   */
  teleportNear(
    ctx: EntityContext,
    target: { x: number; y: number; z: number },
    minDistance = STARE_TELEPORT_MIN,
    maxDistance = STARE_TELEPORT_MAX,
  ): boolean {
    for (let attempt = 0; attempt < TELEPORT_ATTEMPTS; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = minDistance + Math.random() * (maxDistance - minDistance);
      const x = Math.floor(target.x + Math.cos(angle) * distance);
      const z = Math.floor(target.z + Math.sin(angle) * distance);
      const y = Math.floor(target.y + (Math.random() * 8 - 4));
      if (this.teleportTo(ctx, x, y, z)) return true;
    }
    return false;
  }

  /** 瞬移到 (x,y,z) 那一列里最近能站人的一层；成功返回 true */
  private teleportTo(ctx: EntityContext, x: number, y: number, z: number): boolean {
    // 寻路器读的是"这一帧的方块采样器"（`tick` 里才刷新一份）。而瞬移**可能在 tick 之外**
    // 被调用——玩家的攻击结算就是直接 `hurt()` 的——那时采样器还停在上一帧的坐标上，
    // 甚至（刚生成、没 tick 过）还是 null：`snapToGround` 会把整个世界看成空气，
    // 于是"每次都瞬移失败"。这里补一次，代价就是一次赋值。
    this.sampleBlock = ctx.getBlock;
    const spot = this.pathfinder.snapToGround(x, y, z, this.bodyBlocks);
    if (!spot) return false;
    const feet = ctx.getBlock(spot.x, spot.y, spot.z);
    if (feet === Block.WATER || feet === Block.LAVA) return false;

    this.x = spot.x + 0.5;
    this.y = spot.y;
    this.z = spot.z + 0.5;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.onGround = true;
    // 旧路径作废：它是照着**旧位置**算的，留着会让它掉头往回走
    this.path = [];
    this.pathIndex = 0;
    this.repathTimer = 0;
    return true;
  }

  /**
   * 受到伤害：无敌帧内无效；否则扣血 + 击退 + 红闪，生命归零则标记死亡并把掉落物交给上层。
   * @param looting 击杀者的「抢夺」等级，只影响掉落数量（伤害加成在 `tools.ts#meleeDamage` 里算好）
   * @param knockbackLevel 击杀者武器上的「击退」等级（批次 243）：每级把水平初速抬高 35%
   * @returns 是否真的受到了伤害（调用方据此决定要不要点燃等后续效果）
   */
  hurt(
    amount: number,
    knockbackX: number,
    knockbackZ: number,
    ctx?: EntityContext,
    looting = 0,
    knockbackLevel = 0,
    source?: HurtSource,
  ): boolean {
    if (this.dead || this.hurtTime > 0 || amount <= 0) return false;

    this.hurtTime = HURT_COOLDOWN;
    // 只有"被打"才记仇（批次 471）：摔伤、着火、岩浆块、爆炸都不算。
    // 原版里蜘蛛被摔也不会翻脸——以前这里不认来源，所以只能一律记
    const provoked = source !== undefined && source.kind !== 'environment';
    this.lastHurtSource = source ?? { kind: 'environment' };
    if (provoked) {
      // 记仇（批次 93）：亮处中立的蜘蛛被打过之后就会还手，见 `ANGER_SECONDS`。
      // 末影人的"中立"也靠它——被砍一下就不再是那个站着不动的黑家伙了
      this.angerTimer = ANGER_SECONDS;
      // **群体激怒**（批次 122，僵尸猪灵）：同伴挨打，附近的同类一起翻脸。
      // 扫描交给主程序（实体层没有"周围有谁"的视野）——这里只报"我这儿被打了一下"
      if (this.type.angerRadius !== undefined) {
        ctx?.provokeNearby?.(this.x, this.y, this.z, this.type.angerRadius, this.type.id);
      }
    }
    this.hitFlash = 0.3;
    this.health -= amount;

    // 挨打叫一声（批次 232）。
    // ⚠️ 致死的那一下**不在这里**播：死亡声统一由 `tickVoice` 结算，
    // 否则"被打死"会同时响受伤和死亡两条（而火烧/淹死又一条都不响）。
    if (this.health > 0) this.playVoice(ctx, 'hurt');

    // 挨打就闪（批次 112，末影人）：原版按伤害来源分（被箭射必躲、近战有概率躲），
    // 这里统一按 `TELEPORT_ON_HURT_CHANCE`——但**只有真的被打**才闪（批次 471）：
    // 摔一跤就瞬移走是这个模式以前最出戏的地方
    // ⚠️ 放在扣血之后、死亡判定之前：打死它的那一下不该"瞬移走了"（那就永远打不死）
    if (this.type.teleports && ctx && this.health > 0 && provoked && Math.random() < TELEPORT_ON_HURT_CHANCE) {
      this.teleportRandomly(ctx);
    }

    const length = Math.hypot(knockbackX, knockbackZ);
    if (length > 1e-4) {
      // 击退附魔（批次 243）：基础 5 格/秒的初速，每级 +35%（原版是"多推 3 格"，
      // 这里的 35% 折算到现有的击退手感上；II 级约等于原来的一倍半）
      const push = 5 * (1 + 0.35 * Math.max(0, Math.floor(knockbackLevel)));
      this.vx += (knockbackX / length) * push;
      this.vz += (knockbackZ / length) * push;
    }
    this.vy = Math.max(this.vy, 3.6);
    this.onGround = false;

    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      // 被打死 → 允许分裂（批次 120，见 `diedFromDamage`）
      this.diedFromDamage = true;
      this.lootDropped = true;
      this.dropLoot(ctx, looting);
    }
    return true;
  }

  /**
   * @param looting 「抢夺」等级：原版把每种掉落的数量上限抬高这么多（`uniform(min, max + level)`）
   */
  private dropLoot(ctx?: EntityContext, looting = 0): void {
    if (!ctx) return;
    // 幼体不掉落也不给经验（原版行为：小动物杀了白杀）
    if (this.baby) return;
    for (const drop of this.type.drops) {
      if (drop.chance !== undefined && Math.random() > drop.chance) continue;
      const max = drop.max + Math.max(0, looting);
      const count = drop.min + Math.floor(Math.random() * (max - drop.min + 1));
      if (count > 0) ctx.spawnDrop(drop.itemId, count, this.x, this.y + this.height * 0.5, this.z);
    }

    // 羊毛按**自己身上的颜色**掉，所以进不了 drops 表；
    // 剪过的羊不掉羊毛（原版行为，这样"剪"与"杀"才是两条路）
    if (this.type.wool && !this.sheared) {
      ctx.spawnDrop(woolId(this.woolColor), 1, this.x, this.y + this.height * 0.5, this.z);
    }
    // 击杀经验（原版数值）：批次 170 起**掉成一地球**（I16），玩家要走过去吸；
    // 没接 `spawnXpOrbs` 的调用方（离线测试的桩）退回"直接进账"，免得经验凭空消失
    if (this.type.xp > 0) {
      const xp = this.type.xp;
      if (ctx.spawnXpOrbs) ctx.spawnXpOrbs(xp, this.x, this.y + this.height * 0.5, this.z);
      else ctx.awardXp?.(xp);
    }
  }

  /** 与玩家的水平距离（战斗判定用） */
  distanceToPlayerSq(ctx: EntityContext): number {
    const player = ctx.player;
    if (!player) return Number.POSITIVE_INFINITY;
    const dx = player.x - this.x;
    const dz = player.z - this.z;
    return dx * dx + dz * dz;
  }

  /** 调试用：当前是否在追击 */
  get chasingPath(): number {
    return this.path.length;
  }

  /**
   * 是否处在"记仇"状态（批次 93 的蜘蛛与批次 112 的末影人都靠它）——
   * 对末影人来说这就是"中立已被打破"。渲染层与离线测试直接读它。
   */
  get angry(): boolean {
    return this.angerTimer > 0;
  }

  /** 最后一次伤害的来源（批次 471；没人传就是 `'environment'`） */
  get lastDamageSource(): HurtSource {
    return this.lastHurtSource;
  }

  /**
   * **激怒它**（批次 122，僵尸猪灵的群体激怒用）。
   *
   * 与"自己挨了一下"（`hurt` 里那条）是同一个状态，只是入口多了一个：
   * 原版僵尸猪灵会被**同类的遭遇**惊到，于是同伴挨打时它也跟着翻脸。
   * 这一条由主程序在 `provokeNearby` 里逐个调用（见 `MobType.angerRadius`）。
   */
  provoke(): void {
    if (this.dead) return;
    this.angerTimer = ANGER_SECONDS;
  }

  clampToWorld(): void {
    this.vx = clamp(this.vx, -20, 20);
    this.vz = clamp(this.vz, -20, 20);
  }
}

/**
 * **群体激怒要惊动哪些同伴**（批次 122，僵尸猪灵）——纯函数，所以能离线断言。
 *
 * 三条判据与原版一致：
 *  1. **同种**才惊动（旁边的恶魂看着同伴挨打并不生气）；
 *  2. 半径按**三维距离**（原版是 32 格的球，不是"平面 32 格"）；
 *  3. 已经死了的不算（`dead` 的那些马上要被回收）。
 *
 * ⚠️ 抽成纯函数的原因是**它值得被测**：主程序那一扫如果漏了"同种"这一条，
 * 症状是"打一只猪灵，旁边的僵尸也一起追你"——那种错很难在真机上察觉
 * （玩家只会觉得"这下界怎么这么凶"）。见 `EntityContext.provokeNearby`。
 */
export function provokedBy<T extends { x: number; y: number; z: number; dead: boolean; type: MobType }>(
  entities: readonly T[],
  x: number,
  y: number,
  z: number,
  radius: number,
  typeId: string,
): T[] {
  return entities.filter(
    (entity) =>
      !entity.dead && entity.type.id === typeId && Math.hypot(entity.x - x, entity.y - y, entity.z - z) <= radius,
  );
}
