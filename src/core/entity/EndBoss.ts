/**
 * 末地 boss：末影龙 + 末地水晶
 *
 * 末影龙与普通生物的最大差别是**它会飞**，所以不能走 Mob 那套「重力 + 寻路 + 贴地」的 tick。
 * 这里继承 Mob 但整体覆盖 tick，自己实现飞行 AI：
 *
 *   circle 阶段：绕着主岛（世界原点）半径 46 的圆飞，高度在 78 附近起伏
 *   charge 阶段：锁定玩家直线俯冲，撞到就造成伤害
 *   两个阶段每 8~12 秒交替，因此玩家会看到「盘旋 → 俯冲 → 再盘旋」的原版节奏
 *
 * 末地水晶（黑曜石柱顶）是龙的**回血源**：只要还有存活的水晶，龙每 2 秒回 1 点血
 * （对齐原版机制）。水晶被击毁时爆炸，会伤到附近的玩家。
 *
 * ⚠️ 与主世界生物一样，两者都是 Mob 子类，因此渲染、近战射线判定、区块卸载清理
 * 全部自动复用，不需要额外接线。
 */

import type { EntityContext } from './Entity.ts';
import { Mob, type MobType } from './Mob.ts';
import { Block } from '../registry/blocks.ts';

/** 击杀末影龙的经验（原版 12000 点，够从 0 级连升到 60 级往上） */
export const ENDER_DRAGON_XP = 12000;

/** 末影龙：200 点生命（对齐原版），碰撞盒按可玩性缩小到 6×4 */
export const DRAGON_TYPE: MobType = {
  id: 'ender_dragon',
  name: '末影龙',
  health: 200,
  width: 6,
  height: 4,
  speed: 12,
  hostile: true,
  attackDamage: 6,
  followRange: 200,
  drops: [{ itemId: Block.DRAGON_EGG, min: 1, max: 1 }],
  // 龙的 `hurt` 是自己写的（带无敌帧），经验在那里显式结算，不走 Mob.dropLoot
  xp: ENDER_DRAGON_XP,
  // boss（批次 116）：不会因为玩家跑远而消失（那会让"打赢了也白打"）
  boss: true,
  bodyColor: 0x15121c,
  accentColor: 0x2f2647,
  eyeHeight: 3,
};

/** 末地水晶：1 点生命，悬浮不动 */
export const END_CRYSTAL_TYPE: MobType = {
  id: 'end_crystal',
  name: '末地水晶',
  health: 1,
  width: 1.6,
  height: 1.6,
  speed: 0,
  hostile: false,
  attackDamage: 0,
  followRange: 0,
  drops: [],
  xp: 0,
  bodyColor: 0xe8d8f0,
  accentColor: 0x8a4fd0,
  eyeHeight: 0.8,
};

/** 龙的盘旋半径与巡航高度（主岛在原点、岛面 y≈66） */
export const DRAGON_ORBIT_RADIUS = 46;
export const DRAGON_CRUISE_Y = 78;

/**
 * 血息阶段（K4 尾巴）：龙悬停在玩家上方吐龙息，**每 0.4 秒一团云**，
 * 这是龙息（滞留药水的原料）在生存里的唯一来源。
 */
export const DRAGON_BREATH_PHASE_TIME = 6;
export const DRAGON_BREATH_INTERVAL = 0.4;
/** 血息阶段的悬停高度（玩家上方 14 格：够高打不到近战，又够低能罩住脚下一片） */
const BREATH_HOVER_HEIGHT = 14;

export class Dragon extends Mob {
  /** 存活的水晶数量（主线程每帧同步）：>0 时龙会缓慢回血 */
  crystalCount = 0;

  /** 渲染用的扇翅相位（渲染器读取） */
  flapPhase = 0;

  private invuln = 0;
  private attackTimer = 0;
  private regenTimer = 0;
  private orbitAngle: number;
  private phase: 'circle' | 'charge' | 'breath' = 'circle';
  private phaseTimer = 10;
  /** 血息阶段里距离下一团云还有多久（秒） */
  private breathTimer = 0;

  constructor(x: number, y: number, z: number, orbitAngle = 0) {
    super(DRAGON_TYPE, x, y, z);
    this.orbitAngle = orbitAngle;
  }

  /** 当前阶段（调试与测试用） */
  get stage(): string {
    return this.phase;
  }

  override tick(ctx: EntityContext, dt: number): void {
    this.age += dt;
    this.flapPhase += dt * 3.2;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.attackTimer > 0) this.attackTimer -= dt;

    // ---- 水晶回血（原版：柱子上的水晶没被清光，龙就会一直回血）
    if (this.crystalCount > 0 && this.health < this.type.health) {
      this.regenTimer -= dt;
      if (this.regenTimer <= 0) {
        this.regenTimer = 2;
        this.health = Math.min(this.type.health, this.health + 1);
      }
    }

    // ---- 阶段切换：盘旋 → 俯冲 → 血息 → 回盘旋
    this.phaseTimer -= dt;
    if (this.phaseTimer <= 0) {
      if (this.phase === 'circle') {
        this.phase = 'charge';
        this.phaseTimer = 4;
      } else if (this.phase === 'charge') {
        // 俯冲完接着吐一轮血息（K4 尾巴）：这也是**龙息**的唯一来源
        this.phase = 'breath';
        this.phaseTimer = DRAGON_BREATH_PHASE_TIME;
        this.breathTimer = 0;
      } else {
        this.phase = 'circle';
        this.phaseTimer = 8 + Math.random() * 5;
      }
    }

    const player = ctx.player;
    let targetX: number;
    let targetY: number;
    let targetZ: number;
    let speed: number;

    if (this.phase === 'charge' && player) {
      targetX = player.x;
      targetY = player.y + 1;
      targetZ = player.z;
      speed = 20;
    } else if (this.phase === 'breath' && player) {
      // 血息阶段：悬停在玩家上方（够高打不到，又够低能罩住脚下一片）
      targetX = player.x;
      targetY = player.y + BREATH_HOVER_HEIGHT;
      targetZ = player.z;
      speed = 10;
    } else {
      this.orbitAngle += 0.32 * dt;
      targetX = Math.cos(this.orbitAngle) * DRAGON_ORBIT_RADIUS;
      targetY = DRAGON_CRUISE_Y + Math.sin(this.age * 0.6) * 5;
      targetZ = Math.sin(this.orbitAngle) * DRAGON_ORBIT_RADIUS;
      speed = 12;
    }

    this.steer(targetX, targetY, targetZ, speed, dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    this.yaw = Math.atan2(this.vx, this.vz);

    // ---- 俯冲撞击
    if (this.phase === 'charge' && player && this.attackTimer <= 0) {
      const distance = Math.hypot(player.x - this.x, player.z - this.z);
      const vertical = Math.abs(player.y - this.y);
      if (distance < 5.5 && vertical < 4) {
        ctx.hurtPlayer(this.type.attackDamage, this.x, this.z, 'generic', this.type.name, this.y);
        this.attackTimer = 1.5;
      }
    }

    // ---- 血息喷吐（K4 尾巴）：每 0.4 秒一团云，一团比一团更靠近玩家
    if (this.phase === 'breath' && player) {
      this.breathTimer -= dt;
      if (this.breathTimer <= 0) {
        this.breathTimer = DRAGON_BREATH_INTERVAL;
        const dx = player.x - this.x;
        const dz = player.z - this.z;
        const length = Math.hypot(dx, dz) || 1;
        // 从龙嘴出发朝玩家的脚下一路铺过去：进度随阶段时间推进。
        // 于是"站着不动看龙吐息"会被一路烧到，走开就能躲——这与原版血息云
        // "会朝吐出的方向漂"手感接近，但不用给云加一份速度与阻力（云是静止的）
        const progress = 1 - Math.max(0, this.phaseTimer) / DRAGON_BREATH_PHASE_TIME;
        const mouthX = this.x + (dx / length) * 4;
        const mouthY = this.y + 0.5;
        const mouthZ = this.z + (dz / length) * 4;
        const targetY = player.y + 0.2;
        ctx.spawnDragonBreath?.(
          mouthX + (player.x - mouthX) * progress,
          mouthY + (targetY - mouthY) * progress,
          mouthZ + (player.z - mouthZ) * progress,
        );
      }
    }

    // 掉出世界（理论上不会发生，兜底）
    if (this.y < -70) this.dead = true;
  }

  /** 朝目标平滑转向（空中转向慢一点，看起来才有"巨兽"的惯性） */
  private steer(targetX: number, targetY: number, targetZ: number, speed: number, dt: number): void {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dz = targetZ - this.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    const ax = (dx / length) * speed;
    const ay = (dy / length) * speed;
    const az = (dz / length) * speed;
    const factor = Math.min(1, 1.8 * dt);
    this.vx += (ax - this.vx) * factor;
    this.vy += (ay - this.vy) * factor;
    this.vz += (az - this.vz) * factor;
  }

  /**
   * 龙的受击：**不被击退**（原版 boss 的击退抗性），无敌帧也更短，
   * 否则玩家一轮连击就能把它钉在原地。
   */
  override hurt(amount: number, knockbackX: number, knockbackZ: number, ctx?: EntityContext): boolean {
    void knockbackX;
    void knockbackZ;
    if (this.dead || this.invuln > 0 || amount <= 0) return false;

    this.invuln = 0.25;
    this.hitFlash = 0.3;
    this.health -= amount;

    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      // 死亡掉落（原版是龙蛋 + 12000 点经验）
      for (const drop of this.type.drops) {
        const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
        if (count > 0 && ctx) ctx.spawnDrop(drop.itemId, count, this.x, this.y + this.height * 0.5, this.z);
      }
      // 12000 点会连升好多级（原版也是这么设计的）。批次 170 起掉成一地球（I16）：
      // `splitXpOrbs` 会把它拆成一串 3073/1207/617… 的球，而不是一个巨球
      if (ctx?.spawnXpOrbs) ctx.spawnXpOrbs(ENDER_DRAGON_XP, this.x, this.y + 2, this.z);
      else ctx?.awardXp?.(ENDER_DRAGON_XP);
    }
    return true;
  }
}

/** 水晶爆炸的影响半径与最大伤害（原版爆炸半径约 6 格） */
const CRYSTAL_BLAST_RADIUS = 6;
const CRYSTAL_BLAST_DAMAGE = 6;

export class EndCrystal extends Mob {
  constructor(x: number, y: number, z: number) {
    super(END_CRYSTAL_TYPE, x, y, z);
  }

  override tick(_ctx: EntityContext, dt: number): void {
    this.age += dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    // 悬浮不动：不加重力、不做 AI
  }

  /** 水晶一碰就碎，碎的时候爆炸（会伤到站在附近的玩家） */
  override hurt(_amount: number, _knockbackX: number, _knockbackZ: number, ctx?: EntityContext): boolean {
    if (this.dead) return false;
    this.dead = true;

    const player = ctx?.player;
    if (player && ctx) {
      const distance = Math.hypot(player.x - this.x, player.y - this.y, player.z - this.z);
      if (distance < CRYSTAL_BLAST_RADIUS) {
        const falloff = 1 - distance / CRYSTAL_BLAST_RADIUS;
        ctx.hurtPlayer(CRYSTAL_BLAST_DAMAGE * falloff, this.x, this.z, 'explosion', '末影水晶');
      }
    }
    return true;
  }
}
