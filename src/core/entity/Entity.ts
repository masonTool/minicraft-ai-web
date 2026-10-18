/**
 * 实体基类
 *
 * 目前只有掉落物在用，但接口按后续生物（I3/I4/J1）的需要预留：
 * 位置 + 速度 + 碰撞盒 + 每帧 tick + 生死标记。
 */

import type { Mob, MobType } from './Mob.ts';
import type { AABB } from '../physics/AABB.ts';
import type { PhysicsWorld } from '../physics/PlayerPhysics.ts';
// 只引类型：`afflictPlayer` 的效果名跟着状态效果表走（见那一行的注记）。
// type-only import 不会把生存模块拖进实体层的运行时依赖里
import type { EffectId } from '../survival/StatusEffects.ts';

/**
 * 实体层能报出来的伤害类型（是 `PlayerStats.DamageCause` 的子集，那边才是权威定义）。
 * 用字面量联合而不是直接引那边的类型：实体层不该认识生存模块。
 */
export type EntityDamageCause = 'generic' | 'projectile' | 'explosion' | 'fire';

/**
 * 掉落物携带的**附加数据**（批次 63）。
 *
 * 为什么要单独定义一个结构类型，而不直接引 `container/Inventory.ts` 的 `ItemStack`：
 * 与 `EntityDamageCause` 同一个理由——**实体层不该认识容器层**，
 * 但两边的字段必须对得上（多一个少一个都会静默丢数据）。所以这里只写"形状"，
 * 由 `ItemEntity.toStack()` 交给主程序拼成真正的 `ItemStack`。
 */
export interface DroppedExtras {
  /** 工具/盔甲的耐久损耗 */
  damage?: number;
  /** 附魔（id → 等级） */
  enchants?: Readonly<Record<string, number>>;
  /** 铁砧改过的名字 */
  name?: string;
  /** 铁砧的累积惩罚（再修一次的代价） */
  repairCost?: number;
  /**
   * 内容物（潜影盒，批次 72）：挖下来时跟着**掉落物**一起走、捡起来再进背包。
   *
   * 与 `ItemStack.contents` 同一形状（**只嵌一层**）：实体层照旧不引容器层的类型，
   * 所以这里只写"形状"，由 `ItemEntity.toStack()` 交给主程序拼成真正的 `ItemStack`。
   */
  contents?: (DroppedStack | null)[];
}

/** 内容物里那一层（同样只写形状，不引容器层） */
export interface DroppedStack {
  id: number;
  count: number;
  damage?: number;
  enchants?: Readonly<Record<string, number>>;
  name?: string;
  repairCost?: number;
}

export interface EntityContext {
  /** 碰撞与流体查询 */
  world: PhysicsWorld;
  /** 玩家碰撞盒（拾取判定用）；未加载时为 null */
  playerBox: AABB | null;
  /**
   * 拾取回调：把物品放进玩家背包。
   *
   * ⚠️ 必须连 `extras` 一起收下（批次 63）：不然"掉在地上的附魔镐捡起来变成白板"——
   * 这是"玩家东西凭空变化"的同一类问题（见 TASKS H16）。
   * @returns 未能放入的剩余数量（0 表示全部收下）
   */
  pickup: (itemId: number, count: number, extras?: DroppedExtras) => number;
  /** 读取方块 id（生物寻路用） */
  getBlock: (x: number, y: number, z: number) => number;
  /**
   * 那一格的**亮度**（0~15，取天光与方块光的较大者；批次 93，蜘蛛的"亮处中立"用）。
   * 不传就当 0（= 永远算暗，行为与批次 92 之前一致）。
   */
  lightAt?: (x: number, y: number, z: number) => number;
  /**
   * 给玩家施加一个状态效果（批次 93，洞穴蜘蛛的中毒）。
   *
   * 与 `hurtPlayer` 同一个分工：实体层只描述"**该中毒了**"，
   * "毒多久、有没有免疫、难度要不要打折"全归生存模块。
   */
  /**
   * 给玩家挂一个状态效果（批次 93 洞穴蜘蛛的中毒；批次 124 尸壳的饥饿）。
   *
   * ⚠️ 值域跟着 `StatusEffects` 的 `EffectId` 走（**不再手抄一份小的**）：
   * 抄一份的后果是"每加一种新效果就要改三处签名"，而漏改的那处是**编译期**才发现——
   * 这一批的饥饿就是这么撞上来的。
   */
  afflictPlayer?: (effect: EffectId, seconds: number) => void;
  /**
   * 玩家是不是**正看着这一点**（批次 112，末影人被注视激怒用）。
   *
   * 实体层不持有相机（也拿不到玩家的朝向），所以由主程序回答这个问题：
   * 判据是**视线锥 + 视线无遮挡**两条。不传就当"没在看"。
   */
  playerGazeAt?: (x: number, y: number, z: number) => boolean;
  /**
   * 把玩家传送到 (x,y,z)（批次 113，**末影珍珠**用：珍珠落地就把扔它的人传过去）。
   *
   * ⚠️ 这里只传"人到了哪"——**摔落伤害、音效、粒子全归主程序**
   * （原版那 5 点走的是 `DamageSource.FALL`，所以"摔落保护能不能减"这类事
   * 只有生存模块说了算，实体层不该掺和）。
   */
  teleportPlayer?: (x: number, y: number, z: number) => void;
  /**
   * 那一格的**天光**等级（0~15，批次 112，末影人淋雨判据用）。
   *
   * ⚠️ 与 `lightAt` 不是一回事：`lightAt` 是天光与方块光的较大者
   * （"这里亮不亮"），而"露天淋不淋得到雨"要看**天光**（火把照亮的洞里不掉雨）。
   * 判据与"火焰被雨浇灭"同源（`skyLight >= 15` = 头顶直接见天）。
   */
  skyLightAt?: (x: number, y: number, z: number) => number;
  /**
   * 现在**下不下雨**（批次 112，末影人怕雨用）。
   *
   * 传值而不是函数：这一项每帧都可能变，而上下文每帧都会新建
   * （与 `playerInvisible` 同一个理由）。下雪也算降水（原版如此）。
   */
  raining?: boolean;
  /** 玩家位置（敌对生物追击用）；未加载时为 null */
  player: { x: number; y: number; z: number } | null;
  /**
   * 玩家现在是不是隐身的（K4 尾巴）。
   *
   * ⚠️ 传**值**而不是函数：这一项每帧都可能变，而上下文每帧都会重建
   * （反过来说，`heldItemId` 那种"要读时才问"的传函数——见 `HANDOFF` 的经验表）。
   */
  playerInvisible?: boolean;
  /**
   * 播放音效（生物与投掷物用：点火、爆炸、命中……）；不传就没有声音。
   * 取值必须是音频模块里真实存在的 kind（多写一个不存在的名字会在运行时静默无声）。
   */
  playSound?: (
    kind: 'fuse' | 'explode' | 'bow_shoot' | 'arrow_hit' | 'break_glass' | 'splash' | 'mob_villager',
    x: number,
    y: number,
    z: number,
  ) => void;
  /**
   * 爆炸（苦力怕用）。
   * 生物只负责"什么时候炸"，"炸成什么样"由主程序决定（要不要炸地形由 mobGriefing 规则控制）。
   */
  explode?: (x: number, y: number, z: number, power: number) => void;
  /**
   * 烟花炸开（批次 192）：粒子颜色、波及范围与音效全归主程序。
   *
   * 与 `explode` 分成两个钩子（而不是复用 `explode`）：**烟花不炸地形**，
   * 而 `explode` 那条是"要不要炸方块由 mobGriefing 决定"——让烟花走进去，
   * 关掉 `mobGriefing` 之前它就会被当成苦力怕的爆炸处理（那就不是烟花了）。
   */
  burstFirework?: (
    x: number,
    y: number,
    z: number,
    colors: readonly number[],
    power: number,
    damage: number,
  ) => void;
  /**
   * 击杀经验（I5）：生物死亡时把 `type.xp` 交给主程序记账。
   * 放在这里而不是让实体直接持有经验对象，是为了让实体层不认识"玩家进度"。
   */
  awardXp?: (amount: number) => void;
  /**
   * **生成经验球**（批次 170，I16）：生物死亡 / 挖矿时把 `amount` 拆成几个球掉在 (x,y,z)。
   *
   * ⚠️ 与 `awardXp` 是两个钩子，不是一件事：这个是**生成**（要位置），那个是**记账**
   * （玩家把球吸到手上的那一刻）。合成一个之后，"经验从哪掉出来"就变成不可测的了
   * ——而那正是原版与"直接进账"最大的差别（死亡要掉球）。
   */
  spawnXpOrbs?: (amount: number, x: number, y: number, z: number) => void;
  /**
   * 对玩家造成伤害（生物攻击用，第二个参数是伤害来源的水平位置，用于击退方向）。
   *
   * `cause` 用**字符串字面量联合**而不是直接引 `PlayerStats.DamageCause`：
   * 实体层不该认识生存模块的类型，但取值必须与那边对得上（箭矢要传 'projectile'，
   * 否则"弹射物保护"这条附魔永远不生效）。
   */
  hurtPlayer: (
    amount: number,
    sourceX: number,
    sourceZ: number,
    cause?: EntityDamageCause,
    /** 具体来源名（生物名 / 弹射物名），只用于左上角"为什么掉血"的播报 */
    source?: string,
  ) => void;
  /**
   * 查询与给定体积相交的生物（箭矢命中判定用）。
   * 实体层不持有生物列表，所以由主程序从实体管理器里查——
   * 这样箭矢不必知道"生物是怎么存的"，也方便测试里塞桩。
   */
  hitMob?: (box: AABB) => Mob | null;
  /** 生成掉落物实体（生物死亡掉落用；`extras` 供"带着附魔/耐久掉下来"的路径用） */
  spawnDrop: (itemId: number, count: number, x: number, y: number, z: number, extras?: DroppedExtras) => void;
  /**
   * 找一只愿意配对的同类（J8）。
   * 实体层不持有生物列表，所以由主程序去实体管理器里找——
   * 与 `hitMob` 同一个理由：生物只描述"想干什么"，"周围有谁"交给上层。
   */
  findMate?: (mob: Mob) => Mob | null;
  /**
   * 玩家手上拿着什么（J8：拿着食物能把动物引过来）。
   *
   * 用**函数**而不是值：上下文对象是建好之后缓存的，传值会永远停在建它那一帧的物品上。
   */
  heldItemId?: () => number | undefined;
  /** 生成一只幼体（J8 繁殖用） */
  spawnBaby?: (type: MobType, x: number, y: number, z: number) => void;
  /**
   * 按**种类 id** 生成一只生物（批次 120，史莱姆分裂用）。
   *
   * 与 `spawnBaby` 的分工：那个是"生幼崽"（会 `makeBaby()` + 冒爱心 + 记进度），
   * 而这个只是**放一只出来**——分裂出的小史莱姆不是"幼崽"，是另一档尺寸的正常个体。
   * 收 id 而不是 `MobType`：实体层不能引 `mobs.ts`（会成环），见 `MobType.splitsInto`。
   */
  spawnMob?: (typeId: string, x: number, y: number, z: number) => void;
  /**
   * **让附近的同类一起记仇**（批次 122，僵尸猪灵的群体激怒）。
   *
   * 实体层没有"周围有谁"的视野（它只认识自己与玩家），所以这一扫归主程序。
   * 参数带 `typeId`：原版只有**同种**会跟着翻脸——旁边的恶魂看着同伴挨打并不生气。
   */
  provokeNearby?: (x: number, y: number, z: number, radius: number, typeId: string) => void;
  /**
   * 扔一支**三叉戟**（批次 123，溺尸用）——它是生物扔的，所以会**砸玩家**
   * （玩家自己扔的那一支走 `main.throwHeld` 里那条路，两者共用 `Throwable` 的同一档，
   * 差别只在 `fromPlayer`）。
   */
  spawnTrident?: (x: number, y: number, z: number, velocity: { x: number; y: number; z: number }) => void;
  /** 冒爱心粒子（J8：求爱与繁殖成功时）。`scale` 用来让"没找到对象"时少冒几颗 */
  spawnHearts?: (x: number, y: number, z: number, scale?: number) => void;
  /**
   * 冒一圈紫色粒子（批次 114，末影之眼碎掉时用）。
   *
   * 用**名字描述观感**而不是"给末影之眼用的粒子"：传送门、末影箱打开、珍珠传送
   * 用的都是同一套紫色涡旋，将来别的地方要用也直接复用（与 `spawnHearts` 同一个性质）。
   */
  spawnPortalParticles?: (x: number, y: number, z: number, count?: number, spread?: number) => void;
  /**
   * 射出一支箭（J9，骷髅用）。
   * 与 `spawnDrop` 同理：生物只负责"什么时候射、往哪射"，
   * 箭怎么建、飞出去长什么样由主程序决定。
   */
  spawnArrow?: (
    x: number,
    y: number,
    z: number,
    velocity: { x: number; y: number; z: number },
    options: {
      fromPlayer: boolean;
      damage: number;
      knockback?: number;
      fireSeconds?: number;
      pickable?: boolean;
      /** 命中玩家时挂的效果（批次 125，流浪者的箭；见 `ArrowOptions.effect`） */
      effect?: { effect: EffectId; seconds: number };
    },
  ) => void;
  /**
   * 孵出一只小鸡（K4 尾巴：鸡蛋命中时 1/8 概率）。
   * 与 `spawnBaby` 一样，实体层不持有"鸡是哪一种生物"的知识，由主程序决定。
   */
  hatchChicken?: (x: number, y: number, z: number) => void;
  /**
   * 结算一次喷溅药水（K4 尾巴）：主程序才知道"爆心周围有谁"，
   * 范围与时长缩放本身是纯函数（见 `survival/SplashPotion.ts`）。
   */
  applySplash?: (potionId: number, x: number, y: number, z: number) => void;
  /** 在原地留下一片药水云（K4 尾巴：滞留药水摔碎时调用） */
  spawnLingering?: (potionId: number, x: number, y: number, z: number) => void;
  /** 吐一团龙息云（K4 尾巴：末影龙的血息阶段调用） */
  spawnDragonBreath?: (x: number, y: number, z: number) => void;
  /**
   * 吐一颗**小火球**（批次 92，烈焰人用）。
   *
   * 与 `spawnArrow` 同一个理由：生物只负责"什么时候吐、朝哪个方向吐"，
   * 火球怎么建、长什么样由主程序决定（它是 `Throwable` 里的一档）。
   */
  spawnSmallFireball?: (
    x: number,
    y: number,
    z: number,
    velocity: { x: number; y: number; z: number },
  ) => void;
  /**
   * 吐一颗**大火球**（批次 94，恶魂用）。
   *
   * 与 `spawnSmallFireball` 分成两个钩子（而不是加个 `power` 参数）：
   * 它们的**结算**根本不同——小火球只打玩家，大火球命中要**炸开一片**，
   * 而"炸"这件事只有主程序做得了（它才知道世界与周围有谁）。
   */
  spawnLargeFireball?: (
    x: number,
    y: number,
    z: number,
    velocity: { x: number; y: number; z: number },
  ) => void;
  /**
   * 吐一颗**凋灵骷髅头**（批次 116，凋灵用）。
   *
   * `blue` 是原版那两档：黑色的 5 点伤害 + 凋零 10 秒，蓝色（半血之后）的
   * 8 点 + 凋零 40 秒。与火球那两个钩子同一个理由：**结算是投掷物那一层的事**，
   * 生物只负责"什么时候吐、朝哪吐"（`Throwable` 里那两个 kind 就是它）。
   */
  spawnWitherSkull?: (
    x: number,
    y: number,
    z: number,
    velocity: { x: number; y: number; z: number },
    blue: boolean,
  ) => void;
  /**
   * 点燃玩家（批次 92，小火球命中时用）。
   *
   * ⚠️ 与 `hurtPlayer` 分开：伤害与"点火"在生存模块里本来就是两条路
   * （`PlayerStats.hurt` 与 `PlayerStats.ignite`），合成一个参数会让人以为
   * "受伤就会着火"（岩浆是两者都有，而火球是分开结算的）。
   */
  ignitePlayer?: (seconds: number) => void;
}

let nextEntityId = 1;

export abstract class Entity {
  readonly id: number = nextEntityId++;

  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;

  /**
   * 碰撞盒尺寸。
   * 不是 `readonly`：幼体长大后要换回成年的尺寸（J8），
   * 只读的话就只能让幼体一直用成年碰撞盒，会出现"小小的身体卡在方块里"。
   */
  width: number;
  height: number;

  onGround = false;
  /** 存在时长（秒） */
  age = 0;
  /** 标记为待移除 */
  dead = false;

  constructor(x: number, y: number, z: number, width: number, height: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.width = width;
    this.height = height;
  }

  abstract tick(ctx: EntityContext, dt: number): void;

  get isDead(): boolean {
    return this.dead;
  }

  /** 实体所在的区块坐标，用于随区块卸载清理 */
  get chunkX(): number {
    return Math.floor(this.x) >> 4;
  }

  get chunkZ(): number {
    return Math.floor(this.z) >> 4;
  }
}

export function entityIntersectsBox(entity: Entity, box: AABB): boolean {
  const minX = entity.x - entity.width / 2;
  const maxX = entity.x + entity.width / 2;
  const minZ = entity.z - entity.width / 2;
  const maxZ = entity.z + entity.width / 2;
  const maxY = entity.y + entity.height;

  return (
    minX < box.maxX &&
    maxX > box.minX &&
    entity.y < box.maxY &&
    maxY > box.minY &&
    minZ < box.maxZ &&
    maxZ > box.minZ
  );
}
