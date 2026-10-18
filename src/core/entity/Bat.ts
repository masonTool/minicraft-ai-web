/**
 * 蝙蝠（批次 261，J16 最后一只被动生物）
 *
 * 与其它被动生物的区别是**会飞**：不走地面游荡，而是在出生点附近随机挑一个
 * 空中目标点、径直飞过去，到了再换一个。`Mob.tick` 里 `type.flying` 那一支
 * 已经负责"没有重力 + 速度阻尼"，所以这里只给 `vx/vy/vz`，位置积分交给父类。
 *
 * ⚠️ 生成差异（写进 TASKS J16）：原版蝙蝠刷在**洞穴**里，而本项目的刷怪判据
 * 只有"地表草地/雪层"与"水里"两条路（`getSurfaceBlockY` 拿到的是**世界表面**，
 * 不是脚下那片洞穴的地面），没有"洞穴地面"这个通道，所以蝙蝠标成
 * `naturalSpawn: false`——只能靠刷怪蛋/命令见到。不这么做的话，
 * 它会被均匀撒在白天草地上，比"见不到"更怪。
 */

import { Mob } from './Mob.ts';
import type { EntityContext } from './Entity.ts';

/** 换目标的间隔（秒） */
const BAT_RETARGET_MIN = 2;
const BAT_RETARGET_MAX = 5;
/** 悬停范围（格）：以出生点为中心的这一团空气里飞 */
const BAT_HOME_RADIUS = 4;

export class Bat extends Mob {
  /** 出生点（第一次 tick 时记住）：蝙蝠只在附近飞，不会越飞越远 */
  private homeX: number | null = null;
  private homeY = 0;
  private homeZ = 0;
  private targetX = 0;
  private targetY = 0;
  private targetZ = 0;
  private retargetIn = 0;

  /** 在出生点附近重新挑一个空中目标点 */
  private pickTarget(): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1 + Math.random() * (BAT_HOME_RADIUS - 1);
    this.targetX = (this.homeX ?? this.x) + Math.cos(angle) * radius;
    this.targetZ = (this.homeZ || this.z) + Math.sin(angle) * radius;
    // 上下也在 ±2 内挑：蝙蝠是在树冠/洞顶那一层绕，不会贴地跑
    this.targetY = this.homeY + (Math.random() - 0.4) * 3;
    this.retargetIn = BAT_RETARGET_MIN + Math.random() * (BAT_RETARGET_MAX - BAT_RETARGET_MIN);
  }

  protected override updateAi(ctx: EntityContext, dt: number): void {
    if (this.homeX === null) {
      this.homeX = this.x;
      this.homeY = this.y;
      this.homeZ = this.z;
      this.pickTarget();
    }

    this.retargetIn -= dt;
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dz = this.targetZ - this.z;
    const distance = Math.hypot(dx, dy, dz);
    if (this.retargetIn <= 0 || distance < 0.6) {
      this.pickTarget();
      return;
    }

    // 直接给三维速度：重力/阻尼由 `Mob.tick` 的 `flying` 分支处理
    const speed = this.type.speed;
    this.vx = (dx / distance) * speed;
    this.vy = (dy / distance) * speed;
    this.vz = (dz / distance) * speed;
    this.yaw = Math.atan2(dx, dz);
    void ctx;
  }
}
