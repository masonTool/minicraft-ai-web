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
 *  - 骑乘**不要求鞍**（鞍这件物品还没做）；
 *  - 只做"前进/后退 + 左右转向"，没有跳跃蓄力、没有马的跳跃高度。
 */

import { Mob } from './Mob.ts';
import type { EntityContext } from './Entity.ts';

/** 左右转向的速度（弧度/秒）：比视角慢一档，不然马会像陀螺 */
const HORSE_TURN_RATE = 2.2;
/** 松开前进后的减速（每秒比例） */
const HORSE_STOP_DRAG = 6;

export class Horse extends Mob {
  /** 谁骑着它（本项目只有玩家能上） */
  passenger: 'player' | null = null;
  /** 玩家坐在马背上时脚底相对马脚的高度（渲染与相机用） */
  readonly seatHeight = 1.45;

  protected override updateAi(ctx: EntityContext, dt: number): void {
    if (this.passenger !== null) {
      const input = ctx.vehicleInput;
      const forward = input?.forward ?? 0;
      const strafe = input?.strafe ?? 0;

      // 转向：左右键（A/D 或摇杆横轴）改朝向；马不像船能横移
      this.yaw -= strafe * HORSE_TURN_RATE * dt;

      if (Math.abs(forward) > 0.05) {
        // 直接给水平速度：位置的积分在 `Mob.tick` 里统一做（`moveBody`），
        // 这里不需要再走 `move()`——那条分支是给 AI 寻路用的，骑马是"人给方向"。
        // 后退只有一半速度（原版马也这样）。
        const speed = this.type.speed * (forward > 0 ? 0.9 : 0.45);
        this.vx = -Math.sin(this.yaw) * speed;
        this.vz = -Math.cos(this.yaw) * speed;
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
