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
/** 苦力怕引信时长（秒） */
export const CREEPER_FUSE_TIME = 1.5;

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
  /** 生物家族（亡灵 / 节肢）；蜘蛛还没做，所以目前只有亡灵有成员 */
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
  /**
   * 着火剩余秒数（J9 的火矢用它）。
   *
   * 着火伤害**不走 `hurt()`**：那样会被 0.5 秒的无敌帧卡成"每 0.5 秒掉 1 点"，
   * 而原版是每 20 tick（1 秒）掉 1 点、且不吃击退。所以单独攒一个计时器。
   */
  burnTime = 0;

  private burnTick = 0;
  /** 远程生物的移动方向（保持距离用）与"正在拉开"标记 */
  private moveDirX = 0;
  private moveDirZ = 0;
  private retreating = false;
  /** 距离下一次放箭还有多久 */
  private rangedTimer = 0;
  private hurtTime = 0;
  private attackCooldown = 0;
  /** 苦力怕的引信（秒）：贴到玩家身上开始点燃，1.5 秒后炸 */
  private fuse = 0;
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
    this.tickBurning(dt);
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

    // 被烧死的情况在 tickBurning 里只标了 dead，掉落要在这里补上——
    // 否则"用火矢烧死"会变成怪物凭空消失（比被砍死少一条掉落路径）
    if (this.dead && !this.lootDropped) {
      this.lootDropped = true;
      this.dropLoot(ctx);
    }
  }

  /** 掉落是否已结算（防止死亡与着火两条路径重复掉一份） */
  private lootDropped = false;

  private updateAi(ctx: EntityContext, dt: number): void {
    const player = ctx.player;
    const dx = player ? player.x - this.x : 0;
    const dz = player ? player.z - this.z : 0;
    const distanceSq = dx * dx + dz * dz;

    const chasing =
      this.type.hostile && player !== null && distanceSq <= this.type.followRange * this.type.followRange;

    // 远程生物走自己那套（保持距离 + 放箭），不参与近战的寻路追击
    if (chasing && player && this.type.ranged) {
      this.updateRangedAi(ctx, distanceSq, player, dt);
      this.move(true, dt);
      return;
    }

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
      } else if (distanceSq < 4 && this.attackCooldown <= 0) {
        // 贴脸就打（原版僵尸的触及距离约 2 格）
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
    const approaching = distance > ranged.range * 0.9;
    this.retreating = distance < ranged.keepDistance;
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

    ctx.spawnArrow?.(
      this.x,
      eyeY,
      this.z,
      {
        x: (aimX * cos - aimZ * sin) * ranged.speed,
        y: aimY * ranged.speed,
        z: (aimX * sin + aimZ * cos) * ranged.speed,
      },
      { fromPlayer: false, damage: this.type.attackDamage },
    );
    ctx.playSound?.('bow_shoot', this.x, this.y, this.z);
  }

  private move(chasing: boolean, dt: number): void {
    const speed = chasing ? this.type.speed * 1.12 : this.type.speed * 0.5;
    let targetVx = 0;
    let targetVz = 0;

    if (this.type.ranged) {
      // 远程生物：方向由 `updateRangedAi` 决定（保持距离），不走寻路
      targetVx = this.moveDirX * speed;
      targetVz = this.moveDirZ * speed;
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
    this.burnTime -= dt;
    this.burnTick += dt;
    while (this.burnTick >= 1) {
      this.burnTick -= 1;
      this.health -= 1;
      this.hitFlash = 0.2;
      if (this.health <= 0) {
        this.health = 0;
        this.dead = true;
        return;
      }
    }
    if (this.burnTime <= 0) this.burnTick = 0;
  }

  /**
   * 受到伤害：无敌帧内无效；否则扣血 + 击退 + 红闪，生命归零则标记死亡并把掉落物交给上层。
   * @param looting 击杀者的「抢夺」等级，只影响掉落数量（伤害加成在 `tools.ts#meleeDamage` 里算好）
   * @returns 是否真的受到了伤害
   */
  hurt(amount: number, knockbackX: number, knockbackZ: number, ctx?: EntityContext, looting = 0): boolean {
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
    for (const drop of this.type.drops) {
      if (drop.chance !== undefined && Math.random() > drop.chance) continue;
      const max = drop.max + Math.max(0, looting);
      const count = drop.min + Math.floor(Math.random() * (max - drop.min + 1));
      if (count > 0) ctx.spawnDrop(drop.itemId, count, this.x, this.y + this.height * 0.5, this.z);
    }
    // 击杀经验（原版数值）；经验球实体还没做，直接进账
    if (this.type.xp > 0) ctx.awardXp?.(this.type.xp);
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
