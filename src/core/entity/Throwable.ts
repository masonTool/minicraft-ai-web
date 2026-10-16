/**
 * 可投掷物实体（K4 尾巴）：雪球 / 鸡蛋 / 喷溅药水
 *
 * 与 `Arrow`（J9）共用同一套"重力 + 逐段命中"的骨架，但**行为上有三处不同**，
 * 所以是独立的一个类而不是给 Arrow 加参数：
 *  1. **不插在方块上**：命中任何东西（方块/生物）都当场结算并消失，
 *     没有"插住等玩家来捡"那一段状态，也没有可拾取性；
 *  2. 重力更小：原版投掷物是 0.03 格/tick² ≈ **12 格/秒²**（箭是 0.05 ≈ 20），
 *     所以扔出来的抛物弧比射箭平；
 *  3. 命中后的效果按种类分流：雪球只推一下（原版 0 伤害）、
 *     鸡蛋 12.5% 孵出小鸡、喷溅药水找主程序结算"4 格范围内挂效果"。
 *
 * 判定与 Arrow 一样自己分子步（每段 ≤0.4 格）：投掷物速度也有 30 格/秒，
 * 不分子步会直接穿过 0.4 格宽的鸡。
 */

import { Entity, entityIntersectsBox, type EntityContext } from './Entity.ts';
import { boxAt } from '../physics/AABB.ts';
import { moveBody, type MovingBody } from '../physics/EntityMotion.ts';

/** 投掷物重力（原版 0.03 格/tick² ≈ 12 格/秒²） */
const GRAVITY = 12;
/** 水中阻力（与箭一致） */
const WATER_DRAG = 0.36;
/** 存在时长上限（秒）：扔出去一直没碰到东西（比如对着天空扔）就自然消失 */
export const THROWABLE_LIFETIME = 30;
/** 逐段判定的最大步长（格） */
const HIT_STEP = 0.4;
/**
 * 玩家投掷的初速（格/秒）。
 * 原版投掷物是 1.5 格/tick = **30 格/秒**，满蓄力的箭是 3 格/tick = 60——
 * 正好差一倍，所以"扔东西打得更近"这件事是数值本身决定的。
 */
export const PLAYER_THROW_SPEED = 30;
/** 鸡蛋砸出小鸡的概率（原版 1/8） */
export const EGG_CHICK_CHANCE = 0.125;

/**
 * 小火球（批次 92，烈焰人吐的）打中玩家的伤害与点燃时长（原版：5 点 + 5 秒）。
 *
 * 数值放在投掷物这一层而不是 `Blaze.ts`：**结算是这里做的**，
 * 而"谁吐的、飞多快"才是生物那一层的事（见 `Blaze.ts` 的 `BLAZE_FIREBALL_SPEED`）。
 */
export const SMALL_FIREBALL_DAMAGE = 5;
export const SMALL_FIREBALL_FIRE_SECONDS = 5;

export type ThrowableKind =
  | 'snowball'
  | 'egg'
  | 'splash_potion'
  | 'lingering_potion'
  | 'small_fireball'
  | 'large_fireball';

/**
 * 大火球（批次 94，恶魂）：直接命中 6 点、**命中后炸开一小片**（威力 1）。
 *
 * 与小锤球（烈焰人那颗）的差别不只是数字：小火球**只打人、不伤地形**，
 * 大火球是"拆方块 + 点火"的那一种（原版恶魂火球能把下界要塞拆出洞来）。
 * 与 `SMALL_FIREBALL_*` 一样，数值留在结算这一层，`Ghast.ts` 只管"谁吐的、飞多快"。
 */
export const LARGE_FIREBALL_DAMAGE = 6;
export const LARGE_FIREBALL_FIRE_SECONDS = 5;
export const LARGE_FIREBALL_POWER = 1;

export interface ThrowableOptions {
  readonly kind: ThrowableKind;
  /** 渲染用的物品 id（贴图与中文名都从它查） */
  readonly itemId: number;
  /** 药水的物品 id（喷溅/滞留时必填：一个要结算范围效果、一个要留下云） */
  readonly potionId?: number;
}

export class Throwable extends Entity implements MovingBody {
  readonly kind: ThrowableKind;
  readonly itemId: number;
  readonly potionId: number | undefined;

  /** 飞行方向（渲染用；命中后速度归零，所以得单独存一份） */
  dirX = 0;
  dirY = 0;
  dirZ = -1;

  constructor(
    x: number,
    y: number,
    z: number,
    velocity: { x: number; y: number; z: number },
    options: ThrowableOptions,
  ) {
    super(x, y, z, 0.25, 0.25);
    this.kind = options.kind;
    this.itemId = options.itemId;
    this.potionId = options.potionId;
    this.vx = velocity.x;
    this.vy = velocity.y;
    this.vz = velocity.z;
    this.updateDirection();
  }

  private updateDirection(): void {
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    if (speed < 1e-6) return;
    this.dirX = this.vx / speed;
    this.dirY = this.vy / speed;
    this.dirZ = this.vz / speed;
  }

  override tick(ctx: EntityContext, dt: number): void {
    if (this.dead) return;

    this.age += dt;
    // 超时：直接消失（原版投掷物飞太久也会 despawn，不会在半空中炸开）
    if (this.age > THROWABLE_LIFETIME) {
      this.dead = true;
      return;
    }

    const inWater = ctx.world.isLiquid(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    // 小火球（批次 92）：**几乎没有重力**——原版它就是一条直线飞过去，
    // 玩家在十几格外站着不动也能被直直打中（有重力的话它会先落地）
    // 两种火球都**不受重力**（原版它们是一条直线飞出去的）
    if (this.kind !== 'small_fireball' && this.kind !== 'large_fireball') this.vy -= GRAVITY * dt;
    if (inWater) {
      const drag = Math.pow(WATER_DRAG, dt);
      this.vx *= drag;
      this.vy *= drag;
      this.vz *= drag;
    }
    this.updateDirection();

    const dx = this.vx * dt;
    const dy = this.vy * dt;
    const dz = this.vz * dt;
    const distance = Math.hypot(dx, dy, dz);
    const steps = Math.max(1, Math.ceil(distance / HIT_STEP));

    for (let i = 0; i < steps; i++) {
      const beforeVx = this.vx;
      const beforeVy = this.vy;
      const beforeVz = this.vz;
      moveBody(ctx.world, this, dx / steps, dy / steps, dz / steps);

      // moveBody 撞到方块会把对应轴速度清零 —— 那就是"砸在方块上了"
      const blockedX = beforeVx !== 0 && this.vx === 0;
      const blockedY = beforeVy !== 0 && this.vy === 0;
      const blockedZ = beforeVz !== 0 && this.vz === 0;
      if (blockedX || blockedY || blockedZ) {
        this.impact(ctx);
        return;
      }

      if (this.tryHitEntity(ctx)) return;
    }
  }

  /**
   * 这一段有没有打到生物。
   *
   * 不判玩家：投掷物目前只由玩家扔出，而"自己的药水溅到自己"走的是
   * 喷溅的**范围结算**（`applySplash`），不是直接命中——照着原版也是这个分工。
   */
  private tryHitEntity(ctx: EntityContext): boolean {
    const box = boxAt(this.x, this.y, this.z, this.width, this.height);

    // 小火球（批次 92）：它**只打玩家**（是烈焰人吐出来的），所以先查玩家。
    // 其余投掷物都是玩家扔的，只查生物——两者方向相反，不该混成一条
    if (this.kind === 'small_fireball' || this.kind === 'large_fireball') {
      if (ctx.playerBox && entityIntersectsBox(this, ctx.playerBox)) {
        const large = this.kind === 'large_fireball';
        ctx.hurtPlayer(large ? LARGE_FIREBALL_DAMAGE : SMALL_FIREBALL_DAMAGE, this.x, this.z, 'fire');
        ctx.ignitePlayer?.(large ? LARGE_FIREBALL_FIRE_SECONDS : SMALL_FIREBALL_FIRE_SECONDS);
        this.impact(ctx);
        return true;
      }
      return false;
    }

    const mob = ctx.hitMob?.(box) ?? null;
    if (!mob) return false;

    // 雪球：原版**0 伤害**，只把目标推一下（所以走 `push` 而不是 `hurt(0)`——
    // 后者的语义是"没造成伤害"，连挨打动画都不会有）
    if (this.kind === 'snowball') {
      const length = Math.hypot(this.vx, this.vz);
      const kx = length > 1e-6 ? this.vx / length : this.dirX;
      const kz = length > 1e-6 ? this.vz / length : this.dirZ;
      mob.push(kx, kz);
    }

    this.impact(ctx);
    return true;
  }

  /**
   * 命中结算：先按种类分流，再标记自己消失。
   *
   * 位置取**命中那一刻的实体位置**而不是方块格心：喷溅药水的范围判定以爆心为准，
   * 用格心会让"贴着墙扔"的药水偏出去半格。
   */
  private impact(ctx: EntityContext): void {
    const x = this.x;
    const y = this.y;
    const z = this.z;

    switch (this.kind) {
      case 'snowball':
        ctx.playSound?.('arrow_hit', x, y, z);
        break;
      case 'egg':
        ctx.playSound?.('break_glass', x, y, z);
        // 原版 1/8 概率孵出小鸡（掷点在这里做，`ctx.hatchChicken` 只负责生成）
        if (Math.random() < EGG_CHICK_CHANCE) ctx.hatchChicken?.(x, y, z);
        break;
      case 'splash_potion':
        // 范围结算交给主程序（它才知道周围有谁），实体层只管"在哪炸"
        if (this.potionId !== undefined) ctx.applySplash?.(this.potionId, x, y, z);
        else ctx.playSound?.('splash', x, y, z);
        break;
      case 'small_fireball':
        // 命中：原版小火球**不点燃方块**（只有火球那个大号才点），所以这里只出一声
        // （项目里没有"火焰命中"那一声，借用箭命中；见 `Blaze.ts` 的同一处注记）
        ctx.playSound?.('arrow_hit', x, y, z);
        break;
      case 'large_fireball':
        // 命中：**炸开一小片**（原版 ghast 火球能拆方块、也会点火）。
        // 爆炸本身（方块破坏 + 范围内伤害）归主程序，实体层只报"在哪炸"——
        // 与溅射药水那条"范围结算交给主程序"是同一个分工
        ctx.explode?.(x, y, z, LARGE_FIREBALL_POWER);
        ctx.playSound?.('explode', x, y, z);
        break;
      case 'lingering_potion':
        // 滞留型不炸开，而是**在原地留下**一片云（K4 尾巴）：云的生命周期归主程序，
        // 实体层同样只报"在哪摔的"
        if (this.potionId !== undefined) ctx.spawnLingering?.(this.potionId, x, y, z);
        else ctx.playSound?.('splash', x, y, z);
        break;
      default:
        break;
    }

    this.dead = true;
  }
}
