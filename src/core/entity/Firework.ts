/**
 * 烟花火箭实体（批次 192，H16）
 *
 * 与投掷物（`Throwable`）不同，烟花**不参与碰撞**：它一路往上飞，飞到引信烧完就炸。
 * 所以这里只有一个"匀速上升 + 倒计时"的循环：
 *
 *  - 速度固定 `FIREWORK_RISE_SPEED`（10 格/秒），三档分别在 10 / 14 / 18 格左右炸开；
 *  - 引信时长由**飞行档**决定（见 `fireworkRiseSeconds`），与上升速度分开写，
 *    这样"想让它飞高一点但不炸晚"时改一个数就行；
 *  - 炸开时只报"在哪、什么颜色、多大威力、多少伤害"——粒子、伤害结算、音效全归主程序
 *    （实体层不认识世界，也不该决定"炸到谁"）。
 *
 * ⚠️ 不做"火箭炸到自己"：原版火箭在离地太近时爆开会对发射者造成伤害，这里刻意没有，
 * 理由是"对着脚边点一下就掉半管血"更像 bug 而不是玩法（这条差异写进 TASKS H16）。
 */

import { Entity, type EntityContext } from './Entity.ts';
import { FIREWORK_RISE_SPEED, fireworkExplosionPower, fireworkRiseSeconds, fireworkDamage } from '../items/Firework.ts';

export class Firework extends Entity {
  /** 爆炸颜色（0xRRGGBB）；空数组由主程序补成金色 */
  readonly colors: readonly number[];
  /** 飞行档 1~3 */
  readonly flight: number;

  /** 引信剩余秒数 */
  private fuse: number;

  constructor(x: number, y: number, z: number, flight: number, colors: readonly number[]) {
    // 碰撞盒很小：它不参与碰撞，这个尺寸只是为了让"实体表里有个大小"
    super(x, y, z, 0.25, 0.25);
    this.flight = Math.max(1, Math.min(3, Math.round(flight)));
    this.colors = [...colors];
    this.fuse = fireworkRiseSeconds(this.flight);
  }

  tick(ctx: EntityContext, dt: number): void {
    // 已经炸过就别再炸一次：实体管理器是"tick 完再删"，但别的地方（测试、快进）可能多推几帧
    if (this.dead) return;
    this.age += dt;
    this.y += FIREWORK_RISE_SPEED * dt;
    this.fuse -= dt;
    if (this.fuse > 0) return;
    ctx.burstFirework?.(
      this.x,
      this.y,
      this.z,
      this.colors,
      fireworkExplosionPower(this.flight),
      fireworkDamage(this.flight),
    );
    this.dead = true;
  }
}
