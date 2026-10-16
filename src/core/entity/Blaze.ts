/**
 * 烈焰人（批次 92，J26 的断环之一）
 *
 * 它是**第一种会飞的生物**，也是**唯一掉烈焰棒**的生物——而烈焰棒拆出来的烈焰粉
 * 是酿造台的燃料、也是酿造台自己的配方原料。所以在它出现之前，**整族 112 件药水与
 * 药水箭在生存里一瓶都拿不到**（批次 91 的可达性审计量出来的正是这条链）。
 *
 * 行为分工（这样分是为了让"会飞"这件事以后能复用）：
 *  - **飞行与逼近**在基类 `Mob.flyAi` 里（悬停 + 靠到 2.5 格内撞人）；
 *  - 这里只加**它自己的那一招：吐小火球**——原版烈焰人最标志性的东西。
 *
 * 数值按原版：接触伤害 6（`BLAZE_TYPE.attackDamage`）、火球 5 点伤害 + 点燃 5 秒、
 * 大约每 2 秒吐一颗。⚠️ 与原版的差异：没有"蓄火 3 秒然后连吐三颗"那套节奏，
 * 也没有开火前的火焰粒子（本项目没有粒子系统那一层）。
 */

import type { EntityContext } from './Entity.ts';
import { Mob } from './Mob.ts';
import { BLAZE_TYPE } from './mobs.ts';

/** 两次吐火球之间隔多久（秒）——原版约 2 秒一颗 */
export const BLAZE_FIRE_COOLDOWN = 2;
/**
 * 开火的水平距离（格）。比 `followRange`(32) 小：原版它要"看得见你"才吐，
 * 而 32 格外吐出来的火球飞两秒才到，玩家早就走开了——那种"对着空气吐"看起来像 bug
 */
export const BLAZE_FIRE_RANGE = 20;
/** 火球初速（格/秒）。原版小火球约 0.8 格/tick = 16 */
export const BLAZE_FIREBALL_SPEED = 16;
/** 火球打中玩家的伤害（原版 5 点） */
export const FIREBALL_DAMAGE = 5;
/** 打中之后点着多久（秒，原版 5 秒） */
export const FIREBALL_FIRE_SECONDS = 5;

export class Blaze extends Mob {
  /**
   * 距离下次开火还有多久。
   *
   * 出生时先摇半程再开始计时：**刚生成就一炮打脸**既不符合原版，也会让
   * "要塞里的刷怪笼一刷出来就有人在旁边"变成一个陷阱（玩家连反应时间都没有）。
   */
  private fireTimer = BLAZE_FIRE_COOLDOWN * (0.5 + Math.random() * 0.5);

  constructor(x: number, y: number, z: number) {
    super(BLAZE_TYPE, x, y, z);
  }

  /** 距下次开火还有多久（测试与调试用） */
  get fireCooldown(): number {
    return this.fireTimer;
  }

  /**
   * 飞行 AI：先让基类把"悬停 + 逼近"做完（它同时处理撞人那一下），
   * 再在这儿补火球。顺序有讲究——先动位置再开火，火球才是从"这一帧的位置"吐出来的。
   */
  protected override flyAi(
    ctx: EntityContext,
    dt: number,
    player: { x: number; y: number; z: number } | null,
  ): void {
    super.flyAi(ctx, dt, player);

    if (this.fireTimer > 0) this.fireTimer -= dt;
    if (!player || this.dead) return;

    // 瞄玩家胸口：玩家的 y 是脚底，所以 +1；自己从身体中部吐出去
    const mouthY = this.y + this.type.height * 0.6;
    const dx = player.x - this.x;
    const dy = player.y + 1 - mouthY;
    const dz = player.z - this.z;
    if (Math.hypot(dx, dz) > BLAZE_FIRE_RANGE) return;
    if (this.fireTimer > 0) return;

    this.fireTimer = BLAZE_FIRE_COOLDOWN;
    const length = Math.hypot(dx, dy, dz) || 1;
    ctx.spawnSmallFireball?.(this.x, mouthY, this.z, {
      x: (dx / length) * BLAZE_FIREBALL_SPEED,
      y: (dy / length) * BLAZE_FIREBALL_SPEED,
      z: (dz / length) * BLAZE_FIREBALL_SPEED,
    });
    // 项目里暂时没有"烈焰人喷火"那一声，借用引信的嘶嘶声（`EntityContext.playSound`
    // 的取值是一张闭表，加新的要在音频模块里连材质映射一起补，留给音效那一条）
    ctx.playSound?.('fuse', this.x, mouthY, this.z);
  }
}
