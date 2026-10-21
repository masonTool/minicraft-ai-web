/**
 * 马（批次 253）：第一只**可骑乘的生物**
 *
 * 与船/矿车共用同一套"载具"语义（`main` 的 `Rideable` 联合类型、`vehicleInput`、
 * 上下车/贴位置/下车间距），区别只在**运动来源**：
 *  - 船/矿车：载具自己按输入加速；
 *  - 马：生物自己那套 `move()` 仍然负责碰撞与台阶，骑手只是把方向与前进量递给它。
 *
 * 骑乘时不走 AI（游荡/追人/繁殖），但 `Mob.tick` 的其余部分照旧——
 * 燃烧、掉落、无敌帧、繁殖计时都没被跳过（覆写的是 `updateAi` 这一层）。
 *
 * ⚠️ 与本项目宠物系统的折中：
 *  - 驯服用**苹果**（原版是反复骑乘直到它认你），走的是已有的 `tameWith` 通道；
 *  - 只做"前进/后退 + 左右转向"，没有跳跃蓄力、没有马的跳跃高度。
 *
 * **批次 406 起猪与炽足兽也走这个类**（`needsTaming === false`、`canJump === false`）：
 * 骑乘这件事与"是什么生物"无关，差别只有三条——要不要先驯服、能不能跳、
 * 速度取自 `type.speed`。再写一个 `Pig.ts` 会是同一份代码抄第二遍，
 * 而抄漏一处（比如忘了覆写 `updateAi`）的表现是"能骑上但按 W 不动"，很难查。
 */

import { Mob, type HurtSource } from './Mob.ts';
import type { EntityContext } from './Entity.ts';
import { Item } from '../registry/items.ts';
import { Chest } from '../container/Chest.ts';

/** 左右转向的速度（弧度/秒）：比视角慢一档，不然马会像陀螺 */
const HORSE_TURN_RATE = 2.2;
/** 松开前进后的减速（每秒比例） */
const HORSE_STOP_DRAG = 6;
/** 马的起跳初速度（格/秒）：约 1.5 格高（v²/2g） */
export const HORSE_JUMP_SPEED = 8.2;
/** 连续起跳的最小间隔（秒） */
const HORSE_JUMP_COOLDOWN = 0.8;

/** 马铠四档（批次 571）：只有真正的马/驴/骡能装，猪与炽足兽不行 */
export type HorseArmorTier = 'leather' | 'iron' | 'golden' | 'diamond';

export function horseArmorTier(itemId: number): HorseArmorTier | null {
  if (itemId === Item.LEATHER_HORSE_ARMOR) return 'leather';
  if (itemId === Item.IRON_HORSE_ARMOR) return 'iron';
  if (itemId === Item.GOLDEN_HORSE_ARMOR) return 'golden';
  if (itemId === Item.DIAMOND_HORSE_ARMOR) return 'diamond';
  return null;
}

/** 四档马铠的护甲点（原版量级：皮革 3 / 铁 5 / 金 7 / 钻石 11） */
const HORSE_ARMOR_POINTS: Readonly<Record<HorseArmorTier, number>> = {
  leather: 3,
  iron: 5,
  golden: 7,
  diamond: 11,
};

export class Horse extends Mob {
  /** 谁骑着它（本项目只有玩家能上） */
  passenger: 'player' | null = null;
  /**
   * 骑乘朝向（批次 253 修复）。
   *
   * ⚠️ **不能用 `this.yaw`**：`Mob.tick` 会按本帧的移动方向回写 `yaw`
   * （`atan2(vx, vz)`），于是"用 yaw 算速度 → yaw 被反写 → 下一帧朝反方向"，
   * 马会在原地来回蹭（实测位置在 2.5 ↔ 2.617 之间往复、vx 正负交替）。
   * 骑手给的朝向单独存一份，主程序每帧写它。
   */
  rideYaw = 0;
  /** 有没有装鞍（批次 254）：驯服之后还要装鞍才能骑 */
  saddled = false;
  /** 装着的马铠物品 id（批次 571）：null = 没装 */
  armor: number | null = null;
  /**
   * 货舱（J19b，批次 594）：驴/骡/羊驼装上箱子后才有，15 格。
   * 马不能装（原版马只有鞍+马铠），猪/炽足兽也不能。
   */
  cargo: Chest | null = null;

  /** 这个种类能不能装货舱：驴/骡/羊驼；马不行 */
  get canCarryCargo(): boolean {
    return this.type.id === 'donkey' || this.type.id === 'mule' || this.type.id === 'llama' || this.type.id === 'trader_llama';
  }

  /** 这个种类能不能装马铠（猪/炽足兽不行） */
  get canWearHorseArmor(): boolean {
    return this.type.id === 'horse' || this.type.id === 'donkey' || this.type.id === 'mule';
  }

  /** 当前马铠的护甲点（没装为 0） */
  get armorPoints(): number {
    const tier = this.armor === null ? null : horseArmorTier(this.armor);
    return tier ? HORSE_ARMOR_POINTS[tier] : 0;
  }

  /** 马铠减伤（批次 571）：只挡玩家/生物伤害，环境伤害照旧穿透 */
  override hurt(
    amount: number,
    knockbackX: number,
    knockbackZ: number,
    ctx?: EntityContext,
    looting = 0,
    knockbackLevel = 0,
    source?: HurtSource,
  ): boolean {
    const points = this.armorPoints;
    if (points > 0 && source !== undefined && source.kind !== 'environment') {
      amount = Math.max(1, amount * (1 - points * 0.04));
    }
    return super.hurt(amount, knockbackX, knockbackZ, ctx, looting, knockbackLevel, source);
  }
  /** 起跳冷却（秒） */
  private rideJumpCooldown = 0;
  /** 玩家坐在坐骑背上时脚底相对坐骑脚底的高度（渲染与相机用） */
  readonly seatHeight = 1.45;

  /**
   * 要不要先驯服才能骑（批次 406）。
   *
   * 马/驴/骡/羊驼要，**猪与炽足兽不要**——原版这两只本来就是"装鞍即骑"，
   * 没有驯服这一步。判断放在这里而不是散在 `main` 里，
   * 是为了让"能不能骑"只有一处口径。
   */
  get needsTaming(): boolean {
    return this.type.id !== 'pig' && this.type.id !== 'strider';
  }

  /** 骑着时按跳跃键能不能起跳（猪与炽足兽不能；原版它们也确实跳不了） */
  get canJump(): boolean {
    return this.type.id !== 'pig' && this.type.id !== 'strider';
  }

  protected override updateAi(ctx: EntityContext, dt: number): void {
    if (this.rideJumpCooldown > 0) this.rideJumpCooldown -= dt;

    if (this.passenger !== null) {
      const input = ctx.vehicleInput;
      const forward = input?.forward ?? 0;
      const strafe = input?.strafe ?? 0;

      // 转向：左右键（A/D 或摇杆横轴）改朝向；马不像船能横移
      this.rideYaw -= strafe * HORSE_TURN_RATE * dt;
      // 渲染朝向跟着骑乘朝向走（`yaw` 仍可能被 `Mob.tick` 回写，所以每帧重写一次）
      this.yaw = this.rideYaw;

      // 跳跃（批次 254）：骑着时按跳跃键起跳（下马改按潜行）。
      // 冷却防"按住不放连跳"——原版是蓄力，这里退化成"点一下跳一次"。
      if (this.canJump && input?.jump === true && this.onGround && this.rideJumpCooldown <= 0) {
        this.vy = HORSE_JUMP_SPEED;
        this.rideJumpCooldown = HORSE_JUMP_COOLDOWN;
        this.onGround = false;
      }

      if (Math.abs(forward) > 0.05) {
        // 直接给水平速度：位置的积分在 `Mob.tick` 里统一做（`moveBody`），
        // 这里不需要再走 `move()`——那条分支是给 AI 寻路用的，骑马是"人给方向"。
        // 后退只有一半速度（原版马也这样）。
        const speed = this.type.speed * (forward > 0 ? 0.9 : 0.45);
        this.vx = -Math.sin(this.rideYaw) * speed;
        this.vz = -Math.cos(this.rideYaw) * speed;
        return;
      }

      // 松手：慢慢停下，不进入游荡（否则马会自己走开）
      this.vx *= Math.max(0, 1 - HORSE_STOP_DRAG * dt);
      this.vz *= Math.max(0, 1 - HORSE_STOP_DRAG * dt);
      this.idle = true;
      return;
    }

    super.updateAi(ctx, dt);
  }
}
