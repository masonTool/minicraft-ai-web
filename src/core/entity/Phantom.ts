/**
 * 幻翼（J15 的最后一只，批次 126）
 *
 * 它是本项目**第一只"只靠俯冲打人"的飞行怪**：与凋灵（悬停 + 吐骷髅头）和
 * 恶魂（保持距离 + 吐火球）都不同——幻翼的招牌是**在你头顶绕圈，然后一头扎下来**。
 *
 * 所以它整体覆盖 `tick`（与凋灵、末影龙同一条取舍），用一个很小的状态机表达那套动作：
 *
 *   ① **盘旋**（`circle`）：在玩家上方约 18 格、半径 9 格绕圈，绕够一段时间就准备俯冲；
 *   ② **俯冲**（`dive`）：朝玩家的位置直线扎下去，**贴到 1.8 格内就撞一下**
 *      （`attackDamage` 3 点，与原版普通难度一致）；
 *   ③ **拉起**（`climb`）：扎到底（或超过一段时间）之后往上爬回盘旋高度。
 *
 * ⚠️ 与原版的差异（记在 TASKS J15）：
 *  - **不做"俯冲时的命中判定盒"**（原版俯冲的那一下是更大的一个碰撞盒）：这里按
 *    "离玩家多近"算，手感差别不大，但少一层几何；
 *  - **不做"撞碎玻璃"**（原版幻翼会拆窗户）；
 *  - **白天照样会被晒着烧**（与骷髅/僵尸同一条，见 `world/Daylight.ts`）——
 *    这也是它们只在天黑后出现的原因（`survival/Insomnia.ts`）。
 */

import { Mob, type MobType } from './Mob.ts';
import type { EntityContext } from './Entity.ts';
import { Item } from '../registry/items.ts';
import {
  PHANTOM_CIRCLE_HEIGHT,
  PHANTOM_CIRCLE_RADIUS,
} from '../survival/Insomnia.ts';

/** 幻翼：20 点生命、3 点接触伤害、会飞、亡灵（亡灵杀手对它有效） */
export const PHANTOM_TYPE: MobType = {
  id: 'phantom',
  name: '幻翼',
  health: 20,
  // 原版碰撞盒 0.9×0.5；这里放宽到 1.4×0.7：它飞得快，手机上够不着就没法打
  // （与凋灵那条"手机上也打得到"的取舍同源）
  width: 1.4,
  height: 0.7,
  speed: 9,
  hostile: true,
  attackDamage: 3,
  followRange: 48,
  drops: [{ itemId: Item.PHANTOM_MEMBRANE, min: 0, max: 1 }],
  xp: 5,
  flying: true,
  family: 'undead',
  // 天亮之后会被晒着烧（与骷髅同一条规则）——所以它们只在天黑后出现
  burnsInDaylight: true,
  /**
   * ⚠️ **不进自然生成表**：它的生成条件与地形无关，只看"玩家几天没睡"
   * （见 `survival/Insomnia.ts` 与主程序里的 `updateInsomnia`）。
   * 写进 `HOSTILE_MOBS` 的话，它会被当成普通怪撒到野地里——那是另一只生物了。
   */
  naturalSpawn: false,
  bodyColor: 0x37565a,
  accentColor: 0x1d3336,
  // 那双青色的眼睛是它唯一的亮点（原版也是靠眼睛认它）
  eyeColor: 0x6fe3d8,
  eyeHeight: 0.35,
};

/**
 * 俯冲持续多久就往回拉（秒）。
 *
 * ⚠️ 这个数**必须够它从盘旋高度扎到玩家身上**：盘旋在 18 格高、半径 9 格，
 * 直线距离接近 20 格，而俯冲速度是 9 格/秒——第一版写了 1.6 秒，
 * 结果是**它每次都差一点就掉头爬回去了**（招牌动作永远不发生，而且没有报错）。
 * 是 `test:phantom` 那条"俯冲下来贴到玩家就撞一下"抓出来的。
 */
export const PHANTOM_DIVE_SECONDS = 3;
/** 盘旋多久开始下一次俯冲（秒） */
export const PHANTOM_CIRCLE_SECONDS = 5;
/** 撞人的距离（格）：贴到这么近就算撞上（原版那一下的判定盒比身子大） */
export const PHANTOM_HIT_RANGE = 1.8;
/** 两次撞人之间至少隔多久（秒）：免得贴脸时每帧都扣血 */
export const PHANTOM_HIT_COOLDOWN = 1.2;

type Phase = 'circle' | 'dive' | 'climb';

export class Phantom extends Mob {
  private phase: Phase = 'circle';
  /** 当前阶段已经过了多久 */
  private phaseTimer = 0;
  /** 绕圈的当前角度（一直往前推，于是它是在"飞一个圆"） */
  private orbit = Math.random() * Math.PI * 2;
  /** 撞人的冷却 */
  private hitTimer = 0;

  constructor(x: number, y: number, z: number) {
    super(PHANTOM_TYPE, x, y, z);
    // ⚠️ **不在这里抬高度**：出生点由主程序决定（它是"玩家上方 22 格"，
    // 见 `updateInsomnia`）。第一版在这里写了 `y = max(y, 18)`，那会把
    // "玩家在 y=200 的山上"之外的**一切**出生点都压到 18 层——
    // 玩家在地下时它会直接生在石头里
  }

  /** 现在处于哪一段（渲染与离线测试读它） */
  get divePhase(): Phase {
    return this.phase;
  }

  override tick(ctx: EntityContext, dt: number): void {
    this.age += dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.dead) return;
    if (this.hitTimer > 0) this.hitTimer -= dt;

    const player = ctx.player;

    // 没有玩家（离线测试、玩家还没进来）：原地慢慢浮动，别往地里钻
    if (!player) {
      this.vx *= Math.max(0, 1 - 2 * dt);
      this.vz *= Math.max(0, 1 - 2 * dt);
      this.vy = Math.sin(this.age * 1.2) * 0.5;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;
      return;
    }

    this.phaseTimer += dt;
    // 朝玩家（原版它一直盯着你）
    this.yaw = Math.atan2(player.x - this.x, player.z - this.z);

    switch (this.phase) {
      case 'circle': {
        // 绕圈：角度一直往前推，目标点在水平面上转、竖直上固定在玩家上方
        this.orbit += dt * 0.9;
        const targetX = player.x + Math.cos(this.orbit) * PHANTOM_CIRCLE_RADIUS;
        const targetZ = player.z + Math.sin(this.orbit) * PHANTOM_CIRCLE_RADIUS;
        this.steer(targetX, player.y + PHANTOM_CIRCLE_HEIGHT, targetZ, this.type.speed * 0.5, dt);
        if (this.phaseTimer >= PHANTOM_CIRCLE_SECONDS) this.setPhase('dive');
        break;
      }
      case 'dive': {
        // 俯冲：朝玩家**当前**位置（不是预判）——所以玩家往旁边走一步就能躲开，
        // 这正是原版幻翼的手感：它扎得很快，但扎的是刚才那个位置
        this.steer(player.x, player.y + 0.8, player.z, this.type.speed, dt);
        if (this.phaseTimer >= PHANTOM_DIVE_SECONDS) this.setPhase('climb');
        // 撞人（贴到 1.8 格以内）
        if (this.hitTimer <= 0 && this.distanceToPlayer(ctx) <= PHANTOM_HIT_RANGE) {
          this.hitTimer = PHANTOM_HIT_COOLDOWN;
          // 不给 `cause`：那就是普通的"被生物打了一下"（默认 `generic`），
          // 与近战那条同一个口径——护甲照常减伤、无敌帧照常生效。
          // 也不放音效：玩家挨打的声音由生存模块统一播（这里再播一次会叠成两下）
          ctx.hurtPlayer(this.type.attackDamage, this.x, this.z, 'generic', this.type.name, this.y);
        }
        break;
      }
      case 'climb': {
        // 拉起：爬回盘旋高度，回到盘旋
        this.steer(player.x, player.y + PHANTOM_CIRCLE_HEIGHT, player.z, this.type.speed * 0.7, dt);
        if (this.y >= player.y + PHANTOM_CIRCLE_HEIGHT - 1.5) this.setPhase('circle');
        break;
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
  }

  /** 换一段，并把"这一段过了多久"归零（三段的切换判据都是它） */
  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseTimer = 0;
  }

  /**
   * 与玩家的**三维**距离（俯冲撞人用它；水平距离会让"擦着头顶飞过"也算撞上）。
   *
   * `ForTest` 那个名字是给离线测试用的入口：撞人的判据不值得为了测试改可见性，
   * 但"它到底有没有在靠近"得能量出来（见 `test:phantom`）。
   */
  distanceToPlayerForTest(ctx: EntityContext): number {
    return this.distanceToPlayer(ctx);
  }

  /** 与玩家的**三维**距离（俯冲撞人用它；水平距离会让"擦着头顶飞过"也算撞上） */
  private distanceToPlayer(ctx: EntityContext): number {
    const player = ctx.player;
    if (!player) return Number.POSITIVE_INFINITY;
    return Math.hypot(player.x - this.x, player.y - this.y, player.z - this.z);
  }

  /** 朝目标点调整速度（与凋灵同一套：够用、看不出"拐弯生硬"） */
  private steer(targetX: number, targetY: number, targetZ: number, speed: number, dt: number): void {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dz = targetZ - this.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    const factor = Math.min(1, 2.4 * dt);
    this.vx += ((dx / length) * speed - this.vx) * factor;
    this.vy += ((dy / length) * speed - this.vy) * factor;
    this.vz += ((dz / length) * speed - this.vz) * factor;
  }
}
