/**
 * 可投掷物实体（K4 尾巴）：雪球 / 鸡蛋 / 喷溅药水 / 末影珍珠
 *
 * 与 `Arrow`（J9）共用同一套"重力 + 逐段命中"的骨架，但**行为上有三处不同**，
 * 所以是独立的一个类而不是给 Arrow 加参数：
 *  1. **不插在方块上**：命中任何东西（方块/生物）都当场结算并消失，
 *     没有"插住等玩家来捡"那一段状态，也没有可拾取性；
 *  2. 重力更小：原版投掷物是 0.03 格/tick² ≈ **12 格/秒²**（箭是 0.05 ≈ 20），
 *     所以扔出来的抛物弧比射箭平；
 *  3. 命中后的效果按种类分流：雪球只推一下（原版 0 伤害）、
 *     鸡蛋 12.5% 孵出小鸡、喷溅药水找主程序结算"4 格范围内挂效果"、
 *     **末影珍珠把扔它的人传到落点上**（批次 113）。
 *
 * 判定与 Arrow 一样自己分子步（每段 ≤0.4 格）：投掷物速度也有 30 格/秒，
 * 不分子步会直接穿过 0.4 格宽的鸡。
 */

import { Entity, entityIntersectsBox, type EntityContext } from './Entity.ts';
import { boxAt } from '../physics/AABB.ts';
import { moveBody, type MovingBody } from '../physics/EntityMotion.ts';
import { blockDef } from '../registry/blocks.ts';
// 末影之眼落地要"掉回地上"，所以实体层要知道那是哪件物品（与 `Mob` 的掉落同一个口径）
import { Item } from '../registry/items.ts';

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
  | 'large_fireball'
  | 'ender_pearl'
  | 'ender_eye';

/**
 * 末影珍珠落地的摔落伤害（批次 113，原版 5 点）。
 *
 * 原版走的是 `DamageSource.FALL`，所以**摔落保护附魔能减它**、创造模式不掉血——
 * 这两件事都不是这里做的：实体层只报"珍珠落在哪"，扣血由主程序按摔落那条路走
 * （见 `main.teleportByEnderPearl`）。
 */
export const ENDER_PEARL_FALL_DAMAGE = 5;
/**
 * 落点卡在方块里时**最多往上顶几格**（批次 113）。
 *
 * 原版把玩家放在珍珠落地那一点上、卡住就往上一格一格找；顶满这几格还不行就用原落点
 * （宁可卡一下，也不要凭空把人挪走十几格）。
 */
export const ENDER_PEARL_LANDING_LIFT = 3;

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

/**
 * 末影之眼飞多久（秒，批次 114）：原版约 80 tick（4 秒），
 * 飞出去三四十格就落地——**它给的是方向，不是位置**（这是原版的用法）。
 */
export const ENDER_EYE_LIFETIME = 3.5;
/** 眼睛朝要塞飘的水平速度（格/秒） */
export const ENDER_EYE_SPEED = 11;
/**
 * 出手时往上的速度（格/秒）。
 *
 * ⚠️ 原版是"把'投掷点 → 要塞'的**归一化方向**（含竖直分量）当初始速度，再叠一个
 * 每 tick +0.15 的上升"；这里简化成"水平朝要塞 + 一个固定的上升速度"——观感一样
 * （一条飘向要塞、慢慢压平的弧线），而且不必把"要塞在脚下多少格"掺进计算里。
 */
export const ENDER_EYE_RISE = 5.5;
/** 上升速度的衰减（每秒剩下的比例）：让弧线在最后压平 */
export const ENDER_EYE_RISE_DRAG = 0.55;
/**
 * 水平距离要塞这么近之后就**不再往前飘**，只往上飘（原版用它当"就在脚下了"的信号：
 * 眼睛贴着地面往上蹦，那意味着挖下去）。
 */
export const ENDER_EYE_CLOSE_RANGE = 15;
/**
 * 落地时把眼睛**掉回地上**的概率（原版 0.8）：剩下那 0.2 碎掉，什么都不留。
 *
 * 正因为有这 0.8，玩家才能一路反复扔着找要塞（原版也是这么设计的）。
 */
export const ENDER_EYE_DROP_CHANCE = 0.8;

export interface ThrowableOptions {
  readonly kind: ThrowableKind;
  /** 渲染用的物品 id（贴图与中文名都从它查） */
  readonly itemId: number;
  /** 药水的物品 id（喷溅/滞留时必填：一个要结算范围效果、一个要留下云） */
  readonly potionId?: number;
  /**
   * **飞行目标**（批次 114，只有末影之眼用）：眼睛会朝它飘。
   *
   * 目标由主程序算（它才知道种子与维度，见 `nearestStronghold`），
   * 实体层只负责"朝那儿飞"。不填就是普通投掷物（在下界/末地扔眼睛就是这样）。
   */
  readonly target?: { x: number; y: number; z: number };
}

export class Throwable extends Entity implements MovingBody {
  readonly kind: ThrowableKind;
  readonly itemId: number;
  readonly potionId: number | undefined;
  /** 飞行目标（只有末影之眼用；见 `ThrowableOptions.target`） */
  readonly target: { x: number; y: number; z: number } | undefined;

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
    this.target = options.target;
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

    // 末影之眼（批次 114）：飞够时间就落地（原版约 4 秒）——落地的结算与"撞到东西"一样
    if (this.kind === 'ender_eye' && this.age > ENDER_EYE_LIFETIME) {
      this.impact(ctx);
      return;
    }

    const inWater = ctx.world.isLiquid(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    // 小火球（批次 92）：**几乎没有重力**——原版它就是一条直线飞过去，
    // 玩家在十几格外站着不动也能被直直打中（有重力的话它会先落地）
    // 两种火球都**不受重力**（原版它们是一条直线飞出去的）
    if (this.kind === 'ender_eye' && this.target) {
      // 朝要塞飘（自带"往上飘"那一下），所以不叠重力
      this.steerEye(dt);
    } else if (this.kind !== 'small_fireball' && this.kind !== 'large_fireball') {
      this.vy -= GRAVITY * dt;
    }
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
    // 末影之眼**穿过生物**（原版它就是一件"指路的东西"，不会打在谁身上）
    if (this.kind === 'ender_eye') return false;

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
      case 'ender_eye':
        // 末影之眼（批次 114）：落地时**八成掉回地上**（原版 0.8），两成碎掉。
        // 正因为有这 0.8，玩家才能一路反复扔着找要塞——所以这条概率不是"手感"，
        // 而是"找要塞这件事成立不成立"的一部分。
        if (Math.random() < ENDER_EYE_DROP_CHANCE) {
          ctx.spawnDrop(Item.ENDER_EYE, 1, x, y, z);
        } else {
          ctx.playSound?.('break_glass', x, y, z);
          ctx.spawnPortalParticles?.(x, y + 0.3, z, 12, 0.4);
        }
        break;
      case 'ender_pearl': {
        // 末影珍珠（批次 113）：**把扔它的人传到落点上**（原版就是"人到珍珠落地的地方"）。
        //
        // 为什么由实体层算落点：它已经拿着 `ctx.getBlock`，而"要不要往上顶"是纯粹的
        // 几何问题（见 `pearlLanding`）；"传过去之后掉 5 点血、响一声"归主程序。
        //
        // ⚠️ 这里**不判"是不是玩家扔的"**：投掷物只有两条来源（玩家与发射器），
        // 而发射器**不放末影珍珠**（`registry/dispense.ts` 里没有它，`test:dispenser`
        // 有一条断言盯着这件事）——原版那种珍珠没有主人、落地什么都不发生，
        // 与其做一档"扔出去白扔"，不如让它根本不出现。
        // 若哪天有人往发射器表里加了珍珠，那条断言会红，回来把这里补成"要认主人"。
        const landing = this.pearlLanding(ctx);
        ctx.teleportPlayer?.(landing.x, landing.y, landing.z);
        break;
      }
      default:
        break;
    }

    this.dead = true;
  }

  /**
   * 末影之眼的飞行（批次 114）：**朝目标飘 + 慢慢压平**。
   *
   * 两件事：
   *  - 上升速度按 `ENDER_EYE_RISE_DRAG` 衰减（出手那一下往上窜，之后压平）；
   *  - 水平速度朝目标方向平滑收敛（`min(1, 3 * dt)` 那一档与生物的 `flyToward` 同款）——
   *    所以**朝反方向扔出去它也会拐回来**（原版就是"它自己指向要塞"）。
   *
   * 没有目标时（不在主世界 / 拿不到种子）两条都不做：那种情况下它按普通投掷物
   * 受重力落下（见 `tick` 里那个分支），不会诡异地一直往上飘。
   */
  private steerEye(dt: number): void {
    this.vy *= Math.pow(ENDER_EYE_RISE_DRAG, dt);
    const target = this.target;
    if (!target) return;
    const dx = target.x - this.x;
    const dz = target.z - this.z;
    const distance = Math.hypot(dx, dz);
    const factor = Math.min(1, 3 * dt);
    // 很近了：只往上飘（原版那个"就在脚下了"的信号）——把**水平速度收掉**，
    // 否则它会照着手上的初速继续飞过去、一头扎进地里（原版那边有每 tick 0.8 的阻尼，
    // 这里是等价的收法）
    if (distance < ENDER_EYE_CLOSE_RANGE) {
      this.vx -= this.vx * factor;
      this.vz -= this.vz * factor;
      return;
    }
    this.vx += ((dx / distance) * ENDER_EYE_SPEED - this.vx) * factor;
    this.vz += ((dz / distance) * ENDER_EYE_SPEED - this.vz) * factor;
  }

  /**
   * 末影珍珠的落点（批次 113）：从落点那一格起往**上**找最多 `ENDER_PEARL_LANDING_LIFT`
   * 格，找到"这一格与上面一格都站得下人"为止（原版也是卡住就往上顶）。
   *
   * 为什么取"格心 + 0.5"：玩家/实体的坐标约定是"脚下那一格的格心"（与 `Mob` 一致，
   * 见 `physics/EntityMotion.ts` 的用法），直接把珍珠的浮点坐标丢过去会让玩家半只脚
   * 卡在方块里。
   */
  private pearlLanding(ctx: EntityContext): { x: number; y: number; z: number } {
    const bx = Math.floor(this.x);
    const bz = Math.floor(this.z);
    let by = Math.floor(this.y);
    for (let lift = 0; lift < ENDER_PEARL_LANDING_LIFT; lift++) {
      const solid = blockDef(ctx.getBlock(bx, by, bz)).solid;
      const headSolid = blockDef(ctx.getBlock(bx, by + 1, bz)).solid;
      if (!solid && !headSolid) break;
      by++;
    }
    return { x: bx + 0.5, y: by, z: bz + 0.5 };
  }
}
