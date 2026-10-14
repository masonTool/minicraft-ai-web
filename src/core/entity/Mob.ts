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
import { Pathfinder, type PathPoint } from './Pathfinder.ts';

/** 与玩家一致的常量（原版数值） */
const GRAVITY = 32;
const JUMP_SPEED = 8.95;
/** 受击后的无敌时间（秒） */
const HURT_COOLDOWN = 0.5;

export interface MobDrop {
  itemId: number;
  min: number;
  max: number;
  /** 掉落概率 0-1（不填视为 1） */
  chance?: number;
}

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
  /** 渲染用的主色 / 点缀色 */
  bodyColor: number;
  accentColor: number;
  /** 眼睛高度（渲染用） */
  eyeHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class Mob extends Entity {
  readonly type: MobType;

  health: number;
  /** 朝向（渲染用） */
  yaw = 0;
  /** 受击红闪剩余时间 */
  hitFlash = 0;

  private hurtTime = 0;
  private attackCooldown = 0;
  private jumpCooldown = 0;

  private path: PathPoint[] = [];
  private pathIndex = 0;
  private repathTimer = 0;
  private wanderTimer = 0;
  private wanderYaw = 0;
  /** 游荡时是否停下（一部分时间站着不动，比一直乱走自然） */
  private idle = false;

  private readonly pathfinder: Pathfinder;
  private sampleBlock: ((x: number, y: number, z: number) => number) | null = null;

  constructor(type: MobType, x: number, y: number, z: number) {
    super(x, y, z, type.width, type.height);
    this.type = type;
    this.health = type.health;
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

    if (this.hurtTime > 0) this.hurtTime -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;

    this.updateAi(ctx, dt);

    this.vy -= GRAVITY * dt;
    if (this.vy < -60) this.vy = -60;

    moveBody(ctx.world, this, this.vx * dt, this.vy * dt, this.vz * dt);

    // 掉出世界
    if (this.y < -80) this.dead = true;

    // 朝向跟着实际速度走
    if (Math.abs(this.vx) > 0.05 || Math.abs(this.vz) > 0.05) {
      this.yaw = Math.atan2(this.vx, this.vz);
    }
  }

  private updateAi(ctx: EntityContext, dt: number): void {
    const player = ctx.player;
    const dx = player ? player.x - this.x : 0;
    const dz = player ? player.z - this.z : 0;
    const distanceSq = dx * dx + dz * dz;

    const chasing =
      this.type.hostile && player !== null && distanceSq <= this.type.followRange * this.type.followRange;

    if (chasing && player) {
      this.repathTimer -= dt;
      if (this.repathTimer <= 0 || this.path.length === 0) {
        this.repathTimer = 0.5 + Math.random() * 0.4;
        this.path =
          this.pathfinder.find(this.x, this.y, this.z, player.x, player.y, player.z, {
            heightBlocks: this.bodyBlocks,
          }) ?? [];
        this.pathIndex = 0;
      }

      // 贴脸就打（原版僵尸的触及距离约 2 格）
      if (distanceSq < 4 && this.attackCooldown <= 0) {
        this.attackCooldown = 1;
        ctx.hurtPlayer(this.type.attackDamage, this.x, this.z);
      }
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 2 + Math.random() * 4;
        this.wanderYaw = Math.random() * Math.PI * 2;
        // 四分之一的概率原地站一会儿
        this.idle = Math.random() < 0.25;
      }
    }

    this.move(chasing, dt);
  }

  private move(chasing: boolean, dt: number): void {
    const speed = chasing ? this.type.speed * 1.12 : this.type.speed * 0.5;
    let targetVx = 0;
    let targetVz = 0;

    if (chasing) {
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
      if (this.pathIndex >= this.path.length) this.path = [];
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
   * 受到伤害：无敌帧内无效；否则扣血 + 击退 + 红闪，生命归零则标记死亡并把掉落物交给上层。
   * @returns 是否真的受到了伤害
   */
  hurt(amount: number, knockbackX: number, knockbackZ: number, ctx?: EntityContext): boolean {
    if (this.dead || this.hurtTime > 0 || amount <= 0) return false;

    this.hurtTime = HURT_COOLDOWN;
    this.hitFlash = 0.3;
    this.health -= amount;

    const length = Math.hypot(knockbackX, knockbackZ);
    if (length > 1e-4) {
      this.vx += (knockbackX / length) * 5;
      this.vz += (knockbackZ / length) * 5;
    }
    this.vy = Math.max(this.vy, 3.6);
    this.onGround = false;

    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.dropLoot(ctx);
    }
    return true;
  }

  private dropLoot(ctx?: EntityContext): void {
    if (!ctx) return;
    for (const drop of this.type.drops) {
      if (drop.chance !== undefined && Math.random() > drop.chance) continue;
      const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
      if (count > 0) ctx.spawnDrop(drop.itemId, count, this.x, this.y + this.height * 0.5, this.z);
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

  clampToWorld(): void {
    this.vx = clamp(this.vx, -20, 20);
    this.vz = clamp(this.vz, -20, 20);
  }
}
