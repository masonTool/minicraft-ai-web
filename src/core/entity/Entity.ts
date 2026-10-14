/**
 * 实体基类
 *
 * 目前只有掉落物在用，但接口按后续生物（I3/I4/J1）的需要预留：
 * 位置 + 速度 + 碰撞盒 + 每帧 tick + 生死标记。
 */

import type { AABB } from '../physics/AABB.ts';
import type { PhysicsWorld } from '../physics/PlayerPhysics.ts';

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
