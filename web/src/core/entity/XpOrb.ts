/**
 * 经验球（I16，批次 170）
 *
 * 在它之前，本项目的经验是"**直接进账**"的：挖一块矿、打死一只怪，数字当场跳到经验条上
 * （见 `main.ts` 的 `awardXp`）。玩家最容易察觉的两处差距就在那儿：
 *  - **死亡不掉球**——原版死一次，身上的经验散成一地球，别人（或自己重跑回来）能捡；
 *  - **挖矿没有"捡"这一步**——原版钻石矿炸开时那串绿点是要走过去收的。
 *
 * 这一批把它拆成两段：**生成**（`splitXpOrbs` + 这个实体）与**记账**（`ctx.awardXp`）。
 *
 * 对齐原版的地方：
 *  - 一团经验会被**拆成几个球**，球的大小是固定的几档（`ORB_VALUES`：1/3/7/17/37…），
 *    所以"打一群怪地上是一大把小球"而不是一个巨球；
 *  - 玩家在 8 格内时**自动飞过来**（原版就是这个半径），飞过来这一段**不撞方块**
 *    （原版球会贴着地形拐，代价是要写寻路；这里选"直线飞过去"，差 4.5 格以内看不出来）；
 *  - 落地后原地小幅浮动，5 分钟后消失；
 *  - 靠得极近就结算（`ctx.awardXp`），球消失。
 *
 * 没做的（写进 TASKS I16）：
 *  - 经验球**不进存档、也不联机同步**（本项目实体整体都不进存档，见 J2）；
 *  - 不做原版那种"球被方块挤开"的碰撞推挤。
 */

import { Entity, type EntityContext } from './Entity.ts';
import { moveBody, type MovingBody } from '../physics/EntityMotion.ts';

/** 经验球的存在时长（秒，原版 6000 tick = 5 分钟） */
export const XP_ORB_LIFETIME = 300;

/**
 * 一个球能装几经验（原版 `ExperienceOrb.getExperienceValue` 那张档位表）。
 *
 * ⚠️ 这不是"随便取的几档"：它决定了"一堆经验落在地上长什么样"。
 * 用连续值（比如每个球 1 点）会让 100 点经验变成 100 个球——**实体数量**会比原版多两个数量级。
 */
export const ORB_VALUES: readonly number[] = [1, 3, 7, 17, 37, 73, 149, 247, 617, 1207, 3073];

/** 玩家进到这个半径内，球就开始朝人飞（原版 8 格） */
export const XP_ORB_ATTRACT_RANGE = 8;
/** 进到这个距离就结算（球心到玩家腰） */
export const XP_ORB_PICKUP_RANGE = 0.9;
/** 吸附速度（格/秒）——比玩家走路快，所以"跑着捡"也能收干净 */
export const XP_ORB_ATTRACT_SPEED = 7.5;

const GRAVITY = 16;
const MAX_FALL_SPEED = 12;

/**
 * 把一团经验拆成几个球（纯函数，值域见 `ORB_VALUES`）。
 *
 * 从大到小贪心：原版也是"先拿最大的那一档"，于是 10 点 → `[7, 3]`、
 * 100 点 → `[73, 17, 7, 3]`。单点经验（挖一块煤 1 点）就是 `[1]`。
 *
 * @param total 这次要掉多少经验（<= 0 返回空数组：调用方不必自己判）
 */
export function splitXpOrbs(total: number): number[] {
  let left = Math.floor(total);
  if (!Number.isFinite(left) || left <= 0) return [];
  const sizes: number[] = [];
  while (left > 0) {
    // 找最大的、且不超过 remaining 的那一档
    let pick = ORB_VALUES[0]!;
    for (const value of ORB_VALUES) {
      if (value <= left) pick = value;
      else break;
    }
    sizes.push(pick);
    left -= pick;
  }
  return sizes;
}

export class XpOrb extends Entity implements MovingBody {
  /** 渲染用的浮动相位（同一批掉出来的球错开，免得看起来像一整块在动） */
  readonly bobPhase: number;

  constructor(
    public amount: number,
    x: number,
    y: number,
    z: number,
    initialVelocity?: { x: number; y: number; z: number },
  ) {
    super(x, y, z, 0.25, 0.25);
    this.bobPhase = Math.random() * Math.PI * 2;
    if (initialVelocity) {
      this.vx = initialVelocity.x;
      this.vy = initialVelocity.y;
      this.vz = initialVelocity.z;
    } else {
      // 原版掉球时向四周轻轻弹开：不这么做，一堆球会叠成一根柱子
      this.vx = (Math.random() - 0.5) * 1.6;
      this.vy = 1.6 + Math.random() * 1.2;
      this.vz = (Math.random() - 0.5) * 1.6;
    }
  }

  override tick(ctx: EntityContext, dt: number): void {
    if (this.dead) return;

    this.age += dt;
    if (this.age > XP_ORB_LIFETIME) {
      this.dead = true;
      return;
    }

    const player = ctx.player;
    if (player) {
      // 原版把"人"看成一个点（腰那一带），球飞向它而不是玩家的碰撞盒中心
      const tx = player.x;
      const ty = player.y + 0.8;
      const tz = player.z;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dz = tz - this.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq <= XP_ORB_PICKUP_RANGE * XP_ORB_PICKUP_RANGE) {
        ctx.awardXp?.(this.amount);
        this.dead = true;
        return;
      }

      if (distSq <= XP_ORB_ATTRACT_RANGE * XP_ORB_ATTRACT_RANGE) {
        // 吸附阶段：**不撞方块**（原版球会绕，这里直着飞过去；理由见文件头）
        const dist = Math.sqrt(distSq) || 1;
        const step = XP_ORB_ATTRACT_SPEED * dt;
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        this.z += (dz / dist) * step;
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.onGround = false;
        return;
      }
    }

    // 自由状态：与掉落物同一套物理（重力 + 贴地摩擦）
    this.vy -= GRAVITY * dt;
    if (this.vy < -MAX_FALL_SPEED) this.vy = -MAX_FALL_SPEED;
    const friction = Math.pow(this.onGround ? 0.5 : 0.98, dt * 20);
    this.vx *= friction;
    this.vz *= friction;
    moveBody(ctx.world, this, this.vx * dt, this.vy * dt, this.vz * dt);
    if (this.onGround && Math.abs(this.vx) < 0.02 && Math.abs(this.vz) < 0.02) {
      this.vx = 0;
      this.vz = 0;
    }
  }
}
