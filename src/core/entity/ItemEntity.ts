/**
 * 掉落物实体
 *
 * 行为对齐原版：
 *  - 被丢出时带一点随机水平初速，落地后受摩擦迅速停下；
 *  - 落在水里会缓慢上浮；
 *  - 存在 5 分钟（原版 6000 tick）后自然消失；
 *  - 掉落后有 0.5 秒拾取冷却，避免刚丢出去就被自己吸回来；
 *  - 玩家走近即被吸进背包，背包放不下时留在原地。
 */

import { Entity, entityIntersectsBox, type EntityContext } from './Entity.ts';
import { moveBody, type MovingBody } from '../physics/EntityMotion.ts';

const GRAVITY = 32;
const MAX_FALL_SPEED = 20;
/** 存在时长上限（秒） */
export const ITEM_LIFETIME = 300;
/** 拾取冷却（秒） */
const PICKUP_DELAY = 0.5;

export class ItemEntity extends Entity implements MovingBody {
  /** 渲染用的上下浮动相位，让每堆掉落物错开 */
  readonly bobPhase: number;

  constructor(
    readonly itemId: number,
    public count: number,
    x: number,
    y: number,
    z: number,
    initialVelocity?: { x: number; y: number; z: number },
  ) {
    super(x, y, z, 0.25, 0.25);
    this.bobPhase = Math.random() * Math.PI * 2;

    if (initialVelocity) {
      this.vx = initialVelocity.x;
      this.vy = initialVelocity.y;
      this.vz = initialVelocity.z;
    } else {
      // 原版丢出时的随机初速：向四周弹一点并向上抛
      this.vx = (Math.random() - 0.5) * 1.2;
      this.vy = 2.2;
      this.vz = (Math.random() - 0.5) * 1.2;
    }
  }

  override tick(ctx: EntityContext, dt: number): void {
    // 已被标记移除的实体不再推进：EntityManager 会在同一帧内移除它，
    // 但直接调用 tick 的场合（测试、未来的实体复用池）需要这道防线。
    if (this.dead) return;

    this.age += dt;
    if (this.age > ITEM_LIFETIME) {
      this.dead = true;
      return;
    }

    const inWater = ctx.world.isLiquid(Math.floor(this.x), Math.floor(this.y + 0.12), Math.floor(this.z));

    if (inWater) {
      // 上浮，并受到比空气大得多的阻尼
      this.vy = Math.min(this.vy + 22 * dt, 0.7);
      const waterDrag = Math.pow(0.8, dt * 20);
      this.vx *= waterDrag;
      this.vz *= waterDrag;
    } else {
      this.vy -= GRAVITY * dt;
      if (this.vy < -MAX_FALL_SPEED) this.vy = -MAX_FALL_SPEED;
      // 摩擦：贴地时衰减很快，空中几乎保持惯性
      const friction = Math.pow(this.onGround ? 0.55 : 0.98, dt * 20);
      this.vx *= friction;
      this.vz *= friction;
    }

    moveBody(ctx.world, this, this.vx * dt, this.vy * dt, this.vz * dt);

    if (this.onGround && Math.abs(this.vx) < 0.02 && Math.abs(this.vz) < 0.02) {
      this.vx = 0;
      this.vz = 0;
    }

    this.tryPickup(ctx);
  }

  private tryPickup(ctx: EntityContext): void {
    if (this.age < PICKUP_DELAY || !ctx.playerBox) return;

    // 玩家的拾取范围比自身碰撞盒略大，手感更接近原版
    const box = ctx.playerBox;
    const reach = {
      minX: box.minX - 0.7,
      minY: box.minY - 0.5,
      minZ: box.minZ - 0.7,
      maxX: box.maxX + 0.7,
      maxY: box.maxY + 0.5,
      maxZ: box.maxZ + 0.7,
    };
    if (!entityIntersectsBox(this, reach)) return;

    const leftover = ctx.pickup(this.itemId, this.count);
    if (leftover <= 0) this.dead = true;
    else this.count = leftover;
  }
}
