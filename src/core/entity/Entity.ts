/**
 * 实体基类
 *
 * 目前只有掉落物在用，但接口按后续生物（I3/I4/J1）的需要预留：
 * 位置 + 速度 + 碰撞盒 + 每帧 tick + 生死标记。
 */

import type { Mob } from './Mob.ts';
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
  /** 播放音效（生物用：点火、爆炸等）；不传就没有声音 */
  playSound?: (kind: 'fuse' | 'explode' | 'bow_shoot', x: number, y: number, z: number) => void;
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

  readonly width: number;
  readonly height: number;

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
