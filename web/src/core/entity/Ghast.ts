/**
 * 恶魂（批次 94，J26 的最后一块）
 *
 * 飞行那一层的分工与烈焰人一样（见 `Blaze.ts` 的注释）：**"会飞"在基类
 * `Mob` 的 `flyAi` / `flyToward` 里**，这里只加恶魂自己的两件事——
 * **保持距离**与**发射大火球**。
 *
 * ⚠️ 它**不调用 `super.flyAi`**（烈焰人是调用的）：基类那套是"悬停 + 逼近到 1.5 格
 * 再撞人"，而恶魂恰恰相反——原版它远远地吊着你打，贴上去反而打不着。
 * 所以这里自己写飞行：悬停浮动 + 按距离决定"进/退/停"。
 *
 * 数值按原版：火球约每 3 秒一颗、初速比烈焰人的慢（它很好躲）、
 * 命中炸开一个很小的口子（威力 1，原版 ghast 火球能拆方块）。
 */

import type { EntityContext } from './Entity.ts';
import { Mob } from './Mob.ts';
import { GHAST_TYPE } from './mobs.ts';

/** 两次开火之间隔多久（秒）——原版约 3 秒一颗 */
export const GHAST_FIRE_COOLDOWN = 3;
/** 开火距离（格）：原版它能打 100 格，但太远了玩家连火球都看不见，这里取 48 */
export const GHAST_FIRE_RANGE = 48;
/** 想保持的距离（格）：比这近就往后退，比这远就往前挪 */
export const GHAST_KEEP_DISTANCE = 16;
/** 距离差多少以内算"刚合适"（不动）——不留这一圈就会在目标距离上左右抖 */
export const GHAST_DISTANCE_SLACK = 5;
/** 火球初速（格/秒）。比烈焰人的 16 慢：原版恶魂火球肉眼可躲 */
export const GHAST_FIREBALL_SPEED = 11;
/** 火球直接命中的伤害（原版 6 点） */
export const GHAST_FIREBALL_DAMAGE = 6;
/** 命中后点着多久（秒） */
export const GHAST_FIREBALL_FIRE_SECONDS = 5;
/** 命中后炸开的威力（TNT 是 4；恶魂火球只有一个小口子，原版威力 1） */
export const GHAST_FIREBALL_POWER = 1;

export class Ghast extends Mob {
  /** 悬停上下浮动的相位（自己一份：基类那个是 `private`） */
  private bobPhase = 0;
  /**
   * 距下次开火还有多久。出生先摇半程：刚刷出来就一炮打脸既不符合原版，
   * 也会让"在下界走夜路"变成完全的随机死亡。
   */
  private fireTimer = GHAST_FIRE_COOLDOWN * (0.5 + Math.random() * 0.5);

  constructor(x: number, y: number, z: number) {
    super(GHAST_TYPE, x, y, z);
  }

  /** 距下次开火还有多久（测试与调试用） */
  get fireCooldown(): number {
    return this.fireTimer;
  }

  protected override flyAi(
    ctx: EntityContext,
    dt: number,
    player: { x: number; y: number; z: number } | null,
  ): void {
    this.bobPhase += dt * 1.2;
    const bob = Math.sin(this.bobPhase) * 0.6;

    if (!player) {
      // 没目标：慢慢飘（与基类那套不同：它飘得很慢，也不落地）
      this.wanderTimerPrivate(dt);
      this.flyToward(this.x + Math.sin(this.wanderYawPrivate) * 6, this.y + bob, this.z + Math.cos(this.wanderYawPrivate) * 6, dt);
      return;
    }

    if (this.fireTimer > 0) this.fireTimer -= dt;

    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const distance = Math.hypot(dx, dz) || 1;
    const mouthY = this.y + this.type.height * 0.5;

    // 保持距离：太远追、太近退、"刚合适"就只悬停（不留那一圈它会在目标距离左右抖）
    const toward = distance > GHAST_KEEP_DISTANCE + GHAST_DISTANCE_SLACK
      ? 1
      : distance < GHAST_KEEP_DISTANCE - GHAST_DISTANCE_SLACK
        ? -1
        : 0;
    const step = toward * 6;
    this.flyToward(
      this.x + (dx / distance) * step,
      player.y + this.type.height * 0.7 + bob,
      this.z + (dz / distance) * step,
      dt,
    );

    if (distance > GHAST_FIRE_RANGE || this.fireTimer > 0) return;

    this.fireTimer = GHAST_FIRE_COOLDOWN;
    const dy = player.y + 1 - mouthY;
    const length = Math.hypot(dx, dy, dz) || 1;
    ctx.spawnLargeFireball?.(this.x, mouthY, this.z, {
      x: (dx / length) * GHAST_FIREBALL_SPEED,
      y: (dy / length) * GHAST_FIREBALL_SPEED,
      z: (dz / length) * GHAST_FIREBALL_SPEED,
    });
    ctx.playSound?.('fuse', this.x, mouthY, this.z);
  }

  /** 没目标时的飘动计时（`Mob` 里那两个字段是 `private`，这里自己存一份） */
  private driftTimer = 0;
  private driftYaw = 0;

  private wanderTimerPrivate(dt: number): void {
    this.driftTimer -= dt;
    if (this.driftTimer <= 0) {
      this.driftTimer = 4 + Math.random() * 4;
      this.driftYaw = Math.random() * Math.PI * 2;
    }
  }

  private get wanderYawPrivate(): number {
    return this.driftYaw;
  }
}
