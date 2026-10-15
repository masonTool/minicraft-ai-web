/**
 * 箭矢实体（J9）
 *
 * 行为对齐原版：
 *  - 受重力（20 格/秒²）、在水里明显减速；
 *  - 命中方块就**插在上面**（原版能捡回来，所以插住的箭不是立刻消失）；
 *  - 命中生物就造成伤害并消失；被骷髅射出来的箭还会打玩家，走 `'projectile'` 伤害类型
 *    （这样"弹射物保护"这条附魔终于有作用对象）；
 *  - 存在 60 秒后自然消失（原版 despawn 时间）。
 *
 * 命中判定为什么自己分子步：`moveBody` 内部虽然也会分步，但那是"防穿方块"用的，
 * 拿不到每一步的位置。箭在满蓄力时约 1 格/帧，不分子步就会穿过 0.6 格宽的生物。
 * 这里按 ≤0.4 格自己切段，每段分别判"撞没撞生物"，与方块碰撞交给 `moveBody`。
 */

import { Entity, entityIntersectsBox, type EntityContext } from './Entity.ts';
import { Item } from '../registry/items.ts';
import { tippedArrowEffectsOf } from '../survival/TippedArrow.ts';
import { boxAt } from '../physics/AABB.ts';
import { moveBody, type MovingBody } from '../physics/EntityMotion.ts';

/** 箭的重力（原版 0.05 格/tick² ≈ 20 格/秒²） */
const GRAVITY = 20;
/** 水中阻力（每秒衰减到原来的 0.36 倍） */
const WATER_DRAG = 0.36;
/** 存在时长上限（秒） */
export const ARROW_LIFETIME = 60;
/** 刚射出的这段时间内不能捡（不然会立刻被自己吸回来） */
const PICKUP_DELAY = 0.5;
/** 插住的箭的拾取半径（格） */
const PICKUP_RANGE = 1.2;
/** 逐段判定的最大步长（格） */
const HIT_STEP = 0.4;

export interface ArrowOptions {
  /** 是不是玩家射的（玩家射的箭不会打玩家自己） */
  fromPlayer: boolean;
  /** 命中生物的伤害 */
  damage: number;
  /** 击退强度（原版基础 1、冲击附魔每级 +1） */
  knockback?: number;
  /** 火矢：命中后点燃目标的秒数 */
  fireSeconds?: number;
  /**
   * 能不能捡回来。
   * 原版里"无限"附魔射出的箭**不可拾取**（否则等于无限刷箭），由调用方传 false。
   */
  pickable?: boolean;
  /**
   * 这一箭是**哪件物品**（默认普通箭）。
   * 药水箭射出去之后捡回来必须还是原来那支 —— 否则一箭下去就"降级"成普通箭了。
   */
  itemId?: number;
  /**
   * 这一箭带的药水（K4 最后一步）：命中生物时按它挂 **1/8 时长**的效果
   * （见 `survival/TippedArrow.ts`）。普通箭不传。
   */
  potionId?: number;
}

/** 补全默认值之后的选项（内部用，避免到处写 `?? 1`） */
interface ResolvedArrowOptions {
  fromPlayer: boolean;
  damage: number;
  knockback: number;
  fireSeconds: number;
  pickable: boolean;
  itemId: number;
  potionId?: number;
}

export class Arrow extends Entity implements MovingBody {
  /** 命中后插在方块上，不再移动 */
  stuck = false;
  /** 射中/插住时朝的方向（渲染用；命中后速度会被清零，所以得存下来） */
  dirX = 0;
  dirY = 0;
  dirZ = -1;

  private readonly options: ResolvedArrowOptions;
  /** 命中过的生物 id，避免同一支箭在子步里重复打同一个目标 */
  private hitMobIds = new Set<number>();

  constructor(
    x: number,
    y: number,
    z: number,
    velocity: { x: number; y: number; z: number },
    options: ArrowOptions,
  ) {
    super(x, y, z, 0.16, 0.16);
    this.vx = velocity.x;
    this.vy = velocity.y;
    this.vz = velocity.z;
    this.options = {
      fromPlayer: options.fromPlayer,
      damage: options.damage,
      knockback: options.knockback ?? 1,
      fireSeconds: options.fireSeconds ?? 0,
      pickable: options.pickable ?? true,
      itemId: options.itemId ?? Item.ARROW,
      ...(options.potionId === undefined ? {} : { potionId: options.potionId }),
    };
    this.updateDirection();
  }

  /** 这一箭是哪件物品（渲染贴图与捡回来都用它） */
  get itemId(): number {
    return this.options.itemId;
  }

  /** 这一箭带的药水（普通箭是 undefined） */
  get potionId(): number | undefined {
    return this.options.potionId;
  }

  /** 当前朝向（单位向量） */
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
    if (this.age > ARROW_LIFETIME) {
      this.dead = true;
      return;
    }

    // 插住的箭：留在原地等玩家来捡
    if (this.stuck) {
      this.tryPickup(ctx);
      return;
    }

    const inWater = ctx.world.isLiquid(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    this.vy -= GRAVITY * dt;
    if (inWater) {
      const drag = Math.pow(WATER_DRAG, dt);
      this.vx *= drag;
      this.vy *= drag;
      this.vz *= drag;
    }

    this.updateDirection();

    // 自己切段推进：每段只走 ≤0.4 格，段内判一次生物命中
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

      // moveBody 撞到方块时会把对应轴的速度清零，这就是"撞墙了"
      const blockedX = beforeVx !== 0 && this.vx === 0;
      const blockedY = beforeVy !== 0 && this.vy === 0;
      const blockedZ = beforeVz !== 0 && this.vz === 0;
      if (blockedX || blockedY || blockedZ) {
        this.stick();
        return;
      }

      if (this.tryHitEntity(ctx)) return;
    }

    this.tryPickup(ctx);
  }

  /** 插在方块上 */
  private stick(): void {
    this.stuck = true;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
  }

  /**
   * 这一段有没有打到生物或玩家。
   * @returns 是否已经结算（结算后这支箭要么死了、要么插住了）
   */
  private tryHitEntity(ctx: EntityContext): boolean {
    const box = boxAt(this.x, this.y, this.z, this.width, this.height);

    // 玩家：只有"不是玩家自己射的"才会打玩家（骷髅的箭）
    if (!this.options.fromPlayer && ctx.playerBox && entityIntersectsBox(this, ctx.playerBox)) {
      ctx.hurtPlayer(this.options.damage, this.x, this.z, 'projectile');
      this.dead = true;
      return true;
    }

    const mob = ctx.hitMob?.(box) ?? null;
    if (!mob || this.hitMobIds.has(mob.id)) return false;

    this.hitMobIds.add(mob.id);
    const length = Math.hypot(this.vx, this.vz);
    const kx = length > 1e-6 ? this.vx / length : this.dirX;
    const kz = length > 1e-6 ? this.vz / length : this.dirZ;
    mob.hurt(this.options.damage, kx * this.options.knockback, kz * this.options.knockback, ctx);
    if (this.options.fireSeconds > 0) mob.ignite(this.options.fireSeconds);
    // 药水箭（K4 最后一步）：命中挂上药水的效果，时长是原药水的 1/8（原版规则）。
    // 与喷溅药水的差别：**只作用于被射中的那一只**，没有范围结算（原版如此）
    if (this.options.potionId !== undefined) {
      for (const effect of tippedArrowEffectsOf(this.options.potionId)) {
        mob.effects.apply(effect.id, effect.seconds, effect.amplifier);
      }
    }
    this.dead = true;
    return true;
  }

  /** 插住的箭等玩家走近就进背包（原版能捡回箭） */
  private tryPickup(ctx: EntityContext): void {
    if (!this.stuck || !this.options.pickable) return;
    if (this.age < PICKUP_DELAY || !ctx.playerBox) return;

    const box = ctx.playerBox;
    const dx = this.x - (box.minX + box.maxX) / 2;
    const dy = this.y - (box.minY + box.maxY) / 2;
    const dz = this.z - (box.minZ + box.maxZ) / 2;
    if (dx * dx + dy * dy + dz * dz > PICKUP_RANGE * PICKUP_RANGE) return;

    // 捡回来的是**这一支本身**（药水箭捡回来还是药水箭，不能降级成普通箭）
    const leftover = ctx.pickup(this.options.itemId, 1);
    if (leftover <= 0) this.dead = true;
  }
}
