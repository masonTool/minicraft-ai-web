/**
 * 凋灵 boss（J14 的后半，批次 116）
 *
 * 它与普通生物最大的差别是**会飞**，而且有三颗头——所以与末影龙同一条取舍：
 * 继承 `Mob` 但**整体覆盖 `tick`**，自己实现飞行与阶段。
 *
 * 三个阶段（原版那套"越打越凶"）：
 *  ① **> 50%**：悬在玩家上方约 9 格，每 2 秒吐一颗**黑色**骷髅头
 *    （5 点伤害 + 凋零 10 秒）；
 *  ② **掉到 50% 的那一刻**：原地爆炸一次 + **5 秒护盾**（免疫一切伤害，原版那个
 *    "护盾阶段"），之后改吐**蓝色**骷髅头（8 点 + 凋零 40 秒），飞得更快；
 *  ③ **≤ 25%**：吐得更勤（每 1 秒一颗）。
 * 死亡时再炸一次，并掉 **1 颗下界之星**（原版唯一的掉落）。
 *
 * ⚠️ 与原版的差异（记在 TASKS J14）：
 *  - **三颗头不做"每颗独立瞄准"**：原版中间那颗与两侧那颗各打各的，这里统一由
 *    中心朝玩家吐；
 *  - **不做"飞行时免疫箭矢"**（原版那条只在它有护甲时成立，本项目用"护盾 5 秒"替代）；
 *  - 死亡爆炸**不拆地形**（与苦力怕那套共用 `ctx.explode`，`mobGriefing` 关掉时
 *    连伤害都只是"炸一下"）；
 *  - **免疫一切状态效果**（原版凋灵免疫凋零）：因为它整体覆盖了 `tick`，
 *    效果结算那一段根本不跑——这一条是"覆盖 tick"顺带带来的，不是特判。
 */

import { Mob, type MobType } from './Mob.ts';
import type { EntityContext } from './Entity.ts';
import { Item } from '../registry/items.ts';

/** 凋灵：300 点生命（原版）、三颗头、会飞 */
export const WITHER_TYPE: MobType = {
  id: 'wither',
  name: '凋灵',
  health: 300,
  // 原版碰撞盒是 0.9×3.5；这里按"手机上也打得到"稍微放宽（与末影龙同一条取舍）
  width: 1.2,
  height: 3,
  speed: 6,
  hostile: true,
  // 原版凋灵**不近战**：伤害全在那两颗骷髅头上（与恶魂同一个取舍）
  attackDamage: 0,
  followRange: 40,
  drops: [{ itemId: Item.NETHER_STAR, min: 1, max: 1 }],
  xp: 50,
  flying: true,
  fireImmune: true,
  boss: true,
  bodyColor: 0x2b2b33,
  accentColor: 0x14141a,
  // 三颗头上那几对暗红的眼睛（纯黑身体上唯一的辨识点）
  eyeColor: 0xd2352a,
  eyeHeight: 2.2,
};

/** 悬停在玩家上方多高（格）：够高打不到近战，又够低能看清它在瞄你 */
export const WITHER_HOVER_HEIGHT = 9;
/** 两次吐骷髅头之间隔多久（秒）：一阶段 2 秒、狂暴 1 秒 */
export const WITHER_SHOOT_COOLDOWN = 2;
export const WITHER_RAGE_COOLDOWN = 1;
/** 转阶段那一下的爆炸威力与护盾时长（原版是"炸开 + 一段时间无敌"） */
export const WITHER_SHIELD_SECONDS = 5;
export const WITHER_SHIELD_BLAST_POWER = 1;
export const WITHER_DEATH_BLAST_POWER = 1;
/** 骷髅头的初速（格/秒）：比玩家扔的东西快，但比箭慢 */
export const WITHER_SKULL_SPEED = 22;

export class Wither extends Mob {
  /** 护盾剩余秒数（> 0 时免疫一切伤害） */
  private shield = 0;
  /** 护盾用过没有（只触发一次：转阶段那一下） */
  private shieldedOnce = false;
  /** 距离下一颗骷髅头还有多久 */
  private shootTimer = 1.5;

  constructor(x: number, y: number, z: number) {
    super(WITHER_TYPE, x, y, z);
  }

  /** 当前阶段：1 = > 50%、2 = ≤ 50%、3 = ≤ 25%（渲染、HUD 与测试读它） */
  get phase(): 1 | 2 | 3 {
    const ratio = this.health / this.type.health;
    if (ratio <= 0.25) return 3;
    if (ratio <= 0.5) return 2;
    return 1;
  }

  /** 现在是不是护盾期（免疫伤害）——HUD 与测试读它 */
  get shielded(): boolean {
    return this.shield > 0;
  }

  override tick(ctx: EntityContext, dt: number): void {
    this.age += dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.dead) return;
    if (this.shield > 0) this.shield -= dt;

    const player = ctx.player;
    const ratio = this.health / this.type.health;

    // ---- 转阶段：第一次掉到一半 → 炸一下 + 起 5 秒护盾（原版那个"护盾阶段"）
    if (!this.shieldedOnce && ratio <= 0.5) {
      this.shieldedOnce = true;
      this.shield = WITHER_SHIELD_SECONDS;
      ctx.explode?.(this.x, this.y, this.z, WITHER_SHIELD_BLAST_POWER);
      ctx.playSound?.('explode', this.x, this.y, this.z);
    }

    // ---- 飞行：悬停在玩家上方（越低血越急）
    if (player) {
      const speed = this.phase === 3 ? 9 : this.phase === 2 ? 7 : 5.5;
      this.steer(player.x, player.y + WITHER_HOVER_HEIGHT, player.z, speed, dt);
    } else {
      // 没有玩家（离线测试、玩家还没进来）：原地慢慢浮动
      this.vx *= Math.max(0, 1 - 2 * dt);
      this.vz *= Math.max(0, 1 - 2 * dt);
      this.vy = Math.sin(this.age * 1.2) * 0.6;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    this.yaw = Math.atan2(this.vx, this.vz);

    // ---- 吐骷髅头
    this.shootTimer -= dt;
    if (player && this.shootTimer <= 0) {
      this.shootTimer = this.phase === 3 ? WITHER_RAGE_COOLDOWN : WITHER_SHOOT_COOLDOWN;
      const blue = this.phase >= 2;
      const dx = player.x - this.x;
      const dy = player.y + 1 - (this.y + this.type.eyeHeight);
      const dz = player.z - this.z;
      const length = Math.hypot(dx, dy, dz) || 1;
      // 从"脸"前面一点吐出去（免得刚生成就撞上自己的身体）
      ctx.spawnWitherSkull?.(
        this.x + (dx / length) * 1.4,
        this.y + this.type.eyeHeight + (dy / length) * 1.4,
        this.z + (dz / length) * 1.4,
        {
          x: (dx / length) * WITHER_SKULL_SPEED,
          y: (dy / length) * WITHER_SKULL_SPEED,
          z: (dz / length) * WITHER_SKULL_SPEED,
        },
        blue,
      );
      ctx.playSound?.('bow_shoot', this.x, this.y, this.z);
    }

    if (this.y < -70) this.dead = true;
  }

  /**
   * 凋灵的受击：**不被击退**（boss 的击退抗性，与末影龙同一条），
   * 护盾期免疫一切伤害，死亡时炸一下并掉下界之星。
   */
  override hurt(amount: number, knockbackX: number, knockbackZ: number, ctx?: EntityContext): boolean {
    void knockbackX;
    void knockbackZ;
    if (this.dead || amount <= 0) return false;
    if (this.shield > 0) return false;

    this.hitFlash = 0.3;
    this.health -= amount;
    if (this.health > 0) return true;

    this.health = 0;
    this.dead = true;
    const drop = this.type.drops[0];
    if (drop && ctx) ctx.spawnDrop(drop.itemId, drop.min, this.x, this.y + 1, this.z);
    ctx?.awardXp?.(this.type.xp);
    // 原版凋灵倒下时会炸一次（本项目不拆地形，只炸人）
    ctx?.explode?.(this.x, this.y, this.z, WITHER_DEATH_BLAST_POWER);
    return true;
  }

  /** 朝目标平滑加速（与末影龙的 `steer` 同款：空中转向有惯性） */
  private steer(targetX: number, targetY: number, targetZ: number, speed: number, dt: number): void {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dz = targetZ - this.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    const factor = Math.min(1, 1.8 * dt);
    this.vx += ((dx / length) * speed - this.vx) * factor;
    this.vy += ((dy / length) * speed - this.vy) * factor;
    this.vz += ((dz / length) * speed - this.vz) * factor;
  }
}
