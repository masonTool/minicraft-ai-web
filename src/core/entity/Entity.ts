/**
 * 实体基类
 *
 * 目前只有掉落物在用，但接口按后续生物（I3/I4/J1）的需要预留：
 * 位置 + 速度 + 碰撞盒 + 每帧 tick + 生死标记。
 */

import type { Mob, MobType } from './Mob.ts';
import type { AABB } from '../physics/AABB.ts';
import type { PhysicsWorld } from '../physics/PlayerPhysics.ts';

/**
 * 实体层能报出来的伤害类型（是 `PlayerStats.DamageCause` 的子集，那边才是权威定义）。
 * 用字面量联合而不是直接引那边的类型：实体层不该认识生存模块。
 */
export type EntityDamageCause = 'generic' | 'projectile' | 'explosion' | 'fire';

export interface EntityContext {
  /** 碰撞与流体查询 */
  world: PhysicsWorld;
  /** 玩家碰撞盒（拾取判定用）；未加载时为 null */
  playerBox: AABB | null;
  /**
   * 拾取回调：把物品放进玩家背包。
   * @returns 未能放入的剩余数量（0 表示全部收下）
   */
  pickup: (itemId: number, count: number) => number;
  /** 读取方块 id（生物寻路用） */
  getBlock: (x: number, y: number, z: number) => number;
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
    kind: 'fuse' | 'explode' | 'bow_shoot' | 'arrow_hit' | 'break_glass' | 'splash',
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
   * 击杀经验（I5）：生物死亡时把 `type.xp` 交给主程序记账。
   * 放在这里而不是让实体直接持有经验对象，是为了让实体层不认识"玩家进度"。
   */
  awardXp?: (amount: number) => void;
  /**
   * 对玩家造成伤害（生物攻击用，第二个参数是伤害来源的水平位置，用于击退方向）。
   *
   * `cause` 用**字符串字面量联合**而不是直接引 `PlayerStats.DamageCause`：
   * 实体层不该认识生存模块的类型，但取值必须与那边对得上（箭矢要传 'projectile'，
   * 否则"弹射物保护"这条附魔永远不生效）。
   */
  hurtPlayer: (amount: number, sourceX: number, sourceZ: number, cause?: EntityDamageCause) => void;
  /**
   * 查询与给定体积相交的生物（箭矢命中判定用）。
   * 实体层不持有生物列表，所以由主程序从实体管理器里查——
   * 这样箭矢不必知道"生物是怎么存的"，也方便测试里塞桩。
   */
  hitMob?: (box: AABB) => Mob | null;
  /** 生成掉落物实体（生物死亡掉落用） */
  spawnDrop: (itemId: number, count: number, x: number, y: number, z: number) => void;
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
  /** 冒爱心粒子（J8：求爱与繁殖成功时）。`scale` 用来让"没找到对象"时少冒几颗 */
  spawnHearts?: (x: number, y: number, z: number, scale?: number) => void;
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
    options: { fromPlayer: boolean; damage: number; knockback?: number; fireSeconds?: number; pickable?: boolean },
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
