/**
 * 玩家物理
 *
 * 数值对齐原版（换算成"每秒"单位；原版以 1/20 秒为 1 tick）：
 *   走路 4.317 m/s · 疾跑 5.612 m/s · 潜行 1.295 m/s · 游泳 2.2 m/s
 *   重力 32 m/s²（原版 0.08/tick²）· 起跳初速 8.95 m/s（跳跃高度约 1.25 格）
 *   终端速度 78 m/s
 *
 * 碰撞解析：逐轴移动 + 立即推出；水平被挡时尝试抬高 0.6 格（自动上台阶），
 * 与"直接走过去就能上台阶"的原版行为一致。
 */

import { boxAt, collides, intersects, makeAABB, translate, type CollisionWorld } from './AABB.ts';

export const WALK_SPEED = 4.317;
export const SPRINT_SPEED = 5.612;
export const SNEAK_SPEED = 1.295;
export const SWIM_SPEED = 2.2;
export const FLY_SPEED = 10.9;
export const FLY_SPRINT_SPEED = 21.8;

const GRAVITY = 32;
const JUMP_VELOCITY = 8.95;
const TERMINAL_VELOCITY = 78;

/** 单次步进的最大位移，超过就拆成多步，避免高速穿透薄墙 */
const MAX_STEP = 0.4;

export interface PlayerInput {
  forward: number; // -1..1
  strafe: number; // -1..1
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export interface PhysicsWorld extends CollisionWorld {
  isLiquid(x: number, y: number, z: number): boolean;
}

function approach(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

export class PlayerPhysics {
  x = 0;
  y = 80;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;

  onGround = false;
  inWater = false;
  /** 摔落起始高度；落地时用于计算摔落伤害（生存系统接入后使用） */
  fallStartY: number | null = null;

  readonly width = 0.6;
  readonly height = 1.8;
  readonly eyeHeight = 1.62;
  readonly stepHeight = 0.6;

  get eyeY(): number {
    return this.y + this.eyeHeight;
  }

  box(): ReturnType<typeof makeAABB> {
    return boxAt(this.x, this.y, this.z, this.width, this.height);
  }

  /** 相机所处的水平方向（yaw 为弧度，0 表示朝向 -Z） */
  update(world: PhysicsWorld, input: PlayerInput, yaw: number, dt: number, flying: boolean): void {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);

    // 朝向向量：前 = (-sin, 0, -cos)
    let dirX = -sin * input.forward + cos * input.strafe;
    let dirZ = -cos * input.forward - sin * input.strafe;
    const dirLength = Math.hypot(dirX, dirZ);
    if (dirLength > 1e-6) {
      dirX /= dirLength;
      dirZ /= dirLength;
    } else {
      dirX = 0;
      dirZ = 0;
    }

    this.inWater = world.isLiquid(Math.floor(this.x), Math.floor(this.y + 0.4), Math.floor(this.z));

    const speed = flying
      ? input.sprint
        ? FLY_SPRINT_SPEED
        : FLY_SPEED
      : this.inWater
        ? SWIM_SPEED
        : input.sneak
          ? SNEAK_SPEED
          : input.sprint
            ? SPRINT_SPEED
            : WALK_SPEED;

    const accelerate = flying ? 90 : this.onGround ? 48 : 10;
    this.vx = approach(this.vx, dirX * speed, accelerate * dt);
    this.vz = approach(this.vz, dirZ * speed, accelerate * dt);

    if (flying) {
      const vertical = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
      this.vy = approach(this.vy, vertical * speed * 0.85, 90 * dt);
      this.onGround = false;
      this.fallStartY = null;
    } else if (this.inWater) {
      this.vy -= GRAVITY * 0.25 * dt;
      if (input.jump) this.vy = 3.4;
      if (this.vy < -4) this.vy = -4;
      this.fallStartY = null;
    } else {
      if (input.jump && this.onGround) {
        this.vy = JUMP_VELOCITY;
        this.onGround = false;
      }
      this.vy -= GRAVITY * dt;
      if (this.vy < -TERMINAL_VELOCITY) this.vy = -TERMINAL_VELOCITY;
    }

    this.move(world, this.vx * dt, this.vy * dt, this.vz * dt);
  }

  private move(world: PhysicsWorld, dx: number, dy: number, dz: number): void {
    const distance = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.max(1, Math.ceil(distance / MAX_STEP));
    const stepX = dx / steps;
    const stepY = dy / steps;
    const stepZ = dz / steps;

    for (let i = 0; i < steps; i++) {
      this.moveY(world, stepY);

      if (this.onGround && (stepX !== 0 || stepZ !== 0)) {
        const beforeX = this.x;
        const beforeZ = this.z;
        this.moveX(world, stepX);
        this.moveZ(world, stepZ);

        const wantedX = Math.abs(stepX);
        const wantedZ = Math.abs(stepZ);
        const blockedX = wantedX > 1e-6 && Math.abs(this.x - beforeX) < wantedX * 0.5;
        const blockedZ = wantedZ > 1e-6 && Math.abs(this.z - beforeZ) < wantedZ * 0.5;

        if (blockedX || blockedZ) {
          this.tryStepUp(world, beforeX, beforeZ, stepX, stepZ);
        }
      } else {
        this.moveX(world, stepX);
        this.moveZ(world, stepZ);
      }
    }
  }

  /** 水平被挡时：抬高一个台阶再尝试，成功则整体位移到台阶上 */
  private tryStepUp(world: PhysicsWorld, beforeX: number, beforeZ: number, stepX: number, stepZ: number): void {
    const savedY = this.y;

    this.y += this.stepHeight;
    if (collides(world, this.box())) {
      this.y = savedY;
      return;
    }

    // 抬高后重新尝试水平移动
    this.x = beforeX;
    this.z = beforeZ;
    this.moveX(world, stepX);
    this.moveZ(world, stepZ);

    if (Math.abs(this.x - beforeX) < 1e-6 && Math.abs(this.z - beforeZ) < 1e-6) {
      this.x = beforeX;
      this.z = beforeZ;
      this.y = savedY;
      return;
    }

    // 向下吸附到台阶面
    this.snapDown(world);
  }

  /** 从当前位置向下微调，直到踩到地面（最多 stepHeight） */
  private snapDown(world: PhysicsWorld): void {
    const limit = this.y - this.stepHeight - 0.05;
    const probe = 0.05;
    while (this.y > limit) {
      const next = translate(this.box(), 0, -probe, 0);
      if (collides(world, next)) {
        this.onGround = true;
        this.vy = 0;
        return;
      }
      this.y -= probe;
    }
  }

  private moveX(world: PhysicsWorld, amount: number): void {
    if (amount === 0) return;
    this.x += amount;
    if (!collides(world, this.box())) return;

    if (amount > 0) {
      this.x = Math.floor(this.x + this.width / 2) - this.width / 2 - 1e-4;
    } else {
      this.x = Math.floor(this.x - this.width / 2) + 1 + this.width / 2 + 1e-4;
    }
    this.vx = 0;
  }

  private moveZ(world: PhysicsWorld, amount: number): void {
    if (amount === 0) return;
    this.z += amount;
    if (!collides(world, this.box())) return;

    if (amount > 0) {
      this.z = Math.floor(this.z + this.width / 2) - this.width / 2 - 1e-4;
    } else {
      this.z = Math.floor(this.z - this.width / 2) + 1 + this.width / 2 + 1e-4;
    }
    this.vz = 0;
  }

  private moveY(world: PhysicsWorld, amount: number): void {
    if (amount === 0) return;
    this.y += amount;

    if (!collides(world, this.box())) {
      if (amount < 0) this.onGround = false;
      return;
    }

    if (amount > 0) {
      // 撞到天花板
      this.y = Math.floor(this.y + this.height) - this.height - 1e-4;
    } else {
      // 落地
      this.y = Math.floor(this.y) + 1 + 1e-4;
      this.onGround = true;
    }
    this.vy = 0;
  }

  /** 传送到指定位置并清空速度（出生点、调试用） */
  teleport(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.onGround = false;
    this.fallStartY = null;
  }

  /** 视线方向（由 yaw/pitch 推出） */
  static lookDirection(yaw: number, pitch: number): [number, number, number] {
    const cosPitch = Math.cos(pitch);
    return [-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch];
  }

  /**
   * 指定方块是否与玩家碰撞体相交。
   * 用于阻止"把方块放在自己身上"导致卡住。
   */
  blockIntersects(x: number, y: number, z: number): boolean {
    return intersects(this.box(), makeAABB(x, y, z, x + 1, y + 1, z + 1));
  }
}
